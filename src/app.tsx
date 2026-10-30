import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AppState, Mode, ModelChoice, QuizAction, QuizResults, Source } from "../shared/types";
import { api, stream, type Link } from "./api";
import { Chat } from "./chat";
import { exportMarkdown } from "./export";
import { Icon, Spinner } from "./icons";
import { Panel, type ArticleJump, type SourcePayload } from "./panel";
import { PanelDivider } from "./panel-divider";

interface Confirm { title: string; body: string; label: string; tools?: boolean; action: () => Promise<void> }
type Status = "starting" | "ready" | "busy" | "error" | "offline";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function useWide() {
  const query = useMemo(() => matchMedia("(min-width: 1080px)"), []);
  const [wide, setWide] = useState(query.matches);
  useEffect(() => {
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [query]);
  return wide;
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [link, setLink] = useState<Link>("connecting");
  const [source, setSource] = useState<Source | null>(null);
  const [models, setModels] = useState<{ session: string; list: ModelChoice[] }>({ session: "", list: [] });
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [toast, setToast] = useState("");
  const [dismissed, setDismissed] = useState("");
  const [question, setQuestion] = useState("");
  const [quote, setQuote] = useState("");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const wide = useWide();
  const [panelOpen, setPanelOpen] = useState(wide);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [articleJump, setArticleJump] = useState<ArticleJump | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const modelRequest = useRef("");

  useEffect(() => { void stream(setState, setLink); }, []);
  useEffect(() => { setPanelOpen(wide); setArticleJump(null); }, [wide]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // The reader needs the full article text; snapshots only carry a summary.
  const sourceId = state?.source?.id;
  useEffect(() => {
    setArticleJump(null);
    if (!sourceId) { setSource(null); return; }
    let live = true;
    api<Source | null>("/api/source").then(next => { if (live) setSource(next); }, error => setToast(errorText(error)));
    return () => { live = false; };
  }, [sourceId]);

  const session = state?.sessionId;
  useEffect(() => {
    if (!session || !state?.ready || state.busy || modelRequest.current === session) return;
    modelRequest.current = session;
    api<ModelChoice[]>("/api/models").then(list => setModels({ session, list }), () => { modelRequest.current = ""; });
  }, [session, state?.ready, state?.busy]);

  const tools = state?.mode === "tools";
  const hasChat = Boolean(state?.messages.length);
  const idle = link === "online" && Boolean(state?.ready) && !state?.busy && !pending;
  const showPanel = Boolean(state) && !tools && panelOpen;
  const status: Status = link === "offline" || link === "expired" ? "offline"
    : !state ? "starting" : !state.ready ? (state.error ? "error" : "starting") : state.busy ? "busy" : "ready";
  const statusText = {
    offline: link === "expired" ? "Reload needed" : "Offline",
    starting: state ? "Starting Pi" : "Connecting",
    error: "Pi unavailable",
    busy: state?.activity ?? "Working",
    ready: "Ready",
  }[status];

  async function guard(task: () => Promise<void>) {
    setPending(true);
    try { await task(); } finally { setPending(false); }
  }
  async function fresh(mode: Mode) {
    setState(await api("/api/session", { mode, allowTools: mode === "tools" }));
    setQuestion(""); setQuote(""); setQuoteOpen(false);
  }
  function runNow(action: () => Promise<void>) { action().catch(error => setToast(errorText(error))); }

  function newChat() {
    if (!state) return;
    const action = () => guard(() => fresh(state.mode));
    if (!hasChat && !state.source) { runNow(action); return; }
    setConfirm({ title: "Start a new chat?", label: "New chat", tools, action,
      body: `This clears the conversation${state.source ? " and the article" : ""}. Export it first if you want to keep it.` });
  }
  function switchMode(mode: Mode) {
    if (!state || state.mode === mode) return;
    if (mode === "tools") setConfirm({ title: "Turn on tools?", label: "Turn on tools", tools: true, action: () => guard(() => fresh("tools")),
      body: "This starts a separate, empty session where Pi can use files and the shell. Your article and this chat are not copied to it." });
    else setConfirm({ title: "Back to reading?", label: "Start reading chat", action: () => guard(() => fresh("reading")),
      body: "This ends the tool session and starts a new reading chat with tools off." });
  }
  function restart() {
    if (link !== "online") { location.reload(); return; }
    if (!state) return;
    const action = () => guard(() => fresh(state.mode));
    if (!hasChat) { runNow(action); return; }
    setConfirm({ title: "Restart Pi?", label: "Restart", action, body: "This starts a new chat. Export the current one first if you want to keep it." });
  }
  async function attach(payload: SourcePayload) {
    const action = async () => {
      await guard(async () => { setState(await api("/api/source", payload)); });
      setToast("Article added. Ask Pi anything about it.");
      if (!wide) closePanel();
      questionRef.current?.focus();
    };
    if (!hasChat) return action();
    setConfirm({ title: "Start a new chat with this article?", label: "Add and start new chat", action,
      body: "Adding an article starts a new conversation. Export the current one first if you want to keep it." });
  }
  async function send(text: string, passage: string, fromComposer: boolean) {
    if (!idle || !text.trim()) return;
    const draft = { question, quote, quoteOpen };
    if (fromComposer) { setQuestion(""); setQuote(""); setQuoteOpen(false); }
    setPending(true);
    try { await api("/api/chat", { message: text, quote: passage }); }
    catch (error) {
      if (fromComposer) { setQuestion(draft.question); setQuote(draft.quote); setQuoteOpen(draft.quoteOpen); }
      setToast(errorText(error));
    } finally { setPending(false); questionRef.current?.focus(); }
  }
  /** A button under a finished quiz: more questions, an explanation, or harder questions. */
  async function quiz(action: QuizAction, results: QuizResults) {
    if (!idle) return;
    setPending(true);
    try { await api("/api/quiz", { action, results }); }
    catch (error) { setToast(errorText(error)); }
    finally { setPending(false); }
  }
  async function stop() {
    try { await api("/api/stop", {}); } catch (error) { setToast(errorText(error)); }
  }
  const modelList = models.session === session ? models.list : [];
  function selectModel(value: string) {
    const choice = modelList.find(model => model.provider + "/" + model.id === value);
    if (!choice || !idle) return;
    runNow(() => guard(async () => { setState(await api("/api/model", { provider: choice.provider, id: choice.id })); }));
  }
  function selectThinking(level: string) {
    if (!idle) return;
    runNow(() => guard(async () => { setState(await api("/api/thinking", { level })); }));
  }
  function quoteSelection(text: string) {
    setQuote(text.slice(0, 20_000)); setQuoteOpen(true);
    if (!wide) closePanel();
    requestAnimationFrame(() => questionRef.current?.focus());
  }
  function closePanel() { setPanelOpen(false); setArticleJump(null); }
  function openPanel() {
    setArticleJump(null); setPanelOpen(true);
    requestAnimationFrame(() => document.getElementById("source-url")?.focus());
  }
  function goToSection(sectionId: string) {
    if (state?.mode !== "reading" || !state.source?.sections.some(section => section.id === sectionId)) return;
    setArticleJump({ sourceId: state.source.id, sectionId });
    setPanelOpen(true);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirm) return;
      if (!wide && panelOpen) closePanel();
      else if (state?.busy) void stop();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [confirm, wide, panelOpen, state?.busy]);

  const problem = link === "expired" ? "The app restarted. Reload this tab to reconnect."
    : link === "offline" ? "Lost the connection to the local server. Keep the launcher window open."
    : state?.error && state.error !== dismissed ? state.error : "";
  const canRestart = link !== "online" || (state && !state.ready);

  return (
    <div class="app" data-mode={state?.mode ?? "reading"} data-status={status}>
      <header class="topbar">
        {!tools && (
          <button id="toggle-panel" class="icon-btn" aria-pressed={showPanel} disabled={!state}
            aria-label={showPanel ? "Hide article panel" : "Show article panel"} title={showPanel ? "Hide article" : "Show article"}
            onClick={() => { if (panelOpen) closePanel(); else openPanel(); }}>
            <Icon name="panel" size={18} />
            {state?.source && !showPanel && <span class="badge" />}
          </button>
        )}
        <div class="brand"><span class="logo" aria-hidden="true">π</span><span class="brand-name">Companion</span></div>
        <div id="status" class="status" data-state={status} role="status" aria-live="polite" title={statusText}>
          <span class="status-dot" /><span id="status-text" class="status-text">{statusText}</span>
        </div>
        <div class="spacer" />
        <div class="segmented" role="group" aria-label="Session mode">
          <button id="reading-mode" aria-pressed={!tools} disabled={!idle} onClick={() => switchMode("reading")}>
            <Icon name="book" size={15} /><span>Reading</span>
          </button>
          <button id="tools-mode" aria-pressed={tools} disabled={!idle} onClick={() => switchMode("tools")}>
            <Icon name="wrench" size={15} /><span>Tools</span>
          </button>
        </div>
        <button id="export-chat" class="icon-btn" aria-label="Export chat as Markdown" title="Export chat as Markdown" disabled={!hasChat}
          onClick={() => { if (state) { exportMarkdown(state); setToast("Chat exported as Markdown."); } }}>
          <Icon name="download" size={18} />
        </button>
        <button id="new-chat" class="btn btn-ghost new-chat" aria-label="New chat" title="New chat"
          disabled={link !== "online" || Boolean(state?.busy) || pending} onClick={newChat}>
          <Icon name="newChat" size={17} /><span class="label">New chat</span>
        </button>
      </header>

      {tools && state && (
        <div class="tools-strip" role="note">
          <Icon name="alert" size={15} />
          <span><strong>Tools are on.</strong> Pi can read, change, and run files as you. This is not a sandbox.</span>
          <code title={state.workspace}>{state.workspace}</code>
        </div>
      )}
      {problem && (
        <div id="error-banner" class="banner" role="alert">
          <Icon name="alert" size={16} />
          <span class="banner-text">{problem}</span>
          {canRestart && <button id="reconnect" class="btn btn-small" onClick={restart}>{link === "online" ? "Restart Pi" : "Reload"}</button>}
          {!canRestart && <button class="icon-btn small" aria-label="Dismiss" onClick={() => setDismissed(problem)}><Icon name="x" size={15} /></button>}
        </div>
      )}

      <div class="workspace" style={{ "--panel-width": panelWidth === null ? undefined : `${panelWidth}%` }}>
        {showPanel && !wide && <div class="scrim" onClick={closePanel} />}
        {showPanel && state && (
          <Panel summary={state.source} source={source} idle={idle} sheet={!wide} jump={articleJump}
            onAttach={attach} onQuote={quoteSelection} onClose={closePanel} />
        )}
        {showPanel && wide && <PanelDivider onResize={setPanelWidth} />}
        {state ? (
          <Chat state={state} idle={idle} tools={tools} panelVisible={showPanel && wide} models={modelList}
            question={question} setQuestion={setQuestion} quote={quote} setQuote={setQuote}
            quoteOpen={quoteOpen} setQuoteOpen={setQuoteOpen} questionRef={questionRef}
            onSend={send} onQuiz={quiz} onStop={stop} onModel={selectModel} onThinking={selectThinking} onOpenPanel={openPanel} onReference={goToSection} />
        ) : (
          <div class="loading"><Spinner /> Connecting to Pi…</div>
        )}
      </div>

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      <div id="toast" class="toast" role="status" hidden={!toast}>{toast}</div>
    </div>
  );
}

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current!;
    if (confirm && !node.open) { setError(""); node.showModal(); }
    else if (!confirm && node.open) node.close();
  }, [confirm]);
  async function run() {
    if (!confirm || busy) return;
    setBusy(true); setError("");
    try { await confirm.action(); dialog.current!.close(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  return (
    <dialog ref={dialog} id="confirm-dialog" class="dialog" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}
      onClick={event => { if (event.target === dialog.current && !busy) dialog.current!.close(); }}>
      {confirm && (
        <div class="dialog-body">
          <h2>{confirm.title}</h2>
          <p>{confirm.body}</p>
          {confirm.tools && (
            <div id="confirm-extra" class="callout warn">
              <Icon name="alert" size={16} />
              <p>This is not a sandbox. Pi can read, change, and run files with your account's permissions, also outside its start folder. It does not ask before each action. Do not give it instructions from pages you do not trust.</p>
            </div>
          )}
          {error && <p id="dialog-error" class="inline-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
          <div class="dialog-actions">
            <button id="cancel-dialog" type="button" class="btn" disabled={busy} onClick={() => dialog.current!.close()}>Cancel</button>
            <button id="confirm-action" type="button" class={"btn " + (confirm.tools ? "btn-warn" : "btn-primary")} disabled={busy} onClick={run}>
              {busy && <Spinner size={15} />}{confirm.label}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
