export type Mode = "reading" | "tools";
export interface SourceSection {
  id: string;
  title: string;
  /** Heading level (1–6), or 0 for a paragraph reference. */
  level: number;
  /** UTF-16 range of the heading or paragraph in Source.text. */
  start: number;
  end: number;
  /** Index in the sanitized article's nonempty headings; absent for plain text. */
  heading?: number;
}
export interface Source {
  id: string;
  kind: "link" | "text";
  title: string;
  url?: string;
  /** Plain text: the only article content Pi receives. */
  text: string;
  /** App-generated navigation targets, never ids supplied by a fetched page. */
  sections: SourceSection[];
  warnings: string[];
  byline?: string;
  published?: string;
  /** Sanitized article HTML for the reader. Images point at /media/<id>/<n>. */
  html?: string;
  /** Original image URLs that /media/<id>/<n> may fetch, by index. */
  images?: string[];
}
export type SourceSummary = Omit<Source, "text" | "html" | "images"> & { chars: number; words: number; excerpt: string };
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  quote?: string;
  status: "complete" | "streaming" | "error" | "aborted";
}
export interface ToolActivity {
  id: string;
  name: string;
  args: string;
  output: string;
  status: "running" | "complete" | "error";
  /** Number of chat messages that existed when the tool started; the UI shows it after them. */
  after: number;
}
export interface ModelChoice { provider: string; id: string; name: string; reasoning?: boolean; contextWindow?: number }
export interface AppState {
  sessionId: string;
  mode: Mode;
  ready: boolean;
  busy: boolean;
  activity: string;
  model: ModelChoice | null;
  /** Pi's thinking level ("off", "low", "high", ...); the UI calls it effort. */
  thinking: string | null;
  /** Levels the current model supports; ["off"] or [] means no effort choice. */
  thinkingLevels: string[];
  messages: ChatMessage[];
  tools: ToolActivity[];
  source: SourceSummary | null;
  error: string | null;
  workspace: string;
}
