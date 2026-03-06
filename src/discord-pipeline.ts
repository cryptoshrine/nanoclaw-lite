/**
 * Discord Content Pipeline — Ball-AI Ops
 *
 * Runs 3 Discord bots (Scout, Researcher, Klaw) that form an automated
 * content creation pipeline:
 *
 *   Scout (cron) → #scout-alerts
 *   Researcher (auto) → #research-desk
 *   Klaw (auto) → #content-drafts → approval → #approved-queue → post → #posted
 *
 * Each bot runs independently with its own Discord.js client.
 * Klaw also listens for reaction-based approval (✅/❌) on #content-drafts.
 */

import {
  Client,
  GatewayIntentBits,
  TextChannel,
  EmbedBuilder,
  Message,
  MessageReaction,
  User,
  Partials,
} from 'discord.js';
import { logger } from './logger.js';
import { saveDraft, getDraft, deleteDraft, enqueuePost, getPendingPosts, markPostPublished, markPostFailed } from './db.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate text to fit Discord embed limits (description: 4096, field value: 1024). */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/**
 * Extract clean tweet text from LLM output that may contain chain-of-thought,
 * JSON iterations, or other wrapper content.
 */
function extractTweetText(raw: string): string {
  // Try to extract from JSON if the LLM wrapped it
  const jsonMatch = raw.match(/"(?:tweet_?text|text|tweet|content)":\s*"((?:[^"\\]|\\.)*)"/);
  if (jsonMatch) {
    try {
      return JSON.parse(`"${jsonMatch[1]}"`);
    } catch { /* fall through */ }
  }
  // If the raw text is short enough to be a tweet, use it directly
  if (raw.length <= 300 && !raw.includes('{') && !raw.includes('```')) return raw.trim();
  // Otherwise return as-is — truncation will handle length
  return raw.trim();
}

// ── Config ───────────────────────────────────────────────────────────────────

interface DiscordConfig {
  scoutToken: string;
  researcherToken: string;
  klawToken: string;
  serverId: string;
  channels: {
    scoutAlerts: string;
    researchDesk: string;
    contentDrafts: string;
    approvedQueue: string;
    posted: string;
    pipelineLogs: string;
  };
}

function loadConfig(): DiscordConfig {
  const required = [
    'DISCORD_SCOUT_TOKEN',
    'DISCORD_RESEARCHER_TOKEN',
    'DISCORD_KLAW_TOKEN',
    'DISCORD_SERVER_ID',
    'DISCORD_CHANNEL_SCOUT_ALERTS',
    'DISCORD_CHANNEL_RESEARCH_DESK',
    'DISCORD_CHANNEL_CONTENT_DRAFTS',
    'DISCORD_CHANNEL_APPROVED_QUEUE',
    'DISCORD_CHANNEL_POSTED',
    'DISCORD_CHANNEL_PIPELINE_LOGS',
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  return {
    scoutToken: process.env.DISCORD_SCOUT_TOKEN!,
    researcherToken: process.env.DISCORD_RESEARCHER_TOKEN!,
    klawToken: process.env.DISCORD_KLAW_TOKEN!,
    serverId: process.env.DISCORD_SERVER_ID!,
    channels: {
      scoutAlerts: process.env.DISCORD_CHANNEL_SCOUT_ALERTS!,
      researchDesk: process.env.DISCORD_CHANNEL_RESEARCH_DESK!,
      contentDrafts: process.env.DISCORD_CHANNEL_CONTENT_DRAFTS!,
      approvedQueue: process.env.DISCORD_CHANNEL_APPROVED_QUEUE!,
      posted: process.env.DISCORD_CHANNEL_POSTED!,
      pipelineLogs: process.env.DISCORD_CHANNEL_PIPELINE_LOGS!,
    },
  };
}

// ── Bot Clients ──────────────────────────────────────────────────────────────

let scoutClient: Client;
let researcherClient: Client;
let klawClient: Client;
let config: DiscordConfig;

// Track processed message IDs to avoid re-processing
const processedScoutAlerts = new Set<string>();
const processedResearchPosts = new Set<string>();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel instanceof TextChannel) return channel;
    return null;
  } catch (err) {
    logger.error({ err, channelId }, 'Failed to fetch Discord channel');
    return null;
  }
}

async function logToPipeline(text: string): Promise<void> {
  try {
    const channel = await getChannel(klawClient, config.channels.pipelineLogs);
    if (channel) {
      const timestamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      await channel.send(`\`${timestamp}\` ${text}`);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to log to pipeline channel');
  }
}

// ── Scout Bot ────────────────────────────────────────────────────────────────
//
// Every 2 hours, searches X for trending football analytics tweets.
// Posts findings to #scout-alerts.

interface ScoutedTweet {
  text: string;
  authorUsername: string;
  likes: number;
  retweets: number;
  id: string;
  url: string;
}

/**
 * Callback that the main process provides to execute X searches.
 * This keeps the Discord module decoupled from the X API implementation.
 */
export type XSearchCallback = (query: string) => Promise<ScoutedTweet[]>;

let xSearchFn: XSearchCallback | null = null;

export function setXSearchCallback(fn: XSearchCallback): void {
  xSearchFn = fn;
}

const SCOUT_QUERIES = [
  'xG Premier League',
  'football analytics EPL',
  'Champions League tactical analysis',
  'StatsBomb data',
  'expected goals analysis',
  'Premier League stats',
];

async function runScoutScan(): Promise<void> {
  if (!xSearchFn) {
    logger.warn('Scout: No X search callback set, skipping scan');
    await logToPipeline('⚠️ Scout scan skipped — no X search callback configured');
    return;
  }

  const channel = await getChannel(scoutClient, config.channels.scoutAlerts);
  if (!channel) {
    logger.error('Scout: Cannot find #scout-alerts channel');
    return;
  }

  await logToPipeline('🔍 Scout scan starting...');

  const allTweets: ScoutedTweet[] = [];

  // Rotate through queries — pick 2 random ones per scan
  const shuffled = [...SCOUT_QUERIES].sort(() => Math.random() - 0.5);
  const queries = shuffled.slice(0, 2);

  for (const query of queries) {
    try {
      const results = await xSearchFn(query);
      allTweets.push(...results);
    } catch (err) {
      logger.error({ err, query }, 'Scout: X search failed');
    }
  }

  if (allTweets.length === 0) {
    await logToPipeline('🔍 Scout scan complete — no results found');
    return;
  }

  // Deduplicate by tweet ID and sort by engagement
  const seen = new Set<string>();
  const unique = allTweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  unique.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));

  // Take top 5
  const top = unique.slice(0, 5);

  // Post each as an embed
  for (const tweet of top) {
    const embed = new EmbedBuilder()
      .setColor(0x1da1f2)
      .setAuthor({ name: `@${tweet.authorUsername}` })
      .setDescription(tweet.text.slice(0, 400))
      .addFields(
        { name: '❤️ Likes', value: String(tweet.likes), inline: true },
        { name: '🔁 Retweets', value: String(tweet.retweets), inline: true },
      )
      .setURL(tweet.url)
      .setFooter({ text: `Queries: ${queries.join(', ')}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  await logToPipeline(`🔍 Scout scan complete — posted ${top.length} tweets from queries: ${queries.join(', ')}`);
  logger.info({ count: top.length, queries }, 'Scout: scan complete');
}

// ── Researcher Bot ───────────────────────────────────────────────────────────
//
// Watches #scout-alerts for new tweets. For each, researches the story
// behind the tweet and posts analysis to #research-desk.

/**
 * Callback that the main process provides to run research.
 * Takes a tweet summary and returns research findings.
 */
export type ResearchCallback = (tweetSummary: string) => Promise<string>;

let researchFn: ResearchCallback | null = null;

export function setResearchCallback(fn: ResearchCallback): void {
  researchFn = fn;
}

async function handleScoutAlert(message: Message): Promise<void> {
  // Only process embeds from the scout bot
  if (message.embeds.length === 0) return;
  if (processedScoutAlerts.has(message.id)) return;
  processedScoutAlerts.add(message.id);

  // Keep the set bounded
  if (processedScoutAlerts.size > 200) {
    const iter = processedScoutAlerts.values();
    for (let i = 0; i < 50; i++) {
      const v = iter.next().value;
      if (v) processedScoutAlerts.delete(v);
    }
  }

  if (!researchFn) {
    logger.warn('Researcher: No research callback set, skipping');
    return;
  }

  const embed = message.embeds[0];
  const tweetText = embed.description || '';
  const author = embed.author?.name || 'unknown';

  await logToPipeline(`📚 Researcher picking up alert: ${author} — "${tweetText.slice(0, 80)}..."`);

  try {
    const research = await researchFn(`Tweet by ${author}: "${tweetText}"`);

    const researchChannel = await getChannel(researcherClient, config.channels.researchDesk);
    if (!researchChannel) return;

    const researchEmbed = new EmbedBuilder()
      .setColor(0x7c3aed) // purple
      .setTitle('📚 Research Report')
      .setDescription(truncate(research, 4096))
      .addFields({ name: 'Source Tweet', value: truncate(`${author}: "${tweetText}"`, 1024) })
      .setFooter({ text: 'Researcher Bot' })
      .setTimestamp();

    await researchChannel.send({ embeds: [researchEmbed] });
    await logToPipeline(`📚 Research posted for: ${author}`);
  } catch (err) {
    logger.error({ err, messageId: message.id }, 'Researcher: failed to process alert');
    await logToPipeline(`❌ Researcher failed: ${(err as Error).message}`);
  }
}

// ── Klaw Bot (Content Creator + Approval) ────────────────────────────────────
//
// Watches #research-desk for new research. Creates tweet drafts with
// Ball-AI analysis and posts to #content-drafts.
// Listens for ✅/❌ reactions on #content-drafts for approval flow.

/**
 * Callback that the main process provides to create content.
 * Takes research text and returns { text: string, imagePath?: string }.
 */
export interface ContentDraft {
  tweetText: string;
  imagePath?: string;
  researchContext: string;
}

export type ContentCallback = (research: string) => Promise<ContentDraft>;

let contentFn: ContentCallback | null = null;

export function setContentCallback(fn: ContentCallback): void {
  contentFn = fn;
}

/**
 * Callback for publishing approved tweets to X.
 */
export type PublishCallback = (draft: ContentDraft) => Promise<string | null>;

let publishFn: PublishCallback | null = null;

export function setPublishCallback(fn: PublishCallback): void {
  publishFn = fn;
}

async function handleResearchPost(message: Message): Promise<void> {
  if (message.embeds.length === 0) return;
  if (processedResearchPosts.has(message.id)) return;
  processedResearchPosts.add(message.id);

  if (processedResearchPosts.size > 200) {
    const iter = processedResearchPosts.values();
    for (let i = 0; i < 50; i++) {
      const v = iter.next().value;
      if (v) processedResearchPosts.delete(v);
    }
  }

  if (!contentFn) {
    logger.warn('Klaw: No content callback set, skipping');
    return;
  }

  const embed = message.embeds[0];
  const research = embed.description || '';

  await logToPipeline(`✍️ Klaw creating content from research...`);

  try {
    const draft = await contentFn(research);
    // LLM may return chain-of-thought or JSON — extract clean tweet text
    draft.tweetText = extractTweetText(draft.tweetText);

    const draftsChannel = await getChannel(klawClient, config.channels.contentDrafts);
    if (!draftsChannel) return;

    const draftEmbed = new EmbedBuilder()
      .setColor(0xf59e0b) // amber
      .setTitle('📝 Tweet Draft — React ✅ to approve, ❌ to reject')
      .setDescription(truncate(draft.tweetText, 4096))
      .addFields(
        { name: 'Characters', value: `${draft.tweetText.length}/280`, inline: true },
        { name: 'Has Image', value: draft.imagePath ? '✅' : '❌', inline: true },
      )
      .setFooter({ text: 'Klaw • React to approve or reject' })
      .setTimestamp();

    const draftMessage = await draftsChannel.send({ embeds: [draftEmbed] });

    // Add reaction options
    await draftMessage.react('✅');
    await draftMessage.react('❌');

    // Persist draft to SQLite (survives restarts)
    saveDraft(draftMessage.id, draft.tweetText, draft.imagePath, draft.researchContext);

    await logToPipeline(`✍️ Draft posted to #content-drafts — awaiting approval`);
  } catch (err) {
    logger.error({ err, messageId: message.id }, 'Klaw: failed to create content');
    await logToPipeline(`❌ Klaw content creation failed: ${(err as Error).message}`);
  }
}

// Legacy in-memory map removed — drafts now persisted to SQLite via db.ts

// ── Direct Line (Interactive Discord Channels) ──────────────────────────────
//
// Allows Ladi to send messages in interactive Discord channels (#general-ops,
// Ideas channels, etc.) and have them routed to the NanoClaw agent loop,
// with responses posted back to the SAME Discord channel.

/**
 * Callback for processing a direct-line message from Discord.
 * Takes the message text, author name, and source channel ID.
 * Returns the agent's response.
 */
export type DirectLineCallback = (text: string, author: string, channelId: string) => Promise<string | null>;

let directLineFn: DirectLineCallback | null = null;
const interactiveChannelIds = new Set<string>();
/** Tracks the channel ID that the current/most recent agent session originated from */
let activeDiscordChannelId: string | null = null;

export function setDirectLineCallback(fn: DirectLineCallback): void {
  directLineFn = fn;
}

export function setGeneralOpsChannel(channelId: string): void {
  interactiveChannelIds.add(channelId);
}

/**
 * Register additional interactive channels (e.g. Ideas channels).
 * Messages in these channels will be routed to the agent, with responses
 * posted back to the same channel.
 */
export function addInteractiveChannels(channelIds: string[]): void {
  for (const id of channelIds) {
    if (id) interactiveChannelIds.add(id);
  }
  logger.info({ count: interactiveChannelIds.size }, 'Interactive Discord channels registered');
}

/** Get the channel ID where the current agent session was triggered from */
export function getActiveDiscordChannelId(): string | null {
  return activeDiscordChannelId;
}

const directLineProcessing = new Set<string>();

async function handleDirectLineMessage(message: Message): Promise<void> {
  // Ignore bot messages and empty messages
  if (message.author.bot) return;
  if (!message.content.trim()) return;

  // Deduplicate
  if (directLineProcessing.has(message.id)) return;
  directLineProcessing.add(message.id);
  if (directLineProcessing.size > 100) {
    const iter = directLineProcessing.values();
    for (let i = 0; i < 30; i++) {
      const v = iter.next().value;
      if (v) directLineProcessing.delete(v);
    }
  }

  if (!directLineFn) {
    logger.warn('Direct line: no callback set, ignoring message');
    return;
  }

  const text = message.content.trim();
  const author = message.author.displayName || message.author.username;

  const channelName = (message.channel as TextChannel).name || message.channelId;
  await logToPipeline(`💬 Direct line message from ${author} in #${channelName}: "${text.slice(0, 80)}..."`);

  try {
    // Show typing indicator
    const channel = message.channel as TextChannel;
    await channel.sendTyping();

    // Track which channel triggered this agent session
    activeDiscordChannelId = message.channelId;

    const response = await directLineFn(text, author, message.channelId);

    if (response) {
      // Split long responses for Discord's 2000 char limit
      const chunks: string[] = [];
      let remaining = response;
      while (remaining.length > 0) {
        if (remaining.length <= 2000) {
          chunks.push(remaining);
          break;
        }
        let splitAt = remaining.lastIndexOf('\n', 2000);
        if (splitAt < 1000) splitAt = remaining.lastIndexOf(' ', 2000);
        if (splitAt < 1000) splitAt = 2000;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
      }

      for (const chunk of chunks) {
        await channel.send(chunk);
      }

      await logToPipeline(`💬 Direct line response sent (${response.length} chars)`);
    }
  } catch (err) {
    logger.error({ err, messageId: message.id }, 'Direct line: failed to process message');
    await logToPipeline(`❌ Direct line error: ${(err as Error).message}`);
  }
}

/**
 * Send a message to a specific Discord channel by ID.
 * Falls back to the active channel (where the last message came from).
 */
export async function sendToDiscordChannel(text: string, channelId?: string): Promise<void> {
  const targetId = channelId || activeDiscordChannelId;
  if (!targetId || !klawClient) return;
  const channel = await getChannel(klawClient, targetId);
  if (!channel) return;

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 2000) { chunks.push(remaining); break; }
    let splitAt = remaining.lastIndexOf('\n', 2000);
    if (splitAt < 1000) splitAt = remaining.lastIndexOf(' ', 2000);
    if (splitAt < 1000) splitAt = 2000;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

/**
 * Backwards-compatible alias — sends to #general-ops or active channel.
 */
export async function sendToGeneralOps(text: string): Promise<void> {
  // Find general-ops from the interactive set (first one registered)
  const firstId = interactiveChannelIds.values().next().value;
  await sendToDiscordChannel(text, firstId as string);
}

async function handleReaction(reaction: MessageReaction, user: User): Promise<void> {
  // Ignore bot reactions
  if (user.bot) return;

  // Only process reactions in #content-drafts
  if (reaction.message.channelId !== config.channels.contentDrafts) return;

  const messageId = reaction.message.id;
  const row = getDraft(messageId);
  if (!row) {
    logger.warn({ messageId }, 'Approval reaction on unknown draft (data may have been lost or already processed)');
    await logToPipeline(`⚠️ Draft not found for message ${messageId.slice(0, 8)}... — may have been lost during restart`);
    return;
  }

  const draft: ContentDraft = {
    tweetText: row.tweet_text,
    imagePath: row.image_path || undefined,
    researchContext: row.research_context,
  };

  const emoji = reaction.emoji.name;

  if (emoji === '✅') {
    // Approved — save to post queue and show in approved channel
    deleteDraft(messageId);

    const queueId = enqueuePost(
      draft.tweetText,
      draft.imagePath,
      draft.researchContext,
      user.username,
      messageId,
    );

    const approvedChannel = await getChannel(klawClient, config.channels.approvedQueue);
    if (approvedChannel) {
      const approvedEmbed = new EmbedBuilder()
        .setColor(0x22c55e) // green
        .setTitle('✅ Approved Tweet')
        .setDescription(truncate(draft.tweetText, 4096))
        .addFields(
          { name: 'Status', value: 'In post queue — publishing shortly', inline: true },
          { name: 'Queue ID', value: `#${queueId}`, inline: true },
        )
        .setFooter({ text: `Approved by ${user.username}` })
        .setTimestamp();

      await approvedChannel.send({ embeds: [approvedEmbed] });
    }

    await logToPipeline(`✅ Tweet approved by ${user.username} — added to post queue (#${queueId})`);
  } else if (emoji === '❌') {
    // Rejected
    deleteDraft(messageId);
    await logToPipeline(`❌ Tweet rejected by ${user.username}`);
  }
}

// ── Post Queue Consumer ─────────────────────────────────────────────────────
//
// Polls the post_queue table and publishes pending tweets via publishFn.
// Runs on a 2-minute interval after pipeline start.

let queueInterval: ReturnType<typeof setInterval> | null = null;

export async function processPostQueue(): Promise<void> {
  if (!publishFn) {
    logger.debug('Post queue: publishFn not set, skipping');
    return;
  }

  const pending = getPendingPosts();
  if (pending.length === 0) return;

  logger.info({ count: pending.length }, 'Post queue: processing pending tweets');

  for (const item of pending) {
    const draft: ContentDraft = {
      tweetText: item.tweet_text,
      imagePath: item.image_path || undefined,
      researchContext: item.research_context || '',
    };

    try {
      const tweetUrl = await publishFn(draft);

      if (tweetUrl) {
        markPostPublished(item.id, tweetUrl);

        // Post to #posted channel
        const postedChannel = await getChannel(klawClient, config.channels.posted);
        if (postedChannel) {
          const postedEmbed = new EmbedBuilder()
            .setColor(0x1da1f2)
            .setTitle('🐦 Published to X')
            .setDescription(truncate(draft.tweetText, 4096))
            .addFields({ name: 'URL', value: tweetUrl })
            .setFooter({ text: `Queue #${item.id} • Ball-AI Agent` })
            .setTimestamp();

          await postedChannel.send({ embeds: [postedEmbed] });
        }

        await logToPipeline(`🐦 Queue #${item.id} published: ${tweetUrl}`);
        logger.info({ queueId: item.id, url: tweetUrl }, 'Post queue: published');
      } else {
        markPostFailed(item.id, 'publishFn returned null');
        await logToPipeline(`⚠️ Queue #${item.id} publish returned null (retry ${item.retry_count + 1}/3)`);
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      markPostFailed(item.id, errMsg);
      logger.error({ err, queueId: item.id }, 'Post queue: publish failed');
      await logToPipeline(`❌ Queue #${item.id} failed: ${errMsg} (retry ${item.retry_count + 1}/3)`);
    }

    // Small delay between posts to avoid rate limits
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

let scoutInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Returns the Klaw Discord client (after pipeline start).
 * Used by discord-channels.ts to reuse the same bot connection.
 */
export function getKlawClient(): Client | null {
  return klawClient ?? null;
}

export async function startDiscordPipeline(): Promise<void> {
  try {
    config = loadConfig();
  } catch (err) {
    logger.warn({ err }, 'Discord pipeline not configured, skipping');
    return;
  }

  logger.info('Starting Discord content pipeline...');

  // Create clients
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ];

  scoutClient = new Client({ intents });
  researcherClient = new Client({ intents, partials: [Partials.Message, Partials.Channel] });
  klawClient = new Client({
    intents,
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  // ── Scout: login and start cron ──
  scoutClient.once('ready', () => {
    logger.info({ user: scoutClient.user?.tag }, 'Scout bot connected to Discord');
  });

  // ── Researcher: watch #scout-alerts ──
  researcherClient.once('ready', () => {
    logger.info({ user: researcherClient.user?.tag }, 'Researcher bot connected to Discord');
  });

  researcherClient.on('messageCreate', async (message) => {
    if (message.channelId === config.channels.scoutAlerts && message.author.bot) {
      await handleScoutAlert(message);
    }
  });

  // ── Klaw: watch #research-desk + reactions on #content-drafts ──
  klawClient.once('ready', () => {
    logger.info({ user: klawClient.user?.tag }, 'Klaw bot connected to Discord');
  });

  klawClient.on('messageCreate', async (message) => {
    if (message.channelId === config.channels.researchDesk && message.author.bot) {
      await handleResearchPost(message);
    }
    // Direct line: route interactive channel messages to agent
    if (interactiveChannelIds.has(message.channelId) && !message.author.bot) {
      await handleDirectLineMessage(message);
    }
  });

  klawClient.on('messageReactionAdd', async (reaction, user) => {
    // Fetch partial reactions/messages if needed
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (err) {
        logger.error({ err }, 'Failed to fetch partial reaction');
        return;
      }
    }
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
      } catch (err) {
        logger.error({ err }, 'Failed to fetch partial message');
        return;
      }
    }
    await handleReaction(reaction as MessageReaction, user as User);
  });

  // Login all three bots
  try {
    await Promise.all([
      scoutClient.login(config.scoutToken),
      researcherClient.login(config.researcherToken),
      klawClient.login(config.klawToken),
    ]);
    logger.info('All 3 Discord bots connected');

    // Start Scout cron — every 2 hours
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    scoutInterval = setInterval(() => {
      runScoutScan().catch((err) => {
        logger.error({ err }, 'Scout scan error');
      });
    }, TWO_HOURS);

    // Run initial scan after 30 seconds (let bots settle)
    setTimeout(() => {
      runScoutScan().catch((err) => {
        logger.error({ err }, 'Initial scout scan error');
      });
    }, 30_000);

    // Start post queue consumer — every 2 minutes
    const TWO_MINUTES = 2 * 60 * 1000;
    queueInterval = setInterval(() => {
      processPostQueue().catch((err) => {
        logger.error({ err }, 'Post queue consumer error');
      });
    }, TWO_MINUTES);

    // Process any pending queue items after 15 seconds
    setTimeout(() => {
      processPostQueue().catch((err) => {
        logger.error({ err }, 'Initial post queue processing error');
      });
    }, 15_000);

    // Log startup to pipeline
    await logToPipeline('🚀 Discord Content Pipeline started — Scout (2h), Researcher (auto), Klaw (auto + approval), Post Queue (2min)');
  } catch (err) {
    logger.error({ err }, 'Failed to start Discord pipeline');
  }
}

export async function stopDiscordPipeline(): Promise<void> {
  if (scoutInterval) {
    clearInterval(scoutInterval);
    scoutInterval = null;
  }
  if (queueInterval) {
    clearInterval(queueInterval);
    queueInterval = null;
  }
  await Promise.allSettled([
    scoutClient?.destroy(),
    researcherClient?.destroy(),
    klawClient?.destroy(),
  ]);
  logger.info('Discord pipeline stopped');
}

// ── Manual triggers (for testing from Telegram) ──────────────────────────────

export async function triggerScoutScan(): Promise<void> {
  await runScoutScan();
}

export { config as discordConfig };
