import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export async function localModel() {
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
    const buffers: Buffer[] = [];
    for await (const chunk of request) buffers.push(chunk);
    const data = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    requests.push(data);
    const users = data.messages.filter((message: any) => message.role === "user");
    const content = users.at(-1)?.content;
    const text = typeof content === "string" ? content : content?.map((part: any) => part.text ?? "").join("") ?? "";
    let envelope: any = {};
    try { envelope = JSON.parse(text); } catch { /* Tool-recovery messages can be plain text. */ }
    const chunk = (delta: any, finish_reason: string | null = null) => {
      if (!response.destroyed) response.write("data: " + JSON.stringify({
        id: "chatcmpl-local-fixture", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
        model: data.model, choices: [{ index: 0, delta, finish_reason }],
      }) + "\n\n");
    };
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    chunk({ role: "assistant" });
    const done = (finish = "stop") => { chunk({}, finish); response.end("data: [DONE]\n\n"); };
    const tool = (name: string, args: unknown) => {
      chunk({ tool_calls: [{ index: 0, id: "call_" + name, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
      done("tool_calls");
    };
    if (envelope.request?.includes("TOOL_WORKFLOW")) {
      const calls = data.messages.filter((message: any) => message.role === "assistant").flatMap((message: any) => message.tool_calls ?? []);
      if (!calls.some((call: any) => call.function?.name === "write")) { tool("write", { path: "verified.txt", content: "companion-tool-verified\n" }); return; }
      if (!calls.some((call: any) => call.function?.name === "read")) { tool("read", { path: "verified.txt" }); return; }
    }
    let answer = envelope.request?.includes("TOOL_WORKFLOW") ? "Tool workflow complete: companion-tool-verified."
      : envelope.request === "xss" ? 'Safe **markdown**. <script>window.compromised=1</script><img src="https://tracker.invalid/pixel" onerror="window.compromised=1"><a href="javascript:alert(1)">unsafe</a><p style="position:fixed" class="toast" id="question">no styling</p>'
      : "**Main idea:** A thoughtful answer grounded in the shared reading.\n\nThe selected passage helps focus our discussion. Unicode works: café π 🌱\u2028line\u2029paragraph.";
    if (envelope.request === "ARTICLE_REFERENCES") {
      // Read the actual index transported through Pi, including on follow-up requests.
      const page = users.map((user: any) => {
        const value = typeof user.content === "string" ? user.content : user.content?.map((part: any) => part.text ?? "").join("");
        try { return JSON.parse(value).page; } catch { return undefined; }
      }).filter(Boolean).at(-1);
      answer = (page?.sections ?? []).map((section: any) =>
        `[Go to ${section.title.replace(/[\\[\]]/g, "\\$&")}](${section.href})`).join("\n\n")
        + "\n\n[Invented reference](#article-missing-section-9999) [App control](#question).";
    }
    const slow = envelope.request === "slow";
    if (slow) answer = "A slow, cancellable response. ".repeat(100);
    const chunks = answer.match(/[\s\S]{1,12}/g) ?? [];
    let timer: NodeJS.Timeout;
    const next = () => {
      if (response.destroyed) return;
      const value = chunks.shift();
      if (value === undefined) { done(); return; }
      chunk({ content: value }); timer = setTimeout(next, slow ? 100 : 15);
    };
    timer = setTimeout(next, 10);
    response.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const directory = await mkdtemp(resolve(tmpdir(), "pi-companion-provider-"));
  await writeFile(resolve(directory, "settings.json"), JSON.stringify({
    defaultProvider: "companion-fixture", defaultModel: "fixture-reader", defaultThinkingLevel: "off",
    cacheWarming: "off", retry: { enabled: false },
  }));
  await writeFile(resolve(directory, "models.json"), JSON.stringify({ providers: {
    "companion-fixture": { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "local-test-only",
      models: ["fixture-reader", "fixture-alternative"].map(id => ({ id, name: id, reasoning: id === "fixture-alternative", input: ["text"],
        contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })) },
  } }));
  await writeFile(resolve(directory, "auth.json"), "{}");
  const previous = { agent: process.env.PI_CODING_AGENT_DIR, offline: process.env.PI_OFFLINE };
  process.env.PI_CODING_AGENT_DIR = directory; process.env.PI_OFFLINE = "1";
  return { requests, directory, async close() {
    if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.agent;
    if (previous.offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previous.offline;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  } };
}
