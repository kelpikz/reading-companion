# Development

## Verification

```sh
npm run check
npm run test:pi
npm run test:browser
npm run test:widgets
npm run test:launcher
```

- Unit/integration tests exercise protocol framing (including split UTF-8 and U+2028/U+2029), streaming reconciliation, stop, failures, mode isolation, model validation, URL extraction, SSRF/redirect defenses, native DNS pinning, body limits, Host/Origin/token checks, SSE refresh, and the quiz skill (its prompt file and answer checks).
- `test:pi` uses your actual Pi executable with an isolated temp config and a deterministic **local HTTP model**. It checks real built-in write/read tools, streaming, quotes, Stop, models, effort (that `reasoning_effort` reaches the provider), and mode isolation without paid model calls or changes to your Pi config.
- `test:browser` drives the production app in headless Brave/Chrome using the same real Pi + local model. It checks desktop/mobile layouts, the dark theme, the resizable panes, the article reader (rich HTML, proxied images, the plain-text view), quoting a text selection, export, refresh, error handling, models, explicit tool mode, actual file tools, Stop, clickable article references (desktop/mobile, pasted text, and refresh), and malicious model output.
- `test:widgets` uses the production UI, a fake Pi subprocess, and installed Brave/Chrome to test custom widgets (automatic start, collapse, Restart, streaming/interruption handling, refresh, the theme kit, responsive/dark layouts, and isolation) and built-in widgets (chart, steps, quiz with its section links and next-step buttons, flashcards, plain-text data, and invalid data). A local HTTP sink checks blocked requests, external resources, forms, popups, navigation, and access to app/storage. Run `npm run build` first; no real model login is needed. `test:browser` additionally verifies custom and built-in widget output through the real Pi RPC process and source export.
- `test:launcher` checks the actual Windows double-click script, production build/startup, and reuse of an already-running app. It makes no model calls.
- The verify scripts write reports and screenshots to `evidence/`. This folder is not committed.
- The local deterministic model proves the integration, not the quality/latency or availability of a remote provider.

## Code map

- `src/`: browser UI (Preact + TSX) and styles. `app.tsx` is the frame and actions, `panel.tsx` is the article panel, `panel-divider.tsx` is the resizable split, `chat.tsx` is the conversation and message box, `style.css` holds the light/dark design tokens.
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
