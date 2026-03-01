"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Send,
  Loader2,
  Bot,
  User,
  RefreshCw,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function isAgentMessage(msg: ChatMessage): boolean {
  // Agent responses are prefixed with "klaw:" or "Klaw:" or stored as is_from_me
  return msg.is_from_me === 1 || /^klaw:/i.test(msg.content);
}

function cleanContent(msg: ChatMessage): string {
  // Strip the "klaw: " prefix from agent messages for display
  if (/^klaw:\s*/i.test(msg.content)) {
    return msg.content.replace(/^klaw:\s*/i, "");
  }
  return msg.content;
}

// ── Message Bubble ────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isAgent = isAgentMessage(msg);
  const content = cleanContent(msg);

  return (
    <div className={`flex gap-3 ${isAgent ? "" : "flex-row-reverse"}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isAgent
            ? "bg-electric/10 text-electric"
            : "bg-emerald-500/10 text-emerald-400"
        }`}
      >
        {isAgent ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
          isAgent
            ? "bg-card border border-border"
            : "bg-electric/10 border border-electric/20"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {isAgent ? "Klaw" : msg.sender_name}
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {formatTime(msg.timestamp)}
          </span>
        </div>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </p>
      </div>
    </div>
  );
}

// ── Main Chat Page ────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const latestTimestamp = useRef<string>("");

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Initial load
  useEffect(() => {
    async function loadMessages() {
      try {
        const res = await fetch("/api/chat?limit=100");
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages);
          setConnected(true);
          if (data.messages.length > 0) {
            latestTimestamp.current =
              data.messages[data.messages.length - 1].timestamp;
          }
        }
      } catch {
        setConnected(false);
      } finally {
        setLoading(false);
      }
    }
    loadMessages();
  }, []);

  // Poll for new messages
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!latestTimestamp.current) return;
      try {
        const res = await fetch(
          `/api/chat?since=${encodeURIComponent(latestTimestamp.current)}&limit=50`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.messages.length > 0) {
            setMessages((prev) => {
              // Dedupe by ID
              const existingIds = new Set(prev.map((m) => m.id));
              const newMsgs = data.messages.filter(
                (m: ChatMessage) => !existingIds.has(m.id)
              );
              if (newMsgs.length === 0) return prev;
              return [...prev, ...newMsgs];
            });
            latestTimestamp.current =
              data.messages[data.messages.length - 1].timestamp;
          }
          setConnected(true);
          setPollCount((c) => c + 1);
        }
      } catch {
        setConnected(false);
      }
    }, 2000); // Poll every 2s for responsive feel

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Send message
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const data = await res.json();
        // Optimistically add the message
        setMessages((prev) => [...prev, data.message]);
        latestTimestamp.current = data.message.timestamp;
      }
    } catch {
      // Failed to send — could add error state
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-electric/10">
            <MessageSquare className="h-5 w-5 text-electric" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Chat</h2>
            <p className="text-sm text-muted-foreground">
              Talk to Klaw directly from CENTCOMM
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={`text-[10px] px-2 py-0.5 ${
              connected
                ? "border-success/30 text-success"
                : "border-alert/30 text-alert"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${
                connected ? "bg-success" : "bg-alert"
              }`}
            />
            {connected ? "Connected" : "Disconnected"}
          </Badge>
          <span className="text-[10px] text-muted-foreground/50">
            Poll #{pollCount}
          </span>
        </div>
      </div>

      {/* Messages area */}
      <Card className="flex-1 border-border bg-[#0a0a12] overflow-hidden">
        <CardContent className="p-0 h-full flex flex-col">
          <ScrollArea className="flex-1 p-4">
            {loading ? (
              <div className="flex items-center justify-center h-full py-20">
                <Loader2 className="h-6 w-6 animate-spin text-electric" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                <MessageSquare className="h-12 w-12 text-muted-foreground/20 mb-4" />
                <p className="text-sm text-muted-foreground">
                  No messages yet. Send a message to start chatting.
                </p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Messages are processed through the same pipeline as Telegram.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input area */}
          <div className="border-t border-border bg-card p-4">
            <div className="flex gap-3 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
                rows={1}
                className="flex-1 resize-none rounded-xl bg-muted border border-border px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-electric"
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-electric text-white hover:bg-electric-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/40 mt-2 text-center">
              Messages are injected into the NanoClaw message loop. Responses
              appear when the agent completes processing.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
