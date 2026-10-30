import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { ChatMessage } from "../shared/types";
import type { BuiltinWidget } from "../shared/builtin-widgets";
import { widgetPath, type HtmlPart } from "../shared/widgets";
import { Icon, Spinner, type IconName } from "./icons";
import { BUILTINS } from "./widgets";

/** The frame every widget shares. Collapsing hides the widget but keeps its state. */
function WidgetCard({ icon, title, actions, children }: { icon: IconName; title: string; actions?: ComponentChildren; children: ComponentChildren }) {
  const [open, setOpen] = useState(true);
  return (
    <section class="widget" data-open={open} aria-label={title}>
      <div class="widget-header" onClick={event => { if (!(event.target as Element).closest("button")) setOpen(!open); }}>
        <Icon name={icon} size={15} />
        <strong class="widget-title" title={title}>{title}</strong>
        {open && actions}
        <button type="button" class="icon-btn small" aria-expanded={open} aria-label={open ? "Collapse widget" : "Expand widget"}
          title={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>
          <Icon name="chevronDown" size={14} class="widget-chevron" />
        </button>
      </div>
      <div class="widget-body" hidden={!open}>{children}</div>
    </section>
  );
}

export function Builtin({ widget }: { widget: BuiltinWidget }) {
  const { icon, Component } = BUILTINS[widget.type];
  // TypeScript cannot pair the component with its own spec type through the union.
  const Draw = Component as (props: { spec: typeof widget.spec }) => ComponentChildren;
  return <WidgetCard icon={icon} title={widget.spec.title}><Draw spec={widget.spec} /></WidgetCard>;
}

/** A widget fence that Pi is still writing. */
export function PendingWidget({ name }: { name: string }) {
  return (
    <div class="widget widget-pending" role="status">
      <Spinner size={14} />
      <span>{name === "widget" ? "Pi is writing a widget…" : `Pi is making the ${name}…`}</span>
    </div>
  );
}

/** A custom HTML widget. It starts when the reply is complete, in the isolated frame from server/widgets.ts. */
export function HtmlWidget({ part, sessionId, messageId, status }: {
  part: HtmlPart; sessionId: string; messageId: string; status: ChatMessage["status"];
}) {
  const [revision, setRevision] = useState(0);
  const [height, setHeight] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const complete = status === "complete";
  function restart() { setRevision(value => value + 1); setHeight(0); }

  // The widget document reports its content height (server/widgets.ts). Only a number from this frame is used.
  useEffect(() => {
    if (!complete) return;
    const onMessage = (event: MessageEvent) => {
      const value = event.data?.widgetHeight;
      if (event.source === frame.current?.contentWindow && typeof value === "number" && Number.isFinite(value)) setHeight(Math.ceil(value));
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [complete]);

  return (
    <WidgetCard icon="window" title={part.title} actions={complete && (
      <button type="button" class="icon-btn small" aria-label="Restart widget" title="Restart" onClick={restart}><Icon name="restart" size={14} /></button>
    )}>
      {complete ? (
        <iframe ref={frame} key={revision} class="widget-frame" title={part.title} sandbox="allow-scripts"
          referrerPolicy="no-referrer" src={widgetPath(sessionId, messageId, part.index)} style={height ? { height: height + "px" } : undefined} />
      ) : (
        <p class="widget-note">{status === "streaming" ? "The widget starts when Pi finishes this reply."
          : "This reply did not finish, so the widget did not start. Ask Pi to make it again."}</p>
      )}
    </WidgetCard>
  );
}
