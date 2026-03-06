export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import path from "path";

// Load env from nanoclaw root (X_API_KEY, X_ACCESS_TOKEN, etc.)
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

import { TwitterApi } from "twitter-api-v2";

// ── Cache ────────────────────────────────────────────────────────────
let cache: { data: unknown; ts: number } = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getClient(): TwitterApi | null {
  const key = process.env.X_API_KEY;
  const secret = process.env.X_API_SECRET;
  const token = process.env.X_ACCESS_TOKEN;
  const tokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!key || !secret || !token || !tokenSecret) return null;

  return new TwitterApi({
    appKey: key,
    appSecret: secret,
    accessToken: token,
    accessSecret: tokenSecret,
  });
}

export async function GET() {
  // Return cache if fresh
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { error: "X API credentials not configured" },
      { status: 503 }
    );
  }

  try {
    const roClient = client.readOnly;

    // Fetch user profile with metrics
    const me = await roClient.v2.me({
      "user.fields": [
        "public_metrics",
        "description",
        "created_at",
        "profile_image_url",
      ],
    });

    const metrics = me.data.public_metrics;

    // Fetch recent tweets with metrics
    const timeline = await roClient.v2.userTimeline(me.data.id, {
      max_results: 20,
      "tweet.fields": ["public_metrics", "created_at", "text"],
      exclude: ["replies"],
    });

    const tweets = (timeline.data.data ?? []).map((t) => ({
      id: t.id,
      text: t.text.substring(0, 120) + (t.text.length > 120 ? "..." : ""),
      created_at: t.created_at,
      metrics: t.public_metrics,
    }));

    // Compute aggregate stats from tweets
    let totalImpressions = 0;
    let totalLikes = 0;
    let totalRTs = 0;
    let totalReplies = 0;

    for (const t of tweets) {
      if (t.metrics) {
        totalImpressions += t.metrics.impression_count ?? 0;
        totalLikes += t.metrics.like_count ?? 0;
        totalRTs += t.metrics.retweet_count ?? 0;
        totalReplies += t.metrics.reply_count ?? 0;
      }
    }

    const result = {
      account: {
        id: me.data.id,
        name: me.data.name,
        username: me.data.username,
        description: me.data.description,
        profileImage: me.data.profile_image_url,
        createdAt: me.data.created_at,
      },
      followers: metrics?.followers_count ?? 0,
      following: metrics?.following_count ?? 0,
      tweetCount: metrics?.tweet_count ?? 0,
      listedCount: metrics?.listed_count ?? 0,
      recentTweets: tweets,
      recentStats: {
        tweets: tweets.length,
        impressions: totalImpressions,
        likes: totalLikes,
        retweets: totalRTs,
        replies: totalReplies,
        avgImpressions:
          tweets.length > 0
            ? Math.round(totalImpressions / tweets.length)
            : 0,
        avgLikes:
          tweets.length > 0 ? Math.round(totalLikes / tweets.length) : 0,
      },
      fetchedAt: new Date().toISOString(),
    };

    cache = { data: result, ts: now };
    return NextResponse.json(result);
  } catch (error: unknown) {
    // Don't leak credentials in error messages
    const message =
      error instanceof Error ? error.message : "Unknown X API error";
    return NextResponse.json(
      { error: "X API request failed", detail: message },
      { status: 502 }
    );
  }
}
