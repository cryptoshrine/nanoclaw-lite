// ── Council Data Access for CENTCOMM ────────────────────────────────
// Reads council session files from data/council/ directory.
// Can also trigger new sessions via the orchestrator.

import fs from "fs";
import path from "path";
import { PATHS } from "./paths";

const COUNCIL_DIR = path.join(PATHS.root, "data", "council");

export interface CouncilSessionSummary {
  id: string;
  topic: string;
  status: "active" | "complete" | "failed";
  phase: string;
  messageCount: number;
  createdAt: string;
  completedAt: string | null;
  winner?: string;
}

export interface CouncilSessionFull {
  id: string;
  topic: string;
  status: "active" | "complete" | "failed";
  phase: string;
  messages: {
    admiralId: string;
    phase: string;
    content: string;
    timestamp: string;
    thinkingTokens?: number;
    completionTokens?: number;
  }[];
  finalPlan: string | null;
  votes: Record<string, { choice: string; rationale: string }> | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

function ensureDir() {
  if (!fs.existsSync(COUNCIL_DIR)) {
    fs.mkdirSync(COUNCIL_DIR, { recursive: true });
  }
}

export function listCouncilSessions(): CouncilSessionSummary[] {
  ensureDir();
  const files = fs.readdirSync(COUNCIL_DIR).filter((f) => f.endsWith(".json"));

  const sessions: CouncilSessionSummary[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(COUNCIL_DIR, file), "utf-8");
      const data = JSON.parse(raw);
      sessions.push({
        id: data.id,
        topic: data.topic,
        status: data.status,
        phase: data.phase,
        messageCount: data.messages?.length || 0,
        createdAt: data.createdAt,
        completedAt: data.completedAt,
        winner: data.votes
          ? getMajorityVote(data.votes)
          : undefined,
      });
    } catch {
      // Skip corrupt files
    }
  }

  sessions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return sessions;
}

export function getCouncilSession(
  sessionId: string
): CouncilSessionFull | null {
  const filePath = path.join(COUNCIL_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CouncilSessionFull;
  } catch {
    return null;
  }
}

export function saveCouncilSession(session: CouncilSessionFull): void {
  ensureDir();
  const filePath = path.join(COUNCIL_DIR, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

function getMajorityVote(
  votes: Record<string, { choice: string; rationale: string }>
): string {
  const counts: Record<string, number> = {};
  for (const v of Object.values(votes)) {
    counts[v.choice] = (counts[v.choice] || 0) + 1;
  }
  let winner = "";
  let max = 0;
  for (const [id, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      winner = id;
    }
  }
  return winner;
}

// ── Admiral Info ────────────────────────────────────────────────────

export interface AdmiralInfo {
  id: string;
  name: string;
  rank: string;
  model: string;
  provider: string;
  strengths: string[];
}

export function getAdmirals(): AdmiralInfo[] {
  return [
    {
      id: "blackthorn",
      name: "Fleet Admiral Blackthorn",
      rank: "Fleet Admiral",
      model: "claude-opus-4-6",
      provider: "anthropic",
      strengths: [
        "Deep architectural reasoning",
        "Enterprise-grade knowledge",
        "Agentic coding mastery",
        "Legal and compliance awareness",
        "Nuanced edge-case analysis",
      ],
    },
    {
      id: "ironhook",
      name: "Vice Admiral Ironhook",
      rank: "Vice Admiral",
      model: "gpt-5.3-codex",
      provider: "openai",
      strengths: [
        "Speed and efficiency",
        "Mathematical/algorithmic thinking",
        "Terminal automation",
        "Rapid prototyping",
        "Clean code generation",
      ],
    },
    {
      id: "stormcrest",
      name: "Rear Admiral Stormcrest",
      rank: "Rear Admiral",
      model: "gemini-3-pro",
      provider: "google",
      strengths: [
        "Multimodal thinking",
        "Scientific reasoning",
        "Long-horizon planning",
        "Research synthesis",
        "Creative problem-solving",
      ],
    },
  ];
}
