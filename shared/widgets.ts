import { Lexer, type TokensList } from "marked";

export const MAX_WIDGETS = 4;
export const MAX_WIDGET_CHARS = 50_000;
export const WIDGET_PATH = "/widgets/";

export interface MarkdownPart { kind: "markdown"; text: string }
export interface WidgetPart { kind: "widget"; index: number; title: string; source: string }
export type ChatPart = MarkdownPart | WidgetPart;

/** Only closed, top-level `widget` fences opt into execution. Ordinary HTML stays Markdown. */
export function chatContent(text: string): { parts: ChatPart[]; links: TokensList["links"] } {
  const tokens = Lexer.lex(text);
  const parts: ChatPart[] = [];
  let markdown = "";
  let count = 0;
  for (const token of tokens) {
    const label = token.type === "code" ? /^widget(?:[ \t]+(.+?))?[ \t]*$/.exec(token.lang ?? "") : null;
    const opening = label ? /^ {0,3}(`{3,}|~{3,})[^\n]*\n/.exec(token.raw) : null;
    const lastLine = token.raw.trimEnd().split("\n").at(-1) ?? "";
    const closing = opening ? /^ {0,3}(`+|~+)[ \t]*$/.exec(lastLine) : null;
    if (token.type === "code" && label && opening && closing &&
        closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length &&
        token.text.trim() && token.text.length <= MAX_WIDGET_CHARS && count < MAX_WIDGETS) {
      if (markdown) { parts.push({ kind: "markdown", text: markdown }); markdown = ""; }
      parts.push({ kind: "widget", index: count++, title: label[1]?.trim().slice(0, 80) || "Interactive widget", source: token.text });
    } else markdown += token.raw;
  }
  if (markdown) parts.push({ kind: "markdown", text: markdown });
  return { parts, links: tokens.links };
}

export function widgetPath(sessionId: string, messageId: string, index: number): string {
  return `${WIDGET_PATH}${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}/${index}`;
}
