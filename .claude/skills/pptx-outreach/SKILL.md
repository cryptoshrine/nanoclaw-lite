---
name: pptx-outreach
description: |
  Generate personalized creator outreach decks showing what Ball-AI can do for specific football content creators.

  TRIGGERS - Use when user says:
  - "outreach deck" / "creator deck" / "outreach slides"
  - "outreach for [creator name]" / "deck for [creator]"
  - "personalized pitch for [creator]"
  - "creator outreach assets" / "outreach presentation"
  - Any request for personalized Ball-AI outreach material for a specific creator
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# Creator Outreach Deck Generator

Generate personalized outreach decks for football content creators showing what Ball-AI can specifically do for THEIR content. Each deck is tailored to the creator's niche, audience, and content style.

## Prerequisites

- **PPTX Generator:** `BALL-AI-2/.claude/skills/pptx-generator/` (layouts, brand config, cookbook)
- **Ball-AI Brand:** `BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/`
- **Creator Targets:** `knowledge/areas/x-twitter.md` (95 creator targets)
- **YouTube Targets:** `.claude/skills/youtube-scripts/references/top-15-targets.md`
- **Output:** `BALL-AI-2/output/ball-ai/outreach/`

## Deck Structure (8-10 slides)

Short, punchy, personalized. Respect their time — no fluff.

| # | Layout | Section | Content |
|---|--------|---------|---------|
| 1 | title-slide | Cover | "Ball-AI x {Creator Name}" + their handle |
| 2 | content-slide | I See You | 2-3 bullet reference to THEIR recent content (shows you've done homework) |
| 3 | giant-focus-slide | The Problem | Pain point specific to THEIR content type |
| 4 | stats-slide | What If | Show how Ball-AI solves it (with example stats from THEIR niche) |
| 5 | floating-cards-slide | 3 Things Ball-AI Does | 3 features most relevant to THEIR workflow |
| 6 | two-column-slide | Before vs After | Their current workflow vs with Ball-AI |
| 7 | quote-slide | Example Output | An actual Ball-AI analysis of a match THEY recently covered |
| 8 | stats-slide | The Numbers | Ball-AI platform stats (76+ tools, StatsBomb data, 60-second analysis) |
| 9 | closing-slide | Next Step | "Try it free → ball-ai.xyz" + personal note |

## Workflow

### Step 1: Identify the Creator

Parse `$ARGUMENTS` for:
- Creator name or handle
- Platform (X/Twitter, YouTube, blog)
- If none specified, show the top 5 priority targets from the lead list

### Step 2: Research the Creator

Gather intel on the specific creator:

1. **From local files:**
   - `knowledge/areas/x-twitter.md` — check if they're in the 95 creator targets
   - `.claude/skills/youtube-scripts/references/top-15-targets.md` — YouTube target info
   - `.claude/skills/youtube-scripts/references/icp-profile.md` — ICP matching

2. **From the web (if needed):**
   - Search X/Twitter for their recent posts
   - Check their YouTube channel for recent videos
   - Identify their niche: tactical analysis, stats, match recaps, player focus, etc.

3. **Build a creator profile:**
   - **Niche:** What type of football content do they make?
   - **Audience size:** Follower/subscriber count
   - **Content frequency:** How often do they post?
   - **Pain points:** What takes them the most time?
   - **Recent content:** 2-3 specific recent posts/videos to reference
   - **Teams/leagues:** What do they cover?

### Step 3: Generate a Personalized Ball-AI Example

Using Ball-AI, generate an actual analysis related to a match or topic the creator recently covered. This is the "wow" slide — showing them exactly what they'd get.

Example: If they recently covered Arsenal vs City, run:
- "Analyze Arsenal vs Man City — xG breakdown, key players, tactical shape"
- Use the output as content for the "Example Output" slide

### Step 4: Read Brand + Layouts

```
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/brand.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/tone-of-voice.md
Glob: BALL-AI-2/.claude/skills/pptx-generator/cookbook/*.py
```

Read ALL presentation layout frontmatters.

### Step 5: Plan the Deck

Customize the standard structure for this creator:
- Swap generic pain points for THEIR specific struggles
- Use examples from THEIR content
- Highlight features that match THEIR workflow
- Reference THEIR audience size and growth potential

### Step 6: Generate

Follow the pptx-generator Mode 1 (Presentations) workflow:
- Dimensions: 16:9 (13.333" x 7.5")
- Max 5 slides per batch (deck is only 8-10 slides, so 2 batches)

```bash
uv run --with python-pptx==1.0.2 python << 'SCRIPT'
# Personalized outreach deck generation code
SCRIPT
```

### Step 7: Report

Send a message with:
- File location
- Creator name and handle
- Suggested DM/email text to send with the deck
- Key personalization points used

## Batch Generation

To generate decks for multiple creators at once:

```
/pptx-outreach batch [creator1, creator2, creator3]
```

This will:
1. Research each creator in parallel
2. Generate personalized decks for each
3. Save to `BALL-AI-2/output/ball-ai/outreach/{creator-handle}/`
4. Report on all completed decks

## Content Voice

- **Personal and warm** — this is a 1-on-1 pitch, not a broadcast
- **Show respect for their work** — reference specific content they've made
- **Focus on THEIR benefit** — not "Ball-AI is great" but "this saves YOU 4 hours"
- **Confident but not pushy** — "Try it free" not "Buy now"
- **Football native** — use terminology they'd use

## Personalization Checklist

- [ ] Referenced at least 2 specific pieces of their recent content
- [ ] Pain point matches their content type (tactical → speed, stats → data access, etc.)
- [ ] Ball-AI example uses a match/topic they recently covered
- [ ] Features highlighted match their specific workflow
- [ ] CTA is appropriate for their platform (DM link vs email vs signup)
- [ ] Their name/handle appears on the cover slide

## Output

- PPTX: `BALL-AI-2/output/ball-ai/outreach/{creator-handle}-deck-{date}.pptx`
