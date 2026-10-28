import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { download, downloadImage, MAX_PAGE_BYTES } from "../server/source.js";
async function site(listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  // Direct downloader tests deliberately bypass validateTarget, never the app's API.
  const target = { url: new URL(`http://pinned-test.invalid:${port}/article`), addresses: [{ address: "127.0.0.1", family: 4 }] };
  return { target, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test("native fetch pins the validated address while preserving the original HTTP Host", async () => {
  const s = await site((request, response) => { response.writeHead(200, { "Content-Type": "text/plain" }); response.end("Host: " + request.headers.host); });
  try {
    const result = await download(s.target, AbortSignal.timeout(2000));
    assert.match(result.body, /pinned-test.invalid/); assert.equal(result.status, 200);
  } finally { await s.close(); }
});
test("native fetch rejects oversized, non-text, failed, compressed, and stalled responses", async () => {
  const scenarios = [
    { headers: { "Content-Type": "text/plain" }, body: "x".repeat(MAX_PAGE_BYTES + 1), status: 200, expected: /too large/ },
    { headers: { "Content-Type": "application/pdf" }, body: "not supported", status: 200, expected: /not an HTML/ },
    { headers: { "Content-Type": "text/html" }, body: "error", status: 403, expected: /HTTP 403/ },
    { headers: { "Content-Type": "text/html", "Content-Encoding": "gzip" }, body: "compressed", status: 200, expected: /compressed/ },
  ];
  for (const scenario of scenarios) {
    const s = await site((_request, response) => { response.writeHead(scenario.status, scenario.headers); response.end(scenario.body); });
    try { await assert.rejects(download(s.target, AbortSignal.timeout(2000)), scenario.expected); }
    finally { await s.close(); }
  }
  const s = await site(() => {});
  try { await assert.rejects(download(s.target, AbortSignal.timeout(30)), /abort/i); }
  finally { await s.close(); }
});
test("the image downloader accepts images and rejects other content", async () => {
  const s = await site((_request, response) => { response.writeHead(200, { "Content-Type": "image/gif" }); response.end("GIF89a"); });
  try { assert.equal((await downloadImage(s.target, AbortSignal.timeout(2000))).bytes.toString(), "GIF89a"); }
  finally { await s.close(); }
  const page = await site((_request, response) => { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<p>not an image</p>"); });
  try { await assert.rejects(downloadImage(page.target, AbortSignal.timeout(2000)), /supported image/); }
  finally { await page.close(); }
});
