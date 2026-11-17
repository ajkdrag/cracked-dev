---
id: 11
title: Interpreters, bytecode VMs and Lua
part: Languages and compilers
weeks: 10
project: clox, a bytecode compiler and virtual machine for Lox in C that passes the book's test suite, then Lua 5.5 embedded in your chapter 08 HTTP server as route handlers that reload while the server runs.
---

Chapter 10 ported your hash table and event loop to Rust. The borrow checker decided at compile time how long each value lives and who may change it. This chapter goes back to C and builds a language whose values live as long as the running program can still reach them. A garbage collector decides that at run time, and you write the collector.

You have written interpreters before. The 8086 simulator in chapter 05 and the CHIP-8 emulator in chapter 06 each fetched an instruction, decoded it and executed it, in a loop. Those instruction sets were designed by someone else, for hardware. Here you design an instruction set for a programming language, write the compiler that produces it and write the loop that runs it. The guide is part III of Bob Nystrom's Crafting Interpreters, which builds clox: a scanner, a single-pass compiler, a stack-based virtual machine, a mark-sweep garbage collector, closures and classes, in about 2,500 lines of C. Chapter 04 already used one section of the same book for recursive descent parsing.

The second half of the chapter reads and uses a production interpreter. Lua is about 32,000 lines of C. It is embedded in Neovim, Redis and many game engines, all through the same small C API. You learn the language, compare its register-based VM with clox, and then put Lua handlers into the HTTP server from chapter 08. Chapter 14 scripts its games in Lua and builds on that embedding.

The chapter comes here because it uses almost everything before it. A value is a type tag plus a payload, like the `Json` struct of chapter 04's parser. The VM's call frames do in software what chapter 05's stack frames do in hardware. The hash table repeats the open addressing and tombstones of chapter 07's SIMD table, and you measure clox with chapter 07's habits. The server is chapter 08's. Crafting Interpreters part II builds a tree-walking interpreter in Java. Skip it. Part III stands on its own, and where it mentions the Java version, the text says enough. Type the code yourself instead of pasting it, so that you read every line.

## Bytecode chunks and the VM loop

A program for clox becomes a chunk: an array of bytes that holds instructions, an array of constants, and a line number for each byte so runtime errors can name a line. An instruction is a one-byte opcode followed by its operands. `OP_CONSTANT` has one operand, an index into the constant array. Most arithmetic opcodes have none, because they take their inputs from a stack.

```
  chunk
  offset:    0            1    2            3    4        5
  code:      OP_CONSTANT  0    OP_CONSTANT  1    OP_ADD   OP_RETURN
  lines:     123          123  123          123  123      123
  constants: [0] 1.2   [1] 3.4
```

The VM is the loop you wrote twice already. `ip` points at the next byte, like the program counter in your 8086 simulator. A `switch` on the opcode runs the instruction. Instead of registers, clox keeps intermediate values on a value stack. An operation pops its operands and pushes its result. Chapter 15 runs this hand-built chunk:

```
  -((1.2 + 3.4) / 5.6)

  instruction          stack after it runs
  OP_CONSTANT 1.2      [1.2]
  OP_CONSTANT 3.4      [1.2][3.4]
  OP_ADD               [4.6]
  OP_CONSTANT 5.6      [4.6][5.6]
  OP_DIVIDE            [0.821429]
  OP_NEGATE            [-0.821429]
  OP_RETURN            []          prints the popped value
```

Read the Lox language chapter first. It describes the language you implement: its types, operators, statements, functions, closures and classes. Then build chapters 14 and 15. Chapter 14 routes every allocation through one function, `reallocate`. Chapter 04 taught you to allocate from arenas, where everything dies at once. A garbage-collected language frees objects one at a time. In chapter 26 `reallocate` also starts a collection when the heap has grown enough. Chapter 15 ends with a design note on register-based bytecode. Read it, because Lua uses that design and you meet it again in step 8.

clox is split into `.c` files with headers, the way the book writes it. Two of those files define static functions with the same name, so the one-translation-unit build from chapter 01 does not work. Write `build_clox.sh`, a copy of `build.sh` that compiles every file in `src/clox/` into `out/<os>-<mode>/clox`. Chapter 05 covered what the linker does with those object files. The book's code does not follow `-Wconversion`, so for clox use `-Wall -Wextra -Wno-unused-parameter` and drop `-Werror`. Fix every warning that comes from a typing mistake.

### Study

- [Crafting Interpreters: The Lox Language](https://craftinginterpreters.com/the-lox-language.html) (read, 40 min): Sections 3.1 to 3.10. Skip the challenges and the design note.
- [Crafting Interpreters: Chunks of Bytecode](https://craftinginterpreters.com/chunks-of-bytecode.html) (do, 3 h): The whole chapter, 14.1 to 14.6, including the design note "Test Your Language". Skip the challenges.
- [Crafting Interpreters: A Virtual Machine](https://craftinginterpreters.com/a-virtual-machine.html) (do, 3 h): The whole chapter, 15.1 to 15.3, then the design note "Register-Based Bytecode" and challenge 1.

### Build

1. Write `build_clox.sh` as above, with a debug mode that uses chapter 01's sanitizers and a release mode at `-O2`.
2. Type chapters 14 and 15 into `src/clox/`. Turn on `DEBUG_TRACE_EXECUTION` and run the book's chunk for `-((1.2 + 3.4) / 5.6)`.
3. Challenge 1 of chapter 15: write the bytecode for `1 * 2 + 3`, `1 + 2 * 3`, `3 - 2 - 1` and `1 + 2 * 3 - 4 / -5` on paper. Then build each chunk by hand in `main`, run it with tracing on, and check the stack after each instruction against your paper.

### Done when

Both builds run the four hand-built chunks on the Mac and in Linux with no sanitizer report. The printed results are 5, 7, 0 and 7.8. For `3 - 2 - 1` you can say why `OP_SUBTRACT` pops the right operand first, and what result you get if it pops the left one first.

## Scanning and a Pratt compiler

So far you built chunks by hand. The compiler builds them from source text in two parts. The scanner turns characters into tokens: `print`, `(`, `1.5`, `"hi"`. It works on demand. The compiler asks for the next token when it needs one, so clox never holds a list of tokens. The keyword check in chapter 16 is a small trie written as nested `switch` statements, a state machine you can read in the code.

The compiler is single-pass. It parses and emits bytecode at the same time, with no syntax tree in between. For expressions it uses a Pratt parser. Chapter 04's JSON parser had one function per grammar rule. A Pratt parser has one table instead, indexed by token type. Each row holds a prefix parse function, an infix parse function and a precedence. `parsePrecedence(p)` parses the prefix expression at the current token, then keeps folding infix operators into it while their precedence is at least `p`. `binary()` compiles its right operand at one level higher than its own operator, which makes `8 - 3 - 1` group to the left. Here is the call trace for `1 + 2 * 3`:

```
  parsePrecedence(ASSIGNMENT)
    number 1                              emit CONSTANT 1
    next is '+', TERM >= ASSIGNMENT  ->  binary()
      parsePrecedence(FACTOR)             one level above TERM
        number 2                          emit CONSTANT 2
        next is '*', FACTOR >= FACTOR  ->  binary()
          parsePrecedence(UNARY)
            number 3                      emit CONSTANT 3
            next is EOF, precedence NONE, stop
          emit MULTIPLY
        next is EOF, stop
      emit ADD
```

The bytecode comes out in the order the stack machine needs it: `1 2 3 * +`. Follow the same trace for `8 - 3 - 1` and watch the second `-` fail the test inside `parsePrecedence(FACTOR)` and go back up a level.

Chapter 16 prints every token from a temporary loop in `compile()`, and chapter 17 replaces that loop. Keep that loop. Move the loop into `main.c` behind a `--tokens` flag, so `clox --tokens file.lox` prints the token stream in the chapter 16 format. Step 8 uses it.

From here on, test against the book's own suite. The test runner is a Dart program in the book's repository. Install Dart on the Mac with Homebrew, clone the repository, run `make get` in it, then point the runner at your binary with a suite named after the chapter you have finished. The suites for chapters 17 to 20 contain a single expression test. From chapter 21 on they run hundreds of tests. Run the suite on the Mac. Your clox still builds and runs in Linux.

### Study

- [Crafting Interpreters: Scanning on Demand](https://craftinginterpreters.com/scanning-on-demand.html) (do, 3 h): The whole chapter, 16.1 to 16.4. Skip the challenges.
- [Crafting Interpreters: Compiling Expressions](https://craftinginterpreters.com/compiling-expressions.html) (do, 4 h): The whole chapter, 17.1 to 17.7, then challenge 1 and the design note "It's Just Parsing".
- [Crafting Interpreters repository: Testing your implementation](https://github.com/munificent/craftinginterpreters#testing-your-implementation) (reference, as needed): The "Building Stuff" section for `make get`, then "Testing your implementation" for the `--interpreter` flag and the chapter suite names. Install Dart by the Homebrew instructions on dart.dev's "Get the Dart SDK" page.

### Build

1. Type chapters 16 and 17. Turn on `DEBUG_PRINT_CODE` and keep the `--tokens` flag.
2. Run `dart tool/bin/test.dart chap17_compiling --interpreter <path to your clox>` from the clone.
3. Write `tests/expr.sh`, which writes each expression to a file with `printf`, without a trailing newline, runs clox on it and checks the printed value: `1 + 2 * 3` is 7, `8 - 3 - 1` is 4, `2 * (3 + 4)` is 14, `-(-3)` is 3, `(-1 + 2) * 3 - -4` is 7. Add two errors: `1 +` must print `[line 1] Error at end: Expect expression.` and exit with status 65, and `(1` must report a missing `)`.
4. Challenge 1 of chapter 17: write the call trace for `(-1 + 2) * 3 - -4` on paper first, then add a temporary `fprintf(stderr, ...)` at the top of `parsePrecedence`, `unary`, `binary`, `grouping` and `number` and compare.

### Done when

The chap17 suite and `tests/expr.sh` pass on the Mac, and `tests/expr.sh` passes in Linux with no sanitizer report. `clox --tokens` on a file with a string, a number, a keyword and an unterminated string prints one line per token, then an error token for the unterminated string and the EOF token. Your paper trace for challenge 1 matches the printed trace call for call.

## Values, strings and a hash table

Until now every value was a `double`. Lox also has booleans, `nil` and strings, so a value becomes a type tag plus the fields that kind uses, as in chapter 04's `Json` struct. clox packs the payloads into a `union`, so a `Value` stays 16 bytes on ARM64: a 4-byte tag, 4 bytes of padding and an 8-byte payload. Chapter 30 squeezes it into 8.

Strings do not fit in 8 bytes, so they live on the heap as objects. Every heap object starts with an `Obj` header that holds its type, and a pointer to an `Obj` can be cast to the specific struct after checking that type. Chapter 19 calls this struct inheritance. C allows the cast because a pointer to a struct also points to its first member. Every object is also linked into one list, so the VM can free them all at exit and, in chapter 26, find the ones that are garbage.

```
  Value on the VM stack            ObjString on the heap
  +---------+---------+            +-----------------------------+
  | VAL_OBJ | padding |            | Obj: type, next  -> next obj |
  +---------+---------+            | length                       |
  | as.obj  ------------------->   | chars  -> "hello"            |
  +-------------------+            | hash                         |
                                   +-----------------------------+
```

Chapter 20 builds the hash table that clox uses for global variables, for interning strings and later for fields and methods. It is open addressing with linear probing and tombstones, at most 75% full, with FNV-1a as the hash. You built a SIMD table on the same principles in chapter 07, with groups of 16 control bytes and a triangular probe sequence. Compare the two designs as you type this one: what a lookup touches in memory, and what deleting a key leaves behind. Interning stores every string once, so two equal strings are the same object and string equality is a pointer comparison.

### Study

- [Crafting Interpreters: Types of Values](https://craftinginterpreters.com/types-of-values.html) (do, 2 h 30 min): The whole chapter, 18.1 to 18.4. Skip the challenges.
- [Crafting Interpreters: Strings](https://craftinginterpreters.com/strings.html) (do, 2 h 30 min): The whole chapter, 19.1 to 19.5, and the design note "String Encoding".
- [Crafting Interpreters: Hash Tables](https://craftinginterpreters.com/hash-tables.html) (do, 3 h): The whole chapter, 20.1 to 20.5. Skip the challenges.

### Build

1. Type chapters 18 to 20 and run the chap20_hash suite.
2. Add to `tests/expr.sh`: `!(5 - 4 > 3 * 2 == !nil)` prints `true`, `"st" + "ri" + "ng"` prints `string`, `nil == false` prints `false`, `"a" + "b" == "ab"` prints `true`, and `1 + "a"` prints the runtime error `Operands must be two numbers or two strings.` and exits with status 70.
3. Write `tests/table_test.c` with its own `main`. A second line in `build_clox.sh` builds it together with every clox file except `main.c`. It takes the key count from `argv`, 100,000 when no number is given. It inserts that many distinct keys, deletes every second one, checks that each remaining key is found and each deleted key is not, then inserts the deleted keys again. Make keys with `copyString`, so call `initVM` first and `freeVM` at the end. Print the table's capacity and its count, tombstones included, after each phase.

### Done when

The chap20 suite and `tests/expr.sh` pass. `table_test` passes in Linux with no AddressSanitizer or LeakSanitizer report. You can explain from its printed numbers why the count after deleting half the keys is still 100,000, and what reinserting does to the tombstones.

## Variables and control flow

Now Lox gets statements. Global variables live in a hash table keyed by name. Local variables live on the VM stack. The compiler tracks which stack slot holds each local at compile time, so `OP_GET_LOCAL 2` reads slot 2 with no lookup at run time. The compiler resolves scope. The VM only sees slot numbers.

Control flow is jumps over bytecode, the same idea as `JMP` in chapter 03's Hack assembly and the conditional jumps of chapter 05's 8086 decoder. The compiler emits a jump before it knows where the jump lands, leaves a placeholder in the operand, and patches it once the target is known. An `if` with an `else` compiles to this:

```
        condition
        OP_JUMP_IF_FALSE  --> else      condition stays on the stack
        OP_POP                          then-branch pops it
        then-branch
        OP_JUMP           --> end
  else: OP_POP                          else-branch pops it
        else-branch
  end:
```

`and` and `or` are jumps too, because they skip the right operand. Loops are a backward jump, `OP_LOOP`. Chapter 23 compiles `for` from the same jumps as `while`.

The build adds a `switch` statement, challenge 1 of chapter 23. It touches the scanner (three keywords and `:`), the compiler and the jump patching. Each case compares against the same switch value, so that value has to stay on the stack across the comparisons. You need one new instruction for that, for example `OP_DUP`, and an `OP_POP` of the switch value on every exit path. Put your tests in the book's `test/` directory, in a new `test/switch/`, using the `// expect:` comments that every test file there uses. The runner then picks them up in every later suite.

### Study

- [Crafting Interpreters: Global Variables](https://craftinginterpreters.com/global-variables.html) (do, 3 h): The whole chapter, 21.1 to 21.4. Skip the challenges.
- [Crafting Interpreters: Local Variables](https://craftinginterpreters.com/local-variables.html) (do, 3 h): The whole chapter, 22.1 to 22.4. Skip the challenges.
- [Crafting Interpreters: Jumping Back and Forth](https://craftinginterpreters.com/jumping-back-and-forth.html) (do, 3 h): The whole chapter, 23.1 to 23.4, then challenge 1 and the design note "Considering Goto Harmful".

### Build

1. Type chapters 21 to 23. Run the chap21_global, chap22_local and chap23_jumping suites at the end of each chapter.
2. Add `switch` as challenge 1 specifies: no fallthrough, no `break`, optional `default` at the end.
3. Write at least five tests in `test/switch/`: a match on the first case, on a later case, no match with a default, no match without one, and case values that are expressions evaluated in order. Add one compile error test, `case` after `default`, with the expected error in a `// [line N] Error` comment as in the book's own error tests.
4. Disassemble a `switch` with three cases and a default with `DEBUG_PRINT_CODE`, and check every jump offset by hand.

### Done when

The chap23_jumping suite passes with your `switch` tests included. The switch value is evaluated once, not once per case. One of your tests shows this with a switch on a global that a case expression assigns to.

## Functions, calls and closures

A function is an object with its own chunk. A call pushes a call frame: the function, a return address in the form of a saved `ip`, and a pointer to where its slots begin on the shared value stack. Arguments are already on the stack when the call starts, so they become the first locals with no copying. This is chapter 05's stack frame built from C structs:

```
  script calls fib(5), which calls fib(3), which calls fib(1)

  vm.stack:  <script>   fib   5    fib   3    fib   1
             ^          ^          ^          ^
             frame 0    frame 1    frame 2    frame 3

  each CallFrame: closure, ip, slots   (slots points at the callee,
  and the arguments follow it as the first locals)
```

Closures take the longest to type and the longest to debug. A local lives in a stack slot that is reused when its function returns. A function that captures the local can outlive that slot. clox handles this with upvalues. While the enclosing function runs, an upvalue points at the stack slot, and every closure that captured the variable shares that one upvalue. When the slot is about to go away, the VM copies the value into the upvalue itself and repoints it there. This is called closing the upvalue.

```
  fun makeCounter() { var i = 0; fun count() { i = i + 1; print i; } return count; }

  while makeCounter runs                  after it returns
  stack: [makeCounter][ i = 0 ][count]    stack: (frame gone)
                        ^
  upvalue.location -----+                 upvalue.location --> upvalue.closed = 0
  count closure -> upvalue                count closure -> upvalue
```

The scheme comes from Lua, and you read Lua's description of it in step 8.

Chapter 24 also adds native functions, starting with `clock()`, which the book's benchmarks use. From now on you can time Lox programs. Challenge 1 of chapter 24 keeps `ip` in a C local variable instead of reading it through the current frame on every instruction. Do it, and measure it with `test/benchmark/fib.lox`, which prints its own elapsed time. Measure the release build, five runs each, and keep the minimum, as chapter 07's repetition tester does.

### Study

- [Crafting Interpreters: Calls and Functions](https://craftinginterpreters.com/calls-and-functions.html) (do, 5 h): The whole chapter, 24.1 to 24.7, then challenge 1.
- [Crafting Interpreters: Closures](https://craftinginterpreters.com/closures.html) (do, 5 h): The whole chapter, 25.1 to 25.4, and the design note "Closing Over the Loop Variable". Skip the challenges.

### Build

1. Type chapter 24 and run the chap24_calls suite. Then do challenge 1, run the suite again, and record the fib time before and after.
2. Type chapter 25 and run the chap25_closures suite.
3. Draw the stack and the upvalues, as above, for a function that returns two closures sharing one captured variable. Then check the drawing by tracing the program with `DEBUG_TRACE_EXECUTION`.

### Done when

The chap25_closures suite passes in the debug build with no sanitizer report. You have release-build fib times from before and after the `ip` change. You can point at the instruction in your trace where the shared upvalue is closed, and explain why both closures still see each other's changes after it closes.

## A mark-sweep garbage collector

clox has allocated objects and never freed one until exit. Chapter 26 adds a mark-sweep collector. Marking starts from the roots, the places the VM reads values from directly, and follows every reference from object to object. Sweeping walks the list of all objects and frees each one that was not marked. The book uses the tricolor abstraction for the marking phase:

```
  white  not reached yet            freed by the sweep if still white at the end
  gray   reached, fields not traced  kept on a worklist
  black  reached and traced          kept

  roots: the value stack, each frame's closure, open upvalues,
         the globals table, functions the compiler is still building
```

The difficult bugs are missing roots. An object that only a C local variable points to is invisible to the collector. If an allocation in the middle of a C function triggers a collection, that object is freed while the C code still uses it. Section 26.7 shows three such bugs and fixes each one by keeping the object on the VM stack for the duration. Lua's C API in step 9 is built around this rule.

`DEBUG_STRESS_GC` runs a collection before every allocation, so a missing root fails on the first allocation after it is lost. With AddressSanitizer on, a missing root becomes a use-after-free report that names the line.

### Study

- [Crafting Interpreters: Garbage Collection](https://craftinginterpreters.com/garbage-collection.html) (do, 4 h): The whole chapter, 26.1 to 26.7, the design note "Generational Collectors" and challenge 1, which you answer in writing.

### Build

1. Type chapter 26. Run the chap26_garbage suite with `DEBUG_STRESS_GC` on, in the debug build with AddressSanitizer.
2. Undo one of the three fixes in section 26.7, rebuild with stress mode, and find a test or write a program that makes AddressSanitizer report the bug. Put the fix back.
3. Run `table_test` from step 3 with stress mode on and 2,000 keys. Stress mode runs a full mark-sweep per allocation, so 100,000 keys under AddressSanitizer take minutes. The test's keys are reachable only from a table in a C variable, so the collector frees them. Read the report, then add a `Table *extraRoot` field to the VM that `markRoots` marks with `markTable`, and point it at the test's table. That fix is not enough on its own. `copyString` returns an object that nothing references yet, and `tableSet` allocates when it grows the table. Push the key with `push(OBJ_VAL(key))` before `tableSet` and pop it after, as 26.7.2 does.
4. Write `bench/churn.lox`, a loop that creates a million closures and drops each one. Run it on the Mac with `/usr/bin/time -l` and note "maximum resident set size". Then comment out the call to `collectGarbage` in `reallocate`, run it again and compare.
5. Answer challenge 1: compute `sizeof(Obj)` on ARM64 from the fields, then print it and compare.

### Done when

The chap26_garbage suite passes with stress mode and AddressSanitizer on, with no report. You have the AddressSanitizer report for the fix you undid and can say which object was freed and which code still used it. `table_test` passes with stress mode on and 2,000 keys. The peak memory of `churn.lox` stays flat with the collector and grows with the loop count without it.

## Classes, then making clox faster

Chapters 27 to 29 add classes, instances, methods, initializers and inheritance. Classes are objects with a method table, instances are objects with a field table, and a method call looks up a name at run time. Lua does not have classes. It builds objects from tables and metatables instead. Type these chapters anyway. The book's later code and benchmarks depend on them, and section 28.5 shows a superinstruction: `OP_INVOKE` does the work of a property lookup and a call in one instruction, so it skips creating a bound method object for every call.

Chapter 30 measures and then makes clox faster in two ways. Section 30.2 replaces the modulo in hash probing with a mask. Section 30.3 replaces the 16-byte tagged union with NaN boxing. An IEEE 754 double whose exponent bits are all ones and whose quiet bit is set is a NaN, and the hardware never produces most of those bit patterns. clox uses them to hold everything that is not a number, in 8 bytes:

```
  bit  63    62..52 (11 bits)   51..0
       sign  exponent           mantissa

  QNAN     0x7ffc000000000000
  number   any value that does not have all the QNAN bits set
  nil      QNAN | 1
  false    QNAN | 2
  true     QNAN | 3
  object   SIGN_BIT | QNAN | pointer   (user-space pointers fit in 48 bits)
```

Chapter 04 showed you the bits of a double. The book's macros for this are short, and every one of them is a mask or a compare.

The book profiles with a sampling profiler. You built an instrumentation profiler in chapter 07, but a block timer around a function that runs for 20 nanoseconds measures mostly the timer. Add an array of 64-bit counters indexed by opcode, incremented at the top of the dispatch loop behind a flag, and print the counts at exit. That tells you which instructions a benchmark runs most.

The last change is dispatch. A `switch` compiles to one indirect jump that every opcode shares. Computed goto, a GNU C extension that clang supports, puts a separate indirect jump at the end of each opcode's code. Bendersky measured it 25% faster on a toy VM in 2012 and explains the branch prediction argument. A 2015 paper by Rohou, Swamy and Seznec found that on Intel's Haswell the accuracy of indirect branch prediction no longer mattered much for interpreters. Measure it on your M-series core and go by your numbers. Lua does the same in `lvm.c`, which you read in step 8.

### Study

- [Crafting Interpreters: Classes and Instances, Methods and Initializers, Superclasses](https://craftinginterpreters.com/classes-and-instances.html) (do, 9 h): Chapter 27 at this link, then chapter 28 at `methods-and-initializers.html` and chapter 29 at `superclasses.html` on the same site. Read the design note "Novelty Budget" in chapter 28. Skip the challenges in all three chapters.
- [Crafting Interpreters: Optimization](https://craftinginterpreters.com/optimization.html) (do, 4 h): The whole chapter, 30.1 to 30.4.
- [Eli Bendersky: Computed goto for efficient dispatch tables](https://eli.thegreenplace.net/2012/07/12/computed-goto-for-efficient-dispatch-tables) (read, 25 min): From the start through "What is done in other VMs?". The two bonus sections are GCC disassembly for x86-64. Read them only if you want to compare with your own ARM64 disassembly.

### Build

1. Type chapters 27 to 29 and run the full suite: `dart tool/bin/test.dart clox --interpreter <path>`.
2. Before chapter 30, add the opcode counter and run every program in `test/benchmark/` in the release build. Record the time each prints, minimum of five runs, and the five most frequent opcodes.
3. Type section 30.2 and measure again. Type section 30.3 and measure again, with `NAN_BOXING` on.
4. Add computed-goto dispatch behind a `COMPUTED_GOTO` flag, with a table of label addresses indexed by opcode. Measure again.
5. Run the full suite in four configurations: debug and release, each with `NAN_BOXING` on and off.

### Done when

The full clox suite passes in all four configurations, and the debug runs show no sanitizer report. You have one table with a row per benchmark and a column per change: the version before chapter 30, mask probing, NaN boxing, computed goto. Next to each change you have one sentence, based on the opcode counts and the timings, on why it helped the benchmarks it helped and not the others.

## Lua the language and its register VM

Lua's types are nil, booleans, numbers (64-bit integers and doubles as two subtypes), strings, functions, userdata, threads and tables. The table is the only data structure. Arrays, records, modules and objects are all tables. A metatable attached to a table changes what operators and indexing do on it, which is how Lua builds objects without classes. Indexes start at 1, functions return several values, and a variable is global unless declared `local`. Lua 5.5 adds a `global` declaration as well. Section 2 of the reference manual covers values, environments, errors, metatables and the garbage collector. Section 3 is the language. Read both. Compare its rules with the choices clox made, for example which values count as false, what `1 == "1"` gives, and how a global is looked up.

The paper "The Implementation of Lua 5.0" explains the design of the VM in 16 pages. Lua switched from a stack VM to a register VM in version 5.0. Each function gets a window of the Lua stack, its registers, and locals live in fixed registers. An instruction names its operands by register number, so most operations take one instruction where clox needs several:

```
  local a = b + c        (b, c, a are locals)

  clox, stack machine           Lua, register machine
  OP_GET_LOCAL  b               ADD  a b c       R[a] := R[b] + R[c]
  OP_GET_LOCAL  c
  OP_ADD
  OP_SET_LOCAL  a
  OP_POP
```

Fewer instructions mean fewer dispatches, but each instruction is wider and must be decoded into fields, as your 8086 decoder did. In Lua 5.4 and 5.5 the listing shows an `MMBIN` after each arithmetic instruction. The VM skips it when both operands are numbers and runs it to call a metamethod otherwise. The paper describes Lua 5.0, with 35 instructions, a 6-bit opcode, an 8-bit A field and 9-bit B and C fields. Lua 5.5 has more opcodes, a 7-bit opcode field, 8-bit A, B and C fields and a `k` bit. Its `lopcodes.h` documents every instruction in a comment table, one line each. Its table design, an array part plus a hash part, and its upvalues are as the paper describes. Section 5 of the paper describes the open and closed upvalues that clox borrowed.

Build Lua 5.5.1 from source on both machines. The download page gives the commands: `curl -L -R -O https://www.lua.org/ftp/lua-5.5.1.tar.gz`, `tar zxf lua-5.5.1.tar.gz`, then `make all test` in `lua-5.5.1`. `make local` then copies the binaries, headers and `liblua.a` into `lua-5.5.1/install/`. You need those in step 9. `luac -l -l -p file.lua` prints the bytecode of a file with its constants, locals and upvalues, without writing an output file.

### Study

- [Lua 5.5 Reference Manual, section 2: Basic Concepts](https://www.lua.org/manual/5.5/manual.html#2) (read, 2 h 30 min): Sections 2 and 3. Skim 2.5.3, 2.6 and 3.3.8.
- [Ierusalimschy, de Figueiredo, Celes: The Implementation of Lua 5.0](https://www.lua.org/doc/jucs05.pdf) (read, 1 h 30 min): Sections 1 to 5 and 7, PDF pages 1 to 10 and 11 to 16. Skip section 6 on coroutines and the benchmarks in section 8.
- [Lua 5.5 source: lopcodes.h](https://www.lua.org/source/5.5/lopcodes.h.html) (reference, as needed): The instruction formats near the top and the table of opcodes with their comments.

### Build

1. Build Lua on the Mac and in Linux and run `make all test` on both.
2. Read `luaV_execute` in `lua-5.5.1/src/lvm.c` (1 h): the `vmfetch` and `vmdispatch` macros, `ljumptab.h` in the same directory, which is Lua's computed goto, and the `OP_ADD` case.
3. Write `lox_scan.lua`, a port of your clox scanner to Lua, including your `switch` keywords. It reads a file and prints the same lines as `clox --tokens`, with the same token type numbers. Look up the library functions in section 6 of the same manual: 6.2 for the basic functions, 6.5 for strings, 6.9 for `io.open` and `file:read`. Write `tests/scan_diff.sh`, which runs both on every `.lox` file under the book's `test/` directory and diffs the outputs.
4. Write fib, the `makeCounter` closure from step 5, and a loop that sums 1 to 10,000,000 in both Lox and Lua. Put the loop inside a function and use only locals in both languages, so both compile to local-slot access. Disassemble each with `DEBUG_PRINT_CODE` and `luac -l -l -p`. Count the instructions in each function body and the instructions per loop iteration. Then write the loop a second time with globals in both languages and count how many more instructions per iteration each version needs.
5. Write `notes/opcodes.md`: a table with each of clox's opcodes and the Lua 5.5 opcode or opcodes that do the same job, or "none" with a reason. Time fib(35) in both, using `clock()` in Lox and `os.clock()` (manual section 6.10) in Lua.

### Done when

`tests/scan_diff.sh` reports no difference on any test file. `notes/opcodes.md` covers all of clox's opcodes and ends with a paragraph, based on your three programs, on why the register VM executes fewer instructions per loop iteration, with the extra count for the globals version in each language. Given `local x = a * b + c` with `a`, `b` and `c` as locals, you can write Lua's instructions before you run `luac`, and find the `OP_ADD` case in `luaV_execute`.

## Calling between C and Lua

The C API exchanges values through a virtual stack that belongs to the `lua_State`. C code pushes values, calls functions, and reads results by index. Positive indexes count from the bottom of the stack, negative ones from the top, so -1 is the top value. Programming in Lua explains why there is no `lua_Value` type in C: the collector cannot see C variables. That is the missing-root problem from step 6. A value on the Lua stack is reachable, so it is safe. A pointer you copied out of it is only valid while the value stays reachable.

Errors in Lua are a `longjmp`. `setjmp` saves the stack pointer, the program counter and the callee-saved registers from chapter 05. `longjmp` restores them, and execution continues at the `setjmp` with every frame in between abandoned. Their cleanup code never runs. `lua_pcall` sets such a point, catches any error raised while the called function runs and returns a status code with the error value on the stack. An error outside any `lua_pcall` calls a panic function and then `abort`. Two rules follow. Call Lua code only through `lua_pcall`. In a C function that Lua calls, do not hold memory, a lock or an open file across an API call that can raise an error, because the jump skips your `free`.

```
  calling f(3, 4) from C, with a traceback handler

  push traceback handler   [ handler ]
  lua_getglobal "f"        [ handler | f ]
  push 3, push 4           [ handler | f | 3 | 4 ]
  lua_pcall(L, 2, 1, 1)    [ handler | result ]      or  [ handler | error message ]
  read result, pop 2       [ ]
```

Programming in Lua's first edition is free online. Roberto Ierusalimschy, who leads Lua's design, wrote it, and its part IV teaches the C API with short examples. It was written for Lua 5.0, so some names changed. Translate as you read:

```
  PiL 1st edition (Lua 5.0)            Lua 5.5
  lua_open()                           luaL_newstate()
  luaopen_base(L) and the other opens  luaL_openlibs(L)
  luaL_openlib(L, "name", reg, 0)      luaL_newlib(L, reg), then lua_setglobal(L, "name")
  struct luaL_reg                      luaL_Reg
  luaL_checkint, luaL_optint           luaL_checkinteger, luaL_optinteger
  lua_strlen                           lua_rawlen
  luaL_getn                            luaL_len
  lua_newuserdata(L, size)             lua_newuserdatauv(L, size, 0)
  lua_cpcall(L, f, p)                  lua_pushcfunction(L, f), push p, lua_pcall
```

Then read section 4 of the 5.5 manual, which states the same contract for the version you built. Every function entry in section 4.6 has a box like `[-o, +p, x]`: how many values it pops, how many it pushes, and whether it can raise an error. Check that box for each function you use.

Link your programs against the static library: add `-I` for `lua-5.5.1/install/include` and the path of `install/lib/liblua.a` to the compiler line, plus `-lm`, and in Linux `-ldl`. Give `build.sh` a variable for extra flags rather than a second script. Your own code keeps chapter 01's full warnings.

### Study

- [Programming in Lua, 1st edition: An Overview of the C API](https://www.lua.org/pil/24.html) (read, 2 h): Chapters 24, 25 and 26 through the "Next" links, 24.1 to 26.2. Lua 5.0 code, so use the translation table above.
- [Lua 5.5 Reference Manual, section 4: The Application Program Interface](https://www.lua.org/manual/5.5/manual.html#4) (read, 40 min): 4.1 to 4.4. Skip 4.5 on yields.
- [Lua 5.5 Reference Manual, section 4.6: Functions and Types](https://www.lua.org/manual/5.5/manual.html#4.6) (reference, as needed): Every C API function with its `[-o, +p, x]` box. Keep it open together with 4.7, the debug interface, and 5.1, the auxiliary library, for every function you call in this step and the next, in particular `lua_pcall`, `luaL_loadfile`, `luaL_traceback` and `luaL_newlib`.

### Build

Write `src/host.c`:

1. Create a state, open the standard libraries and run `config.lua` with `luaL_loadfile` and `lua_pcall`. Read the globals `width`, `height` and `title`, check each one's type, and print them. A missing or wrongly typed value prints a message that names the variable and exits with status 1.
2. Call the Lua function `transform(s)` from C with a string from the command line and print the string it returns, as PiL 25.2 does. Use a message handler that calls `luaL_traceback`, so an error inside `transform` prints a traceback.
3. Register a C library `host` with `host.now()`, which returns seconds from `clock_gettime(CLOCK_MONOTONIC)` as a float, and `host.log(level, message)`, which checks that `level` is one of `"info"` or `"error"` and raises an error otherwise.
4. After every call, assert that `lua_gettop` equals what it was before. Write test scripts for: a syntax error in `config.lua`, `width = "wide"`, `transform` calling a nil global, `transform` returning a number, `host.log("debug", "x")`, and a Lua `error({code = 42})` with a table as the error value.

### Done when

Every test script gives a clear message and a nonzero status, and none of them crashes or trips a stack-height assert. The Linux build reports nothing under AddressSanitizer and LeakSanitizer, which needs `lua_close` on every exit path. For the call to `transform`, you can draw the Lua stack before and after each API call, matching the `[-o, +p, x]` boxes in the manual.

## Lua route handlers in the HTTP server

The last step puts Lua inside the event loop server from chapter 08. A file `routes.lua` returns a table that maps a path to a handler function. The server calls the handler for a matching request and serves its static files for everything else. Three things on the Lua side are new, and the reading covers all three.

The server has to hold the routes table between requests. A C pointer to a Lua table would not keep it alive. A reference does: `luaL_ref` stores the table in the registry, a table reserved for C code, and returns an integer key that C can keep. Reloading `routes.lua` means loading and running the new file under `lua_pcall`, checking that it returned a table, and only then swapping the reference. A file with a syntax error leaves the old routes in place. Globals live in the state, so a global counter in the script survives a reload. Locals of the old file go away with the old table, once nothing references its handlers.

The handler builds its response through a userdata, a block of memory that Lua allocates and owns, with a metatable that gives it methods: `res:status(n)`, `res:header(name, value)` and `res:write(s)`. The C struct in the userdata points at the connection's request state. That pointer is only valid during the handler call. A script can store `res` in a global and call `res:write` a minute later, after the connection has closed. Keep a `live` flag in the struct, clear it when the handler returns, and make every method raise an error when the flag is clear. The userdata stays valid memory as long as Lua holds it. The pointer inside it does not.

A handler runs on the loop's thread. While it runs, no other client is served, so `while true do end` in a handler would stop the server. `lua_sethook` with `LUA_MASKCOUNT` calls a C function after a given number of Lua instructions. If that function raises an error, the handler's `lua_pcall` returns it. `lua.c` stops scripts on Ctrl-C the same way. The hook counts only Lua instructions. A call into C, such as `string.rep("x", 1e9)`, runs to the end before the hook can fire. Keep every Lua call on the loop thread. One `lua_State` must not be used by two threads at once, so if your server hands work to the chapter 09 job system, that work must not touch Lua.

The manual sections you kept open from step 9 cover the functions of this step: `lua_sethook` and `lua_Hook` in 4.7, and `luaL_ref`, `luaL_newmetatable`, `luaL_checkudata` and `lua_newuserdatauv` in 4.6 and 5.1. The reload check uses `stat`. Its `st_mtime` field holds whole seconds, so two writes within one second look like one. Compare `st_mtime` and `st_size` together, and have the tests wait a second between writes.

### Study

- [Programming in Lua, 1st edition: Storing State in C Functions](https://www.lua.org/pil/27.3.html) (read, 30 min): 27.3.1 The Registry, 27.3.2 References, 27.3.3 Upvalues.
- [Programming in Lua, 1st edition: User-Defined Types in C](https://www.lua.org/pil/28.html) (read, 1 h): 28.1 to 28.3. Lua 5.0 code: use the translation table from step 9, and `luaL_setmetatable` for the two-call sequence `luaL_getmetatable` plus `lua_setmetatable`.
- [stat(2)](https://man7.org/linux/man-pages/man2/stat.2.html) (reference, as needed): DESCRIPTION and the example program. The field list is in stat(3type), linked from the page. Use `st_mtime` and `st_size`, which Linux and macOS both define. macOS also has the man page: `man 2 stat`.

### Build

1. Load `routes.lua` at startup and keep the returned table in the registry. For a request whose path is in the table, build a request table `{method = ..., path = ..., headers = {...}}` with lowercased header names, create a response userdata, and call the handler under `lua_pcall` with a traceback handler. Then format the status line, headers, `Content-Length` and body into the connection's output buffer as chapter 08 does. HEAD gets no body.
2. Check what Lua hands you. The status must be from 100 to 599. Header names and values must not contain CR or LF, or a script could inject a header. The body has a size limit. A handler error, a broken rule or an exhausted budget gives a 500 response and a traceback on `stderr`.
3. Set an instruction budget with `lua_sethook` before each handler call and remove it afterwards. Start with 1,000,000 instructions. Time a `while true do end` handler and pick a budget that ends it in under 20 ms.
4. Check `st_mtime` and `st_size` of `routes.lua` with `stat` at most once per second, using the loop's wait timeout. Reload when either changed, as described above.
5. Shut down on SIGINT with a handler that only sets a flag, following the signal-safety rules from chapter 08's shell step. The loop sees the flag, exits, calls `lua_close` and frees everything.
6. Extend `tests/http.sh`: a Lua route, a route that raises an error, a route with `while true do end`, a route that stores `res` in a global and a second route that writes to it, a header value containing `\r\n`, a `/count` route backed by a global counter that keeps counting across a reload, and a reload with a syntax error that leaves the old routes working. Put `sleep 1` between two writes of `routes.lua`, and after each write wait long enough for the once-per-second check to see it.

### Done when

`sh tests/http.sh` passes on both machines. During the `while true do end` request, the pinger from chapter 08 keeps its worst round trip under 50 ms. In Linux, `wrk -t2 -c100 -d10s` gives you requests per second for a static file and for a Lua route, and after a run of at least 10,000 Lua requests, a `/stats` route that returns `collectgarbage("count")` shows memory staying in a fixed range instead of growing with the request count. The server exits on Ctrl-C with no LeakSanitizer report.

## Where this leads

You have implemented a language end to end. Source text becomes tokens, a single-pass compiler turns tokens into bytecode, and a dispatch loop runs that bytecode over a value stack, with call frames, closures that outlive their stack slots and a collector that finds every root. You measured what NaN boxing and computed goto change on your own CPU. You read a production VM and compared its register design with yours, and you embedded it in a server whose C side checks the types Lua hands it, refuses a response object used after its request, and stops a handler that runs too long.

clox never builds a syntax tree. It emits each expression as soon as it parses it, so it never sees a whole function before generating code, and it does no optimization of the program it compiles. Every instruction still goes through the dispatch loop at run time. Chapter 12, An LLVM backend, compiles a small language to native code. It parses into a tree, lowers the tree to LLVM's intermediate representation in SSA form, runs LLVM's optimization passes over it and emits ARM64 machine code that you can read with the skills from chapter 05.
