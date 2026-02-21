#!/usr/bin/env npx tsx
/**
 * X Integration - Read a specific post and its replies
 * Usage: echo '{"tweetUrl":"https://x.com/user/status/123","includeReplies":true,"replyCount":5}' | npx tsx read-post.ts
 */

import { getBrowserContext, runScript, navigateToTweet, config, ScriptResult } from '../lib/browser.js';

interface ReadPostInput {
  tweetUrl: string;
  includeReplies?: boolean;  // default: true
  replyCount?: number;       // max replies to extract, default: 5
}

interface PostData {
  author: string;
  handle: string;
  text: string;
  time: string;
  stats: {
    replies: string;
    retweets: string;
    likes: string;
    bookmarks: string;
    views: string;
  };
  url: string;
  replies: ReplyData[];
}

interface ReplyData {
  author: string;
  handle: string;
  text: string;
  time: string;
  likes: string;
}

function extractNumber(ariaLabel: string): string {
  const match = ariaLabel.match(/(\d[\d,.KkMm]*)/);
  return match ? match[1] : '0';
}

async function readPost(input: ReadPostInput): Promise<ScriptResult> {
  const { tweetUrl, includeReplies = true, replyCount = 5 } = input;

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

    // The main tweet on its detail page is typically the first or a focal tweet
    // On the detail page, the main tweet has expanded stats
    const mainArticle = page.locator('article[data-testid="tweet"]').first();

    // Extract main tweet data
    const userNameEl = mainArticle.locator('[data-testid="User-Name"]');
    const nameText = await userNameEl.innerText().catch(() => '');
    const parts = nameText.split('\n').filter(Boolean);
    const author = parts[0] || 'Unknown';
    const handle = parts.find(p => p.startsWith('@')) || '';

    const tweetTextEl = mainArticle.locator('[data-testid="tweetText"]');
    const text = await tweetTextEl.innerText().catch(() => '');

    const timeEl = mainArticle.locator('time');
    const time = await timeEl.getAttribute('datetime').catch(() => '') || '';

    // On the detail page, stats may be shown differently (as text, not aria-labels)
    const replyBtn = mainArticle.locator('[data-testid="reply"]');
    const retweetBtn = mainArticle.locator('[data-testid="retweet"], [data-testid="unretweet"]');
    const likeBtn = mainArticle.locator('[data-testid="like"], [data-testid="unlike"]');
    const viewsEl = mainArticle.locator('a[href*="/analytics"]');

    const repliesCount = await replyBtn.getAttribute('aria-label').catch(() => '') || '0';
    const retweetsCount = await retweetBtn.getAttribute('aria-label').catch(() => '') || '0';
    const likesCount = await likeBtn.getAttribute('aria-label').catch(() => '') || '0';
    const viewsCount = await viewsEl.getAttribute('aria-label').catch(() => '') || '0';

    // Bookmarks — on detail page
    const bookmarkBtn = mainArticle.locator('[data-testid="bookmark"], [data-testid="removeBookmark"]');
    const bookmarks = await bookmarkBtn.getAttribute('aria-label').catch(() => '') || '0';

    const postData: PostData = {
      author,
      handle,
      text,
      time,
      stats: {
        replies: extractNumber(repliesCount),
        retweets: extractNumber(retweetsCount),
        likes: extractNumber(likesCount),
        bookmarks: extractNumber(bookmarks),
        views: extractNumber(viewsCount),
      },
      url: tweetUrl,
      replies: [],
    };

    // Extract replies if requested
    if (includeReplies) {
      // Scroll down to load replies
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1500);

      // Replies are subsequent articles after the main tweet
      const allArticles = await page.locator('article[data-testid="tweet"]').all();

      // Skip the first one (main tweet) and extract replies
      for (const article of allArticles.slice(1, 1 + replyCount)) {
        try {
          const replyUserEl = article.locator('[data-testid="User-Name"]');
          const replyNameText = await replyUserEl.innerText().catch(() => '');
          const replyParts = replyNameText.split('\n').filter(Boolean);
          const replyAuthor = replyParts[0] || 'Unknown';
          const replyHandle = replyParts.find(p => p.startsWith('@')) || '';

          const replyTextEl = article.locator('[data-testid="tweetText"]');
          const replyText = await replyTextEl.innerText().catch(() => '');

          const replyTimeEl = article.locator('time');
          const replyTime = await replyTimeEl.getAttribute('datetime').catch(() => '') || '';

          const replyLikeBtn = article.locator('[data-testid="like"], [data-testid="unlike"]');
          const replyLikes = await replyLikeBtn.getAttribute('aria-label').catch(() => '') || '0';

          postData.replies.push({
            author: replyAuthor,
            handle: replyHandle,
            text: replyText.slice(0, 300),
            time: replyTime,
            likes: extractNumber(replyLikes),
          });
        } catch {
          continue;
        }
      }
    }

    // Format output
    let formatted = `*${postData.author}* (${postData.handle}) - ${postData.time}\n\n${postData.text}\n\nReplies: ${postData.stats.replies} | Retweets: ${postData.stats.retweets} | Likes: ${postData.stats.likes} | Bookmarks: ${postData.stats.bookmarks} | Views: ${postData.stats.views}`;

    if (postData.replies.length > 0) {
      formatted += '\n\n--- Replies ---\n\n';
      formatted += postData.replies.map((r, i) =>
        `[${i + 1}] ${r.author} (${r.handle}) - ${r.time}\n${r.text}\nLikes: ${r.likes}`
      ).join('\n\n');
    }

    return {
      success: true,
      message: formatted,
      data: postData
    };

  } finally {
    if (context) await context.close();
  }
}

runScript<ReadPostInput>(readPost);
