import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { RefObject, VNode } from "preact";
import type { AppState, ChatMessage, ModelChoice, SourceSection, ToolActivity } from "../shared/types";
import { referencedSection } from "../shared/sections";
import { chatContent } from "../shared/widgets";
import { Icon, Spinner } from "./icons";
import { renderMarkdown } from "./markdown";
import { Picker } from "./picker";
import { Widget } from "./widget";

const EFFORT: Record<string, { label: string; hint: string }> = {
  off: { label: "Off", hint: "No extra thinking. Fastest." },
  minimal: { label: "Minimal", hint: "A very short think first" },
  low: { label: "Low", hint: "Short thinking. Quick answers." },
  medium: { label: "Medium", hint: "Balanced speed and depth" },
  high: { label: "High", hint: "Thinks longer. Better for hard questions." },
  xhigh: { label: "X-High", hint: "Very long thinking" },
  max: { label: "Max", hint: "Thinks the longest. Slowest." },
};
const effortLabel = (level: string) => EFFORT[level]?.label ?? level;
const contextSize = (tokens?: number) => !tokens ? undefined : tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}K`;

const SUGGESTIONS = [
  { label: "Summarize it", hint: "The main points, in short", prompt: "Summarize this article in a few short paragraphs. Start with the main point." },
  { label: "Explain it simply", hint: "Plain words and an example", prompt: "Explain the main idea of this article in plain language, with a simple example." },
  { label: "Find the argument", hint: "The claim and its evidence", prompt: "What is the main argument of this article, and what evidence supports it?" },
  { label: "Push back", hint: "Weak points and other views", prompt: "What are the strongest counterarguments, weak points, or missing perspectives in this article?" },
];

interface ChatProps {
  state: AppState;
  idle: boolean;
  tools: boolean;
  panelVisible: boolean;
  models: ModelChoice[];
  question: string;
  setQuestion: (value: string) => void;
  quote: string;
  setQuote: (value: string) => void;
  quoteOpen: boolean;
  setQuoteOpen: (value: boolean) => void;
  questionRef: RefObject<HTMLTextAreaElement>;
  onSend: (text: string, passage: string, fromComposer: boolean) => void;
  onStop: () => void;
  onModel: (value: string) => void;
  onThinking: (level: string) => void;
  onOpenPanel: () => void;
  onReference: (sectionId: string) => void;
}

export function Chat(props: ChatProps) {
  const { state } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // SSE snapshots recreate arrays, but a source's index never changes for the same id.
  const sections = useMemo(() => state.mode === "reading" ? state.source?.sections : undefined, [state.mode, state.source?.id]);

  useEffect(() => { stick.current = true; setAtBottom(true); }, [state.sessionId]);
  // Follow new output unless the reader has scrolled up.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  });
  function onScroll() {
    const node = scroller.current!;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    stick.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
  }
  function send(text: string, passage: string, fromComposer: boolean) {
    stick.current = true;
    props.onSend(text, passage, fromComposer);
  }

  const count = state.messages.length;
  const toolsAt = (index: number) => state.tools.filter(tool => Math.min(tool.after ?? count, count) === index);
  const items: VNode[] = [];
  const addTools = (index: number) => {
    const group = toolsAt(index);
    if (group.length) items.push(<div key={"tools-" + group[0].id} class="tool-group" role="listitem">{group.map(tool => <ToolRow key={tool.id} tool={tool} />)}</div>);
  };
  addTools(0);
  state.messages.forEach((message, index) => {
    if (message.role === "user") items.push(<UserMessage key={message.id} message={message} />);
    else if (message.text || message.status === "aborted" || message.status === "error") items.push(
      <AssistantMessage key={message.id} message={message} sessionId={state.sessionId} sections={sections} onReference={props.onReference} />);
    addTools(index + 1);
  });
  const last = state.messages.at(-1);
  const waiting = state.busy && !(last?.role === "assistant" && last.status === "streaming" && last.text);

  return (
    <section class="chat" aria-label="Conversation">
      <div ref={scroller} class="scroller" onScroll={onScroll}>
        {items.length ? (
          <div id="messages" class="thread" role="list" aria-label="Messages">
            {items}
            {waiting && (
              <div class="waiting" role="listitem">
                <span class="avatar" aria-hidden="true">π</span>
                <span class="shimmer">{state.activity}…</span>
              </div>
            )}
          </div>
        ) : (
          <Empty state={state} idle={props.idle} panelVisible={props.panelVisible} onOpenPanel={props.onOpenPanel}
            onSuggest={prompt => send(prompt, "", false)} />
        )}
      </div>
      <div class="jump-anchor">
        {items.length > 0 && !atBottom && (
          <button class="jump" aria-label="Scroll to the latest message" title="Scroll to latest"
            onClick={() => { stick.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }}>
            <Icon name="arrowDown" size={16} />
          </button>
        )}
      </div>
      <Composer {...props} onSend={send} />
    </section>
  );
}

function Empty({ state, idle, panelVisible, onOpenPanel, onSuggest }: {
  state: AppState; idle: boolean; panelVisible: boolean; onOpenPanel: () => void; onSuggest: (prompt: string) => void;
}) {
  if (state.mode === "tools") return (
    <div class="empty">
      <div class="empty-mark tools"><Icon name="wrench" size={22} /></div>
      <h2>Tool session</h2>
      <p>Ask Pi to work with files or run commands. It starts in this folder:</p>
      <code class="path">{state.workspace}</code>
      <div class="callout warn">
        <Icon name="alert" size={16} />
        <p>Pi acts with your account's permissions and does not ask before each action. Do not paste instructions from pages you do not trust.</p>
      </div>
    </div>
  );
  if (state.source) return (
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">π</div>
      <h2>Ask about this article</h2>
      <p class="empty-source">{state.source.title}</p>
      <div class="suggestions">
        {SUGGESTIONS.map(item => (
          <button key={item.label} class="suggestion" disabled={!idle} onClick={() => onSuggest(item.prompt)}>
            <strong>{item.label}</strong><span>{item.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">π</div>
      <h2>Read with Pi</h2>
      <p>{panelVisible ? "Add an article on the left, then ask about it. Or just ask a question." : "Add an article, then ask about it. Or just ask a question."}</p>
      {!panelVisible && <button id="open-panel" class="btn btn-primary" onClick={onOpenPanel}><Icon name="plus" size={16} />Add an article</button>}
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div class="message user" role="listitem">
      {message.quote && (
        <blockquote class={"message-quote" + (expanded ? " expanded" : "")} title={expanded ? "" : "Show the full passage"}
          onClick={() => setExpanded(!expanded)}>{message.quote}</blockquote>
      )}
      <div class="message-body">{message.text}</div>
      {message.status === "error" && <span class="tag error">Not sent</span>}
    </div>
  );
}

function AssistantMessage({ message, sessionId, sections, onReference }: {
  message: ChatMessage; sessionId: string; sections?: readonly SourceSection[]; onReference: (sectionId: string) => void;
}) {
  const parts = useMemo(() => {
    const content = chatContent(message.text);
    return content.parts.map(part => part.kind === "markdown"
      ? { ...part, html: renderMarkdown(part.text, sections, content.links) } : part);
  }, [message.text, sections]);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(message.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* Clipboard access can be blocked; the text stays selectable. */ }
  }
  return (
    <div class="message assistant" role="listitem" data-status={message.status}>
      <span class="avatar" aria-hidden="true">π</span>
      <div class="message-main">
        <div class="message-body prose" onClick={event => {
          const link = event.target instanceof Element ? event.target.closest("a") : null;
          const section = referencedSection(link?.getAttribute("href") ?? "", sections ?? []);
          if (section) { event.preventDefault(); onReference(section.id); }
        }}>
          {parts.map((part, index) => part.kind === "markdown"
            ? <div key={"markdown-" + index} dangerouslySetInnerHTML={{ __html: part.html }} />
            : <Widget key={"widget-" + part.index} part={part} sessionId={sessionId} messageId={message.id} status={message.status} />)}
        </div>
        {message.status !== "streaming" && (
          <div class="message-actions">
            {message.text && (
              <button class="icon-btn small" aria-label={copied ? "Copied" : "Copy reply"} title={copied ? "Copied" : "Copy"} onClick={copy}>
                <Icon name={copied ? "check" : "copy"} size={14} />
              </button>
            )}
            {message.status === "aborted" && <span class="tag">Stopped</span>}
            {message.status === "error" && <span class="tag error">Reply failed</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function toolTarget(args: string): string {
  try {
    const value = JSON.parse(args);
    const target = value.command ?? value.path ?? value.file_path ?? value.pattern ?? value.query;
    return typeof target === "string" ? target.split("\n")[0] : "";
  } catch { return ""; }
}

function ToolRow({ tool }: { tool: ToolActivity }) {
  const target = useMemo(() => toolTarget(tool.args), [tool.args]);
  return (
    <details class="tool" data-status={tool.status}>
      <summary>
        <span class="tool-state">
          {tool.status === "running" ? <Spinner size={14} /> : <Icon name={tool.status === "complete" ? "check" : "x"} size={14} />}
        </span>
        <span class="tool-name">{tool.name}</span>
        <span class="tool-target">{target}</span>
        <Icon name="chevronRight" size={14} class="tool-chevron" />
      </summary>
      <div class="tool-detail">
        <span class="tool-label">Input</span>
        <pre>{tool.args}</pre>
        <span class="tool-label">Output</span>
        <pre>{tool.output || (tool.status === "running" ? "Waiting for output…" : "No output")}</pre>
      </div>
    </details>
  );
}

function autosize(node: HTMLTextAreaElement | null, max: number) {
  if (!node) return;
  node.style.height = "auto";
  node.style.height = Math.min(node.scrollHeight, max) + "px";
  node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
}

function Composer({ state, idle, tools, models, question, setQuestion, quote, setQuote, quoteOpen, setQuoteOpen, questionRef, onSend, onStop, onModel, onThinking }: ChatProps) {
  const quoteRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => autosize(questionRef.current, 240), [question]);
  useLayoutEffect(() => autosize(quoteRef.current, 140), [quote, quoteOpen]);

  const canSend = idle && Boolean(question.trim());
  const submit = () => { if (canSend) onSend(question, quoteOpen ? quote : "", true); };
  const closeQuote = () => { setQuote(""); setQuoteOpen(false); questionRef.current?.focus(); };
  const choices = models.length ? models : state.model ? [state.model] : [];
  const modelOptions = [...choices]
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name))
    .map(model => ({ value: model.provider + "/" + model.id, label: model.name, group: model.provider, meta: contextSize(model.contextWindow) }));
  // An older server (still running from before an update) sends no levels.
  const levels = state.thinkingLevels ?? [];
  const canThink = levels.length > 1;
  const effortOptions = levels.map(level => ({ value: level, label: effortLabel(level), hint: EFFORT[level]?.hint }));
  const placeholder = tools ? "Tell Pi what to do…" : state.source ? "Ask about the article…" : "Ask Pi anything…";
  const note = tools ? "Tools act with your account's permissions. Chats are kept in memory only."
    : `What you share goes to ${state.model?.provider ?? "your model provider"}. Chats are kept in memory only.`;

  return (
    <div class="composer-wrap">
      <form id="chat-form" class="composer" onSubmit={event => { event.preventDefault(); submit(); }}>
        {quoteOpen && (
          <div class="composer-quote">
            <Icon name="quote" size={15} />
            <textarea id="quote-input" ref={quoteRef} rows={1} maxLength={20_000} aria-label="Quoted passage"
              placeholder="Paste a passage to ask about…" value={quote} onInput={event => setQuote(event.currentTarget.value)} />
            <button type="button" id="remove-quote" class="icon-btn small" aria-label="Remove passage" onClick={closeQuote}><Icon name="x" size={14} /></button>
          </div>
        )}
        <textarea id="question" ref={questionRef} rows={1} maxLength={16_000} aria-label="Message Pi" placeholder={placeholder}
          value={question} onInput={event => setQuestion(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } }} />
        <div class="composer-bar">
          {!tools && (
            <button type="button" id="add-quote" class="chip-btn" aria-pressed={quoteOpen} title="Add a passage from the article"
              onClick={() => { if (quoteOpen) closeQuote(); else { setQuoteOpen(true); requestAnimationFrame(() => quoteRef.current?.focus()); } }}>
              <Icon name="quote" size={15} /><span>Passage</span>
            </button>
          )}
          <Picker id="model-picker" label="Model" heading="Model" icon="sparkle" options={modelOptions}
            value={state.model ? state.model.provider + "/" + state.model.id : ""}
            display={state.model?.name ?? "No model"}
            title={state.model ? `Model: ${state.model.provider}/${state.model.id}` : "Choose a model"}
            disabled={!idle || !choices.length} onSelect={onModel} />
          <Picker id="effort-picker" label="Effort" heading="Effort · how long Pi thinks first" icon="gauge" options={effortOptions}
            value={state.thinking ?? ""}
            display={canThink ? effortLabel(state.thinking ?? "off") : "No effort"}
            title={canThink ? `Effort: ${effortLabel(state.thinking ?? "off")}` : "This model has no effort setting"}
            disabled={!idle || !canThink} onSelect={onThinking} />
          <div class="spacer" />
          {state.busy ? (
            <button type="button" id="stop" class="send stop" aria-label="Stop the reply" title="Stop (Esc)" disabled={state.activity === "Stopping"} onClick={onStop}>
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button type="submit" id="send" class="send" aria-label="Send" title="Send (Enter)" disabled={!canSend}>
              <Icon name="arrowUp" size={18} />
            </button>
          )}
        </div>
      </form>
      <p class="composer-note">{note}</p>
    </div>
  );
}
