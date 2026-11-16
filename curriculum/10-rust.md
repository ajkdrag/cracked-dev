---
id: 10
title: Rust
part: Languages and compilers
weeks: 8
project: The chapter 07 Swiss table and the chapter 08 event-loop HTTP server ported to Rust, passing the same tests and benchmarked against the C versions.
---

Chapter 09 ended with a job system in C: threads, a queue you tested and a memory model you wrote down. Before that you freed every allocation on every path, kept views into an arena valid only while the arena lived, closed every socket in the event loop exactly once and put a lock around shared data. All of those rules lived in your head and in comments. The compiler checked none of them. Sanitizers and tests found the mistakes after you made them.

Rust checks most of those rules when it compiles. Every value has one owner, and the value is freed when its owner goes out of scope. A reference is either shared or mutable, never both at once, and it cannot outlive the value it points to. Applied to threads, the same rules reject data races in code that does not use `unsafe`. Where the rules are too strict, you write `unsafe` and take over the proof, as you did in every line of C. This chapter teaches enough Rust to port two of your programs: the Swiss table from chapter 07 and the event-loop HTTP server from chapter 08. Both ports run the tests and benchmarks of the C originals, and you write down what each port cost and what the compiler caught.

The chapter comes after C on purpose. You have done ownership by hand, so the borrow checker's errors describe bugs you have already met: a pointer kept after `free`, an element pointer that dies when a growable array moves, a descriptor closed twice. The school this book follows is split on Rust. Its defenders point at the class of memory bugs it removes. Its critics point at the borrow checker's resistance to many systems writing into one shared array, the data-oriented style of chapter 07. You finish the chapter with your own numbers on both sides.

The first three steps teach the language on programs you already wrote in C: the word counter from chapter 02 and the Hack assembler from chapter 03. The Rust Book is the main text, Rustlings gives you drill, and Aria Desires' book on linked lists shows the borrow checker's hard cases. Steps 4 and 5 port the hash table, first in safe Rust and then with NEON and `unsafe`. Step 6 shares it between threads. Steps 7 and 8 port the server. Your Mac and your Linux VM are both ARM64, so every program in this chapter builds and runs on both.

## Cargo, syntax and ownership

Rust comes with Cargo, a build tool and package manager in one program. `cargo new wordcount` creates a directory with `Cargo.toml`, which names the package and its dependencies, and `src/main.rs`. `cargo build` makes a debug build in `target/debug`, `cargo build --release` an optimized one in `target/release`, `cargo run` builds and runs, and `cargo test` runs the tests. Install Rust with rustup, as section 1.1 of the Rust Book shows, on the Mac and in the Linux VM. The book assumes the 2024 edition, which `cargo new` writes into `Cargo.toml`.

Two habits from chapter 04 change. Integer overflow is defined in Rust. A debug build panics when an addition overflows, and a release build wraps around in two's complement. Indexing past the end of an array panics instead of reading someone else's memory. A panic prints a message and unwinds the thread, which ends the program if it is the main thread.

Ownership maps onto what you did by hand in chapters 02 and 04:

```
  C                                          Rust
  char *w = malloc(n); ... free(w);          let w = String::new();   freed when w goes out of scope
  a table that owns heap copies of words     Vec<(String, u64)> owns its Strings
  const char *start, size_t len              &str or &[u8]: pointer and length in one value
  "the caller now owns this", in a comment   pass by value: a move, the old name is unusable
  "do not free this", in a comment           &T shared or &mut T exclusive, checked by the compiler
```

The borrow rules look like this in code:

```rust
let a = String::from("hi");
let mut b = a;                 // ownership moves to b, a is unusable now
let c = &b;
let d = &mut b;                // rejected, because c is used on the next line
println!("{c} {d}");

let mut text = String::from("hi");
let reader = &text;
println!("{reader}");          // reader's last use
let writer = &mut text;        // accepted: no shared borrow is live any more
writer.push('!');
```

A borrow ends at its last use, not at the closing brace. Chapter 4 of the Rust Book works through these rules with diagrams of the stack and the heap that match the ones you drew in chapter 02.

The word counter reads bytes, so give it a `&[u8]`. Input that is not valid UTF-8 then cannot stop it. `u8` has the methods `is_ascii_alphabetic` and `to_ascii_lowercase`, and `byte as char` turns an ASCII byte into a `char` you can push onto a `String`. To read all of standard input, call `std::io::stdin().read_to_end(&mut buf)` with `use std::io::Read;` at the top of the file. The `use` brings the trait that defines `read_to_end` into scope. Step 3 explains traits.

Tests live in the same file as the code, in a module that only test builds compile:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_word_any_case() {
        let t = count_words(b"The THE the");
        assert_eq!(t, vec![("the".to_string(), 3)]);
    }
}
```

Rust's `Vec` and `String` abort the process when the allocator fails, so the allocation-failure tests from chapter 02 have no direct port. Leave them out.

### Study

- [The Rust Programming Language, chapters 1 to 3](https://doc.rust-lang.org/book/ch01-00-getting-started.html) (read, 2 h 30 min): Chapter 1 (installation, Hello Cargo), chapter 2 (the guessing game, typed in and run) and chapter 3 (sections 3.1 to 3.5). Use the arrow at the bottom of each page to move on. Read 3.2's "Integer Overflow" closely.
- [The Rust Programming Language, chapter 4: Understanding Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html) (read, 1 h 30 min): Sections 4.1 to 4.3. Redraw the stack and heap figures in 4.1 and 4.2 next to your chapter 02 drawings.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 3 h): Install it as the page shows, then do the exercises from `00_intro` to `06_move_semantics`, with the first quiz. Stop before `07_structs`.

### Build

1. `cargo new wordcount`. Write `fn count_words(text: &[u8]) -> Vec<(String, u64)>`. A word is a run of ASCII letters, stored lowercase, and the result lists words in order of first appearance. Find a word with a linear scan in a `for` loop over `&mut` entries, as the C version did.
2. `main` reads standard input into a `Vec<u8>`, calls `count_words` and prints one `count word` line per entry.
3. Port the chapter 02 tests that do not involve allocation failure: case folding, "th", "the" and "then" as three entries, `The cat. the dog; THE end 42 don't`, the empty and punctuation-only inputs, leading whitespace, and 50000 copies of "the ".
4. Write one function that compiles in C but not in Rust. Take a reference to the first entry of a `Vec`, push a new entry, then read through the reference. Copy the compiler's error into a comment above the function.

### Done when

`cargo test` passes on the Mac and in the VM. The shell comparison from chapter 02 prints nothing:

```sh
cargo run --release < ls.txt | sort > mine.txt
LC_ALL=C tr -cs 'A-Za-z' '\n' < ls.txt | LC_ALL=C tr 'A-Z' 'a-z' \
  | grep -v '^$' | sort | uniq -c | awk '{print $1, $2}' | sort > shell.txt
diff mine.txt shell.txt
```

For each variable in `count_words` you can say whether it owns its value or borrows it, and where each `String` is created and freed. You can name the chapter 02 bug that the compiler error in build task 4 prevents: the growable array moved its storage while a pointer into it was still in use.

## Structs, enums and errors: the Hack assembler

A Rust `struct` is a C struct with methods attached in an `impl` block. A Rust `enum` is a tagged union whose tag the compiler checks. Each variant can carry its own data, and `match` must handle every variant or the program does not compile:

```
  Rust                                         C, from chapter 03's point of view
  enum Line {                                  struct Line {
      A(Operand),                                  enum { LINE_A, LINE_C, LINE_LABEL } tag;
      C { dest: u8, comp: u8, jump: u8 },          union { struct Operand a; struct Cfields c;
      Label(String),                                       char *label; } as;
  }                                            };

  match line {                                 switch (line.tag) { ... }
      Line::A(op) => ...,                      forgetting a case compiles in C,
      Line::C { dest, comp, jump } => ...,     and is an error in Rust
      Line::Label(_) => ...,
  }
```

Two enums from the standard library replace two C conventions. `Option<T>` is either `Some(value)` or `None`, which replaces a NULL pointer. `Result<T, E>` is either `Ok(value)` or `Err(error)`, which replaces the `bool` return plus out-parameter of chapter 03's `encode_a`. The `?` operator returns early with the error when a `Result` is an `Err`, so a function that calls five fallible functions does not need five `if` blocks. `HashMap<String, u16>` replaces the symbol table you wrote with a linear scan.

Strings in Rust are UTF-8. `String` owns its bytes and `&str` borrows them. Chapter 8 of the Rust Book explains why you cannot index a `String` by an integer. Hack source is ASCII, so this rarely matters here, but `str::lines()` and `trim()` do the line splitting and space removal that took a page of C. `str::lines()` also removes the `\r` of a `\r\n` ending. `println!("{:016b}", word)` prints a `u16` as 16 binary digits, which replaces `word_to_bits`.

### Study

- [The Rust Programming Language, chapters 5 to 7](https://doc.rust-lang.org/book/ch05-00-structs.html) (read, 2 h 30 min): Structs and methods, enums and `match`, then packages, crates and modules. Chapter 7 tells you how to split the assembler into files. Skim 7.1, which repeats Cargo basics.
- [The Rust Programming Language, chapters 8 and 9](https://doc.rust-lang.org/book/ch08-00-common-collections.html) (read, 2 h 30 min): Vectors, strings and hash maps, then error handling with `panic!`, `Result` and `?`. Then section 11.1, "How to Write Tests", from the table of contents. Skip the rest of chapter 11 and all of chapter 12.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 3 h): Exercises `07_structs` to `13_error_handling`, with the second quiz.

### Build

Make a Cargo project `hasm` and port chapter 03's assembler, symbols included. Split it into `src/main.rs`, `src/parse.rs` and `src/code.rs`.

1. The data: `enum Operand { Num(u16), Sym(String) }`, the `Line` enum above, and `struct AsmError { line: usize, text: String, msg: &'static str }`.
2. The functions: `fn parse_line(line: &str) -> Option<Line>` (`None` for a blank or comment line), `fn encode_a(s: &str) -> Option<u16>`, `fn encode_c(s: &str) -> Option<u16>` and `fn assemble(text: &str) -> Result<Vec<u16>, AsmError>`, which runs both passes. The symbol table is a `HashMap<String, u16>` loaded with the 23 predefined symbols.
3. `main` reads standard input into a `String`, calls `assemble`, and prints every word with `{:016b}`. On an error it prints `line N: TEXT: MESSAGE` to standard error with `eprintln!` and exits with `std::process::exit(1)`.
4. Port every test case from chapter 03 into `#[test]` functions: the `encode_c` and `encode_a` values, the failing inputs, the `DM` alias, the two-line `assemble` cases, variables at 16 and 17, a label used before its definition, `@LOOP` and `@loop` as different symbols, and a label defined twice as an error.

### Done when

`cargo test` passes. `cargo run --release < Pong.asm` matches your C assembler's output for Pong, and `diff` against the reference files prints nothing for Add, Max and Rect, as in chapter 03. `D=Q` on line 2 of a file makes the program print the line and exit with status 1. You have counted every `.clone()` and `.to_string()` in the program and can say why each one is there.

## Generics, traits, lifetimes and too many linked lists

Generics let one function or type work for many types. `fn largest<T: PartialOrd>(list: &[T]) -> &T` works for any `T` that can be compared. The compiler makes one copy of the code per type it is used with, like a macro in chapter 04 that the compiler type-checks. A trait is a set of methods that a type promises to provide. `PartialOrd` is a trait, and so are `Display` (formatting with `{}`), `Iterator` (a `next` method that returns an `Option`) and `Drop` (code that runs when a value is freed). Trait bounds such as `T: PartialOrd` say which promises the generic code relies on.

A lifetime is the compiler's name for how long a borrow stays valid. Most of the time the compiler infers it. You write one when a function or struct returns or stores a borrow and the compiler cannot tell where it came from:

```rust
fn first_word<'a>(s: &'a str) -> &'a str { ... }   // the result lives no longer than s

struct Token<'a> { text: &'a str }                   // a Token cannot outlive the text it points into
```

This is the rule you followed in chapter 04 for a `Str` that pointed into an arena: the view is valid while the arena lives and its memory is not reset. In C the rule was a comment. In Rust `Token<'a>` carries it, and code that frees the text while a `Token` still exists does not compile.

Closures are anonymous functions that can capture variables from their surroundings. Iterator methods such as `map`, `filter` and `position` take closures, and step 6 passes closures to threads.

The linked-list book exists because a linked list is easy in C and hard in safe Rust. Each node owns the next one through a `Box<T>`, Rust's owning heap pointer. Moving a value out of a node while the list still points to it is exactly what the borrow checker forbids, so the book teaches `Option::take`, `mem::replace`, `Drop` and iterators with lifetimes by running into each error and fixing it. The book was written for the 2018 edition. Where your compiler's message differs from the text, trust the compiler.

### Study

- [The Rust Programming Language, chapter 10: Generic Types, Traits, and Lifetimes](https://doc.rust-lang.org/book/ch10-00-generics.html) (read, 2 h 30 min): Sections 10.1 to 10.3. Then sections 13.1, 13.2 and 13.4 from the table of contents, on closures, iterators and their performance. Skip 13.3, which builds on chapter 12.
- [Learning Rust With Entirely Too Many Linked Lists](https://rust-unofficial.github.io/too-many-lists/first.html) (do, 6 h): Chapters 2 to 4: "A Bad Stack", "An Ok Stack" and "A Persistent Stack". Type every listing and run every test. Stop before chapter 5, "A Bad Safe Deque".
- [Rustlings](https://rustlings.rust-lang.org/) (do, 2 h): Exercises `14_generics` to `18_iterators`, with the third quiz.

### Build

1. A `lists` crate with the code from the linked-list book's chapters 2 to 4 and all of its tests.
2. Back in `hasm`, make the parser borrow from the source text instead of copying. Change the line type to `enum Line<'a>` with `Label(&'a str)` and `Operand::Sym(&'a str)`. The symbol table still owns its names as `String`.
3. Write `struct SourceLines<'a>` that implements `Iterator<Item = (usize, &'a str)>`. It yields the line number and the line with its comment cut off and surrounding spaces trimmed, and skips empty lines. A line that still contains a space is an error that names the line.
4. Implement `std::fmt::Display` for `AsmError`, so `main` prints it with `{}`.

### Done when

`cargo test` passes in `lists` and in `hasm`, and the Pong output still matches. The assembler now allocates a `String` only when it adds a symbol to the table, and none per line. Remove `'a` from `Line` and copy the first line of the error. You can say why the linked-list book's `Iter<'a, T>` needs a lifetime and `IntoIter<T>` does not.

## The Swiss table in safe Rust

The C Swiss table from chapter 07 kept three arrays in an arena: control bytes, keys and values. The Rust version keeps them in three `Vec`s that the table owns:

```rust
pub struct Swiss {
    ctrl: Vec<u8>,    // one byte per slot: EMPTY 0x80, DELETED 0xfe, or the key's H2
    keys: Vec<u64>,
    vals: Vec<u64>,
    live: usize,
    tombstones: usize,
}

impl Swiss {
    pub fn with_slots(slots: usize) -> Swiss { ... }
    pub fn get(&self, key: u64) -> Option<u64> { ... }
    pub fn put(&mut self, key: u64, val: u64) -> Option<u64> { ... }   // returns the old value
    pub fn del(&mut self, key: u64) -> Option<u64> { ... }
}
```

The signatures carry the rules. `get` takes `&self`, so any number of readers may look up at once. `put` and `del` take `&mut self`, so while one of them runs nobody else holds a reference into the table. When the table grows, `put` builds three new `Vec`s, inserts every live key and assigns them to the fields. Assigning drops the old `Vec`s and frees their memory. In C the old arrays stayed in the arena until it was reset.

Every `ctrl[i]` in safe Rust checks `i < ctrl.len()` and panics if it fails. That check is a compare and a branch, and the optimizer removes it when it can prove the index is in range. Slicing once, as in `let group = &ctrl[start..start + 16];`, and then indexing the slice often removes the checks inside the loop. The Rust Performance Book's "Bounds Checks" chapter lists the ways. Read the assembly to see which checks remain. Compiler Explorer from chapter 02 compiles Rust too. For a whole crate, this writes one `.s` file per crate into `target/release/deps`:

```sh
cargo rustc --release -- --emit asm
```

A failed check shows up as a branch to a function whose name contains `panic_bounds_check`.

Port the repetition tester from chapter 07 for the benchmark. `std::time::Instant::now()` reads a monotonic clock, and `elapsed()` gives a `Duration`. `std::hint::black_box(x)` tells the optimizer it must assume `x` is used, which stops it from deleting the work you time. Take the test as a closure, `FnMut() -> u64`, that returns a checksum.

Rust's own `HashMap` is a port of Google's Swiss table, so it makes a fair third column in the benchmark. By default it hashes keys with SipHash, which resists attackers who choose keys to cause collisions and costs more than your splitmix finalizer. A `HashMap` takes its hasher as a type parameter, and implementing the `Hasher` trait is a short exercise in traits:

```rust
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default)]
struct SplitMix(u64);

impl Hasher for SplitMix {
    fn write(&mut self, _bytes: &[u8]) { unimplemented!("u64 keys only") }
    fn write_u64(&mut self, x: u64) { self.0 = x; }
    fn finish(&self) -> u64 {
        let mut x = self.0;
        x = (x ^ (x >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        x = (x ^ (x >> 27)).wrapping_mul(0x94d049bb133111eb);
        x ^ (x >> 31)
    }
}

type FastMap = HashMap<u64, u64, BuildHasherDefault<SplitMix>>;
```

`wrapping_mul` asks for the wrapping multiplication the C code got for free. A plain `*` would panic on overflow in a debug build.

From this step on, keep a file `NOTES.md` in the project. Every time the compiler rejects code that would have been a bug in C, write one line about it. Every time a test catches a bug the compiler accepted, write one line about that. Step 8 turns these notes into numbers.

### Study

- [The Rust Performance Book: Build Configuration](https://nnethercote.github.io/perf-book/build-configuration.html) (read, 1 h): Nicholas Nethercote's short book on Rust performance. Read "Release Builds" and "Maximizing Runtime Speed" up to "Profile-guided Optimization", then the chapters "Inlining", "Bounds Checks" and "Machine Code" from the sidebar. Skip the rest for now.
- [Rust standard library: HashMap](https://doc.rust-lang.org/std/collections/struct.HashMap.html) (reference, as needed): The description at the top (SipHash, the SwissTable port), `with_hasher` and `with_capacity_and_hasher`, and the `entry` API if you use the map as a test oracle.
- [Rust standard library: black_box](https://doc.rust-lang.org/std/hint/fn.black_box.html) (reference, as needed): What it promises and what it does not. It is a hint, so check the assembly when a timing looks too good.

### Build

Make a library crate `swiss` with the table in `src/lib.rs` and the benchmark in `src/bin/swissbench.rs`.

1. The table with 16-byte groups and a scalar group match: a loop over the 16 control bytes that sets bit `4 * i + 3` of a `u64` for every byte `i` that equals H2, the same mask chapter 07's NEON code produced. Use `hash_u64` from chapter 07, H1 and H2 as before, triangular probing, tombstones and the 7/8 load limit.
2. The four tests from chapter 07, with `std::collections::HashMap` as the oracle in place of the hash trie: one million random keys present and absent, two million random puts, gets and deletes checked step by step, 65,536 keys that differ only in their top 16 bits with the longest probe sequence printed, and enough deletes and inserts to force a rebuild. Generate keys with the splitmix64 generator so a seed reproduces a run.
3. The repetition tester in Rust, and `swissbench` with the same measurements as chapter 07: a table of 2^20 slots at 524,288 and 917,504 keys, inserts, lookups of present keys in random order and lookups of absent keys, in nanoseconds per operation. Run the same operations on `HashMap` with SipHash and on `FastMap`.
4. Build the benchmark twice: with the default release profile, and with `codegen-units = 1` and `lto = true` under `[profile.release]` in `Cargo.toml`.

### Done when

The tests pass in a debug and a release build on the Mac and in the VM. You have a table with your Rust Swiss table, the C scalar version from chapter 07 run on the same day, `HashMap` and `FastMap`, for three operations at two fills. You can say how far the Rust table is from the C one and point at the instructions in `get` that differ, including every remaining branch to `panic_bounds_check`. You can explain the gap between `HashMap` and `FastMap` from the cost of the hash.

## Unsafe Rust, NEON and Miri

`unsafe` unlocks five operations that the compiler cannot check: dereferencing a raw pointer, calling an `unsafe` function, using a mutable static, implementing an `unsafe` trait and reading a union field. It does not switch off the borrow checker for references. An `unsafe` block says "I checked this by hand", and the rest of the program trusts it. A safe function that contains an `unsafe` block must be correct for every input a safe caller could pass. Otherwise safe code can cause undefined behavior through it. The standard library and mio, which you read in step 7, put a `// SAFETY:` comment above each `unsafe` block that states what the author checked. Do the same.

The NEON intrinsics from chapter 07 exist in Rust under the same names in `std::arch::aarch64`. A load such as `vld1q_u8` takes a raw pointer, so it is an `unsafe` function. The arithmetic intrinsics are safe functions marked as requiring the `neon` target feature. Rust still makes you call them from an `unsafe` block, or from a function marked `#[target_feature(enable = "neon")]`, even though both of your targets enable NEON by default. The 16-byte group match from chapter 07 becomes:

```rust
use std::arch::aarch64::*;

pub struct Neon16;

impl GroupMatch for Neon16 {
    const WIDTH: usize = 16;
    const STRIDE: u32 = 4;            // bits per control byte in the mask

    fn matches(group: &[u8], h2: u8) -> u64 {
        let group: &[u8; 16] = group.try_into().unwrap();
        // SAFETY: NEON is part of the baseline of aarch64-apple-darwin and
        // aarch64-unknown-linux-gnu, and vld1q_u8 reads exactly the 16 bytes
        // that `group` refers to.
        unsafe {
            let eq = vceqq_u8(vld1q_u8(group.as_ptr()), vdupq_n_u8(h2));
            let nib = vshrn_n_u16::<4>(vreinterpretq_u16_u8(eq));
            vget_lane_u64::<0>(vreinterpret_u64_u8(nib)) & 0x8888_8888_8888_8888
        }
    }
}
```

`GroupMatch` is a trait you write with the two constants and `matches`. Make the table generic over it, `Swiss<M: GroupMatch>`, and write `Scalar`, `Neon16` and `Neon8` implementations. The compiler makes one copy of the table per matcher, the compile-time selection you did with the preprocessor in chapter 07. The table stores no value of type `M`, so add a field `_m: std::marker::PhantomData<M>` to tell the compiler the type parameter is used. The `try_into` checks that the slice has 16 bytes. When the caller slices with a constant width, the optimizer removes that check. Look for it in the assembly.

Miri runs a program in an interpreter that checks every memory access against Rust's rules. It reports reads out of bounds, use after free, and references that break the aliasing rules, which the linked-list book calls stacked borrows. Miri needs a nightly toolchain, installed next to your stable one with `rustup +nightly component add miri`, and runs with `cargo +nightly miri test`. It is slow, so shrink the test sizes when `cfg!(miri)` is true. Miri does not implement every platform intrinsic. If it stops at a NEON call with "unsupported operation", run it on the `Scalar` matcher. Like the sanitizers of chapter 01, Miri only finds bugs on the paths your tests run.

### Study

- [The Rust Programming Language, section 20.1: Unsafe Rust](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html) (read, 1 h): The whole section, including "Creating a Safe Abstraction over Unsafe Code", "Using extern Functions to Call External Code", "Using Miri to Check Unsafe Code" and "Using Unsafe Code Correctly".
- [Learning Rust With Entirely Too Many Linked Lists, chapter 6: An Ok Unsafe Queue](https://rust-unofficial.github.io/too-many-lists/fifth.html) (do, 5 h): Sections 6.1 to 6.9. The book installs Miri with a nightly from 2022. Use plain `+nightly` instead. Section 6.5 explains the stacked borrows that Miri reports.
- [Rust core::arch::aarch64](https://doc.rust-lang.org/core/arch/aarch64/index.html) (reference, as needed): Every NEON intrinsic with its signature and whether it is `unsafe`. Search the page for `vld1q_u8`, `vceqq_u8`, `vshrn_n_u16`, `vld1_u8` and `vceq_u8`.

### Build

1. In `lists`, the unsafe queue from chapter 6 of the linked-list book. Run its tests under Miri before and after the fix in section 6.7, and keep the report Miri printed for the broken version.
2. In `swiss`, the `GroupMatch` trait and the three matchers. `Neon8` loads 8 bytes with `vld1_u8`, compares with `vceq_u8` and masks with `0x8080_8080_8080_8080`, so its stride is 8 bits. Start every group at a multiple of its width.
3. Run all four tests for each matcher, with one generic test function `fn check_all<M: GroupMatch>()` called three times.
4. Add the three matchers to `swissbench` next to the scalar results from step 4 and the C NEON results from chapter 07.
5. Run the `Scalar` tests under Miri. Then plant a bug: in a copy of `Scalar::matches`, read the control bytes through a raw pointer starting one byte past the group. Run Miri, note what it says, and delete the copy.
6. In the probe loop of `get`, replace the indexing of `keys` with `get_unchecked` in an `unsafe` block, with a `// SAFETY:` comment that states why the index is in range. Benchmark it. Keep it only if it is measurably faster.

### Done when

Miri passes the linked-list queue tests and the `Scalar` table tests, and you have its report for the planted bug. All three matchers pass the four tests in debug and release builds. Your benchmark table has the Rust and C NEON versions side by side, and you can explain any difference from the assembly of the group match. `grep -n unsafe src/` lists only blocks with a `// SAFETY:` comment above them, and you can defend each one.

## Threads, Send and Sync

In chapter 09 you kept data races out of C by discipline. Rust encodes that discipline in two traits. A type is `Send` if a value of it can move to another thread. A type is `Sync` if a shared reference to it can be used from several threads at once. The compiler derives both for a struct from its fields. `Rc<T>`, a reference count without atomics, is neither. `Arc<T>` uses atomic counts and is `Send` and `Sync` when `T` allows it. `Cell` and `RefCell`, which allow mutation through a shared reference, can move to another thread but are not `Sync`. `Mutex<T>` is `Sync`, and the only way to reach the `T` inside is through the guard that `lock()` returns.

Your `Swiss` holds only `Vec`s of integers, so it is `Send` and `Sync` without a line of code. A shared `&Swiss` may go to many threads at once, which suits a read-only table. `std::thread::spawn` requires a `'static` closure, because the thread may outlive the function that started it. `std::thread::scope` joins every thread it started before it returns, so its threads can borrow local variables:

```rust
let table = build_table();                        // owned by this function
std::thread::scope(|s| {
    for chunk in keys.chunks(keys.len() / threads) {
        s.spawn(|| lookup_all(&table, chunk));    // borrows table and keys
    }
});                                               // every thread has joined here
```

Writes need a lock. A sharded table puts one `Mutex<Swiss>` in each of N shards and picks the shard from the top bits of the hash, so threads that write different shards rarely wait for each other. Shards next to each other in memory can still slow each other down. A `Mutex` is a few bytes, and Apple's cache lines are 128 bytes, as you measured in chapter 07. Several locks then share one line, and every lock operation on one core pulls the line away from the others. That effect is called false sharing. `#[repr(align(128))]` on a wrapper struct gives each shard its own line.

Mara Bos is a former lead of the Rust library team. The first chapter of her book covers threads, scoped threads, `Rc` and `Arc`, interior mutability, `Send` and `Sync`, and Rust's `Mutex` for readers who know concurrency from another language.

### Study

- [Mara Bos: Rust Atomics and Locks, chapter 1: Basics of Rust Concurrency](https://marabos.nl/atomics/basics.html) (read, 2 h): From "Threads in Rust" through "Locking: Mutexes and RwLocks". "Waiting: Parking and Condition Variables" is optional, since chapter 09 covered condition variables. The rest of the book is the Rust version of chapter 09's atomics and is not needed here.
- [Rust standard library: thread::scope](https://doc.rust-lang.org/std/thread/fn.scope.html) (reference, as needed): The example, and the rules for borrowing from the enclosing function.

### Build

1. Three programs that must not compile. Spawn a thread with `std::thread::spawn` that borrows a local table. Send an `Rc<Swiss>` to a spawned thread. Call `put` on the same table from two scoped threads. Copy the first line of each error into `NOTES.md` with the C bug it corresponds to.
2. Add a `probes: Cell<u64>` field to `Swiss` that `get` increments, and try to share the table between scoped threads again. Copy the error, then remove the field.
3. Parallel lookups: fill a `Swiss<Neon16>` with 917,504 keys, then look up all of them in random order from 1, 2, 4 and P scoped threads, where P is the number of performance cores from `sysctl hw.perflevel0.physicalcpu`. Print lookups per second for each thread count.
4. `Sharded<M>` with N shards of `Mutex<Swiss<M>>`. Insert 917,504 keys from P threads, each inserting its own share of the keys. Compare N = 1 and N = 64, and N = 64 with and without `#[repr(align(128))]` on the shard. Check the final contents against a `HashMap` filled from one thread.

### Done when

`NOTES.md` has four compiler errors, each with the C bug it would have been. You have lookups per second for each thread count and can say why lookups scale and where they stop. You have insert times for the three sharded layouts and can explain each one with lock contention and false sharing. You can say why `Swiss` is `Sync` without an `unsafe impl`, and what the `Cell` field changed.

## The event loop over epoll and kqueue

The C server from chapter 08 used one thread, nonblocking sockets, a `loop.h` interface over `epoll` and `kqueue`, a fixed array of client slots and bounded buffers. The Rust port keeps that design. What changes is who closes what.

The standard library's `TcpListener` and `TcpStream` own their descriptors and close them when they are dropped. `set_nonblocking(true)` sets `O_NONBLOCK`, and a read that would block returns an error whose `kind()` is `std::io::ErrorKind::WouldBlock`, the Rust name for `EAGAIN`. Three chores from chapter 08 are already done for you. `TcpListener::bind` sets `SO_REUSEADDR` on Unix. The Rust runtime sets SIGPIPE to ignored before `main` runs, so a write to a closed peer returns an error of kind `BrokenPipe`. And a closed client cannot leak its descriptor, because dropping the `Client` drops its `TcpStream`. Only `epoll` and `kqueue` have no wrapper in the standard library, and you call them through the `libc` crate, which declares the C functions and structs for each platform.

```
  Server
    listener   TcpListener            owns the listening socket
    poller     Epoll or Kqueue        owns the epoll or kqueue descriptor as an OwnedFd
    clients    Vec<Option<Client>>    slot i is token i, plus a free list of slots
      Client { stream: TcpStream, input: [u8; 4096], used: usize,
               output: Vec<u8>, sent: usize, last_seen: Instant }

  closing client i:  poller.forget(stream) and then clients[i] = None
                     dropping the Client closes the socket
```

Put the two system interfaces behind a trait, the Rust form of `loop.h`, and pick the implementation with conditional compilation:

```rust
pub struct Event { pub token: usize, pub readable: bool, pub writable: bool, pub closed: bool }

pub trait Poller: Sized {
    fn new() -> std::io::Result<Self>;
    fn watch(&mut self, fd: BorrowedFd<'_>, token: usize, read: bool, write: bool) -> std::io::Result<()>;
    fn forget(&mut self, fd: BorrowedFd<'_>) -> std::io::Result<()>;
    fn wait(&mut self, out: &mut Vec<Event>, timeout: Option<Duration>) -> std::io::Result<()>;
}

#[cfg(target_os = "linux")]
mod epoll;
#[cfg(target_os = "macos")]
mod kqueue;
```

`BorrowedFd<'_>` is a descriptor borrowed for the length of the call. Any `TcpStream` hands one out through `as_fd()`, and the caller keeps ownership. The token is the client's slot index, as in mio, so an event leads straight to its `Client` without a search.

mio is the library that Tokio, Rust's main async runtime, uses to wait on sockets. Its `epoll.rs` and `kqueue.rs` files are each a few hundred lines that wrap these calls the way you are about to. Read them for three patterns. The descriptor of the epoll or kqueue instance is an `OwnedFd`. A `syscall!` macro turns a return value of -1 into `std::io::Error::last_os_error()`, the Rust form of `errno`. And `select` fills a `Vec` with spare capacity through a raw pointer and then sets its length with `set_len`, with a comment that says why that is sound. mio registers sockets edge-triggered, with `EPOLLET` and `EV_CLEAR`. Your loop stays level-triggered, as in chapter 08, so leave those flags out.

### Study

- [Rust standard library: I/O Safety](https://doc.rust-lang.org/std/io/index.html#io-safety) (read, 20 min): The "I/O Safety" section, then follow its link to `std::os::fd` and read the pages for `OwnedFd` and `BorrowedFd`.
- [mio v1.2.5: the epoll selector](https://github.com/tokio-rs/mio/blob/v1.2.5/src/sys/unix/selector/epoll.rs) (read, 1 h 15 min): `Selector::new`, `select`, `register`, `reregister`, `deregister`, `interests_to_epoll` and the `event` module. Then `kqueue.rs` in the same directory: the `kevent!` macro, `Selector::new`, `select`, `register`, `deregister` and `kevent_register`. Skip the waker and the `debug_details` functions. The `syscall!` macro is at the top of `src/sys/unix/mod.rs`.
- [libc crate documentation](https://docs.rs/libc/latest/libc/) (reference, as needed): The declarations of `epoll_create1`, `epoll_ctl`, `epoll_wait`, `kqueue` and `kevent` and their structs. docs.rs shows one platform at a time. Use the Platform menu to pick `aarch64-unknown-linux-gnu` for epoll and `aarch64-apple-darwin` for kqueue. The man pages from chapter 08 say what each call does.

### Build

Make a crate `rserve` with `libc` as a dependency (`cargo add libc`).

1. `src/poll/mod.rs` with `Event` and `Poller`, `src/poll/epoll.rs` for Linux and `src/poll/kqueue.rs` for the Mac. Every `unsafe` block has a `// SAFETY:` comment. Store the instance's descriptor as an `OwnedFd` so it closes when the poller is dropped.
2. `src/bin/echod.rs`, the echo server from chapter 08 with the same limits: loopback only, a port from the command line, a 4 KB input buffer and a 64 KB output queue per client, reading paused while the queue is full, at most 1000 clients, and a 30 second idle timeout.
3. Run your C `echotest` from chapter 08 against the Rust server, unchanged. It speaks TCP and does not care which language answers.

### Done when

On the Mac and in Linux, `echotest` reports a correct echo for the slow writer and a worst pinger round trip under 50 ms while the stalled reader sits on a full queue, as it did for the C server. `ps -o rss -p <pid>` stays flat during the stalled reader. In Linux, `ls /proc/<pid>/fd` after the test lists only the standard streams, the listening socket and the epoll descriptor. `grep -rn unsafe src/` finds blocks only in the two poller files, and you can say for each one what would go wrong if its `// SAFETY:` comment were false.

## The HTTP server, the benchmarks and the verdict

The last port puts chapter 08's HTTP/1.1 subset on the Rust loop. The framing does not change: a request is complete when the client's input buffer contains `\r\n\r\n`, and a full buffer without it means the header block is too large. Rust's lifetimes help most in the parser. In chapter 08 you parsed with `Str` views into the input buffer and had to remember not to move or reuse the buffer while the views were alive. In Rust the request borrows the buffer:

```rust
struct Request<'a> {
    method: &'a [u8],
    path: &'a [u8],
    close: bool,
}

// Ok(None): need more bytes. Ok(Some((req, n))): a request whose head is n bytes long.
fn parse_head(buf: &[u8]) -> Result<Option<(Request<'_>, usize)>, Status>
```

While a `Request` is alive, the compiler rejects any code that writes to the input buffer or shifts the next request to its front. You handle the request, drop it, and only then remove the `n` bytes. `Status` is an enum with one variant per code you send, and a `match` gives each variant its number and reason phrase. The file table becomes a `HashMap<String, Vec<u8>>` built at startup from the command line, as in chapter 08.

The slice methods `windows(4)` with `position` find `\r\n\r\n`, `split` cuts at spaces and line ends, `trim_ascii` removes surrounding spaces, and `eq_ignore_ascii_case` compares header names. `std::str::from_utf8` turns a path into a `&str` for the table lookup, and a path that is not UTF-8 gets 404.

Then compare the two servers and the two hash tables, and write the result down. The write-up records the opinion about Rust you carry into the rest of the book, with numbers from your own code behind it.

### Study

- [Rust standard library: slice](https://doc.rust-lang.org/std/primitive.slice.html) (reference, as needed): `windows`, `split`, `starts_with`, `trim_ascii` and `eq_ignore_ascii_case`, plus `position` on the iterator that `windows` returns. RFC 9112 and RFC 9110 from chapter 08 still define the protocol.

### Build

1. `src/bin/httpd.rs` on the poller, with the same command line, limits and status codes as the C version: 400, 404, 413, 501 and 505, `Content-Length` on every response, no body for HEAD, and `Connection: close` honored.
2. Unit tests for `parse_head`: a complete GET, a head split across two calls, two requests in one buffer, a POST with a body, an unknown version, and a buffer full without `\r\n\r\n`.
3. Run chapter 08's `tests/http.sh` and `httptest` against the Rust server, changing only the server binary they start.
4. In Linux, run `wrk -t2 -c100 -d10s --latency` and the 1000-connection run against the C server and then the Rust server, in the same session, with the same `ulimit -n`. Run each three times and keep the best.
5. Write `COMPARISON.md`, about 1000 words, with numbers: lines of code for each port and its C original (`wc -l`), the number of `unsafe` blocks and where they are, the compiler-caught and test-caught bugs from `NOTES.md`, the hash table and `wrk` results side by side, binary sizes, and build times from clean. End with where Rust helped, where it got in the way, and which you would use for the next server you write.

### Done when

The parser tests pass, `tests/http.sh` passes against the Rust server on both machines with the status codes from chapter 08, and the slow-client test keeps the pinger's worst round trip under 50 ms. You have `wrk` requests per second and latency percentiles for both servers at 100 and 1000 connections. `COMPARISON.md` exists, every claim in it has a number or a `NOTES.md` entry behind it, and it states your choice.

## Where this leads

You can now write Rust that does systems work. You read the borrow checker's errors as the bugs you used to find with sanitizers, you write traits and generics where the C version used macros or function pointers, and you keep `unsafe` in small blocks with a stated reason. You ported a SIMD hash table and an event-loop server, ran the C tests against them and measured both languages on your own machine.

Chapter 11, Interpreters, bytecode VMs and Lua, goes back to C. You build clox from Crafting Interpreters, a bytecode virtual machine with a garbage collector, and then embed Lua in a C program. A garbage collector walks a graph of heap objects that point at each other in every direction, the shape that took a whole unsafe chapter in the linked-list book. Writing it in C first shows you exactly what the collector tracks. With this chapter behind you, you can also judge which parts of such a VM Rust would check and which would end up in `unsafe`.
