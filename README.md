# Pi Companion

A small, local reading companion for **Chrome, Chromium, and Brave**. The browser is the interface; your installed Pi runs behind it through RPC.

## Open it

On this Windows machine, double-click **Open Pi Companion.cmd** in this folder. It builds the app and opens Brave (or Chrome if Brave is not installed). **Keep its terminal window open.** Close it or press Ctrl+C to stop the app. If the app is already running, the launcher only opens the browser. If the running copy is an older version (for example, after an update), the launcher stops and tells you. Close the old window, then start again.

Or, from this folder:

```sh
npm ci --ignore-scripts
npm run build
npm run open
```

The default address is **http://127.0.0.1:47831**. Use that exact address, not `localhost`, a LAN IP, or a tunnel. `npm start` runs the built server without opening a browser. On macOS/Linux, `bash open.sh` installs, builds, and opens the default browser. Only Windows/Brave and Windows/Chrome have been runtime-tested here.

**Requirements:** Node.js 22.19+, an installed Pi CLI (verified with 1.4.0), and a working Pi model login. Existing Pi credentials and default model are reused; no API key is put in browser storage. If Pi is not configured, run `pi` in a terminal and use `/login` and `/model` first.

## Reading flow

1. In the **article panel**, add an **article link**, or **paste text** from any page, including private pages.
2. The panel then shows the article as published: headings, images, figures, code, and tables. Switch to **Text Pi gets** to see the exact plain text that Pi receives (alongside a section index for navigation). Pi does not see the images; image descriptions (alt text) and diagram labels are in the text as `[Image: …]` and `[Diagram: …]`.
3. Ask a question. To quote part of the article, **select text in the panel** and click **Quote in chat**. You can also click **Passage** in the message box and paste a quote.
4. In the message box, pick the **model** and the **effort** (how long Pi thinks before it answers). Effort shows only the levels that the model supports. Press **Stop** (or Esc) to stop a reply.
5. Pi can link directly to article headings in its answers. Click a heading reference to open the article panel, scroll to that heading, and briefly highlight it. This also works on narrow screens. Pasted text supports Markdown headings; text without headings uses paragraph references. Only targets in the current article are clickable. These in-app links do not work outside the app or in exported chats.
6. **Export** downloads a Markdown copy. **New chat**, changing the article, and changing modes start fresh conversations.

Enter sends; Shift+Enter inserts a newline. Nothing automatically monitors your tabs. The app follows your system light/dark theme.

On wide windows (1080 px or more), the article panel is on the left and the chat is on the right. **Drag the divider** between them left or right to give either side more space. You can also focus the divider and use the arrow keys (Shift for larger steps), or Home/End for the smallest/largest article width. Double-click it or press Enter to reset the split. The split stays while you hide and reopen the panel; refreshing resets it. On narrow windows, the chat fills the window, and the panel button at the top left opens the article as an overlay. A narrow window next to your real article tab works well.

**Chats and context live only in the local server's memory.** Refreshing the browser reconnects to the same conversation. Restarting the app loses it. All open app tabs share one live conversation. Exports, tool-created files, OS swap/crash data, and model-provider retention are outside this in-memory policy.

## Chat widgets

Ask Pi for a visual or interactive aid, for example: **"Make a quiz about this article"** or **"Show these numbers as a chart."** Widgets work in reading and tool modes. They do not need filesystem or shell tools.

Every widget has a title bar. Click the title bar or the arrow to collapse a widget. A collapsed widget keeps its state. While Pi writes a widget, the chat shows a short placeholder, not the code. Copy and export include the original widget block. Limits: four widgets per reply, 50,000 characters each. Oversized or excess blocks stay as code.

### Built-in widgets

Built-in widgets are the default. Pi writes only data (one JSON object), and the app draws the widget with its own components, in the app's colours and theme. No model code runs. A built-in widget shows as soon as its block is complete.

| Fence | Use | Data |
|---|---|---|
| `chart` | Numbers to compare, or a change over time | `title`, `type` (`bar` or `line`), `labels`, `series` (`name`, `values`), optional `unit` and `note` |
| `steps` | A process, in order | `title`, `steps` (`title`, optional `detail`) |
| `quiz` | Multiple-choice questions | `title`, `questions` (`question`, `options`, zero-based `answer`, optional `explanation` and `section`, an article href) |
| `flashcards` | Terms or facts to remember | `title`, `cards` (`front`, `back`) |

~~~~markdown
```chart
{"title": "Adults online", "type": "line", "labels": ["2000", "2010", "2020"],
 "series": [{"name": "US", "values": [52, 71, 91]}], "unit": "%"}
```
~~~~

The app shows all text in the data as plain text, not as Markdown or HTML. If the JSON is not valid, or does not match the format, the block stays as plain code. A chart has a tooltip, arrow-key reading, and a **Show data** table.

To add a widget type:

1. In `shared/builtin-widgets.ts`, add the spec type, a parser that checks the JSON, and one prompt line for Pi.
2. In `src/widgets/`, add a Preact component that draws the spec. Add it to `src/widgets/index.ts`.
3. Add its styles to `src/style.css` and its tests to `tests/widgets.test.ts`.

TypeScript shows an error until you do steps 1 and 2.

### Quiz skill

Type `/quiz` in the message box, or click **Quiz me** in a new article chat. Pi then writes a quiz about the article. The text after `/quiz` sets the focus, for example `/quiz the part about caching`. If you attach a passage, the quiz is about that passage only.

When you answer a question wrong, the quiz shows a **Read "…"** link to the article section that has the answer (only if Pi gave a section of the current article). Click it to open that section.

When you answer all the questions, buttons show under the quiz:

- **More on what I missed**: a new quiz about only the ideas that you got wrong.
- **Explain my mistakes**: a short explanation of each wrong answer, with a link to the section to read again.
- **Go deeper**: a new quiz with harder questions about the same topics. This is the only button when all your answers are correct.

With each button, Pi gets your answers as data in a separate `quiz` field, not as instructions. Your answers stay only in the browser tab: a refresh clears them.

**Edit the prompts in `skills/quiz.md`.** The file has one `## ` section for each action: Start, More, Deeper, and Explain. The app reads the file each time, so a change works on the next quiz without a restart. If the file or a section is missing, the chat shows an error.

### Custom widgets

Pi writes a custom widget only when no built-in widget fits. It is self-contained HTML, CSS and JavaScript in a closed, top-level `widget` fence with an optional title:

~~~~markdown
```widget Counter
<button class="primary" onclick="this.textContent = Number(this.textContent) + 1">0</button>
```
~~~~

A custom widget starts automatically when the reply finishes. It does not start while the reply streams, or from a stopped or failed reply. **Restart** resets it. Refresh starts it again, without its old state.

The frame gives the widget the app's theme in light and dark mode: CSS variables (`--text`, `--text-2`, `--bg`, `--surface`, `--surface-2`, `--border`, `--accent`, `--accent-soft`, `--on-accent`), styled text, buttons, inputs, sliders, selects and tables, and the helper classes `card`, `row`, `grid`, `muted` and `primary`.

Use inline CSS and vanilla JavaScript, accessible labels, and responsive layouts. Inline SVG, canvas, and data-URL images work. External libraries, network APIs, external images/fonts/styles, submitting forms, frames, workers, popups, downloads, app APIs, storage, and access to chat/article content are not supported. There is no widget-to-chat command bridge: the app reads only the widget's content height, to size the preview without a second scrollbar. Ordinary `html` fences, raw HTML, and fences nested in quotes/lists remain inert code/text.

**A custom widget runs model-written code without a click, so never enter secrets into a widget.** Article text can try to trick Pi into writing a harmful widget. An opaque-origin iframe and HTTP security policies isolate it from the app, restrict navigation, and block network APIs/external resources. These browser controls are not a complete network firewall (for example, not every browser-specific API is covered by CSP), nor an OS-level CPU/memory sandbox. Buggy code can still slow the tab. Use a separate restricted browser/container if you need that stronger boundary.

## Reading versus tools

- **Reading is the default:** Pi has no tools. Extensions, MCP, discovered context files, skills, and prompt templates are disabled.
- **Tools is opt-in:** a confirmation starts a fresh Pi process with `read, bash, edit, write, grep, find, ls`. Your article and reading history are NOT automatically transferred. Every return to reading also starts a fresh process with tools off.
- **Tool mode is not sandboxed and does not ask permission for each call.** It has your OS account's permissions. The starting folder, `data/workspace/`, does not prevent access to other folders. Use a real container/VM if you want an OS security boundary.
- This MVP reuses your Pi model/auth settings, **not your installed extensions or MCP tools**. Terminal-only plugin interfaces are not supported.

## What a link can and cannot do

The local server fetches public HTML/plain text and extracts readable content with Mozilla Readability. It does not use cookies, your Brave/Chrome profile, or a JavaScript browser renderer. Login, paywall, anti-bot, and client-rendered pages can fail or return incomplete text. Paste the relevant text instead; the app never silently claims to have read the whole page.

Images in the article are loaded through the local server (`/media/<article id>/<n>`), with the same checks as article links: public addresses only, redirects rechecked, 10 MB per image, 80 images per article. The browser never contacts the article's site directly. When the article body has no image, the page's preview image (`og:image`) is shown at the top. Inline SVG diagrams are shown as static pictures. Diagrams that the site animates or colors with its own scripts and CSS show their first frame in neutral colors. Videos, embeds, and interactive widgets are not shown; use **Open the original** for those.

Limits: 20-second fetch deadline, 2 MB response, 5 redirects, 120,000 characters of article text, 20,000 characters per quote, 16,000 per question, and 200 transcript messages per session. Truncated or suspiciously short extraction is labelled. PDFs, video, sending images to the model, and automatic current-tab/selection capture are not included. Outbound article fetching does not currently support an HTTP proxy.

## Privacy and local security

**Shared page text and quotes are sent to your selected model provider** when you ask a question. Local Pi does not mean local model inference. There is no extra per-page confirmation, as requested. Review sensitive content before sharing it.

The HTTP server binds only to 127.0.0.1, validates exact Host/Origin, and requires a random per-launch token for all API/event requests. The token is only bootstrapped into the app page, not localStorage. No CORS is enabled. Static paths cannot expose source files or Pi credentials. The backend exposes a narrow API, not arbitrary Pi RPC commands.

The link fetcher rejects local/private/reserved IPs, rechecks redirects, pins validated DNS addresses, enforces time/size limits, and runs no fetched scripts. Reading content is treated as untrusted reference material. Chat Markdown is sanitized; raw HTML in ordinary replies is displayed as text, and ordinary replies cannot show images. Built-in widget fences hold only data: the app checks it and shows its text as text. Only explicit `widget` fences run code. They start when the reply is complete, in a frame served from a separate widget-only route with `sandbox allow-scripts` (never `allow-same-origin`), an opaque origin, restrictive CSP/permissions, and no API token. The app permits frames only under that route; widgets cannot frame the token-bearing app page. Widget URLs are capabilities for completed assistant blocks in the current session only and are revoked on a new chat. Ordinary Markdown and article sanitization rules are unchanged. Article HTML is sanitized twice (server and browser) with one shared rule set (`shared/article.ts`): no scripts, styles, classes, forms, frames, or media players, and image sources must be the local `/media/` proxy. `/media/` serves only the current article's own images; the random article id in the path works as the access key, because an `<img>` cannot send the app token. Proxied images are sent with a sandbox content security policy.

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

The model and effort pickers change only the live process, not your saved Pi defaults. Your choice stays when you start a new chat or change modes, but resets to Pi defaults when the app restarts. Missing/expired provider credentials surface as an error in the chat; use the Pi terminal login flow to fix them, then reconnect.

## Verification

```sh
npm run check
npm run test:pi
npm run test:browser
npm run test:widgets
npm run test:launcher
```

- Unit/integration tests exercise protocol framing (including split UTF-8 and U+2028/U+2029), streaming reconciliation, stop, failures, mode isolation, model validation, URL extraction, SSRF/redirect defenses, native DNS pinning, body limits, Host/Origin/token checks, and SSE refresh.
- `test:pi` uses your actual Pi executable with an isolated temp config and a deterministic **local HTTP model**. It checks real built-in write/read tools, streaming, quotes, Stop, models, effort (that `reasoning_effort` reaches the provider), and mode isolation without paid model calls or changes to your Pi config.
- `test:browser` drives the production app in headless Brave/Chrome using the same real Pi + local model. It checks desktop/mobile layouts, the dark theme, the article reader (rich HTML, proxied images, the plain-text view), quoting a text selection, export, refresh, error handling, models, explicit tool mode, actual file tools, Stop, clickable article references (desktop/mobile, pasted text, and refresh), and malicious model output.
- `test:widgets` uses the production UI, a fake Pi subprocess, and installed Brave/Chrome to test custom widgets (automatic start, collapse, Restart, streaming/interruption handling, refresh, the theme kit, responsive/dark layouts, and isolation) and built-in widgets (chart, steps, quiz, flashcards, plain-text data, and invalid data). A local HTTP sink checks blocked requests, external resources, forms, popups, navigation, and access to app/storage. Run `npm run build` first; no real model login is needed. `test:browser` additionally verifies custom and built-in widget output through the real Pi RPC process and source export.
- `test:launcher` checks the actual Windows double-click script, production build/startup, and reuse of an already-running app. It makes no model calls.
- Reports and screenshots are in `evidence/`. They contain only test fixtures, not your credentials or chats.
- The local deterministic model proves the integration, not the quality/latency or availability of a remote provider.

## Code map

- `src/`: browser UI (Preact + TSX) and styles. `app.tsx` is the frame and actions, `panel.tsx` is the article panel, `chat.tsx` is the conversation and message box, `style.css` holds the light/dark design tokens.
- `server/http.ts`: localhost API, static files, and SSE.
- `server/rpc.ts`: Pi discovery, child lifecycle, strict JSONL transport.
- `src/widget.tsx`, `src/widgets/`: the widget card (collapse), the custom-widget frame, and one component for each built-in widget.
- `shared/widgets.ts`, `shared/builtin-widgets.ts`, `server/widgets.ts`: shared fence parser/limits, built-in data formats and checks, and the isolated custom-widget document with its policies and theme kit.
- `server/controller.ts`: session/mode/tool policy and normalized chat state.
- `skills/quiz.md`, `server/quiz.ts`: the editable quiz skill prompts, and the code that reads them and checks quiz answers.
- `server/source.ts`: safe link and image fetch, article extraction (plain text for Pi, sanitized HTML for the reader).
- `shared/article.ts`: sanitizer rules for article HTML, shared by the server and the browser.
- `shared/types.ts`: browser/server state contract. `shared/sections.ts` defines safe article navigation targets and pasted-text section detection.
- `docs/adr-0001-local-web-pi-rpc.md`: accepted architecture and trade-offs.
- `tests/`, `scripts/`: automated verification and launchers.

Built as a personal MVP. No database, account system, browser extension, or cloud hosting required.
