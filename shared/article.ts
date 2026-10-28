// Rules for the article HTML shown in the reader. The server applies them once and the browser applies them again.

/** DOMPurify settings: HTML and SVG markup only, no styles, forms, media players, or frames. */
export const ARTICLE_PURIFY = {
  USE_PROFILES: { html: true, svg: true },
  FORBID_TAGS: ["style", "form", "input", "button", "select", "option", "textarea", "label", "iframe", "frame", "object", "embed",
    "video", "audio", "source", "track", "picture", "image", "foreignObject", "animate", "animateMotion", "animateTransform", "set",
    "canvas", "dialog", "noscript", "template"],
  FORBID_ATTR: ["style", "class", "name", "srcset", "sizes", "tabindex", "contenteditable", "autofocus"],
  ADD_ATTR: ["loading", "decoding"],
  // DOMPurify tests most attribute values with this, so values without a scheme (numbers, path data, "#id") must pass.
  // Only the http(s) and mailto schemes are allowed; javascript:, data:, and the rest are not.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
};

/** Image sources must be the local image proxy, and article ids must not collide with the app's ids. */
export function finishArticle(root: Element | DocumentFragment) {
  root.querySelectorAll("img").forEach(img => { if (!img.getAttribute("src")?.startsWith("/media/")) img.remove(); });
  root.querySelectorAll("use").forEach(use => {
    if (!(use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "").startsWith("#")) use.remove();
  });
  root.querySelectorAll("[id]").forEach(node => { if (!node.closest("svg")) node.removeAttribute("id"); });
  root.querySelectorAll("figure").forEach(figure => {
    if (!figure.querySelector("img, svg") && !figure.textContent?.trim()) figure.remove();
  });
}
