import { useContext, useState } from "preact/hooks";
import type { QuizSpec } from "../../shared/builtin-widgets";
import { referencedSection } from "../../shared/sections";
import type { QuizAction, QuizResults } from "../../shared/types";
import { Icon } from "../icons";
import { WidgetContext } from "./context";

export function Quiz({ spec }: { spec: QuizSpec }) {
  const { sections, idle, onReference, onQuiz } = useContext(WidgetContext);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const total = spec.questions.length;
  const answered = Object.keys(picks).length;
  const right = spec.questions.filter((item, index) => picks[index] === item.answer).length;
  const results = (): QuizResults => ({ title: spec.title, questions: spec.questions.map((item, index) => ({
    question: item.question, answer: item.options[item.answer], picked: item.options[picks[index]], right: picks[index] === item.answer,
    ...(item.section ? { section: item.section } : {}),
  })) });
  // The skill actions in skills/quiz.md. Pi gets the answers with each one.
  const next: { action: QuizAction; label: string }[] = answered < total ? [] : right < total
    ? [{ action: "more", label: "More on what I missed" }, { action: "explain", label: "Explain my mistakes" }, { action: "deeper", label: "Go deeper" }]
    : [{ action: "deeper", label: "Go deeper" }];
  return (
    <div class="quiz">
      {spec.questions.map((item, index) => {
        const pick = picks[index];
        const done = pick !== undefined;
        // Only a section of the current article is a link.
        const section = done && pick !== item.answer && item.section ? referencedSection(item.section, sections) : undefined;
        return (
          <fieldset key={index} class="quiz-question">
            <legend>{total > 1 && `${index + 1}. `}{item.question}</legend>
            <div class="quiz-options">
              {item.options.map((option, choice) => {
                const result = !done ? undefined : choice === item.answer ? "right" : choice === pick ? "wrong" : undefined;
                // aria-disabled, not disabled, so keyboard focus stays on the chosen answer.
                return (
                  <button key={choice} type="button" class="quiz-option" data-result={result} aria-pressed={choice === pick} aria-disabled={done}
                    onClick={() => { if (!done) setPicks({ ...picks, [index]: choice }); }}>
                    <span>{option}</span>
                    {result && <Icon name={result === "right" ? "check" : "x"} size={15} />}
                  </button>
                );
              })}
            </div>
            {done && (
              <p class="quiz-feedback" data-result={pick === item.answer ? "right" : "wrong"} aria-live="polite">
                <strong>{pick === item.answer ? "Correct." : `Not quite. The answer is “${item.options[item.answer]}”.`}</strong>
                {item.explanation && " " + item.explanation}
              </p>
            )}
            {section && (
              <button type="button" class="quiz-review" title={`Go to ${section.title}`} onClick={() => onReference(section.id)}>
                <Icon name="book" size={14} /><span>Read “{section.title}”</span>
              </button>
            )}
          </fieldset>
        );
      })}
      <div class="quiz-footer">
        <span aria-live="polite">{answered < total ? `${answered} of ${total} answered` : `You got ${right} of ${total} right.`}</span>
        {answered > 0 && <button type="button" class="btn btn-small" onClick={() => setPicks({})}>Try again</button>}
      </div>
      {next.length > 0 && (
        <div class="quiz-next" role="group" aria-label="What next">
          {next.map((item, index) => (
            <button key={item.action} type="button" class={"btn btn-small" + (index === 0 ? " btn-primary" : "")} disabled={!idle}
              onClick={() => onQuiz(item.action, results())}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
