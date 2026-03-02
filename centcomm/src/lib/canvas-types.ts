export type ArtifactType =
  | "markdown"
  | "code"
  | "image"
  | "svg"
  | "chart"
  | "html";

export interface CanvasArtifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata?: Record<string, string>;
  position: { x: number; y: number };
  size: { width: number; height: number };
  sourceAgent: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasAnnotation {
  id: string;
  type: "sticky" | "arrow";
  content?: string;
  position: { x: number; y: number };
  sourceId?: string;
  targetId?: string;
  color?: string;
  createdAt: string;
}

export interface CanvasState {
  id: string;
  artifacts: CanvasArtifact[];
  annotations: CanvasAnnotation[];
  viewport: { x: number; y: number; zoom: number };
  lastUpdate: string;
}

export type CanvasEvent =
  | { type: "artifact_add"; artifact: CanvasArtifact }
  | {
      type: "artifact_update";
      artifactId: string;
      changes: Partial<CanvasArtifact>;
    }
  | { type: "artifact_remove"; artifactId: string }
  | { type: "annotation_add"; annotation: CanvasAnnotation }
  | {
      type: "annotation_update";
      annotationId: string;
      changes: Partial<CanvasAnnotation>;
    }
  | { type: "annotation_remove"; annotationId: string };
