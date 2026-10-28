import type { SourceSection } from "./types.js";

export const MAX_SECTIONS = 200;
const HEADINGS = "h1, h2, h3, h4, h5, h6";

/** Keep navigation out of diagrams and content excluded from the model's article text. */
export function articleHeadings(root: Element | DocumentFragment): Element[] {
  return [...root.querySelectorAll(HEADINGS)].filter(node =>
    !node.closest("svg, script, style, noscript, template, iframe, canvas, form, nav, footer, header") && node.textContent?.trim());
}

export function sectionId(sourceId: string, index: number): string {
  return `article-${sourceId}-section-${index + 1}`;
}

/** Recognize explicit Markdown headings without treating code or arbitrary prose as headings. */
export function textSections(text: string, sourceId: string): SourceSection[] {
  const sections: SourceSection[] = [];
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)].filter(match => match[0]);
  let fence: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length && sections.length < MAX_SECTIONS; i++) {
    const line = lines[i][0].replace(/[\r\n]+$/, "");
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.char && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
      continue;
    }
    if (delimiter) { fence = { char: delimiter[1][0], length: delimiter[1].length }; continue; }
    const atx = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/.exec(line);
    const underline = !atx && line.trim() && !/^ {4}|^\t/.test(line)
      ? /^ {0,3}(=+|-+)[ \t]*(?:\r\n|\r|\n|$)$/.exec(lines[i + 1]?.[0] ?? "") : null;
    if (!atx && !underline) continue;
    const title = (atx?.[2] ?? line.trim()).trim();
    if (!title) continue;
    const start = lines[i].index!;
    sections.push({ id: sectionId(sourceId, sections.length), title: title.slice(0, 300),
      level: atx ? atx[1].length : underline![1][0] === "=" ? 1 : 2, start, end: start + line.length });
    if (underline) i++;
  }
  if (sections.length) return sections;

  // Unstructured pastes still have reliable targets: preserve their text exactly and reference paragraphs.
  for (const match of text.matchAll(/\S[\s\S]*?(?=(?:\r?\n)[ \t]*(?:\r?\n)|$)/g)) {
    if (sections.length >= MAX_SECTIONS) break;
    const value = match[0].trimEnd();
    sections.push({ id: sectionId(sourceId, sections.length), title: `Paragraph ${sections.length + 1}`, level: 0,
      start: match.index!, end: match.index! + value.length });
  }
  return sections;
}

/** Only exact targets belonging to the current article can be activated from model output. */
export function referencedSection(href: string, sections: readonly SourceSection[]): SourceSection | undefined {
  return href.startsWith("#") ? sections.find(section => href === `#${section.id}`) : undefined;
}
