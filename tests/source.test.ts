import test from "node:test";
import assert from "node:assert/strict";
import { extractSource, fetchSource, isPublicAddress, pastedSource, validateTarget } from "../server/source.js";
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
