import { useState } from "preact/hooks";
import type { FlashcardsSpec } from "../../shared/builtin-widgets";
import { Icon } from "../icons";

export function Flashcards({ spec }: { spec: FlashcardsSpec }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = spec.cards[index];
  const go = (next: number) => { setIndex(next); setFlipped(false); };
  return (
    <div class="flashcards">
      <button type="button" class="flashcard" data-flipped={flipped} onClick={() => setFlipped(!flipped)}>
        <span class="flashcard-side">{flipped ? "Back" : "Front"}</span>
        <span class="flashcard-text" aria-live="polite">{flipped ? card.back : card.front}</span>
        <span class="flashcard-hint">Click to turn over</span>
      </button>
      {spec.cards.length > 1 && (
        <div class="flashcards-nav">
          <button type="button" class="icon-btn small" aria-label="Previous card" title="Previous" disabled={index === 0} onClick={() => go(index - 1)}>
            <Icon name="chevronLeft" size={16} />
          </button>
          <span>{index + 1} / {spec.cards.length}</span>
          <button type="button" class="icon-btn small" aria-label="Next card" title="Next" disabled={index === spec.cards.length - 1} onClick={() => go(index + 1)}>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
