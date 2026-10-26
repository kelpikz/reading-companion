import { marked } from "marked";
import DOMPurify from "dompurify";
import type { AppState, ChatMessage, ModelChoice, Source, ToolActivity } from "../shared/types";
import "./style.css";

// Articles/model output cannot inject raw HTML, even transiently during sanitization.
marked.use({ renderer: { html({ text }) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
} } });

const icons: Record<string, string> = {
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z"/><path d="M8 7h8M8 11h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"/>',
  quote: '<path d="M10 11H4V5h6v6c0 5-2 7-5 8M20 11h-6V5h6v6c0 5-2 7-5 8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  export: '<path d="M12 3v12m-5-5 5 5 5-5M5 15v6h14v-6"/>',
  tool: '<path d="M14.7 6.3a5 5 0 0 0-6.9 6.9L3 18l3 3 4.8-4.8a5 5 0 0 0 6.9-6.9L14 13l-3-3 3.7-3.7Z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
};
function icon(name: string, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ""}</svg>`;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const token = document.querySelector<HTMLMetaElement>('meta[name="companion-token"]')!.content;
let state: AppState | null = null;
let online = false;
let pending = false;
let inputKind: "link" | "text" = "link";
let models: ModelChoice[] = [];
let modelSession = "";
let dialogAction: (() => Promise<void>) | null = null;
let displayedSession = "";
let autoScroll = true;
let lastError = "";
let sourcePreviewId = "";
let editingSource = false;
const messageElements = new Map<string, { node: HTMLElement; key: string }>();
const toolElements = new Map<string, { node: HTMLElement; key: string }>();

$("app").innerHTML = `
  <aside id="sidebar" class="sidebar" aria-label="Reading context">
    <a href="/" class="brand" aria-label="Pi Companion home"><span class="brand-symbol">π</span><span>pi<span class="brand-slash"> / </span><span class="brand-sub">companion</span></span></a>
    <div class="sidebar-content">
      <div class="section-label">ON YOUR READING DESK</div>
      <h1>A place for<br>your next question.</h1>
      <p class="sidebar-intro">Bring something you’re reading.<br>We’ll think it through together.</p>
      <div id="context-card" class="context-card" hidden>
        <div class="context-overline">${icon("book")} <span id="context-kind">READING CONTEXT</span><span class="context-check">${icon("check")}</span></div>
        <h2 id="context-title"></h2><p id="context-domain" class="context-domain"></p>
        <p id="context-excerpt" class="context-excerpt"></p>
        <div class="context-bottom"><span id="context-size"></span><button id="preview-context" class="text-button">Preview text ${icon("chevron")}</button></div>
        <div id="context-warnings" class="context-warnings" hidden></div>
      </div>
      <button id="toggle-reading-input" class="change-reading" aria-expanded="false" aria-controls="reading-input" hidden>Change reading ${icon("chevron")}</button>
      <div id="reading-input">
        <div class="section-heading"><h2 id="input-heading">Add your reading</h2><span id="input-note">ONE ARTICLE AT A TIME</span></div>
        <div class="input-tabs" role="tablist" aria-label="Article input">
          <button id="link-tab" role="tab" aria-selected="true" aria-controls="link-fields" tabindex="0">${icon("link")} Article link</button>
          <button id="text-tab" role="tab" aria-selected="false" aria-controls="text-fields" tabindex="-1">${icon("quote")} Paste text</button>
        </div>
        <form id="source-form">
          <div id="link-fields" role="tabpanel" aria-labelledby="link-tab"><label class="sr-only" for="source-url">Article URL</label><input id="source-url" type="url" placeholder="https://an-interesting-article…" autocomplete="off" maxlength="4000"><p class="field-hint">We’ll fetch its readable text, without cookies or a browser login.</p></div>
          <div id="text-fields" role="tabpanel" aria-labelledby="text-tab" hidden><label class="sr-only" for="source-title">Reading title (optional)</label><input id="source-title" placeholder="A title, if you like" maxlength="300"><label class="sr-only" for="source-text">Article or selected text</label><textarea id="source-text" rows="8" placeholder="Paste an article, a few paragraphs, or something you’ve highlighted…" maxlength="120000"></textarea><p class="field-hint">Best for private pages and selected passages. Up to 120,000 characters.</p></div>
          <button id="attach-source" type="submit" class="attach-button">${icon("plus")} <span>Add to conversation</span></button>
          <p id="source-error" class="inline-error" role="alert" hidden></p>
        </form>
        <div class="desk-note">${icon("book")} <p>No automatic tab access.<br>Pi sees only what you share here.</p></div>
      </div>
      <div id="tools-note" class="tools-note" hidden>${icon("tool")}<h2>Pi tools are enabled.</h2><p>File and shell actions run with your computer account’s permissions.</p><p class="workspace-label">Starting folder — not a sandbox</p><code id="workspace"></code><p>Articles stay in reading mode. Switching modes starts a fresh chat.</p></div>
    </div>
    <div class="sidebar-footer"><span class="local-dot"></span><span>Runs on your computer</span><span class="version">MVP · 0.1</span></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="topbar-left"><button id="toggle-sidebar" class="icon-button mobile-only" aria-label="Toggle reading context" aria-expanded="false">${icon("menu")}</button><div class="mode-switch" aria-label="Session mode"><button id="reading-mode" aria-pressed="true">${icon("book")} Reading</button><button id="tools-mode" aria-pressed="false">${icon("tool")} Tools</button></div><span id="mode-description" class="mode-description">A little perspective, on demand.</span></div><div class="topbar-actions"><button id="export-chat" class="icon-button" aria-label="Export chat as Markdown" title="Export chat as Markdown">${icon("export")}</button><button id="new-chat" class="new-chat">${icon("plus")} New chat</button></div></header>
    <div id="error-banner" class="error-banner" role="alert" hidden><span id="error-text"></span><button id="reconnect" class="text-button">Reconnect</button></div>
    <div id="conversation" class="conversation" tabindex="0" aria-label="Conversation">
      <section id="welcome" class="welcome"><div class="welcome-emblem">${icon("spark")}</div><span class="eyebrow">YOUR READING, WITH A LITTLE COMPANY</span><h2 id="welcome-title">A little clarity,<br><em>right beside you.</em></h2><p id="welcome-description">Untangle an idea. Follow a thread. Ask the question<br class="desktop-break"> you’d ask a thoughtful friend.</p><div id="suggestions" class="suggestions"><button data-prompt="Explain the main idea of this reading in plain language, with a simple example.">${icon("spark")} Explain it simply</button><button data-prompt="What is the main argument of this reading, and what evidence supports it?">${icon("book")} Find the argument</button><button data-prompt="What are the strongest counterarguments or missing perspectives in this reading?">${icon("quote")} Push back on it</button></div><p class="welcome-small" id="welcome-small">Start with an article, or just a question.</p></section>
      <div id="messages" class="messages" role="list" aria-label="Chat messages"></div>
      <section id="tool-section" class="tool-section" aria-label="Tool activity" hidden><details><summary>${icon("tool")} Tool activity <span id="tool-count"></span></summary><div id="tool-list"></div></details></section>
    </div>
    <div class="composer-area"><div class="composer-meta"><div id="status" class="status" role="status" aria-live="polite"><span id="status-dot" class="status-dot"></span><span id="status-text">Connecting to Pi…</span></div><label class="model-control"><span class="sr-only">Pi model</span><select id="model-select" aria-label="Pi model"><option value="">Loading model…</option></select></label></div>
      <form id="chat-form" class="composer"><div id="quote-container" class="quote-container" hidden><div class="quote-heading"><label for="quote-input">${icon("quote")} A passage to discuss</label><button id="remove-quote" type="button" class="icon-button" aria-label="Remove quoted passage">${icon("close")}</button></div><textarea id="quote-input" rows="3" maxlength="20000" placeholder="Paste the highlighted passage here…"></textarea></div><label class="sr-only" for="question">Ask Pi a question</label><textarea id="question" rows="2" maxlength="16000" placeholder="What are you wondering about?" aria-describedby="composer-hint"></textarea><div class="composer-bottom"><button id="add-quote" type="button" class="quote-button">${icon("quote")} Add a passage</button><span id="composer-hint" class="keyboard-hint">Enter to send · Shift+Enter for a new line</span><button id="send" type="submit" class="send-button" aria-label="Send question">${icon("arrow")}</button><button id="stop" type="button" class="stop-button" hidden><span class="stop-square"></span> Stop</button></div></form>
      <p id="privacy-note" class="privacy-note">Your text goes to your Pi model provider. Chats live in memory; export to keep them.</p>
    </div>
  </main>
  <dialog id="confirm-dialog"><form method="dialog" class="dialog-content"><div class="dialog-emblem">${icon("book")}</div><h2 id="confirm-title"></h2><p id="confirm-description"></p><p id="confirm-extra" class="dialog-warning" hidden></p><div class="dialog-actions"><button id="cancel-dialog" value="cancel" class="secondary-button">Cancel</button><button id="confirm-action" type="button" class="primary-button">Continue</button></div><p id="dialog-error" class="inline-error" role="alert" hidden></p></form></dialog>
  <dialog id="preview-dialog" class="preview-dialog"><div class="preview-heading"><div><span class="eyebrow">EXACT TEXT SHARED WITH PI</span><h2 id="preview-title"></h2></div><button id="close-preview" class="icon-button" aria-label="Close text preview">${icon("close")}</button></div><pre id="preview-text"></pre></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;

async function api<T = AppState>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(path, { method: data === undefined ? "GET" : "POST", headers: {
    "X-Companion-Token": token, ...(data === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
  return value;
}
function showError(error: unknown, target = "source-error") {
  $(target).textContent = error instanceof Error ? error.message : String(error);
  $(target).hidden = false;
}
let toastTimer = 0;
function toast(message: string) {
  $("toast").textContent = message; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { $("toast").hidden = true; }, 4000);
}
function setKind(kind: "link" | "text") {
  inputKind = kind;
  $("link-fields").hidden = kind !== "link"; $("text-fields").hidden = kind !== "text";
  for (const [id, active] of [["link-tab", kind === "link"], ["text-tab", kind === "text"]] as const) {
    $(id).setAttribute("aria-selected", String(active)); $(id).tabIndex = active ? 0 : -1;
  }
  $("source-error").hidden = true;
}
$("link-tab").onclick = () => setKind("link");
$("text-tab").onclick = () => setKind("text");
$("toggle-reading-input").onclick = () => { editingSource = !editingSource; render(); };
for (const id of ["link-tab", "text-tab"]) $(id).onkeydown = event => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault(); setKind(inputKind === "link" ? "text" : "link"); $(inputKind === "link" ? "link-tab" : "text-tab").focus();
  }
};
$("toggle-sidebar").onclick = () => {
  const open = $("sidebar").classList.toggle("sidebar-open");
  $("toggle-sidebar").setAttribute("aria-expanded", String(open));
};

function confirmAction(title: string, description: string, action: () => Promise<void>, tools = false, label = "Start fresh") {
  $("confirm-title").textContent = title; $("confirm-description").textContent = description;
  $("confirm-extra").hidden = !tools;
  $("confirm-extra").textContent = "This is not a sandbox. Pi can read, change, or execute files with your account’s permissions, including outside its starting folder. Tools run without per-call approval. Never give tool mode untrusted page instructions.";
  $("confirm-action").textContent = label;
  $("dialog-error").hidden = true;
  dialogAction = action;
  $("confirm-dialog").querySelector(".dialog-emblem")!.innerHTML = icon(tools ? "tool" : "book");
  $<HTMLDialogElement>("confirm-dialog").showModal();
}
$("confirm-action").onclick = async () => {
  if (!dialogAction || pending) return;
  pending = true; render();
  $<HTMLButtonElement>("confirm-action").disabled = true;
  try { await dialogAction(); $<HTMLDialogElement>("confirm-dialog").close(); }
  catch (error) { showError(error, "dialog-error"); }
  finally { pending = false; $<HTMLButtonElement>("confirm-action").disabled = false; render(); }
};
function acceptState(next: AppState) { state = next; online = true; render(); }
async function fresh(mode: "reading" | "tools") {
  const next = await api("/api/session", { mode, allowTools: mode === "tools" });
  acceptState(next);
  $<HTMLTextAreaElement>("question").value = "";
  $<HTMLTextAreaElement>("quote-input").value = "";
  $("quote-container").hidden = true;
  $<HTMLTextAreaElement>("source-text").value = "";
  $<HTMLInputElement>("source-url").value = "";
  $<HTMLInputElement>("source-title").value = "";
  render();
}
$("new-chat").onclick = () => confirmAction("A fresh page?", "This clears the current chat and reading context. Export the conversation first if you’d like to keep it.", () => fresh(state?.mode ?? "reading"), state?.mode === "tools");
$("tools-mode").onclick = () => {
  if (state?.mode === "tools") return;
  confirmAction("Switch on Pi’s tools?", "This starts a separate, empty tool session. Your article and reading conversation will not be copied into it.", () => fresh("tools"), true, "Enable tools & start fresh");
};
$("reading-mode").onclick = () => {
  if (state?.mode === "reading") return;
  confirmAction("Back to reading?", "This ends the tool chat and starts a fresh reading session with tools disabled.", () => fresh("reading"));
};
$("reconnect").onclick = () => {
  if (!online) { location.reload(); return; }
  confirmAction("Reconnect to Pi?", "A fresh reading session will start. Export your current chat first if you need it.", () => fresh("reading"));
};

async function attachSource() {
  const payload = inputKind === "link" ? { kind: "link", url: $<HTMLInputElement>("source-url").value.trim() }
    : { kind: "text", title: $<HTMLInputElement>("source-title").value, text: $<HTMLTextAreaElement>("source-text").value };
  if (inputKind === "link" && !(payload as {url: string}).url) throw new Error("Paste an article link first.");
  $("source-error").hidden = true;
  const next = await api("/api/source", payload);
  acceptState(next);
  $<HTMLTextAreaElement>("source-text").value = "";
  $<HTMLInputElement>("source-title").value = "";
  $<HTMLInputElement>("source-url").value = "";
  $("sidebar").classList.remove("sidebar-open"); $("toggle-sidebar").setAttribute("aria-expanded", "false");
  toast("Reading context added. What caught your attention?");
  $<HTMLTextAreaElement>("question").focus();
}
$("source-form").onsubmit = async event => {
  event.preventDefault();
  if (pending || !state?.ready || state.busy) return;
  if (state.messages.length) {
    confirmAction("Read something new?", "Adding this reading starts a fresh conversation. Export the current chat first if you’d like to keep it.", attachSource, false, "Add reading & start fresh");
    return;
  }
  pending = true; render();
  try { await attachSource(); }
  catch (error) { showError(error); }
  finally { pending = false; render(); }
};
$("preview-context").onclick = async () => {
  try {
    const source = await api<Source | null>("/api/source");
    if (!source) return;
    $("preview-title").textContent = source.title; $("preview-text").textContent = source.text;
    $<HTMLDialogElement>("preview-dialog").showModal();
  } catch (error) { toast((error as Error).message); }
};
$("close-preview").onclick = () => $<HTMLDialogElement>("preview-dialog").close();
for (const id of ["confirm-dialog", "preview-dialog"]) $(id).onclick = event => {
  if (event.target !== $(id)) return;
  const bounds = $(id).getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $<HTMLDialogElement>(id).close();
};
$("add-quote").onclick = () => { $("quote-container").hidden = false; $<HTMLTextAreaElement>("quote-input").focus(); };
$("remove-quote").onclick = () => { $("quote-container").hidden = true; $<HTMLTextAreaElement>("quote-input").value = ""; $<HTMLTextAreaElement>("question").focus(); };
$("question").oninput = () => renderControls();
$("question").onkeydown = event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); if (!$<HTMLButtonElement>("send").disabled && !state?.busy) $<HTMLFormElement>("chat-form").requestSubmit();
  }
};
$("chat-form").onsubmit = async event => {
  event.preventDefault();
  if (pending || !state?.ready || state.busy || !online) return;
  const question = $<HTMLTextAreaElement>("question");
  const quote = $<HTMLTextAreaElement>("quote-input");
  if (!question.value.trim()) return;
  pending = true; autoScroll = true; render();
  try {
    await api("/api/chat", { message: question.value, quote: quote.value });
    question.value = ""; quote.value = ""; $("quote-container").hidden = true;
  } catch (error) { toast((error as Error).message); }
  finally { pending = false; render(); question.focus(); }
};
$("stop").onclick = async () => {
  $<HTMLButtonElement>("stop").disabled = true;
  try { await api("/api/stop", {}); }
  catch (error) { toast((error as Error).message); }
  finally { renderControls(); }
};
$("suggestions").querySelectorAll<HTMLButtonElement>("button").forEach(button => button.onclick = () => {
  $<HTMLTextAreaElement>("question").value = button.dataset.prompt ?? "";
  $<HTMLTextAreaElement>("question").focus(); renderControls();
});
$("model-select").onchange = async () => {
  const selected = models.find(model => model.provider + "/" + model.id === $<HTMLSelectElement>("model-select").value);
  if (!selected || pending) return;
  pending = true; renderControls();
  try { acceptState(await api("/api/model", { provider: selected.provider, id: selected.id })); }
  catch (error) { toast((error as Error).message); }
  finally { pending = false; renderControls(); updateModels(); }
};
async function loadModels(session: string) {
  try {
    const choices = await api<ModelChoice[]>("/api/models");
    if (state?.sessionId !== session) return;
    models = choices; updateModels();
  } catch { if (modelSession === session) modelSession = ""; }
}
function updateModels() {
  const select = $<HTMLSelectElement>("model-select");
  const choices = models.length ? models : state?.model ? [state.model] : [];
  if (select.dataset.version !== displayedSession + ":" + choices.length) {
    select.replaceChildren();
    for (const model of choices) {
      const option = document.createElement("option"); option.value = model.provider + "/" + model.id;
      option.textContent = model.name + " · " + model.provider; select.append(option);
    }
    if (!choices.length) select.append(new Option("No model configured", ""));
    select.dataset.version = displayedSession + ":" + choices.length;
  }
  select.value = state?.model ? state.model.provider + "/" + state.model.id : "";
  select.title = state?.model ? `${state.model.provider}/${state.model.id}` : "Choose a Pi model";
}

function renderControls() {
  const idle = Boolean(online && state?.ready && !state.busy && !pending);
  $<HTMLButtonElement>("send").disabled = !idle || !$<HTMLTextAreaElement>("question").value.trim();
  $("send").hidden = Boolean(state?.busy);
  $("stop").hidden = !state?.busy;
  $<HTMLButtonElement>("stop").disabled = !online || state?.activity === "Stopping";
  for (const id of ["attach-source", "reading-mode", "tools-mode", "model-select"]) ($<HTMLButtonElement>(id)).disabled = !idle;
  // A failed Pi process can always be replaced with a new reading session.
  $<HTMLButtonElement>("new-chat").disabled = !online || Boolean(state?.busy) || pending;
  $<HTMLButtonElement>("export-chat").disabled = !state?.messages.length;
  $("attach-source").querySelector("span")!.textContent = pending ? "One moment…" : state?.source ? "Replace reading" : "Add to conversation";
}
function renderMessage(message: ChatMessage) {
  let entry = messageElements.get(message.id);
  if (!entry) {
    const node = document.createElement("article"); node.className = "message " + message.role; node.setAttribute("role", "listitem");
    node.innerHTML = `<div class="message-author"></div><blockquote class="message-quote" hidden></blockquote><div class="message-body"></div><span class="message-result"></span>`;
    entry = { node, key: "" }; messageElements.set(message.id, entry); $("messages").append(node);
  }
  const key = message.text + "\0" + message.status + "\0" + (message.quote ?? "");
  if (entry.key === key) return;
  entry.key = key;
  entry.node.hidden = message.role === "assistant" && !message.text && message.status !== "streaming";
  entry.node.querySelector(".message-author")!.textContent = message.role === "user" ? "YOU" : "π  PI";
  const quote = entry.node.querySelector<HTMLElement>(".message-quote")!;
  quote.hidden = !message.quote; quote.textContent = message.quote ?? "";
  const body = entry.node.querySelector<HTMLElement>(".message-body")!;
  if (message.role === "user") body.textContent = message.text;
  else if (message.text) {
    body.innerHTML = DOMPurify.sanitize(marked.parse(message.text, { async: false, breaks: false }), {
      ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "sup", "sub"],
      ALLOWED_ATTR: ["href", "title"],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    });
    body.querySelectorAll("a").forEach(link => { link.target = "_blank"; link.rel = "noopener noreferrer"; });
  } else body.innerHTML = '<span class="thinking-dots" aria-label="Pi is thinking"><i></i><i></i><i></i></span>';
  entry.node.querySelector(".message-result")!.textContent = message.status === "aborted" ? "Stopped" : message.status === "error" ? "Reply interrupted — see the message above" : "";
}
function renderTool(tool: ToolActivity) {
  let entry = toolElements.get(tool.id);
  if (!entry) {
    const node = document.createElement("details"); node.className = "tool-entry";
    node.innerHTML = '<summary><span class="tool-name"></span><span class="tool-status"></span></summary><pre class="tool-args"></pre><pre class="tool-output"></pre>';
    entry = { node, key: "" }; toolElements.set(tool.id, entry); $("tool-list").append(node);
  }
  const key = tool.status + tool.args + tool.output;
  if (key === entry.key) return;
  entry.key = key;
  entry.node.querySelector(".tool-name")!.textContent = tool.name;
  entry.node.querySelector(".tool-status")!.textContent = tool.status;
  entry.node.querySelector(".tool-args")!.textContent = tool.args;
  entry.node.querySelector(".tool-output")!.textContent = tool.output || "Waiting for output…";
}
$("conversation").onscroll = () => {
  const view = $("conversation"); autoScroll = view.scrollHeight - view.scrollTop - view.clientHeight < 120;
};
function render() {
  renderControls();
  if (!state) return;
  if (displayedSession !== state.sessionId) {
    displayedSession = state.sessionId; messageElements.clear(); toolElements.clear(); models = []; modelSession = "";
    $("messages").replaceChildren(); $("tool-list").replaceChildren(); $("source-error").hidden = true;
    autoScroll = true; sourcePreviewId = ""; editingSource = false;
    if ($<HTMLDialogElement>("preview-dialog").open) $<HTMLDialogElement>("preview-dialog").close();
  }
  const tools = state.mode === "tools";
  document.body.classList.toggle("tool-mode", tools);
  $("reading-mode").setAttribute("aria-pressed", String(!tools)); $("tools-mode").setAttribute("aria-pressed", String(tools));
  $("reading-input").hidden = tools || Boolean(state.source && !editingSource); $("tools-note").hidden = !tools;
  $("toggle-reading-input").hidden = tools || !state.source;
  $("toggle-reading-input").setAttribute("aria-expanded", String(editingSource));
  $("toggle-reading-input").innerHTML = (editingSource ? "Keep current reading" : "Change reading") + icon("chevron");
  $("workspace").textContent = state.workspace;
  $("mode-description").textContent = tools ? "Tools enabled · not sandboxed" : "A little perspective, on demand.";
  $("status-text").textContent = !online ? "Connection lost · reconnecting…" : !state.ready ? state.error ? "Pi unavailable" : "Starting Pi…" : state.busy ? `Pi is ${state.activity.toLowerCase()}…` : tools ? "Pi ready · tools enabled" : "Pi ready · tools off";
  $("status-dot").className = "status-dot" + (state.busy ? " pulsing" : "") + (!online || !state.ready ? " disconnected" : "");
  const error = !online ? "The local connection was lost. Keep the launcher running. If the app restarted, reload this tab." : state.error;
  $("error-banner").hidden = !error; $("error-text").textContent = error ?? "";
  $("reconnect").hidden = online && state.ready;
  $("reconnect").textContent = online ? "Reconnect" : "Reload tab";
  if (error && error !== lastError) lastError = error;
  $("context-card").hidden = !state.source || tools;
  if (state.source && sourcePreviewId !== state.source.id) {
    sourcePreviewId = state.source.id;
    $("context-kind").textContent = state.source.kind === "link" ? "ARTICLE ATTACHED" : "TEXT ATTACHED";
    $("context-title").textContent = state.source.title;
    $("context-domain").textContent = state.source.url ? new URL(state.source.url).hostname : "Shared by you";
    $("context-excerpt").textContent = state.source.excerpt;
    $("context-size").textContent = state.source.words.toLocaleString() + " words";
    $("context-warnings").textContent = state.source.warnings.join(" "); $("context-warnings").hidden = !state.source.warnings.length;
  }
  $("input-heading").textContent = state.source ? "Something else to read?" : "Add your reading";
  const hasMessages = state.messages.some(message => message.role === "user" || message.text);
  $("welcome").hidden = hasMessages;
  $("welcome-title").innerHTML = tools ? "A fresh workspace,<br><em>a capable Pi.</em>" : "A little clarity,<br><em>right beside you.</em>";
  $("welcome-description").textContent = tools ? "Ask Pi to help with a file or a task. Tool activity will appear in this conversation." : state.source ? `“${state.source.title}” is on your desk. What would you like to explore?` : "Untangle an idea. Follow a thread. Ask the question you’d ask a thoughtful friend.";
  $("suggestions").hidden = tools;
  $("welcome-small").textContent = tools ? "Separate session · no article context carried over" : state.source ? "Try one of these questions, or follow your own curiosity." : "Start with an article, or just a question.";
  for (const message of state.messages) renderMessage(message);
  $("tool-section").hidden = !state.tools.length;
  $("tool-count").textContent = String(state.tools.length);
  for (const tool of state.tools) renderTool(tool);
  $("privacy-note").textContent = tools ? "Tools have your account’s permissions. Chats live in memory; export to keep them." : `Shared text goes to ${state.model?.provider ?? "your model provider"}. Chats live in memory; export to keep them.`;
  updateModels();
  if (state.ready && modelSession !== state.sessionId && !state.busy) { modelSession = state.sessionId; void loadModels(modelSession); }
  if (autoScroll && hasMessages) requestAnimationFrame(() => { $("conversation").scrollTop = $("conversation").scrollHeight; });
}
$("export-chat").onclick = () => {
  if (!state) return;
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
  const link = document.createElement("a"); link.href = url; link.download = `pi-companion-${new Date().toISOString().slice(0, 10)}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Chat exported. Keep it somewhere private if it contains sensitive text.");
};

async function connect() {
  let failures = 0;
  while (true) {
    try {
      const response = await fetch("/api/events", { headers: { "X-Companion-Token": token } });
      if (response.status === 401) { online = false; render(); toast("The app restarted. Reload this tab to reconnect."); return; }
      if (!response.ok || !response.body) throw new Error("Connection unavailable");
      failures = 0;
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      try {
        while (true) {
          const result = await reader.read(); if (result.done) throw new Error("Connection closed");
          buffer += decoder.decode(result.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (event.startsWith("data: ")) acceptState(JSON.parse(event.slice(6)) as AppState);
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch { online = false; render(); }
    await new Promise(resolve => setTimeout(resolve, Math.min(500 * 2 ** failures++, 5000)));
  }
}
render();
void connect();
