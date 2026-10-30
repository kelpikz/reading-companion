import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Companion } from "../server/controller.js";
export const fakeLaunch = { command: process.execPath, args: [resolve("tests/fixtures/fake-pi.mjs")], label: "fixture" };
export async function fixture() {
  const workspace = await mkdtemp(resolve(tmpdir(), "reading-companion-test-"));
  const companion = new Companion(fakeLaunch, workspace);
  await companion.restart("reading");
  return { companion, async close() { await companion.dispose(); await rm(workspace, { recursive: true, force: true }); } };
}
export async function waitFor(predicate: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for test condition");
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
