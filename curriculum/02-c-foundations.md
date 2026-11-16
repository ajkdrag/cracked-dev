---
id: 02
title: C foundations
part: The machine and C
weeks: 3
project: A linked list, a growable array and a word counter in C, then three C functions matched to ARM64 assembly.
---

Chapter 01 left you with clang and lldb on the Mac, an ARM64 Linux VM, and a `build.sh` that compiles with warnings as errors and sanitizers on. You can compile, run and step through a program. You have not written much C with it yet.

This chapter teaches enough C to build three small things: a linked list, a growable array and a word counter. All three own heap memory, so every allocation needs a clear owner and one place where it gets freed. At the end you put three of your own functions through the compiler and match each line of C to the ARM64 instructions it became.

Most of the chapter is practice at keeping pairs of things apart: a pointer and the thing it points to, a string's length and its buffer's capacity, a variable's name and the bytes behind it. You draw these on paper first and then check the drawing against the real program in a debugger.

The chapter comes now because chapter 03 asks you to write an assembler in C. That assembler reads a text file, splits it into words and keeps a table of symbols. That is the word counter with a different input format.

## The build loop and a test pattern

Before you write your own C, check that the loop from chapter 01 still works on the Mac and in Linux, and add the one piece chapter 01 did not have: a small test program per source file. Every Build in this chapter has test cases, and this pattern runs them.

The pattern keeps the whole program in one translation unit, like `build.sh` does. The test file includes the `.c` file it tests, so it sees every function, including `static` ones. The preprocessor renames the tested file's `main` out of the way first:

```c
// tests/add_test.c
#define main add_demo_main
#include "../src/add.c"
#undef main

#include <stdio.h>

static int failures = 0;

static void check(const char *label, int ok) {
    printf("%s  %s\n", ok ? "OK  " : "FAIL", label);
    if (!ok)
        failures++;
}

int main(void) {
    check("add(2, 3) is 5", add(2, 3) == 5);
    check("add(-1, 1) is 0", add(-1, 1) == 0);
    printf("%d failure(s)\n", failures);
    return failures;
}
```

`const char *label` is how C passes a string that the function only reads. The pointers step assigns the section on `const`, and until then you can copy `check` as it is. `main` returns the failure count, so the exit status is 0 only when every check passed. A script that builds the test with the same flags as `build.sh` and runs it gives you a one-line command per step.

`#define` and `#include` are preprocessor work. Clang runs four stages on every file, and you can stop it after each one to look at the output:

```
  hello.c
     | clang -E hello.c        preprocessor: pastes #include files, expands macros
     v
  expanded C text
     | clang -S hello.c        compiler: writes hello.s, ARM64 assembly as text
     v
  hello.s
     | clang -c hello.c        assembler: writes hello.o, machine code
     v
  hello.o
     | clang hello.o -o hello  linker: joins your code with libc into an executable
     v
  hello
```

The last step of this chapter reads `.s` output in detail. Here you only see that it exists.

### Study

- [Clang command guide](https://clang.llvm.org/docs/CommandGuide/clang.html) (read, 15 min): DESCRIPTION, which names the stages, and "Stage Selection Options". Under "Code Generation Options", read the `-O0` to `-O3` entries. Skip the rest.

### Build

1. Run the `main.c` and `bugs.c` checks from chapter 01 once more on the Mac and in Linux. Fix anything that broke since.
2. Write `src/add.c` with `int add(int a, int b)` and a `main` that prints `add(2, 3)`. Write `tests/add_test.c` as above.
3. Write `tests/run_add_test.sh`. It builds `tests/add_test.c` with the debug flags from `build.sh` into `out/`, runs the result, and exits with the test's status. Run it on the Mac and in Linux.
4. Add a check that is wrong on purpose, such as `add(2, 2) == 5`. Run the script and check its exit status. Remove the wrong check.
5. Run `clang -E`, `clang -S` and `clang -c` on `src/add.c`. Find the `#include <stdio.h>` contents in the `-E` output, the `add` function in the `.s` file, and confirm with `file` that the `.o` file is an object file and not an executable.

### Done when

`sh build.sh add` builds with no output from clang on both machines. `sh tests/run_add_test.sh; echo $?` prints two OK lines and `0`. With the wrong check added, it prints one FAIL line and a nonzero status. You can say which stage produced each of the three files from step 5.

## Expressions, control flow, functions, arrays and structs

The test pattern needs functions to test. This step writes the first ones. You know Python, so most of C's control flow reads as familiar syntax. The differences that matter for this chapter: every variable has a fixed type and size, integer division truncates, an `int` can overflow, and a function receives copies of its arguments.

Arrays and structs are the two ways C groups values. An array is values of one type placed back to back. A struct is fields of different types laid out in the order you declare them. A struct can be copied whole by assignment or by passing it to a function. An array cannot be assigned or passed whole. Passing arrays to functions needs pointers, which come in the next step, so in this step keep each array inside the function that declares it.

### Study

- [Beej's Guide to C: Variables and Statements](https://beej.us/guide/bgc/html/split/variables-and-statements.html) (read, 90 min): All of chapter 3, then follow "Next" through chapter 4 on functions. Skim anything that matches Python.
- [Beej's Guide to C: Arrays](https://beej.us/guide/bgc/html/split/arrays.html) (read, 20 min): Sections 6.1 to 6.4. Stop before 6.5 on multidimensional arrays.
- [Beej's Guide to C: Structs](https://beej.us/guide/bgc/html/split/structs.html) (read, 20 min): Sections 8.1 to 8.3, 8.5 and 8.6. Skip 8.4 on the arrow operator, which needs pointers. The CS50 notes in the linked list step introduce it.

### Build

Write `src/basics.c` with three parts and print the results from `main`:

1. `int collatz_steps(int n)` returns how many steps the sequence "halve if even, else 3n+1" takes to reach 1. Check that it returns 0 for 1, 8 for 6 and 111 for 27.
2. A table of Celsius values from 0 to 100 in steps of 10 next to their Fahrenheit values, computed with integer math as `c * 9 / 5 + 32`.
3. `struct Stats { int min; int max; int sum; int count; }`. In `main`, fill an array with `{4, 8, 15, 16, 23, 42, -1, 0}` and loop over it to fill one `struct Stats`. Write `int stats_average(struct Stats s)` that returns the integer average, and pass the struct by value.

### Done when

The program prints 0, 8 and 111 for the Collatz cases, 212 for 100 Celsius, and min -1, max 42, sum 107, average 13 for the array. It builds with zero warnings under `build.sh`. You can say why `stats_average` cannot change the caller's struct.

## Pointers and lifetimes on paper

The last step kept every array inside the function that declared it, and `stats_average` could not change the caller's struct. Both limits go away once a function receives an address instead of a copy. Memory is one long array of bytes, and every byte has an address. A variable is a name for some of those bytes. A pointer is a variable that holds an address. The addresses below are made up. The layout is exact for your Mac:

```
  int x = 42;
  int *p = &x;

  address   bytes                      name
  0x1000    2a 00 00 00                x   (42 in 4 bytes, lowest byte first)
  0x1004    .. .. .. ..
  0x1008    00 10 00 00 00 00 00 00    p   (holds 0x1000 in 8 bytes)

  p    is 0x1000, the address stored in p
  &p   is 0x1008, the address of p itself
  *p   reads the 4 bytes at 0x1000 and gives 42
```

Every object also has a lifetime: the stretch of the run during which its bytes belong to it. C has three kinds that matter here.

```
  automatic   locals and parameters      born when the block starts,
                                         dead when the block ends
  static      file-scope variables and   live for the whole run,
              locals marked static       start at 0 unless initialized
  allocated   malloc'd blocks            live from malloc until free
```

The pointer variable has its own lifetime, separate from the lifetime of the object it points to. Holding a pointer to an object does not extend the object's lifetime. If a function returns the address of one of its locals, the caller gets an address whose object is already dead. Clang warns about the simple case. Allocated lifetime comes in the linked list step, where you first call `malloc`.

Draw before you run. For every program in this step, draw boxes for variables and arrows for pointers on paper, then step through it in Python Tutor and compare. Python Tutor runs your code on its own Linux server, so the addresses will differ from your Mac. The arrows should point the same way.

### Study

- [Beej's Guide to C: Pointers](https://beej.us/guide/bgc/html/split/pointers.html) (read, 45 min): Sections 5.1 to 5.7.
- [Beej's Guide to C: Qualifiers and Specifiers](https://beej.us/guide/bgc/html/split/types-iv-qualifiers-and-specifiers.html) (read, 25 min): All of 16.1.1 `const`, including 16.1.1.1 on `const` and pointers and 16.1.1.2 on the warning clang gives when a pointer drops `const`. Then 16.2.1 `auto` and 16.2.2 `static`. Skip the other qualifiers (16.1.2 to 16.1.4) and the rest of 16.2.
- [Python Tutor for C](https://pythontutor.com/c.html) (do, 30 min): Paste each program from the Build and step through it. Predict where each arrow points before you click "Next".

### Build

Write `src/lifetimes.c`:

1. `int x = 42` and `int *p = &x`. Print `x`, `p`, `&p`, `*p`, `sizeof x` and `sizeof p` with `%d`, `%p` and `%zu`. Change `x` through `*p` and print `x` again.
2. `void swap_ints(int *a, int *b)` that swaps two of the caller's ints. Call it on two locals in `main`.
3. `int next_id(void)` that keeps a `static int` counter and returns 1, 2, 3 on successive calls.
4. `int *dangling(void)` that returns the address of a local. Read the compiler's message (with `-Werror` the warning becomes an error), then delete the function.

Draw parts 1 and 2 on paper before running them, then check both drawings in Python Tutor.

### Done when

You can explain what `p`, `&p` and `*p` each mean and what type each one has. Your paper drawing of `swap_ints` matches Python Tutor's arrows at every step. You can name the lifetime of each variable in the program and say why the pointer returned by `dangling` was invalid even though it held a real address.

## Strings and pointer arithmetic

Every function in this step takes a pointer from the last step, because a string reaches a function as the address of its first character. A string in C is a `char` array with a 0 byte after the last character. Nothing stores the length. `strlen` finds it by walking until the 0 byte. That gives you two numbers to keep apart: the length of the text and the capacity of the buffer that holds it. The capacity must be at least length + 1.

```
  char buf[8] = "cat";

  index    0    1    2    3    4    5    6    7
  bytes   'c'  'a'  't'  \0   \0   \0   \0   \0
          |--- length 3 ---|
          |------------- capacity 8 -------------|
```

Pointer arithmetic moves in whole elements. If `p` is an `int *`, `p + 1` is 4 bytes further on. If `p` is a `char *`, `p + 1` is 1 byte further on. `a[i]` means `*(a + i)`. When you pass an array to a function, the function receives a pointer to its first element and `sizeof` inside the function measures the pointer. Pass the length or capacity as a separate argument.

A parameter like `const char *s` says the function only reads through `s`. Clang rejects a write through it. `build.sh` also turns on `-Wconversion`, and `tolower` returns an `int`, so storing its result in a `char` is an error until you write the cast yourself: `*s = (char)tolower((unsigned char)*s)`. Cast other narrowing assignments between `int`, `char` and `size_t` the same way, on purpose.

Your copy function should refuse to write past the destination. The standard `strcpy` trusts the caller, so it is the API to understand here and the wrong contract for your own bounded copy.

### Study

- [Beej's Guide to C: Strings](https://beej.us/guide/bgc/html/split/strings.html) (read, 30 min): All of chapter 7, sections 7.1 to 7.7.
- [Beej's Guide to C: Pointers II, Arithmetic](https://beej.us/guide/bgc/html/split/pointers2.html) (read, 40 min): Sections 11.1 to 11.3. Section 11.3 on `void *` is needed for the memory dump in the next step.
- [Beej's C Library Reference: ctype.h](https://beej.us/guide/bgclr/html/split/ctype.html) (reference, as needed): `isalpha()`, `isspace()`, `tolower()` and `toupper()`. Note what each page says about passing values that fit in an `unsigned char`.

### Build

Write `src/strings.c` and a test program that prints OK or FAIL per case and a failure count at the end:

- `size_t str_len(const char *s)`. Test "", "a" and "hello".
- `int str_copy(char *dst, size_t cap, const char *src)` returns 0 and copies `src` with its terminator if it fits in `cap` bytes, and returns -1 without writing anything otherwise. Test an empty source, an exact fit ("abc" into 4 bytes), one byte too small ("abc" into 3 bytes) and `cap` 0.
- `void str_reverse(char *s)` reverses in place. Test "", "a", "ab", "abc" and "abcd".
- `void str_lower(char *s)` lowercases in place with `tolower((unsigned char)c)`. Test "MiXeD 42!".
- Move `swap_ints` from the previous step into this file and test it.

Also declare `int nums[4]` and `char text[4]`, print `&nums[0]`, `&nums[0] + 1`, `&text[0]` and `&text[0] + 1` with `%p`, and explain the difference in the addresses.

### Done when

All tests pass. Break each function on purpose with an off-by-one change (copy one byte fewer, stop the reverse one step early) and confirm at least one test fails for each change. For every test of `str_copy` you can name each byte it reads and writes, including the terminator.

## Checking drawings against real memory

Python Tutor showed you arrows. This step reads the real bytes two ways: from inside the program with a dump function, and from outside it with lldb.

Every object can be read as a sequence of `unsigned char`. That is how you see byte order and padding. Your Mac and your Linux VM are both little-endian, so an `int` holding `0x12345678` is stored lowest byte first: `78 56 34 12`. A struct may contain padding bytes between fields so that each field starts at an address the hardware handles well, usually a multiple of the field's size. Their values are whatever was in memory before.

```
  struct Pair { char a; int b; };      sizeof is 8, not 5

  offset   0     1     2     3     4     5     6     7
          [a]  [pad] [pad] [pad]  [b    b     b     b]
```

Chapter 01 taught you breakpoints, `bt`, `up` and watchpoints in lldb. Here you add `memory read`, which prints raw bytes at an address. Its entry in the GDB to LLDB command map from chapter 01 shows the flags for size, count and format. In lldb, `x/8xb &value` does the same with gdb's short syntax.

### Study

- [Beej's Guide to C: Multibyte Values](https://beej.us/guide/bgc/html/split/pointers-iii-pointers-to-pointers-and-more.html#multibyte-values) (read, 15 min): Section 23.2 only. Section 23.1 on pointers to pointers comes in the next step.
- [Beej's Guide to C: Padding Bytes](https://beej.us/guide/bgc/html/split/structs-ii-more-fun-with-structs.html#struct-padding-bytes) (read, 10 min): Sections 20.5 and 20.6 only.

### Build

Write `src/dump.c` with `void dump_bytes(const void *p, size_t n)` that prints `n` bytes in hex, 8 per line. Dump:

1. `int` set to `0x12345678`.
2. `char s[8] = "hi"`.
3. A `struct Pair { char a; int b; }` and its `offsetof` values.
4. An `int *` that points at the int from part 1. Compare its bytes with what `%p` prints.

Then open your `swap_ints` test in lldb. Set a breakpoint on `swap_ints`, run, and use `bt`, `frame variable`, `up` and `memory read` to read the two caller ints as raw bytes before and after the swap. Set a watchpoint on one of the caller's ints and continue until it fires.

### Done when

Before each dump, you write down the bytes you expect, and the output matches. The bytes lldb shows for each caller int match `dump_bytes` for the same value. The watchpoint stops on the line in `swap_ints` that writes to that int. You can point at the padding bytes in the `struct Pair` dump.

## A linked list that owns its nodes

So far every object had automatic or static lifetime. `malloc` gives you a block whose lifetime you control: it starts when `malloc` returns and ends when you pass the pointer to `free`. Nothing frees it for you. A pointer to a freed block still holds an address, and using it is a bug that ASan reports as heap-use-after-free.

A linked list is a chain of separately allocated nodes. The list owns every node, and one function frees them all. Write the owner of each allocation down before you write the code that creates it.

```
  head --> [ 3 | next ] --> [ 7 | next ] --> [ 9 | NULL ]
           node 1           node 2           node 3
           list owns        list owns        list owns
```

Removing a node means changing whichever pointer points at it. That pointer is `head` for the first node and some node's `next` for the rest. A `struct Node **` cursor holds the address of that pointer, so the first node needs no special case:

```
  struct Node **cur = &head;             cur points at head
  while (*cur && (*cur)->value != v)
      cur = &(*cur)->next;               cur points at a next field

  removing node 2:
  head --> [ 3 | next ] --> [ 7 | next ] --> [ 9 | NULL ]
                    ^
                   cur holds the address of this next field
  struct Node *dead = *cur;
  *cur = dead->next;
  free(dead);
```

To test failure paths, call `malloc` and `free` through wrappers that count calls and can fail on purpose:

```c
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

Put the counters and the wrappers in `src/counted.h`. Each program in this chapter is one translation unit, so `list.c`, `vec.c` and `wordcount.c` each `#include "counted.h"` and get their own copy. When a test ends, `alloc_count == free_count` means every block was freed. The counters work on the Mac. Run the same tests under ASan in the Linux VM to catch leaks and bad accesses the counters cannot see.

### Study

- [CS50x Lecture 5 notes: Linked Lists](https://cs50.harvard.edu/x/notes/5/#linked-lists) (read, 25 min): The "Linked Lists" section only. Read the first program, which introduces the arrow operator and prepends nodes, the print loop, the loop that frees every node and the `unload` function at the end. Skim the append and sorted insert programs, which you do not build. The code writes `typedef struct node { ... } node;` so it can say `node` instead of `struct node`. Keep writing `struct Node`. The examples use `cs50.h` and `get_int`, which you do not have. Replace them with fixed values.
- [Beej's Guide to C: Manual Memory Allocation](https://beej.us/guide/bgc/html/split/manual-memory-allocation.html) (read, 20 min): Sections 12.1 to 12.3. `realloc` in 12.5 waits for the next step.
- [Beej's Guide to C: Pointers to Pointers](https://beej.us/guide/bgc/html/split/pointers-iii-pointers-to-pointers-and-more.html#pointers-to-pointers) (read, 15 min): Section 23.1 only. It explains the pointer-to-pointer idea behind the `struct Node **` cursor above. Stop before 23.1.1.

### Build

Write `src/list.c` with `struct Node { int value; struct Node *next; }` and these functions, each taking `struct Node **head`:

- `bool list_push_front(head, int v)` returns false and leaves the list unchanged if allocation fails.
- `bool list_pop_front(head, int *out)` returns false on an empty list.
- `bool list_remove_first(head, int v)` removes the first node holding `v` using a `struct Node **` cursor.
- `void list_reverse(head)` reverses the links in place without allocating.
- `void list_free(head)` frees every node and sets `*head` to NULL.

Test an empty list, one node and five nodes for every function. Remove the head, a middle node, the tail and a missing value. Reverse lists of length 0, 1, 2 and 5. Make allocation fail on the first call and on the third call. Check the counters balance after every test.

### Done when

All tests pass with balanced counters on the Mac. The same tests run clean under ASan in the Linux VM. Delete the `free` in `list_free` on purpose and confirm that LeakSanitizer in the VM reports the leaked nodes. For every `malloc` in `list.c` you can name the function that frees it.

## A growable array

The linked list paid for one `malloc` per element and spread its nodes across the heap. A growable array keeps its elements in one heap block and tracks two numbers: `len`, the number of valid elements, and `cap`, the number that fit in the block. The rule is `0 <= len <= cap` at all times. When `len == cap` and you push, you grow the block, usually by doubling `cap`.

`realloc` grows a block. It may grow it in place or it may move the elements to a new block and free the old one. If it fails it returns NULL and leaves the old block alone. So keep the old pointer until you know `realloc` succeeded:

```c
int *grown = counted_realloc(v->data, new_cap * sizeof *v->data);
if (grown == NULL)
    return false;           /* v->data, v->len and v->cap unchanged */
v->data = grown;
v->cap = new_cap;
```

`new_cap * sizeof *v->data` can overflow `size_t` and wrap to a small number. Check before multiplying: `if (new_cap > SIZE_MAX / sizeof *v->data) return false`. `SIZE_MAX` comes from `<stdint.h>`.

When the block moves, every pointer into the old block dangles:

```
  len 4, cap 4
  v->data --> [ 1 | 2 | 3 | 4 ]
  saved   --> &v->data[1]

  push 5: realloc moves to a block of 8
  v->data --> [ 1 | 2 | 3 | 4 | 5 | . | . | . ]
  saved   --> old block, already freed by realloc
```

Add `counted_realloc` to `counted.h`. Write it like `counted_malloc`, and count a new block only when the pointer passed in was NULL. `realloc(NULL, n)` behaves like `malloc(n)`, so you can start from `data = NULL` and `cap = 0`.

### Study

- [Beej's Guide to C: Manual Memory Allocation](https://beej.us/guide/bgc/html/split/manual-memory-allocation.html#changing-allocated-size-with-realloc) (read, 20 min): Sections 12.5 to 12.5.2. The `readline` example in 12.5.1 grows a buffer one character at a time, and you reuse that pattern in the word counter.
- [Linux man page: malloc(3)](https://man7.org/linux/man-pages/man3/malloc.3.html) (reference, as needed): The `realloc()` and `reallocarray()` paragraphs under DESCRIPTION and the RETURN VALUE section. On the Mac, `man realloc` gives Apple's version.

### Build

Write `src/vec.c` with `struct Vec { int *data; size_t len; size_t cap; }` and `vec_init`, `bool vec_push(v, int x)`, `bool vec_pop(v, int *out)`, `bool vec_remove_at(v, size_t i)` (shift the later elements down) and `vec_free`. Capacity goes 0, 4, 8, 16.

Test:

- Pop and remove on an empty array return false.
- Pushing 4 values gives `cap` 4. The 5th gives `cap` 8 with the first 4 values intact.
- Failed growth on the 5th push returns false and leaves `data`, `len` and `cap` exactly as they were, with the counters showing one live block.
- Remove the first, a middle and the last element.
- On a test struct with `data` NULL and `len` and `cap` both set by hand to `SIZE_MAX / sizeof(int)`, a push returns false and `alloc_calls` does not change.

### Done when

All tests pass with balanced counters on the Mac and clean under ASan in the VM. Save a pointer to `data[1]`, push until the array grows, then read through the saved pointer in the VM: ASan should report heap-use-after-free if the block moved. You can explain which pointers stay valid after a push that grows the array and which do not.

## A word counter, then its assembly

This step joins everything from the chapter in one program, then shows you what the compiler made of three of your functions.

The word counter reads text from standard input, splits it into words, and counts each distinct word. A word is a run of letters as `isalpha` sees them. Digits, apostrophes and everything else separate words, so "don't" counts as "don" and "t". Words are stored lowercase. The table is a growable array of entries, and each entry owns a heap copy of its word:

```
  table.items --> [ word | count ] [ word | count ] [ word | count ] ...
                     |                 |                 |
                     v                 v                 v
                   "the\0"           "cat\0"           "dog\0"
                   (owned by the entry, freed by table_free)

  table.len = 3, table.cap = 4
```

Lookup is a linear scan over the entries. For each entry, compare the stored word with the slice byte by byte, applying `tolower` to the slice, and check that the stored word ends exactly at `len`. A word already in the table only increments its count and allocates nothing. Adding a new word costs one allocation for the copy, plus one for the array when it grows. If the array growth fails after the copy succeeded, free the copy so nothing leaks.

Reading all of standard input uses `fgetc` and the growing-buffer pattern from Beej's `readline` in the previous step. Append each character to a `char` buffer that doubles when full, stop at `EOF`, add the terminator, then hand the buffer to the table.

The second half of the step is assembly. Chapter 05 teaches you to write it. Here you only read it. Start from one function you already wrote. This is `swap_ints` compiled by clang for your Mac at `-O1`:

```
  void swap_ints(int *a, int *b)       a arrives in x0, b in x1

  _swap_ints:
      ldr  w8, [x0]        tmp = *a      load 4 bytes from the address in x0
      ldr  w9, [x1]        w9 = *b       load 4 bytes from the address in x1
      str  w9, [x0]        *a = w9       store 4 bytes to the address in x0
      str  w8, [x1]        *b = tmp      store 4 bytes to the address in x1
      ret                                jump back to the address in x30
```

Pointers are 8 bytes, so they travel in 64-bit `x` registers. Ints are 4 bytes, so they are loaded into 32-bit `w` registers. At `-O0` the same function first stores `x0` and `x1` into stack slots and reloads them before every use, because each C variable gets its own slot in memory. Dive Into Systems compiles with plain `gcc`, which means `-O0`, so its listings follow the C line by line.

Two Mac details. Function names get a leading underscore (`_swap_ints`). And `char` is signed on Apple ARM64 but unsigned on ARM64 Linux, so the byte load in `str_len` at `-O0` is `ldrsb` on the Mac and `ldrb` in the VM. Both load one byte. `ldrsb` also copies the byte's sign bit into the upper bits of the register.

Three more forms show up in the Build. `ldrb w9, [x0, x8]` loads the byte at the address `x0 + x8`, which is how clang writes `s[n]` with `n` kept in `x8`. `cbz` and `cbnz` branch when a register is zero or nonzero, which covers a NULL check and a loop that stops at the 0 byte. `bl` puts the return address in `x30` before it jumps, so a function that calls another function overwrites its own return address. Clang saves `x29`, the frame pointer, and `x30` on the stack first with an `stp` like `stp x29, x30, [sp, #-48]!` and restores both with `ldp` before `ret`.

### Study

- [Beej's Guide to C: File Input/Output](https://beej.us/guide/bgc/html/split/file-inputoutput.html) (read, 30 min): Sections 9.1 to 9.3.1. Skip formatted input and binary I/O.
- [Dive Into Systems: ARM Assembly Basics](https://diveintosystems.org/book/C9-ARM64/basics.html) (read, 3 h): Sections 9.1, 9.2, 9.3.1, all of 9.4 (9.4.1 to 9.4.3) and all of 9.5 (9.5.1 to 9.5.3). Section 9.5.3 traces the `stp x29, x30` and `ldp` pair at the start and end of `main`. Use the "Next" links. Stop before 9.6 on recursion. The book compiles with gcc on ARM64 Linux, so run its examples in your VM with `gcc -O0` and `objdump -d`.
- [Compiler Explorer](https://godbolt.org/) (do, 1 h): Pick the "armv8-a clang" compiler, which targets ARM64 Linux. Paste one function at a time and compare `-O0` with `-O1`. On the Mac, `clang -S -O1 -o - src/strings.c` shows the Apple version.

### Build

Part 1, the word counter, in `src/wordcount.c`:

- `struct WordCount { char *word; size_t count; }` and `struct WordTable { struct WordCount *items; size_t len; size_t cap; }`.
- `void table_init(struct WordTable *t)` sets everything to zero and allocates nothing.
- `bool table_add_word(struct WordTable *t, const char *start, size_t len)` adds the `len` letters at `start`, stored lowercase. It returns false for a NULL table, NULL `start` or `len` 0. Capacity goes 0, 4, 8.
- `bool table_add_text(struct WordTable *t, const char *text)` splits `text` into words and adds each one.
- `void table_free(struct WordTable *t)` frees every word and the array, zeroes the struct, and is safe to call twice or with NULL.
- `main` reads standard input into a growing buffer, calls `table_add_text`, prints one `count word` line per entry in order of first appearance, frees everything and returns 0. On allocation failure it prints a message to `stderr` and returns 1.

Include `counted.h` and use the counted allocators from the last two steps. Test:

- "The", then "THE": one entry "the" with count 2. The second add allocates nothing.
- "th", "the" and "then" are three entries.
- Adding the first 5 bytes of "hello world" stores "hello".
- `The cat. the dog; THE end 42 don't` gives the 3, cat 1, dog 1, end 1, don 1, t 1, in that order.
- "", "123 !! --", text that ends right after a word, and text that starts with spaces, tabs and newlines.
- 50000 copies of "the " give one entry with count 50000 and exactly 2 allocation calls. Build the 200 KB input string with plain `malloc` so it does not show up in the counts.
- Allocation fails on the word copy, on the first array growth (the copy must be freed), on a later growth (old entries intact) and halfway through `table_add_text` (the words before the failure stay counted).
- Counters balance after every test.

Then compare against the shell on a long text. On the Mac, `man ls | col -b > ls.txt` gives you one. Both commands below print sorted `count word` lines:

```sh
./out/Darwin-debug/wordcount < ls.txt | sort > mine.txt
LC_ALL=C tr -cs 'A-Za-z' '\n' < ls.txt | LC_ALL=C tr 'A-Z' 'a-z' \
  | grep -v '^$' | sort | uniq -c | awk '{print $1, $2}' | sort > shell.txt
diff mine.txt shell.txt
```

Part 2, the assembly. Take three functions: `swap_ints`, `str_len`, and the function in your word counter that copies a word with `malloc`. For each, get the ARM64 output at `-O0` and at `-O1`, paste the `-O1` version into a comment block above the C function, and annotate every instruction with the C it came from. In `str_len`, find the byte load, the counter increment and the branch that jumps back to the top of the loop. In the copy function, find the `bl` that calls `malloc`, the instruction that checks the result for NULL, and the `stp` that saves `x29` and `x30` before the call. Clang at `-O1` may replace your copy loop with a call to `memcpy`. If it does, find that call too. Any other `stp` and `ldp` pairs, on registers from `x19` upward, save registers your function is required to preserve. Chapter 05 explains that rule.

### Done when

All word counter tests pass with balanced counters on the Mac and clean under ASan in the VM, and `diff mine.txt shell.txt` prints nothing. For each of the three functions you have an annotated `-O1` listing, and you can point at the register each argument arrives in, the register the result leaves in, and every load, store and branch. You can say what changed between `-O0` and `-O1` for `swap_ints`.

## Where this leads

You can now write C that owns heap memory and frees it on every path, test the failure paths on purpose, read raw bytes in a debugger, and look at the instructions the compiler produced.

What you cannot yet explain is the hardware that runs those instructions. You saw `ldr`, `add` and `ret` move values between registers and memory, but you have not seen how a register, the program counter or the step from one instruction to the next is built. Chapter 03, From gates to a CPU, builds them from logic gates up to a working CPU, and then asks you to write an assembler in C. It starts away from C, in a browser-based hardware simulator, where you build every basic gate out of NAND. C comes back in its last two steps. The assembler reads a text file, splits lines into fields and keeps a symbol table, so your string functions and word table carry over.
