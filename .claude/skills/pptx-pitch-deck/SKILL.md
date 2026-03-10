---
name: pptx-pitch-deck
description: |
  Generate investor/partner pitch decks for Ball-AI with live metrics and branded styling.

  TRIGGERS - Use when user says:
  - "pitch deck" / "investor deck" / "partner deck"
  - "generate pitch" / "make a pitch deck"
  - "fundraising deck" / "investor presentation"
  - "partner presentation" / "sponsor deck"
  - Any request for a Ball-AI business presentation
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# Ball-AI Pitch Deck Generator

Generate professional investor/partner pitch decks for Ball-AI with live metrics, branded neubrutalism styling, and compelling narrative.

## Prerequisites

- **PPTX Generator:** `BALL-AI-2/.claude/skills/pptx-generator/` (layouts, brand config, cookbook)
- **Ball-AI Brand:** `BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/`
- **Ball-AI Metrics:** Live platform data (tools count, test count, user stats)
- **Output:** `BALL-AI-2/output/ball-ai/`

## Deck Types

### 1. Investor Pitch (15-20 slides)
Full fundraising deck covering problem, solution, traction, market, team, ask.

### 2. Partner Pitch (10-12 slides)
Focused on what Ball-AI can do for a specific partner (creator, publisher, betting company).

### 3. Sponsor Pitch (8-10 slides)
Short deck for potential sponsors showing audience, reach, and integration opportunities.

## Investor Pitch Structure (Default)

| # | Layout | Section | Content |
|---|--------|---------|---------|
| 1 | title-slide | Cover | "Ball-AI — AI-Powered Soccer Intelligence" |
| 2 | giant-focus-slide | Problem | "Football creators spend 4-6 hours on match analysis" |
| 3 | content-slide | The Gap | Why existing tools fail (Wyscout = complex, FBref = raw data, manual = slow) |
| 4 | giant-focus-slide | Solution | "Ask a question. Get professional analysis. 60 seconds." |
| 5 | floating-cards-slide | How It Works | 3 steps: Ask → Analyze → Publish |
| 6 | multi-card-slide | Key Features | 4-5 core capabilities with icons |
| 7 | stats-slide | Platform Stats | Tools: 76+, Tests: 2400+, Data: StatsBomb Licensed |
| 8 | chart-slide | Market Size | TAM/SAM/SOM for football analytics |
| 9 | section-break-slide | Divider | "Traction" |
| 10 | stats-slide | Traction | Key metrics (users, API calls, engagement) |
| 11 | content-slide | Social Proof | Creator testimonials, X engagement, demo reactions |
| 12 | section-break-slide | Divider | "Business Model" |
| 13 | two-column-slide | Revenue Streams | Subscription tiers vs info products |
| 14 | content-slide | Go-to-Market | Distribution strategy (X → YouTube → creators → product) |
| 15 | section-break-slide | Divider | "Why Now" |
| 16 | content-slide | Timing | World Cup 2026 boom, AI adoption curve, StatsBomb moat |
| 17 | stats-slide | The Ask | Funding amount, use of funds, timeline |
| 18 | closing-slide | Contact | "ball-ai.xyz" + contact info |

## Workflow

### Step 1: Determine Deck Type

Parse `$ARGUMENTS` for deck type. Default to investor pitch if unspecified.

If a specific partner/sponsor is named, customize the deck for them.

### Step 2: Gather Live Metrics

Pull current Ball-AI stats:
- **Platform:** Tool count (76+), test count (2400+), skill count (16), viz tools (19)
- **Data:** StatsBomb licensed, EPL + UCL coverage
- **Social:** @Ball_AI_Agent follower count, tweet count, engagement metrics
- **Tech:** API response times, uptime, model stack

Sources:
- `knowledge/projects/ball-ai.md` — platform stats
- `knowledge/resources/ball-ai-tools-complete.md` — tool inventory
- `knowledge/projects/distribution-strategy.md` — GTM strategy
- `knowledge/areas/monetization.md` — revenue model

### Step 3: Read Brand + Layouts

```
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/brand.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/config.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/tone-of-voice.md
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/brand-system.md
Glob: BALL-AI-2/.claude/skills/pptx-generator/cookbook/*.py
```

Read ALL presentation layout frontmatters.

### Step 4: Plan the Deck

Adapt the structure based on deck type and available metrics. Key principles:
- **Lead with the problem** — make them feel the pain
- **Show, don't tell** — use live stats, not claims
- **End with urgency** — World Cup 2026 timing, first-mover advantage

### Step 5: Generate

Follow the pptx-generator Mode 1 (Presentations) workflow:
- Dimensions: 16:9 (13.333" x 7.5")
- Max 5 slides per batch
- Validate after each batch

```bash
uv run --with python-pptx==1.0.2 python << 'SCRIPT'
# Pitch deck generation code
SCRIPT
```

### Step 6: Report

Send a message with:
- File location
- Deck summary and slide count
- Any metrics that need manual updating
- Suggested talking points

## Content Voice

- **Bold and confident** — this is a pitch, own the narrative
- **Numbers are king** — every slide should have at least one metric
- **No hedging** — "We will" not "We hope to"
- **Neubrutalism aesthetic** — sharp, chunky, high contrast
- **Football terminology** — shows domain expertise to investors

## Customization

For partner/sponsor decks:
- Research the partner's audience and needs
- Show specific Ball-AI features that serve THEIR use case
- Include a custom "What We Can Do Together" slide
- Adjust CTA to the specific partnership ask

## Output

- PPTX: `BALL-AI-2/output/ball-ai/ball-ai-{type}-pitch-{date}.pptx`
