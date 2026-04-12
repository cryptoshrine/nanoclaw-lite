"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PipelineColumnProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  headerBg: string;
  items: string[];
  children: React.ReactNode;
  count: number;
}

export function PipelineColumn({
  id,
  label,
  icon,
  color,
  headerBg,
  items,
  children,
  count,
}: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const isEmpty = count === 0;

  // Empty columns render as compact drop targets
  if (isEmpty && !isOver) {
    return (
      <Card
        ref={setNodeRef}
        className={`border-border bg-card/30 transition-all duration-200 min-w-[80px] max-w-[80px] flex-shrink-0 snap-start opacity-60 hover:opacity-100`}
      >
        <CardHeader className="pb-2 px-2 pt-3">
          <CardTitle className="flex flex-col items-center gap-1 text-center">
            <span className={`${color}`}>{icon}</span>
            <span className={`text-[10px] font-medium ${color} leading-tight`}>
              {label}
            </span>
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 ${color} border-current/20`}
            >
              {count}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0">
          <div className="rounded-lg border border-dashed border-border p-2 text-center min-h-[60px] flex items-center justify-center">
            <p className="text-[10px] text-muted-foreground">Drop here</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      ref={setNodeRef}
      className={`border-border bg-card/50 ${headerBg} transition-all duration-200 min-w-[180px] flex-1 flex-shrink-0 snap-start ${
        isOver
          ? "ring-2 ring-electric/50 border-electric/40 bg-electric/5 scale-[1.01]"
          : ""
      }`}
    >
      <CardHeader className="pb-3 px-3 pt-3">
        <CardTitle className="flex items-center justify-between">
          <span className={`flex items-center gap-1.5 text-xs font-medium ${color}`}>
            {icon}
            {label}
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${color} border-current/20`}
          >
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 pt-0">
        <ScrollArea className="h-[calc(100vh-380px)]">
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 p-1 min-h-[60px]">
              {isEmpty ? (
                <div
                  className={`rounded-lg border border-dashed p-4 text-center transition-colors ${
                    isOver
                      ? "border-electric/50 bg-electric/5"
                      : "border-border"
                  }`}
                >
                  <p className="text-xs text-muted-foreground">
                    {isOver ? "Drop here" : "Empty"}
                  </p>
                </div>
              ) : (
                children
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
