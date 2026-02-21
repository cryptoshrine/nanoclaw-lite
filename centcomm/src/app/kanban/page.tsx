"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KanbanColumn } from "@/components/kanban/kanban-column";
import { SortableTask } from "@/components/kanban/sortable-task";
import { TaskCard, type KanbanTask } from "@/components/kanban/task-card";
import { TaskDetail } from "@/components/kanban/task-detail";
import { CreateTaskDialog } from "@/components/kanban/create-task-dialog";
import {
  DevTaskCard,
  type DevTask,
} from "@/components/kanban/dev-task-card";
import { DevTaskDetail } from "@/components/kanban/dev-task-detail";
import {
  SearchFilters,
  defaultFilters,
  hasActiveFilters,
  type SearchFiltersState,
} from "@/components/kanban/search-filters";
import { useToast } from "@/components/ui/toast";
import { KanbanAnalytics } from "@/components/kanban/kanban-analytics";
import { BatchActionBar } from "@/components/kanban/batch-action-bar";
import {
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  Plus,
  RefreshCw,
  Circle,
  Loader2,
  Ban,
  Code2,
  Timer,
} from "lucide-react";

interface GroupInfo {
  name: string;
  folder: string;
  jid: string;
}

// ── Scheduled Tasks Columns ──
const scheduledColumns: {
  status: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  headerBg: string;
}[] = [
  {
    status: "active",
    label: "Active",
    icon: <Play className="h-4 w-4" />,
    color: "text-success",
    headerBg: "border-success/30",
  },
  {
    status: "paused",
    label: "Paused",
    icon: <Pause className="h-4 w-4" />,
    color: "text-amber",
    headerBg: "border-amber/30",
  },
  {
    status: "completed",
    label: "Completed",
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: "text-electric",
    headerBg: "border-electric/30",
  },
  {
    status: "failed",
    label: "Failed",
    icon: <AlertTriangle className="h-4 w-4" />,
    color: "text-alert",
    headerBg: "border-alert/30",
  },
];

// ── Dev Tasks Columns ──
const devColumns: {
  status: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  headerBg: string;
}[] = [
  {
    status: "Pending",
    label: "Pending",
    icon: <Circle className="h-4 w-4" />,
    color: "text-muted-foreground",
    headerBg: "border-border",
  },
  {
    status: "In Progress",
    label: "In Progress",
    icon: <Loader2 className="h-4 w-4" />,
    color: "text-electric",
    headerBg: "border-electric/30",
  },
  {
    status: "Completed",
    label: "Completed",
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: "text-success",
    headerBg: "border-success/30",
  },
  {
    status: "Blocked",
    label: "Blocked",
    icon: <Ban className="h-4 w-4" />,
    color: "text-alert",
    headerBg: "border-alert/30",
  },
];

// Valid status transitions for scheduled tasks (drag targets)
const scheduledTransitions: Record<string, string[]> = {
  active: ["paused"],           // active → pause
  paused: ["active"],           // paused → resume
  // completed and failed can't be dragged to new states
};

// Map target column status → API action for scheduled tasks
const scheduledActionMap: Record<string, "pause" | "resume" | "cancel"> = {
  paused: "pause",
  active: "resume",
};

export default function KanbanPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"scheduled" | "dev">("dev");
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [devTasks, setDevTasks] = useState<DevTask[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const [selectedDevTask, setSelectedDevTask] = useState<DevTask | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [devDetailOpen, setDevDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState("all");
  const [filters, setFilters] = useState<SearchFiltersState>(defaultFilters);

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadData = useCallback(async () => {
    try {
      const [tasksRes, groupsRes, devTasksRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/groups"),
        fetch("/api/dev-tasks"),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks || []);
      }
      if (groupsRes.ok) {
        const data = await groupsRes.json();
        setGroups(Array.isArray(data) ? data : data.groups || []);
      }
      if (devTasksRes.ok) {
        const data = await devTasksRes.json();
        setDevTasks(data.tasks || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ── Scheduled task actions ──
  async function handleAction(
    taskId: string,
    action: "pause" | "resume" | "cancel"
  ) {
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const newStatus =
            action === "pause"
              ? "paused"
              : action === "resume"
              ? "active"
              : "cancelled";
          return { ...t, status: newStatus };
        })
      );

      setDetailOpen(false);
      setSelectedTask(null);
      setTimeout(loadData, 2000);

      const actionLabels = { pause: "paused", resume: "resumed", cancel: "cancelled" };
      toast(`Task ${actionLabels[action]}`, "success");
    } catch {
      toast("Failed to update task", "error");
    }
  }

  // ── Dev task status update ──
  async function handleDevTaskStatusChange(
    task: DevTask,
    newStatus: DevTask["status"]
  ) {
    try {
      const res = await fetch(`/api/dev-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: task.source, status: newStatus }),
      });

      if (res.ok) {
        // Optimistic update
        setDevTasks((prev) =>
          prev.map((t) =>
            t.id === task.id && t.source === task.source
              ? { ...t, status: newStatus }
              : t
          )
        );
        toast(`#${task.id} → ${newStatus}`, "success");
      } else {
        toast("Failed to update task status", "error");
      }
    } catch {
      toast("Failed to update task status", "error");
    }
  }

  // ── Filtering ──
  const query = filters.query.toLowerCase();

  const filteredTasks = tasks.filter((t) => {
    // Group filter
    if (groupFilter !== "all" && t.group_folder !== groupFilter) return false;
    // Search query
    if (
      query &&
      !t.prompt.toLowerCase().includes(query) &&
      !t.group_folder.toLowerCase().includes(query) &&
      !t.schedule_value.toLowerCase().includes(query)
    )
      return false;
    // Schedule type filter
    if (
      filters.scheduleType !== "all" &&
      t.schedule_type !== filters.scheduleType
    )
      return false;
    return true;
  });

  const filteredDevTasks = devTasks.filter((t) => {
    // Group filter
    if (groupFilter !== "all" && t.source !== groupFilter) return false;
    // Search query
    if (
      query &&
      !t.title.toLowerCase().includes(query) &&
      !t.summary.toLowerCase().includes(query) &&
      !(t.category || "").toLowerCase().includes(query)
    )
      return false;
    // Priority filter
    if (filters.priority !== "all" && !t.priority.includes(filters.priority))
      return false;
    // Size filter
    if (filters.size !== "all" && !t.size.includes(filters.size)) return false;
    return true;
  });

  function getScheduledTasksForColumn(status: string) {
    return filteredTasks.filter((t) => t.status === status);
  }

  function getDevTasksForColumn(status: string) {
    return filteredDevTasks.filter((t) => t.status === status);
  }

  // ── Drag-and-drop handlers ──
  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(_event: DragOverEvent) {
    // Visual feedback is handled by the KanbanColumn isOver state
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeIdStr = String(active.id);
    const overId = String(over.id);

    if (tab === "dev") {
      // Dev task drag: find the task and the target column
      const task = devTasks.find(
        (t) => `dev-${t.source}-${t.id}` === activeIdStr
      );
      if (!task) return;

      // Determine target column — overId could be a column id or another task id
      let targetStatus: string | null = null;

      // Check if dropped on a column directly
      const colMatch = devColumns.find((c) => c.status === overId);
      if (colMatch) {
        targetStatus = colMatch.status;
      } else {
        // Dropped on another task — find which column that task belongs to
        const overTask = devTasks.find(
          (t) => `dev-${t.source}-${t.id}` === overId
        );
        if (overTask) {
          targetStatus = overTask.status;
        }
      }

      if (targetStatus && targetStatus !== task.status) {
        handleDevTaskStatusChange(task, targetStatus as DevTask["status"]);
      }
    } else {
      // Scheduled task drag
      const task = tasks.find((t) => `sched-${t.id}` === activeIdStr);
      if (!task) return;

      let targetStatus: string | null = null;

      const colMatch = scheduledColumns.find((c) => c.status === overId);
      if (colMatch) {
        targetStatus = colMatch.status;
      } else {
        const overTask = tasks.find((t) => `sched-${t.id}` === overId);
        if (overTask) {
          targetStatus = overTask.status;
        }
      }

      if (
        targetStatus &&
        targetStatus !== task.status &&
        scheduledTransitions[task.status]?.includes(targetStatus)
      ) {
        const action = scheduledActionMap[targetStatus];
        if (action) {
          handleAction(task.id, action);
        }
      }
    }
  }

  // ── Find active drag item for overlay ──
  function getActiveDragItem() {
    if (!activeId) return null;

    if (tab === "dev") {
      return devTasks.find(
        (t) => `dev-${t.source}-${t.id}` === activeId
      ) || null;
    } else {
      return tasks.find((t) => `sched-${t.id}` === activeId) || null;
    }
  }

  // Stats
  const pendingDevTasks = devTasks.filter((t) => t.status === "Pending").length;
  const activeScheduled = tasks.filter((t) => t.status === "active").length;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Kanban Board</h2>
          <p className="text-sm text-muted-foreground">Loading tasks...</p>
        </div>
      </div>
    );
  }

  const activeDragItem = getActiveDragItem();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Kanban Board</h2>
          <p className="text-sm text-muted-foreground">
            Visual task management and scheduling — drag tasks between columns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-[160px] bg-muted border-border text-sm">
              <SelectValue placeholder="All Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Groups</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.folder} value={g.folder}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={() => loadData()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          {tab === "scheduled" && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-electric px-3 py-2 text-sm font-medium text-white hover:bg-electric-dim transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Task
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "scheduled" | "dev")}
      >
        <TabsList className="bg-muted border border-border">
          <TabsTrigger
            value="dev"
            className="gap-2 data-[state=active]:bg-card"
          >
            <Code2 className="h-4 w-4" />
            Dev Tasks
            {pendingDevTasks > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-electric/30 text-electric"
              >
                {pendingDevTasks}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="scheduled"
            className="gap-2 data-[state=active]:bg-card"
          >
            <Timer className="h-4 w-4" />
            Scheduled
            {activeScheduled > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-success/30 text-success"
              >
                {activeScheduled}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search & Filters */}
      <SearchFilters
        filters={filters}
        onFiltersChange={setFilters}
        tab={tab}
        resultCount={tab === "dev" ? filteredDevTasks.length : filteredTasks.length}
        totalCount={tab === "dev" ? devTasks.length : tasks.length}
      />

      {/* Analytics strip */}
      <KanbanAnalytics tasks={tasks} devTasks={devTasks} tab={tab} />

      {/* Kanban columns with DnD */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {tab === "dev" ? (
          <div className="grid grid-cols-4 gap-4">
            {devColumns.map((col) => {
              const colTasks = getDevTasksForColumn(col.status);
              const taskIds = colTasks.map(
                (t) => `dev-${t.source}-${t.id}`
              );
              return (
                <KanbanColumn
                  key={col.status}
                  id={col.status}
                  label={col.label}
                  icon={col.icon}
                  color={col.color}
                  headerBg={col.headerBg}
                  items={taskIds}
                  count={colTasks.length}
                >
                  {colTasks.map((task) => {
                    const sortableId = `dev-${task.source}-${task.id}`;
                    return (
                      <SortableTask key={sortableId} id={sortableId}>
                        <DevTaskCard
                          task={task}
                          onClick={() => {
                            setSelectedDevTask(task);
                            setDevDetailOpen(true);
                          }}
                          onStatusChange={handleDevTaskStatusChange}
                        />
                      </SortableTask>
                    );
                  })}
                </KanbanColumn>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {scheduledColumns.map((col) => {
              const colTasks = getScheduledTasksForColumn(col.status);
              const taskIds = colTasks.map((t) => `sched-${t.id}`);
              return (
                <KanbanColumn
                  key={col.status}
                  id={col.status}
                  label={col.label}
                  icon={col.icon}
                  color={col.color}
                  headerBg={col.headerBg}
                  items={taskIds}
                  count={colTasks.length}
                >
                  {colTasks.map((task) => {
                    const sortableId = `sched-${task.id}`;
                    // Only allow dragging active/paused tasks
                    const canDrag =
                      task.status === "active" || task.status === "paused";
                    return canDrag ? (
                      <SortableTask key={sortableId} id={sortableId}>
                        <TaskCard
                          task={task}
                          onClick={() => {
                            setSelectedTask(task);
                            setDetailOpen(true);
                          }}
                          onAction={handleAction}
                        />
                      </SortableTask>
                    ) : (
                      <div key={sortableId}>
                        <TaskCard
                          task={task}
                          onClick={() => {
                            setSelectedTask(task);
                            setDetailOpen(true);
                          }}
                          onAction={handleAction}
                        />
                      </div>
                    );
                  })}
                </KanbanColumn>
              );
            })}
          </div>
        )}

        {/* Drag overlay — shows a floating copy of the dragged card */}
        <DragOverlay dropAnimation={null}>
          {activeId && activeDragItem ? (
            <div className="opacity-90 rotate-2 scale-105 shadow-2xl shadow-electric/20">
              {tab === "dev" && "title" in activeDragItem ? (
                <DevTaskCard
                  task={activeDragItem as DevTask}
                  onClick={() => {}}
                />
              ) : "prompt" in activeDragItem ? (
                <TaskCard
                  task={activeDragItem as KanbanTask}
                  onClick={() => {}}
                />
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Scheduled task detail dialog */}
      <TaskDetail
        task={selectedTask}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setSelectedTask(null);
        }}
        onAction={handleAction}
      />

      {/* Dev task detail dialog */}
      <DevTaskDetail
        task={selectedDevTask}
        open={devDetailOpen}
        onClose={() => {
          setDevDetailOpen(false);
          setSelectedDevTask(null);
        }}
        onUpdate={async (task, updates) => {
          // Handle status change
          if (updates.status) {
            await handleDevTaskStatusChange(task, updates.status);
          }
          // Handle summary change
          if (updates.summary) {
            try {
              await fetch(`/api/dev-tasks/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  source: task.source,
                  status: updates.status || task.status,
                  summary: updates.summary,
                }),
              });
              setDevTasks((prev) =>
                prev.map((t) =>
                  t.id === task.id && t.source === task.source
                    ? { ...t, ...updates }
                    : t
                )
              );
              toast("Task updated", "success");
            } catch {
              toast("Failed to update task", "error");
            }
          }
          // Update selected task for detail view
          if (selectedDevTask && selectedDevTask.id === task.id) {
            setSelectedDevTask({ ...selectedDevTask, ...updates });
          }
        }}
      />

      {/* Create task dialog */}
      <CreateTaskDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        groups={groups}
        onCreated={() => {
          setTimeout(loadData, 2000);
        }}
      />
    </div>
  );
}
