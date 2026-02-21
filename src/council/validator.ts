// ── Council Session Validator (Evaluation Harness) ──────────────────
// Post-session quality checks for schema compliance, citation integrity,
// dissent presence, and overall deliberation quality.

import type { CouncilSession, AdmiralId } from './types.js';
import { ADMIRAL_IDS } from './admirals.js';
import { extractCitations, getValidSourceUrls, type ResearchBundle } from './research.js';

export interface ValidationResult {
  passed: boolean;
  score: number; // 0-100
  checks: ValidationCheck[];
  summary: string;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  detail: string;
}

export function validateSession(
  session: CouncilSession,
  researchBundles?: ResearchBundle[],
): ValidationResult {
  const checks: ValidationCheck[] = [];

  // ── 1. Schema Compliance ──────────────────────────────────────────
  // All phases should have responses from at least 2 admirals

  const phases = ['opening', 'critique', 'synthesis', 'vote'] as const;
  for (const phase of phases) {
    const phaseMessages = session.messages.filter((m) => m.phase === phase);
    const respondents = new Set(phaseMessages.map((m) => m.admiralId));

    checks.push({
      name: `phase_${phase}_participation`,
      passed: respondents.size >= 2,
      severity: respondents.size === 0 ? 'critical' : respondents.size < 3 ? 'warning' : 'info',
      detail:
        respondents.size === 3
          ? `All 3 admirals participated in ${phase}`
          : respondents.size === 2
          ? `Only 2 of 3 admirals participated in ${phase} (${[...respondents].join(', ')})`
          : respondents.size === 1
          ? `Only 1 admiral participated in ${phase} — debate quality severely compromised`
          : `No admiral responses in ${phase} — phase failed`,
    });
  }

  // ── 2. Vote Schema Compliance ─────────────────────────────────────
  // Votes should be valid JSON with required fields

  const voteMessages = session.messages.filter((m) => m.phase === 'vote');
  for (const vm of voteMessages) {
    const jsonMatch = vm.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      checks.push({
        name: `vote_schema_${vm.admiralId}`,
        passed: false,
        severity: 'warning',
        detail: `${vm.admiralId}'s vote response is not valid JSON`,
      });
      continue;
    }

    try {
      const vote = JSON.parse(jsonMatch[0]);
      const hasRequiredFields =
        typeof vote.vote === 'string' &&
        typeof vote.rationale === 'string' &&
        ADMIRAL_IDS.includes(vote.vote as AdmiralId);

      checks.push({
        name: `vote_schema_${vm.admiralId}`,
        passed: hasRequiredFields,
        severity: hasRequiredFields ? 'info' : 'warning',
        detail: hasRequiredFields
          ? `${vm.admiralId}'s vote is properly formatted`
          : `${vm.admiralId}'s vote is missing required fields or has invalid target`,
      });
    } catch {
      checks.push({
        name: `vote_schema_${vm.admiralId}`,
        passed: false,
        severity: 'warning',
        detail: `${vm.admiralId}'s vote JSON is malformed`,
      });
    }
  }

  // ── 3. Dissent Presence ───────────────────────────────────────────
  // Good debate should have genuine disagreement, not just echo-chamber

  const critiqueMessages = session.messages.filter((m) => m.phase === 'critique');
  const dissentIndicators = [
    'disagree',
    'however',
    'concern',
    'risk',
    'challenge',
    'weakness',
    'flaw',
    'but ',
    'problem with',
    'overlook',
    'miss',
    'underestimate',
    'overestimate',
    'too complex',
    'too simple',
    'scope creep',
    'impractical',
  ];

  let totalDissentSignals = 0;
  for (const cm of critiqueMessages) {
    const lowerContent = cm.content.toLowerCase();
    const dissentCount = dissentIndicators.filter((d) =>
      lowerContent.includes(d),
    ).length;
    totalDissentSignals += dissentCount;
  }

  const avgDissent = critiqueMessages.length > 0
    ? totalDissentSignals / critiqueMessages.length
    : 0;

  checks.push({
    name: 'dissent_presence',
    passed: avgDissent >= 2,
    severity: avgDissent < 1 ? 'warning' : 'info',
    detail:
      avgDissent >= 4
        ? `Strong dissent detected (avg ${avgDissent.toFixed(1)} signals/critique) — healthy debate`
        : avgDissent >= 2
        ? `Moderate dissent detected (avg ${avgDissent.toFixed(1)} signals/critique) — acceptable debate`
        : avgDissent >= 1
        ? `Low dissent (avg ${avgDissent.toFixed(1)} signals/critique) — may indicate echo chamber`
        : `Very low dissent — admirals may be too agreeable, debate quality questionable`,
  });

  // Check if all votes went to the same person (unanimous might indicate anchoring)
  if (session.votes) {
    const voteTargets = Object.values(session.votes).map((v) => v.choice);
    const uniqueTargets = new Set(voteTargets);

    checks.push({
      name: 'vote_diversity',
      passed: true, // Not a failure, just informational
      severity: 'info',
      detail:
        uniqueTargets.size === 1
          ? `Unanimous vote — all admirals agreed on ${[...uniqueTargets][0]}. Strong consensus or possible anchoring bias.`
          : uniqueTargets.size === 2
          ? `Split vote — ${uniqueTargets.size} different choices. Healthy disagreement.`
          : `Three-way split — each admiral voted differently. Maximum disagreement.`,
    });
  }

  // ── 4. Citation Integrity ─────────────────────────────────────────
  // If research was provided, check that cited URLs actually came from research

  if (researchBundles && researchBundles.length > 0) {
    const validUrls = getValidSourceUrls(researchBundles);

    for (const msg of session.messages) {
      const citations = extractCitations(msg.content);

      if (citations.length > 0) {
        const invalidCitations = citations.filter((url) => {
          // Check if URL or its domain is in valid sources
          try {
            const domain = new URL(url).hostname;
            return !validUrls.has(url) && !validUrls.has(domain);
          } catch {
            return true; // Malformed URL
          }
        });

        if (invalidCitations.length > 0) {
          checks.push({
            name: `citation_integrity_${msg.admiralId}_${msg.phase}`,
            passed: false,
            severity: 'warning',
            detail: `${msg.admiralId} cited ${invalidCitations.length} URL(s) not from research: ${invalidCitations.slice(0, 3).join(', ')}`,
          });
        }
      }
    }

    // Overall citation check
    const allMessages = session.messages;
    const totalCitations = allMessages.reduce(
      (acc, m) => acc + extractCitations(m.content).length,
      0,
    );

    checks.push({
      name: 'citation_usage',
      passed: true,
      severity: 'info',
      detail:
        totalCitations > 0
          ? `${totalCitations} total citations found across all messages`
          : `No citations used — admirals did not reference research sources`,
    });
  }

  // ── 5. Response Quality ───────────────────────────────────────────
  // Check for minimum response length (very short = likely error)

  for (const msg of session.messages) {
    if (msg.content.length < 100 && msg.phase !== 'vote') {
      checks.push({
        name: `response_length_${msg.admiralId}_${msg.phase}`,
        passed: false,
        severity: 'warning',
        detail: `${msg.admiralId}'s ${msg.phase} response is suspiciously short (${msg.content.length} chars)`,
      });
    }
  }

  // ── 6. Final Plan Exists ──────────────────────────────────────────

  checks.push({
    name: 'final_plan_exists',
    passed: session.finalPlan !== null && session.finalPlan.length > 200,
    severity: session.finalPlan ? 'info' : 'critical',
    detail: session.finalPlan
      ? `Final plan exists (${session.finalPlan.length} chars)`
      : `No final plan produced — session failed to synthesize`,
  });

  // ── Compute Score ─────────────────────────────────────────────────

  const criticalFails = checks.filter((c) => !c.passed && c.severity === 'critical').length;
  const warningFails = checks.filter((c) => !c.passed && c.severity === 'warning').length;
  const totalChecks = checks.length;
  const passedChecks = checks.filter((c) => c.passed).length;

  let score = Math.round((passedChecks / totalChecks) * 100);
  score = Math.max(0, score - criticalFails * 20 - warningFails * 5);

  const passed = criticalFails === 0 && score >= 50;

  const summary =
    passed
      ? `Session passed validation (score: ${score}/100). ${criticalFails} critical, ${warningFails} warnings.`
      : `Session has quality issues (score: ${score}/100). ${criticalFails} critical failures, ${warningFails} warnings.`;

  return { passed, score, checks, summary };
}
