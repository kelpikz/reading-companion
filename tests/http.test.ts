import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { createApp } from "../server/http.js";
import { fixture } from "./helpers.js";

async function host() {
  const f = await fixture();
  const dist = await mkdtemp(resolve(tmpdir(), "pi-companion-http-"));
  await writeFile(resolve(dist, "index.html"), '<html><meta name="companion-token" content="__COMPANION_TOKEN__"></html>');
  const app = createApp(f.companion, dist);
  const origin = await app.listen(0);
  const html = await (await fetch(origin)).text();
  const token = /content="([^"]+)"/.exec(html)![1];
  const headers = { "X-Companion-Token": token, Origin: origin, "Content-Type": "application/json" };
  return { ...f, app, origin, headers, async close() { await app.close(); await f.close(); await rm(dist, { recursive: true, force: true }); } };
}
test("requires the launch token, exact Host/Origin, and rejects cross-site requests", async () => {
  const h = await host();
  try {
    assert.equal((await fetch(h.origin + "/api/state")).status, 401);
    assert.equal((await fetch(h.origin + "/api/state", { headers: { ...h.headers, "X-Companion-Token": "wrong" } })).status, 401);
    assert.equal((await fetch(h.origin + "/api/state", { headers: { ...h.headers, Origin: "https://evil.invalid" } })).status, 403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(h.origin + "/api/state", { headers: { ...h.headers, Host: "evil.invalid" } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject); request.end();
    });
    assert.equal(badHost, 403);
    assert.equal((await fetch(h.origin + "/api/state", { headers: { ...h.headers, "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await fetch(h.origin + "/api/state", { headers: h.headers })).status, 200);
    const { Origin, ...withoutOrigin } = h.headers;
    assert.equal((await fetch(h.origin + "/api/session", { method: "POST", headers: withoutOrigin, body: '{"mode":"reading"}' })).status, 403);
  } finally { await h.close(); }
});
test("bootstrap has security headers and static paths cannot escape the build directory", async () => {
  const h = await host();
  try {
    const response = await fetch(h.origin);
    assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.doesNotMatch(await response.text(), /__COMPANION_TOKEN__/);
    for (const path of ["/package.json", "/api/no-such-command", "/%2e%2e%2fpackage.json", "/..%5cpackage.json", "/%00.html"]) {
      assert.equal((await fetch(h.origin + path, { headers: h.headers })).status, 404, path);
    }
  } finally { await h.close(); }
});
test("API exposes a narrow command surface, validates bodies, and never proxies arbitrary RPC", async () => {
  const h = await host();
  try {
    const post = (path: string, body: unknown) => fetch(h.origin + path, { method: "POST", headers: h.headers, body: JSON.stringify(body) });
    assert.equal((await post("/api/bash", { command: "echo unsafe" })).status, 404);
    assert.equal((await post("/api/session", { mode: "tools" })).status, 400);
    assert.equal(h.companion.state.mode, "reading");
    assert.equal((await post("/api/chat", { message: 9 })).status, 400);
    assert.equal((await post("/api/source", { kind: "link", url: "http://127.0.0.1" })).status, 400);
    assert.equal((await post("/api/source", { kind: "text", text: "A private article.", title: "Notes" })).status, 200);
    assert.equal(h.companion.source?.text, "A private article.");
    assert.equal((await post("/api/session", { mode: "tools", allowTools: true })).status, 200);
    assert.equal(h.companion.source, null);
    assert.equal((await post("/api/source", { kind: "text", text: "No auto tools context" })).status, 400);
  } finally { await h.close(); }
});
test("authenticated SSE restores a full snapshot after refresh", async () => {
  const h = await host();
  const abort = new AbortController();
  try {
    await h.companion.prompt("hello");
    const response = await fetch(h.origin + "/api/events", { headers: h.headers, signal: abort.signal });
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /^data: /);
    const state = JSON.parse(first.slice(6).trim());
    assert.equal(state.messages[0].text, "hello");
    assert.equal(state.sessionId, h.companion.state.sessionId);
    await reader.cancel();
  } finally { abort.abort(); await h.close(); }
});
