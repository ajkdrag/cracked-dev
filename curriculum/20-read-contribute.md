---
id: 20
title: Reading real code and contributing
part: Storage, networks and real codebases
weeks: 6
project: A bug fix or a missing test sent to Valkey as a review-ready pull request, after a traced path from socket to reply, then small ports to C++, Zig and Odin checked against your own C.
---

Chapter 19 ended with your key-value store running in three processes that agree on every write through Raft, tested by a simulator that crashes nodes and splits the network. You wrote every line of it, and of the chapter 18 store under it, so you can find anything in them in seconds. This chapter is about code you did not write. A **code base** is the whole body of source code of one project, and the one you read here is large: Valkey has about 165,000 lines of C in `src/*.c`, 180,000 with the headers, grown since 2009.

Valkey is a production key-value server, a store behind an event loop like yours at a much larger scale. It was **forked** from Redis 7.2.4 in 2024: its developers copied that release of the Redis server and continued it as a separate project, keeping most of Redis's file and function names. Valkey takes pull requests on GitHub and its tests are easy to run.

The chapter has three parts, all done in Ubuntu under WSL2 with every checkout under `~/code`:

- Steps 1 to 5 read Valkey. You build and test it at a fixed version, map its files, follow one command from the socket to the reply, then follow the bytes into the parser and the key into memory and onto the disk.
- Steps 6 and 7 change it. You write a test that shows a real bug, or one that covers a path no test covers, fix what needs fixing and send it as a pull request.
- Review on a busy project takes weeks. Steps 8 to 10 fill them with three languages, each read inside real code and each checked against C you already have. C++ comes first, because chapter 21 writes CUDA, which is C++. Zig comes next, read through TigerBeetle, a database that allocates all its memory at startup. Odin comes last, with an allocator that travels with every call and arrays whose memory layout is one keyword.

## Build and test Valkey at a pinned tag

A large code base needs three things before you read a line of it: a fixed version, a build you can debug, and a test you can run. Without them, the line numbers in your notes go stale and the debugger shows nothing useful.

A **tag** is a name that git gives to one commit, and projects tag each release. Checking out a tag **pins** your copy: every file and line number stays as it was at that release. git calls this state a **detached HEAD**, because you are on a commit and not on a branch. This chapter pins Valkey 9.1.3.

Valkey builds with `make`, which you met in chapter 05. Its Makefile has a target `noopt` that compiles with `-O0`, the flag from chapter 01 that turns optimization off. gdb then shows every variable and every call. The Makefile picks its own compiler, `cc`, which is gcc on Ubuntu. Leave that choice alone in a project you contribute to.

> **Practice:** Write the tag and the commit next to every line number in your notes. A line number without a version is wrong as soon as the project moves on.

Valkey has two kinds of tests:

- **Integration tests** live in `tests/` and are written in **Tcl**, a small scripting language. A script called `./runtest` runs them. Each test starts real servers and talks to them over a socket.
- **Unit tests** live in `src/unit/` and are C++ files built on **GoogleTest**, Google's C++ test library. They link the C code directly and call its functions.

A test from `tests/unit/type/string.tcl` looks like this:

```tcl
start_server {tags {"string"}} {
    test {SET and GET an item} {
        r set x foobar
        r get x
    } {foobar}
}
```

`start_server` starts a fresh server for the block. `r` sends one command to it and returns the reply.

The braces after the test body hold the expected result of the body's last command. `assert_equal`, `assert_match` and `assert_error` from `tests/support/test.tcl` check values in the middle of a test. You do not need more Tcl than this. Copy the shape of the tests around the one you add.

A unit test is a C++ function written with a macro. `TEST_F(SdsTest, TestSds)` defines a test named `TestSds` in a group `SdsTest`, and `ASSERT_TRUE(cond)` stops the test when `cond` is false. The C headers come in through an `extern "C"` block, which turns off C++ name mangling, as in chapter 12.

### Study

- [Valkey README at 9.1.3](https://github.com/valkey-io/valkey/blob/9.1.3/README.md) (reference, as needed): "Building Valkey using `Makefile`" for the build options and test targets, and "Fixing build problems with dependencies or cached build options" when you change options or check out another version.

### Build

1. Install Tcl with `sudo apt install -y tcl`. Clone with full history and pin the tag:

   ```sh
   cd ~/code
   git clone https://github.com/valkey-io/valkey.git
   cd valkey
   git switch --detach 9.1.3
   make noopt -j$(nproc)
   ```

   `-j` runs that many compile jobs at once, and `nproc` prints the number of CPU cores. The build ends with the line `Hint: It's a good idea to run 'make test' ;)`.
2. Start a server with `./src/valkey-server --port 7777 --save ""`. `--save ""` turns off the background snapshots to disk. The log warns that memory overcommit is disabled. That warning is about those snapshots, so ignore it. From a second terminal, run `./src/valkey-cli -p 7777` and type `SET greeting hello`, `GET greeting` and `INCR counter`.
3. Stop the server with Ctrl-C. Run `./runtest --single unit/type/string`. It starts its own servers and prints `[ok]` for each test, then "All tests passed without errors!".
4. Read `tests/README.md` in your checkout, then run `./runtest --help`. Find `--single`, `--only`, `--stop` and `--dont-clean` and write one line on each.
5. Break a test on purpose. In `tests/unit/type/string.tcl`, change the expected `{foobar}` of "SET and GET an item" to `{foobaz}`, run `./runtest --single unit/type/string --only "SET and GET an item"`, and read the `[err]` line. Then undo the change with `git checkout tests/unit/type/string.tcl`.
6. Install GoogleTest with `sudo apt install -y libgtest-dev libgmock-dev`, then run `make test-unit UNIT_TEST_PATTERN='SdsTest.*'`. The first run builds every unit test, which takes a few minutes. Open `src/unit/test_sds.cpp` and read the first test. It uses only C you know.

> **If it fails:** If `./runtest` stops with "unix socket path too long", the checkout sits in a directory with a long path. The harness puts a socket file inside the checkout, and Linux limits socket paths to 107 characters. Move the checkout to `~/code/valkey`.

### Done when

`./runtest --single unit/type/string` passes on your build. You broke and repaired a test and can say what its `[err]` line told you. `make test-unit UNIT_TEST_PATTERN='SdsTest.*'` prints "All UNIT TESTS PASSED!".

## Map the source

A build tells you nothing about where things are. The map comes from Salvatore Sanfilippo, who created Redis. In 2015 he added a tour of the source to the Redis README, and it stayed there through Redis 7.2.4, the version Valkey forked from. The tour names the files, the central structs and dozens of functions.

![The Valkey checkout by directory: src holds the server, tests the Tcl integration tests, src/unit the C++ unit tests, deps the libraries Valkey vendors and utils the scripts. Inside src, each group of files has one job.](figures/20-source-map.svg)

Most names in the tour still exist in Valkey. Some moved to other files and some were renamed. Three git commands find both kinds:

- `git grep -n 'activeExpireCycle('` lists every line in the checkout that contains the text, with file and line number. Searching for the name followed by `(` finds the definition and the calls. This is also how you open any function quickly: run it, then open the file at that line in your editor.
- `git log -S 'redisObject' --oneline` lists the commits that added or removed that text. It finds the commit that renamed a struct.
- `git log -L :setKey:src/db.c` shows every change to one function, newest first.

`git log -S` reads the whole history, which is why the last step cloned without `--depth`. Parts of the tour are eleven years old, so checking names against the tree is the exercise of this step. You check 25 of them, enough to learn the layout without spending a week on lookups.

### Study

- [Salvatore Sanfilippo: Redis internals, in the Redis 7.2.4 README](https://github.com/redis/redis/blob/7.2.4/README.md#redis-internals) (read, 30 min): From "Redis internals" through "server.c", then "Other C files". Leave "commands.c" through "Anatomy of a Redis command" for the next step, which assigns the same README again on purpose. Read `redis` as `valkey` and `struct redisObject` as `struct serverObject`.
- [Scott Chacon and Ben Straub: Pro Git, 7.5 Git Tools: Searching](https://git-scm.com/book/en/v2/Git-Tools-Searching) (read, 20 min): All of it: "Git Grep", "Git Log Searching" and "Line Log Search". The git project's website publishes Pro Git as its book.

### Build

1. Write `map.md` in your notes. Pick 25 names from the "server.h" and "server.c" sections of the tour: structs, globals and functions. For each, write its file and line at 9.1.3, found with `git grep -n`.
2. When a name is gone, find the new name and the commit that changed it with `git log -S`, and write down the commit's first line.
3. Pick one function from your map and run `git log -L` on it. Write down how many commits changed it and what the oldest one did.
4. Run `wc -l src/*.c | sort -n | tail -10` for the ten largest files in `src/`, and write one sentence for each. Take the sentence from the tour, or from the comment above the file's first large function when the tour has none. Most files open with the license, not a description.

### Done when

`map.md` has 25 names with a file and line at 9.1.3. At least four of them moved or changed, and each has the commit that did it. Given any name in your map, you can find its definition with `git grep -n` and open it in your editor within a minute.

## One command from socket to reply

The map gives you places. A **trace** gives you the order in which a request visits them. Pick one command, `SET`, and follow it from the moment its bytes arrive on a socket to the moment the reply leaves. You run the server under gdb, stop it at the functions the tour names, send the command from `valkey-cli`, and read the **backtrace**, the list of calls that led to the stop, which chapter 01 showed you with `bt`.

Valkey runs one event loop in one thread by default, the same design as your chapter 08 server. Here is what happens to one `SET k v`:

![SET k v arrives on the socket. The event loop sees the descriptor readable, the parser cuts the RESP bytes into arguments, the command table finds setCommand, setKey stores the value and addReply puts +OK in the client's reply buffer. Before the loop waits again, beforeSleep calls handleClientsWithPendingWrites, which writes the reply to the socket.](figures/20-set-path.svg)

- **The event loop.** `ae.c` is the loop. `aeProcessEvents` waits in `aeApiPoll`, which `ae_epoll.c` implements with `epoll_wait`, as your `loop_wait` did. When the client's descriptor is readable, the loop calls the handler registered for it, `readQueryFromClient`.
- **The parser.** `readQueryFromClient` reads the bytes into a query buffer. `processInputBuffer` cuts them into arguments, `c->argv`, where `c` is the struct that holds everything about one client.
- **The command table.** Once the parser has a whole command, `processInputBuffer` calls `prepareCommandQueue`, which looks the first argument up in the **command table** with `lookupCommand`. The table has one entry per command. The entry for `set` names the function `setCommand` and an **arity** of -3, which means "at least 3 arguments", and `commandCheckArity` checks it. `processCommand` then rejects the command if either check failed, checks permissions and memory, and `call` runs the function.
- **The keyspace.** `setCommand` calls `setGenericCommand`, which calls `setKey` in `db.c` to store the value.
- **The reply.** `addReply` copies `+OK\r\n` into the client's **reply buffer**, `c->buf`, and puts the client on a list of clients with pending output. Nothing is written yet.
- **The write.** Before the loop waits again, it calls `beforeSleep`, which calls `handleClientsWithPendingWrites`, which writes each pending reply to its socket.

The command table is generated. Each command has a JSON file in `src/commands/`, and `utils/generate-command-code.py` turns them all into `src/commands.def`. Search that file for `MAKE_CMD("set",` to see the entry. Three entries match, because Sentinel and `CONFIG` also have a `set`. Yours is the one that names `setCommand`.

This is the backtrace gdb printed at `setKey` for this chapter, trimmed to function, file and line:

```
#0  setKey                         db.c:420
#1  setGenericCommand              t_string.c:146
#2  setCommand                     t_string.c:266
#3  call                           server.c:3915
#4  processCommand                 server.c:4656
#5  processCommandAndResetClient   networking.c:3972
#6  processInputBuffer             networking.c:4299
#7  readQueryFromClient            networking.c:4412
#8  callHandler                    connhelpers.h:79
#9  connSocketEventHandler         socket.c:301
#10 aeProcessEvents                ae.c:486
#11 aeMain                         ae.c:543
#12 main                           server.c:7797
```

Frame 0 shows the line gdb stopped at. Every other frame shows the line inside that function where it made the call to the frame above. `call` starts at `server.c:3840` and calls `setCommand` at line 3915, so look for a definition with `git grep -n`, not at the line in the backtrace. Frames 8 and 9 are Valkey's connection layer. It lets the same code run over plain TCP sockets and over other kinds of connection, such as encrypted ones.

### Study

- [Salvatore Sanfilippo: Redis internals, in the Redis 7.2.4 README](https://github.com/redis/redis/blob/7.2.4/README.md#commandsc) (read, 30 min): The rest of the tour from the last step: "commands.c" through "object.c", then "Anatomy of a Redis command". Skip "replication.c" and "Script". You read "Other C files" in the last step.

### Build

1. Start the server under the debugger. `gdb --args` passes the rest of the line to the program as its arguments:

   ```sh
   gdb --args ./src/valkey-server --port 7777 --save ""
   ```

   Set breakpoints on `readQueryFromClient`, `processCommand`, `setKey` and `handleClientsWithPendingWrites`, then `run`. Send `SET k v` from `valkey-cli`. At each stop, type `bt`, save the output, and `continue`.
2. Write `trace.md`: every function on the path from the readable socket to the write of `+OK`, with file and line at 9.1.3 and one sentence each. Compare it with the backtrace above and with the figure. Note where `setGenericCommand` adds the reply relative to `setKey`, and which frame calls `handleClientsWithPendingWrites`.
3. Find the `set` entry in `src/commands.def` and the file in `src/commands/` it came from. In `trace.md`, write which fields of the entry are checked before `call` runs, and in which function each check happens.

### Done when

`trace.md` lists the full path with file and line numbers, and your saved backtraces agree with it. You can say which function decides that `SET k` with no value is an error, and from which field of the command table entry.

## Bytes on the wire: RESP and the query buffer

The trace started where `readQueryFromClient` got control. This step looks at the bytes it reads and how the parser copes with them. The client and the server speak **RESP**, the Redis serialization protocol, which Valkey keeps. A client sends every command as an array of **bulk strings**, each a length followed by that many bytes. `SET k v` arrives as 27 bytes:

```
*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$1\r\nv\r\n
```

`*3` says three elements follow. `$3` says the next string has three bytes. `\r\n` ends each line.

TCP delivers a stream of bytes with no message boundaries, as chapter 18 showed you from the inside. So one command can arrive split across two reads, and one read can hold several commands. Sending several commands without waiting for the replies is called **pipelining**, and clients do it on purpose to save round trips. The parser has to handle both cases.

`readQueryFromClient` does not read into a buffer of the client's own. It reads into one 16 KB buffer that all clients of the thread share, `thread_shared_qb` in `networking.c`, so idle clients hold no buffer at all. When a read ends in the middle of a command, the client keeps that buffer as its own `c->querybuf`, and the thread allocates a new shared one. The arguments parsed so far wait in `c->argv`.

The query buffer is an **sds**, the string type from `sds.c`. Your chapter 04 string kept its length in a struct next to the pointer. An sds keeps a small header in memory right before the characters and hands out a pointer to the characters:

![An sds string: a small header with the length, the allocated size and a flags byte sits right before the characters. The sds pointer points at the first character, so it also works as a char * for C functions, and s[-1] is the flags byte.](figures/20-sds.svg)

The pointer works as a `char *` for any C function, and the string still knows its length. The flags byte at `s[-1]` says which header comes before it. Its low 3 bits pick one of five header types, from one byte for short strings to 17 bytes, so the length and size fields grow with the string. `sds.h` defines the types as `SDS_TYPE_5` to `SDS_TYPE_64` and the headers as `struct sdshdr8` and so on. The type is chosen when the string is allocated, from its size, so a 16 KB buffer holding seven bytes still has the header of a 16 KB string.

### Study

- [Valkey: Serialization protocol specification](https://valkey.io/topics/protocol/) (read, 40 min): "Network layer" and "Request-Response model", then "RESP protocol description" from "Simple strings" through "Nulls", then "Sending commands to a Valkey server", "Multiple commands and pipelining" and "Inline commands". Skip the RESP3 types from "Booleans" to "Attributes".

### Build

1. Write `split.py`, a Python script that connects to port 7777 and sends `SET split hello` in RESP in two parts: everything up to `$5\r\nhel`, then a 20-second sleep, then `lo\r\n`. Then it reads and prints the reply. Use Python's `socket.create_connection` and `sendall`. The sleep is long because the server stops at each breakpoint, and the second part must arrive after you have typed `continue`, or one read gets both parts.
2. Run the server under gdb with breakpoints on `readQueryFromClient`, `processInputBuffer` and `processCommand`. At each stop on `processInputBuffer`, print the buffer with `p c->querybuf`, whether it is the shared one with `p c->querybuf == thread_shared_qb`, and the parsed arguments so far with `p c->argc`. Run `split.py` and count the stops of each function.
3. Add three `PING` commands sent in one `sendall` to the end of the script, and count again.
4. At a stop on `processInputBuffer`, print the flags byte with `p ((unsigned char *)c->querybuf)[-1] & 7`. Look the number up in the `SDS_TYPE_` lines of `src/sds.h`, then print the whole header by casting to the matching struct. For type 2, that is `p *(struct sdshdr16 *)(c->querybuf - 5)`, because that header is 5 bytes. Check that `len` equals the number of bytes in the buffer, and compare `alloc` with the 16 KB of the shared buffer.

### Done when

You can say how many times `readQueryFromClient`, `processInputBuffer` and `processCommand` ran for the split `SET` and for the three pipelined `PING` commands, and why. You can say what the query buffer held at the second stop of the split `SET`, whether it was still the shared buffer at each stop, and where the arguments parsed from the first read were kept in the meantime. For one real query buffer you can name its header type, read its `len` and `alloc` from the header, and say why the type does not depend on the bytes in it.

## Where a key lives: memory and the disk

`setKey` stored the value. This step follows it into memory and then onto the disk, and compares both with what you built.

In memory, the keys of a database live in `hashtable.c`, reached through `kvstore.c`. The tour says `dict.c`, which held the keyspace until Valkey 8.1 replaced it with a table of 64-byte buckets, one cache line each:

![One bucket of Valkey's hash table fills one 64-byte cache line: a byte of flag bits, one byte of hash for each of the seven entries, and seven entry pointers. A lookup compares the top byte of the key's hash with all seven stored bytes at once and follows a pointer to compare the full key only where they match.](figures/20-bucket.svg)

Your chapter 07 SIMD hash table kept a control byte per slot for the same reason: a lookup compares the stored byte first and rarely compares a full key. On x86-64 Valkey even uses the same SSE2 compare and mask that you used. The study item explains the design by counting memory accesses per lookup, the way chapter 07 taught you to count them.

On disk, Valkey can keep an **append-only file**, AOF for short, which is a log of every write command. It is the same idea as your chapter 18 log, with commands instead of records. The setting `appendfsync` decides when Valkey calls fsync on it:

- `always`: after every batch of write commands, before the replies go out.
- `everysec`: once per second, on a background thread. This is the default, and a crash can lose up to a second of writes.
- `no`: never. The kernel writes the data when it chooses.

Valkey calls fsync through a macro, `valkey_fsync`, defined in `src/config.h`. It runs its slow work, such as these background fsyncs, on helper threads in `bio.c`, short for background I/O.

![Where the fsync of the append-only file runs. Under always, the main thread writes and syncs the file in beforeSleep and only then sends the replies. Under everysec, the main thread writes, sends the replies at once, and hands the fdatasync to the bio_aof thread at most once a second.](figures/20-aof.svg)

### Study

- [Viktor Söderqvist: A new hash table](https://valkey.io/blog/new-hash-table/) (read, 25 min): The whole post. Söderqvist designed `hashtable.c`.
- [Valkey: Persistence](https://valkey.io/topics/persistence/) (read, 20 min): "Append-only file" with "Log rewriting" and "How durable is the append only file?". Skip snapshotting, backups and disaster recovery.

### Build

1. Open `src/hashtable.c` and find the bucket struct, the array of one-byte hashes in it, and the line that computes the byte stored there. In your notes, compare them with your chapter 07 table in five lines: slot count per group, what the stored byte holds, and how a lookup uses it.
2. Find what `valkey_fsync` expands to on Linux in `src/config.h`, and compare it with what you called in chapter 18.
3. Run the server under gdb with the `gdb --args` line from the step "One command from socket to reply", without breakpoints. In `valkey-cli`, run `CONFIG SET appendonly yes`, then `INFO persistence` until it shows `aof_rewrite_in_progress:0`. Turning the AOF on writes a fresh copy of the data first, in a forked child process, and gdb stays with the parent by default.
4. Press Ctrl-C in gdb, add `break fdatasync`, and `continue`. Send `CONFIG SET appendfsync always`, then a `SET`. At the stop, run `info threads` and `bt` and write down the thread name and the function that called `fdatasync`. Then do the same with `CONFIG SET appendfsync everysec`.
5. Under `everysec`, find the function in `src/aof.c` that queued the job for the background thread.

### Done when

Your notes compare Valkey's bucket with your chapter 07 group. You can name the system call behind `valkey_fsync` on Linux, the thread that calls it under `always` and under `everysec`, and the function that hands the `everysec` job to that thread. You can say, from the persistence page, how many seconds of acknowledged writes each setting can lose in a crash.

> **Optional:** Valkey also copies its writes to other servers. A **primary** streams its write commands to **replicas** and does not wait for them before it replies to the client. The [Valkey replication documentation](https://valkey.io/topics/replication/) says that this makes acknowledged writes possible to lose when a replica takes over. Your Raft store waits for a majority before it answers. Read "How Valkey replication works" there, then `replicationFeedReplicas` and `waitCommand` in `src/replication.c`, and write down where your design and Valkey's differ.

## A failing test for a real bug

Now pick something to change. On GitHub, a project's **issues** are its list of reported problems and requests, and a **pull request** is a proposed change that the maintainers review and then merge or decline. Every contribution in this chapter follows the same path:

![The life of a contribution: claim an issue, reproduce it on unstable, write a test that fails, find the cause, fix it, pass the checks, open the pull request, and answer review until it merges. Requested changes go back to the fix as new commits on the same branch.](figures/20-contribution.svg)

This step covers the first row. You have two routes, and both are normal first contributions:

- **A bug fix.** You find an open bug, write a test that shows it, and fix it in the next step.
- **A missing test.** You find a command option you traced that no test sends, and add a test for it. The development guide asks for tests with every change, so the project takes these.

For the bug route, use [Valkey's open, unassigned bugs](https://github.com/valkey-io/valkey/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug%20no%3Aassignee). At the time of writing the list had 44 issues, and many are about Sentinel, cluster, replication or modules. Read 10 of them before you choose. A good first bug for you:

- reproduces on one server, with no cluster, replication or modules
- lives in code you traced. Strings, the options of `SET`, key expiry and the fields of `INFO` are where one-server bugs usually live.
- has no linked pull request
- has a maintainer comment that agrees it is a bug, or shows a reply that is plainly wrong

If none of the 10 fits, take the test-only route. Comment on the issue that you are working on it before you write code. Then reproduce it on `unstable`, the branch where Valkey develops the next release, because a bug fixed there already needs no pull request.

A **regression test** is a test that fails while the bug is present and passes once it is fixed, so the bug cannot come back unnoticed. You write it before the fix. The development guide's "Test coverage" section says where it goes: unit tests for data structure changes, integration tests for commands.

If the issue says the bug is new in some release, `git bisect` finds the commit that brought it in. You mark one commit good and one bad, and git checks out the commit halfway between them. `git bisect run <script>` repeats this by itself and reads the script's exit code: 0 marks the commit good, 1 to 127 marks it bad, and 125 skips it. A commit that does not build must be skipped, not marked bad, or bisect blames the wrong commit:

```sh
#!/bin/sh
make noopt -j$(nproc) > /dev/null 2>&1 || exit 125   # cannot build: skip this commit
~/code/check-bug.sh                                  # your reproduction: exit 0 if right, 1 if wrong
```

### Study

- [Valkey development guidelines](https://github.com/valkey-io/valkey/blob/unstable/DEVELOPMENT_GUIDE.md) (read, 15 min): All of it. The link is to the `unstable` branch on purpose, because you submit against it.
- [Scott Chacon and Ben Straub: Pro Git, 7.10 Git Tools: Debugging with Git](https://git-scm.com/book/en/v2/Git-Tools-Debugging-with-Git#_binary_search) (read, 10 min): "Binary Search", including `git bisect run`. The next step assigns "File Annotation" on the same page.
- [git-bisect manual](https://git-scm.com/docs/git-bisect#_bisect_run) (reference, as needed): "Bisect run" for the exit codes.

### Build

1. Choose your route. On the bug route, read 10 issues from the list above, pick one with the criteria, and comment on it. On the test-only route, pick a `SET` or string command option you traced and run `git grep -n` for it in `tests/unit/type/string.tcl`. If no test sends it, that option is yours.
2. Switch to the newest `unstable` with `git switch unstable` and `git pull`, then run `make distclean` and rebuild with `make noopt -j$(nproc)`. The README section from the first step explains why a changed tree needs `make distclean`. Reproduce the bug with `valkey-cli` or a small script, and write the exact commands and the wrong output into your notes.
3. If the issue says the bug is new in a release, check whether an older tag behaves correctly. If it does, write `check-bug.sh` outside the checkout and the bisect script above, and run `git bisect run` with it.
4. Add a test, in the directory the "Test coverage" section names, next to the tests for the same command or structure. Run it alone with `./runtest --single <file> --only "<test name>"` or with `UNIT_TEST_PATTERN`.

### Done when

On the bug route: your test fails on `unstable`, and the failure message shows the wrong behavior from the issue. An error in the Tcl or C++ of the test itself does not count. The other tests in the same file still pass. Your comment is on the issue. If you used `git bisect`, you have the first bad commit and its pull request.

On the test-only route: your test passes on `unstable`, sends an option no other test sends, and fails when you break the code under test by hand. The other tests in the same file still pass.

## The fix and the pull request

Your test from the last step shows the bug on `unstable`. Find the cause before you write the fix. Put a breakpoint where the wrong value appears and walk back through the backtrace until you find the line that is wrong, the same way you traced `SET`.

Before you change that line, find out why it is there. `git blame` prints, for each line of a file, the commit that last changed it, and that commit's message usually names the pull request and the issue behind it. Valkey reformatted all its C files in 2024, so a plain `git blame` names that formatting commit for most lines. The checkout has a file, `.git-blame-ignore-revs`, that lists such commits, and `git config blame.ignoreRevsFile .git-blame-ignore-revs` tells blame to look past them.

Then make the smallest change that fixes it. A maintainer has to review every line you change. Valkey also **backports** fixes, which means it copies them to the branches of older releases, and a large diff makes that copy conflict. Keep refactoring out of a fix, even where you would write the code differently.

The project checks four things before a person reads your change:

1. Every commit carries a `Signed-off-by` line, which `git commit -s` adds. The line states that you agree to the **Developer Certificate of Origin**, a short statement that you have the right to submit the code. Valkey does not accept anonymous contributors or pseudonyms.
2. The C code is formatted by `clang-format` version 18, and CI fails on any difference. **CI**, continuous integration, is the set of build and test jobs that GitHub runs on every pull request.
3. The CI test jobs pass.
4. An automated review runs first, and you answer or address each of its comments.

The pull request description says what was wrong, how to reproduce it, what you changed and why that is the fix, and how you tested it. Put `Fixes #<issue number>` in it, so that the issue closes when the change merges. You push your branch to a **fork**, your own copy of the repository on GitHub, and open the pull request from there. When a reviewer asks for changes, push new commits to the same branch. The pull request follows the branch.

On the test-only route, skip the first two build items and the fix in the third. The pull request adds your test, and its description says which behavior the test covers and how you checked that it fails when that behavior breaks.

### Study

- [Contributing to Valkey](https://github.com/valkey-io/valkey/blob/unstable/CONTRIBUTING.md) (read, 15 min): "Developer Certificate of Origin", "Use of AI tools", "How to provide a patch or a new feature" through "Submitting a patch", and "Code formatting with clang-format". Skip "Large features" and "Running the daily workflow on demand for your branch". The link is to `unstable` on purpose, because you submit against it.
- [Scott Chacon and Ben Straub: Pro Git, 6.2 GitHub: Contributing to a Project](https://git-scm.com/book/en/v2/GitHub-Contributing-to-a-Project) (read, 30 min): "Forking Projects", "The GitHub Flow" with "Creating a Pull Request" and "Iterating on a Pull Request", then "Keeping up with Upstream" under "Advanced Pull Requests". Skip "Pull Requests as Patches" and "GitHub Flavored Markdown".
- [Scott Chacon and Ben Straub: Pro Git, 7.10 Git Tools: Debugging with Git](https://git-scm.com/book/en/v2/Git-Tools-Debugging-with-Git) (read, 10 min): "File Annotation". You read "Binary Search" on the same page in the last step.

### Build

1. Find the cause with the debugger and write it down in two or three sentences, with the file and line.
2. Set `blame.ignoreRevsFile` as above. Run `git blame -L 120,140 <file>` around the wrong line, with the line numbers changed to yours. Read the commit and the pull request that last changed it, and write one sentence on why the line was written that way.
3. Fix it. Run your new test until it passes, then the whole test file it lives in, then `make test` once. The full suite takes a long time, so start it and do something else.
4. Ubuntu 24.04 ships clang-format 18. Install it with `sudo apt install -y clang-format-18` and run `clang-format-18 -i` on each file you changed, as the contributing guide shows. `git diff` must show only your change afterwards.
5. Fork Valkey on GitHub, add your fork as a remote, and push your branch. Commit with `git commit -s`. Write a commit message whose first line says what the change does and whose body says why.
6. Open the pull request against `unstable` with the description above.
7. Watch CI. When a job fails, read its log, reproduce the failure in WSL2, and push a fix. Answer the automated review.
8. When `unstable` moves on before review, bring your branch up to date as Pro Git shows and rerun your test.

> **If it fails:** Ubuntu's `clang-format-18` is version 18.1.3, and the contributing guide says other versions can format differently. If the format check in CI fails on code that `clang-format-18` left alone, install the exact version the guide pins with `pip install clang-format==18.1.8` inside a Python virtual environment and format again with that one.

### Done when

The pull request is open against `unstable`, links the issue if there is one, and every commit carries your sign-off. CI is green. The description lets a maintainer reproduce the bug and check the fix, or check what the new test covers, without asking you anything. You have answered every review comment so far, or the pull request is merged.

## C++ from below: objects, cleanup and templates

Review takes weeks, and chapter 21 needs C++, because a CUDA kernel is a C++ function. Chapter 12 taught you enough C++ to read LLVM: classes, virtual functions, `std::unique_ptr`, and RAII from Bert Hubert's series. This step looks at the same features from below and adds the ones this book keeps. This book's rule: before you use a C++ feature, read the code it makes the compiler emit.

A **constructor** is a function the compiler calls when an object comes into existence. A **destructor**, written `~Name()`, is a function it calls when the object goes out of scope. A **virtual function** is called through a hidden pointer. Each object of a class with virtual functions starts with a **vptr**, a pointer to a **vtable**, which is a table of function pointers that the compiler builds once per class in read-only data.

![The same struct in C and in C++. In C the object is its two floats, 8 bytes, and nothing else. In C++ with a virtual function the compiler adds a hidden vtable pointer to the object, a vtable in read-only data, a constructor that stores that pointer, and a destructor call at the end of the scope.](figures/20-cpp-adds.svg)

A call through a base pointer, `p->area()`, compiles on x86-64 to two instructions: `mov (%rdi),%rax` loads the vptr, and `jmp *(%rax)` jumps to the first function in the table. The two entries before that slot hold the offset of the base inside the object and a pointer to type information. gcc and clang on Linux follow one layout for all of this, the Itanium C++ ABI.

Destructors give C++ its cleanup pattern, RAII, which you met in chapter 12 under its full name, "resource acquisition is initialization". An object that owns a resource, such as a file or a block of memory, releases it in its destructor. Every way out of the scope then releases it, in reverse order of creation. In C you wrote the same thing by hand in chapter 16's driver init:

![The same function in C and in C++. In C each failure jumps to a label, and the labels undo the steps in reverse order. In C++ each object lives in a scope, and every return that leaves a scope runs that object's destructor on the way back to the caller, the newest object first.](figures/20-raii-goto.svg)

Branimir Karadžić, the author of the bgfx rendering library, calls the subset of C++ this book writes **Orthodox C++**. It leaves out exceptions, run-time type information, streams and the parts of the standard library that allocate. The flags `-fno-exceptions` and `-fno-rtti` turn the first two off.

> **Practice:** Compile every C++ file you write in this chapter with `-Wall -Wextra -fno-exceptions -fno-rtti`, and look at the object code of each new feature once with `nm -C` and `objdump -d -C`.

**Operator overloading** is a function with a special name, which the compiler calls when the operator appears with your types:

```cpp
struct V3 { float x, y, z; };

static inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
static inline V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }

V3 p = origin + dir * t;   // calls operator* then operator+
```

In chapter 12 you only used templates. Writing one takes a `template <typename T>` line in front of a struct or a function. The compiler generates one copy for each type you use it with, which is called **instantiating** it. A struct can also overload `operator[]`, which the compiler calls for `x[i]`:

```cpp
template <typename T>
struct Pair {
    T items[2];
    T &operator[](int i) { assert(i >= 0 && i < 2); return items[i]; }
};

Pair<V3> edge = {};                    // Pair<V3> is generated here
edge[1] = edge[0] + V3{1, 0, 0};      // calls Pair<V3>::operator[]
```

C compiled as C++ breaks in a few predictable places:

- C++ does not convert `void *` to other pointer types without a cast, so every call to your chapter 04 `alloc` needs one.
- `new` is a C++ keyword. The standard C++ headers use it, so your chapter 04 `new` macro breaks them as soon as one is included. Rename the macro.
- Designated initializers must follow the order of the struct's fields.
- `(V3){1, 2, 3}` is a C compound literal, which clang accepts in C++ only as an extension. `V3{1, 2, 3}` is the C++ spelling.

### Study

- [Branimir Karadžić: Orthodox C++](https://bkaradzic.github.io/posts/orthodoxc++/) (read, 15 min): All of it. "What should I use?" is the list of things to leave out.
- [Bert Hubert: Modern C++ for C Programmers, part 1](https://berthub.eu/articles/posts/c++-1/) (read, 15 min): From the start through "So how come C++ std::sort is faster than qsort?". Skip "Strings". It measures `qsort` against `std::sort` and explains the gap with inlining through a template, which you reproduce below. This is the series chapter 12 used.
- [Bert Hubert: Modern C++ for C Programmers, part 6](https://berthub.eu/articles/posts/cpp-6/) (read, 10 min): "Static assert", "constexpr" and "Default parameters, function overloading". Skip everything else.

### Build

1. Write `cpp/buf.cpp` in four pieces:
   1. A struct `Buf` whose constructor `malloc`s `n` bytes into a field `data` and whose destructor frees it.
   2. A function `int use_buf(int n)` that creates a `Buf`, returns -1 when `n < 4`, otherwise passes `b.data` to `void fill(char *, int)`, declared and not defined, and returns `b.data[0]`.
   3. A base `struct Shape` with `virtual float area() const = 0;` and a derived `struct Square` with one float side.
   4. `float area_of(const Shape *p) { return p->area(); }` and a function that builds a `Square` on the stack and calls `area_of`.
2. Compile only, with no inlining, so that every function stays visible: `clang++ -std=c++20 -Wall -Wextra -fno-exceptions -fno-rtti -O1 -fno-inline -c cpp/buf.cpp -o buf.o`. Run `nm -C buf.o` and find the constructors, the destructor, `vtable for Square` and `__cxa_pure_virtual`, which fills the slot of a function with no body.
3. Run `objdump -d --no-show-raw-insn -C -r buf.o`. `-C` demangles names and `-r` shows the relocations, the "fill in this address" notes from chapter 05's linking step. Find the call to `Buf::~Buf()` in `use_buf` and check that both returns reach it. Find the store of `vtable for Square` into the object in `Square::Square(float)`. Find the two instructions of `area_of`.
4. Print `sizeof` of a struct with two floats, with and without one virtual function.
5. Write `checksum_file(path)` twice: in C with `fopen`, `malloc`, `fread` and `goto` cleanup, and in C++ with two small structs `File` and `Mem` whose destructors close and free. Build each with `-Wall -Wextra -g -fsanitize=address,undefined` and run each on an existing file, a missing file and an empty file.
6. Copy `math.c` from chapter 13 to `math.cpp` and compile it with `clang++ -std=c++20 -fno-exceptions -fno-rtti -Wall -Wextra -O2 -c`. Rename the chapter 04 `new` macro wherever `math.cpp` and its headers use it. Fix each error, and note which difference between C and C++ caused it. Then add `operator+`, `operator-` and `operator*` for `V3` and `V4`, and `operator*` for `M4` times `V4` and `M4` times `M4`. Pass `M4` by `const M4 &`. Make the identity matrix `constexpr` and add `static_assert(sizeof(V4) == 16)`.
7. Write `template <typename T> struct Slice` with a pointer, a length and an `operator[]` that asserts the index is in range. Write `template <typename T> Slice<T> push_array(Arena *a, ptrdiff_t n)` on top of your chapter 04 arena. It calls `alloc(a, sizeof(T), alignof(T), n, 0)` and casts the result to `T *`. Call it as `push_array<V4>(&arena, n)`. A function template whose type the compiler cannot work out from the arguments takes the type in angle brackets like this.
8. Push 100,000 random vertices through model, view and projection with the C functions and with the C++ operators, and compare the two output arrays with `memcmp`. Build both with `-ffp-contract=off`. With the `-mfma` flag of chapter 07 on, clang may otherwise fuse a multiply and an add into one `vfmadd` instruction in one build and not the other. A fused multiply-add rounds once instead of twice, so the outputs can differ in the last bit.
9. Sort one million random `float` depth keys with `qsort` and with `std::sort` and a lambda, and time both with your chapter 07 repetition tester. A **lambda** is a function written inline at the call, here `[](float a, float b) { return a < b; }`. Compile the tester's `.c` file with clang as C, put its declarations in an `extern "C"` block in your `.cpp` file, and link the two objects. Build with `-O2 -g`. In gdb, break on your `qsort` comparison function and read the backtrace to see who calls it. Then find `std::__introsort_loop` in `objdump -d -C` and check whether its loop calls anything to compare two keys.

### Done when

You can point at the destructor call, the vptr store and the indirect jump in your disassembly and say which line of C++ produced each. The two `sizeof` values differ by 8, and you can say what the extra 8 bytes hold. Both versions of `checksum_file` print the same result for the three files, and the sanitizers, LeakSanitizer included, report nothing. The `memcmp` of the C and C++ vertex outputs returns 0. You have the minimum times for `qsort` and `std::sort` and can point to the call that explains the difference: glibc's `qsort` calls your comparison through a function pointer once per comparison, and `std::sort` has the comparison inlined.

> **Optional:** Disassemble `m4_mul_v4` from the C build and `operator*(const M4 &, V4)` from the C++ build with `objdump -d --no-show-raw-insn -C`, and check that they compile to the same instructions apart from their names. Also note why this style avoids `std::vector`: a vector that grows past its capacity moves its elements and leaves every pointer into the old storage dangling, as your chapter 02 growable array did, and the move is hidden inside `push_back`.

## Zig and static allocation in TigerBeetle

C++ kept your C and added to it. Zig, Andrew Kelley's language, replaces C instead. It has no hidden control flow and no hidden allocation. This step ports a piece of your chapter 18 store to Zig, then reads how TigerBeetle, a database for financial transactions in about 150,000 lines of Zig, allocates all its memory at startup.

Zig shows every cost in the code:

- Errors are values. A function that can fail returns `!T`, an **error union**: either an error or a `T`. `try f()` returns the error to the caller if `f` failed.
- `defer x` runs `x` when the scope ends. `errdefer x` runs it only when the scope ends with an error, which cleans up a half-built object.
- A function that allocates takes an `Allocator` as a parameter.

All three in one short file, with a test:

```zig
const std = @import("std");

const Pair = struct {
    keys: []u8,
    vals: []u8,

    fn init(allocator: std.mem.Allocator, n: usize) !Pair {
        const keys = try allocator.alloc(u8, n);
        errdefer allocator.free(keys); // runs only if a later line fails
        const vals = try allocator.alloc(u8, n);
        return .{ .keys = keys, .vals = vals };
    }
};

test "init frees what it allocated when it fails" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 1 });
    try std.testing.expectError(error.OutOfMemory, Pair.init(failing.allocator(), 16));
}
```

`std.testing.allocator` reports every block a test forgot to free, with the line that allocated it. `FailingAllocator` lets the first `fail_index` allocations succeed and fails the next one, so this test makes the second `alloc` fail. Delete the `errdefer` line and the test runner reports a leak of `keys`.

![Who chooses the allocator. In C, kd_init takes an Arena *, so its signature fixes the kind of allocator. In Zig, init takes an Allocator, so a test passes the leak-checking allocator, a test sweep passes a failing one, and TigerBeetle passes one that refuses to allocate after startup.](figures/20-zig-alloc.svg)

Your chapter 04 arena was one concrete type. Zig's `Allocator` is an **interface**: a pointer to some state plus a table of four function pointers, `alloc`, `resize`, `remap` and `free`, the same idea as the vtable of the last step.

TigerBeetle's style guide, **TigerStyle**, takes the allocation thinking of chapter 04 further. All memory is allocated at startup and none after, and every loop and queue has a fixed upper bound. `src/static_allocator.zig`, about 80 lines, enforces the first rule. It is an `Allocator` that wraps a parent allocator and holds a state. `Replica.open` in `src/vsr/replica.zig` allocates everything through it, then calls `transition_from_init_to_static`, and from then on every allocation fails an assertion.

Zig has not reached 1.0, and code written for one release often fails to compile on the next. TigerBeetle **pins** its compiler: a script in its `zig/` directory downloads the official Zig 0.14.1 tarball for x86-64 Linux from ziglang.org, checks its SHA-256 checksum and unpacks it into the checkout. You use that compiler for your own code too, so the language reference for 0.14.1 matches everything you compile.

The standard library calls the Build uses, beyond the sample:

- `allocator.alloc(T, n)` and `allocator.free(slice)` allocate and free an array of `n` items. `allocator.create(T)` and `allocator.destroy(ptr)` do the same for one item.
- `@memcpy(dest, src)` copies one slice into another of the same length.
- `std.mem.readInt(u32, bytes[0..4], .little)` and `std.mem.writeInt(u32, bytes[0..4], value, .little)` turn four bytes into an integer and back.
- `std.testing.expectEqual(expected, actual)` and `std.testing.expectError(error.Name, expr)` check values in a test.

### Study

- [Zig 0.14.1 Language Reference](https://ziglang.org/documentation/0.14.1/#Zig-Test) (read, 1.5 h): The sections "Zig Test", "Variables", "Integers", "Arrays", "Pointers", "Slices", "struct", "while", "for", "if", "defer", "Functions", "Errors", "Optionals" and "Memory". Skip the rest, and look up builtins such as `@intCast` and `@truncate` in "Builtin Functions" when the compiler asks for a cast.
- [TigerBeetle: TigerStyle at 0.17.10](https://github.com/tigerbeetle/tigerbeetle/blob/0.17.10/docs/TIGER_STYLE.md) (read, 40 min): "The Essence Of Style" through "Safety", then "Naming Things" and "Off-By-One Errors" under "Developer Experience". Skip "Performance" and "Cache Invalidation".
- [TigerBeetle: Hacking on TigerBeetle at 0.17.10](https://github.com/tigerbeetle/tigerbeetle/blob/0.17.10/docs/internals/HACKING.md) (reference, as needed): "Building" and "Testing" for the build and test commands.

### Build

1. Clone TigerBeetle and fetch its compiler. Clone without `--depth`, because its build reads the git history for the version number:

   ```sh
   cd ~/code
   git clone https://github.com/tigerbeetle/tigerbeetle.git
   cd tigerbeetle
   git switch --detach 0.17.10
   ./zig/download.ps1
   ./zig/zig version
   ```

   `download.ps1` is a shell script and a PowerShell script at once, so it runs on Linux too. `./zig/zig version` prints `0.14.1`.
2. In `~/code/zig-port`, save the sample above as `sample.zig` and run `~/code/tigerbeetle/zig/zig test sample.zig`. Delete the `errdefer` line, run it again and read the leak report.
3. Write `keydir.zig` and port the chapter 18 record frame: `encode` and `decode` with your own CRC-32 over the length and the payload, which must return `0xCBF43926` for `"123456789"`. `decode` returns an error union with `error.Truncated`, `error.TooLong` for a length above the limit your chapter 18 log used, and `error.BadChecksum`. Read and write the header with `std.mem.readInt` and `std.mem.writeInt`, never with a struct.
4. Add a fixed-capacity index from key to file offset with `put`, `get` and `delete`. Keys have a fixed maximum length and are copied into storage the index owns. `init(allocator, capacity)` allocates everything, and no other function allocates. `put` on a full index returns an error. Use `errdefer` in `init` so a failed allocation frees what came before it.
5. Write `test` blocks that use `std.testing.allocator`. Test `decode` with a truncated header, a wrong CRC and a length larger than the buffer. Then write one failing-allocator sweep: a loop over `fail_index` from 0 to the number of allocations `init` makes, checking that each one returns `error.OutOfMemory` and leaks nothing.
6. In the TigerBeetle checkout, build with `./zig/zig build -Drelease`, then run `./tigerbeetle version`. Run one of its tests with `./zig/zig build test -- IOPS`. It prints nothing when the test passes. Find the test it ran in `src/stdx/iops.zig`.
7. Read `src/static_allocator.zig`. In `src/vsr/replica.zig`, find `Replica.open` and list in your notes the allocations it makes before `transition_from_init_to_static`, as far as you can follow them in one sitting.
8. In `keydir.zig`, write your own `StaticAllocator`, modeled on TigerBeetle's. In a test, wrap `std.testing.allocator` in it, call `init`, switch it to static, then run thousands of `put`, `get` and `delete` calls, including a `put` on a full index. Any allocation after the switch fails an assertion and ends the test.

### Done when

`zig test keydir.zig` passes with no leaks reported, including the invalid-data tests, the failing-allocator sweep and the `StaticAllocator` test. You can say why the `errdefer` in your `init` prevents a leak. `./zig/zig build test -- IOPS` passes in your TigerBeetle checkout, and your notes say where `Replica.open` allocates and how `StaticAllocator` makes a later allocation fail.

> **Optional:** Generic code in Zig needs no templates and no macros. A function can take a type as a `comptime` parameter, a value the compiler knows while compiling, and return a new struct type. `IOPSType(comptime T: type, comptime size: u8) type` in `src/stdx/iops.zig` returns a pool with room for exactly `size` items of type `T`. Write `fn Pool(comptime T: type, comptime n: usize) type` that returns a struct with an array of `n` items and a count, with `push` returning `error.Full`, and test it with two types. Separately, TigerBeetle tests its replication protocol with a simulator called the VOPR, which works like your chapter 19 simulator. Run `./zig/zig build vopr -- 123` in the checkout. It prints the settings that seed 123 chose, such as `packet_loss_probability` and `crash_probability`, and ends with `PASSED` and the number of ticks.

## Odin: the context allocator and #soa

Odin is Ginger Bill's language. It stays closer to C than Zig does. An Odin procedure can return several values, and by convention the last one is an error. Two features make Odin worth a step in this book.

The first is the **implicit context**. Every scope has a value named `context` that is passed to every procedure it calls without appearing in their parameter lists. It holds `context.allocator`, `context.temp_allocator`, a logger and a few other fields. `new`, `make` and `append` allocate through `context.allocator` unless you pass another allocator. In C you passed an `Arena *` through every call by hand:

![Passing an allocator down a call chain. In C every function takes an Arena * parameter and hands it on. In Odin, main sets context.allocator once, the context travels with every call without appearing in a parameter list, and make allocates from the arena three calls down.](figures/20-odin-context.svg)

Setting `context.allocator` to an arena in one scope makes every allocation below it come from the arena, including allocations inside libraries.

The second is `#soa`. Chapter 07 made you choose between an array of structs and a struct of arrays, and changing that choice meant rewriting every loop. In Odin, `#soa[dynamic]Pair` stores each field of `Pair` in its own array, and `pairs[i].x0` still indexes it the same way as a plain array of structs:

![The same pairs in two layouts. A plain dynamic array of Pair stores the four fields of each pair together, so a loop that reads only x0 uses one value in every 32 bytes. An #soa dynamic array stores each field in its own array, so the same loop reads x0 values back to back.](figures/20-odin-soa.svg)

Both features together, as the Build uses them:

```odin
package main

import vmem "core:mem/virtual"

Pair :: struct { x0, y0, x1, y1: f64 }
N :: 10_000_000

main :: proc() {
	arena: vmem.Arena
	err := vmem.arena_init_growing(&arena)   // an arena that reserves virtual memory and grows
	ensure(err == nil)
	context.allocator = vmem.arena_allocator(&arena)

	aos := make([dynamic]Pair, 0, N)         // length 0, capacity N, from the arena
	soa := make(#soa[dynamic]Pair, 0, N)     // the same, one array per field
}
```

Odin ships a release every month, and the language and core library change between releases. This chapter uses `dev-2026-11a`, the x86-64 Linux release from the [install page](https://odin-lang.org/docs/install/). Install that one even if a newer one is out, so the code here compiles as written. Odin calls clang to link, which you have had since chapter 00.

### Study

- [Odin: Overview](https://odin-lang.org/docs/overview/) (read, 2 h): From "Hellope!" through "Procedures", then "Basic types", "Advanced types" from "Fixed arrays" through "Structs", "SOA data types" and "Implicit context system" with "Allocators". Skip "Packages" after "import statement", "Foreign system", "Inline assembly" and everything from "Parametric polymorphism" on.
- [Odin core library: mem/virtual](https://pkg.odin-lang.org/core/mem/virtual/) (reference, as needed): The example in "Overview", then `arena_init_growing`, `arena_allocator`, `arena_free_all` and `arena_destroy`. Each entry links to its source in `arena.odin`, which you compare with your chapter 04 arena.
- [Odin core library: time](https://pkg.odin-lang.org/core/time/) (reference, as needed): `tick_now`, `tick_since` and `duration_milliseconds` for the timing loop.

### Build

1. Download the release inside Ubuntu and unpack it into `~/code/tools/odin`. The archive has one top folder, which `--strip-components=1` drops:

   ```sh
   mkdir -p ~/code/tools/odin
   cd ~/code/tools
   curl -LO https://github.com/odin-lang/Odin/releases/download/dev-2026-11a/odin-linux-amd64-dev-2026-11a.tar.gz
   tar xzf odin-linux-amd64-dev-2026-11a.tar.gz -C odin --strip-components=1
   echo 'export PATH="$HOME/code/tools/odin:$PATH"' >> ~/.bashrc
   ```

   The `odin` program must stay next to its `base`, `core` and `vendor` folders. Open a new terminal and run `odin version`.
2. Port the random number generator from your chapter 07 `gen.c` and its uniform mode, and `ReferenceHaversine`, to Odin. `core:math` has `sin`, `cos`, `asin`, `sqrt` and `to_radians`, and `core:fmt` has `printf` with C-style verbs. Build and run with `odin run .` in the directory of your `.odin` files.
3. In `main`, set up the arena and the two arrays as in the sample above, with a capacity of 10 million so that `append` never grows them, and generate the same pairs into both.
4. Compute the average haversine distance over each array, summing in the same order and the same way as your `gen.c`. Print it with 16 decimal places next to the average your C `gen` prints for the same seed and pair count. `core:math` need not round `sin`, `cos` and `asin` the same way as the C library, so expect agreement in the first 12 significant digits and write down how many of the rest match.
5. Write a second loop that reads only `x0` and finds the smallest longitude. Time both loops over both layouts with `core:time`, keeping the minimum of ten runs, and write the four minimum times into one table in your notes. Build with `odin build . -o:speed` for the timings.
6. Free the arena with `arena_free_all`, then read `arena_init_growing` and the allocation procedure in `arena.odin` and write down two differences from your chapter 04 arena.

### Done when

Both layouts print the same average, and it agrees with your C generator in at least 12 significant digits. Your table has four minimum times, the haversine loop and the `x0` loop on each layout, and you can explain from chapter 07 why the layout matters for one loop more than the other. You can name two differences between Odin's arena and yours.

## Where this leads

You can now take a large C code base you have never seen, build it at a pinned version, map it, trace a request through it in a debugger, find a bug or an untested path in it, and get a change in front of its maintainers in the form they ask for. You also read C++, Zig and Odin well enough to follow real code in each, and you checked that claim by porting code of your own and matching its output against your C. Keep answering review on your pull request until it merges.

Chapter 21, GPU programming with CUDA, takes the C++ of this chapter to a different processor. A CUDA kernel is a C++ function that thousands of GPU threads run at once, and its tile sizes are often template parameters. The chapter runs on your laptop's NVIDIA GPU, from Ubuntu under WSL2. It starts by installing NVIDIA's driver in Windows and the CUDA toolkit inside Ubuntu.

Linux reaches that driver through a device that forwards each call out of the virtual machine, not through a kernel module of the chapter 16 kind. Then you write first kernels and check every launch for errors. Next you measure the card's memory bandwidth with NVIDIA's profiler, the way chapter 07 measured your CPU. Later, reading what the compiler emits, which you did here for constructors, vtables and `std::sort`, becomes reading the GPU's own assembly.
