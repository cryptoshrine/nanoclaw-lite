"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";
import type { ContentEntry } from "@/lib/distribution-types";
import {
  CONTENT_STATUS_COLORS,
  CHANNEL_LABELS,
} from "@/lib/distribution-types";

export function ContentCalendar({
  entries,
}: {
  entries: ContentEntry[];
}) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <CalendarDays className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No content scheduled yet.</p>
        <p className="text-xs mt-1">
          Add entries to{" "}
          <code className="text-electric">distribution/content-calendar.json</code>{" "}
          to populate this view.
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="py-4 px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                  Date
                </th>
                <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                  Channel
                </th>
                <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                  Pillar
                </th>
                <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                  Title
                </th>
                <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const color = CONTENT_STATUS_COLORS[entry.status];
                return (
                  <tr
                    key={entry.id}
                    className="border-b border-border/50 hover:bg-sidebar-accent/30"
                  >
                    <td className="py-2 px-4 text-muted-foreground">
                      {entry.date}
                    </td>
                    <td className="py-2 px-4 text-foreground">
                      {CHANNEL_LABELS[entry.channel] ?? entry.channel}
                    </td>
                    <td className="py-2 px-4">
                      <Badge variant="outline" className="text-[9px]">
                        {entry.pillar}
                      </Badge>
                    </td>
                    <td className="py-2 px-4 text-foreground">
                      {entry.url ? (
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-electric hover:underline"
                        >
                          {entry.title}
                        </a>
                      ) : (
                        entry.title
                      )}
                    </td>
                    <td className="py-2 px-4">
                      <Badge
                        variant="outline"
                        className={`text-[9px] bg-${color}/10 text-${color} border-${color}/30`}
                      >
                        {entry.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
