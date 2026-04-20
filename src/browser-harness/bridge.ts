/**
 * Browser Harness Bridge — Unix socket JSON-RPC 2.0 client.
 * Connects to the Python CDP daemon via Unix socket.
 */

import * as net from "net";
import { EventEmitter } from "events";

const DEFAULT_SOCKET = "/run/browser-harness/daemon.sock";
const REQUEST_TIMEOUT = 30_000;
const RECONNECT_DELAY = 2_000;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface RPCResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class BrowserHarnessBridge extends EventEmitter {
  private socket: net.Socket | null = null;
  private socketPath: string;
  private msgId = 0;
  private pending = new Map<number, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>();
  private buffer = "";
  private connected = false;
  private reconnectAttempts = 0;

  constructor(socketPath?: string) {
    super();
    this.socketPath = socketPath || process.env.BROWSER_HARNESS_SOCKET || DEFAULT_SOCKET;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);

      this.socket.on("connect", () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emit("connected");
        resolve();
      });

      this.socket.on("data", (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.socket.on("close", () => {
        this.connected = false;
        this.emit("disconnected");
        this.attemptReconnect();
      });

      this.socket.on("error", (err) => {
        if (!this.connected) {
          reject(err);
        }
        this.emit("error", err);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    // Reject all pending requests
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error("Connection closed"));
    }
    this.pending.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: RPCResponse = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(response.id);
          if (response.error) {
            pending.reject(new BridgeError(response.error.message, response.error.code));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Ignore malformed responses
      }
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit("reconnect_failed");
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => {
      this.connect().catch(() => {
        // Will retry via close handler
      });
    }, RECONNECT_DELAY * this.reconnectAttempts);
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected || !this.socket) {
      throw new BridgeError("Not connected to browser harness daemon", -1);
    }

    const id = ++this.msgId;
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(`Request timeout: ${method}`, -32000));
      }, REQUEST_TIMEOUT);

      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(request);
    });
  }

  // --- Typed method wrappers ---

  async navigate(url: string): Promise<{ url: string; frameId?: string }> {
    return this.call("navigate", { url }) as Promise<{ url: string; frameId?: string }>;
  }

  async evaluate(expression: string): Promise<unknown> {
    return this.call("evaluate", { expression });
  }

  async click(selector: string): Promise<{ selector: string; x: number; y: number }> {
    return this.call("click", { selector }) as Promise<{ selector: string; x: number; y: number }>;
  }

  async fill(selector: string, value: string): Promise<{ selector: string; filled: number }> {
    return this.call("fill", { selector, value }) as Promise<{ selector: string; filled: number }>;
  }

  async screenshot(fullPage = false): Promise<{ base64: string; format: string }> {
    return this.call("screenshot", { full_page: fullPage }) as Promise<{ base64: string; format: string }>;
  }

  async waitFor(selector: string, timeout?: number): Promise<{ selector: string; found: boolean }> {
    return this.call("wait_for", { selector, timeout }) as Promise<{ selector: string; found: boolean }>;
  }

  async getHtml(selector = "body"): Promise<string> {
    return this.call("get_html", { selector }) as Promise<string>;
  }

  async getText(selector = "body"): Promise<string> {
    return this.call("get_text", { selector }) as Promise<string>;
  }

  async getUrl(): Promise<string> {
    return this.call("get_url", {}) as Promise<string>;
  }

  async getTitle(): Promise<string> {
    return this.call("get_title", {}) as Promise<string>;
  }

  async skillRecord(domain: string, name: string, action: string, opts?: {
    selector?: string; params?: Record<string, unknown>; success?: boolean;
  }): Promise<{ domain: string; name: string; success_rate: number; attempts: number }> {
    return this.call("skill_record", { domain, name, action, ...opts }) as Promise<any>;
  }

  async skillFind(domain: string, name?: string): Promise<Array<Record<string, unknown>>> {
    return this.call("skill_find", { domain, name }) as Promise<Array<Record<string, unknown>>>;
  }

  async skillExecute(domain: string, name: string): Promise<Record<string, unknown> | null> {
    return this.call("skill_execute", { domain, name }) as Promise<Record<string, unknown> | null>;
  }

  async skillStats(): Promise<{ total: number; avg_rate: number; domains: number }> {
    return this.call("skill_stats", {}) as Promise<{ total: number; avg_rate: number; domains: number }>;
  }

  async skillPrune(): Promise<{ pruned: number }> {
    return this.call("skill_prune", {}) as Promise<{ pruned: number }>;
  }

  async health(): Promise<{ status: string; chrome_pid: number | null; ws_url: string | null; skills: Record<string, unknown> }> {
    return this.call("health", {}) as Promise<any>;
  }
}

export class BridgeError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}
