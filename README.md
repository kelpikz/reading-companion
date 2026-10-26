# Pi Companion

A small, local reading companion for **Chrome, Chromium, and Brave**. The browser is the interface; your installed Pi runs behind it through RPC.

## Open it

On this Windows machine, double-click **Open Pi Companion.cmd** in this folder. It builds the app and opens Brave (or Chrome if Brave is not installed). **Keep its terminal window open.** Close it or press Ctrl+C to stop the app.

Or, from this folder:

```sh
npm ci --ignore-scripts
npm run build
npm run open
```

The default address is **http://127.0.0.1:47831**. Use that exact address, not `localhost`, a LAN IP, or a tunnel. `npm start` runs the built server without opening a browser. On macOS/Linux, `bash open.sh` installs, builds, and opens the default browser. Only Windows/Brave and Windows/Chrome have been runtime-tested here.

**Requirements:** Node.js 22.19+, an installed Pi CLI (verified with 1.4.0), and a working Pi model login. Existing Pi credentials and default model are reused; no API key is put in browser storage. If Pi is not configured, run `pi` in a terminal and use `/login` and `/model` first.

## Reading flow

1. Add an **article link**, or **paste text** from any page, including private pages.
2. Check **Preview text** to see exactly what was extracted.
3. Ask a question. Optionally use **Add a passage** to paste a highlighted quote alongside it.
4. Change models with the picker, or press **Stop** to interrupt a reply.
5. **Export** downloads a Markdown copy. **New chat**, changing the article, and changing modes start fresh conversations.

Enter sends; Shift+Enter inserts a newline. Nothing automatically monitors your tabs. For a side-by-side reading experience, place this app in a separate narrow browser window next to your article.

**Chats and context live only in the local server's memory.** Refreshing the browser reconnects to the same conversation. Restarting the app loses it. All open app tabs share one live conversation. Exports, tool-created files, OS swap/crash data, and model-provider retention are outside this in-memory policy.

## Reading versus tools

- **Reading is the default:** Pi has no tools. Extensions, MCP, discovered context files, skills, and prompt templates are disabled.
- **Tools is opt-in:** a confirmation starts a fresh Pi process with `read, bash, edit, write, grep, find, ls`. Your article and reading history are NOT automatically transferred. Every return to reading also starts a fresh process with tools off.
- **Tool mode is not sandboxed and does not ask permission for each call.** It has your OS account's permissions. The starting folder, `data/workspace/`, does not prevent access to other folders. Use a real container/VM if you want an OS security boundary.
- This MVP reuses your Pi model/auth settings, **not your installed extensions or MCP tools**. Terminal-only plugin interfaces are not supported.

## What a link can and cannot do

The local server fetches public HTML/plain text and extracts readable content with Mozilla Readability. It does not use cookies, your Brave/Chrome profile, or a JavaScript browser renderer. Login, paywall, anti-bot, and client-rendered pages can fail or return incomplete text. Paste the relevant text instead; the app never silently claims to have read the whole page.

Limits: 20-second fetch deadline, 2 MB response, 5 redirects, 120,000 characters of article text, 20,000 characters per quote, 16,000 per question, and 200 transcript messages per session. Truncated or suspiciously short extraction is labelled. PDFs/video/image reading and automatic current-tab/selection capture are not included. Outbound article fetching does not currently support an HTTP proxy.

## Privacy and local security

**Shared page text and quotes are sent to your selected model provider** when you ask a question. Local Pi does not mean local model inference. There is no extra per-page confirmation, as requested. Review sensitive content before sharing it.

The HTTP server binds only to 127.0.0.1, validates exact Host/Origin, and requires a random per-launch token for all API/event requests. The token is only bootstrapped into the app page, not localStorage. No CORS is enabled. Static paths cannot expose source files or Pi credentials. The backend exposes a narrow API, not arbitrary Pi RPC commands.

The link fetcher rejects local/private/reserved IPs, rechecks redirects, pins validated DNS addresses, enforces time/size limits, and runs no fetched scripts. Reading content is treated as untrusted reference material. Markdown is sanitized; raw HTML is displayed as text; images, scripts, inline styles, and remote trackers are not rendered.

These measures do not protect against malicious software already running as your user, a compromised browser/extension, or dangerous actions you explicitly enable in tool mode. Do not expose this service through ngrok, a reverse proxy, or your LAN.

## Configuration

Environment variables apply to the launcher/server; no existing Pi settings are edited:

| Variable | Purpose |
| --- | --- |
| `PI_COMPANION_PORT` | Local port; default `47831`. |
| `PI_COMPANION_CLI` | Full path to Pi's `dist/bundle/cli.js` or a standalone executable, if autodetection fails. Do not point to Windows `pi.cmd`. |
| `PI_COMPANION_WORKSPACE` | Initial tool directory; default `data/workspace`. **Not a sandbox.** |
| `PI_COMPANION_BROWSER` | Browser executable used by the launcher or browser tests. |
| `PI_COMPANION_NO_BROWSER=1` | Do not automatically open a browser. |
| `PI_CODING_AGENT_DIR` | Optional normal Pi config-directory override, inherited by its subprocess. |

Example in Windows cmd:

```bat
set PI_COMPANION_PORT=47832
call "Open Pi Companion.cmd"
```

The model picker changes only the live process, not your saved Pi defaults. Missing/expired provider credentials surface as an error in the chat; use the Pi terminal login flow to fix them, then reconnect.

## Verification

```sh
npm run check
npm run test:pi
npm run test:browser
npm run test:launcher
```

- Unit/integration tests exercise protocol framing (including split UTF-8 and U+2028/U+2029), streaming reconciliation, stop, failures, mode isolation, model validation, URL extraction, SSRF/redirect defenses, native DNS pinning, body limits, Host/Origin/token checks, and SSE refresh.
- `test:pi` uses your actual Pi executable with an isolated temp config and a deterministic **local HTTP model**. It checks real built-in write/read tools, streaming, quotes, Stop, models, and mode isolation without paid model calls or changes to your Pi config.
- `test:browser` drives the production app in headless Brave/Chrome using the same real Pi + local model. It checks desktop/mobile layouts, source/quote UX, export, refresh, error handling, models, explicit tool mode, actual file tools, Stop, and malicious model output.
- `test:launcher` checks the actual Windows double-click script, production build/startup, and reuse of an already-running app. It makes no model calls.
- Reports and screenshots are in `evidence/`. They contain only test fixtures, not your credentials or chats.
- The local deterministic model proves the integration, not the quality/latency or availability of a remote provider.

## Code map

- `src/`: browser UI and styles.
- `server/http.ts`: localhost API, static files, and SSE.
- `server/rpc.ts`: Pi discovery, child lifecycle, strict JSONL transport.
- `server/controller.ts`: session/mode/tool policy and normalized chat state.
- `server/source.ts`: safe link fetch and extraction.
- `shared/types.ts`: browser/server state contract.
- `docs/adr-0001-local-web-pi-rpc.md`: accepted architecture and trade-offs.
- `tests/`, `scripts/`: automated verification and launchers.

Built as a personal MVP. No database, account system, browser extension, or cloud hosting required.
