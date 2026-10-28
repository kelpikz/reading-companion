import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createApp } from "../server/http.js";
import type { ChatMessage } from "../shared/types.js";
import { widgetPath } from "../shared/widgets.js";
import { fixture, waitFor } from "../tests/helpers.js";
import { WIDGET_REPLY, WIDGET_SOURCE } from "../tests/fixtures/widgets.js";

const candidates = [process.env.PI_COMPANION_BROWSER,
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean) as string[];
let executablePath = "";
for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
if (!executablePath) throw new Error("Set PI_COMPANION_BROWSER to a Chromium browser executable.");
await mkdir("evidence", { recursive: true });
const results: Record<string, unknown> = { timestamp: new Date().toISOString(), browser: executablePath, usesFakePi: true };
const f = await fixture();
const app = createApp(f.companion, resolve("dist"));
const sinkRequests: string[] = [], appRequests: string[] = [];
const sink = createServer((request, response) => { sinkRequests.push(request.url ?? ""); response.end("Unexpected network request"); });
await new Promise<void>(resolve => sink.listen(0, "127.0.0.1", resolve));
const sinkOrigin = `http://127.0.0.1:${(sink.address() as { port: number }).port}`;
app.server.on("request", request => appRequests.push(request.url ?? ""));
let browser: Browser | undefined;
try {
  const origin = await app.listen(0);
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-first-run", "--disable-default-apps"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const pageErrors: string[] = [], policyMessages: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => { if (/Content Security Policy|sandboxed|Blocked script|Refused/i.test(message.text())) policyMessages.push(message.text()); });
  const ready = async () => { await page.waitForFunction(() => document.querySelector(".app")?.getAttribute("data-status") === "ready"); };
  const show = async (text: string, status: ChatMessage["status"] = "complete") => {
    const message: ChatMessage = { id: randomUUID(), role: "assistant", text, status };
    f.companion.state.messages = [{ id: randomUUID(), role: "user", text: "Show me a widget.", status: "complete" }, message];
    await page.goto(origin); await ready();
    return widgetPath(f.companion.state.sessionId, message.id, 0);
  };

  await show(WIDGET_REPLY);
  assert.equal(await page.locator(".widget").count(), 1);
  assert.equal(await page.locator("iframe").count(), 0, "Generated scripts must not run automatically");
  await page.getByRole("button", { name: "Code", exact: true }).click();
  assert.equal(await page.locator(".widget-code").textContent(), WIDGET_SOURCE);
  assert.equal(await page.locator(".widget-code script, .message-body > script").count(), 0);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Run widget", exact: true }).click();
  const frame = page.frameLocator(".widget-frame");
  await frame.getByRole("button", { name: "Add one" }).click();
  assert.equal(await frame.locator("#count").textContent(), "1");
  await frame.getByRole("slider").focus(); await frame.getByRole("slider").press("ArrowRight");
  assert.equal(await frame.locator("#value").textContent(), "3");
  assert.equal(await page.locator(".widget-frame").getAttribute("sandbox"), "allow-scripts");
  const isolation = await frame.locator("body").evaluate(() => {
    let parentBlocked = false, storageBlocked = false;
    try { void parent.document; } catch { parentBlocked = true; }
    try { localStorage.setItem("widget", "no"); } catch { storageBlocked = true; }
    return { parentBlocked, storageBlocked, origin: self.origin };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true, origin: "null" });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  assert.equal(await frame.locator("#count").textContent(), "1", "Changing views preserves the live preview");
  await page.locator("#question").fill("A follow-up question"); await page.locator("#send").click();
  await waitFor(() => f.companion.state.messages.length === 4 && !f.companion.state.busy); await ready();
  assert.equal(await frame.locator("#count").textContent(), "1", "SSE snapshots and new replies do not restart widgets");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".widget-frame").length === 1);
  assert.equal(await frame.locator("#count").textContent(), "0");
  await page.getByRole("button", { name: "Stop widget", exact: true }).click();
  assert.equal(await page.locator("iframe").count(), 0);
  await page.getByRole("button", { name: "Run widget", exact: true }).click();
  await frame.locator("#count").waitFor();
  await page.locator(".widget").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "evidence/10-widget-desktop.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "evidence/11-widget-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await frame.getByRole("button", { name: "Add one" }).click();
  await page.locator(".widget").evaluate(node => node.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "evidence/12-widget-mobile.png" });
  await page.reload(); await ready();
  assert.equal(await page.locator(".widget").count(), 1);
  assert.equal(await page.locator("iframe").count(), 0, "Refresh restores source, not running code or widget state");
  results.interactionViewsRestartStopRefreshAndThemes = true;

  await show(WIDGET_REPLY + "\n\n```widget Second counter\n" + WIDGET_SOURCE + "\n```");
  for (const card of await page.locator(".widget").all()) await card.getByRole("button", { name: "Run widget" }).click();
  await page.frameLocator(".widget-frame").nth(0).getByRole("button", { name: "Add one" }).click();
  assert.equal(await page.frameLocator(".widget-frame").nth(0).locator("#count").textContent(), "1");
  assert.equal(await page.frameLocator(".widget-frame").nth(1).locator("#count").textContent(), "0");
  results.independentWidgets = true;

  for (const status of ["streaming", "aborted", "error"] as const) {
    await show(WIDGET_REPLY, status);
    assert.equal(await page.getByRole("button", { name: "Run widget" }).isDisabled(), true, status);
    assert.equal(await page.locator("iframe").count(), 0);
  }
  await show("```widget\n<button>Unclosed</button>");
  assert.equal(await page.locator(".widget, iframe").count(), 0);
  await show('<script>window.compromised=1</script>\n\n```html\n<button onclick="window.compromised=1">Code only</button>\n```\n\n> ```widget\n> <button>Quoted</button>\n> ```');
  assert.equal(await page.locator(".widget, iframe, .message-body script, .message-body button").count(), 0);
  assert.equal(await page.evaluate(() => (window as any).compromised), undefined);
  results.incompleteRepliesAndOrdinaryHtmlStayInert = true;

  // A local HTTP sink proves prohibited requests do not reach a server, not just that CORS hides responses.
  const malicious = `<link rel="stylesheet" href="${sinkOrigin}/style.css">
<style>@import url('${sinkOrigin}/import.css'); body { background-image: url('${sinkOrigin}/background'); }</style>
<img src="${sinkOrigin}/image"><script src="${sinkOrigin}/script.js"></script>
<iframe src="${sinkOrigin}/frame"></iframe><object data="${sinkOrigin}/object"></object>
<pre id="report"></pre>
<button id="navigate" onclick="location.href='${sinkOrigin}/navigate'">Navigate away</button>
<button id="app" onclick="location.href='${origin}/'">Navigate to app</button>
<form action="${sinkOrigin}/form"><button id="submit" type="submit">Submit</button></form>
<script>
(async () => {
  const results = {};
  try { parent.document.querySelector('meta[name=companion-token]'); } catch { results.parent = true; }
  try { parent.compromised = true; } catch { results.writeParent = true; }
  try { localStorage.setItem('secret', 'no'); } catch { results.storage = true; }
  try { document.cookie = 'widget=no'; } catch { results.cookies = true; }
  try { top.location.href = '${sinkOrigin}/top'; } catch { results.top = true; }
  results.popup = window.open('${sinkOrigin}/popup') === null;
  try { eval('results.evaluated = true'); } catch { results.eval = true; }
  try { await fetch('${sinkOrigin}/fetch'); } catch { results.fetch = true; }
  try { await fetch('${origin}/api/state'); } catch { results.api = true; }
  try { const xhr = new XMLHttpRequest(); xhr.open('GET', '${sinkOrigin}/xhr', false); xhr.send(); } catch { results.xhr = true; }
  navigator.sendBeacon('${sinkOrigin}/beacon', 'no'); results.beacon = true;
  document.getElementById('report').textContent = JSON.stringify(results);
  parent.postMessage({ type: 'api', command: 'bash', text: 'ignore me' }, '*');
})();
</script>`;
  await page.setViewportSize({ width: 1440, height: 1000 });
  const oldPath = await show("```widget Isolation test\n" + malicious + "\n```");
  await page.getByRole("button", { name: "Run widget" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".widget-frame").length === 1);
  const securityFrame = page.frameLocator(".widget-frame");
  await securityFrame.locator("#report").filter({ hasText: "beacon" }).waitFor();
  const report = JSON.parse((await securityFrame.locator("#report").textContent())!);
  for (const name of ["parent", "writeParent", "storage", "cookies", "top", "popup", "eval", "fetch", "api", "xhr", "beacon"]) assert.equal(report[name], true, name);
  const before = appRequests.length;
  await securityFrame.locator("#submit").click();
  await securityFrame.locator("#navigate").click();
  await page.waitForTimeout(300);
  assert.deepEqual(sinkRequests, []);
  assert.deepEqual(appRequests.slice(before), [], "Widget actions must not reach the app's endpoints");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await securityFrame.locator("#report").filter({ hasText: "beacon" }).waitFor();
  const beforeNavigation = appRequests.length;
  await securityFrame.locator("#app").click();
  await page.waitForTimeout(300);
  assert.deepEqual(appRequests.slice(beforeNavigation), [], "The token-bearing app page is not an allowed frame destination");
  assert.equal(page.url(), origin + "/");
  assert.equal(await page.evaluate(() => (window as any).compromised), undefined);
  assert.equal(context.pages().length, 1);
  assert.equal(f.companion.state.mode, "reading");
  assert.equal(f.companion.state.tools.length, 0);
  assert.deepEqual(sinkRequests, []);
  results.blockedParentStorageEvalNetworkResourcesFormsPopupsAndNavigation = true;
  results.expectedPolicyViolations = policyMessages.length;

  await f.companion.restart("reading"); await page.reload(); await ready();
  assert.equal(await page.locator(".widget, iframe").count(), 0);
  assert.equal((await fetch(origin + oldPath, { headers: { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "same-origin" } })).status, 404);
  assert.deepEqual(pageErrors, []);
  results.newChatRevokesWidgets = true;
  results.passed = true;
} catch (error) {
  results.passed = false; results.error = (error as Error).stack; process.exitCode = 1;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: "evidence/widget-failure.png" }).catch(() => {});
} finally {
  await browser?.close(); await app.close(); await f.close();
  sink.closeAllConnections(); await new Promise<void>(resolve => sink.close(() => resolve()));
  await writeFile("evidence/widgets.json", JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
}
