import { describe, it, expect } from 'vitest';
import {
  parseDoubleDiamondPlan,
  convertDoubleDiamondToWorkflow,
} from './omx-ouroboros.js';

// ── parseDoubleDiamondPlan ───────────────────────────────────────────────────

describe('parseDoubleDiamondPlan', () => {
  it('parses structured Diamond phase headers', () => {
    const plan = [
      '## Discover: Research existing auth patterns',
      '1. Audit current session management',
      '2. Review competitor auth flows',
      '',
      '## Define: Lock down architecture',
      '1. Choose JWT vs session cookies',
      '',
      '## Design: Implement auth module',
      '1. Build JWT middleware',
      '2. Add login endpoint',
      '3. Add token refresh logic',
      '',
      '## Deliver: Test and deploy',
      '1. Run full test suite',
    ].join('\n');

    const steps = parseDoubleDiamondPlan(plan);

    // Should extract steps from each phase
    expect(steps.length).toBeGreaterThanOrEqual(4);

    // Should have all four phases
    const phases = new Set(steps.map(s => s.phase));
    expect(phases.has('discover')).toBe(true);
    expect(phases.has('define')).toBe(true);
    expect(phases.has('design')).toBe(true);
    expect(phases.has('deliver')).toBe(true);
  });

  it('handles unstructured numbered lists', () => {
    const plan = [
      '1. First implement the database schema',
      '2. Then build the API endpoints',
      '3. Finally write integration tests',
    ].join('\n');

    const steps = parseDoubleDiamondPlan(plan);

    expect(steps.length).toBe(3);
    // Unstructured defaults to 'design' phase
    expect(steps.every(s => s.phase === 'design')).toBe(true);
  });

  it('handles bullet points', () => {
    const plan = [
      '- Refactor the authentication module to use JWT',
      '- Add rate limiting middleware to all endpoints',
      '- Deploy to staging for verification',
    ].join('\n');

    const steps = parseDoubleDiamondPlan(plan);
    expect(steps.length).toBe(3);
  });

  it('wraps empty/unparseable plan as single design step', () => {
    const plan = 'Just do the thing, make it work well.';
    const steps = parseDoubleDiamondPlan(plan);

    expect(steps.length).toBe(1);
    expect(steps[0].phase).toBe('design');
    expect(steps[0].title).toBe('Execute plan');
  });

  it('assigns dependency chains between phases', () => {
    const plan = [
      '## Discover: Research',
      '1. Investigate existing patterns',
      '',
      '## Define: Architecture',
      '1. Design the module structure',
      '',
      '## Design: Implementation',
      '1. Build the feature',
    ].join('\n');

    const steps = parseDoubleDiamondPlan(plan);

    // Define step should depend on the last Discover step
    const defineStep = steps.find(s => s.phase === 'define');
    expect(defineStep?.dependsOn).toBeDefined();

    // Design step should depend on the last Define step
    const designStep = steps.find(s => s.phase === 'design');
    expect(designStep?.dependsOn).toBeDefined();
  });

  it('parses case-insensitive phase headers', () => {
    const plan = [
      '## DISCOVER: Research phase',
      '1. Do research',
      '',
      '## DESIGN: Build phase',
      '1. Build it',
    ].join('\n');

    const steps = parseDoubleDiamondPlan(plan);
    const phases = new Set(steps.map(s => s.phase));
    expect(phases.has('discover')).toBe(true);
    expect(phases.has('design')).toBe(true);
  });

  it('filters out short items (< 6 chars)', () => {
    const plan = [
      '## Design: Implementation',
      '1. hi',
      '2. Build the complete authentication module with JWT support',
    ].join('\n');

    const steps = parseDoubleDiamondPlan(plan);
    // "hi" should be filtered out (only 2 chars)
    expect(steps.length).toBe(1);
    expect(steps[0].title).toContain('Build');
  });
});

// ── convertDoubleDiamondToWorkflow ───────────────────────────────────────────

describe('convertDoubleDiamondToWorkflow', () => {
  it('produces valid OmX workflow markdown', () => {
    const steps = [
      { phase: 'discover' as const, title: 'Research auth patterns', description: 'Look at existing patterns' },
      { phase: 'design' as const, title: 'Build JWT module', description: 'Implement JWT auth' },
    ];

    const md = convertDoubleDiamondToWorkflow('Add JWT Auth', steps, ['Tests pass', 'No regressions']);

    // Should have OmX header
    expect(md).toContain('# OmX: Add JWT Auth');

    // Should have step headers
    expect(md).toContain('## Step 1:');
    expect(md).toContain('## Step 2:');

    // Should have specialist annotations
    expect(md).toContain('[specialist:research]');
    expect(md).toContain('[specialist:dev');
  });

  it('maps phases to correct specialist types', () => {
    const steps = [
      { phase: 'discover' as const, title: 'Research', description: 'desc' },
      { phase: 'define' as const, title: 'Define', description: 'desc' },
      { phase: 'design' as const, title: 'Build', description: 'desc' },
      { phase: 'deliver' as const, title: 'Test', description: 'desc' },
    ];

    const md = convertDoubleDiamondToWorkflow('Task', steps, []);

    expect(md).toContain('[specialist:research]');
    expect(md).toContain('[specialist:dev, model:sonnet');
    expect(md).toContain('[specialist:gate, gate:full');
  });

  it('appends review + gate + commit when no Deliver phase', () => {
    const steps = [
      { phase: 'design' as const, title: 'Build feature', description: 'Build it' },
    ];

    const md = convertDoubleDiamondToWorkflow('Build Feature', steps, ['Tests pass']);

    // Should have auto-appended review, gate, and commit steps
    expect(md).toContain('Adversarial review');
    expect(md).toContain('[specialist:review');
    expect(md).toContain('Test gate');
    expect(md).toContain('[specialist:gate, gate:full');
    expect(md).toContain('Commit');
    expect(md).toContain('[specialist:commit');
  });

  it('does NOT append review/gate/commit when Deliver phase exists', () => {
    const steps = [
      { phase: 'design' as const, title: 'Build', description: 'Build it' },
      { phase: 'deliver' as const, title: 'Test & deploy', description: 'Run tests' },
    ];

    const md = convertDoubleDiamondToWorkflow('Task', steps, []);

    // Should NOT have auto-appended review
    const reviewCount = (md.match(/Adversarial review/g) || []).length;
    expect(reviewCount).toBe(0);
  });

  it('includes acceptance criteria in review step', () => {
    const steps = [
      { phase: 'design' as const, title: 'Build', description: 'Build it' },
    ];

    const md = convertDoubleDiamondToWorkflow('Task', steps, ['All tests pass', 'Types clean']);

    expect(md).toContain('- [ ] All tests pass');
    expect(md).toContain('- [ ] Types clean');
  });

  it('includes depends annotations', () => {
    const steps = [
      { phase: 'discover' as const, title: 'Research', description: 'desc' },
      { phase: 'design' as const, title: 'Build', description: 'desc', dependsOn: 1 },
    ];

    const md = convertDoubleDiamondToWorkflow('Task', steps, []);

    expect(md).toContain('depends:1');
  });
});
