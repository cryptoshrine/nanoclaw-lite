"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MemorySearch } from "@/components/memory/memory-search";
import {
  Brain,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react";

interface GroupInfo {
  name: string;
  folder: string;
  trigger: string;
  jid: string;
}

interface MemoryFile {
  name: string;
  relativePath: string;
  size: number;
  isDirectory: boolean;
}

interface FileTree {
  [key: string]: {
    files: MemoryFile[];
    dirs: string[];
  };
}

export default function MemoryPage() {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Load groups on mount
  useEffect(() => {
    async function loadGroups() {
      try {
        const res = await fetch("/api/groups");
        if (res.ok) {
          const data = await res.json();
          setGroups(Array.isArray(data) ? data : data.groups || []);
        }
      } catch {
        // silently fail
      }
    }
    loadGroups();
  }, []);

  // Load files when group is selected
  const loadGroupFiles = useCallback(async (folder: string) => {
    setSelectedGroup(folder);
    setLoadingFiles(true);
    setActiveFile(null);
    setFileContent("");
    setExpandedDirs(new Set());
    try {
      const res = await fetch(`/api/groups/${folder}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
        // Auto-expand root
        const rootDirs = (data.files || [])
          .filter((f: MemoryFile) => f.isDirectory && !f.relativePath.includes("/"))
          .map((f: MemoryFile) => f.relativePath);
        setExpandedDirs(new Set(rootDirs));
      }
    } catch {
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  // Load file content
  async function loadFile(folder: string, filePath: string) {
    setActiveFile(filePath);
    setLoadingContent(true);
    try {
      const res = await fetch(
        `/api/groups/${folder}/files?path=${encodeURIComponent(filePath)}`
      );
      if (res.ok) {
        const json = await res.json();
        setFileContent(json.content);
      } else {
        setFileContent("Failed to load file");
      }
    } catch {
      setFileContent("Error loading file");
    } finally {
      setLoadingContent(false);
    }
  }

  // Handle search result click
  function handleSearchResultClick(groupFolder: string, path: string) {
    if (selectedGroup !== groupFolder) {
      loadGroupFiles(groupFolder).then(() => {
        loadFile(groupFolder, path);
      });
    } else {
      loadFile(groupFolder, path);
    }
  }

  // Toggle directory expansion
  function toggleDir(dirPath: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }

  // Build file tree structure
  function buildFileTree(): FileTree {
    const tree: FileTree = { "": { files: [], dirs: [] } };

    const dirs = files.filter((f) => f.isDirectory);
    const regularFiles = files.filter((f) => !f.isDirectory);

    // Register all directories
    for (const dir of dirs) {
      tree[dir.relativePath] = { files: [], dirs: [] };
      const parent = dir.relativePath.includes("/")
        ? dir.relativePath.substring(0, dir.relativePath.lastIndexOf("/"))
        : "";
      if (!tree[parent]) tree[parent] = { files: [], dirs: [] };
      tree[parent].dirs.push(dir.relativePath);
    }

    // Place files in their parent directories
    for (const file of regularFiles) {
      const parent = file.relativePath.includes("/")
        ? file.relativePath.substring(0, file.relativePath.lastIndexOf("/"))
        : "";
      if (!tree[parent]) tree[parent] = { files: [], dirs: [] };
      tree[parent].files.push(file);
    }

    return tree;
  }

  function renderTreeNode(dirPath: string, tree: FileTree, depth: number) {
    const node = tree[dirPath];
    if (!node) return null;

    return (
      <>
        {/* Subdirectories */}
        {node.dirs.sort().map((childDir) => {
          const dirName = childDir.split("/").pop() || childDir;
          const isExpanded = expandedDirs.has(childDir);
          return (
            <div key={childDir}>
              <button
                onClick={() => toggleDir(childDir)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <FolderOpen className="h-3.5 w-3.5 text-amber shrink-0" />
                <span className="text-foreground font-medium truncate">
                  {dirName}
                </span>
              </button>
              {isExpanded && renderTreeNode(childDir, tree, depth + 1)}
            </div>
          );
        })}

        {/* Files */}
        {node.files
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((file) => (
            <button
              key={file.relativePath}
              onClick={() =>
                selectedGroup && loadFile(selectedGroup, file.relativePath)
              }
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                activeFile === file.relativePath
                  ? "bg-electric/10 text-electric"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              style={{ paddingLeft: `${depth * 16 + 24}px` }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">
                {(file.size / 1024).toFixed(1)}k
              </span>
            </button>
          ))}
      </>
    );
  }

  const tree = buildFileTree();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Memory Vault</h2>
        <p className="text-sm text-muted-foreground">
          Browse and search agent knowledge across all groups
        </p>
      </div>

      {/* Search */}
      <MemorySearch onResultClick={handleSearchResultClick} />

      {/* File browser */}
      <div className="grid gap-4 lg:grid-cols-4">
        {/* Left: Group selector + File tree */}
        <div className="space-y-4 lg:col-span-1">
          {/* Group selector */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Brain className="h-4 w-4 text-electric" />
                Agent Groups
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <div className="px-2">
                {groups.map((group) => (
                  <button
                    key={group.folder}
                    onClick={() => loadGroupFiles(group.folder)}
                    className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                      selectedGroup === group.folder
                        ? "bg-electric/10 text-electric"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{group.name}</p>
                      <p className="text-[10px] font-mono opacity-60">
                        {group.folder}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* File tree */}
          {selectedGroup && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-electric" />
                    Files
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-border"
                  >
                    {files.filter((f) => !f.isDirectory).length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ScrollArea className="h-[400px]">
                  {loadingFiles ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="px-1">
                      {renderTreeNode("", tree, 0)}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: File content viewer */}
        <Card className="border-border bg-card lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="h-4 w-4" />
              {activeFile ? (
                <span className="font-mono">
                  {selectedGroup}/{activeFile}
                </span>
              ) : (
                "Select a file to view"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              {loadingContent ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : activeFile ? (
                <pre className="p-6 text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                  {fileContent}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Brain className="h-12 w-12 mb-4 opacity-30" />
                  <p className="text-sm">
                    Select a group and file to view its contents
                  </p>
                  <p className="text-xs mt-1 opacity-60">
                    Or use the search above to find specific information
                  </p>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
