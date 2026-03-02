"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type {
  CanvasState,
  CanvasEvent,
  CanvasArtifact,
  CanvasAnnotation,
} from "@/lib/canvas-types";

function applyCanvasEvent(state: CanvasState, event: CanvasEvent): CanvasState {
  const newState = { ...state, lastUpdate: new Date().toISOString() };

  switch (event.type) {
    case "artifact_add":
      newState.artifacts = [...state.artifacts, event.artifact];
      break;
    case "artifact_update":
      newState.artifacts = state.artifacts.map((a) =>
        a.id === event.artifactId
          ? ({ ...a, ...event.changes } as CanvasArtifact)
          : a
      );
      break;
    case "artifact_remove":
      newState.artifacts = state.artifacts.filter(
        (a) => a.id !== event.artifactId
      );
      break;
    case "annotation_add":
      newState.annotations = [...state.annotations, event.annotation];
      break;
    case "annotation_update":
      newState.annotations = state.annotations.map((a) =>
        a.id === event.annotationId
          ? ({ ...a, ...event.changes } as CanvasAnnotation)
          : a
      );
      break;
    case "annotation_remove":
      newState.annotations = state.annotations.filter(
        (a) => a.id !== event.annotationId
      );
      break;
  }

  return newState;
}

export function useCanvasEvents(groupFolder: string) {
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCanvas = useCallback(async () => {
    try {
      const res = await fetch(`/api/canvas/${groupFolder}`);
      if (res.ok) {
        const state = await res.json();
        setCanvasState(state);
      }
    } catch {
      /* silently fail */
    }
  }, [groupFolder]);

  const connect = useCallback(() => {
    if (sourceRef.current) sourceRef.current.close();

    const source = new EventSource(
      `/api/canvas/${groupFolder}/events`
    );
    sourceRef.current = source;

    source.addEventListener("canvas_event", (e) => {
      try {
        const event = JSON.parse(e.data) as CanvasEvent;
        setCanvasState((prev) => {
          if (!prev) return prev;
          return applyCanvasEvent(prev, event);
        });
        setConnected(true);
      } catch {
        /* ignore parse errors */
      }
    });

    source.addEventListener("heartbeat", () => {
      setConnected(true);
    });

    source.onerror = () => {
      setConnected(false);
      source.close();
      reconnectTimeout.current = setTimeout(connect, 3000);
    };
  }, [groupFolder]);

  useEffect(() => {
    loadCanvas();
    connect();
    return () => {
      sourceRef.current?.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, [loadCanvas, connect]);

  const updateCanvas = useCallback(
    async (action: string, body: object) => {
      try {
        await fetch(`/api/canvas/${groupFolder}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...body }),
        });
      } catch {
        /* silently fail */
      }
    },
    [groupFolder]
  );

  return { canvasState, connected, updateCanvas, reload: loadCanvas };
}
