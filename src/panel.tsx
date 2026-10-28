import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Source, SourceSummary } from "../shared/types";
import { Icon, Spinner } from "./icons";
import { renderArticle } from "./markdown";

export type SourcePayload = { kind: "link"; url: string } | { kind: "text"; title: string; text: string };

interface PanelProps {
  summary: SourceSummary | null;
  source: Source | null;
  idle: boolean;
  /** Narrow screens show the panel as an overlay sheet. */
  sheet: boolean;
  onAttach: (payload: SourcePayload) => Promise<void>;
  onQuote: (text: string) => void;
  onClose: () => void;
}

export function Panel({ summary, source, idle, sheet, onAttach, onQuote, onClose }: PanelProps) {
  const [replacing, setReplacing] = useState(false);
  useEffect(() => setReplacing(false), [summary?.id]);
  const reading = summary && !replacing ? summary : null;
  return (
    <aside id="panel" class={"panel" + (sheet ? " sheet" : "")} aria-label="Article">
      <div class="panel-head">
        <span class="panel-label">{reading ? "Article" : summary ? "Replace article" : "Add an article"}</span>
        {summary && (
          <button id="replace-source" class="btn btn-small btn-ghost" onClick={() => setReplacing(!replacing)}>
            {replacing ? "Cancel" : "Replace"}
          </button>
        )}
        {sheet && <button class="icon-btn" aria-label="Close article panel" onClick={onClose}><Icon name="x" size={18} /></button>}
      </div>
      <div class="panel-scroll">
        {reading
          ? <Reader key={reading.id} summary={reading} source={source?.id === reading.id ? source : null} onQuote={onQuote} />
          : <SourceForm idle={idle} replacing={Boolean(summary)} onAttach={onAttach} />}
      </div>
    </aside>
  );
}

function SourceForm({ idle, replacing, onAttach }: { idle: boolean; replacing: boolean; onAttach: PanelProps["onAttach"] }) {
  const [kind, setKind] = useState<"link" | "text">("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: Event) {
    event.preventDefault();
    if (busy || !idle) return;
    if (kind === "link" ? !url.trim() : !text.trim()) { setError(kind === "link" ? "Paste a link first." : "Paste some text first."); return; }
    setBusy(true); setError("");
    try { await onAttach(kind === "link" ? { kind, url: url.trim() } : { kind, title, text }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  function choose(next: "link" | "text") { setKind(next); setError(""); }

  return (
    <form id="source-form" class="source-form" onSubmit={submit}>
      <div class="intro">
        <h2>{replacing ? "Read something else" : "What are you reading?"}</h2>
        <p>Pi sees only what you add here. It cannot see your browser tabs.</p>
      </div>
      <div class="segmented full" role="tablist" aria-label="Article input"
        onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { choose(kind === "link" ? "text" : "link"); } }}>
        <button type="button" id="link-tab" role="tab" aria-selected={kind === "link"} tabIndex={kind === "link" ? 0 : -1} onClick={() => choose("link")}>
          <Icon name="link" size={15} /><span>Link</span>
        </button>
        <button type="button" id="text-tab" role="tab" aria-selected={kind === "text"} tabIndex={kind === "text" ? 0 : -1} onClick={() => choose("text")}>
          <Icon name="text" size={15} /><span>Paste text</span>
        </button>
      </div>
      {kind === "link" ? (
        <div class="field">
          <label for="source-url">Article link</label>
          <input id="source-url" type="url" inputMode="url" placeholder="https://…" autoComplete="off" maxLength={4000}
            value={url} onInput={event => setUrl(event.currentTarget.value)} />
          <p class="hint">Works for public pages. For pages behind a login or a paywall, or pages that need JavaScript, paste the text.</p>
        </div>
      ) : (
        <>
          <div class="field">
            <label for="source-title">Title <span class="optional">(optional)</span></label>
            <input id="source-title" maxLength={300} placeholder="Give it a name" value={title} onInput={event => setTitle(event.currentTarget.value)} />
          </div>
          <div class="field">
            <label for="source-text">Text</label>
            <textarea id="source-text" rows={12} maxLength={120_000} placeholder="Paste an article, some paragraphs, or a passage…"
              value={text} onInput={event => setText(event.currentTarget.value)} />
            <p class="hint">{text.length ? `${text.length.toLocaleString()} of 120,000 characters` : "Good for private pages. Up to 120,000 characters."}</p>
          </div>
        </>
      )}
      {error && <p id="source-error" class="inline-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
      <button id="attach-source" type="submit" class="btn btn-primary btn-block" disabled={!idle || busy}>
        {busy ? <><Spinner size={15} />{kind === "link" ? "Fetching page…" : "Adding…"}</> : kind === "link" ? "Fetch article" : "Add text"}
      </button>
    </form>
  );
}

function Reader({ summary, source, onQuote }: { summary: SourceSummary; source: Source | null; onQuote: (text: string) => void }) {
  const textRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"article" | "text">("article");
  const article = useMemo(() => source?.html ? renderArticle(source.html) : "", [source?.html]);
  const showArticle = Boolean(article) && view === "article";

  // An image that fails to load is removed, with its figure when nothing else is in it.
  useEffect(() => {
    if (!showArticle) return;
    textRef.current?.querySelectorAll("img").forEach(img => img.addEventListener("error", () => {
      const figure = img.closest("figure");
      img.remove();
      if (figure && !figure.querySelector("img, svg") && !figure.textContent?.trim()) figure.remove();
    }, { once: true }));
  }, [showArticle, article]);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);

  // Offer a "Quote" button above any selection inside the article text.
  useEffect(() => {
    const update = () => {
      const current = document.getSelection();
      const node = textRef.current;
      if (!current || current.isCollapsed || !current.rangeCount || !node) { setSelection(null); return; }
      const range = current.getRangeAt(0);
      const text = current.toString().trim();
      if (!node.contains(range.commonAncestorContainer) || text.length < 2) { setSelection(null); return; }
      const rect = range.getBoundingClientRect();
      const below = rect.top < 110;
      setSelection({ text, below, x: Math.min(Math.max(rect.left + rect.width / 2, 70), innerWidth - 70), y: below ? rect.bottom : rect.top });
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("scroll", update, true);
    return () => { document.removeEventListener("selectionchange", update); document.removeEventListener("scroll", update, true); };
  }, []);

  const host = summary.url ? new URL(summary.url).hostname.replace(/^www\./, "") : "";
  const minutes = Math.max(1, Math.round(summary.words / 230));
  const date = summary.published && !Number.isNaN(Date.parse(summary.published))
    ? new Date(summary.published).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  return (
    <article class="reader">
      <div class="reader-meta">
        <span class="chip">{summary.kind === "link" ? <><Icon name="link" size={13} />{host}</> : <><Icon name="text" size={13} />Pasted text</>}</span>
        <span>{summary.words.toLocaleString()} words · {minutes} min read</span>
      </div>
      <h1 id="context-title" class="reader-title">{summary.title}</h1>
      {(summary.byline || date) && <p class="reader-byline">{[summary.byline, date].filter(Boolean).join(" · ")}</p>}
      {summary.url && (
        <a class="reader-link" href={summary.url} target="_blank" rel="noopener noreferrer">Open the original <Icon name="external" size={13} /></a>
      )}
      {summary.warnings.map(warning => <div key={warning} class="callout warn"><Icon name="alert" size={16} /><p>{warning}</p></div>)}
      <div class="reader-bar">
        {article && (
          <div class="segmented" role="tablist" aria-label="Reader view">
            <button type="button" id="view-article" role="tab" aria-selected={view === "article"} onClick={() => setView("article")}>Article</button>
            <button type="button" id="view-text" role="tab" aria-selected={view === "text"} onClick={() => setView("text")}>Text Pi gets</button>
          </div>
        )}
        <p class="reader-hint"><Icon name="quote" size={14} />
          {showArticle ? "Select text to quote it. Pi gets only the text, not the images." : "Select text to quote it. This is the exact text Pi gets."}
        </p>
      </div>
      {!source ? <div class="reader-loading"><Spinner /> Loading text…</div>
        : showArticle ? <div id="reader-article" ref={textRef} class="reader-article" dangerouslySetInnerHTML={{ __html: article }} />
        : <div id="reader-text" ref={textRef} class="reader-text">{source.text}</div>}
      {selection && (
        <button id="quote-selection" type="button" class={"quote-pop" + (selection.below ? " below" : "")}
          style={{ left: selection.x + "px", top: selection.y + "px" }}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { onQuote(selection.text); document.getSelection()?.removeAllRanges(); setSelection(null); }}>
          <Icon name="quote" size={14} />Quote in chat
        </button>
      )}
    </article>
  );
}
