---
id: 10
title: Rust
part: Languages and compilers
weeks: 8
project: The chapter 07 Swiss table and the chapter 08 event-loop HTTP server ported to Rust, passing the same tests and benchmarked against the C versions.
---

Chapter 09 ended with your HTTP server handing slow requests to a work-stealing job system, and with `docs/jobs-ordering.md`, where you wrote down who owns each shared variable and which release and acquire pair hands it from one thread to the next. Before that you freed every allocation on every path, kept views into an arena valid only while the arena lived, closed every socket in the event loop exactly once and put a lock around shared data. All of those rules lived in your head and in comments. The compiler checked none of them, and the sanitizers and tests found your mistakes after you made them.

**Rust** is a systems language whose compiler checks most of those rules. Every value has one owner, and the value is freed when its owner goes out of scope. A reference to a value is either shared or mutable, never both at once, and it cannot outlive the value. Applied to threads, the same rules reject data races. Where the rules are too strict, you write `unsafe` and take over the proof, as you did in every line of C.

This chapter teaches enough Rust to port two of your programs: the Swiss table from chapter 07 and the event-loop HTTP server from chapter 08. Both ports run the tests and benchmarks of the C originals, and you write down what each port cost and what the compiler caught. The first seven steps teach the language, mostly on two programs you already wrote in C: the word counter from chapter 02 and the Hack assembler from chapter 03. The Rust Book is the main text, Rustlings gives you small exercises, and Aria Desires' book on linked lists shows the borrow checker's hard cases. Then come the hash table in safe Rust, the hash table with SSE2 and `unsafe`, the table shared between threads, and the server in two steps.

The chapter comes after C on purpose. You have done ownership by hand, so the compiler's errors describe bugs you have already met: a pointer kept after `free`, an element pointer that dies when a growable array moves, a descriptor closed twice. The school this book follows is split on Rust. Its defenders point at the class of memory bugs it removes, and its critics point at how hard it makes the data-oriented style of chapter 07, where many systems write into one shared array. You finish the chapter with your own numbers on both sides.

## Rust and Cargo

This step installs Rust in Ubuntu and covers the parts of the language that look like C with different spelling: variables, types, functions, `if` and loops.

**rustup** installs Rust and keeps it up to date. It puts its programs in `~/.cargo/bin`: `rustc`, the Rust compiler, `cargo`, described below, and `rustup` itself. Install it inside Ubuntu with the Linux command in section 1.1 of the Rust Book and take the default option. Do not use the Windows installer. rustc calls the system's C linker at the end of every build, and the `build-essential` package you installed in chapter 06 provides it.

**Cargo** is Rust's build tool and package manager in one program. A **crate** is the unit that rustc compiles: one program or one library. `cargo new hello` makes a directory with two files:

- `Cargo.toml` names the crate, its **edition**, the version of the language rules it follows (`2024`), and the other crates it depends on.
- `src/main.rs` holds `fn main`, where the program starts.

Every crate of this chapter lives in a folder `rust/` of your book repository, `~/code/hello`. Cargo writes its builds to `target/` inside each crate, often hundreds of megabytes. Inside an existing git repository `cargo new` writes no `.gitignore`, so add the line `target/` to the repository's own `.gitignore` once.

You use four Cargo commands in every step of this chapter:

- `cargo build` makes a debug build in `target/debug/`.
- `cargo build --release` makes an optimized build in `target/release/`, the same split as `out/Linux-debug` and `out/Linux-release` from `build.sh`.
- `cargo run` builds and runs the program. Arguments after `--` go to the program, as in `cargo run -- 7`.
- `cargo test` builds the tests and runs them.

Two rules from chapter 04 change. Integer overflow is defined: a debug build stops the program with `attempt to add with overflow`, and a release build wraps around in two's complement. An index past the end of an array stops the program with `index out of bounds` instead of reading other memory. Stopping like this is a **panic**. Rust prints the message and the source line, and a panic in the main thread ends the program with exit status 101.

A name followed by `!`, such as `println!` or `assert_eq!`, is a **macro**: code that the compiler expands into more code before it compiles it, like a C macro that the compiler type-checks afterwards.

Tests live in the same file as the code, in a **module**, a named group of functions and types inside a crate, written `mod name { ... }`. `#[test]` above a function is an **attribute**, a note to the compiler, and this one marks the function as a test. `#[cfg(test)]` compiles the module under it only for `cargo test`, the Rust form of `#ifdef`:

```rust
fn add(a: u8, b: u8) -> u8 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;      // the names of the file above, such as add

    #[test]
    fn small_sum() {
        assert_eq!(add(200, 55), 255);
    }

    #[test]
    #[should_panic]    // passes only if the test panics
    fn overflow_panics() {
        add(200, 56);
    }
}
```

A failed `assert_eq!` panics, and `cargo test` reports that test as failed and goes on with the rest.

> **Practice:** Run `cargo test` and `cargo test --release`. The debug build checks every addition for overflow and the release build does not, and the release build is the one you benchmark.

> **Practice:** Run `cargo clippy` before each commit and treat every warning like a clang warning from chapter 01. Clippy is Rust's checker for code that compiles but is probably wrong or roundabout, and rustup installs it with the compiler.

### Study

- [The Rust Programming Language, chapters 1 to 3](https://doc.rust-lang.org/book/ch01-00-getting-started.html) (read, 2 h 30 min): The official book of the Rust project. Chapter 1 (installation, Hello Cargo), chapter 2 (the guessing game, typed in and run) and chapter 3 (sections 3.1 to 3.5). In 1.1, follow "Installing rustup on Linux or macOS". Read the "Integer Overflow" part of 3.2 closely. Use the arrow at the bottom of each page to move on.
- [The Rust Programming Language, section 11.1: How to Write Tests](https://doc.rust-lang.org/book/ch11-01-writing-tests.html) (read, 30 min): The whole section, through "Checking for Panics with should_panic". Skip "Using Result<T, E> in Tests", which needs chapter 9.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 1 h 30 min): Small exercises from the Rust project, each a file that does not compile or whose test fails until you fix it. Install with `cargo install rustlings`, run `rustlings init` in your home directory, then `cd rustlings` and run `rustlings`. Do the exercises from `00_intro` through `04_primitive_types`, including the first quiz.

### Build

1. Install Rust with rustup. Run `rustc --version` and `cargo --version` in a new terminal.
2. Make the folder `rust/` in your book repository and add `target/` to the repository's `.gitignore`. Run every `cargo new` of this chapter inside `rust/`.
3. Type in and run the guessing game from chapter 2 of the book.
4. `cargo new bytes`. Put `add` and the two tests above in `src/main.rs`. In `main`, collect the command-line arguments with `let args: Vec<String> = std::env::args().collect();`. `Vec<String>` is a growable array of strings, which the next step explains, and `args[0]` is the program's name. Turn `args[1]` into a number with `args[1].parse::<usize>().unwrap()`. `::<usize>` tells `parse` which type to produce, and `unwrap` gives the number or panics if the text is not one, as `expect` did in the guessing game. Print `add(1, 2)` and the element at that index of the array `[10, 20, 30]`.
5. Run `cargo test`, then `cargo test --release`.
6. Run `cargo run -- 2`, then `cargo run -- 7` followed by `echo $?`.
7. Run `cargo clippy`.

> **If it fails:** If `cargo build` stops with `linker 'cc' not found`, the C toolchain is missing. Run `sudo apt install -y build-essential` and build again.

### Done when

The guessing game runs. `cargo test` passes both tests, and `cargo test --release` reports `overflow_panics` as failed with `test did not panic as expected`. You can say why the same test passes in one build and fails in the other. `cargo run -- 7` prints `index out of bounds: the len is 3 but the index is 7` and `echo $?` prints 101. The Rustlings exercises through `04_primitive_types`, including the first quiz, pass, and `git status` in the repository lists no `target/` directory.

## Ownership and borrowing: the word counter

In chapter 02 the word counter's table owned a heap copy of every word, and a comment said who freed what. Rust writes those rules into the language, and the compiler rejects a program that breaks them. This step ports the word counter to learn them.

Three rules decide when memory is freed:

- Each value has one **owner**, the variable that holds it.
- When the owner goes out of scope, Rust **drops** the value: it runs the value's cleanup, which for a `String` frees its heap buffer. The compiler inserts the `free` you wrote by hand in C.
- Assigning a value to another variable, or passing it to a function, **moves** it. The bytes of the value are copied to the new place, and the old name can no longer be used.

A `String` is a growable array of bytes, like your chapter 02 growable array. Its value is three 8-byte fields: a pointer to the heap buffer, the length and the capacity. A move copies those three fields, so two names would point at one buffer and both would free it. Rust prevents that double free by making the old name unusable. To get a second buffer, call `.clone()`, which copies the heap bytes too:

![On the left, let b = a copies the pointer, length and capacity into b, a becomes unusable, and one heap buffer has one owner. On the right, a.clone() also copies the bytes, so a and b each own a buffer and each frees its own.](figures/10-move-clone.svg)

Using a moved variable is the compile error `borrow of moved value`. Types that own nothing on the heap, such as integers, are **Copy**: assigning them copies the value and both names stay usable.

A **reference** lets code use a value without owning it, which Rust calls **borrowing**. There are two kinds:

- `&text` is a **shared reference**. Any number of them may exist at once, and none of them can change the value.
- `&mut text` is a **mutable reference**. It can change the value, and while it is in use no other reference to the value may be used.

The part of the compiler that checks this is the **borrow checker**. A borrow lasts from where it is made to its last use, so a shared reference whose last use is over no longer blocks a mutable one:

![Two shared references reading text are accepted. One mutable reference writing text is accepted. A shared reference that is still used after a mutable reference is made is rejected with error E0502.](figures/10-borrows.svg)

This rule catches the chapter 02 bug where a growable array moved its storage while a pointer into it was still in use. `v.push(x)` needs `&mut v`, so it cannot run while a reference to an element is still alive.

A **slice** borrows part of an array: a pointer and a length in one value, like the `Str` of chapter 04. `&[u8]` is a slice of bytes and `&str` is a slice of UTF-8 text.

| C, chapters 02 and 04 | Rust |
| --- | --- |
| `char *w = malloc(n);` ... `free(w);` | `let w = String::new();`, freed when `w` goes out of scope |
| a table that owns heap copies of words | `Vec<(String, u64)>` owns its `String`s |
| `Str`: a pointer and a length | `&str` or `&[u8]` |
| "the caller now owns this", in a comment | pass by value: a move |
| "do not free this", in a comment | `&T` or `&mut T`, checked by the compiler |

Rust's `Vec` and `String` end the process when an allocation fails, so the allocation-failure tests from chapter 02 have no port. Leave them out.

### Study

- [The Rust Programming Language, chapter 4: Understanding Ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html) (read, 2 h 10 min): Sections 4.1 to 4.3. Compare the stack and heap figures in 4.1 and 4.2 with your chapter 02 drawings. Then sections 8.1 and 8.2 from the table of contents, on vectors and strings. Section 8.2 explains why a `String` cannot be indexed by an integer.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 1 h): The exercises in `05_vecs` and `06_move_semantics`.

### Build

1. In `rust/`, run `cargo new wordcount`. Write `fn count_words(text: &[u8]) -> Vec<(String, u64)>`. The input is bytes, so text that is not valid UTF-8 cannot stop it. A word is a run of ASCII letters, stored lowercase, and the result lists words in order of first appearance. `u8` has the methods `is_ascii_alphabetic` and `to_ascii_lowercase`, and `byte as char` turns an ASCII byte into a `char` that `String::push` accepts.
2. Find a word with a linear scan in a `for` loop over `&mut table`, which hands you a mutable reference to each entry in turn, as the C version did.
3. `main` reads all of standard input into a `Vec<u8>` with `std::io::stdin().read_to_end(&mut buf)` and prints one `count word` line per entry. Put `use std::io::Read;` at the top of the file. `read_to_end` is a method of the `Read` trait, and the traits step explains what a trait is.
4. Port the chapter 02 tests that do not involve allocation failure: case folding, "th", "the" and "then" as three entries, `The cat. the dog; THE end 42 don't`, the empty and punctuation-only inputs, leading whitespace, and 50000 copies of "the ".
5. Write one function that compiles in C but not in Rust. Take a reference to the first entry of a `Vec`, push a new entry, then read through the reference. Copy the first line of the compiler's error into a comment above the function.

### Done when

`cargo test` passes. The shell comparison from chapter 02, run inside `rust/wordcount`, prints nothing. `ls.txt` is at the root of the repository, two folders up:

```sh
cargo run --release < ../../ls.txt | sort > /tmp/mine.txt
LC_ALL=C tr -cs 'A-Za-z' '\n' < ../../ls.txt | LC_ALL=C tr 'A-Z' 'a-z' \
  | grep -v '^$' | sort | uniq -c | awk '{print $1, $2}' | sort > /tmp/shell.txt
diff /tmp/mine.txt /tmp/shell.txt
```

For each variable in `count_words` you can say whether it owns its value or borrows it, and where each `String` is created and dropped. The error in build task 5 is `E0502`, `cannot borrow ... as mutable because it is also borrowed as immutable`, and you can name the chapter 02 bug it prevents.

## Structs and enums: the assembler's types

The word counter needed only functions, a `Vec` and strings. The assembler from chapter 03 needs types of its own, because a line of Hack is an A-instruction, a C-instruction or a label. This step defines those types and the functions that encode one instruction.

A Rust `struct` is a C struct. Functions that belong to it go in an `impl` block, and a function there whose first parameter is `&self` or `&mut self` is a **method**, called as `table.get(k)`. An `enum` is a type whose value is one of several **variants**, and each variant can carry its own data. That is the tagged union of C, a tag plus a union, with the tag managed by the compiler. `match` picks the code for each variant and must handle every variant, or the program does not compile:

```rust
enum Instr {
    A(u16),
    C { dest: u8, comp: u8, jump: u8 },
}

fn encode(i: &Instr) -> u16 {
    match i {
        Instr::A(value) => *value,             // *value reads the u16 the reference points to
        Instr::C { dest, comp, jump } => {
            0xe000 | (*comp as u16) << 6 | (*dest as u16) << 3 | *jump as u16
        }
    }
}
```

![rustc stores Instr in 4 bytes: a one-byte tag, then the u16 or the three fields. The C struct with an int tag and a union takes 8 bytes, and nothing checks that code reads the member the tag names.](figures/10-enum-layout.svg)

`as` converts between number types, like a C cast. The layout in the figure is what rustc does today. Rust does not promise a layout for its enums. C's `switch` on the tag compiles when a case is missing, and reading the wrong member of the union compiles too. In Rust both are compile errors.

The standard library's `Option<T>` is an enum with two variants, `Some(value)` and `None`. It replaces a NULL pointer, and the compiler makes you handle `None` before you reach the value. An `Option<&T>` is 8 bytes, because rustc stores `None` as address 0. A lookup that can fail, such as the code for a `comp` field, returns an `Option`.

A `match` on a string compares it with each literal in turn, so a lookup table is a `match` with a `_ => None` arm at the end for every other string. `s.split_once('=')` returns `Some((before, after))` for the first `=`, or `None` when there is none, and `trim()` removes surrounding spaces.

`#[derive(Debug, PartialEq)]` above a struct or enum asks the compiler to write code for two jobs: `Debug` lets `{:?}` print the value, and `PartialEq` lets `==` and `assert_eq!` compare it. Your tests need both to compare a parsed `Line` with the expected one.

### Study

- [The Rust Programming Language, chapters 5 and 6](https://doc.rust-lang.org/book/ch05-00-structs.html) (read, 2 h): Chapter 5 on structs and methods, then chapter 6 on enums, `Option`, `match` and `if let`. Use the arrow at the bottom of each page to move on, and stop before chapter 7.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 1 h 30 min): The exercises in `07_structs`, `08_enums` and `09_strings`.

### Build

In `rust/`, make the project with `cargo new hasm`. This step keeps everything in `src/main.rs`, and the next step splits it into files.

1. The data: `enum Operand { Num(u16), Sym(String) }` and `enum Line { A(Operand), C { dest: u8, comp: u8, jump: u8 }, Label(String) }`, both with `#[derive(Debug, PartialEq)]`.
2. Three lookup functions, one per field of a C-instruction: `fn dest(s: &str) -> Option<u8>`, `fn comp(s: &str) -> Option<u8>` and `fn jump(s: &str) -> Option<u8>`. Each is one `match` with a line per mnemonic from chapter 03's tables, `DM` included.
3. `fn encode_c(s: &str) -> Option<u16>` cuts the instruction at `=` and `;` with `split_once`, calls the three lookups and builds the word as `encode` above does. `fn encode_a(s: &str) -> Option<u16>` turns the digits after `@` into a number that fits in 15 bits.
4. `fn parse_line(line: &str) -> Option<Line>` returns `None` for a blank or comment line and a `Line` otherwise. `@` followed by a digit is `Operand::Num`, any other `@` is `Operand::Sym`, and `(NAME)` is a `Label`.
5. Port chapter 03's tests for `encode_c` and `encode_a` into `#[test]` functions: the values, the failing inputs and the `DM` alias. Add one test per kind of line for `parse_line`.

### Done when

`cargo test` passes. Delete the `Instr::C` arm from a `match` like the one above and copy the first line of the error, `E0004`, `non-exhaustive patterns: ... not covered`. You can say which C bug that error replaces.

## Errors and modules: the whole assembler

The encoders work on one instruction. The whole assembler also has to report errors with their line numbers, keep a symbol table and grow past one file. This step adds the two passes, Rust's error handling and modules.

An `Option` says that a lookup failed but not why. `Result<T, E>` is a second enum from the standard library, with the variants `Ok(value)` and `Err(error)`, and the `Err` carries a value that says what went wrong. The `?` operator after a `Result` returns early with the error when it is an `Err` and gives you the value when it is `Ok`. A function that calls five fallible functions needs no five `if` blocks. `opt.ok_or(err)` turns an `Option` into a `Result`, so `?` works after a lookup too.

`HashMap<String, u16>` replaces the symbol table you scanned linearly. `str::lines()` splits text into lines and also removes the `\r` of a `\r\n` ending. `println!("{:016b}", word)` prints a `u16` as 16 binary digits, which replaces `word_to_bits`.

A **module** groups code under a name, and a file is a module too. `mod parse;` in `main.rs` makes the compiler read `src/parse.rs` as the module `parse`. Its items are private to it until you mark them `pub`, and other files reach them as `crate::parse::parse_line` or bring the name in with `use`. This is the split you made in C with a header and `static`, checked by the compiler.

### Study

- [The Rust Programming Language, chapter 7: Packages, Crates, and Modules](https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html) (read, 1 h): Sections 7.2 to 7.5, which show how to split a program into files with `mod`, `pub` and `use`. Skim 7.1, which repeats Cargo basics.
- [The Rust Programming Language, section 8.3 and chapter 9](https://doc.rust-lang.org/book/ch08-03-hash-maps.html) (read, 2 h): Hash maps, then chapter 9 on error handling with `panic!`, `Result` and `?`. Then sections 12.1 (command line arguments), 12.2 (reading a file) and 12.6 (writing to standard error) from the table of contents, for `std::env::args`, `std::fs` and `eprintln!`. Skip the rest of chapter 12.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 2 h): The exercises from `10_modules` to `13_error_handling`, with the second quiz.

### Build

All in `hasm`, which now ports chapter 03's assembler, symbols included.

1. Move the types and `parse_line` into `src/parse.rs` and the four encoders into `src/code.rs`. Mark what `main.rs` uses `pub`.
2. `struct AsmError { line: usize, text: String, msg: String }`, with `#[derive(Debug, PartialEq)]`.
3. `fn assemble(text: &str) -> Result<Vec<u16>, AsmError>` runs both passes over `text.lines()`. The symbol table is a `HashMap<String, u16>` loaded with the 23 predefined symbols. Use `?` for every step that can fail.
4. `main` reads standard input into a `String` with `read_to_string`, calls `assemble`, and prints every word with `{:016b}`. On an error it prints `line N: TEXT: MESSAGE` to standard error with `eprintln!` and exits with `std::process::exit(1)`.
5. Port the rest of chapter 03's tests: the two-line `assemble` cases, variables at 16 and 17, a label used before its definition, `@LOOP` and `@loop` as different symbols, and a label defined twice as an error.

### Done when

`cargo test` passes. Inside `rust/hasm`, this prints nothing. The first loop compares with project 5's reference files, as chapter 03 did, and the last line compares with the `Pong.hack` your C assembler wrote:

```sh
for p in Add Max Rect; do
  cargo run -q --release < ../../hack/$p.asm | diff - <(tr -d '\r' < ../../nand2tetris/projects/5/$p.hack)
done
cargo run -q --release < ../../hack/Pong.asm | diff - ../../hack/Pong.hack
```

`D=Q` on line 2 of a file makes the program print the line and exit with status 1. You have counted every `.clone()` and `.to_string()` in the program and can say why each one is there.

## Traits, generics and trait objects

Chapter 07 picked the scalar or the SSE2 group match with the preprocessor, and chapter 08's `loop.h` hid epoll behind four functions. Rust has two ways to write code that works with several types, and the hash table and the server each use one of them. This step teaches both on the assembler's output.

A **trait** is a set of methods that a type promises to provide. You write the methods for one type in an `impl Trait for Type` block. You have used traits already: `read_to_end` comes from the `Read` trait, and `{}` in `println!` works for any type that implements `Display`. Here is `Display` for the assembler's error:

```rust
use std::fmt;

impl fmt::Display for AsmError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "line {}: {}: {}", self.line, self.text, self.msg)
    }
}
```

`println!` hands `fmt` a `Formatter`, the destination of the text. `write!` is `println!` with that destination as its first argument, and it returns the `fmt::Result` that `fmt` passes back.

A **generic** function has a type parameter, written in angle brackets. `fn emit_all<E: Emit>(e: &E, ...)` works for any type `E` that implements the trait `Emit`. `E: Emit` is a **trait bound**: it says which promises the function relies on. The compiler makes one copy of a generic function for each type it is used with, called **monomorphization**. Each copy calls the methods of its own type directly, and the optimizer can inline them, like a macro from chapter 04 that the compiler type-checks.

Sometimes the type is only known at run time, such as an output format picked by a command-line flag. A **trait object** handles that case. `&dyn Emit` is a reference to some value of a type that implements `Emit`, with the type unknown at compile time. It is two pointers: one to the value and one to a **vtable**, a table the compiler builds for each type, which holds the addresses of that type's methods. A call reads the method's address from the vtable and calls it:

![The generic emit_all is copied once for Binary and once for Hex, and each copy calls its own emit by name. The trait object is a data pointer and a vtable pointer, and the single emit_all_dyn calls the emit whose address it reads from Hex's vtable.](figures/10-dyn-generic.svg)

A trait object usually lives behind a **`Box<T>`**, Rust's owning pointer to one value on the heap, like a `malloc` of one object that is freed when the box is dropped. `Box<dyn Emit>` owns a value whose type was chosen at run time. Freeing on drop is itself a trait, `Drop`: its one method runs when a value is dropped, and `Box`, `Vec` and `String` implement it to free their memory.

### Study

- [The Rust Programming Language, chapter 10: Generic Types, Traits, and Lifetimes](https://doc.rust-lang.org/book/ch10-00-generics.html) (read, 2 h): Sections 10.1 and 10.2. Stop before 10.3, which the lifetimes step assigns. Then section 18.2, "Using Trait Objects to Abstract over Shared Behavior", from the table of contents. Its "Performing Dynamic Dispatch" part is the vtable of the figure.
- [The Rust Programming Language, section 15.1: Using Box<T> to Point to Data on the Heap](https://doc.rust-lang.org/book/ch15-01-box.html) (read, 40 min): The whole section, then section 15.3, "Running Code on Cleanup with the Drop Trait", from the table of contents. Skip 15.2, which this chapter does not need.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 1 h 30 min): The exercises in `14_generics` and `15_traits`, with the third quiz.

### Build

All in `hasm`:

1. Implement `std::fmt::Display` for `AsmError` as above, so that `main` prints it with `{}`.
2. A trait `Emit` with one method, `fn emit(&self, out: &mut Vec<u8>, word: u16)`, and two types that implement it. `Binary` writes the 16 binary digits and `Hex` writes four hex digits (`{:04x}`), each followed by a newline. `writeln!(out, "{word:016b}").unwrap()` writes into a `Vec<u8>` once `use std::io::Write;` is at the top of the file.
3. `fn emit_all<E: Emit>(e: &E, words: &[u16], out: &mut Vec<u8>)` and `fn emit_all_dyn(e: &dyn Emit, words: &[u16], out: &mut Vec<u8>)`. Put `#[inline(never)]` above both, an attribute that keeps the optimizer from copying a function into its callers, so each stays a function you can find.
4. A `-x` flag picks hex output. `main` calls `emit_all` with a `match` on the flag that has one call per type, and `emit_all_dyn` with a `Box<dyn Emit>` chosen by the flag. Add a `-d` flag that makes `main` use `emit_all_dyn`. Write the output buffer to standard output once at the end with `std::io::stdout().write_all(&out)`.
5. Print `size_of::<&dyn Emit>()` and `size_of::<&Binary>()` once, then remove the line.
6. Build with `cargo build --release`. Run `nm -C target/release/hasm | grep emit_all`. `nm` lists the symbols of a binary and `-C` turns Rust's encoded names back into readable ones. Then find `emit_all_dyn` in `objdump -d -C --no-show-raw-insn target/release/hasm`.

### Done when

Pong assembles to the same binary output as before, and the output with `-x` and with `-x -d` is identical. The sizes print as 16 and 8 bytes. `nm` lists two copies, `emit_all::<...Binary>` and `emit_all::<...Hex>`, and one `emit_all_dyn`. Each copy of `emit_all` calls its type's `emit` by name or has it inlined, and `emit_all_dyn` calls through a register, as in `call *%r12`. You can say which of the two the hash table should use for its group match, and why.

## Lifetimes: a parser that borrows

Your assembler copies every symbol and label into a new `String`. To borrow from the source text instead, the types have to say how long each borrow may last. That is a **lifetime**: the span of the program in which a reference must stay valid. Most of the time the compiler works lifetimes out by itself. You write one when a function returns a reference and has more than one reference input, or when a struct stores a reference:

```rust
fn longer<'a>(a: &'a str, b: &'a str) -> &'a str { ... }  // the result lives no longer than a or b

struct Token<'a> {
    text: &'a str,                                       // a Token cannot outlive the text it points into
}
```

`'a` is a name for a lifetime, declared in angle brackets like a type parameter. It does not change how long anything lives. It tells the compiler that the references must fit inside the same span, and the compiler checks that every use does. Without `'a`, `longer` fails with `missing lifetime specifier`, because the result could come from `a` or from `b`. With a single reference input, as in `fn first(s: &str) -> &str`, the compiler assumes the result borrows from it and you write nothing.

![source lives from line 1 until it is dropped on line 4. The borrow in tok must end inside that span. A last use on line 3 is accepted, and a last use on line 5, after the drop, is rejected with E0505.](figures/10-lifetime.svg)

This is the rule you followed in chapter 04 for a `Str` that pointed into an arena: the view is valid while the arena lives and is not reset. In C the rule was a comment. In Rust `Token<'a>` carries it, and code that frees the text while a `Token` is still used does not compile. The lifetime `'static` is the whole run of the program, which is why a string literal, stored in the executable, is a `&'static str`.

A type that holds a type with a lifetime needs the lifetime too. If `Operand` borrows, then `Line`, which holds an `Operand`, borrows as well.

### Study

- [The Rust Programming Language, section 10.3: Validating References with Lifetimes](https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html) (read, 1 h 30 min): The whole section.
- [Rustlings](https://rustlings.rust-lang.org/) (do, 45 min): The exercises in `16_lifetimes`.

### Build

All in `hasm`:

1. Make the parser borrow from the source text instead of copying. Change the types to `enum Operand<'a>` with `Sym(&'a str)` and `enum Line<'a>` with `A(Operand<'a>)` and `Label(&'a str)`, and `parse_line` to `fn parse_line<'a>(line: &'a str) -> Option<Line<'a>>`. The symbol table still owns its names as `String`.
2. Fix every place the compiler now reports, and run the tests after each fix.

### Done when

`cargo test` passes and the Pong output still matches. The assembler allocates a `String` only to add a symbol to the table or to build an `AsmError`, and none per line. Check it with `grep -n 'to_string\|String::from\|to_owned\|format!' src/*.rs`, which lists only those places and the tests. Remove every `'a` from the definition of `Line` and copy the first line of the error, `E0106`, `missing lifetime specifier`.

## Iterators, closures and too many linked lists

The assembler now borrows its lines, but `assemble` still walks them with a loop that trims and skips by hand. Rust's iterators turn that loop into a type of its own. This step teaches iterators and closures, then works through the linked-list book, where ownership, `Box` and lifetimes meet in one data structure.

A **closure** is a function without a name that can use variables from the code around it, written `|x| x + offset`. An **iterator** is any type with a `next` method that returns `Some(item)` until it returns `None`, which is the `Iterator` trait. Methods such as `map`, `filter` and `position` take closures, and the threads step passes closures to threads. A struct that hands out borrowed items, such as lines of the source text, carries the lifetime of the text it walks.

The linked-list book exists because a linked list is easy in C and hard in safe Rust. Each node owns the next one through a `Box`. The borrow checker forbids moving a value out of a node while the list still points to it, so the book teaches `Option::take`, `mem::replace`, `Drop` and iterators with lifetimes by running into each error and fixing it. `take` moves the value out of an `Option` and leaves `None` in its place.

The book was written for the 2018 edition. Where your compiler's message differs from the text, trust the compiler.

### Study

- [The Rust Programming Language, sections 13.1, 13.2 and 13.4](https://doc.rust-lang.org/book/ch13-01-closures.html) (read, 1 h 30 min): Closures, then iterators and their performance, from the table of contents. Skip 13.3, which builds on chapter 12.
- [Learning Rust With Entirely Too Many Linked Lists](https://rust-unofficial.github.io/too-many-lists/first.html) (do, 4 h): Chapters 2 and 3, "A Bad Stack" and "An Ok Stack". Type every listing and run every test. Stop before chapter 4, "A Persistent Stack".
- [Rustlings](https://rustlings.rust-lang.org/) (do, 1 h): The exercises in `18_iterators`.

### Build

1. In `rust/`, a `lists` crate with the code from the linked-list book's chapters 2 and 3 and all of its tests.
2. Back in `hasm`, write `struct SourceLines<'a>` that implements `Iterator<Item = (usize, &'a str)>`. It yields the line number and the line with its comment cut off and surrounding spaces trimmed, and skips empty lines. Make `assemble` use it.
3. A line that still contains a space is now an error that names the line. Chapter 03 stripped every space, so this is a deliberate change. First check that no instruction in Pong has an inner space with `sed 's://.*::' ../../hack/Pong.asm | grep -n '[^ ] [^ ]'`, which should print nothing. `sed 's://.*::'` deletes every comment, from `//` to the end of the line, and the `grep` prints each line that still has a space between two other characters. Drop any ported test that relied on spaces inside an instruction.

### Done when

`cargo test` passes in `lists` and in `hasm`, and the Pong output still matches. You can say why the linked-list book's `Iter<'a, T>` needs a lifetime and `IntoIter<T>` does not, and which line of its `pop` uses `take`.

## The Swiss table in safe Rust

You now know enough Rust to port a program whose speed you measured in C. This step ports chapter 07's Swiss table without any `unsafe`, measures it, and finds out what the safety checks cost.

The C table kept three arrays in an arena: control bytes, keys and values. The Rust table keeps them in three `Vec`s that it owns:

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

The fields have no `pub`, so only code in this crate can touch them.

`get` takes `&self`, so any number of readers may look up at once. `put` and `del` take `&mut self`, so while one of them runs nobody else holds a reference into the table. When the table grows, `put` builds three new `Vec`s, inserts every live key and assigns them to the fields. Assigning drops the old `Vec`s and frees their memory, where in C the old arrays stayed in the arena until it was reset.

The benchmark is a separate crate from the library, and Rust inlines a function from another crate only when it is generic or marked `#[inline]`. Put `#[inline]` above `get`, `put` and `del`, so the calls can be inlined as in your one-file C build.

Every `ctrl[i]` in safe Rust checks `i < ctrl.len()` and panics if it fails. The check is a compare and a branch, and the optimizer removes it when it can prove the index is in range. Slicing once, as in `let group = &ctrl[start..start + 16];`, and then indexing the slice often removes the checks inside the loop. A failed check calls a function whose name contains `panic_bounds_check`.

An inlined `get` has no name of its own in the assembly. To read it, add a wrapper to the library that the optimizer may not inline, and call it once from `swissbench` so the two stay in step:

```rust
#[inline(never)]
pub fn get_probe(&self, key: u64) -> Option<u64> { self.get(key) }
```

This command writes the library's assembly to `target/release/deps/swiss-<hash>.s`. Rust's encoded names in it still contain `get_probe` and `panic_bounds_check` as plain words, so search for them:

```sh
cargo rustc --release --lib -- --emit asm
```

Rust's own `HashMap` is a port of Google's Swiss table, which makes it a fair third column. By default it hashes with SipHash, which resists attackers who choose keys to cause collisions and costs more than your splitmix finalizer. A `HashMap` takes its hasher as a type parameter, and writing one is a short exercise in traits:

```rust
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default)]                 // SplitMix::default() starts at 0
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

`struct SplitMix(u64)` is a struct with one unnamed field, read as `self.0`. `wrapping_mul` asks for the wrapping multiplication the C code got by default, where a plain `*` would panic on overflow in a debug build. `BuildHasherDefault` makes a fresh `SplitMix` for each key.

### Study

- [The Rust Performance Book: Build Configuration](https://nnethercote.github.io/perf-book/build-configuration.html) (read, 1 h): Nicholas Nethercote's short book on Rust performance. Read "Release Builds" and "Maximizing Runtime Speed" with its parts up to "Profile-guided Optimization", then the chapters "Bounds Checks" and "Machine Code" from the sidebar. Skip the rest for now.
- [Rust standard library: HashMap](https://doc.rust-lang.org/std/collections/struct.HashMap.html) (reference, as needed): The description at the top (SipHash, the SwissTable port), `with_hasher` and `with_capacity_and_hasher`, and the `entry` API if you use the map as a test oracle.

### Build

In `rust/`, make a library crate with `cargo new --lib swiss`, with the table in `src/lib.rs` and the benchmark in `src/bin/swissbench.rs`. A file in `src/bin/` is a program of its own that uses the library as `swiss::Swiss`.

1. The table with 16-byte groups and a scalar group match: a loop over the 16 control bytes that sets bit `i` of a `u32` for every byte `i` that equals H2, the mask `pmovmskb` produced in chapter 07. Use `hash_u64` from chapter 07, H1 and H2 as before, triangular probing over groups that start at multiples of 16, tombstones and the 7/8 load limit. `m.trailing_zeros()` is `__builtin_ctz`.
2. The four tests from chapter 07, with `std::collections::HashMap` as the oracle in place of the hash trie: one million random keys present and absent, two million random puts, gets and deletes checked step by step, 65,536 keys that differ only in their top 16 bits with the longest probe sequence printed, and enough deletes and inserts to force a rebuild. Generate keys with the splitmix64 generator so a seed reproduces a run.
3. The repetition tester from chapter 07 in Rust. `std::time::Instant::now()` reads a monotonic clock and `elapsed()` gives a `Duration`. `std::hint::black_box(x)` tells the optimizer it must assume `x` is used, so it cannot delete the work you time. Take the test as a closure of type `impl FnMut() -> u64` that returns a checksum.
4. `swissbench` with the measurements of chapter 07: a table of 2^20 slots at 524,288 and 900,000 keys, inserts, lookups of present keys in random order and lookups of absent keys, in nanoseconds per operation. Run the same operations on `HashMap` with SipHash and on `FastMap`. Call `get_probe` once at the end.
5. Build the benchmark twice: with the default release profile, and with `codegen-units = 1` and `lto = true` under `[profile.release]` in `Cargo.toml`. The first compiles each crate as one piece, so the optimizer sees all of it at once, and the second lets it optimize across crates when the program is linked.
6. Run the release `swissbench` and your C `swissbench` from chapter 07 the same way, pinned with `taskset -c 2` and under `perf stat` with the events that worked for you in chapter 07.
7. Write the assembly with the `cargo rustc` command above and find `get_probe` in the `.s` file.
8. Start a file `NOTES.md` in `rust/`. From now on, every time the compiler rejects code that would have been a bug in C, write one line about it. Every time a test catches a bug the compiler accepted, write one line about that. The last step turns these notes into numbers.

### Done when

The tests pass under `cargo test` and `cargo test --release`. You have a table with your Rust table, the C scalar version from chapter 07 run on the same day, `HashMap` and `FastMap`, for three operations at two fills, and the `perf stat` lines of both programs. You can say how far the Rust table is from the C one and point at the instructions in `get_probe` that differ from the C `get`, including every remaining `callq` to a `panic_bounds_check` name. You can explain the gap between `HashMap` and `FastMap` from the cost of the hash.

## Unsafe Rust, SSE2 and Miri

The safe table matches a group with a scalar loop. The chapter 07 version used SSE2, and in Rust the SSE2 intrinsics need `unsafe`. This step adds them and checks the result with a tool that finds undefined behavior in unsafe code.

`unsafe` allows five operations that the compiler cannot check:

- dereferencing a **raw pointer**, `*const T` or `*mut T`, a C pointer with no borrow rules attached
- calling a function marked `unsafe`
- using a mutable global variable
- implementing a trait marked `unsafe`
- reading a field of a `union`

It does not switch off the borrow checker for references. An `unsafe` block says "I checked this by hand", and the rest of the program trusts it. A safe function that contains an `unsafe` block must be correct for every input a safe caller could pass. The table's fields are private, so only code in the crate can break the invariants its unsafe blocks rely on:

![Tests, swissbench and threads reach the table only through get, put and del. Inside the crate the fields are private, and the two unsafe blocks rely on invariants about the lengths of ctrl and keys.](figures/10-safe-unsafe.svg)

> **Practice:** Put a `// SAFETY:` comment above every `unsafe` block that states what you checked, as the standard library does.

The SSE2 intrinsics from chapter 07 exist under the same names in `std::arch::x86_64`. `_mm_loadu_si128` takes a raw pointer, so it is an `unsafe` function. The compare and the movemask are safe functions marked as needing the `sse2` **target feature**, an instruction set extension. Rust still makes you call them from an `unsafe` block, or from a function marked `#[target_feature(enable = "sse2")]`, even though every x86-64 CPU has SSE2. Leave out the `unsafe` and the error says so: "the sse2 target feature being enabled in the build configuration does not remove the requirement to list it in `#[target_feature]`".

A trait can declare constants that each implementation sets, next to its functions:

```rust
pub trait GroupMatch {
    const WIDTH: usize;     // control bytes per group
    const STRIDE: u32;      // mask bits per control byte
    fn matches(group: &[u8], h2: u8) -> u64;
}
```

The 16-byte group match from chapter 07 becomes:

```rust
use std::arch::x86_64::*;

pub struct Sse2;

impl GroupMatch for Sse2 {
    const WIDTH: usize = 16;
    const STRIDE: u32 = 1;

    #[inline]
    fn matches(group: &[u8], h2: u8) -> u64 {
        let group: &[u8; 16] = group.try_into().unwrap();
        // SAFETY: SSE2 is part of every x86-64 CPU, and the load reads
        // exactly the 16 bytes that `group` refers to.
        unsafe {
            let ctrl = _mm_loadu_si128(group.as_ptr() as *const __m128i);
            let eq = _mm_cmpeq_epi8(ctrl, _mm_set1_epi8(h2 as i8));
            _mm_movemask_epi8(eq) as u32 as u64
        }
    }
}
```

`as` also converts between pointer types, here from a byte pointer to the pointer type the load takes. `try_into` turns the slice into a reference to exactly 16 bytes and panics if the length differs. When the caller slices with the constant `M::WIDTH`, the optimizer removes that length check.

Make the table generic over the matcher, `Swiss<M: GroupMatch>`, so the compiler makes one copy of the table per matcher, the compile-time choice you made with the preprocessor in chapter 07. The table stores no value of type `M`, so add a field `_m: std::marker::PhantomData<M>`, a field of size zero that tells the compiler the type parameter is used.

**Miri** runs a program in an interpreter that checks every memory access against Rust's rules. It reports reads out of bounds, use after free, and references that break the aliasing rules, which the linked-list book calls stacked borrows. Miri runs only on the **nightly** toolchain, the daily build of Rust that carries unfinished features.

Install Miri with `rustup toolchain install nightly --component miri` and run `cargo +nightly miri test`. Miri runs far slower than a release build, so shrink the test sizes when `cfg!(miri)` is true. Like the sanitizers of chapter 01, it only finds bugs on the paths your tests run.

### Study

- [The Rust Programming Language, section 20.1: Unsafe Rust](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html) (read, 1 h): The whole section, including "Creating a Safe Abstraction over Unsafe Code", "Using extern Functions to Call External Code", "Using Miri to Check Unsafe Code" and "Using Unsafe Code Correctly".
- [Learning Rust With Entirely Too Many Linked Lists, chapter 6: An Ok Unsafe Queue](https://rust-unofficial.github.io/too-many-lists/fifth.html) (do, 5 h): Sections 6.1 to 6.9. Section 6.5 explains the stacked borrows that Miri reports. Sections 6.4 to 6.6 run Miri as `MIRIFLAGS="-Zmiri-tag-raw-pointers" cargo +nightly-2022-01-21 miri ...`. Drop the `MIRIFLAGS=...` part and the date: that flag no longer exists, and plain `cargo +nightly miri test` already checks raw pointers. Today's Miri words its reports differently from the book's copies, so match them by the kind of error.
- [Rust core::arch::x86_64](https://doc.rust-lang.org/core/arch/x86_64/index.html) (reference, as needed): Every x86-64 intrinsic with its signature and whether it is `unsafe`. Search the page for `_mm_loadu_si128`, `_mm_set1_epi8`, `_mm_cmpeq_epi8` and `_mm_movemask_epi8`.

### Build

1. In `lists`, the unsafe queue from chapter 6 of the linked-list book. Run its tests under Miri before and after the fix in section 6.7, and keep the report Miri printed for the broken version.
2. In `swiss`, the `GroupMatch` trait with two matchers: `Scalar`, the loop from the last step, and `Sse2`. Start every group at a multiple of `M::WIDTH`, and turn match bit `b` into slot `start + b / M::STRIDE`. `matches` is not generic, so it needs its own `#[inline]` to be inlined into the benchmark crate.
3. Run all four tests for both matchers through one generic test function, `fn check_all<M: GroupMatch>()`, called once per matcher.
4. Add both matchers to `swissbench`, next to the scalar results from the last step and the C SSE2 results from chapter 07. A generic table is compiled into the crate that uses it, so read `get_probe` for each matcher in the `.s` file that `cargo rustc --release --bin swissbench -- --emit asm` writes to `target/release/deps/`.
5. Run the tests under Miri with smaller sizes.
6. Plant a bug. Write a copy of `Scalar::matches` that reads its 16 bytes through `group.as_ptr().add(1 + i)` in an `unsafe` block, one byte too far. Call it from one test with `&ctrl[0..16]` of a 64-byte `Vec` and from another with `&ctrl[48..64]`. Run both natively, then under Miri, note what Miri says for each, and delete the copy.
7. In the probe loop of `get`, replace the indexing of `keys` with `get_unchecked` in an `unsafe` block, with a `// SAFETY:` comment that states why the index is in range. Benchmark it. Keep it only if it is measurably faster.

> **Optional:** Add an `Avx2` matcher with 32-byte groups, `_mm256_cmpeq_epi8` and `_mm256_movemask_epi8`. Mark its `matches` helper `#[target_feature(enable = "avx2")]`, and check `is_x86_feature_detected!("avx2")` in `main` before you use `Swiss<Avx2>`, since not every CPU has AVX2.

> **Optional, on the Mac:** Write a `Neon8` matcher with the 8-byte NEON match from chapter 07's optional ARM64 item: `vld1_u8`, `vceq_u8`, a mask of `0x8080_8080_8080_8080`, `WIDTH` 8 and `STRIDE` 8. The intrinsics are in `std::arch::aarch64`, and Rust requires the same `unsafe` block for them.

### Done when

Miri passes the linked-list queue tests and both matchers' table tests. The planted bug passes natively. Under Miri, the first test reports a read with a tag that "does not exist in the borrow stack", because the read left the 16 bytes the slice borrows while staying inside the `Vec`. The second reports a read "at or beyond the end of the allocation".

Your benchmark table has the Rust and C SSE2 versions side by side, and you can explain any difference from the assembly of the group match, including whether the compiler vectorized your `Scalar` loop. `grep -n unsafe src/` lists only blocks with a `// SAFETY:` comment above them, and you can defend each one.

## Threads, Send and Sync

Every test so far ran the table on one thread. In chapter 09 you kept data races out of C by discipline. Rust writes that discipline into two traits, and the compiler checks them wherever a value crosses to another thread.

- A type is **Send** if a value of it can move to another thread.
- A type is **Sync** if a shared reference to it can be used from several threads at once.

The compiler implements both for a struct whose fields all have them. Your `Swiss` holds `Vec`s of integers and plain counts, so it is `Send` and `Sync` without a line of code. `Rc<T>`, a **reference-counted pointer** that frees its value when the last copy is dropped, keeps its count in a plain integer, so it is neither. `Arc<T>` is the same pointer with an atomic count, the `lock xadd` of chapter 09, and it is `Send` and `Sync` when `T` is:

![Send lets a Swiss move from thread 1 to thread 2, one owner at a time. Sync lets both threads hold a shared reference to one Swiss. Rc is neither, because clones in two threads would both add 1 to one plain count and lose an update.](figures/10-send-sync.svg)

Two more types change data through a shared reference, which Rust calls **interior mutability**. `Cell<T>` does it without any synchronization, so it can move to another thread but is not `Sync`. `Mutex<T>` is `Sync`, and the only way to reach the `T` inside is through the guard that `lock()` returns, which unlocks when it is dropped.

`std::thread::spawn` starts a thread that may outlive the function that started it, so its closure may not borrow local variables. It must own everything it uses, which `move` in front of the closure arranges. `std::thread::scope` joins every thread it started before it returns, so its threads can borrow local variables:

```rust
let table = build_table();                        // owned by this function
std::thread::scope(|s| {
    for chunk in keys.chunks(keys.len() / threads) {
        s.spawn(|| lookup_all(&table, chunk));    // borrows table and keys
    }
});                                               // every thread has joined here
```

Writes need a lock. A **sharded** table puts one `Mutex<Swiss>` in each of N shards and picks the shard from the top bits of the hash, so threads that write different shards rarely wait for each other.

On x86-64 a `Mutex<Swiss>` is 96 bytes, and the cache line is 64 bytes. Neighboring shards then share a line, and every lock operation on one shard pulls the line away from its neighbor. That is the false sharing your chapter 09 counters measured. `#[repr(align(64))]` on a wrapper struct, the Rust form of `_Alignas(64)`, rounds each shard up to 128 bytes on its own lines:

![With 96-byte shards, cache lines 1 and 4 each hold the end of one shard and the start of the next. With each shard padded to 128 bytes, every cache line belongs to one shard.](figures/10-shards.svg)

In chapter 09 you read chapter 7 of Mara Bos's Rust Atomics and Locks for the instructions and the hardware, and skipped the Rust. Her chapter 1 is the Rust side of this step.

### Study

- [Mara Bos: Rust Atomics and Locks, chapter 1: Basics of Rust Concurrency](https://marabos.nl/atomics/basics.html) (read, 2 h): From "Threads in Rust" through "Locking: Mutexes and RwLocks": threads, scoped threads, `Rc` and `Arc`, interior mutability, `Send` and `Sync`, and Rust's `Mutex`. "Waiting: Parking and Condition Variables" is optional, since chapter 09 covered condition variables.
- [Rust standard library: thread::scope](https://doc.rust-lang.org/std/thread/fn.scope.html) (reference, as needed): The example, and the rules for borrowing from the enclosing function.

### Build

Run the timings as in chapter 09: release build, best of five runs, at T = 1, 2, 4, half the `nproc` count and the `nproc` count, skipping a count that repeats one before it.

1. Three programs that must not compile: spawn a thread with `std::thread::spawn` that borrows a local table, send an `Rc<Swiss>` to a spawned thread, and call `put` on one table from two scoped threads. Copy the first line of each error into `NOTES.md` with the C bug it corresponds to.
2. Add a `probes: Cell<u64>` field to `Swiss` that `get` increments, and try to share the table between scoped threads again. Copy the error, then remove the field.
3. Parallel lookups: fill a `Swiss<Sse2>` with 900,000 keys, then look up all of them in random order from T scoped threads. Print lookups per second for each T.
4. `Sharded<M>` with N shards of `Mutex<Swiss<M>>`. Insert 900,000 keys from T threads, each inserting its own share of the keys. Compare N = 1 and N = 64, and N = 64 with and without `#[repr(align(64))]` on the shard. Print `size_of` of the shard in both layouts. Check the final contents against a `HashMap` filled from one thread.

### Done when

`NOTES.md` has four compiler errors, each with the C bug it would have been: `E0373` (closure may outlive the current function), `E0277` for `Rc<Swiss>`, `E0499` (cannot borrow as mutable more than once) and `E0277` for the `Cell`. You have lookups per second for each T and can say why lookups scale and where they stop. You have insert times for the three sharded layouts, the two shard sizes (96 and 128 bytes), and you can explain each time with lock contention and false sharing. You can say why `Swiss` is `Sync` without an `unsafe impl`, and what the `Cell` field changed.

## The event loop over epoll

The server uses a different part of Rust: values that own operating-system resources such as sockets. The C server from chapter 08 used one thread, nonblocking sockets, a `loop.h` interface over epoll, a fixed array of client slots and bounded buffers. The Rust port keeps that design. What changes is who closes what.

The standard library's `TcpListener` and `TcpStream` own their descriptors and close them when they are dropped. `set_nonblocking(true)` sets `O_NONBLOCK`, and a call that would block returns an error whose `kind()` is `ErrorKind::WouldBlock`, the Rust name for `EAGAIN`. Three chores from chapter 08 are already done for you:

- `TcpListener::bind` sets `SO_REUSEADDR`.
- The Rust runtime sets SIGPIPE to ignored before `main` runs, so a write to a closed peer returns an error of kind `BrokenPipe`.
- A closed client cannot leak its descriptor, because dropping the `Client` drops its `TcpStream`.

![The Server owns the listener, the epoll instance and a vector of client slots, and each Client owns its TcpStream. An event's token is the index of a slot, and setting clients[2] to None drops that Client, which closes descriptor 7.](figures/10-event-loop.svg)

The client table is a `Vec<Option<Client>>`, where `None` is a free slot and a slot's index is the token you give epoll. `listener.accept()` returns `Ok((stream, addr))` for a new connection, and `read` and `write` on a `TcpStream` come from the `Read` and `Write` traits of the word counter and the assembler. A `match` arm can carry a condition after `if`, which picks out `WouldBlock`:

```rust
// a readable listener: accept every waiting connection
loop {
    match listener.accept() {
        Ok((stream, _addr)) => {
            stream.set_nonblocking(true)?;
            match clients.iter().position(|c| c.is_none()) {
                Some(i) => clients[i] = Some(Client::new(stream)),   // then watch it with token i
                None => drop(stream),                                // table full: close it
            }
        }
        Err(e) if e.kind() == ErrorKind::WouldBlock => break,       // no more waiting
        Err(e) => return Err(e),
    }
}

// a readable client i
let mut done = false;
if let Some(c) = &mut clients[i] {
    match c.stream.read(&mut chunk) {
        Ok(0) => done = true,                                     // the peer closed
        Ok(n) => c.input.extend_from_slice(&chunk[..n]),
        Err(e) if e.kind() == ErrorKind::WouldBlock => {}
        Err(_) => done = true,
    }
}
```

When `done` is set, `clients[i].take()` moves the `Client` out and leaves `None` in the slot. You forget its descriptor in epoll, and the `Client` drops at the end of the block, which closes the socket. For the idle timeout, give each `Client` a `last_active: Instant`. The wait's timeout is the time left until the earliest client expires: the smallest `(c.last_active + idle).saturating_duration_since(now)` over the live clients, which is `None`, wait forever, when there are none.

epoll has no wrapper in the standard library. The **libc** crate declares the C library's functions and structs for Rust. `cargo add libc` adds it to `Cargo.toml` as a **dependency**, a crate that Cargo downloads from crates.io, Rust's package registry, and builds with yours. Its [documentation on docs.rs](https://docs.rs/libc/latest/libc/) lists the declarations of `epoll_create1`, `epoll_ctl`, `epoll_wait` and `epoll_event`. Every call into C is `unsafe`, because the compiler cannot check what the C function does with your pointers.

Two types from `std::os::fd` carry descriptors. `OwnedFd` owns a descriptor and closes it on drop. `BorrowedFd<'_>` borrows one for the length of a call, and any `TcpStream` hands one out through `as_fd()` while keeping ownership. `'_` asks the compiler to pick the lifetime. Put epoll behind a trait, the Rust form of `loop.h`:

```rust
pub struct Event { pub token: usize, pub readable: bool, pub writable: bool, pub closed: bool }

pub trait Poller: Sized {
    fn new() -> std::io::Result<Self>;
    fn watch(&mut self, fd: BorrowedFd<'_>, token: usize, read: bool, write: bool) -> std::io::Result<()>;
    fn forget(&mut self, fd: BorrowedFd<'_>) -> std::io::Result<()>;
    fn wait(&mut self, out: &mut Vec<Event>, timeout: Option<Duration>) -> std::io::Result<()>;
}
```

`std::io::Result<T>` is a `Result` whose error is an `std::io::Error`, and `std::io::Error::last_os_error()` builds one from `errno`. `Poller: Sized` requires every implementing type to have a size known at compile time, which `new` needs in order to return one by value.

**mio** is the library that Tokio, the library most Rust network servers are built on, uses to wait on sockets. Its `epoll.rs` wraps these calls the way you are about to, and it shows three patterns:

- The epoll descriptor is an `OwnedFd`.
- A `syscall!` macro turns a return value of -1 into `std::io::Error::last_os_error()`.
- `select` lets `epoll_wait` fill the spare capacity of a `Vec` through a raw pointer, then sets its length with `set_len`, with a comment that says why that is sound.

### Study

- [Rust standard library: I/O Safety](https://doc.rust-lang.org/std/io/index.html#io-safety) (read, 20 min): The "I/O Safety" section, then follow its link to `std::os::fd` and read the pages for `OwnedFd` and `BorrowedFd`.
- [mio v1.2.5: the epoll selector](https://github.com/tokio-rs/mio/blob/v1.2.5/src/sys/unix/selector/epoll.rs) (read, 45 min): `Selector::new`, `select`, `register`, `reregister`, `deregister`, `interests_to_epoll` and the `event` module. Skip `try_clone` and `debug_details`. The `syscall!` macro is at the top of `src/sys/unix/mod.rs`. mio registers sockets edge-triggered, with `EPOLLET`. Your loop stays level-triggered, as in chapter 08, so leave that flag out.
- [Rust standard library: std::net](https://doc.rust-lang.org/std/net/index.html) (reference, as needed): The pages for `TcpListener` (`bind`, `accept`, `set_nonblocking`, `as_fd`) and `TcpStream` (`read`, `write`, `set_nonblocking`, `as_fd`).

### Build

In `rust/`, make a library crate with `cargo new --lib rserve` and run `cargo add libc` in it. Put the poller in the library, `src/lib.rs` with `pub mod poll;`, and each server in `src/bin/`.

1. `src/poll/mod.rs` with `Event` and `Poller`, and `src/poll/epoll.rs` with `Epoll`. Store the epoll descriptor as an `OwnedFd`, made with `OwnedFd::from_raw_fd` from the number `epoll_create1` returns. `watch` must work for a new descriptor and for one already registered, because pausing reads changes a live client's events. `EPOLL_CTL_ADD` fails with `EEXIST` for a registered descriptor, so try `EPOLL_CTL_MOD` first and fall back to `EPOLL_CTL_ADD` when it fails with `ENOENT`. Retry `epoll_wait` when it fails with `ErrorKind::Interrupted`, the Rust name for `EINTR`. Every `unsafe` block has a `// SAFETY:` comment.
2. `src/bin/echod.rs`, the echo server from chapter 08 with the same limits: loopback only, a port from the command line, a 4 KB input buffer and a 64 KB output queue per client, reading paused while the queue is full, at most `MAX_CLIENTS` = 1100 clients, and a 30 second idle timeout. Start from the accept and read code above. Closing client `i` is `clients[i].take()`, then `poller.forget(...)` with the stream's `as_fd()`.
3. Run your C `echotest` from chapter 08 against the Rust server, unchanged. It speaks TCP and does not care which language answers.
4. Trace the server with `strace -o echod.txt` as in chapter 08, connect once with `nc`, and find the `rt_sigaction` for SIGPIPE, the `setsockopt` with `SO_REUSEADDR`, and the `EPOLL_CTL_MOD` that fails with `ENOENT` before the `EPOLL_CTL_ADD`.

> **Optional, on the Mac:** macOS has kqueue in place of epoll. Add `src/poll/kqueue.rs` behind the same trait, select the module with `#[cfg(target_os = "macos")]` and the epoll one with `#[cfg(target_os = "linux")]`, and run `echotest` there. mio's `kqueue.rs`, in the same directory as `epoll.rs`, shows the `kevent!` macro and the registration.

### Done when

`echotest` reports a correct echo for the slow writer and a worst pinger round trip under 50 ms while the stalled reader sits on a full queue, as it did for the C server. `ps -o rss -p <pid>` stays flat during the stalled reader. After the test, `ls /proc/<pid>/fd` lists only the standard streams, the listening socket and the epoll descriptor. You found the three lines in the trace. `grep -rn unsafe src/` finds blocks only in `src/poll/epoll.rs`, and you can say for each one what would go wrong if its `// SAFETY:` comment were false.

## The HTTP server, the benchmarks and the verdict

The last port puts chapter 08's HTTP/1.1 subset on the Rust loop, and then you compare the two languages with numbers. The framing does not change: a request is complete when the client's input buffer contains `\r\n\r\n`, and a full buffer without it means the header block is too large.

Lifetimes help most in the parser. In chapter 08 you parsed with `Str` views into the input buffer and had to remember not to move or reuse the buffer while the views were alive. In Rust the request borrows the buffer:

```rust
struct Request<'a> {
    method: &'a [u8],
    path: &'a [u8],
    close: bool,
}

// Ok(None): need more bytes. Ok(Some((req, n))): a request whose head is n bytes long.
fn parse_head(buf: &[u8]) -> Result<Option<(Request<'_>, usize)>, Status>
```

While a `Request` is in use, the compiler rejects any code that writes to the input buffer or moves the next request to its front, with the `E0502` error of the ownership step. You handle the request, finish with it, and only then remove the `n` bytes with `input.drain(..n)`. `Status` is an enum with one variant per code you send, and a `match` gives each variant its number and reason phrase. The file table becomes a `HashMap<String, Vec<u8>>` built at startup from the command line, as in chapter 08. `std::fs::read` returns a file's bytes as a `Vec<u8>`.

The slice methods do the scanning:

- `buf.windows(4).position(|w| w == b"\r\n\r\n")` finds the end of the head. `b"..."` is a byte string, a `&[u8; N]`.
- `split` cuts at spaces and line ends, and `trim_ascii` removes surrounding spaces.
- `eq_ignore_ascii_case` compares header names.
- `std::str::from_utf8` turns a path into a `&str` for the table lookup, and a path that is not UTF-8 gets 404.

Then compare the two servers and the two hash tables, and write the result down. Pin each server to one CPU with `taskset -c 2`, as chapter 07 pinned its benchmarks. While `wrk` runs, `perf stat -e task-clock,context-switches -p <pid>` counts for the running server, and Ctrl-C stops the count and prints it.

### Study

- [Rust standard library: slice](https://doc.rust-lang.org/std/primitive.slice.html) (reference, as needed): `windows`, `split`, `starts_with`, `trim_ascii` and `eq_ignore_ascii_case`, plus `position` on the iterator that `windows` returns. RFC 9112 and RFC 9110 from chapter 08 still define the protocol.

### Build

1. `src/bin/httpd.rs` on the poller, with the same command line, limits and status codes as the C version: 400, 404, 413, 501 and 505, `Content-Length` on every response, no body for HEAD, and `Connection: close` honored.
2. Unit tests for `parse_head`: a complete GET, a head split across two calls, two requests in one buffer, a POST with a body, an unknown version, and a buffer full without `\r\n\r\n`.
3. Run chapter 08's `tests/http.sh` and `httptest` against the Rust server, changing only the server binary they start.
4. Start the C server, then the Rust server, each with `taskset -c 2`. Run `wrk -t2 -c100 -d10s --latency` and the 1000-connection run against each, in the same session and with the same `ulimit -n`, with `perf stat -p` on the server during each run. Run each three times and keep the best.
5. Write `COMPARISON.md` in `rust/`, about 1000 words, with numbers: lines of code for each port and its C original (`wc -l`), the number of `unsafe` blocks and where they are, the compiler-caught and test-caught bugs from `NOTES.md`, the hash table and `wrk` results side by side with the `perf stat` lines, binary sizes, and build times from clean (`cargo clean`, then `time cargo build --release`, where `time` in front of a command prints how long it ran, and `real` is the time on the clock). End with where Rust helped, where it got in the way, and which language you would use for the next server you write.

### Done when

The parser tests pass, `tests/http.sh` passes against the Rust server with the status codes from chapter 08, and the slow-client test keeps the pinger's worst round trip under 50 ms. You have `wrk` requests per second and latency percentiles for both servers at 100 and 1000 connections, with the task-clock of each server. `COMPARISON.md` exists, every claim in it has a number or a `NOTES.md` entry behind it, and it states your choice.

## Where this leads

You can now write Rust that does systems work. You read the borrow checker's errors as the bugs you used to find with sanitizers, you write traits and generics where the C version used macros or function pointers, and you keep `unsafe` in small blocks with a stated reason. You ported a SIMD hash table and an event-loop server, ran the C tests against them and measured both languages on your own machine.

Chapter 11, Interpreters, bytecode VMs and Lua, goes back to C. It starts with a chunk of bytecode and the loop that runs it, the same fetch, decode and execute loop as your 8086 simulator and CHIP-8 emulator. From there Crafting Interpreters adds a scanner, a compiler, closures and a garbage collector until you have clox, a complete bytecode VM. The second half embeds Lua in your C HTTP server.

A garbage collector walks heap objects that point at each other in every direction. In the linked-list book, a queue with one extra tail pointer already needed a whole unsafe chapter. Writing the collector in C shows you what it has to track, and with this chapter behind you, you can judge which parts of such a VM Rust would check and which would end up in `unsafe`.
