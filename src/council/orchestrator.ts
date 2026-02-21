// ── Council Orchestrator ─────────────────────────────────────────────
// Manages the debate flow: Research → Opening (Blind) → Critique → Synthesis → Vote
// Each phase runs all admirals in parallel, then collects results.
//
// Improvements v2:
//  1. Web search/research — Pre-debate research brief injected into prompts
//  2. Citation integrity — Admirals can only cite sources from research
//  3. Evaluation harness — Post-session validation checks
//  4. Blind Phase 1 — Anonymous proposals in critique phase

import { randomUUID } from 'crypto';
import { ADMIRALS, ADMIRAL_IDS } from './admirals.js';
import { callAdmiral } from './providers.js';
import { conductResearch, formatResearchBrief, type ResearchBundle } from './research.js';
import { validateSession, type ValidationResult } from './validator.js';
import type {
  AdmiralId,
  CouncilMessage,
  CouncilSession,
  PhaseResult,
  SessionPhase,
} from './types.js';

// ── Phase Prompt Builders ───────────────────────────────────────────

function buildOpeningPrompt(topic: string, researchBrief: string): string {
  return `THE COUNCIL HAS BEEN SUMMONED.

TOPIC FOR DELIBERATION:
${topic}
${researchBrief}
PHASE: OPENING PROPOSALS (BLIND)
This is Phase 1 of 4. You must independently propose your approach to this task.
Your proposal will be shared ANONYMOUSLY with the other admirals in the next phase.
Do NOT include your name or rank in the proposal body — it will be labeled generically.

Instructions:
1. If research was provided, use it to ground your proposal in real-world data
2. Analyze the task thoroughly
3. Propose your implementation plan with clear structure
4. Highlight key architectural decisions and trade-offs
5. Identify risks and mitigation strategies
6. Estimate complexity and effort

CITATION RULES (if research was provided):
- Reference sources as [source_N] matching the research briefing numbers
- Do NOT fabricate or hallucinate URLs — only cite what appears in the briefing
- If you need information not in the research, say "further research needed"

Present your proposal now.`;
}

function buildCritiquePrompt(
  topic: string,
  proposals: PhaseResult[],
  currentAdmiral: AdmiralId,
  researchBrief: string,
): string {
  // BLIND Phase 1: Anonymize proposals — use generic labels
  const labels = ['Proposal Alpha', 'Proposal Beta', 'Proposal Gamma'];

  // Shuffle proposals so the admiral can't guess by position
  // (their own proposal could be any of the three)
  const shuffled = [...proposals].sort(() => Math.random() - 0.5);

  const anonymousProposals = shuffled
    .map((p, i) => {
      return `─── ${labels[i]} ───\n${p.content}`;
    })
    .join('\n\n');

  // Find which label corresponds to the current admiral's proposal
  const ownIndex = shuffled.findIndex((p) => p.admiralId === currentAdmiral);
  const ownLabel = ownIndex >= 0 ? labels[ownIndex] : 'unknown';

  return `COUNCIL DELIBERATION CONTINUES.

TOPIC: ${topic}
${researchBrief}
PHASE: CRITIQUE & CHALLENGE (BLIND REVIEW)
This is Phase 2 of 4. You are reviewing ANONYMIZED proposals.
Your own proposal is labeled "${ownLabel}" — but evaluate ALL proposals equally.

THE THREE PROPOSALS:
${anonymousProposals}

Instructions:
1. Identify strengths and weaknesses in EACH proposal (including your own)
2. Challenge assumptions you disagree with — be specific about why
3. Highlight ideas from other proposals that improve upon yours
4. Point out risks or gaps the others may have missed
5. Note areas of consensus and areas of genuine disagreement
6. Verify any cited sources against the research briefing — flag citations that seem fabricated

Be constructive but honest. The best plans emerge from genuine debate, not politeness.
Your critique should demonstrate INDEPENDENT THINKING — do not simply agree with everything.`;
}

function buildSynthesisPrompt(
  topic: string,
  proposals: PhaseResult[],
  critiques: PhaseResult[],
  currentAdmiral: AdmiralId,
  researchBrief: string,
): string {
  // In synthesis phase, reveal identities — the blind phase is over
  const allCritiques = critiques
    .map((c) => {
      const admiral = ADMIRALS[c.admiralId];
      return `─── ${admiral.name}'s Critique ───\n${c.content}`;
    })
    .join('\n\n');

  const allProposals = proposals
    .map((p) => {
      const admiral = ADMIRALS[p.admiralId];
      return `─── ${admiral.name}'s Original Proposal ───\n${p.content}`;
    })
    .join('\n\n');

  return `COUNCIL DELIBERATION — FINAL SYNTHESIS.
Identities are now revealed. You can see who proposed and critiqued what.

TOPIC: ${topic}
${researchBrief}
PHASE: SYNTHESIS
This is Phase 3 of 4. You have seen all proposals and all critiques.

ORIGINAL PROPOSALS (now attributed):
${allProposals}

ALL CRITIQUES:
${allCritiques}

Instructions:
1. Incorporate the strongest ideas from ALL proposals
2. Address the criticisms raised against your approach
3. Present your FINAL refined implementation plan
4. Structure it as a concrete, actionable plan with:
   - Overview and architecture
   - Step-by-step implementation phases
   - Key technical decisions with rationale
   - Testing strategy
   - Risks and mitigations
   - Estimated timeline/effort
5. This is your final plan — make it your best work
6. Only cite sources that appear in the research briefing

The council will vote on the best synthesis in the next phase.`;
}

function buildVotePrompt(
  topic: string,
  syntheses: PhaseResult[],
  currentAdmiral: AdmiralId,
): string {
  const allSyntheses = syntheses
    .map((s) => {
      const admiral = ADMIRALS[s.admiralId];
      return `─── ${admiral.name}'s Final Plan ───\n${s.content}`;
    })
    .join('\n\n');

  return `COUNCIL VOTE.

TOPIC: ${topic}

PHASE: FINAL VOTE
This is Phase 4 of 4. All admirals have presented their final synthesized plans.

FINAL PLANS:
${allSyntheses}

Instructions:
You must vote for the BEST plan. You MAY vote for your own plan if you genuinely believe it is the strongest, but consider all plans fairly.

Respond in EXACTLY this JSON format (no additional text outside the JSON):
{
  "vote": "<admiralId>",
  "rationale": "<2-3 sentences explaining your vote>",
  "amendments": "<any final amendments or additions you'd suggest to the winning plan, or 'none'>"
}

Where <admiralId> is one of: blackthorn, ironhook, stormcrest`;
}

// ── Session Event Callback ──────────────────────────────────────────

export type CouncilEventType =
  | 'session_created'
  | 'research_started'
  | 'research_complete'
  | 'phase_started'
  | 'admiral_response'
  | 'phase_complete'
  | 'vote_result'
  | 'validation_complete'
  | 'session_complete'
  | 'session_error';

export interface CouncilEvent {
  type: CouncilEventType;
  session: CouncilSession;
  data?: {
    phase?: SessionPhase;
    admiralId?: AdmiralId;
    content?: string;
    winner?: AdmiralId;
    votes?: Record<string, { choice: string; rationale: string; amendments?: string }>;
    researchBundles?: ResearchBundle[];
    validation?: ValidationResult;
  };
}

export type CouncilEventCallback = (event: CouncilEvent) => void;

// ── Core Orchestrator ───────────────────────────────────────────────

export async function runCouncilSession(
  topic: string,
  onEvent?: CouncilEventCallback,
): Promise<CouncilSession> {
  const session: CouncilSession = {
    id: randomUUID(),
    topic,
    status: 'active',
    phase: 'opening',
    messages: [],
    finalPlan: null,
    votes: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };

  onEvent?.({ type: 'session_created', session });

  let researchBundles: ResearchBundle[] = [];
  let researchBrief = '';

  try {
    // ── Phase 0: Research ──
    onEvent?.({ type: 'research_started', session });

    try {
      researchBundles = await conductResearch(topic);
      researchBrief = formatResearchBrief(researchBundles);

      if (researchBrief) {
        console.log(
          `Research complete: ${researchBundles.length} queries, ${researchBundles.reduce((a, b) => a + b.results.length, 0)} results`,
        );
      } else {
        console.log('No research results available (no search API keys configured)');
      }
    } catch (err) {
      console.warn('Research phase failed (continuing without):', err);
    }

    onEvent?.({
      type: 'research_complete',
      session,
      data: { researchBundles },
    });

    // ── Phase 1: Opening Proposals (Blind) ──
    session.phase = 'opening';
    onEvent?.({ type: 'phase_started', session, data: { phase: 'opening' } });

    const openingResults = await runPhaseParallel(
      buildOpeningPrompt(topic, researchBrief),
      session,
      onEvent,
    );

    // ── Phase 2: Critique (Blind Review) ──
    session.phase = 'critique';
    onEvent?.({ type: 'phase_started', session, data: { phase: 'critique' } });

    const critiqueResults = await runPhaseWithContext(
      (admiralId) =>
        buildCritiquePrompt(topic, openingResults, admiralId, researchBrief),
      session,
      onEvent,
    );

    // ── Phase 3: Synthesis (Identities Revealed) ──
    session.phase = 'synthesis';
    onEvent?.({ type: 'phase_started', session, data: { phase: 'synthesis' } });

    const synthesisResults = await runPhaseWithContext(
      (admiralId) =>
        buildSynthesisPrompt(
          topic,
          openingResults,
          critiqueResults,
          admiralId,
          researchBrief,
        ),
      session,
      onEvent,
    );

    // ── Phase 4: Vote ──
    session.phase = 'vote';
    onEvent?.({ type: 'phase_started', session, data: { phase: 'vote' } });

    const voteResults = await runPhaseWithContext(
      (admiralId) => buildVotePrompt(topic, synthesisResults, admiralId),
      session,
      onEvent,
    );

    // ── Tally Votes ──
    const votes = tallyVotes(voteResults);
    session.votes = votes.parsed;
    const winner = votes.winner;

    // The winning plan is the synthesis from the voted admiral
    const winningPlan = synthesisResults.find((r) => r.admiralId === winner);
    session.finalPlan = winningPlan?.content || synthesisResults[0].content;

    onEvent?.({
      type: 'vote_result',
      session,
      data: { winner, votes: votes.raw },
    });

    // ── Evaluation Harness ──
    const validation = validateSession(session, researchBundles);

    onEvent?.({
      type: 'validation_complete',
      session,
      data: { validation },
    });

    console.log(
      `Validation: ${validation.passed ? 'PASSED' : 'ISSUES'} (score: ${validation.score}/100)`,
    );
    for (const check of validation.checks.filter((c) => !c.passed)) {
      console.warn(`  ⚠ ${check.name}: ${check.detail}`);
    }

    // ── Complete ──
    session.phase = 'complete';
    session.status = 'complete';
    session.completedAt = new Date().toISOString();

    // Append validation summary to session (stored as metadata)
    (session as CouncilSession & { validation?: ValidationResult }).validation =
      validation;
    (session as CouncilSession & { researchBundles?: ResearchBundle[] }).researchBundles =
      researchBundles;

    onEvent?.({ type: 'session_complete', session });

    return session;
  } catch (err) {
    session.status = 'failed';
    session.error = err instanceof Error ? err.message : String(err);

    onEvent?.({ type: 'session_error', session });

    return session;
  }
}

// ── Phase Runners ───────────────────────────────────────────────────

/** Run all admirals in parallel with the same prompt */
async function runPhaseParallel(
  userPrompt: string,
  session: CouncilSession,
  onEvent?: CouncilEventCallback,
): Promise<PhaseResult[]> {
  const results = await Promise.allSettled(
    ADMIRAL_IDS.map(async (admiralId) => {
      const admiral = ADMIRALS[admiralId];
      const result = await callAdmiral(admiral.provider, admiral.systemPrompt, [
        { role: 'user', content: userPrompt },
      ]);

      const msg: CouncilMessage = {
        admiralId,
        phase: session.phase,
        content: result.content,
        timestamp: new Date().toISOString(),
        thinkingTokens: result.thinkingTokens,
        completionTokens: result.completionTokens,
      };
      session.messages.push(msg);

      onEvent?.({
        type: 'admiral_response',
        session,
        data: { phase: session.phase, admiralId, content: result.content },
      });

      return {
        admiralId,
        content: result.content,
        thinkingTokens: result.thinkingTokens,
        completionTokens: result.completionTokens,
      } as PhaseResult;
    }),
  );

  const phaseResults: PhaseResult[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      phaseResults.push(r.value);
    } else {
      console.error(`Admiral failed in ${session.phase}:`, r.reason);
    }
  }

  onEvent?.({ type: 'phase_complete', session, data: { phase: session.phase } });

  if (phaseResults.length === 0) {
    throw new Error(`All admirals failed in phase: ${session.phase}`);
  }

  return phaseResults;
}

/** Run all admirals in parallel with per-admiral prompts (for context-aware phases) */
async function runPhaseWithContext(
  buildPrompt: (admiralId: AdmiralId) => string,
  session: CouncilSession,
  onEvent?: CouncilEventCallback,
): Promise<PhaseResult[]> {
  const results = await Promise.allSettled(
    ADMIRAL_IDS.map(async (admiralId) => {
      const admiral = ADMIRALS[admiralId];
      const prompt = buildPrompt(admiralId);

      // Build conversation history from all previous messages for this admiral
      const history = session.messages
        .filter((m) => m.admiralId === admiralId)
        .flatMap((m) => [
          { role: 'user' as const, content: `[Phase: ${m.phase}]` },
          { role: 'assistant' as const, content: m.content },
        ]);

      const messages = [...history, { role: 'user' as const, content: prompt }];

      const result = await callAdmiral(admiral.provider, admiral.systemPrompt, messages);

      const msg: CouncilMessage = {
        admiralId,
        phase: session.phase,
        content: result.content,
        timestamp: new Date().toISOString(),
        thinkingTokens: result.thinkingTokens,
        completionTokens: result.completionTokens,
      };
      session.messages.push(msg);

      onEvent?.({
        type: 'admiral_response',
        session,
        data: { phase: session.phase, admiralId, content: result.content },
      });

      return {
        admiralId,
        content: result.content,
        thinkingTokens: result.thinkingTokens,
        completionTokens: result.completionTokens,
      } as PhaseResult;
    }),
  );

  const phaseResults: PhaseResult[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      phaseResults.push(r.value);
    } else {
      console.error(`Admiral failed in ${session.phase}:`, r.reason);
    }
  }

  onEvent?.({ type: 'phase_complete', session, data: { phase: session.phase } });

  if (phaseResults.length === 0) {
    throw new Error(`All admirals failed in phase: ${session.phase}`);
  }

  return phaseResults;
}

// ── Vote Tallying ───────────────────────────────────────────────────

interface VoteTally {
  parsed: Record<AdmiralId, { choice: AdmiralId; rationale: string }>;
  raw: Record<string, { choice: string; rationale: string; amendments?: string }>;
  winner: AdmiralId;
}

function tallyVotes(voteResults: PhaseResult[]): VoteTally {
  const raw: Record<string, { choice: string; rationale: string; amendments?: string }> = {};
  const parsed: Record<string, { choice: AdmiralId; rationale: string }> = {} as Record<
    AdmiralId,
    { choice: AdmiralId; rationale: string }
  >;
  const counts: Record<string, number> = {};

  for (const result of voteResults) {
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`Could not parse vote from ${result.admiralId}`);
        continue;
      }

      const vote = JSON.parse(jsonMatch[0]);
      const choice = vote.vote as AdmiralId;

      if (!ADMIRAL_IDS.includes(choice)) {
        console.warn(`Invalid vote target from ${result.admiralId}: ${choice}`);
        continue;
      }

      raw[result.admiralId] = {
        choice: vote.vote,
        rationale: vote.rationale || '',
        amendments: vote.amendments,
      };

      parsed[result.admiralId as AdmiralId] = {
        choice,
        rationale: vote.rationale || '',
      };

      counts[choice] = (counts[choice] || 0) + 1;
    } catch (err) {
      console.warn(`Failed to parse vote from ${result.admiralId}:`, err);
    }
  }

  let winner: AdmiralId = 'blackthorn';
  let maxVotes = 0;

  for (const [admiralId, count] of Object.entries(counts)) {
    if (count > maxVotes) {
      maxVotes = count;
      winner = admiralId as AdmiralId;
    }
  }

  const topVoted = Object.entries(counts).filter(([, c]) => c === maxVotes);
  if (topVoted.length > 1) {
    const chairVote = parsed['blackthorn']?.choice;
    if (chairVote && topVoted.some(([id]) => id === chairVote)) {
      winner = chairVote;
    }
  }

  return {
    parsed: parsed as Record<AdmiralId, { choice: AdmiralId; rationale: string }>,
    raw,
    winner,
  };
}
