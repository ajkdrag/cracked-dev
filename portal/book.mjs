// Loads the book: chapters from ../curriculum/*.md and progress from ../LEARNING.md.
// Both are read fresh on every request, so an edit shows up on reload.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const curriculumDirectory = path.join(repository, "curriculum");
const learningPath = path.join(repository, "LEARNING.md");

const frontmatterKeys = ["id", "title", "part", "weeks", "project"];
const stepSections = ["Study", "Build", "Done when"];
const closingTitle = "Where this leads";
const studyItemPattern =
  /^- \[(.+?)\]\((https?:\/\/\S+)\) \((read|watch|do|reference), ([^)]+)\): (.+)$/;

export class BookError extends Error {}
export class ChapterFormatError extends BookError {}
export class LearningRecordError extends BookError {}

export function loadBook() {
  const chapters = fs
    .readdirSync(curriculumDirectory)
    .filter((name) => /^\d\d-.+\.md$/.test(name))
    .sort()
    .map((name) =>
      parseChapter(
        name,
        fs.readFileSync(path.join(curriculumDirectory, name), "utf8"),
      ),
    );
  const progress = parseProgress(fs.readFileSync(learningPath, "utf8"));
  for (const id of Object.keys(progress.checklists))
    if (!chapters.some((chapter) => chapter.id === id))
      throw new LearningRecordError(
        `LEARNING.md lists phase ${id}, which is not a chapter in curriculum/`,
      );
  for (const chapter of chapters)
    chapter.checklist = progress.checklists[chapter.id] ?? [];
  return { chapters, currentChapterId: progress.currentChapterId };
}

export function parseChapter(fileName, text) {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter)
    throw new ChapterFormatError(`${fileName}: missing frontmatter`);
  const fields = Object.fromEntries(
    frontmatter[1].split("\n").map((line) => {
      const separator = line.indexOf(":");
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      ];
    }),
  );
  for (const key of frontmatterKeys)
    if (!fields[key])
      throw new ChapterFormatError(`${fileName}: frontmatter needs "${key}"`);

  const [opening, ...sections] = splitByHeading(
    text.slice(frontmatter[0].length),
    "## ",
  );
  const closing = sections.pop();
  if (closing?.title !== closingTitle)
    throw new ChapterFormatError(
      `${fileName}: the last section must be "## ${closingTitle}"`,
    );
  return {
    id: fields.id,
    title: fields.title,
    part: fields.part,
    weeks: Number(fields.weeks),
    project: fields.project,
    opening: opening.body,
    steps: sections.map((section, index) =>
      parseStep(fileName, index + 1, section),
    ),
    closing: closing.body,
  };
}

function parseStep(fileName, number, section) {
  const [bridge, ...parts] = splitByHeading(section.body, "### ");
  const titles = parts.map((part) => part.title);
  if (titles.join("|") !== stepSections.join("|"))
    throw new ChapterFormatError(
      `${fileName}: step "${section.title}" needs ### ${stepSections.join(", ### ")} in that order`,
    );
  const [study, build, doneWhen] = parts;
  const resources = study.body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const item = line.match(studyItemPattern);
      if (!item)
        throw new ChapterFormatError(
          `${fileName}: step "${section.title}" has a study line that is not "- [Title](url) (kind, time): scope": ${line}`,
        );
      const [, title, url, kind, time, scope] = item;
      return { title, url, kind, time, scope };
    });
  if (resources.length === 0)
    throw new ChapterFormatError(
      `${fileName}: step "${section.title}" has no study items`,
    );
  return {
    number,
    title: section.title,
    bridge: bridge.body,
    resources,
    build: build.body,
    doneWhen: doneWhen.body,
  };
}

// Splits markdown at lines starting with `marker`. The first entry is the text
// before the first heading. Lines inside code fences never count as headings.
function splitByHeading(text, marker) {
  const sections = [{ title: "", lines: [] }];
  let insideFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) insideFence = !insideFence;
    if (!insideFence && line.startsWith(marker))
      sections.push({ title: line.slice(marker.length).trim(), lines: [] });
    else sections.at(-1).lines.push(line);
  }
  return sections.map(({ title, lines }) => ({
    title,
    body: lines.join("\n").trim(),
  }));
}

// LEARNING.md calls a chapter a phase. `Phase: <id>` names the chapter whose
// items sit under `## Checklist`. Other chapters get a `### Phase <id>` block
// under `## Done phases`.
export function parseProgress(learning) {
  const currentChapterId = learning.match(/^Phase: (\S+)/m)?.[1];
  if (!currentChapterId)
    throw new LearningRecordError("LEARNING.md needs a line like 'Phase: 02'");
  const section = (name) =>
    learning.match(
      new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"),
    )?.[1] ?? "";
  const checklistItems = (text) =>
    [...text.matchAll(/^- \[([ x])\] (.+)$/gm)].map(([, mark, label]) => ({
      text: label.replace(/ <- current$/, ""),
      done: mark === "x",
    }));
  const checklists = {
    [currentChapterId]: checklistItems(section("Checklist")),
  };
  for (const [, id, body] of section("Done phases").matchAll(
    /^### Phase (\S+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm,
  ))
    checklists[id] = checklistItems(body);
  return { currentChapterId, checklists };
}
