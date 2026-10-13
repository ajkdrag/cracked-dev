# Systems roadmap portal

```sh
./serve.sh start     # http://localhost:8913, runs in the background
./serve.sh stop
./serve.sh status    # PORT=9000 ./serve.sh start to change the port
```

Open the URL, then reload the page after a progress update. Opening `index.html` from disk still works for reading, but it shows the last built snapshot and no live progress. The notes you saved under `file://` do not carry over to `localhost`, so export them first and import them there.

## Follow the study path

Each chapter has ordered steps:

```text
read the named section -> build the small deliverable -> pass the check
                          |
                          +-> open the visual companion if you need the picture
```

- Study plan: one bounded reading per step, optional visual context, build task and stop condition. No separate course queue or repeated week table.
- Lookups: API contracts, tools and narrow repair references. Assigned material stays beside its step.
- Original roadmap: archived explanations, diagrams, week tables and stretch goals. Sections start collapsed. This is not a second assignment list.
- My notes: a local Sunday log for each phase.
- Reference library: search only the selected resources. Shared URLs appear once, with links to their phases.

Checkpoint ticks come only from `../LEARNING.md`, which your mentor edits. The portal cannot change them. Notes stay in this browser. Export notes to back them up; import replaces them after confirmation.

The server re-reads `LEARNING.md` on every page load, so reload to see an update. The `Phase:` line names the phase under `## Checklist`, and `## Done phases` holds a `### Phase <id>` block per other phase. A listed phase replaces that chapter's curated checklist, so adding an item to the file adds it to the portal. An unknown phase id or a missing `Phase:` line makes the server answer 500, and the page falls back to the last built snapshot with a notice. Opening `index.html` straight from disk also shows that snapshot, marked "Offline snapshot".

## Required breadth extensions

The original order and IDs stay intact. Five new chapters have their own build tasks and mastery gates:

| After            | Extension              | Main sources                                                               |
| ---------------- | ---------------------- | -------------------------------------------------------------------------- |
| 9, bytecode VM   | 9b, LLVM backend       | Official Kaleidoscope chapters 3–5 and 8                                   |
| 9b               | 9c, CHIP-8             | Langhoff's machine guide and Timendus ROM tests                            |
| 11, kernel       | 11b, Linux drivers     | Linux Kernel Labs: character device, IRQ, deferred work and mapping        |
| 11b              | 11c, embedded firmware | Arm Education, RP2040/RP2350 datasheets and Wokwi's compiled Pico scaffold |
| 13, contribution | 14, MiniTorch          | Modules 1–4, then one original differentiable operation                    |

The existing OS chapter also includes the pinned xv6 traps/mmap labs; a small xv6 scheduling experiment follows the user-space queue in phase 6. Dive Into Systems replaces the old x86 reading. CMU allocator/cache specifications are lookups for the existing builds, not additional projects. Handmade Hero day 034 adds a five-minute arena walkthrough.

The portal now has 21 chapters. The pasted 70–72-week estimate describes a different path and is not a promise for this expanded one. Keep one active build and move on at the mastery gate. The new firmware chapter can use simulation; the original RP2350 no-SDK board exercise remains a separate hardware checkpoint.

## Resource selection

Prefer written explanations. A companion must add a diagram, live debugging, an interactive view or a specific tool demonstration. Owning a subscription does not make a course required. The path selects targeted Master.dev and Educative lessons, but leaves overlapping Udemy courses out rather than filling every chapter with alternatives.

`RESOURCE-REVIEW.md` records the main choices and verification limits. Each chapter also has a collapsed explanation of what to skip and why. `curated.json` contains the selected scopes, build tasks and stop conditions. Original roadmap links are preserved only in the archive, not silently merged into the active library.

Public pages, chapter contents and syllabus metadata informed the choices. Authenticated playback, your subscription entitlements and interactive exercises were not tested. Some blocked pages were checked through their official indexes or public search. Course-index links are labeled as indexes, not invented lesson links. Older claims and links in the original archive have not all been rechecked.

The page uses the Marp skill's house style: Archivo, IBM Plex Mono, white paper, black ink, blue links and square borders. It is an SPA, not a Marp slide deck. Fonts use Google Fonts when online and local fallback fonts offline. Mermaid is bundled into the HTML so diagrams render without a CDN. External readings, tools and videos still need internet.

## Edit and rebuild

Requires Node 20 or newer.

```sh
cd portal
npm ci
npm run format
npm run build   # only for code, curated.json or roadmap changes you want in the offline snapshot
npm run check
npm test
npm run format:check
```

`build.mjs` imports the original roadmap and learning record, inserts curated extension chapters after their named prerequisites, combines them with curated study units, and embeds CSS, JavaScript and content into `index.html`. Rebuild after changing an input. `content.json` is a generated readable export, not a browser runtime dependency.

```text
../ROADMAP-BEGINNER.md   original full curriculum, unchanged
../LEARNING.md           initial learning record, unchanged
curated.json             selected steps, scopes and resource decisions
RESOURCE-REVIEW.md       selection rationale and verification limits
build.mjs                Markdown import and standalone HTML build
app.js                   navigation, study path, search, progress and backups
diagrams.js              local Mermaid rendering
styles.css               house-theme adaptation and responsive layout
index.html               ready-to-open portal
content.json             generated content export
tests/                   build/content and app regression tests
```

There is no app framework or backend. Mermaid renders diagrams in the browser; esbuild bundles it at build time. Marked renders trusted local Markdown at build time. Do not publish untrusted Markdown with this build script without adding sanitization.
