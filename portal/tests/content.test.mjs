import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  extractLinks,
  markdownHtml,
  parseProgress,
  selectedResources,
} from "../data.mjs";

const data = JSON.parse(
  fs.readFileSync(new URL("../content.json", import.meta.url), "utf8"),
);
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("all phases and source sections survive the import", () => {
  assert.deepEqual(
    data.chapters.map((chapter) => chapter.id),
    [
      "0",
      "0b",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "9b",
      "9c",
      "10",
      "10b",
      "11",
      "11b",
      "11c",
      "12",
      "13",
      "14",
    ],
  );
  for (const chapter of data.chapters) {
    assert.ok(chapter.goal.length > 50);
    if (!chapter.extension) assert.ok(chapter.sections.length >= 4, chapter.id);
    assert.ok(chapter.checks.length > 0, chapter.id);
    assert.ok(chapter.resources.length > 0, chapter.id);
    if (!chapter.extension && !["0", "1", "13"].includes(chapter.id))
      assert.match(chapter.weekHtml, /<table>/);
  }
  assert.equal(data.extras.length, 3);
  assert.match(
    data.chapters.find((c) => c.id === "13").sourceText,
    /What comes after/,
  );
});

test("LEARNING.md progress marks the current C checkpoint", () => {
  const chapter = data.chapters.find((chapter) => chapter.id === "0b");
  assert.deepEqual(chapter.done, [0, 1, 2]);
  assert.equal(chapter.tracked, true);
  assert.equal(chapter.checks.length, 8);
  assert.match(chapter.checks[2], /arrays, strings, pointers/);
  assert.match(data.learningHtml, /ASan hangs/);
});

test("curated resources have absolute http links and honest deep-link labels", () => {
  for (const chapter of data.chapters) {
    for (const resource of chapter.resources) {
      assert.ok(["http:", "https:"].includes(new URL(resource.url).protocol));
      for (const field of ["title", "platform", "kind", "access", "note"])
        assert.ok(resource[field], `${chapter.id}: ${field}`);
    }
  }
  for (const chapter of data.chapters) {
    assert.ok(
      chapter.units.length > 0 && chapter.units.length <= 6,
      chapter.id,
    );
    assert.ok(chapter.rationale, chapter.id);
    assert.ok(chapter.excluded.length > 0, chapter.id);
    for (const unit of chapter.units) {
      for (const field of ["title", "outcome", "build", "stop"])
        assert.ok(unit[field], `${chapter.id}: ${field}`);
      for (const resource of [unit.read, unit.visual].filter(Boolean)) {
        assert.ok(["http:", "https:"].includes(new URL(resource.url).protocol));
        for (const field of ["title", "scope", "why", "platform", "access"])
          assert.ok(resource[field], `${chapter.id}: ${field}`);
      }
    }
    assert.equal(
      new Set(
        chapter.resources.map((resource) => resource.url.replace(/\/$/, "")),
      ).size,
      chapter.resources.length,
    );
  }
  const compiler = data.chapters.find((chapter) => chapter.id === "9");
  assert.ok(
    compiler.excluded.some((resource) => /compiler/i.test(resource.title)),
  );
  assert.ok(
    compiler.units.some((unit) =>
      /clox|bytecode/i.test(`${unit.title} ${unit.build}`),
    ),
  );
});

test("curation retains distinct core projects rather than treating them as duplicate resources", () => {
  const work = (id) =>
    data.chapters
      .find((chapter) => chapter.id === id)
      .units.map((unit) => `${unit.title} ${unit.build}`)
      .join(" ");
  assert.match(work("2"), /formatter/i);
  assert.match(work("2"), /serializer/i);
  assert.match(work("3"), /Bomb Lab/);
  assert.match(work("3"), /Attack Lab/);
  assert.match(work("5"), /allocator/i);
  assert.match(work("5"), /HTTP/);
  assert.match(work("6"), /SPSC/);
  assert.match(work("10"), /ray trac/i);
  assert.match(work("10b"), /second game/);
  assert.match(work("11"), /heap/);
  const gpu = data.chapters.find((chapter) => chapter.id === "8");
  assert.ok(
    gpu.units.some(
      (unit) =>
        unit.visual?.url === "https://www.youtube.com/watch?v=SGhfUhlowB4",
    ),
  );
  assert.ok(
    !gpu.resources.some((resource) => resource.url.includes("lTmYrKwjSOU")),
  );
});

test("required extensions add distinct builds and keep their toolchain boundaries explicit", () => {
  const chapter = (id) => data.chapters.find((c) => c.id === id);
  assert.deepEqual(
    data.chapters.filter((c) => c.extension).map((c) => c.id),
    ["9b", "9c", "11b", "11c", "14"],
  );
  assert.match(chapter("9b").core, /not an AST/);
  assert.match(chapter("9b").units.at(-1).build, /object/);
  assert.match(chapter("9c").units.at(-1).build, /single-step/);
  assert.match(chapter("9c").units[1].build, /60 Hz/);
  assert.match(chapter("11b").units[0].build, /guest only/);
  assert.ok(
    chapter("11b").resources.some((r) => r.url.endsWith("/deferred_work.html")),
  );
  assert.match(chapter("11c").core, /DMA only for PIO/);
  assert.match(chapter("11c").units[2].build, /bounded ring/);
  assert.match(chapter("14").core, /Python\/Numba/);
  assert.match(chapter("14").units[2].stop, /CUDA operation tests both pass/);
  for (const c of data.chapters.filter((c) => c.extension)) {
    const assigned = new Set(
      c.units.flatMap((u) => [u.read.url, u.visual?.url]).filter(Boolean),
    );
    assert.ok(
      c.lookups.every((r) => !assigned.has(r.url)),
      c.id,
    );
    assert.deepEqual(c.done, []);
    assert.ok(c.environment);
  }
});

test("existing source checklist indices are retained when required checks are appended", () => {
  for (const id of ["5", "6", "11"]) {
    const chapter = data.chapters.find((c) => c.id === id);
    const original = [...chapter.sourceText.matchAll(/^- \[ \] (.+)$/gm)].map(
      (m) => m[1],
    );
    assert.ok(original.length > 0, id);
    assert.deepEqual(chapter.checks.slice(0, original.length), original, id);
  }
  assert.ok(
    data.chapters
      .find((c) => c.id === "5")
      .units.some((u) => u.read.url.endsWith("/labs/mmap.html")),
  );
});

test("selection keeps shared links once without importing the archive", () => {
  const resource = {
    title: "Text",
    url: "https://example.org/text",
    scope: "Chapter one.",
    why: "Contract.",
    platform: "Book",
    access: "Free",
  };
  const selected = selectedResources({
    units: [
      { title: "A", read: resource },
      {
        title: "B",
        read: { ...resource, url: resource.url + "/", scope: "Chapter two." },
      },
    ],
    lookups: [resource],
    resources: [{ url: "https://example.org/rejected" }],
  });
  assert.equal(selected.length, 1);
  assert.match(selected[0].note, /Chapter one/);
  assert.match(selected[0].note, /Chapter two/);
  assert.equal(selected[0].kind, "Read");
});

test("standalone HTML embeds content, styles and app so file:// still works", () => {
  assert.match(html, /<style>/);
  assert.match(html, /id="roadmap-data"/);
  assert.match(html, /id="diagram-runtime"/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  // The only network call is the live data fetch, used only over http.
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.deepEqual(
    [...app.matchAll(/fetch\("([^"]+)"/g)].map((match) => match[1]),
    ["/data.json"],
  );
  assert.ok(html.includes('aria-live="polite"'));
});

test("markdown rendering preserves code, tables, links and Mermaid source", () => {
  const rendered = markdownHtml(
    "```mermaid\nflowchart LR\n A-->B\n```\n\n[Docs](https://example.org/docs)\n\n| A | B |\n|---|---|\n| one | two |",
  );
  assert.match(rendered, /class="mermaid-diagram"/);
  assert.match(rendered, /Diagram source \(Mermaid\)/);
  assert.match(rendered, /A--&gt;B/);
  assert.match(rendered, /<table>/);
  assert.match(rendered, /rel="noopener noreferrer"/);
});

test("link extraction removes markdown escaping and duplicate URLs", () => {
  const links = extractLinks(
    "[Book](https://example.org/a)\nhttps://example.org/a\nhttps://example.org/hello\\_world.",
  );
  assert.equal(links.length, 2);
  assert.equal(links[0].title, "Book");
  assert.equal(links[1].url, "https://example.org/hello_world");
});

const sample = `Phase: 7
## Checklist
- [x] First thing
- [ ] Second thing <- current

## Done phases
### Phase 0
- [x] Old thing

## Quiz log
- [x] not a checklist item
`;

test("parseProgress reads the current phase and done phases", () => {
  const progress = parseProgress(sample);
  assert.equal(progress.current, "7");
  assert.deepEqual(progress.phases["7"], [
    { text: "First thing", done: true },
    { text: "Second thing", done: false },
  ]);
  assert.deepEqual(progress.phases["0"], [{ text: "Old thing", done: true }]);
  assert.deepEqual(Object.keys(progress.phases).sort(), ["0", "7"]);
});

test("parseProgress picks up a new phase block and rejects a missing Phase line", () => {
  const added = sample.replace(
    "## Quiz log",
    "### Phase 3\n- [ ] New thing\n\n## Quiz log",
  );
  assert.deepEqual(parseProgress(added).phases["3"], [
    { text: "New thing", done: false },
  ]);
  assert.throws(() => parseProgress("## Checklist\n- [x] a\n"));
});
