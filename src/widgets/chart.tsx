import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ChartSpec } from "../../shared/builtin-widgets";

const HEIGHT = 240, TOP = 12, RIGHT = 12, BOTTOM = 28;
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
// Series colours are fixed slots in src/style.css, validated for colour-blind readers in both themes.
const color = (series: number) => `var(--series-${series + 1})`;
const short = (label: string) => label.length > 12 ? label.slice(0, 11) + "…" : label;

/** Clean axis steps (1, 2, 2.5, or 5 × 10ⁿ) that cover the data. */
function ticks(low: number, high: number): number[] {
  const rough = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * power).find(step => step >= rough)!;
  const first = Math.floor(low / step), last = Math.ceil(high / step);
  return Array.from({ length: last - first + 1 }, (_, index) => +((first + index) * step).toPrecision(12));
}

/** A bar from the baseline to the value, rounded only at the value end. */
function barPath(x: number, base: number, end: number, width: number): string {
  const r = Math.min(4, width / 2, Math.abs(end - base));
  const s = end < base ? 1 : -1;
  return `M${x},${base}V${end + s * r}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end + s * r}V${base}Z`;
}

export function Chart({ spec }: { spec: ChartSpec }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  // Draw at the real width, so text keeps its size on narrow screens. A collapsed widget has no width.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(box.current!);
    return () => observer.disconnect();
  }, []);

  const { labels, series, unit } = spec;
  const format = (value: number, axis = false) => {
    const number = axis && Math.abs(value) >= 1000 ? compact.format(value) : exact.format(value);
    return !unit ? number : /^[a-z]/i.test(unit) ? `${number} ${unit}` : number + unit;
  };
  const values = series.flatMap(item => item.values);
  let low = Math.min(...values), high = Math.max(...values);
  if (spec.type === "bar") { low = Math.min(low, 0); high = Math.max(high, 0); }
  if (low === high) { high += 1; if (spec.type === "line") low -= 1; }
  const axis = ticks(low, high);
  const min = axis[0], max = axis.at(-1)!, base = axis.includes(0) ? 0 : min;
  const left = Math.max(...axis.map(value => format(value, true).length)) * 7 + 14;
  const plot = Math.max(width - left - RIGHT, 1), bottom = HEIGHT - BOTTOM;
  const y = (value: number) => TOP + (max - value) / (max - min) * (bottom - TOP);
  const line = (value: number) => Math.round(y(value)) + .5;
  const band = plot / labels.length;
  const x = (index: number) => left + band * (index + .5);
  const every = Math.ceil(labels.length * (Math.min(12, Math.max(...labels.map(label => label.length))) * 6.5 + 12) / plot);
  const barWidth = Math.max(1, Math.min(24, (band * .8 - (series.length - 1) * 2) / series.length));
  const group = barWidth * series.length + (series.length - 1) * 2;
  const readout = active === null ? "" : `${labels[active]}: ${series.map(item => `${item.name} ${format(item.values[active])}`).join(", ")}`;

  function point(event: PointerEvent) {
    const index = Math.floor((event.clientX - (event.currentTarget as Element).getBoundingClientRect().left - left) / band);
    setActive(index >= 0 && index < labels.length ? index : null);
  }
  function key(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(labels.length - 1, (active ?? (step > 0 ? -1 : labels.length)) + step)));
  }

  return (
    <figure class="chart">
      {series.length > 1 && (
        <ul class="chart-legend">
          {series.map((item, index) => <li key={index}><span class={"chart-key " + spec.type} style={{ background: color(index) }} />{item.name}</li>)}
        </ul>
      )}
      <div ref={box} class="chart-plot" tabIndex={0} role="group" onKeyDown={key} onBlur={() => setActive(null)}
        aria-label={`${spec.title}, ${spec.type} chart. Use the left and right arrow keys to read the values.`}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden="true" onPointerMove={point} onPointerDown={point} onPointerLeave={() => setActive(null)}>
            {axis.map(value => <line key={"grid" + value} class={value === base ? "chart-base" : "chart-grid"} x1={left} x2={left + plot} y1={line(value)} y2={line(value)} />)}
            {axis.map(value => <text key={"tick" + value} class="chart-axis" x={left - 8} y={y(value) + 4} text-anchor="end">{format(value, true)}</text>)}
            {labels.map((label, index) => index % every === 0 &&
              <text key={"label" + index} class="chart-axis" x={x(index)} y={HEIGHT - 8} text-anchor="middle">{short(label)}</text>)}
            {active !== null && (spec.type === "bar"
              ? <rect class="chart-hover" x={left + band * active} y={TOP} width={band} height={bottom - TOP} rx={4} />
              : <line class="chart-cross" x1={Math.round(x(active)) + .5} x2={Math.round(x(active)) + .5} y1={TOP} y2={bottom} />)}
            {spec.type === "bar"
              ? series.map((item, s) => item.values.map((value, index) => (
                <path key={s + "-" + index} d={barPath(x(index) - group / 2 + s * (barWidth + 2), y(0), y(value), barWidth)} style={{ fill: color(s) }} />
              )))
              : series.map((item, s) => (
                <g key={s}>
                  <path class="chart-line" d={item.values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join("")} style={{ stroke: color(s) }} />
                  {item.values.map((value, index) => (labels.length <= 24 || index === active) &&
                    <circle key={index} class="chart-dot" cx={x(index)} cy={y(value)} r={4} style={{ fill: color(s) }} />)}
                </g>
              ))}
          </svg>
        )}
        {active !== null && width > 0 && (
          <div class="chart-tip" aria-hidden="true" style={x(active) < width / 2 ? { left: x(active) + 12 } : { right: width - x(active) + 12 }}>
            <span class="chart-tip-label">{labels[active]}</span>
            {series.map((item, index) => (
              <span key={index} class="chart-tip-row"><span class="chart-key line" style={{ background: color(index) }} /><strong>{format(item.values[active])}</strong>{series.length > 1 && <span>{item.name}</span>}</span>
            ))}
          </div>
        )}
        <p class="sr-only" aria-live="polite">{readout}</p>
      </div>
      {spec.note && <figcaption class="chart-note">{spec.note}</figcaption>}
      <details class="chart-data">
        <summary>Show data</summary>
        <table>
          <thead><tr><th scope="col"><span class="sr-only">Label</span></th>{series.map((item, index) => <th key={index} scope="col">{item.name}</th>)}</tr></thead>
          <tbody>
            {labels.map((label, row) => (
              <tr key={row}><th scope="row">{label}</th>{series.map((item, index) => <td key={index}>{format(item.values[row])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
