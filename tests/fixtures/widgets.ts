// Uses the frame's style kit (server/widgets.ts): theme variables, card/row helpers, and button.primary.
export const WIDGET_SOURCE = `<style>
#count { font-size: 2rem; font-weight: 700; min-width: 2ch; }
label { display: block; } input { width: 100%; margin: 12px 0; }
</style>
<div class="card">
<h2>A little interactive counter</h2>
<p class="muted">Try the button and slider. Everything runs locally in this frame.</p>
<div class="row"><output id="count" aria-live="polite">0</output>
<button type="button" class="primary" onclick="document.getElementById('count').textContent = Number(document.getElementById('count').textContent) + 1">Add one</button></div>
<label for="scale">Explore a value: <output id="value">2</output></label>
<input id="scale" type="range" min="0" max="10" value="2">
</div>
<script>
document.getElementById('scale').addEventListener('input', event => {
  document.getElementById('value').textContent = event.target.value;
});
</script>`;

export const WIDGET_REPLY = "Here is an interactive example.\n\n```widget Counter demo\n" + WIDGET_SOURCE
  + "\n```\n\nTry the button and the slider.";

export const CHART = {
  title: "Share of readers by format", type: "bar", labels: ["2021", "2022", "2023", "2024"], unit: "%",
  series: [{ name: "Print", values: [70, 58, 44, 32] }, { name: "Online", values: [30, 42, 56, 68] }],
  note: "Source: the article's second table.",
};
export const QUIZ = {
  title: "Check your understanding",
  questions: [
    { question: "Which format grew every year?", options: ["Print", "Online"], answer: 1, explanation: "Online rose from 30% to 68%." },
    { question: "In which year did online pass print?", options: ["2022", "2023", "2024"], answer: 1 },
  ],
};
export const FLASHCARDS = { title: "Key terms", cards: [{ front: "Readership", back: "The people who read a publication." }, { front: "Circulation", back: "The number of copies sent out." }] };
export const STEPS = {
  title: "How the survey worked",
  steps: [{ title: "Sample", detail: "Pick 2,000 adults at random." }, { title: "Ask", detail: "Ask how they read the news." }, { title: "Weigh", detail: "Adjust the results to match the census." }],
};

const block = (name: string, value: unknown) => "```" + name + "\n" + JSON.stringify(value, null, 2) + "\n```";
export const BUILTIN_REPLY = ["Here is the data as a chart.", block("chart", CHART), "The method, step by step:", block("steps", STEPS),
  "Now test yourself.", block("quiz", QUIZ), block("flashcards", FLASHCARDS)].join("\n\n");
