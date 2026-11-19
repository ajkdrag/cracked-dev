---
id: 01
title: How a program runs
part: The machine and C
weeks: 2
project: A build script whose every flag you can explain, a program stopped by a sanitizer, and a bug found in the debugger.
---

Chapter 00 ended with `a.out`, a program you compiled from `hello.c` and ran with `./a.out`. You typed those commands on trust. This chapter explains what happened, from the bottom up: what the bytes in `a.out` are, how the CPU runs them, what the operating system and the shell do to start a program, and what the compiler does before any of that.

The second half gives you the three tools that every later chapter uses. A build script compiles each program with warnings turned on. Sanitizers stop a program at the line where it touches memory it does not own. A debugger, gdb, stops a program anywhere you like so you can read its variables. By the end you can explain every flag in the build script, read a sanitizer report, and find a bug in gdb without adding a single `printf`.

The C programs in this chapter are short and given to you, with every new line explained. The next chapter teaches you to write your own. Work in `~/code/hello`, the directory from chapter 00.

## Bits, bytes and hexadecimal

Everything a computer stores is a number: your source code, the program clang writes, every letter you print. The tools in this book show you those numbers in a compact form, and this step teaches you to read it.

A **bit** is one binary digit, 0 or 1. A **byte** is eight bits. Eight bits have 256 different patterns, so one byte holds a whole number from 0 to 255. Each bit position is worth twice the one to its right, from 1 at the right end up to 128 at the left. You add up the positions that hold a 1.

Long rows of bits are hard to read, so tools print bytes in **hexadecimal** (hex), which is base 16. Hex uses the digits 0 to 9 and then `a` to `f` for 10 to 15. One hex digit stands for exactly four bits, so every byte is exactly two hex digits. A `0x` in front marks a number as hex: `0x68` is 6 × 16 + 8 = 104.

![The byte 01101000: its bit positions add up to 104, and its two groups of four bits are the hex digits 6 and 8.](figures/01-byte.svg)

A text file is a row of bytes, one per character for plain English text. **ASCII** is the agreed table that maps characters to numbers: `h` is 104 (`0x68`) and a newline is 10 (`0x0a`).

Numbers that can be negative use the same bits with one change. A number type that can hold negative values is **signed**, and one that cannot is **unsigned**. C's `int` is signed and takes 4 bytes, 32 bits. Its leftmost bit counts as -2147483648 instead of +2147483648, and the other 31 bits count as usual. So `0x7fffffff` is 2147483647, the largest `int`, and one more gives the bits `0x80000000`, which read as -2147483648.

![Adding 1 to the int 0x7fffffff gives the bits 0x80000000, and because the leftmost bit counts as -2147483648, the int reads as -2147483648.](figures/01-signed.svg)

### Study

- [Dive Into Systems: 4. Binary and Data Representation](https://diveintosystems.org/book/C4-Binary/index.html) (read, 45 min): The chapter introduction on this page, then follow "Next" to 4.1 "Number Bases and Unsigned Integers" and 4.2 "Converting Between Bases". Stop before 4.3, which chapter 04 assigns. The introduction mentions C variable declarations, which chapter 02 teaches. Dive Into Systems is a free textbook by Matthews, Newhall and Webb, and this book uses it again.

### Build

1. Run `printf 'hi\n' > hi.txt`. The shell's `printf` writes the text, with `\n` as a newline, into the file `hi.txt`.
2. Run `od -A d -t x1z hi.txt`. `od` prints the bytes of a file. `-t x1z` asks for each byte as two hex digits followed by the characters, and `-A d` numbers the bytes in decimal at the start of each line. You should see:

   ```
   0000000 68 69 0a                                         >hi.<
   0000003
   ```

3. By hand, write `0x69` in binary and in decimal. Check with `python3 -c 'print(0x69, bin(0x69))'`.
4. Run `od -A d -t x1z hello.c | head -3` and find the bytes of `#include`. `| head -3` keeps only the first three lines of the output.
5. Check the signed numbers from the figure: `python3 -c 'print(0x7fffffff, 0x80000000 - 2**32)'` prints the value of each bit pattern as an `int`.

> **Optional:** Files written by Windows programs often end each line with two bytes, `0x0d 0x0a`, where Linux uses only `0x0a`. Chapter 03 comes back to this.

### Done when

You can say what each of the three bytes of `hi.txt` stands for, and what the `0000003` on the last line counts. You can convert any byte between binary, hex and decimal on paper and check it with Python. You can say why the bits `0x80000000` read as -2147483648 in an `int`.

## Memory and the CPU

A program is bytes too. Before it runs, its bytes are copied into memory, and the CPU works through them one instruction at a time. This step gives you that picture, without detail. Chapter 03 builds a CPU from logic gates.

**Memory** is a long row of bytes. Each byte has a number, its **address**, and addresses count up from 0. Tools print addresses in hex because they get large. A value bigger than one byte, such as an `int`, sits in 4 neighboring bytes, and its address is the address of the first one.

The **CPU** runs **machine instructions**. Each instruction is a few bytes that encode one small order, such as "add these two numbers" or "copy 4 bytes from this address".

The CPU keeps a few values in **registers**, small storage slots inside the CPU itself. One register, the **program counter**, holds the address of the next instruction. The CPU reads the instruction at that address, does it, and moves the program counter on to the next one. Some instructions jump to another address instead.

![The CPU reads the instruction at the address in its program counter, runs it, and moves on, and instructions and data share the same row of memory.](figures/01-cpu-memory.svg)

Instructions and the data they work on sit in the same memory. The set of instructions a CPU understands is its **instruction set**. Yours is x86-64. Chapter 05 teaches you to read it.

### Study

- [Dive Into Systems: 5.2 The von Neumann Architecture](https://diveintosystems.org/book/C5-Arch/von.html) (read, 25 min): The introduction, 5.2.1 to 5.2.4, and 5.2.6 "The von Neumann Machine in Action". Skip the box "Word sizes through history" and 5.2.5. The book's examples use 32-bit values. Your CPU works with 64 bits at a time, which changes the sizes and nothing else.

### Build

1. In `~/code/hello`, run `objdump -d --disassemble=main a.out`. `objdump` is a tool for looking inside program files, and it is installed along with clang. `-d` turns the bytes of the program back into instruction text, which is called **disassembling**. `--disassemble=main` limits that to the function `main`. Ignore the empty "Disassembly of section" headings and find the lines under `<main>:`. They look like this:

   ```
   0000000000001140 <main>:
       1140:	55                   	push   %rbp
       1141:	48 89 e5             	mov    %rsp,%rbp
       1144:	48 83 ec 10          	sub    $0x10,%rsp
       1148:	c7 45 fc 00 00 00 00 	movl   $0x0,-0x4(%rbp)
       114f:	48 8d 3d ae 0e 00 00 	lea    0xeae(%rip),%rdi        # 2004 <_IO_stdin_used+0x4>
       1156:	b0 00                	mov    $0x0,%al
       1158:	e8 d3 fe ff ff       	call   1030 <printf@plt>
       115d:	31 c0                	xor    %eax,%eax
       115f:	48 83 c4 10          	add    $0x10,%rsp
       1163:	5d                   	pop    %rbp
       1164:	c3                   	ret
   ```

   Each line is the address of an instruction, its bytes in hex, and the instruction written as text. The names (`push`, `mov`, `%rsp` and so on) are x86-64 instruction and register names. Ignore them for now. Chapter 05 teaches them. Look only at the address and byte columns.
2. Check that each address equals the one before it plus the number of bytes on the line before it.
3. Find the `call` instruction and the last instruction, `ret`, which returns from `main`. The `call` goes to `printf@plt`, the way into the code of `printf`. The step "From source file to executable" says where that code comes from.
4. Read the note after the `#` on the `lea` line. Text after a `#` is a note from `objdump`. Here it says that the instruction refers to address `2004`, where the text `hello, world` sits. `_IO_stdin_used` is the nearest name `objdump` found, and you can ignore it.

The addresses in the listing count from the start of the program. The running program sits at a higher address, chosen when it starts.

### Done when

You can point at any instruction in the listing and say its address, its bytes and its length. You can say which address the program counter holds when the CPU fetches the instruction at `1144`, and which address it moves on to next.

## Processes

`a.out` is a file on disk. Something has to copy it into memory, point the CPU at its first instruction and clean up when it ends. The operating system does that work.

The **operating system** (OS) is the software that controls the hardware and runs programs. Its core is the **kernel**, here the Linux kernel inside WSL2. A running program is a **process**. To start one, the kernel:

1. checks that the file is a program. Linux program files start with the bytes `7f 45 4c 46`, the marker of the **ELF** format.
2. gives the process memory of its own and copies the program's instructions and data into it.
3. points the CPU at the program's first instruction.

When the process ends, the kernel takes its memory back.

![The kernel reads a.out from disk, loads it into a new process and starts it on the CPU, and the process hands its exit status back to the kernel when it ends.](figures/01-process.svg)

A process sees its memory as one long row of addresses, its **address space**. The kernel lays it out in areas, from low addresses to high:

- **code**: the program's instructions.
- **data**: values that last for the whole run, such as the text `hello, world`.
- **heap**: blocks of memory the program asks for while it runs. The heap grows toward higher addresses.
- **stack**: the memory where local variables live. Each function call gets its own piece of the stack, a **frame**, and gives it back when it returns. The stack grows toward lower addresses.

![A process's address space holds code and data at low addresses, the heap above them growing up, and the stack at high addresses growing down, with local variables such as int a[4] on the stack and malloc blocks on the heap.](figures/01-address-space.svg)

### Study

- [Operating Systems: Three Easy Pieces, chapter 4: The Abstraction: The Process](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-intro.pdf) (read, 30 min): The chapter introduction and sections 4.1 to 4.3, which are pages 1 to 4 and page 5 up to the heading 4.4. Section 4.2 lists what an OS lets you do with processes, and chapter 08 shows the real calls. Figure 4.1 on page 4 shows the same code, data, heap and stack as the figure above. OSTEP is a free operating systems textbook by Remzi and Andrea Arpaci-Dusseau, and chapter 08 uses it again.

### Build

1. Run `od -A d -t x1z -N 4 a.out`. `-N 4` stops after 4 bytes. Find the ELF marker.
2. Run `cat /proc/self/maps`. The kernel makes up the directory `/proc` on the spot, with one entry per process. `self` is the process that reads it, here `cat` itself. `maps` lists the areas of that process's address space, one per line, lowest address first, with the start and end address in hex at the front.
3. In that output, find the lines that end in `/usr/bin/cat`, which hold its code and data, then the lines `[heap]` and `[stack]`. Compare their start addresses. The lines that name `libc.so.6` are the C library, which the step "From source file to executable" explains.

### Done when

You can list in order what the kernel does between the moment you run `./a.out` and the first instruction of `main`. You can name the four areas of an address space, say which way the heap and the stack grow, and show in the `maps` output that `[heap]` starts at a lower address than `[stack]`.

## Streams and exit status

A process needs a way to read input, show results and report how it went. The kernel gives it streams for the first two and an exit status for the last.

The kernel starts every process with three open **streams**. A stream is a channel that bytes flow through. The program reads from it or writes to it without knowing what is at the other end: the terminal, a file or another program.

- Stream 0 is **standard input** (stdin), where the program reads.
- Stream 1 is **standard output** (stdout), for results.
- Stream 2 is **standard error** (stderr), for messages about problems.

In the terminal, all three are connected to the terminal itself.

![A process starts with three streams: it reads stream 0 from the terminal and writes streams 1 and 2 to the terminal.](figures/01-streams.svg)

A process cannot reach the terminal, a file or anything else outside its own memory by itself. It asks the kernel with a **system call**, a request such as "write these 14 bytes to stream 1". `printf` formats your text and then makes the system call `write`. The kernel checks the request and does the work.

![Inside the process, main calls printf, printf calls write, and write makes a system call that asks the kernel to send the bytes to the terminal.](figures/01-syscall.svg)

When the program ends, it hands the kernel a small number, its **exit status**, with one last system call. Zero means success and any other value means failure. In C, the value `main` returns becomes the exit status. The kernel passes it to the process that started the program, usually the shell, the program you type commands into.

Every command and C function has a page in the **manual**, which the program `man` shows. Section 2 of the manual holds the system calls and section 3 the C library, so `man 2 write` and `man 3 printf` pick the right page.

### Study

- [Missing Semester 2026: Command-line Environment](https://missing.csail.mit.edu/2026/command-line-environment/) (read, 15 min): Under "The Command Line Interface", read Streams and Return codes. Skip the `fzf` passage in Streams. The `>` and `2>` that Streams shows come back in the next step.

### Build

1. Run `ls /home /nope`, then `echo $?`. `ls` writes the listing of `/home` to stdout and the complaint about `/nope` to stderr. `echo $?` prints the exit status of the last program, here 2. The next step explains how the shell keeps it.
2. Run `./a.out`, then `echo $?`. It prints 0, the value of `return 0` in `hello.c`.
3. Run `ls -l /proc/self/fd`. `fd` lists the open streams and files of the process that reads it, here `ls`, by number. Lines 0, 1 and 2 point at your terminal. Line 3 is the directory `ls` opened to read.
4. Run `man 2 write` and read the first paragraph under DESCRIPTION. The arrow keys scroll and `q` quits. Then open `man 3 printf` and find the line that says what `%d` does.

> **Optional:** `strace` prints every system call a program makes. Install it with `sudo apt install -y strace`, then run `strace -o trace.txt ./a.out` and `tail -3 trace.txt`. You see `write(1, "hello, world\n", 13)` and `exit_group(0)`, the system call that ends the process. Delete `trace.txt` afterwards.

### Done when

You can say where the streams 0, 1 and 2 of `ls` pointed, and where the 2 from `echo $?` came from. You can say in one sentence what a system call is and which one `printf` ends in, and what the first argument of `write` means.

## The shell

You have typed every command so far into the shell. Knowing what the shell does with a line explains the `./` in `./a.out`, the `$?`, and the `>` that wrote `hi.txt`.

The **shell** is a program that reads the line you type and runs it. Ubuntu's shell is `bash`. For a line such as `ls -l /home`, the shell:

1. splits the line into words. The first word names a program. The others become its **arguments**, the strings the program receives when it starts. An argument that starts with `-`, such as `-l`, is a **flag**, which changes what the program does.
2. finds the program file.
3. asks the kernel to start that file as a new process, with the arguments.
4. waits for the process to end and keeps its exit status in `$?`.

To find the program, the shell looks at the first word. A name with no `/` in it, such as `clang`, is looked up in the directories listed in `PATH`, in order, and the first match wins. `PATH` is an **environment variable**, a named piece of text that the shell hands to every program it starts. A name with a `/` in it is a path, and the shell runs that file without searching. `.` means the current directory, the one `pwd` prints, so `./a.out` is the file `a.out` here.

Your project directory is not in `PATH`, so `a.out` alone fails. Your `PATH` may be long. Only the order matters.

![For a bare name the shell searches the PATH directories in order, and for ./a.out it goes straight to the file.](figures/01-shell-path.svg)

Before it starts a program, the shell can connect the program's streams somewhere else, or make the next command depend on its exit status:

- `> file` connects stdout to the file.
- `2> file` connects stderr to the file.
- `a && b` runs `b` only if `a` exits with status 0.
- `a || b` runs `b` only if `a` exits with any other status.

![With > out.txt the shell connects stdout of ls to a file, and stderr still goes to the terminal.](figures/01-redirect.svg)

### Study

- [Missing Semester 2026: Course Overview and the Shell](https://missing.csail.mit.edu/2026/course-shell/) (read, 10 min): The section "What is available in the shell?" only. It shows `$PATH` and `which`.
- [Missing Semester 2026: Command-line Environment](https://missing.csail.mit.edu/2026/command-line-environment/) (read, 15 min): The same page as in the last step. Under "The Command Line Interface", read Arguments and Environment variables. Skim the globbing part of Arguments and skip process substitution in Environment variables.

### Build

1. Run `echo $PATH`, then `which ls clang`. `which` prints the file that a bare name runs.
2. In `~/code/hello`, run `a.out`, then `./a.out`. Read the error from the first one.
3. Run `ls -l /proc/self/fd > fds.txt`, then `cat fds.txt`. Find the stream that now points at `fds.txt`.
4. Before each of these, write down what you expect to see, then run it:

   ```sh
   ls /home /nope > out.txt
   cat out.txt
   ls /home /nope 2> err.txt
   ls /nope && echo ok || echo failed
   ```

5. Delete the files you made: `rm hi.txt fds.txt out.txt err.txt`.

### Done when

You can say why `a.out` alone fails and `./a.out` works. Your predictions in item 4 matched, or you can explain each one that did not. For each of `>` and `2>`, you can say which stream number the shell connected to the file.

## The compiler

The CPU runs machine instructions and nothing else. You write C as text. Something has to translate one into the other before the program can run.

A **compiler** is a program that reads **source code**, the text you wrote, and writes the machine code for it into an **executable**, a program file the operating system can start. The compiler runs once. After that you run the executable as often as you like, and no compiler is involved.

`python3` also translates your file, into **bytecode**, simple instructions that a program inside `python3` carries out. That translation happens every time you run the script. clang's translation happens once, and the result is machine code that the CPU runs itself.

![python3 translates and runs the script on every run, while clang translates main.c once into an executable that the CPU runs directly.](figures/01-compile.svg)

**clang** is the C compiler of this book. You will see two other names in tutorials. `gcc` is another C compiler, from the GNU project, and it takes the same commands. `cc` is a name that points at the system's default C compiler. When a tutorial types `gcc` or `cc`, type `clang`.

The first flag clang gets in this book is `-o name`, which names the executable `name` instead of `a.out`.

Two kinds of failure look alike at first, so keep them apart from now on. A **compile error** comes from clang before your program exists. It names a file, a line and a column, clang exits with status 1, and no executable is written. A **run-time failure** comes from your program after it started: wrong output, a message on stderr, a nonzero exit status or a crash.

### Study

- [Beej's Guide to C: Compilation Details](https://beej.us/guide/bgc/html/split/hello-world.html#compilation-details) (read, 5 min): Section 2.3 only. It names gcc as its compiler. clang takes the same commands.

### Build

1. Run `mkdir src` and save this as `src/main.c`:

   ```c
   #include <stdio.h>

   int main(void) {
       printf("hello, stdout\n");
       fprintf(stderr, "hello, stderr\n");
       return 3;
   }
   ```

   `fprintf(stderr, ...)` works like `printf` but writes to standard error. `return 3` makes the exit status 3.
2. Compile with `clang -o hello src/main.c`. Run `./hello`, then `echo $?`.
3. Run `./hello > out.txt` and `./hello 2> /dev/null`. `/dev/null` is a file that throws away everything written to it. Say which line each command shows on the terminal before you run it.
4. Run `rm hello`. Delete the semicolon after `return 3` and compile again. Read clang's message, then run `echo $?` and `ls`.
5. Put the semicolon back, compile, and run `rm hello out.txt`.

### Done when

You can point at the file, line and column in clang's message from item 4. `echo $?` after it printed 1, and `ls` showed no `hello`. You can say in one sentence each what a compiler does, how the translation in `python3` differs from clang's, and how a compile error differs from a run-time failure.

## From source file to executable

The `objdump` listing in the memory step called `printf@plt`, but `main.c` never says how `printf` works. Its code sits in a file that was on your system before you wrote a line. clang builds the executable in four stages, and each stage writes what the next one reads:

1. The **preprocessor** handles the lines that start with `#`. `#include <stdio.h>` pastes in the file `stdio.h`, a **header**. A header declares functions: it gives each one's name and the kinds of values it takes and returns, with no code.
2. The compile stage translates the C into **assembly**, the machine instructions written as text, like the `objdump` listing.
3. The **assembler** turns the assembly into machine code in an **object file**, `main.o`. Where `main` calls `printf`, the object file holds a gap with the name `printf` attached.
4. The **linker** fills the gap. It connects `main.o` to the **C library**, the file that holds the compiled code of `printf` and the other standard C functions, and writes the executable.

![clang preprocesses main.c, compiles it to assembly in main.s, assembles that into the object file main.o, and links main.o with the C library into the executable hello.](figures/01-stages.svg)

For the C library, the last part of the join happens when the program starts. That is why `/proc/self/maps` listed `libc.so.6` inside `cat`.

clang normally runs all four stages and keeps the files in between out of sight. Two flags stop it early. `-S` stops after the compile stage and writes assembly, and `-c` stops after the assembler and writes an object file. Chapter 05 opens these files properly.

### Study

- [Dive Into Systems: 2.9.5 C Libraries: Using, Compiling, and Linking](https://diveintosystems.org/book/C2-C_depth/advanced_libraries.html) (read, 15 min): The first two paragraphs, on headers and library code, then the subsection "Compilation Steps". Skip the part in between about `-l` and static linking, and stop at "Common Compilation Errors". The book types `gcc`, and clang takes the same flags. It calls the preprocessor the precompiler.

### Build

1. In `~/code/hello`, run `clang -E src/main.c | wc -l`. `-E` stops after the preprocessor and prints the expanded C, and `wc -l` counts its lines. Your 7 lines became over 800, nearly all of them from `stdio.h`.
2. Run `clang -S -o main.s src/main.c`, then `head -20 main.s`. Find the line that calls `printf`.
3. Run `clang -c -o main.o src/main.c`, then `clang -o hello main.o`. The second command only links. Run `./hello`.
4. Run `ls -l` and compare the sizes of `main.s`, `main.o` and `hello`.
5. Run `rm main.s main.o hello`.

### Done when

You can name the four stages and say what each one reads and writes. You can say what a header holds and where the code of `printf` comes from. You can say what `-S` and `-c` do.

## Warnings

A program can compile without errors and still be wrong. clang notices many such mistakes, but by default it says nothing about them. This step turns those messages on.

A **warning** is a message from the compiler about code that is legal C but probably a mistake. A warning does not stop the build. Most warnings are off unless a flag turns them on.

> **Practice:** Build every program with warnings on, from the first one, and fix each warning before you run the program.

These are the warning flags of this step:

- `-Wall -Wextra` turn on the common warnings and a set of extra ones. Despite its name, `-Wall` is not all of them.
- `-Wconversion` warns when a value is quietly converted to a type that cannot hold all of it, such as a number with a fraction cut down to a whole number.
- `-Werror` turns every warning into an error, so the build stops until you fix it.

### Study

- [Chris Wellons: My favorite C compiler flags during development](https://nullprogram.com/blog/2023/04/29/) (read, 20 min): The opening and the section "Static warnings". Skip the MSVC paragraph and its `cl` line, which are about Microsoft's compiler. The `WriteFile` example is Windows code: read the sentences around it and skip the code. Wellons is a C programmer whose blog this book uses again in chapter 04.
- [Clang: Diagnostic flags](https://clang.llvm.org/docs/DiagnosticsReference.html) (reference, as needed): Look up a warning by the name clang prints in brackets, such as `-Wfloat-conversion`.

### Build

1. Save this as `src/w.c`. It has two planted problems:

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

   The new lines:
   - `int unused;` makes a whole-number variable that nothing uses.
   - `double ratio = 2.75;` makes a variable with a fraction.
   - `int whole = ratio;` copies it into a whole number, which drops the `.75`.
   - `assert(x)` stops the program with a message when `x` is false. Here the check calls `puts`, which prints a line, and the check is true when that worked.
   - `printf("%d\n", whole)` prints `whole`. `printf` replaces the `%d` in its text with the next argument, written as a decimal number.
2. Compile with `clang -o w src/w.c` and run `./w`. No messages, and it prints "assert ran" and 2.
3. Compile again with `clang -Wall -Wextra -o w src/w.c`, then with `-Wconversion` added. Count the warnings, and notice that `w` was still built.
4. Run `rm w`, then `clang -Wall -Wextra -Wconversion -Werror -o w src/w.c`. It stops with two errors, each with the warning's name in brackets, and `ls` shows no `w`.
5. Fix the two problems: delete `int unused;` and write `int whole = (int)ratio;`. The `(int)` says that you mean the conversion. Run the command from item 4 again, then `./w`.

### Done when

The command with `-Werror` failed with one error for `unused` and one for the conversion, and it built `w` after the fix. You can say in one sentence what each of `-Wall`, `-Wextra`, `-Wconversion` and `-Werror` does.

## A build script

The command from the last step is long, it grows in the next step, and you need it for every program. A **shell script** is a text file of shell commands, and `sh build.sh` runs the commands in `build.sh` one after another.

The script makes two kinds of build, each in its own directory under `out`:

- The **debug build** is for everyday work. It uses `-O0`, which tells clang to translate each line as written, so that a debugger can follow the program line by line. The sanitizer step adds checks to it.
- The **release build** is for measuring speed, once the debug build works. It uses `-O2`, which lets clang **optimize**: reorder and remove instructions so the program runs faster. It also uses `-DNDEBUG`. `-D` sets a name for the preprocessor, and `assert` switches itself off when the name `NDEBUG` is set.

![build.sh compiles src/name.c with the warning flags, and writes the debug or the release executable into its own directory under out.](figures/01-build.svg)

The script also passes three flags this book uses everywhere. One line each is enough for now:

- `-Wno-sign-conversion` turns off the part of `-Wconversion` about mixing signed and unsigned numbers. It fires on a lot of correct code.
- `-Wdouble-promotion` warns when a number with a fraction is quietly widened to a bigger kind. Later chapters explain the two kinds.
- `-std=gnu11` picks the 2011 version of the C language, with the additions that Linux's C library offers.

### Study

- [Missing Semester 2026: Course Overview and the Shell](https://missing.csail.mit.edu/2026/course-shell/) (read, 15 min): The same page as in the shell step, now the section "The shell language (bash)". Read the parts on pipes, conditionals with `[`, command substitution with `$( )` and the example script. Skim the loops and the `tee` box. The example script uses `bash` features that `build.sh` does not need.

### Build

1. Save this as `build.sh` in `~/code/hello`:

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
       flags="-O0"
   fi

   $cc -std=gnu11 $warn $flags -o "$out/$name" "src/$name.c"
   echo "built $out/$name ($mode, $cc)"
   ```

   Line by line:
   - `#!/bin/sh` names the shell that runs the script. You start that shell yourself with `sh build.sh`, so the script needs no other setup.
   - The other lines that start with `#` are comments.
   - `set -e` stops the script at the first command that fails.
   - `${1:-main}` is the script's first argument, or `main` when there is none. `${2:-debug}` does the same for the second.
   - `${CC:-clang}` is the environment variable `CC` if you set one, and `clang` otherwise.
   - `$(uname -s)` runs `uname -s` and puts its output, `Linux`, into the line. Builds land in `out/Linux-debug` and `out/Linux-release`.
   - The `if` picks the flags for the mode.
   - The `$cc` line is the clang command from the last step, with the script's names filled in.
2. Run `sh build.sh w` and `./out/Linux-debug/w`, then `sh build.sh w release` and `./out/Linux-release/w`.
3. Run `sh build.sh` and `./out/Linux-debug/main`.
4. Run `rm w a.out`.
5. Make the project a git repository: run `git init`, write a `.gitignore` file with the line `out/`, and commit `hello.c`, `src/`, `build.sh` and `.gitignore`.

> **If it fails:** If `git commit` stops with "Author identity unknown", Ubuntu's git does not know your name yet. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` and commit again.

### Done when

The debug build of `w` prints "assert ran" and 2, and the release build prints only 2. `git status` does not list `out/`. You can say in one sentence what each flag in `build.sh` does.

## Memory you do not own

Python checks every list index and raises `IndexError` when it is out of range. C does not check. When a C program reads memory that is not its own, it gets whatever bytes happen to be there and carries on.

A program **owns** the memory it was given for a purpose: the bytes of each variable, the bytes of each array. In C, `int a[4]` is four `int` values, 4 bytes each, in 16 neighboring bytes on the stack. `a[4]` is a fifth one that does not exist. C computes its address, 16 bytes past the start, and reads the 4 bytes there. They belong to something else.

![The array a owns 16 bytes, and a[4] reads the 4 bytes right after them, which belong to something else.](figures/01-out-of-bounds.svg)

A program can also ask for memory while it runs. `malloc(n)` reserves a block of `n` bytes on the heap and returns the address of the first byte. `free(p)` gives the block at address `p` back. The bytes are still there after `free`, but they belong to `malloc` again, which writes its own bookkeeping into them or hands them out to the next caller. Reading through the old address is a **use after free**.

![Before free the block at p belongs to the program and holds 7, and after free malloc owns it again and has written other bytes into it, but p still holds the address.](figures/01-use-after-free.svg)

A block that is never freed is a **memory leak**. The program keeps it until it exits, so a long-running program grows.

Reading past an array and reading after `free` are **undefined behavior**: the rules of C say nothing about what happens next. Adding 1 to the largest `int` is undefined behavior too. On your machine the bits wrap around as in the first step of this chapter, so 2147483647 + 1 gives -2147483648. In all these cases the program usually prints a wrong answer and exits as if all were well.

### Study

- [Dive Into Systems: 2.4 Dynamic Memory Allocation](https://diveintosystems.org/book/C2-C_depth/dynamic_memory.html) (read, 20 min): The introduction, 2.4.1 "Heap Memory" and 2.4.2 "malloc and free". Read for what `malloc` and `free` do. Chapter 02 teaches the C syntax properly.

### Build

1. Save this as `src/bugs.c`. It has four bugs, one per argument:

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

   The new C in the four bug functions:
   - `static int out_of_bounds(void) { ... }` is a function that takes nothing and returns an `int`. `static` keeps it private to this file.
   - `for (int i = 0; i <= 4; i++)` runs its body with `i` from 0 to 4. The array has indexes 0 to 3.
   - `int *p` is a variable that holds an address of an `int`. `*p` is the `int` at that address.
   - `malloc(sizeof *p)` reserves as many bytes as one `int` takes. `malloc(32)` reserves 32.
   - `strcpy(s, "never freed")` copies the text into the block, and `strlen(s)` counts its 11 characters.
   - `INT_MAX` is the largest `int`, 2147483647.

   Type `main` as given. It picks a bug by the first character of the argument you give the program, so `bugs 2` runs `use_after_free`. Chapter 02 explains `argc`, `argv` and `switch`.
2. Run `sh build.sh bugs`. Run `./out/Linux-debug/bugs 1` three times, with `echo $?` after each. Do the same for 2, 3 and 4.
3. For each bug, write down what the program should print if C checked the way Python does, and what it printed.

### Done when

All twelve runs exited with status 0. The numbers for runs 1 and 2 changed from one run to the next. For each of the four bugs you can say which memory or which value it gets wrong, and whether the program owned that memory.

## Sanitizers

The last step printed wrong numbers and exited with status 0. You want the program to stop at the bad line instead and tell you what went wrong. clang can add that checking for you.

A **sanitizer** is extra checking code that the compiler adds to your program when you ask with a flag. The checks run while the program runs. When one fails, the program stops with a report. The program gets about twice as slow, so sanitizers belong in the debug build only. This book uses three:

- **AddressSanitizer** (ASan, `-fsanitize=address`). The "address" is a memory address. Before every read and write, ASan's code looks the address up in a record of which bytes the program owns. ASan leaves a few unowned bytes, a **red zone**, around every array and heap block, and it keeps freed blocks out of reuse for a while. A step past the end or a read after `free` lands on bytes marked as not owned.
- **LeakSanitizer** runs inside every ASan build on Linux when the program exits, and lists the blocks that were never freed.
- **UndefinedBehaviorSanitizer** (UBSan, `-fsanitize=undefined`) checks arithmetic and indexing, such as an `int` that overflows or an index past the end of an array whose size the compiler knows.

![ASan surrounds the array with red zones and records which bytes are owned, and the read of a[4] lands in a red zone, so ASan stops the program.](figures/01-asan.svg)

The debug build gets three more flags:

- `-fsanitize=address,undefined` turns both sanitizers on.
- `-fno-sanitize-recover=undefined` makes UBSan stop at the first error instead of printing it and going on.
- `-g3` records which source line each instruction came from, so a report can name the line.

A report reads from the top:

1. what went wrong, and at which address.
2. the chain of function calls that led to the bad access, the innermost first.
3. for heap memory, where the block was freed and where it was allocated.

> **Practice:** Run every new program in the debug build with sanitizers before you trust its output.

### Study

- [Clang: AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html) (read, 15 min): Introduction and Usage. The example is C++. Read `new` as `malloc` and `delete[]` as `free`. Skip the rest.
- [Clang: UndefinedBehaviorSanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html) (reference, as needed): Usage, and the list under "Available checks" when a report names a check you do not recognize.

### Build

1. In `build.sh`, change the debug flags line to:

   ```sh
       flags="-g3 -O0 -fsanitize=${SAN:-address,undefined} -fno-sanitize-recover=undefined"
   ```

   `${SAN:-address,undefined}` uses the environment variable `SAN` when you set one, and both sanitizers otherwise.
2. Run `sh build.sh bugs`, then `./out/Linux-debug/bugs 1` to `4`, with `echo $?` after each. For each run, note the kind of error and the line of `bugs.c` it blames. Shortened, the report for run 2 looks like this, with your own paths and addresses:

   ```
   ERROR: AddressSanitizer: heap-use-after-free on address 0x502000000010
   READ of size 4 at 0x502000000010 thread T0
       #0 in use_after_free src/bugs.c:23:12
       #1 in main src/bugs.c:47:30
   freed by thread T0 here:
       #0 in free
       #1 in release src/bugs.c:16:5
   previously allocated by thread T0 here:
       #0 in malloc
       #1 in use_after_free src/bugs.c:20:14
   ```

3. UBSan catches run 1 first, as an index out of bounds. Run `SAN=address sh build.sh bugs` and `./out/Linux-debug/bugs 1` to see ASan report the same bug as a stack-buffer-overflow, an overflow of an array on the stack. Run `sh build.sh bugs` afterwards to get both sanitizers back.
4. Run `sh build.sh bugs release` and the four release runs. They still exit with 0 and print no report.
5. Copy `bugs.c` to `src/fixed.c` and fix the four bugs in the copy. Keep `bugs.c` as it is, because the next step uses it. In `out_of_bounds`, loop while `i < 4`. In `use_after_free`, copy `*p` into an `int` variable before `release(p)` and return that variable. In `leak`, call `free(s);` after the `strlen` line. In `main`, call `add_one(41)`.
6. Run `sh build.sh fixed` and the four runs of `./out/Linux-debug/fixed`.

> **If it fails:** If every ASan build prints `AddressSanitizer:DEADLYSIGNAL` over and over at startup and then crashes, the kernel picks memory addresses from a wider range than this sanitizer runtime expects. Run `sysctl vm.mmap_rnd_bits`. If it prints a number above 28, `sudo sysctl vm.mmap_rnd_bits=28` lowers it until the next `wsl --shutdown` or Windows restart.

### Done when

Each of the four debug runs of `bugs` stops with a report that blames the right line and exits with a nonzero status. Run 3 prints a LeakSanitizer report that points at the line of `malloc` in `leak`, and counts two or three blocks. `fixed` prints 10, 7, 33 and 42 for arguments 1 to 4 with no report. For the use-after-free report, you can name the line that freed the memory and the line that allocated it.

## The debugger

Sanitizers catch code that breaks a rule of the language. A program can follow every rule and still compute the wrong answer. Instead of adding `printf` calls and compiling again, you stop the program and look.

A **debugger** runs your program under its control. You set a **breakpoint** on a function or a line, and the program stops when it gets there. Then you print variables, run one line at a time and look at the **call stack**, the frames of the functions that called each other to reach this point. gdb numbers the frames from 0, the function running now, and `up` and `down` move between them.

![While sum runs, the stack holds main's frame with scores, n and total, and below it sum's frame, frame 0, with a, n, total and i, and up and down move between them.](figures/01-call-stack.svg)

A **watchpoint** stops the program every time a variable changes, which finds the line that wrote a bad value without stepping through everything before it. The debugger of this book is gdb.

![A watchpoint on total stops the program at every change, and the values go 0, 72, 157, 221, 320, so the first score, 90, was never added.](figures/01-watch.svg)

The debug build already gives gdb what it needs. `-g3` records which instructions belong to which line and where each variable lives. `-O0` keeps every variable in memory, where gdb can read it. LeakSanitizer cannot run under a debugger, so start gdb with `ASAN_OPTIONS=detect_leaks=0` in front. `ASAN_OPTIONS` is an environment variable that the ASan code reads.

> **Practice:** When a program computes a wrong value, find where it goes wrong in gdb before you add a `printf`.

These are the commands this chapter uses. Most have a short form:

| command | what it does |
| --- | --- |
| `b sum`, `b scores.c:6` | breakpoint on a function, or on a line |
| `r` | run the program, or restart it from the beginning |
| `n`, `s`, `finish` | next line, step into a call, run to the end of this function |
| `info locals` | all local variables of this function |
| `p total` | print one variable or expression |
| `bt` | show the call stack |
| `up`, `down`, `frame 3` | move to the caller, back, or to frame 3 of the stack |
| `watch total` | stop every time `total` changes |
| `x/5dw &scores` | show five 4-byte values in decimal, starting at the address of `scores` |
| `c` | continue running |

### Study

- [Dive Into Systems: 3.1 Debugging with GDB](https://diveintosystems.org/book/C3-C_debug/gdb.html) (read, 30 min): 3.1.1 and the `badprog.c` example session, then skim the `segfaulter.c` session.
- [Dive Into Systems: 3.2 GDB Commands in Detail](https://diveintosystems.org/book/C3-C_debug/gdb_commands.html) (reference, as needed): 3.2.2, where `x` and its format letters are under "Commands for Examining and Evaluating Program State and Expressions". It does not list `watch`, `up`, `down` or `finish`. The table above covers those.
- [GDB manual: 5.1.2 Setting Watchpoints](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Set-Watchpoints.html) (reference, as needed): Hardware against software watchpoints, and why gdb deletes a watchpoint on a local variable when its function returns.

### Build

1. Save this as `src/scores.c`. The five scores add up to 410 and their mean is 82, but the program prints something else:

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

   `const int *a` is the address of the first score, and `const` promises that `sum` does not change the scores.
2. Run `sh build.sh scores` and `./out/Linux-debug/scores` once.
3. Ubuntu's gdb asks "Enable debuginfod for this session?" the first time a program starts. Turn the question off for good with `echo 'set debuginfod enabled off' >> ~/.gdbinit`. `>>` adds the line to the end of the file instead of replacing the file.
4. Start gdb with `ASAN_OPTIONS=detect_leaks=0 gdb ./out/Linux-debug/scores`. Find the bug in the next items without adding any `printf`.
5. Run `b sum`, `r`, then `info locals`. Step with `n` and print `i` and `total` after each step.
6. Restart with `r` and answer `y` when gdb asks whether to start from the beginning. At the breakpoint, run `watch total`, then `c` until the program ends.
7. Write down the old and new value at each stop. gdb shows the line after the one that wrote the value. If gdb does not stop at `total = 0`, the old value was already 0. When `sum` returns, gdb deletes the watchpoint and says so.
8. Restart once more. Stop in `sum` and run `bt`. Then run `up` and `x/5dw &scores` to see the five scores in memory, then `down`. Compare what you see with the call stack figure.
9. Quit with `q` and answer `y`. Fix the loop and confirm that the program prints `total 410, mean 82`.
10. Commit your work with `git add .` and `git commit`.

> **Optional:** You can also read a sanitizer failure from inside gdb. `ASAN_OPTIONS=abort_on_error=1` makes ASan stop the program with `abort` after its report, and gdb stops there. Run `ASAN_OPTIONS=abort_on_error=1 gdb --args ./out/Linux-debug/bugs 2`. `--args` passes the rest of the line to the program as its arguments.
>
> Type `r`, then `bt`. The first ten or so frames are inside the C library's `abort` and the sanitizer code. Find the frame that names `use_after_free` and `src/bugs.c:23`, which is frame 10 on this book's build. Move to it with `frame 10`, or the number you found, and print the address with `p p`.

### Done when

You found the `scores.c` bug with the watchpoint, and the fixed program prints `total 410, mean 82`. You can say which frame `bt` listed first and what `up` showed. You can set a breakpoint, step, print, show the call stack and set a watchpoint in gdb, looking up nothing but the table above.

## Where this leads

You can read bytes in hex, and you know what happens between typing `./hello` and the first instruction of `main`: the shell finds the file, the kernel makes a process, the CPU runs its instructions, the program asks the kernel for output with system calls, and the exit status comes back to `$?`. You have one build script with warnings and sanitizers, a debug and a release build in `out/Linux-debug` and `out/Linux-release`, and gdb. Every C chapter in this book uses that loop: edit, `sh build.sh`, run, then read the sanitizer report or step through the program in gdb. Commit after every step that works.

You cannot write C of your own yet. Every program in this chapter came ready-made.

The next chapter, "C foundations", opens by adding one piece to this loop: a small test program per source file, run by a script, whose exit status says whether every check passed. Then it teaches pointers, strings and heap memory by having you write a linked list, a growable array and a word counter. The sanitizers check them for memory bugs, LeakSanitizer checks that you freed everything, and gdb shows you the pointers. It ends by matching three of your functions to the x86-64 assembly the compiler produces for them.
