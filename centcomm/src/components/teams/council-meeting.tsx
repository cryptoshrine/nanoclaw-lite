"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Users,
  Send,
  Loader2,
  Bot,
  CheckCircle2,
} from "lucide-react";

interface GroupInfo {
  name: string;
  folder: string;
  jid: string;
}

interface CouncilMeetingProps {
  groups: GroupInfo[];
}

export function CouncilMeeting({ groups }: CouncilMeetingProps) {
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [sentLog, setSentLog] = useState<
    { group: string; time: string; prompt: string }[]
  >([]);

  function toggleGroup(folder: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedGroups(new Set(groups.map((g) => g.folder)));
  }

  async function broadcastMessage() {
    if (!prompt.trim() || selectedGroups.size === 0) return;
    setSending(true);

    const timestamp = new Date().toISOString();
    const promises = Array.from(selectedGroups).map(async (folder) => {
      const group = groups.find((g) => g.folder === folder);
      try {
        await fetch("/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: prompt.trim(),
            target_group: folder,
          }),
        });
        return { group: group?.name || folder, time: timestamp, prompt: prompt.trim() };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(promises);
    const successful = results.filter(Boolean) as {
      group: string;
      time: string;
      prompt: string;
    }[];

    setSentLog((prev) => [...successful, ...prev]);
    setPrompt("");
    setSending(false);
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4 text-electric" />
            Council Meeting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Agent selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Select Agents
              </p>
              <button
                onClick={selectAll}
                className="text-[10px] text-electric hover:underline"
              >
                Select All
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => {
                const selected = selectedGroups.has(group.folder);
                return (
                  <button
                    key={group.folder}
                    onClick={() => toggleGroup(group.folder)}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      selected
                        ? "border-electric bg-electric/10 text-electric"
                        : "border-border bg-muted text-muted-foreground hover:border-electric/30"
                    }`}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {group.name}
                    {selected && <CheckCircle2 className="h-3 w-3" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Message / Directive
            </p>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter a message to broadcast to all selected agents..."
              className="bg-muted border-border min-h-[80px]"
            />
          </div>

          {/* Broadcast button */}
          <button
            onClick={broadcastMessage}
            disabled={sending || !prompt.trim() || selectedGroups.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-electric px-4 py-2.5 text-sm font-medium text-white hover:bg-electric-dim disabled:opacity-50 transition-colors"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Broadcast to {selectedGroups.size} Agent
            {selectedGroups.size !== 1 ? "s" : ""}
          </button>
        </CardContent>
      </Card>

      {/* Sent log */}
      {sentLog.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Broadcast Log
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[200px]">
              <div className="divide-y divide-border">
                {sentLog.map((entry, i) => (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-success/30 text-success"
                      >
                        → {entry.group}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(entry.time).toLocaleTimeString("en-GB")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
                      {entry.prompt}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
