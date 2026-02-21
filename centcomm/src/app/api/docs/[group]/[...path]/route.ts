import { NextResponse } from "next/server";
import { readGroupFile } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ group: string; path: string[] }> }
) {
  try {
    const { group, path: pathSegments } = await params;
    const filePath = pathSegments.join("/");

    const content = readGroupFile(group, filePath);
    if (content === null) {
      return NextResponse.json(
        { error: "File not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({ content, path: filePath, group });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to read document", detail: String(error) },
      { status: 500 }
    );
  }
}
