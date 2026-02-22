"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Inbox,
  RefreshCw,
  MessageSquare,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  Mail,
  MailOpen,
  ArrowLeftRight,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface AgentMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  message: string;
  inReplyTo: string | null;
  timestamp: string;
  status: "pending" | "processed";
}

interface GroupInbox {
  folder: string;
  name: string;
  pending: AgentMessage[];
  processed: AgentMessage[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function groupDisplayName(folder: string): string {
  return folder
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Message Card ────────────────────────────────────────────────────────

function MessageCard({
  msg,
  isRead,
}: {
  msg: AgentMessage;
  isRead: boolean;
}) {
  const [expanded, setExpanded] = useState(!isRead);

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isRead
          ? "border-border bg-card/50"
          : "border-electric/30 bg-electric/5"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-4 text-left"
      >
        <div className="mt-0.5 shrink-0">
          {isRead ? (
            <MailOpen className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Mail className="h-4 w-4 text-electric" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">
              {msg.subject || "(no subject)"}
            </span>
            {!isRead && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-electric/40 text-electric"
              >
                Unread
              </Badge>
            )}
            {msg.inReplyTo && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-muted-foreground/30 text-muted-foreground"
              >
                <ArrowLeftRight className="h-2.5 w-2.5 mr-1" />
                Reply
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground">
              from{" "}
              <span className="text-foreground font-mono">
                {msg.from}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(msg.timestamp)}
            </span>
          </div>
        </div>

        <div className="shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3">
          {msg.inReplyTo && (
            <p className="text-xs text-muted-foreground mb-2 font-mono">
              Re: {msg.inReplyTo}
            </p>
          )}
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {msg.message}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              ID: {msg.id}
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              {new Date(msg.timestamp).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Group Inbox Panel ───────────────────────────────────────────────────

function GroupInboxPanel({ inbox }: { inbox: GroupInbox }) {
  const [showProcessed, setShowProcessed] = useState(false);
  const totalCount = inbox.pending.length + inbox.processed.length;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-electric" />
            <CardTitle className="text-sm font-semibold">
              {inbox.name}
            </CardTitle>
            <span className="text-xs text-muted-foreground font-mono">
              {inbox.folder}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {inbox.pending.length > 0 && (
              <Badge className="bg-electric/20 text-electric border-electric/30 text-xs">
                {inbox.pending.length} unread
              </Badge>
            )}
            {totalCount === 0 && (
              <span className="text-xs text-muted-foreground">Empty</span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {inbox.pending.length === 0 && inbox.processed.length === 0 && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <div className="text-center">
              <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No messages yet</p>
            </div>
          </div>
        )}

        {/* Unread messages */}
        {inbox.pending.length > 0 && (
          <div className="space-y-2">
            {inbox.pending.map((msg) => (
              <MessageCard key={msg.id} msg={msg} isRead={false} />
            ))}
          </div>
        )}

        {/* Processed messages toggle */}
        {inbox.processed.length > 0 && (
          <div className={inbox.pending.length > 0 ? "mt-4" : ""}>
            <button
              onClick={() => setShowProcessed(!showProcessed)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
            >
              {showProcessed ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <CheckCircle2 className="h-3 w-3" />
              {inbox.processed.length} processed
            </button>

            {showProcessed && (
              <div className="space-y-2">
                {inbox.processed.map((msg) => (
                  <MessageCard key={msg.id} msg={msg} isRead={true} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────

export default function InboxPage() {
  const [inboxes, setInboxes] = useState<GroupInbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox");
      if (res.ok) {
        const data = await res.json();
        setInboxes(Array.isArray(data) ? data : []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 10 seconds
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const totalPending = inboxes.reduce((s, g) => s + g.pending.length, 0);
  const totalProcessed = inboxes.reduce((s, g) => s + g.processed.length, 0);
  const activeInboxes = inboxes.filter(
    (g) => g.pending.length > 0 || g.processed.length > 0
  );
  const emptyInboxes = inboxes.filter(
    (g) => g.pending.length === 0 && g.processed.length === 0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-electric" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Agent Inbox</h1>
            <p className="text-sm text-muted-foreground">
              Direct messages between agents across groups
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <Clock className="h-3 w-3 inline mr-1" />
            {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-sidebar-accent transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-electric" />
              <div>
                <p className="text-2xl font-bold text-electric">
                  {totalPending}
                </p>
                <p className="text-xs text-muted-foreground">Unread</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <MailOpen className="h-4 w-4 text-success" />
              <div>
                <p className="text-2xl font-bold">{totalProcessed}</p>
                <p className="text-xs text-muted-foreground">Processed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{inboxes.length}</p>
                <p className="text-xs text-muted-foreground">Groups</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" />
          Loading inboxes...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active inboxes (have messages) */}
          {activeInboxes.length > 0 && (
            <div className="space-y-4">
              {activeInboxes.map((inbox) => (
                <GroupInboxPanel key={inbox.folder} inbox={inbox} />
              ))}
            </div>
          )}

          {/* Empty inboxes — collapsed grid */}
          {emptyInboxes.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                {emptyInboxes.length} group
                {emptyInboxes.length !== 1 ? "s" : ""} with no messages
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {emptyInboxes.map((inbox) => (
                  <div
                    key={inbox.folder}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card/30 px-3 py-2.5"
                  >
                    <Inbox className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">
                        {inbox.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">
                        {inbox.folder}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inboxes.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Inbox className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">No groups registered</p>
              <p className="text-xs mt-1">
                Register groups and agents will be able to message each other here
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
