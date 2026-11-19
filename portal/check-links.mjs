// Fetches every resource URL in the book and lists the ones that do not answer
// with a success status. Run it now and then, because links rot.
import { loadBook } from "./book.mjs";

const concurrentRequests = 8;
const timeoutMilliseconds = 20000;
const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,*/*",
};

const resources = loadBook().chapters.flatMap((chapter) =>
  chapter.steps.flatMap((step) =>
    step.resources.map((resource) => ({
      url: resource.url,
      place: `chapter ${chapter.id}, step ${step.number}`,
    })),
  ),
);

async function fetchStatus(url) {
  try {
    const response = await fetch(url, {
      headers: browserHeaders,
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    return response.ok ? "ok" : `HTTP ${response.status}`;
  } catch (error) {
    return error.cause?.code ?? error.name;
  }
}

const failures = [];
const queue = [...resources];
async function worker() {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const status = await fetchStatus(next.url);
    if (status !== "ok") failures.push({ ...next, status });
  }
}
await Promise.all(Array.from({ length: concurrentRequests }, worker));

for (const { place, url, status } of failures)
  console.log(`${status}\t${place}\t${url}`);
console.log(
  `${resources.length} links checked, ${failures.length} did not answer ok.`,
);
process.exitCode = failures.length ? 1 : 0;
