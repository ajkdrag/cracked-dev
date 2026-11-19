// Writes the book as static files for GitHub Pages.
// usage: BASE_PATH=/cracked-dev node build-site.mjs [output directory]
import fs from "node:fs";
import path from "node:path";
import { loadBook } from "./book.mjs";
import { searchableEntries } from "./search.mjs";
import { chapterPage, homePage, messagePage } from "./pages.mjs";
import { staticFiles } from "./assets.mjs";

const basePath = process.env.BASE_PATH ?? "";
const outputDirectory = path.resolve(process.argv[2] ?? "site");

function writeFile(urlPath, content) {
  const file = path.join(outputDirectory, urlPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// The pages link to /chapter/02 and /static/portal.css. GitHub Pages serves
// the site under /<repository name>, so every such URL gets that prefix.
function writePage(urlPath, html) {
  writeFile(urlPath, html.replace(/(href|src)="\//g, `$1="${basePath}/`));
}

const book = loadBook();
fs.rmSync(outputDirectory, { recursive: true, force: true });
writePage("index.html", homePage(book));
for (const chapter of book.chapters)
  writePage(`chapter/${chapter.id}/index.html`, chapterPage(book, chapter));
writePage(
  "404.html",
  messagePage(book, "Not found", "No page at this address."),
);
writeFile("search-index.json", JSON.stringify(searchableEntries(book)));
for (const [urlPath, [file]] of Object.entries(staticFiles))
  writeFile(urlPath, fs.readFileSync(new URL(file, import.meta.url)));
// Without this file GitHub Pages runs the site through Jekyll.
writeFile(".nojekyll", "");

console.log(`${book.chapters.length} chapters written to ${outputDirectory}`);
