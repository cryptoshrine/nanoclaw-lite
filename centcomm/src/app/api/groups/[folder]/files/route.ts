import { NextResponse } from "next/server";
import { getRegisteredGroups, getGroupFiles, readGroupFile, writeGroupFile } from "@/lib/config";

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

export async function POST(
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

    const body = await request.json();
    const { path: filePath, content } = body;

    if (!filePath || typeof content !== "string") {
      return NextResponse.json(
        { error: "Missing required fields: path, content" },
        { status: 400 }
      );
    }

    const result = writeGroupFile(folder, filePath, content);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      path: filePath,
      backupPath: result.backupPath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save file", detail: String(error) },
      { status: 500 }
    );
  }
}
