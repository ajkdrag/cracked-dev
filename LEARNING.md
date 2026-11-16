# Learning: C foundations for game-dev and systems programming
Mode: mentor
Level: 1
Phase: 02
Mine: src/** (files I write; everything else you may write)

## Style
- Uses straightforward loops with explicit `i` and `sz` bounds.
- Uses one translation unit and simple structs for grouped results.
- Uses integer averages and string verdicts for small exercises.
- Walks lists with a `Node **` cursor, guard clauses first, locals named after the role (`first_item`, `to_remove`).
- Keeps dead alternatives as commented-out code (`list_pop_front_v2`).

## Checklist
- [x] Set up the local C build loop and compile a warning-clean, sanitizer-enabled hello program (UBSan used; ASan hangs in current macOS setup)
- [x] Write small C programs using expressions, control flow, functions, arrays, and structs
- [x] Explain arrays, strings, pointers, and lifetimes with memory drawings (done as printed addresses and sizeof experiments in src/lifetimes.c, hand drawing skipped)
- [x] Implement `strlen`, bounded `strcpy`, in-place string reverse, and pointer-based `swap` (all in src/strings.c, tests mutation-checked)
- [x] Use `lldb`, Python Tutor, and raw memory dumps to verify pointer behavior (lldb on swap_ints and raw byte dump in src/dump.c: frames, memory read, endianness, struct padding; Python Tutor run on swap_ints, comparison not discussed)
- [x] Build a linked list with explicit ownership and check it for leaks (ASan hangs on this Mac and has no leak detection on macOS, so slice 1 uses alloc/free counters; real ASan/LSan waits for the Linux VM; slice 1 done in src/list.c with tests/list_test.c: push_front, loop list_free, counters, failure injection; slice 2 done: pop_front, remove_first via Node ** cursor, 0 failures; slice 3 done: list_reverse (iterative, no alloc/free) + oracle test tests/list_reverse_oracle_test.c, both mutants caught; real LSan still waits for the Linux VM)
- [x] Build a growable array that handles empty input, removal, growth, and allocation failure (src/vec.c with tests/vec_test.c: counted_realloc failure injection by call number, keep old block on failed realloc, overflow guard, sizeof *v->data; 0 failures, 3 mutants caught)
- [ ] Build a word counter, then match three C functions to ARM64 assembly <- current

## Done phases
<!-- Portal format: `Phase: <id>` above names the chapter under `## Checklist`.
Other chapters get a `### Phase <id>` block of `- [x]` / `- [ ]` lines here.
Ids are the chapter numbers in curriculum/ (01, 02, ...). The portal reads
this file on every page load, so edit it directly. -->

### Phase 01
- [x] Compile a warning-clean hello program on the Mac
- [ ] Compile and run the same program in the Linux VM
- [ ] Explain working directory, stdout, stderr and exit status

## Quiz log

## Handoff

## Journal

## Ground-truth tools
- `clang -Wall -Wextra -g -fsanitize=address,undefined`
- `lldb` for stepping, stack traces, variables, raw memory, and disassembly
- Python Tutor for C for visual pointer and lifetime checks
- Compiler Explorer for C-to-assembly comparisons
