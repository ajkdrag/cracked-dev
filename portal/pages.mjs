// HTML for every page and fragment the server returns.
import { marked } from "marked";

export function homePage(book) {
  const current = book.chapters.find(
    (chapter) => chapter.id === book.currentChapterId,
  );
  const totalWeeks = book.chapters.reduce(
    (sum, chapter) => sum + chapter.weeks,
    0,
  );
  const main = `
    <header class="page-bar">
      <h1>Contents</h1>
      <span class="page-bar-meta">${book.chapters.length} chapters, about ${totalWeeks} weeks at 12 h/week</span>
    </header>
    <div class="contents">
      ${continueStrip(current)}
      <p class="how-to">Read the chapters in order. Each step names what to study, what to build and when to stop. Progress comes from LEARNING.md.</p>
      ${groupByPart(book.chapters)
        .map(
          ({ part, chapters }) => `
        <h2 class="part-heading">${escapeHtml(part)}</h2>
        <table class="contents-table">
          ${chapters.map((chapter) => contentsRow(chapter, book.currentChapterId)).join("")}
        </table>`,
        )
        .join("")}
    </div>`;
  return layout(book, { title: "Contents", activeChapterId: null, main });
}

function continueStrip(chapter) {
  const nextItem = chapter.checklist.find((item) => !item.done);
  return `
    <a class="continue-strip" href="/chapter/${chapter.id}">
      <span class="label">Continue</span>
      <span class="chapter-number">${chapter.id}</span>
      <strong>${escapeHtml(chapter.title)}</strong>
      <span class="continue-item">${nextItem ? inlineMarkdown(nextItem.text) : ""}</span>
      <span class="progress-count">${progressCount(chapter)}</span>
    </a>`;
}

function contentsRow(chapter, currentChapterId) {
  return `
    <tr class="${chapter.id === currentChapterId ? "is-current" : ""}">
      <td class="chapter-number">${chapter.id}</td>
      <td class="contents-title"><a href="/chapter/${chapter.id}">${escapeHtml(chapter.title)}</a></td>
      <td class="contents-project">${inlineMarkdown(chapter.project)}</td>
      <td class="contents-weeks">${chapter.weeks} wk</td>
      <td class="progress-count">${progressCount(chapter)}</td>
    </tr>`;
}

export function chapterPage(book, chapter) {
  const index = book.chapters.indexOf(chapter);
  const previous = book.chapters[index - 1];
  const next = book.chapters[index + 1];
  const main = `
    <header class="page-bar">
      <span class="chapter-number">${chapter.id}</span>
      <h1>${escapeHtml(chapter.title)}</h1>
      <span class="page-bar-meta">${escapeHtml(chapter.part)}, ${chapter.weeks} weeks, ${chapter.steps.length} steps</span>
      <nav class="page-bar-nav">
        ${previous ? `<a href="/chapter/${previous.id}" title="${escapeHtml(previous.title)}">&larr; ${previous.id}</a>` : ""}
        ${next ? `<a href="/chapter/${next.id}" title="${escapeHtml(next.title)}">${next.id} &rarr;</a>` : ""}
      </nav>
    </header>
    <div class="chapter-body">
      <article class="chapter content">
        <p class="project"><span class="label">Project</span> ${inlineMarkdown(chapter.project)}</p>
        ${blockMarkdown(chapter.opening)}
        ${chapter.steps.map(stepSection).join("")}
        <section class="closing" id="where-this-leads">
          <h2>Where this leads</h2>
          ${blockMarkdown(chapter.closing)}
          ${next ? `<a class="next-chapter" href="/chapter/${next.id}"><span class="label">Next</span> <span class="chapter-number">${next.id}</span> ${escapeHtml(next.title)} &rarr;</a>` : ""}
        </section>
      </article>
      ${chapterRail(chapter)}
    </div>`;
  return layout(book, {
    title: `${chapter.id} ${chapter.title}`,
    activeChapterId: chapter.id,
    main,
  });
}

function stepSection(step) {
  return `
    <section class="step" id="step-${step.number}">
      <h2><span class="step-number">${step.number}</span><span>${inlineMarkdown(step.title)}</span></h2>
      ${blockMarkdown(step.bridge)}
      <ul class="study">
        ${step.resources
          .map(
            (resource) => `
          <li>
            <span class="kind kind-${resource.kind}">${resource.kind}</span>
            <a class="study-title" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer">${inlineMarkdown(resource.title)}</a>
            <span class="study-time">${escapeHtml(resource.time)}</span>
            <p class="study-scope">${inlineMarkdown(resource.scope)}</p>
          </li>`,
          )
          .join("")}
      </ul>
      <div class="task build"><h3>Build</h3>${blockMarkdown(step.build)}</div>
      <div class="task done-when"><h3>Done when</h3>${blockMarkdown(step.doneWhen)}</div>
    </section>`;
}

function chapterRail(chapter) {
  const checklist = chapter.checklist.length
    ? `
      <h2>Checklist <span class="progress-count">${progressCount(chapter)}</span></h2>
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
      <h2>Steps</h2>
      <ol class="rail-steps">
        ${chapter.steps
          .map(
            (step) =>
              `<li><a href="#step-${step.number}" data-step-link><span class="step-number">${step.number}</span><span>${inlineMarkdown(step.title)}</span></a></li>`,
          )
          .join("")}
        <li><a href="#where-this-leads" data-step-link><span class="step-number">&rarr;</span>Where this leads</a></li>
      </ol>
      ${checklist}
    </aside>`;
}

export function searchResults(hits, query) {
  if (!query.trim())
    return `<p class="search-hint">Type a keyword: pointers, LLVM, cache, page table.</p>`;
  if (hits.length === 0)
    return `<p class="search-hint">Nothing matches "${escapeHtml(query)}".</p>`;
  return hits
    .map(
      (hit) => `
      <div class="search-hit">
        <a class="search-hit-main" href="${hit.href}" data-search-hit>
          <span class="kind kind-${hit.kind}">${hit.kind}</span>
          <span class="chapter-number">${hit.chapterId}</span>
          <span class="search-hit-text">
            <strong>${escapeHtml(hit.title)}</strong>
            <span class="search-hit-context">${escapeHtml(hit.context)}</span>
            <span class="search-hit-snippet">${escapeHtml(hit.snippet)}</span>
          </span>
        </a>
        ${hit.externalUrl ? `<a class="search-hit-open" href="${escapeHtml(hit.externalUrl)}" target="_blank" rel="noopener noreferrer" hx-boost="false" title="Open the resource">open &nearr;</a>` : ""}
      </div>`,
    )
    .join("");
}

export function messagePage(book, title, message) {
  const main = `
    <header class="page-bar"><h1>${escapeHtml(title)}</h1></header>
    <div class="contents"><pre class="message">${escapeHtml(message)}</pre></div>`;
  return layout(book, { title, activeChapterId: null, main });
}

// `book` is null when the book itself failed to load. The sidebar is then empty.
function layout(book, { title, activeChapterId, main }) {
  const chapters = book?.chapters ?? [];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} / cracked-dev</title>
  <link rel="stylesheet" href="/vendor/bulma.css">
  <link rel="stylesheet" href="/static/portal.css">
  <script src="/vendor/htmx.js" defer></script>
  <script src="/static/portal.js" defer></script>
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
        placeholder="Search chapters, steps and resources"
        hx-get="/search" hx-trigger="input changed delay:80ms" hx-target="#search-results">
      <div id="search-results">${searchResults([], "")}</div>
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
  return openLinksInNewTab(marked.parse(text));
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
