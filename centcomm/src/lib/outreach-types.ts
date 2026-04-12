export type PipelineStage =
  | "identified"
  | "verified"
  | "connection_sent"
  | "connected"
  | "message_sent"
  | "replied"
  | "meeting"
  | "case_study_shared"
  | "proposal"
  | "won"
  | "lost";

export type Segment = "pe" | "corp_ma" | "lp" | "family_office";
export type Priority = "A" | "B" | "C";

export interface Activity {
  date: string; // ISO
  channel: "linkedin" | "email" | "call" | "meeting" | "other";
  action: string; // e.g. "Sent connection request", "Shared case study PDF"
  notes?: string;
}

export interface Lead {
  id: string;
  name: string; // person name
  title: string; // e.g. "Managing Partner"
  firm: string;
  firmAum?: string; // e.g. "$1.2B"
  segment: Segment;
  priority: Priority;
  stage: PipelineStage;
  email?: string;
  linkedinUrl?: string;
  activities: Activity[];
  nextAction?: string;
  nextActionDate?: string;
  notes?: string;
  batch?: string; // e.g. "batch-001"
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  name: string;
  createdAt: string;
  leadIds: string[];
}

export interface PipelineData {
  leads: Lead[];
  batches: Batch[];
  updatedAt: string;
}

// Stage cadences for auto follow-up scheduling
export const STAGE_CADENCES: Record<PipelineStage, { days: number; action: string } | null> = {
  identified: { days: 0, action: "Verify LinkedIn profile and prepare connection request" },
  verified: { days: 0, action: "Send LinkedIn connection request" },
  connection_sent: { days: 3, action: "Follow up on connection request (send again or try email)" },
  connected: { days: 1, action: "Send personalized outreach message" },
  message_sent: { days: 3, action: "Send follow-up message" },
  replied: { days: 2, action: "Schedule discovery call" },
  meeting: { days: 1, action: "Share case study and NDA materials" },
  case_study_shared: { days: 5, action: "Follow up on case study and propose next steps" },
  proposal: { days: 7, action: "Follow up on proposal" },
  won: null,
  lost: null,
};

// Email template types
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string; // Supports variables: {{name}}, {{title}}, {{firm}}, {{firmAum}}
  stage: PipelineStage;
  sequence: number; // 1 = initial, 2 = nudge, 3 = follow-up, 4 = break-up
  createdAt: string;
  updatedAt: string;
}

export interface TemplateData {
  templates: EmailTemplate[];
  updatedAt: string;
}

// Display constants
export const STAGE_ORDER: PipelineStage[] = [
  "identified",
  "verified",
  "connection_sent",
  "connected",
  "message_sent",
  "replied",
  "meeting",
  "case_study_shared",
  "proposal",
  "won",
  "lost",
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  identified: "Identified",
  verified: "Verified",
  connection_sent: "Connection Sent",
  connected: "Connected",
  message_sent: "Message Sent",
  replied: "Replied",
  meeting: "Meeting",
  case_study_shared: "Case Study Shared",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const STAGE_COLORS: Record<PipelineStage, string> = {
  identified: "muted-foreground",
  verified: "cyan",
  connection_sent: "electric",
  connected: "electric",
  message_sent: "amber",
  replied: "amber",
  meeting: "success",
  case_study_shared: "success",
  proposal: "success",
  won: "success",
  lost: "alert",
};

export const SEGMENT_LABELS: Record<Segment, string> = {
  pe: "PE Fund",
  corp_ma: "Corp M&A",
  lp: "LP / Allocator",
  family_office: "Family Office",
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  A: "alert",
  B: "amber",
  C: "muted-foreground",
};
