import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { Companion } from "../server/controller.js";
import { createApp } from "../server/http.js";
import { findPi } from "../server/rpc.js";
import { extractSource, pastedSource } from "../server/source.js";
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
// A 1x1 PNG stands in for article images, so the test makes no outside requests.
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const proxiedImages: string[] = [];
const app = createApp(companion, resolve("dist"), "", { fetchImage: async url => { proxiedImages.push(url); return { type: "image/png", body: pixel }; } });
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
  const ready = async () => { await page.waitForFunction(() => document.querySelector(".app")?.getAttribute("data-status") === "ready", undefined, { timeout: 20_000 }); };
  const send = async (text: string) => { await ready(); await page.locator("#question").fill(text); await page.locator("#send").click(); };
  await page.goto(origin); await ready();
  await page.screenshot({ path: "evidence/01-welcome-desktop.png", fullPage: true });
  assert.equal(await page.title(), "Pi · Reading companion"); results.launch = true;

  const divider = page.getByRole("separator", { name: "Resize article panel" });
  const panelWidth = () => page.locator("#panel").evaluate(node => node.getBoundingClientRect().width);
  const expectPanelWidth = async (expected: number) => {
    await page.waitForFunction(width => Math.abs(document.getElementById("panel")!.getBoundingClientRect().width - width) < 1, expected);
  };
  const dragDivider = async (x: number) => {
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await divider.getAttribute("data-resizing"), "false");
  };
  const defaultWidth = await panelWidth();
  await dragDivider(defaultWidth + 204); await expectPanelWidth(defaultWidth + 200);
  await dragDivider(defaultWidth - 156); await expectPanelWidth(defaultWidth - 160);
  await page.locator("#toggle-panel").click();
  assert.equal(await divider.count(), 0);
  await page.locator("#toggle-panel").click(); await expectPanelWidth(defaultWidth - 160);
  await dragDivider(4); await expectPanelWidth(320);
  await dragDivider(1436); await expectPanelWidth(1032);
  assert.equal(await page.locator(".chat").evaluate(node => node.getBoundingClientRect().width), 400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await divider.focus(); await divider.press("ArrowLeft"); await expectPanelWidth(1016);
  await divider.press("Shift+ArrowLeft"); await expectPanelWidth(952);
  await divider.press("ArrowRight"); await expectPanelWidth(968);
  await divider.press("Home"); await expectPanelWidth(320);
  await divider.press("End"); await expectPanelWidth(1032);
  await page.setViewportSize({ width: 1080, height: 1000 }); await expectPanelWidth(672);
  assert.equal(await page.locator(".chat").evaluate(node => node.getBoundingClientRect().width), 400);
  await page.setViewportSize({ width: 1440, height: 1000 }); await expectPanelWidth(1032);
  await divider.press("Enter"); await expectPanelWidth(defaultWidth);
  await divider.press("ArrowRight"); await expectPanelWidth(defaultWidth + 16);
  await divider.dblclick(); await expectPanelWidth(defaultWidth);
  await page.waitForFunction(() => document.getElementById("panel-divider")?.getAttribute("aria-valuenow") === "44");
  assert.equal(await divider.getAttribute("aria-controls"), "panel");

  // A cancelled drag must restore normal selection and leave no stuck resize state.
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  assert.equal(await divider.getAttribute("data-resizing"), "true");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await divider.getAttribute("data-resizing"), "false");
  await page.mouse.move(box.x + 100, box.y + box.height / 2); await page.mouse.up();
  await expectPanelWidth(defaultWidth);

  // Real touch input follows the same pointer-capture path as a mouse drag.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const touch = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touch, x: touch.x + 100 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expectPanelWidth(defaultWidth + 100);
  assert.equal(await divider.getAttribute("data-resizing"), "false");
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await cdp.detach();
  await divider.press("Enter"); await expectPanelWidth(defaultWidth);
  results.resizablePanes = true;

  await page.locator("#text-tab").click();
  await page.locator("#source-title").fill("The quiet intelligence of a forest");
  const article = "A forest is more than a collection of trees. Each layer of the ecosystem helps the others thrive.\n\nDiversity makes a forest resilient: roots, fungi, sunlight, and water connect the life within it. Good explanations help us see these relationships rather than just the individual pieces.";
  await page.locator("#source-text").fill(article);
  await page.locator("#attach-source").click();
  await page.waitForFunction(() => document.getElementById("context-title")?.textContent === "The quiet intelligence of a forest"); await ready();
  assert.equal(companion.source?.text, article); results.pastedArticle = true;
  // The reader pane shows exactly the text Pi receives.
  await page.locator("#reader-text").waitFor();
  assert.equal(await page.locator("#reader-text").textContent(), article); results.contextPreview = true;
  // Selecting article text offers a button that quotes it in the composer.
  const passage = "Diversity makes a forest resilient";
  await page.evaluate(text => {
    const walker = document.createTreeWalker(document.getElementById("reader-text")!, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) && !node.textContent?.includes(text)) { /* Section spans preserve text nodes. */ }
    if (!node) throw new Error("Selection fixture text is missing.");
    const start = node.textContent!.indexOf(text);
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  }, passage);
  await page.locator("#quote-selection").click();
  assert.equal(await page.locator("#quote-input").inputValue(), passage); results.selectionQuote = true;
  await send("How do the parts of a forest work together?");
  await page.waitForFunction(() => document.querySelector(".assistant .message-body")?.textContent?.includes("Main idea"));
  await ready();
  assert.match(await page.locator(".user .message-quote").innerText(), /Diversity/);
  assert.equal(await page.locator(".assistant strong").first().innerText(), "Main idea:");
  await page.mouse.move(0, 0);
  await page.screenshot({ path: "evidence/02-reading-desktop.png", fullPage: true }); results.streamedDiscussionAndQuote = true;
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "evidence/06-reading-dark.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" }); results.darkTheme = true;
  await page.reload(); await ready();
  assert.match(await page.locator("#messages").innerText(), /How do the parts of a forest/); results.refreshRestoresLiveChat = true;
  const downloadEvent = page.waitForEvent("download"); await page.locator("#export-chat").click();
  const download = await downloadEvent; await download.saveAs("evidence/sample-chat.md");
  assert.match(await readFile("evidence/sample-chat.md", "utf8"), /Main idea/); results.export = true;
  await page.waitForFunction(() => document.getElementById("toast")?.hidden);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator("#panel").count(), 0);
  assert.equal(await divider.count(), 0, "No divider on narrow screens");
  await page.screenshot({ path: "evidence/03-reading-mobile.png", fullPage: true });
  await page.locator("#toggle-panel").click();
  assert.equal(await page.locator("#context-title").isVisible(), true);
  assert.equal(await divider.count(), 0, "The mobile overlay is not resizable");
  await page.screenshot({ path: "evidence/04-context-mobile.png", fullPage: true });
  await page.locator("#toggle-panel").click();
  await page.setViewportSize({ width: 900, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#panel").waitFor(); results.responsiveLayout = true;

  await page.locator("#replace-source").click();
  await page.locator("#link-tab").click(); await page.locator("#source-url").fill("http://127.0.0.1");
  await page.locator("#attach-source").click(); await page.locator("#confirm-action").click();
  await page.waitForFunction(() => document.getElementById("dialog-error")?.textContent?.includes("private"));
  assert.equal(companion.source?.title, "The quiet intelligence of a forest");
  await page.locator("#cancel-dialog").click(); results.blockedPrivateNetwork = true;

  assert.equal(await page.locator("#effort-picker").isDisabled(), true, "fixture-reader has no thinking levels");
  await page.locator("#model-picker").click();
  await page.locator("#model-picker-menu [role=option]").nth(1).waitFor();
  await page.screenshot({ path: "evidence/07-model-picker.png" });
  await page.locator("#model-picker-menu [role=option]", { hasText: "fixture-alternative" }).click();
  await page.waitForFunction(() => document.getElementById("model-picker")?.title.includes("fixture-alternative"));
  assert.equal(companion.state.model?.id, "fixture-alternative"); results.modelSelection = true;
  await page.waitForFunction(() => !(document.getElementById("effort-picker") as HTMLButtonElement).disabled);
  await page.locator("#effort-picker").click();
  await page.screenshot({ path: "evidence/08-effort-picker.png" });
  await page.locator("#effort-picker-menu [role=option]", { hasText: /^High/ }).click();
  await page.waitForFunction(() => document.getElementById("effort-picker")?.textContent?.includes("High"));
  assert.equal(companion.state.thinking, "high"); results.effortSelection = true;

  await page.locator("#tools-mode").click();
  await page.locator("#confirm-extra").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#cancel-dialog").click(); assert.equal(companion.state.mode, "reading");
  await page.locator("#tools-mode").click(); await page.locator("#confirm-action").click();
  await page.locator("#confirm-dialog").waitFor({ state: "hidden" });
  await ready(); assert.equal(companion.state.mode, "tools");
  assert.equal(await divider.count(), 0, "No divider in tool mode");
  assert.equal(companion.source, null); assert.equal(companion.state.messages.length, 0); results.explicitModeIsolation = true;
  assert.equal(companion.state.thinking, "high", "effort survives a new session"); results.effortSurvivesRestart = true;
  await send("TOOL_WORKFLOW");
  await page.waitForFunction(() => document.getElementById("messages")?.textContent?.includes("companion-tool-verified")); await ready();
  assert.equal(await readFile(resolve(workspace, "verified.txt"), "utf8"), "companion-tool-verified\n");
  assert.equal(await page.locator(".tool").count(), 2);
  assert.equal(await page.locator(".tool[data-status='complete']").count(), 2);
  await page.locator(".tool summary").first().click();
  await page.screenshot({ path: "evidence/05-tools-desktop.png", fullPage: true }); results.actualPiTools = true;

  await send("slow");
  await page.waitForFunction(() => document.getElementById("messages")?.textContent?.includes("A slow"));
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

  const richArticle = extractSource(`<html><head><title>Rich fixture</title></head><body><article><h1>Rich fixture</h1>
    <p>${"Roots, fungi, and water connect the life of a forest. ".repeat(32)}</p>
    <figure><img src="/images/tree.png" alt="A tall tree" width="400" height="200" onerror="window.compromised=1"><figcaption>A tall tree in the forest</figcaption></figure>
    <h2>Underground</h2><ul><li>Fungi</li><li>Water</li></ul><pre><code>const roots = true;</code></pre>
    <svg viewBox="0 0 200 60" aria-label="A diagram of roots under a tree"><rect x="10" y="10" width="80" height="30"></rect><text x="20" y="30">Roots</text></svg>
    <p style="position:fixed" id="question">${"More text about the forest floor. ".repeat(6)}</p>
    <h3>Underground</h3><p>${"A second heading with the same name, describing deeper roots. ".repeat(8)}</p>
    <script>window.compromised=1</script></article></body></html>`,
    "https://forest.example/rich");
  await companion.setSource(richArticle, companion.state.sessionId);
  await page.waitForFunction(() => document.getElementById("context-title")?.textContent === "Rich fixture");
  await page.locator("#reader-article img").waitFor();
  await page.waitForFunction(() => { const img = document.querySelector("#reader-article img") as HTMLImageElement | null; return Boolean(img?.complete && img.naturalWidth > 0); });
  assert.match(await page.locator("#reader-article img").getAttribute("src") ?? "", /^\/media\//);
  assert.deepEqual(proxiedImages, ["https://forest.example/images/tree.png"]);
  assert.equal(await page.locator("#reader-article figcaption").innerText(), "A tall tree in the forest");
  assert.equal(await page.locator("#reader-article h2, #reader-article li, #reader-article pre, #reader-article svg text").count(), 5);
  assert.equal(await page.locator("#reader-article script, #reader-article [onerror], #reader-article [style], #reader-article [id=question]").count(), 0);
  assert.equal(await page.locator("textarea#question").count(), 1);
  await page.locator("#reader-article figure").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "evidence/09-rich-article.png" });
  await page.locator("#view-text").click();
  assert.match(await page.locator("#reader-text").innerText(), /\[Image: A tall tree\][\s\S]*\[Diagram: A diagram of roots under a tree\]/);
  assert.equal(await page.evaluate(() => (window as unknown as { compromised?: boolean }).compromised), undefined);
  assert.deepEqual(unexpectedRequests, []); results.richArticleWithProxiedImages = true;

  // A reference to the second of two identically named headings must reach that exact heading.
  await send("ARTICLE_REFERENCES");
  const target = richArticle.sections.find(section => section.title === "Underground" && section.level === 3)!;
  const reference = page.locator(`.assistant a[href="#${target.id}"]`);
  await reference.waitFor(); await ready();
  assert.equal(await reference.getAttribute("target"), null, "Article references must not open another tab");
  assert.equal(await page.locator(".assistant a[href='#question'], .assistant a[href='#article-missing-section-9999']").count(), 0);
  const assertReached = async (id: string) => {
    await page.waitForFunction(id => document.activeElement?.id === id, id);
    assert.equal(await page.locator(`[id="${id}"].reference-highlight`).count(), 1);
    assert.ok(await page.locator(".panel-scroll").evaluate(node => node.scrollTop) > 0);
    assert.equal(await page.evaluate(() => location.hash), "", "References must not change the app URL");
  };
  await reference.click(); await assertReached(target.id);
  assert.equal(await page.locator("#view-article").getAttribute("aria-selected"), "true", "A reference exits the plain-text view");
  assert.equal(await page.locator(`[id="${target.id}"]`).evaluate(node => node.tagName), "H3");
  await page.locator(".panel-scroll").evaluate(node => { node.scrollTop = 0; });
  await reference.click(); await assertReached(target.id); // Repeated clicks work too.
  await page.locator("#view-text").click();
  await page.locator("#reader-text").waitFor();
  assert.equal(await page.locator("#view-text").getAttribute("aria-selected"), "true", "Manual view changes must not replay an old jump");
  await page.locator("#replace-source").click(); await page.locator("#source-form").waitFor();
  await reference.click(); await assertReached(target.id);
  assert.equal(await page.locator("#source-form").count(), 0, "References return from the replacement form");
  await page.locator("#toggle-panel").click();
  await reference.focus(); await reference.press("Enter"); await assertReached(target.id);
  assert.equal(context.pages().length, 1); results.desktopArticleReferences = true;

  await page.reload(); await ready();
  await reference.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#panel").waitFor({ state: "hidden" });
  await reference.focus(); await reference.press("Enter"); await assertReached(target.id);
  assert.equal(await page.locator("#panel.sheet").count(), 1);
  const inView = await page.locator(`[id="${target.id}"]`).evaluate(node => {
    const rect = node.getBoundingClientRect(), panel = node.closest(".panel-scroll")!.getBoundingClientRect();
    return rect.top >= panel.top && rect.bottom <= panel.bottom;
  });
  assert.equal(inView, true); results.mobileArticleReferencesAfterRefresh = true;
  await page.locator("[aria-label='Close article panel']").click();

  for (const text of [
    "## Introduction\n\n" + "Opening paragraph. ".repeat(80) + "\n\n## Section 3: Café π\n\n" + "Evidence and details. ".repeat(20),
    "An opening paragraph. ".repeat(80) + "\n\nA second paragraph with evidence.\n\n" + "The final paragraph. ".repeat(20),
  ]) {
    const pasted = pastedSource(text, "Pasted references");
    await companion.setSource(pasted, companion.state.sessionId);
    await page.waitForFunction(() => !document.getElementById("messages")); await ready();
    await send("ARTICLE_REFERENCES");
    const section = pasted.sections.at(-1)!;
    const link = page.locator(`.assistant a[href="#${section.id}"]`);
    await link.waitFor(); await ready();
    await link.click(); await assertReached(section.id);
    assert.equal(await page.locator("#reader-text").textContent(), pasted.text, "Navigation must preserve the exact text Pi receives");
    assert.equal(await page.locator(`[id="${section.id}"]`).evaluate(node => node.tagName), "SPAN");
    await page.locator("[aria-label='Close article panel']").click();
  }
  results.pastedHeadingAndParagraphReferences = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await send("HTML_WIDGET");
  await page.locator(".widget").waitFor(); await ready();
  assert.equal(await page.locator(".widget-frame").count(), 0, "Widgets require an explicit Run click");
  await page.getByRole("button", { name: "Run widget", exact: true }).click();
  const widget = page.frameLocator(".widget-frame");
  await widget.getByRole("button", { name: "Add one" }).click();
  assert.equal(await widget.locator("#count").textContent(), "1");
  assert.equal(companion.state.mode, "reading");
  assert.equal(companion.state.tools.length, 0, "A widget does not need Pi tools");
  const widgetExportEvent = page.waitForEvent("download"); await page.locator("#export-chat").click();
  const widgetExport = await widgetExportEvent;
  const widgetExportPath = resolve(workspace, "widget-chat.md");
  await widgetExport.saveAs(widgetExportPath);
  assert.match(await readFile(widgetExportPath, "utf8"), /\`\`\`widget Counter demo/);
  await page.reload(); await ready();
  assert.equal(await page.locator(".widget").count(), 1);
  assert.equal(await page.locator(".widget-frame").count(), 0, "Refresh must not rerun code");
  results.realPiHtmlWidgetAndSourceExport = true;
  assert.deepEqual(unexpectedRequests, []);
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
