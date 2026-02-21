"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, MessageSquare, ListTodo, Clock, ChevronRight } from "lucide-react";
import Link from "next/link";

interface AgentCardProps {
  name: string;
  folder: string;
  trigger: string;
  jid: string;
  messageCount: number;
  taskCount: number;
  activeTaskCount: number;
  lastActivity?: string;
  requiresTrigger?: boolean;
}

function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function AgentCard({
  name,
  folder,
  trigger,
  messageCount,
  taskCount,
  activeTaskCount,
  lastActivity,
  requiresTrigger,
}: AgentCardProps) {
  const isActive = lastActivity
    ? new Date().getTime() - new Date(lastActivity).getTime() < 24 * 60 * 60 * 1000
    : false;

  return (
    <Link href={`/agents/${folder}`}>
      <Card className="border-border bg-card card-glow cursor-pointer transition-all hover:border-electric/30">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-electric/10">
                  <Bot className="h-5 w-5 text-electric" />
                </div>
                {isActive && (
                  <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success status-pulse" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-border font-mono"
                  >
                    {trigger}
                  </Badge>
                  {requiresTrigger === false && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 border-amber/30 text-amber"
                    >
                      always-on
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-cyan" />
              <span className="text-sm tabular-nums text-muted-foreground">
                {messageCount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ListTodo className="h-3.5 w-3.5 text-success" />
              <span className="text-sm tabular-nums text-muted-foreground">
                {taskCount} tasks
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-amber" />
              <span className="text-sm text-muted-foreground truncate">
                {lastActivity ? timeAgo(lastActivity) : "never"}
              </span>
            </div>
          </div>

          {activeTaskCount > 0 && (
            <div className="mt-3 flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-success status-pulse" />
              <span className="text-xs text-success">
                {activeTaskCount} active task{activeTaskCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
