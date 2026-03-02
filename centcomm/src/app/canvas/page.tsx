"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodesChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Layers,
  Wifi,
  WifiOff,
  Trash2,
  StickyNote,
  RefreshCw,
} from "lucide-react";
import { useCanvasEvents } from "@/lib/use-canvas-events";
import { ArtifactNode } from "@/components/canvas/artifact-node";
import { StickyNoteNode } from "@/components/canvas/sticky-note-node";

const nodeTypes = {
  artifact: ArtifactNode,
  sticky: StickyNoteNode,
};

export default function CanvasPage() {
  const [groupFolder, setGroupFolder] = useState("main");
  const [groups, setGroups] = useState<{ name: string; folder: string }[]>([]);
  const { canvasState, connected, updateCanvas, reload } =
    useCanvasEvents(groupFolder);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Load groups list
  useEffect(() => {
    fetch("/api/groups")
      .then((r) => r.json())
      .then((data) => {
        setGroups(Array.isArray(data) ? data : data.groups || []);
      })
      .catch(() => {});
  }, []);

  const handleRemoveArtifact = useCallback(
    (artifactId: string) => {
      updateCanvas("remove_artifact", { artifactId });
      setNodes((nds) => nds.filter((n) => n.id !== artifactId));
    },
    [updateCanvas, setNodes]
  );

  const handleUpdateAnnotation = useCallback(
    (annotationId: string, changes: object) => {
      updateCanvas("update_annotation", { annotationId, changes });
    },
    [updateCanvas]
  );

  const handleRemoveAnnotation = useCallback(
    (annotationId: string) => {
      updateCanvas("remove_annotation", { annotationId });
      setNodes((nds) => nds.filter((n) => n.id !== annotationId));
      setEdges((eds) => eds.filter((e) => e.id !== annotationId));
    },
    [updateCanvas, setNodes, setEdges]
  );

  // Sync canvas state to React Flow nodes
  useEffect(() => {
    if (!canvasState) return;

    const artifactNodes: Node[] = canvasState.artifacts.map((a) => ({
      id: a.id,
      type: "artifact" as const,
      position: a.position,
      data: {
        artifactId: a.id,
        type: a.type,
        title: a.title,
        content: a.content,
        metadata: a.metadata,
        sourceAgent: a.sourceAgent,
        onRemove: handleRemoveArtifact,
      },
      style: { width: a.size.width, height: a.size.height },
    }));

    const annotationNodes: Node[] = canvasState.annotations
      .filter((a) => a.type === "sticky")
      .map((a) => ({
        id: a.id,
        type: "sticky" as const,
        position: a.position,
        data: {
          content: a.content || "",
          color: a.color || "#f59e0b",
          onUpdate: (content: string) =>
            handleUpdateAnnotation(a.id, { content }),
          onRemove: () => handleRemoveAnnotation(a.id),
        },
      }));

    const annotationEdges: Edge[] = canvasState.annotations
      .filter((a) => a.type === "arrow" && a.sourceId && a.targetId)
      .map((a) => ({
        id: a.id,
        source: a.sourceId!,
        target: a.targetId!,
        type: "smoothstep",
        style: { stroke: a.color || "#3b82f6" },
        animated: true,
      }));

    setNodes([...artifactNodes, ...annotationNodes]);
    setEdges(annotationEdges);
  }, [
    canvasState,
    handleRemoveArtifact,
    handleUpdateAnnotation,
    handleRemoveAnnotation,
    setNodes,
    setEdges,
  ]);

  // Handle node position changes (persist on drag end)
  const handleNodesChangeWrapped: OnNodesChange<Node> = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);

      for (const change of changes) {
        if (
          change.type === "position" &&
          change.dragging === false &&
          change.position
        ) {
          const nodeId = change.id;
          if (nodeId.startsWith("art-")) {
            updateCanvas("move_artifact", {
              artifactId: nodeId,
              position: change.position,
            });
          } else if (nodeId.startsWith("ann-")) {
            updateCanvas("update_annotation", {
              annotationId: nodeId,
              changes: { position: change.position },
            });
          }
        }
      }
    },
    [onNodesChange, updateCanvas]
  );

  // Handle edge connections (user draws arrow between nodes)
  const onConnect: OnConnect = useCallback(
    (connection) => {
      const annotationId = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const annotation = {
        id: annotationId,
        type: "arrow",
        position: { x: 0, y: 0 },
        sourceId: connection.source,
        targetId: connection.target,
        color: "#3b82f6",
        createdAt: new Date().toISOString(),
      };
      updateCanvas("add_annotation", { annotation });
      setEdges((eds) =>
        addEdge({ ...connection, id: annotationId, animated: true }, eds)
      );
    },
    [updateCanvas, setEdges]
  );

  const handleAddStickyNote = useCallback(() => {
    const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const annotation = {
      id,
      type: "sticky",
      content: "New note...",
      position: {
        x: 200 + Math.floor(Math.random() * 100),
        y: 200 + Math.floor(Math.random() * 100),
      },
      color: "#f59e0b",
      createdAt: new Date().toISOString(),
    };
    updateCanvas("add_annotation", { annotation });
  }, [updateCanvas]);

  const handleClearCanvas = useCallback(() => {
    updateCanvas("clear", {});
  }, [updateCanvas]);

  const artifactCount = canvasState?.artifacts.length ?? 0;
  const annotationCount = canvasState?.annotations.length ?? 0;

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <Layers className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Live Canvas</h2>
            <p className="text-sm text-muted-foreground">
              Visual workspace for agent outputs and annotations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={groupFolder} onValueChange={setGroupFolder}>
            <SelectTrigger className="w-[160px] bg-muted border-border text-sm">
              <SelectValue placeholder="Group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="main">Main</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.folder} value={g.folder}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Badge
            variant="outline"
            className={`text-xs flex items-center gap-1.5 ${
              connected
                ? "border-green-500/30 text-green-400"
                : "border-red-500/30 text-red-400"
            }`}
          >
            {connected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {connected ? "Live" : "Reconnecting..."}
          </Badge>

          <Badge variant="outline" className="text-xs">
            {artifactCount} artifacts, {annotationCount} annotations
          </Badge>

          <button
            onClick={handleAddStickyNote}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            title="Add Sticky Note"
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={reload}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={handleClearCanvas}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-muted px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            title="Clear Canvas"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* React Flow Canvas */}
      <div className="flex-1 rounded-lg border border-border bg-[#0a0a0f] overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChangeWrapped}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-[#0a0a0f]"
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: "#3b82f6" },
          }}
        >
          <Controls className="!bg-card !border-border [&>button]:!bg-muted [&>button]:!border-border [&>button]:!text-foreground" />
          <MiniMap
            className="!bg-card !border-border"
            maskColor="rgba(10, 10, 15, 0.7)"
            nodeColor="#3b82f6"
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#1e293b"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
