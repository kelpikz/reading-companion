import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PI_COMPANION_PORT ?? 47831);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PI_COMPANION_PORT.");
const url = "http://127.0.0.1:" + port;
const browser = () => {
  if (process.env.PI_COMPANION_NO_BROWSER === "1") return;
  const brave = "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
  const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const executable = process.env.PI_COMPANION_BROWSER || (process.platform === "win32" && existsSync(brave) ? brave : process.platform === "win32" && existsSync(chrome) ? chrome : "");
  let child;
  if (executable) child = spawn(executable, [url], { detached: true, stdio: "ignore", windowsHide: true });
  else if (process.platform === "win32") child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true });
  else child = spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => console.log("Open this link in Chrome or Brave: " + url));
  child.unref();
};
async function probe() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    if (response.ok && (await response.text()).includes("<title>Pi · Reading companion</title>")) return "companion";
    return "occupied";
  } catch { return "free"; }
}
const existing = await probe();
if (existing === "companion") { console.log("Pi Companion is already running: " + url); browser(); }
else if (existing === "occupied") { console.error("Another app is using port " + port + ". Set PI_COMPANION_PORT to another port."); process.exitCode = 1; }
else {
  if (!existsSync(resolve(root, "dist-server/server/start.js")) || !existsSync(resolve(root, "dist/index.html"))) {
    throw new Error("Build the app first with npm run build, or use Open Pi Companion.cmd.");
  }
  const child = spawn(process.execPath, [resolve(root, "dist-server/server/start.js")], { cwd: root, stdio: "inherit", windowsHide: true });
  let exited = false;
  child.on("error", error => { console.error(error.message); exited = true; process.exitCode = 1; });
  child.on("exit", code => { exited = true; process.exitCode = code ?? 0; });
  process.on("SIGINT", () => child.kill("SIGTERM"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  let opened = false;
  for (let attempt = 0; attempt < 100 && !exited; attempt++) {
    if (await probe() === "companion") { browser(); opened = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!opened && !exited) {
    console.error("Startup took too long. Check the terminal output, or open " + url);
    child.kill("SIGTERM"); process.exitCode = 1;
  }
}
