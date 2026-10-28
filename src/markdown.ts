import { marked } from "marked";
import DOMPurify from "dompurify";
import { ARTICLE_PURIFY, finishArticle } from "../shared/article.js";
import { articleHeadings, referencedSection, sectionId } from "../shared/sections.js";
import type { SourceSection } from "../shared/types.js";

// Model output cannot inject raw HTML, even transiently during sanitization.
marked.use({ renderer: { html({ text }) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
} } });

function externalLink(node: Element) {
  node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer");
}
function fragmentHtml(fragment: DocumentFragment): string {
  const holder = document.createElement("div");
  holder.append(fragment);
  return holder.innerHTML;
}

/** Article HTML from the server, cleaned again before app-owned heading ids are added. */
export function renderArticle(html: string, sourceId: string, sections: readonly SourceSection[]): string {
  const fragment = DOMPurify.sanitize(html, { ...ARTICLE_PURIFY, RETURN_DOM_FRAGMENT: true });
  finishArticle(fragment);
  const headings = articleHeadings(fragment);
  sections.forEach((section, index) => {
    if (section.id !== sectionId(sourceId, index) || section.heading === undefined) return;
    const heading = headings[section.heading];
    if (heading) heading.id = section.id;
  });
  fragment.querySelectorAll("a").forEach(externalLink);
  return fragmentHtml(fragment);
}

export function renderMarkdown(text: string, sections: readonly SourceSection[] = []): string {
  const fragment = DOMPurify.sanitize(marked.parse(text, { async: false, breaks: false }), {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "sup", "sub"],
    ALLOWED_ATTR: ["href", "title"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    RETURN_DOM_FRAGMENT: true,
  });
  fragment.querySelectorAll("a").forEach(link => {
    const href = link.getAttribute("href") ?? "";
    if (!href.startsWith("#")) { if (href) externalLink(link); return; }
    const section = referencedSection(href, sections);
    if (section) link.setAttribute("title", `Go to ${section.title}`);
    // Invented, stale, or app-control fragments must never become navigation links.
    else link.replaceWith(...link.childNodes);
  });
  return fragmentHtml(fragment);
}
