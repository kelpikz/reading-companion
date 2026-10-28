import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { SourceSection } from "../shared/types.js";
import { sectionId } from "../shared/sections.js";

// Initialize DOMPurify exactly as the browser does, before importing the browser renderer.
const dom = new JSDOM("<!doctype html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
const { renderArticle, renderMarkdown } = await import("../src/markdown.js");
after(() => { dom.window.close(); });
const sections: SourceSection[] = [
  { id: sectionId("current", 0), title: "Café π", level: 2, start: 0, end: 6, heading: 0 },
  { id: sectionId("current", 1), title: "Café π", level: 3, start: 20, end: 26, heading: 1 },
];
function parse(html: string) { return JSDOM.fragment(html); }

test("valid article links stay in-app, while ordinary external links keep their protections", () => {
  const root = parse(renderMarkdown(`[Go to Café π](#${sections[1].id}) and [Original](https://example.org/article).`, sections));
  const [internal, external] = [...root.querySelectorAll("a")];
  assert.equal(internal.getAttribute("href"), `#${sections[1].id}`);
  assert.equal(internal.getAttribute("target"), null);
  assert.equal(internal.getAttribute("title"), "Go to Café π");
  assert.equal(external.getAttribute("target"), "_blank");
  assert.equal(external.getAttribute("rel"), "noopener noreferrer");
});

test("invented, stale, and app-control links are readable but cannot navigate", () => {
  const root = parse(renderMarkdown("[Unknown](#article-current-section-999) [Old](#article-old-section-1) [Control](#question)", sections));
  assert.equal(root.querySelectorAll("a").length, 0);
  assert.match(root.textContent!, /Unknown.*Old.*Control/);
  assert.equal(parse(renderMarkdown(`[No article](#${sections[0].id})`)).querySelectorAll("a").length, 0);
});

test("article references do not relax Markdown HTML, image, or unsafe-scheme filtering", () => {
  const root = parse(renderMarkdown(`<script>window.compromised=1</script><h2 id="question">Raw HTML</h2>

![Tracking](https://tracker.invalid/pixel) [Unsafe](javascript:alert%281%29) [Valid](#${sections[0].id})`, sections));
  assert.equal(root.querySelectorAll("script, img, [id], [style], [onclick], a[href^='javascript:']").length, 0);
  assert.match(root.textContent!, /<script>/);
  assert.equal(root.querySelector("a[href^='#']")?.getAttribute("href"), `#${sections[0].id}`);
});

test("article sanitization removes page ids before regenerating only known heading targets", () => {
  const html = `<p id="question" class="toast" style="position:fixed">Text</p><h2 id="question">Café π</h2>
    <h3 id="${sections[0].id}" onclick="alert(1)">Café π</h3><h2 id="unindexed">Not shared</h2>
    <img src="https://tracker.invalid/pixel"><a href="https://example.org/">Original</a>`;
  const cleaned = renderArticle(html, "current", sections);
  const root = parse(cleaned);
  assert.deepEqual([...root.querySelectorAll("[id]")].map(node => node.id), sections.map(section => section.id));
  assert.equal(root.querySelectorAll("[onclick], [style], [class], img").length, 0);
  assert.equal(root.querySelector("a")?.getAttribute("rel"), "noopener noreferrer");
  // The second pass cannot strip or change the app's regenerated targets.
  assert.deepEqual([...parse(renderArticle(cleaned, "current", sections)).querySelectorAll("[id]")].map(node => node.id), sections.map(section => section.id));
  assert.equal(parse(renderArticle(html, "another-article", sections)).querySelectorAll("[id]").length, 0);
});
