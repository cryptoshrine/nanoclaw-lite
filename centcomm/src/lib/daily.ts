import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import type {
  DailyLog,
  DailyLogSummary,
  DailySession,
  ActiveWorkItem,
  SearchResult,
  PROJECT_TAGS,
} from "./daily-types";
import { PROJECT_TAGS as TAGS } from "./daily-types";

const DAILY_DIR = path.join(process.cwd(), "..", "groups", "main", "daily");

export function listDailyLogs(): string[] {
  if (!existsSync(DAILY_DIR)) return [];
  return readdirSync(DAILY_DIR)
    .filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.replace(".md", ""))
    .sort()
    .reverse();
}

function parseActiveWork(section: string): ActiveWorkItem[] {
  return section
    .split("\n")
    .filter((l) => /^- \[[ x]\]/.test(l.trim()))
    .map((l) => ({
      text: l.trim().replace(/^- \[[ x]\] /, ""),
      completed: l.includes("[x]"),
    }));
}

function parseSessions(raw: string): DailySession[] {
  const sessions: DailySession[] = [];
  // Split on session headers: ## Session @ TIME
  const sessionBlocks = raw.split(/^## Session @ /m).slice(1);

  for (const block of sessionBlocks) {
    const lines = block.split("\n");
    const headerLine = lines[0] ?? "";

    // Parse time from header: "12:02 AM [Scheduled Task]" or "2:06 PM"
    const timeMatch = headerLine.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    const time = timeMatch ? timeMatch[1].trim() : "Unknown";
    const isScheduled = headerLine.includes("[Scheduled Task]");

    let duration = "";
    let topic = "";
    let status: DailySession["status"] = "unknown";
    let summary = "";
    let pending = "";
    let nextStep = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- Duration:")) {
        duration = trimmed.replace("- Duration:", "").trim();
      } else if (trimmed.startsWith("- Topic:")) {
        topic = trimmed.replace("- Topic:", "").trim();
      } else if (trimmed.startsWith("- Status:")) {
        const s = trimmed.replace("- Status:", "").trim().toLowerCase();
        if (s === "completed" || s === "in-progress" || s === "blocked") {
          status = s;
        }
      } else if (trimmed.startsWith("- Summary:")) {
        summary = trimmed.replace("- Summary:", "").trim();
      } else if (trimmed.startsWith("- Pending:")) {
        pending = trimmed.replace("- Pending:", "").trim();
      } else if (trimmed.startsWith("- Next step:")) {
        nextStep = trimmed.replace("- Next step:", "").trim();
      }
    }

    if (topic || summary) {
      sessions.push({ time, isScheduled, duration, topic, status, summary, pending: pending || undefined, nextStep: nextStep || undefined });
    }
  }

  return sessions;
}

function detectProjects(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [project, keywords] of Object.entries(TAGS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      found.push(project);
    }
  }
  return found;
}

export function getDailyLog(date: string): DailyLog | null {
  const filePath = path.join(DAILY_DIR, `${date}.md`);
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, "utf-8");

  // Extract Active Work section
  const activeMatch = raw.match(/## Active Work[^\n]*\n([\s\S]*?)(?=\n## (?!Active)|\n---|\Z)/);
  const activeWork = activeMatch ? parseActiveWork(activeMatch[1]) : [];

  // Extract Completed Yesterday section
  const completedMatch = raw.match(/## Completed Yesterday[^\n]*\n([\s\S]*?)(?=\n## (?!Completed)|\n---|\Z)/);
  const completedYesterday = completedMatch ? parseActiveWork(completedMatch[1]) : [];

  const sessions = parseSessions(raw);

  return { date, activeWork, completedYesterday, sessions, raw };
}

export function getDailyLogSummary(date: string): DailyLogSummary | null {
  const log = getDailyLog(date);
  if (!log) return null;

  const userSessions = log.sessions.filter((s) => !s.isScheduled).length;
  const scheduledSessions = log.sessions.filter((s) => s.isScheduled).length;
  const topics = [...new Set(log.sessions.map((s) => s.topic).filter(Boolean))];
  const projects = detectProjects(log.raw);

  return {
    date,
    totalSessions: log.sessions.length,
    userSessions,
    scheduledSessions,
    completedItems: log.activeWork.filter((i) => i.completed).length + log.completedYesterday.filter((i) => i.completed).length,
    pendingItems: log.activeWork.filter((i) => !i.completed).length,
    topics,
    projects,
  };
}

export function getAllSummaries(): DailyLogSummary[] {
  const dates = listDailyLogs();
  return dates
    .map((d) => getDailyLogSummary(d))
    .filter((s): s is DailyLogSummary => s !== null);
}

export function searchLogs(query: string, projectFilter?: string): SearchResult[] {
  const dates = listDailyLogs();
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const date of dates) {
    const filePath = path.join(DAILY_DIR, `${date}.md`);
    if (!existsSync(filePath)) continue;

    const raw = readFileSync(filePath, "utf-8");

    // If project filter, skip days that don't mention the project
    if (projectFilter && projectFilter !== "all") {
      const keywords = TAGS[projectFilter];
      if (keywords && !keywords.some((kw) => raw.toLowerCase().includes(kw))) {
        continue;
      }
    }

    const lines = raw.split("\n");
    let currentSection = "Header";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ")) {
        currentSection = line.replace(/^## /, "").trim();
      }

      if (line.toLowerCase().includes(queryLower)) {
        // Grab surrounding context (1 line before and after)
        const contextLines = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2));
        results.push({
          date,
          line: line.trim(),
          lineNumber: i + 1,
          context: contextLines.join("\n"),
          section: currentSection,
        });
      }
    }
  }

  return results.slice(0, 100); // Cap at 100 results
}
