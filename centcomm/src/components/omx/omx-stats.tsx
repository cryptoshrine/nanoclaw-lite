"use client";

import { useState, useEffect, useCallback } from "react";
import { Zap, CheckCircle, XCircle, Users } from "lucide-react";

interface WorkflowSummary {
  id: string;
  status: string;
  specialistsSpawned: number;
}

export function OmxStats() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/omx/workflows?status=all");
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [load]);

  const active = workflows.filter((w) => w.status === "active").length;
  const completed = workflows.filter((w) => w.status === "completed").length;
  const failed = workflows.filter((w) => w.status === "failed").length;
  const specialists = workflows.reduce(
    (sum, w) => sum + (w.specialistsSpawned || 0),
    0
  );

  const cards = [
    {
      label: "Active",
      value: active,
      icon: Zap,
      color: "text-amber-400",
      bg: "bg-amber-400/10",
    },
    {
      label: "Completed",
      value: completed,
      icon: CheckCircle,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
    },
    {
      label: "Failed",
      value: failed,
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-400/10",
    },
    {
      label: "Specialists",
      value: specialists,
      icon: Users,
      color: "text-electric",
      bg: "bg-electric/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-border bg-card p-4 flex items-center gap-3"
        >
          <div className={`rounded-md p-2 ${c.bg}`}>
            <c.icon className={`h-5 w-5 ${c.color}`} />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{c.value}</p>
            <p className="text-xs text-muted-foreground">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
