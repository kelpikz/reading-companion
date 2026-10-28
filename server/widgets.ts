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
:root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 16px; overflow-wrap: anywhere; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
img, svg, canvas { max-width: 100%; }
</style></head><body>${source}</body></html>`;
}
