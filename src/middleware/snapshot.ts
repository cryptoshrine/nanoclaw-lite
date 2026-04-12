/**
 * SnapshotMiddleware — writes task, group, and fact snapshots to IPC dir before agent invocation.
 * Extracted from runAgent() lines 280-301 in index.ts, plus Phase 2 fact snapshot.
 */

import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { logger } from '../logger.js';

import { MiddlewareServices } from './services.js';
import { Middleware, MiddlewareContext } from './types.js';

export function createSnapshotMiddleware(services: MiddlewareServices): Middleware {
  return {
    name: 'SnapshotMiddleware',

    async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
      try {
        // Dynamic import to avoid circular dependency with container-runner
        const { writeTasksSnapshot, writeGroupsSnapshot } = await import('../container-runner.js');

        const tasks = services.getAllTasks();
        writeTasksSnapshot(
          ctx.group.folder,
          ctx.isMain,
          tasks.map((t) => ({
            id: t.id,
            groupFolder: t.group_folder,
            prompt: t.prompt,
            schedule_type: t.schedule_type,
            schedule_value: t.schedule_value,
            status: t.status,
            next_run: t.next_run,
          })),
        );

        const availableGroups = services.getAvailableGroups();
        writeGroupsSnapshot(
          ctx.group.folder,
          ctx.isMain,
          availableGroups,
        );
      } catch (err) {
        logger.warn({ group: ctx.group.name, err }, 'Snapshot write failed (non-fatal)');
      }

      // Write memory facts snapshot for agent-runner to read
      try {
        const factExtractor = services.getFactExtractor();
        if (factExtractor) {
          const facts = factExtractor.getTopFacts(ctx.group.folder, 30);
          if (facts.length > 0) {
            const ipcDir = path.join(DATA_DIR, 'ipc', ctx.group.folder);
            fs.mkdirSync(ipcDir, { recursive: true });
            const factsPath = path.join(ipcDir, 'memory_facts.json');
            fs.writeFileSync(factsPath, JSON.stringify(facts));

            // Track accessed fact IDs so we can increment access_count
            factExtractor.markAccessed(facts.map((f) => f.id));
          }
        }
      } catch (err) {
        logger.warn({ group: ctx.group.name, err }, 'Fact snapshot write failed (non-fatal)');
      }

      return ctx;
    },
  };
}
