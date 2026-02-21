#!/usr/bin/env npx tsx
/**
 * X Integration - Check Notifications
 * Usage: echo '{"count":10}' | npx tsx notifications.ts
 */

import { getBrowserContext, runScript, config, ScriptResult } from '../lib/browser.js';

interface NotificationsInput {
  count?: number;    // max notifications to extract, default: 10
  tab?: 'all' | 'mentions';  // default: 'all'
}

interface NotificationData {
  type: string;     // 'like', 'retweet', 'reply', 'follow', 'mention', 'other'
  users: string;    // who triggered it
  text: string;     // notification text
  tweetPreview: string;  // preview of related tweet if applicable
  time: string;
}

async function checkNotifications(input: NotificationsInput): Promise<ScriptResult> {
  const { count = 10, tab = 'all' } = input;

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    const url = tab === 'mentions'
      ? 'https://x.com/notifications/mentions'
      : 'https://x.com/notifications';

    await page.goto(url, { timeout: config.timeouts.navigation, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(config.timeouts.pageLoad);

    // Check if logged in
    const isLoggedIn = await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').isVisible().catch(() => false);
    if (!isLoggedIn) {
      return { success: false, message: 'X login expired. Run /x-integration to re-authenticate.' };
    }

    // Wait for notifications to load
    await page.waitForTimeout(2000);

    // Scroll to load more
    if (count > 5) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1500);
    }

    const notifications: NotificationData[] = [];

    // Notifications are in article elements or div[data-testid="cellInnerDiv"] items
    const cells = await page.locator('[data-testid="cellInnerDiv"]').all();

    for (const cell of cells.slice(0, count * 2)) { // over-read because some cells are separators
      try {
        const text = await cell.innerText().catch(() => '');
        if (!text || text.trim().length < 5) continue;

        // Determine notification type from content
        let type = 'other';
        if (text.toLowerCase().includes('liked your')) type = 'like';
        else if (text.toLowerCase().includes('retweeted your') || text.toLowerCase().includes('reposted your')) type = 'retweet';
        else if (text.toLowerCase().includes('replied')) type = 'reply';
        else if (text.toLowerCase().includes('followed you')) type = 'follow';
        else if (text.toLowerCase().includes('mentioned you') || text.includes('@')) type = 'mention';

        // Extract time if available
        const timeEl = cell.locator('time');
        const time = await timeEl.getAttribute('datetime').catch(() => '') || '';

        // Clean up and truncate text
        const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 300);

        notifications.push({
          type,
          users: '', // extracted from text
          text: cleanText,
          tweetPreview: '',
          time,
        });

        if (notifications.length >= count) break;
      } catch {
        continue;
      }
    }

    if (notifications.length === 0) {
      return {
        success: true,
        message: `No notifications found (tab: ${tab})`,
        data: { tab, notifications: [] }
      };
    }

    // Format output
    const formatted = notifications.map((n, i) =>
      `[${i + 1}] [${n.type.toUpperCase()}] ${n.time ? `(${n.time})` : ''}\n${n.text}`
    ).join('\n\n---\n\n');

    // Summary counts
    const typeCounts: Record<string, number> = {};
    for (const n of notifications) {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    }
    const summary = Object.entries(typeCounts)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    return {
      success: true,
      message: `Notifications (${tab}, ${notifications.length} items):\nSummary: ${summary}\n\n${formatted}`,
      data: { tab, summary: typeCounts, notifications }
    };

  } finally {
    if (context) await context.close();
  }
}

runScript<NotificationsInput>(checkNotifications);
