"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { GrowthTarget } from "@/lib/distribution-types";

export function GrowthTargets({
  targets,
}: {
  targets: GrowthTarget[];
}) {
  return (
    <Card>
      <CardContent className="py-4 px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-4 font-medium text-muted-foreground">
                  Metric
                </th>
                <th className="text-right py-2 px-4 font-medium text-muted-foreground">
                  Current
                </th>
                <th className="text-right py-2 px-4 font-medium text-electric">
                  Week 2
                </th>
                <th className="text-right py-2 px-4 font-medium text-amber">
                  Month 1
                </th>
                <th className="text-right py-2 px-4 font-medium text-success">
                  Month 3
                </th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr
                  key={t.metric}
                  className="border-b border-border/50 hover:bg-sidebar-accent/30"
                >
                  <td className="py-2 px-4 text-foreground font-medium">
                    {t.metric}
                  </td>
                  <td className="py-2 px-4 text-right text-muted-foreground">
                    {t.current}
                  </td>
                  <td className="py-2 px-4 text-right text-electric">
                    {t.week2}
                  </td>
                  <td className="py-2 px-4 text-right text-amber">
                    {t.month1}
                  </td>
                  <td className="py-2 px-4 text-right text-success">
                    {t.month3}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
