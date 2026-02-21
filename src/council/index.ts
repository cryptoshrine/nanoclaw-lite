// ── Supreme Governing Council — Public API ──────────────────────────

export { ADMIRALS, ADMIRAL_IDS } from './admirals.js';
export { callAdmiral } from './providers.js';
export { runCouncilSession } from './orchestrator.js';
export { CouncilStore } from './store.js';
export { conductResearch, formatResearchBrief, extractCitations, getValidSourceUrls } from './research.js';
export { validateSession } from './validator.js';
export type {
  AdmiralId,
  Admiral,
  SessionPhase,
  CouncilMessage,
  CouncilSession,
  PhaseResult,
} from './types.js';
export type { CouncilEvent, CouncilEventCallback, CouncilEventType } from './orchestrator.js';
export type { ValidationResult, ValidationCheck } from './validator.js';
