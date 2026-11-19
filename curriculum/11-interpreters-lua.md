---
id: 11
title: Interpreters, bytecode VMs and Lua
part: Languages and compilers
weeks: 10
project: clox, a bytecode compiler and virtual machine for Lox in C that passes the book's test suite, then Lua 5.5 embedded in your HTTP server as route handlers that reload while the server runs.
---

Chapter 10 ported your hash table and HTTP server to Rust, and the borrow checker decided at compile time how long each value lives. This chapter goes back to C and builds a language whose values live as long as the running program can still reach them. A **garbage collector** is the part of a language's runtime that finds memory the program can no longer reach and frees it. You write one.

You have written interpreters before. An **interpreter** is a program that runs another program by reading its instructions and doing what each one says. Your 8086 simulator from chapter 05 and your CHIP-8 emulator from chapter 06 each fetched, decoded and executed instructions in a loop, for instruction sets someone else designed for hardware. Here you design the instruction set, write the compiler that produces it and write the loop that runs it:

![The scanner turns the source line print 1 + 2 into tokens, the compiler turns the tokens into a chunk of bytecode, and the VM runs the bytecode and prints 3.](figures/11-pipeline.svg)

The guide is part III of Bob Nystrom's Crafting Interpreters. It builds clox, about 3,000 lines of C: a scanner, a compiler, a virtual machine, a garbage collector, closures and classes. The book's chapters are numbered 1 to 30, and this chapter writes them as CI 14 to CI 30 so they do not mix with the chapters of this book. Skip part II, which builds a different interpreter in Java. Part III stands on its own, and chapter 04 already used one section of part II for recursive descent parsing.

The second half of this chapter reads and uses Lua, a production interpreter of about 32,000 lines of C, comments included. Neovim, Redis and many game engines embed it through one small C API. You compare its design with clox and then put Lua handlers into your HTTP server. Chapter 14 scripts its games in Lua on top of that.

The chapter comes here because it uses almost everything before it. A value is a type tag plus a payload, like the `Json` struct of chapter 04's parser. The VM's call frames do in software what chapter 05's stack frames do in hardware. The hash table repeats the open addressing and tombstones of chapter 07's SIMD table, and you measure clox with chapter 07's tools. The server is the one you built in chapter 08 and moved onto the job system in chapter 09.

## Bytecode chunks and the VM loop

Before clox can compile anything, it needs a format for compiled code and a loop that runs it. This step builds both, and you write the first programs by hand.

**Bytecode** is an instruction set designed for an interpreter instead of a CPU. Each instruction starts with a one-byte **opcode** that says what to do, followed by zero or more **operands**, extra bytes that say what to do it with. A program for clox becomes a **chunk** of bytecode, which holds three arrays:

- `code`, the instruction bytes.
- `constants`, the values that appear in the source, such as the number 1.2. `OP_CONSTANT` has one operand, an index into this array.
- `lines`, the source line of each byte in `code`, so a runtime error can name a line.

![A chunk holds three arrays. Each OP_CONSTANT in the code is followed by an operand byte that indexes the constants array, and the lines array has one source line per code byte.](figures/11-chunk.svg)

A **virtual machine**, VM for short, is the program that runs bytecode. clox's VM is the loop you wrote twice already. `ip`, the instruction pointer, points at the next byte, like the program counter in your 8086 simulator. A `switch` on the opcode runs the instruction.

Your CPU keeps intermediate results in registers. clox keeps them on a **value stack** instead, an array of values with a pointer to its top. An operation pops its operands off the top and pushes its result. Most arithmetic opcodes therefore have no operands at all. CI 15 runs a hand-built chunk for `-((1.2 + 3.4) / 5.6)`:

![The value stack after each instruction of -((1.2 + 3.4) / 5.6). Each operation pops its operands from the top and pushes its result, and OP_RETURN pops the final value and prints it.](figures/11-value-stack.svg)

Read the Lox language chapter first. It describes the language you implement: its types, operators, statements, functions, closures and classes. Then type CI 14 and CI 15.

CI 14 routes every allocation through one function, `reallocate`. Chapter 04 taught you arenas, where everything is freed at once. A language with a garbage collector frees objects one at a time, and in CI 26 `reallocate` also starts a collection.

> **Practice:** Type the book's code yourself instead of pasting it, and build after every section. Typing makes you read every line, and the build catches your typos while the section is fresh.

clox is split into several `.c` files with headers, as the book writes it. Your `build.sh` compiles one file, `src/<name>.c`, so clox gets its own script. The two scripts differ in these ways:

- `build_clox.sh` takes no program name. It always builds clox.
- `src/clox/*.c` names every `.c` file in the directory. The shell expands the `*` before clang runs.
- `-Wno-unused-parameter` turns off the warning for a function parameter that the function never reads. The book's native functions in CI 24 take parameters they ignore.
- `-Wconversion`, `-Wno-sign-conversion`, `-Wdouble-promotion` and `-Werror` are left out. The book's code converts between number types without casts in about a dozen places that are correct, and the clox code should match the text you are reading.
- `$EXTRA` adds flags for one build, the way `SAN` and `LIBS` do.

The book turns its debugging aids on with lines such as `#define DEBUG_TRACE_EXECUTION` in `common.h`. Do not type those lines. Pass the switch from the build with `-D`, which chapter 01 used for `NDEBUG`. `EXTRA=-DDEBUG_TRACE_EXECUTION sh build_clox.sh` builds a clox that prints a trace, and the next plain `sh build_clox.sh` builds one that does not. The same goes for `DEBUG_PRINT_CODE`, `DEBUG_LOG_GC` and `NAN_BOXING`, which later chapters of the book add.

> **Practice:** Run the book's tests only on a build without `DEBUG_TRACE_EXECUTION`, `DEBUG_PRINT_CODE` or `DEBUG_LOG_GC`. All three print extra lines, and the tests compare every line clox prints.

### Study

- [Crafting Interpreters: The Lox Language](https://craftinginterpreters.com/the-lox-language.html) (read, 40 min): Sections 3.1 to 3.10. Skip the challenges and the design note.
- [Crafting Interpreters: Chunks of Bytecode](https://craftinginterpreters.com/chunks-of-bytecode.html) (do, 3 h): The whole chapter, 14.1 to 14.6, including the design note "Test Your Language". Skip the challenges.
- [Crafting Interpreters: A Virtual Machine](https://craftinginterpreters.com/a-virtual-machine.html) (do, 3 h): The whole chapter, 15.1 to 15.3, then the design note "Register-Based Bytecode" and challenge 1.

### Build

1. Save this as `build_clox.sh` next to `build.sh`:

   ```sh
   #!/bin/sh
   # usage: sh build_clox.sh [release]
   # Builds every .c file in src/clox/ into out/<os>-<mode>/clox.
   set -e
   mode=${1:-debug}
   cc=${CC:-clang}
   out=out/$(uname -s)-$mode
   mkdir -p "$out"

   warn="-Wall -Wextra -Wno-unused-parameter"
   if [ "$mode" = release ]; then
       flags="-O2 -DNDEBUG"
   else
       flags="-g3 -O0 -fsanitize=${SAN:-address,undefined} -fno-sanitize-recover=undefined"
   fi

   $cc -std=gnu11 $warn $flags $EXTRA -o "$out/clox" src/clox/*.c
   echo "built $out/clox ($mode, $cc)"
   ```

2. Type CI 14 and CI 15 into `src/clox/`. Build with `sh build_clox.sh` and `sh build_clox.sh release`, and fix every warning before you go on.
3. Build with `EXTRA=-DDEBUG_TRACE_EXECUTION sh build_clox.sh` and run the book's chunk for `-((1.2 + 3.4) / 5.6)`. Compare each line of the trace with the figure above.
4. Challenge 1 of CI 15: write the bytecode for `1 * 2 + 3`, `1 + 2 * 3`, `3 - 2 - 1` and `1 + 2 * 3 - 4 / -5` on paper. Then build each chunk by hand in `main`, run it in the tracing build, and check the stack after each instruction against your paper.

### Done when

Both builds run the four hand-built chunks with no warning and no sanitizer report. The printed results are 5, 7, 0 and 7.8. For `3 - 2 - 1` you can say why `OP_SUBTRACT` pops the right operand first, and what result you get if it pops the left one first.

## Scanning tokens on demand

So far you built chunks by hand in `main`. From now on a compiler builds them from source text, in two stages. This step builds the first.

A **scanner**, also called a lexer, reads the characters of the source and groups them into **tokens**, the words of the language: `print`, `(`, `1.5`, `"hi"`. Each token records its type, the source characters it covers, called its **lexeme**, and its line. clox scans on demand. The compiler asks for the next token when it needs one, so the whole list of tokens never exists in memory.

The scanner must tell keywords such as `while` from names such as `width`. CI 16 does it with nested `switch` statements on the first letters, a small **trie**: a tree with one branch per letter. You built a hash trie in chapter 04. This one is written into the code.

CI 16 prints every token from a temporary loop in `compile()`, and CI 17 replaces that loop. Keep it. Move it into `main.c` behind a `--tokens` flag, so `clox --tokens file.lox` prints the token stream. On a file with `print "hi" + 1.5;` on line 1 and `var x = "oops` on line 2, the book's finished scanner prints:

```
   1 31 'print'
   | 20 '"hi"'
   |  7 '+'
   | 21 '1.5'
   |  8 ';'
   2 36 'var'
   | 19 'x'
   | 13 '='
   | 38 'Unterminated string.'
   | 39 ''
```

The first column is the line, or `|` for the same line. The second is the token type, the number of the enum member in `scanner.h`. An error token carries its message as its lexeme, and type 39 is the end of the file. Your numbers can differ if your enum is in a different order. The Lua step later compares a Lua scanner against this output.

### Study

- [Crafting Interpreters: Scanning on Demand](https://craftinginterpreters.com/scanning-on-demand.html) (do, 3 h): The whole chapter, 16.1 to 16.4. Skip the challenges.

### Build

1. Type CI 16 and run its token loop on a few files of your own.
2. Move the loop into `main.c` behind `--tokens`. Without the flag, `main` goes on to `interpret` as the book has it.
3. Write `tests/tokens.lox` with a string, a number, a keyword, a name that starts like a keyword (`classy`) and an unterminated string at the end.

### Done when

`clox --tokens tests/tokens.lox` prints one line per token, with `classy` as a name and not as `class`, then an error token for the unterminated string and the EOF token. The debug build prints no sanitizer report.

## A Pratt compiler

The scanner gives you tokens. The compiler turns them into bytecode, and the hard part is the order of operations in an expression.

A **parser** reads tokens and finds the structure of the program in them. The parser of chapter 04 built a tree of `Json` nodes. clox has a **single-pass compiler**: it parses and writes bytecode at the same time, with no tree in between.

In `1 + 2 * 3` the `*` must run first. Each operator has a **precedence**, a level that says how tightly it binds, and `*` is higher than `+`. **Associativity** decides between equal levels: `8 - 3 - 1` means `(8 - 3) - 1`, so `-` is left-associative.

A **Pratt parser** handles both with one table indexed by token type. Each row holds a **prefix** function, for a token that starts an expression such as a number or `-`, an **infix** function, for a token between two operands such as `+`, and the token's precedence. `parsePrecedence(p)` runs the prefix function of the current token. Then it keeps folding infix operators into the expression while their precedence is at least `p`. `binary()` compiles its right operand at one level above its own operator, which makes `-` group to the left:

![Pratt parsing of 1 + 2 * 3. Each call of parsePrecedence handles operators at its level or higher. The + at TERM calls binary, which parses its right side at FACTOR, so the * binds first and MULTIPLY is emitted before ADD.](figures/11-pratt.svg)

The bytecode comes out in the order the stack machine needs. Follow the same calls for `8 - 3 - 1` and watch the second `-` fail the test inside `parsePrecedence(FACTOR)` and return to the outer call.

From CI 17 on, `main` reads a file, compiles it and runs it, and `OP_RETURN` prints the result. A file that holds `1 + 2 * 3` prints 7.

### Study

- [Crafting Interpreters: Compiling Expressions](https://craftinginterpreters.com/compiling-expressions.html) (do, 4 h): The whole chapter, 17.1 to 17.7, then challenge 1 and the design note "It's Just Parsing".

### Build

1. Type CI 17. Keep the `--tokens` flag.
2. Build with `EXTRA=-DDEBUG_PRINT_CODE sh build_clox.sh` and run files with `1 + 2 * 3` and `8 - 3 - 1`. Check that the listing for the first has `OP_MULTIPLY` before `OP_ADD`, and that the second subtracts 3 before it loads 1.
3. Challenge 1 of CI 17: write the call trace for `(-1 + 2) * 3 - -4` on paper first. Then add a temporary `fprintf(stderr, ...)` at the top of `parsePrecedence`, `unary`, `binary`, `grouping` and `number`, and compare.
4. Remove the `fprintf` calls and build without `DEBUG_PRINT_CODE` again.

### Done when

The plain debug build prints 7 for `1 + 2 * 3`, 4 for `8 - 3 - 1` and 7 for `(-1 + 2) * 3 - -4`, with no sanitizer report. Your paper trace for challenge 1 matches the printed trace call for call.

## The book's test runner

Checking each expression by hand works for one chapter of the book. clox grows for thirteen more, and every change can break something that worked before, so from here on a program checks it.

The book's repository holds a suite of about 250 Lox programs. Each test file states its expected output in comments such as `// expect: 7`. The **test runner** is a program in the same repository that runs your clox on every file and compares what it prints.

The runner also checks the exit status. clox exits with 65 for a compile error and 70 for a runtime error. The numbers come from the header `sysexits.h`, a list of exit statuses from the BSD family of operating systems.

A suite is named after the book chapter your clox has reached, such as `chap17_compiling`. The suites for CI 17 to CI 20 contain a single expression test. From CI 21 on they run hundreds of tests.

The runner is written in Dart, a language from Google, so you install the Dart SDK first. You need an old version. The runner was written before Dart 3, and Dart 3 refuses to load it. dart.dev's apt repository still carries Dart 2.19.6, the last version before 3, and you ask apt for that version by name.

> **Practice:** Run the book's suite for the chapter you just finished, in the debug build, before you start the next chapter.

### Study

- [Dart: Get the Dart SDK](https://dart.dev/get-dart) (reference, as needed): The Linux tab, "Install using the `apt-get` package manager". Use its first three commands as written, then the install command from the Build below. Your laptop is `amd64`, the architecture the commands name.
- [Crafting Interpreters repository: Testing your implementation](https://github.com/munificent/craftinginterpreters#testing-your-implementation) (reference, as needed): The "Building Stuff" section for `make get`, then "Testing your implementation" for the `--interpreter` flag. The suite names are in `tool/bin/test.dart` in the repository.

### Build

1. Run the first three commands from dart.dev. In place of the fourth, run `sudo apt update && sudo apt install -y dart=2.19.6-1`, which installs that exact version. Then run `sudo apt-mark hold dart`, which stops a later `apt upgrade` from replacing it with Dart 3. `dart --version` prints `Dart SDK version: 2.19.6`.
2. In `~/code`, run `git clone https://github.com/munificent/craftinginterpreters`, then `make get` inside the clone. It downloads the packages the runner needs and ends with `Got dependencies!`.
3. From the clone, run `dart tool/bin/test.dart chap17_compiling --interpreter ~/code/hello/out/Linux-debug/clox`, with the path to your own project.
4. Write `tests/expr.sh`. For each case it writes the expression to a file with `printf`, runs clox on it and checks what clox prints. Use no trailing newline: with one, the end of the file is on line 2 and the error messages below name line 2. The cases: `1 + 2 * 3` is 7, `8 - 3 - 1` is 4, `2 * (3 + 4)` is 14, `-(-3)` is 3, `(-1 + 2) * 3 - -4` is 7. Two errors: `1 +` prints `[line 1] Error at end: Expect expression.` and exits with status 65, and `(1` reports a missing `)`.

> **If it fails:** If `make get` prints "The lower bound of sdk '>2.11.0 <3.0.0' must be 2.12.0 or higher to enable null safety", apt installed Dart 3. Run `sudo apt install -y --allow-downgrades dart=2.19.6-1`, where `--allow-downgrades` lets apt replace a newer version with an older one. Then run `sudo apt-mark hold dart` and `make get` again.

### Done when

`dart --version` names 2.19.6. The chap17_compiling suite passes against your debug build, and `tests/expr.sh` passes, with no sanitizer report.

## Values, strings and a hash table

Until now every value was a `double`. Lox also has booleans, `nil` and strings, so a value needs to say which kind it is.

clox stores a value as a type tag plus a payload. The payload is a **union**, a C type whose members share the same bytes, so it is as large as its largest member and holds one member at a time. The tag says which member is valid, like the `kind` field of chapter 04's `Json` struct. On x86-64 a `Value` is 16 bytes: a 4-byte tag, 4 bytes of padding and an 8-byte payload. CI 30 squeezes it into 8.

A string does not fit in 8 bytes, so it lives on the heap as an **object**. Every object starts with the same header, `Obj`, which holds the object's type and a pointer to the next object:

![A Value on the VM stack is a 4-byte type tag, 4 bytes of padding and an 8-byte payload. For a string the payload points at an ObjString on the heap, which starts with the Obj header shared by every object.](figures/11-value-object.svg)

Code that holds an `Obj *` checks the type and then casts the pointer to the specific struct, such as `ObjString *`. C allows the cast because a pointer to a struct also points at its first member. CI 19 calls this struct inheritance. The `next` pointers link every object into one list, so the VM can free them all at exit, and in CI 26 find the ones that are garbage.

CI 20 builds the hash table that clox uses for global variables, for strings and later for fields and methods. It uses open addressing with linear probing, like your chapter 07 table, with FNV-1a as the hash, a simple hash that mixes each byte of the key into one number, and at most 75% of the slots in use. Deleting a key leaves a **tombstone**, a marker that says "something was here", so lookups keep probing past it:

![A table of 8 slots with linear probing. a and b both hash to slot 2, so b goes to slot 3, and c, which hashes to 3, goes to 4. Deleting b leaves a tombstone, so a lookup of c still probes past slot 3 and finds c in slot 4.](figures/11-hash-table.svg)

clox counts tombstones as used slots, so a table full of tombstones still grows. Your chapter 07 table probed groups of 16 control bytes with SIMD and a triangular sequence. Compare the two as you type this one: what a lookup touches in memory, and what deleting a key leaves behind.

The table also makes **string interning** possible. clox stores every distinct string once, and creating a string first looks it up in the VM's `strings` table. Two equal strings are then the same object, and comparing them is a pointer comparison.

### Study

- [Crafting Interpreters: Types of Values](https://craftinginterpreters.com/types-of-values.html) (do, 2 h 30 min): The whole chapter, 18.1 to 18.4. Skip the challenges.
- [Crafting Interpreters: Strings](https://craftinginterpreters.com/strings.html) (do, 2 h 30 min): The whole chapter, 19.1 to 19.5, and the design note "String Encoding".
- [Crafting Interpreters: Hash Tables](https://craftinginterpreters.com/hash-tables.html) (do, 3 h): The whole chapter, 20.1 to 20.5. Skip the challenges.

### Build

1. Type CI 18 to CI 20 and run the chap18_types, chap19_strings and chap20_hash suites at the end of each.
2. Add to `tests/expr.sh`: `!(5 - 4 > 3 * 2 == !nil)` prints `true`, `"st" + "ri" + "ng"` prints `string`, `nil == false` prints `false`, `"a" + "b" == "ab"` prints `true`, and `1 + "a"` prints the runtime error `Operands must be two numbers or two strings.` and exits with status 70.
3. Write `tests/table_test.c` with its own `main`. Build it with a second compiler line at the end of `build_clox.sh`, which compiles it together with every clox file except `main.c`:

   ```sh
   $cc -std=gnu11 $warn $flags $EXTRA -o "$out/table_test" tests/table_test.c $(ls src/clox/*.c | grep -v main.c)
   ```

   `$( )` runs the command inside and puts its output in the line, as `$(uname -s)` does. `grep -v main.c` drops the line `src/clox/main.c` from the list.
4. The test takes a key count from the command line, 100,000 when none is given. It inserts that many distinct keys, deletes every second one, checks that each remaining key is found and each deleted key is not, then inserts the deleted keys again. Make keys with `copyString`, so call `initVM` first and `freeVM` at the end. Print the table's capacity and its count after each phase.

### Done when

The chap20_hash suite and `tests/expr.sh` pass. `table_test` passes with no AddressSanitizer or LeakSanitizer report. It prints a capacity of 262144 and a count of 100000 after all three phases, and you can explain from the code why the count does not drop when half the keys are deleted, and where the reinserted keys go.

## Variables and control flow

Lox now evaluates expressions. Real programs need variables and statements that run in order, skip ahead and repeat.

From CI 21 on a program is a list of **statements**: `print`, variable declarations, blocks and expression statements. A bare expression is no longer a program, so change each case in `tests/expr.sh` to `print <expression>;`. The error case becomes `print 1 +;`, which prints `[line 1] Error at ';': Expect expression.`

A **global variable** lives in a hash table keyed by its name. A **local variable** lives in a slot of the value stack. The compiler keeps a list of the locals in **scope**, the region of code where a name is visible, and knows at compile time which slot holds each one. So `OP_GET_LOCAL 2` reads slot 2 with no lookup at run time.

Control flow is jumps over bytecode, as in chapter 03's Hack assembly and the conditional jumps of your 8086 decoder. The compiler emits a jump before it knows where the jump lands. It writes a placeholder offset, remembers where, and **patches** the offset once the target is known. An `if` with an `else` compiles to two forward jumps:

![An if with an else compiles to two forward jumps. OP_JUMP_IF_FALSE skips the then-branch, OP_JUMP at its end skips the else-branch, and each branch starts by popping the condition.](figures/11-if-jumps.svg)

`and` and `or` are jumps too, because they skip their right operand. A loop is a backward jump, `OP_LOOP`. CI 23 compiles `for` from the same jumps as `while`.

The build adds a `switch` statement, challenge 1 of CI 23. It touches the scanner (three keywords, `switch`, `case` and `default`, and the `:` token), the compiler and the jump patching. Each case compares against the same switch value, so that value has to stay on the stack across the comparisons. You need one new instruction for that, for example `OP_DUP`, which pushes a copy of the top value, and an `OP_POP` of the switch value on every exit path.

Put your tests in the clone's `test/` directory, in a new `test/switch/`, using the `// expect:` comments that every test file there uses. The runner includes every directory under `test/` from the chap21_global suite on, so it picks up yours.

### Study

- [Crafting Interpreters: Global Variables](https://craftinginterpreters.com/global-variables.html) (do, 3 h): The whole chapter, 21.1 to 21.4. Skip the challenges.
- [Crafting Interpreters: Local Variables](https://craftinginterpreters.com/local-variables.html) (do, 3 h): The whole chapter, 22.1 to 22.4. Skip the challenges.
- [Crafting Interpreters: Jumping Back and Forth](https://craftinginterpreters.com/jumping-back-and-forth.html) (do, 3 h): The whole chapter, 23.1 to 23.4, then challenge 1 and the design note "Considering Goto Harmful".

### Build

1. Type CI 21 to CI 23. Run the chap21_global, chap22_local and chap23_jumping suites at the end of each.
2. Change `tests/expr.sh` to `print` statements as described above.
3. Add `switch` as challenge 1 specifies: no fallthrough, no `break`, an optional `default` at the end.
4. Write at least five tests in `test/switch/`: a match on the first case, a match on a later case, no match with a default, no match without one, and case values that are expressions evaluated in order. Add one compile error test, `case` after `default`, with the expected error in a `// [line N] Error` comment as in the book's own error tests.
5. Disassemble a `switch` with three cases and a default in a build made with `EXTRA=-DDEBUG_PRINT_CODE`, and check every jump offset by hand.

### Done when

The chap23_jumping suite passes with your `switch` tests included. The switch value is evaluated once, not once per case, and one of your tests shows this with a switch on a global that a case expression assigns to.

## Functions and call frames

So far a Lox program is one block of top-level code in one chunk. Functions need their own code, their own locals, and a way back to the caller.

In clox a function is an object with its own chunk. A call pushes a **call frame**, a struct with three fields:

- the function being run,
- its own `ip`, which keeps the caller's place while the callee runs and so works as the return address,
- `slots`, a pointer to the first value-stack slot the function may use.

The caller pushes the function and then the arguments. The callee's `slots` points at the function's own slot, so the arguments are already its first locals and nothing is copied. Every frame is a window onto one shared stack. This is chapter 05's stack frame, built from C structs:

![The script calls fib(5), which calls fib(3), which calls fib(1). All frames share one value stack. Each frame's slots pointer marks where its window starts: the called function in slot 0, then its arguments as its first locals.](figures/11-call-frames.svg)

CI 24 also adds **native functions**, functions written in C that Lox code calls like its own. The first is `clock()`, which returns the seconds since the program started. The book's benchmarks in `test/benchmark/` use it to time themselves, so from now on you can measure clox.

Challenge 1 of CI 24 keeps `ip` in a C local variable instead of reading it through the current frame on every instruction. The compiler can then keep it in a register. Measure the change with `test/benchmark/fib.lox`, which prints `true` and then its own elapsed time in seconds.

> **Practice:** Time only the release build, run each benchmark five times and keep the minimum, as chapter 07's repetition tester does. The other runs measure what else the machine was doing.

### Study

- [Crafting Interpreters: Calls and Functions](https://craftinginterpreters.com/calls-and-functions.html) (do, 5 h): The whole chapter, 24.1 to 24.7, then challenge 1.

### Build

1. Type CI 24 and run the chap24_calls suite.
2. Build the release binary and run `fib.lox` five times. Record the minimum.
3. Do challenge 1, run the suite again, and record the new fib minimum.
4. Write a Lox program where `a` calls `b` and `b` calls `c` with two arguments. Start the debug build in gdb as in chapter 01, with `ASAN_OPTIONS=detect_leaks=0` in front. Set `break callValue`, run the program, and at each stop print `vm.frameCount` and `vm.stackTop - vm.stack`, the number of values on the stack. Check them against a drawing like the figure.

### Done when

The chap24_calls suite passes in the debug build with no sanitizer report. You have release-build fib times from before and after the `ip` change. Your drawing of the three frames matches what gdb printed.

## Closures and upvalues

Lox functions can be declared inside other functions and use their locals. That breaks the stack rule from the last step.

A **closure** is a function together with the variables it uses from the functions around it. A local lives in a stack slot that is reused when its function returns. A closure that uses the local can outlive that slot:

```
fun makeCounter() {
  var i = 0;
  fun count() { i = i + 1; print i; }
  return count;
}
```

clox handles this with **upvalues**, small objects that stand for one captured variable. While `makeCounter` runs, the upvalue is **open**: it points at the stack slot of `i`, and every closure that captured `i` shares that one upvalue. When the slot is about to go away, the VM copies the value into the upvalue itself and points the upvalue at its own copy. This is called **closing** the upvalue:

![Left, while makeCounter runs: the upvalue is open and its location points at the stack slot of i. Right, after makeCounter returns: the upvalue is closed, the value 0 has been copied into it and location points at its own closed field.](figures/11-upvalue.svg)

Code that reads `i` always goes through `location`, so it works the same before and after the close. The scheme comes from Lua, and you read Lua's own description of it in the register VM step.

This chapter of the book takes the longest to type and to debug. Run the suite after each section, not only at the end.

### Study

- [Crafting Interpreters: Closures](https://craftinginterpreters.com/closures.html) (do, 5 h): The whole chapter, 25.1 to 25.4, and the design note "Closing Over the Loop Variable". Skip the challenges.

### Build

1. Type CI 25 and run the chap25_closures suite.
2. Write a Lox function that declares one local and returns two closures that both change it, for example by storing them in two globals. Draw the stack and the upvalue, as in the figure, at the moment before the outer function returns and after.
3. Check the drawing by running the program in a build made with `EXTRA=-DDEBUG_TRACE_EXECUTION`.

### Done when

The chap25_closures suite passes in the debug build with no sanitizer report. You can point at the instruction in your trace where the shared upvalue is closed, and explain why both closures still see each other's changes after it closes.

## A mark-sweep garbage collector

clox has allocated objects and never freed one until exit. A long-running program would grow without limit. CI 26 adds a mark-sweep collector.

A **root** is a place the VM reads values from directly: the value stack, each frame's closure, the open upvalues, the globals table and the functions the compiler is still building. **Marking** starts at the roots and follows every reference from object to object, setting a mark bit on each object it reaches. **Sweeping** then walks the list of all objects and frees each one that is not marked.

The book organizes marking with three colors:

- **White**: not reached yet. An object still white at the end is garbage.
- **Gray**: reached and marked, but its own references are not followed yet. Gray objects wait on a **worklist**, an array of objects still to process.
- **Black**: reached, and every object it references has been marked.

Marking pops a gray object off the worklist, marks the white objects it references and pushes them, and the popped object is then black. It stops when the worklist is empty:

![Marking in progress. The roots reach A and B. A is black: marked and traced. B and C are gray: marked and waiting on the worklist. D and E point at each other, but nothing reachable points at them, so they stay white and the sweep frees them.](figures/11-mark-sweep.svg)

The hard bugs are missing roots. An object that only a C local variable points to is invisible to the collector. If an allocation in the middle of a C function starts a collection, that object is freed while the C code still uses it. Section 26.7 shows three such bugs and fixes each one by keeping the object on the VM stack while the C code needs it. Lua's C API, later in this chapter, is built around the same rule.

`DEBUG_STRESS_GC` runs a full collection before every allocation, so a missing root fails at the first allocation after it is lost. With AddressSanitizer on, the failure is a heap-use-after-free report that names the line that used the object, the collection that freed it and the allocation that created it.

> **Practice:** Keep `DEBUG_STRESS_GC` on in the debug build for the rest of clox, and off in the release build you time.

`build_clox.sh` does that for you once you change its debug branch to this:

```sh
else
    flags="-g3 -O0 -fsanitize=${SAN:-address,undefined} -fno-sanitize-recover=undefined"
    if [ "${STRESS:-1}" = 1 ]; then
        flags="$flags -DDEBUG_STRESS_GC"
    fi
fi
```

`${STRESS:-1}` is 1 unless you set `STRESS` yourself. A debug build now defines `DEBUG_STRESS_GC`, and `STRESS=0 sh build_clox.sh` builds one without it.

### Study

- [Crafting Interpreters: Garbage Collection](https://craftinginterpreters.com/garbage-collection.html) (do, 4 h): The whole chapter, 26.1 to 26.7, the design note "Generational Collectors" and challenge 1, which you answer in writing.

### Build

1. Change the debug branch of `build_clox.sh` as shown above. Type CI 26. Where the book adds `DEBUG_LOG_GC`, look at its log once with `EXTRA=-DDEBUG_LOG_GC`. Then run the chap26_garbage suite in a plain debug build, which has stress mode on.
2. Undo the `concatenate` fix from section 26.7: pop both strings at the top of the function again and drop the two `pop()` calls at the end. Rebuild and run `print ("a" + "b") + ("c" + "d");`. The strings `"ab"` and `"cd"` live only on the stack, so once they are popped, the allocation inside `concatenate` frees them. Read the report, then put the fix back.
3. Build with `STRESS=0 sh build_clox.sh` and run `table_test` from the values step again. After CI 26 it fails even without stress mode, once the heap passes the first collection threshold. Read the report: the test's keys are reachable only from a table in a C variable.
4. Fix the test in two parts. Add a `Table *extraRoot` field to the VM that `markRoots` marks with `markTable` when it is not `NULL`, and point it at the test's table. Then push each key with `push(OBJ_VAL(key))` before `tableSet` and pop it after, as 26.7.2 does, because `tableSet` can allocate before the key is in the table. Run it with 100,000 keys in a build made with `STRESS=0 sh build_clox.sh`, then with 2,000 keys in a plain debug build, which has stress mode on. Stress mode runs a full collection per allocation, so 100,000 keys would take minutes.
5. Write `bench/churn.lox`, a loop that creates a million closures and drops each one. Run the release build under `/usr/bin/time -v`, which prints the time and memory a program used, and note "Maximum resident set size" in kilobytes. Then comment out the `collectGarbage` call under the `nextGC` check in `reallocate`, run it again and compare.
6. Answer challenge 1: compute `sizeof(Obj)` on x86-64 from its fields and the padding rules of chapter 02, then print it and compare.

> **If it fails:** If `/usr/bin/time` is missing, install it with `sudo apt install -y time`. A plain `time` runs the shell's built-in, which only prints durations.

### Done when

The chap26_garbage suite passes with stress mode and AddressSanitizer on, with no report. You have the report for the fix you undid and can say which object was freed and which line still used it. `table_test` passes with 100,000 keys and with stress mode on and 2,000 keys. The peak memory of `churn.lox` stays at a few megabytes with the collector and is far larger without it.

## Classes, methods and inheritance

With the collector in place, clox runs every kind of Lox program except one with classes. CI 27 to CI 29 add them.

A **class** is an object with a table of methods. An **instance** is an object with a table of fields and a pointer to its class. A **method** is a function stored in a class, and a call such as `point.move(1)` looks the name up at run time, first among the fields and then among the methods. When a method is read without being called, clox wraps it with its instance into a **bound method** object, so `this` still refers to that instance later:

![An instance points at its class and holds its own fields. The class holds the methods. Reading p.move without calling it creates a bound method that points at the receiver p and at the method's closure.](figures/11-classes.svg)

Inheritance copies the superclass's methods into the subclass when the class is created.

Lua does not have classes. It builds objects from tables and metatables instead, which you meet in the Lua steps. Type these chapters anyway. The book's tests and benchmarks use classes, and the measuring steps time them.

Section 28.5 adds a **superinstruction**, one instruction that does the work of several. `OP_INVOKE` looks up a method and calls it, where the plain path runs `OP_GET_PROPERTY`, creates a bound method object and runs `OP_CALL`. Most method calls never need the bound method, so the superinstruction saves an allocation per call.

### Study

- [Crafting Interpreters: Classes and Instances, Methods and Initializers, Superclasses](https://craftinginterpreters.com/classes-and-instances.html) (do, 9 h): CI 27 at this link, then CI 28 at `methods-and-initializers.html` and CI 29 at `superclasses.html` on the same site. Read the design note "Novelty Budget" in CI 28. Skip the challenges in all three chapters.

### Build

1. Type CI 27 and run the chap27_classes suite.
2. Type CI 28 up to section 28.5. Disassemble `class A { m(x) { return x; } } var a = A(); print a.m(1);` in a build made with `EXTRA=-DDEBUG_PRINT_CODE` and find `OP_GET_PROPERTY` followed by `OP_CALL`. Type 28.5 and find `OP_INVOKE` in their place. Run the chap28_methods suite.
3. Type CI 29 and run the full suite: `dart tool/bin/test.dart clox --interpreter <path to your clox>`.

### Done when

The full `clox` suite passes in the debug build with stress mode on and no sanitizer report. You have both disassemblies of the method call and can say which object the plain path allocates that `OP_INVOKE` does not.

## Measuring clox and faster probing

clox is complete. CI 30 makes it faster. Before you change anything, find out where the time goes, with the tools from chapter 07.

Start with `perf`, through the alias for the generic copy that chapter 07 set up. Build a release copy with `EXTRA="-g -fno-omit-frame-pointer" sh build_clox.sh release`. `-g` adds the line information `perf annotate` needs, and the frame pointer lets `perf record -g` follow callers. On `fib.lox`, expect most samples in `run`, the dispatch loop, and most of the rest in `tableGet` and `callValue`. `tableGet` is the lookup of the global `fib` on every call.

`perf` cannot tell you which opcodes run inside `run`, because every opcode lives in that one function. `perf annotate` shows the hot instructions, but a direct count is easier to read. Add an array of 64-bit counters indexed by opcode, incremented at the top of the dispatch loop, and print the counts at exit. Chapter 07's block profiler would not help here: a timer around an instruction that runs for a few nanoseconds measures mostly the timer.

Section 30.2 makes the first change. Hash probing computes `hash % capacity`, and `%` compiles to a division, one of the slowest arithmetic instructions. The capacity is always a power of two, so `hash & (capacity - 1)` keeps the same low bits with one AND.

> **Practice:** Change one thing at a time and run the benchmarks after each change, release build, minimum of five runs. A table with one column per change tells you which change did what.

### Study

- [Crafting Interpreters: Optimization](https://craftinginterpreters.com/optimization.html) (do, 1 h 30 min): 30.1 and 30.2. Stop at 30.3 NaN Boxing, which the next step covers.

### Build

1. Run `perf stat -e task-clock` and then `perf record -g` with `perf report --stdio --no-children` on `fib.lox` with the release build from above. Then run `perf annotate --stdio -s run` and find the hottest lines.
2. Add the opcode counter inside `#ifdef COUNT_OPCODES`, and build it with `EXTRA=-DCOUNT_OPCODES sh build_clox.sh release`.
3. Run every program in `test/benchmark/` in a plain release build. Record the time each prints, minimum of five runs, as the first column of your table. Record the five most frequent opcodes of each from the counting build.
4. Type section 30.2, run the suite in the debug build, and measure again for the second column.

### Done when

You have the `perf` profile of `fib.lox` and the opcode counts of every benchmark. Your table has a row per benchmark and two columns, before CI 30 and mask probing. Next to the second column you have one sentence, based on the opcode counts and the profile, on which benchmarks the mask helped and why.

## NaN boxing and computed goto

A clox value is 16 bytes, and every instruction goes through one shared jump in `run`. Section 30.3 halves the first, and you change the second yourself.

Chapter 04's floats step showed the fields of a `double`: a sign bit, an 11-bit exponent and a 52-bit fraction, which Crafting Interpreters calls the **mantissa**. An exponent of all ones means infinity when the fraction is 0 and NaN otherwise. A NaN whose top fraction bit, the **quiet bit**, is set is a **quiet NaN**. That is the kind of NaN arithmetic produces, for example from 0.0 / 0.0:

![A 64-bit double is 1 sign bit, 11 exponent bits and 52 fraction bits. The number 1.5 has an ordinary exponent. When all 11 exponent bits are ones and the top fraction bit is set, the value is a quiet NaN, and the remaining fraction bits are free to hold other data.](figures/11-double-bits.svg)

The hardware never produces most quiet NaN bit patterns. **NaN boxing** uses them to hold everything that is not a number, so a `Value` fits in 8 bytes. clox also sets bit 50, which keeps it clear of the one quiet NaN that Intel CPUs produce themselves:

```
  QNAN     0x7ffc000000000000
  number   any value that does not have all the QNAN bits set
  nil      QNAN | 1
  false    QNAN | 2
  true     QNAN | 3
  object   SIGN_BIT | QNAN | pointer   (user-space pointers fit in 48 bits)
```

Every NaN-boxing macro in the book is a mask or a compare on those bits, written with the bitwise operators of chapter 04.

The last change is **dispatch**, the jump from one instruction's code to the next. A `switch` compiles to one indirect jump through a table, shared by every opcode. **Computed goto**, a GNU C extension that clang supports, takes the address of a label with `&&label` and jumps to it with `goto *p`. With it, each opcode's code ends in its own indirect jump:

![Left, a switch: every opcode's code jumps back to one shared indirect jump, so the branch predictor sees one jump with many targets. Right, computed goto: each opcode's code ends in its own indirect jump, so there is one jump per opcode to predict.](figures/11-dispatch.svg)

Chapter 07's branch predictor then has one jump per opcode to learn from. Bendersky measured computed goto 25% faster on a small VM in 2012. A 2015 paper by Rohou, Swamy and Seznec found that Intel's predictors since Haswell, its 2013 generation of cores, guess the shared jump well too, so measure it on your own laptop and go by your numbers. Lua does the same in `lvm.c`, which you read later.

### Study

- [Crafting Interpreters: NaN Boxing](https://craftinginterpreters.com/optimization.html#nan-boxing) (do, 2 h 30 min): 30.3 and 30.4, the rest of the chapter from the last step.
- [Eli Bendersky: Computed goto for efficient dispatch tables](https://eli.thegreenplace.net/2012/07/12/computed-goto-for-efficient-dispatch-tables) (read, 40 min): The whole post. The two bonus sections are annotated x86-64 disassembly of both versions from GCC at `-O3`, the same instruction set your clang writes, so compare them with your own `run`.

### Build

1. Type section 30.3. Where the book writes `#define NAN_BOXING`, build with `EXTRA=-DNAN_BOXING` instead. Measure every benchmark for the third column.
2. Add computed-goto dispatch inside `#ifdef COMPUTED_GOTO`, with a table of label addresses indexed by opcode. Build with `EXTRA="-DNAN_BOXING -DCOMPUTED_GOTO" sh build_clox.sh release` and measure for the fourth column.
3. Run `objdump -d` on that release binary and find the indirect `jmp` at the end of two opcodes' code.
4. Run the full suite in four configurations: debug and release, each with and without `EXTRA=-DNAN_BOXING`. The debug builds keep stress mode on.

> **Optional, on the Mac:** Build clox there with and without `COMPUTED_GOTO` and compare the ratio with your laptop's. Apple's cores predict indirect jumps differently.

### Done when

The full clox suite passes in all four configurations, and the debug runs show no sanitizer report. Your table has four columns: the version before CI 30, mask probing, NaN boxing, computed goto. Next to each of the last two you have one sentence, based on the opcode counts and the `perf` profile, on why it helped the benchmarks it helped and not the others.

## Lua: building it and learning the language

The rest of the chapter studies Lua, a production interpreter built from the same parts as clox: tagged values, a hash table at the center, upvalues and a garbage collector. This step builds it and teaches the language.

Lua's types are nil, booleans, numbers (64-bit integers and doubles, as two subtypes), strings, functions, userdata, threads and tables. A **table** is the only data structure: an associative array whose keys can be any value except nil. Arrays, records, modules and objects are all tables. A **metatable** is a second table attached to a table, whose entries, the **metamethods**, change what operators and indexing do on it. Lua builds objects without classes that way.

A few rules differ from Lox. Indexes start at 1, functions return several values, and a variable is global unless declared `local`.

Programming in Lua teaches the language in short chapters. Roberto Ierusalimschy, who leads Lua's design, wrote it, and its first edition is free on lua.org. You use the same edition again for the C API. It was written for Lua 5.0, and three things in its part I have changed since:

- PiL 2.3 says Lua has no integer type. Lua 5.5 keeps integers and floats as two subtypes of number, and `7 // 2` is the integer 3.
- PiL 5.2 reads extra arguments from a hidden table `arg`. In Lua 5.5 write `local args = {...}` instead.
- Lua 5.5 adds a `global` declaration next to `local`.

`#` gives the length of a string or of a table used as an array, as in `#"abc"` or `#t`.

The 5.5 reference manual states the rules for the version you build. Its sections 2 and 3 cover the values, the collector and the language itself, and section 6 lists the standard library.

You build Lua 5.5.1 from source, from lua.org. The download page lists the commands, and the build is a Makefile like the one you wrote in chapter 05. `make linux test` builds for Linux and runs the test target, which prints the version. The download page writes `make all test`, which guesses the platform with `uname` and runs the same `linux` target.

Lua's Makefile compiles with gcc, which chapter 05 installed. The library follows the same ABI as clang's output, so you link it into clang programs later. `make local` then copies the programs, headers and library into `lua-5.5.1/install/`:

- `bin/lua`, the interpreter.
- `bin/luac`, the compiler, which turns a Lua file into bytecode and with `-l` lists that bytecode.
- `include/` and `lib/liblua.a`, the headers and static library that a C program links to use Lua. You need those in the C API step.

### Study

- [Programming in Lua, 1st edition: Getting Started](https://www.lua.org/pil/1.html) (read, 2 h 30 min): Chapters 1 to 6 through the "Next" links, 1.1 to 6.3, then 13.1 Arithmetic Metamethods. Lua 5.0 code, so keep the three changes above in mind.
- [Lua 5.5 Reference Manual, section 2: Basic Concepts](https://www.lua.org/manual/5.5/manual.html#2) (read, 1 h): Skim sections 2 and 3 to see what is where. Read 2.1 on the number subtypes, 3.3.7 on `local` and `global` declarations and 3.4.7 on the length operator.

### Build

1. In `~/code`, run `curl -L -R -O https://www.lua.org/ftp/lua-5.5.1.tar.gz` and `tar xzf lua-5.5.1.tar.gz`, which download and unpack as in chapter 06. `-R` gives the file the date it has on the server. In `lua-5.5.1`, run `make linux test`, then `make local`.
2. Run `./install/bin/lua` and try what you read: a table used as an array, a table used as a record, a function that returns two values, and a metatable with `__add`. Press Ctrl-D to leave.
3. In `notes/lox-vs-lua.md`, write what each language does for: which values count as false, `1 == "1"`, reading an undefined global, and `"10" + 1`. Check each answer in both interpreters.
4. Write `lox_scan.lua`, a port of your clox scanner to Lua, including your `switch` keywords. It reads a file and prints the same lines as `clox --tokens`, with the same token type numbers. Look up library functions in section 6 of the same manual: 6.2 for the basic functions, 6.5 for strings and 6.9 for `io.open` and `file:read`.
5. Write `tests/scan_diff.sh`, which runs both scanners on every `.lox` file under the clone's `test/` directory and diffs their outputs.

> **Optional:** `make linux` builds `lua` without line editing, so the arrow keys print `^[[A` at its prompt. `sudo apt install -y libreadline-dev`, then `make linux-readline test` and `make local` again, gives it history and editing.

### Done when

`make linux test` prints `Lua 5.5.1`. Every answer in `notes/lox-vs-lua.md` is checked in both interpreters. `tests/scan_diff.sh` reports no difference on any test file.

## Lua's register VM

You know Lua as a language. This step reads how its VM runs that language and compares it with clox.

The paper "The Implementation of Lua 5.0" explains the design in 18 pages. Lua switched from a stack VM to a **register VM** in version 5.0. Each function gets a window of the Lua stack as its registers, like a clox call frame, and its locals live in fixed registers. An instruction names its operands by register number, so it does not push and pop. The same statement takes five instructions in clox and two in Lua:

![The same statement, x = a * b + c with four locals. clox runs five instructions that move values through the stack. Lua runs two instructions that name registers directly, and skips the MMBIN after each because the operands are numbers.](figures/11-stack-vs-register.svg)

Fewer instructions mean fewer dispatches. Each instruction is wider, though, and has to be split into fields, as your 8086 decoder did. In Lua 5.4 and 5.5 an `MMBIN` follows each arithmetic instruction. The VM skips it when both operands are numbers and runs it to call a metamethod otherwise.

The paper describes Lua 5.0, with 35 instructions, a 6-bit opcode, an 8-bit A field and 9-bit B and C fields. Lua 5.5 has a 7-bit opcode, 8-bit A, B and C fields and a `k` bit that says whether an operand is a constant. Its `lopcodes.h` documents every instruction in a comment table, one line each. The table design, an array part plus a hash part, and the upvalues are as the paper describes. clox took its open and closed upvalues from section 5 of the paper.

`luac -l -l -p file.lua` prints the bytecode of a file with its constants, locals and upvalues. `-p` only parses, so no output file is written. In `lvm.c`, the function `luaV_execute` is Lua's dispatch loop. Its `vmdispatch` and `vmcase` macros expand to a `switch`, or, when the compiler is GCC or clang, to the computed gotos defined in `ljumptab.h`.

### Study

- [Ierusalimschy, de Figueiredo, Celes: The Implementation of Lua 5.0](https://www.lua.org/doc/jucs05.pdf) (read, 1 h 30 min): Sections 1 to 5 (pages 1 to 10, stop where section 6 starts on page 10) and section 7 (pages 11 to 15). Skip section 6 on coroutines and section 8, the conclusion with the benchmarks, on page 16.
- [Lua 5.5 source: lopcodes.h](https://www.lua.org/source/5.5/lopcodes.h.html) (reference, as needed): The instruction formats near the top and the table of opcodes with their comments.

### Build

1. Read `luaV_execute` in `lua-5.5.1/src/lvm.c` (1 h): the `vmfetch` and `vmdispatch` macros, `ljumptab.h` in the same directory, and the `OP_ADD` case.
2. Write fib, the `makeCounter` closure from the closures step, and a loop that sums 1 to 10,000,000, in both Lox and Lua. Put the loop inside a function and use only locals in both languages, so both compile to local-slot access.
3. Disassemble each with a clox built with `EXTRA=-DDEBUG_PRINT_CODE` and with `luac -l -l -p`. Count the instructions in each function body and the instructions per loop iteration. Then write the loop a second time with globals in both languages and count again.
4. Write `notes/opcodes.md`: a table with each of clox's opcodes and the Lua 5.5 opcode or opcodes that do the same job, or "none" with a reason.
5. Time fib(35) in both release builds, using `clock()` in Lox and `os.clock()` (manual section 6.10) in Lua, minimum of five runs.
6. Open `lua-5.5.1/src/lgc.c`, Lua's collector. Find where it marks (`reallymarkobject` and `propagatemark`, with the same white, gray and black) and where it sweeps (`sweeplist`). Then find `singlestep`: Lua collects **incrementally**, a few objects at a time between pieces of the program's own work, where clox's `collectGarbage` does a whole collection at once. Write two sentences in `notes/opcodes.md` on what that changes, using the "Generational Collectors" design note of CI 26 and manual section 2.5.

### Done when

`notes/opcodes.md` covers all of clox's opcodes and ends with a paragraph, based on your three programs, on why the register VM runs fewer instructions per loop iteration, with the extra count for the globals version in each language, and your two sentences on `lgc.c`. Given `local x = a * b + c` with `a`, `b` and `c` as locals, you can write Lua's instructions before you run `luac`, and find the `OP_ADD` case in `luaV_execute`.

## Calling between C and Lua

In the last two steps you ran Lua through its own `lua` and `luac` programs. Lua is built to live inside a C program instead, called the **host**. The host links `liblua.a`, creates an interpreter and calls into it.

A **`lua_State`** is one interpreter with its own globals and stack, created with `luaL_newstate`. C and Lua exchange values through a **virtual stack** that belongs to the `lua_State`. C code pushes values, calls functions and reads results by index. Index 1 is the bottom of the stack and counts up. Negative indexes count from the top, so -1 is the top value:

![The virtual stack while C calls the Lua function f with 3 and 4. C pushes a message handler, the function and the arguments. lua_pcall pops the function and arguments and pushes one result, or the error message. Index 1 is the bottom and -1 the top.](figures/11-c-api-stack.svg)

C never holds a Lua value directly, because the collector cannot see C variables. That is the missing-root problem from the collector step. A value on the Lua stack is reachable, so it is safe. A pointer you copied out of it, such as the `const char *` of a string, is valid only while the value stays on the stack.

Errors in Lua use `setjmp` and `longjmp` from the C library. `setjmp` saves the stack pointer, the instruction pointer and the callee-saved registers of chapter 05's ABI. `longjmp` restores them, so execution continues at the `setjmp` and every frame in between is abandoned without running its cleanup. **`lua_pcall`**, a protected call, sets such a point, calls a function and returns a status code with the error value on the stack. An error outside any `lua_pcall` calls a panic function and then `abort`.

Two rules follow. Call Lua code only through `lua_pcall`. In a C function that Lua calls, hold no memory, lock or open file across an API call that can raise an error, because the jump skips your `free`.

Part IV of Programming in Lua, the first edition you read for the language, teaches the C API with short examples. The C API changed more than the language since Lua 5.0, so translate these names as you read:

| PiL 1st edition (Lua 5.0) | Lua 5.5 |
| --- | --- |
| `lua_open()` | `luaL_newstate()` |
| `luaopen_base(L)` and the other opens | `luaL_openlibs(L)` |
| `luaL_openlib(L, "name", reg, 0)` | `luaL_newlib(L, reg)`, then `lua_setglobal(L, "name")` |
| `struct luaL_reg` | `luaL_Reg` |
| `luaL_checkint`, `luaL_optint` | `luaL_checkinteger`, `luaL_optinteger` |
| `lua_strlen` | `lua_rawlen` |
| `luaL_getn` | `luaL_len` |
| `lua_newuserdata(L, size)` | `lua_newuserdatauv(L, size, 0)` |
| `lua_cpcall(L, f, p)` | `lua_pushcfunction(L, f)`, push `p`, `lua_pcall` |

Section 4 of the 5.5 manual states the same contract for the version you built. Each function in section 4.6 has a box like `[-o, +p, x]`: how many values it pops, how many it pushes, and whether it can raise an error.

Build the host with `build.sh` and the `LIBS` variable from chapter 06. `-I` adds a directory where clang looks for headers, the `.a` path links the static library, and `-lm` adds libm, which Lua's math uses:

```sh
lua=$HOME/code/lua-5.5.1/install
LIBS="-I$lua/include $lua/lib/liblua.a -lm" sh build.sh host
```

### Study

- [Programming in Lua, 1st edition: An Overview of the C API](https://www.lua.org/pil/24.html) (read, 2 h): Chapters 24, 25 and 26 through the "Next" links, 24.1 to 26.2. Lua 5.0 code, so use the table above.
- [Lua 5.5 Reference Manual, section 4: The Application Program Interface](https://www.lua.org/manual/5.5/manual.html#4) (read, 40 min): 4.1 to 4.4. Skip 4.5 on yields.
- [Lua 5.5 Reference Manual, section 4.6: Functions and Types](https://www.lua.org/manual/5.5/manual.html#4.6) (reference, as needed): Every C API function with its `[-o, +p, x]` box. Keep it open together with 4.7, the debug interface, and 5.1, the auxiliary library, for every function you call in this step and the next, in particular `lua_pcall`, `luaL_loadfile`, `luaL_traceback` and `luaL_newlib`.

### Build

Write `src/host.c`:

1. Create a state, open the standard libraries and run `config.lua` with `luaL_loadfile` and `lua_pcall`. Read the globals `width`, `height` and `title`, check each one's type, and print them. A missing or wrongly typed value prints a message that names the variable and exits with status 1.
2. Call the Lua function `transform(s)` from C with a string from the command line and print the string it returns, as PiL 25.2 does. Push a message handler first that calls `luaL_traceback`, and pass its index to `lua_pcall`, so an error inside `transform` prints a traceback.
3. Register a C library `host` with `host.now()`, which returns seconds from `clock_gettime(CLOCK_MONOTONIC)` as a float, and `host.log(level, message)`, which checks that `level` is `"info"` or `"error"` and raises an error otherwise.
4. After every call, assert that `lua_gettop` equals what it was before. Write test scripts for: a syntax error in `config.lua`, `width = "wide"`, `transform` calling a nil global, `transform` returning a number, `host.log("debug", "x")`, and `error({code = 42})` with a table as the error value.

### Done when

Every test script gives a clear message and a nonzero status, and none of them crashes or trips a stack-height assert. The debug build reports nothing under AddressSanitizer and LeakSanitizer, which needs `lua_close` on every exit path. For the call to `transform`, you can draw the Lua stack before and after each API call, matching the `[-o, +p, x]` boxes in the manual.

## Lua route handlers in the HTTP server

The host from the last step ran one script and exited. This step puts Lua inside your server, which runs for hours and calls Lua for every request. Start from `httpd2.c`, the chapter 09 version that runs slow requests on the job system. A file `routes.lua` returns a table that maps a path to a handler function. The server calls the handler for a matching request and serves its files for everything else.

The server needs three things from the C API:

- **The routes table between requests.** A C pointer to a Lua table would not keep it alive, but a reference does. The **registry** is a table reserved for C code, and `luaL_ref` stores a value in it and returns an integer key that C can keep.
- **A response object.** The handler builds its response through a **userdata**, a block of memory that Lua allocates and the collector owns. A metatable gives it methods: `res:status(n)`, `res:header(name, value)` and `res:write(s)`. The C struct inside the userdata points at the connection.
- **A `live` flag in that struct.** The connection pointer is valid only during the handler call. A script can store `res` in a global and call `res:write` a minute later, after the connection has closed. Clear the flag when the handler returns, and make every method raise an error when it is clear.

![During a handler call the response userdata points at the C connection and its live flag is 1. The server finds the routes table through an integer key in the registry. After the handler returns the flag is 0, so a res kept in a global still exists but every method on it raises an error.](figures/11-http-handler.svg)

The figure shows why the flag is needed. `res` is still a valid Lua value after the handler returns, because a global refers to it, but the connection it pointed at may be gone.

The C side also checks everything Lua hands back before it reaches the socket. A script can return any status number and any header text, and a header value with a line break in it would let the script add headers of its own.

One `lua_State` must never be used by two threads at once. Keep every Lua call on the loop thread, and keep the chapter 09 jobs away from Lua.

The manual sections you kept open from the last step cover the functions: `luaL_ref`, `luaL_newmetatable`, `luaL_checkudata` and `lua_newuserdatauv` in 4.6 and 5.1.

### Study

- [Programming in Lua, 1st edition: Storing State in C Functions](https://www.lua.org/pil/27.3.html) (read, 30 min): 27.3.1 The Registry, 27.3.2 References, 27.3.3 Upvalues.
- [Programming in Lua, 1st edition: User-Defined Types in C](https://www.lua.org/pil/28.html) (read, 1 h): 28.1 to 28.3. Lua 5.0 code: use the table from the last step, and `luaL_setmetatable` for the two calls `luaL_getmetatable` and `lua_setmetatable`.

### Build

1. Copy `src/httpd2.c` to `src/httpd_lua.c` and build it with the `LIBS` line from the last step.
2. Load `routes.lua` at startup and keep the returned table in the registry. For a request whose path is in the table, build a request table `{method = ..., path = ..., headers = {...}}` with lowercased header names, create a response userdata, and call the handler under `lua_pcall` with a traceback handler. Then format the status line, headers, `Content-Length` and body into the connection's output buffer as chapter 08 does. HEAD gets no body.
3. Check what Lua hands you. The status must be from 100 to 599. Header names and values must not contain CR or LF. The body has a size limit. A handler error or a broken rule gives a 500 response and a traceback on `stderr`.
4. Extend `tests/http.sh`: a Lua route, a HEAD request to it, a route that raises an error, a route that stores `res` in a global and a second route that writes to it, and a header value containing `\r\n`.

### Done when

`sh tests/http.sh` passes with the server in the debug build, and AddressSanitizer reports nothing. The second request of the stored-`res` test gets a 500 and a traceback with the error from your `live` check, and the server keeps serving. The `\r\n` test gets a 500, not a response with an extra header.

## Keeping the server safe from its scripts

The server now runs Lua for some requests. A handler can still stop it, an edit to `routes.lua` needs a restart, and Ctrl-C ends it without cleanup. This step fixes all three.

A handler runs on the event loop's thread, and while it runs no other client is served. `while true do end` in a handler would stop the server. The fixes, one per problem:

- **An instruction budget.** `lua_sethook` with `LUA_MASKCOUNT` calls a C function, a **hook**, after a given number of Lua instructions. If the hook raises an error, the handler's `lua_pcall` returns it, the same way `lua.c` stops a script on Ctrl-C. The count covers only Lua instructions. A call into C, such as `string.rep("x", 1e9)`, runs to its end first.
- **Reloading while the server runs.** Load and run the new `routes.lua` under `lua_pcall`, check that it returned a table, and only then swap the registry reference. A file with a syntax error leaves the old routes in place. Globals live in the state, so a global counter in the script survives a reload.
- **Noticing the edit.** `stat` fills a `struct stat` with a file's size and times. Its `st_mtime` field holds whole seconds, so two writes within one second look like one. Compare `st_mtime` and `st_size` together, and have the tests wait a second between writes.
- **A clean shutdown.** On SIGINT a handler sets a flag and the loop exits, closes the `lua_State` with `lua_close` and frees everything. The flag is a `volatile sig_atomic_t`, the type the C standard allows a signal handler to set.

`lua_sethook` and `lua_Hook` are in section 4.7 of the manual you kept open.

### Study

- [stat(2)](https://man7.org/linux/man-pages/man2/stat.2.html) (reference, as needed): DESCRIPTION and the example program. The field list is in stat(3type), linked from the page.

### Build

1. Set an instruction budget with `lua_sethook` before each handler call and remove it afterwards. Start with 1,000,000 instructions. Time a `while true do end` handler and pick a budget that ends it in under 20 ms. An exhausted budget gives a 500 response.
2. Check `st_mtime` and `st_size` of `routes.lua` with `stat` at most once per second, using the loop's wait timeout. Reload when either changed, as described above.
3. Shut down on SIGINT with a handler that only sets the flag, following the signal-safety rule from chapter 08's shell step.
4. Extend `tests/http.sh`: a route with `while true do end`, a `/count` route backed by a global counter that keeps counting across a reload, and a reload with a syntax error that leaves the old routes working. Put `sleep 1` between two writes of `routes.lua`, and after each write wait long enough for the once-per-second check to see it.

### Done when

`sh tests/http.sh` passes. During the `while true do end` request, the pinger from chapter 08's `httptest` keeps its worst round trip under 50 ms. `wrk -t2 -c100 -d10s` gives you requests per second for a static file and for a Lua route. After a run of at least 10,000 Lua requests, a `/stats` route that returns `collectgarbage("count")` shows memory staying in a fixed range instead of growing with the request count. The server exits on Ctrl-C with no LeakSanitizer report.

## Where this leads

You have implemented a language end to end. Source text becomes tokens, a single-pass compiler turns tokens into bytecode, and a dispatch loop runs that bytecode over a value stack, with call frames, closures that outlive their stack slots and a collector that finds every root. You measured what NaN boxing and computed goto change on your own CPU. You read a production VM and compared its register design with yours, and you embedded it in a server whose C side checks the types Lua hands it, refuses a response object used after its request, and stops a handler that runs too long.

Two parts of Lua were left out. Coroutines, which let a function pause and resume later, are in section 2.6 of the manual. Game scripts often use them for an action that spans several frames, so read that section when a script in chapter 14 needs one. Lua's compiler in `lparser.c` is single-pass like clox's, and you did not read it.

clox never builds a syntax tree. It emits each expression as soon as it parses it, so it never sees a whole function before generating code and does no optimization. Every instruction still goes through the dispatch loop at run time.

Chapter 12, An LLVM backend, compiles to native code instead. It starts by reading LLVM's intermediate representation, the form clang makes from your own C functions, next to the clox bytecode for the same loop. LLVM's tutorial is written in C++, so a short step teaches the part of C++ it uses. Then you build Kaleidoscope: a front end that parses into a tree and lowers it to LLVM IR, which LLVM optimizes and turns into x86-64 machine code that you read with the skills from chapter 05, and into ARM64 code that runs under `qemu-aarch64`.
