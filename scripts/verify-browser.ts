import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { Companion } from "../server/controller.js";
import { createApp } from "../server/http.js";
import { findPi } from "../server/rpc.js";
import { localModel } from "./local-model.js";

await mkdir("evidence", { recursive: true });
const candidates = [process.env.PI_COMPANION_BROWSER,
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean) as string[];
let executablePath = "";
for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
if (!executablePath) throw new Error("Set PI_COMPANION_BROWSER to a Chromium browser executable.");
const results: Record<string, unknown> = { timestamp: new Date().toISOString(), browser: executablePath, usesRealPi: true, usesLocalTestModel: true };
const provider = await localModel();
const workspace = await mkdtemp(resolve(tmpdir(), "pi-companion-browser-"));
const companion = new Companion(await findPi(), workspace);
const app = createApp(companion, resolve("dist"));
let browser: Browser | undefined;
try {
  await companion.restart("reading");
  const origin = await app.listen(0);
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-first-run", "--disable-default-apps"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = []; const unexpectedRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !/400 \(Bad Request\)/.test(message.text())) errors.push(message.text()); });
  page.on("request", request => { if (!request.url().startsWith(origin) && !request.url().startsWith("data:")) unexpectedRequests.push(request.url()); });
  const ready = async () => { await page.waitForFunction(() => document.getElementById("status-text")?.textContent?.includes("Pi ready"), undefined, { timeout: 20_000 }); };
  const send = async (text: string) => { await ready(); await page.locator("#question").fill(text); await page.locator("#send").click(); };
  await page.goto(origin); await ready();
  await page.screenshot({ path: "evidence/01-welcome-desktop.png", fullPage: true });
  assert.equal(await page.title(), "Pi · Reading companion"); results.launch = true;

  await page.locator("#text-tab").click();
  await page.locator("#source-title").fill("The quiet intelligence of a forest");
  const article = "A forest is more than a collection of trees. Each layer of the ecosystem helps the others thrive.\n\nDiversity makes a forest resilient: roots, fungi, sunlight, and water connect the life within it. Good explanations help us see these relationships rather than just the individual pieces.";
  await page.locator("#source-text").fill(article);
  await page.locator("#attach-source").click();
  await page.waitForFunction(() => document.getElementById("context-title")?.textContent === "The quiet intelligence of a forest"); await ready();
  assert.equal(companion.source?.text, article); results.pastedArticle = true;
  await page.locator("#preview-context").click();
  await page.locator("#preview-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#preview-text").textContent(), article);
  await page.keyboard.press("Escape"); results.contextPreview = true;
  await page.locator("#add-quote").click();
  await page.locator("#quote-input").fill("Diversity makes a forest resilient.");
  await send("How do the parts of a forest work together?");
  await page.waitForFunction(() => document.querySelector(".assistant .message-body")?.textContent?.includes("Main idea"));
  await ready();
  assert.match(await page.locator(".user .message-quote").innerText(), /Diversity/);
  assert.equal(await page.locator(".assistant strong").first().innerText(), "Main idea:");
  await page.screenshot({ path: "evidence/02-reading-desktop.png", fullPage: true }); results.streamedDiscussionAndQuote = true;
  await page.reload(); await ready();
  assert.match(await page.locator("#messages").innerText(), /How do the parts of a forest/); results.refreshRestoresLiveChat = true;
  const downloadEvent = page.waitForEvent("download"); await page.locator("#export-chat").click();
  const download = await downloadEvent; await download.saveAs("evidence/sample-chat.md");
  assert.match(await readFile("evidence/sample-chat.md", "utf8"), /Main idea/); results.export = true;
  await page.waitForFunction(() => document.getElementById("toast")?.hidden);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "evidence/03-reading-mobile.png", fullPage: true });
  await page.locator("#toggle-sidebar").click();
  assert.equal(await page.locator("#context-card").isVisible(), true);
  await page.screenshot({ path: "evidence/04-context-mobile.png", fullPage: true });
  await page.locator("#toggle-sidebar").click();
  await page.setViewportSize({ width: 900, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 }); results.responsiveLayout = true;

  await page.locator("#toggle-reading-input").click();
  await page.locator("#link-tab").click(); await page.locator("#source-url").fill("http://127.0.0.1");
  await page.locator("#attach-source").click(); await page.locator("#confirm-action").click();
  await page.waitForFunction(() => document.getElementById("dialog-error")?.textContent?.includes("private"));
  assert.equal(companion.source?.title, "The quiet intelligence of a forest");
  await page.locator("#cancel-dialog").click(); results.blockedPrivateNetwork = true;

  await page.waitForFunction(() => (document.getElementById("model-select") as HTMLSelectElement)?.options.length >= 2);
  await page.locator("#model-select").selectOption("companion-fixture/fixture-alternative");
  await page.waitForFunction(() => document.getElementById("model-select")?.getAttribute("title")?.includes("fixture-alternative"));
  assert.equal(companion.state.model?.id, "fixture-alternative"); results.modelSelection = true;

  await page.locator("#tools-mode").click();
  assert.equal(await page.locator("#confirm-extra").isVisible(), true);
  await page.locator("#cancel-dialog").click(); assert.equal(companion.state.mode, "reading");
  await page.locator("#tools-mode").click(); await page.locator("#confirm-action").click();
  await page.locator("#confirm-dialog").waitFor({ state: "hidden" });
  await ready(); assert.equal(companion.state.mode, "tools");
  assert.equal(companion.source, null); assert.equal(companion.state.messages.length, 0); results.explicitModeIsolation = true;
  await send("TOOL_WORKFLOW");
  await page.waitForFunction(() => document.getElementById("messages")?.textContent?.includes("companion-tool-verified")); await ready();
  assert.equal(await readFile(resolve(workspace, "verified.txt"), "utf8"), "companion-tool-verified\n");
  await page.locator("#tool-section > details > summary").click();
  assert.equal(await page.locator("#tool-count").textContent(), "2");
  await page.screenshot({ path: "evidence/05-tools-desktop.png", fullPage: true }); results.actualPiTools = true;

  await send("slow");
  await page.waitForFunction(() => document.querySelectorAll(".assistant .message-body").length >= 4 || document.querySelector(".assistant:last-child .message-body")?.textContent?.includes("slow"));
  await page.locator("#stop").click(); await ready();
  assert.ok(companion.state.messages.some(message => message.status === "aborted")); results.stop = true;

  await page.locator("#reading-mode").click(); await page.locator("#confirm-action").click();
  await page.locator("#confirm-dialog").waitFor({ state: "hidden" }); await ready();
  await send("xss");
  await page.waitForFunction(() => document.querySelector(".assistant .message-body")?.textContent?.includes("no styling")); await ready();
  assert.equal(await page.evaluate(() => (window as unknown as { compromised?: boolean }).compromised), undefined);
  assert.equal(await page.locator(".message-body script, .message-body img, .message-body [style], .message-body [id], .message-body [class], .message-body a[href^='javascript:']").count(), 0);
  assert.equal(await page.locator("textarea#question").count(), 1);
  assert.deepEqual(unexpectedRequests, []); results.markdownXssAndTrackingProtection = true;
  assert.deepEqual(errors, []); results.noBrowserErrors = true;
  results.passed = true;
} catch (error) {
  results.passed = false; results.error = (error as Error).stack; process.exitCode = 1;
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: "evidence/browser-failure.png", fullPage: true }).catch(() => {}); results.pageText = (await page.locator("body").innerText()).slice(-5000); }
} finally {
  await browser?.close(); await app.close(); await companion.dispose(); await provider.close();
  await rm(workspace, { recursive: true, force: true });
  await writeFile("evidence/browser.json", JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
}
