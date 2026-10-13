# Resource selection review

The previous portal combined curated courses, imported links and original week tables. That made alternate explanations look like additional assignments. This revision assigns one reading per study step and keeps visual companions optional. The original projects and checklist indices stay intact.

## Breadth integration

The additional curriculum supplies new implementation targets, not another required resource list. The user chose required extensions while preserving the existing order. The original Markdown and learning record remain unchanged; `curated.json` holds the new curriculum.

| Addition              | Placement and boundary                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLVM Kaleidoscope     | 9b after clox. Small numeric AST, IR, JIT and object emission. clox compiles directly to bytecode and has no reusable AST. Reuse token/precedence tests, not an imaginary intermediate representation. Learn C++ unique ownership only at this boundary.                                                |
| Langhoff + Timendus   | 9c after LLVM. A separate CHIP-8 machine with conformance tests, independent 60 Hz timers and a single-step debugger. Logo ROMs establish a small drawing/opcode subset, not keypad or timer correctness.                                                                                               |
| Linux Kernel Labs     | 11b after the Rust kernel. Validate the supplied QEMU x86 target first, then character-device, IRQ, workqueue and mapping contracts. No second RISC-V/C kernel. The public setup includes a 32-bit x86 example; record actual guest bitness rather than assuming x86-64.                                |
| Arm Education + Wokwi | 11c after drivers. One compiled RP2040 GPIO/timer/UART/ring-buffer firmware and a port map to the existing RP2350 exercise. Arm's second-edition STM32 examples are concept material, not Pico register instructions.                                                                                   |
| MiniTorch             | 14 after contribution work, with phase 8 GPU and phase 9 runtime prerequisites. Modules 1–4 plus an original operation and numerical gradient tests. Its Python/Numba GPU path is separate from the native CUDA library. CUDA tests on an NVIDIA device are required, not replaced by CPU-only success. |

The OS path gains the pinned xv6 traps/mmap exercises. The scheduling experiment follows the user-space queue, so kernel policy work does not become an excuse to skip synchronization. Their checks are appended; old checklist indices and notes remain stable. New chapters get empty checklists when older browser saves or exports are loaded.

### Replacements and narrow lookups

- Dive Into Systems replaces the older UNLV x86 PDF for the existing ABI exercise. Read common instructions and function calls, not all sections 7.1–7.9.
- Dive Into Systems GDB is a Linux tool lookup; native Mac work still uses LLDB. No second C syntax pass.
- Its Cachegrind section explains an instrument. Simulated cache counts do not establish native Apple Silicon timing.
- CMU Cache/Malloc Lab specifications supply repair exercises and test ideas. Keep the existing cache probes and mmap-backed allocator, rather than assigning duplicate builds or mixing the Malloc Lab memlib scaffold into the allocator silently.
- Handmade Hero day 034, 49:50–54:58, shows arena initialization and allocation. The title is Tile Map Memory. Do not assign the entire episode or advanced dynamic-arena follow-ons.
- Rustlings, TinyRenderer and full COMP4300 stay out of the assigned path: the existing Rust port, rasterizer and shipped games already cover their main outcomes.
- The additional GPU MODE episodes stay out where they repeat the existing CUDA contracts, reduction and matmul. The selected performance-checklist video remains optional.
- OSDev's RISC-V bootstrap does not replace or get mixed into the pinned x86 Rust boot contract. Existing xv6 already supplies RISC-V kernel experience.

### Verification and environment limits

Three GPT-6 Luna workers independently researched language/ML extensions, driver/MCU extensions and overlap choices. Parent review corrected the nonexistent clox AST, the logo-ROM input claim, driver setup order/bitness, optional-versus-required wording and overly broad chapter scopes. An independent reviewer checked the integrated path.

Official LLVM chapter 3, 4, 5 and 8 pages, MiniTorch module assignments, Timendus README, MIT Fall 2025 traps/mmap instructions, Linux Kernel Labs introduction/deferred-work instructions, Arm Education's repository and Wokwi's Pico model documentation were inspected. The pasted verification date is not evidence for every original link. No toolchain, driver VM, physical firmware, ROM suite or MiniTorch training run was executed during resource selection.

Wokwi's published feature table models one RP2040 core, UART, I2C/SPI master and timers. DMA is PIO-only. Its Pico is not RP2350/Pico 2. The selected public C++ SDK scaffold avoids accidentally assigning a MicroPython project; keep the firmware logic C-compatible. The new simulated chapter does not require buying hardware, but it does not mark the original no-SDK RP2350 board checkpoint complete.

Linux lab pages follow a moving `master` branch and contain historical kernel interfaces. Pin a matching lab/kernel revision when starting; arbitrary current distribution headers are not a substitute. Use the existing x86 laptop for the supplied QEMU path; Apple Silicon requires deliberate x86 emulation/cross-building. Public page checks do not establish that the user's present machine is already configured.

No broad C, C++, Rust, GPU or ML course was added. The old calendar total does not describe this expanded path.

## Earlier selection decisions

| Phase | Main choice                                                                                                                                                    | What stays out of the default path                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0     | Verify only a missing Linux guest. Local C setup is already recorded.                                                                                          | Reinstalling tools and repeating mindset talks.                                                       |
| 0b    | Exact Beej pointer/string/allocation/I/O chapters. One Educative dynamic-array lesson. Python Tutor and two Master.dev lessons supply targeted visual context. | Full CS50, K&R, Master.dev and multiple Udemy pointer courses in parallel.                            |
| 1     | Nand2Tetris Part I project specifications and tests. One optional Ben Eater ALU demonstration.                                                                 | Part II and a second breadboard CPU build.                                                            |
| 2     | Selected Modern C object rules, Data Lab, arena lifetime article and JSON grammar.                                                                             | A second advanced-C course or a general-purpose library project.                                      |
| 3     | Native ARM64 examples, Dive Into Systems for a bounded x86 comparison, linking and the official Computer Enhance 8086 listings.                                | Additional assembly 101 or security courses. The original Bomb/Attack Lab exercises stay.             |
| 4     | Exact Algorithmica measurement/cache/branch/layout/SIMD chapters. Computer Enhance demonstrations support the same probes.                                     | MIT and conference-talk queues on top of the same performance project.                                |
| 5     | OSTEP mechanisms, pinned xv6 syscall/traps/paging/COW/fs/mmap contracts, allocator and bounded event-loop work.                                                | Educative OS lessons and a full Udemy OS course covering overlapping topics.                          |
| 6     | Pthread API/predicate-loop text, Bos for coherence/ordering and a staged queue/job system.                                                                     | Rust fluency as a prerequisite, custom futex work first and premature lock-free MPMC.                 |
| 7     | Rust ownership, errors, lifetimes and narrow unsafe boundaries at the point of use.                                                                            | Several Rust books/exercise tracks before porting known C behavior.                                   |
| 8     | CUDA contracts, reduction, Boehm kernels 1–3 and specific profiling videos.                                                                                    | PMPP, a full Udemy CUDA course and the entire GPU MODE playlist together.                             |
| 9     | Crafting Interpreters Part III, then a small protected Lua host.                                                                                               | A C compiler course, JavaScript compiler/formatter course and Java tree-walker implementation.        |
| 10    | SDL3 contracts, scalar rasterization and selected Handmade Hero demonstrations. Ray Tracing book 1 remains a distinct project.                                 | Days 1–60 as mandatory viewing, extra ray-tracing books and a separate graphics API curriculum.       |
| 10b   | Fixed-step simulation, GPU resource contracts, the systems needed by game 1, then a tightly scoped game 2.                                                     | A general engine before shipping, another game-loop lesson and broad physics/rendering prerequisites. |
| 11    | One Rust kernel boot contract, interrupt/memory/task sequence and a separate Pico exercise.                                                                    | Mixing tutorial boot paths or replacing the bootloader before the kernel works.                       |
| 12    | Selected CMU notes, simple WAL lifecycle and fault tests; raw packet contracts and isolated TCP.                                                               | The full CMU/BusTub project sequence plus a second database course.                                   |
| 13    | One small language port and one pinned real-code operation.                                                                                                    | C++, Zig and Odin as three full prerequisite courses.                                                 |

A lookup is not an assignment. A specification or testing tool earns a separate link when it defines a contract or supplies an independent check. A second explanation of the same concept does not.

## Handmade Hero selections

These are individual topic pages, not a playlist assignment:

- [Day 003: Allocating a Back Buffer](https://guide.handmadehero.org/code/day003/): see the buffer and presentation boundary while building the SDL3 equivalent.
- [Day 023: Input Recording and Playback](https://guide.handmadehero.org/code/day023/): see replay used to make a game-state bug reproducible.

The recordings use Win32 and C-style C++. The roadmap uses SDL3 on macOS. Borrow the data flow and debugging technique, not OS calls or build commands. Frame pacing and bitmap episodes were considered, but excluded from the active path where they repeated the assigned fixed-step or rasterization material.

## Verification limits

Three GPT-6 Luna research workers inspected the foundation, systems and capstone sources separately. Parent review corrected their proposals before integration, including video-first C assignments, an incorrect clox chapter entry, missing allocator/ray-tracing/game-2 work and overly broad course scopes. A fourth independent reviewer caught a mislabeled GPU MODE video and incomplete formatter/serializer wording. Both were corrected.

Public contents or official navigation were inspected for Beej, Nand2Tetris, Algorithmica, OSTEP/xv6, Bos, Rust, NVIDIA/GPU MODE, Crafting Interpreters/Lua, Handmade Hero, SDL3 and CMU. CMU Fall 2025's schedule confirms the buffer-pool, B+ tree and logging video links and notes. Some individual pages/PDFs resisted automated extraction. Public indexes or search supplied metadata in those cases; that does not establish authenticated playback. Final direct YouTube links were also checked with YouTube's public title/author metadata. This caught the GPU MODE Lecture 4 link that had been incorrectly labeled as Lecture 8.

Master.dev's public lesson pages identify the lessons but do not expose full playback. The selected Educative growth lesson came from the previous public-syllabus research; account entitlement and exercise execution remain untested. Computer Enhance demonstration links deliberately use the subscriber index because exact episode deep links were not verified. Its public GitHub repository supplies the selected decoder inputs.

Books and blogs can use x86 assumptions, old API versions or hardware-specific results. Study scopes call out the ARM64/Win32/C++ differences where they matter. CUDA timing comparisons must match dtype, layout and math mode on the available NVIDIA GPU. The kernel follows one pinned bootloader/toolchain contract. Lua manual, headers and runtime must match.

The active path does not claim that every original archive URL or version statement is current. It also does not replace the original project tests with watching or reading completion.
