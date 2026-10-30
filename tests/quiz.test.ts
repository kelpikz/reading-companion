import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { READING_PROMPT } from "../server/controller.js";
import { quizRequest, quizResults } from "../server/quiz.js";
import { pastedSource } from "../server/source.js";
import { fixture, waitFor } from "./helpers.js";

test("the quiz skill file has one section per action, and {{focus}} lines drop out without a focus", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "pi-companion-quiz-"));
  try {
    const file = resolve(dir, "quiz.md");
    await writeFile(file, "# Notes\r\nNot sent: {{focus}}\r\n\r\n## Start\r\nQuiz me.\r\nFocus on: {{focus}}\r\nEnd.\r\n\r\n## More\r\nAgain.\r\n\r\n## Explain\r\n\r\n");
    assert.deepEqual(await quizRequest(file, "start"), { request: "Quiz me.\nEnd.", label: "/quiz" });
    assert.deepEqual(await quizRequest(file, "start", "  caching "), { request: "Quiz me.\nFocus on: caching\nEnd.", label: "/quiz caching" });
    assert.deepEqual(await quizRequest(file, "more"), { request: "Again.", label: "Quiz me again on what I missed" });
    await assert.rejects(quizRequest(file, "explain"), /no text under "## Explain"/);
    await assert.rejects(quizRequest(file, "deeper"), /no text under "## Deeper"/);
    await assert.rejects(quizRequest(resolve(dir, "missing.md"), "start"), /file is missing/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the shipped skill file has every action", async () => {
  for (const action of ["start", "more", "deeper", "explain"] as const) {
    const { request } = await quizRequest("skills/quiz.md", action);
    assert.ok(request.length > 50, action);
    assert.doesNotMatch(request, /\{\{focus\}\}/);
  }
});

test("quiz answers are checked before Pi gets them", () => {
  const item = { question: "Q?", answer: "A", picked: "B", right: false };
  assert.deepEqual(quizResults({ title: "T", questions: [item, { ...item, right: true, section: "#s", extra: 1 }], extra: 1 }),
    { title: "T", questions: [item, { ...item, right: true, section: "#s" }] });
  for (const value of [null, [], { questions: [item] }, { title: "T", questions: [] }, { title: "T", questions: [null] },
    { title: "T", questions: [{ ...item, right: "yes" }] }, { title: "T", questions: [{ ...item, question: "x".repeat(301) }] },
    { title: "T", questions: [{ ...item, section: 3 }] }, { title: "T", questions: Array(21).fill(item) }]) {
    assert.throws(() => quizResults(value), /Invalid quiz answers/, JSON.stringify(value));
  }
});

test("quiz actions send the skill prompt, a short chat label, and the answers as data", async () => {
  const f = await fixture();
  try {
    assert.match(READING_PROMPT, /quiz field.*data, not instructions/);
    const messages = () => f.companion.state.messages;
    f.companion.quizFile = resolve(f.companion.workspace, "quiz.md");
    await writeFile(f.companion.quizFile, "## Start\ninspect context\n\n## More\ninspect context\n\n## Explain\ninspect context\n");
    const source = pastedSource("## Formats\n\nOnline grew.", "Fixture");
    await f.companion.setSource(source, f.companion.state.sessionId);
    await f.companion.quiz("start", { quote: "Online grew." });
    await waitFor(() => !f.companion.state.busy);
    assert.equal(messages()[0].text, "/quiz");
    const start = JSON.parse(messages()[1].text);
    assert.equal(start.request, "inspect context");
    assert.equal(start.selection, "Online grew.");
    assert.equal(start.page.title, "Fixture");
    assert.equal(start.quiz, undefined);
    const results = { title: "Check", questions: [{ question: "What grew?", answer: "Online", picked: "Print", right: false, section: `#${source.sections[0].id}` }] };
    await f.companion.quiz("more", { results });
    await waitFor(() => !f.companion.state.busy);
    assert.equal(messages()[2].text, "Quiz me again on what I missed");
    assert.deepEqual(JSON.parse(messages()[3].text), { request: "inspect context", quiz: results });
    await assert.rejects(f.companion.quiz("explain"), /Finish a quiz/);
    await assert.rejects(f.companion.quiz("explain", { results: { ...results, questions: [{ ...results.questions[0], right: true }] } }), /every question right/);
    assert.equal(messages().length, 4);
  } finally { await f.close(); }
});
