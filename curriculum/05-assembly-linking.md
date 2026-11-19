---
id: 05
title: Assembly, the ABI and linking
part: The machine and C
weeks: 9
project: Hand-written x86-64 and ARM64 functions called from C, then an 8086 instruction decoder and simulator in C.
---

Chapter 04 left you writing C you can reason about at the byte level: how a struct sits in memory, which code the compiler may assume never runs, and how an arena replaces a pile of small `malloc` calls. In chapter 02 you read clang's x86-64 output for three of your functions, after most of Dive Into Systems 7.1 to 7.5. In chapter 03 you wrote an assembler for a 16-bit CPU you built from gates. You have not yet written assembly for a real CPU, and you have not looked at what happens between `clang -c` and a program that runs.

The chapter has two halves. The first half writes small functions in assembly and learns the rules that make a function call work. The second half goes the other way, from bytes back to instructions, by writing a decoder and simulator for the Intel 8086. The steps are:

1. An x86-64 function in its own file.
2. Stack frames, nested calls and recursion.
3. Stack arguments, doubles and globals.
4. Talking to the kernel with a system call.
5. The same leaf functions on ARM64.
6. ARM64 frames, calls and system calls.
7. Reading optimized code.
8. The Bomb Lab.
9. How a buffer overflow becomes an exploit.
10. Object files, symbols and relocations.
11. Linking, libraries and the loader.
12. A Makefile for the library.
13. Decoding 8086 MOV instructions.
14. Decoding arithmetic and jumps.
15. Simulating registers, flags and jumps.
16. Simulating memory.

Three terms come up in every step. An **ISA** (instruction set architecture) is the set of instructions a CPU runs and the way they are encoded. An **ABI** (application binary interface) is how separately compiled code agrees on argument registers, return values, saved registers and stack alignment. An **object format** is how code, symbols and relocations are stored in a file.

```
  ISA            x86-64 and ARM64 are two ISAs.
  ABI            Linux and Windows on the same x86-64 CPU use different ABIs.
  object format  Linux uses ELF, Windows uses PE, macOS uses Mach-O.
```

Everything you build in WSL2 is a Linux program. It follows the **System V ABI** for x86-64, the set of calling rules every Linux program on this CPU obeys, and it is stored as ELF, even though the laptop around it runs Windows.

You write assembly in this chapter to learn those rules. Keep the programs small. Outside this chapter the compiler writes the assembly and you read it. The chapter comes now because chapter 06 builds a whole machine in software on top of the decode and execute loop you write here, and chapter 07 starts measuring speed, where every measurement ends with reading the instructions the compiler produced.

## An x86-64 function in its own file

In chapter 02 you read `swap_ints` after clang compiled it. Now you write the `.s` file yourself and let clang assemble it and link it with a C caller. An **assembly file** holds two kinds of line: instructions, which the CPU runs, and the directives you left out of your chapter 02 listings, which start with a dot and talk to the assembler, not the CPU. The C side needs only a prototype such as `long add2(long a, long b);`. One clang command compiles the `.c` file, assembles the `.s` file and links both. These commands write to `out/x86`, a folder of your own outside the `build.sh` layout:

```sh
mkdir -p out/x86
clang -g -O0 -o out/x86/leaf_test tests/leaf_test.c src/x86/leaf.s
```

This file defines one function in AT&T syntax, the syntax chapter 02 used:

```
# src/x86/leaf.s
# long add2(long a, long b): a arrives in rdi, b in rsi, the result leaves in rax
        .text                           # what follows is code
        .globl  add2                    # make the symbol visible to the linker
        .type   add2, @function         # mark the symbol as a function for gdb and objdump
        .p2align 4                      # start on a 16-byte boundary, as compilers do
add2:
        movq    %rdi, %rax              # rax = a
        addq    %rsi, %rax              # rax = a + b
        ret                             # pop the return address and jump there

        .section .note.GNU-stack,"",@progbits
```

End every `.s` file in this chapter with that last line, after the last function. It tells the linker this code does not need an executable stack. Step 9 explains what that means.

A label made of a digit, like `1:`, is a **local label**. `jne 1b` jumps back to the nearest `1:` above it and `1f` looks forward. Use them for loops so you do not have to invent names.

> **Practice:** Write the C prototype first and test every assembly function from C. The prototype is the one place that says what the bits in each register mean.

Assembly has no types. The C prototype decides what the bits mean. A `long` or a pointer travels in a 64-bit register such as `rdi`, an `int` in its 32-bit lower half `edi`.

Writing a 32-bit register clears the upper 32 bits of the 64-bit register. Writing an 8-bit or 16-bit part such as `al` or `ax` leaves the other bits as they were. So `movl $5, %eax` makes rax 5, and `movw $5, %ax` changes only the low 16 bits.

The ABI is a contract between a function and its caller. It says which registers carry the arguments, which carries the result, and which ones the function must hand back unchanged.

![Find the callee-saved row. Those are the only registers a function must restore before it returns.](figures/05-registers.svg)

Two words in the figure name who keeps a register alive across a call. **Caller-saved** means the called function may destroy the value, so a caller that needs it afterward must keep its own copy. **Callee-saved** means the called function must put the old value back before `ret`, so the caller can leave values there across the call. A leaf function, one that calls nothing, that sticks to the caller-saved registers needs no stack at all. If a function keeps a value in a callee-saved register without restoring it, the caller reads a wrong value later, in code that looks correct.

Chapter 01's gdb commands and chapter 02's single-instruction commands work on assembly, because `-g` records line information for your `.s` file too. These are their short forms, plus a few new ones:

```
  b add2              breakpoint on the first instruction of add2
  i r rdi rsi         read registers rdi and rsi (info registers)
  si                  step one instruction (stepi)
  ni                  step one instruction, over a call (nexti)
  disas               disassemble the current function
  x/4gx $rsp          four 8-byte words at the stack pointer, in hex
  x/a  ADDR           one address-sized word, shown as a symbol if it is one
  x/s  ADDR           the C string at ADDR
  x/8dw ADDR          eight 4-byte words in signed decimal
```

gdb and objdump print AT&T syntax, where the source comes first (`movq %rdi, %rax` copies rdi into rax).

> **Optional:** `set disassembly-flavor intel` in gdb, and `objdump -d -M intel`, switch to Intel syntax, where the destination comes first. Compiler Explorer and the Intel manuals use it. The 8086 steps later in the chapter use it too. You do not need it before then.

### Study

- [Dive Into Systems: 7.7 Arrays in Assembly](https://diveintosystems.org/book/C7-x86_64/arrays.html) (read, 40 min): Section 7.7 in full. Chapter 02 stopped after 7.5, and 7.6 on recursion comes in the next step. Section 7.7 shows the scaled-index load `mov (%rdx,%rcx,4), %eax` that your array loop needs.
- [System V ABI, AMD64 Architecture Processor Supplement](https://gitlab.com/x86-psABIs/x86-64-ABI/-/jobs/artifacts/master/raw/x86-64-ABI/abi.pdf?job=build) (reference, as needed): The specification itself, version 1.0 of March 2025, built from the psABI repository at [gitlab.com/x86-psABIs/x86-64-ABI](https://gitlab.com/x86-psABIs/x86-64-ABI). If the artifact link ever breaks, that repository's README points at the current PDF. Look things up in 3.2.1 Registers, 3.2.2 The Stack Frame, 3.2.3 Parameter Passing and Figure 3.4 Register Usage. Later steps add 3.5.7 Variable Argument Lists, A.2 AMD64 Linux Kernel Conventions and 4.4.1 Relocation Types. Skip the x87, ILP32 and large-model material.

### Build

Write `src/x86/leaf.s` with six functions, each with its prototype in `tests/leaf_test.c`:

1. `long add2(long a, long b)`.
2. `long sum_array(const long *a, long n)`. Return 0 when `n` is 0.
3. `size_t asm_strlen(const char *s)`. Compare one byte at a time with `cmpb`.
4. `void *asm_memcpy(void *dst, const void *src, size_t n)` copies byte by byte with `movzbl` and `movb` and returns `dst`.
5. `long abs_diff(long a, long b)` returns the absolute value of `a - b` with no branch, using `cmov`. Subtract, copy the result and negate the copy, then `test` the result and `cmovs` the negated copy when the result is negative. `cmov` copies only when a flag is set, so `cmovs` means "copy if the sign flag is set".
6. `long div_mod(long a, long b, long *rem)` returns `a / b` and writes `a % b` through `rem`, using `idiv`. `idivq %rsi` divides the 128-bit value in rdx:rax by rsi, so first save `rem` out of rdx, then `cqo` sign-extends rax into rdx, then `idivq` leaves the quotient in rax and the remainder in rdx.

Use only the caller-saved registers rax, rcx, rdx, rsi, rdi and r8 to r11. Write the test file with the OK and FAIL pattern from chapter 02. Test `add2` with negative numbers, `sum_array` on an empty array, `{5}` and `{1, 2, 3, -4}`, `asm_strlen` on `""`, `"a"`, `"hello"` and a 1000-character string you build with `memset`, and `asm_memcpy` for 0, 1, 7 and 100 bytes into a buffer with guard bytes after the destination. Test `abs_diff` and `div_mod` with negative inputs, including `abs_diff(3, 10)`, which must be 7.

Then break the contract on purpose. Put this in `src/x86/bad.s`, in its own file so `leaf_test` does not link it: `long bad_sum(const long *a, long n)` that keeps its running sum in rbx without saving it. Put this caller in `src/keeps.c`:

```c
long bad_sum(const long *a, long n);

long keeps(const long *a, long n) {
    long k = n * 7;
    long s = bad_sum(a, n);
    return s + k;
}
```

Chapter 01 named gcc as the other C compiler. This chapter uses it next to clang, because Dive Into Systems, the Bomb Lab and Ubuntu's own packages are built with gcc. Install it with `sudo apt install -y gcc`.

Build a test of `keeps` with `-O1` instead of `-O0`, once with clang and once with gcc, so that the compiler keeps a value in a callee-saved register across the call. Run it, then open it in gdb, run `disas keeps` and find the register that carries a value across the `call`. clang keeps `k` there and gcc keeps `n`. Both pick rbx.

### Done when

All tests pass. Stepping through `sum_array` in gdb with `si`, you can say what rdi, rsi, rax and your loop counter hold after every instruction of the first two iterations. `abs_diff(3, 10)` is 7 and `div_mod(17, 5, &r)` returns 3 with `r` set to 2. `keeps` returns the wrong value, and you can point at the instruction in `keeps` that read the register `bad_sum` destroyed, and explain why a function made only of valid instructions can still break its caller.

## Stack frames, nested calls and recursion

A leaf function needs no stack. A function that calls another one does, because the call destroys every caller-saved register and overwrites the return address. This step builds the stack frame a non-leaf function sets up. Start with the two instructions that move the stack pointer on their own.

![Before a call the stack holds the caller's data, call pushes the return address and lowers rsp, and ret pops it and raises rsp back to where it started.](figures/05-call-return.svg)

`call` pushes the return address onto the stack and jumps. `ret` pops it and jumps back. The ABI wants rsp to be a multiple of 16 at every `call`. The `call` then pushes 8 bytes, so every function starts with rsp 8 bytes off a multiple of 16. Each `push` moves rsp by another 8. Count your pushes and adjust with `sub` until rsp is a multiple of 16 again before your own `call`.

A function that needs values to survive its own calls keeps them in callee-saved registers and pushes the caller's copies first. The epilogue pops them in reverse order. This function computes `sq(a) + sq(b) + sq(c)`. It pushes rbx and r12, then 8 more bytes so rsp is aligned before each `call`:

```
# long sum3sq(long a, long b, long c)
        .globl  sum3sq
        .type   sum3sq, @function
sum3sq:                                 # rsp % 16 == 8, call pushed 8 bytes
        pushq   %rbx                    # rsp % 16 == 0
        pushq   %r12                    # rsp % 16 == 8
        subq    $8, %rsp                # rsp % 16 == 0, ready to call
        movq    %rsi, %rbx              # b survives the calls in rbx
        movq    %rdx, %r12              # c survives the calls in r12
        call    sq                      # rax = sq(a), a is already in rdi
        movq    %rbx, %rdi
        movq    %rax, %rbx              # rbx = sq(a)
        call    sq                      # rax = sq(b)
        addq    %rax, %rbx
        movq    %r12, %rdi
        call    sq                      # rax = sq(c)
        addq    %rbx, %rax
        addq    $8, %rsp
        popq    %r12
        popq    %rbx
        ret
```

Your chapter 02 listings at `-O0` opened with `pushq %rbp` and `movq %rsp, %rbp`, and Dive Into Systems 7.5 traced that pair. After it, rbp points at the saved rbp of the caller, which points at the saved rbp of its caller, down the whole chain. The paired `leave` instruction at the end undoes it, copying rbp back into rsp and popping the saved rbp.

![While fib(3) runs, rbp points at its saved rbp, which holds the address of fib(4)'s saved rbp, which holds the address of main's, so the saved rbp values chain every frame back to main.](figures/05-stack-frame.svg)

Each return address sits 8 bytes above its saved rbp. At `-O1` and above, gcc and clang drop the `rbp` pair and use rbp as one more callee-saved register. gdb's `bt` still works there, because the compiler writes tables into the `.eh_frame` section that describe every frame. Your `fib` below keeps the rbp chain so you can walk it by hand. A recursive function runs the same prologue once per call.

One more rule shows up in compiled code. Code reaches its data relative to the instruction pointer. `leaq msg(%rip), %rsi` puts the address of `msg` in rsi, computed as the address of the next instruction plus a fixed distance. Ubuntu builds position-independent executables that load at a different address on each run, as chapter 02 noted, but the distance from code to data stays the same.

> **Practice:** Check an ABI claim with gdb, not from memory. `p (long)$rsp % 16` at a breakpoint tells you the real alignment at that instruction.

### Study

- [Dive Into Systems: 7.6 Recursion](https://diveintosystems.org/book/C7-x86_64/recursion.html) (read, 30 min): The whole section, including the animation in 7.6.1. If the `push %rbp` and `leave` pair is not clear, reread 7.5.2 and 7.5.3 from chapter 02.

### Build

Write `src/x86/calls.s` and `tests/calls_test.c`, building to `out/x86`:

1. `long sq(long x)` and `long sum3sq(long a, long b, long c)` as above. Test `sum3sq(2, 3, 4)` is 29 and `sum3sq(-1, 0, 5)` is 26.
2. `long fib(long n)` with two recursive calls, `fib(n - 1) + fib(n - 2)`, and `fib(0) = 0`, `fib(1) = 1`. Open it with `pushq %rbp` and `movq %rsp, %rbp`, then push the callee-saved registers it needs. Test it against a C version for every `n` from 0 to 25.

Then write `tests/fib4.c`, which only prints `fib(4)`. In gdb, set a breakpoint on `fib` that stops only when the argument is 1, with `b fib if $rdi == 1`, and run. At this stop the new frame does not exist yet, so `$rbp` is still the caller's record and the current return address is at `$rsp`: read it with `x/a $rsp`. Step with `si` twice to run `pushq %rbp` and `movq %rsp, %rbp`, until `$rbp` equals `$rsp`, then run `x/2a $rbp` to read the saved rbp and the return address of this `fib` call. The saved rbp is the address of the next record.

### Done when

All tests pass. `sum3sq(2, 3, 4)` is 29. Stopped at the first instruction of `sum3sq`, `p (long)$rsp % 16` prints 8, and after you break on each `call` inside it (with `b *ADDRESS` from `disas`) the same command prints 0. gdb refuses arithmetic on `$rsp` without the `(long)` cast, because it treats the register as a pointer. At the `fib` breakpoint you stepped past the prologue and walked at least three frame records by hand with `x/2a`, and each return address points into `fib` or into `main`.

## Stack arguments, doubles and globals

The register rule from step 1 covers the first six integer arguments. Three common cases do not fit it: a function with more than six integer arguments, a `double` argument, and a global variable. Each has its own ABI rule, and Section 3.2.3 of the ABI document from step 1 covers the first two.

- A seventh or later integer argument does not fit in the six argument registers, so it travels on the stack. On entry it sits at `8(%rsp)`, just above the return address, and at `16(%rbp)` once you have pushed rbp.
- A `double` argument arrives in a vector register. The first two doubles come in xmm0 and xmm1, and a `double` result leaves in xmm0. The figure in step 1 shows the xmm row.
- A global in `.bss`, the section of zeroed memory, is reached rip-relative like any other data, with `incq counter(%rip)`.

One kind of call needs a fourth rule. Before a call to a **variadic** function, one that takes a variable number of arguments such as `printf`, al holds the number of vector registers that carry arguments. For integer arguments that number is 0, so compiled C puts `xorl %eax, %eax` right before `call printf`.

`printf` saves the vector registers only when al is nonzero, and it saves them with `movaps`, an instruction that needs a 16-byte aligned address. A garbage al together with a misaligned rsp crashes inside `printf`, even though your own code never touched the stack. Section 3.5.7 of the ABI document states the rule for al.

`.ascii` stores bytes as written. `.asciz` adds a terminating 0 byte, which a C string such as a `printf` format needs. In `.set len, . - msg`, the `.` stands for the current address, so `len` is the length of the message.

### Study

- [System V ABI, AMD64 Architecture Processor Supplement](https://gitlab.com/x86-psABIs/x86-64-ABI/-/jobs/artifacts/master/raw/x86-64-ABI/abi.pdf?job=build) (reference, as needed): For this step, 3.2.3 Parameter Passing for the stack arguments and the xmm registers, and 3.5.7 Variable Argument Lists for the al rule. The link and the sections to skip are in step 1.

### Build

Add to `src/x86/calls.s` and `tests/calls_test.c`:

1. `long sum8(long a, long b, long c, long d, long e, long f, long g, long h)` that adds all eight. The first six come in registers. Read `g` from `8(%rsp)` and `h` from `16(%rsp)` on entry. In gdb, break on its first instruction and run `x/2gx $rsp+8` to see `g` and `h` on the stack.
2. `double scale(double x, long n)` that returns `x * n`, with `cvtsi2sd %rdi, %xmm1` to turn `n` into a double and `mulsd`.
3. `long counter` in `.bss` with `void bump(void)` doing `incq counter(%rip)` and `long get_counter(void)`. Call all three from C.
4. `void print_long(long v)` that calls `printf("%ld\n", v)` with the format string in `.rodata`, its address from `leaq fmt(%rip), %rdi`, al set to 0 and rsp aligned.

Then break `print_long` on purpose, in a small test program of its own, since it will crash. Copy it to `print_long_bad`, drop the stack adjustment and set eax to 1 instead of 0. Run it, then run it in gdb, which stops at the faulting instruction. Try each of the two changes alone as well.

### Done when

All tests pass. `sum8(1, 2, 3, 4, 5, 6, 7, 8)` is 36, and in gdb `x/2gx $rsp+8` at the first instruction shows `g` and `h`. `scale(2.5, 4)` is 10.0 and three `bump` calls leave `get_counter` at 3. `print_long_bad` crashes at a `movaps` inside `printf`, each change alone does not crash, and you can say why both are needed.

## Talking to the kernel with a system call

Every program so far asked libc to print for it. This step talks to the kernel directly, with no libc at all. Chapter 01 showed that a program cannot write to the terminal or a file on its own and asks the kernel with a system call. Here you make that request yourself: load a call number and arguments into registers and run one instruction that switches the CPU into the kernel. libc's `write(int fd, const void *buf, size_t n)` is a thin C wrapper around that instruction.

`fd` is a **file descriptor**, a small integer that names an open file. The stream numbers 0, 1 and 2 from chapter 01 are file descriptors. Chapter 08 covers what the kernel does with the call.

A system call on x86-64 Linux puts its number in rax and its arguments in rdi, rsi, rdx, r10, r8 and r9, then runs `syscall`. The result comes back in rax, and the kernel overwrites rcx and r11. Section A.2.1 of the ABI document lists these rules. The numbers live in `/usr/include/x86_64-linux-gnu/asm/unistd_64.h`: `write` is 1 and `exit` is 60. A program without libc has no `main`. The linker starts it at `_start`, and it must never return, because nothing called it:

```
# hello.s, x86-64 Linux without libc
# as -o hello.o hello.s && ld -o hello hello.o
        .text
        .globl  _start
_start:
        movl    $1, %edi                # fd 1 is stdout
        leaq    msg(%rip), %rsi         # rsi = address of msg
        movl    $len, %edx              # byte count
        movl    $1, %eax                # write
        syscall
        xorl    %edi, %edi              # exit status 0
        movl    $60, %eax               # exit
        syscall

        .section .rodata
msg:    .ascii  "hello from x86-64\n"
        .set    len, . - msg
        .section .note.GNU-stack,"",@progbits
```

You can watch every system call a program makes with `strace`, from the optional box in chapter 01. Install it with `sudo apt install -y strace` if you skipped that box. `strace ./out/x86/hello` prints the `execve` that started it, the `write(1, "hello from x86-64\n", 18)` and the `exit(0)`. It works on any Linux program, not just this one, and it is the fastest way to see what a program asks the kernel for.

### Study

- [Linux man page: syscall(2)](https://man7.org/linux/man-pages/man2/syscall.2.html) (reference, as needed): Under NOTES, the two "Architecture calling conventions" tables. Read the x86-64 row now and the arm64 row in step 6.

### Build

1. Write `src/x86/hello.s` as above. Build it with `as` and `ld` and run it.
2. Run `strace ./out/x86/hello` and read the three system calls it prints. Then run `strace` on any program you built in step 1 and watch it call `write` through libc.

### Done when

`hello` prints its line, `echo $?` prints 0, and `file` on it says "statically linked", because no libc was linked. `strace ./out/x86/hello` shows `execve`, one `write(1, ..., 18)` returning 18, and `exit(0)`. You can name the register that held the call number and the register that held the file descriptor.

## The same leaf functions on ARM64

Now redo the leaf functions on a second ISA. ARM64 runs most phones and a growing share of laptops and servers. Every instruction is 4 bytes long, only loads and stores touch memory, and there are 31 general registers instead of 16. The ideas carry over: argument registers, a result register, callee-saved registers and an aligned stack. The register names and the memory instructions differ.

Your laptop cannot run ARM64 code directly. Install a cross toolchain, which runs on x86-64 and produces ARM64 programs, and QEMU's user-mode emulator, which runs one ARM64 Linux program by translating its instructions into x86-64 instructions and passing its system calls to your kernel:

```sh
sudo apt install gcc-aarch64-linux-gnu qemu-user gdb-multiarch
mkdir -p out/arm64

aarch64-linux-gnu-gcc -g -O0 -static -o out/arm64/leaf_test tests/leaf_test.c src/arm64/leaf.s
qemu-aarch64 ./out/arm64/leaf_test
```

`-static` copies the ARM64 libc into the program, so QEMU needs no ARM64 library directory. Keep `-static` as the book's choice for every ARM64 program in this chapter. The other tools carry the same prefix, such as `aarch64-linux-gnu-objdump -d` and `aarch64-linux-gnu-as`, because the plain `objdump` cannot disassemble ARM64. QEMU may warn about a corrupt string table in a "system-supplied DSO". That object belongs to QEMU, and you can ignore the warning.

This is `add2` on ARM64:

```
// src/arm64/leaf.s
// long add2(long a, long b): a arrives in x0, b in x1, the result leaves in x0
        .text                   // what follows is code
        .globl  add2            // make the symbol visible to the linker
        .type   add2, %function
        .p2align 2              // start on a 4-byte boundary, the size of one instruction
add2:
        add     x0, x0, x1
        ret                     // jump to the address in x30

        .section .note.GNU-stack,"",%progbits
```

Comments start with `//`. A `#` after an instruction is read as part of an operand, because `#` marks an immediate value such as `#64`. A `long` or a pointer travels in a 64-bit `x` register, an `int` or a `char` in the 32-bit `w` half of one. Writing a `w` register clears the upper 32 bits of the matching `x` register.

ARM64 has no byte-moving `mov` into memory, so a function that walks a string loads and stores one byte at a time. Dive Into Systems chapter 9 does not cover these forms, so here they are, each one assembled and run under `qemu-aarch64`:

```
  ldrb w2, [x0, x3]     load the byte at x0 + x3 into w2, zero-extended
  strb w2, [x0, x3]     store the low byte of w2 at x0 + x3
  cbz  w2, 2f           jump to label 2 if w2 is 0
  cmp  x3, x1           compare the index with the length
  b.ge 2f               jump to label 2 if x3 >= x1 (b.ne, b.lt and so on exist too)
  add  x3, x3, #1       add the immediate 1 to x3
```

The full register contract is in the Build, as a table to keep open while you write. `bl` puts the return address in x30 and jumps. A leaf function never runs another `bl`, so x30 survives until its `ret`.

### Study

- [Dive Into Systems: ARM Assembly](https://diveintosystems.org/book/C9-ARM64/index.html) (read, 1 h): The chapter introduction, which mentions cross-compilers and QEMU, then 9.1 (9.1.1 to 9.1.4), 9.2, 9.3 and 9.4 (9.4.1 to 9.4.3). The sections follow the order of chapter 7, so read each one against its x86-64 twin and move fast where they match. The book's examples come from gcc on ARM64 Linux, so `aarch64-linux-gnu-gcc -O0` reproduces them.
- [QEMU: User space emulator](https://www.qemu.org/docs/master/user/main.html) (reference, as needed): Under "Linux User space emulator", the command line options `-L` and `-g` and the `QEMU_STRACE` variable. Skip the BSD part. `QEMU_STRACE=1 qemu-aarch64 ./prog` prints the system calls an ARM64 program makes, the way `strace` did on x86-64.

### Build

Write `src/arm64/leaf.s` with the same leaf functions as step 1 (`add2`, `sum_array`, `asm_strlen`, `asm_memcpy`, `abs_diff`, `div_mod`), using the byte-load table above for the string functions. Keep this register table open while you write:

```
  register     role                                   who must preserve it
  x0  to x7    arguments, x0 also carries the result   nobody, caller-saved
  x8           address for a large struct result       caller-saved
  x9  to x15   scratch                                 caller-saved
  x16, x17     scratch the linker may use              caller-saved
  x18          platform register, leave it alone
  x19 to x28   free to use if you restore them         callee-saved
  x29          frame pointer                           callee-saved
  x30          link register, the return address
  sp           stack pointer, a multiple of 16 at every call
```

Use only x0 to x15 in the leaf functions. Reuse the C test files unchanged and run every test under `qemu-aarch64`. `bad_sum` and `keeps` come along too. At `-O1`, gcc keeps `n` in x19 across the call, so a `bad_sum` that uses x19 without saving it breaks `keeps` the same way.

### Done when

Every leaf test passes under `qemu-aarch64`. `abs_diff(3, 10)` is 7 and `div_mod(17, 5, &r)` returns 3 with `r` set to 2. You can say which register holds the return address on ARM64 and why a leaf function does not need to save it.

## ARM64 frames, calls and system calls

A leaf function keeps its return address in x30. A function that calls another function loses x30 at the first `bl`, so it has to save x30 first, and the place is the stack. A non-leaf function opens with a prologue that pushes a frame record, the pair x29 and x30, and points x29 at it. Callee-saved registers go into the same frame:

```
// long sum3sq(long a, long b, long c)
        .globl  sum3sq
        .type   sum3sq, %function
        .p2align 2
sum3sq:
        stp     x29, x30, [sp, #-32]!   // sp -= 32, then store x29 and x30 at sp
        mov     x29, sp                 // x29 points at the frame record
        stp     x19, x20, [sp, #16]     // save the caller's x19 and x20
        mov     x19, x1                 // b survives the calls in x19
        mov     x20, x2                 // c survives the calls in x20
        bl      sq                      // x0 = sq(a)
        mov     x1, x0
        mov     x0, x19                 // x0 = b
        mov     x19, x1                 // x19 = sq(a)
        bl      sq                      // x0 = sq(b)
        add     x19, x19, x0
        mov     x0, x20
        bl      sq                      // x0 = sq(c)
        add     x0, x19, x0
        ldp     x19, x20, [sp, #16]     // restore the caller's x19 and x20
        ldp     x29, x30, [sp], #32     // load x29 and x30, then sp += 32
        ret
```

![The ARM64 frame next to the x86-64 one: both hold a saved frame-pointer and a return address, but x86-64 stacks the return address above the saved rbp while ARM64 stores the pair x29 and x30 together at the bottom of the frame.](figures/05-arm64-frame.svg)

The frame is 32 bytes, so sp stays a multiple of 16. Each saved x29 points at the caller's frame record, the same chain the rbp links formed on x86-64. On ARM64 the eight integer argument registers are x0 to x7, so a ninth or later argument goes on the stack. `sum8` fits in x0 to x7 and needs no stack arguments at all.

ARM64 builds addresses in two steps. One 4-byte instruction cannot hold a 64-bit address, so `adrp` loads the address of the 4 KB page that holds a symbol and `add` with `:lo12:` adds the low 12 bits. `printf` takes no al count, and the `long` goes in x1. clang at `-O1` compiles `printf("%ld\n", v)` to this:

```
  mov   x1, x0
  adrp  x0, .L.str
  add   x0, x0, :lo12:.L.str
  b     printf
```

It ends in `b printf` instead of `bl`, a **tail call**: a call that is the last thing a function does, turned into a plain jump so the callee returns straight to the original caller. A system call on ARM64 Linux puts its number in x8, its arguments in x0 to x5, and runs `svc #0`. The numbers live in `/usr/aarch64-linux-gnu/include/asm-generic/unistd.h`: `write` is 64 and `exit` is 93. An ARM64 `hello.s` has the same shape as the x86-64 one, with `adrp`/`add` for the message address and `svc #0` for each call.

### Study

- [Dive Into Systems: ARM functions and recursion](https://diveintosystems.org/book/C9-ARM64/functions.html) (read, 1 h 30 min): Sections 9.5 (9.5.1 to 9.5.3), 9.6 and 9.7 Arrays in Assembly. Stop before 9.8. Section 9.5.3 traces the `stp x29, x30` and `ldp` pair through `main`. Section 9.7 prints a comma after `LSL` in `ldr w0, [x1, x2, LSL, #2]`. Leave it out, because the GNU assembler rejects it.
- [Procedure Call Standard for the Arm 64-bit Architecture (AAPCS64)](https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst) (reference, as needed): Arm's own specification, written as reStructuredText with named headings rather than numbered sections. Read "General-purpose Registers" (section 6.1.1, its Table 2), "The Stack" (6.4.5), "Subroutine calls" (6.5), "Parameter passing rules" (6.8.2, where stage B covers structs larger than 16 bytes) and "Result return" (6.9). Skip the SIMD, SVE, SME and ZA material.

### Build

Write `src/arm64/calls.s` and `src/arm64/hello.s` with the same functions as steps 2, 3 and 4 (`sq`, `sum3sq`, `fib`, `sum8`, `print_long`, `hello`). `print_long` passes the value in x1 and needs its own frame record, because it runs a `bl`. `sum8` takes all eight arguments in x0 to x7, so unlike the x86-64 version it reads nothing from the stack.

1. Run every test under `qemu-aarch64`. In `gdb-multiarch`, stop in `fib` when the argument is 1 with `b fib if $x0 == 1`, run `fib(4)`, step past the prologue with `si`, and walk the frame records with `x/2a $x29`, as you did with rbp. Start it in two terminals: `qemu-aarch64 -g 1234 ./out/arm64/calls_test` in one, `gdb-multiarch -q ./out/arm64/calls_test -ex 'target remote :1234'` in the other.
2. Write `notes/abi.md`. For `sum3sq` and `fib` on both ISAs, fill in this skeleton, one block per function:

```
## sum3sq (x86-64)
- arguments arrive in:
- result leaves in:
- return address lives in (during the body):
- callee-saved registers used:
- prologue moves the stack pointer by (bytes):
```

> **Optional:** On the Mac, build `calls.s` natively with clang. Apple's ABI gives every C name a leading underscore (`_sum3sq`), spells `adrp` and `add` operands as `sym@PAGE` and `sym@PAGEOFF`, reserves x18, and passes the variadic arguments of `printf` on the stack, so `print_long` stores the value at `[sp]` instead of x1. [Apple: Writing ARM64 code for Apple platforms](https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms) lists these differences.

### Done when

All tests pass under `qemu-aarch64`. `hello` prints its line, `echo $?` prints 0, and `file` says "ARM aarch64" and "statically linked". At the `fib` breakpoint you walked at least three frame records with `x/2a $x29`, and `p (long)$sp % 16` prints 0 at every `bl`. You can explain every stack adjustment in `sum3sq` and `fib` on both ISAs from `notes/abi.md` without looking at the code.

## Reading optimized code

So far you read code at `-O0` and `-O1`, or code you wrote. Real programs ship at `-O2`, and `-O2` rewrites your function. The same three lines of C come out like this:

```
  C                            x86-64, clang -O2           ARM64, clang -O2
  int add(int a, int b)        leal (%rdi,%rsi), %eax      add w0, w1, w0
    { return a + b; }          ret                         ret
  long times8(long x)          leaq (,%rdi,8), %rax        lsl x0, x0, #3
    { return x * 8; }          ret                         ret
  long times10(long x)         addq %rdi, %rdi             add x8, x0, x0, lsl #2
    { return x * 10; }         leaq (%rdi,%rdi,4), %rax    lsl x0, x8, #1
                               ret                         ret
```

The table prints clang's `ret`. On x86-64 clang's own `-S` writes `retq`, as chapter 02 noted. x86-64 uses its address arithmetic, `lea`, as a three-operand add, and ARM64 shifts the second operand for free inside `add`. Neither instruction multiplies. Learn to name a few transformations the optimizer does:

- An **induction variable** is a variable that moves by a fixed step each loop iteration, such as the index times the element size, which the compiler keeps in a register instead of recomputing.
- **Loop-invariant code motion** lifts a computation whose result does not change out of a loop, so it runs once.
- **Inlining** replaces a call with the body of the callee, which then opens the body to the other transformations.
- A `switch` over dense cases becomes a **jump table**, covered in the next step.
- A **tail call** (step 6) becomes a plain jump.

The optimizer also deletes work whose result nothing uses, so every benchmark in chapter 07 needs a place to put its result.

The chapter uses two C compilers. clang is the book's compiler and the one you have written assembly for. gcc, which you installed in step 1, is the one Ubuntu builds its own packages with and the one Dive Into Systems compiles its examples with. Ubuntu's gcc adds three things clang leaves out, and you meet them in every gcc listing.

One is `endbr64` as the first instruction of every function. It marks a place where a call or jump may land, for the CPU's control-flow protection, and does nothing else. The second is a **stack canary**: a function with an array on the stack copies a secret value from `%fs:0x28` into its frame on entry and checks it before returning, which step 9 covers. The third appears at `-O2`, where calls such as `printf` and `strcpy` become `__printf_chk` and `__strcpy_chk`, versions that check buffer sizes.

Your chapter 04 library passes structs by value, so the ABI rules for structs show up in its listings. A `Str` is 16 bytes, two 8-byte fields. It travels in two argument registers, rdi and rsi or x0 and x1, and comes back in two, rax and rdx or x0 and x1. A `JsonResult` is 40 bytes, too big for registers. The caller reserves space for it and passes the address as a hidden argument: in rdi on x86-64, which moves every real argument one register along, and in x8 on ARM64, the register from step 5's table. This is `str_slice` at `-O2`:

```
  Str str_slice(Str s, ptrdiff_t beg, ptrdiff_t end)

  x86-64                     ARM64
  leaq (%rdi,%rdx), %rax     sub x1, x3, x2        result len  = end - beg
  subq %rdx, %rcx            add x0, x0, x2        result data = s.data + beg
  movq %rcx, %rdx            ret
  ret
```

### Study

- [Matt Godbolt: Advent of Compiler Optimisations 2025](https://xania.org/AoCO2025-archive) (read, 1 h): Short posts by the author of Compiler Explorer, each with a live example. Read days 4, 9, 13, 17 and 19 from the archive list: multiply by a constant, induction variables, loop-invariant code motion, inlining and tail calls. Godbolt says an LLM proofread the posts, and the code and measurements are his. A few posts mention C++ types. Read `std::string_view` as a pointer plus a length.
- [CMU 15-213: Machine-Level Programming II, Control](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/04-machine-control.pdf) (read, 20 min): Lecture slides from the Fall 2025 course, built on CS:APP by Bryant and O'Hallaron. Only the switch statements part, PDF pages 50 to 64 (page 49 is an in-class activity, so start at 50): a `switch` in C, its jump table, and how to find the table in a binary with gdb. Page 64 is the position-independent form your own programs use.

### Build

Take two functions from your chapter 04 `base.c`: `str_equals` and `str_parse_i64`. Compile each with clang at `-O2` for x86-64 with `clang -O2 -S -o -`, and for ARM64 with `clang --target=aarch64-linux-gnu -O2 -S -o -`, which finds the ARM64 headers the cross toolchain installed. For each `-O2` listing, write a comment block that maps every instruction to the C it came from and names each transformation from the posts.

Then look at the first instructions of `json_parse` on both ISAs and find where the hidden pointer to the `JsonResult` arrives and where each real argument went. Day 16 of the Godbolt archive walks a struct passed in registers with the System V rules from step 1, so read it here against your own `str_slice` listing. Last, write a function whose result is unused, such as a loop that sums an array into a local, and confirm that `-O2` removes the loop.

### Done when

Each of your two annotated listings names at least two transformations per ISA, and you can say why each one is correct for every input. You can say which registers carry a `Str` into and out of a function on both ISAs, and where a `JsonResult` goes instead. The unused-result loop is gone from the `-O2` listing.

## The Bomb Lab

Now practice reading code with no source. The CS:APP Bomb Lab gives you an x86-64 Linux program with six phases, which runs directly in WSL2. Each phase reads a line and calls `explode_bomb` unless the line is right. You get `main` in C and nothing else. The self-study bomb has its grading-server notification turned off, so an explosion costs you nothing but a restart.

Phase 3 is a `switch` compiled to a jump table: an array of code addresses in `.rodata`, indexed by the switch value. The code checks the bounds once, then jumps through the table. In a program built without position-independent code, such as the bomb, it reads like this:

```
  cmpq   $6, %rdi                  # compare x with the largest case
  ja     .Ldefault                 # unsigned compare: x > 6 or x < 0 goes to default
  jmp    *.Ltable(,%rdi,8)         # load the address at .Ltable + 8*x and jump there

  .section .rodata
  .Ltable:
  .quad  .Lcase0, .Lcase1, .Ldefault, .Lcase3, ...
```

![A jump table lookup: a bounds check sends out-of-range values to the default case, and an in-range index selects one address from a table in .rodata that the jump then follows.](figures/05-jump-table.svg)

`ja` is the unsigned "above", so one comparison rejects negative values too. In a disassembly the table has no name, only an address inside the `jmp`. Print it in gdb with `x/8gx` at that address to get the targets. Your own programs are position-independent, so gcc and clang store 4-byte offsets from the start of the table instead of addresses, which you print with `x/8dw`. The CMU slides from the last step show both forms.

The method for the whole bomb:

```
  objdump -d bomb > bomb.s        the whole program as text, to annotate
  gdb ./bomb:
    b explode_bomb                stop before any explosion
    b phase_1                     stop at the start of a phase
    disas                         the current function
    x/s $rsi                      the string an argument register points at
    p/x $rax, i r, si, ni         inspect and step
    r answers.txt                 run with the solved lines so far
  ./bomb answers.txt              reads solved lines from the file, then stdin
```

> **Practice:** Translate each phase into C on paper before you guess anything. Several phases read their line with `sscanf`, which parses a string the way `scanf` parses input and returns the number of fields it filled.

Phase 4 uses a recursive function, and phase 6 walks a linked list of structs. For phase 6 you need the structs and bitwise reading in the Study below, and your linked lists from chapter 02.

### Study

- [CS:APP Labs: Bomb Lab](https://csapp.cs.cmu.edu/3e/labs.html) (do, 12 h): From the Bomb Lab entry, download the "Self-Study Handout" (`bomb.tar`) and read the "Writeup", whose Hints section lists the tools. The CS:APP gdb notes are a two-page PDF on the same page. Unpack `bomb.tar` under your home directory, not under `/mnt/c`, so Windows does not rewrite the binary. Ignore the parts about requesting a bomb and the scoreboard, which apply to CMU students. Stop after phase 6. The secret phase is optional.
- [Dive Into Systems: 7.9 Structs in Assembly](https://diveintosystems.org/book/C7-x86_64/structs.html) (read, 40 min): Section 7.9, including 7.9.1 on alignment, for phase 6, and go back for 7.3.1 Bit Shifting Instructions and 7.3.2 Bitwise Instructions, which chapter 02 skipped and the bomb's earlier phases need. Navigate to 7.3 from the contents list.

### Build

Unpack `bomb.tar` under your home directory. Keep `answers.txt` with one solved line per phase and a file `bomb-notes.md` with the C you reconstructed for each phase.

### Done when

`./bomb answers.txt` gets through all six phases without an explosion and prints "Congratulations! You've defused the bomb!". For every phase, `bomb-notes.md` has C code that would accept the same inputs, and you can point at the instructions each line of it came from. You found phase 3's jump table in the disassembly and printed its targets in gdb.

## How a buffer overflow becomes an exploit

The bomb was a program you read. In this step you break a program and see why it breaks. You have seen that a copy with no length check runs off the end of a buffer, and chapter 01's ASan caught it. On the stack the bytes just above a local array are the saved registers and the return address.

![A write longer than the buffer runs upward past it, over the saved rbp and then over the return address, so ret jumps to the address the input left in the return-address slot.](figures/05-buffer-overflow.svg)

Recall the frame from step 2. A local `char buf[16]` sits at the low end of the frame, and the saved rbp and the return address sit just above it, at higher addresses. A write into `buf` moves toward higher addresses. A copy of more than 16 bytes keeps going, over the saved rbp, then over the return address. When the function runs `ret`, the CPU jumps to whatever is now in the return-address slot.

If the input chose that value, the input chose where the program goes next. To do it you write the address of the function you want, byte for byte, at the right offset in the input. For a `char buf[16]` with a saved rbp above it, the bytes are buf (16), the saved rbp (8), then the return address, so input byte 25 is the first byte of the return address. An address such as `0x401176` is written little-endian, low byte first, as `76 11 40 00 00 00 00 00`.

The CS:APP Attack Lab has you do exactly this: redirect a program to a function it never meant to call, then inject your own instructions and jump to them. The main skill is writing a few assembly instructions, assembling them, and reading their bytes out of the object file.

Three defenses sit in every modern binary, and you have already seen their traces. Here they are in the order the CPU meets them:

- A **stack canary** is a secret value the function writes between its locals and the saved return address on entry, loaded from `%fs:0x28`. Before `ret`, the function checks that the value is unchanged and calls `__stack_chk_fail` if it is not. An overflow that reaches the return address also changed the canary, so the program aborts before it jumps. gcc adds this with `-fstack-protector`, on by default on Ubuntu, and `-fno-stack-protector` turns it off.
- A **non-executable stack** (NX) marks the stack's memory as data, not code, so even if the input places instructions in `buf`, the CPU refuses to run them. The linker records this in the `GNU_STACK` segment. The `.note.GNU-stack` line you end every `.s` file with is what asks for it, and `-z execstack` at link time turns the stack back to executable.
- **ASLR**, address space layout randomization, loads the stack, the libraries and a **position-independent executable** (PIE) at a different address on each run, so the input cannot name an address in advance. Ubuntu builds PIEs by default, and `-no-pie` builds a fixed-address executable instead.

The Attack Lab's `ctarget` is built with all three off so the first attacks land: it is a `-no-pie` fixed-address executable with an executable stack, and the lab runs it with ASLR effectively off, which is why its addresses are the same on every run. Your own programs keep the defenses on, which is why every gcc listing from here carries a `%fs:0x28` load.

> **If it fails:** Expand the tar inside the Linux file system, under your home directory, not on the Windows side. A browser or an unzip tool on Windows clears the executable bit on `ctarget`, `rtarget` and `hex2raw`, and then the target will not run. Re-extract with `tar -xf target1.tar` inside WSL2 and run `chmod +x ctarget rtarget hex2raw` if needed. The targets expect a machine like the one that built them, which Ubuntu 24.04 under WSL2 is.

### Study

- [Dive Into Systems: 7.10 Real World: Buffer Overflow](https://diveintosystems.org/book/C7-x86_64/buffer_overflow.html) (read, 40 min): All of 7.10, sections 7.10.1 to 7.10.6. It walks a buffer overflow on an x86-64 Linux program with gdb memory dumps of `buf`, the saved rbp and the return address, and 7.10.6 "Protecting Against Buffer Overflow" covers the canary, the non-executable stack and stack randomization.
- [CS:APP Labs: Attack Lab](https://csapp.cs.cmu.edu/3e/labs.html) (do, 8 h): From the Attack Lab entry on the same page as the Bomb Lab, download the "Self-Study Handout" (`target1.tar`), a pair of x86-64 Linux targets that run in WSL2. The required phases are 1 to 3, the code-injection attacks on `ctarget`: redirect to `touch1`, then pass your cookie to `touch2` and `touch3`. Phases 4 and 5, the return-oriented programming attacks on `rtarget`, are optional. The lab needs three tools from the handout: `gcc -c` and `objdump -d` to turn the assembly you inject into bytes, and `hex2raw` to turn a line of hex bytes into the raw input the target reads. Find the buffer size in `getbuf` with `objdump -d` (the `sub $0x__,%rsp` at its start). Unpack the tar under your home directory, read the Writeup, and run every target with `-q` so it does not try to reach a grading server.

### Build

Write one small vulnerable function and see the defenses in the disassembly, not in an exploit:

```c
void vulnerable(const char *input) {
    char buf[16];
    strcpy(buf, input);   /* no length check: a classic overflow */
    printf("%s\n", buf);
}
```

1. Build it two ways: `gcc -O0 -o vuln vuln.c` for the default, hardened binary, and `gcc -O0 -fno-stack-protector -z execstack -no-pie -o vuln_unsafe vuln.c` with every defense off.
2. Run `objdump -d` on each. The default one loads `%fs:0x28` into the frame on entry, checks it before `ret`, and calls `__stack_chk_fail`. The unsafe one has none of that.
3. Run `readelf -lW` on each and read the `GNU_STACK` line. The default build is `RW`, the unsafe build `RWE`, the E marking the stack executable. Run `readelf -hW` and see that the default is a `DYN` (a PIE) and the unsafe one an `EXEC`.
4. Read `/proc/sys/kernel/randomize_va_space` (it is 2, ASLR on). Write a tiny program that prints the address of a local and run it twice outside gdb: the two addresses differ. gdb turns ASLR off, so inside it they would not.

### Done when

The default `objdump -d` shows the `%fs:0x28` load and the `__stack_chk_fail` call, and the unsafe one shows neither. The `GNU_STACK` flags read `RW` for the default build and `RWE` for the unsafe one. Two runs of your address-printing program print two different stack addresses. You can say, for each of the three defenses, what an attacker's overflow has to get past and which flag or instruction turns it on.

## Object files, symbols and relocations

Every program so far came from one `clang` or `gcc` command that hid a step. The compiler turns each `.c` or `.s` file into an object file. The linker joins the object files and libraries into one executable. Chapter 01 showed this pipeline and stopped at the linker joining `main.o` with the C library. Here you open the `.o` file.

![Find the symbol table's "uses" rows. Those names have no address in this file, so each needs a relocation the linker will fill.](figures/05-object-file.svg)

An **object file** holds **sections** of bytes (`.text` for code, `.data` and `.bss` for globals, `.rodata` for constants), a **symbol table** and **relocations**. The symbol table lists the names this file defines and the names it uses but does not define. A **relocation** is a note to the linker: at this offset, once you know where a symbol ends up, write its address or its distance from here. This is a call to `bump`, a function defined in another file, as `gcc -c` and `objdump -dr` show it:

```
   d:   e8 00 00 00 00          call   12 <main+0x12>
                        e: R_X86_64_PLT32       bump-0x4
```

The four zero bytes after the `e8` opcode are the hole. The relocation says to fill offset `0xe` with the distance to `bump`, minus 4 because x86 measures from the end of the instruction.

`nm` prints one line per symbol with a letter for its kind. The ones you meet here:

```
  T    a function in .text
  D    initialized global data
  B    zeroed global data in .bss
  R    read-only data
  U    a name this file uses but does not define
```

A lowercase letter means the symbol is local to the file, and `static` makes a symbol local. The `nm(1)` man page lists the rest. The stack canary from step 7 shows up here too, as `U __stack_chk_fail` in a gcc object file with a protected function. If headers, include guards, `static` and `extern` are not fresh, Beej's chapter 17 on multifile projects covers them.

> **Practice:** Predict before you run. Write down every symbol and its letter before you run `nm`, then compare. A surprise is a gap in your model of the file.

### Study

- [CMU 15-213: Linking](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/07-linking.pdf) (read, 45 min): Lecture slides from Fall 2025, built on CS:APP chapter 7. PDF pages 3 to 29, which cover the ELF sections and segments, the symbol table, symbol resolution and relocation. Skip the quiz on page 30 and leave the library and loader pages for the next step. The slides show `R_X86_64_32` and `R_X86_64_PC32`. Your Ubuntu objects use `PC32` for data and `PLT32` for calls, and `R_X86_64_32` appears only in non-PIE builds. Section 4.4.1 of the ABI document from step 1 defines all of them.

### Build

Split your chapter 04 code into separately compiled files. Your chapter 04 `base.c` is the starting point: chapter 04 made every function `static` and had each program `#include` it. Work in a new directory, `~/code/hello/split`, so that `src/` keeps the one-file version that `build.sh` builds and chapter 07 uses. Copy `src/base.c`, `src/json.c` and `src/jsoncheck.c` there. Split them into five groups, each a `.c` file with a header, drop `static` from the functions another file calls, and delete the copy of `base.c` once its code has moved:

1. `arena.c` for the arena.
2. `str.c` for `Str`, the growable arrays, the hash trie, `read_all` and `Buf`.
3. `json.c` for the JSON parser.
4. `jsoncheck.c`, the program with `main`.
5. a header per `.c` file (`arena.h`, `str.h`, `json.h`).

`build.sh` compiles one file per program, so it cannot build the split. First confirm the split still works: in `split/`, run `clang -std=gnu11 -g -fsanitize=address,undefined -o app *.c`, then `./app < ../doc.json; echo $?`, which prints 0 as chapter 04's `jsoncheck` did. Then:

1. Compile each file with `gcc -c`. Before running `nm` on each `.o` file, write down every symbol you expect and its letter (`T`, `U`, `D`, `B`, `t`, `r`). Compare.
2. Run `objdump -dr json.o`. Find one call relocation and one relocation for a global or a string constant. Link the program, find the same call in `objdump -d app`, and check by hand that the four bytes after `e8` equal the target address minus the address of the next instruction.
3. Define the same non-static global variable in two files and link. Read the error (`multiple definition`). On gcc 13 this happens whether or not the variable is initialized, because `-fno-common` is the default, so a reader on an older tutorial that reports no error is seeing an older default. Make one of them `static` and link again.
4. Compile `arena.c`, `str.c` and `json.c` for ARM64 with `aarch64-linux-gnu-gcc -c` and run `aarch64-linux-gnu-objdump -dr json.o`. List the relocation types you see, and for each one name the instruction it patches and what the linker writes there.

### Done when

Your `nm` predictions matched for every symbol, or you can explain each miss. Your hand calculation of the call displacement matches the bytes. You can explain the duplicate-symbol error in one sentence. For every ARM64 relocation type in `json.o` you can name the instruction it patches.

## Linking, libraries and the loader

Step 10 opened one object file. This step joins several, pulls in libraries, and follows a call into a shared library at run time. The linker works in two passes over everything it is given:

![The linker runs two passes over the object files: pass one matches every used name to one definition, pass two lays out the sections and fills every relocation hole, giving one executable.](figures/05-linker-passes.svg)

A **static library** (`.a`) is an archive of object files. The linker copies in only the members that define something still missing, and it scans the command line left to right, so order matters. A **shared library** (`.so` on Linux) stays a separate file that the **loader**, the part of the system that copies a program into memory and starts it, maps at run time, at an address nobody knows at link time. Code reaches a shared library's functions through the **procedure linkage table** (PLT) and its data through the **global offset table** (GOT).

![A call to json_parse goes to a PLT stub that jumps through a GOT slot. Before the first call the slot points back into the PLT resolver, and after the loader resolves it the slot points at json_parse inside libjson.so.](figures/05-plt-got.svg)

A shared library can load at a different address each run, so its code must be **position-independent**. The `-fPIC` flag makes the compiler emit position-independent code, which reaches its own globals and functions through the GOT instead of at a fixed address, so the same library works wherever the loader puts it.

Ubuntu's gcc links with `-z now` by default, which fills the whole GOT at load time. Link with `-Wl,-z,lazy` to see the lazy scheme Bendersky describes, where each entry is filled at the first call, so you can watch a GOT slot change. Use the lazy build for the Build below for that reason. Your calls go through an entry in `.plt.sec`, which is one `jmp` through the GOT. That is the one fact you need here: look for the stub in `.plt.sec`, not `.plt`.

The driver also links files you never wrote. `gcc -v` shows them on the linker command line:

```
  Scrt1.o             holds _start, the entry point from step 4. It calls
                      __libc_start_main, which calls your main and passes its
                      return value to exit. The S marks the version for
                      position-independent executables.
  crti.o, crtn.o      the opening and closing instructions of _init and _fini,
                      code that runs before main and at exit
  crtbeginS.o,        gcc's support for running constructor and destructor lists
  crtendS.o
  -lgcc, -lgcc_s      gcc's helper routines for operations with no instruction
  -lc                 libc itself, as libc.so.6
```

### Study

- [Eli Bendersky: Position Independent Code (PIC) in shared libraries](https://eli.thegreenplace.net/2011/11/03/position-independent-code-pic-in-shared-libraries) (read, 40 min): From the start through "PIC with function calls through PLT and GOT - an example". The examples are 32-bit x86 with Intel syntax. On x86-64 the code reaches the GOT with one `rip`-relative instruction instead of the `get_pc_thunk` call the article walks through. You see that in your own disassembly.
- [CMU 15-213: Linking](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/07-linking.pdf) (read, 15 min): The same deck as step 10, now PDF pages 31 to 41 on static and shared libraries. Skip the run-time linking with `dlopen` on pages 42 to 44.

### Build

Use the split from step 10 (`arena.o`, `str.o`, `json.o`, `jsoncheck.o`).

1. Run `gcc -v -o app *.o` and find the `collect2` line, the linker call. List the files it adds that you did not write, such as `Scrt1.o`, `crti.o` and `-lc`, and say what each one is for.
2. Run `readelf -hlW app`. Read the entry point from the header and confirm with `nm app | grep _start` that it is the address of `_start`. There are four `LOAD` segments: read-only headers, code (`.text`), read-only data (`.rodata`) and writable data (`.data` and `.bss`). Name which section is in each. Then run `ldd app` to see `libc.so.6` and the loader.
3. Build `libjson.a` from `arena.o`, `str.o` and `json.o` with `ar rcs`. Link `jsoncheck.o` with it, once with the library after `jsoncheck.o` and once before it. Explain the error.
4. Recompile `arena.c`, `str.c` and `json.c` with `-fPIC`, link them into `libjson.so` with `-shared`, and link `jsoncheck.c` against it with `-g -L. -ljson -no-pie -Wl,-z,lazy`. Run it with `LD_LIBRARY_PATH=.`, which tells the loader to search the current directory for `libjson.so`. In `objdump -d`, find the `json_parse@plt` entry in `.plt.sec` and the GOT address its `jmp` reads (objdump prints it after the `#` in the comment). In gdb, started with `LD_LIBRARY_PATH=.` as well, break on the line of the first call to `json_parse`, print that GOT slot with `x/a`, step over the call with `next`, and print the slot again.

### Done when

`readelf -hlW` shows the entry point equal to `_start`, and you can name which section is in each of the four `LOAD` segments. You can explain the library-order error in one sentence. The GOT slot held an address inside `.plt` before the first call and an address inside `libjson.so` after it, and you can say which code wrote it.

## A Makefile for the library

Every later chapter builds with `make` (xv6, Lua, Valkey, the Linux kernel), and the book has never had you write one. `build.sh` stays the build of this book. The point here is to read and write one small Makefile for the library you just split.

A **Makefile** is a list of rules. Each rule names a **target**, the file to build, its **prerequisites**, the files it is built from, and a **recipe**, the commands that build it:

```make
app: jsoncheck.o json.o
	cc -o app jsoncheck.o json.o
```

`make` rebuilds a target only when one of its prerequisites is newer than the target. So after you edit one `.c` file, only its `.o` and the program are rebuilt. Four more pieces make a Makefile short:

- Each recipe line must start with a tab, not spaces.
- A **pattern rule** such as `%.o: %.c` says how to make any `.o` from the `.c` of the same name.
- In a recipe, `$@` is the target, `$<` is the first prerequisite and `$^` is all of them.
- The `-MMD` flag makes the compiler write each file's header dependencies into a `.d` file, so a changed header rebuilds exactly the files that include it.

Here is the whole Makefile for the library:

```make
OBJS = jsoncheck.o json.o str.o arena.o
CFLAGS += -MMD
app: $(OBJS)
	$(CC) -o $@ $^
%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<
-include $(OBJS:.o=.d)
```

The first line names the object files. `app: $(OBJS)` links them, and its recipe is `$(CC) -o $@ $^`, which expands to the default `CC`, which is `cc`, linking `app` from all four objects. The pattern rule compiles each `.c`, and `-include $(OBJS:.o=.d)` pulls in the `.d` files `-MMD` wrote, so header edits are tracked. `make -n` prints the commands without running them.

### Study

- [GNU Make Manual](https://www.gnu.org/software/make/manual/make.html) (reference, as needed): Read only 2.1 "What a Rule Looks Like", 5.1 "Recipe Syntax" (where the tab rule is), 4.3 "Types of Prerequisites", 4.14 "Generating Prerequisites Automatically", and 10.5.3 "Automatic Variables" (where `$@`, `$<` and `$^` are defined), for the one Makefile in the Build.

### Build

Write the `Makefile` above in `split/`, next to the split library.

1. Run `make -n` to see what would run without running it, then `make`, then run `./app`.
2. Touch `str.h` and run `make -n` again: only the files that include `str.h` rebuild, and `arena.o`, which does not include it, stays. Run `make`, then `make -n` once more to see nothing left to do.

### Done when

`make` builds and runs `app`. After touching `str.h`, `make -n` lists only the files that include it and leaves `arena.o` alone, and you can explain from the `.d` files how `make` knew.

## Decoding 8086 MOV instructions

The rest of the chapter goes the other way: from bytes to instructions. You start with the Intel 8086 from 1978, the first chip of the x86 line. Its encoding is small enough to decode by hand, and x86-64 still encodes many instructions the same way. Casey Muratori's Performance-Aware Programming course on Computer Enhance builds a decoder and then a simulator for it, and the next four steps follow his Part 1.

From here on the assembly is written in Intel syntax, which is nasm's and the Intel manual's, with the destination on the left: `mov cx, bx` copies bx into cx, the opposite order from the AT&T `movq %rsi, %rdi` you wrote in the first half. **nasm** is an assembler for x86 that reads Intel syntax. Install it with `sudo apt install nasm`. Clone the course listings inside WSL, not on the Windows side, so git does not rewrite the line endings in the binary listings:

```sh
git clone https://github.com/cmuratori/computer_enhance ~/computer_enhance
```

A file like `listing_0037_single_register_mov.asm` is the source, and the file of the same name without `.asm` holds the bytes nasm made from it.

The 8086 has eight 16-bit registers. The first four can also be used as two 8-bit halves:

```
  16-bit   ax  cx  dx  bx  sp  bp  si  di
  8-bit    al  cl  dl  bl  ah  ch  dh  bh     (low halves, then high halves)
  code     000 001 010 011 100 101 110 111    (the 3-bit number in the encoding)
```

A register-to-register `mov` takes two bytes. Listing 37 is the single instruction `mov cx, bx`, stored as `89 d9`:

![The two bytes 89 d9 of mov cx, bx: byte one is a six-bit opcode then the d and w bits, byte two is the two-bit mod field, the three-bit reg field and the three-bit r/m field.](figures/05-8086-fields.svg)

Your laptop's CPU still decodes these two bytes the same way. In 64-bit code `89 d9` is `mov ecx, ebx`, and `48 89 d9` is `mov rcx, rbx`, where the prefix byte `48`, a **REX prefix**, widens the operation to 64 bits. `objdump -d out/x86/leaf_test` shows a `48` in front of the `movq` in your `add2`.

Other `mov` forms add a displacement or an immediate value, so an instruction is 1 to 6 bytes long. The `mod` and `r/m` fields together pick the operand: a register, or a memory address built from `bx`, `bp`, `si` and `di`.

![The mod and r/m fields pick the operand: mod 11 means r/m is a register, and the three lower mod values give a memory address built from bx, bp, si and di, with 0, 1 or 2 displacement bytes following.](figures/05-modrm.svg)

One case breaks the pattern: `mod = 00` with `r/m = 110` means a direct 16-bit address, not `[bp]`. So nasm encodes `mov dx, [bp]` as `8b 56 00`, with an 8-bit displacement of 0. An 8-bit displacement is signed. Run it through your `sign_extend` from chapter 04 before you print `[bp + di - 37]`.

The decoder reads the whole binary from standard input with chapter 04's `read_all`, which works for binary input as well as text. It walks the buffer one instruction at a time and prints nasm source. The test is a round trip: if nasm turns your output back into the same bytes, you decoded every instruction correctly. Build your decoder with `sh build.sh decode`, which writes `out/Linux-debug/decode`:

```sh
./out/Linux-debug/decode < listing_0039_more_movs > out39.asm
nasm out39.asm -o out39.bin
cmp out39.bin listing_0039_more_movs && echo same
```

Your output must start with `bits 16`, or nasm assembles for a different mode.

### Study

- [Computer Enhance: Instruction Decoding on the 8086](https://www.computerenhance.com/p/instruction-decoding-on-the-8086) (watch, 30 min): The whole video. Paid, part of your subscription. The homework is listings 37 and 38.
- [Computer Enhance: Decoding Multiple Instructions and Suffixes](https://www.computerenhance.com/p/decoding-multiple-instructions-and) (watch, 45 min): The whole video. The homework is listing 39, with listing 40 as an optional challenge.
- [Intel 8086 Family User's Manual, October 1979](https://edge.edx.org/c4x/BITSPilani/EEE231/asset/8086_family_Users_Manual_1_.pdf#page=160) (reference, as needed): A scanned PDF of Intel's manual (no text layer, so search will not work), hosted on an edX course page, so save a copy in case the host moves. PDF pages 160 to 173, printed pages 4-18 onward: "Machine Instruction Encoding and Decoding", tables 4-7 to 4-11 for the fields, table 4-12 with the bit patterns of every instruction (the MOV rows are on PDF page 164), and table 4-13, the decode-by-first-byte table, the fastest way to find an opcode while writing the decoder.

### Build

Write `src/decode.c`. Keep the register names in two arrays of 8 strings indexed by the 3-bit field, and the effective-address forms (`bx + si`, `bx + di`, `bp + si`, `bp + di`, `si`, `di`, `bp`, `bx`) in a third. Decode instruction by instruction:

1. Register to register, enough for listings 37 and 38.
2. Register to and from memory with no, 8-bit and 16-bit displacement, including the direct-address case.
3. Immediate to register.

Write a test script `tests/decode_test.sh` that runs the round trip for every listing in this step and prints OK or FAIL per listing. Add a check in the decoder for an opcode it does not know: print the byte offset and the byte to `stderr` and exit with status 1.

### Done when

The round trip prints OK for listings 37, 38 and 39. For each instruction in listing 39 you can write its bytes on paper from the assembly using table 4-12 and match them against `od -An -tx1` of the binary.

Then take your own `add2` from `objdump -d`: its first bytes are `48 89 f8` for `movq %rdi, %rax`. Decode them by hand with the REX prefix `48`, the opcode `89` and the mod-reg-r/m byte `f8`, the same way you decoded `89 d9`. Feeding the decoder a byte it does not handle prints the offset and exits with status 1. Listing 40 is optional.

## Decoding arithmetic and jumps

`add`, `sub` and `cmp` reuse the patterns you already decode. Each has a register-and-memory form with `d`, `w`, `mod`, `reg` and `r/m`, an immediate-to-register-or-memory form, and an immediate-to-accumulator form. The immediate form puts the operation in the `reg` field of the second byte, so one opcode covers several instructions. Casey's video shows how to share one decoding path for all three.

Conditional jumps such as `jnz` are two bytes: an opcode and a signed 8-bit displacement measured from the end of the jump. Labels do not exist in the bytes, so print the target as nasm's `$` plus an offset. `$` is the address where the current instruction starts, so a jump with displacement `d` reaches `$ + 2 + d`. A `jnz` at offset 12 with displacement -8 prints as `jnz $-6` and goes to offset 6.

The code review video is optional. If you watch it, do so only after your own decoder passes. Casey walks through his reference decoder, which uses a table of instruction formats instead of a long `switch`. The simulator builds on whatever you have at the end of this step.

### Study

- [Computer Enhance: Opcode Patterns in 8086 Arithmetic](https://www.computerenhance.com/p/opcode-patterns-in-8086-arithmetic) (watch, 20 min): The whole video. The homework is listing 41, with listing 42 as an optional challenge.
- [Computer Enhance: 8086 Decoder Code Review](https://www.computerenhance.com/p/8086-decoder-code-review) (watch, 1 h 20 min): Optional. Watch it only after listing 41 round-trips, and only if you want to compare designs before the simulator. Casey says you can skip it if you are happy with your own decoder.

### Build

Extend `src/decode.c` with `add`, `sub` and `cmp` in all three forms, and the conditional jumps and loops in listing 41 (`je`, `jl`, `jle`, `jb`, `jbe`, `jp`, `jo`, `js`, `jnz` and the rest, plus `loop`, `loopz`, `loopnz` and `jcxz`). Look up each opcode in table 4-12 of the Intel manual from the previous step. Add listing 41 to the round-trip script.

### Done when

The round trip prints OK for listings 37, 38, 39 and 41. For any instruction in listing 41 you can find its row in table 4-12 and say which bits picked `add`, `sub` or `cmp`. If you watched the code review, you can name one thing the reference decoder does differently from yours and say which version you kept and why.

## Simulating registers, flags and jumps

A simulator executes what the decoder decodes. For `mov` that means storing a value in an array of registers. Arithmetic does more: `add`, `sub` and `cmp` also set **flags**, single bits that describe the result. `cmp` is a `sub` that sets the flags and throws the result away.

The required listings use four flags: zero (Z, the result is 0), sign (S, the top bit of the result is 1), parity (P, the low byte of the result has an even number of 1 bits) and carry (C, the operation carried out of or borrowed into the top bit). The reference traces also show auxiliary carry (A), and the optional listing 47 adds overflow (O). You need A and O only for listing 47 and for a trace that matches line by line.

A conditional jump reads the flags. To jump, the simulator needs an **instruction pointer** (IP), the offset of the next instruction. Your decoder already kept one to know where the next instruction starts. Now it becomes a register: each instruction adds its length to IP, and a jump that is taken adds its displacement as well. This is the fetch, decode, execute loop from chapter 03, on a CPU with variable-length instructions:

```
  while ip < program length:
      decode the instruction at memory[ip]   ->  its length and its fields
      ip = ip + length
      execute it: update registers and flags, and for a taken jump, ip = ip + disp
```

Each listing in this step comes with a `.txt` file of the reference simulator's output. Its last block lists every register whose final value is not zero, then the flags that are set, in the order C, P, A, Z, S, O. The files for listings 43 to 47 have no `ip` line, because those homeworks come before IP. Listing 49 ends like this:

```
Final registers:
      bx: 0x0406 (1030)
      ip: 0x000e (14)
   flags: PZ
```

Print your final state in the same format, with an option to leave out `ip` for the early listings, so `diff` can check it. The `.txt` files use Windows line endings (a `\r` before each newline, which you can see with `cat -A`) and end with a blank line, so strip the `\r` and the blank lines on both sides before comparing. Put the whole comparison in a script so you do not retype it, and build your simulator with `sh build.sh sim`:

```sh
# tests/sim_test.sh runs this for each listing
./out/Linux-debug/sim < "$1" > got.txt
sed -n '/^Final registers/,$p' "$1.txt" | tr -d '\r' | sed '/^$/d' > want.txt
sed -n '/^Final registers/,$p' got.txt | sed '/^$/d' > have.txt
diff want.txt have.txt && echo "OK $1" || echo "FAIL $1"
```

`tr -d '\r'` removes the carriage return each Windows line ends with, so the reference lines match your Unix-newline output.

### Study

- [Computer Enhance: Simulating Non-memory MOVs](https://www.computerenhance.com/p/simulating-non-memory-movs) (watch, 20 min): The whole video. The homework is listings 43 and 44, with 45 as an optional challenge.
- [Computer Enhance: Simulating ADD, SUB, and CMP](https://www.computerenhance.com/p/simulating-add-jmp-and-cmp) (watch, 26 min): The whole video. The homework is listing 46, with 47, the full set of flags, as an optional challenge.
- [Computer Enhance: Simulating Conditional Jumps](https://www.computerenhance.com/p/simulating-conditional-jumps) (watch, 20 min): The whole video. The homework is listings 48 and 49, with 50 as an optional challenge.

### Build

Write `src/sim.c`, or add a `-exec` option to your decoder, so one program decodes and executes. It keeps eight 16-bit registers, IP and the flags, and writes 8-bit results into the correct half of a 16-bit register. Print one line per executed instruction, then the final block.

1. Write `tests/sim_test.sh` with the `diff` pipeline above as a function, so each listing is one line in the script.
2. Add listings 43, 44, 46, 48 and 49 to the script.

### Done when

The script prints OK for listings 43, 44, 46, 48 and 49. Before running listing 49, you trace its loop on paper, writing down cx, bx, IP and the flags after every instruction, and your page matches the simulator's trace. You can explain why `sub bp, 2026` in listing 46 leaves both the Z and P flags set.

## Simulating memory

The last piece is memory. The 8086 addresses up to 1 MB, so give the simulator a 1 MB byte array. Every memory operand you decoded in step 13 now computes an **effective address**, such as `bx + si + 4`, and reads or writes one byte or two.

A 16-bit value is stored little-endian, low byte first, like the `int` you dumped in chapter 02. Ignore the 8086's segment registers here. Casey's listings keep every address inside the first 64 KB.

With `mov`, `add`, `sub`, `cmp` and conditional jumps, small real programs already work. Listing 54 draws a 64 by 64 picture into memory, four bytes per pixel, starting at address 256. Each pixel gets its x coordinate as red, its y coordinate as blue and 255 as alpha. Dump the simulator's memory to a file at exit, then turn the pixels into a PNG with Python. It needs Pillow, so install it with `sudo apt install python3-pil` if `import PIL` fails. Put the conversion in a four-line file so you can read it:

```python
# tools/png.py
import sys
from PIL import Image

data = open(sys.argv[1], "rb").read()
Image.frombytes("RGBA", (64, 64), data[256:256 + 64 * 64 * 4]).save(sys.argv[2])
```

```sh
./out/Linux-debug/sim -dump mem.bin < listing_0054_draw_rectangle
python3 tools/png.py mem.bin rect.png
```

The image should show red growing from left to right and blue from top to bottom. The values only reach 63 out of 255, so expect dark colors.

> **Optional:** Casey's next video, [Estimating Cycles](https://www.computerenhance.com/p/estimating-cycles), adds 8086 cycle counts to the simulator. Nothing in chapter 06 needs it.

### Study

- [Computer Enhance: Simulating Memory](https://www.computerenhance.com/p/simulating-memory) (watch, 27 min): The whole video. The homework is listings 51 and 52, with 53 as an optional challenge.
- [Computer Enhance: Simulating Real Programs](https://www.computerenhance.com/p/simulating-real-programs) (watch, 16 min): The whole video. The homework is listing 54, with 55 as an optional challenge.

### Build

Add memory to the simulator: a 1 MB array, effective-address calculation for every `mod` and `r/m` combination your decoder handles, 8-bit and 16-bit loads and stores, and the `-dump` option. Load the program at address 0, as Casey's listings expect. Add listings 51, 52 and 54 to `tests/sim_test.sh`, and write `tools/png.py` as above.

### Done when

The script prints OK for every listing from 43 to 54 that is not marked optional. `rect.png` shows the gradient. Without running anything, you can say which bytes listing 51's `mov word [bx + 4], 10` writes and at which addresses.

## Where this leads

You can now write a function in assembly on both ISAs and call it from C, explain every stack adjustment in a prologue, read `-O2` output and name what the optimizer did, and follow a program from object files through the linker to the loader. You saw why a buffer overflow is dangerous and what the canary, the non-executable stack and ASLR do about it. You also wrote a decoder and a simulator for a real instruction set, so a CPU's fetch, decode and execute loop is code you wrote and tested.

What you have not built is a whole machine: a CPU together with its screen, keyboard, timers and a program to run at full speed. Chapter 06, A CHIP-8 emulator, does that. CHIP-8 is a small virtual machine from the 1970s with fixed two-byte instructions, so its decoder is simpler than your 8086 one.

Its first two steps write the whole machine state as one C struct and six instructions, and run them headless, printing the display as text, until two test ROMs draw their logos. The rest of the instruction set follows. The new parts come after that: a window for the 64 by 32 display, the keypad, the two timers and a main loop that runs the CPU at a fixed rate. Your simulator's loop and your test-by-diff habit carry straight over.
