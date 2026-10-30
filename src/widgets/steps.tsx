import type { StepsSpec } from "../../shared/builtin-widgets";

export function Steps({ spec }: { spec: StepsSpec }) {
  return (
    <ol class="steps">
      {spec.steps.map((step, index) => (
        <li key={index}>
          <span class="step-number" aria-hidden="true">{index + 1}</span>
          <div class="step-text">
            <strong>{step.title}</strong>
            {step.detail && <p>{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
