# Chat widgets

Ask Pi for a visual or interactive aid, for example: **"Make a quiz about this article"** or **"Show these numbers as a chart."** Widgets work in reading and tool modes. They do not need filesystem or shell tools.

Every widget has a title bar. Click the title bar or the arrow to collapse a widget. A collapsed widget keeps its state. While Pi writes a widget, the chat shows a short placeholder, not the code. Copy and export include the original widget block. Limits: four widgets per reply, 50,000 characters each. Oversized or excess blocks stay as code.

## Built-in widgets

Built-in widgets are the default. Pi writes only data (one JSON object), and the app draws the widget with its own components, in the app's colours and theme. No model code runs. A built-in widget shows as soon as its block is complete.

| Fence | Use | Data |
|---|---|---|
| `chart` | Numbers to compare, or a change over time | `title`, `type` (`bar` or `line`), `labels`, `series` (`name`, `values`), optional `unit` and `note` |
| `steps` | A process, in order | `title`, `steps` (`title`, optional `detail`) |
| `quiz` | Multiple-choice questions | `title`, `questions` (`question`, `options`, zero-based `answer`, optional `explanation` and `section`, an article href) |
| `flashcards` | Terms or facts to remember | `title`, `cards` (`front`, `back`) |

~~~~markdown
```chart
{"title": "Adults online", "type": "line", "labels": ["2000", "2010", "2020"],
 "series": [{"name": "US", "values": [52, 71, 91]}], "unit": "%"}
```
~~~~

The app shows all text in the data as plain text, not as Markdown or HTML. If the JSON is not valid, or does not match the format, the block stays as plain code. A chart has a tooltip, arrow-key reading, and a **Show data** table.

The quiz widget is also the [quiz skill](../README.md#quiz-skill): its prompts are in [`skills/quiz.md`](../skills/quiz.md).

To add a widget type:

1. In `shared/builtin-widgets.ts`, add the spec type, a parser that checks the JSON, and one prompt line for Pi.
2. In `src/widgets/`, add a Preact component that draws the spec. Add it to `src/widgets/index.ts`.
3. Add its styles to `src/style.css` and its tests to `tests/widgets.test.ts`.

TypeScript shows an error until you do steps 1 and 2.

## Custom widgets

Pi writes a custom widget only when no built-in widget fits. It is self-contained HTML, CSS and JavaScript in a closed, top-level `widget` fence with an optional title:

~~~~markdown
```widget Counter
<button class="primary" onclick="this.textContent = Number(this.textContent) + 1">0</button>
```
~~~~

A custom widget starts automatically when the reply finishes. It does not start while the reply streams, or from a stopped or failed reply. **Restart** resets it. Refresh starts it again, without its old state.

The frame gives the widget the app's theme in light and dark mode: CSS variables (`--text`, `--text-2`, `--bg`, `--surface`, `--surface-2`, `--border`, `--accent`, `--accent-soft`, `--on-accent`), styled text, buttons, inputs, sliders, selects and tables, and the helper classes `card`, `row`, `grid`, `muted` and `primary`.

Use inline CSS and vanilla JavaScript, accessible labels, and responsive layouts. Inline SVG, canvas, and data-URL images work. External libraries, network APIs, external images/fonts/styles, submitting forms, frames, workers, popups, downloads, app APIs, storage, and access to chat/article content are not supported. There is no widget-to-chat command bridge: the app reads only the widget's content height, to size the preview without a second scrollbar. Ordinary `html` fences, raw HTML, and fences nested in quotes/lists remain inert code/text.

**A custom widget runs model-written code without a click, so never enter secrets into a widget.** Article text can try to trick Pi into writing a harmful widget. An opaque-origin iframe and HTTP security policies isolate it from the app, restrict navigation, and block network APIs/external resources. These browser controls are not a complete network firewall (for example, not every browser-specific API is covered by CSP), nor an OS-level CPU/memory sandbox. Buggy code can still slow the tab. Use a separate restricted browser/container if you need that stronger boundary.
