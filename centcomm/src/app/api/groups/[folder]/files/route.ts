import { NextResponse } from "next/server";
import { getRegisteredGroups, getGroupFiles, readGroupFile } from "@/lib/config";

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
    const filePath = searchParams.get("path");

    if (filePath) {
      // Read a specific file
      const content = readGroupFile(folder, filePath);
      if (content === null) {
        return NextResponse.json(
          { error: "File not found or access denied" },
          { status: 404 }
        );
      }
      return NextResponse.json({ path: filePath, content });
    }

    // List all files
    const files = getGroupFiles(folder);
    return NextResponse.json({ files });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch files", detail: String(error) },
      { status: 500 }
    );
  }
}
