---
name: pptx-match-analysis
description: |
  Generate post-match analysis presentation decks using Ball-AI data and the pptx-generator.

  TRIGGERS - Use when user says:
  - "match analysis deck" / "match deck" / "post-match deck"
  - "analysis slides for [match]" / "match presentation"
  - "generate analysis for [home] vs [away]"
  - "match report slides" / "post-match slides"
  - Any request for a visual match analysis presentation
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# Match Analysis Deck Generator

Generate polished post-match analysis presentations using Ball-AI's StatsBomb data. These decks combine stats, charts, and tactical narrative into a visual story of the match.

## Prerequisites

- **PPTX Generator:** `BALL-AI-2/.claude/skills/pptx-generator/` (layouts, brand config, cookbook)
- **Ball-AI Brand:** `BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/`
- **Ball-AI API:** For live match data (StatsBomb)
- **Output:** `BALL-AI-2/output/ball-ai/`

## Deck Structure (10-15 slides)

| # | Layout | Section | Content |
|---|--------|---------|---------|
| 1 | title-slide | Title | "{Home} vs {Away} — Match Analysis" + date, competition |
| 2 | stats-slide | Scoreline & Key Stats | Final score, xG, possession, shots |
| 3 | content-slide | Match Narrative | 3-4 bullet overview of how the match unfolded |
| 4 | section-break-slide | Divider | "First Half" |
| 5 | chart-slide | First Half xG | xG timeline or shot map for H1 |
| 6 | floating-cards-slide | Key Moments H1 | 3 pivotal moments (goals, chances, tactical shifts) |
| 7 | section-break-slide | Divider | "Second Half" |
| 8 | chart-slide | Second Half xG | xG timeline or shot map for H2 |
| 9 | floating-cards-slide | Key Moments H2 | 3 pivotal moments |
| 10 | section-break-slide | Divider | "Player Ratings" |
| 11 | multi-card-slide | Top Performers | 3-5 standout players with key stats |
| 12 | stats-slide | Pressing Battle | PPDA comparison, high turnovers, press success |
| 13 | two-column-slide | Tactical Comparison | Side-by-side formation + style breakdown |
| 14 | quote-slide | Verdict | One-line match verdict (analyst style) |
| 15 | closing-slide | CTA | "Powered by Ball-AI — ball-ai.xyz" |

## Workflow

### Step 1: Identify the Match

Parse `$ARGUMENTS` for:
- Team names (home vs away)
- Gameweek or date
- Competition (default: Premier League 2025/26)

If no match specified, ask or pick the most recent/interesting fixture.

### Step 2: Gather Match Data

Query Ball-AI for comprehensive match data:

1. **Core Stats**
   - "Match stats for {home} vs {away} GW{N} 2025/26"
   - Final score, xG (home/away), shots (on/off target), possession, corners

2. **xG Timeline**
   - "xG timeline for {home} vs {away}"
   - Minute-by-minute xG accumulation

3. **Key Events**
   - "Goals and key events in {home} vs {away}"
   - Goals, red cards, substitutions, big chances

4. **Player Performance**
   - "Top 5 players by rating in {home} vs {away}"
   - Key stats per player (goals, assists, xG, progressive actions)

5. **Pressing Data**
   - "PPDA and pressing stats for {home} vs {away}"
   - Press intensity by period

6. **Tactical Shape**
   - "Formations used in {home} vs {away}"
   - Any formation changes during the match

### Step 3: Read Brand + Layouts

```
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/brand.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/config.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/tone-of-voice.md
Glob: BALL-AI-2/.claude/skills/pptx-generator/cookbook/*.py
```

Read ALL presentation layout frontmatters (first 40 lines of each .py file).

### Step 4: Plan the Deck

Create a slide plan table with specific content from the match data. Adapt the standard structure based on what happened:
- Dominant win? Emphasize stats disparity
- Upset? Lead with the narrative twist
- Tactical battle? More formation/pressing slides
- Individual brilliance? Extra player spotlight

### Step 5: Generate

Follow the pptx-generator Mode 1 (Presentations) workflow:
- Dimensions: 16:9 (13.333" x 7.5")
- Max 5 slides per batch
- Validate after each batch
- Combine into final deck

```bash
uv run --with python-pptx==1.0.2 python << 'SCRIPT'
# Presentation generation code
SCRIPT
```

### Step 6: Chart Generation

For chart-slide layouts, use python-pptx chart capabilities:

```python
# xG comparison bar chart
chart_data = CategoryChartData()
chart_data.categories = ["{Home}", "{Away}"]
chart_data.add_series("xG", [home_xg, away_xg])
chart_data.add_series("Goals", [home_goals, away_goals])
```

Available chart types:
- `BAR_CLUSTERED` — xG vs Goals comparison
- `DOUGHNUT` — Possession split
- `COLUMN_CLUSTERED` — Shot types breakdown
- `LINE` — xG timeline (if supported)

### Step 7: Report

Send a message with:
- File location
- Match summary (1-2 sentences)
- Number of slides

## Content Voice

- **Narrative-driven** — tell the story of the match, don't just list stats
- **Headlines state insights** — "Arsenal's Press Collapsed After 60'" not "Second Half Analysis"
- **Data supports narrative** — every claim backed by StatsBomb numbers
- **Include "Data: StatsBomb" attribution** on any slide with match data
- **No trailing punctuation** on headlines/bullets

## Output

- PPTX: `BALL-AI-2/output/ball-ai/{home}-vs-{away}-gw{N}-{date}.pptx`
