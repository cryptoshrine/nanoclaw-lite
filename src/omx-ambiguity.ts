/**
 * OmX Pattern 2: Ambiguity Scoring
 *
 * Lightweight heuristic (regex/keyword-based, zero LLM cost) that scores each
 * OmX step for clarity before a specialist is spawned.
 *
 * Dimensions (0.2 each, max 1.0):
 *   1. Specifies files to modify
 *   2. Has acceptance criteria
 *   3. References specific functions/classes
 *   4. Has measurable output
 *   5. Scope is bounded (not vague verbs without specifics)
 */

// ── Scoring Helpers ──────────────────────────────────────────────────────────

/** Check for file paths like src/, .ts, .py, .md, or path-like tokens */
const FILE_PATH_RE = /(?:src\/|app\/|lib\/|test[s]?\/|\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|rs|go|css|html|sql|sh|mjs))\b/i;

/** Acceptance-criteria language */
const ACCEPTANCE_RE = /\b(?:ACCEPTANCE|acceptance criteria|must\s|should\s|passing|clean|green|success|correct|valid|no\serror)/i;

/** Identifiers: camelCase, PascalCase, snake_case function/class names, or backtick-quoted names */
const IDENTIFIER_RE = /(?:`[A-Za-z_]\w+`|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*\b|\b[a-z]+_[a-z_]+\b)/;

/** Measurable output markers */
const MEASURABLE_RE = /\b(?:PASS|FAIL|OUTPUT|test[s]?\s|result[s]?\s|\d+\s*(?:test|file|line|error|warning|step))/i;

/** Vague unbounded verbs (penalise when NO specifics accompany them) */
const VAGUE_VERB_RE = /\b(?:improve|refactor|clean\s?up|optimiz|enhance|polish|tidy|reorganiz)/i;
/** Specifics that neutralise a vague verb */
const SPECIFICS_RE = /(?:`[^`]+`|src\/|\.(?:ts|py|js|rs)\b|\bfunction\b|\bclass\b|\bmodule\b|\bfile\b)/i;

// ── Public API ───────────────────────────────────────────────────────────────

export interface ClarityScore {
  total: number;
  dimensions: {
    fileSpecificity: number;
    acceptanceCriteria: number;
    identifierReferences: number;
    measurableOutput: number;
    scopeBounded: number;
  };
}

/**
 * Score a step's content for clarity on a 0-1 scale.
 * Each of the 5 dimensions contributes 0.2.
 */
export function scoreStepClarity(stepContent: string): number {
  const d = scoreDimensions(stepContent);
  return d.total;
}

/**
 * Return the full breakdown (useful for debugging / logging).
 */
export function scoreDimensions(stepContent: string): ClarityScore {
  const fileSpecificity = FILE_PATH_RE.test(stepContent) ? 0.2 : 0;
  const acceptanceCriteria = ACCEPTANCE_RE.test(stepContent) ? 0.2 : 0;
  const identifierReferences = IDENTIFIER_RE.test(stepContent) ? 0.2 : 0;
  const measurableOutput = MEASURABLE_RE.test(stepContent) ? 0.2 : 0;

  // Scope bounded: start at 0.2, lose it if vague verbs without specifics
  let scopeBounded = 0.2;
  if (VAGUE_VERB_RE.test(stepContent) && !SPECIFICS_RE.test(stepContent)) {
    scopeBounded = 0;
  }

  const total = fileSpecificity + acceptanceCriteria + identifierReferences + measurableOutput + scopeBounded;

  return {
    total: Math.round(total * 100) / 100, // avoid floating-point drift
    dimensions: {
      fileSpecificity,
      acceptanceCriteria,
      identifierReferences,
      measurableOutput,
      scopeBounded,
    },
  };
}

/**
 * Returns true when a step is too vague to proceed (score < 0.4).
 */
export function isStepTooVague(score: number): boolean {
  return score < 0.4;
}

/**
 * Returns true when a step needs enhancement (0.4 <= score < 0.7).
 */
export function isStepNeedsEnhancement(score: number): boolean {
  return score >= 0.4 && score < 0.7;
}

/**
 * For borderline steps (0.4-0.7 clarity), prepend contextual information from
 * the snapshot to make the step content clearer for the specialist.
 */
export function enhanceVagueStep(stepContent: string, snapshotContent: string): string {
  // Take up to 2KB of snapshot for context injection
  const contextSlice = snapshotContent.length > 2048
    ? snapshotContent.slice(-2048)
    : snapshotContent;

  return [
    '--- ENHANCED CONTEXT (auto-injected by OmX ambiguity scorer) ---',
    contextSlice,
    '--- END ENHANCED CONTEXT ---',
    '',
    stepContent,
  ].join('\n');
}
