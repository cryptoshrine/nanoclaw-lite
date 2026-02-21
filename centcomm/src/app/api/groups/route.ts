import { NextResponse } from "next/server";
import { getRegisteredGroups } from "@/lib/config";
import { getMessageCountByGroup, getAllTasks } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const groups = getRegisteredGroups();
    const messageCounts = getMessageCountByGroup();
    const tasks = getAllTasks();

    const enriched = groups.map((group) => {
      const msgCount =
        messageCounts.find((m) => m.chat_jid === group.jid)?.count ?? 0;
      const groupTasks = tasks.filter((t) => t.group_folder === group.folder);
      const activeTasks = groupTasks.filter((t) => t.status === "active").length;

      return {
        ...group,
        messageCount: msgCount,
        taskCount: groupTasks.length,
        activeTaskCount: activeTasks,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch groups", detail: String(error) },
      { status: 500 }
    );
  }
}
