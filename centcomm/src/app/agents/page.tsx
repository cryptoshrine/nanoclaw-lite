import { getRegisteredGroups } from "@/lib/config";
import { getMessageCountByGroup, getAllTasks } from "@/lib/db";
import { getRecentMessages } from "@/lib/db";
import { AgentCard } from "@/components/agents/agent-card";
import { Bot } from "lucide-react";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  const groups = getRegisteredGroups();
  const messageCounts = getMessageCountByGroup();
  const tasks = getAllTasks();
  const recentMessages = getRecentMessages(200);

  // Build lookup maps
  const messageCountMap = new Map(
    messageCounts.map((r) => [r.chat_jid, r.count])
  );

  // Get last activity per group (latest message timestamp)
  const lastActivityMap = new Map<string, string>();
  for (const msg of recentMessages) {
    if (!lastActivityMap.has(msg.chat_jid)) {
      lastActivityMap.set(msg.chat_jid, msg.timestamp);
    }
  }

  // Tasks per group
  const taskCountMap = new Map<string, number>();
  const activeTaskCountMap = new Map<string, number>();
  for (const task of tasks) {
    const folder = task.group_folder;
    taskCountMap.set(folder, (taskCountMap.get(folder) ?? 0) + 1);
    if (task.status === "active") {
      activeTaskCountMap.set(folder, (activeTaskCountMap.get(folder) ?? 0) + 1);
    }
  }

  // Sort groups by message count (most active first)
  const sortedGroups = [...groups].sort((a, b) => {
    const aCount = messageCountMap.get(a.jid) ?? 0;
    const bCount = messageCountMap.get(b.jid) ?? 0;
    return bCount - aCount;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Agents</h2>
        <p className="text-sm text-muted-foreground">
          Monitor and control all agent groups
        </p>
      </div>

      {sortedGroups.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-12">
          <div className="text-center">
            <Bot className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              No registered groups found
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedGroups.map((group) => (
            <AgentCard
              key={group.jid}
              name={group.name}
              folder={group.folder}
              trigger={group.trigger}
              jid={group.jid}
              messageCount={messageCountMap.get(group.jid) ?? 0}
              taskCount={taskCountMap.get(group.folder) ?? 0}
              activeTaskCount={activeTaskCountMap.get(group.folder) ?? 0}
              lastActivity={lastActivityMap.get(group.jid)}
              requiresTrigger={group.requiresTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
}
