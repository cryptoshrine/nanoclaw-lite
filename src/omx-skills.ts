/**
 * OmX Pattern 6: Skills System
 *
 * Keyword-triggered skill registry for OmX orchestration. Maps natural
 * language commands to structured actions: workflow creation, quality gates,
 * analysis tasks, content generation, and devops operations.
 *
 * Built-in skills are data-driven (arrays of objects, no switch statements).
 * Custom skills load from groups/{folder}/skills/omx-*.md with YAML frontmatter.
 *
 * Integration: The supervisor's tick loop calls matchSkill() on incoming
 * messages BEFORE normal processing. autoRun skills dispatch immediately;
 * non-autoRun skills are suggested to the user.
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Skill category for filtering and organization */
export type OmxSkillCategory =
  | 'workflow'
  | 'planning'
  | 'quality'
  | 'analysis'
  | 'content'
  | 'devops';

/** A single OmX skill definition */
export interface OmxSkill {
  name: string;
  description: string;
  triggers: RegExp[];
  file: string;
  category: OmxSkillCategory;
  requiresProject: boolean;
  autoRun: boolean;
}

/** Context passed to skill dispatch */
export interface SkillContext {
  message: string;
  groupFolder: string;
  chatJid: string;
  projectPath?: string;
  sendMessage: (text: string) => Promise<void>;
}

/** Result of skill dispatch */
export interface SkillResult {
  handled: boolean;
  response?: string;
  workflowId?: string;
}

/** Raw trigger definition used by built-in skill data */
interface RawSkillDef {
  name: string;
  description: string;
  triggers: Array<string | RegExp>;
  file: string;
  category: OmxSkillCategory;
  requiresProject: boolean;
  autoRun: boolean;
}

// ── Built-in Skill Definitions ────────────────────────────────────────────────

/**
 * Core skill definitions. Each trigger is either:
 *   - A string  → converted to a case-insensitive word-boundary regex
 *   - A RegExp  → used as-is
 *
 * Strings get wrapped as /\b<string>\b/i — this prevents "testing" from
 * matching a "test" trigger (word-boundary enforcement).
 */
const BUILTIN_SKILL_DEFS: RawSkillDef[] = [
  // ── Workflow skills ──────────────────────────────────────────────────────
  {
    name: 'omx-workflow',
    description: 'Create and run an OmX autonomous workflow',
    triggers: [/^OmX:/i, /^autonomous:/i, /^do this overnight:/i],
    file: 'skills/omx-workflow.md',
    category: 'workflow',
    requiresProject: true,
    autoRun: true,
  },
  {
    name: 'ralplan',
    description: 'RALPLAN-DR deliberative planning (planner → architect → critic)',
    triggers: [/^ralplan:/i, /^deliberate:/i, /^plan this:/i],
    file: 'skills/omx-ralplan.md',
    category: 'planning',
    requiresProject: true,
    autoRun: true,
  },
  {
    name: 'deep-interview',
    description: 'Socratic pre-planning interview to extract precise requirements',
    triggers: [/^interview:/i, /^clarify:/i],
    file: 'skills/omx-interview.md',
    category: 'planning',
    requiresProject: false,
    autoRun: true,
  },

  // ── Quality skills ───────────────────────────────────────────────────────
  {
    name: 'adversarial-review',
    description: 'Adversarial code review — finds bugs, security issues, design flaws',
    triggers: [/\bcode review\b/i, /\badversarial review\b/i, /\baudit code\b/i],
    file: 'specialists/adversarial-review.md',
    category: 'quality',
    requiresProject: true,
    autoRun: false,
  },
  {
    name: 'deslop-pass',
    description: 'Clean up AI-generated code slop (console.logs, TODOs, dead code)',
    triggers: [/\bdeslop\b/i, /\bclean up code\b/i, /\bremove slop\b/i],
    file: 'skills/omx-deslop.md',
    category: 'quality',
    requiresProject: true,
    autoRun: false,
  },
  {
    name: 'type-gate',
    description: 'Run TypeScript type checker (tsc --noEmit)',
    triggers: [/\btype check\b/i, /\btsc\b/i, /\btype gate\b/i],
    file: 'skills/omx-type-gate.md',
    category: 'quality',
    requiresProject: true,
    autoRun: true,
  },
  {
    name: 'lint-gate',
    description: 'Run linter (ruff for Python, eslint for TS)',
    triggers: [/\blint\b/i, /\bruff\b/i, /\beslint\b/i, /\blint gate\b/i],
    file: 'skills/omx-lint-gate.md',
    category: 'quality',
    requiresProject: true,
    autoRun: true,
  },
  {
    name: 'test-gate',
    description: 'Run test suite (pytest, jest, vitest)',
    triggers: [/\brun tests\b/i, /\bpytest\b/i, /\btest gate\b/i, /\brun the tests\b/i],
    file: 'skills/omx-test-gate.md',
    category: 'quality',
    requiresProject: true,
    autoRun: true,
  },
  {
    name: 'full-gate',
    description: 'Run full validation gate (tests + types + lint)',
    triggers: [/\bfull gate\b/i, /\bfull validation\b/i, /\bvalidate all\b/i],
    file: 'skills/omx-full-gate.md',
    category: 'quality',
    requiresProject: true,
    autoRun: true,
  },

  // ── Analysis skills ──────────────────────────────────────────────────────
  {
    name: 'deep-research',
    description: 'Deep codebase or topic research with structured output',
    triggers: [/\bresearch\b/i, /\binvestigate\b/i, /\bdeep dive\b/i],
    file: 'skills/omx-research.md',
    category: 'analysis',
    requiresProject: false,
    autoRun: false,
  },
  {
    name: 'comparative-analysis',
    description: 'Compare options, benchmark alternatives, evaluate trade-offs',
    triggers: [/\bcompare\b/i, /\bbenchmark\b/i, /\bevaluate options\b/i],
    file: 'skills/omx-compare.md',
    category: 'analysis',
    requiresProject: false,
    autoRun: false,
  },
  {
    name: 'performance-analysis',
    description: 'Profile and analyze performance bottlenecks',
    triggers: [/\bprofile\b/i, /\bperformance analysis\b/i, /\bbottleneck\b/i],
    file: 'skills/omx-performance.md',
    category: 'analysis',
    requiresProject: true,
    autoRun: false,
  },
  {
    name: 'dependency-audit',
    description: 'Audit project dependencies for security, size, and freshness',
    triggers: [/\baudit deps\b/i, /\bdependency audit\b/i, /\baudit dependencies\b/i],
    file: 'skills/omx-dep-audit.md',
    category: 'analysis',
    requiresProject: true,
    autoRun: false,
  },
  {
    name: 'architecture-review',
    description: 'Review project architecture and suggest improvements',
    triggers: [/\barchitecture review\b/i, /\barch review\b/i, /\breview architecture\b/i],
    file: 'skills/omx-arch-review.md',
    category: 'analysis',
    requiresProject: true,
    autoRun: false,
  },

  // ── Content skills ───────────────────────────────────────────────────────
  {
    name: 'tweet-composer',
    description: 'Compose a tweet or thread with data-driven content',
    triggers: [/\btweet\b/i, /\bpost to x\b/i, /\btweet about\b/i],
    file: 'skills/omx-tweet.md',
    category: 'content',
    requiresProject: false,
    autoRun: false,
  },
  {
    name: 'blog-writer',
    description: 'Write a blog post or technical article',
    triggers: [/\bblog post\b/i, /\barticle\b/i, /\bwrite a post\b/i],
    file: 'skills/omx-blog.md',
    category: 'content',
    requiresProject: false,
    autoRun: false,
  },
  {
    name: 'newsletter-writer',
    description: 'Write a newsletter edition',
    triggers: [/\bnewsletter\b/i, /\bwrite newsletter\b/i],
    file: 'skills/omx-newsletter.md',
    category: 'content',
    requiresProject: false,
    autoRun: false,
  },
  {
    name: 'documentation',
    description: 'Generate or update project documentation',
    triggers: [/\bwrite docs\b/i, /\bupdate docs\b/i, /\bdocumentation\b/i],
    file: 'skills/omx-docs.md',
    category: 'content',
    requiresProject: true,
    autoRun: false,
  },

  // ── DevOps skills ────────────────────────────────────────────────────────
  {
    name: 'deployment',
    description: 'Deploy to production or staging',
    triggers: [/\bdeploy\b/i, /\bpush to prod\b/i, /\bship it\b/i],
    file: 'skills/omx-deploy.md',
    category: 'devops',
    requiresProject: true,
    autoRun: false,
  },
  {
    name: 'ci-config',
    description: 'Configure or update CI/CD pipeline',
    triggers: [/\bci config\b/i, /\bpipeline\b/i, /\bgithub actions\b/i, /\bci\/cd\b/i],
    file: 'skills/omx-ci.md',
    category: 'devops',
    requiresProject: true,
    autoRun: false,
  },
  {
    name: 'docker-config',
    description: 'Create or update Docker configuration',
    triggers: [/\bdocker\b/i, /\bcontainer config\b/i, /\bdockerfile\b/i],
    file: 'skills/omx-docker.md',
    category: 'devops',
    requiresProject: true,
    autoRun: false,
  },
  {
    name: 'env-setup',
    description: 'Set up or debug environment configuration',
    triggers: [/\benv setup\b/i, /\benvironment setup\b/i, /\bsetup env\b/i],
    file: 'skills/omx-env.md',
    category: 'devops',
    requiresProject: true,
    autoRun: false,
  },
];

// ── Trigger Compilation ───────────────────────────────────────────────────────

/**
 * Convert a string trigger to a case-insensitive word-boundary regex.
 * RegExp triggers are returned as-is.
 */
function compileTrigger(trigger: string | RegExp): RegExp {
  if (trigger instanceof RegExp) return trigger;
  // Escape regex metacharacters in the string, then wrap with word boundaries
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/**
 * Compile a raw skill definition into a fully typed OmxSkill.
 */
function compileSkillDef(def: RawSkillDef): OmxSkill {
  return {
    name: def.name,
    description: def.description,
    triggers: def.triggers.map(compileTrigger),
    file: def.file,
    category: def.category,
    requiresProject: def.requiresProject,
    autoRun: def.autoRun,
  };
}

// ── Custom Skill Parsing ──────────────────────────────────────────────────────

/**
 * Valid skill categories for frontmatter validation.
 */
const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'workflow', 'planning', 'quality', 'analysis', 'content', 'devops',
]);

/**
 * Parse YAML frontmatter from a skill markdown file.
 *
 * Expected format:
 * ```
 * ---
 * name: my-skill
 * triggers: ["keyword1", "keyword2"]
 * category: workflow
 * requiresProject: true
 * autoRun: false
 * ---
 * # Skill instructions...
 * ```
 */
export function parseSkillFrontmatter(content: string): Partial<OmxSkill> & { description?: string } {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const frontmatter = fmMatch[1];
  const result: Record<string, unknown> = {};

  for (const line of frontmatter.split('\n')) {
    const kvMatch = line.match(/^\s*(\w+)\s*:\s*(.+)$/);
    if (!kvMatch) continue;
    const [, key, rawValue] = kvMatch;
    let value: unknown = rawValue.trim();

    // Parse JSON arrays
    if (typeof value === 'string' && value.startsWith('[')) {
      try {
        value = JSON.parse(value);
      } catch {
        // Keep as string
      }
    }

    // Parse booleans
    if (value === 'true') value = true;
    if (value === 'false') value = false;

    result[key] = value;
  }

  const partial: Partial<OmxSkill> & { description?: string } = {};

  if (typeof result.name === 'string') partial.name = result.name;
  if (typeof result.description === 'string') partial.description = result.description;
  if (typeof result.category === 'string' && VALID_CATEGORIES.has(result.category)) {
    partial.category = result.category as OmxSkillCategory;
  }
  if (typeof result.requiresProject === 'boolean') partial.requiresProject = result.requiresProject;
  if (typeof result.autoRun === 'boolean') partial.autoRun = result.autoRun;

  // Compile trigger strings to RegExps
  if (Array.isArray(result.triggers)) {
    partial.triggers = (result.triggers as string[])
      .filter((t): t is string => typeof t === 'string')
      .map(compileTrigger);
  }

  return partial;
}

// ── Registry Loading ──────────────────────────────────────────────────────────

/** Compiled built-in skills (lazy-initialized) */
let builtinSkills: OmxSkill[] | null = null;

/**
 * Get compiled built-in skills (cached).
 */
function getBuiltinSkills(): OmxSkill[] {
  if (!builtinSkills) {
    builtinSkills = BUILTIN_SKILL_DEFS.map(compileSkillDef);
  }
  return builtinSkills;
}

/**
 * Load custom skills from groups/{folder}/skills/omx-*.md files.
 * Returns only valid, fully-specified skills.
 */
function loadCustomSkills(groupFolder: string): OmxSkill[] {
  const skillsDir = path.join(GROUPS_DIR, groupFolder, 'skills');
  let files: string[];
  try {
    files = fs.readdirSync(skillsDir).filter(f => f.startsWith('omx-') && f.endsWith('.md'));
  } catch {
    return [];
  }

  const skills: OmxSkill[] = [];
  for (const file of files) {
    const filePath = path.join(skillsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseSkillFrontmatter(content);

      if (!parsed.name || !parsed.triggers || parsed.triggers.length === 0) {
        logger.debug({ file }, 'omx-skills: skipping custom skill — missing name or triggers');
        continue;
      }

      const skill: OmxSkill = {
        name: parsed.name,
        description: parsed.description || `Custom skill: ${parsed.name}`,
        triggers: parsed.triggers,
        file: filePath,
        category: parsed.category || 'workflow',
        requiresProject: parsed.requiresProject ?? false,
        autoRun: parsed.autoRun ?? false,
      };

      skills.push(skill);
      logger.debug({ name: skill.name, triggers: skill.triggers.length }, 'omx-skills: loaded custom skill');
    } catch (err) {
      logger.warn({ file, err }, 'omx-skills: failed to parse custom skill');
    }
  }

  return skills;
}

/**
 * Load the full skill registry: built-in skills + custom skills from disk.
 *
 * @param groupFolder - Group folder name (e.g. "main") for loading custom skills
 */
export function loadSkillRegistry(groupFolder: string = 'main'): OmxSkill[] {
  const builtin = getBuiltinSkills();
  const custom = loadCustomSkills(groupFolder);

  // Custom skills override built-ins with the same name
  const builtinNames = new Set(builtin.map(s => s.name));
  const overridden = new Set<string>();
  for (const s of custom) {
    if (builtinNames.has(s.name)) {
      overridden.add(s.name);
    }
  }

  const merged = [
    ...builtin.filter(s => !overridden.has(s.name)),
    ...custom,
  ];

  if (overridden.size > 0) {
    logger.info(
      { overridden: Array.from(overridden) },
      'omx-skills: custom skills overriding built-ins',
    );
  }

  logger.debug(
    { builtin: builtin.length, custom: custom.length, total: merged.length },
    'omx-skills: registry loaded',
  );

  return merged;
}

// ── Skill Matching ────────────────────────────────────────────────────────────

/**
 * Find the first matching skill for a message.
 * Tests all triggers in registry order; returns the first hit.
 *
 * @param message - User message to match against skill triggers
 * @param groupFolder - Group folder for loading custom skills
 */
export function matchSkill(
  message: string,
  groupFolder: string = 'main',
): OmxSkill | null {
  const registry = loadSkillRegistry(groupFolder);
  for (const skill of registry) {
    for (const trigger of skill.triggers) {
      if (trigger.test(message)) {
        return skill;
      }
    }
  }
  return null;
}

/**
 * Find ALL matching skills for a message.
 * Useful for suggesting multiple relevant skills.
 *
 * @param message - User message to match against skill triggers
 * @param groupFolder - Group folder for loading custom skills
 */
export function matchAllSkills(
  message: string,
  groupFolder: string = 'main',
): OmxSkill[] {
  const registry = loadSkillRegistry(groupFolder);
  const matched: OmxSkill[] = [];
  const seen = new Set<string>();

  for (const skill of registry) {
    if (seen.has(skill.name)) continue;
    for (const trigger of skill.triggers) {
      if (trigger.test(message)) {
        matched.push(skill);
        seen.add(skill.name);
        break;
      }
    }
  }

  return matched;
}

// ── Skill Dispatch ────────────────────────────────────────────────────────────

/**
 * Load a skill's instruction content from its markdown file.
 * Returns the full file content, or a fallback message if not found.
 */
function loadSkillContent(skill: OmxSkill, groupFolder: string): string {
  // Try absolute path first (custom skills have absolute paths)
  if (path.isAbsolute(skill.file)) {
    try {
      return fs.readFileSync(skill.file, 'utf-8');
    } catch {
      // Fall through
    }
  }

  // Try relative to group folder
  const groupPath = path.join(GROUPS_DIR, groupFolder, skill.file);
  try {
    return fs.readFileSync(groupPath, 'utf-8');
  } catch {
    return `Skill "${skill.name}": ${skill.description}\n\nNo instruction file found at ${skill.file}.`;
  }
}

/**
 * Dispatch a matched skill. Reads the skill's instruction file and
 * routes to the appropriate handler based on category.
 *
 * For workflow/planning skills: would create an OmX workflow or RALPLAN session.
 * For quality skills: would run the appropriate gate/check.
 * For content skills: would generate a draft and send for review.
 *
 * NOTE: Full dispatch integration with the supervisor is documented but
 * not wired in yet. This function provides the dispatch scaffold and
 * returns a SkillResult indicating what should happen next.
 */
export async function dispatchSkill(
  skill: OmxSkill,
  context: SkillContext,
): Promise<SkillResult> {
  logger.info(
    { skill: skill.name, category: skill.category, message: context.message.slice(0, 80) },
    'omx-skills: dispatching skill',
  );

  // Check project requirement
  if (skill.requiresProject && !context.projectPath) {
    await context.sendMessage(
      `Skill "${skill.name}" requires a project path but none is set.`,
    );
    return { handled: false, response: 'Missing project path' };
  }

  const content = loadSkillContent(skill, context.groupFolder);

  // Route by category
  switch (skill.category) {
    case 'workflow':
      return dispatchWorkflowSkill(skill, context, content);
    case 'planning':
      return dispatchPlanningSkill(skill, context, content);
    case 'quality':
      return dispatchQualitySkill(skill, context, content);
    case 'analysis':
      return dispatchAnalysisSkill(skill, context, content);
    case 'content':
      return dispatchContentSkill(skill, context, content);
    case 'devops':
      return dispatchDevopsSkill(skill, context, content);
    default:
      return { handled: false, response: `Unknown skill category: ${skill.category}` };
  }
}

/**
 * Workflow skill dispatch — creates an OmX workflow.
 *
 * Integration point: calls createOmxWorkflow() from omx-supervisor.ts
 * after generating workflow markdown from the user's message.
 */
async function dispatchWorkflowSkill(
  skill: OmxSkill,
  context: SkillContext,
  _content: string,
): Promise<SkillResult> {
  // Extract task description by stripping the trigger prefix
  const task = context.message
    .replace(/^(?:OmX|autonomous|do this overnight)\s*:\s*/i, '')
    .trim();

  await context.sendMessage(
    `Skill "${skill.name}" matched. Task: "${task.slice(0, 100)}"\n` +
    `This will create an OmX workflow. Supervisor integration pending.`,
  );

  // TODO: Wire into createOmxWorkflow() when supervisor integration is ready
  // const workflow = createOmxWorkflow({ workflowContent, taskDescription, ... });

  return {
    handled: true,
    response: `Workflow skill "${skill.name}" triggered for: ${task.slice(0, 100)}`,
  };
}

/**
 * Planning skill dispatch — starts RALPLAN or Deep-Interview.
 */
async function dispatchPlanningSkill(
  skill: OmxSkill,
  context: SkillContext,
  _content: string,
): Promise<SkillResult> {
  const task = context.message
    .replace(/^(?:ralplan|deliberate|plan this|interview|clarify)\s*:\s*/i, '')
    .trim();

  await context.sendMessage(
    `Skill "${skill.name}" matched. Starting ${skill.name === 'ralplan' ? 'deliberative planning' : 'Socratic interview'} for: "${task.slice(0, 100)}"`,
  );

  // TODO: Wire into runRalplan() or runInterview() from their respective modules

  return {
    handled: true,
    response: `Planning skill "${skill.name}" triggered for: ${task.slice(0, 100)}`,
  };
}

/**
 * Quality skill dispatch — runs gate checks or code review.
 */
async function dispatchQualitySkill(
  skill: OmxSkill,
  context: SkillContext,
  _content: string,
): Promise<SkillResult> {
  await context.sendMessage(
    `Running quality check: ${skill.description}`,
  );

  // TODO: Wire into direct shell execution for gate skills,
  // or spawn an adversarial-review specialist for code review

  return {
    handled: true,
    response: `Quality skill "${skill.name}" triggered`,
  };
}

/**
 * Analysis skill dispatch — spawns a research specialist.
 */
async function dispatchAnalysisSkill(
  skill: OmxSkill,
  context: SkillContext,
  _content: string,
): Promise<SkillResult> {
  await context.sendMessage(
    `Starting analysis: ${skill.description}`,
  );

  // TODO: Spawn a research specialist with the skill content as context

  return {
    handled: true,
    response: `Analysis skill "${skill.name}" triggered`,
  };
}

/**
 * Content skill dispatch — generates draft content for review.
 */
async function dispatchContentSkill(
  skill: OmxSkill,
  context: SkillContext,
  _content: string,
): Promise<SkillResult> {
  await context.sendMessage(
    `Generating content draft: ${skill.description}\nDraft will be sent for your review before publishing.`,
  );

  // TODO: Spawn a copywriter specialist, send output for review

  return {
    handled: true,
    response: `Content skill "${skill.name}" triggered`,
  };
}

/**
 * DevOps skill dispatch — runs deployment or configuration tasks.
 */
async function dispatchDevopsSkill(
  skill: OmxSkill,
  context: SkillContext,
  _content: string,
): Promise<SkillResult> {
  await context.sendMessage(
    `DevOps task: ${skill.description}\nRequires confirmation before external actions.`,
  );

  // TODO: Wire into deployment scripts or CI config generation

  return {
    handled: true,
    response: `DevOps skill "${skill.name}" triggered`,
  };
}

// ── Utility Exports ───────────────────────────────────────────────────────────

/**
 * List all available skills, optionally filtered by category.
 */
export function listSkills(
  groupFolder: string = 'main',
  category?: OmxSkillCategory,
): OmxSkill[] {
  const registry = loadSkillRegistry(groupFolder);
  if (!category) return registry;
  return registry.filter(s => s.category === category);
}

/**
 * Format the skill registry as a human-readable summary.
 * Grouped by category with trigger patterns listed.
 */
export function formatSkillSummary(groupFolder: string = 'main'): string {
  const registry = loadSkillRegistry(groupFolder);

  const byCategory = new Map<OmxSkillCategory, OmxSkill[]>();
  for (const skill of registry) {
    const list = byCategory.get(skill.category) || [];
    list.push(skill);
    byCategory.set(skill.category, list);
  }

  const lines: string[] = ['*OmX Skills Registry*', ''];

  const categoryOrder: OmxSkillCategory[] = [
    'workflow', 'planning', 'quality', 'analysis', 'content', 'devops',
  ];

  for (const cat of categoryOrder) {
    const skills = byCategory.get(cat);
    if (!skills || skills.length === 0) continue;

    lines.push(`*${cat.charAt(0).toUpperCase() + cat.slice(1)}*`);
    for (const s of skills) {
      const auto = s.autoRun ? ' [auto]' : '';
      const proj = s.requiresProject ? ' [project]' : '';
      lines.push(`  ${s.name}${auto}${proj} — ${s.description}`);
    }
    lines.push('');
  }

  lines.push(`Total: ${registry.length} skills`);
  return lines.join('\n');
}
