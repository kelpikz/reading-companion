import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import createDOMPurify from "dompurify";
import type { Source } from "../shared/types.js";
import { ARTICLE_PURIFY, finishArticle } from "../shared/article.js";

export const MAX_SOURCE_CHARS = 120_000;
export const MAX_PAGE_BYTES = 2_000_000;
export const MAX_IMAGE_BYTES = 10_000_000;
const MAX_IMAGES = 80;
const MAX_HTML_CHARS = 1_500_000;
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

export function isPublicAddress(address: string): boolean {
  try {
    // process() converts IPv4-mapped IPv6 before range classification.
    return ipaddr.process(address).range() === "unicast";
  } catch { return false; }
}

export async function validateTarget(input: string, resolve: Resolver = host => dnsLookup(host, { all: true, verbatim: true })) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a complete http:// or https:// link."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only HTTP(S) links without embedded credentials are allowed.");
  }
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only standard web ports (80 and 443) are allowed.");
  url.hash = "";
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local and private-network links are not allowed. Paste the text instead.");
  }
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error("This link resolves to a local, private, or reserved address. Paste the text instead.");
  }
  return { url, addresses };
}

type Target = Awaited<ReturnType<typeof validateTarget>>;
interface Fetched { status: number; location?: string; type: string; bytes: Buffer }
interface Kind { types: RegExp; accept: string; maxBytes: number; wrongType: string; tooLarge: string }
const PAGE: Kind = {
  types: /^(text\/html|application\/xhtml\+xml|text\/plain)(;|$)/, accept: "text/html,text/plain;q=0.9", maxBytes: MAX_PAGE_BYTES,
  wrongType: "This link is not an HTML or plain-text page. Paste its text instead.",
  tooLarge: "This page is too large. Paste the relevant section instead.",
};
const IMAGE: Kind = {
  types: /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)(;|$)/, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8",
  maxBytes: MAX_IMAGE_BYTES, wrongType: "The address did not return a supported image.", tooLarge: "The image is too large.",
};

function fetchBytes(target: Target, signal: AbortSignal, kind: Kind): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const pinned = target.addresses[0];
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(target.url, {
      signal,
      // Pin the vetted address: a second DNS lookup cannot rebind to localhost.
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) callback(null, [pinned] as never);
        else callback(null, pinned.address, pinned.family);
      },
      maxHeaderSize: 16_384,
      headers: { "User-Agent": "PiCompanion/0.1", Accept: kind.accept, "Accept-Encoding": "identity" },
    }, response => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      const type = String(response.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400) {
        response.destroy();
        resolve({ status, location, type, bytes: Buffer.alloc(0) });
        return;
      }
      if (status !== 200) { response.destroy(); reject(new Error(`The site returned HTTP ${status}. Paste the page text instead.`)); return; }
      if (!kind.types.test(type)) { response.destroy(); reject(new Error(kind.wrongType)); return; }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy(); reject(new Error("The site returned an unsupported compressed response. Paste its text instead.")); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > kind.maxBytes) { response.destroy(new Error(kind.tooLarge)); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, location, type, bytes: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

interface Download { status: number; location?: string; type: string; body: string }
export type Downloader = (target: Target, signal: AbortSignal) => Promise<Download>;
export type ImageDownloader = (target: Target, signal: AbortSignal) => Promise<Fetched>;

export const download: Downloader = async (target, signal) => {
  const { status, location, type, bytes } = await fetchBytes(target, signal, PAGE);
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1] ?? "utf-8";
  let body: string;
  try { body = new TextDecoder(charset).decode(bytes); }
  catch { body = bytes.toString("utf8"); }
  return { status, location, type, body };
};
export const downloadImage: ImageDownloader = (target, signal) => fetchBytes(target, signal, IMAGE);

/** Validates every hop, so a redirect cannot reach a private address. */
async function follow<T extends { status: number; location?: string }>(input: string, get: (target: Target, signal: AbortSignal) => Promise<T>,
  resolve: Resolver | undefined, timeoutMs: number) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = input;
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    // The timeout covers DNS as well as the body download.
    const target = await Promise.race([
      validateTarget(current, resolve),
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Fetching the page timed out. Paste the text instead.")), { once: true });
      }),
    ]);
    const response = await get(target, signal);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error("The site returned a redirect without a destination.");
      current = new URL(response.location, target.url).href;
      continue;
    }
    return { target, response };
  }
  throw new Error("The page redirected too many times. Paste the text instead.");
}

function cleanText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function elementText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  // Pi cannot see figures, so their descriptions stand in for them.
  clone.querySelectorAll("img").forEach(img => {
    const alt = img.getAttribute("alt")?.trim();
    img.replaceWith(alt ? `\n[Image: ${alt}]\n` : "");
  });
  clone.querySelectorAll("svg").forEach(svg => {
    const label = (svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "").trim();
    svg.replaceWith(label.length >= 12 ? `\n[Diagram: ${label}]\n` : "");
  });
  clone.querySelectorAll("script,style,noscript,template,iframe,svg,canvas,form,nav,footer,header").forEach(node => node.remove());
  clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  clone.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,pre,blockquote,section,tr").forEach(node => { node.prepend("\n"); node.append("\n"); });
  return cleanText(clone.textContent ?? "");
}

/** Gives each SVG its own id prefix and keeps url(#id) and href="#id" references working. */
function prepareSvg(svg: Element, prefix: string) {
  const ids = new Map<string, string>();
  for (const node of [svg, ...svg.querySelectorAll("[id]")]) {
    const old = node.getAttribute("id");
    if (old) { ids.set(old, prefix + ids.size); node.setAttribute("id", prefix + (ids.size - 1)); }
  }
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) {
      let value = attribute.value.replace(/url\(\s*['"]?#([^)'"]+)['"]?\s*\)/g, (_match, old: string) => ids.has(old) ? `url(#${ids.get(old)})` : "none");
      if ((attribute.name === "href" || attribute.name === "xlink:href") && value.startsWith("#")) value = ids.has(value.slice(1)) ? "#" + ids.get(value.slice(1)) : "";
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  }
  // Diagrams that relied on the site's CSS get a neutral style in the reader.
  if (!svg.matches("[fill], [stroke]") && !svg.querySelector("[fill], [stroke], [style]")) svg.setAttribute("data-plain", "");
}

function lastSrcsetUrl(srcset: string): string {
  return srcset.split(",").map(entry => entry.trim().split(/\s+/)[0]).filter(Boolean).at(-1) ?? "";
}

/** Sanitized article HTML. Image sources become /media/<source id>/<n>, served by the local proxy. */
function richArticle(window: JSDOM["window"], holder: Element, pageUrl: string, id: string, lead: string) {
  const images: string[] = [];
  const proxy = (raw: string) => {
    let absolute: URL;
    try { absolute = new URL(raw, pageUrl); } catch { return null; }
    if (!["http:", "https:"].includes(absolute.protocol) || absolute.href.length > 4000) return null;
    let index = images.indexOf(absolute.href);
    if (index === -1) {
      if (images.length >= MAX_IMAGES) return null;
      index = images.push(absolute.href) - 1;
    }
    return `/media/${id}/${index}`;
  };
  const document = window.document;
  // Many pages keep the main image outside the article body.
  if (lead && !holder.querySelector("img")) {
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.setAttribute("src", lead); img.setAttribute("alt", "");
    figure.append(img); holder.prepend(figure);
  }
  holder.querySelectorAll("img").forEach(img => {
    const raw = img.getAttribute("src") || img.getAttribute("data-src") || lastSrcsetUrl(img.getAttribute("srcset") || img.getAttribute("data-srcset") || "");
    const local = raw && !raw.startsWith("data:") ? proxy(raw) : null;
    if (!local) { img.remove(); return; }
    img.setAttribute("src", local); img.setAttribute("loading", "lazy"); img.setAttribute("decoding", "async");
  });
  holder.querySelectorAll("svg").forEach((svg, index) => prepareSvg(svg, `article-svg${index}-`));
  const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
  const fragment = purify.sanitize(holder.innerHTML, { ...ARTICLE_PURIFY, RETURN_DOM_FRAGMENT: true });
  finishArticle(fragment);
  const output = document.createElement("div");
  output.append(fragment);
  const html = output.innerHTML;
  return html.length > MAX_HTML_CHARS ? null : { html, images };
}

export function extractSource(body: string, url: string, type = "text/html"): Source {
  const id = randomUUID();
  let title = new URL(url).hostname;
  let text = body;
  let rich: { html: string; images: string[] } | null = null;
  let byline: string | undefined;
  let published: string | undefined;
  const warnings: string[] = [];
  if (!type.startsWith("text/plain")) {
    const dom = new JSDOM(body, { url }); // No scripts or external resources are enabled.
    try {
      const document = dom.window.document;
      title = document.title.trim() || title;
      const lead = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.getAttribute("content")?.trim() ?? "";
      const fallback = elementText(document.querySelector("article, main") ?? document.body);
      const article = new Readability(document, { charThreshold: 150 }).parse();
      if (article?.content) {
        title = article.title?.trim() || title;
        byline = article.byline?.trim().slice(0, 200) || undefined;
        published = article.publishedTime?.trim().slice(0, 40) || undefined;
        const holder = document.createElement("div");
        holder.append(JSDOM.fragment(article.content));
        text = elementText(holder);
        rich = richArticle(dom.window, holder, url, id, lead);
      } else {
        text = fallback;
        warnings.push("Could not confidently isolate the article. Check the context preview.");
      }
    } finally { dom.window.close(); }
  }
  text = cleanText(text);
  if (!text) throw new Error("No readable text was found. This page may need a login or JavaScript; paste its text instead.");
  if (text.length < 250) warnings.push("Very little text was found. This may be a login, paywall, or incomplete page; check the preview.");
  if (text.length > MAX_SOURCE_CHARS) {
    text = text.slice(0, MAX_SOURCE_CHARS);
    warnings.push("Only the first 120,000 characters were included. Paste a specific section for more focused questions.");
  }
  return { id, kind: "link", title: title.slice(0, 300), url, text, warnings, byline, published, ...(rich ?? {}) };
}

export async function fetchSource(input: string, options: { resolve?: Resolver; download?: Downloader; timeoutMs?: number } = {}): Promise<Source> {
  const { target, response } = await follow(input, options.download ?? download, options.resolve, options.timeoutMs ?? 20_000);
  return extractSource(response.body, target.url.href, response.type);
}

/** Fetches one article image with the same address checks as article links. */
export async function fetchImage(input: string, options: { resolve?: Resolver; download?: ImageDownloader; timeoutMs?: number } = {}) {
  const { response } = await follow(input, options.download ?? downloadImage, options.resolve, options.timeoutMs ?? 20_000);
  return { type: response.type.split(";")[0].trim(), body: response.bytes };
}

export function pastedSource(text: string, title = ""): Source {
  text = text.trim();
  if (!text) throw new Error("Paste some article text or a selected passage first.");
  if (text.length > MAX_SOURCE_CHARS) throw new Error("Use at most 120,000 characters. Paste the relevant section instead.");
  return { id: randomUUID(), kind: "text", title: title.trim().slice(0, 300) || "Pasted reading", text, warnings: [] };
}
