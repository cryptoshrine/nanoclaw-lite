import { NextResponse } from "next/server";
import { getSystemStats } from "@/lib/db";
import { getRegisteredGroups } from "@/lib/config";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const stats = getSystemStats();
    const groups = getRegisteredGroups();

    return NextResponse.json({
      groups: {
        total: groups.length,
        list: groups.map((g) => ({ name: g.name, folder: g.folder })),
      },
      messages: stats.messages,
      tasks: stats.tasks,
      teams: stats.teams,
      members: stats.members,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch stats", detail: String(error) },
      { status: 500 }
    );
  }
}
