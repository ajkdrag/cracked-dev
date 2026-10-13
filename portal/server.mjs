// Serves the built page and fresh data. Progress lives in ../LEARNING.md and is
// re-read on every /data.json request, so reload the page to see an update.
import http from "node:http";
import fs from "node:fs";
import { loadData } from "./data.mjs";

const port = Number(process.env.PORT || 8913);
const indexPath = new URL("./index.html", import.meta.url);

function sendText(response, status, type, body) {
  response.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  if (pathname === "/data.json") {
    try {
      return sendText(
        response,
        200,
        "application/json",
        JSON.stringify(loadData()),
      );
    } catch (error) {
      return sendText(response, 500, "text/plain", error.message);
    }
  }
  if (pathname === "/" || pathname === "/index.html")
    return sendText(response, 200, "text/html", fs.readFileSync(indexPath));
  sendText(response, 404, "text/plain", "Not found");
});

// Loopback only: this server reads personal notes and has no auth.
server.listen(port, "127.0.0.1", () =>
  console.log(`Portal on http://localhost:${port}`),
);
