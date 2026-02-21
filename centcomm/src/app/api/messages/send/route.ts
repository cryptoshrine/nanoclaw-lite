import { NextResponse } from "next/server";
import { sendMessage } from "@/lib/ipc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, target_group } = body;

    if (!text || !target_group) {
      return NextResponse.json(
        { error: "Missing required fields: text, target_group" },
        { status: 400 }
      );
    }

    const filePath = sendMessage({ text, target_group });
    return NextResponse.json({ success: true, ipcFile: filePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Cannot resolve JID") ? 404 : 500;
    return NextResponse.json(
      { error: "Failed to send message", detail: message },
      { status }
    );
  }
}
