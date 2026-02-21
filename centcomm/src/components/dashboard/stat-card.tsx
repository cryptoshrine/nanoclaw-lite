import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "neutral";
  color?: "blue" | "green" | "amber" | "red" | "cyan" | "purple";
}

const colorMap = {
  blue: "text-electric",
  green: "text-success",
  amber: "text-amber",
  red: "text-alert",
  cyan: "text-cyan",
  purple: "text-purple-400",
};

const bgColorMap = {
  blue: "bg-electric/10",
  green: "bg-success/10",
  amber: "bg-amber/10",
  red: "bg-alert/10",
  cyan: "bg-cyan/10",
  purple: "bg-purple-400/10",
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = "blue",
}: StatCardProps) {
  return (
    <Card className="card-glow border-border bg-card">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="text-3xl font-bold tabular-nums text-foreground">
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-lg",
              bgColorMap[color]
            )}
          >
            <Icon className={cn("h-6 w-6", colorMap[color])} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
