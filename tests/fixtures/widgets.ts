export const WIDGET_SOURCE = `<style>
.demo { max-width: 32rem; margin: auto; padding: 12px; }
h2 { margin-top: 0; font-size: 1.25rem; }
.counter { display: flex; align-items: center; gap: 16px; margin: 20px 0; }
#count { font-size: 2rem; font-weight: 700; min-width: 2ch; }
button { background: #5b5bd6; color: white; border: 0; border-radius: 8px; padding: 9px 14px; }
label { display: block; } input { width: 100%; margin: 12px 0; }
</style>
<div class="demo">
<h2>A little interactive counter</h2>
<p>Try the button and slider. Everything runs locally in this preview.</p>
<div class="counter"><output id="count" aria-live="polite">0</output>
<button type="button" onclick="document.getElementById('count').textContent = Number(document.getElementById('count').textContent) + 1">Add one</button></div>
<label for="scale">Explore a value: <output id="value">2</output></label>
<input id="scale" type="range" min="0" max="10" value="2">
</div>
<script>
document.getElementById('scale').addEventListener('input', event => {
  document.getElementById('value').textContent = event.target.value;
});
</script>`;

export const WIDGET_REPLY = "Here is an interactive example.\n\n```widget Counter demo\n" + WIDGET_SOURCE
  + "\n```\n\nClick Run widget to try it. You can inspect its code before running it.";
