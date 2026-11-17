---
id: 07
title: Memory hierarchy, measurement and SIMD
part: Performance and the operating system
weeks: 10
project: The haversine pipeline profiled and sped up on the Mac with your own timers, profiler and repetition tester, then a SIMD hash table measured against your chapter 04 hash trie.
---

Chapter 06 ended with a CHIP-8 emulator that runs 15 instructions per frame on a host that could run millions. Speed never came up in part one. Your programs were correct, tested against golden files, and you could read the instructions clang made from them. You never asked how long any of it took, or why. In this chapter you measure it, and you explain each number with a model of the hardware. The chapter opens part two of the book, Performance and the operating system. Chapter 08 explains the page faults you count here, and chapter 09 spreads work across cores. The timers, profiler and repetition tester you write here measure the work of both.

The backbone is Casey Muratori's Performance-Aware Programming course on Computer Enhance, the course whose Part 1 gave you the 8086 decoder in chapter 05. You follow its Prologue, Part 2 (Basic Profiling), most of Part 3 (Moving Data) and the start of Part 5 (Computation). Keep the [table of contents](https://www.computerenhance.com/p/table-of-contents) open. Every post named below is linked from it, and each post has the video, notes and often a transcript. The code listings live in the [course repository](https://github.com/cmuratori/computer_enhance/tree/main/perfaware), in the folders `part1` to `part5`.

Casey works on Windows with x86-64 CPUs. You work on an ARM64 Mac. Porting his timers, assembly loops and intrinsics to the Mac is most of the homework. Where Casey reads the x86 time stamp counter, you read the ARM generic timer. Where he writes an x64 loop in nasm, you write the same loop in ARM64 assembly as you did in chapter 05. Where he uses AVX intrinsics, you use NEON. His listings say the course is not tested on macOS or Linux, so read them as reference code to port and do not expect them to build as they are. Do every timing on the Mac itself. The `lab86` machine from chapter 05 runs x86 code through Rosetta, so its numbers describe the translator. If you have a native x86-64 machine, such as the laptop chapter 20 uses, you can run Casey's listings unchanged there as a side experiment.

## The five multipliers and a haversine baseline

Casey opens the course by summing an array of integers, first in Python and then in C. The same work runs at very different speeds, and he names five reasons, the multipliers. Waste is instructions that do no useful work, such as an interpreter's bookkeeping around each Python addition. Instructions per clock is how many instructions the CPU finishes in one cycle when they do not wait on each other. SIMD is one instruction working on several values at once. Caching is how close to the core the data sits. Multithreading uses several cores. This chapter covers the first four. Threads wait for chapter 09.

The C versions of his sum loops are in `part1/listing_0058_prologue_sum_loops.cpp`. The file is plain C apart from its extension, so copy the functions into `src/sumloops.c`. The comment at its top gives the clang flags that stop the compiler from vectorizing the loops, because the Prologue shows SIMD as a separate step. To time a loop, read a monotonic clock before and after it:

```c
#include <stdint.h>
#include <time.h>

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000u + (uint64_t)ts.tv_nsec;
}
```

Run each loop many times over the same 4096-element array and keep the fastest run. The first runs pay for cold caches and for a core that is still at a low clock speed. Step 2 replaces this clock with better ones.

This is the first timing in the chapter, so set the rules for all of them now. Time only release builds from chapter 01's `build.sh`, after the debug build with sanitizers passes. Keep the slow version as an oracle that every fast version must agree with. Write down, next to each number:

```
  machine   sysctl -n machdep.cpu.brand_string, macOS version
  build     clang --version, flags, release or debug
  input     file name, pair count, seed, size in bytes
  result    a sum or checksum the program prints, so the optimizer
            cannot delete the work (chapter 05 showed it will)
  timing    minimum and median over repeated runs, plus a rate:
            bytes per second or operations per second
```

Then the course turns to its real problem. The haversine formula gives the distance between two points on a sphere from their longitudes and latitudes. A generator writes a JSON file of random point pairs and a binary file of answers. A processor reads the JSON, computes the distance of every pair and prints the average. The whole chapter makes this program fast.

```
  gen uniform 1234 1000000
      -> data_1000000_flex.json        {"pairs":[
                                           {"x0":-12.3..., "y0":45.6..., "x1":..., "y1":...},
                                           ... one pair per line ...
                                        ]}
      -> data_1000000_haveranswer.f64  one double per pair, then the average

  hav data_1000000_flex.json data_1000000_haveranswer.f64
      read file -> parse JSON -> pull out x0 y0 x1 y1 -> sum the distances
      -> compare the average with the last double of the answer file
```

`x` is longitude in degrees, from -180 to 180. `y` is latitude, from -90 to 90. The "cluster" mode of the generator picks points near a few random centers, so the distances are not all similar. Use Casey's `ReferenceHaversine` from `part2/listing_0065_haversine_formula.cpp` exactly as written, with an earth radius of 6372.8. Changing the formula changes the answers.

Your processor reuses the chapter 04 library. `read_all` loads the file, `json_parse` builds the tree and `json_get` finds each key. Numbers stay as text in the tree, so convert each one with `strtod`. Inside the JSON buffer a comma or a brace always follows a validated number, so you can pass the number's `data` pointer to `strtod` directly and check that `endptr` stops at `data + len`.

Write down the accuracy rule now and keep it for the whole chapter: the average must match the answer file within a relative error of 1e-9. The rule leaves room for the faster parser and the approximated math later on.

### Study

- [Computer Enhance: Welcome to the Performance-Aware Programming Series!](https://www.computerenhance.com/p/welcome-to-the-performance-aware) (watch, 3 h 30 min): The whole Prologue, in table of contents order: this video, then "Waste", "Instructions Per Clock", "Single Instruction, Multiple Data", "Caching", "Multithreading" and "Python Revisited". It has no homework. The x64 assembly on screen is for orientation. Watch "Multithreading" for the idea only.
- [Computer Enhance: The Haversine Distance Problem](https://www.computerenhance.com/p/the-haversine-distance-problem) (watch, 1 h): This Interlude video, then the first two videos of Part 2, "Generating Haversine Input JSON" and "Writing a Simple Haversine Distance Processor". Their homework is this step's build. "Initial Haversine Processor Code Review" is optional. Casey says to skip it if your own processor works. The other Interlude video comes back in step 8.
- [Beej's C Library Reference: strtod()](https://beej.us/guide/bgclr/html/split/stdlib.html#man-strtod) (reference, as needed): Section 24.4, for what `endptr` points at after a conversion.

### Build

Part 1, the sum loops. Write `src/sumloops.c` with `SingleScalar`, `Unroll2Scalar`, `DualScalar` and `QuadScalar` from listing 58. Build it twice: with the release flags from `build.sh`, and with the no-vectorize flags from the listing's comment. Print each loop's time per element in nanoseconds and the sum, so the work cannot be deleted. Write the Python version too: `sum()` over a list of 4096 ints, timed with `time.perf_counter_ns` over many runs. Disassemble the four functions in both builds with lldb's `di -n` or Compiler Explorer and find the NEON instructions in the vectorized build. They name `v` registers, like `add v0.4s, v0.4s, v1.4s`. Compiler Explorer's "armv8-a clang" target from chapter 05 shows the same thing.

Part 2, the baseline. Write `src/gen.c` with the same arguments and output format as Casey's generator: `uniform` or `cluster`, a seed, and a pair count, with one pair per line of JSON. Any 64-bit random number generator works. The one in `part2/listing_0066_haversine_generator_main.cpp` is a small jsf64 generator and easy to port. Print the expected average. Write `src/hav.c`: load both files, parse the JSON with your chapter 04 parser, copy the pairs into an array of `struct { double x0, y0, x1, y1; }`, compute the average with `ReferenceHaversine`, and print it next to the reference value and their difference. Also compare the first 1000 per-pair distances with the answer file and print the largest difference. Print how many arena bytes the parse used, and divide by the file size.

Generate 100,000 pairs for testing and 1,000,000 pairs for timing, in both modes. Also generate 10,000,000 pairs in both modes for step 8. Those two JSON files take about 1 GB each, so check your free disk space first. Time the whole processor with `now_ns`.

### Done when

The processor's average matches the answer file within the 1e-9 rule for both modes and both sizes, and the debug build runs clean under the sanitizers. You have a table of the sum loops in nanoseconds per element for Python, the non-vectorized C and the vectorized C, and you can point at the instruction that makes the vectorized loop faster. You know your baseline: total time for 1,000,000 pairs, and arena bytes per byte of JSON.

## Clocks on your machine

`now_ns` asks the operating system for the time. Casey uses two clocks in Part 2. `QueryPerformanceCounter` is the Windows call that returns the time. `RDTSC` is an x86 instruction that reads the time stamp counter, a register that counts at a fixed rate. Old CPUs counted core cycles in that register, but the core's clock speed changes all the time, so modern x86 CPUs count at a constant frequency instead. Casey's QueryPerformanceCounter post steps into the Windows call with a debugger and finds that it reads the same counter.

ARM64 has the same pair. The generic timer is a counter that runs at a fixed frequency in every core. `CNTVCT_EL0` holds its current count and `CNTFRQ_EL0` holds its frequency in ticks per second. macOS and Linux both let a user program read them. C has no name for these registers, so you write the instruction yourself with inline assembly:

```c
static inline uint64_t read_cpu_timer(void) {
    uint64_t v;
    __asm__ volatile("isb\n\tmrs %0, cntvct_el0" : "=r"(v));
    return v;
}

static inline uint64_t cpu_timer_freq(void) {
    uint64_t f;
    __asm__ volatile("mrs %0, cntfrq_el0" : "=r"(f));
    return f;
}
```

`__asm__` places the instructions in the string into the compiled C. `"=r"(v)` asks clang to pick a general register for `%0` and copy that register into `v` afterwards. `volatile` stops clang from moving the statement or deleting it. `mrs` copies a system register into a general register. The `isb` comes from section 4.1 of the Arm guide below: the CPU may read the counter early, out of program order, and `isb` makes it wait for the instructions before it.

If `cntfrq_el0` reports 24 MHz, one tick lasts about 42 ns. A block of code that takes 10 ns then reads as 0 or 1 tick, and you only get a useful number by timing many runs of it. That limit shapes every probe you write later in this chapter. The counter also does not count core cycles, the same problem Casey describes for the invariant TSC. Step 5 gets cycle counts another way.

The OS clock on the Mac has two forms. `clock_gettime(CLOCK_MONOTONIC)` returns nanoseconds on both systems. `mach_absolute_time` is a macOS call that returns the counter in its own unit, a tick you must convert, as Apple's page below explains. Casey's way to check a timer still applies: count ticks of the CPU timer over 100 ms of the OS clock, divide, and compare with the frequency the register reports.

macOS also decides which core runs your program. Apple Silicon has performance cores and efficiency cores, and the scheduler picks one. `sysctl hw | grep perflevel` shows how many of each you have. The scheduler uses a thread's quality-of-service class when it picks a core. On the Mac, call `pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0)` from `<pthread.h>` at the start of every benchmark, inside `#ifdef __APPLE__` so the code still builds in Linux. Treat a sudden 2x slowdown as a sign the program ran on an efficiency core.

### Study

- [Computer Enhance: Introduction to RDTSC](https://www.computerenhance.com/p/introduction-to-rdtsc) (watch, 1 h 20 min): The video, then the next post in Part 2, "How does QueryPerformanceCounter measure time?". The second one is also a video, and it is free. Both are about x86 and Windows. Watch for the method: calibrate an unknown counter against a known clock, then check what the OS clock reads underneath.
- [Arm: Learn the architecture, Generic Timer](https://documentation-service.arm.com/static/65fac6957bcc0c1c661b36c0) (read, 20 min): Arm's guide, version 1.3, as a PDF. Read section 4.1 "Count and frequency" and section 4.6 "Timer virtualization", which explains why the virtual count in your Linux VM can differ from the Mac's. Skip the sections on configuring timers and interrupts. They are for kernels.
- [Apple: Addressing architectural differences in your macOS code](https://developer.apple.com/documentation/apple-silicon/addressing-architectural-differences-in-your-macos-code) (reference, as needed): "Fetch System and Hardware Details Dynamically" for page and cache line sizes, which you need in steps 4 and 7, and "Apply Timebase Information to Mach Absolute Time Values".

### Build

Write `src/platform.c` with no `main`:

- `uint64_t read_os_timer(void)` in nanoseconds, from `clock_gettime(CLOCK_MONOTONIC)`.
- `read_cpu_timer` and `cpu_timer_freq` as above, inside `#if defined(__aarch64__)`. Add an `#elif defined(__x86_64__)` branch that uses `__rdtsc()` from `<x86intrin.h>`, so the file still builds in `lab86`.
- `uint64_t estimate_cpu_timer_freq(uint64_t ms)` with Casey's method.

Then `src/timers.c` prints: the frequency from the register, the estimate after 10, 100 and 1000 ms of waiting, the length of one tick in nanoseconds, the smallest nonzero difference between two back-to-back reads of each timer, and the average cost of one read of each timer over 10 million reads. Run it on the Mac and in the `lab` VM.

Next, find out what the OS clock reads. Build a tiny program that calls `clock_gettime` once, open it in lldb, break before the call and step into it with `si` until you find the instruction that reads the hardware counter. It may show up as `cntvct_el0`, as a self-synchronizing variant like the one the Arm guide mentions, or as a raw system register name starting with `S3_` that Apple defines. Write down which one your machine uses.

Last, time the stages of `hav`: reading the file, parsing, copying the pairs out, summing, and checking. Print each one in ticks, in milliseconds and as a percentage of the total.

### Done when

The 100 ms estimate agrees with the register's frequency within 0.1% on the Mac. You can state the tick length and the cost of one timer read on both systems. You can name the instruction `clock_gettime` uses to read the counter on your Mac. `hav` prints a stage table whose percentages add up to between 99% and 101%, and you can say which stage is the largest.

## An instrumentation profiler

A stage table by hand works for five stages. Casey's next videos turn it into a profiler you can drop into any function with one line. Each labeled block of code gets an anchor, a slot in a global array that accumulates its time and hit count. At the start of a block you read the timer. At the end you read it again and add the difference to the anchor.

Nesting makes this harder. If `parse` calls `parse_number`, the time of `parse_number` counts inside `parse` too. The profiler keeps two totals per anchor. The exclusive time leaves out the children. The inclusive time covers everything between the block's start and end. Exclusive times add up to the total run time. Recursion breaks the obvious inclusive sum, because an outer call of `parse_value` already includes its inner calls. Your chapter 04 parser is recursive descent, so it shows that bug at once.

```
  time  ---------------------------------------------------------->
  main     |=================================================|
  parse       |=============================|
  number          |==|    |==|    |==|
  sum                                         |=========|

  inclusive(parse) = the whole parse bar
  exclusive(parse) = the parse bar minus the three number bars
```

Casey's C++ version ends a block in a destructor. C has no destructors, but clang and gcc support the `cleanup` attribute. It calls a function with a pointer to a local variable when that variable goes out of scope, which covers early returns too. `__COUNTER__` is a compiler macro that expands to 0, 1, 2 and so on, a new number at each use, so every block in the program gets its own anchor index at compile time:

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

Anchor 0 stays free to act as the parent of the outermost blocks. `__COUNTER__` counts within one translation unit, so keep chapter 04's convention: include `profiler.c` first, then `base.c` and `json.c`, in a single translation unit, and every block gets a different index. Compile them separately and the anchor numbers collide with no error. A profiler costs time, two timer reads per block plus the bookkeeping. With a 42 ns tick, a block that runs for less than a microsecond is mostly noise. Casey's overhead videos show how to measure the cost and how to compile the profiler out completely with one switch.

### Study

- [Computer Enhance: Instrumentation-Based Profiling](https://www.computerenhance.com/p/instrumentation-based-profiling) (watch, 1 h 15 min): This video, then "Profiling Nested Blocks" and "Profiling Recursive Blocks". Do the homework of each before you watch the next one, because the next video shows his solution.
- [Computer Enhance: A First Look at Profiling Overhead](https://www.computerenhance.com/p/a-first-look-at-profiling-overhead) (watch, 35 min): This video, then "Comparing the Overhead of RDTSC and QueryPerformanceCounter". Your version of the comparison uses `read_cpu_timer` against `read_os_timer` from step 2.
- [Clang: Attributes in Clang, cleanup](https://clang.llvm.org/docs/AttributeReference.html#cleanup) (reference, as needed): The `cleanup` entry, with its example.

### Build

Write `src/profiler.c` on top of `platform.c`: `TIME_BLOCK`, `TIME_FUNCTION`, `prof_begin_run`, and `prof_end_and_print`, which prints every anchor with a nonzero hit count as label, hits, exclusive milliseconds, exclusive percent and inclusive percent. When `PROFILER` is defined as 0, the macros expand to nothing, except for one block around the whole run.

Test it first on code with known timings. Write `spin(uint64_t ns)`, which loops on `read_os_timer` until that many nanoseconds pass.

1. `a()` spins 10 ms and calls `b()`, which spins 20 ms. `a` is 10 ms exclusive and 30 ms inclusive.
2. `r(n)` spins 1 ms, then calls `r(n - 1)` if `n` is above 1. For `r(5)`, the inclusive time of `r` is about 5 ms. A profiler that adds up every call's inclusive time reports 15 ms.
3. `e()` spins 5 ms and then returns from inside an `if`, before the end of its block. Its 5 ms is still recorded.

Then instrument `hav`: the file read, `json_parse`, the recursive value parser inside it, the copy, the sum and the check. Run it on 1,000,000 pairs with `PROFILER` at 1 and at 0, and compare the totals.

### Done when

The three tests report times within 1% of the spin targets. On `hav`, the exclusive percentages add up to between 99% and 101% and the recursive parser's inclusive time stays under 100%. You can state how much the profiler slows `hav` and which blocks have hit counts so high that their timings are mostly overhead. You can name the stage that dominates the baseline.

## Repetition testing and page faults

The profiler shows where one run spends its time. It cannot tell you how fast a piece of code could run, because one run includes whatever happened to the caches, the page tables and the core that time. Part 3 starts with two tools for that.

The first is a rate. Divide the bytes a block processes by its time and you get a bandwidth, for example how many gigabytes per second the parser consumes. Rates let you compare stages that process different amounts of data, and later you compare them with what the hardware can move.

The second is a repetition tester. It runs one function again and again, keeps the minimum, and stops once it has gone some seconds without finding a new minimum. Casey uses 10 seconds. The minimum is the best the code did with everything in its favor. The maximum and the average show what else happens.

The first repetition test of file reading turns up a surprise: reading into freshly allocated memory is much slower than reading into a buffer that was used before. The cause is page faults. `malloc` of a large block only reserves addresses. The first write to each page traps into the kernel, which finds a free physical page, fills it with zeros and maps it, then returns to your loop:

```
  p = malloc(1 GB)        addresses reserved, no physical memory behind them
  p[0] = 1                page fault: the kernel maps one page, then returns
  p[1] = 1                no fault, that page is mapped
  p[page_size] = 1        page fault for the next page
  free(p), malloc again   a large block may go back to the kernel, and the
                          faults start over
```

Chapter 08 explains virtual memory from the kernel's side. Here you count the faults and measure what they cost. `getrusage` reports the number of faults the process has taken so far. The non-Windows branch of Casey's `part3/listing_0108_platform_metrics.cpp`, which a student contributed, adds its `ru_minflt` and `ru_majflt` fields. Page sizes differ between your two systems, so print both before you predict anything.

### Study

- [Computer Enhance: Measuring Data Throughput](https://www.computerenhance.com/p/measuring-data-throughput) (watch, 50 min): This video, then "Repetition Testing", the first two videos of Part 3. Copy his repetition tester's structure in C. His file reads use Windows calls. Use `fread` from chapter 04 instead.
- [Computer Enhance: Monitoring OS Performance Counters](https://www.computerenhance.com/p/monitoring-os-performance-counters) (watch, 1 h): This video, then "Page Faults". Four of the Part 3 videos marked with an asterisk in the table of contents are about page faults and are optional bonus material: "Probing OS Page Fault Behavior", "Four-Level Paging", "Analyzing Page Fault Anomalies" and "Powerful Page Mapping Techniques". "Faster Reads with Large Page Allocations" uses a Windows feature, so watch it if you like and skip its homework.
- [getrusage(2)](https://man7.org/linux/man-pages/man2/getrusage.2.html) (reference, as needed): The Linux man page, for the `ru_minflt` and `ru_majflt` fields. On the Mac, run `man getrusage`.

### Build

Write `src/reptest.c`. A test is a function that receives the tester and calls `rt_begin` and `rt_end` around the timed work, then `rt_count_bytes` with the bytes it processed. The tester tracks test count, total, minimum and maximum time and page faults per run, and prints new minimums as it finds them. It stops after a chosen number of seconds without a new minimum and prints the minimum, maximum and average as time, bandwidth in GB/s and faults per run.

Tests, each on the 1,000,000-pair JSON file:

1. `fread` the whole file into one buffer allocated once, before the tests start.
2. `malloc` a buffer, `fread` into it, `free` it, every repetition.
3. Like test 2, but write one byte into every page of the buffer before the `fread`.

Then a fault probe, `src/faults.c`. Allocate 1 GB with `malloc`. Write one byte into the first N pages for N from 1 up to 4096, and print N, the faults counted, and faults per page touched. Print the page size from `vm_page_size` on the Mac and from `getconf PAGESIZE` in the `lab` VM. Run the probe on both.

### Done when

The tester reaches a stable minimum for all three tests, and the faults per run explain the difference between tests 1 and 2. You can say whether touching the pages first (test 3) helps or only moves the cost, with numbers. The fault probe shows how many faults each touched page costs on each system, and the two page sizes. If faults per page is not 1 on a system, you have written down what it is.

## Latency, throughput and dependency chains

To go further, you need to know what the CPU does with the instructions in a loop. Two numbers describe an instruction. Latency is how many cycles pass before its result can feed another instruction. Throughput is how many of it the core can start per cycle. When each instruction needs the result of the one before, the chain runs at the speed of latency. When instructions are independent, the core overlaps them and the loop runs at the speed of throughput. Casey explains this with a washer and a dryer, and then turns it into predictions for real loops.

Look at `SingleScalar` from step 1 with this in mind. Every add needs the previous sum, so the loop is one dependency chain of adds. `DualScalar` keeps two sums and so has two chains that run side by side. The time per element you measured in step 1 follows from the latency of one add and the number of chains.

To test such ideas directly, Casey writes loops in assembly, links them into a C program and runs them under the repetition tester. You did the same with ARM64 functions in chapter 05. You also need cycles, and the generic timer does not count them. Count them with a loop whose cycle cost you already know. Dougall Johnson's tables below give a 64-bit register `add` a latency of 1 cycle on the M1's performance core. A loop of 8 dependent adds then takes 8 cycles per iteration, because the loop counter's own `subs` and `b.ne` run beside the chain. Time a billion iterations and you get the core's clock frequency:

```
// src/arm64/probes.s
// void add_chain8(uint64_t count): count iterations of 8 dependent adds
        .text
        .globl  _add_chain8
        .p2align 6
_add_chain8:
1:      add     x1, x1, #1
        add     x1, x1, #1
        add     x1, x1, #1
        add     x1, x1, #1
        add     x1, x1, #1
        add     x1, x1, #1
        add     x1, x1, #1
        add     x1, x1, #1
        subs    x0, x0, #1
        b.ne    1b
        ret

  cycles per iteration = 8     frequency = 8 * count / seconds
```

`.p2align 6` starts the loop on a 64-byte boundary, as Casey's `align 64` does. Apple does not publish clock speeds for its M-series chips, so check the result against a second reading. While the probe runs, `sudo powermetrics --samplers cpu_power -n 1` in another terminal prints the frequency of each core cluster as macOS sees it. Your chip may be newer than the M1 that Dougall measured, and its clock will differ. If your result comes out at about half of what `powermetrics` shows for the performance cluster, the add latency on your core is not 1 cycle, or the program ran on an efficiency core. With the frequency in hand, every time you measure converts to cycles. The clock speed drifts with temperature and load, so calibrate in the same run as the measurement.

The front end also has a limit: how many instructions per cycle the core can fetch and decode, whatever they are. A loop of `nop` instructions measures it, because a `nop` does nothing once decoded.

### Study

- [Computer Enhance: Inspecting Loop Assembly](https://www.computerenhance.com/p/inspecting-loop-assembly) (watch, 1 h 25 min): This video, then "Intuiting Latency and Throughput" (free) and "Analyzing Dependency Chains". The examples are x64. Repeat each one on your Mac by reading clang's ARM64 output of the same C.
- [Computer Enhance: Linking Directly to ASM for Experimentation](https://www.computerenhance.com/p/linking-directly-to-asm-for-experimentation) (watch, 1 h 20 min): This video, then "CPU Front End Basics". His routines use nasm and the Windows calling convention. Write yours in ARM64 assembly with chapter 05's register rules, and build them with clang as in chapter 05.
- [Dougall Johnson: Firestorm Base Instructions](https://dougallj.github.io/applecpu/firestorm-int.html) (reference, as needed): Measured latency (LAT) and reciprocal throughput (TP) for every integer instruction on the M1's performance core, from black-box testing. The header explains the columns. Later Apple cores differ in places, so your measurements win when they disagree.

### Build

Write `src/arm64/probes.s` and `src/probes.c`, which runs each probe under the repetition tester and prints cycles per iteration and instructions per cycle, both computed from the calibration of the same run.

1. `add_chain8` as above, for calibration.
2. `add_chains2`, `add_chains4`, `add_chains8`: 8 adds per iteration, spread round-robin over 2, 4 or 8 registers.
3. `nop4`, `nop8`, `nop16`: 4, 8 or 16 `nop` instructions plus the loop branch.
4. `load_chain`: `ldr x1, [x1]` eight times per iteration, with `x1` pointing at a word that holds its own address. Each load needs the previous result.
5. Your four sum loops from step 1, non-vectorized, converted to cycles per element.

### Done when

The calibrated frequency varies by less than 1% between runs. You have a table of adds per cycle against the number of chains, and you can say where it stops rising and how that compares with the TP column for `ADD`. You can state the front end's limit in instructions per cycle and the latency of a load that hits the L1 cache, in cycles. You can explain the cycles per element of each sum loop from these numbers alone.

## Branch prediction and the out-of-order core

Every probe in step 5 had one branch, the loop's own `b.ne`, and it went the same way on every iteration but the last. Real code branches on data. A CPU fetches instructions far ahead of the ones it is executing. At a conditional branch it does not know yet which way to go, so it predicts and keeps going. A correct guess costs nothing. A wrong guess throws away all the work done on the wrong path and restarts at the right one. Predictors learn patterns, so a branch taken every third time can be as cheap as one never taken. Random data defeats them.

Casey's test loop reads one byte per iteration and branches on its low bit. The data decides the pattern: all zeros, all ones, alternating, one in three, one in four, random. The ARM64 version uses `tbnz`, which tests one bit of a register and branches if that bit is 1:

```
// void cond_nop(uint64_t count, const uint8_t *data)
        .globl  _cond_nop
        .p2align 6
_cond_nop:
        mov     x2, #0
1:      ldrb    w3, [x1, x2]
        add     x2, x2, #1
        tbnz    w3, #0, 2f
        nop
2:      cmp     x2, x0
        b.lo    1b
        ret
```

A branchless version computes both outcomes and selects one. ARM64's `csel x0, x1, x2, cond` writes x1 into x0 if the condition holds and x2 otherwise, with no branch to predict. It is not automatically faster. It always does the work of both sides, and it makes the result depend on the comparison. Clang often turns a C `if` into `csel` on its own, so check the disassembly before you believe you are measuring a branch.

The rest of the out-of-order core comes next. Your program names 31 registers, but the core has hundreds of physical ones. The renamer, which Casey calls the RAT, gives each new write its own physical register. Two instructions that only reuse a register name then stop depending on each other, and some `mov` instructions disappear completely. A scheduler then sends each ready instruction to an execution port, a unit that can run that kind of instruction. The number of ports of each kind sets throughput limits such as loads per cycle.

### Study

- [Computer Enhance: Branch Prediction](https://www.computerenhance.com/p/branch-prediction) (watch, 1 h 15 min): This video, then "Code Alignment". His random data comes from a Windows call. On the Mac use `arc4random_buf` from `<stdlib.h>`.
- [Computer Enhance: The RAT and the Register File](https://www.computerenhance.com/p/the-rat-and-the-register-file) (watch, 1 h 20 min): This video, then "Execution Ports and the Scheduler". The RAT homework is x64 assembly you trace on paper with chapter 05's x86 reading skills.
- [Dougall Johnson: Firestorm Overview](https://dougallj.github.io/applecpu/firestorm.html) (reference, as needed): "Firestorm Units" lists which of the M1 performance core's units handle integer, load, store and SIMD work, and "Elimination" lists the instructions the renamer removes. Compare your measurements with both.

### Build

Add to `probes.s` and `probes.c`:

1. `cond_nop` over 1 MB of data for each pattern: never taken, always taken, every 2nd, every 3rd, every 4th, random. Print cycles per iteration for each pattern.
2. Two assembly versions of "sum the bytes that are 128 or more": one with `cmp` and a branch around the add, one with `csel`. Run both on random bytes and on the same bytes sorted.
3. `load_x1` to `load_x4`: 1 to 4 independent `ldr x3, [x1]` per iteration from the same address. Print loads per cycle.
4. The RAT homework from the video, traced on paper: draw each instruction's inputs after renaming and find the longest chain.
5. Optional: copy `cond_nop`, put 1 to 63 `nop` instructions after the `.p2align` and before the loop label, and see whether the loop's position in memory changes its speed on your core.

### Done when

You have cycles per iteration for the six branch patterns and can say which patterns your predictor learns. For the byte sum you have four numbers, branchy and branchless on random and sorted data, and you can explain each one from the cost of a mispredict and the dependency through `csel`. Your loads-per-cycle result matches the number of load units in Dougall's overview, or you can say how it differs. Your RAT drawing names the longest chain.

## Caches and memory bandwidth

Every load so far hit the L1 cache. Real data does not fit there. A cache holds recently used memory in fixed-size lines, and each level is larger and slower than the one before. Apple Silicon has an L1 data cache per core, an L2 shared by a cluster of cores, a system level cache in front of DRAM, and DRAM. The sizes come from `sysctl`, as Apple's page in step 2 says. Run `sysctl -a | grep -E 'cachesize|cachelinesize|perflevel'`. Apple's cache lines are larger than the 64 bytes Casey's x86 code assumes, so read `hw.cachelinesize` and use it.

The tool to see the hierarchy is a read loop over a buffer of a chosen size, repeated many times. While the buffer fits in L1, the loop runs at L1 bandwidth. Past the L1 size it drops to L2 bandwidth, and so on. Casey keeps the loop simple by masking the offset with `size - 1`, which works for sizes that are powers of two:

```
  offset = (offset + 256) & (size - 1)     wraps around inside the buffer

  bandwidth
    |######
    |      ######              each plateau is one level: L1, L2,
    |            #######       system cache, DRAM. Fill in your own
    |                   ########### sizes and numbers. Do not copy
    +---------------------------------> buffer size (log scale)
```

Bandwidth needs wide loads. NEON gives you 32 vector registers of 128 bits, `v0` to `v31`. In a load, `q0` names all 128 bits of `v0`. `ldr q0, [x1]` loads 16 bytes and `ldp q0, q1, [x1]` loads 32. You do not need to compute with the values to measure bandwidth.

Latency needs a different loop. Make the buffer one random cycle of pointers, one per cache line, and follow it: `p = *p`. Each load needs the previous result, so the hardware prefetcher cannot guess the next address, and every hop pays the full latency of whatever level holds the line. Build the cycle with Sattolo's algorithm, a variant of the Fisher-Yates shuffle: for `i` from `n - 1` down to 1, pick `j` at random from 0 to `i - 1`, and swap elements `i` and `j`. The result is one cycle through all `n` lines.

A loop that streams through memory in order runs at tens of gigabytes per second. A loop that chases pointers pays a full memory latency per hop. Step 8 and step 10 both depend on the gap you measure here.

### Study

- [Computer Enhance: Increasing Read Bandwidth with SIMD Instructions](https://www.computerenhance.com/p/increasing-read-bandwidth-with-simd) (watch, 1 h 50 min): This video, then "Cache Size and Bandwidth Testing" and "Non-Power-of-Two Cache Size Testing". His loads are AVX `vmovdqu` of 32 bytes. Use `ldr q` and `ldp q` instead.
- [Computer Enhance: Latency and Throughput, Again](https://www.computerenhance.com/p/latency-and-throughput-again) (watch, 1 h 40 min): This video, then "Unaligned Load Penalties" and "Cache Sets and Indexing".
- [Computer Enhance: Prefetching](https://www.computerenhance.com/p/prefetching) (watch, 40 min): This video, then "Prefetching Wrap-up". The ARM64 prefetch instruction is `prfm pldl1keep, [x1]`. "Non-Temporal Stores", the video before these, is optional. ARM64's `stnp` is only a hint and may change nothing.

### Build

Write `src/arm64/cache.s` and `src/cache.c`, all run under the repetition tester, writing CSV you plot with Python and matplotlib on a log-scale size axis.

1. Read widths: loops that load 8, 16 and 32 bytes per load from a 16 KB buffer. Print bytes per cycle.
2. Bandwidth sweep: the masked read loop with 32-byte loads over sizes from 4 KB to 1 GB in powers of two. Then repeat with sizes between the powers of two, using a counter that resets instead of a mask, to find each level's size more exactly.
3. Latency sweep: the pointer chase in C over the same sizes, one pointer per cache line. Print nanoseconds and cycles per hop.
4. Unaligned loads: 16-byte loads at offsets that stay inside a cache line and offsets that cross a line boundary.
5. Cache sets: read 64 lines that are 4 KB apart, then 64 lines that are 4 KB plus one line apart, and compare.
6. Prefetching: a linked chain of cache-line-sized blocks in random order, with a short loop of busy work on each block, run with and without `prfm` on the next block's address.

Fill in this table from your plots and `sysctl`. `sysctl` gives the L1 and L2 sizes, and `hw.memsize` gives DRAM. macOS does not expose the system cache size, so read it off your plot and write "from plot":

```
  level           size             read bandwidth    latency (ns, cycles)
  L1 data         ...
  L2              ...
  system cache    ...
  DRAM            ...
```

### Done when

Your bandwidth and latency plots show steps where `sysctl` says the cache sizes are, and you labeled each step. The table is filled with your numbers. You can say what an unaligned load that crosses a line costs on your Mac, explain the cache set result from how addresses map to sets, and say how much the prefetch hint saved in the chain test and why.

## A faster haversine pipeline

Now you know where time goes in the haversine processor and what the machine can do. Casey's rule from the Prologue applies first: before optimizing, remove waste. The baseline wastes in several places, and your profile from step 3 already names the worst:

- The generic parser builds a tree of every value, with a hash trie for every object, only to read four numbers per line.
- `json_get` hashes and compares a key string to find each number.
- `strtod` handles every number format, including exponents, while the generator only writes a sign, digits, a point and digits.
- The whole file goes into freshly allocated memory, which pays the page faults you counted in step 4.

The fast version reads the file in chunks into one reused buffer. Casey's file read video measures how the size of that buffer changes the read speed, and you repeat the test on the Mac. Each pair sits on its own line, so the parser handles every complete line in the chunk and carries the unfinished last line over to the start of the next chunk. It scans each line once, finds the four numbers by position and converts them with its own routine: read the digits into a 64-bit integer, count the digits after the point, and divide by the matching power of ten. That conversion can differ from `strtod` in the last bit, which the 1e-9 rule allows. Keep the generic path as a `-check` option that parses with the chapter 04 parser and compares.

That parser only accepts what your generator writes. State this narrower contract in a comment at the top of the file. Data from anywhere else goes through the generic path.

Store the numbers as a structure of arrays, one array per field, instead of an array of structures. For this loop both layouts touch every byte, but the next step loads two pairs into one vector register, and that needs the same field of consecutive pairs next to each other:

```
  array of structures:  struct { double x0, y0, x1, y1; } pairs[n];
     memory: [x0 y0 x1 y1][x0 y0 x1 y1][x0 y0 x1 y1] ...

  structure of arrays:  struct { double *x0, *y0, *x1, *y1; } pairs;
     memory: [x0 x0 x0 x0 ...][y0 y0 y0 y0 ...][x1 x1 ...][y1 y1 ...]
     one 16-byte load gets x0 of two neighboring pairs
```

The math changes last. Casey's opening videos of Part 5 replace `sin`, `cos` and `asin` with his own polynomial approximations and remove the work the formula does twice. Part 4 derives those approximations. It is optional, and Casey says you can start Part 5 from the supplied code. Port the scalar function `SimplifiedHaversineI` from `part4/listing_0195_simplified_haversine_main.cpp` to C, with `SineCoreWithPrefix` and `ArcsineCoreFromSquared` from the same file. The rest of what it uses lives in other listings: the `f64` and `b32` types in `part4/listing_0194_combined_haversine_test.cpp`, `Pi64` in `listing_0175_math_check.cpp`, `QUESTIONABLE_EARTH_RADIUS` (6372.8) in `listing_0172_reference_haversine.cpp`, and `SqrtCE` in `listing_0190_math_replacement.cpp`. Define the two constants yourself. Casey declares the helpers plain `inline`, which fails to link in C99, so make them `static inline`. His function loops over an array of pair structures, so rewrite its loop to read your four arrays. Replace `SqrtCE` and its SSE intrinsic with `sqrt` from `<math.h>`, and check that the disassembly contains an `fsqrt` instruction and no call. `fma` from `<math.h>` should become one `fmadd` instruction.

### Study

- [Computer Enhance: 2x Faster File Reads](https://www.computerenhance.com/p/2x-faster-file-reads) (watch, 30 min): The whole video. Skip the next one, "Overlapping File Reads with Computation", which uses a second thread. Threads come in chapter 09.
- [Computer Enhance: Our Very Own Haversine](https://www.computerenhance.com/p/our-very-own-haversine) (watch, 1 h 10 min): This video, then "Removing Waste" and "Simplified Haversine Candidate", the first three entries of Part 5 in the table of contents. The posts themselves call these the last videos of Part 4. They are the same videos.

### Build

Write `src/hav2.c`:

1. Chunked reading into one buffer that you allocate once. Under the repetition tester, try chunk sizes from 16 KB to 16 MB, summing the bytes so the read cannot be skipped, and pick the fastest.
2. The line parser and number conversion described above, writing into four arrays of `double` in the arena. Test the converter against `strtod` on every number of the 100,000-pair file and print the largest difference in units of the last bit. To get that distance for two doubles of the same sign, `memcpy` each one into an `int64_t` and subtract the two integers.
3. The scalar `SimplifiedHaversineI` over the four arrays.
4. `-check`, which also runs the baseline and compares the two averages.

Profile every change separately, in the order above, and keep a table of total time and per-stage time after each one. Then compute a bound: divide the JSON file size by the read bandwidth your step 7 sweep found for DRAM. That is roughly the time it takes only to read the bytes once.

### Done when

`hav2` passes the 1e-9 rule against the answer file for uniform and cluster data at 1,000,000 and 10,000,000 pairs, and `-check` agrees with the baseline at 1,000,000 pairs. The baseline's tree may not fit in memory at 10,000,000. Your table shows the time each change saved. You can say how far the final time is from the bandwidth bound, and which stage the profiler now says is largest. You can explain, from the chunk-size test and your step 4 fault counts, why the reused chunk beats reading the whole file.

## SIMD lanes with NEON

`hav2` now stores the same field of consecutive pairs side by side, and step 1 showed clang's NEON instructions in the vectorized sum loops. This step writes those instructions yourself. A SIMD instruction does the same operation on every lane of a vector register. A 128-bit NEON register holds four `float` lanes or two `double` lanes:

```
  scalar:  a0+b0   a1+b1   a2+b2   a3+b3            4 instructions

  NEON:    [a0 a1 a2 a3] + [b0 b1 b2 b3] = [a0+b0 a1+b1 a2+b2 a3+b3]
           one fadd v0.4s, v1.4s, v2.4s                1 instruction
           128 bits: 4 floats or 2 doubles
           (x86 AVX2 is 256 bits: 8 floats or 4 doubles)
```

You call NEON from C through intrinsics in `<arm_neon.h>`, functions that compile to one instruction each. The types name their lanes: `float64x2_t` is two doubles, `uint8x16_t` is sixteen bytes. The function names follow a pattern that the Arm guide below explains: `vaddq_f32` is a vector (`v`) add on a full 128-bit register (`q`) of 32-bit floats.

Casey teaches SIMD with AVX on x86. The ideas carry over one to one, and the names change:

```
  idea                    AVX, in Casey's videos           NEON, on your Mac
  lanes of double         __m256d, 4 lanes                 float64x2_t, 2 lanes
  broadcast a constant    _mm256_set1_pd(c)                vdupq_n_f64(c)
  load, store             _mm256_loadu_pd(p)               vld1q_f64(p), vst1q_f64(p, v)
  add, multiply           _mm256_add_pd, _mm256_mul_pd     vaddq_f64, vmulq_f64
  fused multiply-add      _mm256_fmadd_pd(a, b, c) = a*b+c vfmaq_f64(c, a, b) = c+a*b
  square root             _mm256_sqrt_pd(x)                vsqrtq_f64(x)
  absolute value          and-not with -0.0                vabsq_f64(x)
  compare to a mask       _mm256_cmp_pd(a, b, _CMP_LT_OS)  vcltq_f64(a, b), a uint64x2_t
  select by mask          _mm256_blendv_pd(a, b, m)        vbslq_f64(m, b, a)
  zero where mask is set  _mm256_andnot_pd(m, x)           vbslq_f64(m, vdupq_n_f64(0), x)
  sum the lanes           shuffles and adds                vaddvq_f64(v)
```

Watch the argument order in two rows. `vfmaq_f64` takes the accumulator first. `vbslq_f64` takes the mask first and returns its second argument where the mask bits are set. A comparison returns a mask with all bits set in lanes where it holds and all bits clear elsewhere. Casey calls code built from masks predicated code, and a whole video in this step is about it.

An array is rarely a multiple of the lane count. Process full vectors while at least one full vector remains, then finish the rest with the scalar code. Never load past the end of the array, and keep the scalar version as the oracle. The Arm guide's first example ignores this case. It processes `len / 16` blocks and drops the rest, so add the tail yourself if you copy it.

### Study

- [Computer Enhance: Three Steps from Scalar to SIMD](https://www.computerenhance.com/p/three-steps-from-scalar-to-simd) (watch, 1 h 50 min): This video, then "Branchless Absolute Value", "SIMD Predicates", "SIMD Masking" and "Horizontal Operations" from the same Part 5 list. Skip "SIMD Mask Registers", which is about AVX-512 hardware your Mac does not have. The other Part 5 videos in between, from "Selectively Preventing Optimizations" to "How to Use uops.info", are optional. The ones on dead code elimination help if a benchmark loop of yours ever vanishes.
- [Arm: Learn the architecture, Optimizing C code with Neon intrinsics](https://documentation-service.arm.com/static/662f7519f022d5726b45bdc6) (read, 40 min): Arm's guide, version 2.1, as a PDF. Read section 2 "What is Neon?", section 3 "Why use Neon intrinsics?", section 4 "Example - RGB deinterleaving" and section 7 "Program conventions" for the naming pattern. Sections 5 and 6, on matrix multiplication and collision detection, are optional.
- [Arm Neon Intrinsics Reference](https://arm-software.github.io/acle/neon_intrinsics/advsimd.html) (reference, as needed): Arm's list of every intrinsic with its argument order and the instruction it produces. Use the browser's search for a name, or the sections "Fused multiply-accumulate", "Less than", "Bitwise select" and "Addition across vector".

### Build

Part 1, lanes and tails. Write `src/simd_add.c`: `add_f32_scalar` and `add_f32_neon` for `void add(float *dst, const float *a, const float *b, ptrdiff_t n)`. Test every `n` from 0 to 33 against the scalar version, with eight guard bytes after `dst` that must not change. Time both at sizes that fit in L1 and at 1 GB, and compare the ratio with your step 7 bandwidth numbers. Then compile the scalar version with `-O2 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize`. These flags make clang print a remark for each loop it vectorized or failed to vectorize. Find out whether clang vectorized it and how its loop differs from yours.

Part 2, the haversine in lanes. Port the wide haversine from `part5/listing_0218_wide_haversine_math.cpp` and `part5/listing_0219_wide_haversine_main.cpp` to NEON, using the table above. Casey's listing 219 still loads one pair and broadcasts it to all lanes. Yours loads two neighboring pairs from the four arrays of `hav2`, so each lane holds a different pair. Keep the running sum in a `float64x2_t`, add its two lanes with `vaddvq_f64` at the end, and finish an odd last pair with the scalar function. Then try two independent accumulators, four pairs per iteration, as the dependency chains of step 5 suggest.

### Done when

The array add passes for every length from 0 to 33 with the guard bytes intact, under the sanitizers. You can say whether clang vectorized the scalar loop, and quote the remark. The NEON haversine passes the 1e-9 rule at 1,000,000 pairs for both generator modes, including a pair count that is odd. You have its time per pair next to the scalar time from step 8, and you can explain the ratio from the lane count and from what the profiler says the rest of `hav2` costs.

## A SIMD hash table

Chapter 03's assembler looked up symbols with a linear scan, and said this chapter would come back to faster tables. Chapter 04 replaced the scan with Wellons' hash trie. Each lookup in the trie follows pointers from node to node, and at a million keys most of those nodes are not in L1 or L2. Step 7 measured what each such hop costs.

An open-addressing table keeps everything in flat arrays. The hash picks a slot. If the slot holds another key, the lookup tries the next slots in a fixed order until it finds the key or an empty slot. Google's Swiss table adds a separate array of control bytes, one per slot, and checks 16 of them with a few SIMD instructions:

```
  hash(key), 64 bits:   H1 = hash >> 7      picks the starting group
                        H2 = hash & 0x7f    7 bits kept in the control byte

  ctrl:   80 80 3a 80 fe 80 11 80 80 80 80 5c 80 80 80 80 | next group ...
          0x80 = empty     0xfe = deleted     0x00 to 0x7f = full, holds H2
  slots:  one key and value per control byte, same index

  lookup(key):
      g = H1 & (ngroups - 1)
      loop:
          compare the 16 control bytes of group g with H2, all at once
          for each matching byte: compare the slot's key, return on a match
          if the group has an empty byte: the key is not in the table
          g = next group in the probe sequence
```

A control byte of some other key equals your H2 by chance about once in 128 bytes, so a lookup rarely compares more than one full key. The control bytes of 16 slots fit in one 16-byte load. That one array is an example of moving metadata out of the records it describes, the layout idea from step 8.

The probe sequence visits groups at offsets 1, 3, 6, 10 and so on, the triangular numbers. With a power-of-two number of groups it reaches every group. A deleted key leaves a tombstone, `0xfe`, because a lookup must keep probing past it to find keys inserted after it. Keep the table at most 7/8 full, counting tombstones. When an insert would pass that, allocate a table twice the size from the arena and insert every live key again. The old arrays stay in the arena, as the old blocks of chapter 04's dynamic array did.

NEON has no instruction that turns a byte comparison into a bitmask, the x86 `pmovmskb` that the Swiss table's original code uses. Danila Kutenin's article shows two replacements. One narrows the 16 comparison bytes to a 64-bit integer with 4 bits per byte:

```c
uint8x16_t ctrl = vld1q_u8(group);
uint8x16_t eq   = vceqq_u8(ctrl, vdupq_n_u8(h2));            /* 0xff where equal */
uint8x8_t  nib  = vshrn_n_u16(vreinterpretq_u16_u8(eq), 4);  /* 4 bits per byte */
uint64_t   m    = vget_lane_u64(vreinterpret_u64_u8(nib), 0)
                  & 0x8888888888888888u;                     /* 1 bit per byte */
while (m) {
    int i = __builtin_ctzll(m) / 4;   /* index of the matching byte, 0 to 15 */
    /* compare the key in slot group_start + i */
    m &= m - 1;                       /* clear the lowest set bit */
}
```

`__builtin_ctzll` counts the zero bits below the lowest set bit. The other replacement, from the article's SwissMap section, uses 8-byte groups and a 64-bit NEON comparison. Build both and measure.

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
- [Danila Kutenin: Bit twiddling with Arm Neon: beating SSE movemasks, counting bits and more](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/porting-x86-vector-bitmask-optimizations-to-arm-neon) (read, 30 min): A Google engineer's post on Arm's blog. Read the introduction on `shrn`, "Case study: ZSTD" for the 16-byte mask and its loop, and "Case study: Google SwissMap" for the 8-byte version. The other case studies are optional.

### Build

Write `src/swiss.c` in the arena, for `uint64_t` keys and `uint64_t` values: `swiss_new(Arena *a, ptrdiff_t cap)`, `swiss_get`, `swiss_put`, `swiss_del`. Make the group match a function with three versions selected at compile time: scalar (a loop over the bytes), NEON with 16-byte groups, NEON with 8-byte groups. Start every group at a multiple of the group size, so each group load stays inside the control array.

Tests, run in the debug build:

1. Insert 1,000,000 random keys, look all of them up, look up 1,000,000 keys that were never inserted.
2. A random sequence of 2,000,000 puts, gets and deletes, checked step by step against your chapter 04 hash trie. The trie's key is a `Str` holding the 8 bytes of the `uint64_t`, copied into the arena as in chapter 04's tests. The trie has no delete, so store a "deleted" value in it instead.
3. 65,536 keys that differ only in their top 16 bits. Print the longest probe sequence, counted in groups, to check that the hash spreads them.
4. Enough deletes and inserts that tombstones force a rebuild.

Then `src/swissbench.c` under the repetition tester, with the profiler around each phase, at two fills of a table with 2^20 slots: 524,288 keys (1/2 full) and 917,504 keys (7/8 full). For the trie and each of the three match versions, measure inserts, lookups of present keys in random order, and lookups of absent keys, in nanoseconds per operation. Also print bytes of arena used per key.

### Done when

All four tests pass for every match version with no sanitizer report. Your benchmark table has 4 structures, 3 operations and 2 fills, with bytes per key. You can explain each result with numbers from earlier steps: cache misses per lookup from step 7, the dependent loads of the trie, and the instructions of the group match. Where SIMD did not help, or the 8-byte group beat the 16-byte one, you can say why.

## Where this leads

You can now measure a program on your own machine with timers you calibrated, a profiler and a repetition tester you wrote. You can turn a time into cycles, explain it with latency, throughput, branch prediction and the cache level the data lives in, and check the explanation with a probe. You sped up a real pipeline by removing waste first and adding SIMD second, with an oracle that checked every version, and you built a hash table whose layout follows from what a lookup touches.

Some of what you measured happened outside your program. Page faults, the cost of `fread` and the memory you get from `malloc` are the operating system's work, and you saw them only as counts and times. Chapter 08, Operating systems, shows that work from the kernel's side. You work through selected labs of the xv6 teaching kernel, then write a shell, a `malloc` and an event-loop server. The profiler and repetition tester come with you, and chapter 10 ports this hash table to Rust and benchmarks the two versions against each other.
