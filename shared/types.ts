export type Mode = "reading" | "tools";
export interface Source {
  id: string;
  kind: "link" | "text";
  title: string;
  url?: string;
  text: string;
  warnings: string[];
}
export type SourceSummary = Omit<Source, "text"> & { chars: number; words: number; excerpt: string };
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
}
export interface ModelChoice { provider: string; id: string; name: string }
export interface AppState {
  sessionId: string;
  mode: Mode;
  ready: boolean;
  busy: boolean;
  activity: string;
  model: ModelChoice | null;
  messages: ChatMessage[];
  tools: ToolActivity[];
  source: SourceSummary | null;
  error: string | null;
  workspace: string;
}
