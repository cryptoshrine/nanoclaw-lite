import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { PATHS } from "@/lib/paths";
import type { CanvasState } from "@/lib/canvas-types";

export const dynamic = "force-dynamic";

function getCanvasPath(groupFolder: string) {
  return path.join(PATHS.canvas, groupFolder, "canvas.json");
}

function defaultCanvas(groupFolder: string): CanvasState {
  return {
    id: groupFolder,
    artifacts: [],
    annotations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    lastUpdate: new Date().toISOString(),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ groupFolder: string }> }
) {
  const { groupFolder } = await params;
  const canvasPath = getCanvasPath(groupFolder);

  try {
    if (fs.existsSync(canvasPath)) {
      const state = JSON.parse(fs.readFileSync(canvasPath, "utf-8"));
      return NextResponse.json(state);
    }
    return NextResponse.json(defaultCanvas(groupFolder));
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read canvas state", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupFolder: string }> }
) {
  const { groupFolder } = await params;
  const canvasPath = getCanvasPath(groupFolder);
  const dir = path.dirname(canvasPath);

  try {
    const body = await request.json();
    const { action } = body;

    // Read current state
    let state = defaultCanvas(groupFolder);
    try {
      if (fs.existsSync(canvasPath)) {
        state = JSON.parse(fs.readFileSync(canvasPath, "utf-8"));
      }
    } catch {
      /* fresh start */
    }

    switch (action) {
      case "move_artifact": {
        const idx = state.artifacts.findIndex(
          (a: { id: string }) => a.id === body.artifactId
        );
        if (idx >= 0) {
          state.artifacts[idx].position = body.position;
          state.artifacts[idx].updatedAt = new Date().toISOString();
        }
        break;
      }
      case "resize_artifact": {
        const idx = state.artifacts.findIndex(
          (a: { id: string }) => a.id === body.artifactId
        );
        if (idx >= 0) {
          state.artifacts[idx].size = body.size;
          state.artifacts[idx].updatedAt = new Date().toISOString();
        }
        break;
      }
      case "remove_artifact": {
        state.artifacts = state.artifacts.filter(
          (a: { id: string }) => a.id !== body.artifactId
        );
        break;
      }
      case "add_annotation": {
        state.annotations.push(body.annotation);
        break;
      }
      case "update_annotation": {
        const idx = state.annotations.findIndex(
          (a: { id: string }) => a.id === body.annotationId
        );
        if (idx >= 0) {
          state.annotations[idx] = {
            ...state.annotations[idx],
            ...body.changes,
          };
        }
        break;
      }
      case "remove_annotation": {
        state.annotations = state.annotations.filter(
          (a: { id: string }) => a.id !== body.annotationId
        );
        break;
      }
      case "clear": {
        state.artifacts = [];
        state.annotations = [];
        break;
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    state.lastUpdate = new Date().toISOString();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(canvasPath, JSON.stringify(state, null, 2));

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update canvas", detail: String(error) },
      { status: 500 }
    );
  }
}
