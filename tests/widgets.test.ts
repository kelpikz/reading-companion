import test from "node:test";
import assert from "node:assert/strict";
import { chatContent, MAX_WIDGET_CHARS, MAX_WIDGETS, widgetPath } from "../shared/widgets.js";

const fence = (source: string, title = "", name = "widget") => `\`\`\`${name}${title ? " " + title : ""}\n${source}\n\`\`\``;
const json = (name: string, value: unknown) => fence(JSON.stringify(value), "", name);
const parts = (text: string) => chatContent(text).parts;
const widgets = (text: string) => parts(text).filter(part => part.kind === "html" || part.kind === "builtin");
const builtin = (text: string) => {
  const [part] = parts(text);
  return part?.kind === "builtin" ? part.widget : undefined;
};

test("closed widget fences split prose in order and keep their HTML/CSS/JS out of Markdown", () => {
  const source = '<style>button{color:purple}</style><button onclick="this.textContent=\'π\'">Try it</button>';
  const result = parts("Before **this**.\n\n" + fence(source, "A counter") + "\n\nBetween.\n\n" + fence("<p>Second</p>") + "\n\nAfter.");
  assert.deepEqual(result.map(part => part.kind), ["markdown", "html", "markdown", "html", "markdown"]);
  assert.deepEqual(result[1], { kind: "html", index: 0, title: "A counter", source });
  assert.deepEqual(result[3], { kind: "html", index: 1, title: "Interactive widget", source: "<p>Second</p>" });
  assert.ok(result.filter(part => part.kind === "markdown").every(part => !part.text.includes("<button")));
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

test("an open widget fence is pending with its raw text, and ordinary open code stays Markdown", () => {
  for (const text of ["`\`\`widget Demo\n<p>Still streaming</p>", "`\`\`chart\n{\"labels\":", "`\`\`quiz", "`\`\`\`widget\n<p>Too short</p>\n`\`\`"]) {
    const result = parts("Intro.\n\n" + text);
    assert.deepEqual(result.map(part => part.kind), ["markdown", "pending"], text);
    assert.equal(result[1].kind === "pending" && result[1].text, text);
  }
  assert.deepEqual(parts("`\`\`js\nconst open = true;").map(part => part.kind), ["markdown"]);
});

test("CommonMark closing rules, CRLF, Unicode, and bounded plain-text titles are supported", () => {
  const [part] = widgets("   ~~~~widget Café π\r\n<button>🌱</button>\r\n   ~~~~~  \r\n");
  assert.deepEqual(part, { kind: "html", index: 0, title: "Café π", source: "<button>🌱</button>" });
  const long = widgets(fence("<p>Hi</p>", "x".repeat(200)))[0];
  assert.equal(long.kind === "html" && long.title.length, 80);
  const markup = widgets(fence("<p>Hi</p>", "<img src=x onerror=alert(1)>"))[0];
  assert.equal(markup.kind === "html" && markup.title, "<img src=x onerror=alert(1)>");
});

test("oversized and excess widgets of any kind remain readable code", () => {
  assert.equal(widgets(fence("x".repeat(MAX_WIDGET_CHARS))).length, 1);
  const oversized = fence("x".repeat(MAX_WIDGET_CHARS + 1));
  assert.equal(widgets(oversized).length, 0);
  const steps = json("steps", { steps: [{ title: "One" }] });
  const text = [steps, ...Array.from({ length: MAX_WIDGETS }, (_, index) => fence(`<p>${index}</p>`))].join("\n\n");
  assert.equal(widgets(text).length, MAX_WIDGETS);
  const last = parts(text).at(-1);
  assert.ok(last?.kind === "markdown");
  assert.match(last.text, /<p>3<\/p>/);
  const first = widgets(oversized + "\n\n" + fence("<p>Fits</p>"))[0];
  assert.equal(first.kind === "html" && first.index, 0);
});

test("custom widget indexes count only HTML widgets, so built-in data is never served as a document", () => {
  const result = widgets(json("chart", { labels: ["A"], series: [{ values: [1] }] }) + "\n\n" + fence("<p>Custom</p>"));
  assert.deepEqual(result.map(part => part.kind), ["builtin", "html"]);
  assert.equal(result[1].kind === "html" && result[1].index, 0);
});

test("built-in widgets turn valid JSON into bounded plain-text specs", () => {
  assert.deepEqual(builtin(json("chart", {
    title: "  Adults online  ", type: "line", labels: [2000, "2010"], unit: "%", note: "From the article",
    series: [{ name: "US", values: [52, 71.5] }, { values: [-3, 0] }],
  })), { type: "chart", spec: {
    title: "Adults online", type: "line", labels: ["2000", "2010"], unit: "%", note: "From the article",
    series: [{ name: "US", values: [52, 71.5] }, { name: "Series 2", values: [-3, 0] }],
  } });
  assert.deepEqual(builtin(json("chart", { labels: ["A"], series: [{ values: [1] }] })), { type: "chart", spec: {
    title: "Chart", type: "bar", labels: ["A"], series: [{ name: "Series 1", values: [1] }], unit: undefined, note: undefined,
  } });
  assert.deepEqual(builtin(json("steps", { title: "A law", steps: [{ title: "Draft", detail: "Write it." }, { title: "Vote", detail: 3 }] })),
    { type: "steps", spec: { title: "A law", steps: [{ title: "Draft", detail: "Write it." }, { title: "Vote", detail: undefined }] } });
  assert.deepEqual(builtin(json("quiz", { questions: [{ question: "Two plus two?", options: ["3", "4"], answer: 1, explanation: "Count." }] })),
    { type: "quiz", spec: { title: "Quiz", questions: [{ question: "Two plus two?", options: ["3", "4"], answer: 1, explanation: "Count." }] } });
  const quizSection = (section: unknown) => {
    const widget = builtin(json("quiz", { questions: [{ question: "Q", options: ["A", "B"], answer: 0, section }] }));
    return widget?.type === "quiz" ? widget.spec.questions[0].section : "invalid";
  };
  assert.equal(quizSection("#article-x-section-2"), "#article-x-section-2");
  for (const section of ["https://evil.invalid", "javascript:alert(1)", 3, ""]) assert.equal(quizSection(section), undefined, "A quiz section is only an in-page href");
  assert.deepEqual(builtin(json("flashcards", { title: "Terms", cards: [{ front: "π", back: "About 3.14\nfor circles" }] })),
    { type: "flashcards", spec: { title: "Terms", cards: [{ front: "π", back: "About 3.14\nfor circles" }] } });
  const markup = builtin(json("steps", { title: "<img src=x onerror=alert(1)>", steps: [{ title: "x".repeat(500) }] }));
  assert.equal(markup?.spec.title, "<img src=x onerror=alert(1)>", "Text stays text; components never render it as HTML");
  assert.equal(markup?.type === "steps" && markup.spec.steps[0].title.length, 120);
});

test("invalid or mismatched built-in data stays Markdown code", () => {
  const series = (values: unknown) => ({ labels: ["A", "B"], series: [{ values }] });
  for (const [name, body] of [
    ["chart", "{not json"],
    ["chart", "[1, 2]"],
    ["chart", "null"],
    ["chart", JSON.stringify({ ...series([1, 2]), type: "pie" })],
    ["chart", JSON.stringify(series([1]))],
    ["chart", JSON.stringify(series([1, "2"]))],
    ["chart", JSON.stringify({ labels: [], series: [] })],
    ["chart", JSON.stringify({ labels: ["A"], series: Array.from({ length: 7 }, () => ({ values: [1] })) })],
    ["chart", JSON.stringify({ labels: Array.from({ length: 61 }, String), series: [{ values: Array(61).fill(1) }] })],
    ["steps", JSON.stringify({ steps: [{ detail: "No title" }] })],
    ["steps", JSON.stringify({ steps: ["Plain strings"] })],
    ["quiz", JSON.stringify({ questions: [{ question: "Q", options: ["Only one"], answer: 0 }] })],
    ["quiz", JSON.stringify({ questions: [{ question: "Q", options: ["A", "B"], answer: 2 }] })],
    ["quiz", JSON.stringify({ questions: [{ question: "Q", options: ["A", "B"], answer: 0.5 }] })],
    ["quiz", JSON.stringify({ questions: [{ question: "Q", options: ["A", "B"], answer: "A" }] })],
    ["flashcards", JSON.stringify({ cards: [{ front: "No back" }] })],
    ["constructor", "{}"],
    ["__proto__", "{}"],
    ["toString", "{}"],
  ]) {
    const text = fence(body, "", name);
    assert.deepEqual(parts(text), [{ kind: "markdown", text }], `${name}: ${body}`);
  }
});

test("widget paths encode their capabilities, not executable source or the API token", () => {
  assert.equal(widgetPath("session", "message", 1), "/widgets/session/message/1");
  assert.equal(widgetPath("a/b", "x?y#z", 0), "/widgets/a%2Fb/x%3Fy%23z/0");
});
