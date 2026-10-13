import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { marked } from "marked";

const directory = path.dirname(fileURLToPath(import.meta.url));

export function markdownHtml(text) {
  text = text.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
    const source = diagram
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `\n<figure class="diagram"><div class="mermaid-diagram" role="img" aria-label="Roadmap diagram">Rendering diagram…</div><details><summary>Diagram source (Mermaid)</summary><pre><code>${source}</code></pre></details></figure>\n`;
  });
  return marked
    .parse(text)
    .replace(
      /<a href="(https?:[^\"]+)"/g,
      '<a target="_blank" rel="noopener noreferrer" href="$1"',
    );
}

export function extractLinks(text) {
  const found = new Map();
  for (const match of text.matchAll(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>|)]+)/g,
  )) {
    const url = (match[2] || match[3])
      .replace(/\\([_~])/g, "$1")
      .replace(/[.,;]+$/, "");
    if (found.has(url)) continue;
    const context = text.slice(
      text.lastIndexOf("\n", match.index) + 1,
      text.indexOf("\n", match.index) < 0
        ? text.length
        : text.indexOf("\n", match.index),
    );
    const title =
      match[1] ||
      new URL(url).hostname.replace(/^www\./, "") + new URL(url).pathname;
    found.set(url, {
      title,
      url,
      platform: new URL(url).hostname.replace(/^www\./, ""),
      kind: "Roadmap reference",
      access: "See source",
      note: context.replace(/^[\s*-]+/, ""),
      evidence: "Imported from roadmap; not independently rechecked",
    });
  }
  return [...found.values()];
}

export function selectedResources(guide) {
  const selected = new Map();
  for (const unit of guide.units || []) {
    for (const [kind, resource] of [
      ["Read", unit.read],
      ["Visual companion", unit.visual],
    ]) {
      if (!resource) continue;
      const key = resource.url.replace(/\/$/, "");
      const previous = selected.get(key);
      if (previous) {
        previous.note += ` ${unit.title}: ${resource.scope}`;
        continue;
      }
      selected.set(key, {
        ...resource,
        kind,
        note: `${resource.scope} ${resource.why}`,
      });
    }
  }
  for (const resource of guide.lookups || []) {
    const key = resource.url.replace(/\/$/, "");
    if (!selected.has(key))
      selected.set(key, {
        ...resource,
        kind: "Lookup",
        note: `${resource.scope} ${resource.why}`,
      });
  }
  return [...selected.values()];
}

// Progress lives in LEARNING.md and is read fresh on every call.
// The `Phase:` line names the phase under `## Checklist`. Finished phases sit
// under `## Done phases` as `### Phase <id>` blocks. A listed phase replaces
// that chapter's curated checks, so adding an item there adds it to the portal.
export function parseProgress(learning) {
  const current = learning.match(/^Phase: (\S+)/m)?.[1];
  if (!current) throw new Error("LEARNING.md needs a line like 'Phase: 0b'");
  const section = (name) =>
    learning.match(
      new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"),
    )?.[1] ?? "";
  const items = (text) =>
    [...text.matchAll(/^- \[([ x])\] (.+)$/gm)].map(([, mark, label]) => ({
      text: label.replace(/ <- current$/, ""),
      done: mark === "x",
    }));
  const phases = { [current]: items(section("Checklist")) };
  for (const [, id, body] of section("Done phases").matchAll(
    /^### Phase (\S+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm,
  ))
    phases[id] = items(body);
  return { current, phases };
}

export function loadData() {
  const roadmap = fs.readFileSync(
    path.join(directory, "../ROADMAP-BEGINNER.md"),
    "utf8",
  );
  const learning = fs.readFileSync(
    path.join(directory, "../LEARNING.md"),
    "utf8",
  );
  const curated = JSON.parse(
    fs.readFileSync(path.join(directory, "curated.json"), "utf8"),
  );
  const progress = parseProgress(learning);
  const parts = [
    ...roadmap.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm),
  ];
  const chapters = parts
    .filter((part) => part[1].startsWith("Phase "))
    .map((part) => {
      const [, id, title] = part[1].match(/^Phase ([\db]+): (.+)$/);
      const body = part[2];
      const weeks = title.match(/\(([^)]+)\)$/)?.[1] || "ongoing";
      const sections = [
        ...body.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm),
      ].map((section) => ({
        title: section[1],
        html: markdownHtml(section[2]),
      }));
      const intro = body.split(/^### /m)[0];
      const goal = intro.match(/Goal: ([\s\S]*?)(?=\n\n)/)?.[1] || intro.trim();
      const sourceChecks = [...body.matchAll(/^- \[ \] (.+)$/gm)].map(
        (match) => match[1],
      );
      const guide = curated.chapters[id] || {};
      const checks = guide.checks || sourceChecks;
      return {
        id,
        title: title.replace(/ \([^)]+\)$/, ""),
        shortTitle:
          guide.shortTitle || title.split(",")[0].replace(/ \([^)]+\)$/, ""),
        weeks,
        goal,
        introHtml: markdownHtml(intro),
        sections,
        checks,
        project: guide.project || goal,
        core:
          guide.core ||
          "Use the first working checkpoint in the roadmap. Stretch goals do not block the next phase.",
        units: guide.units || [],
        rationale: guide.rationale || "",
        excluded: guide.excluded || [],
        lookups: guide.lookups || [],
        resources: selectedResources(guide),
        sourceResources: extractLinks(body),
        weekHtml:
          sections.find((section) => section.title === "Week by week")?.html ||
          "",
        sourceText: body,
      };
    });
  // Extensions have no original Markdown chapter. Keep old IDs and checklist
  // indices stable so existing browser progress remains meaningful.
  for (const [id, guide] of Object.entries(curated.chapters)) {
    if (!guide.after) continue;
    const index = chapters.findIndex((chapter) => chapter.id === guide.after);
    if (index < 0 || chapters.some((chapter) => chapter.id === id))
      throw new Error(
        `Invalid extension placement: ${id} after ${guide.after}`,
      );
    chapters.splice(index + 1, 0, {
      ...guide,
      id,
      extension: true,
      introHtml: "",
      sections: [],
      sourceResources: [],
      weekHtml: "",
      sourceText: "",
      resources: selectedResources(guide),
    });
  }
  for (const id of Object.keys(progress.phases))
    if (!chapters.some((chapter) => chapter.id === id))
      throw new Error(
        `LEARNING.md lists Phase ${id}, which is not in the roadmap`,
      );
  for (const chapter of chapters) {
    const items = progress.phases[chapter.id];
    chapter.tracked = Boolean(items);
    if (items) chapter.checks = items.map((item) => item.text);
    chapter.done = (items || []).flatMap((item, index) =>
      item.done ? [index] : [],
    );
  }
  const extras = parts
    .filter((part) => !part[1].startsWith("Phase "))
    .map((part) => ({ title: part[1], html: markdownHtml(part[2]) }));
  const data = {
    chapters,
    extras,
    current: progress.current,
    learningHtml: markdownHtml(learning),
    subscriptions: [
      "Master.dev",
      "Educative",
      "Udemy Business",
      "Computer Enhance",
    ],
    source: "ROADMAP-BEGINNER.md + LEARNING.md + curated.json",
    resourceCount: chapters.reduce(
      (sum, chapter) => sum + chapter.resources.length,
      0,
    ),
  };
  return data;
}
