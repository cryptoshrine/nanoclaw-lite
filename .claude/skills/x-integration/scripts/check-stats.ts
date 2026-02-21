#!/usr/bin/env npx tsx
/**
 * X Integration - Check Post Stats
 * Usage: echo '{"tweetUrl":"https://x.com/user/status/123"}' | npx tsx check-stats.ts
 */

import { getBrowserContext, runScript, navigateToTweet, ScriptResult } from '../lib/browser.js';

interface CheckStatsInput {
  tweetUrl: string;
}

interface StatsData {
  author: string;
  handle: string;
  text: string;
  time: string;
  replies: string;
  retweets: string;
  quotes: string;
  likes: string;
  bookmarks: string;
  views: string;
  url: string;
}

function extractNumber(ariaLabel: string): string {
  const match = ariaLabel.match(/(\d[\d,.KkMm]*)/);
  return match ? match[1] : '0';
}

async function checkStats(input: CheckStatsInput): Promise<ScriptResult> {
  const { tweetUrl } = input;

  if (!tweetUrl || tweetUrl.trim().length === 0) {
    return { success: false, message: 'Tweet URL is required' };
  }

  let context = null;
  try {
    context = await getBrowserContext();
    const { page, success, error } = await navigateToTweet(context, tweetUrl);

    if (!success) {
      return { success: false, message: error || 'Failed to navigate to tweet' };
    }

    const mainArticle = page.locator('article[data-testid="tweet"]').first();

    // Extract basic info
    const userNameEl = mainArticle.locator('[data-testid="User-Name"]');
    const nameText = await userNameEl.innerText().catch(() => '');
    const parts = nameText.split('\n').filter(Boolean);
    const author = parts[0] || 'Unknown';
    const handle = parts.find(p => p.startsWith('@')) || '';

    const tweetTextEl = mainArticle.locator('[data-testid="tweetText"]');
    const text = await tweetTextEl.innerText().catch(() => '');

    const timeEl = mainArticle.locator('time');
    const time = await timeEl.getAttribute('datetime').catch(() => '') || '';

    // Extract all stats
    const replyBtn = mainArticle.locator('[data-testid="reply"]');
    const retweetBtn = mainArticle.locator('[data-testid="retweet"], [data-testid="unretweet"]');
    const likeBtn = mainArticle.locator('[data-testid="like"], [data-testid="unlike"]');
    const bookmarkBtn = mainArticle.locator('[data-testid="bookmark"], [data-testid="removeBookmark"]');
    const viewsEl = mainArticle.locator('a[href*="/analytics"]');

    const replies = extractNumber(await replyBtn.getAttribute('aria-label').catch(() => '') || '');
    const retweets = extractNumber(await retweetBtn.getAttribute('aria-label').catch(() => '') || '');
    const likes = extractNumber(await likeBtn.getAttribute('aria-label').catch(() => '') || '');
    const bookmarks = extractNumber(await bookmarkBtn.getAttribute('aria-label').catch(() => '') || '');
    const views = extractNumber(await viewsEl.getAttribute('aria-label').catch(() => '') || '');

    // Try to get quote count from the retweet menu area (if visible as separate stat)
    const quotes = '0'; // X doesn't expose quotes in a reliable aria-label

    const statsData: StatsData = {
      author,
      handle,
      text: text.slice(0, 100) + (text.length > 100 ? '...' : ''),
      time,
      replies,
      retweets,
      quotes,
      likes,
      bookmarks,
      views,
      url: tweetUrl,
    };

    const formatted = [
      `Post by ${author} (${handle})`,
      `Posted: ${time}`,
      `"${statsData.text}"`,
      '',
      `Views: ${views}`,
      `Likes: ${likes}`,
      `Retweets: ${retweets}`,
      `Replies: ${replies}`,
      `Bookmarks: ${bookmarks}`,
    ].join('\n');

    return {
      success: true,
      message: formatted,
      data: statsData
    };

  } finally {
    if (context) await context.close();
  }
}

runScript<CheckStatsInput>(checkStats);
