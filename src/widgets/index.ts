import type { FunctionComponent } from "preact";
import type { BuiltinSpec, BuiltinType } from "../../shared/builtin-widgets";
import type { IconName } from "../icons";
import { Chart } from "./chart";
import { Flashcards } from "./flashcards";
import { Quiz } from "./quiz";
import { Steps } from "./steps";

type Builtins = { [T in BuiltinType]: { icon: IconName; Component: FunctionComponent<{ spec: BuiltinSpec<T> }> } };

/** The component that draws each built-in widget. Its spec and prompt line live in shared/builtin-widgets.ts. */
export const BUILTINS: Builtins = {
  chart: { icon: "chart", Component: Chart },
  steps: { icon: "steps", Component: Steps },
  quiz: { icon: "quiz", Component: Quiz },
  flashcards: { icon: "cards", Component: Flashcards },
};
