import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const script = fs
  .readFileSync(new URL("../diagrams.js", import.meta.url), "utf8")
  .replace('import mermaid from "mermaid";', "");

function diagramContext({ closed = false, fail = false } = {}) {
  let renders = 0;
  const details = { open: false };
  const drawing = { style: {}, viewBox: { baseVal: { width: 1300 } } };
  const node = {
    isConnected: true,
    dataset: {},
    innerHTML: "",
    closest: () => (closed ? details : null),
    getClientRects: () => [{}],
    querySelector: () => drawing,
    parentElement: {
      querySelector: (selector) =>
        selector === "code" ? { textContent: "flowchart LR\nA-->B" } : details,
    },
  };
  const window = {};
  vm.runInNewContext(script, {
    window,
    document: {
      querySelectorAll: () => (node.dataset.rendered ? [] : [node]),
      getElementById: () => null,
      addEventListener() {},
    },
    console: { error() {} },
    mermaid: {
      initialize() {},
      async render() {
        renders += 1;
        if (fail) throw new Error("Invalid diagram");
        return { svg: "<svg></svg>" };
      },
    },
  });
  return {
    window,
    node,
    details,
    drawing,
    renders: () => renders,
    openArchive: () => {
      closed = false;
    },
  };
}

test("closed archive sections defer diagrams even when the browser returns a rectangle", async () => {
  const context = diagramContext({ closed: true });
  await context.window.renderRoadmapDiagrams();
  assert.equal(context.renders(), 0);
  assert.equal(context.node.dataset.rendered, undefined);
  context.openArchive();
  await context.window.renderRoadmapDiagrams();
  assert.equal(context.renders(), 1);
  assert.equal(context.node.dataset.rendered, "done");
  assert.equal(context.drawing.style.minWidth, "900px");
  await context.window.renderRoadmapDiagrams();
  assert.equal(context.renders(), 1);
});

test("a parse failure opens readable source instead of leaving a loading placeholder", async () => {
  const context = diagramContext({ fail: true });
  await context.window.renderRoadmapDiagrams();
  assert.equal(context.node.dataset.rendered, "error");
  assert.equal(context.details.open, true);
  assert.match(context.node.textContent, /source below/);
});

test("detached chapter diagrams are not rendered", async () => {
  const context = diagramContext();
  context.node.isConnected = false;
  await context.window.renderRoadmapDiagrams();
  assert.equal(context.renders(), 0);
});
