import type { AppState } from "../shared/types";

/** Downloads the current chat as a Markdown file. */
export function exportMarkdown(state: AppState) {
  const title = state.source?.title ?? (state.mode === "tools" ? "Pi tool session" : "Pi conversation");
  const lines = [`# ${title}`, "", `Exported: ${new Date().toISOString()}`, `Mode: ${state.mode}`, `Model: ${state.model?.provider}/${state.model?.id}`, ""];
  if (state.source?.url) lines.push(`Source: ${state.source.url}`, "");
  for (const message of state.messages) {
    if (!message.text) continue;
    lines.push(`## ${message.role === "user" ? "You" : "Pi"}`, "");
    if (message.quote) lines.push(message.quote.split("\n").map(line => "> " + line).join("\n"), "");
    lines.push(message.text, "");
  }
  if (state.tools.length) {
    lines.push("## Tool activity", "");
    for (const tool of state.tools) lines.push(`### ${tool.name} (${tool.status})`, "", tool.args, "", tool.output, "");
  }
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `reading-companion-${new Date().toISOString().slice(0, 10)}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
