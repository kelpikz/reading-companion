import test from "node:test";
import assert from "node:assert/strict";
import { extractSource, fetchImage, fetchSource, isPublicAddress, pastedSource, validateTarget } from "../server/source.js";
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
test("rejects private, loopback, mapped, link-local, and reserved addresses", () => {
  for (const ip of ["127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "192.168.1.4", "169.254.169.254", "100.64.0.1", "224.0.0.1", "192.0.2.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "bad"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
});
test("rejects dangerous URL schemes, credentials, network ports, and alternate loopback spellings", async () => {
  for (const url of ["file:///etc/passwd", "ftp://example.org/", "http://user:pass@example.org", "http://example.org:8080", "http://localhost", "http://service.local", "http://2130706433", "http://0x7f000001", "http://[::1]", "http://[::ffff:127.0.0.1]"]) await assert.rejects(validateTarget(url, publicDns), (error: unknown) => error instanceof Error, url);
});
test("rejects mixed DNS results and strips fragments from valid URLs", async () => {
  await assert.rejects(validateTarget("https://example.org", async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]), /private/);
  const target = await validateTarget("https://example.org/read#intro", publicDns);
  assert.equal(target.url.href, "https://example.org/read");
  assert.equal(target.addresses[0].address, "93.184.216.34");
});
test("revalidates each redirect before downloading", async () => {
  let calls = 0;
  await assert.rejects(fetchSource("https://example.org", { resolve: publicDns, download: async () => {
    calls++; return { status: 302, location: "http://169.254.169.254/latest/meta-data", type: "", body: "" };
  } }), /private/);
  assert.equal(calls, 1);
});
test("follows relative public redirects and bounds redirect loops", async () => {
  const source = await fetchSource("https://example.org", { resolve: publicDns, download: async target =>
    target.url.pathname === "/" ? { status: 302, location: "/article", type: "", body: "" }
      : { status: 200, type: "text/plain", body: "A readable public article with useful text." } });
  assert.equal(source.url, "https://example.org/article");
  await assert.rejects(fetchSource("https://example.org", { resolve: publicDns, download: async () => ({ status: 302, location: "/", type: "", body: "" }) }), /too many/);
});
test("times out DNS lookup instead of hanging", async () => {
  await assert.rejects(fetchSource("https://example.org", { timeoutMs: 25, resolve: async () => new Promise(() => {}) }), /timed out/);
});
test("extracts article text without scripts, navigation, or HTML", () => {
  const paragraph = "A long article explores why careful reading helps us notice assumptions and test the strength of evidence. ";
  const source = extractSource(`<title>A thoughtful article</title><nav>Secret navigation</nav><article><h1>A thoughtful article</h1><p>${paragraph.repeat(5)}</p><script>globalThis.compromised=true</script><p>A second paragraph.</p></article>`, "https://example.org/article");
  assert.equal(source.title, "A thoughtful article");
  assert.match(source.text, /second paragraph/); assert.doesNotMatch(source.text, /compromised|Secret navigation|<p>/);
  assert.ok(source.text.includes("\n"));
});
test("warns on short extraction and truncation; rejects empty pages", () => {
  assert.ok(extractSource("<p>Login required</p>", "https://example.org").warnings.length);
  assert.ok(extractSource("word ".repeat(30_000), "https://example.org", "text/plain").warnings.some(w => w.includes("120,000")));
  assert.equal(extractSource("word ".repeat(30_000), "https://example.org", "text/plain").text.length, 120_000);
  assert.throws(() => extractSource("<html><body></body></html>", "https://example.org"), /No readable/);
});
test("accepts pasted Unicode safely and validates input length", () => {
  assert.equal(pastedSource("  café π 🌱  ", " Notes ").text, "café π 🌱");
  assert.equal(pastedSource("Some text").title, "Pasted reading");
  assert.throws(() => pastedSource("  "), /Paste/);
  assert.throws(() => pastedSource("x".repeat(120_001)), /120,000/);
});
test("keeps article HTML with proxied images and SVG diagrams, but no scripts, styles, or unsafe links", () => {
  const paragraph = "A long article explores why careful reading helps us notice assumptions and test the strength of evidence. ";
  const source = extractSource(`<html><head><title>Rich</title><meta property="og:image" content="https://cdn.example.org/lead.png"></head><body><article><h1>Rich</h1>
    <p>${paragraph.repeat(5)}</p>
    <figure><img src="/img/tree.png" alt="A tall tree" srcset="/img/tree-2x.png 2x" onerror="globalThis.x=1"><figcaption>Tree caption</figcaption></figure>
    <p id="question" class="toast" style="position:fixed">Styled <a href="javascript:alert(1)">bad</a> and <a href="/docs">good</a> links. ${paragraph}</p>
    <svg viewBox="0 0 100 50" aria-label="A diagram of roots and fungi"><defs><clipPath id="clip"><rect width="10" height="10"></rect></clipPath></defs><g clip-path="url(#clip)"><text x="5" y="9">Underground</text></g><image href="https://tracker.example/x.png"></image></svg>
    <img src="data:image/png;base64,AAAA"><script>globalThis.x=1</script>
  </article></body></html>`, "https://example.org/post");
  const html = source.html!;
  assert.deepEqual(source.images, ["https://example.org/img/tree.png"]);
  assert.ok(html.includes(`src="/media/${source.id}/0"`));
  assert.match(html, /<figcaption>Tree caption<\/figcaption>/);
  assert.match(html, /href="https:\/\/example\.org\/docs"/);
  assert.match(html, /<svg[^>]*viewBox="0 0 100 50"/);
  assert.match(html, /clip-path="url\(#article-svg0-0\)"/);
  assert.match(html, /<text x="5" y="9">Underground<\/text>/);
  assert.doesNotMatch(html, /onerror|javascript:|<script|<image|style=|class=|id="question"|srcset|data:image|tracker\.example/);
  assert.match(source.text, /\[Image: A tall tree\]/);
  assert.match(source.text, /\[Diagram: A diagram of roots and fungi\]/);
  assert.doesNotMatch(source.text, /Underground/);
});
test("uses the page's lead image when the article body has none", () => {
  const paragraph = "A long article explores why careful reading helps us notice assumptions and test the strength of evidence. ";
  const source = extractSource(`<head><title>Lead</title><meta property="og:image" content="https://cdn.example.org/lead.png"></head><article><p>${paragraph.repeat(5)}</p></article>`, "https://example.org/post");
  assert.deepEqual(source.images, ["https://cdn.example.org/lead.png"]);
  assert.ok(source.html!.startsWith(`<figure><img src="/media/${source.id}/0"`));
});
test("image fetches revalidate redirects and return the image type", async () => {
  await assert.rejects(fetchImage("https://example.org/a.png", { resolve: publicDns, download: async () =>
    ({ status: 302, location: "http://127.0.0.1/secret.png", type: "", bytes: Buffer.alloc(0) }) }), /private/);
  const image = await fetchImage("https://example.org/a.png", { resolve: publicDns, download: async () =>
    ({ status: 200, type: "image/png; charset=binary", bytes: Buffer.from([1, 2, 3]) }) });
  assert.equal(image.type, "image/png");
  assert.deepEqual([...image.body], [1, 2, 3]);
});
