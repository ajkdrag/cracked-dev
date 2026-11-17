// Search dialog keys and the step highlight in the right rail. htmx swaps the
// whole body on navigation, so every listener sits on document.
function searchModal() {
  return document.getElementById("search-modal");
}

function searchHits() {
  return [...document.querySelectorAll("[data-search-hit]")];
}

function openSearch() {
  searchModal().classList.add("is-active");
  const input = document.getElementById("search-input");
  input.focus();
  input.select();
}

function closeSearch() {
  searchModal().classList.remove("is-active");
}

function moveActiveHit(offset) {
  const hits = searchHits();
  if (hits.length === 0) return;
  const current = hits.findIndex((hit) => hit.classList.contains("is-active"));
  const next = Math.min(hits.length - 1, Math.max(0, current + offset));
  hits[current]?.classList.remove("is-active");
  hits[next].classList.add("is-active");
  hits[next].scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown", (event) => {
  const searchIsOpen = searchModal().classList.contains("is-active");
  if ((event.metaKey || event.ctrlKey) && event.key === "k") {
    event.preventDefault();
    return searchIsOpen ? closeSearch() : openSearch();
  }
  if (!searchIsOpen) return;
  if (event.key === "Escape") closeSearch();
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveActiveHit(event.key === "ArrowDown" ? 1 : -1);
  }
  if (event.key === "Enter")
    document.querySelector("[data-search-hit].is-active")?.click();
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-cycle-theme]")) cycleTheme();
  if (event.target.closest("[data-open-search]")) openSearch();
  if (event.target.closest("[data-close-search]")) closeSearch();
  // A hit inside the open chapter only changes the hash, so nothing swaps
  // the dialog away.
  if (event.target.closest("[data-search-hit]")) closeSearch();
});

document.addEventListener("htmx:afterSwap", (event) => {
  if (event.target.id === "search-results")
    searchHits()[0]?.classList.add("is-active");
});

let stepObserver;

function highlightVisibleStep() {
  stepObserver?.disconnect();
  const links = [...document.querySelectorAll("[data-step-link]")];
  stepObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links)
          link.classList.toggle(
            "is-active",
            link.getAttribute("href") === `#${entry.target.id}`,
          );
      }
    },
    { rootMargin: "-10% 0px -70% 0px" },
  );
  for (const section of document.querySelectorAll(".step, .closing"))
    stepObserver.observe(section);
}

highlightVisibleStep();
document.addEventListener("htmx:afterSettle", (event) => {
  if (event.target === document.body) highlightVisibleStep();
});

showThemeName();
document.addEventListener("htmx:afterSettle", (event) => {
  if (event.target === document.body) showThemeName();
});
