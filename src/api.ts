import type { AppState } from "../shared/types";

const token = document.querySelector<HTMLMetaElement>('meta[name="companion-token"]')!.content;

export async function api<T = AppState>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: data === undefined ? "GET" : "POST",
    headers: { "X-Companion-Token": token, ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
  return value;
}

/** "expired" means the server restarted with a new token; only a reload can recover. */
export type Link = "connecting" | "online" | "offline" | "expired";

/** Streams full state snapshots over SSE and reconnects with backoff. */
export async function stream(onState: (state: AppState) => void, onLink: (link: Link) => void) {
  let failures = 0;
  while (true) {
    try {
      const response = await fetch("/api/events", { headers: { "X-Companion-Token": token } });
      if (response.status === 401) { onLink("expired"); return; }
      if (!response.ok || !response.body) throw new Error("Connection unavailable");
      failures = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) throw new Error("Connection closed");
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (event.startsWith("data: ")) { onState(JSON.parse(event.slice(6))); onLink("online"); }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch { onLink("offline"); }
    await new Promise(resolve => setTimeout(resolve, Math.min(500 * 2 ** failures++, 5000)));
  }
}
