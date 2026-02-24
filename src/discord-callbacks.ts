/**
 * Discord Pipeline Callbacks — v3 (Claude-powered + Ball-AI viz)
 *
 * Wires the 4 callback hooks in discord-pipeline.ts:
 *   1. X Search (Scout) — Twitter API v2 recent search
 *   2. Research (Researcher) — Claude-powered narrative research (Opus 4.6)
 *   3. Content Creation (Klaw) — Claude-powered tweet drafting + Ball-AI viz generation
 *   4. Publish — Posts approved tweets via tweet-with-media.mjs
 *
 * v3: Content callback outputs structured JSON with viz commands. When a
 * visualization is requested, shells out to Ball-AI Python tools to generate
 * charts/images and attaches them to the ContentDraft.
 * Falls back to v2 (text-only) or v1 (template) if anything fails.
 */

import { execFile } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { TwitterApi } from 'twitter-api-v2';
import { logger } from './logger.js';
import { PROJECT_ROOT } from './config.js';
import { readEnvFile } from './env.js';
import {
  setXSearchCallback,
  setResearchCallback,
  setContentCallback,
  setPublishCallback,
} from './discord-pipeline.js';
import type { ContentDraft } from './discord-pipeline.js';

// ── Callback 1: X Search (Scout) ───────────────────────────────────────────

function createXSearchCallback() {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    logger.warn('X_BEARER_TOKEN not set — Scout X search callback disabled');
    return null;
  }

  const client = new TwitterApi(bearerToken);

  return async (query: string) => {
    logger.info({ query }, 'Scout: searching X');

    const result = await client.v2.search(query, {
      max_results: 10,
      'tweet.fields': ['public_metrics', 'author_id', 'created_at'],
      expansions: ['author_id'],
      'user.fields': ['username'],
      sort_order: 'relevancy',
    });

    const users = new Map<string, string>();
    if (result.includes?.users) {
      for (const u of result.includes.users) {
        users.set(u.id, u.username);
      }
    }

    const tweets: Array<{
      text: string;
      authorUsername: string;
      likes: number;
      retweets: number;
      id: string;
      url: string;
    }> = [];

    for (const tweet of result.tweets) {
      const metrics = tweet.public_metrics;
      const likes = metrics?.like_count ?? 0;
      const retweets = metrics?.retweet_count ?? 0;

      // Filter: min 10 likes, skip retweets
      if (likes < 10) continue;
      if (tweet.text.startsWith('RT @')) continue;

      const authorUsername = users.get(tweet.author_id ?? '') ?? 'unknown';

      tweets.push({
        text: tweet.text,
        authorUsername,
        likes,
        retweets,
        id: tweet.id,
        url: `https://x.com/${authorUsername}/status/${tweet.id}`,
      });
    }

    logger.info({ query, count: tweets.length }, 'Scout: search complete');
    return tweets;
  };
}

// ── Callback 2: Research (Researcher) ───────────────────────────────────────
//
// v2: Claude-powered narrative research via Anthropic Messages API.
// Identifies the story behind a tweet, relevant context, and suggests
// Ball-AI tools and content angles for reactive tweets.
// Falls back to v1 regex logic if token is missing or API call fails.

const RESEARCH_SYSTEM_PROMPT = `You are Ball-AI's football analytics researcher. Your job is to analyze trending football tweets and produce research briefs that a content creator will use to craft reactive tweets.

Given a tweet from football analytics Twitter, you must:

1. **Identify the Story** — What event, match, debate, or narrative is this tweet about? Be specific (e.g. "Arsenal's 4-1 win over Spurs on Feb 23, where Saka scored a brace" not just "Arsenal match").

2. **Key Context** — What's the broader narrative? Is this part of a title race debate? A player comparison? A tactical trend? A transfer saga? Give 2-3 sentences of context a content creator needs.

3. **Teams & Players** — List every team and notable player mentioned or implied.

4. **Competition** — Which competition(s) are relevant (Premier League, Champions League, Bundesliga, La Liga, etc.)

5. **Ball-AI Tools to Run** — Suggest specific Ball-AI tools that would generate compelling data for a reactive tweet. Be specific:
   - Match analysis: xG timeline, shot map, pass network (specify which match)
   - Player comparison: radar charts, stat comparisons (specify which players)
   - Season stats: team performance trends, league tables by xG
   - Set piece analysis, pressing stats, chance creation maps

6. **StatsBomb Match ID** — If you can identify the specific match being discussed, include its StatsBomb match ID if known. This is critical for generating visualizations. Format: **Match ID:** 3999676 (or "Unknown" if you can't determine it). Common recent IDs:
   - Tottenham vs Arsenal (Feb 23, 2025): 3999676
   - If you don't know the ID, say "Unknown — content creator should look this up"

7. **Content Angles** — Suggest 2-3 specific reactive tweet angles:
   - Counter-take: How could Ball-AI data challenge or nuance this tweet's premise?
   - Data amplification: How could Ball-AI data strengthen the point with evidence?
   - Comparison: What player/team comparison would this audience find compelling?
   - Hot take: What spicy, data-backed opinion could this inspire?

Keep the brief concise but information-dense. The content creator needs enough context to craft a tweet without doing additional research.

Format your response as a structured brief with clear sections using ** markdown headers.`;

function researchFallbackV1(tweetSummary: string): string {
  const topics: string[] = [];
  const tweetLower = tweetSummary.toLowerCase();

  const topicPatterns: Array<[RegExp, string]> = [
    [/\bxg\b|expected goals/i, 'Expected Goals (xG)'],
    [/\bpressing\b|press\b/i, 'Pressing & Defensive Actions'],
    [/\bpass\b|passing|progressive/i, 'Passing & Progression'],
    [/\bshot\b|shooting|finish/i, 'Shooting & Finishing'],
    [/\bformation\b|tactic/i, 'Tactical Setup'],
    [/\btransfer\b/i, 'Transfers'],
    [/\binjur/i, 'Injuries'],
    [/\bderby\b/i, 'Derby Match'],
    [/\bchampions league\b|ucl\b/i, 'Champions League'],
    [/\bpremier league\b|epl\b/i, 'Premier League'],
    [/\bbundesliga\b/i, 'Bundesliga'],
    [/\bla liga\b/i, 'La Liga'],
    [/\bstatsbomb\b/i, 'StatsBomb Data'],
    [/\bset piece/i, 'Set Pieces'],
    [/\bheatmap\b/i, 'Player Positioning'],
  ];

  for (const [pattern, label] of topicPatterns) {
    if (pattern.test(tweetLower)) {
      topics.push(label);
    }
  }

  const teamPatterns: Array<[RegExp, string]> = [
    [/\barsenal\b/i, 'Arsenal'],
    [/\bchelsea\b/i, 'Chelsea'],
    [/\bliverpool\b/i, 'Liverpool'],
    [/\bman city\b|manchester city\b|man\s*c\b/i, 'Manchester City'],
    [/\bman utd\b|manchester united\b|man\s*u\b/i, 'Manchester United'],
    [/\btottenham\b|spurs\b/i, 'Tottenham'],
    [/\bnewcastle\b/i, 'Newcastle'],
    [/\baston villa\b/i, 'Aston Villa'],
    [/\bbrighton\b/i, 'Brighton'],
    [/\bwest ham\b/i, 'West Ham'],
  ];

  const teams: string[] = [];
  for (const [pattern, label] of teamPatterns) {
    if (pattern.test(tweetLower)) {
      teams.push(label);
    }
  }

  const sections: string[] = [];
  sections.push(`**Source Tweet:**\n${tweetSummary}`);
  if (topics.length > 0) sections.push(`**Detected Topics:** ${topics.join(', ')}`);
  if (teams.length > 0) sections.push(`**Teams Mentioned:** ${teams.join(', ')}`);
  sections.push(
    `**Content Angle Suggestions:**`,
    `• Counter-take: Challenge the tweet's premise with Ball-AI data`,
    `• Deep dive: Use Ball-AI to generate visualizations on the same topic`,
    `• Amplify: Add data that strengthens the tweet's point`,
    `• Compare: Run a comparison (player vs player, team vs team) related to the topic`,
  );
  if (teams.length > 0) {
    sections.push(
      `**Ball-AI Tools to Consider:**`,
      `• Match analysis (xG timeline, shot map, pass network)`,
      `• Player comparison (radar charts, stats comparison)`,
      `• Season-level stats (team performance trends)`,
    );
  }

  return sections.join('\n\n');
}

function createResearchCallback() {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!oauthToken) {
    logger.warn('CLAUDE_CODE_OAUTH_TOKEN not set — Research callback using v1 fallback');
    return async (tweetSummary: string): Promise<string> => {
      logger.info('Researcher (v1 fallback): processing tweet');
      return researchFallbackV1(tweetSummary);
    };
  }

  return async (tweetSummary: string): Promise<string> => {
    logger.info('Researcher (v2): calling Claude for narrative research');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${oauthToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          max_tokens: 2048,
          system: RESEARCH_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user' as const,
              content: `Analyze this trending football tweet and produce a research brief:\n\n${tweetSummary}`,
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.error({ status: res.status, body: errText.slice(0, 500) }, 'Researcher (v2): Anthropic API error, falling back to v1');
        return researchFallbackV1(tweetSummary);
      }

      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const textBlock = data.content?.find((b) => b.type === 'text');
      const research = textBlock?.text || '';

      if (!research) {
        logger.warn('Researcher (v2): empty response from Claude, falling back to v1');
        return researchFallbackV1(tweetSummary);
      }

      logger.info(
        { outputTokens: data.usage?.output_tokens, charCount: research.length },
        'Researcher (v2): Claude research complete',
      );
      return research;
    } catch (err) {
      logger.error({ err }, 'Researcher (v2): API call failed, falling back to v1');
      return researchFallbackV1(tweetSummary);
    }
  };
}

// ── Callback 3: Content Creation (Klaw) ──────────────────────────────────────
//
// v3: Claude-powered tweet drafting + Ball-AI visualization generation.
// Claude outputs structured JSON with tweet text and optional viz command.
// If viz is requested, shells out to Ball-AI Python tools to generate images.
// Falls back to v2 (text-only Claude) or v1 (template) if anything fails.

const CONTENT_SYSTEM_PROMPT = `You are Ball-AI's tweet writer. You craft reactive tweets for the @Ball_AI_Agent X account.

## Voice & Personality

You're the smartest person at the pub who also happens to have a data science degree.

- **Data + interpretation** — Never just stats. Always "here's what this means"
- **Spicy & provocative** — Take sides. Have opinions. Say things people will quote-tweet
- **Confident, not arrogant** — Back every take with data. Let the numbers do the flexing
- **Accessible** — Make analytics feel like conversation, not a lecture
- **70% opinionated** — Take a side: "Saka is the most dangerous wide player in Europe and here's the data to prove it"
- **30% neutral analysis** — Pure data drops: "Here's every team's xG performance this season"

## What You Sound Like

YES: "Everyone's arguing about whether Salah or Palmer is better this season. We ran the numbers. It's not even close."
YES: "Arsenal's pressing numbers are genuinely terrifying. The data behind why they haven't lost in 14."
NO: "In this analysis we examine the pressing metrics of Arsenal FC..."
NO: "Here are some interesting stats about the Premier League! 😊"

## Output Format — STRICT JSON

You MUST output valid JSON only. No markdown, no commentary, no backticks.

{
  "tweetText": "The tweet text here",
  "visualization": {
    "vizType": "shot_map",
    "matchId": 3999676,
    "team": "Arsenal",
    "player": null
  }
}

### tweetText rules:
- Single tweet: under 280 characters
- Thread: separate tweets with --- (each under 280 chars, max 6 tweets)
- If including a visualization, write the tweet to reference it: "Here's what that looks like ↓" or "The data speaks for itself" etc.

### visualization field:
- Include this when the research brief mentions a specific match ID and a viz would strengthen the tweet
- Set to null if no visualization is appropriate (e.g., general debate, no specific match data)
- vizType options: "shot_map", "xg_timeline", "pass_network", "heatmap", "shot_freeze_frame", "pitch_control", "corner_attack_heatmap"
- matchId: StatsBomb match ID (MUST be a number from the research brief)
- team: team name filter (required for pass_network, heatmap; optional for others)
- player: player name filter (optional)

### When to include visualization:
- ALWAYS include a viz when a specific match ID is available in the research brief
- Prefer xg_timeline for match narrative tweets
- Prefer shot_map for shooting/finishing discussion
- Prefer pass_network for tactical/build-up discussion
- Skip viz if no match ID is available or the tweet is purely opinion-based

## Content Templates to Draw From

- **Hot take:** Provocative statement + 2-3 data points + strong conclusion
- **Data drop:** Clean stat presentation + brief interpretation
- **Debate entry:** "Interesting debate. Let me add some data:" + key stats + opinion
- **Thread:** Hook tweet + data points + mention attached viz + conclusion with CTA

## Ball-AI CTA (Use Sparingly)

When appropriate, include a subtle reference to Ball-AI. NOT on every tweet. Maybe 1 in 3.
- "All analysis powered by Ball-AI + StatsBomb data"
- "5-minute analysis with Ball-AI. Join the waitlist → app.ball-ai.xyz/waitlist"
- "This is what data-driven analysis looks like"
Do NOT force the CTA. If it doesn't fit naturally, skip it.

## Rules

1. Never use corporate language
2. Never start with "Great question" or "Interesting stat"
3. Emoji use: minimal. One per tweet max. Skip entirely if it doesn't add anything
4. Hashtags: skip entirely. They look desperate
5. Be reactive to the source tweet — don't write in a vacuum
6. If the research brief suggests specific data points, reference them specifically
7. Output MUST be valid JSON — no markdown fences, no explanation text`;

// ── Ball-AI Viz Generation ──────────────────────────────────────────────────

interface VizCommand {
  vizType: string;
  matchId: number;
  team?: string | null;
  player?: string | null;
}

const BALL_AI_PROJECT = resolve(
  PROJECT_ROOT,
  'groups',
  'main',
  'BALL-AI-2',
);

/**
 * Shell out to Ball-AI Python tools to generate a visualization.
 * Returns the absolute file path of the generated image, or null on failure.
 * Uses the Ball-AI project's venv Python directly (no uv dependency at runtime).
 */
function generateVisualization(viz: VizCommand): Promise<string | null> {
  const scriptPath = resolve(BALL_AI_PROJECT, 'scripts', 'discord_viz.py');
  const pythonPath = resolve(BALL_AI_PROJECT, '.venv', 'Scripts', 'python.exe');

  const args = [
    scriptPath,
    '--match-id', String(viz.matchId),
    '--viz-type', viz.vizType,
    '--platform', 'twitter',
    '--format', 'png',
  ];
  if (viz.team) {
    args.push('--team', viz.team);
  }
  if (viz.player) {
    args.push('--player', viz.player);
  }

  logger.info({ viz }, 'Klaw (v3): generating Ball-AI visualization');

  return new Promise((res) => {
    execFile(
      pythonPath,
      args,
      {
        timeout: 120_000,
        cwd: BALL_AI_PROJECT,
        env: process.env as Record<string, string>,
      },
      (error, stdout, stderr) => {
        if (error) {
          logger.error(
            { err: error, stderr: stderr?.slice(0, 500) },
            'Klaw (v3): viz generation failed',
          );
          res(null);
          return;
        }

        // Parse JSON output from discord_viz.py
        try {
          // Find the last JSON line in stdout (script may print progress before JSON)
          const lines = stdout.trim().split('\n');
          let jsonLine = '';
          for (let i = lines.length - 1; i >= 0; i--) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('{')) {
              jsonLine = trimmed;
              break;
            }
          }

          if (!jsonLine) {
            logger.warn({ stdout: stdout.slice(0, 500) }, 'Klaw (v3): no JSON in viz output');
            res(null);
            return;
          }

          const result = JSON.parse(jsonLine);
          if (result.success && result.file_path) {
            const filePath = result.file_path as string;

            // If the file_path is a URL (cloud storage), download it locally
            if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
              const localDir = resolve(PROJECT_ROOT, 'output', 'discord-pipeline');
              const localFile = resolve(localDir, `${viz.matchId}_${viz.vizType}_${Date.now()}.png`);

              fetch(filePath)
                .then(async (r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  const buffer = Buffer.from(await r.arrayBuffer());
                  await mkdir(localDir, { recursive: true });
                  await writeFile(localFile, buffer);
                  logger.info(
                    { localFile, cloudUrl: filePath, duration: result.duration_seconds },
                    'Klaw (v3): viz downloaded from cloud to local',
                  );
                  res(localFile);
                })
                .catch((dlErr) => {
                  logger.error({ err: dlErr, url: filePath }, 'Klaw (v3): failed to download viz from cloud');
                  res(null);
                });
            } else {
              // Local file path — resolve relative to Ball-AI project
              const absPath = resolve(BALL_AI_PROJECT, filePath);
              logger.info(
                { filePath: absPath, duration: result.duration_seconds },
                'Klaw (v3): viz generated (local)',
              );
              res(absPath);
            }
          } else {
            logger.warn({ error: result.error }, 'Klaw (v3): viz generation returned error');
            res(null);
          }
        } catch {
          logger.warn({ stdout: stdout.slice(0, 500) }, 'Klaw (v3): could not parse viz output');
          res(null);
        }
      },
    );
  });
}

// ── Content fallbacks ───────────────────────────────────────────────────────

function contentFallbackV1(research: string): ContentDraft {
  const teamsMatch = research.match(/\*\*Teams Mentioned:\*\* (.+)/);
  const teams = teamsMatch?.[1] ?? '';
  const topicsMatch = research.match(/\*\*Detected Topics:\*\* (.+)/);
  const detectedTopics = topicsMatch?.[1] ?? '';

  const openers = [
    'The data tells a different story.',
    'Everyone\'s talking about this. Let\'s check the numbers.',
    'Interesting take. Here\'s what the data actually shows.',
    'Hot take incoming — backed by data.',
    'The numbers don\'t lie.',
  ];
  const closers = [
    '\n\nBall-AI + StatsBomb. The full picture.',
    '\n\nThis is what data-driven analysis looks like.',
    '\n\nWant the full breakdown? Ball-AI has it.',
  ];

  const opener = openers[Math.floor(Math.random() * openers.length)];
  const closer = closers[Math.floor(Math.random() * closers.length)];

  let tweetText = opener;
  if (teams) tweetText += `\n\n${teams} — `;
  if (detectedTopics) tweetText += detectedTopics.split(', ').slice(0, 2).join(' + ');
  tweetText += closer;

  if (tweetText.length > 280) {
    tweetText = tweetText.slice(0, 277) + '...';
  }

  return { tweetText, researchContext: research };
}

function createContentCallback() {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!oauthToken) {
    logger.warn('CLAUDE_CODE_OAUTH_TOKEN not set — Content callback using v1 fallback');
    return async (research: string): Promise<ContentDraft> => {
      logger.info('Klaw (v1 fallback): creating tweet draft');
      return contentFallbackV1(research);
    };
  }

  return async (research: string): Promise<ContentDraft> => {
    logger.info('Klaw (v3): calling Claude for tweet draft + viz command');

    let tweetText = '';
    let vizCommand: VizCommand | null = null;

    // Step 1: Get structured JSON from Claude
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${oauthToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          max_tokens: 1024,
          system: CONTENT_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user' as const,
              content: `Based on this research brief, craft a reactive tweet (or thread) with visualization for @Ball_AI_Agent:\n\n${research}`,
            },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.error({ status: res.status, body: errText.slice(0, 500) }, 'Klaw (v3): Anthropic API error, falling back to v1');
        return contentFallbackV1(research);
      }

      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const textBlock = data.content?.find((b) => b.type === 'text');
      const rawOutput = textBlock?.text?.trim() || '';

      if (!rawOutput) {
        logger.warn('Klaw (v3): empty response from Claude, falling back to v1');
        return contentFallbackV1(research);
      }

      logger.info(
        { outputTokens: data.usage?.output_tokens, charCount: rawOutput.length },
        'Klaw (v3): Claude response received',
      );

      // Parse the structured JSON response
      try {
        // Strip markdown fences if Claude wraps in ```json ... ```
        const cleaned = rawOutput.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(cleaned) as {
          tweetText?: string;
          visualization?: VizCommand | null;
        };

        tweetText = parsed.tweetText?.trim() || '';
        vizCommand = parsed.visualization || null;

        if (!tweetText) {
          logger.warn('Klaw (v3): parsed JSON has no tweetText, falling back to v1');
          return contentFallbackV1(research);
        }
      } catch {
        // Claude might output raw tweet text instead of JSON — treat as v2 text-only
        logger.info('Klaw (v3): response is not JSON, treating as v2 text-only draft');
        tweetText = rawOutput;
        vizCommand = null;
      }
    } catch (err) {
      logger.error({ err }, 'Klaw (v3): API call failed, falling back to v1');
      return contentFallbackV1(research);
    }

    // If it's a single tweet (no thread separator), enforce 280 char limit
    if (!tweetText.includes('---') && tweetText.length > 280) {
      tweetText = tweetText.slice(0, 277) + '...';
    }

    // Step 2: Generate visualization if requested
    let imagePath: string | undefined;
    if (vizCommand && vizCommand.matchId && vizCommand.vizType) {
      try {
        const result = await generateVisualization(vizCommand);
        if (result) {
          imagePath = result;
          logger.info({ imagePath }, 'Klaw (v3): viz attached to draft');
        } else {
          logger.warn('Klaw (v3): viz generation returned null, proceeding without image');
        }
      } catch (err) {
        logger.error({ err }, 'Klaw (v3): viz generation threw, proceeding without image');
      }
    }

    const draft: ContentDraft = {
      tweetText,
      imagePath,
      researchContext: research,
    };

    logger.info(
      {
        charCount: tweetText.length,
        isThread: tweetText.includes('---'),
        hasImage: !!imagePath,
        vizType: vizCommand?.vizType,
      },
      'Klaw (v3): draft complete',
    );
    return draft;
  };
}

// ── Callback 4: Publish ─────────────────────────────────────────────────────
//
// Shells out to tweet-with-media.mjs for posting.
// Returns tweet URL on success, null on failure.

function createPublishCallback() {
  const scriptPath = resolve(
    PROJECT_ROOT,
    'groups',
    'main',
    'scripts',
    'tweet-with-media.mjs',
  );

  return async (draft: ContentDraft): Promise<string | null> => {
    logger.info({ charCount: draft.tweetText.length }, 'Publishing tweet to X');

    const args = ['--text', draft.tweetText];
    if (draft.imagePath) {
      args.push('--image', draft.imagePath);
    }

    return new Promise((resolve) => {
      execFile(
        'node',
        [scriptPath, ...args],
        {
          timeout: 60_000,
          cwd: PROJECT_ROOT,
          env: process.env as Record<string, string>,
        },
        (error, stdout, stderr) => {
          if (error) {
            logger.error(
              { err: error, stderr: stderr?.slice(0, 500) },
              'Publish: tweet-with-media.mjs failed',
            );
            resolve(null);
            return;
          }

          // Parse JSON output from the script
          try {
            const result = JSON.parse(stdout);
            if (result.success && result.url) {
              logger.info({ url: result.url }, 'Publish: tweet posted');
              resolve(result.url);
            } else {
              logger.warn({ stdout: stdout.slice(0, 300) }, 'Publish: unexpected output');
              resolve(null);
            }
          } catch {
            // Script might output non-JSON lines before the JSON
            const urlMatch = stdout.match(/https:\/\/x\.com\/[^\s]+/);
            if (urlMatch) {
              resolve(urlMatch[0]);
            } else {
              logger.warn({ stdout: stdout.slice(0, 300) }, 'Publish: could not parse output');
              resolve(null);
            }
          }
        },
      );
    });
  };
}

// ── Wire all callbacks ──────────────────────────────────────────────────────

export function wireDiscordCallbacks(): void {
  logger.info('Wiring Discord pipeline callbacks...');

  // Load OAuth token from .env for Claude-powered callbacks.
  // readEnvFile doesn't pollute process.env — we set it explicitly here
  // so the v2 callbacks can read it via process.env.
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const envVars = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN']);
    if (envVars.CLAUDE_CODE_OAUTH_TOKEN) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = envVars.CLAUDE_CODE_OAUTH_TOKEN;
      logger.info('Loaded CLAUDE_CODE_OAUTH_TOKEN from .env for Discord callbacks');
    }
  }

  const xSearch = createXSearchCallback();
  if (xSearch) {
    setXSearchCallback(xSearch);
    logger.info('Discord callback wired: X Search (Scout)');
  }

  const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

  setResearchCallback(createResearchCallback());
  logger.info(`Discord callback wired: Research (Researcher) [${hasOAuthToken ? 'v2 Claude' : 'v1 fallback'}]`);

  setContentCallback(createContentCallback());
  logger.info(`Discord callback wired: Content Creation (Klaw) [${hasOAuthToken ? 'v3 Claude+Viz' : 'v1 fallback'}]`);

  setPublishCallback(createPublishCallback());
  logger.info('Discord callback wired: Publish');

  logger.info('All Discord pipeline callbacks wired');
}
