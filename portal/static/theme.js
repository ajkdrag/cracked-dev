// Loaded in the head without defer, so the saved theme applies before the
// first paint. "system" follows the operating system setting.
const themes = ["system", "light", "dark"];

function savedTheme() {
  return localStorage.getItem("theme") ?? "system";
}

function applyTheme(theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function showThemeName() {
  document.querySelector("[data-cycle-theme]").textContent = savedTheme();
}

function cycleTheme() {
  const next = themes[(themes.indexOf(savedTheme()) + 1) % themes.length];
  localStorage.setItem("theme", next);
  applyTheme(next);
  showThemeName();
}

applyTheme(savedTheme());
