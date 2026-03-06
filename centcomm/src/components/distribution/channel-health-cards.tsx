"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, MessageCircle, Youtube, Mail } from "lucide-react";
import type { ChannelHealth, ChannelStatus } from "@/lib/distribution-types";

const STATUS_STYLES: Record<ChannelStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-success/10 text-success border-success/30" },
  planned: { label: "Planned", cls: "bg-amber/10 text-amber border-amber/30" },
  not_started: { label: "Not Started", cls: "bg-muted text-muted-foreground border-border" },
};

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  "X / Twitter": Radio,
  Reddit: MessageCircle,
  YouTube: Youtube,
  Newsletter: Mail,
};

export function ChannelHealthCards({
  channels,
}: {
  channels: ChannelHealth[];
}) {
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {channels.map((ch) => {
        const Icon = CHANNEL_ICONS[ch.name] ?? Radio;
        const style = STATUS_STYLES[ch.status];
        return (
          <Card key={ch.name}>
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-electric" />
                  <span className="text-sm font-medium text-foreground">
                    {ch.name}
                  </span>
                </div>
                <Badge variant="outline" className={`text-[10px] ${style.cls}`}>
                  {style.label}
                </Badge>
              </div>
              {ch.handle && (
                <div className="text-xs text-electric mb-1">{ch.handle}</div>
              )}
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                {ch.description}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
