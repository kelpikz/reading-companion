import test from "node:test";
import assert from "node:assert/strict";
import { chatContent, MAX_WIDGET_CHARS, MAX_WIDGETS, widgetPath } from "../shared/widgets.js";

const fence = (source: string, title = "") => `\`\`\`widget${title ? " " + title : ""}\n${source}\n\`\`\``;
const widgets = (text: string) => chatContent(text).parts.filter(part => part.kind === "widget");

test("closed widget fences split prose in order and keep their HTML/CSS/JS out of Markdown", () => {
  const source = '<style>button{color:purple}</style><button onclick="this.textContent=\'π\'">Try it</button>';
  const parts = chatContent("Before **this**.\n\n" + fence(source, "A counter") + "\n\nBetween.\n\n" + fence("<p>Second</p>") + "\n\nAfter.").parts;
  assert.deepEqual(parts.map(part => part.kind), ["markdown", "widget", "markdown", "widget", "markdown"]);
  assert.deepEqual(parts[1], { kind: "widget", index: 0, title: "A counter", source });
  assert.deepEqual(parts[3], { kind: "widget", index: 1, title: "Interactive widget", source: "<p>Second</p>" });
  assert.ok(parts.filter(part => part.kind === "markdown").every(part => !part.text.includes("<button")));
});

test("ordinary HTML, nested fences, and incomplete/mismatched fences never opt into execution", () => {
  for (const text of [
    '<button onclick="alert(1)">Raw HTML</button>',
    "`\`\`html\n<p>Code only</p>\n`\`\`",
    "`\`\`widget\n<p>Still streaming</p>",
    "`\`\`\`widget\n<p>Too short</p>\n`\`\`",
    "`\`\`widget\n<p>Wrong delimiter</p>\n~~~",
    "`\`\`widget\n<p>Closing fence has trailing text</p>\n`\`\` nope",
    "> `\`\`widget\n> <p>Quoted</p>\n> `\`\`",
    "- `\`\`widget\n  <p>In a list</p>\n  `\`\`",
    "    `\`\`widget\n    <p>Indented code</p>\n    `\`\`",
    "`\`\`\`md\n`\`\`widget\n<p>Example</p>\n`\`\`\n`\`\`\`",
    fence(""),
    fence("  \n "),
    fence("<p>Unknown language</p>").replace("widget", "widgets"),
  ]) {
    assert.equal(widgets(text).length, 0, text);
  }
});

test("CommonMark closing rules, CRLF, Unicode, and bounded plain-text titles are supported", () => {
  const [part] = widgets("   ~~~~widget Café π\r\n<button>🌱</button>\r\n   ~~~~~  \r\n");
  assert.deepEqual(part, { kind: "widget", index: 0, title: "Café π", source: "<button>🌱</button>" });
  assert.equal(widgets(fence("<p>Hi</p>", "x".repeat(200)))[0].title.length, 80);
  assert.equal(widgets(fence("<p>Hi</p>", "<img src=x onerror=alert(1)>"))[0].title, "<img src=x onerror=alert(1)>");
});

test("oversized and excess widgets remain non-executable readable code", () => {
  assert.equal(widgets(fence("x".repeat(MAX_WIDGET_CHARS))).length, 1);
  const oversized = fence("x".repeat(MAX_WIDGET_CHARS + 1));
  assert.equal(widgets(oversized).length, 0);
  const text = Array.from({ length: MAX_WIDGETS + 1 }, (_, index) => fence(`<p>${index}</p>`)).join("\n\n");
  const parts = chatContent(text).parts;
  assert.equal(widgets(text).length, MAX_WIDGETS);
  const last = parts.at(-1);
  assert.ok(last?.kind === "markdown");
  assert.match(last.text, /<p>4<\/p>/);
  assert.equal(widgets(oversized + "\n\n" + fence("<p>Fits</p>"))[0].index, 0);
});

test("widget paths encode their capabilities, not executable source or the API token", () => {
  assert.equal(widgetPath("session", "message", 1), "/widgets/session/message/1");
  assert.equal(widgetPath("a/b", "x?y#z", 0), "/widgets/a%2Fb/x%3Fy%23z/0");
});
