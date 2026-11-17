# cracked-dev portal

A local reader for the book in `../curriculum`.

```sh
npm install          # once
./serve.sh start     # http://localhost:8913, runs in the background
./serve.sh stop
./serve.sh status    # PORT=9000 ./serve.sh start to change the port
```

Press `Cmd+K` (or `Ctrl+K`) to search chapters, steps and resources. Arrow keys move, Enter opens, Esc closes.

## How it fits together

```text
../curriculum/NN-name.md   one chapter per file, read in order
../LEARNING.md             progress, edited by the mentor
book.mjs                   parses both into the book
search.mjs                 keyword search over the book
pages.mjs                  HTML for the pages and the search results
server.mjs                 routes
static/                    portal.css, portal.js and theme.js
check-links.mjs            fetches every resource URL and lists dead ones
tests/                     parser, search and book checks
```

The server renders plain HTML. htmx swaps pages without a full reload and Bulma supplies the base styles. The word next to the title in the sidebar switches the theme between system, light and dark.

The server reads the chapter files and `LEARNING.md` on every request. Reload the page after an edit.

## Chapter format

```markdown
---
id: 02
title: C foundations
part: The machine and C
weeks: 3
project: A linked list, a growable array and a word counter in C.
---

Opening prose: where you are coming from and what this chapter builds.

## Step title

Bridge prose for the step.

### Study

- [Title](https://example.com/page) (read, 40 min): Which sections to read and what to skip.

### Build

What to write.

### Done when

A check you can run yourself.

## Where this leads

How the next chapter picks up.
```

- Every `##` section is a step, except the last one, which is always `## Where this leads`.
- A step has `### Study`, `### Build` and `### Done when`, in that order.
- A study line is `- [Title](url) (kind, time): scope`. The kind is `read`, `watch`, `do` or `reference`.
- A step has at most three study lines.
- Chapters with the same `part` are grouped together in the sidebar.

A file that breaks the format makes every page show the parser's message, with the file and the step named.

## Progress

`LEARNING.md` calls a chapter a phase. The `Phase:` line names the chapter whose items sit under `## Checklist`. Other chapters get a `### Phase <id>` block under `## Done phases`. Ids are the chapter numbers (`01`, `02`, ...). The portal only displays the checklists.

## Checks

```sh
npm test               # parser, search, and rules for the real book
npm run check-links    # needs internet
npm run format
```

`npm test` fails when a chapter breaks the format, a step has more than three study lines, a link points at a banned site, or the same material is assigned twice.
