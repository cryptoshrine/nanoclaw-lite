export interface DailySession {
  time: string;
  isScheduled: boolean;
  duration: string;
  topic: string;
  status: "completed" | "in-progress" | "blocked" | "unknown";
  summary: string;
  pending?: string;
  nextStep?: string;
}

export interface ActiveWorkItem {
  text: string;
  completed: boolean;
}

export interface DailyLog {
  date: string;
  activeWork: ActiveWorkItem[];
  completedYesterday: ActiveWorkItem[];
  sessions: DailySession[];
  raw: string;
}

export interface DailyLogSummary {
  date: string;
  totalSessions: number;
  userSessions: number;
  scheduledSessions: number;
  completedItems: number;
  pendingItems: number;
  topics: string[];
  projects: string[];
}

export interface SearchResult {
  date: string;
  line: string;
  lineNumber: number;
  context: string;
  section: string;
}

export const PROJECT_TAGS: Record<string, string[]> = {
  "Ball-AI": ["ball-ai", "statsbomb", "ball ai", "match analysis", "xg", "visualization", "betting", "value bet", "o2.5", "dixon"],
  "PE/VC": ["pe/vc", "pe-vc", "basecasedd", "base case", "simulation engine", "due diligence", "outreach", "pipeline"],
  "NanoClaw": ["nanoclaw", "centcomm", "telegram", "discord", "cron", "scheduled task", "mcp", "ipc", "agent-runner"],
  "X/Twitter": ["x engagement", "tweet", "x api", "@ball_ai", "@crypto_shrine", "amplifier", "qt draft", "follower"],
  "Content": ["carousel", "video", "youtube", "kai", "newsletter", "gumroad", "info product", "pdf"],
  "Betting": ["betting", "odds", "pinnacle", "dixon-coles", "calibration", "value bet", "accumulator"],
};
