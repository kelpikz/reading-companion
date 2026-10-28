import test from "node:test";
import assert from "node:assert/strict";
import { extractSource, pastedSource } from "../server/source.js";
import { MAX_SECTIONS, referencedSection, sectionId, textSections } from "../shared/sections.js";

const paragraph = "Careful reading helps us notice assumptions and test the strength of evidence. ";

test("HTML references use actual heading positions, including duplicate and Unicode headings", () => {
  const source = extractSource(`<title>Reference article</title><article>
    <p>We mention Résultats π here before the heading. ${paragraph.repeat(5)}</p>
    <h2 id="question" class="toast">Résultats <em>π</em></h2><p>${paragraph.repeat(4)}</p>
    <h3 id="question">Résultats π</h3><p>${paragraph.repeat(4)}</p>
    <h2> </h2><p>${paragraph}</p></article>`, "https://example.org/references");
  const headings = source.sections.filter(section => section.title === "Résultats π");
  assert.equal(headings.length, 2);
  assert.deepEqual(headings.map(section => section.level), [2, 3]);
  assert.ok(headings[0].start > source.text.indexOf("Résultats π"));
  assert.ok(headings[1].start > headings[0].end);
  assert.notEqual(headings[0].id, headings[1].id);
  source.sections.forEach((section, index) => {
    assert.equal(section.id, sectionId(source.id, index));
    assert.equal(source.text.slice(section.start, section.end), section.title);
    assert.equal(typeof section.heading, "number");
  });
  assert.doesNotMatch(source.text, /\u0000/);
  assert.doesNotMatch(source.html!, /id="question"|class="toast"/);
});

test("references never include headings beyond the article's text limit", () => {
  const source = extractSource(`<title>Long article</title><article><h2>Included</h2>
    <p>${paragraph.repeat(1700)}</p><h2>Not supplied to Pi</h2><p>${paragraph.repeat(4)}</p></article>`, "https://example.org/long");
  assert.equal(source.text.length, 120_000);
  assert.ok(source.sections.some(section => section.title === "Included"));
  assert.ok(!source.sections.some(section => section.title === "Not supplied to Pi"));
  assert.ok(source.sections.every(section => section.end <= source.text.length));
});

test("pasted Markdown keeps exact text and indexes headings, not fenced code", () => {
  const text = "# Introduction\r\n\r\nA short explanation.\r\n\r\n```md\r\n## Not a heading\r\n```\r\n\r\n## Section 3: Café π ###\r\nDetails.\r\n\r\nConclusion\r\n----------\r\nDone.";
  const source = pastedSource(text);
  assert.equal(source.text, text);
  assert.deepEqual(source.sections.map(({ title, level }) => ({ title, level })), [
    { title: "Introduction", level: 1 }, { title: "Section 3: Café π", level: 2 }, { title: "Conclusion", level: 2 },
  ]);
  assert.deepEqual(source.sections.map(section => source.text.slice(section.start, section.end)), [
    "# Introduction", "## Section 3: Café π ###", "Conclusion",
  ]);
  assert.ok(source.sections.every(section => section.heading === undefined));
  assert.deepEqual(textSections("~~~\n# code\n~~~~\n\n## Real\nText", "test").map(section => section.title), ["Real"]);
});

test("plain text falls back to paragraphs without changing whitespace or inventing headings", () => {
  const source = pastedSource("Opening café π 🌱.\nOne paragraph.\n\n  Second paragraph.\n\nLast one.");
  assert.deepEqual(source.sections.map(section => section.title), ["Paragraph 1", "Paragraph 2", "Paragraph 3"]);
  assert.deepEqual(source.sections.map(section => source.text.slice(section.start, section.end)), [
    "Opening café π 🌱.\nOne paragraph.", "Second paragraph.", "Last one.",
  ]);
  assert.ok(source.sections.every(section => section.level === 0));
  assert.notEqual(source.sections[0].id, pastedSource(source.text).sections[0].id);
});

test("indexes are bounded and fragment resolution accepts only exact current-article targets", () => {
  const sections = textSections(Array.from({ length: MAX_SECTIONS + 10 }, (_, i) => `## Heading ${i}\nText.\n`).join("\n"), "current");
  assert.equal(sections.length, MAX_SECTIONS);
  assert.equal(textSections(Array.from({ length: MAX_SECTIONS + 10 }, () => "Paragraph.").join("\n\n"), "current").length, MAX_SECTIONS);
  assert.equal(referencedSection(`#${sections[0].id}`, sections), sections[0]);
  for (const href of ["#question", "#article-old-section-1", "#article-current-section-9999", "#article-current-section-01",
    "#article-current-section-1%20", "https://example.org/#article-current-section-1", "javascript:alert(1)", ""]) {
    assert.equal(referencedSection(href, sections), undefined, href);
  }
});
