#!/usr/bin/env npx tsx
/**
 * X Integration - Search Posts
 * Usage: echo '{"query":"football analytics","sort":"latest","count":10}' | npx tsx search.ts
 */

import { getBrowserContext, runScript, config, ScriptResult } from '../lib/browser.js';

interface SearchInput {
  query: string;
  sort?: 'top' | 'latest';  // default: 'latest'
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
}

async function extractTweets(page: import('playwright').Page, count: number): Promise<TweetData[]> {
  const tweets: TweetData[] = [];

  // Wait for tweets to load
  await page.locator('article[data-testid="tweet"]').first().waitFor({ timeout: config.timeouts.elementWait * 2 }).catch(() => {});

  const articles = await page.locator('article[data-testid="tweet"]').all();

  for (const article of articles.slice(0, count)) {
    try {
      // Extract author name and handle
      const userNameEl = article.locator('[data-testid="User-Name"]');
      const nameText = await userNameEl.innerText().catch(() => '');
      const parts = nameText.split('\n').filter(Boolean);
      const author = parts[0] || 'Unknown';
      const handle = parts.find(p => p.startsWith('@')) || '';

      // Extract tweet text
      const tweetTextEl = article.locator('[data-testid="tweetText"]');
      const text = await tweetTextEl.innerText().catch(() => '');

      // Extract time
      const timeEl = article.locator('time');
      const time = await timeEl.getAttribute('datetime').catch(() => '') || '';

      // Extract stats (replies, retweets, likes, views)
      const replyBtn = article.locator('[data-testid="reply"]');
      const retweetBtn = article.locator('[data-testid="retweet"], [data-testid="unretweet"]');
      const likeBtn = article.locator('[data-testid="like"], [data-testid="unlike"]');

      const replies = await replyBtn.getAttribute('aria-label').catch(() => '') || '0';
      const retweets = await retweetBtn.getAttribute('aria-label').catch(() => '') || '0';
      const likes = await likeBtn.getAttribute('aria-label').catch(() => '') || '0';

      // Extract views from the analytics link
      const viewsEl = article.locator('a[href*="/analytics"]');
      const views = await viewsEl.getAttribute('aria-label').catch(() => '') || '0';

      // Extract tweet URL
      const linkEls = await article.locator('a[href*="/status/"]').all();
      let url = '';
      for (const link of linkEls) {
        const href = await link.getAttribute('href').catch(() => '');
        if (href && href.match(/\/status\/\d+$/)) {
          url = `https://x.com${href}`;
          break;
        }
      }

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
      });
    } catch {
      // Skip malformed tweets
      continue;
    }
  }

  return tweets;
}

function extractNumber(ariaLabel: string): string {
  const match = ariaLabel.match(/(\d[\d,.KkMm]*)/);
  return match ? match[1] : '0';
}

async function searchPosts(input: SearchInput): Promise<ScriptResult> {
  const { query, sort = 'latest', count = 10 } = input;

  if (!query || query.trim().length === 0) {
    return { success: false, message: 'Search query cannot be empty' };
  }

  let context = null;
  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    const encodedQuery = encodeURIComponent(query);
    const sortParam = sort === 'latest' ? 'live' : 'top';
    const url = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=${sortParam}`;

    await page.goto(url, { timeout: config.timeouts.navigation, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(config.timeouts.pageLoad);

    // Check if logged in
    const isLoggedIn = await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').isVisible().catch(() => false);
    if (!isLoggedIn) {
      return { success: false, message: 'X login expired. Run /x-integration to re-authenticate.' };
    }

    // Scroll down to load more if needed
    if (count > 5) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(1500);
    }

    const tweets = await extractTweets(page, count);

    if (tweets.length === 0) {
      return {
        success: true,
        message: `No results found for "${query}"`,
        data: { query, sort, tweets: [] }
      };
    }

    // Format results as readable text
    const formatted = tweets.map((t, i) =>
      `[${i + 1}] ${t.author} (${t.handle}) - ${t.time}\n${t.text}\nReplies: ${t.stats.replies} | Retweets: ${t.stats.retweets} | Likes: ${t.stats.likes} | Views: ${t.stats.views}\n${t.url}`
    ).join('\n\n---\n\n');

    return {
      success: true,
      message: `Found ${tweets.length} posts for "${query}" (${sort}):\n\n${formatted}`,
      data: { query, sort, tweets }
    };

  } finally {
    if (context) await context.close();
  }
}

runScript<SearchInput>(searchPosts);
