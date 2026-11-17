---
id: 19
title: Reading real code and contributing
part: Storage, networks and real codebases
weeks: 6
project: A bug fix with a regression test sent to Valkey as a review-ready pull request, after a traced path from socket to reply, then small ports to C++, Zig and Odin checked against your own C.
---

Chapter 18 ended with a key-value store and a TCP stack of a few thousand lines each. You wrote every line, so you can find anything in them in seconds. This chapter is about code you did not write. Valkey, the code base of the first four steps, has about 165,000 lines of C in `src/*.c`, 180,000 with the headers, grown since 2009. You learn to build a code base of that size at a fixed version, find your way around it, follow one request through it with a debugger, and change it in a way its maintainers accept.

Valkey started as the Redis server under another name. It was forked from Redis 7.2.4 in 2024, right before Redis moved to source-available licenses, and it keeps the BSD license and most of Redis's file and function names. Chapter 18 named SQLite, Lua, Redis and TigerBeetle. All four are worth reading, but three of them make an outside fix hard. SQLite is open source and closed to outside contributions. Lua asks you not to send pull requests and takes bug reports on its mailing list. Redis now takes contributions only under a contributor license agreement and its new licenses. Valkey takes pull requests on GitHub with a sign-off line in each commit. TigerBeetle also takes pull requests, and you read it in step 6.

The pull request goes out at the end of step 4. It is a bug fix with a regression test if you find a bug that fits, and a new test on its own if you do not. Step 3 says when to switch. Review on a busy project takes weeks, so you spend that time on three more languages, each read inside real code and each checked against C you already have. Step 5 is C++ in the restricted style of this book's school, which you need again in chapter 20 for CUDA. Step 6 is Zig, read through TigerBeetle, a database built around static allocation. Step 7 is Odin, whose allocators travel in an implicit context and whose `#soa` arrays turn the data layouts of chapter 07 into syntax.

Do the Valkey steps in the Linux VM. Valkey's CI runs on Linux, its unit tests link with a GNU linker feature, and `gdb` in the VM is the debugger chapter 01 set up for Linux. Steps 5 to 7 run on the Mac.

## A pinned build and a map of the source

A large code base needs three things before you read a line of it: a fixed version, a build you can debug, and a test you can run. Pin a release tag, so that every line number you write down stays true. Build without optimization, so that the debugger shows every variable and every call. Run one test file, so that you know the harness works before you need it.

The map comes from Salvatore Sanfilippo, who created Redis. In 2015 he added a tour of the source to the Redis README, and it stayed there through Redis 7.2.4, the version Valkey forked from. The tour names the files, the central structs and dozens of functions. Most of them still exist in Valkey under the same names. Some moved to other files and some were renamed. git finds both kinds:

```
git grep -n 'activeExpireCycle('        where the name appears now
git log -S 'redisObject' --oneline      commits that added or removed the string
git log -L :setKey:src/db.c             every change to one function, newest first
```

`git log -S` needs the full history, so clone without `--depth`. Read the first part of the guide, then check each name it gives against the tree. Parts of the guide are eleven years old, so the check is the first real exercise of this step. You read the rest of the guide in step 2, when you trace a command through the files it describes.

### Study

- [Salvatore Sanfilippo: Redis internals, in the Redis 7.2.4 README](https://github.com/redis/redis/blob/7.2.4/README.md#redis-internals) (read, 30 min): From "Redis internals" through "server.c", then "Other C files". Leave "commands.c" through "Anatomy of a Redis command" for the next step, which assigns the same README again on purpose. Read `redis` as `valkey` and `struct redisObject` as `struct serverObject`.
- [Scott Chacon and Ben Straub: Pro Git, 7.5 Git Tools: Searching](https://git-scm.com/book/en/v2/Git-Tools-Searching) (read, 20 min): All of it: "Git Grep", "Git Log Searching" and "Line Log Search". The git project's website publishes Pro Git as its book.
- [Valkey README at 9.1.3](https://github.com/valkey-io/valkey/blob/9.1.3/README.md) (reference, as needed): "Building Valkey using `Makefile`" for the build options and test targets, "Fixing build problems with dependencies or cached build options" when you change options, and "Integration with IDE" if your editor uses clangd.

### Build

1. In the VM, install Tcl for the test harness with `sudo apt install tcl`. Clone `https://github.com/valkey-io/valkey.git` with full history, then `git switch --detach 9.1.3`. Build with `make noopt -j4`, the Makefile's target for `-O0`.
2. Start a server with `./src/valkey-server --port 7777 --save ""` and talk to it from a second terminal with `./src/valkey-cli -p 7777`: `SET greeting hello`, `GET greeting`, `INCR counter`.
3. Run `./runtest --single unit/type/string`. It starts its own servers and prints `[ok]` for each test.
4. Write `map.md` in your notes. For every struct, global and function named in the sections you read ("Redis internals", "Source code layout", "server.h", "server.c" and "Other C files"), write its file and line at 9.1.3. When a name is gone, find the new name and the commit that changed it with `git log -S`, and write down the commit's first line.
5. Add the line counts of the twenty largest files in `src/` (`wc -l src/*.c | sort -n | tail -20`) and one sentence for each of the ten largest. Take the sentence from the guide's description of the file, or from the comment above the file's first large function when the guide has none. Most files open with the license, not a description.

### Done when

`./runtest --single unit/type/string` passes on your build. `map.md` has a location for every name in the sections you read. At least four names have moved or changed, and each has the commit that did it. Given any function in your map, you can open its definition in your editor in a few seconds.

## One command from socket to reply

The map gives you locations. The trace shows the call path between them. Pick one command, `SET`, and follow it from the moment its bytes arrive on a socket to the moment the reply leaves. Run the server under `gdb`, put breakpoints on the functions the guide names, send the command from `valkey-cli`, and read the backtrace at each stop.

Valkey runs one event loop in one thread by default, the same design as your chapter 08 server. `ae.c` is the loop. `aeCreateFileEvent` registers a handler for a file descriptor, and `aeProcessEvents` waits in `aeApiPoll`, which is `epoll` in `ae_epoll.c` on Linux and `kqueue` in `ae_kqueue.c` on the Mac. That is the same split your chapter 08 loop made. After the file events, the loop runs time events such as `serverCron`. Expect a path of roughly this shape, then correct it with what the debugger shows:

```
aeMain                              ae.c
  aeProcessEvents                   ae.c          waits in aeApiPoll
    connSocketEventHandler          socket.c      the descriptor is readable
      readQueryFromClient           networking.c  read() appends to c->querybuf
        processInputBuffer          networking.c  cuts RESP into c->argv
          processCommandAndResetClient
            processCommand          server.c      lookup, arity, ACL, memory checks
              call                  server.c      runs c->cmd->proc, then propagates
                setCommand          t_string.c
                  setGenericCommand t_string.c    setKey into db.c, addReply
beforeSleep                         server.c      once per loop iteration
  handleClientsWithPendingWrites    networking.c  write() the reply
```

The bytes on the wire are RESP, the protocol in the second study item. A client sends every command as an array of bulk strings, so `SET k v` arrives as `*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n`. TCP gives no message boundaries, as chapter 18 showed you from the inside, so a command can arrive split across two reads, and one read can hold several commands. The parser has to handle both.

The query buffer is an `sds`, the string type from `sds.c`. Your chapter 04 string carried its length in a struct next to the pointer. An sds keeps a small header in memory right before the characters and hands out a pointer to the characters, so the same pointer also works as a `char *` for any C function:

```
         sdshdr8, 3 bytes        the sds pointer points here
  +-------+-------+-------+      |
  |  len  | alloc | flags |      v
  +-------+-------+-------+-----------------------+---------+
                          | h  e  l  l  o  \0     | spare   |
                          +-----------------------+---------+
  s[-1] is the flags byte. Its low 3 bits pick the header type,
  so the header grows from 1 byte to 17 bytes with the string's size.
```

Keys end up in `hashtable.c` through `kvstore.c`. The guide says `dict.c`, which held the keyspace until Valkey 8.1 replaced it with a table of 64-byte buckets. The third study item explains the bucket layout, which follows the same cache-line reasoning as your chapter 07 SIMD hash table. While you read it, compare its one-byte secondary hashes with the control bytes (H2) of your chapter 07 table. Both keep a few bits of each key's hash next to the slots so that a lookup rarely compares a full key.

### Study

- [Salvatore Sanfilippo: Redis internals, in the Redis 7.2.4 README](https://github.com/redis/redis/blob/7.2.4/README.md#commandsc) (read, 30 min): The rest of the guide from step 1: "commands.c" through "object.c", then "Anatomy of a Redis command". Skip "replication.c" and "Script". You read "Other C files" in step 1.
- [Valkey: Serialization protocol specification](https://valkey.io/topics/protocol/) (read, 40 min): "Network layer" and "Request-Response model", then "RESP protocol description" from "Simple strings" through "Nulls", then "Sending commands to a Valkey server", "Multiple commands and pipelining" and "Inline commands". Skip the RESP3 types from "Booleans" to "Attributes".
- [Viktor Söderqvist: A new hash table](https://valkey.io/blog/new-hash-table/) (read, 25 min): The whole post. Söderqvist designed `hashtable.c` and explains its bucket layout by counting memory accesses per lookup, the way chapter 07 taught you to.

### Build

1. Start the server under the debugger: `gdb --args ./src/valkey-server --port 7777 --save "" --appendonly no`. Set breakpoints on `readQueryFromClient`, `processCommand`, `setKey` and `handleClientsWithPendingWrites`, then `run`. Send `SET k v` from `valkey-cli` and save the backtrace at `setKey`.
2. Write `trace.md`: every function on the path from the readable socket to the `write` of `+OK`, with file and line at 9.1.3 and one sentence each. Fix the diagram above where your backtraces disagree with it. Note where `setGenericCommand` adds the reply relative to `setKey`.
3. Write a Python script that connects to port 7777 and sends `SET split hello` in RESP in two parts: everything up to `$5\r\nhel`, then a five-second sleep, then `lo\r\n`. Count how often `readQueryFromClient` and `processCommand` stop, and print `c->querybuf` at each stop. Then send three commands in one `sendall` and count again.
4. Find what `valkey_fsync` expands to on Linux and on macOS in `config.h`, and compare it with what you used in chapter 18. Then turn on the append-only file. Remove the earlier breakpoints with `delete`, run `CONFIG SET appendonly yes`, and wait until `INFO persistence` shows `aof_rewrite_in_progress:0`. The setting starts a rewrite in a forked child, and nothing is fsynced until the rewrite ends. Keep gdb's default `follow-fork-mode parent` so the child is ignored. Press Ctrl-C in gdb, add `break fdatasync`, `continue`, then send a `SET` with `CONFIG SET appendfsync always` and again with `appendfsync everysec`. `valkey.conf` in the checkout documents both settings. Write down which thread makes the call in each mode and which function queued it.
5. Extend `map.md` with the names from the sections you read in this step, "commands.c" through "object.c" and "Anatomy of a Redis command", in the same way as in step 1.

### Done when

`trace.md` lists the full path with file and line numbers, and your saved backtrace agrees with it. You can say how many times `readQueryFromClient` ran for the split `SET` and for the three pipelined commands, and why. You can name the system call behind `valkey_fsync` on each operating system, the thread that calls it under `everysec`, and the function that hands it the job. `map.md` has a location for every name in the sections of the guide you read in steps 1 and 2.

## How Valkey tests itself, and a failing test for a real bug

Valkey has two kinds of tests. Integration tests live in `tests/` and are written in Tcl. Each one starts real servers and talks RESP to them. Unit tests live in `src/unit/` and are C++ files built on GoogleTest. They link the C code directly and call its functions. A test from `tests/unit/type/string.tcl` looks like this:

```tcl
start_server {tags {"string"}} {
    test {SET and GET an item} {
        r set x foobar
        r get x
    } {foobar}
}
```

`start_server` starts a fresh server for the block. `r` sends one command to it and returns the reply. The braces after the test body hold the expected value of the body's last command. `assert_equal`, `assert_match` and `assert_error` from `tests/support/test.tcl` check values in the middle of a test. You do not need to learn Tcl beyond this. Copy the shape of the tests around the one you add.

A unit test is a C++ function written with a macro. `TEST_F(SdsTest, TestSds)` defines a test named `TestSds` in a group `SdsTest`, `ASSERT_TRUE(cond)` stops the test when `cond` is false, and the C headers come in through an `extern "C"` block, which turns off C++ name mangling as in chapter 12. Open `src/unit/test_sds.cpp` and read the first test. It uses only what you already know from C and chapter 12.

`git blame` tells you which commit last touched each line, and that commit's message usually names the pull request and the issue behind it. Reading that discussion before you change a line tells you why the line is there. When a bug appeared between two releases, `git bisect run` finds the commit that brought it in by building and testing about log2(n) commits for you.

Now find a bug to fix. Open issues with the `bug` label are on [Valkey's issue tracker](https://github.com/valkey-io/valkey/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug). Closed issues with the `good first issue` label show you the size of fix that newcomers land. A good first bug for you:

- reproduces on one server, with no cluster, replication or modules
- lives in code you traced: networking, strings, keys, the event loop, a data type
- has no linked pull request and nobody assigned
- has a maintainer comment that agrees it is a bug, or shows a reply that is plainly wrong

Comment on the issue that you are working on it before you write code. If after about four hours of looking nothing fits, switch to the test-only route. Pick a command option you traced and `grep` the test files for it. If no test sends it, a test that does is a contribution the project takes, because the development guide asks for tests with every change. Your pull request in step 4 then adds that test and no fix.

### Study

- [Valkey development guidelines](https://github.com/valkey-io/valkey/blob/unstable/DEVELOPMENT_GUIDE.md) (read, 15 min): All of it. The link is to `unstable` on purpose, because you submit against it. "Test coverage" decides where your test goes: unit tests for data structure changes, integration tests for commands.
- [Scott Chacon and Ben Straub: Pro Git, 7.10 Git Tools: Debugging with Git](https://git-scm.com/book/en/v2/Git-Tools-Debugging-with-Git) (read, 20 min): "File Annotation" and "Binary Search", including `git bisect run`.

### Build

1. Read `tests/README.md` in your checkout, then run `./runtest --help` for the full list of options. You need `--single`, `--only`, `--stop` and `--dont-clean`.
2. Pick one test in `tests/unit/type/string.tcl`. Find the commit that added it with `git log -S` on a string from its body, and read the pull request named in the commit message.
3. Run `git blame -L` on `setGenericCommand` in `src/t_string.c`. Find its oldest line and the newest line, and read both commits.
4. Install GoogleTest with `sudo apt install libgtest-dev libgmock-dev`, then run `make test-unit UNIT_TEST_PATTERN='SdsTest.*'`.
5. Choose your issue with the list above and comment on it.
6. Switch to the newest `unstable`, build it, and reproduce the bug with `valkey-cli` or a small script. Write the exact commands and the wrong output into your notes.
7. If the issue says the bug is new in a release, check whether an older tag behaves correctly. If it does, write a script that builds and exits non-zero on the bug, and run `git bisect run` with it.
8. Add a test that shows the bug, in the directory the development guide's "Test coverage" section names, next to the tests for the same command or structure. Run it alone with `./runtest --single <file> --only "<test name>"` or with `UNIT_TEST_PATTERN`.

### Done when

Your test fails on `unstable`, and the failure message shows the wrong behavior from the issue. An error in the Tcl or C++ of the test itself does not count. The other tests in the same file still pass. Your comment is on the issue. If you used `git bisect`, you have the first bad commit and its pull request.

On the test-only route, your test passes on `unstable`, sends an option no other test sends, and fails when you break the code under test by hand. The other tests in the same file still pass.

## The fix and the pull request

Find the cause before you write the fix. Put a breakpoint where the wrong value appears and walk back through the backtrace until you find the line that is wrong, the same way you traced `SET`. Then make the smallest change that fixes it. A maintainer has to review every line you change, and Valkey also backports fixes to older release branches, where a large diff causes conflicts. Keep refactoring out of a fix pull request, even when you see code you would write differently.

The project checks four things before a person reads your change. Every commit carries a `Signed-off-by` line, which `git commit -s` adds. That line is your statement of the Developer Certificate of Origin, and Valkey does not accept anonymous or pseudonymous contributors. The C code is formatted by `clang-format` version 18, and CI fails on any difference. The CI test jobs pass. An automated review runs first, and you answer or address each of its comments.

The pull request description says what was wrong, how to reproduce it, what you changed and why that is the fix, and how you tested it. Put `Fixes #<issue number>` in it so that the issue closes when the change merges. When a reviewer asks for changes, push new commits to the same branch. The pull request follows the branch.

On the test-only route from step 3, skip the first build item and the fix in the second. The pull request adds your test, and its description says which behavior the test covers and how you checked that it fails when that behavior breaks.

### Study

- [Contributing to Valkey](https://github.com/valkey-io/valkey/blob/unstable/CONTRIBUTING.md) (read, 15 min): The link is to `unstable` on purpose, because you submit against it. "Developer Certificate of Origin", "Use of AI tools", "How to provide a patch or a new feature" through "Submitting a patch", and "Code formatting with clang-format". Skip "Large features" and "Running the daily workflow on demand for your branch".
- [Scott Chacon and Ben Straub: Pro Git, 6.2 GitHub: Contributing to a Project](https://git-scm.com/book/en/v2/GitHub-Contributing-to-a-Project) (read, 30 min): "Forking Projects", "The GitHub Flow" with "Creating a Pull Request" and "Iterating on a Pull Request", then "Keeping up with Upstream" under "Advanced Pull Requests". Skip "Pull Requests as Patches" and "GitHub Flavored Markdown".

### Build

1. Find the cause with the debugger and write it down in two or three sentences, with the file and line.
2. Fix it. Run your new test until it passes, then the whole test file it lives in, then `make test` once. The full suite takes a long time. Start it and do something else.
3. Install `clang-format` 18 as the contributing guide shows, and run it on each file you changed. `git diff` must show only your change afterwards.
4. Fork Valkey on GitHub, add your fork as a remote, and push your branch. Commit with `git commit -s`. Write a commit message whose first line says what the change does and whose body says why.
5. Open the pull request against `unstable` with the description above.
6. Watch CI. When a job fails, read its log, reproduce the failure in the VM, and push a fix. Answer the automated review.
7. When `unstable` moves on before review, bring your branch up to date as Pro Git shows and rerun your test.

### Done when

The pull request is open against `unstable`, links the issue if there is one, and every commit carries your sign-off. CI is green. The description lets a maintainer reproduce the bug and check the fix, or check what the new test covers, without asking you anything. You have answered every review comment so far, or the pull request is merged.

## C++ as C with a few things

Chapter 12 taught you enough C++ to follow the LLVM tutorial: classes, virtual functions, references, `std::unique_ptr` and the use of templates. Step 3 added GoogleTest. Chapter 20 is CUDA, and CUDA kernels are C++. This step settles which parts of C++ you write yourself.

The school this book follows writes C++ as C with a few additions. Branimir Karadžić, the author of the bgfx rendering library, calls it Orthodox C++. His page is a list of things to leave out: exceptions, RTTI, the C++ wrappers for C headers such as `<cstdio>`, streams, any part of the standard library that allocates, heavy template metaprogramming and modules. The things you keep are this chapter's choice. You keep operator overloading for math types, function overloading, references where they remove a pointer, `constexpr`, `static_assert` and small templates. You have read compiler output since chapter 05, so add one rule of your own: before you use a feature, read the code it emits.

Operator overloading is a function with a special name. The compiler calls it when the operator appears with your types:

```cpp
struct V3 { float x, y, z; };

static inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
static inline V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }

V3 p = origin + dir * t;   // calls operator* then operator+
```

In chapter 12 you only used templates. Writing one takes a `template <typename T>` line in front of a struct or a function, and `T` stands for a type inside it. A struct can also overload `operator[]` as a member function, which the compiler calls for `x[i]`. The compiler generates one copy of the struct or function for each type you use it with. A function template whose type the compiler cannot deduce from the arguments takes the type in angle brackets at the call:

```cpp
template <typename T>
struct Pair {
    T items[2];
    T &operator[](int i) { assert(i >= 0 && i < 2); return items[i]; }
};

template <typename T>
T zero() { return T{}; }

Pair<V3> edge = {{zero<V3>(), zero<V3>()}};   // Pair<V3> and zero<V3> are generated here
edge[1] = edge[0] + V3{1, 0, 0};             // calls Pair<V3>::operator[]
```

Compiling your C as C++ breaks in a few predictable places. C++ does not convert `void *` to other pointer types without a cast, so every call to your chapter 04 `alloc` needs one. `new` is a C++ keyword, so the chapter 04 `new` macro needs another name. Designated initializers must follow the order of the struct fields. Compound literals such as `(V3){1, 2, 3}` are a C feature that clang accepts in C++ only as an extension, and `V3{1, 2, 3}` is the C++ spelling. A `std::vector` that grows past its capacity moves its elements and leaves every pointer into the old storage dangling, the same as the growable array you wrote in chapter 02. That hidden move is one reason this style avoids it.

Floating point needs one flag for a fair comparison. On ARM64, clang may fuse a multiply and an add into one `fmadd` instruction, which rounds once instead of twice. Whether it fuses can depend on how the expression is written. Compile both versions with `-ffp-contract=off` when you compare their outputs bit for bit.

### Study

- [Branimir Karadžić: Orthodox C++](https://bkaradzic.github.io/posts/orthodoxc++/) (read, 15 min): All of it. Read "What should I use?" for the list of things to leave out. The subset you keep is the one in the prose above.
- [Bert Hubert: Modern C++ for C Programmers, part 1](https://berthub.eu/articles/posts/c++-1/) (read, 15 min): From the start through "So how come C++ std::sort is faster than qsort?". Skip "Strings". It measures `qsort` against `std::sort` and explains the gap with inlining through a template, which you reproduce below. This is the series chapter 12 used, by the founder of PowerDNS.
- [Bert Hubert: Modern C++ for C Programmers, part 6](https://berthub.eu/articles/posts/cpp-6/) (read, 10 min): "Static assert", "constexpr" and "Default parameters, function overloading". Skip everything else.

### Build

1. Copy `math.c` from chapter 13 to `math.cpp` and compile it with `clang++ -std=c++20 -fno-exceptions -fno-rtti -Wall -Wextra -O2`. Rename the chapter 04 `new` macro wherever `math.cpp` and its headers use it. Fix each error, and note what kind of difference between C and C++ caused it.
2. Add `operator+`, `operator-` and `operator*` for `V3` and `V4`, and `operator*` for `M4` times `V4` and `M4` times `M4`. Pass `M4` by `const M4 &`. Make the identity matrix `constexpr` and add `static_assert(sizeof(V4) == 16)`.
3. Write `template <typename T> struct Slice` with a pointer, a length and an `operator[]` that asserts the index is in range. Write `template <typename T> Slice<T> push_array(Arena *a, ptrdiff_t n)` on top of your chapter 04 arena. It calls `alloc(a, sizeof(T), alignof(T), n, 0)` and casts the result to `T *`. Call it as `push_array<V4>(&arena, n)`.
4. Push 100,000 random vertices through model, view and projection with the C functions and with the C++ operators, both built with `-ffp-contract=off`. Compare the two output arrays with `memcmp`.
5. In Compiler Explorer, which you used in chapter 02, compile `m4_mul_v4` as C and `operator*(const M4 &, V4)` as C++ with `armv8-a clang` at `-O2`. Compare the instructions.
6. Sort one million random `float` depth keys with `qsort` and with `std::sort` and a lambda, timed with your chapter 07 repetition tester. Find the call to the comparison function in the `qsort` path and show that the `std::sort` loop has none.

### Done when

The `memcmp` of the C and C++ outputs returns 0. The two transform functions compile to the same instructions apart from their names. You have the minimum times for `qsort` and `std::sort` and can point to the instruction that explains the difference. For each C++ feature you used, you can say in one line what code it produced.

## Zig, read through TigerBeetle

Zig is Andrew Kelley's language. It is a C replacement with no hidden control flow and no hidden allocation. A function that allocates takes an `Allocator` as a parameter. Errors are values in the return type, written `!T`, and `try` passes an error up to the caller. `defer` and `errdefer` run cleanup when a scope ends, `errdefer` only when it ends with an error. `?T` is an optional that must be unwrapped, often with `orelse`. A function can take types as `comptime` parameters and return a new type, which is how Zig writes generic code in place of templates or macros.

Zig is not at 1.0, and code written for one release often fails to compile on the next. TigerBeetle pins its compiler: the download script in its `zig/` directory fetches Zig 0.14.1 into the checkout, and the build uses only that one. You use the same compiler for your own code in this step, so the language reference for 0.14.1 matches everything you compile.

TigerBeetle is a database for financial transactions, about 150,000 lines of Zig. Its style guide, TigerStyle, takes the allocation thinking of chapter 04 further. All memory is allocated at startup and none after. Every loop and queue has an upper bound. Functions assert their arguments, return values and invariants, at least two assertions per function on average. No function is longer than 70 lines. Read the style guide, then four places in the code where the static allocation rule shows:

```
src/static_allocator.zig     an Allocator that refuses to allocate after startup
src/stdx/iops.zig            a fixed pool of N items, generic over the item type
src/message_pool.zig         init_capacity allocates every message up front
src/vsr/replica.zig          Replica.open: allocates through StaticAllocator, then
                             calls transition_from_init_to_static
```

`static_allocator.zig` is about 80 lines, and it shows how a Zig allocator is built: a struct with a state, and a table of four function pointers (`alloc`, `resize`, `remap`, `free`) that every caller goes through. Your chapter 04 arena was one concrete type with no function table. Zig's `Allocator` is an interface, so any allocator can stand behind the same parameter.

### Study

- [Zig 0.14.1 Language Reference](https://ziglang.org/documentation/0.14.1/#Zig-Test) (read, 3 h): The sections "Zig Test", "Variables", "Integers", "Operators" (only the table, for `+%` and `-%`), "Arrays", "Pointers", "Slices", "struct", "enum", "union", "switch", "while", "for", "if", "defer", "Functions", "Errors", "Optionals", "Casting", "comptime" through "Generic Data Structures", and "Memory". Skip the rest, and look up builtins such as `@ptrCast` and `@intFromPtr` in "Builtin Functions" when you meet them.
- [TigerBeetle: TigerStyle at 0.17.10](https://github.com/tigerbeetle/tigerbeetle/blob/0.17.10/docs/TIGER_STYLE.md) (read, 40 min): "The Essence Of Style" through "Safety", then "Naming Things" and "Off-By-One Errors" under "Developer Experience". Skip "Performance" and "Cache Invalidation", and stop at the end of "Off-By-One Errors".
- [TigerBeetle: Hacking on TigerBeetle at 0.17.10](https://github.com/tigerbeetle/tigerbeetle/blob/0.17.10/docs/internals/HACKING.md) (reference, as needed): "Building" and "Testing" for the build and test commands. It also describes the review process, if you send TigerBeetle a fix later.

### Build

1. On the Mac, clone `https://github.com/tigerbeetle/tigerbeetle.git`, `git switch --detach 0.17.10`, run `./zig/download.ps1` as the hacking guide says (it is also a shell script), then `./zig/zig build -Drelease` and `./tigerbeetle version`.
2. Run `./zig/zig build test -- IOPS` and find the test it ran in `src/stdx/iops.zig`.
3. Read the four places above. In your notes, list every allocation `Replica.open` makes before `transition_from_init_to_static`, as far as you can follow it in one sitting, and explain how `StaticAllocator` makes a later allocation fail.
4. In a directory of your own, write `keydir.zig` with TigerBeetle's compiler, `../tigerbeetle/zig/zig`. Port the chapter 18 record format: `encode` and `decode` with your own CRC-32, which must return `0xCBF43926` for `"123456789"`. Add a fixed-capacity in-memory index from key to file offset with `put`, `get` and `delete`. Keys have a fixed maximum length and are copied into storage the index owns. `init(allocator, capacity)` allocates everything, and no other function allocates.
5. Write your own `StaticAllocator`, modeled on TigerBeetle's. In a test, wrap `std.testing.allocator` in it, call `init`, switch it to static, then run thousands of `put`, `get` and `delete` calls, including a `put` on a full index, which returns an error. Any allocation after the switch fails an assertion and ends the test.
6. Write `test` blocks that use `std.testing.allocator`, which reports leaks. Test `decode` with invalid data: a truncated header, a wrong CRC, a length larger than the buffer. Then write one failing-allocator sweep: a loop over `n` from 0 to the number of allocations `init` makes, calling `init` with `std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = n })`, which lets `n` allocations succeed and fails the next. Check that each failure returns `error.OutOfMemory` and leaks nothing.

### Done when

`./zig/zig build test -- IOPS` passes in your TigerBeetle checkout. `../tigerbeetle/zig/zig test keydir.zig` passes with no leaks reported, including the invalid-data tests and the failing-allocator sweep. Your notes say where `Replica.open` allocates and how the switch to static mode works.

## Odin: the context allocator and #soa

Odin is Ginger Bill's language. It stays closer to C than Zig does. Where Zig builds errors into the return type, an Odin procedure returns multiple values, and by convention the last one is an error. Two features make Odin worth a step in this book.

The first is the implicit context. Every scope has a value named `context` that is passed to called procedures without appearing in their parameter lists. It holds `context.allocator` and `context.temp_allocator`. `new`, `make` and `append` allocate through `context.allocator` unless you pass another allocator. Setting `context.allocator` to an arena in one scope makes every allocation below it, including inside libraries, come from the arena. In C you threaded an `Arena *` through every call by hand.

The second is `#soa`. Chapter 07 made you choose between an array of structs and a struct of arrays, and changing that choice meant rewriting every loop. In Odin, `#soa[dynamic]Pair` stores each field of `Pair` in its own array, and `pairs[i].x0` still indexes it the same way as a plain array of structs:

```
[dynamic]Pair          x0 y0 x1 y1 | x0 y0 x1 y1 | x0 y0 x1 y1 | ...
#soa[dynamic]Pair      x0 x0 x0 ...
                       y0 y0 y0 ...
                       x1 x1 x1 ...
                       y1 y1 y1 ...
```

Odin ships a release every month, and the language and core library change between releases. Install the newest monthly release from the [install page](https://odin-lang.org/docs/install/), `dev-2026-11a` at the time of writing, and write down which one you used. Use the Mac build for ARM64.

### Study

- [Odin: Overview](https://odin-lang.org/docs/overview/) (read, 2 h): From "Hellope!" through "Procedures", then "Basic types", "Advanced types" from "Fixed arrays" through "Structs", "SOA data types" and "Implicit context system" with "Allocators". Skip "Packages" after "import statement", "Foreign system", "Inline assembly" and everything from "Parametric polymorphism" on.
- [Odin core library: mem/virtual](https://pkg.odin-lang.org/core/mem/virtual/) (reference, as needed): The example in "Overview", then `arena_init_growing`, `arena_allocator`, `arena_free_all` and `arena_destroy`. Each entry links to its source in `arena.odin`, which you compare with your chapter 04 arena.
- [Odin core library: time](https://pkg.odin-lang.org/core/time/) (reference, as needed): `tick_now`, `tick_since` and `duration_milliseconds` for the timing loop.

### Build

1. Port the random number generator from your chapter 07 `gen.c` and its uniform mode, and `ReferenceHaversine`, to Odin. `core:math` has `sin`, `cos`, `asin`, `sqrt` and `to_radians`, and `core:fmt` has `printf` with C-style verbs.
2. In `main`, create a growing virtual arena and set `context.allocator` to it. Make a `[dynamic]Pair` and a `#soa[dynamic]Pair`, each with a capacity of 10 million so that `append` never grows them, and generate the same pairs into both.
3. Compute the average haversine distance over each array, summing in the same order and the same way as your `gen.c`. Print it with 16 decimal places next to the average your C `gen` prints for the same seed and pair count. `core:math` need not round `sin`, `cos` and `asin` the same way as the C library, so expect agreement in the first 12 significant digits and write down how many of the rest match.
4. Write a second loop that reads only `x0` and finds the smallest longitude. Time both loops over both layouts with `core:time`, keeping the minimum of ten runs, and write the four minimum times into one table in your notes.
5. Free the arena with `arena_free_all`, then read `arena_init_growing` and the allocation procedure in `arena.odin` and write down two differences from your chapter 04 arena.

### Done when

Both layouts print the same average, and it agrees with your C generator in at least 12 significant digits. Your table has four minimum times, the haversine loop and the `x0` loop on each layout, and you can explain from chapter 07 why the layout matters for one loop more than the other. You can name two differences between Odin's arena and yours.

## Where this leads

You can now take a large C code base you have never seen, build it at a pinned version, map it, trace a request through it in a debugger, find a bug or an untested path in it, and get a change in front of its maintainers in the form they ask for. You also read C++, Zig and Odin well enough to follow real code in each, and you checked that claim by porting code of your own and matching its output against your C. Keep answering review on your pull request until it merges.

Chapter 20, GPU programming with CUDA, takes the C++ from step 5 to a different machine. A CUDA kernel is a C++ function that thousands of GPU threads run at once, and its tile sizes are often template parameters. Reading what the compiler emits, which you did for operator overloads and `std::sort` here, becomes reading PTX and SASS. Measuring before you explain, which you did in chapter 07, becomes profiling with NVIDIA's tools.
