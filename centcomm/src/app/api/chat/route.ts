import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { PATHS } from "@/lib/paths";
import { getMessagesByGroup, type DbMessage } from "@/lib/db";
import { getRegisteredGroups } from "@/lib/config";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// Write-capable DB connection (separate from the read-only one in lib/db)
let _writeDb: Database.Database | null = null;

function getWriteDb(): Database.Database {
  if (!_writeDb) {
    _writeDb = new Database(PATHS.database, { readonly: false });
    _writeDb.pragma("busy_timeout = 5000");
  }
  return _writeDb;
}

function getMainGroupJid(): string | null {
  const groups = getRegisteredGroups();
  const main = groups.find((g) => g.folder === "main");
  return main?.jid ?? null;
}

/**
 * GET /api/chat — returns recent messages for the main group
 * Query params: ?limit=50&since=<ISO timestamp>
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const since = searchParams.get("since");

  const mainJid = getMainGroupJid();
  if (!mainJid) {
    return NextResponse.json({ error: "Main group not found" }, { status: 404 });
  }

  let messages: DbMessage[];

  if (since) {
    // Get messages newer than a timestamp (for polling)
    const db = getWriteDb(); // use write db since read db might not see latest
    messages = db
      .prepare(
        "SELECT * FROM messages WHERE chat_jid = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?"
      )
      .all(mainJid, since, limit) as DbMessage[];
  } else {
    // Get most recent messages (initial load)
    messages = getMessagesByGroup(mainJid, limit).reverse();
  }

  return NextResponse.json({
    messages,
    mainJid,
  });
}

/**
 * POST /api/chat — sends a message by injecting it into SQLite
 * Body: { text: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or empty text field" },
        { status: 400 }
      );
    }

    const mainJid = getMainGroupJid();
    if (!mainJid) {
      return NextResponse.json(
        { error: "Main group not found" },
        { status: 404 }
      );
    }

    const db = getWriteDb();
    const now = new Date().toISOString();
    const msgId = `centcomm-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    db.prepare(
      `INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(msgId, mainJid, "centcomm", "CryptoShrine", text.trim(), now, 0);

    return NextResponse.json({
      success: true,
      message: {
        id: msgId,
        chat_jid: mainJid,
        sender: "centcomm",
        sender_name: "CryptoShrine",
        content: text.trim(),
        timestamp: now,
        is_from_me: 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to send message", detail: message },
      { status: 500 }
    );
  }
}
