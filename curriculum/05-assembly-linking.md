---
id: 05
title: Assembly, the ABI and linking
part: The machine and C
weeks: 8
project: Hand-written ARM64 and x86-64 functions called from C, then an 8086 instruction decoder and simulator in C.
---

Chapter 04 left you writing C you can reason about at the byte level: how a struct sits in memory, which code the compiler may assume never runs, and how an arena replaces a pile of small `malloc` calls. In chapter 02 you read clang's ARM64 output for three of your functions. In chapter 03 you wrote an assembler for a 16-bit CPU you built from gates. You have not yet written assembly for a real CPU, and you have not looked at what happens between `clang -c` and a program that runs.

The chapter has two halves. In the first five steps you write small functions in ARM64 assembly on the Mac and in x86-64 assembly in a Linux machine, call them from C, and learn the rules that make the call work. Then you read code the compiler optimized, defuse a bomb from its disassembly alone, and split your chapter 04 library into object files to watch the linker join them. In the last four steps you write an 8086 decoder and simulator in C, following Casey Muratori's Computer Enhance course. The decoder is your chapter 03 assembler run backwards: bytes in, assembly text out.

Three terms come up in every step. Keep them apart:

```
  ISA            which instructions a CPU runs and how they are encoded.
                 ARM64 and x86-64 are two ISAs.
  ABI            how separately compiled code agrees on argument registers,
                 return values, saved registers and stack alignment.
                 macOS and Linux on the same ARM64 CPU use slightly different ABIs.
  object format  how code, symbols and relocations are stored in a file.
                 Linux uses ELF. macOS uses Mach-O.
```

You write assembly in this chapter to learn those rules. Keep the programs small. Outside this chapter the compiler writes the assembly and you read it. The chapter comes now because chapter 06 builds a whole machine in software on top of the decode and execute loop you write here, and chapter 07 starts measuring speed, where every measurement ends with reading the instructions the compiler produced.

## An ARM64 function in its own file

In chapter 02 you read `swap_ints` after clang compiled it. Now you write the `.s` file yourself and let clang assemble it and link it with a C caller. The C side needs only a prototype such as `long add2(long a, long b);`. One clang command compiles the `.c` file, assembles the `.s` file and links both:

```sh
clang -g -O0 -o out/leaf_test tests/leaf_test.c src/arm64/leaf.s
```

An assembly file holds instructions and directives. Directives start with a dot and talk to the assembler, not the CPU. This file defines one function:

```
// src/arm64/leaf.s
// long add2(long a, long b): a arrives in x0, b in x1, the result leaves in x0
        .text                   // what follows is code
        .globl  _add2           // make the symbol visible to the linker
        .p2align 2              // start on a 4-byte boundary, the size of one instruction
_add2:
        add     x0, x0, x1
        ret                     // jump to the address in x30
```

On macOS every C name gets a leading underscore in assembly, so the C function `add2` is the label `_add2`. Linux uses no underscore. A label made of a digit, like `1:`, is a local label. `b.ne 1b` jumps back to the nearest `1:` above it and `1f` looks forward. Use them for loops so you do not have to invent names.

Assembly has no types. The C prototype decides what the bits mean. A `long` or a pointer travels in a 64-bit `x` register, an `int` or a `char` in the 32-bit `w` half of one. Writing a `w` register clears the upper 32 bits of the matching `x` register.

The ABI is a contract between the function and its caller. These are the parts a leaf function (one that calls nothing) has to respect on your Mac:

```
  register     role                                   who must preserve it
  x0  to x7    arguments, x0 also carries the result   nobody, caller-saved
  x8           address for a large struct result       caller-saved
  x9  to x15   scratch                                 caller-saved
  x16, x17     scratch the linker may use              caller-saved
  x18          reserved by Apple, never touch it
  x19 to x28   free to use if you restore them         callee-saved
  x29          frame pointer                           callee-saved
  x30          link register, the return address
  sp           stack pointer, a multiple of 16 at every call
```

Caller-saved means the callee may destroy the value, so a caller that needs it after the call must keep a copy. Callee-saved means the callee must put the old value back before `ret`, so the caller can keep values there across the call. A leaf function that sticks to x0 to x15 needs no stack at all. Breaking the rule does not fail at the instruction that breaks it. The caller computes a wrong value later, in code that looks correct.

Chapter 01's lldb commands work on assembly, because `-g` records line information for your `.s` file too. A few more help here:

```
  b add2              breakpoint on _add2, lldb drops the underscore
  re r x0 x1          read registers x0 and x1
  si                  step one instruction
  di -f               disassemble the current function
  x/4xg $sp           four 8-byte words at the stack pointer, in hex
```

### Study

- [Dive Into Systems: 9.7 Arrays](https://diveintosystems.org/book/C9-ARM64/arrays.html) (read, 25 min): The whole section. It continues the chapter 9 reading from chapter 02 and shows the scaled-index load `ldr w0, [x1, x2, LSL #2]` that your array loop needs. The book prints a comma after `LSL`. Leave it out, because clang rejects it.
- [Apple: Writing ARM64 code for Apple platforms](https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms) (read, 15 min): Every section except "Handle C++ differences" and "Enable DIT". It lists where macOS departs from the Arm standard. The variadic rule matters in the next step.
- [Procedure Call Standard for the Arm 64-bit Architecture (AAPCS64)](https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst) (reference, as needed): Arm's own specification. Look things up in 6.1.1 General-purpose Registers with its Table 2, 6.4.5 The Stack, 6.5 Subroutine calls, 6.8.2 Parameter passing rules (stage B covers structs larger than 16 bytes) and 6.9 Result return. Skip the SIMD, SVE, SME and ZA material.

### Build

Write `src/arm64/leaf.s` with four functions, each with its prototype in `tests/leaf_test.c`:

1. `long add2(long a, long b)`.
2. `long sum_array(const long *a, long n)`. Return 0 when `n` is 0.
3. `size_t asm_strlen(const char *s)`. Load one byte at a time with `ldrb`.
4. `void *asm_memcpy(void *dst, const void *src, size_t n)` copies byte by byte and returns `dst`.

Use only x0 to x15. Write the test file with the OK and FAIL pattern from chapter 02. Test `add2` with negative numbers. Test `sum_array` on an empty array, `{5}` and `{1, 2, 3, -4}`. Test `asm_strlen` on `""`, `"a"`, `"hello"` and a 1000-character string you build with `memset`. Test `asm_memcpy` for 0, 1, 7 and 100 bytes into a buffer with guard bytes after the destination, and check that the guard bytes did not change and the return value equals `dst`.

Then break the contract on purpose. Write `long bad_sum(const long *a, long n)` that keeps its running sum in x19 without saving it. Put this caller in `src/keeps.c`:

```c
long bad_sum(const long *a, long n);

long keeps(const long *a, long n) {
    long k = n * 7;
    long s = bad_sum(a, n);
    return s + k;
}
```

Build a test of `keeps` with `-O1` instead of `-O0`, so that clang keeps `n` in a callee-saved register across the call. Run it, then open it in lldb, run `di -n keeps` and find the register that holds `n` across the `bl`.

### Done when

All tests pass on the Mac. Stepping through `sum_array` in lldb with `si`, you can say what x0, x1 and your loop registers hold after every instruction of the first two iterations. `keeps` returns the wrong value, and you can point at the instruction in `keeps` that read the register `bad_sum` destroyed. You can explain why a function made only of valid instructions can still break its caller.

## Stack frames, nested calls and recursion on ARM64

`bl` puts the return address in x30 and jumps. A leaf function never runs another `bl`, so x30 survives until its `ret`. A function that calls another function loses its own return address at the first `bl`. It has to save x30 somewhere first, and the place is the stack.

A non-leaf function opens with a prologue that pushes a frame record, the pair x29 and x30, and points x29 at it. If it needs values to survive its own calls, it keeps them in callee-saved registers and saves the caller's copies of those registers in the same frame. The epilogue undoes everything in reverse order. This function computes `sq(a) + sq(b) + sq(c)`:

```
// long sum3sq(long a, long b, long c)
        .globl  _sum3sq
        .p2align 2
_sum3sq:
        stp     x29, x30, [sp, #-32]!   // sp -= 32, then store x29 and x30 at sp
        mov     x29, sp                 // x29 points at the frame record
        stp     x19, x20, [sp, #16]     // save the caller's x19 and x20
        mov     x19, x1                 // b survives the calls in x19
        mov     x20, x2                 // c survives the calls in x20
        bl      _sq                     // x0 = sq(a)
        mov     x1, x0
        mov     x0, x19                 // x0 = b
        mov     x19, x1                 // x19 = sq(a)
        bl      _sq                     // x0 = sq(b)
        add     x19, x19, x0
        mov     x0, x20
        bl      _sq                     // x0 = sq(c)
        add     x0, x19, x0
        ldp     x19, x20, [sp, #16]     // restore the caller's x19 and x20
        ldp     x29, x30, [sp], #32     // load x29 and x30, then sp += 32
        ret
```

At the first `bl`, the frame looks like this:

```
  higher addresses
  +---------------------------+  <- sp on entry, a multiple of 16
  | saved x20                 |  sp + 24
  | saved x19                 |  sp + 16
  | saved x30, return address |  sp + 8
  | saved x29, caller's frame |  sp + 0   <- sp and x29 after the prologue
  +---------------------------+
  lower addresses
```

The frame is 32 bytes, so sp stays a multiple of 16. Each saved x29 points at the caller's frame record, so the frame records form a linked list from the newest frame to the oldest. lldb's `bt` walks that list, and Apple requires x29 to point at a valid record at all times. A recursive function is the same prologue stacked once per call.

The step ends with two programs that talk to the operating system. On the Mac, call libc. Your assembly `_main` loads arguments and runs `bl _write`, like a C program would. One rule differs from Linux: on Apple platforms the variadic arguments of a function like `printf` go on the stack, not in registers. To print a `long` you reserve 16 bytes, store the value at `[sp]` and pass only the format string in x0. On Linux the same value goes in x1. Compiled C shows both versions:

```
  printf("%ld\n", v), clang -O1

  macOS, ARM64                          Linux, ARM64
  sub   sp, sp, #32                     mov   x1, x0
  stp   x29, x30, [sp, #16]             adrp  x0, .L.str
  add   x29, sp, #16                    add   x0, x0, :lo12:.L.str
  str   x0, [sp]                        b     printf
  adrp  x0, l_.str@PAGE
  add   x0, x0, l_.str@PAGEOFF
  bl    _printf
  ...
```

The Linux version ends in `b printf` instead of `bl`, a tail call. Step 4 comes back to it. `adrp` plus `add` builds the address of a string in two instructions, because one fixed 32-bit instruction cannot hold a whole 64-bit address. Apple's assembler spells the two halves `@PAGE` and `@PAGEOFF`, the GNU assembler on Linux spells the second one `:lo12:`.

In the Linux VM, skip libc and talk to the kernel directly. A system call on ARM64 Linux puts its number in x8, its arguments in x0 to x5, and runs `svc #0`. The numbers live in `/usr/include/asm-generic/unistd.h`: `write` is 64 and `exit` is 93. A program without libc has no `main`. The linker starts it at `_start`, and it must never return, because nothing called it:

```
// hello.s, ARM64 Linux without libc
// as -o hello.o hello.s && ld -o hello hello.o
        .text
        .globl  _start
_start:
        mov     x0, #1                  // fd 1 is stdout
        adrp    x1, msg
        add     x1, x1, :lo12:msg       // x1 = address of msg
        mov     x2, #len                // byte count
        mov     x8, #64                 // write
        svc     #0
        mov     x0, #0                  // exit status
        mov     x8, #93                 // exit
        svc     #0

        .section .rodata
msg:    .ascii  "hello from arm64\n"
        .set    len, . - msg
        .section .note.GNU-stack,"",%progbits
```

The last line tells the Linux linker that this code does not need an executable stack. Without it, `ld` prints a warning. macOS has system calls too, but Apple keeps their numbers private and changes them, so on the Mac you go through libc.

### Study

- [Dive Into Systems: 9.5.2 Tracing Through an Example](https://diveintosystems.org/book/C9-ARM64/functions.html#_tracing_through_an_example) (read, 1 h): 9.5.2 and 9.5.3, then "Next" to 9.6 Recursion, including the animation in 9.6.1. Chapter 02 stopped you before 9.5.2. The book runs gcc on ARM64 Linux, so its frames match your VM. Clang on the Mac builds the same frames with small differences in order.
- [Linux man page: syscall(2)](https://man7.org/linux/man-pages/man2/syscall.2.html) (reference, as needed): Under NOTES, the two "Architecture calling conventions" tables. Read the arm64 row now and the x86-64 row in the next step.

### Build

Write `src/arm64/calls.s` and `tests/calls_test.c` on the Mac:

1. `long sq(long x)` and `long sum3sq(long a, long b, long c)` as above. Test `sum3sq(2, 3, 4)` is 29 and `sum3sq(-1, 0, 5)` is 26.
2. `long fib(long n)` with two recursive calls, `fib(n - 1) + fib(n - 2)`, and `fib(0) = 0`, `fib(1) = 1`. Test it against a C version for every `n` from 0 to 25.
3. `void print_long(long v)` that calls `printf("%ld\n", v)` with the Apple variadic rule.
4. `src/arm64/hello_mac.s` with a `_main` that prints one line with `write` and returns 0. Build it alone with `clang -g -o out/hello_mac src/arm64/hello_mac.s`.

In the Linux VM, write `src/arm64/hello_linux.s` as above, build it with `as` and `ld`, and run it. Then make `calls.s` work in the VM too. Copy it, drop the underscores, change `@PAGE` and `@PAGEOFF` to the plain symbol and `:lo12:`, and pass the `printf` argument in x1 instead of on the stack.

In lldb, set a breakpoint on `fib` that stops only when the argument is 1, with `br s -n fib -c '$x0 == 1'`, and run `fib(4)`. At the stop, run `bt`, then read the frame records by hand: `x/2xg $x29` shows the saved x29 and x30, and the saved x29 is the address of the next record.

### Done when

All tests pass on the Mac and `fib` passes in the VM. `hello_linux` prints its line and `echo $?` prints 0, with no libc linked (`file` says "statically linked"). At the `fib` breakpoint you walked at least three frame records by hand with `x/2xg`, and each saved x30 points into `fib` or into the test's caller. You can draw the stack of `fib(3)` at its deepest point, with every saved register, and check that sp is a multiple of 16 at every `bl` with `re r sp`.

## The same functions on x86-64

Now redo the last two steps on the other ISA. x86-64 instructions have variable length, most of them can take a memory operand, and there are 16 general registers instead of 31. The ideas you just used carry over: argument registers, a result register, callee-saved registers and an aligned stack. The details differ:

```
                      ARM64, macOS and Linux        x86-64, Linux (System V)
  arguments           x0 to x7                      rdi, rsi, rdx, rcx, r8, r9
  result              x0                            rax
  return address      x30, the link register        on the stack, pushed by call
  callee-saved        x19 to x28, x29               rbx, rbp, r12 to r15
  stack alignment     sp % 16 == 0 at all times     rsp % 16 == 0 at each call,
                                                    so rsp % 16 == 8 on entry
  system call         number in x8, svc #0          number in rax, syscall
```

The return address is the big difference. `call` pushes it onto the stack and `ret` pops it, so a function starts with rsp 8 bytes off a multiple of 16. Each `push` moves rsp by 8. Count your pushes and adjust with `sub` until rsp is a multiple of 16 before your own `call`:

```
# long sum3sq(long a, long b, long c), x86-64 Linux, AT&T syntax
        .globl  sum3sq
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

  higher addresses
  | caller's frame        |
  | return address        |  pushed by the caller's call
  | saved rbx             |
  | saved r12             |
  | 8 bytes of padding    |  <- rsp at each call, a multiple of 16
  lower addresses
```

This step uses AT&T syntax, the default of the GNU assembler, gcc, objdump and gdb on Linux, and the syntax Dive Into Systems uses. Registers start with `%`, constants with `$`, the destination comes last, and a suffix gives the size: `movq $1, %rax` puts 1 in rax. Compiler Explorer and the Intel manuals use Intel syntax, where the same instruction reads `mov rax, 1`. Steps 6 to 9 use Intel syntax.

You need an x86-64 Linux machine. Your ARM64 VM cannot run x86 programs, but OrbStack can create an Intel machine that runs x86-64 programs through Apple's Rosetta translator. Chapter 01 told you to skip the [Intel (x86) emulation section of the OrbStack docs](https://docs.orbstack.dev/machines/#intel-x86-emulation). Read it now, together with "Debugging with GDB/LLDB" below it. Rosetta runs programs at nearly native speed but does not let gdb attach to them. To debug, you run the program under QEMU's user-mode emulator with a debug port and connect gdb to that port:

```sh
orb create --arch amd64 ubuntu:noble lab86
orb -m lab86
sudo apt update
sudo apt install -y build-essential gdb qemu-user-static

# terminal 1: run the program, stopped at its first instruction
qemu-x86_64-static -g 1234 ./out/calls_test
# terminal 2: debug it
gdb -q ./out/calls_test -ex 'target remote :1234'
```

In gdb, `b sum3sq`, `c`, `info registers rdi rsi rdx rsp`, `stepi` and `x/4gx $rsp` do what their lldb versions did on the Mac. The x86-64 `hello` uses `syscall` with the number in rax and the arguments in rdi, rsi and rdx. `write` is 1 and `exit` is 60, from `/usr/include/x86_64-linux-gnu/asm/unistd_64.h`. Build the C tests with `gcc -g -O0` and no sanitizers in this machine. The sanitizers do not check assembly anyway.

`print_long` needs one more rule on x86-64 Linux. Before a call to a variadic function such as `printf`, al holds the number of vector registers that carry arguments. For integer arguments that number is 0, so compiled C puts `xorl %eax, %eax` right before `call printf`. Leave it out and `printf` may read garbage. A misaligned rsp at that call can crash inside `printf` even when your own code never touches the stack.

### Study

- [Dive Into Systems: 64-bit x86 Assembly](https://diveintosystems.org/book/C7-x86_64/index.html) (read, 3 h 20 min): The chapter introduction, which explains AT&T and Intel syntax, then follow "Next" through 7.1 to 7.7, skip 7.8 Matrices, and read 7.9 Structs in Assembly. Stop before 7.10. The sections match chapter 9 one to one, so read them side by side with what you know. Struct field access comes back in the Bomb Lab in the next step. Newer objdump prints `call` and `leave` where the book shows `callq` and `leaveq`.
- [GNU as: AT&T Syntax versus Intel Syntax](https://sourceware.org/binutils/docs/as/i386_002dVariations.html) (reference, as needed): The list of differences between the two syntaxes. Keep it open when you compare gdb's output with Compiler Explorer's.

### Build

In `lab86`, write `src/x86/leaf.s`, `src/x86/calls.s` and `src/x86/hello.s` with the same functions as the two ARM64 steps, without underscores and with the `.note.GNU-stack` line at the end of each file. Reuse the C test files unchanged. `hello.s` uses raw system calls and builds with `as` and `ld`, like the ARM64 Linux version. `keeps` and `bad_sum` come along too. At `-O1`, gcc keeps `n` in rbx across the call, so a `bad_sum` that uses rbx without saving it breaks `keeps` the same way.

Then write `notes/abi.md`. For `sum_array`, `sum3sq` and `fib` on both ISAs, write down where each argument arrives, where the result leaves, where the return address lives during the body, which callee-saved registers the function uses, and how many bytes the prologue moves the stack pointer.

### Done when

All tests pass in `lab86`. `hello` prints its line and exits with 0. In gdb under QEMU, stopped at the first instruction of `sum3sq`, `p (long)$rsp % 16` prints 8, and at each `call` inside it the same command prints 0. gdb refuses arithmetic on `$rsp` without the cast, because it treats the register as a pointer. You can explain every stack adjustment in `sum3sq` and `fib` on both ISAs from `notes/abi.md` without looking at the code.

## Optimized code and the Bomb Lab

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

x86-64 uses its address arithmetic, `lea`, as a three-operand add, and ARM64 shifts the second operand for free inside `add`. Neither multiplies. Learn to name what you see: constant multiplies turned into shifts and adds, induction variables, loop-invariant code moved out of a loop, inlining, tail calls turned into jumps, a `switch` turned into a jump table, and whole loops replaced by a formula. The optimizer also deletes work whose result nothing uses, so every benchmark in chapter 07 needs a place to put its result.

A `switch` over dense case values often becomes a jump table: an array of code addresses in `.rodata`, indexed by the switch value. The code checks the bounds once, then jumps through the table:

```
  cmpq   $6, %rdi                  # compare x with the largest case
  ja     .Ldefault                 # unsigned compare: x > 6 or x < 0 goes to default
  jmp    *.Ltable(,%rdi,8)         # load the address at .Ltable + 8*x and jump there

  .section .rodata
  .Ltable:
  .quad  .Lcase0, .Lcase1, .Ldefault, .Lcase3, ...
```

`ja` is the unsigned "above", so one comparison rejects negative values too. In a disassembly the table has no name, only an address inside the `jmp`. Print it in gdb with `x/8gx` at that address to get the targets.

Your chapter 04 library passes structs by value, so the ABI rules for structs show up in its listings. A `Str` is 16 bytes, two 8-byte fields. It travels in two argument registers, x0 and x1 or rdi and rsi, and comes back in two, x0 and x1 or rax and rdx. A `JsonResult` is 40 bytes, too big for registers. The caller reserves space for it and passes the address as a hidden argument: in x8 on ARM64, the register from step 1's table, and in rdi on x86-64, which moves every real argument one register along. This is `str_slice` at `-O2`:

```
  Str str_slice(Str s, ptrdiff_t beg, ptrdiff_t end)

  x86-64                     ARM64, macOS
  leaq (%rdi,%rdx), %rax     sub x1, x3, x2        result len  = end - beg
  subq %rdx, %rcx            add x0, x0, x2        result data = s.data + beg
  movq %rcx, %rdx            ret
  ret
```

Do not memorize instruction sets. About thirty instructions cover most compiled integer code on x86-64: `mov`, `movzx`/`movsx` (AT&T `movz`/`movs`), `lea`, `add`, `sub`, `imul`, `and`, `or`, `xor`, `shl`, `shr`, `sar`, `cmp`, `test`, `jmp`, the conditional jumps, `cmov`, `setcc`, `call`, `ret`, `push` and `pop`. Look up the rest when you meet them.

Then practice reading code with no source. The CS:APP Bomb Lab gives you an x86-64 Linux program with six phases. Each phase reads a line and calls `explode_bomb` unless the line is right. You get `main` in C and nothing else. The self-study bomb on the CS:APP site has its grading server turned off, so an explosion costs you nothing but a restart. The method:

```
  objdump -d bomb > bomb.s        the whole program as text, to annotate
  gdb, through QEMU as before:
    b explode_bomb                stop before any explosion
    b phase_1                     stop at the start of a phase
    disas                         the current function
    x/s $rsi                      the string an argument register points at
    p/x $rax, i r, stepi, nexti   inspect and step
  ./bomb answers.txt              reads solved lines from the file, then stdin
```

Translate each phase into C on paper before you guess anything. Several phases read their line with `sscanf`, which parses a string the way `scanf` parses input and returns the number of fields it filled. Its format string is the first thing to print with `x/s`. Phase 3 uses a `switch` compiled to a jump table, phase 4 a recursive function, and phase 6 walks a linked list of structs. For phase 6 you need 7.9 Structs in Assembly from step 3 and your linked lists from chapter 02. Keep the CS:APP [two-page summary of gdb commands for x86-64](https://csapp.cs.cmu.edu/3e/docs/gdbnotes-x86-64.pdf) next to gdb while you work. The bomb runs directly in `lab86`, and gdb reaches it through `qemu-x86_64-static -g 1234 ./bomb answers.txt`.

### Study

- [Matt Godbolt: Advent of Compiler Optimisations 2025](https://xania.org/AoCO2025-archive) (read, 1 h 15 min): Short posts by the author of Compiler Explorer, each with a live example. Read days 4, 9, 13, 16, 17, 19 and 24 from the archive list: multiply by a constant, induction variables, loop-invariant code motion, structs passed in registers, inlining, tail calls and a loop replaced by a formula. Day 16 shows only System V x86-64. The ARM64 rule for `Str` is in the prose above. A few posts mention C++ types. Read `std::string_view` as a pointer plus a length. Open each example in Compiler Explorer and switch the compiler to "armv8-a clang" to see the ARM64 version.
- [CMU 15-213: Machine-Level Programming II, Control](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/04-machine-control.pdf) (read, 20 min): Lecture slides from the Fall 2025 course, built on CS:APP by Bryant and O'Hallaron. Only the switch statements part, PDF pages 50 to 64: a `switch` in C, its jump table, and how to find the table in a binary with gdb. The rest of the deck covers the same ground as Dive Into Systems 7.4.
- [CS:APP Labs: Bomb Lab](https://csapp.cs.cmu.edu/3e/labs.html) (do, 12 h): From the Bomb Lab entry, download the "Self-Study Handout" (`bomb.tar`) and read the "Writeup", whose Hints section lists the tools. Ignore the parts about requesting a bomb and the scoreboard, which apply to CMU students. Stop after phase 6. The secret phase is optional.

### Build

Part 1, before the bomb. Take three functions from your chapter 04 `base.c`: `alloc`, `str_equals` and `str_parse_i64`. Compile each with clang at `-O0` and `-O2` for x86-64 and for ARM64, either in Compiler Explorer or on your machines with `clang -O2 -S -o -`. For each `-O2` listing, write a comment block that maps every instruction to the C it came from and names each transformation from the posts. Then look at the first instructions of `json_parse` on both ISAs and find where the hidden pointer to the `JsonResult` arrives and where each real argument went. Last, write a function whose result is unused, such as a loop that sums an array into a local, and confirm that `-O2` removes the loop.

Part 2, the bomb. Unpack `bomb.tar` in `lab86`. Keep `answers.txt` with one solved line per phase and a file `bomb-notes.md` with the C you reconstructed for each phase.

### Done when

Each of your three annotated listings names at least two transformations per ISA, and you can say why each one is correct for every input. You can say which registers carry a `Str` into and out of a function on both ISAs, and where a `JsonResult` goes instead. `./bomb answers.txt` gets through all six phases without an explosion and prints "Congratulations! You've defused the bomb!". For every phase, `bomb-notes.md` has C code that would accept the same inputs, and you can point at the instructions each line of it came from.

## Object files, symbols and linking

Every program so far came from one `clang` or `gcc` command that hid a step. The compiler turns each `.c` or `.s` file into an object file. The linker joins the object files and libraries into one executable. Chapter 02 showed this pipeline and stopped at "linker: joins your code with libc". Here you open the `.o` file.

An object file holds sections of bytes (`.text` for code, `.data` and `.bss` for globals, `.rodata` for constants), a symbol table and relocations. The symbol table lists the names this file defines and the names it uses but does not define. A relocation is a note to the linker: at this offset, once you know where a symbol ends up, write its address or its distance from here. This is a call to `bump`, a function defined in another file, as `objdump -dr` prints it in `lab86`:

```
   d:   e8 00 00 00 00          call   12 <main+0x12>
                        e: R_X86_64_PLT32       bump-0x4
```

The four zero bytes after the `e8` opcode are a hole. The relocation says to fill offset `0xe` with the distance to `bump`, minus 4 because x86 measures from the end of the instruction. The linker works in two passes over everything it is given:

```
  arena.c     --cc -c--> arena.o      defines alloc        uses memset
  json.c      --cc -c--> json.o       defines json_parse   uses alloc
  jsoncheck.c --cc -c--> jsoncheck.o  defines main         uses json_parse, fprintf
                             \          |          /
                              v         v         v
             ld  1. symbol resolution: match every use with exactly one definition
                 2. relocation: lay out the sections, then fill every hole
                              |
                              v
                             app  --at load time-->  the dynamic loader maps libc.so.6
                                                     and fills in the addresses of
                                                     fprintf and the other libc calls
```

A static library (`.a`) is an archive of object files. The linker copies in only the members that define something still missing, and it scans the command line left to right, so order matters. A shared library (`.so` on Linux, `.dylib` on macOS) stays a separate file that the loader maps at run time, at an address nobody knows at link time. Code reaches its functions through the procedure linkage table (PLT) and its data through the global offset table (GOT). Ubuntu's gcc links with `-z now` by default, which fills the whole GOT at load time. Link with `-Wl,-z,lazy` to see the lazy scheme Bendersky describes, where each entry is filled at the first call.

`nm` prints one line per symbol with a letter for its kind. The ones you meet here: `T` for a function in `.text`, `D` for initialized data, `B` for zeroed data in `.bss`, `R` for read-only data, and `U` for a name this file uses but does not define. A lowercase letter means the symbol is local to the file. `static` makes a symbol local. The full list is under "symbol type" in the [nm(1) man page](https://man7.org/linux/man-pages/man1/nm.1.html).

The driver also links files you never wrote. `gcc -v` shows them on the linker command line:

```
  Scrt1.o             holds _start, the entry point from step 2. It calls
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

Build this step in `lab86` so your relocation names match the slides. The Mac uses Mach-O with the same ideas under other names. `objdump -dr` works there too, `otool -L` lists the libraries a program needs, and libc lives inside `libSystem`. `clang -###` prints the linker command the driver would run. ARM64 relocations patch the instructions you met in step 2:

```
  ARM64_RELOC_BRANCH26      the 26-bit offset in a bl
  ARM64_RELOC_PAGE21        the page number in an adrp       (@PAGE)
  ARM64_RELOC_PAGEOFF12     the low 12 bits in an add or ldr (@PAGEOFF)
```

A name with `GOT_LOAD` in it, such as `ARM64_RELOC_GOT_LOAD_PAGE21`, means the instruction reaches the symbol through the GOT instead of directly.

### Study

- [Beej's Guide to C: Multifile Projects](https://beej.us/guide/bgc/html/split/multifile-projects.html) (read, 25 min): All of chapter 17, sections 17.1 to 17.4. It covers headers, include guards, `static` and `extern`, which you need to split your code into files.
- [CMU 15-213: Linking](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/07-linking.pdf) (read, 1 h): Lecture slides from Fall 2025, built on CS:APP chapter 7. PDF pages 3 to 29 and 31 to 41. Skip the quiz on page 30 and the run-time linking with `dlopen` on pages 42 to 44.
- [Eli Bendersky: Position Independent Code (PIC) in shared libraries](https://eli.thegreenplace.net/2011/11/03/position-independent-code-pic-in-shared-libraries) (read, 40 min): From the start through "PIC with function calls through PLT and GOT - an example". The examples are 32-bit x86 with Intel syntax. On x86-64 the code reaches the GOT with one `rip`-relative instruction instead of the `get_pc_thunk` call the article walks through. You see that in your own disassembly.

### Build

In `lab86`, split your chapter 04 code into separately compiled files. Chapter 04 made every function in `base.c` `static` and had each program `#include` it. Now `base.c` becomes `arena.c` for the arena and `str.c` for `Str`, the growable arrays, the hash trie, `read_all` and `Buf`, each with a header. `json.c` gets a header too, and `jsoncheck.c` stays the program with `main`. Functions another file calls lose their `static`. Helpers used only inside one file keep it.

1. Compile each file with `gcc -c`. Before running `nm` on each `.o` file, write down every symbol you expect and its letter (`T`, `U`, `D`, `B`, `t`, `r`). Compare.
2. Run `objdump -dr json.o`. Find one call relocation and one relocation for a global or a string constant. Link the program, find the same call in `objdump -d app`, and check by hand that the four bytes after `e8` equal the target address minus the address of the next instruction.
3. Run `gcc -v -o app *.o` and find the `collect2` line, the linker call. List the files it adds that you did not write, such as `Scrt1.o`, `crti.o` and `-lc`, and say what each one is for.
4. Define the same non-static global variable in two files and link. Read the error. Make one of them `static` and link again.
5. Build `libjson.a` from `arena.o`, `str.o` and `json.o` with `ar rcs`. Link `jsoncheck.o` with it, once with the library after `jsoncheck.o` and once before it. Explain the error.
6. Recompile `arena.c`, `str.c` and `json.c` with `-fPIC`, link the new object files into `libjson.so` with `-shared`, and link `jsoncheck.c` against it with `-g -L. -ljson -no-pie -Wl,-z,lazy`. Run it with `LD_LIBRARY_PATH=.`. In `objdump -d`, find the PLT entry for `json_parse` and the GOT address its `jmp` reads. In gdb under QEMU, break on `main`, print that GOT slot with `x/gx`, step over the first call to `json_parse` with `next`, and print the slot again.
7. On the Mac, compile the same files with `clang -c`, run `objdump -dr json.o` and `nm -m json.o`. List the relocation types you see, and for each one name the instruction it patches and what the linker writes there.

### Done when

Your `nm` predictions matched for every symbol, or you can explain each miss. Your hand calculation of the call displacement matches the bytes. You can explain the duplicate-symbol error and the library-order error in one sentence each. The GOT slot held an address inside the PLT before the first call and an address inside `libjson.so` after it, and you can say which code wrote it.

## Decoding 8086 MOV instructions

The rest of the chapter goes the other way: from bytes to instructions. You start with the Intel 8086 from 1978, the first chip of the x86 line. Its encoding is small enough to decode by hand, and x86-64 still encodes many instructions the same way. Casey Muratori's Performance-Aware Programming course on Computer Enhance builds a decoder and then a simulator for it, and the next four steps follow his Part 1. Each post has a video and a transcript, and the homework listings come from the [course repository](https://github.com/cmuratori/computer_enhance/tree/main/perfaware/part1). A file like `listing_0037_single_register_mov.asm` is the source, and the file of the same name without `.asm` holds the bytes nasm made from it.

The 8086 has eight 16-bit registers. The first four can also be used as two 8-bit halves:

```
  16-bit   ax  cx  dx  bx  sp  bp  si  di
  8-bit    al  cl  dl  bl  ah  ch  dh  bh     (low halves, then high halves)
  code     000 001 010 011 100 101 110 111    (the 3-bit number in the encoding)
```

A register-to-register `mov` takes two bytes. Listing 37 is the single instruction `mov cx, bx`, stored as `89 d9`:

```
  89 d9 = 10001001 11011001

  byte 1: 100010  d  w        byte 2: mod  reg  r/m
          100010  0  1                11   011  001
          opcode  |  w = 1: 16-bit    |    bx   cx
                  d = 0: reg is the   mod = 11: r/m is a register
                         source

  mov cx, bx
```

Other `mov` forms add a displacement or an immediate value, so an instruction is 1 to 6 bytes long. `mod` says how many displacement bytes follow and whether r/m names a register or a memory address built from `bx`, `bp`, `si` and `di`. One case breaks the pattern: `mod = 00` with `r/m = 110` means a direct 16-bit address, not `[bp]`. So nasm encodes `mov dx, [bp]` as `8b 56 00`, with an 8-bit displacement of 0. An 8-bit displacement is signed. Run it through your `sign_extend` from chapter 04 before you print `[bp + di - 37]`.

The decoder reads the whole binary from standard input with chapter 04's `read_all`, which works for binary input as well as text. It walks the buffer one instruction at a time and prints nasm source. The test is a round trip: if nasm turns your output back into the same bytes, you decoded every instruction correctly. Install nasm with `brew install nasm` on the Mac.

```sh
./out/decode < listing_0039_more_movs > out39.asm
nasm out39.asm -o out39.bin
cmp out39.bin listing_0039_more_movs && echo same
```

Your output must start with `bits 16`, or nasm assembles for a different mode.

### Study

- [Computer Enhance: Instruction Decoding on the 8086](https://www.computerenhance.com/p/instruction-decoding-on-the-8086) (watch, 30 min): The whole video. Paid, part of your subscription. The homework is listings 37 and 38.
- [Computer Enhance: Decoding Multiple Instructions and Suffixes](https://www.computerenhance.com/p/decoding-multiple-instructions-and) (watch, 45 min): The whole video. The homework is listing 39, with listing 40 as an optional challenge.
- [Intel 8086 Family User's Manual, October 1979](https://edge.edx.org/c4x/BITSPilani/EEE231/asset/8086_family_Users_Manual_1_.pdf#page=160) (reference, as needed): A scanned PDF of Intel's manual. PDF pages 160 to 169, printed pages 4-18 to 4-27: "Machine Instruction Encoding and Decoding", tables 4-7 to 4-11 for the fields, and table 4-12 with the bit patterns of every instruction. The MOV rows are on PDF page 164.

### Build

Write `src/decode.c`. Keep the register names in two arrays of 8 strings indexed by the 3-bit field, and the effective-address forms (`bx + si`, `bx + di`, `bp + si`, `bp + di`, `si`, `di`, `bp`, `bx`) in a third. Decode instruction by instruction:

1. Register to register, enough for listings 37 and 38.
2. Register to and from memory with no, 8-bit and 16-bit displacement, including the direct-address case.
3. Immediate to register.

Write a test script `tests/decode_test.sh` that runs the round trip for every listing in this step and prints OK or FAIL per listing. Add a check in the decoder for an opcode it does not know: print the byte offset and the byte to `stderr` and exit with status 1.

### Done when

The round trip prints OK for listings 37, 38 and 39. For each instruction in listing 39 you can write its bytes on paper from the assembly using table 4-12 and match them against `od -An -tx1` of the binary. Feeding the decoder a byte it does not handle prints the offset and exits with status 1. Listing 40 is optional.

## Decoding arithmetic and jumps

`add`, `sub` and `cmp` reuse the patterns you already decode. Each has a register/memory form with `d`, `w`, `mod`, `reg` and `r/m`, an immediate-to-register/memory form, and an immediate-to-accumulator form. The immediate form puts the operation in the `reg` field of the second byte, so one opcode covers several instructions. Casey's video shows how to share one decoding path for all three.

Conditional jumps such as `jnz` are two bytes: an opcode and a signed 8-bit displacement measured from the end of the jump. Labels do not exist in the bytes, so print the target as nasm's `$` plus an offset. `$` is the address where the current instruction starts, so a jump with displacement `d` reaches `$ + 2 + d`. A `jnz` at offset 12 with displacement -8 prints as `jnz $-6` and goes to offset 6.

The code review is optional. If you watch it, do so only after your own decoder passes. Casey walks through his reference decoder, which uses a table of instruction formats instead of a long `switch`. Compare its structure with yours and decide whether to rewrite before you start simulating. The simulator builds on whatever you have at the end of this step.

### Study

- [Computer Enhance: Opcode Patterns in 8086 Arithmetic](https://www.computerenhance.com/p/opcode-patterns-in-8086-arithmetic) (watch, 20 min): The whole video. The homework is listing 41, with listing 42 as an optional challenge.
- [Computer Enhance: 8086 Decoder Code Review](https://www.computerenhance.com/p/8086-decoder-code-review) (watch, 1 h 20 min): Optional. Watch it only after listing 41 round-trips, and only if you want to compare designs before the simulator. Casey says you can skip it if you are happy with your own decoder.

### Build

Extend `src/decode.c` with `add`, `sub` and `cmp` in all three forms, and the conditional jumps and loops in listing 41 (`je`, `jl`, `jle`, `jb`, `jbe`, `jp`, `jo`, `js`, `jnz` and the rest, plus `loop`, `loopz`, `loopnz` and `jcxz`). Look up each opcode in table 4-12 of the Intel manual from the previous step. Add listing 41 to the round-trip script.

### Done when

The round trip prints OK for listings 37, 38, 39 and 41. For any instruction in listing 41 you can find its row in table 4-12 and say which bits picked `add`, `sub` or `cmp`. If you watched the code review, you can name one thing the reference decoder does differently from yours and say which version you kept and why.

## Simulating registers, flags and jumps

A simulator executes what the decoder decodes. For `mov` that means storing a value in an array of registers. Arithmetic does more: `add`, `sub` and `cmp` also set flags, single bits that describe the result. `cmp` is a `sub` that sets the flags and throws the result away. The final state of every required listing uses only four flags: zero (Z, the result is 0), sign (S, the top bit of the result is 1), parity (P, the low byte of the result has an even number of 1 bits) and carry (C, the operation carried out of or borrowed into the top bit). The per-instruction traces in the reference files also show auxiliary carry (A), and the optional listing 47 adds overflow (O). Casey explains all six in the video on ADD, SUB and CMP. You need A and O only for listing 47 and for a trace that matches line by line.

A conditional jump reads the flags. To jump, the simulator needs an instruction pointer, IP, the offset of the next instruction. Your decoder already kept one to know where the next instruction starts. Now it becomes a register: each instruction adds its length to IP, and a jump that is taken adds its displacement as well. This is the fetch, decode, execute loop from chapter 03, on a CPU with variable-length instructions:

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

Print your final state in the same format, with an option to leave out `ip` for the early listings, so `diff` can check it. Compare the final block only. The `.txt` files use Windows line endings and end with a blank line, so remove the `\r` and the blank lines on both sides:

```sh
./out/sim < listing_0049_conditional_jumps > got.txt
sed -n '/^Final registers/,$p' listing_0049_conditional_jumps.txt | tr -d '\r' | sed '/^$/d' > want.txt
sed -n '/^Final registers/,$p' got.txt | sed '/^$/d' > have.txt
diff want.txt have.txt
```

### Study

- [Computer Enhance: Simulating Non-memory MOVs](https://www.computerenhance.com/p/simulating-non-memory-movs) (watch, 20 min): The whole video. The homework is listings 43 and 44, with 45 as an optional challenge.
- [Computer Enhance: Simulating ADD, SUB, and CMP](https://www.computerenhance.com/p/simulating-add-jmp-and-cmp) (watch, 26 min): The whole video. The homework is listing 46, with 47, the full set of flags, as an optional challenge.
- [Computer Enhance: Simulating Conditional Jumps](https://www.computerenhance.com/p/simulating-conditional-jumps) (watch, 20 min): The whole video. The homework is listings 48 and 49, with 50 as an optional challenge.

### Build

Write `src/sim.c`, or add a `-exec` option to your decoder, so one program decodes and executes. It keeps eight 16-bit registers, IP and the flags, and writes 8-bit results into the correct half of a 16-bit register. Print one line per executed instruction, then the final block. Add a script `tests/sim_test.sh` that runs the `diff` above for every listing in the step and prints OK or FAIL.

### Done when

The script prints OK for listings 43, 44, 46, 48 and 49. Before running listing 49, you trace its loop on paper, writing down cx, bx, IP and the flags after every instruction, and your page matches the simulator's trace. You can explain why `sub bp, 2026` in listing 46 leaves both the Z and P flags set.

## Simulating memory

The last piece is memory. The 8086 addresses up to 1 MB, so give the simulator a 1 MB byte array. Every memory operand you decoded in step 6 now computes an effective address, such as `bx + si + 4`, and reads or writes one byte or two. A 16-bit value is stored little-endian, low byte first, like the `int` you dumped in chapter 02. Ignore the 8086's segment registers here. Casey's listings keep every address inside the first 64 KB.

With `mov`, `add`, `sub`, `cmp` and conditional jumps, small real programs already work. Listing 54 draws a 64 by 64 picture into memory, four bytes per pixel, starting at address 256. Each pixel gets its x coordinate as red, its y coordinate as blue and 255 as alpha. Dump the simulator's memory to a file at exit, then turn the pixels into a PNG with the Python you already know. The one-liner needs Pillow. If `import PIL` fails, run `python3 -m pip install pillow` in a virtual environment first.

```sh
./out/sim -dump mem.bin < listing_0054_draw_rectangle
python3 -c "from PIL import Image; d = open('mem.bin', 'rb').read(); Image.frombytes('RGBA', (64, 64), d[256:256 + 64*64*4]).save('rect.png')"
```

The image should show red growing from left to right and blue from top to bottom. The values only reach 63 out of 255, so expect dark colors. Casey's next video, [Estimating Cycles](https://www.computerenhance.com/p/estimating-cycles), adds 8086 cycle counts to the simulator. It is optional, and nothing in chapter 06 needs it.

### Study

- [Computer Enhance: Simulating Memory](https://www.computerenhance.com/p/simulating-memory) (watch, 27 min): The whole video. The homework is listings 51 and 52, with 53 as an optional challenge.
- [Computer Enhance: Simulating Real Programs](https://www.computerenhance.com/p/simulating-real-programs) (watch, 16 min): The whole video. The homework is listing 54, with 55 as an optional challenge.

### Build

Add memory to the simulator: a 1 MB array, effective-address calculation for every `mod` and `r/m` combination your decoder handles, 8-bit and 16-bit loads and stores, and the `-dump` option. Load the program at address 0, as Casey's listings expect. Add listings 51, 52 and 54 to `tests/sim_test.sh`.

### Done when

The script prints OK for every listing from 43 to 54 that is not marked optional. `rect.png` shows the gradient. Without running anything, you can say which bytes listing 51's `mov word [bx + 4], 10` writes and at which addresses.

## Where this leads

You can now write a function in assembly on both ISAs and call it from C, explain every stack adjustment in a prologue, read `-O2` output and name what the optimizer did, and follow a program from object files through the linker to the loader. You also wrote a decoder and a simulator for a real instruction set, so a CPU's fetch, decode and execute loop is code you wrote and tested.

What you have not built is a whole machine: a CPU together with its screen, keyboard, timers and a program to run at full speed. Chapter 06, A CHIP-8 emulator, does that. CHIP-8 is a small virtual machine from the 1970s with fixed two-byte instructions, so its decoder is simpler than your 8086 one. The new parts are the 64 by 32 display, the keypad, the two timers and a main loop that runs the CPU at a fixed rate. Your simulator's loop and your test-by-diff habit carry straight over.
