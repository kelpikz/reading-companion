import test from "node:test";
import assert from "node:assert/strict";
import { JsonLines, PiRpc } from "../server/rpc.js";
import { fakeLaunch, waitFor } from "./helpers.js";
import { tmpdir } from "node:os";
test("JSONL handles split UTF-8 and Unicode line separators without readline corruption", () => {
  const records: unknown[] = [];
  const lines = new JsonLines(record => records.push(record));
  const value = { text: "café π 🌱\u2028line\u2029paragraph" };
  const bytes = Buffer.from(JSON.stringify(value) + "\r\n" + JSON.stringify({ next: true }) + "\n");
  for (const byte of bytes) lines.push(Buffer.from([byte]));
  assert.deepEqual(records, [value, { next: true }]);
});
test("malformed and oversized protocol records are rejected", () => {
  assert.throws(() => new JsonLines(() => {}).push(Buffer.from("{bad}\n")));
  assert.throws(() => new JsonLines(() => {}).push(Buffer.alloc(8_000_001, 32)), /oversized/);
});
test("RPC correlates concurrent commands and shuts down its child", async () => {
  const events: any[] = []; const exits: Error[] = [];
  const rpc = new PiRpc(fakeLaunch, event => events.push(event), error => exits.push(error));
  try {
    const state = await rpc.start(tmpdir(), []);
    assert.equal(state.model.id, "reader");
    const [models, again] = await Promise.all([rpc.command("get_available_models"), rpc.command("get_state")]);
    assert.equal(models.models.length, 2); assert.equal(again.model.provider, "fixture");
    await rpc.command("prompt", { message: JSON.stringify({ request: "hello" }) });
    await waitFor(() => events.some(event => event.type === "agent_settled"));
    assert.ok(events.some(event => event.type === "message_update"));
  } finally { await rpc.stop(); }
  assert.equal(exits.length, 0);
  await assert.rejects(rpc.command("get_state"), /not running/);
});
test("RPC reports unexpected process exits rather than hanging", async () => {
  let exit: Error | null = null;
  const rpc = new PiRpc(fakeLaunch, () => {}, error => { exit = error; });
  await rpc.start(tmpdir(), []);
  await assert.rejects(rpc.command("prompt", { message: JSON.stringify({ request: "crash" }) }), /exited/);
  await waitFor(() => Boolean(exit));
  await rpc.stop();
});
