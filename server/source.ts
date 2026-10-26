import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { Source } from "../shared/types.js";

export const MAX_SOURCE_CHARS = 120_000;
export const MAX_PAGE_BYTES = 2_000_000;
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

interface Download { status: number; location?: string; type: string; body: string }
export type Downloader = (target: Awaited<ReturnType<typeof validateTarget>>, signal: AbortSignal) => Promise<Download>;

export const download: Downloader = (target, signal) => new Promise((resolve, reject) => {
  const pinned = target.addresses[0];
  const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(target.url, {
    signal,
    // Pin the vetted address: a second DNS lookup cannot rebind to localhost.
    lookup: (_hostname, options, callback) => {
      if (typeof options === "object" && options.all) callback(null, [pinned] as never);
      else callback(null, pinned.address, pinned.family);
    },
    maxHeaderSize: 16_384,
    headers: { "User-Agent": "PiCompanion/0.1", Accept: "text/html,text/plain;q=0.9", "Accept-Encoding": "identity" },
  }, response => {
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    const type = String(response.headers["content-type"] ?? "").toLowerCase();
    if (status >= 300 && status < 400) {
      response.destroy();
      resolve({ status, location, type, body: "" });
      return;
    }
    if (status !== 200) { response.destroy(); reject(new Error(`The site returned HTTP ${status}. Paste the page text instead.`)); return; }
    if (!/^(text\/html|application\/xhtml\+xml|text\/plain)(;|$)/.test(type)) {
      response.destroy(); reject(new Error("This link is not an HTML or plain-text page. Paste its text instead.")); return;
    }
    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
      response.destroy(); reject(new Error("The site returned an unsupported compressed response. Paste its text instead.")); return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAGE_BYTES) { response.destroy(new Error("This page is too large. Paste the relevant section instead.")); return; }
      chunks.push(chunk);
    });
    response.on("end", () => {
      const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1] ?? "utf-8";
      let body: string;
      try { body = new TextDecoder(charset).decode(Buffer.concat(chunks)); }
      catch { body = Buffer.concat(chunks).toString("utf8"); }
      resolve({ status, location, type, body });
    });
    response.on("error", reject);
  });
  request.on("error", reject);
  request.end();
});

function cleanText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function elementText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("script,style,noscript,template,iframe,svg,canvas,form,nav,footer,header").forEach(node => node.remove());
  clone.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  clone.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,pre,blockquote,section,tr").forEach(node => { node.prepend("\n"); node.append("\n"); });
  return cleanText(clone.textContent ?? "");
}
export function extractSource(body: string, url: string, type = "text/html"): Source {
  let title = new URL(url).hostname;
  let text = body;
  const warnings: string[] = [];
  if (!type.startsWith("text/plain")) {
    const dom = new JSDOM(body, { url }); // No scripts or external resources are enabled.
    try {
      const document = dom.window.document;
      title = document.title.trim() || title;
      const fallback = elementText(document.querySelector("article, main") ?? document.body);
      const article = new Readability(document, { charThreshold: 150 }).parse();
      if (article?.content) {
        title = article.title?.trim() || title;
        const fragment = JSDOM.fragment(article.content);
        const holder = document.createElement("div");
        holder.append(fragment);
        text = elementText(holder);
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
  return { id: randomUUID(), kind: "link", title: title.slice(0, 300), url, text, warnings };
}

export async function fetchSource(input: string, options: { resolve?: Resolver; download?: Downloader; timeoutMs?: number } = {}): Promise<Source> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  let current = input;
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    // The timeout covers DNS as well as the body download.
    const target = await Promise.race([
      validateTarget(current, options.resolve),
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("Fetching the page timed out. Paste the text instead.")), { once: true });
      }),
    ]);
    const response = await (options.download ?? download)(target, signal);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error("The site returned a redirect without a destination.");
      current = new URL(response.location, target.url).href;
      continue;
    }
    return extractSource(response.body, target.url.href, response.type);
  }
  throw new Error("The page redirected too many times. Paste the text instead.");
}

export function pastedSource(text: string, title = ""): Source {
  text = text.trim();
  if (!text) throw new Error("Paste some article text or a selected passage first.");
  if (text.length > MAX_SOURCE_CHARS) throw new Error("Use at most 120,000 characters. Paste the relevant section instead.");
  return { id: randomUUID(), kind: "text", title: title.trim().slice(0, 300) || "Pasted reading", text, warnings: [] };
}
