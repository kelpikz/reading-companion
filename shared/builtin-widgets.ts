// Built-in widgets: Pi writes one JSON object, and the app draws it with its own components.
// No model-written code runs. To add a type, add its spec, parser, and prompt line here,
// then its component in src/widgets/index.ts (the types make you do both).

export interface ChartSpec {
  title: string; type: "bar" | "line"; labels: string[];
  series: { name: string; values: number[] }[]; unit?: string; note?: string;
}
export interface StepsSpec { title: string; steps: { title: string; detail?: string }[] }
export interface QuizSpec { title: string; questions: { question: string; options: string[]; answer: number; explanation?: string; section?: string }[] }
export interface FlashcardsSpec { title: string; cards: { front: string; back: string }[] }

type Data = Record<string, unknown>;

const record = (value: unknown): Data | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : undefined;
/** Trimmed, bounded plain text. Components render it as text, never as HTML. */
const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
/** A non-empty, bounded array whose items all pass. */
function list<T>(value: unknown, max: number, item: (value: unknown, index: number) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > max) return;
  const items = value.map(item);
  return items.every(item => item !== undefined) ? items as T[] : undefined;
}
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

function chart(data: Data): ChartSpec | undefined {
  const type = data.type ?? "bar";
  const labels = list(data.labels, 60, label => number(label)?.toString() ?? text(label, 60));
  const series = list(data.series, 6, (value, index) => {
    const item = record(value);
    const values = list(item?.values, 60, number);
    return item && values ? { name: text(item.name, 40) ?? `Series ${index + 1}`, values } : undefined;
  });
  if ((type !== "bar" && type !== "line") || !labels || !series || series.some(item => item.values.length !== labels.length)) return;
  return { title: text(data.title, 80) ?? "Chart", type, labels, series, unit: text(data.unit, 12), note: text(data.note, 300) };
}

function steps(data: Data): StepsSpec | undefined {
  const items = list(data.steps, 20, value => {
    const item = record(value);
    const title = text(item?.title, 120);
    return title ? { title, detail: text(item!.detail, 600) } : undefined;
  });
  return items && { title: text(data.title, 80) ?? "Steps", steps: items };
}

function quiz(data: Data): QuizSpec | undefined {
  const questions = list(data.questions, 20, value => {
    const item = record(value);
    const question = text(item?.question, 300);
    const options = list(item?.options, 6, option => text(option, 200));
    const answer = item?.answer;
    if (!question || !options || options.length < 2 || typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return;
    // section is an article href (#article-…). The app links it only when it is a section of the current article.
    const section = text(item!.section, 300);
    return { question, options, answer, explanation: text(item!.explanation, 600), ...(section?.startsWith("#") ? { section } : {}) };
  });
  return questions && { title: text(data.title, 80) ?? "Quiz", questions };
}

function flashcards(data: Data): FlashcardsSpec | undefined {
  const cards = list(data.cards, 50, value => {
    const item = record(value);
    const front = text(item?.front, 200), back = text(item?.back, 600);
    return front && back ? { front, back } : undefined;
  });
  return cards && { title: text(data.title, 80) ?? "Flashcards", cards };
}

export const BUILTIN_WIDGETS = {
  chart: { parse: chart, prompt: 'numbers to compare, or a change over time. {"title":"Adults online","type":"line","labels":["2000","2010","2020"],"series":[{"name":"US","values":[52,71,91]}],"unit":"%","note":"Source: the article"}. type is bar or line. Give each series one number per label; use at most 6 series and 60 labels. unit (a short suffix) and note are optional.' },
  steps: { parse: steps, prompt: 'a process or a sequence, in order. {"title":"How a bill becomes law","steps":[{"title":"Draft","detail":"A member writes the bill."}]}. detail is optional; use at most 20 steps.' },
  quiz: { parse: quiz, prompt: 'multiple-choice questions that check understanding. {"title":"Check your understanding","questions":[{"question":"…","options":["…","…","…"],"answer":0,"explanation":"…","section":"#article-…-section-2"}]}. answer is the zero-based index of the correct option. Use 2 to 6 options. explanation is optional. section is optional: the exact href from page.sections where the answer is.' },
  flashcards: { parse: flashcards, prompt: 'terms or facts to remember. {"title":"Key terms","cards":[{"front":"Term","back":"Meaning"}]}. Use at most 50 cards.' },
};

export type BuiltinType = keyof typeof BUILTIN_WIDGETS;
export type BuiltinSpec<T extends BuiltinType> = NonNullable<ReturnType<(typeof BUILTIN_WIDGETS)[T]["parse"]>>;
export type BuiltinWidget = { [T in BuiltinType]: { type: T; spec: BuiltinSpec<T> } }[BuiltinType];

export const isBuiltinType = (name: string): name is BuiltinType => Object.hasOwn(BUILTIN_WIDGETS, name);

/** The widget, or undefined when the JSON is invalid or does not match the type's spec. */
export function builtinWidget(type: BuiltinType, source: string): BuiltinWidget | undefined {
  let data: Data | undefined;
  try { data = record(JSON.parse(source)); } catch { return; }
  const spec = data && BUILTIN_WIDGETS[type].parse(data);
  return spec ? { type, spec } as BuiltinWidget : undefined;
}
