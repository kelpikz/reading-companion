import { Lexer, type TokensList } from "marked";
import { builtinWidget, isBuiltinType, type BuiltinWidget } from "./builtin-widgets.js";

export const MAX_WIDGETS = 4;
export const MAX_WIDGET_CHARS = 50_000;
export const WIDGET_PATH = "/widgets/";

export interface MarkdownPart { kind: "markdown"; text: string }
/** A custom widget: model-written HTML that runs only in the isolated /widgets/ frame. */
export interface HtmlPart { kind: "html"; index: number; title: string; source: string }
/** A built-in widget: model-written data that the app draws. */
export interface BuiltinPart { kind: "builtin"; widget: BuiltinWidget }
/** A widget fence that is not closed yet, for example while Pi writes it. `text` is its raw Markdown. */
export interface PendingPart { kind: "pending"; name: string; text: string }
export type ChatPart = MarkdownPart | HtmlPart | BuiltinPart | PendingPart;

/** Only closed, top-level widget fences become widgets. Ordinary HTML and invalid widgets stay Markdown. */
export function chatContent(text: string): { parts: ChatPart[]; links: TokensList["links"] } {
  const tokens = Lexer.lex(text);
  const parts: ChatPart[] = [];
  let markdown = "";
  let count = 0, html = 0;
  const add = (part: ChatPart) => {
    if (markdown) { parts.push({ kind: "markdown", text: markdown }); markdown = ""; }
    parts.push(part);
  };
  for (const token of tokens) {
    if (token.type !== "code") { markdown += token.raw; continue; }
    const label = /^(\S+)(?:[ \t]+(.+?))?[ \t]*$/.exec(token.lang ?? "");
    const name = label && (label[1] === "widget" || isBuiltinType(label[1])) ? label[1] : undefined;
    const opening = name ? /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(token.raw) : null;
    if (!name || !opening) { markdown += token.raw; continue; }
    const lastLine = token.raw.trimEnd().split("\n").at(-1) ?? "";
    const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(lastLine);
    if (!closing || closing[1][0] !== opening[1][0] || closing[1].length < opening[1].length) { add({ kind: "pending", name, text: token.raw }); continue; }
    const fits = token.text.trim() && token.text.length <= MAX_WIDGET_CHARS && count < MAX_WIDGETS;
    if (fits && name === "widget") {
      count++;
      add({ kind: "html", index: html++, title: label![2]?.trim().slice(0, 80) || "Interactive widget", source: token.text });
      continue;
    }
    const widget = fits && isBuiltinType(name) ? builtinWidget(name, token.text) : undefined;
    if (widget) { count++; add({ kind: "builtin", widget }); }
    else markdown += token.raw;
  }
  if (markdown) parts.push({ kind: "markdown", text: markdown });
  return { parts, links: tokens.links };
}

export function widgetPath(sessionId: string, messageId: string, index: number): string {
  return `${WIDGET_PATH}${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}/${index}`;
}
