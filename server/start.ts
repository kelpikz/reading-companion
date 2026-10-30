import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildId } from "./build.js";
import { Companion } from "./controller.js";
import { createApp } from "./http.js";
import { findPi } from "./rpc.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspace = resolve(process.env.READING_COMPANION_WORKSPACE ?? resolve(root, "data/workspace"));
const port = Number(process.env.READING_COMPANION_PORT ?? 47831);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("READING_COMPANION_PORT must be between 1 and 65535.");

try {
  const launch = await findPi();
  const companion = new Companion(launch, workspace, resolve(root, "skills/quiz.md"));
  const app = createApp(companion, resolve(root, "dist"), await buildId(resolve(root, "dist-server")));
  const origin = await app.listen(port);
  console.log(`\n  Reading Companion\n\n  Open ${origin} in Chrome or Brave.\n  Reading mode · ephemeral chats · tools off\n  Press Ctrl+C to stop.\n`);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await Promise.allSettled([companion.dispose(), app.close()]);
    process.exit(0);
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
  try { await companion.restart("reading"); }
  catch (error) { console.error("Pi could not start:", (error as Error).message); }
} catch (error) {
  console.error((error as NodeJS.ErrnoException).code === "EADDRINUSE"
    ? `Port ${port} is in use. The app may already be running: http://127.0.0.1:${port}\nSet READING_COMPANION_PORT to choose another port.`
    : (error as Error).message);
  process.exitCode = 1;
}
