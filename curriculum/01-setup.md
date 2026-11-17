---
id: 01
title: Setup and tools
part: The machine and C
weeks: 1
project: A working C toolchain in Ubuntu 24.04 under WSL2, with clang and gcc, a build script, sanitizers and a debugger.
---

You know Python, git and a terminal. This book takes you from there to a tensor library you write yourself, by way of C, hardware, assembly, operating systems, compilers and GPUs. Every chapter after this one asks you to write C, run it, and find out why it did what it did. This chapter sets up the tools for that loop before you know any C. By the end of the week one build script compiles C with clang and with gcc in Ubuntu under WSL2, sanitizers stop the program at memory bugs, and you can pause a program in a debugger and read its variables. The C programs in this chapter are short and given to you. The next chapter teaches you to write them.

The book works build first. Each chapter has a project and each step has a Build. Start the Build with what you already know. When you get stuck on something specific, read the Study item that covers it, and only the sections the scope note names. Then check the claim on the machine: step through it in the debugger, look at the assembly, or measure it. Do not take a statement about memory, the compiler or the hardware on trust when you can watch it happen.

Plan on about 12 hours a week. Spend roughly 60 percent of that on the project with the debugger open, 25 percent on the reading for the step you are stuck on, and the rest on small experiments with code you wrote but do not fully understand. Put the longest uninterrupted block of the week on the hardest part of the build. Once a week, write a few lines in your notes on what you built and what confused you. The next week starts from that note.

A step ends when its "Done when" check passes. Finishing the reading does not end a step, and an unfinished reading does not block one. A chapter ends when the project works and you can explain how it works. Extra work that a step marks as optional never blocks the next chapter. If your WSL2 Ubuntu already compiles C, run each step's "Done when" check first and skip the steps that pass.

## Hello from the shell

Every command in this book runs in Ubuntu 24.04 under WSL2 on your Windows laptop. WSL2 runs a real Linux kernel in a light virtual machine that Windows manages, so Linux programs, system calls and tools behave as they do on a Linux PC. The CPU is your laptop's x86-64 CPU. Install WSL2 and Ubuntu first. `wsl --install` on its own installs whatever Ubuntu release is newest, so name the release with `-d Ubuntu-24.04`. The package names in this book are the ones Ubuntu 24.04 uses. If the install stops with error `0x80370102`, virtualization is turned off. Turn it on in the laptop's firmware settings (the BIOS or UEFI setup screen), restart, and run the command again. Microsoft's [WSL troubleshooting page](https://learn.microsoft.com/en-us/windows/wsl/troubleshooting) lists that error and the other install failures.

The shell starts every program you run in this book and gets three things back from it. Standard output (stdout) carries the results. Standard error (stderr) carries diagnostics, so when you redirect the results to a file the errors still reach your screen. The exit status is a small integer. Zero means success and any other value means failure. In C, the value `main` returns becomes the exit status, and the shell keeps it in `$?` until the next command runs.

A C program goes through a compiler before it runs. `clang` reads your source file, turns it into machine code for your CPU and writes an executable file. Two kinds of failure look alike at first. A compile error comes from clang, names a file, line and column, and leaves no new executable behind. A run-time failure comes from your program after it started, as text on stderr, a nonzero exit status or a crash. Keep the two apart from the first day.

You type `./hello` with a `./` in front. For a bare name like `clang`, the shell searches the directories listed in the `PATH` variable, and your project directory is not one of them. `./hello` is a relative path that starts in the working directory, the directory `pwd` prints.

Ubuntu splits the toolchain into packages. `build-essential` brings gcc, `make` and the C library headers. `clang` and `gdb` are the compiler and the debugger this chapter uses. clang's sanitizer runtime is the separate package `libclang-rt-dev`. apt normally pulls it in with clang. When apt skips recommended packages, the runtime is missing and a debug build from the next step fails at the link step with `cannot find .../libclang_rt.asan-x86_64.a`. The install line names the package so that this cannot happen. The `llvm` package provides `llvm-symbolizer`, which turns the addresses in a sanitizer report into file and line numbers. gcc brings its own sanitizer runtime. `clangd` gives the editor in the third step clang's view of your code. Ubuntu's WSL image leaves out the manual pages for the C library and the system calls. `manpages-dev` puts them back, so `man 3 printf` and `man 2 write` work.

### Study

- [Microsoft: Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install) (do, 30 min): "Prerequisites", "Install WSL command", "Change the default Linux distribution installed", "Set up your Linux user info" and "Check which version of WSL you are running". Skip the upgrade, multiple-distribution and preview sections.
- [Missing Semester 2026: Command-line Environment](https://missing.csail.mit.edu/2026/command-line-environment/) (read, 20 min): Under "The Command Line Interface", read Arguments, Streams, Environment variables and Return codes. Streams and Return codes give the redirection and `&&`/`||` syntax the Build uses. Skim the parts that repeat what you already know, and skim the globbing and `fzf` passages. Skip Signals for now and everything from "Remote Machines" on.
- [Beej's Guide to C: Hello, World!](https://beej.us/guide/bgc/html/split/hello-world.html) (read, 25 min): Sections 2.1 to 2.4 and 2.7. Skip 2.6 on IDEs. Skip 2.5 too, which is about macOS. 2.4 shows the build command with `gcc`. `clang` takes the same arguments, and in Ubuntu the two are separate compilers. Use `clang` until the third step puts gcc next to it. 2.7 says Beej writes for C23. This book compiles C11 with GNU extensions, set in the next step. Where Beej uses a C23 feature he also shows the older form, so use that one.

### Build

In PowerShell, opened with "Run as administrator", install WSL and Ubuntu, then restart Windows:

```
wsl --install -d Ubuntu-24.04
```

Open Ubuntu from the Start menu or as a tab in Windows Terminal and create your Linux user. Then install the tools, tell git who you are, and make the project directory in your Linux home directory. Ubuntu's git does not read the settings of Git for Windows, and `git commit` refuses to run with "Author identity unknown" until you set both values. The third step explains why the project lives under `~` and how Windows programs reach it.

```sh
sudo apt update
sudo apt install -y build-essential clang gdb llvm libclang-rt-dev clangd manpages-dev git
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
mkdir -p ~/code/hello && cd ~/code/hello
```

Edit files with `nano` for now. Ctrl+O saves and Ctrl+X quits. The third step connects an editor on Windows.

Run `git init`, and add a `.gitignore` that contains the line `out/`. Write `src/main.c`:

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

`wsl -l -v` in PowerShell lists `Ubuntu-24.04` with version 2, and `uname -m` in Ubuntu prints `x86_64`. Your predictions for all seven commands matched, or you can explain each one that did not. You can say in one sentence each what the working directory is, why `./hello` needs the `./`, how stdout and stderr differ, and where the 3 from `echo $?` came from. After the broken compile you can point at the file, line and column in clang's message, `echo $?` printed a nonzero status, and `ls` showed no `hello` file.

## A build script with warnings

Past three flags you will want them in a script. Put them in a shell script, `build.sh`, that every project in the book copies and grows. You can read every flag in it, and it runs the same way with clang and with gcc. Each program is one translation unit: one `.c` file handed to the compiler. When a program grows, `main.c` will `#include` its other `.c` files, so a single compiler call still sees the whole program. Handmade Hero is built this way. Builds of this size finish in well under a second.

clang accepts a lot of code that is almost certainly wrong. Warnings report it. `-Wall -Wextra` turn on the common set. `-Wconversion` reports implicit conversions that can change a value, such as a `double` cut down to an `int`. `-Wdouble-promotion` reports a `float` quietly widened to `double`. `-Werror` turns every warning into an error. The book uses it so that a warning stops the build and you fix it on the spot.

The script makes two kinds of build. The debug build turns optimization off with `-O0`, records full debug information with `-g3`, and turns sanitizers on. The sanitizer flags get their own step after the next one. The release build uses `-O2` and `-DNDEBUG` with no sanitizers. Use it only to measure speed, after the debug build passes. `-DNDEBUG` deletes every `assert(...)` from the program, along with any work written inside it.

### Study

- [Chris Wellons: My favorite C compiler flags during development](https://nullprogram.com/blog/2023/04/29/) (read, 25 min): Read the post except the MSVC and `cl` parts and the Thread Sanitizer paragraph. The MSVC and `cl` parts cover Microsoft's compiler on Windows, and you compile inside Linux. Thread Sanitizer belongs to "Concurrency and parallelism". The sanitizer step comes back to "Dynamic run-time checks". Wellons also turns off two unused-code warnings. You may copy that once they get in your way.
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

`-std=gnu11` selects C11 plus the POSIX and GNU declarations that Linux hides in strict `-std=c11` mode. Later chapters call functions such as `clock_gettime` and `mmap` that need them. `set -e` stops the script at the first failing command. `${CC:-clang}` uses the `CC` variable when you set one and `clang` otherwise. The same goes for `SAN`. `uname -s` prints the name of the kernel, `Linux`, so your builds land in `out/Linux-debug` and `out/Linux-release`. A build on another operating system lands in a directory of its own.

Run `sh build.sh` and `./out/Linux-debug/main`.

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

Run `sh build.sh w`. Read both errors, then fix them: delete `unused` and write `int whole = (int)ratio;`. Build and run the debug and the release version (`sh build.sh w release`, then `./out/Linux-release/w`).

### Done when

`sh build.sh` and `sh build.sh main release` both finish with no output from clang. The first build of `w.c` failed with one error for `unused` and one for the conversion. After the fix, the debug build prints "assert ran" and the release build does not. `git status` does not list `out/`. You can say what each flag in `build.sh` does.

## A second compiler and the Windows side

Ubuntu gives you two C compilers. You have used clang so far. gcc came with `build-essential`, and in Ubuntu the plain `cc` command runs gcc. The two compilers accept the same flags in `build.sh` but are separate programs with separate optimizers and separate warnings. A bug that one of them misses, the other sometimes reports. Later chapters read the assembly both of them produce, and Linux itself, which a later chapter compiles, builds with gcc. From now on, build every program with both before you call it done. They write to the same `out/Linux-debug`, so the last build wins, and the last line of `build.sh` says which compiler made it.

Your files can live in two places. Ubuntu's own file system sits in a virtual disk that WSL2 manages, and your home directory, `/home/<you>`, is on it. Windows reaches those files at `\\wsl$\Ubuntu-24.04\home\<you>`. Going the other way, Ubuntu sees your Windows drives under `/mnt/c`, `/mnt/d` and so on. Every file operation on `/mnt/c` crosses between the virtual machine and Windows, which makes builds and `git` slow there. Keep projects in your Linux home directory and let Windows programs reach in:

```
  Windows side                         Ubuntu 24.04 in WSL2 (x86_64)

  C:\Users\<you>\           <---->     /mnt/c/Users/<you>/      slow, no projects here
  \\wsl$\Ubuntu-24.04\home\
    <you>\code\hello\       <---->     ~/code/hello/            fast, projects here
                                         src/  build.sh  out/Linux-debug/
  File Explorer             <------    explorer.exe .
  VS Code window            <------    code .   (starts the VS Code server)
                                       clang, gcc, gdb, git
```

Windows programs run from the Ubuntu shell when you type their full name with `.exe`, so `explorer.exe .` opens the current directory in File Explorer. An editor works the same way. VS Code installed on Windows with its WSL extension opens a Linux directory when you run `code .` in that directory. The window runs on Windows, and a small server inside Ubuntu does the file access, the search and the terminal. For C, add the clangd extension inside that window. It runs the `clangd` program you installed with apt, which parses each file the way clang does and shows errors, warnings, go to definition and hover in the editor. clangd does not read `build.sh`. A file named `compile_flags.txt` in the project root gives it the flags, one per line. Leave Microsoft's C/C++ extension uninstalled. It does the same job, and the clangd documentation says to remove it when you use clangd.

Line endings cause one more problem. Linux ends a line with `\n`, and many Windows tools write `\r\n`. A shell script with `\r\n` endings fails in confusing ways, because the shell reads the `\r` as part of each command. Git for Windows usually converts line endings to `\r\n` when it checks files out, so run `git` for this project inside Ubuntu only.

### Study

- [Microsoft: Working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems) (read, 10 min): "File storage and performance across file systems", "View your current directory in Windows File Explorer" and "Run Windows tools from Linux". Skip the rest.
- [VS Code: Developing in WSL](https://code.visualstudio.com/docs/remote/wsl) (do, 20 min): "Getting started" through "From the WSL terminal", then "Opening a terminal in WSL". Skip "Advanced" and "Known limitations".
- [GCC: Warning Options](https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html) (reference, as needed): gcc's counterpart to clang's diagnostic list. Look up a warning by the name gcc prints in brackets. The page documents the newest gcc, and every warning in `build.sh` exists in Ubuntu's gcc 13.

### Build

1. In the project directory, run `pwd`, `cc --version`, `gcc --version` and `clang --version`.
2. Run `CC=gcc sh build.sh && ./out/Linux-debug/main; echo $?`, then the same with `sh build.sh` for clang.
3. Put the two planted problems back into `src/w.c` and run `CC=gcc sh build.sh w`. Put gcc's two error messages next to clang's from the last step. Fix `w.c` again and build it with both compilers, in debug and in release.
4. Run `explorer.exe .` and find `build.sh` in the window that opens. Install VS Code and its WSL extension on Windows, run `code .`, and open a terminal inside VS Code. Run `uname -r` there. Edit `src/main.c` in VS Code so that it prints one more line, then build and run it from that terminal.
5. In the VS Code window, open the Extensions view, search for "clangd" and install the extension published by LLVM. Write `compile_flags.txt` in the project root with one flag per line: `-std=gnu11`, `-Wall`, `-Wextra`, `-Wconversion`, `-Wno-sign-conversion` and `-Wdouble-promotion`. Commit it. Open `src/w.c`, put `int unused;` back, and wait for the underline. Hover over it to read the warning, then delete the line again.
6. Make a copy of the script with Windows line endings and run it: `sed 's/$/\r/' build.sh > crlf.sh`, then `sh crlf.sh`. Read the error, run `file crlf.sh`, and delete the copy.
7. Optional, on the Mac: copy the project folder there (with `scp -r`, or by pushing to a private repository you made) and run `sh build.sh` with Apple's clang. `uname -s` prints `Darwin` on macOS, so the build lands in `out/Darwin-debug` and never mixes with the Linux one. ASan and UBSan work there. Apple's clang does not support LeakSanitizer on Apple Silicon, so leak checks happen in WSL2.

### Done when

`pwd` prints a path under `/home`, not `/mnt/c`. `main` built with gcc and with clang exits with status 3. You can name the warning flag that gcc and clang both print in brackets for the conversion in `w.c`. The fixed `w.c` builds with no compiler output under both compilers and both modes. `uname -r` in VS Code's terminal prints a kernel release ending in `microsoft-standard-WSL2`, and a change saved in VS Code shows up in the next build. clangd underlined `int unused;` in `w.c` with the unused-variable warning. `sh crlf.sh` stopped with `set: Illegal option -`, and you can say which character caused it.

## Sanitizers: memory and undefined behavior at run time

The compiler checks what it can see in the source. Many C bugs only appear while the program runs: reading past the end of an array, reading memory after it was freed, never freeing memory, an `int` overflowing. C checks none of these. The program carries on with a wrong value or crashes later somewhere unrelated. A sanitizer is checking code the compiler adds around memory accesses and arithmetic. When a check fails, the program stops with a report.

- AddressSanitizer (ASan, `-fsanitize=address`) finds out-of-bounds reads and writes on the stack and the heap, and use after free. On Linux it also runs LeakSanitizer when the program exits, which lists memory your program never freed.
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

A sanitized program runs about twice as slow, which is fine for debug builds. LeakSanitizer only reports a block when nothing points at it any more. It scans registers and the stack for leftover pointers, so a leak report can name fewer blocks than the program leaked. A "Direct leak" is a block nothing points at. An "Indirect leak" is a block that only leaked blocks point at, such as the later nodes of a linked list whose head was lost. Fix the direct leaks first, and the indirect ones usually go with them. If every ASan build prints `AddressSanitizer:DEADLYSIGNAL` over and over at startup and then crashes, the kernel's address randomization may be set higher than the sanitizer runtime expects. Run `sysctl vm.mmap_rnd_bits`. If it prints a number above 28, `sudo sysctl vm.mmap_rnd_bits=28` lowers it until the next `wsl --shutdown` or restart of Windows.

Return to "Dynamic run-time checks" in Wellons' post from the build script step. He prefers UBSan's trap mode. This chapter keeps the printed reports while you learn to read them. Note his `ASAN_OPTIONS` line. The debugger step uses it.

### Study

- [Clang: AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html) (read, 20 min): Read Introduction, Usage and Symbolizing the Reports. "Memory leak detection" under Additional Checks is two sentences that point to the LeakSanitizer page, the next item. The example is C++. Read `new` as `malloc` and `delete[]` as `free`. Skip the rest.
- [Clang: LeakSanitizer](https://clang.llvm.org/docs/LeakSanitizer.html) (read, 5 min): Introduction and Usage. The leak checker runs inside every ASan build on Linux. Skip Suppressions and everything after.
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

Run `sh build.sh bugs`, then `./out/Linux-debug/bugs 1` through `4`, with `echo $?` after each. For every run, note the kind of error and the line of `bugs.c` it blames. Then:

1. Run 1 is caught by UBSan's bounds check. Rebuild with `SAN=address sh build.sh bugs` and run 1 again to see ASan report the same bug as a stack-buffer-overflow. Rebuild with the default afterwards.
2. Build the release version with `sh build.sh bugs release` and run all four. They exit with status 0 and print no report. Use clang for this one. gcc rejects `bugs.c` at `-O2` under `-Werror`, because its optimizer spots the out-of-bounds loop and the use after free at compile time. Run `CC=gcc sh build.sh bugs release` once to read those two errors.
3. Repeat the four debug runs with `CC=gcc sh build.sh bugs`. Compare the leak summary line of run 3 under both compilers. gcc reports 96 bytes in 3 allocations. clang reports 64 bytes in 2, because a copy of the last pointer is still in a register or on the stack when the program exits.
4. Copy `bugs.c` to `src/fixed.c` and fix the four bugs in the copy. Keep `bugs.c` as it is. The next step uses it. In `out_of_bounds`, loop while `i < 4`. In `use_after_free`, read `*p` into a local before `release(p)` and return the local. In `leak`, call `free(s)` after the `strlen` line. In `main`, call `add_one(41)`.

### Done when

Each of the four debug runs of `bugs` stops with a report that blames the right line and exits with a nonzero status, under clang and under gcc. Run 3 prints a LeakSanitizer report that points at the `malloc` in `leak`. The release runs exit with 0 and report nothing, even where the number they print is wrong. `fixed` prints 10, 7, 33 and 42 for arguments 1 to 4 with no reports, under both compilers. For the use-after-free report, you can name the line that freed the memory and the line that allocated it.

## The debugger

Sanitizers catch code that breaks a rule of the language. A program can follow every rule and still compute the wrong answer. For that you stop the program and look. A debugger runs your program under its control. You set a breakpoint on a function or a line, and the program stops there. Then you print variables, step one line at a time and walk up the call stack. A watchpoint stops the program each time a variable changes, which finds the line that wrote a bad value without stepping through everything before it.

The debug build gives the debugger what it needs. `-g3` records which machine code belongs to which source line and where each variable lives. `-O0` keeps every variable in memory. In an optimized build the debugger often shows variables as "optimized out".

The debugger is gdb, the standard debugger on Linux. Most commands have a short form:

```
b sum                breakpoint on function sum
b scores.c:6         breakpoint on a line
r                    run the program, or restart it from the beginning
n / s / finish       next line, step into, run to the end of the function
info locals          all local variables in this frame
p total              print one expression
bt                   call stack
up / down            move to the caller's frame and back
frame 3              move to frame 3 of the call stack
watch total          stop whenever total changes
x/5dw &scores        five 4-byte words from memory, in decimal
c                    continue
```

Ubuntu's gdb asks "Enable debuginfod for this session?" the first time a program starts. A `y` downloads debug information for system libraries such as the C library from Ubuntu's servers. Your own program carries its debug information, and this chapter needs nothing more, so answer `n`. Put `set debuginfod enabled off` in `~/.gdbinit` to stop the question.

### Study

- [Dive Into Systems: 3.1 Debugging with GDB](https://diveintosystems.org/book/C3-C_debug/gdb.html) (read, 30 min): 3.1.1 and the `badprog.c` example session, then skim the `segfaulter.c` session. Dive Into Systems is a free textbook by Matthews, Newhall and Webb that the next chapter uses again.
- [Dive Into Systems: 3.2 GDB Commands in Detail](https://diveintosystems.org/book/C3-C_debug/gdb_commands.html) (reference, as needed): 3.2.2, where `x` and its format letters are under "Commands for Examining and Evaluating Program State and Expressions". It does not list `watch`, `up`, `down` or `finish`. The table above covers those.
- [GDB manual: 5.1.2 Setting Watchpoints](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Set-Watchpoints.html) (reference, as needed): Hardware against software watchpoints, and why gdb deletes a watchpoint on a local variable when its function returns.

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

Build it with `sh build.sh scores` and start gdb with `ASAN_OPTIONS=detect_leaks=0 gdb ./out/Linux-debug/scores`. LeakSanitizer cannot run under a debugger. Without that option it prints a fatal error when the program exits, and the exit status turns to 1. Find the bug without adding any `printf`:

1. `b sum`, `r`, then `info locals`. Step with `n` and print `i` and `total` after each step.
2. Restart with `r` and answer `y` when gdb asks whether to start from the beginning. At the breakpoint, run `watch total`, then `c` until the program ends. Write down the old and new value at each stop. gdb shows the line after the one that wrote the value. At the first stop, `total` changes to 0 from whatever was in memory before. The next one shows which score never got added. When `sum` returns, gdb deletes the watchpoint and says so.
3. Restart once more. Stop in `sum`, run `bt`, `up`, and `x/5dw &scores` to see the five scores in memory, then `down`.
4. Fix the loop and confirm the program prints `total 410, mean 82`.

Then watch a sanitizer report from inside the debugger. Wellons' `abort_on_error=1` option makes ASan call `abort` after its report, and the debugger stops on the abort:

```sh
ASAN_OPTIONS=abort_on_error=1 gdb --args ./out/Linux-debug/bugs 2
```

`--args` hands the rest of the line to the program as its arguments. Type `r`, then `bt`. The top frames are inside the C library's `abort` and the sanitizer runtime. Find the frame for `use_after_free`, move to it with `frame <number>`, and print the pointer with `p p`.

### Done when

You found the `scores.c` bug with the watchpoint, and the fixed program prints `total 410, mean 82`. You reached the `use_after_free` frame from an ASan abort and printed `p`. You can set a breakpoint, step, print, show the call stack and set a watchpoint in gdb, looking up nothing but the table above and the Dive Into Systems command list.

## Where this leads

You have a project layout in your Linux home directory, one build script with warnings and sanitizers that runs with clang and with gcc, an editor on Windows that works on those files and shows clang's warnings as you type, and gdb. Every C chapter in this book uses that loop: edit, `sh build.sh`, run, then read the sanitizer report or step through the program in gdb. Commit after every step that works.

You cannot write C of your own yet. Every program in this chapter came ready-made. The next chapter, "C foundations", opens by adding one piece to this loop: a small test program per source file, run by a script, whose exit status says whether every check passed. Then it teaches pointers, strings and heap memory by having you write a linked list, a growable array and a word counter. The sanitizers check them for memory bugs, LeakSanitizer checks that you freed everything, and gdb shows you the pointers. It ends by matching three of your functions to the x86-64 assembly the compiler produces for them.
