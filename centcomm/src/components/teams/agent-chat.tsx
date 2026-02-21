"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Send,
  Loader2,
  Bot,
} from "lucide-react";

interface GroupInfo {
  name: string;
  folder: string;
  jid: string;
}

interface Message {
  id: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

interface AgentChatProps {
  groups: GroupInfo[];
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

export function AgentChat({ groups }: AgentChatProps) {
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedGroup) return;

    loadMessages();
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup]);

  async function loadMessages() {
    if (!selectedGroup) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/groups/${selectedGroup}?messageLimit=50`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!chatInput.trim() || !selectedGroup) return;
    setSending(true);
    try {
      await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chatInput.trim(),
          target_group: selectedGroup,
        }),
      });
      setChatInput("");
      setTimeout(loadMessages, 2000);
    } catch {
      // silently fail
    } finally {
      setSending(false);
    }
  }

  // Reversed messages for chat display (oldest first)
  const displayMessages = [...messages].reverse();

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="h-4 w-4 text-electric" />
            Agent Chat
          </span>
          <Select value={selectedGroup} onValueChange={setSelectedGroup}>
            <SelectTrigger className="w-[180px] bg-muted border-border text-sm">
              <SelectValue placeholder="Select agent..." />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.folder} value={g.folder}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]" ref={scrollRef}>
          {!selectedGroup ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bot className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">Select an agent to start chatting</p>
            </div>
          ) : loading && messages.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : displayMessages.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">No messages yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {displayMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`px-4 py-3 ${
                    msg.is_from_me
                      ? "border-l-2 border-l-electric/50 bg-electric/5"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {msg.is_from_me ? "Klaw" : msg.sender_name || "User"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(msg.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                    {msg.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Send message */}
        {selectedGroup && (
          <div className="border-t border-border p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex gap-2"
            >
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Send a message to this agent..."
                className="bg-muted border-border text-sm"
              />
              <button
                type="submit"
                disabled={sending || !chatInput.trim()}
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
        )}
      </CardContent>
    </Card>
  );
}
