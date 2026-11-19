import test from "node:test";
import assert from "node:assert/strict";
import { ChapterFormatError, parseChapter, parseProgress } from "../book.mjs";

const chapterText = `---
id: 02
title: C foundations
part: The machine and C
weeks: 3
project: A linked list in C.
---

Opening prose.

## Pointers

Bridge prose.

\`\`\`sh
## a comment inside a code fence is not a heading
\`\`\`

### Study

- [Beej: Pointers](https://beej.us/guide/bgc/html/split/pointers.html) (read, 40 min): Sections 5.1 to 5.5.
- [C operator precedence](https://en.cppreference.com/w/c/language/operator_precedence_(C)) (reference, as needed): The table.

### Build

Implement swap.

### Done when

The test passes.

## Where this leads

Closing prose.
`;

test("a chapter file becomes frontmatter fields, steps and a closing", () => {
  const chapter = parseChapter("02-c-foundations.md", chapterText);

  assert.equal(chapter.id, "02");
  assert.equal(chapter.weeks, 3);
  assert.equal(chapter.opening, "Opening prose.");
  assert.equal(chapter.closing, "Closing prose.");
  assert.equal(chapter.steps.length, 1);

  const [step] = chapter.steps;
  assert.equal(step.title, "Pointers");
  assert.match(step.bridge, /not a heading/);
  assert.equal(step.build, "Implement swap.");
  assert.equal(step.doneWhen, "The test passes.");
  assert.deepEqual(step.resources[0], {
    title: "Beej: Pointers",
    url: "https://beej.us/guide/bgc/html/split/pointers.html",
    kind: "read",
    time: "40 min",
    scope: "Sections 5.1 to 5.5.",
  });
  assert.equal(
    step.resources[1].url,
    "https://en.cppreference.com/w/c/language/operator_precedence_(C)",
  );
});

test("a chapter that breaks the format is rejected", () => {
  const brokenChapters = [
    chapterText.replace("weeks: 3\n", ""),
    chapterText.replace("### Build", "### Make"),
    chapterText.replace("(read, 40 min)", "(skim, 40 min)"),
    chapterText.replace("## Where this leads", "## Summary"),
  ];
  for (const text of brokenChapters)
    assert.throws(() => parseChapter("02.md", text), ChapterFormatError);
});

test("progress comes from the current checklist and the done phases", () => {
  const progress = parseProgress(`Phase: 02

## Checklist
- [x] Build a list
- [ ] Build a word counter <- current

## Done phases
### Phase 01
- [x] Compile hello

## Journal
`);

  assert.equal(progress.currentChapterId, "02");
  assert.deepEqual(progress.checklists, {
    "02": [
      { text: "Build a list", done: true },
      { text: "Build a word counter", done: false },
    ],
    "01": [{ text: "Compile hello", done: true }],
  });
});
