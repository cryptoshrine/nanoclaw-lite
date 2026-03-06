/**
 * MiddlewareServices — dependency injection for middleware.
 *
 * Instead of a full DI container, middleware factories receive this
 * services object which wraps the module-level state from index.ts.
 */

import { AvailableGroup, ContainerOutput } from '../container-runner.js';
import { FactExtractor } from '../memory/fact-extractor.js';
import { MemoryManager } from '../memory/manager.js';
import { RegisteredGroup, ScheduledTask, Session } from '../types.js';

export interface MiddlewareServices {
  // Session management
  getSessions(): Session;
  setSession(folder: string, sessionId: string): void;
  clearSession(folder: string): void;
  saveSessions(): void;

  // Groups
  getRegisteredGroups(): Record<string, RegisteredGroup>;
  getAvailableGroups(): AvailableGroup[];

  // Tasks
  getAllTasks(): ScheduledTask[];

  // Memory
  getMemoryManager(): MemoryManager;
  getFactExtractor(): FactExtractor | null;

  // Agent invocation
  runAgent(
    group: RegisteredGroup,
    input: {
      prompt: string;
      sessionId?: string;
      groupFolder: string;
      chatJid: string;
      isMain: boolean;
      sourceChannel?: 'telegram' | 'discord';
    },
  ): Promise<ContainerOutput>;
}
