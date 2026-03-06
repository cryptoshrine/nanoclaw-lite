/**
 * Distribution types and constants — safe for client and server use.
 * No fs/path imports. Only types and pure data.
 */

// ── Channel types ────────────────────────────────────────────────────

export type ChannelStatus = "active" | "planned" | "not_started";

export interface ChannelHealth {
  name: string;
  status: ChannelStatus;
  handle?: string;
  url?: string;
  description: string;
}

export const CHANNELS: ChannelHealth[] = [
  {
    name: "X / Twitter",
    status: "active",
    handle: "@Ball_AI_Agent",
    url: "https://x.com/Ball_AI_Agent",
    description: "Daily posts, engagement crons, autonomous operation",
  },
  {
    name: "Reddit",
    status: "planned",
    description: "r/soccer, r/FantasyPL, r/footballtactics — value-first analysis posts",
  },
  {
    name: "YouTube",
    status: "planned",
    description: "Tutorials & Shorts — screen recordings of Ball-AI in action",
  },
  {
    name: "Newsletter",
    status: "planned",
    description: "Weekly Ball-AI Intelligence Brief via Resend/Substack",
  },
];

// ── X Engagement ─────────────────────────────────────────────────────

export interface DailyEngagement {
  date: string;
  posts: number;
  likes: number;
  rts: number;
  follows: number;
}

export interface XPost {
  title: string;
  date: string;
  url?: string;
  pillar?: string;
  type?: string;
}

export interface XDashboardData {
  daily: DailyEngagement[];
  totals: { posts: number; likes: number; rts: number; follows: number };
  recentPosts: XPost[];
  daysActive: number;
}

// ── Waitlist ─────────────────────────────────────────────────────────

export interface WaitlistData {
  totalSignups: number;
  spotsRemaining: number;
  totalSpots: number;
  recentSignups?: number;
}

// ── Content Calendar ─────────────────────────────────────────────────

export type ContentStatus = "posted" | "scheduled" | "draft" | "idea";
export type ContentChannel = "x" | "reddit" | "youtube" | "newsletter";

export interface ContentEntry {
  id: string;
  date: string;
  channel: ContentChannel;
  pillar: string;
  title: string;
  status: ContentStatus;
  url?: string;
}

export const CONTENT_STATUS_COLORS: Record<ContentStatus, string> = {
  posted: "success",
  scheduled: "electric",
  draft: "amber",
  idea: "muted-foreground",
};

export const CHANNEL_LABELS: Record<ContentChannel, string> = {
  x: "X / Twitter",
  reddit: "Reddit",
  youtube: "YouTube",
  newsletter: "Newsletter",
};

// ── Creator Outreach ─────────────────────────────────────────────────

export type OutreachStage =
  | "identified"
  | "following"
  | "engaging"
  | "contacted"
  | "partner";

export interface Creator {
  handle: string;
  channelName: string;
  platform: string;
  followers: number;
  contentFocus: string;
  twitterHandle?: string;
  outreachStage: OutreachStage;
  notes?: string;
}

export const OUTREACH_STAGE_COLORS: Record<OutreachStage, string> = {
  identified: "muted-foreground",
  following: "electric",
  engaging: "amber",
  contacted: "cyan",
  partner: "success",
};

export const OUTREACH_STAGE_LABELS: Record<OutreachStage, string> = {
  identified: "Identified",
  following: "Following",
  engaging: "Engaging",
  contacted: "Contacted",
  partner: "Partner",
};

// ── Growth Targets ───────────────────────────────────────────────────

export interface GrowthTarget {
  metric: string;
  current: number | string;
  week2: number | string;
  month1: number | string;
  month3: number | string;
}

export const GROWTH_TARGETS: GrowthTarget[] = [
  { metric: "X Followers", current: "~low", week2: 200, month1: 500, month3: 5000 },
  { metric: "Waitlist Signups", current: "unknown", week2: 20, month1: 100, month3: 1500 },
  { metric: "Reddit Posts", current: 0, week2: 3, month1: 12, month3: 50 },
  { metric: "Newsletter Subs", current: 0, week2: "—", month1: 50, month3: 500 },
  { metric: "YouTube Subs", current: 0, week2: "—", month1: 100, month3: 500 },
  { metric: "Founding Members", current: 0, week2: "—", month1: 15, month3: 40 },
];

// ── Overview response ────────────────────────────────────────────────

export interface DistributionOverview {
  channels: ChannelHealth[];
  xDashboard: XDashboardData;
  growthTargets: GrowthTarget[];
}
