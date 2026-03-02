"use client";

import { memo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";

interface StickyNoteData {
  content: string;
  color: string;
  onUpdate: (content: string) => void;
  onRemove: () => void;
  [key: string]: unknown;
}

function StickyNoteNodeComponent({ data, selected }: NodeProps) {
  const noteData = data as unknown as StickyNoteData;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(noteData.content);

  return (
    <div
      className={`relative rounded-md shadow-lg p-3 min-w-[150px] min-h-[80px] ${
        selected ? "ring-2 ring-blue-500/40" : ""
      }`}
      style={{
        backgroundColor: (noteData.color || "#f59e0b") + "20",
        borderColor: (noteData.color || "#f59e0b") + "40",
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <button
        onClick={noteData.onRemove}
        className="absolute top-1 right-1 p-0.5 rounded hover:bg-black/20 text-muted-foreground hover:text-red-400 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>

      {editing ? (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            noteData.onUpdate(text);
          }}
          className="w-full bg-transparent text-xs text-foreground resize-none outline-none min-h-[60px]"
        />
      ) : (
        <p
          className="text-xs text-foreground cursor-text whitespace-pre-wrap pr-4"
          onDoubleClick={() => setEditing(true)}
        >
          {noteData.content || "Double-click to edit..."}
        </p>
      )}
    </div>
  );
}

export const StickyNoteNode = memo(StickyNoteNodeComponent);
