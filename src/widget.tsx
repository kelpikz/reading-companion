import { useState } from "preact/hooks";
import type { ChatMessage } from "../shared/types";
import { widgetPath, type WidgetPart } from "../shared/widgets";

export function Widget({ part, sessionId, messageId, status }: {
  part: WidgetPart; sessionId: string; messageId: string; status: ChatMessage["status"];
}) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [running, setRunning] = useState(false);
  const [revision, setRevision] = useState(0);
  const complete = status === "complete";
  const active = running && complete;
  function run() { setRevision(value => value + 1); setRunning(true); setView("preview"); }
  return (
    <section class="widget" aria-label={part.title}>
      <div class="widget-header">
        <strong class="widget-title">{part.title}</strong>
        <span class="tag">HTML widget</span>
        <div class="segmented" aria-label="Widget view">
          <button type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")}>Preview</button>
          <button type="button" aria-pressed={view === "code"} onClick={() => setView("code")}>Code</button>
        </div>
      </div>
      <div hidden={view !== "preview"}>
        {active ? (
          <iframe key={revision} class="widget-frame" title={part.title} sandbox="allow-scripts"
            referrerPolicy="no-referrer" src={widgetPath(sessionId, messageId, part.index)} />
        ) : (
          <div class="widget-placeholder">
            <p>{complete ? "Run generated HTML/JavaScript in an isolated preview. Review the code first, and do not enter secrets."
              : status === "streaming" ? "The widget can run when Pi finishes this reply."
              : "This reply did not finish. Ask Pi to generate the widget again."}</p>
            <button type="button" class="btn btn-primary" disabled={!complete} onClick={run}>Run widget</button>
          </div>
        )}
      </div>
      <pre class="widget-code" hidden={view !== "code"} tabIndex={0}><code>{part.source}</code></pre>
      <div class="widget-footer">
        <span>Isolated from chat · External resources blocked</span>
        {active && <div class="widget-controls">
          <button type="button" class="btn btn-small" onClick={run}>Restart</button>
          <button type="button" class="btn btn-small" onClick={() => setRunning(false)}>Stop widget</button>
        </div>}
      </div>
    </section>
  );
}
