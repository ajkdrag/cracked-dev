import test from "node:test";
import assert from "node:assert/strict";
import { searchBook } from "../search.mjs";

const book = {
  chapters: [
    {
      id: "02",
      title: "C foundations",
      part: "The machine and C",
      project: "A linked list.",
      opening: "You will meet pointers here.",
      closing: "Next comes hardware.",
      steps: [
        {
          number: 1,
          title: "Pointers and addresses",
          bridge: "A pointer holds an address.",
          build: "Implement swap.",
          doneWhen: "The test passes.",
          resources: [
            {
              title: "Beej: Pointers",
              url: "https://beej.us/guide/bgc/html/split/pointers.html",
              kind: "read",
              time: "40 min",
              scope: "Sections 5.1 to 5.5.",
            },
          ],
        },
      ],
    },
  ],
};

test("a keyword finds the step, the resource and the chapter that mention it", () => {
  const hits = searchBook(book, "pointers");

  assert.deepEqual(
    hits.map((hit) => hit.kind),
    ["step", "resource", "chapter"],
  );
  assert.equal(hits[0].href, "/chapter/02#step-1");
  assert.equal(
    hits[1].externalUrl,
    "https://beej.us/guide/bgc/html/split/pointers.html",
  );
});

test("every word of the query has to match", () => {
  assert.equal(searchBook(book, "pointers swap").length, 1);
  assert.equal(searchBook(book, "pointers llvm").length, 0);
});

test("a resource is found by its site name", () => {
  const hits = searchBook(book, "beej.us");

  assert.equal(hits[0].kind, "resource");
});
