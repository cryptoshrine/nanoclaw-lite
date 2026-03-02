"use client";

import { memo } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Code2,
  FileText,
  Image,
  BarChart3,
  Globe,
  Layers,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactType } from "@/lib/canvas-types";

interface ArtifactNodeData {
  artifactId: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata?: Record<string, string>;
  sourceAgent: string;
  onRemove: (id: string) => void;
  [key: string]: unknown;
}

const typeIcons: Record<ArtifactType, typeof FileText> = {
  markdown: FileText,
  code: Code2,
  svg: Layers,
  image: Image,
  chart: BarChart3,
  html: Globe,
};

const typeColors: Record<ArtifactType, string> = {
  markdown: "border-blue-500/30 text-blue-400",
  code: "border-green-500/30 text-green-400",
  svg: "border-cyan-500/30 text-cyan-400",
  image: "border-amber-500/30 text-amber-400",
  chart: "border-purple-500/30 text-purple-400",
  html: "border-red-500/30 text-red-400",
};

function renderContent(data: ArtifactNodeData) {
  switch (data.type) {
    case "markdown":
      return (
        <div className="prose prose-sm prose-invert max-w-none text-xs">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {data.content}
          </ReactMarkdown>
        </div>
      );
    case "code":
      return (
        <pre className="rounded-md bg-[#0d0d14] border border-border p-2 text-[11px] font-mono text-foreground/80 overflow-auto whitespace-pre-wrap">
          <code>{data.content}</code>
        </pre>
      );
    case "svg":
      return (
        <div
          className="flex items-center justify-center [&>svg]:max-w-full [&>svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: data.content }}
        />
      );
    case "image":
      return (
        <img
          src={data.content}
          alt={data.title}
          className="w-full h-auto rounded"
        />
      );
    case "chart":
      return (
        <div className="text-xs text-muted-foreground italic">
          [Chart: {data.title}]
        </div>
      );
    case "html":
      return (
        <div
          className="text-xs"
          dangerouslySetInnerHTML={{ __html: data.content }}
        />
      );
  }
}

function ArtifactNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ArtifactNodeData;
  const Icon = typeIcons[nodeData.type] || FileText;

  return (
    <>
      <NodeResizer
        color="#3b82f6"
        isVisible={selected}
        minWidth={200}
        minHeight={100}
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-blue-500 !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-blue-500 !w-2 !h-2"
      />

      <Card
        className={`border-border bg-card h-full overflow-hidden ${
          selected ? "ring-1 ring-blue-500/40" : ""
        }`}
      >
        <CardHeader className="pb-2 pt-3 px-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-xs font-medium truncate">
              {nodeData.title}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 ${typeColors[nodeData.type]}`}
            >
              {nodeData.type}
            </Badge>
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground"
            >
              {nodeData.sourceAgent}
            </Badge>
            <button
              onClick={() => nodeData.onRemove(nodeData.artifactId)}
              className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </CardHeader>
        <CardContent
          className="px-3 pb-3 overflow-auto"
          style={{ maxHeight: "calc(100% - 44px)" }}
        >
          {renderContent(nodeData)}
        </CardContent>
      </Card>
    </>
  );
}

export const ArtifactNode = memo(ArtifactNodeComponent);
