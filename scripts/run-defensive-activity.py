#!/usr/bin/env python3
"""Invoke defensive_activity_tool for EPL and UCL 2025/26."""

import asyncio
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

# Ball-AI project root
BALL_AI_DIR = Path(r"C:\claw\nanoclaw\groups\main\BALL-AI-2")
sys.path.insert(0, str(BALL_AI_DIR))

from dotenv import load_dotenv
load_dotenv(BALL_AI_DIR / ".env")

from app.analysis.schemas import AnalysisDeps
from app.visualizations.defensive_activity_tool import defensive_activity_tool


async def render(competition_id: int, season_id: int, label: str, output_dir: str):
    """Render a single defensive activity heatmap."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    deps = AnalysisDeps(
        statsbomb_data_path="",
        output_dir=output_dir,
        default_dpi=300,
    )

    ctx = MagicMock()
    ctx.deps = deps

    print(f"\n{'='*60}")
    print(f"Starting: {label}")
    print(f"Competition ID: {competition_id}, Season ID: {season_id}")
    print(f"Output dir: {output_dir}")
    print(f"{'='*60}\n")

    start = time.time()
    result = await defensive_activity_tool(ctx, competition_id=competition_id, season_id=season_id, team=None, format="png")
    elapsed = time.time() - start

    print(f"\n{'='*60}")
    print(f"DONE: {label}")
    print(f"File: {result['file_path']}")
    print(f"Size: {result.get('file_size_bytes', 'N/A')} bytes")
    print(f"Dimensions: {result.get('dimensions', 'N/A')}")
    print(f"Duration: {elapsed:.1f}s")
    print(f"{'='*60}\n")
    return result


async def main():
    comp = int(sys.argv[1]) if len(sys.argv) > 1 else None

    if comp == 2:
        await render(2, 318, "EPL 2025/26", r"C:\claw\nanoclaw\output\defensive-activity")
    elif comp == 16:
        await render(16, 318, "UCL 2025/26", r"C:\claw\nanoclaw\output\defensive-activity")
    else:
        print("Usage: python run-defensive-activity.py <competition_id>")
        print("  2  = EPL 2025/26")
        print("  16 = UCL 2025/26")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
