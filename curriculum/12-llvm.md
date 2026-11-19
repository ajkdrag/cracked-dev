---
id: 12
title: An LLVM backend
part: Languages and compilers
weeks: 3
project: Kaleidoscope, a small language of doubles, functions, loops and local variables, compiled by your own C++ front end through LLVM IR, both into machine code in memory that runs at once and into x86-64 and ARM64 object files that link with C.
---

Chapter 11 ended with Lua handlers running inside your HTTP server. Before that you built clox, which parses Lox and writes bytecode as it parses, then runs that bytecode one instruction at a time in a loop with a `switch` over opcodes. In chapter 05 you saw the other way to run a program: clang turns C into x86-64 instructions that the CPU runs directly. This chapter builds a compiler that works the second way.

A compiler of that kind has three parts. The **front end** reads the source text and checks it. It hands an **intermediate representation**, IR for short, to the **optimizer**, which rewrites the IR into faster IR that computes the same results. The **back end** turns the IR into machine code for one CPU.

That machine code can go into an object file, as clang's does, or straight into memory. A **JIT**, short for just-in-time compiler, is a compiler that runs inside a program and puts the machine code in that program's memory, so the program can call it at once.

**LLVM** is a set of C++ libraries that supplies the optimizer and the back ends. clang is LLVM's front end for C, and rustc uses LLVM too. You write a front end of your own for a small language and let LLVM do the rest:

![You write the front end that turns source into LLVM IR. LLVM supplies the optimizer and the back end that turns the IR into x86-64 code, either in memory for a JIT or in an object file. clang and rustc are other front ends that emit the same IR.](figures/12-pipeline.svg)

The language is Kaleidoscope, from LLVM's own tutorial. Every value is a 64-bit double, and the language has functions, `extern` declarations for C functions, `if`/`then`/`else`, a `for` loop and mutable local variables.

The front end has the same parts as clox: a lexer, the part clox called the scanner, and a parser. You already know both, and you read object files and calling conventions in chapter 05. The new material is the IR, the passes that optimize it and the back end. After this chapter you can read the IR that clang makes from small C functions.

The tutorial is written in C++, which this book has not taught. You need a small part of it, and step 2 covers that part. Steps 3 to 6 follow tutorial chapters 1 to 5, 7 and 8. You skip chapter 6, which lets programs define their own operators, and chapter 9, which adds debug information.

## Reading LLVM IR

Before you generate IR, read some. clang can stop after its front end and write the IR it would have optimized, so your own C functions are the first examples.

You need LLVM's libraries and tools. The clang you installed in chapter 00 is Ubuntu's clang 18, and Ubuntu packages the LLVM 18 that matches it. That is the LLVM of this book. LLVM's C++ API changes between major versions, so every LLVM link in this chapter points at the pages for 18.1.8, which fit Ubuntu's 18.1.3.

LLVM IR is an assembly language for a made-up machine with as many registers as you want. Its pieces nest:

- A **module** is one file of IR. It holds functions and global variables.
- A **function** holds basic blocks. A **basic block** is a label followed by a list of instructions. Control enters a block only at its top.
- The last instruction of a block is its **terminator**, an instruction that says where control goes next: `br` (branch) to another block, or `ret` to return.
- An instruction that computes something gives its result a name that starts with `%`. A value with no name from the source gets a number instead, such as `%0`. Functions are named with `@`, as in `@ipow`.
- Every type is written out: `i32` is a 32-bit integer, `i1` a one-bit true or false, `double` a 64-bit float, `ptr` an address.

Every `%` name is assigned exactly once and never changes. That rule is called **static single assignment**, SSA. In a function without branches it is easy to see:

![The C function sum3sq next to its IR. Each value, such as %mul, is defined once on the left of an equals sign. Later instructions use it by name, as %add uses %mul and %mul1.](figures/12-ssa-values.svg)

The blocks of a function and the branches between them form the **control flow graph**, CFG for short. A branch makes SSA harder. In `pick`, the result is `a` on one path and `b` on the other, and one name cannot be assigned twice. A **phi** instruction at the top of the block where the paths meet solves this. It picks one of its inputs according to the block control came from:

![The control flow graph of pick. The entry block ends in a conditional branch to if.then or if.end. Both branch to the return block, whose phi takes %a when control came from if.then and %b when it came from if.end.](figures/12-if-else-cfg.svg)

Front ends rarely build phi nodes themselves. clang at `-O0` gives every local variable and every argument a stack slot in the function's frame with **`alloca`**, reads it with `load` and writes it with `store`. A pass called **mem2reg** then turns those slots into SSA values and inserts the phi nodes. It only promotes `alloca` slots. A `load` through a pointer that came in as an argument stays, because the pass cannot know who else can see that memory. Here is `ipow`'s loop before and after:

![ipow before and after mem2reg. Before, x, y, r and i each live in a stack slot made by alloca, every read is a load and every write a store. After, all four slots are gone, x and y are used directly, and two phi nodes at the top of for.cond pick r and i from the entry edge or from the back edge out of for.inc.](figures/12-mem2reg.svg)

clox in chapter 11 did what the left side does: it kept `r` and `i` in stack slots and overwrote them. The right side never overwrites anything.

### Study

- [Sunny Young de la Sota (mcyoung): A Gentle Introduction to LLVM IR](https://mcyoung.xyz/2023/08/01/llvm-ir/) (read, 1 h 15 min): The whole post. It was picked because it teaches IR as a language you read, from small functions up to SSA, `phi`, `alloca` and mem2reg in "Phony! Phony!". Skim "Synchronization" and "Reinterpret Shenanigans". The examples are Rust, which you can read after chapter 10, compiled for x86-64 Linux like your own.
- [LLVM Language Reference Manual (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/LangRef.html) (reference, as needed): "Identifiers", "Module Structure" and "Functions" under High Level Structure, then the entry for each instruction you meet: `alloca`, `load`, `store`, `br`, `phi`, `icmp`, `fcmp`, `fadd`, `call` and `ret`. Do not read it front to back.

### Build

1. Install LLVM with `sudo apt install -y llvm-dev`. The package brings the tools, the headers, the libraries and `llvm-config`, a program that prints the flags for building against LLVM. Check that `llvm-config --version` prints 18.1.3 and that `opt --version` names LLVM 18. `opt` reads an IR file, runs **passes** over it and writes the result. A pass is one transformation or one check, such as removing repeated computations.
2. Make a folder `llvm/` in `~/code/hello`, next to `rust/` from chapter 10, and run every command of this chapter inside it. Every path below, such as `ir/`, `cpp/`, `src/` and `tests/`, is inside `llvm/`, and the programs you build land there too. When `git status` lists one of those programs, add its name to a `.gitignore` in `llvm/`. Make `ir/funcs.c`. Copy `swap_ints` and `str_len` from chapter 02 and add these three:

   ```c
   int ipow(int x, int y) {
       int r = 1;
       for (int i = 0; i < y; i++)
           r *= x;
       return r;
   }

   double pick(double c, double a, double b) {
       if (c != 0)
           return a;
       return b;
   }

   int sum3sq(int a, int b, int c) {
       return a * a + b * b + c * c;
   }
   ```

3. Emit the IR three ways. `-S -emit-llvm` makes clang write IR as text instead of an object file. At `-O0`, clang marks every function `optnone`, which tells every pass to leave it alone. `-Xclang -disable-O0-optnone` passes an option to the compiler inside clang that turns that mark off. `-fno-discard-value-names` keeps your C names on the IR values. In `opt`, `-passes=mem2reg` runs one pass, `-O2` runs the standard optimizing set, and `-S` writes text:

   ```sh
   clang -S -emit-llvm -O0 -Xclang -disable-O0-optnone -fno-discard-value-names ir/funcs.c -o ir/funcs.ll
   opt -passes=mem2reg -S ir/funcs.ll -o ir/funcs.m2r.ll
   opt -O2 -S ir/funcs.ll -o ir/funcs.o2.ll
   ```

4. Compare `sum3sq` in `funcs.ll` and `funcs.m2r.ll` with the figure. clang adds words the figure leaves out, such as `dso_local`, `noundef` and `#0`, and lines that start with `!`. Those are attributes and metadata, notes for the optimizer and the debugger, and the post explains the ones that matter. The `nsw` on `mul` and `add` means "no signed wrap": signed overflow in C is undefined behavior from chapter 04, so the IR may assume it does not happen.
5. In `funcs.m2r.ll`, write a comment above every basic block of `ipow` and `pick` that names its predecessors and its terminator. LLVM prints the predecessors after `; preds =`. For each `phi`, write which C variable it stands for and which edge brings which value. In `swap_ints`, explain why the `load` and `store` instructions survived.
6. Emit `funcs.c` again without `-Xclang -disable-O0-optnone` into `ir/funcs.optnone.ll`, run mem2reg on it, and `diff` the input against the output. The first line of each file, `; ModuleID = ...`, is the file name the IR came from, so it differs. The rest of the diff is empty because `optnone` makes mem2reg skip every function.
7. Write `ipow` in Lox and run it in a clox built with `EXTRA=-DDEBUG_PRINT_CODE sh build_clox.sh`, from `~/code/hello` as in chapter 11. Paste the disassembly into a comment next to the IR. Mark which instructions in each form read and write `r`.
8. Write `ir/fib.ll` by hand: `define i64 @fib(i64 %n)`, iterative, with `alloca` slots for the two previous values and the counter, in the style of the post's `@pow`. Check it with `opt -passes=verify -disable-output ir/fib.ll`, which runs only the checker and writes nothing. Write `ir/main.c` that declares `long long fib(long long n);` and prints `fib(0)` to `fib(10)` and `fib(90)`. Build with `clang ir/main.c ir/fib.ll -o fibtest`. clang accepts `.ll` files as inputs. It warns that it is "overriding the module target triple", because your file names no machine. Step 6 explains triples.
9. Run `opt -passes=mem2reg -S ir/fib.ll` and compare the phi nodes it made with the ones you would have written.
10. Break `fib.ll` twice. First define the same `%` name twice. Then use a value in a block that control can reach without passing through the block that defines it, for example a value from the loop body used in the entry block. LLVM forbids that, because on such a path the value would not exist yet. A block that every path to an instruction passes through **dominates** that instruction, and the checker's message uses that word. Read both error messages.

> **Optional:** Find `ipow` in `funcs.o2.ll`. The loop vectorizer from chapter 07 turned it into multiplications on `<4 x i32>`, four 32-bit integers at a time, with a plain loop after it for the iterations that are left over.

### Done when

- `fibtest` prints 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55 and 2880067194370816120.
- `opt -passes=verify` prints nothing for your `fib.ll`.
- The two broken versions print "multiple definition of local value named" and "Instruction does not dominate all uses!".
- You can point at every `phi` in `funcs.m2r.ll` and say which variable it replaced and why it sits at the top of its block.
- You can say why the diff from build task 6 shows only the `ModuleID` line and why mem2reg changed nothing else.
- You can name two differences between the clox disassembly and the IR for `ipow`.

## Enough C++ to read the tutorial

From the next step on, your own program writes IR through LLVM's C++ API, following LLVM's Kaleidoscope tutorial. The tutorial assumes you know C++. You need less than that, and most of it has a C or Rust counterpart you already know:

| C or Rust you know | C++ the tutorial uses |
| --- | --- |
| a struct plus functions that take a pointer to it | a **class** with member functions, where `this` is that pointer |
| a table of function pointers in a struct | a **virtual function**: `= 0` makes it required, `override` marks an implementation |
| `Box<T>` from chapter 10, an owning heap pointer | `std::unique_ptr<T>`, and `std::unique_ptr<Base>` for a derived object |
| `let b = a;` moves, `a` is unusable afterwards | `auto b = std::move(a);` leaves `a` null, and `a` still compiles |
| the growable array from chapter 02, `Vec<T>` | `std::vector<T>` with `push_back`, `back`, `pop_back`, `size` and `[]` |
| a pointer plus a length, `String` | `std::string` with `+=`, `==`, `[]`, `size` and `c_str()` |
| the hash trie from chapter 04, `HashMap<K, V>` | `std::map<K, V>` with `find`, `end`, `[]` and `clear` |
| a pointer parameter that must not be null | a **reference** parameter, `const std::string &Name` |
| `let x = expr;` with no type written | `auto x = expr;`, where the compiler works out the type |
| `for arg in &args` in Rust | `for (auto &Arg : F->args())`, which visits each element through a reference |
| a tuple `(a, b)` with `.0` and `.1` | `std::pair<A, B>` with `.first` and `.second` |
| `&*b`, borrowing what a `Box` points at | `p.get()`, the raw pointer a `unique_ptr` holds, which it keeps owning |
| a C cast `(Num *)e` | `static_cast<Num *>(e)`, a cast between a base and a derived class |
| a C `enum` | the same `enum`, as in `enum Token { tok_eof = -1 }` |
| a method that takes `&self` in Rust | a member function with `const` after its parameter list, which promises not to change the object |

A **class** is a struct whose functions are declared inside it. A **derived class** such as `class Num : public Expr` starts with everything `Expr` has, and a pointer to `Expr` can point at a `Num`. A **virtual function** is called through that pointer and runs the derived class's version. `std::unique_ptr<T>` owns one heap object and frees it when the `unique_ptr` goes out of scope, like a `Box`.

You only use templates, as in `std::vector<std::unique_ptr<ExprAST>>`. You do not write them. You do not need exceptions either.

LLVM is built with exceptions turned off, and Kaleidoscope reports errors by returning `nullptr`. Output goes through `fprintf` and through LLVM's `errs() << "text"`, which writes to standard error. LLVM's names live in a **namespace**, a prefix like `llvm::`, and the tutorial's `using namespace llvm;` lets it leave the prefix off.

The series below skips a few details the build needs:

- The standard library comes in headers: `<memory>` for `unique_ptr` and `make_unique`, `<utility>` for `std::move` and `std::pair`, then `<vector>`, `<string>` and `<map>`. C's headers keep working under names with a `c` in front and no `.h`, such as `<cstdio>` and `<cstdlib>`.
- `s += c` appends a character to a `std::string`, and `s.c_str()` gives a `const char *` for C functions such as `strtod`.
- `v.back()` returns the last element of a `std::vector`, and `v.pop_back()` removes it.
- A member declared `inline static int live = 0;` inside a class is one shared variable, like a C global that belongs to the class.
- `std::map`'s `[]` inserts a default value when the key is missing. The tutorial relies on that: `BinopPrecedence[CurTok]` adds precedence 0 for a character it has not seen, and 0 means "not an operator". Use `find` when you only want to look.

A constructor can set members before its body runs, with a **member initializer list** after a colon:

```cpp
class NumberExprAST : public ExprAST {
  double Val;
public:
  NumberExprAST(double Val) : Val(Val) {}   // member Val starts as the parameter Val
  Value *codegen() override;
};
```

The largest difference from Rust is the move. After `auto b = std::move(a);` the compiler still lets you use `a`:

![Before auto b = std::move(a), a owns the heap node. After it, b owns the node and a holds nullptr. a->eval() still compiles and crashes at run time, where Rust refuses the same code at compile time.](figures/12-unique-move.svg)

### Study

- [Bert Hubert: Modern C++ for C Programmers, part 2](https://berthub.eu/articles/posts/cpp-2/) (read, 17 min): "Namespaces", "Classes" and "Resource Acquisition Is Initialization (RAII)". Skip "Smart pointers", which covers `std::shared_ptr`, and read part 5's section of that name instead. Skip "Threads, atomics", "Locking" and "Error handling". The series was picked because it is written for readers who know C, by the founder of PowerDNS, a DNS server written in C++.
- [Bert Hubert: Modern C++ for C Programmers, part 3](https://berthub.eu/articles/posts/cpp-3/) (read, 30 min): The whole part. "Inheritance & polymorphism" covers `virtual`, `= 0` and `override`. "A worked example" shows `find`, `end()`, `first` and `second` on an associative container, the same calls the tutorial makes on `std::map`.
- [Bert Hubert: Modern C++ for C Programmers, part 5](https://berthub.eu/articles/posts/cpp-5/) (read, 30 min): From "Memory management" through "Smart pointers and polymorphism", which covers `std::unique_ptr`, `std::make_unique`, `std::move` and the virtual destructor. Skip "Placement new" and the rest. The `std::move` example uses exceptions. Ignore the exception code in it.

### Build

Write `cpp/rpn.cpp`, a calculator that turns reverse Polish notation, where each operator follows its two operands, into an expression tree.

1. Include `<cstdio>`, `<cstdlib>`, `<cstring>`, `<memory>`, `<string>`, `<utility>` and `<vector>`. A base class `Expr` with a virtual destructor, `virtual double eval() const = 0` and `virtual std::string str() const = 0`. Derived classes `Num`, `Neg` and `Bin`. `Bin` holds a `char` operator and two `std::unique_ptr<Expr>` children, set through a member initializer list.
2. A counter of live nodes, declared inside `Expr` as `inline static int live = 0;`, incremented in its constructor and decremented in its destructor.
3. `std::unique_ptr<Expr> parse_rpn(const std::string &src)`. Walk `src` with an index and build each space-separated token with `+=`. Kaleidoscope's lexer in step 3 builds identifiers the same way. Convert numbers with `strtod(tok.c_str(), &end)`. A number pushes a `Num` onto a `std::vector<std::unique_ptr<Expr>>`. `+ - * /` pop two entries and push a `Bin`. `neg` pops one and pushes a `Neg`. Move entries out of the vector with `std::move(stack.back())` followed by `pop_back()`. On a missing operand, an unknown token or anything other than one value left at the end, print an error to `stderr` and return `nullptr`.
4. `str()` formats numbers with `snprintf` and `%g` into a `char` buffer and returns `std::string(buf)`. `main` runs these cases and checks `live == 0` after each one: `1 2 + 3 *` prints `((1 + 2) * 3) = 9`, `2 3 4 * -` prints `(2 - (3 * 4)) = -10`, `5 neg 2 /` prints `(-5 / 2) = -2.5`, and `1 +`, `1 2` and the empty string are errors.
5. A function `use_after_move()` that moves one `unique_ptr` into another with `auto b = std::move(a);` and then calls `eval()` through `a`. Call it only when the program gets the argument `crash`.
6. Build with `clang++ -std=c++17 -g -Wall -Wextra -fsanitize=address,undefined cpp/rpn.cpp -o rpn`. `clang++` is clang in C++ mode, and `-std=c++17` picks the version of C++ that LLVM 18 is written in.
7. Write the same code in Rust in a scratch file `cpp/move.rs`: a `Box` moved with `let b = a;` and then used through `a`. Run `rustc cpp/move.rs` and paste its error as a comment next to `use_after_move`.

### Done when

`./rpn` prints the three results and the three errors, `live` is 0 after every case, and the sanitizers report nothing, including LeakSanitizer at exit. `./rpn crash` stops with "member call on null pointer" from the undefined behavior sanitizer, then a segmentation fault report from AddressSanitizer. `rustc cpp/move.rs` refuses to compile with error E0382, "borrow of moved value", and that error sits next to `use_after_move` in your C++ file. For each `std::move` in your file, you can say which object owns the node before and after.

## A lexer, a parser and your first IR

With the C++ from step 2 you can type the tutorial. Tutorial chapters 1 and 2 build the front end. The lexer, `gettok`, returns either a character's own value or a negative code for `def`, `extern`, identifiers and numbers. clox's scanner made a `Token` struct with a type and a slice of the source. Kaleidoscope keeps the current identifier and number in two globals instead.

The parser is recursive descent, and `ParseBinOpRHS` does the job of clox's `parsePrecedence`: it keeps parsing while the next operator binds at least as tightly as the current minimum.

The difference is the output. clox wrote bytecode as it parsed. Kaleidoscope builds an **abstract syntax tree**, AST for short: a tree of objects, one per expression, like the JSON tree of chapter 04. A top-level expression such as `4+5;` becomes a function with no arguments named `__anon_expr`, so later steps can compile and call it.

Tutorial chapter 3 adds a virtual `codegen()` to every AST class. Each node generates its children first and then appends its own instruction, so the IR comes out in the order the values are needed:

![The AST of x*x + 2*x and the IR its codegen emits. Each binary node first generates its two children and then appends one instruction, so the two multiplications come out before the addition. Leaves emit no instruction and return the argument %x or a constant.](figures/12-ast-codegen.svg)

Three LLVM objects do the work:

- `LLVMContext` owns types and constants and hands out one shared copy of each, so the API says `ConstantFP::get` and not `new`.
- `Module` owns the functions you generate.
- `IRBuilder` keeps an insertion point inside a basic block and appends instructions there.

The AST and the IR are owned differently. Your AST nodes live in `unique_ptr`s and are freed when the parser drops them. IR objects belong to the module, so `codegen()` returns a raw `Value *` that you never free, like the pointers into your chapter 04 arena. `verifyFunction` checks a finished function against the rules from step 1. Call it as `verifyFunction(*F, &errs())` and it prints the reason when it returns `true`, which means the function is broken.

Each tutorial page ends with a full code listing, the same file as `llvm/examples/Kaleidoscope/ChapterN/toy.cpp` in LLVM's source. Where the prose and the listing disagree, follow the listing. Type the code in as you did with clox, and build after every section. Keep one file, `src/toy.cpp`, and commit at the end of each tutorial chapter so you can diff your version against the listing.

`$(...)` pastes a command's output into the line, as `$(uname -s)` does in `build.sh`. `llvm-config --cxxflags` prints the flags for compiling against LLVM: where its headers are, `-std=c++17`, and `-fno-exceptions`. `--ldflags --system-libs --libs core` prints the flags for linking.

On Ubuntu the link flags come down to `-lLLVM-18`, one shared library that holds all of LLVM. `-g -O1` keeps the debug information for gdb and optimizes your C++ a little. `-Wall` stays on as in every build since chapter 01. `-Wextra` stays off here, because LLVM's own headers set off between 30 and 150 of its unused-parameter warnings, all in code you did not write. Each build takes about ten seconds, most of it spent in LLVM's headers:

```sh
clang++ -Wall -g -O1 src/toy.cpp $(llvm-config --cxxflags) -o toy                                    # tutorial chapter 2
clang++ -Wall -g -O1 src/toy.cpp $(llvm-config --cxxflags --ldflags --system-libs --libs core) -o toy   # tutorial chapter 3
```

### Study

- [Kaleidoscope, chapter 1: Kaleidoscope Introduction and the Lexer (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/tutorial/MyFirstLanguageFrontend/LangImpl01.html) (do, 45 min): Sections 1.1 and 1.2. Type the lexer as you go.
- [Kaleidoscope, chapter 2: Implementing a Parser and AST (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/tutorial/MyFirstLanguageFrontend/LangImpl02.html) (do, 1 h 45 min): Sections 2.1 to 2.8, typing the code as you go. Section 2.9 is the full listing to check against.
- [Kaleidoscope, chapter 3: Code generation to LLVM IR (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/tutorial/MyFirstLanguageFrontend/LangImpl03.html) (do, 1 h 30 min): Sections 3.1 to 3.5, with 3.6 as the listing. Look up `fcmp` and `uitofp` in the LangRef from step 1 when 3.3 uses them.

### Build

1. Tutorial chapters 1 and 2: `./toy` reads from standard input and prints what it parsed. Check the sample session in section 2.8. The build warns that the private fields `Val` and `Op` are not used. Chapter 3's `codegen()` uses them, and the warnings go away.
2. Tutorial chapter 3: `./toy` prints the IR for every definition, extern and top-level expression.
3. Add `/` as a binary operator with precedence 40, emitting `fdiv` through `Builder->CreateFDiv`.
4. Identifiers are letters and digits only, so `half_of` lexes as `half` followed by `_`. Allow `_` in the first character and in the rest. Step 6 needs it for `newton_sqrt`.
5. Fix the bug the end of section 3.4 describes. When a definition finds a function that an earlier `extern` declared, report an error if the argument counts differ, and otherwise rename the existing function's arguments to the definition's names. Add a `getArgs()` accessor to `PrototypeAST`, use `F->arg_size()` for the count, and loop over `F->args()` with `setName` to rename.
6. Put the inputs below in `tests/ch3.ks` and run `./toy < tests/ch3.ks`.

   ```
   4+5;
   def foo(a b) a*a + 2*a*b + b*b;
   def half_of(x) x/2;
   extern cos(x);
   cos(1.234);
   extern foo2(a);
   def foo2(b) b;
   extern f(a);
   def f(a b) a;
   def bad(x) y;
   def good(x) x*2;
   ```

### Done when

- `4+5;` prints a function that returns `9.000000e+00` with no `fadd`, because `IRBuilder` folded the constants as it built them.
- `foo` prints the same instructions as the listing in section 3.5, apart from value names.
- `half_of` is one function and contains `fdiv`.
- `foo2` compiles and its IR uses `%b`.
- `f` prints your argument-count error.
- `bad` prints "Error: Unknown variable name", and `good` still compiles after it.
- You can say which object frees each `ExprAST` and why nothing frees a `Value`.

## A JIT and the optimizer

Your `toy` prints IR and never runs it. Tutorial chapter 4 adds the two missing parts of the pipeline from the start of this chapter. The first is the optimizer. `IRBuilder` already folds constants as it builds, but it cannot see that `(1+2+x)*(x+(1+2))` computes `x+3` twice. Four passes fix that:

- `instcombine` makes small local rewrites, such as an integer `x * 2` into a shift left by one bit.
- `reassociate` reorders commutative operations so that equal expressions are written the same way.
- `gvn`, global value numbering, finds instructions that compute a value already computed and deletes the copies.
- `simplifycfg` merges and deletes basic blocks.

The pass manager setup takes about twenty lines, mostly four analysis managers that the passes ask for facts about the code. Type it in without studying it.

The second part is the JIT from the start of this chapter. `KaleidoscopeJIT` is a small class built on ORC, LLVM's library for JITs. It lives in LLVM's source tree, not in the installed headers, so you copy it into `include/KaleidoscopeJIT.h`. `addModule` compiles a module into x86-64 code in memory, and `lookup` returns the address of a symbol.

The tutorial casts that address to `double (*)()` and calls it. That works because the generated code follows the System V calling convention from chapter 05. A module is the unit the JIT compiles and frees, so the tutorial puts every function in its own module and removes each `__anon_expr` module after running it:

![The path of a typed line through the JIT. The line bar(2) is parsed into __anon_expr, turned into IR in a new module and optimized. addModule compiles the module into x86-64 code in memory, lookup returns its address, toy calls it through a function pointer and prints the result. Calls to names the module does not define are found in earlier modules or in the running process.](figures/12-jit.svg)

When JIT code calls a name it does not define, the JIT looks in the modules it already has, then in the running process. That finds `sin` in libm and `putchard` in `toy.cpp`. Finding a function of `toy.cpp` takes two things, `extern "C"` on the function and `-rdynamic` on the build line, and build tasks 5 and 6 show what each one does.

LLVM reports failures from calls like `addModule` as `Error` and `Expected<T>` values, the way Rust returns `Result`. The tutorial wraps those calls in `ExitOnErr`, which returns the value on success and prints the error and exits on failure.

The prose of section 4.4 creates the JIT with `std::make_unique<KaleidoscopeJIT>()`, and the listing uses `ExitOnErr(KaleidoscopeJIT::Create())`. Follow the listing. The prose also shows a function being redefined, then warns that the JIT has rejected duplicate definitions since LLVM 9. Skip that part and restart `toy` when you want to redefine something.

The build line adds two LLVM libraries to the link: `orcjit` for the JIT and `native` for the back end of the machine you are on, x86-64. `-rdynamic` makes the functions of `toy` visible to the JIT:

```sh
clang++ -Wall -g -O1 -rdynamic src/toy.cpp $(llvm-config --cxxflags --ldflags --system-libs --libs core orcjit native) -o toy
```

### Study

- [Kaleidoscope, chapter 4: Adding JIT and Optimizer Support (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/tutorial/MyFirstLanguageFrontend/LangImpl04.html) (do, 2 h): Sections 4.1 to 4.4, with 4.5 as the listing. The `putchard` and `printd` functions are at the end of 4.4.
- [KaleidoscopeJIT.h at llvmorg-18.1.3](https://github.com/llvm/llvm-project/blob/llvmorg-18.1.3/llvm/examples/Kaleidoscope/include/KaleidoscopeJIT.h) (reference, as needed): The file at the tag of Ubuntu's LLVM. Copy it into `include/`. Read `Create`, `addModule` and `lookup` once. The rest is ORC setup you can leave alone.
- [LLVM's Analysis and Transform Passes (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/Passes.html) (reference, as needed): The entries for `instcombine`, `reassociate`, `gvn`, `simplifycfg`, `mem2reg` and `dot-cfg`.

### Build

1. Tutorial chapter 4: the JIT, the four passes, `putchard` and `printd`.
2. Add a command-line flag: `./toy -O0` skips `TheFPM->run` and leaves everything else the same.
3. Run `def test(x) (1+2+x)*(x+(1+2));` with and without `-O0`. Copy the `-O0` definition into `opt/test.ll`, then run `opt -S -passes=reassociate opt/test.ll`, `opt -S -passes=gvn opt/test.ll` and `opt -S -passes=reassociate,gvn opt/test.ll`. Write down what each run changed.
4. Add `extern "C" double clockd()` to the host, returning `(double)clock() / CLOCKS_PER_SEC`. That is the same clock clox's `clock()` native reads.
5. C++ encodes a function's argument types into its symbol name, which is called **name mangling**, and `extern "C"` keeps the plain C name. Remove `extern "C"` from `putchard`, rebuild, and look at `nm toy | grep putchard`. You see `_Z8putchardd`, which is `putchard(double)` mangled. Put `extern "C"` back.
6. A program's **dynamic symbol table** lists the names that code loaded at run time can find in it, and the JIT searches that table. `nm -D` prints it. Without `-rdynamic` it holds only names the program takes from shared libraries, and `-rdynamic` adds the program's own functions. Build once without `-rdynamic`, and compare `nm -D toy | grep putchard` and the output of `extern putchard(x); putchard(65);` with the normal build.

### Done when

- `def foo(x) x + 1; def bar(x) foo(2 * x); bar(2);` prints "Evaluated to 5.000000".
- `extern sin(x); sin(1.0);` prints "Evaluated to 0.841471".
- `extern printd(x); printd(42);` prints 42.000000 and then "Evaluated to 0.000000".
- With passes on, `test` contains one `fadd` and one `fmul`.
- From build task 3 you can say which pass makes the two additions look the same, and why `gvn` alone already removes the copy when `3 + x` and `x + 3` are written in different orders, given that `fadd` is commutative.
- Without `-rdynamic`, `nm -D` shows no `putchard` and the call fails with "Symbols not found: [ putchard ]".

## Control flow, phi nodes and mem2reg

So far every Kaleidoscope function is one basic block, so its IR has no phi. Tutorial chapter 5 adds `if`/`then`/`else` and `for`. An `if` builds the shape of `pick` from step 1.

The block that computes the condition ends in a conditional `br` to a `then` block or an `else` block. Both of those end in a `br` to a merge block, and the merge block starts with a phi that picks the value from whichever branch ran. The tutorial builds that phi by hand.

Section 5.2.5 has one detail to watch. Generating the `then` expression can create blocks of its own, when it holds another `if`. The phi must name the block the builder is in after generating it, `Builder->GetInsertBlock()`, and not the block where `then` started:

![The control flow graph of an if whose then-expression is another if. Generating the then-expression creates the blocks then4, else and ifcont, so the outer merge block ifcont6 is reached from ifcont, not from then, and its phi names ifcont.](figures/12-nested-if.svg)

The `for` loop runs its body before it tests the end condition, so it has the shape of a C `do`/`while` and the body always runs at least once. Its loop variable is a phi at the top of the loop block, like `%i.0` in `ipow`.

Tutorial chapter 7 adds `var`/`in` for local variables and `=` for assignment. Writing phi nodes by hand for every assignment would mean building SSA in the front end. The tutorial takes clang's route from step 1 instead:

- Every variable, including each function argument, gets an `alloca` in the function's entry block, made by the helper `CreateEntryBlockAlloca`.
- A read becomes a `load` and a write becomes a `store`.
- mem2reg turns the slots back into SSA values with phi nodes, as in the `ipow` figure of step 1. It only promotes an `alloca` in the entry block that is used only by plain loads and stores.

The 18.1.8 pages have a gap here. Section 7.5 adds mem2reg with an older API call, `createPromoteMemoryToRegisterPass`, that your pass manager does not take, and the listing in 7.8 leaves mem2reg out. Without it, `gvn` removes most of the loads but every `alloca` and `store` stays. Add `#include "llvm/Transforms/Utils/Mem2Reg.h"` and put `TheFPM->addPass(PromotePass());` first in the pass list. `PromotePass` is mem2reg's name in C++.

The examples in tutorial chapter 7 use operators that chapter 6 lets the user define. `def binary : 1 (x y) y;` makes `:` a sequencing operator that evaluates both sides and returns the right one.

You skip chapter 6, so make `:` built in: precedence 1 in `BinopPrecedence`, and `BinaryExprAST::codegen` returns `R` for it. The chapter 7 code also mentions `tok_binary`, `tok_unary` and token numbers from chapter 6. Leave those out. Your token numbers can differ.

This step also times compiled code against clox. In chapter 11 you timed `fib(35)` in clox with `test/benchmark/fib.lox`. You run the same function in your JIT and in C.

### Study

- [Kaleidoscope, chapter 5: Extending the Language: Control Flow (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/tutorial/MyFirstLanguageFrontend/LangImpl05.html) (do, 2 h): Sections 5.1 to 5.3, with 5.4 as the listing. The `opt -passes=view-cfg` command in 5.2.4 opens a window. Use `dot-cfg` as in the build below, which writes files instead.
- [Kaleidoscope, chapter 7: Extending the Language: Mutable Variables (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/tutorial/MyFirstLanguageFrontend/LangImpl07.html) (do, 2 h): Sections 7.1 to 7.7, with 7.8 as the listing. Section 7.3 explains why the tutorial uses `alloca` plus mem2reg. Read it slowly and compare its examples with your `funcs.m2r.ll` from step 1.

### Build

1. Tutorial chapter 5. Check that `def foo(x) if x < 10 then 0 else 1; foo(9); foo(11);` evaluates to 0 and then 1.
2. Before you run them, write down how many stars `printstar(100)`, `printstar(1)` and `printstar(0)` print with the definition from section 5.3. Then run them.
3. Run `./toy -O0`, copy the IR for `printstar` and for a function with a nested `if` into `opt/cfg.ll`, then run `opt -passes=dot-cfg -disable-output cfg.ll` inside `opt/`. It writes one hidden file per function into the current directory, such as `.printstar.dot`, so list them with `ls -a`. Graphviz is a set of programs that draw graphs, and its `dot` command turns a text file like these into an image. Install it with `sudo apt install -y graphviz` and render each file with `dot -Tpng .printstar.dot -o printstar.png`. Open the images in your editor.
4. Time `fib(35)` three ways: in your release build of clox with `test/benchmark/fib.lox`, in your JIT, and in C with `double fib(double x)` built with `clang -O2`. Write the three times in a file `NOTES.md` in `llvm/`, as you kept one in `rust/`. In the JIT, type `extern clockd(); extern printd(x);` and `def fib(x) if x < 3 then 1 else fib(x-1)+fib(x-2);`, then these three top-level lines, and subtract the two printed clock readings by hand:

   ```
   printd(clockd());
   fib(35);
   printd(clockd());
   ```

5. Tutorial chapter 7, with mem2reg added as above, `:` built in and `=` at precedence 2 as section 7.6 sets it.
6. Write `fibi` from section 7.4 without the `def binary` line, and check `fibi(10)`.
7. Run the `printstar` calls from build task 2 again on the chapter 7 version. Its loop variable now lives in an `alloca`. Compare `printstar`'s IR under `-O0` and with passes on, and find the phi that mem2reg made.

> **Practice:** Use the release build of clox and the minimum of five runs for each time, as in chapter 11.

### Done when

`foo(9)` and `foo(11)` evaluate to 0 and 1, and your star counts matched, or you can explain each miss from the `for` loop's IR. Your CFG image of the nested `if` shows the outer merge block with the inner merge block as a predecessor, and you can say why its phi names the block that `GetInsertBlock()` returned. `fibi(10)` evaluates to 55. Both versions of `printstar` print the same counts, and the chapter 7 version with passes on has no `alloca`. `NOTES.md` has the three `fib(35)` times and two sentences on where the gap between clox and your JIT comes from.

## Object files for x86-64 and ARM64

Tutorial chapter 8 swaps the JIT for a file. The back end needs to know which machine to write code for. A **target triple** names it as `<arch>-<vendor>-<sys>-<env>`. Your laptop's is `x86_64-pc-linux-gnu`, which `clang -print-target-triple` prints. A triple may leave a part out, as `aarch64-linux-gnu` leaves out the vendor.

The tutorial looks up a target by its triple and makes a `TargetMachine` from it. The `TargetMachine` knows the CPU, the **data layout** (the sizes and alignments of types on that machine) and how to emit code. `addPassesToEmitFile` runs the back end over the module and writes an object file. Two of its stages do most of the work:

- **Instruction selection** picks machine instructions for each IR instruction.
- **Register allocation** maps the unlimited SSA values onto the CPU's real registers, and puts the rest in stack slots.

The back end still runs on LLVM's older pass manager, which is why tutorial chapter 8 includes `LegacyPassManager.h`.

Make this a second program, `src/ksc.cpp`, copied from your `toy.cpp` as it stands after tutorial chapter 7. It has no JIT, reads a whole file from standard input into one module, and writes `output.o` at the end.

The tutorial's chapter 8 listing drops the optimization passes. Keep yours, or every variable stays an `alloca` slot in the object file. The listing also sets the data layout only after parsing. Create the `TargetMachine` before parsing instead, and set the module's triple and data layout when you create the module, so the passes know the machine.

`InitializeAllTargets` and the calls next to it link every back end into `ksc`, so `ksc` can write code for any CPU LLVM supports. You use that to build the same program for ARM64, the second instruction set of chapter 05, and run it under `qemu-aarch64`:

![One IR function, newton_sqrt, goes through two target machines. The x86-64 one writes an ELF object where x arrives in xmm0 and is copied to xmm1, and the loop runs divsd and addsd on xmm registers. The AArch64 one writes an ELF object where x stays in d0 and the loop runs fdiv and fadd on d registers. Both return the result in register 0. clang links the x86-64 object for the laptop, and links the AArch64 one statically for qemu-aarch64.](figures/12-two-targets.svg)

Doubles do not travel in the integer registers. On x86-64 the first double argument arrives in xmm0, the second in xmm1, and a double result leaves in xmm0, as you saw for `scale` in chapter 05. Chapter 05's System V ABI document says so in section 3.2.3, Parameter Passing, under the SSE class. The instructions are the scalar double forms: `addsd`, `subsd`, `mulsd`, `divsd`.

On ARM64 the first eight double arguments arrive in d0 to d7, which are the 64-bit views of the vector registers v0 to v7, and the result leaves in d0. The instructions are `fadd`, `fsub`, `fmul` and `fdiv` on d registers.

The language also gets two features that are yours. Unary minus becomes the `fneg` instruction, emitted with `Builder->CreateFNeg` and parsed in `ParsePrimary` when the current token is `-`. A `>` operator uses `Builder->CreateFCmpUGT`, next to the `CreateFCmpULT` that `<` uses, followed by the same `uitofp`. Give `>` precedence 10, the same as `<`. Add both features to `toy.cpp` and to `ksc.cpp`.

### Study

- [Kaleidoscope, chapter 8: Compiling to Object Code (LLVM 18.1.8)](https://releases.llvm.org/18.1.8/docs/tutorial/MyFirstLanguageFrontend/LangImpl08.html) (do, 1 h): Sections 8.1 to 8.6, with 8.7 as the listing. Section 8.6 links a C++ caller. You link a C caller instead, with `double average(double, double);` in place of the `extern "C"` block. The `--libs all` build line from 8.6 links every LLVM library.
- [Procedure Call Standard for the Arm 64-bit Architecture (AAPCS64)](https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst) (reference, as needed): Only section 6.1.2, "SIMD and Floating-Point registers", the part of this document that chapter 05 told you to skip. v0 to v7 carry arguments and results, and d0 is the 64-bit view of v0.

### Build

1. `ksc` with the command line `./ksc [-S] [-O0] [-target <triple>] < prog.ks`. It writes `output.o`, or `output.s` with `-S` (use `CodeGenFileType::AssemblyFile`). `-O0` skips your passes. The default triple is `sys::getDefaultTargetTriple()`. Build it with `clang++ -Wall -g -O1 src/ksc.cpp $(llvm-config --cxxflags --ldflags --system-libs --libs all) -o ksc`.
2. Unary minus and `>`. Put `def t1(x) -x;`, `def t2(x y) x - -y;`, `def t3() 3 > 2;` and `def t4() 2 > 3;` in `tests/ops.ks` and check their IR and values through `toy`.
3. `tests/newton.ks`:

   ```
   def newton_sqrt(x)
     var g = x / 2 in
       (for i = 0, i < 20 in g = (g + x / g) / 2) : g;

   def absdiff(a b) if a < b then -(a - b) else a - b;
   ```

4. `tests/main.c` declares both functions, computes `newton_sqrt` for 2, 10, 1000000 and 0.25, compares each with `sqrt` from `<math.h>` using `absdiff`, prints PASS or FAIL per value with a relative tolerance of 1e-12, and returns 1 on any failure.
5. Build and run it on x86-64: `./ksc < tests/newton.ks && clang tests/main.c output.o -lm -o newton && ./newton`.
6. Build it for ARM64 and run it under QEMU. `--target=aarch64-linux-gnu` makes clang cross-compile with the ARM64 libraries that the cross toolchain from chapter 05 installed, and `-static` is that chapter's choice for every ARM64 program:

   ```sh
   ./ksc -target aarch64-linux-gnu < tests/newton.ks && mv output.o newton-arm64.o
   clang --target=aarch64-linux-gnu -static tests/main.c newton-arm64.o -lm -o newton-arm64
   qemu-aarch64 ./newton-arm64
   ```

7. Run `file`, `nm` and `objdump -d` on the x86-64 object, and `aarch64-linux-gnu-objdump -d` on the ARM64 one. Compare the instructions of `newton_sqrt` on the two machines.
8. Build `output.s` for x86-64 with and without `-O0`. In the optimized loop of `newton_sqrt`, mark the `divsd` and the xmm registers that hold `x` and `g`. Find where your `/ 2` went: `instcombine` turned it into a multiplication by 0.5, which gives the same result because 0.5 is a power of two. In the `-O0` version, find the stack loads and stores that the `alloca` slots became. Compare the optimized loop with the floating-point code you wrote by hand in chapter 05.
9. Write `LANGUAGE.md`: the grammar, every operator with its precedence, the built-in `:`, unary minus, what a `for` loop returns, and what the language does not have.

> **Optional, on the Mac:** Run `clang -print-target-triple` on the Mac. In WSL2, run `./ksc -target <triple> < tests/newton.ks` with the triple the Mac printed. The result is a Mach-O object, the Mac's format from chapter 05. Check it with `llvm-nm output.o`, which shows `_newton_sqrt` with the leading underscore Apple's toolchain gives every symbol. Then copy `output.o` and `tests/main.c` to the Mac and link them there with `clang tests/main.c output.o -o newton`.

### Done when

`./newton` and `qemu-aarch64 ./newton-arm64` each print four PASS lines. `file` says "x86-64" for one object and "ARM aarch64" for the other, and `nm` shows `newton_sqrt` and `absdiff` as `T` in both. You can point at the instructions that carry `x` in and the result out of `newton_sqrt` on each machine and name the registers its calling convention assigns. `tests/ops.ks` gives the values you expect, and `LANGUAGE.md` describes the language your compiler accepts.

## Where this leads

You can now read the IR clang makes for scalar C code, including its `alloca` slots at `-O0` and the phi nodes mem2reg puts in their place. You have met calls, structs, globals and `getelementptr` only in the reading. You wrote a front end that emits SSA IR, ran LLVM's passes and watched which pass changed what, and sent the same IR through a JIT and through the back end into object files for two instruction sets. The C++ you learned covers the tutorial and not much more. You also measured how much an interpreter loop costs against compiled code for one recursive function.

Chapter 13, Software rendering, starts the part on graphics and games and goes back to the window of chapter 06. Your CHIP-8 front end ran one SDL loop that polled input, ran the machine and pushed a 64 by 32 texture to the screen 60 times a second. Chapter 13 splits that loop into a platform layer and a game function the platform calls once per frame, then loads the game as a shared library that you rebuild and reload while it runs. On that base you write a rasterizer in C whose inner loops compute every pixel of a 960 by 540 frame from triangles and a camera. Reading the IR and the assembly clang makes for those loops, and checking which loops the vectorizer from chapter 07 handled, uses what you practiced in this chapter.
