---
id: 12
title: An LLVM backend
part: Languages and compilers
weeks: 3
project: Kaleidoscope, a small language of doubles, functions, loops and local variables, compiled by your own C++ front end through LLVM IR into a JIT and into object files that link with C on Linux and on the Mac.
---

Chapter 11 ended with Lua handlers running inside your HTTP server. Before that you built clox. clox scans, parses with a Pratt parser that writes bytecode while it parses, and runs that bytecode in a loop with a `switch` over opcodes. Every Lox program you ran went through that loop one instruction at a time. In chapter 05 you saw the other way: clang turns C into ARM64 instructions that the CPU runs directly.

This chapter builds a compiler that produces machine code. The language is Kaleidoscope, from LLVM's own tutorial. Every value is a 64-bit double, and the language has functions, `extern` declarations for C functions, `if`/`then`/`else`, a `for` loop and mutable local variables. You write the lexer, the parser and the AST in C++. Your code walks the AST and emits LLVM IR. LLVM optimizes that IR and turns it into ARM64 code, either straight into memory (a JIT) or into an object file that clang links with a C program. On top of the tutorial you add your own operators and a compile-to-file driver that can also target the Mac.

```
  clox, chapter 11
  source --scanner--> tokens --Pratt parser, emits as it parses--> bytecode --VM loop--> result

  this chapter
  source --lexer--> tokens --parser--> AST --codegen--> LLVM IR --passes--> better IR --+
                                                                                        |
                         JIT: ARM64 code in memory, called through a function pointer <-+
                         object file: .o for Linux or the Mac, linked with C by clang <-+
```

The chapter comes now because the two ends of this compiler are already familiar. You wrote a scanner and a precedence parser in chapter 11, and you read object files, symbols and calling conventions in chapter 05. The new material is the intermediate representation in SSA form, the optimization passes that run over it, and the backend that turns it into instructions. Clang and rustc both hand their output to this same IR, these passes and this backend, so after this chapter you can read the IR they produce for your C and your Rust.

The tutorial is written in C++, which this book has not taught. You need a small part of it: classes, virtual functions, `std::unique_ptr` with `std::move`, and three standard containers. Step 2 covers that part with one series written for C programmers. All building happens in the Linux VM, on one pinned LLVM version. The Mac comes back in the last step to run object files your compiler made for it. Steps 3 to 6 follow Kaleidoscope chapters 1 to 5, 7 and 8. You skip chapter 6 (user-defined operators) and chapter 9 (debug information).

## Reading LLVM IR

Before you generate IR, read some. You need LLVM 23 in the VM first. LLVM's C++ API changes between major releases, and the tutorial pages change with it. Chapter 8 of the tutorial sets the module's data layout with `TargetMachine->createDataLayout()` in the 23.1.0 docs and with a different call in the current development docs. Pin one version, and read the tutorial pages from `releases.llvm.org/23.1.0`, which every link in this chapter uses. Point releases inside 23 keep the same API, so 23.1.6 works with the 23.1.0 pages. The apt.llvm.org repository serves LLVM 23 for Ubuntu 24.04 on ARM64, with headers and libraries. Homebrew's `llvm` on the Mac follows the newest major version, so this chapter builds in the VM.

```sh
sudo apt install -y lsb-release wget gnupg software-properties-common
wget https://apt.llvm.org/llvm.sh
sudo bash llvm.sh 23
sudo apt install -y llvm-23-dev libclang-rt-23-dev zlib1g-dev libzstd-dev
echo 'export PATH=/usr/lib/llvm-23/bin:$PATH' > ~/llvm23.sh
. ~/llvm23.sh
llvm-config --version     # 23.1.x
clang --version           # clang version 23.1.x
```

`llvm.sh` adds the repository and installs clang 23. If `llvm.sh` fails, add the repository by hand. Put `deb http://apt.llvm.org/noble/ llvm-toolchain-noble-23 main` in a file under `/etc/apt/sources.list.d/`, save the key from `https://apt.llvm.org/llvm-snapshot.gpg.key` as `/etc/apt/trusted.gpg.d/apt.llvm.org.asc`, run `sudo apt update` and install `clang-23` before the other packages. `llvm-23-dev` brings the headers, the static libraries and `llvm-config`. `libclang-rt-23-dev` holds the sanitizer runtime, the versioned form of the `libclang-rt-dev` package from chapter 01. Keep the project in `~/code/kaleido` on the Mac and build it in the VM under `/mnt/mac/Users/<you>/code/kaleido`, as chapter 01 set up. Run `. ~/llvm23.sh` in every VM shell you use for this chapter. It puts the LLVM 23 tools first, so `clang`, `opt`, `llc` and `llvm-config` mean version 23.

LLVM IR is a typed assembly language for a machine with an unlimited number of registers. A module holds functions. A function holds basic blocks. A basic block is a list of instructions that ends in exactly one terminator, such as `br` (branch) or `ret`, and control enters a block only at its top. Every value is named once, with `%`, and is never assigned again. That rule is static single assignment, SSA. A value that differs depending on how control arrived, like a loop counter, comes from a `phi` instruction at the top of a block. `phi` picks one of its inputs according to the block control came from. A block dominates a use when every path from the function's entry to the use passes through that block. An instruction can use a value only where the value's definition dominates it, so the value is certain to exist. A `phi` input only has to be available at the end of the predecessor block it comes from.

Here is one loop in C, as clox would run the same loop written in Lox, and as LLVM IR:

```
  C                                  clox bytecode for the Lox version (chapter 11)
  int ipow(int x, int y) {             OP_GET_LOCAL i, OP_GET_LOCAL y, OP_LESS    test i < y
      int r = 1;                       OP_JUMP_IF_FALSE                           leave the loop
      for (int i = 0; i < y; i++)      OP_GET_LOCAL r, OP_GET_LOCAL x,
          r *= x;                      OP_MULTIPLY, OP_SET_LOCAL r                overwrite slot r
      return r;                        ... increment i the same way ...
  }                                    OP_LOOP                                    back to the test

  LLVM IR after mem2reg (written by hand, clang's names will differ)
  define i32 @ipow(i32 %x, i32 %y) {
  entry:
    br label %cond
  cond:
    %r = phi i32 [ 1, %entry ], [ %r2, %body ]
    %i = phi i32 [ 0, %entry ], [ %i2, %body ]
    %c = icmp slt i32 %i, %y
    br i1 %c, label %body, label %done
  body:
    %r2 = mul i32 %r, %x
    %i2 = add i32 %i, 1
    br label %cond
  done:
    ret i32 %r
  }
```

clox keeps `r` and `i` in stack slots and overwrites them. The IR never overwrites anything. Each trip through `cond` makes new `%r` and `%i`, chosen by the `phi` from the entry edge or the back edge. Front ends do not usually build `phi` nodes themselves. Clang gives every local variable a stack slot with `alloca`, reads and writes it with `load` and `store`, and leaves the rest to a pass called `mem2reg`. That pass promotes the slots to SSA values and inserts the `phi` nodes. `mem2reg` only promotes `alloca` slots. A `load` or `store` through a pointer that came in as an argument stays. Kaleidoscope does the same in step 5.

One trap when you try this on clang's output: at `-O0`, clang marks every function `optnone`, and the optimizer skips those functions. Add `-Xclang -disable-O0-optnone` when you want to run passes on `-O0` output, and `-fno-discard-value-names` to keep readable names.

### Study

- [Sunny Young de la Sota (mcyoung): A Gentle Introduction to LLVM IR](https://mcyoung.xyz/2023/08/01/llvm-ir/) (read, 1 h 15 min): The whole post. It was picked because it teaches IR as a language you read, starting from small functions and building up to SSA, `phi`, `alloca` and `mem2reg`. Skim "Synchronization" and "Reinterpret Shenanigans". The examples are Rust, which you can read after chapter 10, compiled for x86-64. The IR ideas carry over to ARM64 unchanged, and only the `target` lines and some attributes differ.
- [LLVM Language Reference Manual (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/LangRef.html) (reference, as needed): "Identifiers", "Module Structure" and "Functions" under High Level Structure, then the entry for each instruction you meet: `alloca`, `load`, `store`, `br`, `phi`, `icmp`, `fcmp`, `fadd`, `call` and `ret`. Do not read it front to back.

### Build

1. Install LLVM 23 as above and check both version lines.
2. In `ir/funcs.c`, copy `swap_ints` and `str_len` from chapter 02, and add `ipow` from the diagram plus `double pick(double c, double a, double b)` that returns `a` when `c != 0` and `b` otherwise, with two `return` statements.
3. Emit three versions:

```sh
clang -S -emit-llvm -O0 -Xclang -disable-O0-optnone -fno-discard-value-names ir/funcs.c -o ir/funcs.ll
opt -passes=mem2reg -S ir/funcs.ll -o ir/funcs.m2r.ll
opt -O2 -S ir/funcs.ll -o ir/funcs.o2.ll
```

4. In `funcs.m2r.ll`, write a comment above every basic block of `ipow` and `pick` that names its predecessors and its terminator. For each `phi`, write which C variable it stands for and which edge brings which value. In `swap_ints`, explain why the `load` and `store` instructions survived `mem2reg`.
5. Run `clang` again on `funcs.c` without `-Xclang -disable-O0-optnone`, run `mem2reg` on that output, and diff it against the input.
6. Write `ipow` in Lox, run it in your clox with `DEBUG_PRINT_CODE` defined, and paste the disassembly into a comment next to the IR. Mark which instructions in each form read and write `r`.
7. Write `ir/fib.ll` by hand: `define i64 @fib(i64 %n)`, iterative, with `alloca` slots for the two previous values and the counter, in the style of the post's `@pow`. Check it with `opt -passes=verify -disable-output ir/fib.ll`. Write `ir/main.c` that declares `long long fib(long long n);` and prints `fib(0)` to `fib(10)` and `fib(90)`. Build with `clang ir/main.c ir/fib.ll -o fibtest`. Clang accepts `.ll` files as inputs.
8. Run `opt -passes=mem2reg -S ir/fib.ll` and compare the `phi` nodes it made with the ones you would have written.
9. Break `fib.ll` twice: assign the same `%` name twice, then use a value in a block that the value's block does not dominate. Read both error messages.

### Done when

`fibtest` prints 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55 and 2880067194370816120. `opt -passes=verify` prints nothing for your `fib.ll`. You can point at every `phi` in `funcs.m2r.ll` and say which variable it replaced and why it sits at the top of its block. You can say why the diff from build task 5 was empty. You can name two differences between the clox disassembly and the IR for `ipow`.

## Enough C++ to read the tutorial

Step 1 read IR that clang wrote. From step 3 on, your own program writes IR through LLVM's C++ API, following LLVM's Kaleidoscope tutorial. The tutorial says it assumes you know C++. You need less than that. This is the list, with what you already know for each:

```
  C or Rust you know                                C++ the tutorial uses
  struct plus functions taking a pointer to it      class with member functions, `this` is that pointer
  table of function pointers in a struct            virtual function, `= 0` makes it required, `override`
  Box<T> from chapter 10, an owning heap pointer    std::unique_ptr<T>, and std::unique_ptr<Base> for a derived object
  let b = a; moves, a is unusable afterwards        auto b = std::move(a); a is now null and still compiles
  growable array from chapter 02, Vec<T>            std::vector<T>: push_back, back, pop_back, size, []
  pointer plus length, String                       std::string: +=, ==, [], size, c_str()
  hash trie from chapter 04, HashMap<K, V>          std::map<K, V>: find, end, [], clear
  pointer parameter that must not be null           reference parameter, `const std::string &Name`
```

You do not need to write templates, only use them, as in `std::vector<std::unique_ptr<ExprAST>>`. You do not need exceptions. LLVM is compiled with `-fno-exceptions`, which `llvm-config --cxxflags` adds to your build as well. Kaleidoscope reports errors by returning `nullptr`, and LLVM's fallible calls return `Error` or `Expected<T>` values that step 4 deals with. Output goes through `fprintf` and through LLVM's `errs() << "text"`, which writes to standard error like `fprintf(stderr, ...)`. You do not need to write operator overloads.

The series below does not show the container calls the build uses, so here they are. `s += c` appends a character to a `std::string`, and `s.c_str()` gives a `const char *` for C functions such as `strtod`. `v.back()` returns a reference to the last element of a `std::vector`, and `v.pop_back()` removes that element. A member declared `inline static int live = 0;` inside a class is one shared variable, like a C global scoped to the class.

Two more details the series does not show. A constructor can initialize members before its body runs, with a member initializer list after a colon:

```cpp
class NumberExprAST : public ExprAST {
  double Val;
public:
  NumberExprAST(double Val) : Val(Val) {}   // member Val starts as the parameter Val
  Value *codegen() override;
};
```

And `std::map`'s `[]` inserts a default value when the key is missing. The tutorial depends on that. `BinopPrecedence[CurTok]` adds an entry with precedence 0 for any character it has not seen, and the parser treats 0 as "not an operator". `NamedValues[Name]` for an unknown name returns `nullptr` and leaves a `nullptr` entry in the map. Use `find` when you only want to look.

The largest difference from Rust is the move. After `auto b = std::move(a);` the compiler still lets you use `a`. A moved-from `std::unique_ptr` holds `nullptr`, so `a->eval()` compiles and crashes at run time. Rust rejects the same code at compile time with "borrow of moved value", one of the move errors you met in chapter 10.

### Study

- [Bert Hubert: Modern C++ for C programmers, part 2](https://berthub.eu/articles/posts/cpp-2/) (read, 17 min): "Namespaces", "Classes" and "Resource Acquisition Is Initialization (RAII)". Skip "Smart pointers", which covers `std::shared_ptr`, and read part 5's section of that name instead. Skip "Threads, atomics", "Locking" and "Error handling". The series was picked because it is written for readers who know C, by the founder of PowerDNS, a DNS server written in C++.
- [Bert Hubert: Modern C++ for C Programmers, part 3](https://berthub.eu/articles/posts/cpp-3/) (read, 30 min): The whole part. "Inheritance & polymorphism" covers `virtual`, `= 0` and `override`. "A worked example" shows `find`, `end()`, `first` and `second` on an associative container, the same calls the tutorial makes on `std::map`.
- [Bert Hubert: Modern C++ for C Programmers, part 5](https://berthub.eu/articles/posts/cpp-5/) (read, 30 min): From "Memory management" through "Smart pointers and polymorphism", which covers `std::unique_ptr`, `std::make_unique`, `std::move` and the virtual destructor. Skip "Placement new" and the rest. The `std::move` example uses exceptions. Ignore the exception code in it.

### Build

Write `cpp/rpn.cpp`, a calculator that turns reverse Polish notation into an expression tree.

1. A base class `Expr` with a virtual destructor, `virtual double eval() const = 0` and `virtual std::string str() const = 0`. Derived classes `Num`, `Neg` and `Bin`. `Bin` holds a `char` operator and two `std::unique_ptr<Expr>` children, set through a member initializer list.
2. A counter of live nodes, declared inside `Expr` as `inline static int live = 0;`, incremented in its constructor and decremented in its destructor.
3. `std::unique_ptr<Expr> parse_rpn(const std::string &src)`. Walk `src` with an index and build each space-separated token with `+=`. Kaleidoscope's lexer in step 3 builds identifiers the same way. Convert numbers with `strtod(tok.c_str(), nullptr)`. A number pushes a `Num` onto a `std::vector<std::unique_ptr<Expr>>`. `+ - * /` pop two entries and push a `Bin`. `neg` pops one and pushes a `Neg`. Move entries out of the vector with `std::move(stack.back())` followed by `pop_back()`. On a missing operand, an unknown token or more than one value left at the end, print an error to `stderr` and return `nullptr`.
4. `str()` formats numbers with `snprintf` and `%g` into a `char` buffer and returns `std::string(buf)`. `main` runs these cases and checks `live == 0` after each one: `1 2 + 3 *` prints `((1 + 2) * 3) = 9`, `2 3 4 * -` prints `(2 - (3 * 4)) = -10`, `5 neg 2 /` prints `(-5 / 2) = -2.5`, and `1 +`, `1 2` and the empty string are errors.
5. A function `use_after_move()` that moves one `unique_ptr` into another and then calls `eval()` through the first. Call it only when the program gets the argument `crash`.
6. Build in the VM with `clang++ -std=c++17 -g -Wall -Wextra -fsanitize=address,undefined cpp/rpn.cpp -o rpn`.

### Done when

`./rpn` prints the three results and the three errors, `live` is 0 after every case, and the sanitizers report nothing, including LeakSanitizer at exit. `./rpn crash` dies with a sanitizer report about a null pointer, and you have written the Rust error that the same code would get. For each `std::move` in your file, you can say which object owns the node before and after.

## A lexer, a parser and your first IR

With the C++ from step 2 you can type the tutorial. Kaleidoscope chapters 1 and 2 build the front end. The lexer, `gettok`, returns either a character's own value or a negative code for `def`, `extern`, identifiers and numbers. clox's scanner made a `Token` struct with a type and a slice of the source. Kaleidoscope keeps the current identifier and number in two globals instead. The parser is recursive descent with operator precedence for binary operators. `ParseBinOpRHS` does the same job as clox's `parsePrecedence`. It keeps parsing while the next operator binds at least as tightly as the current minimum. The difference is the output. clox emitted bytecode as it parsed. Kaleidoscope builds an AST and hands it on. A top-level expression becomes a function with no arguments named `__anon_expr`, so that later chapters can compile and call it.

Tutorial chapter 3 adds a virtual `codegen()` to every AST class. Three LLVM objects do the work. `LLVMContext` owns types and constants and hands out one shared copy of each, so the API says `ConstantFP::get` and not `new`. `Module` owns the functions you generate. `IRBuilder` keeps an insertion point inside a basic block and appends instructions there. The AST and the IR are owned differently. Your AST nodes live in `unique_ptr`s and are freed when the parser drops them. IR objects are owned by the module, so `codegen()` returns a raw `Value *` that you never free, the same arrangement as pointers into your chapter 04 arena. `verifyFunction` checks a finished function against the rules from step 1. Call it as `verifyFunction(*F, &errs())` and it prints the reason when it returns `true`, which means the function is broken.

Each chapter page ends with a full code listing. The 23.1.0 listings are the compiled example programs in `llvm/examples/Kaleidoscope/ChapterN/toy.cpp` at that release. Where the prose and the listing disagree, follow the listing. Type the code in. Do not paste it. Keep one file, `src/toy.cpp`, and commit at the end of each tutorial chapter so you can diff your version against the listing.

Build lines, from the VM with `~/llvm23.sh` sourced:

```sh
clang++ -g -O1 src/toy.cpp $(llvm-config --cxxflags) -o toy                    # tutorial chapter 2
clang++ -g -O1 src/toy.cpp $(llvm-config --cxxflags --ldflags --system-libs --libs core) -o toy   # tutorial chapter 3
```

If the link step says it cannot find a library named by `--system-libs`, such as `-lzstd`, install that library's `-dev` package.

### Study

- [Kaleidoscope, chapter 1: Kaleidoscope Introduction and the Lexer (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/tutorial/MyFirstLanguageFrontend/LangImpl01.html) (do, 2 h 30 min): Chapter 1, then chapter 2 at https://releases.llvm.org/23.1.0/docs/tutorial/MyFirstLanguageFrontend/LangImpl02.html. Read sections 2.1 to 2.8 and type the code as you go. Section 2.9 is the full listing to check against.
- [Kaleidoscope, chapter 3: Code generation to LLVM IR (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/tutorial/MyFirstLanguageFrontend/LangImpl03.html) (do, 1 h 30 min): Sections 3.1 to 3.5, with 3.6 as the listing. Look up `fcmp` and `uitofp` in the LangRef from step 1 when 3.3 uses them.

### Build

1. Tutorial chapters 1 and 2: `./toy` reads from standard input and prints what it parsed. Check the sample session in section 2.8.
2. Tutorial chapter 3: `./toy` prints the IR for every definition, extern and top-level expression.
3. Add `/` as a binary operator with precedence 40, emitting `fdiv`.
4. Fix the bug the end of section 3.4 describes. When a definition finds a function that an earlier `extern` declared, report an error if the argument counts differ, and otherwise rename the existing function's arguments to the definition's names. Use `F->arg_size()` for the count and loop over `F->args()` with `setName` to rename.
5. Put the inputs below in `tests/ch3.ks` and run `./toy < tests/ch3.ks`.

```
4+5;
def foo(a b) a*a + 2*a*b + b*b;
def half(x) x/2;
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

`4+5;` prints a function that returns `9.000000e+00` with no `fadd`, because `IRBuilder` folded the constants. `foo` prints the same instructions as the listing in section 3.5, apart from value names. `half` contains `fdiv`. `foo2` compiles and its IR uses `%b`. `f` prints your argument-count error. `bad` prints "Unknown variable name", and `good` still compiles after it. You can say which object frees each `ExprAST` and why nothing frees a `Value`.

## A JIT and the optimizer

Your `toy` prints IR and never runs it. Tutorial chapter 4 adds two things. The first is optimization passes. `IRBuilder` already folds constants as it builds, but it cannot see that `(1+2+x)*(x+(1+2))` computes `x+3` twice. Four function passes fix that: `instcombine` (local rewrites), `reassociate` (reorders commutative operations so equal expressions look equal), `gvn` (global value numbering, which removes repeated computations) and `simplifycfg` (merges and deletes blocks). The pass manager setup takes about twenty lines, mostly four analysis managers that the passes query. Type it in without studying it.

The second is the JIT. `KaleidoscopeJIT` is a small class built on LLVM's ORC JIT APIs. It lives in the LLVM source tree, not in the installed headers, so you copy it from the tag that matches your LLVM into `include/KaleidoscopeJIT.h`. `addModule` compiles a module into ARM64 code in memory. `lookup` returns the address of a symbol. The tutorial casts that address to `double (*)()` and calls it. That works because the JIT follows the platform calling convention from chapter 05, so the generated code is an ordinary function. A module is the unit the JIT compiles and frees, so the tutorial puts every function in its own module and removes each `__anon_expr` module after running it.

When JIT code calls a name it does not define, `KaleidoscopeJIT` looks in the modules it already has, then in the running process. The second lookup finds `sin` in libm and `putchard` in `toy.cpp`. Two details make the process lookup work, and neither is in an earlier chapter. The host function needs `extern "C"`, which turns off C++ name mangling. Without it, `nm toy` shows `_Z8putchardd` and the JIT finds no `putchard`. And on Linux the executable needs `-rdynamic`, which puts its own symbols in the dynamic symbol table that the lookup searches.

LLVM reports failures from calls like `addModule` as `Error` and `Expected<T>` values instead of exceptions. The tutorial wraps those calls in `ExitOnErr`, which returns the value on success and prints the error and exits on failure. The 23.1.0 prose lags its listing in two places. The prose creates the JIT with `std::make_unique<KaleidoscopeJIT>()`, and the listing uses `ExitOnErr(KaleidoscopeJIT::Create())`. Follow the listing. The prose also shows a function being redefined, then warns that the JIT has rejected duplicate definitions since LLVM 9. Skip that part and restart `toy` when you want to redefine something.

Build line:

```sh
clang++ -g -O1 -rdynamic src/toy.cpp $(llvm-config --cxxflags --ldflags --system-libs --libs core orcjit native) -o toy
```

### Study

- [Kaleidoscope, chapter 4: Adding JIT and Optimizer Support (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/tutorial/MyFirstLanguageFrontend/LangImpl04.html) (do, 2 h): Sections 4.1 to 4.4, with 4.5 as the listing. The `putchard` and `printd` functions are at the end of 4.4.
- [KaleidoscopeJIT.h at llvmorg-23.1.0](https://github.com/llvm/llvm-project/blob/llvmorg-23.1.0/llvm/examples/Kaleidoscope/include/KaleidoscopeJIT.h) (reference, as needed): Copy this file into `include/`. If `llvm-config --version` prints a later 23.1 release, change the tag in the URL to match. Read `Create`, `addModule` and `lookup` once. The rest is ORC setup you can leave alone.
- [LLVM's Analysis and Transform Passes (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/Passes.html) (reference, as needed): The entries for `instcombine`, `reassociate`, `gvn`, `simplifycfg`, `mem2reg` and `dot-cfg`.

### Build

1. Tutorial chapter 4: the JIT, the four passes, `putchard` and `printd`.
2. Add a command-line flag: `./toy -O0` skips `TheFPM->run` and leaves everything else the same.
3. Run `def test(x) (1+2+x)*(x+(1+2));` with and without `-O0`. Copy the `-O0` definition into `opt/test.ll`, then run `opt -S -passes=reassociate opt/test.ll`, `opt -S -passes=gvn opt/test.ll` and `opt -S -passes=reassociate,gvn opt/test.ll`. Write down which pass makes the two additions identical and which one deletes the copy.
4. Add `extern "C" double clockd()` to the host, returning `(double)clock() / CLOCKS_PER_SEC`. That is the same clock clox's `clock()` native reads.
5. Remove `extern "C"` from `putchard`, rebuild, and look at `nm toy | grep putchard`. Put it back. Then build once without `-rdynamic` and compare `nm -D toy | grep putchard` and the error from `extern putchard(x); putchard(65);`.

### Done when

`def foo(x) x + 1; def bar(x) foo(2 * x); bar(2);` prints "Evaluated to 5.000000", the case LLVM's own test suite uses for this chapter. `extern sin(x); sin(1.0);` prints "Evaluated to 0.841471". `extern printd(x); printd(42);` prints 42.000000 and then "Evaluated to 0.000000". With passes on, `test` contains one `fadd` and one `fmul`. You can name the pass behind each change from build task 3, and you can say what `-rdynamic` changed in the output of `nm -D`.

## Control flow, phi nodes and mem2reg

So far every Kaleidoscope function is one basic block with no branches, so its IR has no `phi`. Tutorial chapter 5 adds `if`/`then`/`else` and `for`. An `if` adds three blocks. The block that computes the condition ends in a conditional `br` to a `then` block or an `else` block. Both of those end in a `br` to a merge block, and the merge block starts with a `phi` that picks the value from whichever branch ran. The tutorial builds that `phi` by hand. Watch for one detail in section 5.2.5. Emitting the `then` expression can create blocks of its own, for a nested `if`, so the `phi` must name the block the builder is in after emitting it, `Builder->GetInsertBlock()`, and not the block where `then` started.

The `for` loop runs its body before it tests the end condition, so it has the shape of a C `do`/`while`. The body always runs at least once. Its loop variable is a `phi` at the top of the loop block, like `%i` in step 1's `ipow`.

Tutorial chapter 7 adds `var`/`in` for local variables and `=` for assignment. Writing `phi` nodes by hand for every assignment would mean building SSA in the front end. The tutorial takes clang's route from step 1 instead. Every variable, including each function argument, gets an `alloca` in the function's entry block. Reads become `load` and writes become `store`. `PromotePass`, which is `mem2reg`, joins the pass list and turns the slots back into SSA values with `phi` nodes. `mem2reg` only promotes an `alloca` that sits in the entry block and is used only by plain loads and stores. The tutorial's helper `CreateEntryBlockAlloca` puts every slot there.

The examples in tutorial chapter 7 use operators that its chapter 6 lets the user define: `def binary : 1 (x y) y;` makes `:` a sequencing operator that evaluates both sides and returns the right one. You skip tutorial chapter 6, so make `:` built in. Give it precedence 1 in `BinopPrecedence` and have `BinaryExprAST::codegen` return `R` for it. The chapter 7 code also mentions `tok_binary`, `tok_unary` and token numbers from tutorial chapter 6. Leave those out. Your token numbers can differ.

This step also times compiled code against clox. In chapter 11 you timed `fib(35)` in clox with `test/benchmark/fib.lox` and in Lua. You run the same function in your JIT and in C.

### Study

- [Kaleidoscope, chapter 5: Extending the Language: Control Flow (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/tutorial/MyFirstLanguageFrontend/LangImpl05.html) (do, 2 h): Sections 5.1 to 5.3, with 5.4 as the listing. The `opt -passes=view-cfg` command in 5.2.4 opens a window, which the VM does not have. Use `dot-cfg` as in the build below.
- [Kaleidoscope, chapter 7: Extending the Language: Mutable Variables (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/tutorial/MyFirstLanguageFrontend/LangImpl07.html) (do, 2 h): Sections 7.1 to 7.7, with 7.8 as the listing. Section 7.3 explains why the tutorial uses `alloca` plus `mem2reg`. Read it slowly and compare its examples with your `funcs.m2r.ll` from step 1.

### Build

1. Tutorial chapter 5. Check `def foo(x) if x < 10 then 0 else 1; foo(9); foo(11);` prints 0 and then 1.
2. Before running them, write down how many stars `printstar(100)`, `printstar(1)` and `printstar(0)` print with the definition from section 5.3. Then run them.
3. Run `./toy -O0`, copy the IR for `printstar` and for a function with a nested `if` into `opt/cfg.ll`, and run `opt -passes=dot-cfg -disable-output opt/cfg.ll` in an empty directory. List it with `ls -a` to find the `.dot` files, install `graphviz`, and render them with `dot -Tpng`. Open the images on the Mac.
4. Time `fib(35)` three ways, on the VM: in your release build of clox with `test/benchmark/fib.lox`, in your JIT with `def fib(x) if x < 3 then 1 else fib(x-1)+fib(x-2);` and `clockd()` before and after, and in C with `double fib(double x)` built with `clang -O2`. Write the three times in `NOTES.md`.
5. Tutorial chapter 7, with `:` built in and `=` at precedence 2 as section 7.6 sets it.
6. Write `fibi` from section 7.4 without the `def binary` line, and check `fibi(10)`.
7. Run the `printstar` calls from build task 2 again on the chapter 7 version. Its loop variable now lives in an `alloca`. The star counts must match the chapter 5 version. Compare `printstar`'s IR under `-O0` and with passes on, and find the `phi` that `mem2reg` made.

### Done when

The `if` test prints 0 and 1, and your star-count predictions matched, or you can explain each miss from the `for` loop's IR. Your CFG image of the nested `if` shows the merge block with two predecessors, and you can say why its `phi` names the block that `GetInsertBlock()` returned. `fibi(10)` prints 55. Both versions of `printstar` print the same counts. `NOTES.md` has the three `fib(35)` times and two sentences on where the gap between clox and your JIT comes from.

## Object files for Linux and the Mac

Tutorial chapter 8 swaps the JIT from step 4 for a file. You look up a target by its triple, the `<arch>-<vendor>-<sys>-<env>` string that names a platform, such as `aarch64-unknown-linux-gnu` in the VM. A `TargetMachine` made from that target knows the CPU, the data layout and how to emit code. `addPassesToEmitFile` runs the code generator over the module and writes an object file. Instruction selection picks ARM64 instructions for each IR instruction, and register allocation maps the unlimited SSA values onto 31 general-purpose and 32 floating-point registers. The code generator still runs on LLVM's older pass manager, and tutorial chapter 8 includes `LegacyPassManager.h` for it.

Make this a second program, `src/ksc.cpp`, copied from your `toy.cpp` as it stands after tutorial chapter 7. It has no JIT, reads a whole file from standard input into one module, and writes `output.o` at the end. The tutorial's chapter 8 listing drops the optimization passes. Keep yours, or every variable stays an `alloca` slot in the object file. Create the `TargetMachine` before parsing, and set the module's target triple and data layout when you create the module, as the JIT version did with `TheJIT->getDataLayout()`.

`InitializeAllTargets` and the related calls link every backend into `ksc`. With all of them present, `ksc` can produce code for any target, and you use that to build an object file for the Mac from the VM. On the Mac, `clang -print-target-triple` prints its triple. Pass that string to `ksc`. The result is a Mach-O object file, the Mac format from chapter 05, with every symbol name given a leading underscore. `clang` on the Mac links it, and Apple's toolchain is all the Mac needs.

The language also gets two features that are yours. Unary minus becomes the `fneg` instruction, emitted with `Builder->CreateFNeg` and parsed in `ParsePrimary` when the current token is `-`. A `>` operator uses `Builder->CreateFCmpUGT`, next to the `CreateFCmpULT` that `<` uses, followed by the same `uitofp`. Give `>` precedence 10 in `BinopPrecedence`, the same as `<`. Both instructions have entries in the LangRef from step 1. Add both features to `toy.cpp` and to `ksc.cpp`.

The 23.1.0 prose in 8.2 to 8.4 passes a `std::string` where the API wants a `Triple`. `sys::getDefaultTargetTriple()` returns a `std::string`, and `setTargetTriple`, `lookupTarget` and `createTargetMachine` take a `Triple`, so those snippets do not compile. Copy the listing in 8.7, which writes `Triple(TargetTriple)`, and do the same with the string from `-target`.

Build task 8 asks you to read floating-point code. Doubles do not use the x registers. The first double argument is in d0, the second in d1, up to d7, and a double result leaves in d0. `fadd`, `fmul`, `fdiv` and `fneg` act on d registers. The full rule is in sections 6.1.2 and 6.8.2 of the AAPCS64 reference from chapter 05, the SIMD and floating-point material that chapter told you to skip.

### Study

- [Kaleidoscope, chapter 8: Compiling to Object Code (LLVM 23.1.0)](https://releases.llvm.org/23.1.0/docs/tutorial/MyFirstLanguageFrontend/LangImpl08.html) (do, 1 h): Sections 8.1 to 8.6, with 8.7 as the listing. Section 8.6 links a C++ caller. You link a C caller instead, with `extern double average(double, double);` in place of the `extern "C"` block. The `--libs all` build line from 8.6 links every LLVM library.

### Build

1. `ksc` with the command line `./ksc [-S] [-O0] [-target <triple>] < prog.ks`. It writes `output.o`, or `output.s` with `-S` (use `CodeGenFileType::AssemblyFile`). `-O0` skips your passes. The default triple is `sys::getDefaultTargetTriple()`.
2. Unary minus and `>`. Add `-x`, `x - -y`, `3 > 2` and `2 > 3` to a new `tests/ops.ks` and check them through `toy`.
3. `tests/newton.ks`:

```
def newton_sqrt(x)
  var g = x / 2 in
    (for i = 0, i < 20 in g = (g + x / g) / 2) : g;

def absdiff(a b) if a < b then -(a - b) else a - b;
```

4. `tests/main.c` declares both functions, computes `newton_sqrt` for 2, 10, 1000000 and 0.25, compares each with `sqrt` from `<math.h>` using `absdiff`, prints PASS or FAIL per value with a relative tolerance of 1e-12, and returns 1 on any failure.
5. In the VM: `./ksc < tests/newton.ks && clang tests/main.c output.o -lm -o newton && ./newton`.
6. In the VM: `./ksc -target <the Mac's triple> < tests/newton.ks`. On the Mac, in the shared directory: `clang tests/main.c output.o -o newton && ./newton`.
7. Run `nm` and `objdump -d` on the Linux object in the VM. Run them on the Mac object on the Mac, in the shared directory, or use `llvm-objdump -d` in the VM, since GNU `objdump` cannot read an arm64 Mach-O file. Compare the symbol names and the instructions of `newton_sqrt`, and explain each difference you find.
8. Build `output.s` for Linux with and without `-O0`. In the optimized loop of `newton_sqrt`, mark the `fdiv` instructions and the `d` registers that hold `x` and `g`. In the `-O0` version, find the stack loads and stores that the `alloca` slots became. Compare the optimized version with the ARM64 you wrote by hand in chapter 05.
9. Write `LANGUAGE.md`: the grammar, every operator with its precedence, the built-in `:`, unary minus, what a `for` loop returns, and what the language does not have.

### Done when

`./newton` prints four PASS lines on Linux and on the Mac from objects that `ksc` built in the VM. `nm` shows `newton_sqrt` in the ELF object and `_newton_sqrt` in the Mach-O object. You can point at the instructions that carry the arguments in and the result out of `newton_sqrt` and name the registers the ARM64 calling convention assigns them. `tests/ops.ks` gives the values you expect, and `LANGUAGE.md` describes the language your compiler accepts.

## Where this leads

You can now read LLVM IR, including the `alloca` and `phi` patterns that clang and rustc produce. You wrote a front end that emits SSA IR, you ran LLVM's passes and watched which pass changed what, and you sent the same IR through a JIT and through the code generator into object files for two operating systems. The C++ you learned covers the tutorial and not much more. You also measured how much an interpreter loop costs against compiled code for one recursive function.

Chapter 13, Software rendering, starts the part on graphics and games and goes back to the window of chapter 06. Your CHIP-8 front end ran one SDL loop that polled input, ran the machine and pushed a 64 by 32 texture to the screen 60 times a second. Chapter 13 splits that loop into a platform layer and a game function the platform calls once per frame, then loads the game as a shared library that you rebuild and reload while it runs. On that base you write a rasterizer in C that computes every pixel of a 960 by 540 frame from triangles and a camera. Its inner loops run millions of times per frame. Reading the IR and the assembly clang makes for them, and checking which loops the vectorizer from chapter 07 handled, uses what you practiced in this chapter.
