import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();

    // Messages per day (last 14 days)
    const messagesPerDay = db
      .prepare(
        `SELECT date(timestamp) as day, COUNT(*) as count
         FROM messages
         WHERE timestamp >= datetime('now', '-14 days')
         GROUP BY date(timestamp)
         ORDER BY day`
      )
      .all() as { day: string; count: number }[];

    // Messages per group (top 10)
    const messagesPerGroup = db
      .prepare(
        `SELECT chat_jid, COUNT(*) as count
         FROM messages
         GROUP BY chat_jid
         ORDER BY count DESC
         LIMIT 10`
      )
      .all() as { chat_jid: string; count: number }[];

    // Task success rate over time (last 30 days)
    const taskRunsByDay = db
      .prepare(
        `SELECT date(run_at) as day, status, COUNT(*) as count
         FROM task_run_logs
         WHERE run_at >= datetime('now', '-30 days')
         GROUP BY date(run_at), status
         ORDER BY day`
      )
      .all() as { day: string; status: string; count: number }[];

    // Task run duration histogram
    const taskDurations = db
      .prepare(
        `SELECT
           CASE
             WHEN duration_ms < 5000 THEN '<5s'
             WHEN duration_ms < 30000 THEN '5-30s'
             WHEN duration_ms < 60000 THEN '30s-1m'
             WHEN duration_ms < 300000 THEN '1-5m'
             ELSE '>5m'
           END as bucket,
           COUNT(*) as count
         FROM task_run_logs
         GROUP BY bucket
         ORDER BY MIN(duration_ms)`
      )
      .all() as { bucket: string; count: number }[];

    // Task status distribution
    const taskStatusDist = db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM scheduled_tasks
         GROUP BY status`
      )
      .all() as { status: string; count: number }[];

    return NextResponse.json({
      messagesPerDay,
      messagesPerGroup,
      taskRunsByDay,
      taskDurations,
      taskStatusDist,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch metrics", detail: String(error) },
      { status: 500 }
    );
  }
}
