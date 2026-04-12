import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import type { TemplateData, EmailTemplate } from "@/lib/outreach-types";

export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "..", "groups", "main", "pe-vc-outreach");
const TEMPLATES_FILE = path.join(DATA_DIR, "templates.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readTemplates(): TemplateData {
  ensureDataDir();
  if (!existsSync(TEMPLATES_FILE)) {
    const empty: TemplateData = { templates: [], updatedAt: new Date().toISOString() };
    writeFileSync(TEMPLATES_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(readFileSync(TEMPLATES_FILE, "utf-8"));
}

function writeTemplates(data: TemplateData) {
  ensureDataDir();
  data.updatedAt = new Date().toISOString();
  writeFileSync(TEMPLATES_FILE, JSON.stringify(data, null, 2));
}

export async function GET() {
  try {
    const data = readTemplates();
    return NextResponse.json({ templates: data.templates });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = readTemplates();

    const now = new Date().toISOString();
    const template: EmailTemplate = {
      id: `tpl-${crypto.randomUUID().slice(0, 8)}`,
      name: body.name,
      subject: body.subject,
      body: body.body,
      stage: body.stage,
      sequence: body.sequence ?? 1,
      createdAt: now,
      updatedAt: now,
    };

    data.templates.push(template);
    writeTemplates(data);

    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
