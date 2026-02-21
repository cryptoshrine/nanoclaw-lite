import { NextResponse } from "next/server";
import { getRegisteredGroups, getGroupFiles, readGroupFile } from "@/lib/config";
import { getMessagesByGroup, getAllTasks } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ folder: string }> }
) {
  try {
    const { folder } = await params;
    const groups = getRegisteredGroups();
    const group = groups.find((g) => g.folder === folder);
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const includeMessages = searchParams.get("messages") !== "false";
    const includeFiles = searchParams.get("files") !== "false";
    const messageLimit = parseInt(searchParams.get("messageLimit") ?? "50", 10);

    const messages = includeMessages
      ? getMessagesByGroup(group.jid, messageLimit)
      : [];
    const tasks = getAllTasks().filter((t) => t.group_folder === folder);
    const files = includeFiles ? getGroupFiles(folder) : [];

    return NextResponse.json({
      ...group,
      messages,
      tasks,
      files,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch group details", detail: String(error) },
      { status: 500 }
    );
  }
}
