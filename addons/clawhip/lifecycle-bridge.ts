/**
 * Clawhip — Discord Lifecycle Bridge
 *
 * Posts color-coded embeds to Discord #mission-control when agent lifecycle
 * events occur. Provides visibility into specialist spawning, completion,
 * failure, and cleanup.
 *
 * Events:
 *   - team.created      → Blue embed
 *   - specialist.spawned → Purple embed
 *   - specialist.completed → Green embed
 *   - specialist.failed  → Red embed
 *   - specialist.crashed → Red embed (with error details)
 *   - specialist.timeout → Amber embed
 *   - team.cleaned_up   → Gray embed
 *
 * ADDON: clawhip
 * Install: Copy this file to src/lifecycle-bridge.ts
 * Requires: discord.js npm package
 */

import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LifecycleEventType =
  | 'team.created'
  | 'specialist.spawned'
  | 'specialist.completed'
  | 'specialist.failed'
  | 'specialist.crashed'
  | 'specialist.timeout'
  | 'team.cleaned_up';

export interface LifecycleEvent {
  type: LifecycleEventType;
  teamId: string;
  teamName: string;
  timestamp: string;
  specialistName?: string;
  specialistModel?: string;
  duration?: number;
  error?: string;
  summary?: string;
}

// ── Color Map ─────────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<LifecycleEventType, number> = {
  'team.created':         0x3498DB, // Blue
  'specialist.spawned':   0x9B59B6, // Purple
  'specialist.completed': 0x2ECC71, // Green
  'specialist.failed':    0xE74C3C, // Red
  'specialist.crashed':   0xE74C3C, // Red
  'specialist.timeout':   0xF39C12, // Amber
  'team.cleaned_up':      0x95A5A6, // Gray
};

const EVENT_ICONS: Record<LifecycleEventType, string> = {
  'team.created':         '🔵',
  'specialist.spawned':   '🟣',
  'specialist.completed': '🟢',
  'specialist.failed':    '🔴',
  'specialist.crashed':   '🔴',
  'specialist.timeout':   '🟠',
  'team.cleaned_up':      '⚪',
};

// ── Client State ──────────────────────────────────────────────────────────────

let client: Client | null = null;
let missionControlChannel: TextChannel | null = null;
let initialized = false;

// ── Initialize ────────────────────────────────────────────────────────────────

/**
 * Initialize the Clawhip bridge with a Discord bot token.
 * Call this once at startup.
 */
export async function initClawhip(token: string, channelId: string): Promise<void> {
  if (initialized) return;

  client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  await client.login(token);

  // Wait for ready
  await new Promise<void>((resolve) => {
    client!.once('ready', () => resolve());
  });

  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }

  missionControlChannel = channel;
  initialized = true;
}

/**
 * Initialize with an existing Discord.js Client (shared with other modules).
 */
export function initClawhipWithClient(existingClient: Client, channelId: string): void {
  if (initialized) return;

  client = existingClient;
  const channel = client.channels.cache.get(channelId);
  if (channel && channel instanceof TextChannel) {
    missionControlChannel = channel;
    initialized = true;
  }
}

// ── Post Event ────────────────────────────────────────────────────────────────

/**
 * Post a lifecycle event to #mission-control.
 */
export async function postLifecycleEvent(event: LifecycleEvent): Promise<void> {
  if (!initialized || !missionControlChannel) return;

  const color = EVENT_COLORS[event.type] || 0x95A5A6;
  const icon = EVENT_ICONS[event.type] || '⚪';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${icon} ${formatEventType(event.type)}`)
    .setTimestamp(new Date(event.timestamp));

  // Team info
  embed.addFields({ name: 'Team', value: event.teamName, inline: true });

  // Specialist info
  if (event.specialistName) {
    embed.addFields({ name: 'Specialist', value: event.specialistName, inline: true });
  }
  if (event.specialistModel) {
    embed.addFields({ name: 'Model', value: event.specialistModel, inline: true });
  }

  // Duration
  if (event.duration !== undefined) {
    const secs = Math.round(event.duration / 1000);
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    const formatted = mins > 0 ? `${mins}m ${remaining}s` : `${secs}s`;
    embed.addFields({ name: 'Duration', value: formatted, inline: true });
  }

  // Summary or error
  if (event.summary) {
    embed.setDescription(event.summary.slice(0, 200));
  }
  if (event.error) {
    embed.addFields({
      name: 'Error',
      value: `\`\`\`${event.error.slice(0, 500)}\`\`\``,
    });
  }

  try {
    await missionControlChannel.send({ embeds: [embed] });
  } catch (err) {
    // Silently fail — don't let Discord errors break the main flow
    console.error('Clawhip: Failed to post lifecycle event:', err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEventType(type: LifecycleEventType): string {
  const labels: Record<LifecycleEventType, string> = {
    'team.created':         'Team Created',
    'specialist.spawned':   'Specialist Spawned',
    'specialist.completed': 'Specialist Completed',
    'specialist.failed':    'Specialist Failed',
    'specialist.crashed':   'Specialist Crashed',
    'specialist.timeout':   'Specialist Timed Out',
    'team.cleaned_up':      'Team Cleaned Up',
  };
  return labels[type] || type;
}

/**
 * Shut down the Clawhip bridge.
 */
export async function shutdownClawhip(): Promise<void> {
  if (client) {
    client.destroy();
    client = null;
    missionControlChannel = null;
    initialized = false;
  }
}
