# Learning: C foundations for game-dev and systems programming
Mode: mentor
Level: 1
Phase: 0b
Mine: src/** (files I write; everything else you may write)

## Style
- Uses straightforward loops with explicit `i` and `sz` bounds.
- Uses one translation unit and simple structs for grouped results.
- Uses integer averages and string verdicts for small exercises.

## Checklist
- [x] Set up the local C build loop and compile a warning-clean, sanitizer-enabled hello program (UBSan used; ASan hangs in current macOS setup)
- [x] Write small C programs using expressions, control flow, functions, arrays, and structs
- [x] Explain arrays, strings, pointers, and lifetimes with memory drawings (done as printed addresses and sizeof experiments in src/lifetimes.c, hand drawing skipped)
- [x] Implement `strlen`, bounded `strcpy`, in-place string reverse, and pointer-based `swap` (all in src/strings.c, tests mutation-checked)
- [x] Use `lldb`, Python Tutor, and raw memory dumps to verify pointer behavior (lldb on swap_ints and raw byte dump in src/dump.c: frames, memory read, endianness, struct padding; Python Tutor run on swap_ints, comparison not discussed)
- [ ] Build a linked list with explicit ownership and check it for leaks (ASan hangs on this Mac and has no leak detection on macOS, so slice 1 uses alloc/free counters; real ASan/LSan waits for the Linux VM; slice 1 done in src/list.c with tests/list_test.c: push_front, loop list_free, counters, failure injection; pop_front, remove by value, reverse left) <- current
- [ ] Build a growable array that handles empty input, removal, growth, and allocation failure
- [ ] Build a word counter, then match three C functions to ARM64 assembly

## Done phases
<!-- Portal format: `Phase: <id>` above names the phase under `## Checklist`.
Each finished or earlier phase gets a `### Phase <id>` block of `- [x]` / `- [ ]`
lines here. The portal reads this file on every page load, so edit it directly.
A listed phase replaces that chapter's curated checks. Phase ids must exist in
the roadmap. -->

### Phase 0
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
