// The embedded copy is the offline snapshot from the last build. Over http the
// server sends fresh data (progress from LEARNING.md) and replaces it.
let data = JSON.parse(document.getElementById("roadmap-data").textContent);
let snapshotStale = !/^https?:/.test(location.protocol);
const storageKey = "altamash-systems-roadmap-v1";
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
let state = loadProgress();
let activeTab = "plan";
let searchQuery = "";
let platformFilter = "All platforms";
let memoryOnly = false;

// Only notes and the last opened phase live in this browser. Checkpoint ticks
// come from LEARNING.md. Old saves carry a `checks` field; it is dropped here.
function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (validProgress(saved)) return keepBrowserState(saved);
  } catch {
    /* Storage can be unavailable under file:// or browser privacy settings. */
  }
  return { version: 1, notes: {}, lastChapter: data.current };
}

function keepBrowserState(saved) {
  return {
    version: 1,
    notes: saved.notes,
    lastChapter: saved.lastChapter,
  };
}

function validProgress(value) {
  return (
    value &&
    value.version === 1 &&
    value.notes &&
    typeof value.notes === "object" &&
    !Array.isArray(value.notes) &&
    Object.values(value.notes).every((note) => typeof note === "string") &&
    typeof value.lastChapter === "string" &&
    data.chapters.some((chapter) => chapter.id === value.lastChapter)
  );
}

function saveProgress() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    memoryOnly = true;
    notify(
      "Browser storage is unavailable. Export notes before closing this tab.",
    );
  }
}

function notify(message) {
  const notice = document.getElementById("notice");
  notice.textContent = message;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => {
    notice.textContent = "";
  }, 5000);
}

function progress(chapter) {
  const done = chapter.done.length;
  return {
    done,
    total: chapter.checks.length,
    percent: chapter.checks.length
      ? Math.round((done / chapter.checks.length) * 100)
      : 0,
  };
}

function currentChapter() {
  return (
    data.chapters.find((chapter) => chapter.id === state.lastChapter) ||
    data.chapters[1]
  );
}

function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("phase/"))
    return {
      type: "chapter",
      chapter: data.chapters.find((chapter) => chapter.id === hash.slice(6)),
    };
  if (hash === "library") return { type: "library" };
  if (hash === "guide") return { type: "guide" };
  return { type: "home" };
}

function resourcesFor(chapter) {
  return chapter.resources;
}

function libraryResources() {
  const selected = new Map();
  for (const chapter of data.chapters) {
    for (const resource of resourcesFor(chapter)) {
      const key = resource.url.replace(/\/$/, "");
      const previous = selected.get(key);
      if (previous) {
        previous.chapters.push(chapter);
        previous.note += ` Phase ${chapter.id}: ${resource.note}`;
      } else {
        selected.set(key, { ...resource, chapters: [chapter] });
      }
    }
  }
  return [...selected.values()];
}

function renderApp() {
  const page = route();
  if (page.type === "chapter" && !page.chapter) {
    location.hash = "";
    return;
  }
  if (page.chapter) {
    state.lastChapter = page.chapter.id;
    saveProgress();
  }
  const total = data.chapters.reduce(
    (sum, chapter) => sum + progress(chapter).total,
    0,
  );
  const done = data.chapters.reduce(
    (sum, chapter) => sum + progress(chapter).done,
    0,
  );
  document.getElementById("app").innerHTML = `
    <aside class="sidebar" aria-label="Roadmap navigation">
      <a class="brand" href="#"><span class="brand-mark">C_</span><span>Systems<br> roadmap</span></a>
      <div class="identity">ALTAMASH / FIELD NOTES</div>
      <nav class="primary-nav" aria-label="Portal"><a href="#" ${page.type === "home" ? 'aria-current="page"' : ""}>Overview</a><a href="#library" ${page.type === "library" ? 'aria-current="page"' : ""}>Reference library</a><a href="#guide" ${page.type === "guide" ? 'aria-current="page"' : ""}>How to use this</a></nav>
      <div class="nav-caption">CHAPTERS / IN STUDY ORDER</div>
      <nav class="chapter-nav" aria-label="Chapters">${data.chapters
        .map((chapter) => {
          const p = progress(chapter);
          return `<a href="#phase/${chapter.id}" ${page.chapter?.id === chapter.id ? 'aria-current="page"' : ""}><span class="phase-number">${chapter.id.padStart(2, "0")}</span><span>${escapeHtml(chapter.shortTitle)}</span><span class="nav-count">${p.done}/${p.total}</span></a>`;
        })
        .join("")}</nav>
      <div class="sidebar-footer"><span class="mono">${done} / ${total} checkpoints</span><progress max="${total}" value="${done}" aria-label="Total checkpoints completed"></progress><button id="export-progress">Export notes</button><label class="import-label">Import notes<input id="import-progress" type="file" accept="application/json,.json"></label><p>Checkpoints come from LEARNING.md. Reload to refresh.</p>${snapshotStale ? "<p><strong>Offline snapshot.</strong> Run portal/serve.sh start for live progress.</p>" : ""}<p>Notes saved in this browser${memoryOnly ? " (unavailable)" : ""}.</p></div>
    </aside>
    <div class="workspace"><header class="topbar"><span class="mono">PERSONAL CURRICULUM</span><a class="resume-link" href="#phase/${currentChapter().id}">Resume phase ${currentChapter().id} →</a></header><main id="main" tabindex="-1">${page.type === "chapter" ? chapterPage(page.chapter) : page.type === "library" ? libraryPage() : page.type === "guide" ? guidePage() : homePage()}</main><footer class="page-footer"><span>Build first. Read what unblocks you.</span><span>Source: ROADMAP-BEGINNER.md / LEARNING.md / curated.json</span></footer></div>`;
  bindEvents(page);
  window.renderRoadmapDiagrams?.();
  document.title = `${page.chapter ? `Phase ${page.chapter.id}: ${page.chapter.shortTitle}` : page.type === "library" ? "Reference library" : "Systems roadmap"} / Altamash`;
}

function homePage() {
  const chapter = currentChapter();
  const p = progress(chapter);
  const nextCheck = chapter.checks.find(
    (_, index) => !chapter.done.includes(index),
  );
  return `<div class="eyebrow">C → HARDWARE → SYSTEMS → SHIPPED PROJECTS</div><h1>Your systems<br>curriculum.</h1><p class="lead">One roadmap. The references you need for the code you are building.</p>
  <section class="continue-card" aria-labelledby="continue-heading"><div><div class="eyebrow">${chapter.id === data.current ? "CURRENT CHECKPOINT / FROM LEARNING.MD" : "LAST OPENED CHAPTER"}</div><h2 id="continue-heading">${escapeHtml(chapter.shortTitle)}</h2><p>${escapeHtml(nextCheck || "All listed checkpoints complete. Review the core gate before moving on.")}</p><a class="button primary" href="#phase/${chapter.id}">Continue phase ${chapter.id} →</a></div><div class="checkpoint-meter"><span class="big-number">${String(p.done).padStart(2, "0")}<small> / ${String(p.total).padStart(2, "0")}</small></span><span class="mono">CHECKPOINTS COMPLETED</span><progress max="${p.total || 1}" value="${p.done}" aria-label="Current chapter progress"></progress><p>Completion means you built and tested it. Watching a lesson does not tick a checkpoint.</p></div></section>
  <div class="owned-row"><span class="mono">ALREADY AVAILABLE</span>${data.subscriptions.map((name) => `<span>${name}</span>`).join("")}</div>
  <section class="curriculum"><div class="section-heading"><h2>Chapter map</h2><span class="mono">${data.chapters.length} PHASES / PROJECT FIRST</span></div><p class="muted">Keep the listed order and one active build. New required extensions follow their prerequisites: LLVM and CHIP-8 after the VM, drivers and firmware after kernels, MiniTorch after CUDA and runtime work. Weeks are rough estimates at 12 h/week, not deadlines or a verified total duration.</p><div class="chapter-grid">${data.chapters
    .map((item) => {
      const value = progress(item);
      return `<a class="chapter-card" href="#phase/${item.id}"><div class="card-top"><span class="mono">PHASE ${item.id}</span><span class="mono muted">${escapeHtml(item.weeks)}</span></div><h3>${escapeHtml(item.shortTitle)}</h3><p>${escapeHtml(item.project)}</p><div class="card-bottom"><span>${value.done}/${value.total} checkpoints</span><span aria-hidden="true">↗</span></div><progress max="${value.total || 1}" value="${value.done}" aria-label="Phase ${item.id} progress"></progress></a>`;
    })
    .join("")}</div></section>
  <section class="rhythm"><h2>Your weekly split</h2><div class="rhythm-grid"><div><strong>65%</strong><span>Build with the debugger open</span></div><div><strong>20%</strong><span>Read the chapter you are stuck on</span></div><div><strong>15%</strong><span>Watch the relevant explanation</span></div></div><p>Sunday: write 200 words on what you built and what confused you.</p></section>`;
}

function chapterPage(chapter) {
  const index = data.chapters.indexOf(chapter);
  const p = progress(chapter);
  return `<div class="breadcrumb"><a href="#">Curriculum</a> / Phase ${chapter.id}</div><div class="eyebrow">PHASE ${chapter.id} / ${escapeHtml(chapter.weeks)} AT 12 H/WEEK</div><h1 class="chapter-title">${escapeHtml(chapter.shortTitle)}</h1><p class="lead">${escapeHtml(chapter.project)}</p><div class="chapter-meta"><span>${p.done}/${p.total} checkpoints complete</span><span>${chapter.units.length} study steps</span><span>${escapeHtml(chapter.environment || `Mac ARM64 + Linux VM${chapter.id === "8" ? " + NVIDIA laptop" : ""}`)}</span></div>
  <nav class="tabs" aria-label="Chapter sections">${[
    ["plan", "Study plan"],
    ["references", "Lookups"],
    ["source", "Original roadmap"],
    ["notes", "My notes"],
  ]
    .map(
      ([id, title]) =>
        `<button data-tab="${id}" ${activeTab === id ? 'aria-current="page"' : ""}>${title}</button>`,
    )
    .join("")}</nav>
  <div id="chapter-content">${chapterTab(chapter)}</div>
  <nav class="chapter-pager" aria-label="Study order">${index ? `<a href="#phase/${data.chapters[index - 1].id}">← ${escapeHtml(data.chapters[index - 1].shortTitle)}</a>` : "<span>Start of roadmap</span>"}${index < data.chapters.length - 1 ? `<a href="#phase/${data.chapters[index + 1].id}">${escapeHtml(data.chapters[index + 1].shortTitle)} →</a>` : '<a href="#">Back to overview →</a>'}</nav>`;
}

function chapterTab(chapter) {
  if (activeTab === "references")
    return `<h2>Look up when needed</h2><p class="muted">API contracts, test tools and narrow references. Assigned reading and visual companions live in the study plan, not another list here.</p>${chapter.lookups.length ? `${filterControls(chapter.lookups)}<div id="resource-results">${resourceResults(chapter)}</div>` : "<p>No separate lookups for this chapter. Use the resources beside each study step.</p>"}${selectionNotes(chapter)}`;
  if (activeTab === "source" && chapter.extension)
    return `<div class="source-note">Required extension from the breadth review. There is no older Markdown chapter for this build. Its selected sources, deliverables and mastery gate are in the Study plan; selection decisions are recorded in RESOURCE-REVIEW.md.</div>`;
  if (activeTab === "source")
    return `<div class="source-note">Archive, not another assignment. The original weeks, course lists and stretch goals are preserved here. Follow the curated study plan; open a section only when you need its explanation.</div><article class="prose">${chapter.introHtml}${chapter.sections.map((section) => `<details class="archive-section"><summary>${escapeHtml(section.title)}</summary>${section.html}</details>`).join("")}</article>`;
  if (activeTab === "notes")
    return `<h2>Sunday log / phase ${chapter.id}</h2><p class="muted">What did you build? What confused you? What will you verify next?</p><label class="sr-only" for="chapter-notes">Notes for phase ${chapter.id}</label><textarea id="chapter-notes" placeholder="This week I built…" rows="16">${escapeHtml(state.notes[chapter.id] || "")}</textarea><div class="note-footer"><span id="notes-status">Saved locally as you type.</span><span>Include notes in your progress export.</span></div>`;
  return `<section class="core-gate"><span class="mono">FIRST WORKING CHECKPOINT</span><p>${escapeHtml(chapter.core)}</p></section><p class="path-intro">${escapeHtml(chapter.rationale)}</p><p class="muted">Read the bounded section, build, then use the visual companion if you need the picture. Stop when the check passes.</p><div class="learning-path">${chapter.units.map((unit, index) => studyUnit(unit, index)).join("")}</div>
  ${selectionNotes(chapter)}
  <section><div class="section-heading"><h2>Completion checklist</h2><span class="mono">${progress(chapter).done}/${chapter.checks.length}</span></div><p class="muted">${chapter.tracked ? "Marked by your mentor in LEARNING.md. Reload the page to refresh." : chapter.extension || ["0", "13"].includes(chapter.id) ? "Curated project checkpoints based on this phase's goals." : "Full-track checklist from the roadmap. Some entries include stretch work; use the first working checkpoint above to decide when to move on."}</p><div class="checklist">${chapter.checks.map((check, index) => `<label><input type="checkbox" disabled ${chapter.done.includes(index) ? "checked" : ""}><span>${markdownInline(check)}</span></label>`).join("")}</div></section>`;
}

function studyUnit(unit, index) {
  return `<section class="study-unit"><div class="unit-heading"><span class="step-index">${String(index + 1).padStart(2, "0")}</span><div><h2>${escapeHtml(unit.title)}</h2><p>${escapeHtml(unit.outcome)}</p></div></div>${assignedResource(unit.read, "Read")}${unit.visual ? `<details class="visual-companion"><summary>Visual companion · ${escapeHtml(unit.visual.title)}</summary>${assignedResource(unit.visual, "Visualize")}</details>` : ""}<div class="unit-task"><span class="mono">BUILD / VERIFY</span><p>${escapeHtml(unit.build)}</p></div><div class="unit-stop"><span class="mono">MOVE ON WHEN</span><p>${escapeHtml(unit.stop)}</p></div></section>`;
}

function assignedResource(resource, role) {
  return `<div class="assigned-resource"><span class="mono">${role.toUpperCase()} / ${escapeHtml(resource.platform)}</span><a class="resource-title" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.title)} ↗</a><p class="resource-scope">${escapeHtml(resource.scope)}</p><p class="resource-reason">${escapeHtml(resource.why)}</p><small>${escapeHtml(resource.access)}</small></div>`;
}

function selectionNotes(chapter) {
  return `<details class="selection-notes"><summary>Resource choices: what to skip and why</summary><p>${escapeHtml(chapter.rationale)}</p><ul>${chapter.excluded.map((resource) => `<li><strong>${escapeHtml(resource.title)}:</strong> ${escapeHtml(resource.reason)}</li>`).join("")}</ul></details>`;
}

function markdownInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function resourceCard(resource) {
  return `<article class="resource-card"><div class="resource-meta"><span class="mono">${escapeHtml(resource.platform)}</span><span>${escapeHtml(resource.kind || "Lookup")}</span><span>${escapeHtml(resource.access)}</span></div><a class="resource-title" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.title)} <span aria-hidden="true">↗</span></a><p>${escapeHtml(resource.note || `${resource.scope} ${resource.why}`)}</p>${resource.evidence ? `<small>${escapeHtml(resource.evidence)}</small>` : ""}</article>`;
}

function filterControls(resources) {
  const platforms = [
    ...new Set(resources.map((resource) => resource.platform)),
  ].sort();
  return `<div class="filters"><label>Search references<input id="resource-search" type="search" placeholder="Pointers, paging, Lua…" value="${escapeHtml(searchQuery)}"></label><label>Platform<select id="platform-filter"><option>All platforms</option>${platforms.map((platform) => `<option ${platformFilter === platform ? "selected" : ""}>${escapeHtml(platform)}</option>`).join("")}</select></label></div>`;
}

function matchesResource(resource) {
  const query = searchQuery.toLowerCase().trim();
  return (
    (platformFilter === "All platforms" ||
      resource.platform === platformFilter) &&
    (!query ||
      `${resource.title} ${resource.note || ""} ${resource.scope || ""} ${resource.why || ""} ${resource.platform} ${resource.kind || "Lookup"}`
        .toLowerCase()
        .includes(query))
  );
}

function resourceResults(chapter) {
  const resources = chapter.lookups.filter(matchesResource);
  return resources.length
    ? `<p class="result-count mono">${resources.length} REFERENCES</p><div class="resource-list">${resources.map((resource) => resourceCard(resource)).join("")}</div>`
    : '<div class="empty-state"><h3>No references match.</h3><p>Try a shorter topic or choose All platforms.</p></div>';
}

function libraryPage() {
  const all = libraryResources();
  return `<div class="eyebrow">SELECTED MATERIAL / SEARCHABLE INDEX</div><h1>Reference library.</h1><p class="lead">Only the resources selected for your study path. Shared links appear once.</p><div class="source-note">This is a lookup index, not a reading queue. Open a phase for the order, exact scope and stop condition. Public content and syllabuses inform the choices; authenticated playback and subscription entitlement were not tested. Unselected links stay in the original archive or the chapter's skip notes, not this index.</div>${filterControls(all)}<div id="resource-results">${libraryResults()}</div>`;
}

function libraryResults() {
  const resources = libraryResources().filter(matchesResource);
  return resources.length
    ? `<p class="result-count mono">${resources.length} UNIQUE RESOURCES</p><div class="resource-list">${resources.map((resource) => `<div>${resourceCard(resource)}<div class="library-phases">${resource.chapters.map((chapter) => `<a href="#phase/${chapter.id}">Phase ${chapter.id}: ${escapeHtml(chapter.shortTitle)}</a>`).join("")}</div></div>`).join("")}</div>`
    : '<div class="empty-state"><h3>No references match.</h3><p>Try another topic or reset the platform filter.</p></div>';
}

function guidePage() {
  return `<div class="eyebrow">METHOD / SCOPE / SOURCES</div><h1>How to use this.</h1><div class="prose"><h2>Build the project, not a course backlog</h2><p>Each step has one bounded reading, an optional visual companion, a build task and a stop condition. Skip a companion when you can already pass the check. Lookups are for API contracts and tools, not another course queue. The Original roadmap tab is an archive with collapsed sections; its old week tables are not extra assignments.</p><h2>Required extensions</h2><p>The original chapter order stays intact. LLVM reuses your compiler concepts rather than repeating a full frontend course. CHIP-8 adds instruction timing and conformance tests. Linux drivers and MCU firmware extend the existing kernel and board work. MiniTorch connects tensors and autodiff to the CUDA kernels you already built. These are required builds, not optional course alternatives; the old total duration does not cover them.</p><h2>When you get stuck</h2><p>Attempt the deliverable before the next lesson. After 30–45 minutes stuck, consult its exact section. Ask AI for a diagnostic question, then one conceptual hint, bug localization, a violated invariant, and only then pseudocode. Request review after your attempt works. Add a test or feature the tutorial does not supply. Spend at least 65% of your time building and debugging.</p><h2>Your subscriptions</h2><p>Owning a course does not make it required. Master.dev and Educative are selected only where a specific lesson fills a gap. Computer Enhance remains the decoder/performance project companion. Overlapping Udemy and full-course alternatives are left out of the default path. Nothing here requires buying DragonZap. Some projects still need their stated hardware or toolchain; the new MCU extension has a simulator route.</p><h2>Progress and notes</h2><p>Checkpoints are marked by your mentor in LEARNING.md and are read-only here. Reload the page to see an update. Notes are stored in this browser. Export JSON for backup or moving to another browser. Import replaces your notes after confirmation. Run portal/serve.sh start for live progress; opening the file directly shows the last built snapshot.</p><h2>Links and offline use</h2><p>The portal, full chapter text and code work without a server or network. External resources still need internet; subscribed resources may require login. Fonts fall back to local system fonts offline. Exact lesson links are from public syllabuses or catalog tools, not guessed URLs. Older source links, version claims and fees from the roadmap have not all been rechecked.</p><h2>Diagrams</h2><p>Diagrams render locally, including when you open this file offline. Expand the source below a diagram to inspect its Mermaid definition.</p><h2>Current learning record</h2>${data.learningHtml}</div>${data.extras.map((extra) => `<details class="extra-source"><summary>${escapeHtml(extra.title)}</summary><article class="prose">${extra.html}</article></details>`).join("")}`;
}

function bindEvents(page) {
  document.getElementById("export-progress").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "systems-roadmap-progress.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Notes exported.");
  };
  document.getElementById("import-progress").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("File too large");
      const imported = JSON.parse(await file.text());
      if (!validProgress(imported)) throw new Error("Invalid progress format");
      if (!confirm("Replace this browser’s notes with this backup?")) return;
      state = keepBrowserState(imported);
      saveProgress();
      renderApp();
      notify("Notes imported.");
    } catch {
      notify(
        "Could not import. Choose a valid progress JSON exported by this portal.",
      );
    } finally {
      event.target.value = "";
    }
  };
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.onclick = () => {
      activeTab = button.dataset.tab;
      searchQuery = "";
      platformFilter = "All platforms";
      renderApp();
      document.getElementById("main").focus({ preventScroll: true });
    };
  });
  const notes = document.getElementById("chapter-notes");
  if (notes)
    notes.oninput = () => {
      state.notes[page.chapter.id] = notes.value;
      saveProgress();
      document.getElementById("notes-status").textContent = memoryOnly
        ? "Not saved to browser storage. Export before closing."
        : "Saved in this browser.";
    };
  const search = document.getElementById("resource-search");
  const filter = document.getElementById("platform-filter");
  const updateResults = () => {
    document.getElementById("resource-results").innerHTML =
      page.type === "library"
        ? libraryResults()
        : resourceResults(page.chapter);
  };
  if (search)
    search.oninput = () => {
      searchQuery = search.value;
      updateResults();
    };
  if (filter)
    filter.onchange = () => {
      platformFilter = filter.value;
      updateResults();
    };
}

document.querySelector(".skip-link").onclick = (event) => {
  event.preventDefault();
  const main = document.getElementById("main");
  main.focus();
  main.scrollIntoView();
};

window.addEventListener("hashchange", () => {
  activeTab = "plan";
  searchQuery = "";
  platformFilter = "All platforms";
  renderApp();
  window.scrollTo(0, 0);
  document.getElementById("main").focus({ preventScroll: true });
});
renderApp();
if (!snapshotStale) loadFreshData();

async function loadFreshData() {
  try {
    const response = await fetch("/data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    data = await response.json();
  } catch (error) {
    snapshotStale = true;
    notify(`Showing the offline snapshot. ${error.message}`);
  }
  renderApp();
}
