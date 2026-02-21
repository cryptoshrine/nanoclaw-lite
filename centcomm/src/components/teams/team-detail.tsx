"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  ListTodo,
  MessageSquare,
  Bot,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  Plus,
  ArrowLeft,
} from "lucide-react";

interface TeamMember {
  id: string;
  team_id: string;
  name: string;
  model: string;
  role: string;
  status: string;
  prompt: string;
  created_at: string;
}

interface TeamTask {
  id: string;
  team_id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  priority: number;
  created_at: string;
  completed_at: string | null;
}

interface TeamMessage {
  id: number;
  team_id: string;
  from_member: string;
  to_member: string | null;
  content: string;
  read: number;
  created_at: string;
}

interface TeamDetailProps {
  teamId: string;
  teamName: string;
  onBack: () => void;
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
  return `${Math.floor(hours / 24)}d ago`;
}

const statusColors: Record<string, string> = {
  active: "text-success border-success/30",
  running: "text-success border-success/30",
  idle: "text-muted-foreground border-border",
  completed: "text-electric border-electric/30",
  stopped: "text-alert border-alert/30",
  failed: "text-alert border-alert/30",
  pending: "text-amber border-amber/30",
  claimed: "text-cyan border-cyan/30",
};

export function TeamDetail({ teamId, teamName, onBack }: TeamDetailProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Spawn teammate form
  const [tmName, setTmName] = useState("");
  const [tmPrompt, setTmPrompt] = useState("");
  const [tmModel, setTmModel] = useState("claude-sonnet-4-6");
  const [spawning, setSpawning] = useState(false);

  useEffect(() => {
    loadTeamData();
    const interval = setInterval(loadTeamData, 10000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  async function loadTeamData() {
    try {
      const res = await fetch(`/api/teams/${teamId}`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setTasks(data.tasks || []);
        setMessages(data.messages || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  async function handleSpawn() {
    if (!tmName.trim() || !tmPrompt.trim()) return;
    setSpawning(true);
    try {
      await fetch(`/api/teams/${teamId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "spawn_teammate",
          name: tmName.trim(),
          prompt: tmPrompt.trim(),
          model: tmModel,
        }),
      });
      setTmName("");
      setTmPrompt("");
      setSpawnOpen(false);
      setTimeout(loadTeamData, 3000);
    } catch {
      // silently fail
    } finally {
      setSpawning(false);
    }
  }

  async function handleSendMessage() {
    if (!chatMessage.trim()) return;
    setSending(true);
    try {
      await fetch(`/api/teams/${teamId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          content: chatMessage.trim(),
        }),
      });
      setChatMessage("");
      setTimeout(loadTeamData, 2000);
    } catch {
      // silently fail
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-foreground">{teamName}</h3>
          <p className="text-xs text-muted-foreground font-mono">{teamId}</p>
        </div>
        <button
          onClick={() => setSpawnOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:bg-electric-dim transition-colors"
        >
          <Plus className="h-4 w-4" />
          Spawn Teammate
        </button>
      </div>

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList className="bg-muted border border-border">
          <TabsTrigger
            value="members"
            className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric"
          >
            <Users className="h-3.5 w-3.5" />
            Members ({members.length})
          </TabsTrigger>
          <TabsTrigger
            value="tasks"
            className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric"
          >
            <ListTodo className="h-3.5 w-3.5" />
            Tasks ({tasks.length})
          </TabsTrigger>
          <TabsTrigger
            value="messages"
            className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat ({messages.length})
          </TabsTrigger>
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members">
          <div className="grid gap-3 md:grid-cols-2">
            {members.map((member) => (
              <Card key={member.id} className="border-border bg-card">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric/10 shrink-0">
                      <Bot className="h-4 w-4 text-electric" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {member.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${
                            statusColors[member.status] || "border-border"
                          }`}
                        >
                          {member.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-border font-mono"
                        >
                          {member.role}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {member.model.includes("opus") ? "opus" : "sonnet"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                        {member.prompt.slice(0, 150)}
                        {member.prompt.length > 150 ? "..." : ""}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {members.length === 0 && (
              <div className="col-span-2 rounded-lg border border-dashed border-border p-8 text-center">
                <Users className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No team members yet. Spawn a teammate to get started.
                </p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks">
          <Card className="border-border bg-card">
            <CardContent className="p-0">
              <ScrollArea className="h-[400px]">
                {tasks.length === 0 ? (
                  <div className="p-8 text-center">
                    <ListTodo className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No team tasks
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {tasks.map((task) => (
                      <div key={task.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {task.status === "completed" ? (
                              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                            ) : task.status === "claimed" ? (
                              <Clock className="h-4 w-4 text-cyan shrink-0" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <span className="text-sm font-medium text-foreground truncate">
                              {task.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {task.assigned_to && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-cyan/30 text-cyan"
                              >
                                {task.assigned_to}
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${
                                statusColors[task.status] || "border-border"
                              }`}
                            >
                              {task.status}
                            </Badge>
                          </div>
                        </div>
                        {task.description && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 ml-6">
                            {task.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Team Communication
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[350px]">
                {messages.length === 0 ? (
                  <div className="p-8 text-center">
                    <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No messages yet
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {messages.map((msg) => (
                      <div key={msg.id} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-electric">
                              {msg.from_member}
                            </span>
                            {msg.to_member && (
                              <>
                                <span className="text-[10px] text-muted-foreground">
                                  →
                                </span>
                                <span className="text-xs font-medium text-foreground">
                                  {msg.to_member}
                                </span>
                              </>
                            )}
                            {!msg.to_member && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-amber/30 text-amber"
                              >
                                broadcast
                              </Badge>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {timeAgo(msg.created_at)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* Send message */}
              <div className="border-t border-border p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    placeholder="Broadcast a message to all teammates..."
                    className="bg-muted border-border text-sm"
                  />
                  <button
                    type="submit"
                    disabled={sending || !chatMessage.trim()}
                    className="flex items-center gap-1.5 rounded-md bg-electric px-3 py-2 text-sm text-white hover:bg-electric-dim disabled:opacity-50 transition-colors"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </form>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Spawn teammate dialog */}
      <Dialog open={spawnOpen} onOpenChange={() => setSpawnOpen(false)}>
        <DialogContent className="max-w-lg border-border bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>Spawn Teammate</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name
              </label>
              <Input
                value={tmName}
                onChange={(e) => setTmName(e.target.value)}
                placeholder="e.g., researcher, coder"
                className="mt-1 bg-muted border-border"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Prompt / Task
              </label>
              <Textarea
                value={tmPrompt}
                onChange={(e) => setTmPrompt(e.target.value)}
                placeholder="What should this teammate do?"
                className="mt-1 bg-muted border-border min-h-[80px]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Model
              </label>
              <select
                value={tmModel}
                onChange={(e) => setTmModel(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
              >
                <option value="claude-sonnet-4-6">Sonnet 4.6 (recommended)</option>
                <option value="claude-sonnet-4-20250514">Sonnet 4 (legacy)</option>
                <option value="claude-opus-4-6">Opus (complex reasoning)</option>
              </select>
            </div>
            <button
              onClick={handleSpawn}
              disabled={spawning || !tmName.trim() || !tmPrompt.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-electric px-4 py-2.5 text-sm font-medium text-white hover:bg-electric-dim disabled:opacity-50 transition-colors"
            >
              {spawning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Spawn
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
