import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const data = JSON.parse(
  fs.readFileSync(new URL("../content.json", import.meta.url), "utf8"),
);
const script = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

function browserContext(saved, blocked = false) {
  const elements = new Map(
    ["app", "notice", "export-progress", "import-progress", "main"].map(
      (id) => [id, { innerHTML: "", textContent: "", focus() {} }],
    ),
  );
  elements.set("roadmap-data", { textContent: JSON.stringify(data) });
  const context = vm.createContext({
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelectorAll: () => [],
      querySelector: () => ({}),
      title: "",
    },
    localStorage: {
      getItem: () => saved || null,
      setItem: (_key, value) => {
        if (blocked) throw new Error("Blocked");
        saved = value;
      },
    },
    location: { hash: "" },
    window: { addEventListener() {}, scrollTo() {} },
    setTimeout: () => 1,
    clearTimeout() {},
  });
  vm.runInContext(script, context);
  return { context, elements, saved: () => saved };
}

test("new browser shows LEARNING.md progress and renders overview", () => {
  const { context, elements } = browserContext();
  assert.equal(vm.runInContext("progress(data.chapters[1]).done", context), 3);
  assert.match(elements.get("app").innerHTML, /Your systems/);
  assert.match(elements.get("app").innerHTML, /3\/8 checkpoints/);
});

test("all chapter routes and tabs render without missing sections", () => {
  const { context } = browserContext();
  for (const chapter of data.chapters) {
    for (const tab of ["plan", "references", "source", "notes"]) {
      const rendered = vm.runInContext(
        `activeTab=${JSON.stringify(tab)};chapterTab(data.chapters.find(chapter=>chapter.id===${JSON.stringify(chapter.id)}))`,
        context,
      );
      assert.ok(rendered.length > 100, `${chapter.id}/${tab}`);
      assert.doesNotMatch(
        rendered,
        /href="undefined"|>NaN</,
        `${chapter.id}/${tab}`,
      );
    }
  }
});

test("study paths do not repeat week tables or a separate resource queue", () => {
  const { context } = browserContext();
  for (const chapter of data.chapters) {
    const rendered = vm.runInContext(
      `activeTab="plan";chapterTab(data.chapters.find(c=>c.id===${JSON.stringify(chapter.id)}))`,
      context,
    );
    assert.match(rendered, /BUILD \/ VERIFY/);
    assert.match(rendered, /MOVE ON WHEN/);
    assert.doesNotMatch(
      rendered,
      /Original week-by-week|Start with these references/,
    );
    assert.equal(
      (rendered.match(/class="study-unit"/g) || []).length,
      chapter.units.length,
    );
    assert.equal(
      (rendered.match(/class="visual-companion"/g) || []).length,
      chapter.units.filter((unit) => unit.visual).length,
    );
  }
});

test("lookups omit assigned readings and archive links; library deduplicates shared links", () => {
  const { context } = browserContext();
  vm.runInContext('activeTab="references"', context);
  for (const chapter of data.chapters) {
    const rendered = vm.runInContext(
      `chapterTab(data.chapters.find(c=>c.id===${JSON.stringify(chapter.id)}))`,
      context,
    );
    const lookupUrls = new Set(chapter.lookups.map((resource) => resource.url));
    for (const unit of chapter.units) {
      if (!lookupUrls.has(unit.read.url))
        assert.ok(!rendered.includes(`href="${unit.read.url}"`));
    }
  }
  assert.equal(
    vm.runInContext(
      'new Set(libraryResources().map(r=>r.url.replace(/\\/$/, ""))).size === libraryResources().length',
      context,
    ),
    true,
  );
  assert.equal(
    vm.runInContext(
      "resourcesFor(data.chapters[1]).some(r=>data.chapters[1].sourceResources.some(s=>s.url===r.url) && !data.chapters[1].resources.some(c=>c.url===r.url))",
      context,
    ),
    false,
  );
  const archive = vm.runInContext(
    'activeTab="source";chapterTab(data.chapters[1])',
    context,
  );
  assert.match(archive, /class="archive-section"/);
  assert.doesNotMatch(archive, /class="archive-section" open/);
});

test("progress validation rejects corrupt backups", () => {
  const { context } = browserContext();
  assert.equal(vm.runInContext("validProgress(state)", context), true);
  assert.equal(vm.runInContext("validProgress(null)", context), null);
  assert.equal(
    vm.runInContext("validProgress({...state,version:2})", context),
    false,
  );
  assert.equal(
    vm.runInContext('validProgress({...state,notes:{"0b":123}})', context),
    false,
  );
});

test("note changes save and restore", () => {
  const first = browserContext();
  vm.runInContext(
    'state.notes["0b"]="A pointer owns nothing.";saveProgress()',
    first.context,
  );
  const second = browserContext(first.saved());
  assert.equal(
    vm.runInContext('state.notes["0b"]', second.context),
    "A pointer owns nothing.",
  );
});

test("old saves keep notes and drop stored checkpoint ticks", () => {
  const legacy = {
    version: 1,
    checks: { "0b": [0, 1, 2, 3, 4, 5, 6, 7] },
    notes: { "0b": "Keep my pointer drawings." },
    lastChapter: "0b",
  };
  const { context } = browserContext(JSON.stringify(legacy));
  assert.equal(
    vm.runInContext('state.notes["0b"]', context),
    legacy.notes["0b"],
  );
  assert.equal(vm.runInContext("state.checks", context), undefined);
  assert.equal(vm.runInContext("progress(data.chapters[1]).done", context), 3);
  context.legacy = legacy;
  assert.equal(vm.runInContext("validProgress(legacy)", context), true);
  assert.equal(
    vm.runInContext("validProgress({...legacy, notes: []})", context),
    false,
  );
  assert.equal(
    vm.runInContext('validProgress({...legacy, lastChapter: "nope"})', context),
    false,
  );
});

test("checklist is read-only and reflects LEARNING.md", () => {
  const { context } = browserContext();
  const rendered = vm.runInContext(
    'activeTab="plan";chapterTab(data.chapters.find(c=>c.id==="0b"))',
    context,
  );
  assert.equal(
    (rendered.match(/<input type="checkbox" disabled/g) || []).length,
    8,
  );
  assert.equal((rendered.match(/disabled checked/g) || []).length, 3);
  assert.doesNotMatch(rendered, /data-check/);
});

test("storage failure warns rather than losing the in-memory session", () => {
  const { context, elements } = browserContext(null, true);
  vm.runInContext('state.notes["0b"]="Keep this";saveProgress()', context);
  assert.match(elements.get("notice").textContent, /Export notes/);
  assert.equal(vm.runInContext('state.notes["0b"]', context), "Keep this");
});

test("search combines text and platform and escapes note HTML", () => {
  const { context } = browserContext();
  assert.equal(
    vm.runInContext(
      'searchQuery="thread";platformFilter="Documentation";[{title:"ThreadSanitizer",platform:"Documentation",scope:"Thread tests",why:"Find races"}].filter(matchesResource).length',
      context,
    ),
    1,
  );
  assert.equal(
    vm.runInContext(
      'platformFilter="Master.dev";[{title:"ThreadSanitizer",platform:"Documentation",scope:"Thread tests",why:"Find races"}].filter(matchesResource).length',
      context,
    ),
    0,
  );
  assert.equal(
    vm.runInContext('escapeHtml("<script>bad</script>")', context),
    "&lt;script&gt;bad&lt;/script&gt;",
  );
});
