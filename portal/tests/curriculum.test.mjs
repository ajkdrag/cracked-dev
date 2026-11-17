// Checks on the real book in ../curriculum.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadBook } from "../book.mjs";

const curriculumDirectory = new URL("../../curriculum/", import.meta.url);
const bannedSites = [
  "medium.com",
  "dev.to",
  "geeksforgeeks.org",
  "tutorialspoint.com",
  "javatpoint.com",
  "w3schools.com",
  "programiz.com",
  "baeldung.com",
  "freecodecamp.org",
  "hashnode.dev",
  "master.dev",
  "educative.io",
  "udemy.com",
];

const book = loadBook();
const steps = book.chapters.flatMap((chapter) =>
  chapter.steps.map((step) => ({ chapter, step })),
);

test("chapters are numbered 01 upward and each file name starts with its id", () => {
  const fileNames = fs
    .readdirSync(curriculumDirectory)
    .filter((name) => name.endsWith(".md"))
    .sort();

  book.chapters.forEach((chapter, index) => {
    assert.equal(chapter.id, String(index + 1).padStart(2, "0"));
    assert.ok(fileNames[index].startsWith(`${chapter.id}-`));
  });
});

test("no step assigns more than three study items", () => {
  for (const { chapter, step } of steps)
    assert.ok(
      step.resources.length <= 3,
      `chapter ${chapter.id}, step "${step.title}"`,
    );
});

test("no resource comes from a banned site", () => {
  for (const { chapter, step } of steps)
    for (const resource of step.resources) {
      const host = new URL(resource.url).hostname;
      assert.ok(
        !bannedSites.some((site) => host === site || host.endsWith(`.${site}`)),
        `chapter ${chapter.id}: ${resource.url}`,
      );
    }
});

test("the same sections of a resource are assigned once in the whole book", () => {
  const assignedIn = new Map();
  for (const { chapter, step } of steps)
    for (const resource of step.resources) {
      if (resource.kind === "reference") continue;
      const assignment = `${resource.url} ${resource.scope}`;
      const place = `chapter ${chapter.id}, step "${step.title}"`;
      assert.ok(
        !assignedIn.has(assignment),
        `${resource.url} is assigned in ${assignedIn.get(assignment)} and in ${place}`,
      );
      assignedIn.set(assignment, place);
    }
});

test("chapter prose has no em dashes, semicolons outside code or curly quotes", () => {
  for (const name of fs.readdirSync(curriculumDirectory)) {
    const prose = fs
      .readFileSync(new URL(name, curriculumDirectory), "utf8")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "")
      .replace(/\]\([^)]*\)/g, "]");
    assert.doesNotMatch(prose, /[—‘’“”;]/, name);
  }
});
