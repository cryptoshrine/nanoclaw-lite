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
      .setDescription(research.slice(0, 4000))
      .addFields({ name: 'Source Tweet', value: `${author}: "${tweetText.slice(0, 200)}..."` })
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

    const draftsChannel = await getChannel(klawClient, config.channels.contentDrafts);
    if (!draftsChannel) return;

    const draftEmbed = new EmbedBuilder()
      .setColor(0xf59e0b) // amber
      .setTitle('📝 Tweet Draft — React ✅ to approve, ❌ to reject')
      .setDescription(draft.tweetText)
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

    // Store the draft data on the message for later retrieval
    // We use a Map keyed by message ID
    pendingDrafts.set(draftMessage.id, draft);

    await logToPipeline(`✍️ Draft posted to #content-drafts — awaiting approval`);
  } catch (err) {
    logger.error({ err, messageId: message.id }, 'Klaw: failed to create content');
    await logToPipeline(`❌ Klaw content creation failed: ${(err as Error).message}`);
  }
}

// Store pending drafts for approval
const pendingDrafts = new Map<string, ContentDraft>();

async function handleReaction(reaction: MessageReaction, user: User): Promise<void> {
  // Ignore bot reactions
  if (user.bot) return;

  // Only process reactions in #content-drafts
  if (reaction.message.channelId !== config.channels.contentDrafts) return;

  const messageId = reaction.message.id;
  const draft = pendingDrafts.get(messageId);
  if (!draft) return;

  const emoji = reaction.emoji.name;

  if (emoji === '✅') {
    // Approved — move to approved queue
    pendingDrafts.delete(messageId);

    const approvedChannel = await getChannel(klawClient, config.channels.approvedQueue);
    if (approvedChannel) {
      const approvedEmbed = new EmbedBuilder()
        .setColor(0x22c55e) // green
        .setTitle('✅ Approved Tweet')
        .setDescription(draft.tweetText)
        .addFields(
          { name: 'Status', value: 'Queued for optimal posting window', inline: true },
        )
        .setFooter({ text: `Approved by ${user.username}` })
        .setTimestamp();

      await approvedChannel.send({ embeds: [approvedEmbed] });
    }

    await logToPipeline(`✅ Tweet approved by ${user.username} — queued for posting`);

    // Publish to X
    if (publishFn) {
      try {
        const tweetUrl = await publishFn(draft);
        const postedChannel = await getChannel(klawClient, config.channels.posted);
        if (postedChannel && tweetUrl) {
          const postedEmbed = new EmbedBuilder()
            .setColor(0x1da1f2)
            .setTitle('🐦 Published to X')
            .setDescription(draft.tweetText)
            .addFields({ name: 'URL', value: tweetUrl })
            .setFooter({ text: 'Ball-AI Agent' })
            .setTimestamp();

          await postedChannel.send({ embeds: [postedEmbed] });
        }
        await logToPipeline(`🐦 Tweet published: ${tweetUrl || 'posted'}`);
      } catch (err) {
        logger.error({ err }, 'Klaw: failed to publish tweet');
        await logToPipeline(`❌ Failed to publish: ${(err as Error).message}`);
      }
    }
  } else if (emoji === '❌') {
    // Rejected
    pendingDrafts.delete(messageId);
    await logToPipeline(`❌ Tweet rejected by ${user.username}`);
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

let scoutInterval: ReturnType<typeof setInterval> | null = null;

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

    // Log startup to pipeline
    await logToPipeline('🚀 Discord Content Pipeline started — Scout (2h), Researcher (auto), Klaw (auto + approval)');
  } catch (err) {
    logger.error({ err }, 'Failed to start Discord pipeline');
  }
}

export async function stopDiscordPipeline(): Promise<void> {
  if (scoutInterval) {
    clearInterval(scoutInterval);
    scoutInterval = null;
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
