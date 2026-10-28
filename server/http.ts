import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { Companion } from "./controller.js";
import { fetchImage, fetchSource, pastedSource } from "./source.js";
import { chatContent, MAX_WIDGETS, WIDGET_PATH } from "../shared/widgets.js";
import { widgetDocument, widgetPolicy, WIDGET_PERMISSIONS } from "./widgets.js";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
function json(response: ServerResponse, code: number, value: unknown) {
  response.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(request.headers["content-type"]).startsWith("application/json")) throw new Error("Send JSON with Content-Type: application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 768_000) throw new Error("Request too large.");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Send a JSON object.");
  return value;
}
function string(value: unknown, name: string, max: number, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${name}.`);
  return value;
}

type ImageFetcher = (url: string) => Promise<{ type: string; body: Buffer }>;

export function createApp(companion: Companion, dist: string, build = "", options: { fetchImage?: ImageFetcher } = {}) {
  const loadImage = options.fetchImage ?? fetchImage;
  const token = randomBytes(32).toString("hex");
  let origin = "";
  let importBusy = false;
  const clients = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (build) response.setHeader("X-Companion-Build", build);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    // Restrict frame navigation to widget pages, not arbitrary URLs or the token-bearing app page.
    response.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src ${origin}${WIDGET_PATH}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    try {
      if (request.headers.host !== new URL(origin).host ||
          !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) {
        json(response, 403, { error: "Only this computer and the app's exact localhost address are allowed." }); return;
      }
      if (request.headers.origin && request.headers.origin !== origin ||
          request.headers["sec-fetch-site"] === "cross-site") {
        json(response, 403, { error: "Cross-origin requests are not allowed." }); return;
      }
      const url = new URL(request.url ?? "/", origin);
      // An iframe cannot send the API token. The current session/message ids are a capability
      // for this one widget, never for chat state, article text, or arbitrary supplied HTML.
      if (url.pathname.startsWith(WIDGET_PATH)) {
        if (request.method !== "GET") { json(response, 405, { error: "Method not allowed." }); return; }
        if (request.headers["sec-fetch-dest"] !== "iframe" || request.headers["sec-fetch-site"] !== "same-origin") {
          json(response, 403, { error: "Widgets can only be opened in the app's preview." }); return;
        }
        const match = /^\/widgets\/([^/]+)\/([^/]+)\/(0|[1-9]\d?)$/.exec(url.pathname);
        const message = match && match[1] === companion.state.sessionId && Number(match[3]) < MAX_WIDGETS
          ? companion.state.messages.find(message => message.id === match[2] && message.role === "assistant" && message.status === "complete")
          : undefined;
        const part = message && chatContent(message.text).parts.find(part => part.kind === "widget" && part.index === Number(match![3]));
        if (!part || part.kind !== "widget") { json(response, 404, { error: "This widget is no longer available." }); return; }
        response.removeHeader("X-Frame-Options");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": widgetPolicy(origin), "Permissions-Policy": WIDGET_PERMISSIONS,
          "X-DNS-Prefetch-Control": "off" });
        response.end(widgetDocument(part.source)); return;
      }
      // Article images: only the current article's own images, fetched with the link checks.
      // <img> cannot send the token; the random source id in the path is the capability.
      if (url.pathname.startsWith("/media/")) {
        if (request.method !== "GET") { json(response, 405, { error: "Method not allowed." }); return; }
        const [, , sourceId, index] = url.pathname.split("/");
        const source = companion.source;
        const image = source && sourceId === source.id && /^\d{1,3}$/.test(index ?? "") ? source.images?.[Number(index)] : undefined;
        if (!image) { json(response, 404, { error: "Not found." }); return; }
        let media: Awaited<ReturnType<ImageFetcher>>;
        try { media = await loadImage(image); }
        catch (error) { json(response, 502, { error: error instanceof Error ? error.message : "The image could not be loaded." }); return; }
        response.writeHead(200, { "Content-Type": media.type, "Cache-Control": "private, max-age=3600",
          // An SVG opened directly must not run scripts in this origin.
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        response.end(media.body);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const supplied = Buffer.from(String(request.headers["x-companion-token"] ?? ""));
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          json(response, 401, { error: "Reload this app page to reconnect securely." }); return;
        }
        if (request.method === "GET" && url.pathname === "/api/state") { json(response, 200, companion.snapshot()); return; }
        if (request.method === "GET" && url.pathname === "/api/source") { json(response, 200, companion.source); return; }
        if (request.method === "GET" && url.pathname === "/api/models") { json(response, 200, await companion.availableModels()); return; }
        if (request.method === "GET" && url.pathname === "/api/events") {
          if (clients.size >= 8) { json(response, 429, { error: "Too many open companion tabs." }); return; }
          response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive", "X-Accel-Buffering": "no" });
          const send = () => {
            if (!response.destroyed && !response.write("data: " + JSON.stringify(companion.snapshot()) + "\n\n")) {
              // Slow clients reconnect for a fresh snapshot instead of accumulating unbounded buffers.
              if (response.writableLength > 2_000_000) response.destroy();
            }
          };
          let timer: NodeJS.Timeout | undefined;
          const unsubscribe = companion.subscribe(() => {
            if (!timer) timer = setTimeout(() => { timer = undefined; send(); }, 45);
          });
          const heartbeat = setInterval(() => { if (!response.destroyed) response.write(": heartbeat\n\n"); }, 15_000);
          clients.add(response); send();
          response.on("close", () => { unsubscribe(); clearInterval(heartbeat); clearTimeout(timer); clients.delete(response); });
          return;
        }
        if (request.method !== "POST") { json(response, 404, { error: "Not found." }); return; }
        if (request.headers.origin !== origin) { json(response, 403, { error: "An exact Origin header is required." }); return; }
        const data = await body(request);
        switch (url.pathname) {
          case "/api/chat":
            await companion.prompt(string(data.message, "question", 16_000), string(data.quote, "quote", 20_000, true));
            json(response, 200, { ok: true }); return;
          case "/api/stop":
            await companion.abort(); json(response, 200, { ok: true }); return;
          case "/api/session":
            if (data.mode !== "reading" && data.mode !== "tools") throw new Error("Choose reading or tools mode.");
            await companion.restart(data.mode, data.allowTools === true);
            json(response, 200, companion.snapshot()); return;
          case "/api/model":
            await companion.selectModel(string(data.provider, "provider", 200), string(data.id, "model", 300));
            json(response, 200, companion.snapshot()); return;
          case "/api/thinking":
            await companion.selectThinking(string(data.level, "effort level", 20));
            json(response, 200, companion.snapshot()); return;
          case "/api/source": {
            if (importBusy) { json(response, 409, { error: "A page is already being imported." }); return; }
            if (companion.state.mode !== "reading" || companion.state.busy || !companion.state.ready) throw new Error("Attach an article in an idle reading session.");
            importBusy = true;
            const session = companion.state.sessionId;
            try {
              const source = data.kind === "link"
                ? await fetchSource(string(data.url, "link", 4000))
                : data.kind === "text" ? pastedSource(string(data.text, "page text", 120_000), string(data.title, "title", 300, true))
                : (() => { throw new Error("Choose a link or pasted text."); })();
              await companion.setSource(source, session);
              json(response, 200, companion.snapshot());
            } finally { importBusy = false; }
            return;
          }
          default: json(response, 404, { error: "Not found." }); return;
        }
      }
      if (request.method !== "GET" && request.method !== "HEAD") { json(response, 405, { error: "Method not allowed." }); return; }
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); } catch { json(response, 400, { error: "Invalid path." }); return; }
      const root = resolve(dist);
      const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
      if (!file.startsWith(root + sep) || !MIME[extname(file)] || /[\\\0]/.test(pathname)) {
        json(response, 404, { error: "Not found." }); return;
      }
      let content: Buffer;
      try { content = await readFile(file); } catch { json(response, 404, { error: "Not found. Build the app with npm run build." }); return; }
      if (file === resolve(root, "index.html")) content = Buffer.from(content.toString("utf8").replace("__COMPANION_TOKEN__", token));
      response.writeHead(200, { "Content-Type": MIME[extname(file)] });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, 400, { error: error instanceof Error ? error.message : "The request failed." });
      else if (!response.destroyed) response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return {
    server,
    async listen(port = 47831) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not bind localhost.");
      origin = "http://127.0.0.1:" + address.port;
      return origin;
    },
    async close() {
      for (const client of clients) client.end();
      server.closeIdleConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
