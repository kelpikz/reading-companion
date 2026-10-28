import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Fragment, type ComponentChildren } from "preact";
import { Icon, type IconName } from "./icons";

export interface PickerOption { value: string; label: string; hint?: string; meta?: string; group?: string }

interface PickerProps {
  id: string;
  label: string;
  icon?: IconName;
  value: string;
  display: ComponentChildren;
  options: PickerOption[];
  disabled?: boolean;
  title?: string;
  /** Text shown at the top of the menu. */
  heading?: string;
  onSelect: (value: string) => void;
}

/** A small dropdown that opens upward from the message box. */
export function Picker({ id, label, icon, value, display, options, disabled, title, heading, onSelect }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const searchable = options.length > 8;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  // Keep the menu inside the window, then focus the search box or the current choice.
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    pop.current.style.left = "0px";
    const overflow = pop.current.getBoundingClientRect().right - (innerWidth - 8);
    if (overflow > 0) pop.current.style.left = -overflow + "px";
    const target = searchable ? pop.current.querySelector<HTMLElement>("input")
      : pop.current.querySelector<HTMLElement>('[aria-selected="true"]') ?? pop.current.querySelector<HTMLElement>('[role="option"]');
    target?.focus();
  }, [open]);

  function close(refocus = true) {
    setOpen(false); setQuery("");
    if (refocus) root.current?.querySelector<HTMLElement>(".picker-trigger")?.focus();
  }
  function choose(next: string) {
    close();
    if (next !== value) onSelect(next);
  }
  function move(delta: number) {
    const items = [...(pop.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index <= 0 && delta < 0 && searchable) { pop.current?.querySelector<HTMLElement>("input")?.focus(); return; }
    items[Math.max(0, Math.min(items.length - 1, index + delta))]?.focus();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Tab") close(false);
  }

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter(option => {
    const text = `${option.label} ${option.value} ${option.group ?? ""}`.toLowerCase();
    return words.every(word => text.includes(word));
  });
  const grouped = new Set(options.map(option => option.group)).size > 1;

  return (
    <div class="picker" ref={root}>
      <button type="button" id={id} class="picker-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} title={title}
        onClick={() => (open ? close() : setOpen(true))}>
        {icon && <Icon name={icon} size={15} />}
        <span class="picker-value">{display}</span>
        <Icon name="chevronDown" size={14} class="picker-chevron" />
      </button>
      {open && (
        <div ref={pop} id={id + "-menu"} class="picker-pop" onKeyDown={onKeyDown}>
          {heading && <div class="picker-heading">{heading}</div>}
          {searchable && (
            <label class="picker-search">
              <Icon name="search" size={14} />
              <input type="text" placeholder="Search" aria-label={"Search " + label} value={query} autoComplete="off"
                onInput={event => setQuery(event.currentTarget.value)}
                onKeyDown={event => { if (event.key === "Enter" && shown[0]) { event.preventDefault(); choose(shown[0].value); } }} />
            </label>
          )}
          <div class="picker-list" role="listbox" aria-label={label}>
            {shown.map((option, index) => (
              <Fragment key={option.value}>
                {grouped && option.group !== shown[index - 1]?.group && <div class="picker-group" role="presentation">{option.group}</div>}
                <button type="button" role="option" class="picker-option" aria-selected={option.value === value}
                  title={option.value} onClick={() => choose(option.value)}>
                  <span class="picker-text">
                    <span class="picker-label">{option.label}</span>
                    {option.hint && <span class="picker-hint">{option.hint}</span>}
                  </span>
                  {option.meta && <span class="picker-meta">{option.meta}</span>}
                  <span class="picker-check">{option.value === value && <Icon name="check" size={15} />}</span>
                </button>
              </Fragment>
            ))}
            {!shown.length && <div class="picker-empty">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}
