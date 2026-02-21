#!/usr/bin/env npx tsx
/**
 * X Integration - Read Feed / User Timeline
 * Usage: echo '{"type":"home","count":10}' | npx tsx read-feed.ts
 * Usage: echo '{"type":"user","username":"elikidd_","count":10}' | npx tsx read-feed.ts
 */

import { getBrowserContext, runScript, config, ScriptResult } from '../lib/browser.js';

interface ReadFeedInput {
  type: 'home' | 'user';
  username?: string;         // required if type === 'user'
  count?: number;            // max posts to extract, default: 10
}

interface TweetData {
  author: string;
  handle: string;
  text: string;
  time: string;
  stats: {
    replies: string;
    retweets: string;
    likes: string;
    views: string;
  };
  url: string;
  isPinned: boolean;
}

function extractNumber(ariaLabel: string): string {
  const match = ariaLabel.match(/(\d[\d,.KkMm]*)/);
  return match ? match[1] : '0';
}

async function extractTweets(page: import('playwright').Page, count: number): Promise<TweetData[]> {
  const tweets: TweetData[] = [];

  await page.locator('article[data-testid="tweet"]').first().waitFor({ timeout: config.timeouts.elementWait * 2 }).catch(() => {});

  const articles = await page.locator('article[data-testid="tweet"]').all();

  for (const article of articles.slice(0, count)) {
    try {
      const userNameEl = article.locator('[data-testid="User-Name"]');
      const nameText = await userNameEl.innerText().catch(() => '');
      const parts = nameText.split('\n').filter(Boolean);
      const author = parts[0] || 'Unknown';
      const handle = parts.find(p => p.startsWith('@')) || '';

      const tweetTextEl = article.locator('[data-testid="tweetText"]');
      const text = await tweetTextEl.innerText().catch(() => '');

      const timeEl = article.locator('time');
      const time = await timeEl.getAttribute('datetime').catch(() => '') || '';

      const replyBtn = article.locator('[data-testid="reply"]');
      const retweetBtn = article.locator('[data-testid="retweet"], [data-testid="unretweet"]');
      const likeBtn = article.locator('[data-testid="like"], [data-testid="unlike"]');
      const viewsEl = article.locator('a[href*="/analytics"]');

      const replies = await replyBtn.getAttribute('aria-label').catch(() => '') || '0';
      const retweets = await retweetBtn.getAttribute('aria-label').catch(() => '') || '0';
      const likes = await likeBtn.getAttribute('aria-label').catch(() => '') || '0';
      const views = await viewsEl.getAttribute('aria-label').catch(() => '') || '0';

      const linkEls = await article.locator('a[href*="/status/"]').all();
      let url = '';
      for (const link of linkEls) {
        const href = await link.getAttribute('href').catch(() => '');
        if (href && href.match(/\/status\/\d+$/)) {
          url = `https://x.com${href}`;
          break;
        }
      }

      // Check for pinned tweet indicator
      const socialContext = article.locator('[data-testid="socialContext"]');
      const socialText = await socialContext.innerText().catch(() => '');
      const isPinned = socialText.toLowerCase().includes('pinned');

      tweets.push({
        author,
        handle,
        text: text.slice(0, 500),
        time,
        stats: {
          replies: extractNumber(replies),
          retweets: extractNumber(retweets),
          likes: extractNumber(likes),
          views: extractNumber(views),
        },
        url,
        isPinned,
      });
    } catch {
      continue;
    }
  }

  return tweets;
}

async function readFeed(input: ReadFeedInput): Promise<ScriptResult> {
  const { type, username, count = 10 } = input;

  if (type === 'user' && (!username || username.trim().length === 0)) {
    return { success: false, message: 'Username is required for user timeline' };
  }

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    let url: string;
    if (type === 'home') {
      url = 'https://x.com/home';
    } else {
      const cleanUsername = username!.replace(/^@/, '');
      url = `https://x.com/${cleanUsername}`;
    }

    await page.goto(url, { timeout: config.timeouts.navigation, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(config.timeouts.pageLoad);

    // Check if logged in
    const isLoggedIn = await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').isVisible().catch(() => false);
    if (!isLoggedIn) {
      return { success: false, message: 'X login expired. Run /x-integration to re-authenticate.' };
    }

    // For user profile, check if user exists
    if (type === 'user') {
      const notFound = await page.locator('div[data-testid="empty_state_header_text"]').isVisible().catch(() => false);
      if (notFound) {
        return { success: false, message: `User @${username} not found` };
      }

      // Extract profile info
      const bioEl = page.locator('[data-testid="UserDescription"]');
      const bio = await bioEl.innerText().catch(() => '');

      const followersEl = page.locator(`a[href="/${username!.replace(/^@/, '')}/verified_followers"]`);
      const followers = await followersEl.innerText().catch(() => '');

      const followingEl = page.locator(`a[href="/${username!.replace(/^@/, '')}/following"]`);
      const following = await followingEl.innerText().catch(() => '');

      // Scroll to load more tweets
      if (count > 5) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await page.waitForTimeout(1500);
      }

      const tweets = await extractTweets(page, count);

      const profileHeader = `Profile: @${username!.replace(/^@/, '')}\nBio: ${bio}\nFollowers: ${followers} | Following: ${following}\n`;
      const formatted = tweets.map((t, i) =>
        `[${i + 1}]${t.isPinned ? ' [PINNED]' : ''} ${t.time}\n${t.text}\nReplies: ${t.stats.replies} | Retweets: ${t.stats.retweets} | Likes: ${t.stats.likes} | Views: ${t.stats.views}\n${t.url}`
      ).join('\n\n---\n\n');

      return {
        success: true,
        message: `${profileHeader}\n${tweets.length} recent posts:\n\n${formatted}`,
        data: { type, username, bio, followers, following, tweets }
      };
    }

    // Home feed
    if (count > 5) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1500);
    }

    const tweets = await extractTweets(page, count);

    const formatted = tweets.map((t, i) =>
      `[${i + 1}] ${t.author} (${t.handle}) - ${t.time}\n${t.text}\nReplies: ${t.stats.replies} | Retweets: ${t.stats.retweets} | Likes: ${t.stats.likes} | Views: ${t.stats.views}\n${t.url}`
    ).join('\n\n---\n\n');

    return {
      success: true,
      message: `Home feed (${tweets.length} posts):\n\n${formatted}`,
      data: { type, tweets }
    };

  } finally {
    if (context) await context.close();
  }
}

runScript<ReadFeedInput>(readFeed);
