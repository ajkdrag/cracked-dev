---
id: 07
title: Memory hierarchy, measurement and SIMD
part: Performance and the operating system
weeks: 10
project: The haversine pipeline profiled and sped up with your own timers, profiler and repetition tester, then a SIMD hash table measured against your chapter 04 hash trie.
---

Chapter 06 ended with a CHIP-8 emulator that runs 15 instructions per frame on a laptop that could run millions. Speed never came up in part one. Your programs were correct and tested, and you could read the instructions clang made from them, but you never asked how long any of it took. In this chapter you measure it, and you explain each number with a model of the hardware.

The chapter opens part two of the book, Performance and the operating system. Chapter 08 shows the operating system's side of costs you only count here, and chapter 09 spreads work across cores. The timers, profiler and repetition tester you write here measure the work of both.

The backbone is Casey Muratori's Performance-Aware Programming course on Computer Enhance, whose Part 1 gave you the 8086 decoder in chapter 05. You follow its Prologue, Part 2 (Basic Profiling), most of Part 3 (Moving Data) and parts of Part 5 (Computation). Keep the [table of contents](https://www.computerenhance.com/p/table-of-contents) open. Every post named below is linked from it, with the video, notes and often a transcript. The code listings are in `~/computer_enhance/perfaware`, the clone from chapter 05, in the folders `part1` to `part5`.

Casey works on Windows with Microsoft's compiler, on an x86-64 CPU like yours. His assembly loops and SIMD code run on your laptop as they are, and what you port is the code that calls the operating system. Each step says what to change where it comes up.

## The five multipliers

The same work can run at very different speeds. Casey opens the course by summing an array of integers in Python and in C, and the C loop is far faster. He names five reasons, which he calls the **multipliers**:

- **Waste** is instructions that do no useful work, such as the bookkeeping Python's interpreter does around each addition.
- **Instructions per clock** (IPC) is how many instructions the core finishes per **cycle**, one tick of its clock, when they do not wait on each other.
- **SIMD** (single instruction, multiple data) is one instruction that works on several values at once.
- **Caching** is how close to the core the data sits when an instruction needs it. A **cache** is a small, fast memory next to the core, and L1 is the closest one. Step 7 measures them.
- **Multithreading** splits the work across several cores. It waits for chapter 09.

![The five multipliers: waste surrounds each useful add with other work, independent adds share a cycle, one SIMD instruction adds four values, data in L1 arrives faster than data in DRAM, and each core sums its own part of an array.](figures/07-multipliers.svg)

The C versions of his loops are in `part1/listing_0058_prologue_sum_loops.cpp`. The file is plain C apart from its name, so copy the `u32` typedef and the four functions into `src/sumloops.c`. To time a loop, read a clock before and after it. Casey's Windows clock call, `QueryPerformanceCounter`, becomes `clock_gettime` on Linux. A **monotonic** clock only moves forward, even when someone changes the system's date and time:

```c
#include <stdint.h>
#include <time.h>

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000u + (uint64_t)ts.tv_nsec;
}
```

`clock_gettime` fills a `struct timespec` with seconds and nanoseconds, and `now_ns` joins them into one count of nanoseconds. Run each loop many times over the same 4096-element array and keep the fastest run. The first runs pay for data that is not in the cache yet and for a core that is still at a low clock speed.

The core's clock speed changes all the time with load, temperature and power, which is **frequency scaling**. Many laptop CPUs are also **hybrid**: they mix fast performance cores with slower efficiency cores. `taskset -c 2 ./prog` runs a program on CPU 2 only, so one run does not mix two kinds of core. Under WSL2 that CPU is a virtual one, and Windows picks the physical core under it, so pinning cuts the noise without removing it.

> **Practice:** Time only release builds, after the debug build passes under the sanitizers. Plug the laptop in, set Windows' power mode to best performance, pin the benchmark with `taskset`, and trust the minimum of many runs. Keep the slow version as an **oracle**, a slow version you trust that checks every fast one. Print a result of the timed work, such as the sum, so the optimizer cannot delete the work, as chapter 05 showed it will.

`lscpu` prints your CPU's model name, its cores and its caches, and `uname -r` prints the version of the running kernel. Write these down next to every number you measure in this chapter:

```
  machine   lscpu | grep 'Model name', and uname -r for the kernel
  build     clang --version, the flags, release or debug
  input     file name, pair count, seed, size in bytes
  result    the sum or checksum the program printed
  timing    minimum and median over repeated runs, plus a rate:
            bytes per second or operations per second
```

clang's `-O2` **vectorizes** loops on its own: it rewrites them with SIMD instructions. The Prologue shows SIMD as a separate multiplier, so the comment at the top of listing 58 gives flags that stop it:

- `-O3` optimizes more than `-O2`.
- `-fno-unroll-loops` stops clang from copying the loop body to do several iterations per pass.
- `-fno-vectorize` and `-fno-slp-vectorize` turn off clang's two vectorizers, one for loops and one for runs of similar statements.

Every x86-64 CPU has **SSE2**, a set of SIMD instructions on sixteen 128-bit registers named `xmm0` to `xmm15`. Its `paddd` adds four 32-bit integers in one instruction.

### Study

- [Computer Enhance: Welcome to the Performance-Aware Programming Series!](https://www.computerenhance.com/p/welcome-to-the-performance-aware) (watch, 3 h 30 min): The whole Prologue, in table of contents order: this video, then "Waste", "Instructions Per Clock", "Single Instruction, Multiple Data", "Caching", "Multithreading" and "Python Revisited". It has no homework. The x64 assembly on screen is in Intel syntax, like the second half of chapter 05. Watch "Multithreading" for the idea only.
- [taskset(1)](https://man7.org/linux/man-pages/man1/taskset.1.html) (reference, as needed): The Linux man page. You need only the `-c` form that starts a command on a list of CPUs.

### Build

1. Write `src/sumloops.c` with `SingleScalar`, `Unroll2Scalar`, `DualScalar` and `QuadScalar` from listing 58 and a `main` that fills an array of 4096 `u32` and times each function. Print each function's best time per element in nanoseconds and its sum.
2. Run `sh build.sh sumloops`, then run the debug build once to check that the four sums agree. Then run `sh build.sh sumloops release` and time `taskset -c 2 out/Linux-release/sumloops`.
3. Build the version without vectorization by hand: `clang -std=gnu11 -O3 -fno-unroll-loops -fno-vectorize -fno-slp-vectorize -DNDEBUG -o out/Linux-release/sumloops_novec src/sumloops.c`.
4. Write the Python version: `sum()` over a list of 4096 ints, timed with `time.perf_counter_ns` over many runs, keeping the minimum.
5. Disassemble both C builds with `objdump -d --no-show-raw-insn out/Linux-release/sumloops | less`. `--no-show-raw-insn` hides the bytes of each instruction. `less` shows long output one screen at a time: Space moves down a screen, `/` followed by a word searches for it, and `q` quits. Type `/SingleScalar` to jump to the function. Do the same for `sumloops_novec`.
6. Run `nproc`, which prints how many CPUs Linux sees, and run the release `sumloops` pinned to two different CPUs with `taskset -c N`.

### Done when

You have a table of nanoseconds per element for Python, the C build without vectorization and the vectorized C build, for all four loops. In the vectorized `SingleScalar` you can point at the `paddd` that adds four elements at once, and you can say which `xmm` registers hold the running sums. You can say whether two CPUs gave different times.

## A haversine baseline and the time stamp counter

The sum loops are too small to need a profiler, so the course moves to a real program with parsing, math and a lot of data. The **haversine formula** gives the distance between two points on a sphere from their longitudes and latitudes. A generator, `gen`, writes a JSON file of random point pairs and a binary file with the answer for each pair. A processor, `hav`, reads the JSON, computes every distance and prints the average. The rest of the chapter makes `hav` fast.

![gen writes the JSON file and the answer file. hav reads the JSON file, parses it, copies the pairs out, sums the distances and checks the average against the answer file.](figures/07-haversine-pipeline.svg)

The JSON file holds one pair per line, inside `{"pairs":[` and `]}`. In a pair, `x0` and `x1` are longitudes in degrees, from -180 to 180, and `y0` and `y1` are latitudes, from -90 to 90:

```
    {"x0":-12.3456789012345678, "y0":45.6789012345678901, "x1":..., "y1":...},
```

The answer file holds one `double` per pair, in binary, and then the average. The generator has two modes. `uniform` spreads points over the whole sphere, and `cluster` picks points near a few random centers. Use Casey's `ReferenceHaversine` from `part2/listing_0065_haversine_formula.cpp` exactly as written, with an earth radius of 6372.8. Changing the formula changes the answers.

Your processor reuses the chapter 04 library: `read_all`, `json_parse`, `json_get` and `json_f64`. The math functions `sin`, `cos`, `asin` and `sqrt` live in a separate library, libm, so pass it through the `LIBS` variable from chapter 06: `LIBS=-lm sh build.sh hav`. Keep one accuracy rule for the whole chapter: the average must match the answer file within a relative error of 1e-9.

Next you time each stage of `hav`, and the profiler of step 3 will read a clock millions of times. Each `now_ns` call costs tens of nanoseconds. Every x86 core has a cheaper clock, the **time stamp counter** (TSC), a 64-bit counter that the instruction `rdtsc` reads.

Current CPUs tick it at a constant rate whatever the clock speed, so the TSC measures time, not cycles. Linux lists that property in `/proc/cpuinfo` as `constant_tsc`. WSL2 runs Linux in a virtual machine, so the flag tells you what the virtual CPU promises.

C has no name for `rdtsc`, so clang provides an **intrinsic**: a function that the compiler turns into one instruction. `__rdtsc()` from `<x86intrin.h>` returns the counter. Nothing tells you its rate, so Casey measures it. Read the TSC and the OS clock, wait 100 ms on the OS clock, read both again, and divide the TSC ticks by the seconds that passed.

### Study

- [Computer Enhance: The Haversine Distance Problem](https://www.computerenhance.com/p/the-haversine-distance-problem) (watch, 1 h): This Interlude video, then the first two videos of Part 2, "Generating Haversine Input JSON" and "Writing a Simple Haversine Distance Processor". Their homework is this step's first build items. "Initial Haversine Processor Code Review" is optional. Casey says to skip it if your own processor works.
- [Computer Enhance: Introduction to RDTSC](https://www.computerenhance.com/p/introduction-to-rdtsc) (watch, 1 h 20 min): The video, then the next post in Part 2, "How does QueryPerformanceCounter measure time?", which is free. Listing 74, `part2/listing_0074_platform_metrics.cpp`, has a non-Windows branch that reads the counter with `__rdtsc()` as yours does, and uses `gettimeofday` as the OS clock, which is not monotonic. Use `clock_gettime` in its place. In the second video Casey steps into the Windows clock with a debugger. The optional item below does the same for `clock_gettime`.

### Build

1. Write `src/gen.c` with the same arguments and output as Casey's generator: `uniform` or `cluster`, a seed, and a pair count, with one pair per line of JSON. Port the small random number generator from `part2/listing_0066_haversine_generator_main.cpp`, so a seed always gives the same file. Print the expected average.
2. Write `src/hav.c`. Load both files and parse the JSON with your chapter 04 parser in a 2 GB arena block. As chapter 04 showed, the pages of the block that the parse never touches cost nothing. Copy the pairs into an array of `struct { double x0, y0, x1, y1; }`. Compute the average with `ReferenceHaversine` and print it next to the reference value and their difference.
3. Also compare the first 1000 distances with the answer file and print the largest difference. Print how many arena bytes the parse used, and divide by the file size.
4. Generate 100,000 pairs for testing and 1,000,000 pairs for timing, in both modes. Also generate 10,000,000 pairs in both modes for step 8. Those two JSON files take about 1 GB each, so check the free space with `df -h ~` first.
5. Run `grep -o -m1 -w constant_tsc /proc/cpuinfo`. `-w` matches whole words and `-m1` stops at the first match.
6. Write `src/platform.c` with no `main`: `uint64_t read_os_timer(void)` in nanoseconds from `clock_gettime`, `uint64_t read_cpu_timer(void)` that returns `__rdtsc()`, and `uint64_t estimate_cpu_timer_freq(uint64_t ms)` with Casey's method.
7. Write `src/timers.c`, which includes `platform.c`. Print the frequency estimate after 10, 100 and 1000 ms of waiting, the length of one tick in nanoseconds, and the average cost of one read of each timer over 10 million reads.
8. Time the stages of `hav` with `read_cpu_timer`: reading the file, parsing, copying the pairs out, summing and checking. Print each one in ticks, in milliseconds and as a percentage of the total.

> **Optional:** Find the instruction `clock_gettime` reads the time with. Build a small program with `-g -O0` that calls `clock_gettime` twice. The first call goes through chapter 05's lazy binding, so in gdb break on the line of the second call and `run`. Type `display/i $pc`, which prints the next instruction after every step, as `x/i $pc` did in chapter 02. Then step with `si`. After a few dozen steps you are in the vDSO, a small piece of kernel code that Linux maps into every process, and you reach `rdtsc` or `rdtscp`.

### Done when

The processor's average matches the answer file within the 1e-9 rule for both modes at 100,000 and 1,000,000 pairs, and the debug build runs clean under the sanitizers. You know the arena bytes per byte of JSON. `constant_tsc` is present, or you have written down that it is missing. The 100 ms and 1000 ms estimates agree within 0.1%, and you can state the tick length and the cost of one read of each timer. `hav` prints a stage table whose percentages add up to between 99% and 101%, and you can name the largest stage.

## Two profilers: your own and perf

A stage table by hand works for five stages. A profiler that measures code you have marked is an **instrumentation profiler**, and Casey's next videos build one that you add to any function with one line. Each labeled block gets an anchor, a slot in a global array that adds up its time and hit count. At the start of a block you read the TSC, and at the end you read it again and add the difference to the anchor.

If `parse` calls `number`, the time of `number` counts inside `parse` too. So the profiler keeps two totals per anchor. The **inclusive** time covers everything between the block's start and end. The **exclusive** time leaves out the blocks it called, so the exclusive times of all blocks add up to the run time.

![parse calls number three times. The inclusive time of parse is its whole bar, and its exclusive time is the parse bar with the three number bars cut out.](figures/07-profile-blocks.svg)

Recursion breaks the obvious inclusive sum, and your chapter 04 parser is recursive. Take a function that works for 1 ms and then calls itself, five levels deep. The outermost call lasts 5 ms, and that is the function's inclusive time. Adding up every call's own span gives 5 + 4 + 3 + 2 + 1 = 15 ms, because each outer call already contains the inner ones. Casey's fix is the `old_inclusive` field below: a block saves the anchor's inclusive total when it starts and overwrites the total with that saved value plus its own span when it ends, so only the outermost call counts.

Casey's C++ ends a block in a destructor, a function C++ runs when a variable goes out of scope, and C has none. clang's `cleanup` attribute does that job in C: it calls a function with a pointer to a local variable when the variable goes out of scope, early returns included. `__COUNTER__` expands to 0, 1, 2 and so on, a new number at each use:

```c
typedef struct {
    const char *label;
    uint64_t start;
    uint64_t old_inclusive;
    uint32_t parent;
    uint32_t anchor;
} ProfBlock;

ProfBlock prof_begin(const char *label, uint32_t anchor);
void prof_end(ProfBlock *b);

#define CAT2(a, b) a##b
#define CAT(a, b) CAT2(a, b)
#define TIME_BLOCK(name) \
    ProfBlock CAT(blk_, __LINE__) __attribute__((cleanup(prof_end))) = \
        prof_begin(name, __COUNTER__ + 1)
#define TIME_FUNCTION TIME_BLOCK(__func__)
```

`CAT` glues `blk_` and the line number into a fresh variable name, and the two levels make the preprocessor expand `__LINE__` first. Anchor 0 stays free as the parent of the outermost blocks. `__COUNTER__` counts within one file, so keep chapter 04's one-file build: `hav.c` includes `profiler.c`, `base.c` and `json.c`. Each block also costs two timer reads, so a block shorter than about a microsecond is mostly overhead.

A **sampling profiler** works the other way round. It interrupts the program at a regular interval and records the **call stack**, the function that was running and the chain of functions that called it. Linux's sampling profiler is **perf**. Its `Self` column is the share of samples that stopped in a function's own code, your exclusive time. `Children` adds the samples in functions it called, your inclusive time.

![Ten samples over a run of main, parse and number. Eight samples are inside parse or number, so parse's Children share is 8 of 10. Five stopped in parse's own code, so its Self share is 5 of 10.](figures/07-perf-samples.svg)

Ubuntu's `perf` command looks for a copy built for the running kernel and finds none for WSL2's Microsoft kernel. The generic copy works, so you point an **alias**, a shell shortcut, at it. The CPU also has **performance counters**, registers that count events such as cycles. Many WSL2 installs do not pass them to Linux, and then `perf stat` prints `<not supported>` for `cycles`. Every step of this chapter works without them, with software events such as `task-clock` and timer sampling.

### Study

- [Computer Enhance: Instrumentation-Based Profiling](https://www.computerenhance.com/p/instrumentation-based-profiling) (watch, 1 h 50 min): This video, then "Profiling Nested Blocks", "Profiling Recursive Blocks", "A First Look at Profiling Overhead" and "Comparing the Overhead of RDTSC and QueryPerformanceCounter". Do the homework of each before you watch the next one, because the next video shows his solution. Your version of the overhead comparison uses `read_cpu_timer` against `read_os_timer`.
- [perf wiki: Linux kernel profiling with perf](https://perfwiki.github.io/main/tutorial/) (read, 60 min): The tutorial from the perf project's wiki, adapted from one by Stephane Eranian at Google. Read "Counting with perf stat", "Sampling with perf record", "Sample analysis with perf report" with its "Overhead calculation" on Children and Self, and "Source level analysis with perf annotate". Its examples count hardware events, which may show `<not supported>` on your machine. Skip processor-wide mode, the flame graph and Firefox Profiler sections, `perf top` and `perf bench`.
- [Clang: Attributes in Clang, cleanup](https://clang.llvm.org/docs/AttributeReference.html#cleanup) (reference, as needed): The `cleanup` entry, with its example.

### Build

1. Write `src/profiler.c` on top of `platform.c`: `TIME_BLOCK`, `TIME_FUNCTION`, `prof_begin_run` and `prof_end_and_print`. The last one prints every anchor with a nonzero hit count as label, hits, exclusive milliseconds, exclusive percent and inclusive percent.
2. Wrap `#define PROFILER 1` in `#ifndef PROFILER`, so that `-DPROFILER=0` on the clang line turns the profiler off. When `PROFILER` is 0, make the macros expand to nothing, except for one block around the whole run.
3. Write `spin(uint64_t ns)`, which loops on `read_os_timer` until that many nanoseconds pass. Test the profiler on code with known timings:
   - `a()` spins 10 ms and calls `b()`, which spins 20 ms. `a` is 10 ms exclusive and 30 ms inclusive.
   - `r(n)` spins 1 ms, then calls `r(n - 1)` if `n` is above 1. For `r(5)`, the inclusive time of `r` is about 5 ms. A profiler that adds up every call's inclusive time reports 15 ms.
   - `e()` spins 5 ms and then returns from inside an `if`, before the end of its block. Its 5 ms is still recorded.
4. Instrument `hav`: the file read, `json_parse`, the recursive value parser inside it, the copy, the sum and the check. Run it on 1,000,000 pairs with `PROFILER` at 1 and at 0, and compare the totals.
5. Run `sudo apt install -y linux-tools-generic`. Add `alias perf="$(ls /usr/lib/linux-tools/*-generic/perf | tail -n 1)"` to `~/.bashrc`, open a new terminal and run `perf --version`. Then run `perf stat -e cycles,instructions,task-clock,page-faults true`. `true` is a program that does nothing, so this only shows which events work. Write down whether `cycles` has a number.
6. Run `perf stat` on the release `hav` with 1,000,000 pairs, and compare `task-clock` with the total your profiler prints. If `cycles` worked, divide instructions by cycles for its IPC.
7. `perf record -g` records the callers of each sample by following the rbp chain of chapter 05, and `-O2` uses rbp as an ordinary register unless you add `-fno-omit-frame-pointer`. Build a copy for it: `clang -std=gnu11 -O2 -DNDEBUG -DPROFILER=0 -g -fno-omit-frame-pointer -o out/Linux-release/hav_perf src/hav.c -lm`. Run it on the 1,000,000-pair files with `perf record -g` in front of the command, which writes `perf.data`. Then run `perf report --stdio`, and again with `--no-children`.
8. Run `perf annotate --stdio -s NAME` with the name of the function that has the largest `Self` share. It prints the function's instructions next to the share of samples that landed on each.

> **If it fails:** If `perf` refuses to run and its message mentions `perf_event_paranoid`, the kernel is limiting who may profile. The tutorial's section "Access Control and perf_event_paranoid" explains the setting. Profiling your own program as your own user works at the default value.

### Done when

The three tests report times within 1% of the spin targets. On `hav`, the exclusive percentages add up to between 99% and 101%, and the recursive parser's inclusive time stays under 100%. You can state how much the profiler slows `hav` and which blocks are so short that their timings are mostly overhead. You know whether your WSL2 exposes hardware counters. `perf report` names the same few functions as your profiler's largest blocks, and their `Self` shares match your exclusive percentages within a few percent, or you can say where they differ and why: inlining, short blocks or sampling error. You can point at the instructions where `perf annotate` puts the most samples.

## Repetition testing and page faults

The profiler shows where one run spends its time. It cannot tell you how fast a piece of code could run, because one run includes whatever happened to the caches, the operating system and the core at that moment. Part 3 starts with two tools for that.

The first is a rate. Divide the bytes a block processes by its time and you get a **bandwidth**, for example how many gigabytes per second the parser consumes. Rates let you compare stages that process different amounts of data, and later you compare them with what the hardware can move.

The second is a **repetition tester**. It runs one function again and again, keeps the minimum, and stops once it has gone some seconds without finding a new minimum. Casey uses 10 seconds. The minimum is the best the code did with everything in its favor, and the maximum and the average show what else happens.

The first repetition test of a file read turns up a surprise. Reading into freshly allocated memory is much slower than reading into a buffer that was used before. The cause is **page faults**.

Memory is handed out in the 4096-byte pages of chapter 04, and `malloc` of a large block only reserves addresses. The kernel keeps a **page table** for each process, which records the page of RAM behind each page of addresses, and a reserved page has no entry yet. The first write to each page traps into the kernel, which finds a free page of RAM, fills it with zeros, enters it in the page table and returns to your loop.

![The first write to a fresh page finds no page table entry and traps into the kernel, which zeroes a free page, maps it and returns so the write runs again. Later writes to the same page go straight to memory.](figures/07-page-fault.svg)

Freeing a large block can hand its pages back to the kernel, and the next `malloc` pays the faults again. Chapter 08 explains page tables from the kernel's side. Here you count the faults with `getrusage`, which the non-Windows branch of Casey's `part3/listing_0108_platform_metrics.cpp` already calls. Where his code allocates with the Windows call `VirtualAlloc`, use `malloc`.

The fault probe below writes to memory that nothing reads again, and the optimizer may delete those writes. Declare the pointer `volatile char *`. **volatile** tells the compiler that every read and write through the pointer must happen, in order.

### Study

- [Computer Enhance: Measuring Data Throughput](https://www.computerenhance.com/p/measuring-data-throughput) (watch, 50 min): This video, then "Repetition Testing", the first two videos of Part 3. Copy his repetition tester's structure in C. His file reads use Windows calls, and his listings already have an `fread` version.
- [Computer Enhance: Monitoring OS Performance Counters](https://www.computerenhance.com/p/monitoring-os-performance-counters) (watch, 1 h): This video, then "Page Faults". The videos marked with an asterisk in the table of contents are optional bonus material: "Probing OS Page Fault Behavior", "Four-Level Paging", "Analyzing Page Fault Anomalies" and "Powerful Page Mapping Techniques". Skip "Memory-Mapped Files", which needs `mmap` from chapter 08. "Faster Reads with Large Page Allocations" uses a Windows feature, so do this step's optional item in place of its homework.
- [getrusage(2)](https://man7.org/linux/man-pages/man2/getrusage.2.html) (reference, as needed): The Linux man page, for the `ru_minflt` and `ru_majflt` fields.

### Build

Write `src/reptest.c`. A test is a function that receives the tester and calls `rt_begin` and `rt_end` around the timed work, then `rt_count_bytes` with the bytes it processed. The tester tracks the test count, total, minimum and maximum time, and page faults per run, and prints new minimums as it finds them. It stops after a chosen number of seconds without a new minimum and prints the minimum, maximum and average as time, bandwidth in GB/s and faults per run.

1. Test: `fread` the 1,000,000-pair JSON file into one buffer allocated once, before the tests start.
2. Test: `malloc` a buffer, `fread` into it and `free` it, every repetition.
3. Test: like test 2, but write one byte into every page of the buffer before the `fread`.
4. Write `src/faults.c`. Allocate 1 GB with `malloc` into a `volatile char *`. Write one byte into the first N pages for N from 1 up to 4096 in powers of 4, and print N, the faults counted and faults per page. Run `getconf PAGESIZE`, which prints the page size, and check that it is 4096. Run the release build, because ASan maps memory of its own and adds faults.
5. Give `reptest` an option that runs only one test. Run `perf stat -e page-faults` on test 2 alone, and compare its total with your faults per run times the number of runs.

> **Optional:** Ask for 2 MB pages. Allocate the 1 GB block with `aligned_alloc(1 << 21, size)`, which returns an address that is a multiple of 2 MB. Before the first write call `madvise(p, size, MADV_HUGEPAGE)` from `<sys/mman.h>`, which asks the kernel to back the block with 2 MB pages. Run the fault probe again. This is the Linux version of "Faster Reads with Large Page Allocations".

### Done when

The tester reaches a stable minimum for all three tests, and the faults per run explain the difference between tests 1 and 2. You can say whether touching the pages first (test 3) helps or only moves the cost, with numbers. The fault probe shows one fault per touched page, within 1%. The first page can show 0 faults, because `malloc` already wrote its own header there.

## Latency, throughput and dependency chains

To go further, you need to know what the core does with the instructions in a loop. Two numbers describe an instruction. **Latency** is how many cycles pass before its result can feed another instruction. **Throughput** is how many of it the core can start per cycle. Casey explains them with a washer and a dryer, and then turns them into predictions for real loops.

Take an integer multiply on a recent core: its latency is 3 cycles, and the core can start a new one every cycle. Three multiplies that each need the previous result take 3 + 3 + 3 = 9 cycles. Three multiplies of unrelated values start in cycles 1, 2 and 3 and are all done after cycle 5.

When each instruction needs the result of the one before, they form a **dependency chain**, and the chain runs at the speed of latency. When instructions do not depend on each other, the core overlaps them, and the loop runs at the speed of throughput. `SingleScalar` from step 1 is one chain of adds. `DualScalar` keeps two sums and so has two chains that run side by side.

![Eight adds into one sum take eight cycles, one after another. The same eight adds spread over four sums take two cycles, four adds per cycle.](figures/07-dependency-chains.svg)

Casey tests such ideas with loops in assembly for nasm, the assembler of chapter 05's 8086 listings. Keep them in nasm with Intel syntax, and change only the argument registers: his Windows code takes them in rcx and rdx, and the System V ABI of chapter 05 uses rdi and rsi.

You also need cycles, and the TSC does not count them. Count them with a loop whose cycle cost you know. A register-to-register `add` has a latency of 1 cycle on every recent x86 core, so a loop of 8 dependent adds takes 8 cycles per iteration. The loop counter's `dec` and `jnz` run beside the chain:

```nasm
; src/x86/probes.asm
; void add_chain8(uint64_t count, uint64_t addend)
        section .text

        global  add_chain8
        align   64
add_chain8:
.loop:  add     rax, rsi
        add     rax, rsi
        add     rax, rsi
        add     rax, rsi
        add     rax, rsi
        add     rax, rsi
        add     rax, rsi
        add     rax, rsi
        dec     rdi
        jnz     .loop
        ret

        section .note.GNU-stack noalloc noexec nowrite progbits

; cycles per iteration = 8      clock speed = 8 * count / seconds
```

`section .text` and `global` are nasm's spellings of the `.text` and `.globl` directives from chapter 05. `align 64` starts the loop on a 64-byte boundary. A label that starts with a dot belongs to the label above it, so every function can have its own `.loop`. The last section line marks the stack as not executable, like the last line of chapter 05's `.s` files. The addend is a register because Agner Fog's manual, step 6's reference, notes that an add of a small constant can have zero latency on Alder Lake's performance cores.

To spread the same 8 adds over two chains, alternate two registers. The adds into rax and the adds into rcx do not wait on each other:

```nasm
; void add_chains2(uint64_t count, uint64_t addend)
        global  add_chains2
        align   64
add_chains2:
.loop:  add     rax, rsi
        add     rcx, rsi
        add     rax, rsi
        add     rcx, rsi
        add     rax, rsi
        add     rcx, rsi
        add     rax, rsi
        add     rcx, rsi
        dec     rdi
        jnz     .loop
        ret
```

The core splits each instruction into **micro-operations** (uops), the small steps its execution units run. uops.info, this step's reference, lists measured latency and throughput per instruction.

### Study

- [Computer Enhance: Inspecting Loop Assembly](https://www.computerenhance.com/p/inspecting-loop-assembly) (watch, 2 h 15 min): This video, then "Intuiting Latency and Throughput" (free), "Analyzing Dependency Chains" and "Linking Directly to ASM for Experimentation". Repeat each example by reading clang's output for the same C. His build scripts are Windows batch files. Use this step's nasm and `build.sh` commands instead.
- [Computer Enhance: How to Use uops.info](https://www.computerenhance.com/p/how-to-use-uopsinfo) (watch, 40 min): A Part 5 video, watched out of order because you need the table now. Casey reads the rows and columns of the table you use below.
- [uops.info: Table](https://uops.info/table.html) (reference, as needed): Measured latency and throughput of every x86 instruction on many microarchitectures, from Andreas Abel at Saarland University. Find the row `ADD (R64, R64)`. Pick the column closest to your CPU's model name from `lscpu`. Your measurements win when they disagree.

### Build

Write `src/x86/probes.asm` and `src/probes.c`. `probes.c` declares each probe like `void add_chain8(uint64_t count, uint64_t addend);`, runs it under the repetition tester and prints cycles per iteration and instructions per cycle, both from the calibration of the same run. Build and run:

```sh
mkdir -p out/x86
nasm -f elf64 -g -F dwarf -o out/x86/probes.o src/x86/probes.asm
LIBS=out/x86/probes.o sh build.sh probes release
taskset -c 2 out/Linux-release/probes
```

`-f elf64` makes nasm write a 64-bit Linux object file, and `-g -F dwarf` adds the line information gdb reads.

1. `add_chain8` as above, for calibration.
2. `add_chains2` as above, then `add_chains4` and `add_chains8`: the same 8 adds of `rsi`, spread round-robin over 4 or 8 registers. With rdi and rsi taken, seven caller-saved registers are left, so `add_chains8` also uses rbx, saved with `push` and restored with `pop` as in chapter 05.
3. `load_chain`: `mov rsi, [rsi]` eight times per iteration, with `rsi` pointing at a word that holds its own address. Each load needs the previous result.
4. Your four sum loops from step 1, built without vectorization, converted to cycles per element.
5. If `perf stat` showed cycles in step 3, run `perf stat -e cycles,task-clock` on the calibration and compare its GHz with yours. Otherwise compare with the speed Windows Task Manager shows on its Performance tab while the probe runs.

### Done when

You can say how much the calibrated clock speed varies between runs, and you have checked it once against a second source. You have a table of adds per cycle against the number of chains, and you can say where it stops rising and how that compares with the throughput uops.info lists for your core. You can state the latency, in cycles, of a load that finds its data in L1. You can explain the cycles per element of each sum loop from these numbers alone.

## The front end, branch prediction and the out-of-order core

Step 5 measured how fast the core runs instructions once it has them. Before that, the **front end** of the core fetches instructions from memory and decodes them into uops, and it has a limit of its own: how many instructions it can decode per cycle, whatever they are. A loop of `nop` instructions measures that limit, because a `nop` does nothing once decoded:

```nasm
; void nop4(uint64_t count)
        global  nop4
        align   64
nop4:
.loop:  nop
        nop
        nop
        nop
        dec     rdi
        jnz     .loop
        ret
```

The front end fetches far ahead of the instructions being executed. At a conditional branch it does not know yet which way to go, so it **predicts** and keeps going. A correct guess costs nothing, and a wrong one throws away all the work done on the wrong path. Predictors learn patterns, so a branch taken every third time can be as cheap as one never taken, and random data defeats them.

Casey's test loop in `part3/listing_0136_conditional_nop_loops.asm` branches on the low bit of one byte per iteration. His version loads 8 bytes at each position and so reads up to 7 bytes past the end of the buffer. Load one byte with `movzx r10d, byte [rsi + rax]`, the Intel spelling of chapter 02's `movzbl`, instead. A branchless version computes both outcomes and selects one with `cmov`, from chapter 05's `abs_diff`. It always does the work of both sides, and clang often turns a C `if` into `cmov` on its own, so check the disassembly first.

Your code names 16 general registers, and the core has a few hundred physical ones. The **renamer**, which Casey calls the RAT, gives each new result its own physical register. Two instructions that only reuse a register name then stop depending on each other. The **scheduler** sends each instruction whose inputs are ready to an **execution port**, a unit that runs that kind of instruction. The number of ports of each kind sets limits such as loads per cycle.

![The branch predictor steers the front end, which fetches and decodes in program order. The renamer and the scheduler send instructions to the execution ports out of order, and results retire in program order.](figures/07-ooo-core.svg)

### Study

- [Computer Enhance: CPU Front End Basics](https://www.computerenhance.com/p/cpu-front-end-basics) (watch, 1 h 45 min): This video, then "Branch Prediction" and "Code Alignment". His random data comes from a Windows call. Use `getrandom(buf, n, 0)` from `<sys/random.h>`, which fills a buffer with random bytes from the kernel.
- [Computer Enhance: The RAT and the Register File](https://www.computerenhance.com/p/the-rat-and-the-register-file) (watch, 1 h 20 min): This video, then "Execution Ports and the Scheduler". The RAT homework is x64 assembly you trace on paper.
- [Agner Fog: The microarchitecture of Intel, AMD, and VIA CPUs](https://www.agner.org/optimize/microarchitecture.pdf) (reference, as needed): Agner Fog's measured description of each core design. Read the chapter for your CPU: 13 "Intel Alder Lake", which refers back to 12 "Intel Ice Lake and Tiger Lake" for details, or 24 "AMD Zen 4 pipeline" or 25 "AMD Zen 5 pipeline". If your CPU is newer than the manual, use the newest chapter of your vendor and trust your measurements.

### Build

Add to `probes.asm` and `probes.c`:

1. `nop4` as above, then `nop8` and `nop16`. Print instructions per cycle, counting the `dec` and the `jnz`.
2. `cond_nop` over 1 MB of data for each pattern: never taken, always taken, every 2nd, every 3rd, every 4th and random. Print cycles per iteration for each.
3. Two assembly versions of "sum the bytes that are 128 or more": one with `cmp` and a branch around the add, one with `cmov`. Run both on random bytes and on the same bytes sorted.
4. `load_x1` to `load_x4`: 1 to 4 independent `mov r8, [rsi]` per iteration from the same address. Print loads per cycle.
5. Trace the RAT homework from the video on paper: draw each instruction's inputs after renaming and find the longest chain.
6. Optional: copy `cond_nop`, put 1 to 63 `nop` instructions after the `align` and before the loop label, and see whether the loop's position in memory changes its speed.

### Done when

You can state the front end's limit in instructions per cycle. You have cycles per iteration for the six branch patterns and can say which patterns your predictor learns. For the byte sum you have four numbers, branchy and branchless on random and sorted data, and you can explain each one from the cost of a mispredict and the dependency through `cmov`. Your loads per cycle match the load ports in Agner Fog's chapter for your core, or you can say how they differ. Your RAT drawing names the longest chain.

## Caches and memory bandwidth

Every load so far found its data in L1. Real data does not fit there. A cache holds recently used memory in fixed-size blocks called **lines**, 64 bytes on x86. Each level is larger and slower than the one before. Each core has its own L1 data cache and L2, the cores share an L3, and DRAM sits behind all of them.

This step's build is the largest of the chapter, so give it two weeks.

![The cache hierarchy of an Alder Lake performance core, with sizes and latencies from Agner Fog's table 13.1: a 48 KB L1 and a 1.25 MB L2 per core, an L3 of up to 30 MB shared by all cores, then DRAM. Each level down is larger and slower.](figures/07-cache-hierarchy.svg)

Your own sizes come from `lscpu -C`, which prints each level's size, ways, sets and line size. The files under `/sys/devices/system/cpu/cpu0/cache/` hold the same numbers, with the line size in `coherency_line_size`.

A cache does not put a line just anywhere. It is split into **sets**, and the middle bits of an address pick the set a line must go to. Each set holds a few lines, its **ways**. In the figure's L1, 64 sets of 12 ways, bits 6 to 11 pick the set. Addresses 4 KB apart agree in all of bits 0 to 11, so they all compete for the 12 ways of one set.

![An address splits into a 6-bit offset inside the line, a 6-bit set index that picks one of 64 sets, and a tag that is compared with the tags of the 12 lines in that set.](figures/07-cache-sets.svg)

To see the hierarchy, read a buffer of a chosen size many times. While the buffer fits in L1, the loop runs at L1 bandwidth, and past the L1 size it drops to L2 bandwidth. Casey wraps the offset with a mask, `offset = (offset + 256) & (size - 1)`, which works for sizes that are powers of two.

Bandwidth needs wide loads. **AVX** added sixteen 256-bit registers, `ymm0` to `ymm15`, whose low halves are the `xmm` registers. `vmovdqu ymm0, [rsi]` loads 32 bytes, and Casey's loops use exactly that.

Latency needs a different loop. Make the buffer one random cycle of pointers, one per cache line, and follow it: `p = *p`. Each load needs the previous result, so the hardware **prefetcher**, which loads lines it expects you to need, cannot guess the next address.

![A linear scan reads lines in address order, so the prefetcher loads the next lines early. A pointer chase finds each next address inside the line it just loaded, so every hop waits for a full load.](figures/07-pointer-chase.svg)

Build the cycle with **Sattolo's algorithm**: for `i` from `n - 1` down to 1, pick `j` at random from 0 to `i - 1` and swap elements `i` and `j`. The result is one cycle through all `n` lines.

### Study

- [Computer Enhance: Increasing Read Bandwidth with SIMD Instructions](https://www.computerenhance.com/p/increasing-read-bandwidth-with-simd) (watch, 1 h 50 min): This video, then "Cache Size and Bandwidth Testing" and "Non-Power-of-Two Cache Size Testing". His AVX loads run on your CPU as they are.
- [Computer Enhance: Latency and Throughput, Again](https://www.computerenhance.com/p/latency-and-throughput-again) (watch, 1 h 40 min): This video, then "Unaligned Load Penalties" and "Cache Sets and Indexing".
- [Computer Enhance: Prefetching](https://www.computerenhance.com/p/prefetching) (watch, 40 min): This video, then "Prefetching Wrap-up". "Non-Temporal Stores", the video before these, is optional.

### Build

Write `src/x86/cache.asm` and `src/cache.c`, all run under the repetition tester. Write the results as CSV and plot them with Python's matplotlib on a log-scale size axis. Install it with `sudo apt install -y python3-matplotlib`, because Ubuntu 24.04 refuses `pip install` outside a virtual environment.

1. Run `grep -o -m1 -w avx /proc/cpuinfo`. Without AVX, use the 16-byte `movdqu xmm0, [rsi]` from SSE2 in the loops below.
2. Read widths: loops that load 8, 16 and 32 bytes per load from a 16 KB buffer. Print bytes per cycle.
3. Bandwidth sweep: the masked read loop with 32-byte loads over sizes from 4 KB to 1 GB in powers of two. Repeat with sizes between the powers of two, using a counter that resets in place of the mask, to find each level's size more exactly.
4. Latency sweep: the pointer chase in C over the same sizes, one pointer per cache line. Print nanoseconds and cycles per hop.
5. Unaligned loads: 32-byte loads at offsets that stay inside a cache line and at offsets that cross a line boundary.
6. Cache sets: read 64 lines that are 4 KB apart, then 64 lines that are 4 KB plus one line apart, and compare. Predict the result first from the ways and sets `lscpu -C` lists for L1d.
7. Prefetching: a linked chain of cache-line-sized blocks in random order, with a short loop of busy work on each block, run with and without `prefetcht0` on the next block's address. `prefetcht0 [rax]` asks the core to load that line into every cache level and does not wait for it.

Fill in this table from your plots and `lscpu -C`:

```
  level      size        read bandwidth    latency (ns, cycles)
  L1 data    ...
  L2         ...
  L3         ...
  DRAM       ...
```

### Done when

Your bandwidth and latency plots show steps where `lscpu -C` says the cache sizes are, and you labeled each step. The table is filled with your numbers. You can say what an unaligned load that crosses a line costs, explain the cache set result from the set index bits, and say how much the prefetch saved in the chain test and why.

## Removing waste, then cheaper math

Now you know where time goes in `hav` and what the machine can do. Casey's rule from the Prologue applies first: before optimizing, remove waste. Your profiles from step 3 already name the worst of it:

- The generic parser builds a tree of every value, with a hash trie for every object, only to read four numbers per line.
- `json_get` hashes and compares a key string to find each number.
- `json_f64` copies each number and calls `strtod`, which handles every number format, while the generator only writes a sign, digits, a point and digits.
- The whole file goes into freshly allocated memory, which pays the page faults you counted in step 4.

The fast version, `hav2`, reads the file in chunks into one reused buffer, parses each complete line and carries the unfinished last line over to the next chunk. It finds the four numbers by position and converts each with its own routine: read the digits into a 64-bit integer, count the digits after the point and divide by the matching power of ten. That parser accepts only what your generator writes, so state this contract in a comment and keep the generic path behind a `-check` option.

Store the numbers as a **structure of arrays**, one array per field, in place of an **array of structures**. For a scalar loop both layouts touch the same bytes. Step 9 loads four pairs into one SIMD register, and that needs the same field of neighboring pairs side by side.

![In an array of structures one 32-byte load gets the four fields of one pair. In a structure of arrays one 32-byte load gets x0 of four neighboring pairs.](figures/07-aos-soa.svg)

With the parsing waste gone, the math takes a larger share. Casey replaces `sin`, `cos` and `asin` from libm with polynomials that are exact enough for this data. Port `SimplifiedHaversineI` from `part4/listing_0195_simplified_haversine_main.cpp` to C, with `SineCoreWithPrefix` and `ArcsineCoreFromSquared` from the same file. The rest is in other listings:

- The `f64` and `b32` types are in `part4/listing_0194_combined_haversine_test.cpp`.
- `Pi64` is in `listing_0175_math_check.cpp`, and `QUESTIONABLE_EARTH_RADIUS` (6372.8) in `listing_0172_reference_haversine.cpp`.
- `SqrtCE` is in `listing_0190_math_replacement.cpp`. It computes a square root with one SSE2 instruction.

Casey declares the helpers `inline`, a hint to copy a function's body into each caller. In C a plain `inline` function can fail to link, so make them `static inline`, which gives each file a private copy as `static` did in chapter 04's `base.c`. His loop reads an array of pair structures, so rewrite it to read your four arrays. The polynomials use `fma(a, b, c)` from `<math.h>`, a **fused multiply-add**: `a * b + c` with one rounding at the end. clang only uses instructions that every x86-64 CPU has unless you say otherwise, and without that each `fma` is a jump into libm.

> **Practice:** Build for the CPU features you have. Run `grep -o -m1 -w -e avx2 -e fma /proc/cpuinfo`. If it prints both words, add the line `arch="-mavx2 -mfma"` to `build.sh` and `$arch` to its compiler line, and the same flags to `tests/run_test.sh`. `-mfma` lets clang use the FMA instructions, and `-mavx2` the 256-bit instructions of AVX2 that step 9 uses.

> **If it fails:** If either word is missing, leave the flags out. Your `fma` calls stay in libm. In step 9, write the array add with SSE2's four-lane `_mm_loadu_ps`, `_mm_add_ps` and `_mm_storeu_ps`, and skip the wide haversine, build items 4 to 6.

### Study

- [Computer Enhance: 2x Faster File Reads](https://www.computerenhance.com/p/2x-faster-file-reads) (watch, 30 min): The whole video. Skip the next one, "Overlapping File Reads with Computation", which uses a second thread. Threads come in chapter 09.
- [Computer Enhance: Our Very Own Haversine](https://www.computerenhance.com/p/our-very-own-haversine) (watch, 1 h 10 min): This video, then "Removing Waste" and "Simplified Haversine Candidate", the first three entries of Part 5 in the table of contents. The posts themselves call these the last videos of Part 4. Part 4 derives the polynomials and is optional. Casey says you can start from the supplied code.
- [CppCon 2014: Mike Acton "Data-Oriented Design and C++"](https://www.youtube.com/watch?v=rX0ItVEVjHc) (watch, 1 h 30 min): Acton, then engine director at Insomniac Games, on choosing a layout from the data a loop reads. The examples are C++, and the point is the layout. Stop when the audience questions start.

### Build

Write `src/hav2.c`, and profile every change separately, in this order. Keep a table of total time and time per stage after each one.

1. Chunked reading into one buffer that you allocate once. Under the repetition tester, try chunk sizes from 16 KB to 16 MB, summing the bytes so the read cannot be skipped, and pick the fastest.
2. The line parser and number conversion described above, writing into four arrays of `double` in the arena. Test the converter against `strtod` on every number of the 100,000-pair file and print the largest difference in units of the last bit. For two doubles of the same sign, `memcpy` each one into an `int64_t` and subtract the two integers.
3. The sum with `ReferenceHaversine` over the four arrays, and `-check`, which also runs the baseline and compares the two averages.
4. Compute a bound: divide the JSON file size by the DRAM read bandwidth from your step 7 sweep. That is roughly the time it takes only to read the bytes once.
5. Add `arch` to `build.sh` and `tests/run_test.sh` as the Practice says, rebuild `hav2` and run its tests again.
6. Add the scalar `SimplifiedHaversineI` as a second sum, chosen with a `-fast` option, and keep `ReferenceHaversine` as the oracle.
7. Check with `objdump -d` that the function contains `vfmadd` instructions and no `call fma` or `jmp fma`. Build it once without `$arch` and find the jumps or calls to `fma`. Profile both sums at 1,000,000 and 10,000,000 pairs.

### Done when

`hav2` passes the 1e-9 rule against the answer file for uniform and cluster data at 1,000,000 and 10,000,000 pairs, with both sums, and `-check` agrees with the baseline at 1,000,000 pairs. The baseline's tree may not fit in memory at 10,000,000. Your table shows the time each change saved. You can explain, from the chunk-size test and your step 4 fault counts, why the reused chunk beats reading the whole file. You can point at a `vfmadd` and at the libm `fma` that replaces it without `-mfma`. You can say how far the whole run now is from the bandwidth bound, and which stage is now largest.

## SIMD lanes with AVX2

`hav2` now stores the same field of neighboring pairs side by side, and step 1 showed clang's SSE2 instructions in the vectorized sum loops. In this step you write SIMD code yourself. A SIMD instruction does the same operation on every **lane** of a register. **AVX2** works on the 256-bit `ymm` registers from step 7, which hold four `double` lanes or eight `float` lanes.

![One vaddpd adds the four double lanes of ymm1 and ymm2 at once and writes four sums into ymm0. The low two lanes are the 128-bit register xmm0.](figures/07-simd-lanes.svg)

You write AVX2 from C through intrinsics in `<immintrin.h>`, the same ones Casey uses. The type `__m256d` holds four doubles, `__m256` eight floats and `__m256i` integers of any width. The names follow a pattern: `_mm256_add_pd` is a 256-bit (`_mm256`) add of packed doubles (`pd`). `ps` means packed floats, `epi8` packed 8-bit integers, and plain `_mm_` names work on the 128-bit `xmm` registers. Casey's wide haversine uses these:

```
  broadcast a constant      _mm256_set1_pd(c)
  load, store               _mm256_loadu_pd(p), _mm256_storeu_pd(p, v)
  add, multiply             _mm256_add_pd(a, b), _mm256_mul_pd(a, b)
  fused multiply-add        _mm256_fmadd_pd(a, b, c), which is a * b + c
  square root               _mm256_sqrt_pd(x)
  compare to a mask         _mm256_cmp_pd(a, b, _CMP_LT_OS)
  select by mask            _mm256_blendv_pd(a, b, mask), b where the mask is set
  clear by mask             _mm256_andnot_pd(mask, x), x where the mask is clear
```

A comparison returns a **mask**: all bits set in each lane where it holds and all bits clear elsewhere. Casey calls code built from masks predicated code, and several videos in this step are about it.

An array is rarely a multiple of the lane count. Process full registers while at least one full register of data remains, then finish the rest, the **tail**, with the scalar code. Never load past the end of the array, and keep the scalar version as the oracle.

A single running sum in a `__m256d` is one dependency chain again, four lanes wide. Casey's "Dependency Chain Stalls" and "In-order Interleaving" show how a second accumulator hides the latency of the add, as `add_chains2` did in step 5.

### Study

- [Computer Enhance: Three Steps from Scalar to SIMD](https://www.computerenhance.com/p/three-steps-from-scalar-to-simd) (watch, 1 h 50 min): This video, then "Branchless Absolute Value", "SIMD Predicates", "SIMD Masking" and "Horizontal Operations" from the same Part 5 list. "SIMD Mask Registers" is about AVX-512. Watch it only if `grep -o -m1 -w avx512f /proc/cpuinfo` prints a match. "Nested SIMD Predicates", "SIMD Shuffles" and "SIMD Unpacks", which sit between "SIMD Masking" and "Horizontal Operations", are optional.
- [Computer Enhance: Dependency Chain Stalls](https://www.computerenhance.com/p/dependency-chain-stalls) (watch, 1 h 10 min): This video, then "In-order Interleaving". Watch them before build item 6. Of the other Part 5 videos before "Three Steps from Scalar to SIMD", "How to Use uops.info" was step 5's, and the rest are optional. The ones on dead code elimination help if a benchmark loop of yours ever vanishes.
- [Intel Intrinsics Guide](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html) (reference, as needed): Intel's searchable list of every intrinsic. Tick AVX2 and FMA in its list of instruction sets and search for a name to see its arguments, the instruction it becomes and what it computes.

### Build

1. Write `src/simd_add.c` with `add_f32_scalar` and `add_f32_avx2` for `void add(float *dst, const float *a, const float *b, ptrdiff_t n)`. Test every `n` from 0 to 33 against the scalar version, with eight guard bytes after `dst` that must not change.
2. Time both at sizes that fit in L1 and at 1 GB, and compare the ratio with your step 7 bandwidth numbers.
3. Compile the scalar version with `clang -std=gnu11 -O2 -mavx2 -mfma -Rpass=loop-vectorize -Rpass-missed=loop-vectorize -c src/simd_add.c -o /dev/null`. These flags make clang print a remark for each loop it vectorized or did not. Find out whether it vectorized your scalar loop, then read its loop in `objdump -d` and say how it differs from yours.
4. Port the wide haversine from `part5/listing_0218_wide_haversine_math.cpp` and `part5/listing_0219_wide_haversine_main.cpp`. Take the math and leave out the test harness that listing 219 includes. Casey's listing 219 still loads one pair and broadcasts it to all four lanes. Yours loads four neighboring pairs from the four arrays of `hav2` with `_mm256_loadu_pd`, so each lane holds a different pair.
5. Keep the running sum in a `__m256d`, add its four lanes at the end, and finish the last pairs, up to three, with the scalar function.
6. Try two independent accumulators, eight pairs per iteration, as "In-order Interleaving" shows.

> **Optional:** On ARM64 the same ideas use 128-bit NEON registers, with two `double` or four `float` lanes, through `<arm_neon.h>`. Port the array add of this step's build with `vld1q_f32`, `vaddq_f32` and `vst1q_f32`, build it with `aarch64-linux-gnu-gcc -static` and run it under `qemu-aarch64`, as in chapter 05.

### Done when

The array add passes for every length from 0 to 33 with the guard bytes intact, under the sanitizers. You can say whether clang vectorized the scalar loop, and quote the remark. The AVX2 haversine passes the 1e-9 rule at 1,000,000 pairs for both generator modes, and also at a pair count that is not a multiple of 4. You have its time per pair next to the time of the scalar `-fast` sum from step 8, with one and with two accumulators, and you can explain the ratio from the lane count and from what the profiler says the rest of `hav2` costs.

## A SIMD hash table

Chapter 02's word counter looked up words with a linear scan, and chapter 04 replaced the scan with Wellons' hash trie. Each lookup in the trie follows pointers from node to node. At a million keys most of those nodes are in neither L1 nor L2, and step 7 measured what each such hop costs.

An **open-addressing** table keeps everything in flat arrays. The hash picks a slot, and if that slot holds another key, the lookup tries the next slots in a fixed order until it finds the key or an empty slot. Google's **Swiss table** adds a separate array of **control bytes**, one per slot, and checks a group of 16 of them with a few SSE2 instructions. It splits the 64-bit hash in two. The top 57 bits, called H1, pick the group where the search starts. The low 7 bits, called H2, are a small fingerprint of the key that is stored in the slot's control byte.

![H1, the top 57 bits of the hash, picks the first group, and H2, the low 7 bits, is compared with all 16 control bytes of the group at once. The resulting mask has a bit for each match, and only those slots compare the full key. A miss moves on to the next group of the probe sequence.](figures/07-swiss-table.svg)

A control byte holds `0x80` for an empty slot, `0xfe` for a deleted one, or the H2 of the key in a full slot. Another key's control byte equals your H2 by chance about once in 128, so a lookup rarely compares more than one full key. The control bytes of 16 slots fit in one 16-byte load. That array moves metadata out of the records it describes, the layout idea from step 8. This is the group match the original design uses:

```c
#include <emmintrin.h>

__m128i  ctrl = _mm_loadu_si128((const __m128i *)group);
__m128i  eq   = _mm_cmpeq_epi8(ctrl, _mm_set1_epi8((char)h2)); /* 0xff where equal */
uint32_t m    = (uint32_t)_mm_movemask_epi8(eq);              /* 1 bit per byte */
while (m) {
    int i = __builtin_ctz(m);   /* index of the matching byte, 0 to 15 */
    /* compare the key in slot group_start + i */
    m &= m - 1;                 /* clear the lowest set bit */
}
```

`_mm_cmpeq_epi8` compiles to `pcmpeqb` and `_mm_movemask_epi8` to `pmovmskb`, which gathers the top bit of each of the 16 bytes into an integer. `__builtin_ctz` counts the zero bits below the lowest set bit. The same compare against `0x80` finds the empty slots.

The probe sequence visits the groups at offsets 1, 3, 6, 10 and so on from the first one, the triangular numbers, and with a power-of-two number of groups it reaches every group. A deleted key leaves a **tombstone**, `0xfe`, because a lookup must keep probing past it to find keys inserted after it. Keep the table at most 7/8 full, counting tombstones. When an insert would pass that, allocate a table twice the size from the arena and insert every live key again. The old arrays stay in the arena, as the old blocks of chapter 04's dynamic array did.

Integer keys need a hash that mixes every input bit into every output bit, or keys that differ only in their high bits all land in one group. The finalizer of the splitmix64 generator does this in a few instructions:

```c
static uint64_t hash_u64(uint64_t x) {
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9u;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebu;
    return x ^ (x >> 31);
}
```

### Study

- [Abseil: Swiss Tables Design Notes](https://abseil.io/about/design/swisstables) (read, 20 min): "Lookup Optimizations", with its parts "Metadata Layout", "Metadata Information" and "Metadata Lookup". Skip "Storage Optimizations" and everything after it, which is about the C++ interface.
- [Danila Kutenin: Bit twiddling with Arm Neon: beating SSE movemasks, counting bits and more](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/porting-x86-vector-bitmask-optimizations-to-arm-neon) (read, 30 min): Optional. A Google engineer's post on Arm's blog about ARM64, which has no `pmovmskb`. If you build the optional ARM64 version below, read the introduction, "Case study: ZSTD" for the narrowing trick that replaces `pmovmskb`, and "Case study: Google SwissMap".

### Build

Write `src/swiss.c` in the arena, for `uint64_t` keys and `uint64_t` values: `swiss_new(Arena *a, ptrdiff_t cap)`, `swiss_get`, `swiss_put` and `swiss_del`. Make the group match a function with two versions chosen at compile time: scalar, a loop over the 16 bytes that builds the same mask, and SSE2 as above. Start every group at a multiple of 16, so each group load stays inside the control array.

Tests, in `tests/swiss_test.c` in the test pattern of chapter 02, run with `sh tests/run_test.sh swiss` once for each match version:

1. Insert 1,000,000 random keys, look all of them up, and look up 1,000,000 keys that were never inserted.
2. A random sequence of 2,000,000 puts, gets and deletes, checked step by step against your chapter 04 hash trie. The trie's key is a `Str` holding the 8 bytes of the `uint64_t`, copied into the arena as in chapter 04's tests. The trie has no delete, so store a "deleted" value in it instead.
3. 65,536 keys that differ only in their top 16 bits. Print the longest probe sequence, counted in groups, to check that the hash spreads them.
4. Enough deletes and inserts that tombstones force a rebuild.

Then write `src/swissbench.c` under the repetition tester, with the profiler around each phase, at two fills of a table with 2^20 slots: 524,288 keys (1/2 full) and 900,000 keys (about 86% full, under the 7/8 limit, so the bench never rebuilds). For the trie and both match versions, measure inserts, lookups of present keys in random order and lookups of absent keys, in nanoseconds per operation. Also print bytes of arena used per key.

> **Optional:** Add a third version with 32-byte groups, using `_mm256_cmpeq_epi8` and `_mm256_movemask_epi8` from AVX2. Or build the table for ARM64 with the 8-byte NEON match from Kutenin's SwissMap section and run its tests under `qemu-aarch64`.

### Done when

All four tests pass for both match versions with no sanitizer report. Your benchmark table has 3 structures, 3 operations and 2 fills, with bytes per key, and the table never rebuilt during the bench. You can explain each result with numbers from earlier steps: cache misses per lookup from step 7, the dependent loads of the trie, and the instructions of the group match. Where SIMD did not help, you can say why.

## Where this leads

You can now measure a program on your own machine with timers you calibrated, a profiler and a repetition tester you wrote, and perf. You can turn a time into cycles, explain it with latency, throughput, branch prediction and the cache level the data lives in, and check the explanation with a probe. You sped up a real pipeline by removing waste first and adding SIMD second, with an oracle that checked every version, and you built a hash table whose layout follows from what a lookup touches.

Some of what you measured happened outside your program. Page faults, the cost of `fread` and the memory you get from `malloc` are the operating system's work, and you saw them only as counts and times. Chapter 08, Operating systems, shows that work from the kernel's side. It starts by building xv6, a small Unix that MIT wrote for teaching, and running it in QEMU in your Ubuntu. Then it turns to the process and file descriptor interface a program sees, through the system calls `fork`, `exec` and `wait`.

From there it alternates between labs that change the xv6 kernel and programs of your own: a shell, a `malloc` built on `mmap` and an event-loop server. One of the labs extends the kernel's page fault handler, the code behind the faults you counted in step 4. The repetition tester comes with you to time a system call, and chapter 10 ports this hash table to Rust and benchmarks the two versions against each other.
