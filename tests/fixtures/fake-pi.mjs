import { StringDecoder } from "node:string_decoder";
const emit = record => process.stdout.write(JSON.stringify(record) + "\n");
let buffer = ""; const decoder = new StringDecoder("utf8");
let model = { provider: "fixture", id: "reader", name: "Fixture Reader" };
let active = null;
function finish(aborted = false) {
  if (active) {
    clearTimeout(active.timer);
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: active.text }], stopReason: aborted ? "aborted" : "stop" } });
    active = null;
  }
  emit({ type: "agent_settled", aborted });
}
function handle(command) {
  const reply = (data = {}) => emit({ id: command.id, type: "response", command: command.type, success: true, data });
  switch (command.type) {
    case "get_state": reply({ model, isStreaming: Boolean(active) }); break;
    case "get_available_models": reply({ models: [model, { provider: "fixture", id: "other", name: "Other Reader" }] }); break;
    case "set_model": model = { provider: command.provider, id: command.modelId, name: command.modelId }; reply(model); break;
    case "clear_queue": reply({ steering: [], followUp: [] }); break;
    case "abort": finish(true); reply(); break;
    case "prompt": {
      const envelope = JSON.parse(command.message);
      if (envelope.request === "reject") { emit({ id: command.id, type: "response", command: "prompt", success: false, error: "Fixture rejection" }); break; }
      if (envelope.request === "crash") { process.exit(7); }
      reply({ disposition: "started" });
      emit({ type: "agent_start" });
      emit({ type: "message_start", message: { role: "assistant", content: [] } });
      if (envelope.request === "provider error") {
        emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Fixture provider error" } });
        emit({ type: "agent_settled", aborted: false }); break;
      }
      let text = envelope.request === "xss"
        ? 'Safe **markdown**. <script>window.compromised=1</script><img src="https://tracker.invalid/pixel" onerror="window.compromised=1"><a href="javascript:alert(1)">unsafe</a><p style="position:fixed" class="toast" id="question">no styling</p>'
        : `A clear answer about ${envelope.page?.title ?? "your question"}. Quote: ${envelope.selection ?? "none"}. Unicode: café π 🌱\u2028still one record\u2029done.`;
      if (envelope.request === "slow") text = "A slow reply that can be stopped. ".repeat(100);
      active = { text: "", timer: null };
      const chunks = text.match(/[\s\S]{1,20}/g) ?? [];
      const tick = () => {
        if (!active) return;
        const chunk = chunks.shift();
        if (chunk === undefined) { finish(); return; }
        active.text += chunk;
        emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: chunk } });
        active.timer = setTimeout(tick, envelope.request === "slow" ? 100 : 8);
      };
      active.timer = setTimeout(tick, 10);
      break;
    }
    default: reply();
  }
}
process.stdin.on("data", chunk => {
  buffer += decoder.write(chunk);
  let end;
  while ((end = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => { if (active) clearTimeout(active.timer); process.exit(0); });
