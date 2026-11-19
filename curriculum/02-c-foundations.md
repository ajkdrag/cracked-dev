---
id: 02
title: C foundations
part: The machine and C
weeks: 3
project: A linked list, a growable array and a word counter in C, then three C functions matched to x86-64 assembly.
---

Chapter 01 left you with a `build.sh` that compiles with warnings and sanitizers on, and with gdb for stopping a program and looking inside it. You have compiled and debugged small programs. You have not yet written much C of your own.

This chapter teaches enough C to build three small things: a linked list, a growable array and a word counter. All three keep their data on the heap, the memory from `malloc` that chapter 01 showed, and must hand every block back with `free`. At the end you put three of your functions through the compiler and match each line of C to the x86-64 instructions it became.

The chapter's exercises keep three pairs apart: a pointer and its target, a string's length and the size of the memory that holds it, a variable's name and its bytes. You draw these on paper first, then check the drawing against the running program.

The chapter comes now because chapter 03 asks you to write an **assembler** in C, a program that turns assembly text into machine code. That assembler reads a text file, splits it into words and keeps a table of names. That is the word counter with a different input.

## The build loop and a test pattern

Every Build in this chapter comes with test cases. Running each function by hand and reading its output gets old after the first one. This step sets up a pattern you reuse for the rest of the book: a small test program per source file, and one script that builds and runs it.

A **test program** is a second program that calls your functions with known inputs and checks the results. It lives in `tests/` and pulls in the file it tests with `#include`. Two features of the preprocessor, the first of clang's four stages from chapter 01, make that work:

- `#include "../src/add.c"` pastes the whole text of `add.c` into the test file, so the test sees every function in it.
- `#define main add_demo_main`, placed before the include, replaces every later `main` with `add_demo_main`. The `main` of `add.c` gets that name and stays out of the way. `#undef main` ends the replacement, so the test can write its own `main`.

![The test file pastes in add.c with its main renamed, clang builds one program from it, and its exit status tells the shell whether every check passed.](figures/02-test-pattern.svg)

```c
// tests/add_test.c
#define main add_demo_main
#include "../src/add.c"
#undef main

#include <stdio.h>

int failures = 0;

void check(const char *label, int ok) {
    if (ok) {
        printf("OK    %s\n", label);
    } else {
        printf("FAIL  %s\n", label);
        failures++;
    }
}

int main(void) {
    check("add(2, 3) is 5", add(2, 3) == 5);
    check("add(-1, 1) is 0", add(-1, 1) == 0);
    printf("%d failure(s)\n", failures);
    return failures;
}
```

Including a `.c` file is a shortcut for single-file programs. Chapter 05 shows how real programs are split into several files.

`const char *label` passes a string to a function. Steps 3 and 4 explain it, so copy it as it is for now. `check` receives the result of a comparison such as `add(2, 3) == 5`, which is 1 when true and 0 when false. `printf` replaces each `%s` in its first argument with the next argument as a string, and each `%d` with the next argument as a decimal `int`. `main` returns the number of failed checks as the exit status, so the test exits with 0 only when every check passed.

The script builds one test with the debug flags of `build.sh` and runs it. `$1` is the first word after the script's name, so `sh tests/run_test.sh add` builds and runs `tests/add_test.c`:

```sh
#!/bin/sh
# usage: sh tests/run_test.sh add
# Builds tests/<name>_test.c with the debug flags of build.sh and runs it.
set -e
name=$1
out=out/$(uname -s)-debug
mkdir -p "$out"
clang -std=gnu11 \
    -Wall -Wextra -Wconversion -Wno-sign-conversion -Wdouble-promotion -Werror \
    -g3 -O0 -fsanitize=${SAN:-address,undefined} -fno-sanitize-recover=undefined \
    -o "$out/${name}_test" "tests/${name}_test.c"
"./$out/${name}_test"
```

The `\` at the end of a line continues the command on the next line. `"${name}_test"` puts the value of `name` in front of `_test`, and the braces show where the variable's name ends. `SAN` works as it does in `build.sh`. The test runs last, so the script's exit status is the test's.

> **Practice:** Write the tests together with the function, and run them in the debug build every time. Each run of this script is also an ASan, UBSan and LeakSanitizer run.

### Study

- [Beej's Guide to C: The C Preprocessor](https://beej.us/guide/bgc/html/split/the-c-preprocessor.html) (read, 15 min): Sections 19.1 `#include` and 19.2 Simple Macros only. Chapter 04 comes back to this chapter for macros with arguments.

### Build

1. Write `src/add.c` with `int add(int a, int b)` and a `main` that prints `add(2, 3)`. Build it with `sh build.sh add` and run `./out/Linux-debug/add`.
2. Write `tests/add_test.c` and `tests/run_test.sh` as above. Run `sh tests/run_test.sh add`, then `echo $?` to print the exit status.
3. The script is the one place the debug flags of `build.sh` are copied. Add the comment `# debug flags are copied in tests/run_test.sh` above the `if` in `build.sh`, so you change both together.
4. Add a check that is wrong on purpose, such as `add(2, 2) == 5`. Run the script and print the exit status again. Remove the wrong check.
5. If you wrote programs and tests for later steps of this chapter on the Mac, bring them into `~/code/hello` and rerun every one of them. LeakSanitizer never ran on the Mac, so this is the first leak check that code gets.
   1. Clone the git repository that holds your Mac work into WSL: `git clone <its URL> ~/code/mac`.
   2. Copy every `.c` file from `~/code/mac/src/` into `~/code/hello/src/` except `main.c`, which would replace chapter 01's. Use one `cp` per file, such as `cp ~/code/mac/src/list.c ~/code/hello/src/`. Copy the tests with `cp -r ~/code/mac/tests ~/code/hello/`.
   3. Keep chapter 01's `build.sh`. Delete the old `tests/run_*_test.sh` scripts, which built with UBSan alone.
   4. Run `sh build.sh <name>` for each program in `src/`, and `sh tests/run_test.sh <name>` for each `tests/<name>_test.c`.

   Expect three kinds of failure, and fix each one in the source, never by dropping a flag:
   - A Mac-only header, such as `<malloc/malloc.h>`, does not exist on Linux.
   - Ubuntu's clang reports some warnings that Apple's clang did not, and `-Werror` turns them into errors.
   - LeakSanitizer reports blocks that a `main` never freed, even where the counters in your tests balanced.

### Done when

`sh build.sh add` prints no warnings. `sh tests/run_test.sh add; echo $?` prints two OK lines, `0 failure(s)` and a final `0`. With the wrong check added, it prints one FAIL line, `1 failure(s)` and `1`. Every program and test from item 5 builds and passes with no sanitizer report.

## Expressions, control flow, functions, arrays and structs

The test pattern needs functions to test, and this step writes the first ones. You know Python, so most of C's `if`, `while`, `for` and function calls read as new spelling for ideas you have. Four differences matter in this chapter:

- Every variable has a fixed type, and the type fixes its size. An `int` is 4 bytes on x86-64 Linux and holds whole numbers from about minus 2 billion to plus 2 billion.
- Dividing two integers drops the remainder: `7 / 2` is 3.
- An `int` that goes past its largest value **overflows**. Python would give you a bigger number. In C, signed overflow is undefined behavior, as chapter 01 showed: the language says nothing about what happens next. The debug build stops the program with a UBSan report instead.
- A function receives copies of its arguments. Changing a parameter inside the function changes the copy.

Arrays and structs are C's two ways to group values. An **array** is a fixed number of values of one type, placed back to back in memory. A **struct** is a group of named fields, which may have different types, laid out in the order you declare them. Assigning a struct, or passing it to a function, copies every field:

![Calling stats_average copies the four fields of main's struct into a second struct that belongs to stats_average.](figures/02-copy-argument.svg)

An array cannot be assigned or passed whole. Passing an array to a function needs pointers, which come in the next step. Until then, keep each array inside the function that declares it.

### Study

- [Beej's Guide to C: Variables and Statements](https://beej.us/guide/bgc/html/split/variables-and-statements.html) (read, 90 min): All of chapter 3, then follow "Next" through chapter 4 on functions. Skim anything that matches Python.
- [Beej's Guide to C: Arrays](https://beej.us/guide/bgc/html/split/arrays.html) (read, 20 min): Sections 6.1 to 6.4. Stop before 6.5 on multidimensional arrays.
- [Beej's Guide to C: Structs](https://beej.us/guide/bgc/html/split/structs.html) (read, 20 min): Sections 8.1 to 8.3, 8.5 and 8.6. Skip 8.4 on the arrow operator, which needs pointers. The linked list step explains it.

### Build

Write `src/basics.c` with three parts and print the results from `main`:

1. `int collatz_steps(int n)` returns how many steps the sequence "halve if even, else 3n+1" takes to reach 1. Check that it returns 0 for 1, 8 for 6 and 111 for 27.
2. A table of Celsius values from 0 to 100 in steps of 10 next to their Fahrenheit values, computed with integer math as `c * 9 / 5 + 32`.
3. `struct Stats { int min; int max; int sum; int count; }`. In `main`, fill an array with `{4, 8, 15, 16, 23, 42, -1, 0}` and loop over it to fill one `struct Stats`. Write `int stats_average(struct Stats s)` that returns the integer average, and pass the struct by value, as a copy.

### Done when

The program prints 0, 8 and 111 for the Collatz cases, 212 for 100 Celsius, and min -1, max 42, sum 107, average 13 for the array. `sh build.sh basics` prints no warnings. You can say why `stats_average` cannot change the caller's struct.

## Pointers and lifetimes on paper

The last step kept every array inside the function that declared it, and `stats_average` could not change the caller's struct. Both limits go away once a function receives an address instead of a copy.

Memory is a long row of bytes, each with a numbered address. A variable is a name for a few of those bytes. `int x = 42;` takes 4 bytes, and x86-64 stores the lowest byte first:

![int x = 42 takes the four bytes at addresses 0x1000 to 0x1003, lowest byte first.](figures/02-variable-bytes.svg)

`&x` is the address of `x`. A **pointer** is a variable that holds an address. `int *p = &x;` declares `p` as a pointer to an `int` and stores the address of `x` in it. `*p` follows the pointer to the `int` at that address, for reading or for writing. Keep `p`, `&p` and `*p` apart:

![p lives at 0x1008 and holds 0x1000, the address of x. Following p reaches the int 42.](figures/02-pointer.svg)

The addresses in these figures are made up. The compiler decides where each variable goes, so your program prints other ones. On x86-64 every pointer takes 8 bytes, whatever it points to.

A function that receives pointers can change its caller's variables. `swap_ints(&x, &y)` hands over two addresses, and the function writes through them:

![swap_ints gets the addresses of main's x and y, so its writes through a and b change main's variables: x goes from 1 to 2 and y from 2 to 1.](figures/02-swap-pointers.svg)

Every variable also has a **lifetime**: the part of the run during which its bytes belong to it. Two kinds of lifetime matter in this step:

- **Automatic**: locals and parameters. They are born when their block starts and die when it ends. Each function call gets its own frame on the stack for its locals, as chapter 01 showed, and gives it back when it returns. A register, `%rsp`, holds the address of the top of the stack.
- **Static**: variables declared outside any function, and locals marked `static`. They live for the whole run and start at 0 unless you give them a value.

A pointer does not keep its target alive. If a function returns the address of one of its locals, the caller gets the address of a dead variable, a **dangling pointer**.

Draw before you run. Python Tutor draws the same boxes and arrows from your code. It runs your program on its own server, so its addresses differ from yours, but its arrows should match your drawing.

### Study

- [Beej's Guide to C: Pointers](https://beej.us/guide/bgc/html/split/pointers.html) (read, 45 min): Sections 5.1 to 5.7.
- [Beej's Guide to C: Qualifiers and Specifiers](https://beej.us/guide/bgc/html/split/types-iv-qualifiers-and-specifiers.html) (read, 25 min): All of 16.1.1 `const`, including 16.1.1.1 on `const` and pointers and 16.1.1.2 on the warning clang gives when a pointer drops `const`. Then 16.2.2 `static`. Skip the other qualifiers (16.1.2 to 16.1.4) and the rest of 16.2.
- [Python Tutor for C](https://pythontutor.com/c.html) (do, 30 min): Paste each program from the Build and step through it. Predict where each arrow points before you click "Next".

### Build

Write `src/lifetimes.c` and build it with `sh build.sh lifetimes`:

1. `int x = 42` and `int *p = &x`. Print `x`, `p`, `&p`, `*p`, `sizeof x` and `sizeof p`. In `printf`, `%p` prints an address and `%zu` prints a `size_t`, the unsigned type that `sizeof` gives. Then change `x` through `*p` and print `x` again.
2. `void swap_ints(int *a, int *b)` that swaps two of the caller's ints. Call it on two locals in `main`.
3. `int next_id(void)` that keeps a `static int` counter and returns 1, 2, 3 on successive calls.
4. `int *dangling(void)` that returns the address of a local. Build, read clang's error, then delete the function.

Draw parts 1 and 2 on paper before you run them, then check both drawings in Python Tutor.

### Done when

You can say what `p`, `&p` and `*p` each mean and what type each one has. Your drawing of `swap_ints` matches Python Tutor's arrows at every step. You can name the lifetime of each variable in the program and say why the pointer returned by `dangling` was invalid even though it held a real address.

## Strings and pointer arithmetic

Every function in this step takes a pointer, because a string reaches a function as the address of its first character.

A **string** in C is an array of `char` with a 0 byte after the last character. That byte is the **terminator**, written `'\0'`. Nothing stores the length. `strlen` finds it by walking until the 0 byte.

A **buffer** is a block of bytes that holds data on its way somewhere, here the array a string lives in. So keep two numbers apart: the length of the text and the **capacity** of the buffer that holds it. The capacity must be at least the length plus 1:

![The string cat fills three bytes of an eight-byte buffer and the terminator a fourth, so the length is 3 and the capacity is 8.](figures/02-string-buffer.svg)

**Pointer arithmetic** moves in whole elements. If `p` points at an `int`, `p + 1` points at the next `int`, 4 bytes further on. If `q` points at a `char`, `q + 1` is 1 byte further on. `a[i]` is shorthand for `*(a + i)`.

![Adding 1 to an int pointer moves it 4 bytes, and adding 1 to a char pointer moves it 1 byte.](figures/02-pointer-arithmetic.svg)

A function that receives an array gets only a pointer to its first element. Inside the function, `sizeof` measures that pointer, and the array's length is gone. So pass the length or the capacity as a separate argument. `size_t` is the unsigned type C uses for sizes and lengths.

A parameter written `const char *s` promises that the function only reads through `s`, and clang rejects a write through it. Put `const` on every pointer parameter that a function only reads.

The `string.h` functions you meet most often differ in who checks the size:

- `strlen(s)` counts the bytes before the terminator and trusts that there is one.
- `strcpy(dst, src)` copies `src` with its terminator and trusts the caller that it fits.
- `strncpy(dst, src, n)` writes at most `n` bytes. When `src` does not fit, it writes `n` bytes and no terminator.
- `strcmp(a, b)` compares two strings and returns 0 when they are equal.
- `memcpy(dst, src, n)` copies exactly `n` bytes and ignores terminators.

Your own `str_copy` checks the size itself and refuses to write past the end.

> **Practice:** Cast a byte to `unsigned char` before you pass it to a `<ctype.h>` function such as `tolower`, and cast the result back on purpose: `*s = (char)tolower((unsigned char)*s)`. These functions need a value from 0 to 255, and `char` is signed on x86-64 Linux, so a byte above 127 arrives as a negative number. As chapter 01 showed for `int`, the top bit of a signed value counts as negative, so the byte `0xE9` read as a signed `char` is -23. `tolower` returns an `int`, so `-Wconversion` in `build.sh` wants the `(char)` cast too.

### Study

- [Beej's Guide to C: Strings](https://beej.us/guide/bgc/html/split/strings.html) (read, 30 min): All of chapter 7, sections 7.1 to 7.7.
- [Beej's Guide to C: Pointers II, Arithmetic](https://beej.us/guide/bgc/html/split/pointers2.html) (read, 40 min): Sections 11.1 to 11.3. Section 11.3 on `void *` is needed for the memory dump in the next step.
- [Beej's C Library Reference: string.h](https://beej.us/guide/bgclr/html/split/stringref.html) (reference, as needed): The entries 26.15 `strlen()`, 26.2 `strcpy()` with `strncpy()`, 26.5 `strcmp()` with `memcmp()`, and 26.1 `memcpy()` with `memmove()`. Skip the rest.

### Build

Write `src/strings.c` and `tests/strings_test.c` in the test pattern, and run it with `sh tests/run_test.sh strings`:

1. `size_t str_len(const char *s)`. Test "", "a" and "hello".
2. `int str_copy(char *dst, size_t cap, const char *src)` returns 0 and copies `src` with its terminator if it fits in `cap` bytes, and returns -1 without writing anything otherwise. Test an empty source, an exact fit ("abc" into 4 bytes), one byte too small ("abc" into 3 bytes) and `cap` 0.
3. `void str_reverse(char *s)` reverses in place. Test "", "a", "ab", "abc" and "abcd".
4. `void str_lower(char *s)` lowercases in place. Test "MiXeD 42!".
5. Move `swap_ints` from the previous step into this file and test it. Do not mark `swap_ints` or `str_len` `static`. At `-O1` clang copies a `static` function into its callers and deletes it, and step 8 reads the listings of both.
6. In `main`, declare `int nums[4]` and `char text[4]`, print `&nums[0]`, `&nums[0] + 1`, `&text[0]` and `&text[0] + 1` with `%p`, and explain the difference in the addresses.

### Done when

All tests pass. Break each function on purpose with an off-by-one change (copy one byte fewer, stop the reverse one step early) and confirm that at least one test fails for each change. For every test of `str_copy` you can name each byte it reads and writes, including the terminator. You can say what `strncpy(buf, "abc", 3)` leaves in `buf` and why your `str_copy` returns -1 for the same input.

## Checking drawings against real memory

Python Tutor showed you arrows. This step reads the real bytes, from inside the program with a function that prints them and from outside with gdb. It also shows where each kind of variable lives in a running process.

Any object can be read one byte at a time through an `unsigned char` pointer. That shows two things the C source hides:

- **Byte order.** x86-64 is **little-endian**: an `int` holding `0x12345678` is stored lowest byte first, as `78 56 34 12`.
- **Padding.** The compiler may leave unused bytes between struct fields, so that each field starts at an address the hardware handles well, usually a multiple of the field's size. `offsetof(type, field)` from `<stddef.h>` gives a field's distance in bytes from the start of the struct.

![struct Pair puts a at offset 0, three padding bytes after it, and b at offsets 4 to 7, so its size is 8.](figures/02-struct-padding.svg)

gdb reads the same bytes from outside. `x/8xb &value` prints 8 units in hex (`x`), each 1 byte (`b`) wide, starting at the address of `value`. Start gdb with `ASAN_OPTIONS=detect_leaks=0` as in chapter 01, because LeakSanitizer cannot run under a debugger.

Each lifetime lives in its own area of the process's address space from chapter 01. gdb's `info proc mappings` lists the same lines as `/proc/self/maps`, for the program gdb is running, one region per line: start and end address, permissions such as `r-xp` (read and execute) or `rw-p` (read and write), and the file the region came from. The last letter, `p`, means the region is private to the process. The heap holds the blocks from `malloc`, which the next step covers properly. The figure shows the regions of the `regions.c` program from the Build, with typical addresses:

![The memory map of a running program: the stack at the top, shared libraries below it, then the heap, and three regions from the program file for globals, string literals and code.](figures/02-memory-map.svg)

Your program file has two more `r--p` lines that the figure leaves out. The first line of the file, at the lowest address, holds the file's header. The `r--p` line right before `rw-p` in gdb's list holds data the loader fixes up at start. Sanitizers add regions of their own and move variables into them, so build `regions.c` without sanitizers.

The kernel starts a program at a different address each run, which is called **address space randomization**. gdb switches it off, so the addresses inside gdb differ from the ones a plain run prints.

### Study

- [Beej's Guide to C: Multibyte Values](https://beej.us/guide/bgc/html/split/pointers-iii-pointers-to-pointers-and-more.html#multibyte-values) (read, 15 min): Section 23.2 only. Section 23.1 on pointers to pointers comes in the next step.
- [Beej's Guide to C: Padding Bytes](https://beej.us/guide/bgc/html/split/structs-ii-more-fun-with-structs.html#struct-padding-bytes) (read, 10 min): Sections 20.5 and 20.6 only.
- [Debugging with GDB: Examining Memory](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Memory.html) (reference, as needed): Section 10.6, the `x/nfu addr` command. Look up the letters for count, format and unit size there.

### Build

1. Write `src/dump.c` with `void dump_bytes(const void *p, size_t n)` that prints `n` bytes in hex, 8 per line. Dump an `int` set to `0x12345678`, then `char s[8] = "hi"`, then a `struct Pair { char a; int b; }` and its `offsetof` values, then an `int *` that points at the first int. Compare the pointer's bytes with what `%p` prints.
2. Open your strings test in gdb with `ASAN_OPTIONS=detect_leaks=0 gdb ./out/Linux-debug/strings_test`. Set a breakpoint on `swap_ints`, run, and use `bt`, `info args` (the parameters, as `info locals` shows the locals), `up` and `x/4xb` to read the two caller ints as raw bytes before and after the swap.
3. From the caller's frame, set a watchpoint on one of its ints with `watch` and continue until it fires. gdb is now back in `swap_ints`, so run `up` again before you print the ints.
4. Write `src/regions.c` with a global `int g`, a string literal `const char *s = "literal"`, a local `int l`, and a block `int *h = malloc(sizeof *h)`. `malloc` returns the address of a new heap block, or `NULL` when it fails, so return 1 if `h` is `NULL`. Free `h` with `free(h)` before `main` returns.
5. Build it without sanitizers: `clang -g -O0 -Wall -Wextra -o out/Linux-debug/regions src/regions.c`. Even `SAN=undefined sh build.sh regions` links UBSan's code into the program, and `g` then lands in an unnamed `rw-p` line.
6. Open `regions` in gdb, break on the line that frees `h`, and print `&g`, `s`, `&l` and `h`. Then run `info proc mappings` and find the line whose start and end addresses contain each one.

### Done when

Before each dump, you write down the bytes you expect, and the output matches. The bytes gdb shows for each caller int match `dump_bytes` for the same value. The watchpoint stops inside `swap_ints` and prints the old and new value. gdb shows the line after the write, the next one to run, so you can name the line that did the write. You can point at the padding bytes in the `struct Pair` dump. For `regions`, `l` falls in `[stack]`, `h` in `[heap]`, `g` in an `rw-p` line of your executable and the literal in an `r--p` line of it, and you can match each to its lifetime.

## A linked list that owns its nodes

A list that grows while the program runs needs memory whose lifetime you decide. That is the heap from chapter 01. `malloc(n)` returns the address of a new block of `n` bytes, or `NULL` when it has none to give, and the block stays valid until you pass its address to `free`. Nothing frees it for you, and nothing stops you from using it after `free`. ASan reports that bug as heap-use-after-free.

![A local of list_push_front dies when the function returns, while the node it got from malloc lives on until free.](figures/02-lifetime.svg)

A **linked list** is a chain of separately allocated **nodes**. Each node holds a value and a pointer to the next node, and the last `next` is `NULL`. `n->next` is shorthand for `(*n).next`, the field `next` of the struct that `n` points at.

![head on the stack points at the first of three nodes on the heap, each node points at the next, and the last next is NULL.](figures/02-linked-list.svg)

The list **owns** its nodes: one function, `list_free`, frees all of them, and no other code frees a node that is still in the list.

> **Practice:** Before you write a `malloc`, write down who owns the block and which function frees it.

> **Practice:** Check the result of every `malloc` for `NULL` before you use it. The next step adds the same rule for `realloc`.

To test the paths where `malloc` fails, call `malloc` and `free` through wrappers that count calls and can fail on purpose:

```c
#include <stdlib.h>

int alloc_calls, alloc_count, free_count, fail_at_alloc;

void *counted_malloc(size_t size) {
    alloc_calls++;
    if (fail_at_alloc != 0 && alloc_calls == fail_at_alloc)
        return NULL;
    void *p = malloc(size);
    if (p != NULL)
        alloc_count++;
    return p;
}

void counted_free(void *p) {
    if (p != NULL)
        free_count++;
    free(p);
}
```

Reset the four counters to 0 at the start of every test. Setting `fail_at_alloc` to 3 then makes the third call since that reset return `NULL`. When a test ends, `alloc_count == free_count` means every block was freed. ASan and LeakSanitizer catch what the counters cannot see, such as a read past the end of a node.

Removing a node means changing whichever pointer points at it. That pointer is `head` for the first node and the previous node's `next` for the others. A cursor of type `struct Node **` holds the address of that pointer, so the first node needs no special case:

```c
struct Node **cur = head;          /* head is the struct Node ** parameter */
while (*cur != NULL && (*cur)->value != v)
    cur = &(*cur)->next;           /* move to the next node's next field */
if (*cur == NULL)
    return false;                  /* v is not in the list */
struct Node *dead = *cur;
*cur = dead->next;                 /* the pointer to dead now skips it */
counted_free(dead);
return true;
```

![To remove the node holding 7, cur holds the address of the next field that points at it. Writing through cur relinks the list around it.](figures/02-cursor.svg)

### Study

- [CS50x Lecture 5 notes: Linked Lists](https://cs50.harvard.edu/x/notes/5/#linked-lists) (read, 25 min): The "Linked Lists" section only. Read the first program, the print loop, the free loop and `unload`, and skim the append and sorted insert programs. Read `node` as `struct Node` and `get_int` from `cs50.h` as a fixed value.
- [Beej's Guide to C: Manual Memory Allocation](https://beej.us/guide/bgc/html/split/manual-memory-allocation.html) (read, 20 min): Sections 12.1 to 12.3. `realloc` in 12.5 waits for the next step.
- [Beej's Guide to C: Pointers to Pointers](https://beej.us/guide/bgc/html/split/pointers-iii-pointers-to-pointers-and-more.html#pointers-to-pointers) (read, 15 min): Section 23.1 only. It explains the pointer-to-pointer idea behind the `struct Node **` cursor. Stop before 23.1.1.

### Build

1. Put the counters and the two wrappers in `src/counted.h`. A `.h` file is a file you include. Quotes, as in `#include "counted.h"`, look in your own folder first, and angle brackets look in the system's. Each program in this chapter is one file, so `list.c` now and `vec.c` and `wordcount.c` later each include `counted.h` and get their own copy.
2. Write `src/list.c` with `struct Node { int value; struct Node *next; }`. The functions return `bool`, `true` or `false`, from `<stdbool.h>`, and each takes `struct Node **head`:
   - `bool list_push_front(head, int v)` returns false and leaves the list unchanged if allocation fails.
   - `bool list_pop_front(head, int *out)` returns false on an empty list.
   - `bool list_remove_first(head, int v)` removes the first node holding `v` with the cursor above.
   - `void list_reverse(head)` reverses the links in place without allocating.
   - `void list_free(head)` frees every node and sets `*head` to `NULL`.
3. Write `tests/list_test.c` and run it with `sh tests/run_test.sh list`. Test an empty list, one node and five nodes for every function. Remove the head, a middle node, the tail and a missing value. Reverse lists of length 0, 1, 2 and 5. Make allocation fail on the first call and on the third call. Check that the counters balance after every test.

### Done when

All tests pass with balanced counters and no sanitizer report. Delete the `free` in `list_free` on purpose and confirm that LeakSanitizer reports the leaked nodes and points at the `malloc` in `counted_malloc`. For every `malloc` in `list.c` you can name the function that frees it.

## A growable array

The linked list paid for one `malloc` per element and scattered its nodes across the heap. A **growable array** keeps all its elements in one heap block and tracks two numbers: `len`, how many elements are in use, and `cap`, how many fit in the block. `len` never exceeds `cap`. A push when `len == cap` first grows the block, here by doubling `cap`.

`realloc(p, n)` resizes the block at `p` to `n` bytes. It may grow the block where it is. It may also copy the elements to a new block, free the old one and return the new address. If it fails, it returns `NULL` and leaves the old block as it was. `realloc(NULL, n)` behaves like `malloc(n)`, so an empty array can start with `data` set to `NULL` and `cap` 0.

> **Practice:** Store the result of `realloc` in a new variable, and check it for `NULL` before you overwrite the old pointer.

With `counted_realloc`, the counted version that you add to `counted.h` in the Build, a push that needs more room does this:

```c
int *grown = counted_realloc(v->data, new_cap * sizeof *v->data);
if (grown == NULL)
    return false;           /* v->data, v->len and v->cap unchanged */
v->data = grown;
v->cap = new_cap;
```

`sizeof *v->data` is the size of one element, 4 bytes for an `int`. When the block moves, every pointer into the old block dangles:

![Before the push, data and saved point into a full block of 4 ints. After realloc moves the elements to a block of 8, saved still points into the freed old block.](figures/02-vec-grow.svg)

The size passed to `realloc` can overflow too. `new_cap * sizeof *v->data` is a `size_t`, and a product past `SIZE_MAX`, its largest value, wraps around to a small number. Check before you multiply: `if (new_cap > SIZE_MAX / sizeof *v->data) return false;`. `SIZE_MAX` comes from `<stdint.h>`.

### Study

- [Beej's Guide to C: Manual Memory Allocation](https://beej.us/guide/bgc/html/split/manual-memory-allocation.html#changing-allocated-size-with-realloc) (read, 20 min): Sections 12.5 to 12.5.2. The `readline` example in 12.5.1 reads with `fgetc` and doubles the buffer when it is full. You reuse that pattern in the word counter, but stop at `EOF` instead of a newline.
- [Linux man page: malloc(3)](https://man7.org/linux/man-pages/man3/malloc.3.html) (reference, as needed): The `realloc()` and `reallocarray()` paragraphs under DESCRIPTION and the RETURN VALUE section. This is the C library your programs use on Ubuntu.

### Build

1. Add `counted_realloc` to `counted.h`. Write it like `counted_malloc`, and count a new block only when the pointer passed in was `NULL`.
2. Write `src/vec.c` with `struct Vec { int *data; size_t len; size_t cap; }` and `vec_init`, `bool vec_push(v, int x)`, `bool vec_pop(v, int *out)`, `bool vec_remove_at(v, size_t i)` (shift the later elements down) and `vec_free`. Capacity goes 0, 4, 8, 16.
3. Write `tests/vec_test.c` and run it with `sh tests/run_test.sh vec`. Test:
   - Pop and remove on an empty array return false.
   - Pushing 4 values gives `cap` 4. The 5th gives `cap` 8 with the first 4 values intact.
   - Failed growth on the 5th push returns false and leaves `data`, `len` and `cap` exactly as they were, with the counters showing one live block.
   - Remove the first, a middle and the last element.
   - On a test struct with `data` `NULL` and `len` and `cap` both set by hand to `SIZE_MAX / sizeof(int)`, a push returns false and `alloc_calls` does not change.

### Done when

All tests pass with balanced counters and no sanitizer report. Add a last test to `tests/vec_test.c` that saves a pointer to `data[1]`, pushes until the array grows, then reads through the saved pointer. ASan reports heap-use-after-free if the block moved. Delete that test once you have seen the report. You can say which pointers stay valid after a push that grows the array and which do not.

## A word counter, then its assembly

This step puts the whole chapter into one program, then shows what the compiler made of three of your functions.

The word counter reads text from standard input, splits it into words and counts each distinct word. A word is a run of letters as `isalpha` sees them, stored lowercase. Everything else separates words, so "don't" counts as "don" and "t". The table is a growable array of entries, and each entry owns a heap copy of its word:

![The word table holds a heap array of four entries, three in use. Each entry points at its own heap copy of a word and keeps a count.](figures/02-word-table.svg)

The second half of the step reads assembly, the machine instructions written as text, one per line. Chapter 01 showed clang's four stages, and `-S` stops it after the second, with the assembly in a `.s` file.

Here is `swap_ints` from step 3, compiled with `-O1`, a level of optimization that removes obvious waste and keeps the code readable. Chapter 05 teaches you to write assembly yourself.

![Each C line of swap_ints is joined to the instruction or instructions it became. tmp has no memory slot: it stays in %eax.](figures/02-swap-asm.svg)

x86-64 has 16 general registers, the storage slots inside the CPU from chapter 01, and each holds 8 bytes. clang on Linux prints assembly in **AT&T syntax**:

- The source comes first and the destination last: `movl %ecx, (%rdi)` copies `%ecx` to memory.
- A name after `%` is a register, and a number after `$` is a constant. Parentheses mean memory: `(%rdi)` is the bytes at the address held in `%rdi`.
- The last letter of the instruction gives the size: `b` for 1 byte, `l` for 4, `q` for 8.
- `%rdi` is all 8 bytes of a register and `%edi` its low 4. Pointers travel in the `r` names and ints in the `e` names.
- The first argument arrives in `%rdi`, the second in `%rsi`, and the result leaves in `%rax`, or `%eax` for an `int`.

`swap_ints` and `str_len` need six instruction forms:

| Instruction | What it does |
| --- | --- |
| `movl (%rdi), %eax` | loads 4 bytes from the address in `rdi` into `eax`. `movl %ecx, (%rdi)` stores in the other direction |
| `cmpb $0, 1(%rdi,%rax)` | compares the byte at address `rdi + rax + 1` with 0 |
| `jne .LBB0_1` | jumps to the label `.LBB0_1` if that comparison found the two different |
| `leaq 1(%rax), %rax` | adds 1 to `rax`, leaving the comparison result for `jne` untouched |
| `callq f` | pushes the **return address**, the address of the next instruction, onto the stack and jumps to `f` |
| `retq` | takes the return address off the top of the stack and jumps there |

At `-O0`, which clang uses when you give no `-O` flag, every C variable gets its own slot in memory, so the listing follows the C line by line. The function opens with `pushq %rbp`, which saves the caller's `%rbp` on the stack, and `movq %rsp, %rbp`, which points `%rbp` at the new frame. The variables' slots sit below that address, such as `-8(%rbp)`, 8 bytes below it:

![During swap_ints at -O0, main's frame sits above the return address that call pushed. Below it, swap_ints's frame starts with the saved %rbp, where %rsp and %rbp point, and holds slots for a, b and tmp.](figures/02-call-frame.svg)

The `-O0` listings and the copy function in your word counter show a few more forms. Chapter 05 explains them, so only recognize them here:

- `testq %rax, %rax` then `je`: jumps if `rax` is 0. A `NULL` check compiles to this pair. `xorl %eax, %eax` sets `eax` to 0.
- `alloc_calls(%rip)`: a global, found at a fixed distance from `%rip`, x86-64's name for the program counter.
- `callq malloc@PLT`: a call into the C library, through a table.
- `pushq %rbx` at the start and `popq %rbx` before `retq`: the function saves a register that it must hand back unchanged.
- `movsbl` and `movzbl`: load 1 byte into a 4-byte register, padding with the sign for signed values or with zeros.

Dive Into Systems prints its listings with `objdump -d`, as you did in chapter 01. They differ from `clang -S` in small ways:

- They leave off the size letter when a register already gives the size: `mov %ecx,(%rdi)`.
- They print `ret` and `call` where clang prints `retq` and `callq`. These are the same instructions.
- The book shows addresses like `400526`. Ubuntu loads programs at addresses like `0x555555555140`.

### Study

- [Dive Into Systems: 64-bit x86 Assembly](https://diveintosystems.org/book/C7-x86_64/index.html) (read, 2.5 h): The introduction, 7.1, 7.2, the opening table of 7.3 and 7.3.3 on `lea`, then 7.4 and 7.5. Open each section from the contents list on the left, because the pages have no "Next" link. Ignore Intel syntax and NASM, since this book reads AT&T syntax. Stop before 7.6, where chapter 05 continues.
- [Beej's C Library Reference: ctype.h](https://beej.us/guide/bgclr/html/split/ctype.html) (reference, as needed): The chapter introduction on why these functions need an `unsigned char` value, then the `isalpha()` and `tolower()` entries.

### Build

Part 1, the word counter, in `src/wordcount.c`:

1. `src/counted.h` is the file from steps 6 and 7. If you wrote the wrappers inside `list.c` and `vec.c`, move them into `src/counted.h` now, with `counted_realloc`, and include it from all three programs.
2. Declare `struct WordCount { char *word; size_t count; }` and `struct WordTable { struct WordCount *items; size_t len; size_t cap; }`.
3. `void table_init(struct WordTable *t)` sets everything to zero and allocates nothing.
4. `char *word_copy(const char *start, size_t len)` returns a new block from `counted_malloc` that holds the `len` bytes at `start`, lowercased, with a terminator, or `NULL` if allocation fails.
5. `bool table_add_word(struct WordTable *t, const char *start, size_t len)` adds the `len` letters at `start`. It returns false for a `NULL` table, `NULL` `start` or `len` 0. Capacity goes 0, 4, 8. To look a word up, scan the entries and compare the stored word with the slice byte by byte, lowercasing the slice as you go, and check that the stored word ends exactly at `len`. A word already in the table only adds 1 to its count and allocates nothing. A new word gets its copy from `word_copy`. If growing the array fails after the copy succeeded, free the copy so nothing leaks.
6. `bool table_add_text(struct WordTable *t, const char *text)` splits `text` into words and adds each one.
7. `void table_free(struct WordTable *t)` frees every word and the array, zeroes the struct, and is safe to call twice or with `NULL`.
8. `main` reads all of standard input with the growing buffer of Beej's `readline`: `fgetc(stdin)` returns the next byte as an `int`, or `EOF` when the input is over. It appends each byte to a buffer that doubles when full and adds the terminator at `EOF`. Then it calls `table_add_text`, prints one `count word` line per entry in order of first appearance, frees everything and returns 0. On allocation failure it prints a message to `stderr` and returns 1.

Write `tests/wordcount_test.c` and run it with `sh tests/run_test.sh wordcount`. Test:

- "The", then "THE": one entry "the" with count 2. The second add allocates nothing.
- "th", "the" and "then" are three entries.
- Adding the first 5 bytes of "hello world" stores "hello".
- `The cat. the dog; THE end 42 don't` gives the 3, cat 1, dog 1, end 1, don 1, t 1, in that order.
- "", "123 !! --", text that ends right after a word, and text that starts with spaces, tabs and newlines.
- 50000 copies of "the " give one entry with count 50000 and exactly 2 allocation calls. Build the 200 KB input string with plain `malloc` so it does not show up in the counts.
- Allocation fails on the word copy, on the first array growth (the copy must be freed), on a later growth (old entries intact) and halfway through `table_add_text` (the words before the failure stay counted).
- Counters balance after every test.

Then compare your program with a second word count built from standard shell tools, on a long text. You use these tools only for this check, so copy the commands after you have read what each part does:

- `ls --help > ls.txt` saves the help text of `ls` to a file, which gives you a few hundred words to count.
- `tr -cs 'A-Za-z' '\n'` replaces every run of characters that are not letters with one newline, so each word lands on a line of its own. `LC_ALL=C` makes `tr` treat each byte as one plain character.
- `tr 'A-Z' 'a-z'` lowercases, and `grep -v '^$'` drops empty lines.
- `sort | uniq -c` puts equal words next to each other and counts each run. `awk '{print $1, $2}'` reprints the count and the word with one space between them.
- `diff` prints the lines where the two files differ, and nothing when they match.

```sh
ls --help > ls.txt
./out/Linux-debug/wordcount < ls.txt | sort > mine.txt
LC_ALL=C tr -cs 'A-Za-z' '\n' < ls.txt | LC_ALL=C tr 'A-Z' 'a-z' \
  | grep -v '^$' | sort | uniq -c | awk '{print $1, $2}' | sort > shell.txt
diff mine.txt shell.txt
rm mine.txt shell.txt
```

Keep `ls.txt`, because chapter 04 counts it again, and add the line `ls.txt` to `.gitignore` so git leaves it alone.

Part 2, the assembly, for `swap_ints`, `str_len` and `word_copy`. None of the three may be `static`, because at `-O1` clang copies a `static` function into its callers and deletes it, so there is no listing to read.

1. For each one, print its assembly at `-O0` and at `-O1`, for example `clang -S -O1 -o - src/strings.c`. `-o -` writes the output to the terminal instead of a file.
2. For `swap_ints` and `str_len`, paste the `-O1` version into a comment block above the C function and write next to every instruction the C it came from. Lines that start with a dot and do not end in a colon, such as `.cfi_def_cfa_offset 16`, `.type`, `.size`, `.globl` and `.p2align`, are **directives**: notes for the assembler and the debugger that produce no instructions. Leave them out of your copy. Keep labels such as `.LBB1_1:`, because the jumps name them as their targets.
3. In `str_len`, find the byte load, the counter increment and the jump back to the top of the loop. Clang 18 at `-O1` folds the load into the `cmpb` and counts with `leaq`, so the `jne` after it still tests the `cmpb`.
4. In `word_copy` at `-O1`, about 50 instructions long, find only these: the register `len` arrives in, the `leaq` that computes `malloc`'s argument into `%rdi`, the `callq` to `malloc`, the `testq` and `je` that check the result for `NULL`, the `pushq` instructions at the start with their `popq` partners at the end, and the `retq`. clang copies the body of `counted_malloc` into `word_copy`, so the counter updates appear before the call. `tolower` becomes a call to `__ctype_tolower_loc`, which returns a lowercase table, and one table lookup per byte.
5. Count the instructions of `swap_ints` at `-O0` and at `-O1`.

Then watch `swap_ints` run, one instruction at a time. gdb has commands for single instructions that add to the ones from chapter 01:

```
b *swap_ints         stop at the function's first instruction
                     (b swap_ints stops after the frame setup)
info registers rdi   print a register
x/gx $rsp            the 8 bytes at the top of the stack, in hex
info symbol ADDR     name the function that the address ADDR falls in
disassemble          the current function's instructions, an arrow at the next one
stepi                run one instruction
x/i $pc              print the instruction about to run
```

1. Copy `swap_ints` into `src/swap_demo.c` with a `main` that swaps two local ints `x` and `y` and prints them.
2. Build it without `build.sh`, because the sanitizer checks grow the 16 instructions of `swap_ints` at `-O0` to about 140: `clang -g -O0 -o out/Linux-debug/swap_demo src/swap_demo.c`.
3. Start it in gdb, run `b *swap_ints`, then `r`. The `a=` and `b=` values in gdb's stop line are not set up yet at this point, so ignore them.
4. Run `info registers rdi rsi rsp`. Then `up`, `p &x` and `p &y`, and compare the two addresses with `rdi` and `rsi`. Go back with `down`.
5. Run `x/gx $rsp` and `info symbol` on the value it prints.
6. Run `disassemble`, find the frame setup and the stack slots of the figure, then `stepi` through the function with `x/i $pc` after each step until `ret` has run.

> **Optional:** `clang --target=aarch64-linux-gnu -S -O1 -o - src/swap_demo.c` prints the same function for ARM64, the instruction set of the Mac, without any extra install. `swap_ints` becomes two `ldr` loads and two `str` stores, and `ret` jumps to the address in register `x30` instead of taking it off the stack. Chapter 05 uses ARM64 as its second instruction set.

> **Optional:** [Compiler Explorer](https://godbolt.org/) compiles C you paste into the page and colors each C line and the instructions it became. Choose C in the language box, pick the "x86-64 clang 18.1.0" compiler, type `-O1` in the options box, and turn off "Intel asm syntax" in the "Output..." menu. Newer clang versions turn the `str_len` loop into a call to `strlen`.

### Done when

All word counter tests pass with balanced counters and no sanitizer report, and `diff mine.txt shell.txt` prints nothing. For `swap_ints` and `str_len` you have an annotated `-O1` listing, and you can point at the register each argument arrives in, the register the result leaves in, and every load, store and jump. In `word_copy` you can point at each item of Part 2, item 4. You can say what changed between `-O0` and `-O1` for `swap_ints`. In gdb you saw `rdi` and `rsi` hold the addresses of the caller's two ints, `info symbol` named a spot inside `main` as the return address on the stack, and `stepi` past `ret` landed you back in `main` at the instruction after the `call`.

## Where this leads

You can now write C that owns heap memory and frees it on every path, test the failure paths on purpose, read raw bytes in a debugger, and look at the instructions the compiler produced. What you cannot yet explain is the hardware that runs those instructions. You saw `mov` move values between registers and memory, `cmpb` and `jne` drive a loop, and `call` and `ret` pass the return address through the stack. You have not seen how a register, the program counter or the step from one instruction to the next is built.

Chapter 03, From gates to a CPU, builds them from logic gates up to a working CPU, and then asks you to write an assembler in C. It starts away from C, in a browser-based hardware simulator, where you build every basic gate out of NAND. C comes back in its last two steps. The assembler reads a text file, splits lines into fields and keeps a symbol table, so your string functions and word table carry over.
