import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { StringDecoder } from "node:string_decoder";

export interface Launch { command: string; args: string[]; label: string }
export async function findPi(): Promise<Launch> {
  const candidates: string[] = [];
  if (process.env.READING_COMPANION_CLI) candidates.push(resolve(process.env.READING_COMPANION_CLI));
  else {
    try {
      const entry = createRequire(import.meta.url).resolve("@earendil-works/pi-coding-agent");
      candidates.push(join(dirname(entry), "bundle", "cli.js"));
    } catch { /* A global install is also supported. */ }
    const roots = [
      join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm", "node_modules"),
      join(dirname(process.execPath), "node_modules"),
      join(dirname(process.execPath), "..", "lib", "node_modules"),
      ...String(process.env.PATH ?? "").split(delimiter).flatMap(dir => [join(dir, "node_modules"), join(dir, "..", "lib", "node_modules")]),
    ];
    for (const root of roots) candidates.push(join(root, "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"));
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const js = /\.[cm]?js$/i.test(candidate);
      return { command: js ? process.execPath : candidate, args: js ? [candidate] : [], label: candidate };
    } catch { /* Try the next known installation. */ }
  }
  throw new Error("Pi was not found. Install Pi, or set READING_COMPANION_CLI to its dist/bundle/cli.js path. Run Pi's /login first.");
}

export class JsonLines {
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  constructor(private receive: (record: any) => void) {}
  push(chunk: Buffer) {
    this.buffer += this.decoder.write(chunk);
    if (this.buffer.length > 8_000_000) throw new Error("Pi emitted an oversized protocol record.");
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      if (line.trim()) this.receive(JSON.parse(line));
    }
  }
}

interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
export class PiRpc {
  private child: ChildProcessWithoutNullStreams | null = null;
  private requests = new Map<string, Pending>();
  private sequence = 0;
  private stopping = false;
  private stderr = "";
  constructor(private launch: Launch, private onEvent: (record: any) => void, private onExit: (error: Error) => void) {}

  async start(cwd: string, args: string[]) {
    if (this.child) throw new Error("Pi is already running.");
    this.stopping = false;
    const child = spawn(this.launch.command, [...this.launch.args, "--mode", "rpc", ...args], {
      cwd, env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" },
      stdio: "pipe", windowsHide: true, shell: false,
    });
    this.child = child;
    const fail = (error: Error) => {
      for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.requests.clear();
      if (!this.stopping) this.onExit(error);
    };
    const lines = new JsonLines(record => {
      if (record.type === "response") {
        const request = this.requests.get(record.id);
        if (request) {
          clearTimeout(request.timer); this.requests.delete(record.id);
          if (record.success) request.resolve(record.data);
          else request.reject(new Error(String(record.error || "Pi rejected the command.")));
        }
      } else if (record.type === "extension_ui_request") {
        if (["confirm", "select", "input", "editor"].includes(record.method)) {
          child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: record.id, cancelled: true }) + "\n");
        }
      } else this.onEvent(record);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      try { lines.push(chunk); }
      catch (error) { fail(new Error(`Invalid Pi protocol: ${(error as Error).message}`)); child.kill(); }
    });
    child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8000); });
    child.stdin.on("error", error => fail(error));
    child.on("error", fail);
    child.on("exit", (code, signal) => {
      this.child = null;
      fail(new Error(`Pi exited (${signal ?? code ?? "unknown"}). ${this.stderr.slice(-1500)}`.trim()));
    });
    return await this.command("get_state", {}, 45_000);
  }

  command(type: string, fields: Record<string, unknown> = {}, timeout = 15_000): Promise<any> {
    const child = this.child;
    if (!child || child.stdin.destroyed) return Promise.reject(new Error("Pi is not running. Start a new chat to reconnect."));
    const id = "web-" + ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`Pi timed out handling ${type}. Start a new chat to reconnect.`)); }, timeout);
      this.requests.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n", error => {
        if (error) { clearTimeout(timer); this.requests.delete(id); reject(error); }
      });
    });
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    // stdin EOF lets Pi dispose itself. Fall back to terminating an unresponsive process.
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); }, 1500);
      const deadline = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3500);
      child.once("exit", () => { clearTimeout(timer); clearTimeout(deadline); resolve(); });
      child.stdin.end();
    });
    this.child = null;
  }
}
