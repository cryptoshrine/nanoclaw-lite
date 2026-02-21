"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare,
  ListTodo,
  FileText,
  Bot,
  Clock,
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

interface Message {
  id: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

interface Task {
  id: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  status: string;
  next_run: string | null;
  last_run: string | null;
}

interface MemoryFile {
  name: string;
  relativePath: string;
  size: number;
  isDirectory: boolean;
}

interface GroupDetail {
  name: string;
  folder: string;
  trigger: string;
  jid: string;
  messages: Message[];
  tasks: Task[];
  files: MemoryFile[];
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
  return `${days}d ago`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const statusIcon = (status: string) => {
  switch (status) {
    case "active":
      return <Play className="h-3.5 w-3.5 text-success" />;
    case "paused":
      return <Pause className="h-3.5 w-3.5 text-amber" />;
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-electric" />;
    case "failed":
      return <AlertTriangle className="h-3.5 w-3.5 text-alert" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

const statusColor = (status: string) => {
  switch (status) {
    case "active":
      return "border-success/30 text-success";
    case "paused":
      return "border-amber/30 text-amber";
    case "completed":
      return "border-electric/30 text-electric";
    case "failed":
      return "border-alert/30 text-alert";
    default:
      return "border-border text-muted-foreground";
  }
};

export function AgentDetail({ folder }: { folder: string }) {
  const [data, setData] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/groups/${folder}?messageLimit=100`);
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [folder]);

  async function loadFile(filePath: string) {
    setActiveFile(filePath);
    setLoadingFile(true);
    try {
      const res = await fetch(
        `/api/groups/${folder}/files?path=${encodeURIComponent(filePath)}`
      );
      if (res.ok) {
        const json = await res.json();
        setFileContent(json.content);
      } else {
        setFileContent("Failed to load file");
      }
    } catch {
      setFileContent("Error loading file");
    } finally {
      setLoadingFile(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-muted-foreground">Loading agent data...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Link
          href="/agents"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Agents
        </Link>
        <div className="flex items-center justify-center p-12">
          <div className="text-alert">Agent not found</div>
        </div>
      </div>
    );
  }

  const directories = data.files.filter((f) => f.isDirectory);
  const files = data.files.filter((f) => !f.isDirectory);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/agents"
          className="mt-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-electric/10">
              <Bot className="h-5 w-5 text-electric" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground">{data.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className="text-xs px-2 py-0 border-border font-mono"
                >
                  {data.trigger}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {data.folder}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="messages" className="space-y-4">
        <TabsList className="bg-muted border border-border">
          <TabsTrigger value="messages" className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric">
            <MessageSquare className="h-3.5 w-3.5" />
            Messages ({data.messages.length})
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric">
            <ListTodo className="h-3.5 w-3.5" />
            Tasks ({data.tasks.length})
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric">
            <FileText className="h-3.5 w-3.5" />
            Files ({files.length})
          </TabsTrigger>
        </TabsList>

        {/* Messages Tab */}
        <TabsContent value="messages">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Recent Messages
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {data.messages.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No messages
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`px-6 py-3 ${
                          msg.is_from_me
                            ? "border-l-2 border-l-electric/50 bg-electric/5"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">
                            {msg.is_from_me ? "Klaw" : msg.sender_name || "Unknown"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(msg.timestamp)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
                          {msg.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Scheduled Tasks
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {data.tasks.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No tasks
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data.tasks.map((task) => (
                      <div key={task.id} className="px-6 py-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {statusIcon(task.status)}
                            <p className="text-sm text-foreground truncate">
                              {task.prompt.slice(0, 120)}
                              {task.prompt.length > 120 ? "..." : ""}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 shrink-0 ${statusColor(task.status)}`}
                          >
                            {task.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="font-mono">
                            {task.schedule_type}: {task.schedule_value}
                          </span>
                          {task.next_run && (
                            <span>Next: {timeAgo(task.next_run)}</span>
                          )}
                          {task.last_run && (
                            <span>Last: {timeAgo(task.last_run)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Files Tab */}
        <TabsContent value="files">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* File tree */}
            <Card className="border-border bg-card lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Memory Files
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  <div className="px-2 py-1">
                    {/* Root files first */}
                    {files
                      .filter((f) => !f.relativePath.includes("/"))
                      .map((f) => (
                        <button
                          key={f.relativePath}
                          onClick={() => loadFile(f.relativePath)}
                          className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors ${
                            activeFile === f.relativePath
                              ? "bg-electric/10 text-electric"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{f.name}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                            {(f.size / 1024).toFixed(1)}k
                          </span>
                        </button>
                      ))}

                    {/* Directories with their files */}
                    {directories.map((dir) => (
                      <div key={dir.relativePath} className="mt-2">
                        <div className="flex items-center gap-2 px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {dir.name}/
                        </div>
                        {files
                          .filter(
                            (f) =>
                              f.relativePath.startsWith(dir.relativePath + "/") &&
                              f.relativePath.split("/").length ===
                                dir.relativePath.split("/").length + 1
                          )
                          .map((f) => (
                            <button
                              key={f.relativePath}
                              onClick={() => loadFile(f.relativePath)}
                              className={`flex w-full items-center gap-2 rounded px-3 py-1.5 pl-6 text-left text-sm transition-colors ${
                                activeFile === f.relativePath
                                  ? "bg-electric/10 text-electric"
                                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                              }`}
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{f.name}</span>
                              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                                {(f.size / 1024).toFixed(1)}k
                              </span>
                            </button>
                          ))}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* File content viewer */}
            <Card className="border-border bg-card lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {activeFile ? activeFile : "Select a file to view"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  {loadingFile ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      Loading...
                    </div>
                  ) : activeFile ? (
                    <pre className="p-6 text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                      {fileContent}
                    </pre>
                  ) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      Click a file in the tree to view its contents
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
