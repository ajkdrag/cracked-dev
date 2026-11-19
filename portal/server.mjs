// Serves the book as plain HTML. Chapters and progress are re-read on every
// request, so reload the page to see an edit.
import http from "node:http";
import fs from "node:fs";
import { BookError, loadBook } from "./book.mjs";
import { searchableEntries } from "./search.mjs";
import { chapterPage, homePage, messagePage } from "./pages.mjs";
import { staticFiles } from "./assets.mjs";

const port = Number(process.env.PORT || 8913);

function send(response, status, type, body) {
  response.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function handleRequest(request, response) {
  const { pathname } = new URL(request.url, "http://localhost");
  if (staticFiles[pathname]) {
    const [file, type] = staticFiles[pathname];
    return send(
      response,
      200,
      type,
      fs.readFileSync(new URL(file, import.meta.url)),
    );
  }

  const book = loadBook();
  if (pathname === "/") return send(response, 200, "text/html", homePage(book));
  if (pathname === "/search-index.json")
    return send(
      response,
      200,
      "application/json",
      JSON.stringify(searchableEntries(book)),
    );
  const chapter = book.chapters.find(
    (candidate) => pathname === `/chapter/${candidate.id}`,
  );
  if (chapter)
    return send(response, 200, "text/html", chapterPage(book, chapter));
  send(
    response,
    404,
    "text/html",
    messagePage(book, "Not found", `No page at ${pathname}`),
  );
}

const server = http.createServer((request, response) => {
  try {
    handleRequest(request, response);
  } catch (error) {
    if (!(error instanceof BookError)) throw error;
    send(
      response,
      500,
      "text/html",
      messagePage(null, "The book did not load", error.message),
    );
  }
});

// Loopback only: this server has no auth.
server.listen(port, "127.0.0.1", () =>
  console.log(`Portal on http://localhost:${port}`),
);
