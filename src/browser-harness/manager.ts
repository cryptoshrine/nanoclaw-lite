/**
 * Browser Harness Manager — lifecycle management for the Python daemon.
 * Handles spawn, stop, health checks, and auto-restart.
 */

import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { BrowserHarnessBridge } from "./bridge.js";

const HEALTH_CHECK_INTERVAL = 30_000;
const STARTUP_TIMEOUT = 10_000;
const MAX_RESTART_ATTEMPTS = 3;

export interface ManagerOptions {
  socketPath?: string;
  pythonPath?: string;
  autoRestart?: boolean;
  healthCheckInterval?: number;
}

export class BrowserHarnessManager {
  private bridge: BrowserHarnessBridge;
  private process: ChildProcess | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private restartAttempts = 0;
  private pythonPath: string;
  private autoRestart: boolean;
  private healthCheckInterval: number;
  private running = false;

  constructor(opts: ManagerOptions = {}) {
    this.bridge = new BrowserHarnessBridge(opts.socketPath);
    this.pythonPath = opts.pythonPath || process.env.BROWSER_HARNESS_PYTHON || "python3";
    this.autoRestart = opts.autoRestart ?? true;
    this.healthCheckInterval = opts.healthCheckInterval || HEALTH_CHECK_INTERVAL;
  }

  getBridge(): BrowserHarnessBridge {
    return this.bridge;
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Spawn the Python daemon
    this.process = spawn(this.pythonPath, ["-m", "browser_harness.daemon"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      detached: false,
    });

    this.process.on("exit", (code) => {
      this.running = false;
      if (this.autoRestart && this.restartAttempts < MAX_RESTART_ATTEMPTS) {
        this.restartAttempts++;
        setTimeout(() => this.start(), 2000 * this.restartAttempts);
      }
    });

    this.process.stderr?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[browser-harness] ${msg}`);
    });

    // Wait for socket to become available
    await this.waitForSocket();

    // Connect the bridge
    await this.bridge.connect();
    this.running = true;
    this.restartAttempts = 0;

    // Start health checks
    this.startHealthChecks();
  }

  async stop(): Promise<void> {
    this.stopHealthChecks();
    this.bridge.disconnect();

    if (this.process) {
      this.process.kill("SIGTERM");
      // Give it a moment to clean up
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (this.process && !this.process.killed) {
        this.process.kill("SIGKILL");
      }
      this.process = null;
    }
    this.running = false;
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    try {
      if (!this.bridge.isConnected()) {
        return { healthy: false, details: { reason: "not connected" } };
      }
      const health = await this.bridge.health();
      return { healthy: health.status === "ok", details: health };
    } catch (err) {
      return { healthy: false, details: { reason: String(err) } };
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private async waitForSocket(): Promise<void> {
    const socketPath = process.env.BROWSER_HARNESS_SOCKET || "/run/browser-harness/daemon.sock";
    const deadline = Date.now() + STARTUP_TIMEOUT;

    while (Date.now() < deadline) {
      if (existsSync(socketPath)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Browser harness daemon did not start within ${STARTUP_TIMEOUT}ms`);
  }

  private startHealthChecks(): void {
    this.healthTimer = setInterval(async () => {
      const { healthy } = await this.healthCheck();
      if (!healthy && this.autoRestart) {
        console.warn("[browser-harness] Health check failed, restarting...");
        await this.stop();
        await this.start();
      }
    }, this.healthCheckInterval);
  }

  private stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }
}
