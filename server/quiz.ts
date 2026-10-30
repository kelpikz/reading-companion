import { readFile } from "node:fs/promises";
import type { QuizAction, QuizResults } from "../shared/types.js";

// The quiz skill: its prompts live in an editable Markdown file (skills/quiz.md), one "## " section per action.

const LABELS: Record<QuizAction, string> = {
  start: "/quiz", more: "Quiz me again on what I missed", deeper: "Go deeper", explain: "Explain what I got wrong",
};

/** The request for one action, read from the skill file each time, and the short label the chat shows. */
export async function quizRequest(file: string, action: QuizAction, focus = ""): Promise<{ request: string; label: string }> {
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch { throw new Error(`The quiz skill file is missing: ${file}`); }
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) sections.set(heading[1].toLowerCase(), current = []);
    else current?.push(line);
  }
  focus = focus.trim();
  // Without a focus, lines that ask for one are left out.
  const request = (sections.get(action) ?? [])
    .filter(line => focus || !line.includes("{{focus}}"))
    .map(line => line.replaceAll("{{focus}}", focus)).join("\n").trim();
  if (!request) throw new Error(`The quiz skill file has no text under "## ${action[0].toUpperCase() + action.slice(1)}": ${file}`);
  return { request, label: action === "start" && focus ? `${LABELS.start} ${focus}` : LABELS[action] };
}

const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : undefined;

/** Checks the answers that the quiz widget sends. Their text is model-written, so Pi gets it as data only. */
export function quizResults(value: unknown): QuizResults {
  const data = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const title = text(data.title, 80);
  const questions = Array.isArray(data.questions) && data.questions.length && data.questions.length <= 20
    ? data.questions.map(item => {
      const question = text(item?.question, 300), answer = text(item?.answer, 200), picked = text(item?.picked, 200);
      const section = item?.section === undefined ? "" : text(item.section, 300);
      if (question === undefined || answer === undefined || picked === undefined || typeof item.right !== "boolean" || section === undefined) return;
      return { question, answer, picked, right: item.right, ...(section ? { section } : {}) };
    }) : [];
  if (title === undefined || !questions.length || questions.some(item => !item)) throw new Error("Invalid quiz answers.");
  return { title, questions: questions as QuizResults["questions"] };
}
