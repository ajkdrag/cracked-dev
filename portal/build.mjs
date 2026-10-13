import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { loadData } from "./data.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
// This file bakes an offline snapshot. server.mjs serves fresh data instead.
const data = loadData();
const { chapters } = data;
const css = fs.readFileSync(path.join(directory, "styles.css"), "utf8");
const js = fs.readFileSync(path.join(directory, "app.js"), "utf8");
// Bundle every diagram type so opening file:// never needs a CDN or local fetch.
const bundle = await build({
  entryPoints: [path.join(directory, "diagrams.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  minify: true,
});
const diagramRuntime = bundle.outputFiles[0].text.replace(
  /<\/script/gi,
  "<\\/script",
);
// Escape script delimiters because the entire portal must work from file://.
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Altamash / Systems roadmap</title><style>${css}</style></head>
<body><a class="skip-link" href="#main">Skip to content</a><div id="app"></div><div id="notice" role="status" aria-live="polite"></div><noscript>This portal needs JavaScript. The original roadmap remains in ROADMAP-BEGINNER.md.</noscript><script id="roadmap-data" type="application/json">${json}</script><script id="diagram-runtime">${diagramRuntime}</script><script>${js}</script></body></html>`;
fs.writeFileSync(path.join(directory, "index.html"), html);
fs.writeFileSync(
  path.join(directory, "content.json"),
  JSON.stringify(data, null, 2) + "\n",
);
console.log(
  `Built portal/index.html: ${chapters.length} phases, ${data.resourceCount} reference entries.`,
);
