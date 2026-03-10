---
name: pptx-carousel
description: |
  Generate branded X/Twitter carousel graphics using Ball-AI data and the pptx-generator.

  TRIGGERS - Use when user says:
  - "carousel" / "x carousel" / "twitter carousel"
  - "carousel about [topic]" / "make a carousel"
  - "swipeable graphic" / "carousel post"
  - "visual thread" / "image thread"
  - Any request for multi-image X/Twitter content with Ball-AI data
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
---

# X Content Carousel Generator

Generate branded carousel-style graphics for X/Twitter posts using Ball-AI data. These are square (1:1) multi-image posts that drive engagement — "Top 5 xG underperformers this week" as a swipeable visual.

## Prerequisites

- **PPTX Generator:** `BALL-AI-2/.claude/skills/pptx-generator/` (layouts, brand config, cookbook)
- **Ball-AI Brand:** `BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/`
- **Ball-AI API:** For live data
- **Output:** `BALL-AI-2/output/ball-ai/`

## Carousel Types

### 1. Statistical Rankings
- "Top 5 xG underperformers this week"
- "Best pressing teams in the PL"
- "Most progressive passers GW{N}"
- Layout: hook → numbered-point slides → cta

### 2. Match Breakdown
- "Arsenal vs City — By the Numbers"
- "The 5 moments that decided the match"
- Layout: hook → single-point slides (with stats) → cta

### 3. Player Spotlight
- "Saka's season in numbers"
- "Why Salah is having his best xA season"
- Layout: hook → single-point slides → quote (analyst take) → cta

### 4. Tactical Explainer
- "How Brighton's 3-2-5 build-up works"
- "Why high pressing beats low blocks"
- Layout: hook → numbered-point (steps/phases) → cta

### 5. Hot Take / Opinion
- "The most overrated team in the PL"
- "3 transfers that actually worked"
- Layout: hook → single-point (evidence) → quote → cta

## Workflow

### Step 1: Determine Topic

Parse `$ARGUMENTS` for the carousel topic. If no topic provided, suggest 3-5 timely topics based on:
- Current gameweek results
- Recent betting analysis
- Trending football narratives
- StatsBomb data highlights

### Step 2: Gather Data

Source data from Ball-AI:
- Use specific queries to app.ball-ai.xyz or local data
- Get exact numbers, not approximations
- Ensure StatsBomb attribution included

### Step 3: Read Brand + Layouts

```
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/brand.json
Read: BALL-AI-2/.claude/skills/pptx-generator/brands/ball-ai/tone-of-voice.md
Glob: BALL-AI-2/.claude/skills/pptx-generator/cookbook/carousels/*.py
```

Read ALL carousel layout frontmatters (first 40 lines of each .py file).

### Step 4: Plan the Carousel

Optimal structure (5-8 slides):

| # | Layout | Content |
|---|--------|---------|
| 1 | hook-slide | Bold, scroll-stopping headline (max 50 chars) |
| 2-6 | numbered-point or single-point | One data point per slide, large text |
| 7 | quote-slide | (Optional) Analyst take or insight |
| 8 | cta-slide | "Follow @Ball_AI_Agent for more" |

Rules:
- **One idea per slide** — don't cram
- **Large text** — must be readable on mobile
- **Max 50 chars for headlines, 150 for body**
- **Strong hook** — first slide stops the scroll
- **Data: StatsBomb** attribution on slides with match data

### Step 5: Generate

Follow the pptx-generator Mode 2 (Carousels) workflow:
- Dimensions: 7.5" x 7.5" (square 1:1)
- Generate all slides in one batch (typically 5-8 slides)

```bash
uv run --with python-pptx==1.0.2 python << 'SCRIPT'
# Carousel generation code with 7.5" x 7.5" dimensions
SCRIPT
```

### Step 6: Convert to Images

For X/Twitter, we need individual PNG images (not PDF):

```bash
# Convert each slide to PNG using LibreOffice
libreoffice --headless --convert-to png --outdir BALL-AI-2/output/ball-ai/carousel-images BALL-AI-2/output/ball-ai/carousel.pptx
```

Alternative: Use Playwright to screenshot each slide at 1080x1080.

### Step 7: Post (Optional)

If user wants to post immediately, use the X posting script:
```bash
node scripts/tweet-with-media.mjs --text "Tweet text" --media "path/to/image1.png,path/to/image2.png,..."
```

Note: X allows max 4 images per post. For longer carousels, split into a thread.

### Step 8: Report

Send a message with:
- File locations (PPTX + individual PNGs)
- Suggested tweet text
- Number of slides generated

## Content Voice

- **Spicy, opinionated, data-backed** — this is for X, not LinkedIn
- Headlines must be scroll-stoppers
- Use football slang where appropriate
- Numbers should be bold and prominent
- Every claim backed by data
- No corporate speak
- End with a clear CTA to follow @Ball_AI_Agent

## Output

- PPTX: `BALL-AI-2/output/ball-ai/{topic}-carousel-{date}.pptx`
- Images: `BALL-AI-2/output/ball-ai/carousel-images/slide-{N}.png`
