# Privacy, security and limits

## Reading versus tools

- **Reading is the default:** Pi has no tools. Extensions, MCP, discovered context files, skills, and prompt templates are disabled.
- **Tools is opt-in:** a confirmation starts a fresh Pi process with `read, bash, edit, write, grep, find, ls`. Your article and reading history are NOT automatically transferred. Every return to reading also starts a fresh process with tools off.
- **Tool mode is not sandboxed and does not ask permission for each call.** It has your OS account's permissions. The starting folder, `data/workspace/`, does not prevent access to other folders. Use a real container/VM if you want an OS security boundary.
- The app reuses your Pi model/auth settings, **not your installed extensions or MCP tools**. Terminal-only plugin interfaces are not supported.

## What a link can and cannot do

The local server fetches public HTML/plain text and extracts readable content with Mozilla Readability. It does not use cookies, your Brave/Chrome profile, or a JavaScript browser renderer. Login, paywall, anti-bot, and client-rendered pages can fail or return incomplete text. Paste the relevant text instead; the app never silently claims to have read the whole page.

Images in the article are loaded through the local server (`/media/<article id>/<n>`), with the same checks as article links: public addresses only, redirects rechecked, 10 MB per image, 80 images per article. The browser never contacts the article's site directly. When the article body has no image, the page's preview image (`og:image`) is shown at the top. Inline SVG diagrams are shown as static pictures. Diagrams that the site animates or colors with its own scripts and CSS show their first frame in neutral colors. Videos, embeds, and interactive widgets are not shown; use **Open the original** for those.

Limits: 20-second fetch deadline, 2 MB response, 5 redirects, 120,000 characters of article text, 20,000 characters per quote, 16,000 per question, and 200 transcript messages per session. Truncated or suspiciously short extraction is labelled. PDFs, video, sending images to the model, and automatic current-tab/selection capture are not included. Outbound article fetching does not currently support an HTTP proxy.

## Privacy and local security

**Shared page text and quotes are sent to your selected model provider** when you ask a question. Local Pi does not mean local model inference. There is no extra per-page confirmation. Review sensitive content before sharing it.

**Chats and context live only in the local server's memory.** Refreshing the browser reconnects to the same conversation. Restarting the app loses it. All open app tabs share one live conversation. Exports, tool-created files, OS swap/crash data, and model-provider retention are outside this in-memory policy.

The HTTP server binds only to 127.0.0.1, validates exact Host/Origin, and requires a random per-launch token for all API/event requests. The token is only bootstrapped into the app page, not localStorage. No CORS is enabled. Static paths cannot expose source files or Pi credentials. The backend exposes a narrow API, not arbitrary Pi RPC commands.

The link fetcher rejects local/private/reserved IPs, rechecks redirects, pins validated DNS addresses, enforces time/size limits, and runs no fetched scripts. Reading content is treated as untrusted reference material. Chat Markdown is sanitized; raw HTML in ordinary replies is displayed as text, and ordinary replies cannot show images. Built-in widget fences hold only data: the app checks it and shows its text as text. Quiz answers go to Pi in a separate `quiz` field, as data. Only explicit `widget` fences run code. They start when the reply is complete, in a frame served from a separate widget-only route with `sandbox allow-scripts` (never `allow-same-origin`), an opaque origin, restrictive CSP/permissions, and no API token. The app permits frames only under that route; widgets cannot frame the token-bearing app page. Widget URLs are capabilities for completed assistant blocks in the current session only and are revoked on a new chat. Article HTML is sanitized twice (server and browser) with one shared rule set (`shared/article.ts`): no scripts, styles, classes, forms, frames, or media players, and image sources must be the local `/media/` proxy. `/media/` serves only the current article's own images; the random article id in the path works as the access key, because an `<img>` cannot send the app token. Proxied images are sent with a sandbox content security policy.

These measures do not protect against malicious software already running as your user, a compromised browser/extension, or dangerous actions you explicitly enable in tool mode. Do not expose this service through ngrok, a reverse proxy, or your LAN.
