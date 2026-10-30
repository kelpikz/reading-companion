/** This policy applies only to widget documents, never the app's own script context. */
export function widgetPolicy(origin: string): string {
  return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}; sandbox allow-scripts`;
}

export const WIDGET_PERMISSIONS = "camera=(), microphone=(), geolocation=(), display-capture=(), fullscreen=(), payment=(), usb=(), serial=(), hid=(), clipboard-read=(), clipboard-write=()";

/** Source is deliberately executable HTML, isolated by HTTP CSP and an opaque-origin iframe. */
export function widgetDocument(source: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Interactive widget</title>
<style>
/* The app's theme (keep in step with src/style.css), so custom widgets look like the rest of the chat. */
:root {
  color-scheme: light dark;
  --font: "Segoe UI Variable Text", "Segoe UI Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: "Cascadia Code", "Cascadia Mono", ui-monospace, "SF Mono", Consolas, monospace;
  --bg: #ffffff; --surface: #ffffff; --surface-2: #f2f2f0; --border: #e6e6e2; --border-strong: #d4d4cf;
  --text: #1b1b19; --text-2: #565650; --text-3: #74746d;
  --accent: #5b5bd6; --accent-hover: #4d4dc4; --accent-soft: #eeeefc; --on-accent: #ffffff;
  --ok: #1d9a52; --danger: #bf2f2a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111113; --surface: #1a1a1d; --surface-2: #232327; --border: #2a2a2f; --border-strong: #3b3b42;
    --text: #ededef; --text-2: #b3b3bb; --text-3: #8d8d96;
    --accent: #6c6ae6; --accent-hover: #7e7cf0; --accent-soft: #23223b; --on-accent: #ffffff;
    --ok: #4ade80; --danger: #ff8f86;
  }
}
* { box-sizing: border-box; }
body { margin: 16px; font: 15px/1.5 var(--font); color: var(--text); overflow-wrap: anywhere; }
h1, h2, h3, h4 { margin: 0 0 .5em; font-size: 1.05rem; line-height: 1.3; font-weight: 600; }
p { margin: 0 0 .75em; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; padding: 6px 12px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); font-size: 14px; font-weight: 500; }
button:hover { background: var(--surface-2); }
button.primary { border-color: transparent; background: var(--accent); color: var(--on-accent); }
button.primary:hover { background: var(--accent-hover); }
input:not([type=range], [type=checkbox], [type=radio], [type=color]), select, textarea {
  padding: 6px 10px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface);
}
input, select, textarea, progress { accent-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
table { border-collapse: collapse; font-size: 14px; }
th, td { padding: 6px 10px; border: 1px solid var(--border); text-align: left; }
th { background: var(--surface-2); font-weight: 600; }
code { font-family: var(--mono); font-size: .9em; }
.card { padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.muted { color: var(--text-2); }
output, .value { font-weight: 600; font-variant-numeric: tabular-nums; }
img, svg, canvas { max-width: 100%; }
</style>
<script>
// Sends only the content height, so the app can size the frame without a second scrollbar.
new ResizeObserver(() => parent.postMessage({ widgetHeight: document.documentElement.getBoundingClientRect().height }, "*"))
  .observe(document.documentElement);
</script></head><body>${source}</body></html>`;
}
