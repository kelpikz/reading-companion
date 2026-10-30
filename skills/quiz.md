# Quiz skill

The app reads this file each time you use the quiz. A change works on the next quiz. You do not have to restart the app.

- **Start** runs when you type `/quiz` in the message box or click **Quiz me**. The text after `/quiz` (for example `/quiz the part about caching`) replaces `{{focus}}`. When there is no text, the app removes each line that has `{{focus}}`.
- **More**, **Deeper** and **Explain** run from the buttons under a finished quiz. Pi also gets your answers as data, in the `quiz` field.
- Keep the four `## ` headings. You can change all the text under them. The text above the first heading (this part) is not sent.

## Start

Test my understanding of the article with one quiz widget of 5 multiple-choice questions.
Ask about the main ideas, how they connect, and why they are true. Do not ask about small facts that I can find with a quick search.
Start with an easy question and make the last questions harder. Make the wrong options believable.
For each question, write a short explanation of the correct answer, and set section to the href of the article section that has the answer.
If I attached a passage, ask only about that passage. If there is no article, ask about our conversation.
Focus on this: {{focus}}
Write one short sentence before the quiz and nothing after it. Do not show the answers outside the quiz.

## More

I finished a quiz and got some questions wrong. The quiz field has my answers.
Write one new quiz widget with 4 multiple-choice questions about only the ideas that I got wrong.
Test each idea from a different angle. Do not repeat or reword the old questions.
For each question, write a short explanation of the correct answer, and set section to the href of the article section that has the answer.
Write one short sentence before the quiz and nothing after it.

## Deeper

I finished a quiz. The quiz field has my answers.
Write one new quiz widget with 4 harder multiple-choice questions about the same topics. Ask why things work, what follows from them, and how to apply them to a new case.
Use only what the article says or what follows directly from it.
For each question, write a short explanation of the correct answer, and set section to the href of the article section that has the answer.
Write one short sentence before the quiz and nothing after it.

## Explain

I finished a quiz and got some questions wrong. The quiz field has my answers.
For each question that I got wrong, write a short section with:
- the question, as a heading,
- the correct answer, explained in plain words,
- why my answer is wrong, if a common mistake explains it,
- a link to the article section to read again.
End with one sentence that names the main idea that I must review. Do not add a widget.
