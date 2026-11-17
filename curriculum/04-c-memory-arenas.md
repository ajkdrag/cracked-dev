---
id: 04
title: C properly: memory, undefined behavior, arenas
part: The machine and C
weeks: 8
project: An arena-backed string, dynamic array and hash map library with a JSON parser and serializer on top that passes JSONTestSuite with no sanitizer reports.
---

Chapter 02 taught you to own heap memory one `malloc` at a time: every node and every word copy had an owner and one place where it got freed. Chapter 03 built a CPU from gates and ended with an assembler in C that reads text, splits it into fields and keeps a symbol table. You can write working C now. This chapter replaces one `malloc` per object with arenas, and checks your code against the rules of the C language.

You build a small library in one file: an arena allocator, a string type that carries its length, a dynamic array, a hash map and a buffered writer. On top of it you write a JSON parser and serializer. The finished parser gives the right answer on every file of JSONTestSuite, survives a fuzzer and runs clean under the sanitizers. Each program calls `malloc` once and `free` once, both in `main`.

The first three steps come before the library. They cover what C values look like as bits and what the compiler assumes about your code. The arena does exact arithmetic on sizes and addresses, so integers come first. Floats are the other kind of number C keeps as bits, and the parser meets them again. Undefined behavior comes third, because it explains how a check you wrote can disappear from the program.

The chapter comes now because chapter 05 reads the machine code clang makes from C. Much of what you see there, such as sign extension, deleted overflow checks and structs returned in registers, follows from the rules in this chapter.

## Integers: widths, conversions and overflow

The arena of step 4 computes sizes and addresses, and C converts between integer types without telling you. This step makes those conversions visible before you rely on them.

Your ALU in chapter 03 added 16-bit **two's complement** numbers, where the top bit counts as minus its usual weight. In 8 bits the top bit is worth -128 instead of 128. In C the same bits come with a **type**, and the type decides how the bits are read. On x86-64 Linux:

- `int` is 32 bits. `long` and every pointer are 64 bits.
- `<stdint.h>` names exact widths: `int8_t` to `int64_t` for signed numbers, `uint8_t` to `uint64_t` for unsigned ones, and `uintptr_t`, an unsigned integer wide enough to hold an address.
- `<stddef.h>` names `size_t`, the unsigned type that `sizeof` gives, and `ptrdiff_t`, the signed type of the difference of two pointers. Both are 64 bits.
- Plain `char` is signed on x86-64. On ARM64 Linux, which chapter 05 runs in an emulator, it is unsigned. The library in this chapter stores bytes as `uint8_t`, which is unsigned everywhere.

A **conversion** turns a value of one type into another type. Going to a narrower type keeps only the low bits. Going to a wider type from a signed one copies the sign bit into every new high bit, which is called **sign extension**. Going wider from an unsigned type fills the new bits with zeros.

![One byte holding 11001000 reads as 200 in a uint8_t and as -56 in an int8_t. Widened to 32 bits, the int8_t copies its sign bit and the uint8_t fills with zeros.](figures/04-twos-complement.svg)

Three rules cause most integer surprises:

1. Unsigned arithmetic **wraps**: it is done modulo 2 to the power of the width, so `UINT32_MAX + 1`, one more than the largest `uint32_t`, is 0. That is defined behavior. Signed overflow is undefined behavior, as chapter 01 showed, and step 3 shows what the compiler does with it.
2. Before arithmetic, a value of a type narrower than `int` is **promoted** to `int`. A `uint16_t` holding 65535, plus 1, gives the `int` 65536, not 0.
3. When a signed and an unsigned operand of the same width meet, the signed one is converted to unsigned.

Rule 3 makes `-1 < 0u` false. `0u` is an `unsigned int`, so -1 is converted to 4294967295 first, and 4294967295 is not less than 0. clang gives no warning for that line, even with every flag in `build.sh`. The same rule turns `size_t` arithmetic near zero into huge numbers: with `size_t n = 0`, `n - 1` is 18446744073709551615.

> **Practice:** Use the signed `ptrdiff_t` for sizes, lengths and counts, as Chris Wellons does in the posts you read from step 4 on. A mistake then gives a negative number that an `assert` catches, instead of a huge positive one.

The second half of the step is bit operations. The arena rounds an address up to the next multiple of an **alignment**, a power of two such as 8. For a power of two `align`, `addr & (align - 1)` keeps the low bits of `addr`, which is how far `addr` is past the last multiple. `-addr & (align - 1)` is how far it is to the next one:

```
  align = 8, addr = 0x1003
  addr  & 7  = 3     bytes past 0x1000
  -addr & 7  = 5     bytes to 0x1008
```

`-addr` on an unsigned value is defined, because unsigned arithmetic wraps.

Alignment matters because the hardware expects it. A CPU reads an 8-byte value in one step from an address that is a multiple of 8, and some instructions refuse any other address: the atomic operations of chapter 09 and some of the SIMD loads of chapter 07. C makes a read through a misaligned pointer undefined, and UBSan reports it as a "misaligned address".

### Study

- [Dive Into Systems: Signed Binary Integers](https://diveintosystems.org/book/C4-Binary/signed.html) (read, 45 min): Section 4.3, including Negation and Sign Extension, then 4.5 Integer Overflow (`overflow.html`) and 4.6 Bitwise Operators (`bitwise.html`), each one link further in the contents list. Skip 4.4 on binary arithmetic, which the adders of chapter 03 already covered.
- [Beej's Guide to C: Numeric Conversions](https://beej.us/guide/bgc/html/split/types-iii-conversions.html#numeric-conversions) (read, 20 min): Sections 15.3 to 15.5.1. Skip 15.1 and 15.2 on strings and chars.
- [C11 final draft, N1570](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf) (reference, as needed): The C language standard. Look up a rule here when a prediction below goes wrong: 6.3.1.1 (integer promotions), 6.3.1.3 (signed and unsigned conversions), 6.3.1.8 (usual arithmetic conversions), 6.2.5 paragraph 9 (unsigned wraparound), 6.2.5 paragraph 15 (whether `char` is signed), 6.5.5 (multiplication and division, where division truncates toward zero) and 6.5.7 (shifts). Annex J.2 lists every undefined behavior, and step 3 uses it.

### Build

Part 1, predictions.

1. In `src/predict.c`, print each expression below with `printf`. `%d` prints an `int`, `%u` an `unsigned int` and `%zu` a `size_t`. Before you run it, write your predicted value and its type in a comment next to each line.
   - `-1 < 0u`
   - `(unsigned)-1`
   - `(uint8_t)300`, `(int8_t)200` and `(char)200`
   - `a + 1` where `uint16_t a = 65535`
   - `b + 1` where `uint32_t b = UINT32_MAX`
   - `-7 / 2` and `-7 % 2`
   - `-8 >> 1`
   - `sizeof(int) - 5`
2. Build it with `sh build.sh predict` and run it. For each wrong prediction, find the rule in N1570 that produced the real value.
3. Save this loop inside a `main` in `src/countdown.c`, with `#include <stddef.h>` and `#include <stdio.h>` at the top, then build and run it:

   ```c
   size_t n = 0;
   for (size_t i = n - 1; i >= 0; i--) {
       printf("%zu\n", i);
       break;
   }
   ```

4. Add `-Wtype-limits` to the `warn` line of `build.sh` and to the warning flags in `tests/run_test.sh`. It warns about a comparison that is always true or always false because of the range of its type. Build `countdown` again.

Part 2, bit functions. Write `src/bits.c` and `tests/bits_test.c` in the test pattern from chapter 02, and run them with `sh tests/run_test.sh bits`:

1. `bool is_pow2(uint32_t x)`. Test 0, 1, 2, 3, 64, `0x80000000` and `UINT32_MAX`.
2. `uint32_t get_byte(uint32_t x, int n)` returns byte `n`, where byte 0 is the lowest. Test `0x12345678` for `n` from 0 to 3.
3. `int popcount32(uint32_t x)` counts the bits that are 1. Test 0, 1, `0xFF`, `UINT32_MAX` and `0x80000001`.
4. `uintptr_t align_padding(uintptr_t addr, uintptr_t align)` with the `-addr & (align - 1)` expression. Compare it with `(align - addr % align) % align` for every `addr` from 0 to 255 and every `align` in 1, 2, 4, ..., 128.
5. `int32_t sign_extend(uint32_t x, int bits)` reads the low `bits` bits of `x` as a two's complement number. `sign_extend(0xFF, 8)` is -1, `sign_extend(0x7F, 8)` is 127 and `sign_extend(0x80, 8)` is -128. Do the bit work on `uint32_t`. The last step, converting a value above `INT32_MAX` to `int32_t`, is **implementation-defined**: the standard lets each compiler choose the result and makes it document the choice. clang wraps.
6. `bool add_i32(int32_t a, int32_t b, int32_t *out)` returns false on overflow and never performs an addition that overflows. Check against the limits before you add. Test every pair from {`INT32_MIN`, `INT32_MIN + 1`, -2, -1, 0, 1, 2, `INT32_MAX - 1`, `INT32_MAX`} against the sum computed in `int64_t`.
7. `bool mul_size(ptrdiff_t count, ptrdiff_t size, ptrdiff_t *out)`, for `count >= 0` and `size > 0`, returns false when the product would exceed `PTRDIFF_MAX`. Test `count` 0, 1, `PTRDIFF_MAX / 8` and `PTRDIFF_MAX / 8 + 1` with `size` 8.

### Done when

The bits tests pass with no sanitizer report. For every prediction that was wrong, you can name the rule that produced the real value and its section number in N1570. `countdown` built without a warning and printed 18446744073709551615, and with `-Wtype-limits` the build stops with an error. You can say why `i >= 0` is always true.

## Floats: the bits of float and double

The parser of this chapter keeps JSON numbers as text, so this step is mostly for later chapters: chapters 07, 20 and 21 compute with floats all the time. It also explains why the parser keeps the text. Floats are the second way C keeps numbers as bits, and this step shows what `float` and `double` can hold exactly and what they round.

A `float` is 32 bits in three **fields**: a sign bit, an 8-bit **exponent** and a 23-bit **fraction**. For a normal float the value is the fraction with a 1 in front of the **binary point**, the point between the whole bits and the fractional bits, like a decimal point, times 2 to the power of the exponent minus 127, negated if the sign bit is 1. That leading 1 is not stored, so it is called the **implied 1**. The 127 is called the **bias**. It lets the 8 exponent bits stand for powers from -126 to 127.

![The float 0.15625 is 0x3E200000: sign 0, exponent 124, fraction 01 followed by zeros. That is 1.25 times 2 to the -3.](figures/04-float-fields.svg)

Two exponent values are special:

- All zeros: the number is zero or **subnormal**, a tiny value with no implied 1 in front.
- All ones: infinity when the fraction is 0, and **NaN**, "not a number", otherwise.

A `double` is 64 bits with an 11-bit exponent (bias 1023) and a 52-bit fraction. With the implied 1 that makes 53 significant bits. A `double` holds every integer up to 2 to the 53rd power exactly, and above that only every second integer, then every fourth. JSON files often hold 64-bit IDs, which matters in step 9.

To read the bits of a float, copy them into a `uint32_t` with `memcpy`. Reading a float through a `uint32_t *` breaks C's type rules, and step 3 shows what the optimizer does with that. The copy costs nothing. At `-O1`, clang compiles a 4-byte `memcpy` from a `float` into a `uint32_t` to one instruction, `movd %xmm0, %eax`. `xmm0` is one of the registers x86-64 uses for floating point values, and a `float` argument arrives in it.

Two `printf` formats show doubles exactly:

- `%.17g` prints 17 significant digits, enough to tell any two doubles apart.
- `%a` prints the exact value in hexadecimal, with no decimal rounding. `0x1.8p+1` means hex 1.8, which is 1.5, times 2 to the 1st, so 3.

### Study

- [Bartosz Ciechanowski: Exposing Floating Point](https://ciechanow.ski/exposing-floating-point/) (read, 75 min): From the start through "Raw Integer Value", then "Double" under Other Types, all of "Conversions", and "Hexadecimal Form" under Printing. Skip "Half", "Larger Types" and "Exact Decimal Representation". Flip bits in the interactive figures until you can predict the value before it changes.
- [Beej's C Library Reference: strtod()](https://beej.us/guide/bgclr/html/split/stdlib.html#man-strtod) (reference, as needed): Section 24.4, the function that turns text into a `double`. Step 9 uses it with `errno`, which the Return Value paragraph explains.

### Build

Write `src/floats.c` and `tests/floats_test.c`:

1. `uint32_t f32_bits(float f)` and `float f32_from_bits(uint32_t u)` with `memcpy`.
2. `void f32_show(float f)` prints the bits in hex, the sign, the exponent minus the bias, the fraction in hex, and a class: zero, subnormal, normal, infinity or NaN. Before running it, write down the bits you expect for `1.0f`, `-2.0f` and `0.5f`. Then show `0.1f`, `-0.0f`, the smallest subnormal (`f32_from_bits(1)`), `FLT_MAX` from `<float.h>`, and `INFINITY` and `NAN` from `<math.h>`.
3. `uint32_t f32_twice(uint32_t bits)` returns the bits of twice the float, using only integer operations on `bits`. Handle zero, subnormals (shift the fraction left), normals (add 1 to the exponent), overflow to infinity, infinity and NaN.
4. Test `f32_twice` against `f32_bits(2.0f * f32_from_bits(u))` for every one of the 2 to the 32nd bit patterns. Where the input is a NaN, only require the output to be a NaN. A loop with `u <= UINT32_MAX` never ends, and clang does not warn about it. Use `do { ... } while (++u != 0);` instead, which stops when `u` wraps to 0.
5. The full loop takes about 7 seconds without sanitizers and far longer with them, so build this test by hand with the release flags from `build.sh`. Run `mkdir -p out/Linux-release` first in case you have not built a release binary yet, then `clang -std=gnu11 -O2 -DNDEBUG -o out/Linux-release/floats_test tests/floats_test.c`, then run `./out/Linux-release/floats_test`.
6. Print `9007199254740993.0` and `(double)INT64_MAX` with `%.17g`, and `0.1 + 0.2` and `0.3` with `%a`.

### Done when

`f32_twice` matches the hardware on every bit pattern. Your hand-written bits for `1.0f`, `-2.0f` and `0.5f` match `f32_show`. You can explain why `9007199254740993.0` prints as `9007199254740992`, using the `%.17g` lines, and why `0.1 + 0.2 == 0.3` is false, using the `%a` lines.

## Undefined behavior: what the compiler assumes

Chapter 01 showed **undefined behavior** as a bug the sanitizer catches: an `int` that overflowed. The debug build stops there with a report. The release build has no sanitizers, and its optimizer does something else with the same code. This step shows what.

The optimizer assumes undefined behavior never happens and changes your code on that assumption:

- A check that can only be true after a signed overflow is deleted.
- Two pointers of different types are assumed not to point at the same bytes. This is the **strict aliasing** rule.
- A pointer that was already read through is assumed not to be null, so a later null check is deleted.

At `-O0` clang makes few of these changes, so a program can pass every debug test and still break in the release build.

UBSan only checks code that runs, and it does not check every rule. It never sees aliasing violations or reads of a variable that was never set. clang has one more sanitizer for that second case. **MemorySanitizer**, MSan for short, reports every read of an uninitialized value. It cannot run in the same program as ASan, so build with `SAN=memory sh build.sh name`, using the `SAN` variable of chapter 01's `build.sh`, and go back to plain `sh build.sh name` afterwards.

Annex J.2 of N1570, from step 1, lists every undefined behavior in C11. You do not need to memorize it. Look a line up there when you suspect it.

The program below uses three small pieces of C you have not written yet. `static` before a function makes it private to this file, so the compiler can see every caller. `atoi(s)` from `<stdlib.h>` turns the text of a number into an `int`. `c ? a : b` is the conditional operator, an `if` inside an expression: it gives `a` when `c` is true and `b` otherwise.

### Study

- [Chris Lattner: What Every C Programmer Should Know About Undefined Behavior #1/3](https://blog.llvm.org/2011/05/what-every-c-programmer-should-know.html) (read, 20 min): The whole post. Its list of undefined behaviors (uninitialized variables, signed overflow, oversized shifts, wild pointers, null dereferences, type rule violations) is the list this step tests, except wild pointers, which your ASan runs in chapter 01 already showed. Case 5, a `double` converted to an `int` that cannot hold it, is not in the post. Annex J.2 lists it.
- [Chris Lattner: What Every C Programmer Should Know About Undefined Behavior #2/3](https://blog.llvm.org/2011/05/what-every-c-programmer-should-know_14.html) (read, 20 min): Read up to the section "There is No Reliable Way to Determine if a Large Codebase Contains Undefined Behavior" and skip that section, whose tool list predates UBSan, which you already use. Skip part 3.

### Build

Save this as `src/ub.c`. Each function looks reasonable and has undefined behavior for one input:

```c
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>

static int always_bigger(int a) { return a + 1 > a; }
static int alias(int *i, float *f) { *i = 1; *f = 0.0f; return *i; }
static int bad_check(int size) { if (size > size + 1) return -1; return size + 1; }
static unsigned shift(unsigned x, int n) { return x << n; }
static int to_int(double d) { return (int)d; }
static void set_if(int *x, int n) { if (n > 0) *x = n; }
static int pick(int n) { int x; set_if(&x, n); return x * 2; }
static int deref(int *p) { int v = *p; if (!p) return -1; return v; }

int main(int argc, char **argv) {
    int which = argc > 1 ? atoi(argv[1]) : 0;
    int n = argc > 2 ? atoi(argv[2]) : 32;
    if (which == 1) printf("%d\n", always_bigger(INT_MAX));
    if (which == 2) { int x = 0; printf("%d\n", alias(&x, (float *)&x)); }
    if (which == 3) printf("%d\n", bad_check(INT_MAX));
    if (which == 4) printf("%u\n", shift(1u, n));
    if (which == 5) printf("%d\n", to_int(3e9 + n));
    if (which == 6) printf("%d\n", pick(n - 32));
    if (which == 7) printf("%d\n", deref(n == 32 ? NULL : &n));
    return 0;
}
```

`./out/Linux-debug/ub 4` runs case 4. A second number replaces `n`, which is 32 by default. Case 6 hides the uninitialized `x` behind `set_if`, because clang refuses `int x; if (n > 0) x = n; return x * 2;` written in one function with a `-Wsometimes-uninitialized` error.

1. Build the debug and the release version. Run cases 1 to 7 in both, and record each in a table: case, debug output or UBSan report, release output.
2. Build with `SAN=memory sh build.sh ub` and run case 6. Read MSan's report, then rebuild with `sh build.sh ub`.
3. Copy `always_bigger`, `bad_check` and `deref` without `static` into `src/ub_asm.c`. At `-O2` clang copies the `static` functions of `ub.c` into `main`, and the copies are hard to find. Read `clang -O2 -S -o - src/ub_asm.c` and find the comparison or check that is missing from each function. Then read `clang -O0 -S -o - src/ub_asm.c` for `always_bigger` and find the comparison there.
4. For case 2, explain from Lattner's first post why the release build prints 1 and the debug build prints 0, and why UBSan said nothing. For case 7, explain why the release build printed 32 instead of crashing.
5. Write a fixed version of each function in `src/ub_fixed.c`:
   - `always_bigger` compares against `INT_MAX` first.
   - `bad_check` tests `size == INT_MAX`.
   - `alias` does not read one object through two pointer types.
   - `shift` returns 0 for `n < 0 || n >= 32`.
   - `to_int` returns 0 for NaN and clamps everything else to the `int` range before converting.
   - `pick` gives `x` a value before the call.
   - `deref` checks `p` before it reads through it.
6. `-fwrapv` tells clang that signed overflow wraps, as unsigned arithmetic does. Build `clang -std=gnu11 -O2 -fwrapv -o out/Linux-release/ub_wrapv src/ub.c` and run cases 1 and 3 again.

On a working machine MSan's report for case 6 starts with `WARNING: MemorySanitizer: use-of-uninitialized-value` and names `pick`.

> **If it fails:** If the MSan build of item 2 stops at startup with an error about an unexpected memory mapping instead of running case 6, try the `vm.mmap_rnd_bits` fix from chapter 01. If that does not help, skip item 2. The report quoted above is what it would show.

### Done when

Your table has all seven cases in both builds. The fixed versions print the same values in debug and release builds, with no UBSan report and no MSan report. You can point at the instruction in the `-O2` output of `always_bigger` that replaced the comparison, and at the load in `deref` that is all that is left of it. You can name the Annex J.2 entry for each of the seven cases, and say what `-fwrapv` changed in cases 1 and 3.

## An arena allocator

In chapter 02, every list node had its own `malloc` and its own `free`. That works, and it scales badly. Most objects in a real program die in groups: everything built while parsing one file, everything used for one request, everything allocated during one function call.

An **arena** allocates a group from one big block and frees the whole group at once. It is two pointers: `beg`, the first free byte, and `end`, one past the last byte of the block. An allocation moves `beg` forward. Freeing everything means moving `beg` back, or dropping the arena.

![An arena over one block: a char at offset 0, seven bytes of padding, an int64_t at offsets 8 to 15, and beg at offset 16, where the free part runs to end.](figures/04-arena.svg)

Every allocation first pads `beg` up to the alignment of the type, with the `-addr & (align - 1)` expression from step 1. `_Alignof(T)` gives that alignment: 1 for a `char`, 8 for an `int64_t`. `new` is a **function-like macro**, a `#define` that takes arguments. It passes `sizeof(T)` and `_Alignof(T)` for you, so the rest of the program never writes a size by hand.

Before it returns, `alloc` sets every byte it hands out to zero with `memset(p, 0, n)`, which writes `n` zero bytes at `p` and comes from `<string.h>`. A fresh struct from the arena then has every pointer null and every count 0.

> **Practice:** Design every type so that all zero bytes is a valid empty value. An empty `Str`, an empty dynamic array, an empty hash map and an empty JSON array then need no setup function, and every later step relies on it.

Fleury's article explains the lifetime model: a function receives the arena that its results should live in. Wellons' article turns that into about fifteen lines of C, with two conventions that every later step uses:

- A **permanent** arena is passed by pointer. What the function allocates there outlives the call, because the caller's `beg` moves.
- A **scratch** arena is passed by value. The function gets its own copy of the two pointers, so everything it allocates is free again when it returns.

![perm_user receives the caller's arena by pointer and moves the caller's beg. scratch_user receives a copy and moves only the copy, so the caller's beg stays where it was.](figures/04-scratch.svg)

When the block runs out, `alloc` calls `abort`, which stops the program with the signal `SIGABRT`. A **signal** is a message the kernel sends to a process. `SIGABRT` tells it to stop, and gdb catches it. A caller that can handle failure passes the `SOFTFAIL` flag and gets a null pointer instead.

Wellons names his types with `typedef`. `typedef struct { char *beg; char *end; } Arena;` declares a struct with no **tag**, the name that usually follows `struct`, and gives it the name `Arena`. You write `Arena` where chapter 02 wrote `struct Node`. A struct that points to its own type needs a tag, and step 7 shows that case.

The block itself comes from one `malloc` in `main`. Chapter 02's memory map showed small `malloc` blocks in `[heap]`. glibc serves a block of 128 KB or more from a **mapping** of its own, a region it asks the kernel for with `mmap`, which chapter 08 covers. So the 256 MB arena blocks of later steps sit next to the shared libraries, not in `[heap]`.

To ASan the arena block is one big `malloc` block. It cannot tell when you read past the end of one arena object into the next, or read an object after its scratch arena returned. Step 5 shows how to tell it.

> **Practice:** Add a function to the library only when a program needs it, and move code into `base.c` only after a second program uses it.

### Study

- [Ryan Fleury: Untangling Lifetimes: The Arena Allocator](https://www.dgtlgrove.com/p/untangling-lifetimes-the-arena-allocator) (read, 45 min): From the start through "Arena Parameterization". Skim "Generating Inconvenient Code: RAII" and "The Enforcement Bureaucracy: Garbage Collection", which compare arenas with RAII in C++ and with the garbage collection that Python uses. Neither is needed for this chapter. Skip "Composition With More Complex Allocators", the survey of specializations and "Implementation Notes". The notes reserve virtual address space, which chapter 08 explains.
- [Chris Wellons: Arena allocator tips and tricks](https://nullprogram.com/blog/2023/09/27/) (read, 30 min): The example at the top, then "An arena implementation", "The new macro" and "Arena size and growth". Skip "Enhance alloc with attributes", whose June 2024 update says `alloc_size` is broken, and "Pointer laundering". Keep `abort` as the failure policy and ignore the `longjmp` variant.
- [Beej's Guide to C: Macros with Arguments](https://beej.us/guide/bgc/html/split/the-c-preprocessor.html#macros-with-arguments) (read, 15 min): Sections 19.5.1 and 19.5.2. The rest of 19.5 is not needed.

### Build

1. Start `src/base.c`. Every function in it is `static`, private to the file, as in step 3. Programs `#include` it, so clang still compiles each program from one file, as in chapter 01. clang warns about a private function that nobody calls, because no other file could call it either. A program calls only some of the library's functions, so under `-Werror` every unused one is an error. Add `-Wno-unused-function` to the `warn` line of `build.sh` and to the warning flags in `tests/run_test.sh`. It turns off that one warning.
2. Add `typedef struct { char *beg; char *end; } Arena;` and `void *alloc(Arena *a, ptrdiff_t size, ptrdiff_t align, ptrdiff_t count, int flags)` as in Wellons' post, with a `SOFTFAIL` flag. Add asserts that `size > 0`, `count >= 0` and `align` is a power of two. Wellons' version does not check for a negative count.
3. Add `#define new(a, t, n) (t *)alloc(a, sizeof(t), _Alignof(t), n, 0)`. The posts of steps 6 and 7 call `new(perm, T)` with two arguments. Keep this three-argument macro and write the count 1 yourself when you copy their code.
4. Write `tests/base_test.c` and run it with `sh tests/run_test.sh base`. Take every test block from `malloc`, which returns addresses that are multiples of 16, and `free` it at the end.
   - Fill a 4096-byte block with `0xAA` before making an arena from it. Every allocation reads back as zero.
   - `new(&a, char, 1)` followed by `new(&a, int64_t, 1)`: the second pointer is a multiple of 8, and `beg` moved 16 bytes in total. An allocation with alignment 64 lands on a multiple of 64.
   - Exact fit: a 64-byte arena gives one allocation of 64 chars. One more char with `SOFTFAIL` returns 0 and leaves `beg` unchanged.
   - A count of 0 uses no bytes when `beg` is already aligned.
   - A count of `PTRDIFF_MAX` with size 8 and `SOFTFAIL` returns 0.
   - `ptrdiff_t scratch_user(Arena scratch)` allocates 1000 bytes and returns how far its copy of `beg` moved. After the call, the caller's `beg` has not moved. `void perm_user(Arena *perm)` allocates 1000 bytes, and afterwards the caller's `beg` has moved by at least 1000.
5. Without `SOFTFAIL`, a count of `PTRDIFF_MAX` aborts. Make the test run that case only when it gets an argument. Write `int main(int argc, char **argv)`, put `(void)argv;` on its first line, and test `if (argc > 1)`. The `(void)` cast tells clang that leaving `argv` unused is deliberate. Without it `-Wextra` reports an unused parameter, which `-Werror` turns into an error. Run it in gdb with `ASAN_OPTIONS=detect_leaks=0 gdb --args ./out/Linux-debug/base_test abort`. `--args` passes the rest of the line to the program as its arguments, here the word `abort`. gdb stops on the `SIGABRT`. Type `bt`.
6. Copy `src/regions.c` from chapter 02 and add a 256 MB block: `char *big = malloc((size_t)1 << 28);`, printed with `%p` and freed at the end. Build it without sanitizers as in chapter 02, break before the `free` calls, and find the block's line in `info proc mappings`.

### Done when

All tests pass with no sanitizer report. `grep -nw 'malloc\|free' src/base.c` prints nothing. Keep the two words out of your comments in this chapter's files, so that this check and the later ones only find code. `bt` shows `alloc` called from your test. You can explain why `scratch_user` cannot hand its allocations back to its caller. The 256 MB block lies in a line of `info proc mappings` with no name and a size a little over 0x10000000, outside `[heap]`, and you can say why.

## Strings that carry their length

The arena gives the library a place to put things. The first type built on it replaces the C string. A C string ends with a zero byte, and you saw the cost in chapter 02: every length is a walk with `strlen`, every copy needs room for the terminator, and a piece of a string cannot exist without a copy.

Wellons replaces it with a pointer and a length, passed by value: `typedef struct { uint8_t *data; ptrdiff_t len; } Str;`. A **slice** of a `Str` is a new pointer and length into the same bytes, and it copies nothing.

![s points at the 11 bytes of hello world. t, the slice from 6 to 11, points at the w inside the same bytes and has length 5.](figures/04-str-slice.svg)

Two strings are equal when their lengths match and their bytes match. A `Str` can contain zero bytes, which JSON strings need. When a C library function wants a terminated string, you make a terminated copy in an arena.

Wellons also returns structs instead of writing through out-parameters. A parse function returns `{value, ok}` in one struct, and the caller checks `ok`. That shape repeats in every later step. The `S("...")` macro builds a `Str` from a string literal with a **compound literal**, a struct value written inline as `(Str){pointer, length}`.

`memcmp` and `memcpy` require valid pointers even when the length is 0, and an empty `Str` usually has a null `data`. glibc marks their pointer arguments as never null, so UBSan reports the call. Skip the call when the length is 0.

A `Str` owns nothing. Its bytes belong to whatever holds them: a string literal, the input buffer, or an arena. That makes one bug easy to write: a function makes a `Str` in its scratch arena and returns it. The bytes are free again once the function returns, and the next allocation overwrites them. ASan cannot see this, because the bytes are inside the one block it knows about.

ASan has a way to learn about it. **Poisoning** marks bytes as off limits, and a read of a poisoned byte stops the program with a `use-after-poison` report. `ASAN_POISON_MEMORY_REGION(addr, size)` and `ASAN_UNPOISON_MEMORY_REGION(addr, size)` from `<sanitizer/asan_interface.h>` do the marking. In a build without ASan they do nothing. The plan:

1. Poison the whole block when you make an arena from it.
2. In `alloc`, unpoison exactly the bytes it hands out.
3. After a call that used a scratch copy, poison the free part of the caller's arena again.

![The arena block in three states: all poisoned when the arena is made, A and B usable after two allocations, and after a call that used a scratch copy, the bytes of its object C poisoned again while beg stays after B.](figures/04-poison.svg)

### Study

- [Chris Wellons: My personal C coding style as of late 2023](https://nullprogram.com/blog/2023/10/08/) (read, 30 min): "Primitive types", "Macros", "Strings" and "More structures". Skim "Parameters and functions". Skip "Odds and ends". Follow him in dropping `const`, which the code in this chapter does. Do not adopt his short type names: this chapter writes `ptrdiff_t`, `uint8_t` and `int32_t` in full.
- [Beej's Guide to C: Compound Literals](https://beej.us/guide/bgc/html/split/types-part-v-compound-literals-and-generic-selections.html#compound-literals) (read, 10 min): Sections 32.1 to 32.1.2. Stop before 32.2 Generic Selections.
- [AddressSanitizer: Manual Poisoning](https://github.com/google/sanitizers/wiki/AddressSanitizerManualPoisoning) (reference, as needed): The sanitizer project's page on the two macros. It describes the same plan for custom allocators, and notes that a poisoned region may be a little smaller than you asked for.

### Build

Add to `src/base.c`:

1. `typedef struct { uint8_t *data; ptrdiff_t len; } Str;` and `#define S(s) (Str){(uint8_t *)s, (ptrdiff_t)sizeof(s) - 1}`, for string literals only.
2. `bool str_equals(Str a, Str b)`. Compare the lengths first. Then add `if (a.len == 0) return true;` before the `memcmp`, because two empty strings with null `data` have equal lengths.
3. `Str str_slice(Str s, ptrdiff_t beg, ptrdiff_t end)`, which asserts `0 <= beg <= end <= s.len`.
4. `typedef struct { Str head; Str tail; bool ok; } Cut;` and `Cut str_cut(Str s, uint8_t c)`, which splits at the first `c`. Without a `c`, `head` is all of `s` and `ok` is false.
5. `Str str_trim(Str s)`, which removes spaces, tabs, `\n` and `\r` from both ends.
6. `Str str_clone(Arena *a, Str s)`, `Str str_concat(Arena *a, Str x, Str y)` and `char *str_cstr(Arena *a, Str s)`, which returns a zero-terminated copy.
7. `typedef struct { int64_t value; bool ok; } I64Parsed;` and `I64Parsed str_parse_i64(Str s)`. It accepts an optional `-` followed by decimal digits and nothing else, and it never overflows. Check against the limit before each multiply and add, as `add_i32` did in step 1. The negative range is one larger than the positive range, so accumulate as a negative number and negate at the end for positive input. Then `-9223372036854775808` needs no special case.
8. Poisoning: `#include <sanitizer/asan_interface.h>`, and write `void arena_poison_free(Arena a)`, which poisons the bytes from `a.beg` to `a.end`. Call it right after you make an arena from a block. In `alloc`, unpoison the bytes you hand out before the `memset` that zeroes them.

Tests in `tests/str_test.c`:

- `str_equals` on two empty strings with `data` 0, an empty string against `S("")`, `S("a")` against `S("b")`, and two equal strings at different addresses.
- `str_slice` of `S("hello world")` from 6 to 11 equals `S("world")`, and its `data` points into the original.
- `str_cut(S("key=value"), '=')`, `str_cut(S("=x"), '=')` and `str_cut(S("none"), '=')`.
- `str_trim` on `S("")`, `S("  \t ")` and `S("\n a b \r")`.
- `str_cstr` of a slice from the middle of a string gives the right `strlen`.
- `str_parse_i64` accepts `0`, `-0`, `42`, `9223372036854775807` and `-9223372036854775808`. It rejects `""`, `"-"`, `"+1"`, `"12a"`, `"9223372036854775808"` and `"-9223372036854775809"`.
- The scratch bug, on purpose: `Str make_temp(Arena scratch)` returns `str_clone(&scratch, S("temporary"))`. The caller reads `t.data[0]` after the call. Run it once as it is, then once with `arena_poison_free(a)` on the caller's arena between the call and the read. Make the second version run only when the test gets an argument, as in step 4.

### Done when

All tests pass under ASan and UBSan. Remove the empty-string guard from `str_equals` and confirm that UBSan reports "null pointer passed as argument 1, which is declared to never be null", then put the guard back. The scratch bug runs silently without the extra `arena_poison_free` and stops with `use-after-poison` on the read with it. You can say, for each `Str` in your tests, which object owns its bytes.

## A dynamic array in the arena

The parser will need lists that grow while it reads: the elements of an array, the members of an object. This step builds a growable array on the arena.

Chapter 02's growable array used `realloc`. An arena cannot resize an object in the middle of its block, so Wellons' version allocates a block twice as large and copies the elements over. The old block stays in the arena until the arena is reset. Old copies of the slice header still point at the old block and still work, and nothing points into freed memory. Any struct with `data`, `len` and `cap` fields in that order works with one `push` macro.

![Three pushes into an empty int32s: the first push allocates a block of 2, the third allocates a block of 4 and copies 1 and 2 into it. The block of 2 stays behind, followed by 8 bytes of padding, because grow starts every block on a multiple of 16.](figures/04-push-grow.svg)

`push` evaluates to a pointer to the new element, so `*push(&v, &a) = 3;` appends 3. The macro uses the conditional operator from step 3 to call `grow` only when the array is full. A zero-initialized slice is an empty array, as the Practice of step 4 asked.

### Study

- [Chris Wellons: A simple, arena-backed, generic dynamic array for C](https://nullprogram.com/blog/2023/10/05/) (read, 25 min): All of it up to the addendum, and skip the addendum, whose in-place growth changes the test numbers below. Use the macro with the fixed alignment of 16. The patch that passes `_Alignof(*(s)->data)` uses a GNU extension that clang rejects under `-Werror`. Skip the statement expression variant.

### Build

Add to `src/base.c`:

1. `push` and `grow` from the post. His `grow` calls `alloc` with four arguments. Add the `0` flags argument.

Tests, in `tests/base_test.c`:

- Push 100 values into a zero-initialized slice: `len` 100, `cap` 128, values intact.
- Start a slice on a static array of 2 elements, as in Wellons' `fibonacci`, push one more value, and check that the static array is unchanged.
- Copy a slice header, push into the copy until it grows, and check that the original header still reads its old values.
- Push 1000 values inside a scoped copy of the arena, then check that the outer arena's `beg` has not moved.

### Done when

The tests pass with no sanitizer report. You can say which old blocks are still in the arena after the 100-value push test and how many bytes they take, padding included.

## A hash trie and word counting

The parser also needs to find an object's member by name. This step builds a hash map on the arena and uses it to rebuild chapter 02's word counter.

Wellons' hash map is a **hash trie**. Each node holds a key, a value and four child pointers. A **hash** is a number computed from the key's bytes, the same every time for the same key and scattered for different keys. The top two bits of the hash pick a child of the root, the next two bits a child of that node, and so on. A new key goes into the first empty child slot on its path.

The trie never resizes, so it fits an arena, and a null pointer is an empty map. One function, `upsert`, both finds and inserts. Called with a null arena, it only looks up.

![Looking up dog: its hash starts with the bits 10, so the search goes to child 2 of the root, then the next bits 01 lead to child 1 of cat, where dog is.](figures/04-hash-trie.svg)

A trie node points to its own type, so it needs a struct tag. Wellons' `typedef struct { strset *child[4]; str key; } strset;` does not compile, because `strset` is not a name yet inside the braces. Declare the name first:

```c
typedef struct Trie Trie;
struct Trie { Trie *child[4]; Str key; ptrdiff_t value; };
```

The word counter reads all of standard input at once. To do that, unpoison the arena's free space, call `fread` once into it, move `beg` past the bytes read, and poison the rest again. If `fread` filled the whole free space, the input was too large.

Give the command-line programs of this chapter, `wordcount2` and later `jsoncheck`, a 256 MB arena block. As step 4 showed, a block that large gets a mapping of its own. The kernel backs each **page** of it, a 4 KB piece, with real memory only when the program first touches that page, so the untouched part costs nothing. When a program aborts inside `alloc`, run it in gdb and read `bt` before you look for a bug in your code. The fix for an out-of-memory abort is a larger block or a smaller input.

### Study

- [Chris Wellons: An easy-to-implement, arena-friendly hash map](https://nullprogram.com/blog/2023/09/30/) (read, 30 min): From the start through "Fleshing it out". Stop before "Relative pointers?". "As a concurrent hash map" needs the atomics of chapter 09.
- [Beej's C Library Reference: fread()](https://beej.us/guide/bgclr/html/split/stdio.html#man-fread) (reference, as needed): `fread()` in 23.19. The next step uses `fwrite()` in 23.20 and `fflush()` in 23.6 from the same page.

### Build

Add to `src/base.c`:

1. `uint64_t str_hash(Str s)` and the `Trie` above with `ptrdiff_t *upsert(Trie **m, Str key, Arena *perm)`, from the hash map post.
2. `Str read_all(FILE *f, Arena *a)`, as described above. For input that does not fit, it returns a `Str` with `len` -1.

Test, in `tests/base_test.c`: insert 100000 keys, each the 4 bytes of the loop counter copied into a fresh 4-byte arena allocation, with the counter as the value. Look every key up without an arena and check the value. A lookup of a key that was never inserted returns a null pointer.

Then `src/wordcount2.c`:

1. Read standard input with `read_all` and lowercase it in place with `tolower`.
2. Split it into words as chapter 02 did, as slices of the input. Count them with the hash trie.
3. Keep the words in order of first appearance in a slice of `Str`: push a word when `upsert` returns a count of 0.
4. Print `count word` lines with `printf` for now.

Make a larger input with `for i in $(seq 100); do cat ls.txt; done > ls100.txt`, which concatenates `ls.txt` 100 times. Add `ls100.txt` to `.gitignore`, so the generated file stays out of your commits.

### Done when

The test passes. Run `wordcount2` on `ls.txt` and on `ls100.txt`, and put each output through the `sort` and `diff` check from chapter 02 against the shell pipeline. `diff` prints nothing. `grep -nw 'malloc\|free' src/base.c src/wordcount2.c` shows only the `malloc` and `free` of the block in `wordcount2`'s `main`.

## Buffered output

`wordcount2` still prints with `printf`, which reads its format string while the program runs and writes through a buffer you do not control. This step builds the output side of the library: a buffer you append bytes to, which the serializer will write JSON into.

**Buffered output** collects bytes in memory and hands them to the operating system in large pieces. Wellons' buffer has a capacity, a length and a sticky error flag, and appending copies bytes in. When the buffer is full, a buffer with a file **flushes**: it writes its bytes to the file and starts again from empty. A buffer without a file cannot flush, so the append sets the error flag instead. The flag stays set, so you check it once at the end instead of after every call.

![buf_append copies bytes into a buffer of 16. When it is full, buf_flush hands the bytes to fwrite and fflush, which pass them to stdout. A buffer with no file sets err instead.](figures/04-buf.svg)

Wellons leaves the writing to a platform function, `os_write`. Use `fwrite` and then `fflush` on a `FILE *`. If `fwrite` returns fewer items than you asked for, or `fflush` returns `EOF`, set the error flag. Linux has a device, `/dev/full`, on which every write fails with "No space left on device". Redirecting output there tests the error path without filling a disk.

The tests compare `buf_i64` with `snprintf`. `snprintf(buf, size, fmt, ...)` formats like `printf`, writes at most `size` bytes into `buf`, zero byte included, and returns the length it wanted to write.

### Study

- [Chris Wellons: Let's implement buffered, formatted output](https://nullprogram.com/blog/2023/02/13/) (read, 30 min): "The print-is-append mindset", "Buffer implementation" and "Output to a handle". Skip "Float formatting", because the JSON numbers in this chapter stay as text. Use `ptrdiff_t` where the post uses `int` for sizes.

### Build

Add to `src/base.c`:

1. `typedef struct { uint8_t *buf; ptrdiff_t len; ptrdiff_t cap; FILE *f; bool err; } Buf;`
2. `Buf buf_mem(Arena *a, ptrdiff_t cap)` and `Buf buf_file(Arena *a, ptrdiff_t cap, FILE *f)`.
3. `buf_append(Buf *b, Str s)`, `buf_byte(Buf *b, uint8_t c)`, `buf_i64(Buf *b, int64_t x)` and `buf_flush(Buf *b)`.

Tests in `tests/buf_test.c`:

- A memory buffer of capacity 5: appending `"hello"` leaves `err` false. Appending `"!"` sets `err`, and `len` stays 5. A further append of `""` leaves `err` set.
- A memory buffer of capacity 0: any non-empty append sets `err`.
- `buf_i64` matches `snprintf` for 0, 1, -1, 42, `INT64_MIN`, `INT64_MAX` and 1000 more values. Make value `i` with `(int64_t)((uint64_t)i * 0x9E3779B97F4A7C15u)`, which scatters the bits and wraps to negative numbers as step 1 showed. Use `snprintf` in tests only. On Linux an `int64_t` is a `long`, so the format `%lld` needs the argument cast to `long long`, or clang stops with a `-Wformat` error.

Then switch `wordcount2.c` to print through a `buf_file` on `stdout` with a capacity of 16 bytes, so it flushes many times. `main` calls `buf_flush` at the end, and if `err` is set it prints a message to `stderr` with `fprintf` and returns 1.

### Done when

The tests pass. `wordcount2` output still passes the `diff` check of the last step. `./out/Linux-debug/wordcount2 < ls.txt > /dev/full; echo $?` prints your error message and 1. `grep -n printf src/base.c src/wordcount2.c` finds only the `fprintf` of that message.

## A JSON parser: grammar, values, numbers and arrays

The library now has what a parser needs: an arena for the tree, `Str` for slices of the input, growable arrays and a hash map for arrays and objects, and a `Buf` for output. This step parses everything except strings and objects.

JSON is defined in RFC 8259. An **RFC** is an Internet standards document. RFC 8259 gives JSON a short formal **grammar**, a set of rules that say which byte sequences are valid JSON. It is written in ABNF, Augmented Backus-Naur Form, a notation for grammars:

- `/` separates alternatives, and `*` before an element means zero or more of it.
- `[ ]` means optional.
- `%x5B` is the byte 0x5B, and `%x30-39` is the range of bytes from 0x30 to 0x39, the digits.
- `ws` is the whitespace allowed around structural characters: space, tab, line feed and carriage return.

A **recursive descent** parser turns each grammar rule into one function. Each function looks at the byte at the current offset, takes what its rule allows, and calls the function for any rule nested inside. `parse_value` calls `parse_array`, and `parse_array` calls `parse_value` for each element, so nesting in the input becomes recursion in the parser:

![Parsing [1,[true]]: json_parse calls parse_value, which sees [ and calls parse_array. That calls parse_value for 1, which calls parse_number, and parse_value for the inner array, which calls parse_array, parse_value and parse_literal.](figures/04-descent.svg)

All the functions share one `Parser` struct, passed by pointer:

```c
typedef struct {
    Str in; ptrdiff_t pos;          /* the input and the offset into it */
    int depth; int max_depth;       /* arrays open now, and the limit */
    Arena *perm;                    /* where the tree goes */
    bool failed; ptrdiff_t err_pos; Str err;   /* the first error */
} Parser;

static void fail(Parser *p, Str msg);           /* records only the first error */
static void parse_value(Parser *p, Json *out);  /* fills in *out */
```

Every read checks `pos` against `in.len` first, because the input is not zero-terminated and may contain zero bytes. `fail` records `pos` and the message if `failed` is still false, then sets it. Every function returns as soon as it sees `failed`, so the first error stops the whole recursion.

The offset of an error is the first byte that cannot continue a valid document, or `in.len` when the input ends too early. A depth counter counts the arrays that are open, so a file of 100000 `[` characters gives an error instead of running out of stack. RFC 8259 section 9 allows these limits.

A JSON value is a **tagged struct**: an `enum` that says which kind of value it is, plus the fields that kind uses. An **enum** gives names to a set of integer constants. The parser keeps a number as its **lexeme**, the exact text it had in the input, after checking it against the grammar. That keeps 64-bit IDs and huge exponents exact, which step 2 showed a `double` cannot.

```c
typedef enum { JSON_NULL, JSON_FALSE, JSON_TRUE, JSON_NUMBER,
               JSON_STRING, JSON_ARRAY, JSON_OBJECT } JsonKind;

typedef struct Json Json;
typedef struct { Json *data; ptrdiff_t len; ptrdiff_t cap; } Jsons;
struct Json {
    JsonKind kind;
    Str      text;    /* number lexeme now, string contents in step 11 */
    Jsons    items;   /* array elements */
};
```

`Jsons` holds `Json` values and `Json` holds a `Jsons`, so the name `Json` has to exist before either is written out. The first `typedef` declares it, as for the trie. `parse_array` pushes a zeroed `Json` onto `items` and passes that pointer to `parse_value`.

The number grammar of RFC 8259 section 6 is easiest to code as a diagram of states, where each byte moves you from one state to the next. Here is its integer part. Extend it with the fraction and the exponent before you write `parse_number`:

![The integer part of a JSON number as states: an optional minus sign, then either a single 0 or a digit from 1 to 9 followed by any number of digits. The ringed states are where the integer part may end.](figures/04-number-int.svg)

### Study

- [RFC 8259: The JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259#section-2) (read, 30 min): Sections 2, 3, 5, 6 and 9. Section 4 on objects and section 7 on strings belong to step 11.
- [Crafting Interpreters: Recursive Descent Parsing](https://craftinginterpreters.com/parsing-expressions.html#recursive-descent-parsing) (read, 15 min): Section 6.2 up to 6.2.1, with the table that maps grammar notation to code, then skim 6.2.1 for the shape of the functions. It is here for that table, which turns each ABNF construct into a loop, a branch or a call. The code is Java and uses classes from earlier chapters of that book, so read the code for its structure only.
- [Beej's Guide to C: Enumerated Types](https://beej.us/guide/bgc/html/split/enumerated-types-enum.html) (read, 10 min): Sections 22.1 to 22.2.

### Build

Write `src/json.c` with no `main`. Programs include `base.c`, then `json.c`. Start with the types above and these two:

1. `typedef struct { Json *value; bool ok; ptrdiff_t err_pos; Str err; } JsonResult;` and `JsonResult json_parse(Str in, Arena *perm, int max_depth)`, which sets up a `Parser`, skips whitespace, calls `parse_value`, skips whitespace again and fails if any bytes are left.

Then grow the parser in three stages, and run the tests of each stage before the next. Strings and objects come in step 11. Until then, `parse_value` fails at their first byte.

2. Literals and whitespace: `parse_literal` for `null`, `true` and `false`, and a `ws` function that skips the four whitespace bytes.
3. Numbers: `parse_number`, following your state diagram, sets `text` to the slice of the input it read.
4. Arrays: `parse_array` with the depth counter.

Then the parts that use the tree:

5. `I64Parsed json_i64(Json *v)` for numbers.
6. `bool json_f64(Json *v, Arena scratch, double *out)` makes a terminated copy of the lexeme with `str_cstr` in the scratch arena, sets `errno` to 0, calls `strtod`, and returns false when `errno` is `ERANGE`, the value for out of range. `errno` comes from `<errno.h>`.
7. `src/jsoncheck.c` reads standard input with `read_all` into a 256 MB arena, parses it with a depth limit of 512, and returns 0 on success. On failure it prints `error at byte N: message` to `stderr` and returns 1. When the input does not fit, it says so and returns 2.
8. Before you run anything, predict `sizeof` of `Str`, `Json` and `JsonResult`, and the `offsetof` of each field, using the padding rules and `offsetof` from chapter 02. Print them in a test and compare. Chapter 05 relies on these numbers.

Tests in `tests/json_test.c`. These inputs parse:

- Stage 2: `null`, `true` and `false`, then each again with a space, a tab, a line feed and a carriage return before and after it.
- Stage 3: `123`, `-0`, `2.5e10`, `1E-2` and `0.5`. `json_i64` on `9223372036854775807` gives that value, and on `9223372036854775808` and `2.5e10` it gives `ok` false while the parse itself succeeded. `json_f64` on `9007199254740993` gives 9007199254740992, on `1e999` it returns false, and on `-0` it gives negative zero, which `%a` prints as `-0x0p+0`.
- Stage 4: `[]`, `[ ]`, `[1, -0, 2.5e10, 1E-2, 0.5]` and `[[[]], [false]]`.

These fail at the byte offset given. The inputs are the bytes between the backticks:

- Stage 2: the empty input at 0, `tru` at 3, `nul` at 3.
- Stage 3: `+1` at 0, `.5` at 0, `01` at 1, `-` at 1, `1.` at 2, `1e` at 2.
- Stage 4: `[1,]` at 3, `[1 2]` at 3, `[` at 1, `[1]x` at 3, `[NaN]` at 1, and the 4 bytes `[1]` followed by a zero byte at 3. An error inside an array at depth 3 reports the offset of the bad byte: `[1, [2, [3, tru]]]` fails at 15. 512 nested arrays parse, and 513 fail at offset 512.
- A failed parse leaves the arena usable. Save `beg`, parse `[1,` and see it fail, put `beg` back, and parse `[1,2]` in the same arena with no sanitizer report.

### Done when

Every test passes with no sanitizer report. For each failing input you can point at the line of the RFC grammar that rules it out. You can explain why the zero-byte case would pass if the parser stopped at the first zero byte. Your `sizeof` predictions matched, or you can say which padding you missed.

## UTF-8 and the `\u` escape

The next step parses JSON strings, and a JSON string can name a character by number. This step writes the three small functions that turn those numbers into bytes, and tests them before the parser uses them.

A **code point** is the number Unicode gives a character: U+0041 for `A`, U+00E9 for `é`, U+1D11E for the musical symbol 𝄞. **UTF-8** stores a code point in 1 to 4 bytes, and JSON text is UTF-8. The first byte's leading bits say how many bytes the character takes, every later byte starts with the bits `10`, and the bits of the code point fill the rest:

![UTF-8 stores a code point in 1 to 4 bytes. The first byte's leading bits say how many bytes follow, every later byte starts with 10, and the code point's bits fill the x positions.](figures/04-utf8.svg)

So `€`, U+20AC, is `0010 0000 1010 1100` in 16 bits. The 3-byte row puts the top 4 bits after `1110`, the next 6 after `10`, and the last 6 after `10`: `E2 82 AC`.

A JSON string names a code point with an escape, `\u` and four hex digits. That form comes from **UTF-16**, an encoding that stores most code points in 16 bits. Four hex digits only reach U+FFFF, so a code point above that arrives as two escapes, a **surrogate pair**: a high one from D800 to DBFF, then a low one from DC00 to DFFF. They join like this:

```
cp = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
\ud834\udd1e:  0x10000 + (0x34 << 10) + 0x11E = 0x1D11E
```

A high surrogate with no low one after it, or a low one on its own, is a **lone surrogate**. It is not a character, and RFC 3629 forbids encoding the range U+D800 to U+DFFF in UTF-8. Your parser rejects a lone surrogate, with the error at the offset of the backslash of its `\u`.

| code point | UTF-8 bytes |
| --- | --- |
| U+0024 `$` | `24` |
| U+00E9 `é` | `C3 A9` |
| U+20AC `€` | `E2 82 AC` |
| U+1D11E, from `\ud834\udd1e` | `F0 9D 84 9E` |

### Study

- [RFC 3629: UTF-8 definition](https://www.rfc-editor.org/rfc/rfc3629#section-3) (reference, as needed): The table in section 3 and the three encoding steps under it. The same section forbids encoding U+D800 to U+DFFF.
- [RFC 2781: Decoding UTF-16](https://www.rfc-editor.org/rfc/rfc2781#section-2.2) (reference, as needed): Section 2.2 joins a surrogate pair into one code point.

### Build

Add to `src/base.c`:

1. `int32_t hex4(Str s)` turns exactly four hex digits, either case, into their value, and returns -1 for anything else.
2. `int32_t surrogate_join(int32_t hi, int32_t lo)` joins a surrogate pair.
3. `int utf8_encode(uint8_t *out, int32_t cp)` writes 1 to 4 bytes to `out` and returns how many.

Tests in `tests/utf8_test.c`, run with `sh tests/run_test.sh utf8`:

- `hex4` of `"00e9"`, `"20AC"` and `"d834"`, and -1 for `"12g4"` and `"123"`.
- `surrogate_join(0xD834, 0xDD1E)` is `0x1D11E`.
- `utf8_encode` gives the bytes of the table above, and its length changes exactly between U+007F and U+0080, U+07FF and U+0800, and U+FFFF and U+10000. U+10FFFF, the last code point, takes 4 bytes.

### Done when

The tests pass with no sanitizer report. You can encode U+00E9 by hand from the figure and get `C3 A9`.

## Strings, objects and the serializer

The parser from step 9 stops with an error at the first quote or brace. This step fills in both, then writes the tree back out as JSON.

A JSON string is a quote, then characters, then a quote. Raw bytes from 0x00 to 0x1F are not allowed inside. A backslash starts an **escape**: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, or `\u` followed by four hex digits. The parser stores the decoded bytes:

- If a string has no backslash, its decoded bytes are its raw bytes, so the `Str` points straight into the input and copies nothing.
- Otherwise, allocate a buffer the size of the raw text and decode into it with `hex4`, `surrogate_join` and `utf8_encode` from step 10. Decoding never makes a string longer: `\n` is 2 bytes in and 1 out, and `\u20ac` is 6 bytes in and 3 out.

An object keeps its members in input order: a slice of keys next to the `items` slice of values. For lookup, the object also holds a hash trie from each key to its member's index. RFC 8259 section 4 says names should be unique, and it does not forbid duplicates. Keep every member for the serializer, and have `json_get` return the last value for a duplicated key.

![The tree for {"a":[1,true],"b":null}: the object has items, keys and an index. The keys Str "a" and Str "b" and the text of the number 1 point into the input bytes.](figures/04-json-tree.svg)

The **serializer** walks the tree and appends to a `Buf` in compact form, with no whitespace:

- Numbers write their lexeme.
- Strings write `\"` and `\\`, the short escapes `\n`, `\t`, `\r`, `\b` and `\f`, and `\u00XX` for every other byte below 0x20. Every other byte goes out as it is.
- Arrays and objects write their brackets, commas and colons around their members.

### Study

- [RFC 8259: Objects, Strings and Character Issues](https://www.rfc-editor.org/rfc/rfc8259#section-4) (read, 20 min): Section 4, then section 7 and sections 8.1 to 8.3.

### Build

1. Extend `Json` with `Strs keys`, where `Strs` is a slice of `Str` with `data`, `len` and `cap`, and with `Trie *index` for objects, the trie from step 7 mapping each key to its member's position.
2. Add strings and objects to `json_parse`. Reject lone surrogates as step 10 said, and write that rule in a comment at the top of `json.c`.
3. `Json *json_get(Json *object, Str key)` returns 0 for a missing key or a non-object.
4. `void json_write(Buf *b, Json *v)`.

Tests. Each input parses, and `json_write` produces exactly the output shown:

- ` { "a" : [ 1 , 2.5e3 , true ] , "b" : null } ` gives `{"a":[1,2.5e3,true],"b":null}`.
- `"\u00e9"` gives a quote, the bytes C3 A9, and a quote.
- `"\ud834\udd1e"` gives a quote, the bytes F0 9D 84 9E, and a quote.
- `"a\u0000b"` parses to a `Str` of length 3 with a zero byte in the middle, and writes back as `"a\u0000b"`.
- `"\/"` gives `"/"`. `"tab\there"` writes back as `"tab\there"`.
- `{"x":1,"y":2,"x":3}` writes back with all three members, and `json_get` for `x` gives 3.

These fail at the offset given:

- `"abc` at 4, `"\x"` at 2, `{"a" 1}` at 5, `{1:2}` at 1, `{"a":1,}` at 7, and a string holding a raw tab byte at the offset of the tab.
- The lone surrogates `"\ud834"` at 1, `"\udd1e"` at 1 and `"x\ud834y"` at 2.
- An error inside a string at depth 3: `[[["ab\q"]]]` fails at 7, the byte after the backslash.

For every input that parses, check that `json_write`, then `json_parse` of that output, then `json_write` again gives the same bytes as the first `json_write`. That shows the serializer and parser agree. It cannot show that both are right, so the fixed outputs above are the real check.

### Done when

All tests pass with no sanitizer report. Start gdb with `ASAN_OPTIONS=detect_leaks=0` as in chapter 01, stop in the `"a\u0000b"` test, and show with `x/3xb` on the string's `data` that it holds `0x61 0x00 0x62`. For a string without escapes, show that its `data` points into the input.

## The tree in memory

The parser works. Before you test it against other people's files, look at what it builds: how much arena a file needs, and where each part of the tree sits in the block.

Every `Json` node is 80 bytes, every array leaves its old blocks behind as it grows, and every object member adds a trie node. So the tree is several times larger than the input. Chapter 07 parses a file of about 100 MB with this parser, so you measure the ratio now.

The second half is a map of the arena block after one small parse. You read it in gdb with `x`, as in chapter 02. gdb's `@` operator saves you from following each slice by hand: `p *v->items.data@v->items.len` prints every element of a slice as one array.

### Study

- [GDB manual: Artificial Arrays](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Arrays.html) (reference, as needed): Section 10.4, the `@` operator.

### Build

Part 1, the cost of the tree.

1. Give `jsoncheck` a `-v` argument that makes it print to `stderr` how many bytes the input had and how many arena bytes the parse used, which is `beg` after the parse minus `beg` before it.
2. Generate a file of 100,000 objects with four numbers each, about 10 MB, and add `big*.json` to `.gitignore`:

   ```sh
   python3 -c '
   import json, random
   pairs = [{"x0": random.uniform(-180, 180), "y0": random.uniform(-90, 90),
             "x1": random.uniform(-180, 180), "y1": random.uniform(-90, 90)}
            for _ in range(100000)]
   json.dump({"pairs": pairs}, open("big.json", "w"))'
   ```

3. Run `sh build.sh jsoncheck release` and `./out/Linux-release/jsoncheck -v < big.json`. Divide the tree bytes by the input bytes.
4. From that ratio, predict the largest file of this shape that fits in the 256 MB block, counting the input itself. Generate one twice that size as `big2.json` and run it. If it aborts, run the debug build on the same file in gdb, started with `ASAN_OPTIONS=detect_leaks=0`, and read `bt`.

For chapter 07 you give the arena a larger block. A `malloc` of several GB is fine, because untouched pages cost nothing.

Part 2, the memory map.

1. Save `{"name":"caf\u00e9","tags":["a","b"],"n":12}` as `doc.json`.
2. Start gdb on the debug `jsoncheck` with `ASAN_OPTIONS=detect_leaks=0` as in chapter 01, set a breakpoint on the line after `json_parse`, and start the program with `run < doc.json`, which connects the file to standard input.
3. With `x/32xb` at the arena's block, and at later addresses as you go, find the input bytes, each `Json` node, each slice's backing block, the hash trie nodes, and the decoded `café`. Use `@` to print each slice.
4. Write the map as a comment in `jsoncheck.c`: offset ranges and what each holds, and for every `Str` in the tree, whether its bytes are in the input or in a decoded copy.

### Done when

You can say how much arena a JSON file of N bytes of this shape needs, and what `jsoncheck` did with the file that was too large. Your memory map accounts for every byte the parse used, padding included.

## Conformance with JSONTestSuite

Your tests so far are the cases you thought of. This step checks the parser against cases other people thought of.

**JSONTestSuite** holds the cases other parsers got wrong. Its `test_parsing` directory has three kinds of file. A parser must accept every `y_` file and reject every `n_` file. For `i_` files the RFC allows either answer, so you record what yours does. The lone surrogate files are among them, and your parser rejects those.

Seriot's article explains why each group of tests exists, and which common parsers failed them. One of those parsers is Python's `json` module, which you can run next to yours.

The test script needs one fix to trust its exit statuses. ASan and UBSan exit with status 1 when they report a bug, which is the same status as "reject". A crash on an `n_` file would pass as a correct answer. `ASAN_OPTIONS=exitcode=99 UBSAN_OPTIONS=exitcode=99` makes both runtimes exit with 99 instead.

### Study

- [Nicolas Seriot: Parsing JSON is a Minefield](https://seriot.ch/security/parsing_json.html) (read, 45 min): Section 1 and sections 2.1 to 2.6. Skip section 3 onward, which covers the test setup and the results for other parsers.
- [JSONTestSuite](https://github.com/nst/JSONTestSuite) (do, 3 h): Clone it with git into your project directory, and add `JSONTestSuite/` and `i_results.txt` to `.gitignore`. The README explains the `y_`, `n_` and `i_` prefixes. Use only `test_parsing/`.

### Build

Save this as `tests/run_suite.sh` and run it with `sh tests/run_suite.sh JSONTestSuite/test_parsing`. It runs every file through the debug build of `jsoncheck`. Exit status 0 means accept and 1 means reject. Any other status, such as a sanitizer report, is a failure for every prefix:

```sh
#!/bin/sh
# usage: sh tests/run_suite.sh path/to/JSONTestSuite/test_parsing
rm -f i_results.txt
bad=0
for f in "$1"/*.json; do
    name=$(basename "$f")
    ASAN_OPTIONS=exitcode=99 UBSAN_OPTIONS=exitcode=99 \
        ./out/Linux-debug/jsoncheck < "$f" > /dev/null 2>&1
    status=$?
    case "$name" in
    y_*) [ $status -eq 0 ] || { echo "FAIL $name ($status)"; bad=$((bad+1)); } ;;
    n_*) [ $status -eq 1 ] || { echo "FAIL $name ($status)"; bad=$((bad+1)); } ;;
    i_*) echo "$status $name" >> i_results.txt ;;
    esac
done
echo "$bad failure(s)"
[ $bad -eq 0 ]
```

- `for f in ...; do ... done` runs the lines between `do` and `done` once for each file, with `$f` set to its path. `basename` strips the directory from that path.
- `$?` is the exit status of the last command.
- `case` compares `$name` with each pattern in turn, `*` matches any text, and `;;` ends a pattern's commands.
- `[ $status -eq 0 ]` tests whether two numbers are equal. `a || b` runs `b` only when `a` fails, so each `y_` and `n_` line prints FAIL and counts it when the status is wrong. `{ ...; }` groups the two commands, and `$((bad+1))` is shell arithmetic.
- `>>` appends to a file, where `>` would replace it.

1. Fix every failure, then add the file's bytes as a test case in `tests/json_test.c`.
2. Check `i_results.txt` for any status other than 0 or 1.
3. Write one line per `i_` file into a block of comments at the top of `json.c`, saying what your parser does and why.
4. Copy the script to `tests/vs_python.sh` and change the loop to run each file through Python as well, with `python3 -c 'import json, sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$f"`. That command exits with 0 when Python accepts the file and 1 when it raises an error. Print the name of every file where the two exit statuses differ.

### Done when

`sh tests/run_suite.sh JSONTestSuite/test_parsing` reports 0 failures, and every `i_` file has a line of explanation in `json.c`. You can name three files where Python and your parser disagree and say which answer RFC 8259 supports.

## Fuzzing the parser

JSONTestSuite is a fixed list. This step adds inputs a program generates, millions of them, and checks a property on each.

A **fuzzer** writes test inputs for you. **libFuzzer** calls a function you write with millions of generated byte strings. It watches which branches of your code each input reaches, and it keeps and changes the inputs that reach new ones. The inputs it keeps are its **corpus**.

Run the fuzzer with ASan and UBSan, and give it a property to check: serializing, parsing and serializing again gives the same bytes. libFuzzer is in `libclang-rt-18-dev`, the package that also holds the sanitizer runtimes. apt installed it along with clang in chapter 00.

### Study

- [LLVM: libFuzzer](https://llvm.org/docs/LibFuzzer.html) (read, 30 min): "Introduction", "Getting Started" (Fuzz Target, Fuzzer Usage), "Corpus", "Running", and skim "Options" for `-max_len`, `-max_total_time` and `-dict`. Skip "Advanced features" and the FAQ.

### Build

1. Write `tests/json_fuzz.c`. It includes `base.c` and `json.c` and defines `int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)`. libFuzzer calls it once per input and supplies `main` itself.
2. Make the arena's 64 MB block on the first call, with `malloc`, keep the pointer in a `static` variable, and poison the whole block once.
3. On each call, start a fresh arena over the block. Parse the input with depth limit 512. If it parses, serialize it into a memory `Buf` of twice the input size plus 16 bytes, parse that output and serialize it again. Call `abort()` if a `Buf` reports an error, the second parse fails or the two outputs differ.
4. At the end of each call, poison only the bytes this call used, from the block's start to the arena's `beg`. Poisoning all 64 MB on every call made the fuzzer more than 20 times slower in a test run for this book.
5. Add `corpus/`, `crash-*` and `fuzz.log` to `.gitignore`. Then build and run it:

   ```sh
   clang -std=gnu11 -g -O1 -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=undefined -o out/json_fuzz tests/json_fuzz.c
   mkdir -p corpus && cp JSONTestSuite/test_parsing/y_*.json corpus/
   ./out/json_fuzz -max_len=4096 -max_total_time=1800 corpus/ 2> fuzz.log
   ```

   - `-fsanitize=fuzzer` links in libFuzzer.
   - `-fno-sanitize-recover=undefined` makes UBSan stop the program at its first report. Without it UBSan only prints a "runtime error" line and the fuzzer carries on, so undefined behavior never counts as a crash.
   - `-O1` makes the code fast enough for millions of runs and keeps it debuggable.
   - `-max_len=4096` limits each input to 4096 bytes, and `-max_total_time=1800` stops after 30 minutes.
   - libFuzzer adds the inputs it keeps to `corpus/`. `2> fuzz.log` saves its progress lines, which it prints to `stderr`.
6. Every crash leaves a `crash-...` file. Reproduce it with `./out/json_fuzz crash-...`, fix the bug, and add the input to your tests.

> **If it fails:** If the build stops with `/usr/bin/ld: cannot find .../libclang_rt.fuzzer-x86_64.a: No such file or directory`, the libFuzzer library is missing. Install it with `sudo apt install libclang-rt-dev` and build again.

### Done when

- The fuzzer ran for 30 minutes without a crash after your last fix, and `grep -c 'runtime error' fuzz.log` prints 0.
- `grep -nw 'malloc\|free' src/base.c src/json.c src/wordcount2.c src/jsoncheck.c tests/base_test.c tests/str_test.c tests/buf_test.c tests/utf8_test.c tests/json_test.c tests/json_fuzz.c` shows only the arena blocks in each `main`, in the tests and in the fuzz target.

## Where this leads

The JSON parser leaves you with a way of working: a cursor over bytes, rules turned into functions, errors with exact offsets, and tests that come from a specification instead of from memory. Chapter 05's 8086 decoder reads bytes at an offset the same way.

What you have not looked at is the code the compiler made from all this. You saw a few instructions in chapter 02 and deleted comparisons in step 3, but you cannot yet say how a `Str` crosses a function call, why `json_parse` can return a struct, or what happens when two `.c` files call each other. Every program in this chapter is one file, so nothing has needed linking.

Chapter 05, Assembly, the ABI and linking, writes x86-64 by hand and debugs it in gdb, adds ARM64 as a second instruction set under QEMU, and explains the System V calling convention. It then reads optimized code and defuses the Bomb Lab from its disassembly, and shows how an out-of-bounds write on the stack, the kind of undefined behavior from step 3, becomes an exploit. It splits this library into ELF object files with a Makefile, and builds an 8086 instruction decoder. The decoder pulls bit fields out of bytes and sign-extends displacements, as `get_byte` and `sign_extend` did in step 1.
