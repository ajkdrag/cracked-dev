// HTML for every page. The search results are rendered in the browser by
// static/portal.js.
import fs from "node:fs";
import { marked } from "marked";
import { ChapterFormatError } from "./book.mjs";

const figuresDirectory = new URL("../curriculum/figures/", import.meta.url);

const kindLabels = {
  read: "Read",
  watch: "Watch",
  do: "Do",
  reference: "Reference",
};

export function homePage(book) {
  const current = book.chapters.find(
    (chapter) => chapter.id === book.currentChapterId,
  );
  const totalWeeks = book.chapters.reduce(
    (sum, chapter) => sum + chapter.weeks,
    0,
  );
  const main = `
    <div class="page">
      <article class="page-content">
        <h1>Contents</h1>
        <p class="lead">${book.chapters.length} chapters, about ${totalWeeks} weeks at 12 hours a week. Read the chapters in order. Each step names what to study, what to build and when to stop.</p>
        ${continueCard(current)}
        ${groupByPart(book.chapters)
          .map(
            ({ part, chapters }) => `
          <h2 class="part-heading">${escapeHtml(part)}</h2>
          <div class="contents-list">
            ${chapters.map(contentsRow).join("")}
          </div>`,
          )
          .join("")}
      </article>
    </div>`;
  return layout(book, { title: "Contents", activeChapterId: null, main });
}

function continueCard(chapter) {
  const nextItem = chapter.checklist.find((item) => !item.done);
  return `
    <a class="card-link" href="/chapter/${chapter.id}">
      <span class="card-link-label">Continue, ${progressCount(chapter)} done</span>
      <span class="card-link-title">${chapter.id}. ${escapeHtml(chapter.title)}</span>
      ${nextItem ? `<span class="card-link-note">${inlineMarkdown(nextItem.text)}</span>` : ""}
    </a>`;
}

function contentsRow(chapter) {
  return `
    <a class="contents-row" href="/chapter/${chapter.id}">
      <span class="contents-number">${chapter.id}</span>
      <span class="contents-text">
        <span class="contents-title">${escapeHtml(chapter.title)}</span>
        <span class="contents-project">${inlineMarkdown(chapter.project)}</span>
      </span>
      <span class="contents-weeks">${chapter.weeks} wk</span>
    </a>`;
}

export function chapterPage(book, chapter) {
  const index = book.chapters.indexOf(chapter);
  const previous = book.chapters[index - 1];
  const next = book.chapters[index + 1];
  const main = `
    <div class="page">
      <article class="page-content">
        <p class="eyebrow">Chapter ${chapter.id}, ${escapeHtml(chapter.part)}, ${chapter.weeks} weeks</p>
        <h1>${escapeHtml(chapter.title)}</h1>
        <p class="lead">${inlineMarkdown(chapter.project)}</p>
        <div class="content prose">${blockMarkdown(chapter.opening)}</div>
        ${chapter.steps.map(stepSection).join("")}
        <section class="closing" id="where-this-leads">
          <h2>Where this leads</h2>
          <div class="content prose">${blockMarkdown(chapter.closing)}</div>
        </section>
        <nav class="pager">
          ${previous ? pagerCard("Previous", previous) : "<span></span>"}
          ${next ? pagerCard("Next", next) : "<span></span>"}
        </nav>
      </article>
      ${chapterRail(chapter)}
    </div>`;
  return layout(book, {
    title: `${chapter.id} ${chapter.title}`,
    activeChapterId: chapter.id,
    main,
  });
}

function pagerCard(label, chapter) {
  return `
    <a class="card-link pager-${label.toLowerCase()}" href="/chapter/${chapter.id}">
      <span class="card-link-label">${label}</span>
      <span class="card-link-title">${chapter.id}. ${escapeHtml(chapter.title)}</span>
    </a>`;
}

function stepSection(step) {
  return `
    <section class="step" id="step-${step.number}">
      <h2><span class="step-number">${step.number}.</span> ${inlineMarkdown(step.title)}</h2>
      <div class="content prose">${blockMarkdown(step.bridge)}</div>
      <h3>Study</h3>
      <ul class="study">
        ${step.resources
          .map(
            (resource) => `
          <li>
            <a class="study-title" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer">${inlineMarkdown(resource.title)}</a>
            <span class="study-meta">${kindLabels[resource.kind]}, ${escapeHtml(resource.time)}</span>
            <p class="study-scope">${inlineMarkdown(resource.scope)}</p>
          </li>`,
          )
          .join("")}
      </ul>
      <h3>Build</h3>
      <div class="content prose">${blockMarkdown(step.build)}</div>
      <div class="done-when">
        <h3>Done when</h3>
        <div class="content prose">${blockMarkdown(step.doneWhen)}</div>
      </div>
    </section>`;
}

function chapterRail(chapter) {
  const checklist = chapter.checklist.length
    ? `
      <h2>Checklist, ${progressCount(chapter)}</h2>
      <ul class="rail-checklist">
        ${chapter.checklist
          .map(
            (item) =>
              `<li class="${item.done ? "is-done" : ""}"><span class="tick">${item.done ? "&#10003;" : ""}</span><span class="rail-checklist-text" title="${escapeHtml(item.text)}">${inlineMarkdown(item.text)}</span></li>`,
          )
          .join("")}
      </ul>`
    : "";
  return `
    <aside class="rail">
      <h2>On this page</h2>
      <ol class="rail-steps">
        ${chapter.steps
          .map(
            (step) =>
              `<li><a href="#step-${step.number}" data-step-link>${step.number}. ${inlineMarkdown(step.title)}</a></li>`,
          )
          .join("")}
        <li><a href="#where-this-leads" data-step-link>Where this leads</a></li>
      </ol>
      ${checklist}
    </aside>`;
}

export function messagePage(book, title, message) {
  const main = `
    <div class="page">
      <article class="page-content">
        <h1>${escapeHtml(title)}</h1>
        <pre class="message">${escapeHtml(message)}</pre>
      </article>
    </div>`;
  return layout(book, { title, activeChapterId: null, main });
}

// `book` is null when the book itself failed to load. The sidebar is then empty.
function layout(book, { title, activeChapterId, main }) {
  const chapters = book?.chapters ?? [];
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} / cracked-dev</title>
  <link rel="stylesheet" href="/vendor/bulma.css">
  <link rel="stylesheet" href="/static/portal.css">
  <script src="/vendor/htmx.js" defer></script>
  <script src="/static/portal.js" type="module"></script>
</head>
<body hx-boost="true">
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/">cracked-dev</a>
      <button class="search-button" type="button" data-open-search>Search<kbd>&#8984;K</kbd></button>
      <nav class="chapter-list">
        ${groupByPart(chapters)
          .map(
            ({ part, chapters: partChapters }) => `
          <p class="part-label">${escapeHtml(part)}</p>
          ${partChapters
            .map(
              (chapter) => `
            <a href="/chapter/${chapter.id}" class="${[
              chapter.id === activeChapterId ? "is-active" : "",
              chapter.id === book.currentChapterId ? "is-current" : "",
            ].join(" ")}">
              <span class="chapter-number">${chapter.id}</span>
              <span class="chapter-title">${escapeHtml(chapter.title)}</span>
              <span class="progress-count">${progressCount(chapter)}</span>
            </a>`,
            )
            .join("")}`,
          )
          .join("")}
      </nav>
    </aside>
    <main id="main">${main}</main>
  </div>
  <div class="modal search-modal" id="search-modal">
    <div class="modal-background" data-close-search></div>
    <div class="modal-content">
      <input class="input" id="search-input" type="search" name="q" autocomplete="off"
        placeholder="Search chapters, steps and resources">
      <div id="search-results"></div>
      <p class="search-keys"><kbd>&uarr;</kbd><kbd>&darr;</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close</p>
    </div>
  </div>
</body>
</html>`;
}

function groupByPart(chapters) {
  const groups = [];
  for (const chapter of chapters) {
    if (groups.at(-1)?.part !== chapter.part)
      groups.push({ part: chapter.part, chapters: [] });
    groups.at(-1).chapters.push(chapter);
  }
  return groups;
}

function progressCount(chapter) {
  if (chapter.checklist.length === 0) return "";
  const done = chapter.checklist.filter((item) => item.done).length;
  return `${done}/${chapter.checklist.length}`;
}

function blockMarkdown(text) {
  return inlineFigures(openLinksInNewTab(marked.parse(text)));
}

// A paragraph that holds only `![caption](figures/name.svg)` becomes the SVG
// itself, so the drawing takes its colors from the page theme.
function inlineFigures(html) {
  return html.replace(
    /<p><img src="figures\/([\w-]+\.svg)" alt="([^"]*)"><\/p>/g,
    (paragraph, fileName, caption) => {
      const file = new URL(fileName, figuresDirectory);
      if (!fs.existsSync(file))
        throw new ChapterFormatError(`missing figure: figures/${fileName}`);
      return `<figure class="figure">${fs.readFileSync(file, "utf8")}<figcaption>${caption}</figcaption></figure>`;
    },
  );
}

function inlineMarkdown(text) {
  return openLinksInNewTab(marked.parseInline(text));
}

function openLinksInNewTab(html) {
  return html.replace(
    /<a href="(https?:[^"]+)"/g,
    '<a target="_blank" rel="noopener noreferrer" href="$1"',
  );
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
