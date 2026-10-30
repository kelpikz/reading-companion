import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { localModel } from "./local-model.js";

await mkdir("evidence", { recursive: true });
const provider = await localModel();
const workspace = await mkdtemp(resolve(tmpdir(), "reading-companion-launcher-"));
const reserve = createServer();
await new Promise<void>(resolve => reserve.listen(0, "127.0.0.1", resolve));
const port = (reserve.address() as {port: number}).port;
await new Promise<void>(resolve => reserve.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
const windows = process.platform === "win32";
const command = windows ? process.env.ComSpec ?? "cmd.exe" : "bash";
const args = windows ? ["/d", "/s", "/c", '""Open Reading Companion.cmd""'] : ["open.sh"];
const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, READING_COMPANION_PORT: String(port),
  READING_COMPANION_NO_BROWSER: "1", READING_COMPANION_WORKSPACE: workspace }, stdio: "pipe", windowsHide: true, windowsVerbatimArguments: windows });
let log = ""; let exited = false;
child.stdout.on("data", chunk => { log += chunk.toString(); });
child.stderr.on("data", chunk => { log += chunk.toString(); });
child.on("exit", () => { exited = true; });
child.on("error", error => { log += error.message; exited = true; });
const results: Record<string, unknown> = { timestamp: new Date().toISOString(), launcher: windows ? "Open Reading Companion.cmd" : "open.sh", localTestModel: true };
try {
  let token = "";
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (exited) throw new Error("Launcher exited early: " + log);
    try {
      if (!token) {
        const html = await (await fetch(origin, { signal: AbortSignal.timeout(500) })).text();
        token = /name="companion-token" content="([a-f0-9]+)"/.exec(html)?.[1] ?? "";
      }
      if (token) {
        const state = await (await fetch(origin + "/api/state", { headers: { "X-Companion-Token": token } })).json();
        if (state.ready) { assert.equal(state.mode, "reading"); assert.equal(state.model.provider, "companion-fixture"); ready = true; break; }
        if (state.error) throw new Error(state.error);
      }
    } catch (error) { if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, "The launcher should build and start a connected reading session: " + log);
  results.productionBuildAndStartup = true;
  // A second launcher must reuse the running app, not spawn another Pi server.
  const second = spawn(process.execPath, [resolve("scripts/open.mjs")], { env: { ...process.env, READING_COMPANION_PORT: String(port), READING_COMPANION_NO_BROWSER: "1" }, stdio: "pipe", windowsHide: true });
  let secondOutput = "";
  second.stdout.on("data", chunk => { secondOutput += chunk.toString(); });
  const secondCode = await new Promise<number | null>((resolve, reject) => { second.on("exit", resolve); second.on("error", reject); });
  assert.equal(secondCode, 0); assert.match(secondOutput, /already running/);
  results.existingAppReuse = true;
  assert.equal(provider.requests.length, 0); results.noModelCallsAtStartup = true; results.passed = true;
} catch (error) { results.passed = false; results.error = (error as Error).stack; results.log = log; process.exitCode = 1; }
finally {
  if (windows && child.pid) {
    await new Promise<void>(resolve => { const kill = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); kill.on("exit", () => resolve()); kill.on("error", () => resolve()); });
  } else { child.kill("SIGTERM"); }
  await new Promise(resolve => setTimeout(resolve, 300));
  await provider.close(); await rm(workspace, { recursive: true, force: true });
  await writeFile("evidence/launcher.json", JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
}
