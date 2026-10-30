import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { TargetedPointerEvent } from "preact";

interface DividerProps {
  /** Article width as a percentage of the workspace; null restores the default. */
  onResize: (width: number | null) => void;
}

export function PanelDivider({ onResize }: DividerProps) {
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; offset: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [value, setValue] = useState({ min: 0, max: 100, now: 44 });

  function measure() {
    const node = divider.current!;
    const workspace = node.parentElement!;
    const panel = node.previousElementSibling!;
    const rect = workspace.getBoundingClientRect();
    // Keep these limits in CSS too, so resizing the window is clamped immediately.
    const style = getComputedStyle(workspace);
    const min = parseFloat(style.getPropertyValue("--panel-min"));
    const max = rect.width - node.getBoundingClientRect().width - parseFloat(style.getPropertyValue("--chat-min"));
    return { left: rect.left, width: rect.width, panel: panel.getBoundingClientRect().width, min, max };
  }

  function resize(pixels: number) {
    const { width, min, max } = measure();
    onResize(Math.max(min, Math.min(max, pixels)) / width * 100);
  }

  function finish() {
    const pointer = drag.current;
    drag.current = null;
    setResizing(false);
    const node = divider.current;
    if (pointer && node?.hasPointerCapture(pointer.id)) node.releasePointerCapture(pointer.id);
  }

  useLayoutEffect(() => {
    const node = divider.current!;
    const update = () => {
      const { width, panel, min, max } = measure();
      setValue({ min: Math.round(min / width * 100), max: Math.round(max / width * 100), now: Math.round(panel / width * 100) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node.parentElement!);
    observer.observe(node.previousElementSibling!);
    window.addEventListener("blur", finish);
    return () => { observer.disconnect(); window.removeEventListener("blur", finish); };
  }, []);

  function start(event: TargetedPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    event.preventDefault();
    const { left, panel } = measure();
    drag.current = { id: event.pointerId, offset: event.clientX - left - panel };
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  }

  function end(event: TargetedPointerEvent<HTMLDivElement>) {
    if (event.pointerId === drag.current?.id) finish();
  }

  return (
    <div ref={divider} id="panel-divider" class="panel-divider" role="separator" tabIndex={0}
      aria-label="Resize article panel" aria-orientation="vertical" aria-controls="panel"
      aria-valuemin={value.min} aria-valuemax={value.max} aria-valuenow={value.now}
      aria-valuetext={`${value.now}% article width`} data-resizing={resizing}
      title="Drag to resize · Arrow keys to adjust · Double-click or Enter to reset"
      onPointerDown={start}
      onPointerMove={event => {
        if (event.pointerId !== drag.current?.id) return;
        resize(event.clientX - measure().left - drag.current.offset);
      }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onDblClick={() => onResize(null)}
      onKeyDown={event => {
        const { panel, min, max } = measure();
        const step = event.shiftKey ? 64 : 16;
        if (event.key === "ArrowLeft") resize(panel - step);
        else if (event.key === "ArrowRight") resize(panel + step);
        else if (event.key === "Home") resize(min);
        else if (event.key === "End") resize(max);
        else if (event.key === "Enter") onResize(null);
        else return;
        event.preventDefault();
      }} />
  );
}
