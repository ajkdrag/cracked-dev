import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  look: "classic",
  fontFamily: "IBM Plex Mono, monospace",
  themeVariables: {
    primaryColor: "#ffffff",
    primaryTextColor: "#111111",
    primaryBorderColor: "#111111",
    lineColor: "#0000e6",
    secondaryColor: "#eeeeff",
    tertiaryColor: "#ffffff",
  },
  flowchart: { htmlLabels: false },
});

let diagramId = 0;

window.renderRoadmapDiagrams = async function renderRoadmapDiagrams() {
  for (const node of document.querySelectorAll(
    ".mermaid-diagram:not([data-rendered])",
  )) {
    // Closed archive/guide sections cannot supply useful layout dimensions.
    // Some browsers still return a client rect, so check their ancestors too.
    if (
      !node.isConnected ||
      node.closest("details:not([open])") ||
      !node.getClientRects().length
    )
      continue;
    node.dataset.rendered = "pending";
    const source = node.parentElement.querySelector("code").textContent;
    const id = `roadmap-diagram-${++diagramId}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (!node.isConnected) continue;
      node.innerHTML = svg;
      // Wide diagrams scroll on phones instead of shrinking labels into dots.
      const drawing = node.querySelector("svg");
      drawing.style.minWidth = `${Math.min(drawing.viewBox.baseVal.width, 900)}px`;
      node.dataset.rendered = "done";
    } catch (error) {
      document.getElementById(`d${id}`)?.remove();
      if (!node.isConnected) continue;
      node.textContent = "Could not render this diagram. See its source below.";
      node.dataset.rendered = "error";
      node.parentElement.querySelector("details").open = true;
      console.error("Roadmap diagram failed", source, error);
    }
  }
};

// The toggle event does not bubble; capture it for expandable guide sections.
document.addEventListener("toggle", () => window.renderRoadmapDiagrams(), true);
