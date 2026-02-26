"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, MemoryStick, HardDrive, Clock, RefreshCw } from "lucide-react";

interface HealthData {
  cpu: {
    cores: number;
    model: string;
    avgUsage: number;
    perCore: number[];
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
  } | null;
  system: {
    platform: string;
    arch: string;
    hostname: string;
    uptime: number;
    nodeVersion: string;
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function ProgressBar({
  value,
  color,
}: {
  value: number;
  color: string;
}) {
  const colorClass =
    value > 90
      ? "bg-alert"
      : value > 70
        ? "bg-amber"
        : color;

  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

export function HealthCards() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !health) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="border-border bg-card animate-pulse">
            <CardContent className="p-6 h-32" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          System Health
        </h3>
        <button
          onClick={fetchHealth}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* CPU */}
        <Card className="card-glow border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Cpu className="h-4 w-4 text-electric" />
                CPU
              </span>
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {health.cpu.avgUsage}%
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ProgressBar value={health.cpu.avgUsage} color="bg-electric" />
            <p className="text-[10px] text-muted-foreground">
              {health.cpu.cores} cores
            </p>
            {/* Per-core mini bars */}
            <div className="flex gap-0.5">
              {health.cpu.perCore.map((usage, i) => (
                <div
                  key={i}
                  className="flex-1 h-4 rounded-sm bg-muted overflow-hidden"
                  title={`Core ${i}: ${usage}%`}
                >
                  <div
                    className={`w-full transition-all duration-500 ${
                      usage > 90
                        ? "bg-alert"
                        : usage > 70
                          ? "bg-amber"
                          : "bg-electric"
                    }`}
                    style={{ height: `${usage}%`, marginTop: `${100 - usage}%` }}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Memory */}
        <Card className="card-glow border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <MemoryStick className="h-4 w-4 text-cyan" />
                Memory
              </span>
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {health.memory.usedPercent}%
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ProgressBar value={health.memory.usedPercent} color="bg-cyan" />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{formatBytes(health.memory.used)} used</span>
              <span>{formatBytes(health.memory.total)} total</span>
            </div>
          </CardContent>
        </Card>

        {/* Disk */}
        <Card className="card-glow border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <HardDrive className="h-4 w-4 text-purple-400" />
                Disk
              </span>
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {health.disk?.usedPercent ?? "—"}%
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {health.disk ? (
              <>
                <ProgressBar value={health.disk.usedPercent} color="bg-purple-400" />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{formatBytes(health.disk.used)} used</span>
                  <span>{formatBytes(health.disk.free)} free</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Unavailable</p>
            )}
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card className="card-glow border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Clock className="h-4 w-4 text-success" />
                System
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {formatUptime(health.system.uptime)}
            </p>
            <p className="text-[10px] text-muted-foreground">uptime</p>
            <div className="space-y-1 text-[10px] text-muted-foreground">
              <p>{health.system.hostname}</p>
              <p>
                {health.system.platform}/{health.system.arch}
              </p>
              <p>Node {health.system.nodeVersion}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
