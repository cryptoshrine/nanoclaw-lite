/**
 * Distribution data access layer — SERVER ONLY.
 * Reads engagement logs, creator CSV, and content calendar data.
 *
 * Client components should import types/constants from "@/lib/distribution-types" instead.
 */
import fs from "fs";
import path from "path";
import { PATHS } from "./paths";

export * from "./distribution-types";

import type {
  DailyEngagement,
  XPost,
  XDashboardData,
  Creator,
  OutreachStage,
  ContentEntry,
} from "./distribution-types";

// ── Path helpers ─────────────────────────────────────────────────────

const DISTRIBUTION_DIR = path.join(PATHS.groups, "main", "distribution");
const X_ENGAGEMENT_LOG = path.join(
  PATHS.groups,
  "main",
  "knowledge",
  "areas",
  "x-engagement-log.md"
);
const CREATOR_CSV = path.resolve("C:\\claw\\Ball_AI_Lead_List_Clean.csv");
const OUTREACH_TRACKER = path.join(DISTRIBUTION_DIR, "outreach-tracker.json");
const CONTENT_CALENDAR = path.join(DISTRIBUTION_DIR, "content-calendar.json");

// ── Engagement log parser ────────────────────────────────────────────

/**
 * Parse the cumulative totals markdown table from the engagement log.
 * Format:
 * | Metric | Feb 26 | Feb 27 | ... | Total |
 * | Posts  | 7      | 5      | ... | 31    |
 */
export function parseEngagementLog(): XDashboardData {
  const defaults: XDashboardData = {
    daily: [],
    totals: { posts: 0, likes: 0, rts: 0, follows: 0 },
    recentPosts: [],
    daysActive: 0,
  };

  try {
    if (!fs.existsSync(X_ENGAGEMENT_LOG)) return defaults;
    const raw = fs.readFileSync(X_ENGAGEMENT_LOG, "utf-8");
    const lines = raw.split("\n");

    // Find the LAST cumulative totals section (multiple versions may exist)
    let totalsIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes("## Cumulative Totals")) {
        totalsIdx = i;
        break;
      }
    }
    if (totalsIdx === -1) return defaults;

    // Parse the markdown table (header row + separator + data rows)
    const tableLines: string[] = [];
    for (let i = totalsIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("|")) {
        tableLines.push(line);
      } else if (tableLines.length > 0 && !line.startsWith("|")) {
        break;
      }
    }

    if (tableLines.length < 3) return defaults;

    // Parse header to get date columns
    const headerCells = tableLines[0]
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    // headerCells = ["Metric", "Feb 26", "Feb 27", ..., "Total"]
    const dateColumns = headerCells.slice(1, -1); // everything except "Metric" and "Total"

    // Parse data rows (skip separator at index 1)
    const dataRows: Record<string, number[]> = {};
    const totalValues: Record<string, number> = {};

    for (let i = 2; i < tableLines.length; i++) {
      const cells = tableLines[i]
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length < 2) continue;

      const metric = cells[0].toLowerCase();
      const values = cells.slice(1, -1).map((v) => parseInt(v, 10) || 0);
      const total = parseInt(cells[cells.length - 1], 10) || 0;

      dataRows[metric] = values;
      totalValues[metric] = total;
    }

    // Build daily engagement array
    const daily: DailyEngagement[] = dateColumns.map((date, idx) => ({
      date,
      posts: dataRows["posts"]?.[idx] ?? 0,
      likes: dataRows["likes"]?.[idx] ?? 0,
      rts: dataRows["rts"]?.[idx] ?? 0,
      follows: dataRows["follows"]?.[idx] ?? 0,
    }));

    // Parse recent posts from day sections
    const recentPosts: XPost[] = [];
    let currentDate = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match day headers like "## Feb 26, 2026" or "## Mar 1, 2026"
      const dayMatch = line.match(/^## (\w+ \d+, \d+)/);
      if (dayMatch) {
        currentDate = dayMatch[1];
        continue;
      }

      // Match post entries — bold title lines
      const postMatch = line.match(
        /^\d+\.\s+\*\*(.+?)\*\*\s*(?:—|–|-)\s*(.+)/
      );
      if (postMatch && currentDate) {
        const title = postMatch[1];
        const meta = postMatch[2];

        // Try to find URL on next line(s)
        let url: string | undefined;
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const urlMatch = lines[j].match(
            /https:\/\/x\.com\/Ball_AI_Agent\/status\/\d+/
          );
          if (urlMatch) {
            url = urlMatch[0];
            break;
          }
        }

        // Extract pillar from meta
        let pillar: string | undefined;
        const pillarMatch = meta.match(/Pillar \d+: (.+?)\)/);
        if (pillarMatch) pillar = pillarMatch[1];

        recentPosts.push({ title, date: currentDate, url, pillar });
      }
    }

    return {
      daily,
      totals: {
        posts: totalValues["posts"] ?? 0,
        likes: totalValues["likes"] ?? 0,
        rts: totalValues["rts"] ?? 0,
        follows: totalValues["follows"] ?? 0,
      },
      recentPosts: recentPosts.slice(-20), // last 20 posts
      daysActive: daily.length,
    };
  } catch {
    return defaults;
  }
}

// ── Creator CSV parser ───────────────────────────────────────────────

/**
 * Parse CSV with quoted fields. Simple state-machine approach.
 */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function getCreators(): Creator[] {
  try {
    if (!fs.existsSync(CREATOR_CSV)) return [];
    const raw = fs.readFileSync(CREATOR_CSV, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return [];

    // Parse header
    const headers = parseCsvRow(lines[0]);
    const handleIdx = headers.indexOf("Channel Handle");
    const nameIdx = headers.indexOf("Channel Name");
    const platformIdx = headers.indexOf("Primary Platform");
    const followersIdx = headers.indexOf("subscribers_numeric");
    const focusIdx = headers.indexOf("Content Focus");
    const twitterIdx = headers.indexOf("Twitter/X Handle");
    const notesIdx = headers.indexOf("Additional Notes");

    // Load outreach tracker for stage info
    let stageMap: Record<string, OutreachStage> = {};
    try {
      if (fs.existsSync(OUTREACH_TRACKER)) {
        const trackerRaw = fs.readFileSync(OUTREACH_TRACKER, "utf-8");
        const tracker = JSON.parse(trackerRaw) as { stages: Record<string, OutreachStage> };
        stageMap = tracker.stages ?? {};
      }
    } catch {
      // ignore
    }

    const creators: Creator[] = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvRow(lines[i]);
      if (fields.length < 5) continue;

      const handle = fields[handleIdx] ?? "";
      const twitter = fields[twitterIdx] ?? "";
      const cleanHandle = handle.replace(/^@/, "");

      creators.push({
        handle: cleanHandle,
        channelName: fields[nameIdx] ?? handle,
        platform: fields[platformIdx] ?? "Unknown",
        followers: parseInt(fields[followersIdx], 10) || 0,
        contentFocus: fields[focusIdx] ?? "",
        twitterHandle: twitter !== "Not Found" ? twitter : undefined,
        outreachStage: stageMap[cleanHandle] ?? "identified",
        notes: fields[notesIdx] !== "None" ? fields[notesIdx] : undefined,
      });
    }

    return creators.sort((a, b) => b.followers - a.followers);
  } catch {
    return [];
  }
}

// ── Content Calendar ─────────────────────────────────────────────────

export function getContentCalendar(): ContentEntry[] {
  try {
    if (!fs.existsSync(CONTENT_CALENDAR)) return [];
    const raw = fs.readFileSync(CONTENT_CALENDAR, "utf-8");
    const data = JSON.parse(raw) as { entries: ContentEntry[] };
    return data.entries ?? [];
  } catch {
    return [];
  }
}

// ── Waitlist (proxied from Ball-AI API) ──────────────────────────────

let waitlistCache: { data: WaitlistData | null; ts: number } = {
  data: null,
  ts: 0,
};
const WAITLIST_TTL = 5 * 60 * 1000; // 5 minutes

interface WaitlistData {
  totalSignups: number;
  spotsRemaining: number;
  totalSpots: number;
  recentSignups?: number;
}

export async function getWaitlistStats(): Promise<WaitlistData | null> {
  const now = Date.now();
  if (waitlistCache.data && now - waitlistCache.ts < WAITLIST_TTL) {
    return waitlistCache.data;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://app.ball-ai.xyz/api/waitlist/stats", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return waitlistCache.data;

    const json = await res.json();
    const data: WaitlistData = {
      totalSignups: json.total_signups ?? json.totalSignups ?? 0,
      spotsRemaining: json.spots_remaining ?? json.spotsRemaining ?? 100,
      totalSpots: json.total_spots ?? json.totalSpots ?? 100,
      recentSignups: json.recent_signups ?? json.recentSignups,
    };

    waitlistCache = { data, ts: now };
    return data;
  } catch {
    return waitlistCache.data;
  }
}
