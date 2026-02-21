"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface KanbanColumnProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  headerBg: string;
  items: string[];
  children: React.ReactNode;
  count: number;
  isOver?: boolean;
}

export function KanbanColumn({
  id,
  label,
  icon,
  color,
  headerBg,
  items,
  children,
  count,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <Card
      ref={setNodeRef}
      className={`border-border bg-card/50 ${headerBg} transition-all duration-200 ${
        isOver
          ? "ring-2 ring-electric/50 border-electric/40 bg-electric/5 scale-[1.01]"
          : ""
      }`}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span
            className={`flex items-center gap-2 text-sm font-medium ${color}`}
          >
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
        <ScrollArea className="h-[calc(100vh-340px)]">
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 p-1 min-h-[60px]">
              {count === 0 ? (
                <div
                  className={`rounded-lg border border-dashed p-6 text-center transition-colors ${
                    isOver
                      ? "border-electric/50 bg-electric/5"
                      : "border-border"
                  }`}
                >
                  <p className="text-xs text-muted-foreground">
                    {isOver ? "Drop here" : `No ${label.toLowerCase()} tasks`}
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
