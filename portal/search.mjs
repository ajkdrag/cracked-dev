// Keyword search over chapters, steps and resources. Every word of the query
// must appear in a hit. A word found in the title counts more than one found
// in the body.
const titleWeight = 10;
const kindWeight = { chapter: 3, step: 2, resource: 1 };
const snippetRadius = 70;
const maximumHits = 40;

export function searchBook(book, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return searchableEntries(book)
    .map((entry) => ({ entry, score: scoreEntry(entry, words) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maximumHits)
    .map(({ entry }) => ({
      kind: entry.kind,
      chapterId: entry.chapterId,
      title: entry.title,
      context: entry.context,
      href: entry.href,
      externalUrl: entry.externalUrl,
      snippet: snippetAround(entry.body, words),
    }));
}

function searchableEntries(book) {
  return book.chapters.flatMap((chapter) => [
    {
      kind: "chapter",
      chapterId: chapter.id,
      title: chapter.title,
      context: chapter.part,
      body: plainText(
        `${chapter.project} ${chapter.opening} ${chapter.closing}`,
      ),
      href: `/chapter/${chapter.id}`,
    },
    ...chapter.steps.flatMap((step) => [
      {
        kind: "step",
        chapterId: chapter.id,
        title: step.title,
        context: `${chapter.title}, step ${step.number}`,
        body: plainText(`${step.bridge} ${step.build} ${step.doneWhen}`),
        href: `/chapter/${chapter.id}#step-${step.number}`,
      },
      ...step.resources.map((resource) => ({
        kind: "resource",
        chapterId: chapter.id,
        title: resource.title,
        context: `${resource.kind}, ${chapter.title}, step ${step.number}`,
        body: plainText(`${resource.scope} ${new URL(resource.url).hostname}`),
        href: `/chapter/${chapter.id}#step-${step.number}`,
        externalUrl: resource.url,
      })),
    ]),
  ]);
}

function scoreEntry(entry, words) {
  const title = entry.title.toLowerCase();
  const body = entry.body.toLowerCase();
  let score = kindWeight[entry.kind];
  for (const word of words) {
    if (title.includes(word)) score += titleWeight;
    else if (body.includes(word)) score += 1;
    else return 0;
  }
  return score;
}

function snippetAround(body, words) {
  const lowered = body.toLowerCase();
  const positions = words
    .map((word) => lowered.indexOf(word))
    .filter((position) => position >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, center - snippetRadius);
  const end = Math.min(body.length, center + snippetRadius * 2);
  return (
    (start > 0 ? "..." : "") +
    body.slice(start, end).trim() +
    (end < body.length ? "..." : "")
  );
}

function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
