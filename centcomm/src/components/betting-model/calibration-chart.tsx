"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from "recharts";
import type { CalibrationBucket } from "@/lib/backtest-types";

interface CalibrationChartProps {
  raw: CalibrationBucket[];
  calibrated: CalibrationBucket[];
  title?: string;
}

function bucketToMidpoint(bucket: string): number {
  const match = bucket.match(/(\d+)%-(\d+)%/);
  if (!match) return 0;
  return (parseInt(match[1]) + parseInt(match[2])) / 200;
}

export function CalibrationChart({ raw, calibrated, title = "Calibration: Predicted vs Actual" }: CalibrationChartProps) {
  const rawData = raw.map((b) => ({
    predicted: Math.round(b.predicted_avg * 100),
    actual: Math.round(b.actual_rate * 100),
    count: b.count,
    bucket: b.bucket,
    gap: b.gap,
  }));

  const calibratedData = calibrated.map((b) => ({
    predicted: Math.round(b.predicted_avg * 100),
    actual: Math.round(b.actual_rate * 100),
    count: b.count,
    bucket: b.bucket,
    gap: b.gap,
  }));

  const perfectLine = [
    { predicted: 0, actual: 0 },
    { predicted: 100, actual: 100 },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              dataKey="predicted"
              domain={[0, 100]}
              name="Predicted"
              unit="%"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              label={{ value: "Predicted %", position: "bottom", offset: 5, fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="actual"
              domain={[0, 100]}
              name="Actual"
              unit="%"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              label={{ value: "Actual %", angle: -90, position: "insideLeft", offset: 5, fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
                fontSize: 12,
              }}
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div className="bg-card border border-border rounded-md p-2 text-xs space-y-1">
                    <div className="font-medium">{d.bucket}</div>
                    <div>Predicted: {d.predicted}%</div>
                    <div>Actual: {d.actual}%</div>
                    <div>Gap: {d.gap > 0 ? "+" : ""}{(d.gap * 100).toFixed(1)}pp</div>
                    <div className="text-muted-foreground">{d.count} predictions</div>
                  </div>
                );
              }}
            />
            <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 11 }} />
            <Scatter
              name="Perfect"
              data={perfectLine}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              line
              shape={() => null}
              legendType="line"
            />
            <Scatter
              name="Raw Model"
              data={rawData}
              fill="#ef4444"
              fillOpacity={0.7}
              shape="circle"
              r={5}
            />
            <Scatter
              name="Calibrated (Isotonic)"
              data={calibratedData}
              fill="#22c55e"
              fillOpacity={0.7}
              shape="diamond"
              r={5}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface CalibrationTableProps {
  raw: CalibrationBucket[];
  calibrated: CalibrationBucket[];
}

export function CalibrationTable({ raw, calibrated }: CalibrationTableProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Calibration Detail</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-2">Bucket</th>
                <th className="text-right py-2 px-2">Raw Pred</th>
                <th className="text-right py-2 px-2">Raw Actual</th>
                <th className="text-right py-2 px-2">Raw Gap</th>
                <th className="text-right py-2 px-2">Cal Pred</th>
                <th className="text-right py-2 px-2">Cal Actual</th>
                <th className="text-right py-2 px-2">Cal Gap</th>
                <th className="text-right py-2 px-2">Samples</th>
              </tr>
            </thead>
            <tbody>
              {raw.map((r, i) => {
                const c = calibrated[i];
                return (
                  <tr key={r.bucket} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-1.5 px-2 font-medium">{r.bucket}</td>
                    <td className="text-right py-1.5 px-2">{(r.predicted_avg * 100).toFixed(1)}%</td>
                    <td className="text-right py-1.5 px-2">{(r.actual_rate * 100).toFixed(1)}%</td>
                    <td className={`text-right py-1.5 px-2 ${Math.abs(r.gap) > 0.1 ? "text-alert" : Math.abs(r.gap) > 0.05 ? "text-amber" : "text-success"}`}>
                      {r.gap > 0 ? "+" : ""}{(r.gap * 100).toFixed(1)}pp
                    </td>
                    <td className="text-right py-1.5 px-2">{c ? (c.predicted_avg * 100).toFixed(1) + "%" : "—"}</td>
                    <td className="text-right py-1.5 px-2">{c ? (c.actual_rate * 100).toFixed(1) + "%" : "—"}</td>
                    <td className={`text-right py-1.5 px-2 ${c && Math.abs(c.gap) > 0.1 ? "text-alert" : c && Math.abs(c.gap) > 0.05 ? "text-amber" : "text-success"}`}>
                      {c ? `${c.gap > 0 ? "+" : ""}${(c.gap * 100).toFixed(1)}pp` : "—"}
                    </td>
                    <td className="text-right py-1.5 px-2 text-muted-foreground">{r.count}{c ? ` / ${c.count}` : ""}</td>
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
