/**
 * Discord Channels — Extended channel support for Ball-AI Ops
 *
 * Provides utilities for posting to project channels, agent lines,
 * intelligence channels, and operations channels beyond the core
 * content pipeline.
 *
 * Channel categories:
 *   - Content Pipeline: scout-alerts, research-desk, content-drafts, approved-queue, posted, pipeline-logs
 *   - Projects: ball-ai-dev, nanoclaw-dev, remotion-pipeline, betting-signals
 *   - Agent Lines: dev-agent, research-agent, copywriter-agent
 *   - Intelligence: daily-digest, x-metrics, competitor-watch
 *   - Operations: general, mission-control
 */

import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { logger } from './logger.js';

// ── Extended Channel Config ─────────────────────────────────────────────────

export interface ExtendedChannelConfig {
  // Projects
  ballAiDev?: string;
  nanoclavDev?: string;
  remotionPipeline?: string;
  bettingSignals?: string;
  // Agent Lines
  devAgent?: string;
  researchAgent?: string;
  copywriterAgent?: string;
  // Intelligence
  dailyDigest?: string;
  xMetrics?: string;
  competitorWatch?: string;
  // Operations
  general?: string;
  missionControl?: string;
}

export function loadExtendedChannels(): ExtendedChannelConfig {
  return {
    ballAiDev: process.env.DISCORD_CHANNEL_BALL_AI_DEV || undefined,
    nanoclavDev: process.env.DISCORD_CHANNEL_NANOCLAW_DEV || undefined,
    remotionPipeline: process.env.DISCORD_CHANNEL_REMOTION_PIPELINE || undefined,
    bettingSignals: process.env.DISCORD_CHANNEL_BETTING_SIGNALS || undefined,
    devAgent: process.env.DISCORD_CHANNEL_DEV_AGENT || undefined,
    researchAgent: process.env.DISCORD_CHANNEL_RESEARCH_AGENT || undefined,
    copywriterAgent: process.env.DISCORD_CHANNEL_COPYWRITER_AGENT || undefined,
    dailyDigest: process.env.DISCORD_CHANNEL_DAILY_DIGEST || undefined,
    xMetrics: process.env.DISCORD_CHANNEL_X_METRICS || undefined,
    competitorWatch: process.env.DISCORD_CHANNEL_COMPETITOR_WATCH || undefined,
    general: process.env.DISCORD_CHANNEL_GENERAL || undefined,
    missionControl: process.env.DISCORD_CHANNEL_MISSION_CONTROL || undefined,
  };
}

// ── Channel Client ──────────────────────────────────────────────────────────

let client: Client | null = null;
let channels: ExtendedChannelConfig = {};

/**
 * Initialize the extended channels module. Reuses the Klaw bot client
 * (passed from discord-pipeline.ts) to avoid creating a 4th bot connection.
 */
export function initExtendedChannels(klawClient: Client): void {
  client = klawClient;
  channels = loadExtendedChannels();
  const count = Object.values(channels).filter(Boolean).length;
  logger.info({ configuredChannels: count }, 'Extended Discord channels initialized');
}

/**
 * Initialize with a standalone client (for when pipeline isn't running).
 */
export async function initStandaloneClient(token: string): Promise<void> {
  if (client) return; // Already initialized via pipeline

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await client.login(token);
  channels = loadExtendedChannels();
  logger.info('Extended channels: standalone client connected');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getChannel(channelId: string): Promise<TextChannel | null> {
  if (!client) return null;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch instanceof TextChannel) return ch;
    return null;
  } catch (err) {
    logger.error({ err, channelId }, 'Extended channels: failed to fetch channel');
    return null;
  }
}

async function sendToChannel(channelId: string | undefined, content: string | { embeds: EmbedBuilder[] }): Promise<boolean> {
  if (!channelId) return false;
  const ch = await getChannel(channelId);
  if (!ch) return false;
  try {
    if (typeof content === 'string') {
      await ch.send(content);
    } else {
      await ch.send(content);
    }
    return true;
  } catch (err) {
    logger.error({ err, channelId }, 'Extended channels: failed to send message');
    return false;
  }
}

// ── Project Channel Posts ───────────────────────────────────────────────────

export type ProjectChannel = 'ball-ai-dev' | 'nanoclaw-dev' | 'remotion-pipeline' | 'betting-signals';

const projectChannelMap: Record<ProjectChannel, keyof ExtendedChannelConfig> = {
  'ball-ai-dev': 'ballAiDev',
  'nanoclaw-dev': 'nanoclavDev',
  'remotion-pipeline': 'remotionPipeline',
  'betting-signals': 'bettingSignals',
};

export async function postToProject(
  project: ProjectChannel,
  title: string,
  description: string,
  color?: number,
): Promise<boolean> {
  const channelKey = projectChannelMap[project];
  const channelId = channels[channelKey];
  if (!channelId) {
    logger.debug({ project }, 'Extended channels: project channel not configured');
    return false;
  }

  const embed = new EmbedBuilder()
    .setColor(color ?? 0x3b82f6) // blue default
    .setTitle(title)
    .setDescription(description.slice(0, 4000))
    .setTimestamp();

  return sendToChannel(channelId, { embeds: [embed] });
}

// ── Agent Line Posts ────────────────────────────────────────────────────────

export type AgentLine = 'dev-agent' | 'research-agent' | 'copywriter-agent';

const agentLineMap: Record<AgentLine, keyof ExtendedChannelConfig> = {
  'dev-agent': 'devAgent',
  'research-agent': 'researchAgent',
  'copywriter-agent': 'copywriterAgent',
};

export async function postToAgentLine(
  agent: AgentLine,
  message: string,
  isResult = false,
): Promise<boolean> {
  const channelKey = agentLineMap[agent];
  const channelId = channels[channelKey];
  if (!channelId) return false;

  if (isResult) {
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('Agent Result')
      .setDescription(message.slice(0, 4000))
      .setTimestamp();
    return sendToChannel(channelId, { embeds: [embed] });
  }

  return sendToChannel(channelId, message);
}

// ── Intelligence Channels ───────────────────────────────────────────────────

export async function postDailyDigest(digest: string): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6) // purple
    .setTitle(`Daily Digest — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`)
    .setDescription(digest.slice(0, 4000))
    .setTimestamp();

  return sendToChannel(channels.dailyDigest, { embeds: [embed] });
}

export async function postXMetrics(metrics: string): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor(0x1da1f2) // twitter blue
    .setTitle('X Metrics Report')
    .setDescription(metrics.slice(0, 4000))
    .setTimestamp();

  return sendToChannel(channels.xMetrics, { embeds: [embed] });
}

export async function postCompetitorWatch(report: string): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b) // amber
    .setTitle('Competitor Watch')
    .setDescription(report.slice(0, 4000))
    .setTimestamp();

  return sendToChannel(channels.competitorWatch, { embeds: [embed] });
}

// ── Operations Channels ─────────────────────────────────────────────────────

export async function postToMissionControl(
  title: string,
  status: string,
  color?: number,
): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor(color ?? 0x6b7280) // gray default
    .setTitle(title)
    .setDescription(status.slice(0, 4000))
    .setTimestamp();

  return sendToChannel(channels.missionControl, { embeds: [embed] });
}

export async function postToGeneral(message: string): Promise<boolean> {
  return sendToChannel(channels.general, message);
}

// ── Notification Helpers ────────────────────────────────────────────────────

/**
 * Post a deployment notification to #ball-ai-dev
 */
export async function notifyDeploy(
  project: ProjectChannel,
  version: string,
  changes: string,
): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor(0x22c55e) // green
    .setTitle(`🚀 Deploy — ${version}`)
    .setDescription(changes.slice(0, 4000))
    .setTimestamp();

  const channelKey = projectChannelMap[project];
  return sendToChannel(channels[channelKey], { embeds: [embed] });
}

/**
 * Post a PR notification to a project channel
 */
export async function notifyPR(
  project: ProjectChannel,
  prTitle: string,
  prUrl: string,
  status: 'opened' | 'merged' | 'closed',
): Promise<boolean> {
  const colorMap = { opened: 0x3b82f6, merged: 0x8b5cf6, closed: 0xef4444 };
  const emojiMap = { opened: '📝', merged: '✅', closed: '❌' };

  const embed = new EmbedBuilder()
    .setColor(colorMap[status])
    .setTitle(`${emojiMap[status]} PR ${status}: ${prTitle}`)
    .setURL(prUrl)
    .setTimestamp();

  const channelKey = projectChannelMap[project];
  return sendToChannel(channels[channelKey], { embeds: [embed] });
}

/**
 * Post a test result notification to a project channel
 */
export async function notifyTestResult(
  project: ProjectChannel,
  passed: number,
  failed: number,
  duration: string,
): Promise<boolean> {
  const allPassed = failed === 0;
  const embed = new EmbedBuilder()
    .setColor(allPassed ? 0x22c55e : 0xef4444)
    .setTitle(allPassed ? '✅ Tests Passed' : '❌ Tests Failed')
    .setDescription(`**Passed:** ${passed}\n**Failed:** ${failed}\n**Duration:** ${duration}`)
    .setTimestamp();

  const channelKey = projectChannelMap[project];
  return sendToChannel(channels[channelKey], { embeds: [embed] });
}

/**
 * Post a value bet notification to #betting-signals
 */
export async function notifyValueBet(
  match: string,
  bet: string,
  odds: number,
  edge: string,
): Promise<boolean> {
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b) // amber
    .setTitle(`💰 Value Bet: ${match}`)
    .addFields(
      { name: 'Bet', value: bet, inline: true },
      { name: 'Odds', value: String(odds), inline: true },
      { name: 'Edge', value: edge, inline: true },
    )
    .setTimestamp();

  return sendToChannel(channels.bettingSignals, { embeds: [embed] });
}

/**
 * Post a system health update to #mission-control
 */
export async function notifySystemHealth(
  status: 'healthy' | 'degraded' | 'down',
  details: string,
): Promise<boolean> {
  const colorMap = { healthy: 0x22c55e, degraded: 0xf59e0b, down: 0xef4444 };
  const emojiMap = { healthy: '🟢', degraded: '🟡', down: '🔴' };

  return postToMissionControl(
    `${emojiMap[status]} System ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    details,
    colorMap[status],
  );
}
