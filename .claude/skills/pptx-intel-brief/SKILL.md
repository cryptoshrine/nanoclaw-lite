---
name: pptx-intel-brief
description: |
  Generate the weekly PL Intelligence Brief as a branded PDF document using Ball-AI data and the pptx-generator.

  TRIGGERS - Use when user says:
  - "intel brief" / "intelligence brief" / "PL brief"
  - "weekly report" / "weekly PDF" / "generate the brief"
  - "PL Intelligence Brief" / "premier league brief"
  - "generate report for GW[number]"
  - Any request for a weekly Premier League analysis document
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# PL Intelligence Brief — PDF Generator

Generate the weekly Premier League Intelligence Brief as a branded Ball-AI PDF document. This is a premium info product (target: £9.99/mo) that delivers data-driven EPL analysis.

## Prerequisites

- **PPTX Generator:** `BALL-AI-2/.claude/skills/pptx-generator/` (layouts, brand config, cookbook)
- **Ball-AI Brand:** `BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/` (colors, fonts, voice)
- **Ball-AI API:** For live data (StatsBomb via Ball-AI tools on app.ball-ai.xyz)
- **Output:** `BALL-AI-2/output/ball-ai/`

## Brief Structure (20-25 pages)

The Intelligence Brief follows a fixed structure each gameweek:

| # | Layout | Section | Content |
|---|--------|---------|---------|
| 1 | doc-cover-slide | Cover | "PL Intelligence Brief — GW{N}" + date range |
| 2 | doc-intro-slide | Executive Summary | 3-4 sentence overview of the gameweek's key narrative |
| 3 | doc-section-break-slide | Part 1 | "Results & Standings" |
| 4 | doc-table-slide | Results Grid | All GW results with scores |
| 5 | doc-table-slide | Table Movement | Current standings + GW position changes |
| 6 | doc-section-break-slide | Part 2 | "Match Analysis" |
| 7-12 | doc-bullet-slide | Top 3 Matches | 2 pages per match: narrative + key stats |
| 13 | doc-section-break-slide | Part 3 | "Statistical Leaders" |
| 14 | doc-table-slide | xG Table | League xG table (xG, xGA, xGD) |
| 15 | doc-table-slide | Player Leaders | Top scorers, assisters, progressive passers |
| 16 | doc-definition-slide | Key Metric Spotlight | Deep dive on one metric (rotating weekly) |
| 17 | doc-section-break-slide | Part 4 | "Tactical Trends" |
| 18 | doc-bullet-slide | Formation Watch | Notable formation changes and their impact |
| 19 | doc-bullet-slide | Pressing Analysis | PPDA leaders and trends |
| 20 | doc-section-break-slide | Part 5 | "Value Bets & Predictions" |
| 21 | doc-table-slide | Value Bets | Top value bets for next GW (from betting pipeline) |
| 22 | doc-checklist-slide | Prediction Tracker | Previous GW predictions vs actuals |
| 23 | doc-cta-slide | CTA | "Get Ball-AI" + link |

## Workflow

### Step 1: Determine Gameweek

Check `$ARGUMENTS` for a specific GW number. If none provided, determine the most recent completed gameweek.

### Step 2: Gather Data

Source data from Ball-AI and local files:

1. **Results & Standings**
   - Use Ball-AI app (app.ball-ai.xyz) or local StatsBomb data
   - Query: "Show me all Premier League results for GW{N} 2025/26"
   - Query: "Show me the current Premier League table"

2. **Match Analysis (Top 3 matches)**
   - Pick the 3 most interesting matches (highest xG delta, biggest upsets, title race relevant)
   - Query per match: "Analyze {home} vs {away} GW{N} — give me xG, shots, possession, key players"

3. **Statistical Leaders**
   - Query: "Premier League xG table 2025/26 season"
   - Query: "Top 10 Premier League scorers, assisters, and progressive passers 2025/26"

4. **Tactical Trends**
   - Query: "Which teams changed formation in GW{N}?"
   - Query: "PPDA leaders in the Premier League this season"

5. **Value Bets**
   - Read from: `knowledge/areas/betting.md` or latest betting analysis output
   - Read from: daily betting reports if available

### Step 3: Read Brand + Layouts

```
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/brand.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/config.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/tone-of-voice.md
Glob: BALL-AI-2/.claude/skills/pptx-generator/cookbook/documents/*.py
```

Read ALL document layout frontmatters (first 40 lines of each .py file).

### Step 4: Plan the Document

Create a slide plan table (as shown in the Brief Structure above) with specific content filled in from the data gathered.

### Step 5: Generate

Follow the pptx-generator Mode 3 (Documents) workflow:
- Dimensions: 8.5" x 11" (letter portrait)
- Max 5 pages per batch
- Validate after each batch
- Combine into final document

```bash
uv run --with python-pptx==1.0.2 python << 'SCRIPT'
# Generation code here
SCRIPT
```

### Step 6: Export to PDF

```bash
libreoffice --headless --convert-to pdf --outdir BALL-AI-2/output/ball-ai BALL-AI-2/output/ball-ai/pl-intel-brief-gw{N}.pptx
```

### Step 7: Report

Send a message with:
- File location
- Brief summary of what's covered
- Any data gaps or issues

## Content Voice

Follow `brands/ball-ai/tone-of-voice.md`:
- Confident, data-grounded, no hedging
- Lead with insights, support with numbers
- No trailing punctuation on headlines/bullets
- Use proper football metrics (xG, xA, PPDA)
- Headlines should be tweetable (3-8 words)

## Output

- PPTX: `BALL-AI-2/output/ball-ai/pl-intel-brief-gw{N}-{date}.pptx`
- PDF: `BALL-AI-2/output/ball-ai/pl-intel-brief-gw{N}-{date}.pdf`
