import { marked } from "marked";
import DOMPurify from "dompurify";
import { ARTICLE_PURIFY, finishArticle } from "../shared/article";

// Model output cannot inject raw HTML, even transiently during sanitization.
marked.use({ renderer: { html({ text }) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
} } });

DOMPurify.addHook("afterSanitizeAttributes", node => {
  if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});

/** Article HTML from the server, cleaned again in the browser before it is shown. */
export function renderArticle(html: string): string {
  const fragment = DOMPurify.sanitize(html, { ...ARTICLE_PURIFY, RETURN_DOM_FRAGMENT: true });
  finishArticle(fragment);
  const holder = document.createElement("div");
  holder.append(fragment);
  return holder.innerHTML;
}

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false, breaks: false }), {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "sup", "sub"],
    ALLOWED_ATTR: ["href", "title"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  });
}
