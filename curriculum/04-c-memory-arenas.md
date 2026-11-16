---
id: 04
title: C properly: memory, undefined behavior, arenas
part: The machine and C
weeks: 8
project: An arena-backed string, dynamic array and hash map library with a JSON parser and serializer on top that passes JSONTestSuite with no sanitizer reports.
---

Chapter 02 taught you to own heap memory one `malloc` at a time: every node and every word copy had an owner and one place where it got freed. Chapter 03 built a CPU from gates and ended with an assembler in C that reads text, splits it into fields and keeps a symbol table. You can write working C now. This chapter changes how you write it.

You build a small library in one file: an arena allocator, a string type that carries its length, a dynamic array, a hash map and a buffered writer. On top of it you write a JSON parser and serializer. The finished parser accepts and rejects the files of JSONTestSuite correctly, survives a fuzzer, and runs clean under the sanitizers. The whole program calls `malloc` once and `free` once, both in `main`.

The first three steps come before any of that. They cover what C values look like as bits and what the compiler assumes about your code. Integer conversions change values without a warning, floats round, and undefined behavior lets the optimizer delete checks you wrote. The arena depends on alignment arithmetic and overflow-free size checks, and the parser has to decide what to do with numbers a `double` cannot hold, so these rules come first.

The chapter comes now because chapter 05 reads the machine code clang makes from C. Much of what you see there, such as sign extension, deleted overflow checks and structs returned in registers, follows from the rules in this chapter. Do not grow the library past what the parser and the word counter need. Pull shared code out the third time you write it, not the first.

## Integers: widths, conversions and overflow

The ALU from chapter 03 added and negated 16-bit two's complement numbers. In C the same bits come with types, and the types come with rules. On both of your machines an `int` is 32 bits. `<stdint.h>` names exact widths, `int8_t` to `int64_t` and `uint8_t` to `uint64_t`, plus `uintptr_t`, an unsigned integer wide enough to hold an address. `<stddef.h>` gives `ptrdiff_t`, the signed 64-bit type of the difference of two pointers, and `size_t`, the unsigned type that `sizeof` returns.

Three rules cause most integer surprises:

1. Unsigned arithmetic wraps modulo 2 to the power of the width. That is defined behavior. Signed overflow is undefined behavior, which step 3 covers.
2. Before arithmetic, values of a type narrower than `int` are promoted to `int`. A `uint16_t` holding 65535 plus 1 gives the `int` 65536, not 0.
3. When a signed and an unsigned operand of the same width meet, the signed one is converted to unsigned.

The third rule makes `-1 < 0u` false:

```
  -1 < 0u
  -1 is converted to unsigned int: 0xFFFFFFFF, which is 4294967295
  4294967295 < 0  ->  0
```

clang does not warn about that line, even with `-Wall -Wextra`. The same rule turns `size_t` arithmetic near zero into huge numbers: with `size_t n = 0`, `n - 1` is `SIZE_MAX`. From step 4 on, the library uses signed `ptrdiff_t` for sizes and lengths, as Chris Wellons does, so that a mistake gives a negative number you can assert against instead of a huge one.

Bit operations are the other half of this step. Step 4's arena rounds an address up to the next multiple of an alignment with one expression, and you write and test that expression here. For a power of two `align`, `addr & (align - 1)` is how far `addr` is past the last multiple, and `-addr & (align - 1)` is how far it is to the next one:

```
  align = 8, addr = 0x1003
  addr  & 7         = 3      bytes past 0x1000
  -addr & 7         = 5      bytes to 0x1008
  addr + 5          = 0x1008
```

`-addr` on an unsigned value is defined: it wraps.

### Study

- [Dive Into Systems: Signed Binary Integers](https://diveintosystems.org/book/C4-Binary/signed.html) (read, 45 min): Section 4.3, including Negation and Sign Extension, then follow "Next" to 4.5 Integer Overflow and 4.6 Bitwise Operators. Section 4.4 on binary addition by hand is optional after the adders of chapter 03.
- [Beej's Guide to C: Numeric Conversions](https://beej.us/guide/bgc/html/split/types-iii-conversions.html#numeric-conversions) (read, 20 min): Sections 15.3 to 15.5.1. Skip 15.1 and 15.2 on strings and chars.
- [C11 final draft, N1570](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf) (reference, as needed): The language standard. Look up 6.3.1.1 (integer promotions), 6.3.1.3 (signed and unsigned conversions), 6.3.1.8 (usual arithmetic conversions) and 6.5.7 (shifts) when a prediction below goes wrong. Annex J.2 lists every undefined behavior, and step 3 uses it.

### Build

Part 1, predictions. In `src/predict.c`, print each expression below. Before you run it, write your predicted value and its type in a comment next to the line.

- `-1 < 0u`
- `(unsigned)-1`
- `(uint8_t)300` and `(int8_t)200`
- `a + 1` where `uint16_t a = 65535`
- `b + 1` where `uint32_t b = UINT32_MAX`
- `-7 / 2` and `-7 % 2`
- `-8 >> 1`
- `sizeof(int) - 5`, printed with `%zu`

Then put this loop in `src/countdown.c` and build it with clang and then with `CC=gcc` in the VM:

```c
size_t n = 0;
for (size_t i = n - 1; i >= 0; i--) {
    break;
}
```

Part 2, bit functions. Write `src/bits.c` and `tests/bits_test.c` with the test pattern from chapter 02:

- `bool is_pow2(uint32_t x)`. Test 0, 1, 2, 3, 64, `0x80000000` and `UINT32_MAX`.
- `uint32_t get_byte(uint32_t x, int n)` returns byte `n`, where byte 0 is the lowest. Test `0x12345678` for n from 0 to 3.
- `int popcount32(uint32_t x)` counts the set bits. Test 0, 1, `0xFF`, `UINT32_MAX` and `0x80000001`.
- `uintptr_t align_padding(uintptr_t addr, uintptr_t align)` with the `-addr & (align - 1)` expression. Compare it with `(align - addr % align) % align` for every `addr` from 0 to 255 and every `align` in 1, 2, 4, ..., 128.
- `int32_t sign_extend(uint32_t x, int bits)` treats the low `bits` bits of `x` as a two's complement number. `sign_extend(0xFF, 8)` is -1, `sign_extend(0x7F, 8)` is 127 and `sign_extend(0x80, 8)` is -128. Do the bit work on `uint32_t`. The final conversion to `int32_t` of a value above `INT32_MAX` is implementation-defined, and clang and gcc define it as wrapping.
- `bool add_i32(int32_t a, int32_t b, int32_t *out)` returns false on overflow and never performs an overflowing addition. Check the limits before you add. Test every pair from {`INT32_MIN`, `INT32_MIN + 1`, -2, -1, 0, 1, 2, `INT32_MAX - 1`, `INT32_MAX`} against the sum computed in `int64_t`.
- `bool mul_size(ptrdiff_t count, ptrdiff_t size, ptrdiff_t *out)` for `count >= 0` and `size > 0` returns false when the product would exceed `PTRDIFF_MAX`. Test `count` 0, 1, `PTRDIFF_MAX / 8` and `PTRDIFF_MAX / 8 + 1` with `size` 8.

### Done when

The bits tests pass in debug builds, which include UBSan, on the Mac and in the VM. For every prediction that was wrong, you can name the rule that produced the real value and its section number in N1570. gcc refuses `countdown.c` with a `-Wtype-limits` error and clang builds it, and you can say why the loop never ends.

## Floats: the bits of float and double

A `float` is 32 bits: a sign bit, an 8-bit exponent and a 23-bit fraction. A `double` is 64 bits with an 11-bit exponent and a 52-bit fraction. The fraction has an implied leading 1 for normal numbers, so a `double` holds every integer up to 2 to the 53rd power exactly, and above that it starts skipping integers. JSON numbers are often 64-bit IDs, which matters in the parser steps.

```
  float 1.0f = 0x3F800000

  sign  exponent   fraction
  0     01111111   00000000000000000000000
        127 - 127 = 0      1.0 x 2^0 = 1.0
```

To read the bits of a float, copy them into a `uint32_t` with `memcpy`. Casting a `float *` to `uint32_t *` and reading through it breaks C's type rules, and step 3 shows what the optimizer does with that. `memcpy` of 4 bytes compiles to a single register move at `-O1`, so it costs nothing.

Two printf formats help here. `%.17g` prints a `double` with enough digits to tell any two doubles apart. `%a` prints the exact value in hexadecimal, fraction and binary exponent, with no decimal rounding.

### Study

- [Bartosz Ciechanowski: Exposing Floating Point](https://ciechanow.ski/exposing-floating-point/) (read, 75 min): From the start through "Raw Integer Value", then "Double" under Other Types, all of "Conversions", and "Hexadecimal Form" under Printing. Skip "Half", "Larger Types" and "Exact Decimal Representation". Flip bits in the interactive figures until you can predict the value before it changes.

### Build

Write `src/floats.c` and its tests:

1. `uint32_t f32_bits(float f)` and `float f32_from_bits(uint32_t u)` with `memcpy`.
2. `void f32_show(float f)` prints the bits in hex, the sign, the unbiased exponent, the fraction in hex, and a class: zero, subnormal, normal, infinity or NaN. Before running it, write down the bits you expect for `1.0f`, `-2.0f` and `0.5f`. Then show `0.1f`, `-0.0f`, the smallest subnormal (`f32_from_bits(1)`), `FLT_MAX` from `<float.h>`, and `INFINITY` and `NAN` from `<math.h>`.
3. `uint32_t f32_twice(uint32_t bits)` returns the bits of twice the float, using only integer operations on `bits`. Handle zero, subnormals (shift the fraction), normals (add 1 to the exponent), overflow to infinity, infinity and NaN. Test it against `f32_bits(2.0f * f32_from_bits(u))` for all 2 to the 32nd power bit patterns. Where the input is a NaN, only require the output to be a NaN. Build this one test with the release flags from `build.sh` (`-O2`, no sanitizers). It takes seconds that way and much longer with sanitizers.
4. Print `9007199254740993.0` and `(double)INT64_MAX` with `%.17g`, and `0.1 + 0.2` and `0.3` with `%a`.

### Done when

`f32_twice` matches the hardware on every bit pattern. Your hand-written bits for `1.0f`, `-2.0f` and `0.5f` match `f32_show`. You can explain why `9007199254740993.0` prints as `9007199254740992`, and why `0.1 + 0.2 == 0.3` is false using the two `%a` lines.

## Undefined behavior: what the compiler assumes

Chapter 01 introduced UBSan with an `int` that overflowed. That chapter treated undefined behavior as a bug the sanitizer catches. This step shows the other half: the optimizer assumes undefined behavior never happens and transforms your code on that assumption. A check that can only be true after undefined behavior gets deleted. Two pointers of different types are assumed not to point at the same bytes. At `-O0` the compiler makes few of these transformations, so a program can pass every debug test and still break in a release build.

Lattner's two posts explain why the C standard leaves these cases undefined and which optimizations depend on that. Read them with Compiler Explorer from chapter 02 open, and paste each example in.

UBSan only checks code that runs, and it does not check every rule. It does not see type-based aliasing violations at all. Annex J.2 of N1570, from step 1, lists every undefined behavior in C11. You do not need to memorize it. Use it when you suspect a line.

### Study

- [Chris Lattner: What Every C Programmer Should Know About Undefined Behavior #1/3](https://blog.llvm.org/2011/05/what-every-c-programmer-should-know.html) (read, 20 min): The whole post. Its list of undefined behaviors (uninitialized variables, signed overflow, oversized shifts, wild pointers, null dereferences, type rule violations) is the list this step tests.
- [Chris Lattner: What Every C Programmer Should Know About Undefined Behavior #2/3](https://blog.llvm.org/2011/05/what-every-c-programmer-should-know_14.html) (read, 20 min): Read up to "There is No Reliable Way to Determine if a Large Codebase Contains Undefined Behavior". The tool list in that last section predates UBSan, which you already use. Skip part 3.

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

int main(int argc, char **argv) {
    int which = argc > 1 ? atoi(argv[1]) : 0;
    int n = argc > 2 ? atoi(argv[2]) : 32;
    if (which == 1) printf("%d\n", always_bigger(INT_MAX));
    if (which == 2) { int x = 0; printf("%d\n", alias(&x, (float *)&x)); }
    if (which == 3) printf("%d\n", bad_check(INT_MAX));
    if (which == 4) printf("%u\n", shift(1u, n));
    if (which == 5) printf("%d\n", to_int(3e9 + n));
    return 0;
}
```

1. Build the debug and the release version. Run cases 1 to 5 in both, on the Mac and in the VM, and record each output in a table: debug output or UBSan report, release output.
2. For cases 1 and 3, find the comparison the optimizer deleted. At `-O2` clang inlines the `static` functions into `main`, so paste `always_bigger` and `bad_check` alone, without `static`, into Compiler Explorer with "armv8-a clang" and `-O2`.
3. For case 2, explain from Lattner's first post why the release build prints 1 and the debug build prints 0, and why UBSan said nothing.
4. Write a fixed version of each function in `src/ub_fixed.c`: an `always_bigger` that compares against `INT_MAX` first, a `bad_check` that tests `size == INT_MAX`, an `alias` that does not read one object through two pointer types, a `shift` that returns 0 for `n >= 32`, and a `to_int` that clamps to the `int` range before converting. Then build with `-fwrapv` once and run case 1 again to see what that flag changes.

### Done when

Your table has an entry for all five cases in both builds on both machines. The fixed versions print the same values in debug and release builds and produce no UBSan reports. You can point at the instruction in the `-O2` output of `always_bigger` that replaced the comparison, and you can name the Annex J.2 entry for each of the five cases.

## An arena allocator

In chapter 02, every list node had its own `malloc` and its own `free`, and the test counters proved they balanced. That works, and it scales badly. Most objects in a real program die in groups: everything built while parsing one file, everything used for one request, everything allocated by one function call. An arena allocates a group from one block and frees the whole group at once by moving a pointer back.

```
  arena: one block, a pointer to the first free byte, a pointer to the end

  beg                                                  end
   v                                                    v
  [ used | used | pad | used |          free            ]
                              ^
                              next allocation starts here
```

Fleury's article explains the lifetime model: a function receives the arena its results should live in. Wellons' article turns that into about fifteen lines of C. Two of Wellons' conventions appear in every later step. A permanent arena is passed by pointer, and what you allocate there outlives the call. A scratch arena is passed by value, so the function allocates from its own copy of the two pointers and everything it allocated is gone when it returns. Allocation failure aborts the program, or returns 0 when the caller asks for a soft failure.

Every allocation pads `beg` up to the alignment of the type, with the `align_padding` expression from step 1. `_Alignof(T)` gives that alignment. `new` is a function-like macro that passes `sizeof(T)` and `_Alignof(T)` for you, so the rest of the program never writes a size by hand.

Your process has several kinds of memory, and the arena block is one more region in it. This picture is a teaching layout. The real addresses on macOS and Linux differ and change on every run:

```
  high addresses
  stack       locals, return addresses, grows down
     ...
  heap        malloc blocks, including the arena's one block
  .bss        globals that start at zero
  .data       globals with an initial value
  .rodata     string literals, const tables
  .text       machine code
  low addresses
```

The sanitizers see the arena as one big `malloc` block. ASan cannot tell when you read past the end of one arena object into the next, or read an object after its scratch arena was reset. The tests in this chapter have to catch those mistakes.

### Study

- [Ryan Fleury: Untangling Lifetimes: The Arena Allocator](https://www.dgtlgrove.com/p/untangling-lifetimes-the-arena-allocator) (read, 45 min): From the start through "Arena Parameterization". Skip "Composition With More Complex Allocators", the survey of specializations and "Implementation Notes". The notes reserve virtual address space, which chapter 08 explains.
- [Chris Wellons: Arena allocator tips and tricks](https://nullprogram.com/blog/2023/09/27/) (read, 30 min): Read "An arena implementation", "The new macro" and "Arena size and growth", plus the example at the top. Skip "Enhance alloc with attributes", whose June 2024 update says `alloc_size` is broken, and "Pointer laundering". Keep `abort` as the failure policy and ignore the `longjmp` variant.
- [Beej's Guide to C: Macros with Arguments](https://beej.us/guide/bgc/html/split/the-c-preprocessor.html#macros-with-arguments) (read, 15 min): Sections 19.5.1 and 19.5.2. The rest of 19.5 is not needed.

### Build

Start `src/base.c`. Every function in it is `static`, and programs `#include` it, so each program stays one translation unit as in chapter 01.

- `typedef struct { char *beg; char *end; } Arena;`
- `void *alloc(Arena *a, ptrdiff_t size, ptrdiff_t align, ptrdiff_t count, int flags)` as in Wellons' post, with a `SOFTFAIL` flag. Add asserts that `size > 0`, `count >= 0` and `align` is a power of two. Wellons' version does not check for a negative count.
- `#define new(a, t, n) (t *)alloc(a, sizeof(t), _Alignof(t), n, 0)`
- In each program's `main`: one `malloc` for the arena's block, and one `free` of the same pointer before returning. LeakSanitizer in the VM then has nothing to report.

Tests in `tests/base_test.c`:

- Fill a 4096-byte block with `0xAA` before making an arena from it. Every allocation reads back as zero.
- `new(&a, char, 1)` followed by `new(&a, int64_t, 1)`: the second pointer is a multiple of 8 and `beg` moved 16 bytes in total. An allocation with alignment 64 lands on a multiple of 64.
- Exact fit: a 64-byte arena gives one allocation of 64 chars. One more char with `SOFTFAIL` returns 0 and leaves `beg` unchanged.
- A count of 0 consumes no bytes when `beg` is already aligned.
- A count of `PTRDIFF_MAX` with size 8 and `SOFTFAIL` returns 0. Without `SOFTFAIL` it aborts. Run that case once by hand in lldb and read `bt`.
- `ptrdiff_t scratch_user(Arena scratch)` allocates 1000 bytes and returns how far its copy of `beg` moved. After the call, the caller's `beg` has not moved. `void perm_user(Arena *perm)` allocates 1000 bytes, and afterwards the caller's `beg` has moved by at least 1000.

Then a look at the layout picture. In `src/layout.c`, print with `%p` the address of a string literal, a global with an initial value, a global without one, a local in `main`, a local in a function `main` calls, and the arena block. Sort the addresses on paper and compare them with the picture, on the Mac and in the VM.

### Done when

All tests pass on both machines, and the VM run reports no leaks. `grep -n 'malloc\|free(' src/*.c` shows only the pair in `main`. The `bt` of the aborting case shows `alloc` called from your test. You can explain why `scratch_user` cannot leak its allocations to its caller, and which of the addresses from `layout.c` matched the picture.

## Strings that carry their length

C strings end with a zero byte. You saw the cost in chapter 02: every length is a walk with `strlen`, every copy needs capacity for the terminator, and a slice of a string cannot exist without a copy. Wellons replaces them with a pointer and a length passed by value:

```
  Str s = S("hello world");        Str t = str_slice(s, 6, 11);

  s.data --> h e l l o _ w o r l d          s.len = 11
                         ^
  t.data ----------------+                  t.len = 5

  t owns nothing. Its bytes belong to whatever holds "hello world".
```

A slice is a new pair of numbers and copies no bytes. Two strings are equal when their lengths match and their bytes match. A `Str` can contain zero bytes, which JSON strings need. At a libc call that wants a terminated string, you make a terminated copy in an arena.

Wellons also returns structs instead of writing through out-parameters. A parse function returns `{value, ok}` in one struct, and the caller checks `ok`. That shape repeats in every later step. The `S("...")` macro builds a `Str` with a compound literal, a struct value written inline.

`memcmp` and `memcpy` require valid pointers even when the length is 0, and an empty `Str` has a null `data`. UBSan in the VM reports a null passed to `memcmp`. Check the length before you call them.

### Study

- [Chris Wellons: My personal C coding style as of late 2023](https://nullprogram.com/blog/2023/10/08/) (read, 30 min): "Primitive types", "Macros", "Strings" and "More structures". Skim "Parameters and functions". Dropping `const` is his preference, and you may keep `const`. Skip "Odds and ends". You do not have to adopt his short type names.
- [Beej's Guide to C: Compound Literals](https://beej.us/guide/bgc/html/split/types-part-v-compound-literals-and-generic-selections.html#compound-literals) (read, 10 min): Sections 32.1 to 32.1.2. Stop before 32.2 Generic Selections.

### Build

Add to `src/base.c`:

- `typedef struct { uint8_t *data; ptrdiff_t len; } Str;` and `#define S(s) (Str){(uint8_t *)s, (ptrdiff_t)sizeof(s) - 1}` for string literals only.
- `bool str_equals(Str a, Str b)`
- `Str str_slice(Str s, ptrdiff_t beg, ptrdiff_t end)`, which asserts `0 <= beg <= end <= s.len`.
- `typedef struct { Str head; Str tail; bool ok; } Cut;` and `Cut str_cut(Str s, uint8_t c)`, which splits at the first `c`. Without a `c`, `head` is all of `s` and `ok` is false.
- `Str str_trim(Str s)`, which removes spaces, tabs, `\n` and `\r` from both ends.
- `Str str_clone(Arena *a, Str s)`, `Str str_concat(Arena *a, Str x, Str y)` and `char *str_cstr(Arena *a, Str s)`, which returns a zero-terminated copy.
- `typedef struct { int64_t value; bool ok; } I64Parsed;` and `I64Parsed str_parse_i64(Str s)`. It accepts an optional `-` followed by decimal digits and nothing else. It never overflows. Check against the limit before each multiply and add, as `add_i32` did in step 1. The negative range is one larger than the positive range, so `-9223372036854775808` needs its own care: accumulate as a negative number and negate at the end for positive input.

Test, with the chapter 02 pattern:

- `str_equals` on two empty strings with `data` 0, an empty string against `S("")`, `S("a")` against `S("b")`, and two equal strings at different addresses.
- `str_slice` of `S("hello world")` from 6 to 11 equals `S("world")` and its `data` points into the original.
- `str_cut(S("key=value"), '=')`, `str_cut(S("=x"), '=')`, `str_cut(S("none"), '=')`.
- `str_trim` on `S("")`, `S("  \t ")` and `S("\n a b \r")`.
- `str_cstr` of a slice from the middle of a string gives the right `strlen`.
- `str_parse_i64` accepts `0`, `-0`, `42`, `9223372036854775807` and `-9223372036854775808`. It rejects `""`, `"-"`, `"+1"`, `"12a"`, `"9223372036854775808"` and `"-9223372036854775809"`.

### Done when

All tests pass on the Mac and under ASan and UBSan in the VM. Remove the length check from `str_equals` and confirm that UBSan in the VM reports the null passed to `memcmp`, then put the check back. You can say, for each `Str` in your tests, which object owns its bytes.

## A dynamic array and a hash map in the arena

Chapter 02's growable array used `realloc`. An arena cannot resize an object in the middle of its block, so Wellons' version allocates a block twice as large and copies the elements over. The old block stays in the arena until the arena is reset. Old copies of the slice header still point at the old block and still work, and nothing points into freed memory. Any struct with `data`, `len` and `cap` fields in that order works with one `push` macro.

```
  int32s v = {0};                 len 0, cap 0, data 0
  *push(&v, &a) = 1;              grow: new block of 2, len 1
  *push(&v, &a) = 2;              len 2
  *push(&v, &a) = 3;              grow: new block of 4, copy 2, len 3

  arena: [ 1 2 ][ 1 2 3 . ]
           old     v.data
```

Wellons' hash map is a hash trie. Each node has four children, and the top two bits of the hash pick a child at each level. It never resizes, so it fits an arena. A null pointer is an empty map. One function, `upsert`, both finds and inserts. Called without an arena, it only looks up.

The word counter from chapter 02 comes back here on top of the arena, with a hash map instead of a linear scan. To read all of standard input, call `fread` once into the arena's free space and advance `beg` by the number of bytes read. If `fread` filled the whole free space, the input was too large.

### Study

- [Chris Wellons: An easy-to-implement, arena-friendly hash map](https://nullprogram.com/blog/2023/09/30/) (read, 30 min): From the start through "Fleshing it out". Stop before "As a concurrent hash map", which needs the atomics of chapter 09.
- [Chris Wellons: A simple, arena-backed, generic dynamic array for C](https://nullprogram.com/blog/2023/10/05/) (read, 25 min): All of it. Use the macro with the fixed alignment of 16. The patch that passes `_Alignof(*(s)->data)` uses a GNU extension that clang rejects under `-Werror`. Skip the statement expression variant. The addendum is optional.
- [Beej's C Library Reference: fread()](https://beej.us/guide/bgclr/html/split/stdio.html#man-fread) (reference, as needed): `fread()` in 23.19. The next step uses `fwrite()` in 23.20 and `fflush()` in 23.6 from the same page.

### Build

Add `push`, `grow`, `str_hash` and a `Str` to `ptrdiff_t` hash trie to `src/base.c`, plus `Str read_all(FILE *f, Arena *a)`. For input that does not fit, `read_all` returns a `Str` with `len` -1.

Tests:

- Push 100 values into a zero-initialized slice: `len` 100, `cap` 128, values intact.
- Start a slice on a static array of 2 elements as in Wellons' `fibonacci`, push one more value, and check that the static array is unchanged.
- Copy a slice header, push into the copy until it grows, and check that the original header still reads its old values.
- Push 1000 values inside a scoped copy of the arena, then check that the outer arena's `beg` has not moved.
- Insert 100000 keys, each the 4 bytes of the loop counter copied into a fresh 4-byte arena allocation, with the counter as the value. Look every key up without an arena and check the value. A lookup of a key that was never inserted returns a null pointer.

Then `src/wordcount2.c`: read standard input with `read_all`, lowercase it in place with `tolower`, split it into words as chapter 02 did, count them with the hash trie, and keep the words in order of first appearance in a slice of `Str`. Print `count word` lines with `printf` for now.

### Done when

The tests pass on both machines. `wordcount2` and the chapter 02 word counter print identical output for `ls.txt` (`diff` prints nothing), and for the same file concatenated 100 times. `grep` shows one `malloc` and one `free` in `wordcount2.c` and none in `base.c`. You can say which old blocks are still in the arena after the 100-value push test and how many bytes they take.

## Buffered output

`printf` parses a format string at run time and writes through a buffer you do not control. Wellons replaces it with a buffer you append to: bytes, strings, integers. When the buffer is full it is flushed to a file, or, for a memory buffer, the append sets a sticky error flag. You check the flag once at the end instead of after every call.

Wellons' sink is an `os_write` that he leaves to the platform. Use `fwrite` and then `fflush` on a `FILE *`, from the stdio reference of the previous step. If `fwrite` returns fewer items than you asked for, or `fflush` returns `EOF`, set the error flag. The JSON serializer in step 9 writes through this buffer.

Linux has a device, `/dev/full`, on which every write fails with "No space left on device". Redirecting output there tests the error path without filling a disk.

### Study

- [Chris Wellons: Let's implement buffered, formatted output](https://nullprogram.com/blog/2023/02/13/) (read, 30 min): "The print-is-append mindset", "Buffer implementation" and "Output to a handle". Skip "Float formatting". The JSON numbers in this chapter stay as text. Use `ptrdiff_t` where the post uses `int` for sizes.

### Build

Add to `src/base.c`:

- `typedef struct { uint8_t *buf; ptrdiff_t len; ptrdiff_t cap; FILE *f; bool err; } Buf;`
- `Buf buf_mem(Arena *a, ptrdiff_t cap)` and `Buf buf_file(Arena *a, ptrdiff_t cap, FILE *f)`.
- `buf_append(Buf *b, Str s)`, `buf_byte(Buf *b, uint8_t c)`, `buf_i64(Buf *b, int64_t x)` and `buf_flush(Buf *b)`.

Tests:

- A memory buffer of capacity 5: appending `"hello"` leaves `err` false. Appending `"!"` sets `err` and `len` stays 5. A further append of `""` leaves `err` set.
- A memory buffer of capacity 0: any non-empty append sets `err`.
- `buf_i64` matches `snprintf` with `%lld` for 0, 1, -1, 42, `INT64_MIN`, `INT64_MAX` and 1000 values built from `rand()`. `snprintf` is allowed in tests only.

Then switch `wordcount2.c` to print through a `buf_file` on `stdout` with a capacity of 16 bytes, so it flushes many times. `main` calls `buf_flush` at the end, and if `err` is set it prints a message to `stderr` and returns 1.

### Done when

The tests pass. `wordcount2` output still matches chapter 02 byte for byte. In the VM, `./out/Linux-debug/wordcount2 < ls.txt > /dev/full; echo $?` prints your error message and 1. `grep -n printf src/base.c src/wordcount2.c` finds only the `stderr` message, written with `fprintf`.

## A JSON parser: grammar, values, numbers and arrays

JSON has a short formal grammar in RFC 8259, written in ABNF. Read it like this: `/` separates alternatives, `*` before an element means zero or more, `[ ]` means optional, `%x5B` is the byte 0x5B, and `%x30-39` is the range of digits. `ws` is the whitespace allowed around structural characters: space, tab, line feed and carriage return.

A recursive descent parser turns each grammar rule into one function. Your parser keeps the input as a `Str` and an offset into it. Each function looks at the byte at the offset, consumes what its rule allows, and calls the function for any rule nested inside. `value` calls `array`, and `array` calls `value` for each element, so nesting becomes recursion:

```
  parse(in):  ws, value, ws, then the offset must equal in.len

  value:   'n' -> literal "null"     't' -> "true"     'f' -> "false"
           '['  -> array              '"' -> string      '{' -> object
           '-' or a digit -> number   anything else -> error here

  array:   '[' ws
           if ']': done
           loop: value ws
                 ',' ws -> next element
                 ']'    -> done
                 else   -> error here
```

Every read checks the offset against `in.len` first. The input is not zero-terminated, and it may contain zero bytes. The first error records its byte offset and a message, and every function returns as soon as an error is recorded. The offset of an error is the first byte that cannot continue a valid document, or `in.len` when the input ends too early. A depth counter counts the arrays and objects that are open, so a file of 100000 `[` characters gives an error instead of a stack overflow. RFC 8259 section 9 allows these limits.

A JSON value is a tagged struct: an `enum` saying which kind of value it is and the fields that kind uses. Numbers are validated against the grammar and kept as their text, the lexeme. That keeps 64-bit IDs and huge exponents exact, and it decides the question step 2 raised. A caller that wants an integer calls `str_parse_i64` on the text from step 5.

```c
typedef enum { JSON_NULL, JSON_FALSE, JSON_TRUE, JSON_NUMBER,
               JSON_STRING, JSON_ARRAY, JSON_OBJECT } JsonKind;

typedef struct Json Json;
typedef struct { Json *data; ptrdiff_t len; ptrdiff_t cap; } Jsons;
struct Json {
    JsonKind kind;
    Str      text;    /* number lexeme now, string contents next step */
    Jsons    items;   /* array elements */
};
```

### Study

- [RFC 8259: The JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259#section-2) (read, 30 min): Sections 2, 3, 5, 6 and 9. Section 4 on objects and section 7 on strings belong to the next step. Draw the number grammar of section 6 as a diagram of states before you code it.
- [Crafting Interpreters: Recursive Descent Parsing](https://craftinginterpreters.com/parsing-expressions.html#recursive-descent-parsing) (read, 15 min): Section 6.2 up to 6.2.1, with the table that maps grammar notation to code. Skim 6.2.1 for the shape of the functions. The code is Java and uses classes from earlier chapters of that book, so read it for structure only.
- [Beej's Guide to C: Enumerated Types](https://beej.us/guide/bgc/html/split/enumerated-types-enum.html) (read, 10 min): Sections 22.1 to 22.2.

### Build

Write `src/json.c` with no `main`. Programs include `base.c`, then `json.c`.

- `typedef struct { Json *value; bool ok; ptrdiff_t err_pos; Str err; } JsonResult;`
- `JsonResult json_parse(Str in, Arena *perm, int max_depth)` for `null`, `true`, `false`, numbers and arrays. Strings and objects come next step. Until then, return an error at their first byte.
- `I64Parsed json_i64(Json *v)` for numbers.
- `src/jsoncheck.c` reads standard input with `read_all`, parses it with a depth limit of 512, and returns 0 on success. On failure it prints `error at byte N: message` to `stderr` and returns 1.

Tests. These inputs parse:

- `null`, `true`, `false`, `123`, `-0`, `[]`, `[ ]`, `[1, -0, 2.5e10, 1E-2, 0.5]` and `[[[]], [false]]`, then each of them again with a space, a tab, a line feed and a carriage return before and after it.
- `json_i64` on `9223372036854775807` gives that value, and on `9223372036854775808` and `2.5e10` it gives `ok` false while the parse itself succeeded.

These fail at the byte offset given. The inputs are the bytes between the backticks:

- The empty input at 0, `+1` at 0, `.5` at 0, `[1,]` at 3, `[1 2]` at 3, `01` at 1, `-` at 1, `1.` at 2, `1e` at 2, `[` at 1, `[1]x` at 3, `tru` at 3, `[NaN]` at 1.
- The 4 bytes `[1]` followed by a zero byte fail at 3.
- 512 nested arrays parse. 513 fail at offset 512.

### Done when

Every test passes on the Mac and in the VM with no sanitizer report. For each failing input you can point at the line of the RFC grammar that rules it out. You can explain why the zero-byte case would pass if the parser stopped at the first zero byte.

## Strings, objects and the serializer

A JSON string is a quote, then characters, then a quote. Raw bytes from 0x00 to 0x1F are not allowed inside. A backslash starts an escape: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, or `\u` followed by four hex digits. Store the decoded bytes. If a string has no backslash, its decoded bytes equal its raw bytes, so the `Str` points straight into the input and copies nothing. Otherwise allocate a buffer the size of the raw text and decode into it. Decoding never makes a string longer, as the escape table shows:

```
  escape              bytes in    UTF-8 bytes out
  \n                  2           1
  \u00e9              6           2    C3 A9
  \u20ac              6           3    E2 82 AC
  \ud834\udd1e        12          4    F0 9D 84 9E   (one code point, U+1D11E)
```

`\u` escapes name UTF-16 code units. A code point above U+FFFF arrives as two escapes, a high surrogate from D800 to DBFF and then a low surrogate from DC00 to DFFF. RFC 2781 gives the arithmetic that joins them into one code point. RFC 3629 gives the table that turns a code point into 1 to 4 UTF-8 bytes. A lone surrogate is a case the RFC leaves open. Pick reject or accept and write your choice down.

An object keeps its members in input order: a slice of keys next to the `items` slice of values. For lookup, put a hash trie from the key to the member's index on the object. RFC 8259 section 4 says names should be unique and does not forbid duplicates. Keep every member for the serializer, and have `json_get` return the last value for a duplicated key.

The serializer walks the tree and appends to a `Buf` in compact form, with no whitespace. Numbers write their lexeme. Strings write `\"`, `\\` and the escapes for bytes below 0x20 (`\n`, `\t`, `\r`, `\b`, `\f`, and `\u00XX` for the rest), and every other byte as it is.

### Study

- [RFC 8259: Objects, Strings and Character Issues](https://www.rfc-editor.org/rfc/rfc8259#section-4) (read, 20 min): Section 4, then section 7 and sections 8.1 to 8.3.
- [RFC 3629: UTF-8 definition](https://www.rfc-editor.org/rfc/rfc3629#section-3) (reference, as needed): The table in section 3 and the four encoding steps under it.
- [RFC 2781: Decoding UTF-16](https://www.rfc-editor.org/rfc/rfc2781#section-2.2) (reference, as needed): Section 2.2 joins a surrogate pair into one code point.

### Build

Extend `Json` with `Strs keys`, where `Strs` is a slice of `Str` with `data`, `len` and `cap`, and with an index for objects: the `Str` to `ptrdiff_t` hash trie from step 6, mapping each key to its member's position. Add strings and objects to `json_parse`, then add:

- `Json *json_get(Json *object, Str key)`, which returns 0 for a missing key or a non-object.
- `void json_write(Buf *b, Json *v)`.

Tests. Each input parses, and `json_write` produces exactly the output shown:

- ` { "a" : [ 1 , 2.5e3 , true ] , "b" : null } ` gives `{"a":[1,2.5e3,true],"b":null}`.
- `"\u00e9"` gives a quote, the bytes C3 A9, and a quote.
- `"\ud834\udd1e"` gives a quote, the bytes F0 9D 84 9E, and a quote.
- `"a\u0000b"` parses to a `Str` of length 3 with a zero byte in the middle, and writes back as `"a\u0000b"`.
- `"\/"` gives `"/"`. `"tab\there"` writes back as `"tab\there"`.
- `{"x":1,"y":2,"x":3}` writes back with all three members, and `json_get` for `x` gives 3.

These fail at the offset given: `"abc` at 4, `"\x"` at 2, `{"a" 1}` at 5, `{1:2}` at 1, `{"a":1,}` at 7, and a string holding a raw tab byte at the offset of the tab.

For every input that parses, check that `json_write`, then `json_parse` of that output, then `json_write` again gives the same bytes as the first `json_write`. That shows the serializer and parser agree. It cannot show that both are right, which is why the fixed outputs above exist.

### Done when

All tests pass on both machines with no sanitizer report. For the `"a\u0000b"` case, you can show in lldb with `memory read` that the decoded string holds `61 00 62`. For a string without escapes, you can show that its `data` points into the input buffer. Your choice for lone surrogates is written in a comment at the top of `json.c`.

## Conformance, fuzzing and the memory map

Your tests so far are the cases you thought of. JSONTestSuite holds the cases other parsers got wrong. Its `test_parsing` directory has three kinds of file. A parser must accept every `y_` file and reject every `n_` file. For `i_` files the RFC allows either answer, so you record what your parser does. Seriot's article explains why each group of tests exists, and it shows how common parsers failed them.

A fuzzer writes test inputs for you. libFuzzer calls a function you write with millions of generated byte strings. It watches which branches of your code each input reaches, and it keeps and mutates the inputs that reach new ones. Run it with ASan and UBSan, and give it a property to check: here, that serializing, parsing and serializing again gives the same bytes. Apple's clang does not ship libFuzzer, so the fuzzer runs in the VM. The `clang` there has it.

### Study

- [Nicolas Seriot: Parsing JSON is a Minefield](https://seriot.ch/security/parsing_json.html) (read, 45 min): Section 1 and sections 2.1 to 2.6. Skip section 3 onward, which covers the test setup and the results for other parsers.
- [JSONTestSuite](https://github.com/nst/JSONTestSuite) (do, 3 h): Clone it with git on the Mac into your project directory, so the VM sees it under `/mnt/mac`, and add it to `.gitignore`. The README explains the `y_`, `n_` and `i_` prefixes. Use only `test_parsing/`.
- [LLVM: libFuzzer](https://llvm.org/docs/LibFuzzer.html) (read, 30 min): "Introduction", "Getting Started" (Fuzz Target, Fuzzer Usage), "Corpus", "Running", and skim "Options" for `-max_len`, `-max_total_time` and `-dict`. Skip "Advanced features" and the FAQ.

### Build

1. The suite. In the VM, run every file through the debug build of `jsoncheck`. Exit status 0 means accept and 1 means reject. Any other status, such as a sanitizer abort, is a failure for every prefix. A starting point:

```sh
#!/bin/sh
# usage: sh tests/run_suite.sh path/to/JSONTestSuite/test_parsing
rm -f i_results.txt
bad=0
for f in "$1"/*.json; do
    name=$(basename "$f")
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

   Fix every failure, then add the file's bytes as a test case in your own test program. Check `i_results.txt` for any status other than 0 or 1, and write one line per `i_` file into a section of comments at the top of `json.c` saying what your parser does and why.

2. The fuzzer. Write `tests/json_fuzz.c`, which includes `base.c` and `json.c` and defines `int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)`. Make the arena's backing block once, on the first call, with `malloc`, and keep the pointer in a `static` variable. On each call, take a fresh copy of the arena header, parse the input with depth limit 512, and if it parses, serialize into a memory `Buf` of twice the input size plus 16 bytes, parse that output and serialize it again. Call `abort()` if a `Buf` reports an error, the second parse fails or the two outputs differ. Build and run it in the VM:

```sh
clang -std=c11 -g -O1 -fsanitize=fuzzer,address,undefined -o out/json_fuzz tests/json_fuzz.c
mkdir -p corpus && cp JSONTestSuite/test_parsing/y_*.json corpus/
./out/json_fuzz -max_len=4096 -max_total_time=1800 corpus/
```

   Every crash leaves a `crash-...` file. Reproduce it with `./out/json_fuzz crash-...`, fix the bug, and add the input to your tests.

3. The memory map. Save `{"name":"caf\u00e9","tags":["a","b"],"n":12}` as `doc.json`. In lldb, set a breakpoint on the line after `json_parse` in `jsoncheck` and start the program with `process launch -i doc.json`, which connects the file to standard input. With `memory read` starting at the arena's block, find the input bytes, each `Json` node, each slice's backing block, the hash trie nodes, and the decoded `café`. Write the map as a comment in `jsoncheck.c`: offset ranges and what each holds, and for every `Str` in the tree, whether its bytes are in the input or in a decoded copy.

### Done when

`sh tests/run_suite.sh` reports 0 failures in the VM, with no sanitizer output, and every `i_` file has a line of explanation in `json.c`. The fuzzer ran for 30 minutes without a crash after your last fix. `grep -rn 'malloc\|free(' src tests` shows only the arena blocks in each `main` and in the fuzz target. Your memory map accounts for every byte the parse used, padding included.

## Where this leads

You can now say what C guarantees about a value and what it leaves undefined. You have checked those rules against the optimizer and the sanitizers, and you have a library that gets by with one allocation per program. The JSON parser shows the pattern this book uses for the rest of part one: a cursor over bytes, a grammar turned into functions, errors with exact offsets, and tests that come from a specification instead of from memory.

What you have not looked at is the code the compiler made from all this. You saw a few instructions in chapter 02 and deleted comparisons in step 3, but you cannot yet say how a `Str` crosses a function call, why `json_parse` can return a struct, or what happens when two `.c` files call each other. Every program in this chapter is one translation unit, so nothing has needed linking. Chapter 05, Assembly, the ABI and linking, writes ARM64 and x86-64 by hand, explains the calling convention and object files, and then builds an 8086 instruction decoder that pulls bit fields out of bytes and sign-extends displacements, as `get_byte` and `sign_extend` did in step 1.
