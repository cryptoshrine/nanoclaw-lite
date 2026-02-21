import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PATHS } from "@/lib/paths";
import { getRegisteredGroups } from "@/lib/config";

export const dynamic = "force-dynamic";

export interface DocEntry {
  title: string;
  path: string;
  relativePath: string;
  group: string;
  groupName: string;
  category: string;
  size: number;
  mtime: string;
  excerpt: string;
}

/** Directories to scan for documents (relative to group folder) */
const DOC_DIRS = [
  { dir: "reports", category: "Reports" },
  { dir: "ball-ai-test-results", category: "Test Results" },
  { dir: "memory", category: "Research & Briefs" },
  { dir: "tasks", category: "Task Reports" },
  { dir: "plans", category: "Plans" },
  { dir: "betting/output", category: "Betting Analysis" },
  // Ball-AI nested docs
  { dir: "BALL-AI-2/docs/reports", category: "Bug Reports" },
  { dir: "BALL-AI-2/.agents/docs", category: "Agent Docs" },
  { dir: "BALL-AI-2/.claude/commands/business/report", category: "Business Strategy" },
  { dir: "BALL-AI-2/.claude/commands/infrastructure/report", category: "Infrastructure" },
];

/** Files that should be excluded */
const EXCLUDE_FILES = new Set(["CLAUDE.md", "SOUL.md", "USER.md", "MEMORY.md"]);

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.md$/, "")
    .replace(/\.json$/, "")
    .replace(/\.txt$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractExcerpt(content: string, maxLen = 150): string {
  // Skip markdown headers and frontmatter
  const lines = content.split("\n");
  const textLines = lines.filter(
    (l) =>
      l.trim() &&
      !l.startsWith("#") &&
      !l.startsWith("---") &&
      !l.startsWith("**") &&
      !l.startsWith("|") &&
      !l.startsWith("```")
  );
  const text = textLines.slice(0, 3).join(" ").trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function scanGroupForDocs(groupFolder: string, groupName: string): DocEntry[] {
  const docs: DocEntry[] = [];
  const groupPath = path.join(PATHS.groups, groupFolder);

  for (const { dir, category } of DOC_DIRS) {
    const fullDir = path.join(groupPath, dir);
    if (!fs.existsSync(fullDir)) continue;

    try {
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) continue;
        if (!entry.name.endsWith(".md") && !entry.name.endsWith(".txt")) continue;
        if (EXCLUDE_FILES.has(entry.name)) continue;

        const filePath = path.join(fullDir, entry.name);
        const stat = fs.statSync(filePath);
        const relativePath = path.relative(groupPath, filePath).replace(/\\/g, "/");

        let excerpt = "";
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          excerpt = extractExcerpt(content);
        } catch {
          // ignore
        }

        docs.push({
          title: titleFromFilename(entry.name),
          path: filePath,
          relativePath,
          group: groupFolder,
          groupName,
          category,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          excerpt,
        });
      }
    } catch {
      // directory not readable
    }
  }

  // Also scan root-level .md files that look like reports (not config files)
  try {
    const rootEntries = fs.readdirSync(groupPath, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isDirectory()) continue;
      if (!entry.name.endsWith(".md")) continue;
      if (EXCLUDE_FILES.has(entry.name)) continue;
      // Skip common config files
      if (["package.json", "tsconfig.json", "README.md"].includes(entry.name)) continue;

      const filePath = path.join(groupPath, entry.name);
      const stat = fs.statSync(filePath);
      // Only include files > 500 bytes (skip stubs)
      if (stat.size < 500) continue;

      let excerpt = "";
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        excerpt = extractExcerpt(content);
      } catch {
        // ignore
      }

      docs.push({
        title: titleFromFilename(entry.name),
        path: filePath,
        relativePath: entry.name,
        group: groupFolder,
        groupName,
        category: "General",
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        excerpt,
      });
    }
  } catch {
    // ignore
  }

  return docs;
}

export function GET() {
  try {
    const groups = getRegisteredGroups();
    const allDocs: DocEntry[] = [];

    for (const group of groups) {
      const docs = scanGroupForDocs(group.folder, group.name);
      allDocs.push(...docs);
    }

    // Sort by modification time, newest first
    allDocs.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

    // Build category summary
    const categories: Record<string, number> = {};
    for (const doc of allDocs) {
      categories[doc.category] = (categories[doc.category] || 0) + 1;
    }

    return NextResponse.json({
      docs: allDocs.map(({ path: _p, ...rest }) => rest), // strip absolute path
      categories,
      total: allDocs.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to scan docs", detail: String(error) },
      { status: 500 }
    );
  }
}
