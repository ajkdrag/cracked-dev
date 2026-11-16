---
id: 01
title: Setup and tools
part: The machine and C
weeks: 1
project: A working C toolchain on the Mac and in an ARM64 Linux VM, with a build script, sanitizers and a debugger.
---

You know Python, git and a terminal. This book takes you from there to a tensor library you write yourself, by way of C, hardware, assembly, operating systems, compilers and GPUs. Every chapter after this one asks you to write C, run it, and find out why it did what it did. This chapter sets up the tools for that loop before you know any C. By the end of the week one build script compiles C on your Mac and in a Linux machine, sanitizers stop the program at memory bugs, and you can pause a program in a debugger and read its variables. The C programs in this chapter are short and given to you. The next chapter teaches you to write them.

The book works build first. Each chapter has a project and each step has a Build. Start the Build with what you already know. When you get stuck on something specific, read the Study item that covers it, and only the sections the scope note names. Then check the claim on the machine: step through it in the debugger, look at the assembly, or measure it. Do not take a statement about memory, the compiler or the hardware on trust when you can watch it happen.

Plan on about 12 hours a week. Spend roughly 60 percent of that on the project with the debugger open, 25 percent on the reading for the step you are stuck on, and the rest on small experiments with code you wrote but do not fully understand. Put the longest uninterrupted block of the week on the hardest part of the build. Once a week, write a few lines in your notes on what you built and what confused you. The next week starts from that note.

A step ends when its "Done when" check passes. Finishing the reading does not end a step, and an unfinished reading does not block one. A chapter ends when the project works and you can explain how it works. Extra work that a step marks as optional never blocks the next chapter. If your Mac already compiles C, run each step's "Done when" check first and skip the steps that pass.

## Hello from the shell

The shell starts every program you run in this book and gets three things back from it. Standard output (stdout) carries the results. Standard error (stderr) carries diagnostics, so when you redirect the results to a file the errors still reach your screen. The exit status is a small integer. Zero means success and any other value means failure. In C, the value `main` returns becomes the exit status, and the shell keeps it in `$?` until the next command runs.

A C program goes through a compiler before it runs. `clang` reads your source file, turns it into machine code for your CPU and writes an executable file. Two kinds of failure look alike at first. A compile error comes from clang, names a file, line and column, and leaves no new executable behind. A run-time failure comes from your program after it started, as text on stderr, a nonzero exit status or a crash. Keep the two apart from the first day.

You type `./hello` with a `./` in front. For a bare name like `clang`, the shell searches the directories listed in the `PATH` variable, and your project directory is not one of them. `./hello` is a relative path that starts in the working directory, the directory `pwd` prints.

Install Apple's command line tools with `xcode-select --install`. They provide `clang`, `lldb` and `git`.

### Study

- [Missing Semester 2026: Command-line Environment](https://missing.csail.mit.edu/2026/command-line-environment/) (read, 25 min): Under "The Command Line Interface", read Arguments, Streams, Environment variables and Return codes. Skim the globbing and `fzf` passages. Skip Signals for now and everything from "Remote Machines" on.
- [Beej's Guide to C: Hello, World!](https://beej.us/guide/bgc/html/split/hello-world.html) (read, 25 min): Sections 2.1 to 2.5 and 2.7. Skip 2.6 on IDEs. On the Mac, `gcc` runs clang, as 2.5 explains, so use `clang` everywhere.

### Build

Make a project directory, run `git init`, and add a `.gitignore` that contains the line `out/`. Write `src/main.c`:

```c
#include <stdio.h>

int main(void) {
    printf("hello, stdout\n");
    fprintf(stderr, "hello, stderr\n");
    return 3;
}
```

`fprintf(stderr, ...)` works like `printf` but writes to standard error. Compile with `clang -o hello src/main.c`. Before each of these commands, write down what you expect to see:

```sh
./hello
echo $?
./hello > out.txt
cat out.txt
./hello 2> err.txt
./hello > /dev/null 2>&1; echo $?
./hello && echo ok || echo failed
```

Then run `rm hello`, delete the semicolon after `return 3`, and compile again. Read clang's message, run `echo $?` right after it, and run `ls`. Put the semicolon back, compile, run `rm hello out.txt err.txt`, and commit `src/main.c` and `.gitignore`.

### Done when

Your predictions for all seven commands matched, or you can explain each one that did not. You can say in one sentence each what the working directory is, why `./hello` needs the `./`, how stdout and stderr differ, and where the 3 from `echo $?` came from. After the broken compile you can point at the file, line and column in clang's message, `echo $?` printed a nonzero status, and `ls` showed no `hello` file.

## A build script with warnings

Typing compiler flags by hand stops working after the third flag. Put them in a shell script, `build.sh`, that every project in the book copies and grows. You can read every flag in it, and it runs the same way on the Mac and in Linux. Each program is one translation unit: one `.c` file handed to the compiler. When a program grows, `main.c` will `#include` its other `.c` files, so a single compiler call still sees the whole program. Handmade Hero is built this way. Builds of this size finish in well under a second.

clang accepts a lot of code that is almost certainly wrong. Warnings report it. `-Wall -Wextra` turn on the common set. `-Wconversion` reports implicit conversions that can change a value, such as a `double` cut down to an `int`. `-Wdouble-promotion` reports a `float` quietly widened to `double`. `-Werror` turns every warning into an error. The book uses it so that a warning stops the build and you fix it on the spot.

The script makes two kinds of build. The debug build turns optimization off with `-O0`, records full debug information with `-g3`, and turns sanitizers on. The sanitizer flags get their own step once the Linux machine is up. The release build uses `-O2` and `-DNDEBUG` with no sanitizers. Use it only to measure speed, after the debug build passes. `-DNDEBUG` deletes every `assert(...)` from the program, along with any work written inside it.

### Study

- [Chris Wellons: My favorite C compiler flags during development](https://nullprogram.com/blog/2023/04/29/) (read, 25 min): Read the whole post. Skip the MSVC parts, which apply to Windows, and the paragraph on Thread Sanitizer, which belongs to "Concurrency and parallelism". "Dynamic run-time checks" comes back in the sanitizer step. Wellons also turns off two unused-code warnings. You may copy that once they get in your way.
- [Clang: Diagnostic flags](https://clang.llvm.org/docs/DiagnosticsReference.html) (reference, as needed): Look up a warning by the name clang prints in brackets, such as `-Wfloat-conversion`.

### Build

Save this as `build.sh` in the project root and commit it:

```sh
#!/bin/sh
# usage: sh build.sh [name] [release]
# Builds src/<name>.c into out/<os>-<mode>/<name>. Default name is main.
set -e
name=${1:-main}
mode=${2:-debug}
cc=${CC:-clang}
out=out/$(uname -s)-$mode
mkdir -p "$out"

warn="-Wall -Wextra -Wconversion -Wno-sign-conversion -Wdouble-promotion -Werror"
if [ "$mode" = release ]; then
    flags="-O2 -DNDEBUG"
else
    flags="-g3 -O0 -fsanitize=${SAN:-address,undefined} -fno-sanitize-recover=undefined"
fi

$cc -std=gnu11 $warn $flags -o "$out/$name" "src/$name.c"
echo "built $out/$name ($mode, $cc)"
```

`-std=gnu11` selects C11 plus the POSIX and GNU declarations that Linux hides in strict `-std=c11` mode. Later chapters call functions such as `clock_gettime` and `mmap` that need them. `set -e` stops the script at the first failing command. `${CC:-clang}` uses the `CC` variable when you set one and `clang` otherwise. The same goes for `SAN`. `uname -s` prints `Darwin` on macOS and `Linux` in Linux, so the two machines write to different directories.

Run `sh build.sh` and `./out/Darwin-debug/main`.

Next, write `src/w.c` with two planted problems:

```c
#include <assert.h>
#include <stdio.h>

int main(void) {
    int unused;
    double ratio = 2.75;
    int whole = ratio;
    assert(puts("assert ran") >= 0);
    printf("%d\n", whole);
    return 0;
}
```

Run `sh build.sh w`. Read both errors, then fix them: delete `unused` and write `int whole = (int)ratio;`. Build and run the debug and the release version (`sh build.sh w release`, then `./out/Darwin-release/w`).

### Done when

`sh build.sh` and `sh build.sh main release` both finish with no output from clang. The first build of `w.c` failed with one error for `unused` and one for the conversion. After the fix, the debug build prints "assert ran" and the release build does not. You can say what each flag in `build.sh` does.

## A Linux machine next to the Mac

Much of this book runs on Linux. The operating systems, driver and networking chapters use Linux system calls and tools that macOS does not have. LeakSanitizer, which lists memory your program never freed, runs by default on Linux. Apple's clang does not ship it, so the Mac build never checks for leaks. You need a Linux machine this week.

OrbStack runs Linux in a light virtual machine on the Mac. On Apple Silicon it creates ARM64 machines unless you ask for Intel, so Linux runs the same instruction set as macOS. `uname -m` prints `arm64` on the Mac and `aarch64` in Linux. Both names mean ARM64. The x86-64 work comes in "Assembly, the ABI and linking".

The Linux machine sees your Mac files under `/mnt/mac`. Keep one project directory on the Mac, edit there, and build from either side:

```
  Mac (arm64, macOS)                      Linux machine "lab" (aarch64, Ubuntu)
  ~/code/hello/                           /mnt/mac/Users/<you>/code/hello/
    src/  build.sh   <---- same files ---->   src/  build.sh
    out/Darwin-debug/                       out/Linux-debug/
  clang, lldb                             clang, gcc, lldb, gdb
```

On Ubuntu, clang's sanitizer runtime comes in a separate package, `libclang-rt-dev`. Without it a debug build fails at the link step with "cannot find ... libclang_rt.asan". The `llvm` package provides `llvm-symbolizer`, which turns the addresses in a sanitizer report into file and line numbers. `gcc` from `build-essential` brings its own sanitizer runtime.

### Study

- [OrbStack: Linux machines](https://docs.orbstack.dev/machines/) (read, 15 min): Read the top of the page, "File transfer" and "Machine creation". Skip "Intel (x86) emulation" until "Assembly, the ABI and linking".
- [OrbStack: Commands](https://docs.orbstack.dev/machines/commands) (reference, as needed): `orb` opens a shell in the default machine, `orb -m <name>` in a named one, and `orb list` lists them.

### Build

Install OrbStack with `brew install orbstack` or from its website, open it once, then create and enter an Ubuntu 24.04 machine. `ubuntu:noble` pins that release so the package names below match.

```sh
orb create ubuntu:noble lab
orb -m lab
```

Inside the machine:

```sh
uname -m
sudo apt update
sudo apt install -y build-essential clang lldb llvm libclang-rt-dev gdb
cd /mnt/mac/Users/<you>/code/hello
sh build.sh && ./out/Linux-debug/main; echo $?
CC=gcc sh build.sh && ./out/Linux-debug/main; echo $?
```

Back on the Mac, run `git status`. It should not list `out/`.

### Done when

`uname -m` prints `aarch64` in the machine. The same commit builds with clang on the Mac, and with clang and with gcc in Linux, with no warnings, and all three binaries print both lines and exit with status 3. You can say which sanitizer checks run on the Mac and which run only in Linux.

## Sanitizers: memory and undefined behavior at run time

The compiler checks what it can see in the source. Many C bugs only appear while the program runs: reading past the end of an array, reading memory after it was freed, never freeing memory, an `int` overflowing. C checks none of these. The program carries on with a wrong value or crashes later somewhere unrelated. A sanitizer is checking code the compiler adds around memory accesses and arithmetic. When a check fails, the program stops with a report.

- AddressSanitizer (ASan, `-fsanitize=address`) finds out-of-bounds reads and writes on the stack and the heap, and use after free. On Linux it also runs LeakSanitizer when the program exits.
- UndefinedBehaviorSanitizer (UBSan, `-fsanitize=undefined`) finds signed overflow, bad shifts, out-of-range indexes into arrays of known size and more. By default UBSan prints and continues. `-fno-sanitize-recover=undefined` in `build.sh` makes it stop at the first error.

An ASan report reads top down. This one is shortened, and your addresses will differ:

```
ERROR: AddressSanitizer: heap-use-after-free on address 0x5020...  <- what went wrong
READ of size 4 at 0x5020... thread T0
    #0 in use_after_free src/bugs.c:23                             <- the bad access
    #1 in main src/bugs.c:47
freed by thread T0 here:
    #0 in free
    #1 in release src/bugs.c:16                                    <- who freed it
previously allocated by thread T0 here:
    #0 in malloc
    #1 in use_after_free src/bugs.c:20                             <- who allocated it
```

A sanitized program runs about twice as slow, which is fine for debug builds. ASan and UBSan both run on macOS, as the Supported Platforms section of the ASan page says. That page also offers leak detection on macOS through `ASAN_OPTIONS=detect_leaks=1`, but Apple's clang does not support it. Do all leak checks in Linux.

Return to "Dynamic run-time checks" in Wellons' post from the build script step. He prefers UBSan's trap mode. This chapter keeps the printed reports while you learn to read them. Note his `ASAN_OPTIONS` line. The debugger step uses it.

### Study

- [Clang: AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html) (read, 20 min): Read Introduction, Usage, Symbolizing the Reports, "Memory leak detection" under Additional Checks, and Supported Platforms. The example is C++. Read `new` as `malloc` and `delete[]` as `free`. Skip the rest.
- [Clang: UndefinedBehaviorSanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) (reference, as needed): Usage, and the list under "Available checks" when a report names a check you do not recognize.

### Build

Save this as `src/bugs.c`. It holds four bugs, one per argument:

```c
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int out_of_bounds(void) {
    int a[4] = {1, 2, 3, 4};
    int sum = 0;
    for (int i = 0; i <= 4; i++) {
        sum += a[i];
    }
    return sum;
}

static void release(int *p) {
    free(p);
}

static int use_after_free(void) {
    int *p = malloc(sizeof *p);
    *p = 7;
    release(p);
    return *p;
}

static int leak(void) {
    int total = 0;
    for (int i = 0; i < 3; i++) {
        char *s = malloc(32);
        strcpy(s, "never freed");
        total += (int)strlen(s);
    }
    return total;
}

static int add_one(int x) {
    return x + 1;
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: bugs 1|2|3|4\n");
        return 2;
    }
    switch (argv[1][0]) {
    case '1': printf("%d\n", out_of_bounds()); break;
    case '2': printf("%d\n", use_after_free()); break;
    case '3': printf("%d\n", leak()); break;
    case '4': printf("%d\n", add_one(INT_MAX)); break;
    default:  fprintf(stderr, "unknown bug %s\n", argv[1]); return 2;
    }
    return 0;
}
```

In Linux, run `sh build.sh bugs`, then `./out/Linux-debug/bugs 1` through `4`, with `echo $?` after each. For every run, note the kind of error and the line of `bugs.c` it blames. Then:

1. Run 1 is caught by UBSan's bounds check. Rebuild with `SAN=address sh build.sh bugs` and run 1 again to see ASan report the same bug as a stack-buffer-overflow. Rebuild with the default afterwards.
2. Build the release version with `sh build.sh bugs release` and run all four. They exit with status 0 and print no report. Use clang for this one. gcc rejects `bugs.c` at `-O2` under `-Werror`, because its optimizer spots the out-of-bounds loop and the use after free at compile time.
3. Repeat the four debug runs with `CC=gcc sh build.sh bugs`.
4. Copy `bugs.c` to `src/fixed.c` and fix the four bugs in the copy. Keep `bugs.c` as it is. The next step uses it. In `out_of_bounds`, loop while `i < 4`. In `use_after_free`, read `*p` into a local before `release(p)` and return the local. In `leak`, call `free(s)` after the `strlen` line. In `main`, call `add_one(41)`.
5. On the Mac, build `bugs` and run the four debug runs. Runs 1, 2 and 4 stop with reports. Run 3 prints 33 with no leak report.

### Done when

In Linux, each of the four debug runs of `bugs` stops with a report that blames the right line and exits with a nonzero status, under clang and under gcc. Run 3 prints a LeakSanitizer report that points at the `malloc` in `leak`. The release runs exit with 0 and report nothing, even where the number they print is wrong. `fixed` prints 10, 7, 33 and 42 for arguments 1 to 4 with no reports, under both compilers. For the use-after-free report, you can name the line that freed the memory and the line that allocated it.

## The debugger

Sanitizers catch code that breaks a rule of the language. A program can follow every rule and still compute the wrong answer. For that you stop the program and look. A debugger runs your program under its control. You set a breakpoint on a function or a line, and the program stops there. Then you print variables, step one line at a time and walk up the call stack. A watchpoint stops the program each time a variable changes, which finds the line that wrote a bad value without stepping through everything before it.

The debug build gives the debugger what it needs. `-g3` records which machine code belongs to which source line and where each variable lives. `-O0` keeps every variable in memory. In an optimized build the debugger often shows variables as "optimized out".

On the Mac you use `lldb`. In Linux you use `gdb`, the standard Linux debugger. They share ideas and most short commands:

```
lldb                           gdb                what it does
b sum                          b sum              breakpoint on function sum
b scores.c:6                   b scores.c:6       breakpoint on a line
r                              r                  run the program
n / s / finish                 n / s / finish     next line, step into, run to the end of the function
v                              info locals        all local variables in this frame
p total                        p total            print one expression
bt                             bt                 call stack
up / down                      up / down          move to the caller's frame and back
watchpoint set variable total  watch total        stop whenever total changes
x/5dw &scores                  x/5dw &scores      five 4-byte words from memory, in decimal
c                              c                  continue
```

### Study

- [LLDB: Tutorial](https://lldb.llvm.org/use/tutorial.html) (read, 20 min): Read Command Structure, Setting Breakpoints, Setting Watchpoints, Controlling Your Program and Examining Stack Frame State. The examples are mostly Objective-C, so skip the `self`, `isa` and `NSString` details. Skip Loading a Program Into LLDB, Breakpoint Names, Starting or Attaching to Your Program and Examining Thread State.
- [LLDB: GDB to LLDB command map](https://lldb.llvm.org/use/map.html) (reference, as needed): Keep it open in Linux to translate between the two debuggers. Examining Variables covers `frame variable`, which `v` abbreviates, and `p`. Examining Thread State covers `bt`, `up`, `down`, `frame select` and `x/`.

### Build

Save this as `src/scores.c`. The total of the five scores is 410 and the mean is 82, but the program prints something else:

```c
#include <stdio.h>

static int sum(const int *a, int n) {
    int total = 0;
    for (int i = 1; i < n; i++) {
        total += a[i];
    }
    return total;
}

int main(void) {
    int scores[5] = {90, 72, 85, 64, 99};
    int n = 5;
    int total = sum(scores, n);
    printf("total %d, mean %d\n", total, total / n);
    return 0;
}
```

On the Mac, build it with `sh build.sh scores` and start `lldb ./out/Darwin-debug/scores`. Find the bug without adding any `printf`:

1. `b sum`, `r`, then `v`. Step with `n` and print `i` and `total` after each step.
2. Restart with `r`. At the breakpoint, run `watchpoint set variable total`, then `c` until the program ends. Write down the old and new value at each stop. The first change shows which score never got added.
3. Restart once more. Stop in `sum`, run `bt`, `up`, and `x/5dw &scores` to see the five scores in memory, then `down`.
4. Fix the loop and confirm the program prints `total 410, mean 82`.

In Linux, start gdb with `ASAN_OPTIONS=detect_leaks=0 gdb ./out/Linux-debug/scores` and repeat steps 1 to 3, using the map to translate. LeakSanitizer cannot run under a debugger. Without that option it prints a fatal error when the program exits, and the exit status turns to 1. Then watch a sanitizer report from inside the debugger. Wellons' `abort_on_error=1` option makes ASan call `abort` after its report, and the debugger stops on the abort:

```sh
ASAN_OPTIONS=abort_on_error=1 gdb --args ./out/Linux-debug/bugs 2
```

`--args` hands the rest of the line to the program as its arguments. Type `r`, then `bt`. The top frames are inside the sanitizer runtime. Find the frame for `use_after_free`, move to it with `frame <number>`, and print the pointer with `p p`.

### Done when

You found the `scores.c` bug with the watchpoint, and the fixed program prints `total 410, mean 82`. In gdb you reached the `use_after_free` frame from an ASan abort and printed `p`. You can set a breakpoint, step, print, show the call stack and set a watchpoint in both debuggers, looking up nothing but the command map.

## Where this leads

You have a project layout, one build script with warnings and sanitizers, two ARM64 machines that build the same files, and a debugger on each. Every C chapter in this book uses that loop: edit, `sh build.sh`, run, then read the sanitizer report or step through the program in the debugger. Commit after every step that works.

You cannot write C of your own yet. Every program in this chapter came ready-made. The next chapter, "C foundations", opens by adding one piece to this loop: a small test program per source file, run by a script, whose exit status says whether every check passed. Then it teaches pointers, strings and heap memory by having you write a linked list, a growable array and a word counter. The sanitizers check them for memory bugs, LeakSanitizer in the Linux machine checks that you freed everything, and the debugger shows you the pointers. It ends by matching three of your functions to the ARM64 assembly clang produces for them.
