import { createContext } from "preact";
import type { QuizAction, QuizResults, SourceSection } from "../../shared/types";

/** What a built-in widget can do in the chat: open an article section, or run a quiz skill action. */
export interface WidgetActions {
  sections: readonly SourceSection[];
  idle: boolean;
  onReference: (sectionId: string) => void;
  onQuiz: (action: QuizAction, results: QuizResults) => void;
}

export const WidgetContext = createContext<WidgetActions>({ sections: [], idle: false, onReference() {}, onQuiz() {} });
