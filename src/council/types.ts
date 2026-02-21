// ── Supreme Council Types ────────────────────────────────────────────

export type AdmiralId = 'blackthorn' | 'ironhook' | 'stormcrest';

export interface Admiral {
  id: AdmiralId;
  name: string;
  rank: string;
  model: string;
  provider: 'anthropic' | 'openai' | 'google';
  systemPrompt: string;
  strengths: string[];
}

export type SessionPhase =
  | 'opening'     // Each admiral proposes independently
  | 'critique'    // Each reads others' proposals and challenges
  | 'synthesis'   // Each presents refined plan
  | 'vote'        // Final vote + rationale
  | 'complete';   // Session finished

export interface CouncilMessage {
  admiralId: AdmiralId;
  phase: SessionPhase;
  content: string;
  timestamp: string;
  thinkingTokens?: number;
  completionTokens?: number;
}

export interface CouncilSession {
  id: string;
  topic: string;
  status: 'active' | 'complete' | 'failed';
  phase: SessionPhase;
  messages: CouncilMessage[];
  finalPlan: string | null;
  votes: Record<AdmiralId, { choice: AdmiralId; rationale: string }> | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface PhaseResult {
  admiralId: AdmiralId;
  content: string;
  thinkingTokens?: number;
  completionTokens?: number;
}
