---
id: 08
title: Operating systems
part: Performance and the operating system
weeks: 13
project: Six xv6 kernel labs on RISC-V and a scheduling experiment, then a Unix shell, a malloc built on mmap and a nonblocking epoll HTTP server, run at the end inside a container you make by hand.
---

Chapter 07 made your programs fast. You measured them with your own profiler and repetition tester, changed their data layout to suit the caches and wrote vector code for the hot loops. Whenever one of those programs read a file, asked for memory or touched a fresh page, the kernel did work on its behalf, and you saw that work only as a count of page faults or a slower time. In chapter 05 you made a system call by hand, with the call number in rax and the `syscall` instruction. This chapter follows that call into the kernel and out again.

The chapter has two tracks that take turns. The kernel track uses xv6, a small Unix that MIT wrote for teaching, and six labs from MIT's operating systems course. You add system calls, print and change the tables that map a process's memory, handle the timer, change the scheduler, make `fork` copy memory only when it is written, and extend the file system. The user track runs on Linux in your WSL2 Ubuntu. You write a shell, a general-purpose `malloc` and an HTTP server that serves many clients from one thread, and at the end you run your shell inside a container you build from two kernel features.

The tracks feed each other. The shell uses the `fork`, `exec` and pipes you first meet in xv6. The allocator asks the kernel for pages, and by then you have written the kernel code that hands pages out. The server waits on file descriptors whose kernel side you read in the file system steps. The chapter comes before concurrency because a thread is a saved set of registers plus a stack that the scheduler switches between, and here you read the code of that switch and watch it in a debugger.

## xv6 in QEMU

You need a kernel you can read in full and change without fear. Linux has millions of lines. **xv6** is a small Unix kernel that MIT wrote for teaching, about 6,000 lines of C and assembly. It has processes, virtual memory, a file system and a shell, and little else.

xv6 runs on **RISC-V**, an open instruction set used in teaching and in a growing number of chips. It is your third instruction set after x86-64 and ARM64. Your laptop cannot run RISC-V code, so a program runs the whole RISC-V computer in software. **QEMU** is that program.

In chapter 05 you used `qemu-aarch64`, which runs one ARM64 Linux program and hands its system calls to your kernel. `qemu-system-riscv64` goes further. It emulates a whole machine, with a CPU, memory, a disk and a console, and xv6 runs on it as its only kernel.

![On your x86-64 laptop, WSL2's Linux runs qemu-system-riscv64 as an ordinary process, and inside it the emulated RISC-V machine boots the xv6 kernel, which runs the xv6 shell and programs.](figures/08-qemu.svg)

The labs come from 6.1810, MIT's operating systems course, in its Fall 2025 offering. Use that offering for everything: its book (revision 5), its lab pages and its repository belong together. A later offering can rename labs and change tests.

The repository has one git **branch** per lab, each starting from unmodified xv6 plus that lab's tests. You switch between them with `git checkout`. Each lab has a grading script that runs the course's tests, and `make grade` runs all of them for the current branch. The lab pages also talk about Gradescope, `time.txt` and `make zipball`. Those parts are for MIT students, so skip them.

The compiler for xv6 is gcc, in its RISC-V version named `riscv64-linux-gnu-gcc`, because the course's Makefile expects it. Your own Linux programs in this chapter still build with clang. The packages to install:

- `qemu-system-misc`: QEMU for whole machines of several instruction sets, RISC-V among them.
- `gcc-riscv64-linux-gnu` and `binutils-riscv64-linux-gnu`: a cross compiler, assembler and linker that run on x86-64 and produce RISC-V code, like the ARM64 toolchain from chapter 05.
- `gdb-multiarch`: gdb for programs of other instruction sets. You used it for ARM64 in chapter 05.

> **Practice:** Commit after every lab part that passes its tests, and always before `git checkout` of another branch. git refuses to switch branches over uncommitted changes, and a commit is the only undo the labs give you.

> **Practice:** Run `make clean` after every `git checkout` of a lab branch. It deletes the compiled files and the disk image `fs.img` left by the previous branch, which `make` could otherwise reuse in the new one.

### Study

- [6.1810 Fall 2025: Tools](https://pdos.csail.mit.edu/6.1810/2025/tools.html) (reference, as needed): "Debian or Ubuntu" for the package list, and "Installing on Windows", which names WSL 2 with Ubuntu 24.04 as a supported setup.
- [6.1810 Fall 2025: Lab Utilities](https://pdos.csail.mit.edu/6.1810/2025/labs/util.html) (do, 30 min): Only the section "Boot xv6". The exercises below it belong to the next step.
- [6.1810 Fall 2025: Lab guidance](https://pdos.csail.mit.edu/6.1810/2025/labs/guidance.html) (reference, as needed): The difficulty scale at the top, then "Debugging tips": print debugging, `kernel/kernel.asm`, `addr2line` and gdb through `make qemu-gdb`.

### Build

1. Install the tools:

   ```sh
   sudo apt update
   sudo apt install -y git build-essential gdb-multiarch qemu-system-misc \
       gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu
   ```

2. Clone the repository into `~/code`, next to your own project, and enter it:

   ```sh
   cd ~/code
   git clone git://g.csail.mit.edu/xv6-labs-2025
   cd xv6-labs-2025
   ```

3. Run `make qemu`. It builds the kernel and a disk image, then boots xv6, which prints `init: starting sh` and the prompt `$ `.
4. At the xv6 prompt, type `ls`. Press Ctrl-p, which makes the kernel print its list of processes. Leave QEMU with Ctrl-a, then x.
5. Run `git branch -a` to list the lab branches, and `git status` to see that you are on `util`.
6. Run `make grade`. It boots xv6 several times and runs the util tests. They fail, because you have written nothing yet. Read the names of the tests.

> **If it fails:** If `git clone` cannot connect, your network blocks git's own protocol on port 9418. The repository has no https address, so try again on another network, such as a phone's hotspot. You can also clone it on any machine that can connect and copy the whole folder, `.git` included, into `~/code`.

### Done when

xv6 boots to `$ `, `ls` lists its files, Ctrl-p prints at least `init` and `sh`, and Ctrl-a x returns you to your Linux shell. You have seen `make grade` list the util tests. You can say in one sentence what QEMU does here that `qemu-aarch64` did not do in chapter 05.

## Processes and file descriptors

A shell has to start programs, connect their input and output, and wait for them. Chapter 01 showed you that from the outside. The first chapter of the xv6 book shows the system calls that do it, and there are only a few:

- `fork()` creates a copy of the calling process. Both copies return from it. The original, the **parent**, gets the new process's **process ID** (pid). The copy, the **child**, gets 0.
- `exec(file, argv)` replaces the calling process's memory with a program loaded from a file, and starts it. It does not return if it works.
- `exit(status)` ends the calling process.
- `wait(&status)` lets a parent sleep until one of its children exits, and collects its exit status.

![fork makes a child that is a copy of the parent, exec replaces the child's program with ls but keeps its file descriptors, and wait in the parent returns when the child exits.](figures/08-fork-exec.svg)

Chapter 01 called the numbered channels 0, 1 and 2 streams. Their real name is **file descriptor**: a small integer that indexes the process's table of open files. The kernel keeps the real state of each open file, such as which file, whether it was opened for reading, and the **offset**, the position in the file where the next `read` or `write` starts. The process holds only the index. Files, pipes and the **console**, the terminal as the kernel sees it, all sit behind the same `read` and `write`.

![A process's file descriptor table: fds 0, 1 and 2 point at the console, fd 3 at an open file with its offset, fd 4 at the write end of a pipe, all objects the kernel keeps.](figures/08-fd-table.svg)

Two rules connect descriptors to processes. `fork` copies the table, so parent and child refer to the same open files and share their offsets. `exec` keeps the table.

Together the two rules let a shell redirect output. It forks, the child closes fd 1 and opens the output file, and `open` always returns the lowest free number, which is now 1. Then the child calls `exec`. The program writes to fd 1 and never learns where the bytes go.

The util lab has you write five user programs for xv6. xv6 has its own tiny C library, declared in `user/user.h`: `printf`, `strcmp`, `atoi`, `malloc` and one function per system call. There is no `FILE` and no `stdio.h`.

The lab points to K&R for C. Beej's guide from chapter 02 covers the same ground, so skip those pointers. The `memdump` exercise prints raw bytes as integers, characters and pointers, which is chapter 04's material on the bytes of a value.

### Study

- [xv6 book, chapter 1: Operating system interfaces](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=9) (read, 1 h 15 min): Sections 1.1 to 1.4, pages 9 to 19. Figure 1.2 lists every xv6 system call. Read the shell examples slowly, because you write your own shell in the next step. Skip 1.5 and the exercises.
- [6.1810 Fall 2025: Lab Utilities](https://pdos.csail.mit.edu/6.1810/2025/labs/util.html) (do, 8 h): The exercises sleep, sixfive, memdump, find and exec. Skip "Submit the lab" and the optional challenge exercises.

### Build

1. Do the five exercises in order. After each one, run its tests outside QEMU, for example `./grade-lab-util sleep`.
2. Commit after each exercise that passes.

### Done when

`make grade` on the util branch reports every test as OK. You can say, for `find . wc -exec echo hi`, which processes exist while it runs and which process waits for which: the xv6 shell waits for `find`, and `find` forks one child per match, which execs `echo`, and waits for it.

## A shell: commands, redirection and pipes

xv6's `user/sh.c` parses a command line into a tree of commands and runs it with the system calls from xv6 chapter 1. Now you write a shell for Linux with the same core. This step covers commands, redirection and pipes. The next one adds Ctrl-C and background jobs.

Linux's process calls are close to xv6's:

- `execvp(name, argv)` is `exec` that searches `PATH`, so `ls` runs `/usr/bin/ls`.
- `waitpid(pid, &status, 0)` waits for one particular child. Macros decode the status: `WIFEXITED(status)` is true when the child called `exit`, and `WEXITSTATUS(status)` is then its exit code.
- `dup2(old, new)` makes descriptor `new` refer to what `old` refers to. It replaces xv6's trick of closing a descriptor and calling `dup`.

Two library calls read the input. `getline(&buf, &cap, stdin)` reads one line, allocates and grows `buf` as needed, and returns the line's length, or -1 at end of input. Pass the same `buf` and `cap` on every call and free the buffer once at exit. `isatty(fd)` returns 1 when the descriptor is a terminal and 0 otherwise. The shell uses it to decide whether a person is typing, and prints its prompt only then.

A **pipe** is a buffer in the kernel with two descriptors: bytes written to the write end come out of the read end. A pipeline is mostly descriptor bookkeeping. For `ls | grep c | wc -l > out.txt` the shell creates two pipes and three children, and each process closes every pipe end it does not use.

![Which pipe ends each process of ls | grep c | wc -l keeps: ls keeps the write end of pipe A as fd 1, grep keeps the read end of A as fd 0 and the write end of B as fd 1, wc keeps the read end of B as fd 0, and the shell closes all four.](figures/08-pipeline.svg)

A reader sees end of file only when every write end of its pipe is closed, in every process. If the shell forgets to close A's write end, `grep` waits for more input forever and the pipeline hangs.

The read ends matter too. In `cat /dev/zero | head -c 5`, `head` exits after five bytes. The kernel then stops `cat` at its next write with a **signal** called SIGPIPE, a notification whose default action ends the process. That happens only if no process still holds the read end. If the shell kept it open, `cat` fills the pipe, blocks and never exits.

You can watch your shell do all this. Chapter 05 used `strace` to list the system calls of one program. With `-f` it follows every child the program forks, and `-o file` writes the list to a file. The kernel names differ from the library names:

- `fork` appears as `clone`.
- `pipe` appears as `pipe2`.
- `waitpid` appears as `wait4`.
- `execvp` appears as several `execve` calls, one per `PATH` directory until one works.

> **Practice:** Check the return value of every system call. On failure, call `perror("fork")` or similar, which prints your text and the reason the last call failed. A shell that ignores a failed `fork` or `dup2` fails later, somewhere else.

### Study

- [CMU 15-213 Fall 2025: Processes and Multitasking](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/16-processes.pdf#page=39) (read, 45 min): Slides 39 to 46 on reaping, zombies, `wait` and `waitpid`, then slides 53 to 65 on a simple shell. Skip the rest, which repeats xv6 chapter 1. Some examples call `Fork`, a wrapper from the course's `csapp.c` that calls `fork` and exits on error. Call the plain functions and check the return values yourself.
- [Linux man page: strace(1)](https://man7.org/linux/man-pages/man1/strace.1.html) (reference, as needed): Under OPTIONS, `-f` in "Tracing", `-e trace=` in "Filtering" and `-o` in "Output format".

### Build

Write `src/mysh.c` and build it with `sh build.sh mysh`. It must build with no warnings.

1. The loop: print `mysh> ` only when `isatty(0)` returns true, read a line with `getline`, split it into words at spaces and tabs, and print each word on its own line. Stop at end of input. Require `|`, `<`, `>` and `&` to be separate words, which keeps the parser small.
2. Move the words into a chapter 04 arena: allocate the word strings and the argv array from it, and reset it after each line. Remove the word printing.
3. The built-ins `cd` and `exit`. They must run in the shell process itself. Section 1.4 of the xv6 book says why for `cd`.
4. One command: `fork`, `execvp` in the child, `waitpid` in the parent. If `execvp` returns, the child prints `mysh: <name>: not found` to stderr and calls `_exit(127)`. `_exit` ends the process at once. Plain `exit` would also flush the copy of the parent's stdio buffers that `fork` gave the child, so text could be printed twice, and it would run exit-time work such as the sanitizer's leak check a second time. 127 is the exit code shells use for "command not found".
5. Redirection: `< file` on the first command of a line and `> file` on the last. Open the input with `O_RDONLY`. Open the output with `open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644)`. `O_CREAT` creates the file if it does not exist, and `O_TRUNC` empties it if it does. The third argument is needed only with `O_CREAT` and sets the new file's permissions. `0644` is octal: the owner may read and write, everyone else may only read. Draw the descriptor table of the child before you write the code.
6. Pipelines of any length. Draw the pipe ends for three commands as in the figure, then write the code. The shell closes every pipe end after the last fork, then waits for every child.
7. Write `tests/shell.sh`. It feeds each test case to your shell and to the system's `sh` on standard input and compares what the two print:

   ```sh
   mysh=./out/Linux-debug/mysh

   check() {
       printf '%s\n' "$@" | timeout 5 $mysh > got.txt
       status=$?
       printf '%s\n' "$@" | sh > want.txt
       if [ "$status" -ne 124 ] && cmp -s got.txt want.txt; then
           echo "ok    $1"
       else
           echo "FAIL  $1"
       fi
   }

   check 'echo hello'
   check 'ls / | sort | head -3'
   check 'cat < /etc/hostname | tr a-z A-Z'
   check 'ls | grep c | wc -l > out.txt'
   check 'cat /dev/zero | head -c 5 | wc -c'
   check 'nosuchcommand'
   ```

   `check` takes the lines of one case as its arguments, and `printf '%s\n' "$@"` prints each argument on a line of its own. `timeout 5` kills your shell if it runs longer than 5 seconds and then exits with status 124, which `$?` holds right after the pipeline, so a hang counts as a failure. `cmp -s` compares the two files without printing anything and succeeds when they are equal.

8. Trace one pipeline. Build a release binary with `sh build.sh mysh release`, which leaves out the sanitizer's own system calls, then run:

   ```sh
   echo 'cat /dev/zero | head -c 5 | wc -c' |
       strace -f -e trace=%process,pipe2,dup2,close -o trace.txt ./out/Linux-release/mysh
   ```

   `%process` selects the calls that create, run and wait for processes. In `trace.txt`, each line starts with the pid that made the call. Find the two `pipe2` calls, the three `clone` calls, each child's `dup2` and `close` calls, and the line where `cat` is killed by SIGPIPE.

### Done when

`sh tests/shell.sh` passes every case and nothing times out. In `trace.txt` you can point at the line where the shell closes its last pipe end, and say for each child which descriptors it kept.

## Signals, Ctrl-C and background jobs

Your shell runs commands, but Ctrl-C kills the shell along with the command, and a command cannot run in the background. Both need signals.

A signal is a notification the kernel delivers to a process, such as SIGINT when you press Ctrl-C or SIGCHLD when a child exits. A process sets a **disposition** for each signal: the default action, ignore, or a **handler**, a function of its own that runs when the signal arrives. The default action of SIGINT ends the process.

The terminal does not send SIGINT to one process. Every process belongs to a **process group**, and the terminal has one **foreground** process group. Ctrl-C sends SIGINT to every process in it. Children start in the shell's process group, so Ctrl-C reaches the shell and the command it runs. The shell has to survive and the command should die.

![Ctrl-C makes the terminal send SIGINT to every process in its foreground group, the shell and sleep 100, while sleep 200 &, in a process group of its own, gets nothing.](figures/08-signals.svg)

Two rules from signal(7) decide how to do that:

- A child of `fork` inherits all of its parent's dispositions.
- `execve` resets signals that have a handler to the default, but leaves ignored signals ignored.

So if the shell ignores SIGINT, each child must set SIGINT back to the default before it calls `exec`. Otherwise Ctrl-C stops working for every program the shell starts.

A command that ends in `&` runs in the **background**. The shell does not wait for it, and it moves the job's processes into a new process group with `setpgid`, so Ctrl-C at the prompt leaves the job alone. Someone still has to collect a finished job's exit status, which is called **reaping**. A child that has exited but was not reaped stays in the process table as a **zombie**.

The CMU slides reap from a SIGCHLD handler and then spend many slides on the races that creates. A simpler design is enough here. Before each prompt, call `waitpid(-1, &status, WNOHANG)` in a loop and report every background child it returns. `-1` means any child, and `WNOHANG` makes the call return 0 at once when no child has exited. Wait for foreground children by their pids, so the foreground wait never collects a background job.

> **Practice:** A signal handler may call only functions that signal-safety(7) lists as async-signal-safe. `write` is on the list and `printf` is not. Your shell needs no handler, and chapter 11 follows this rule when it adds one to the server.

### Study

- [CMU 15-213 Fall 2025: Exceptional Control Flow](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/17-ecf.pdf#page=21) (read, 1 h 30 min): Slides 21 to 61: signals, process groups, Ctrl-C, handlers, blocking signals and the SIGCHLD races in a shell. Stop before slide 62 (`sigsuspend`). The signal slides use the course's safe I/O functions in place of `write`. Slides 10 to 20 cover exceptions with x86-64 examples, and the system call step covers the same ground on RISC-V.
- [Linux man page: signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html) (reference, as needed): "Signal dispositions" for the fork and execve rules, "Standard signals" for the default action of each signal, and "Interruption of system calls and library functions by signal handlers" when a call fails with EINTR.

### Build

1. Ctrl-C: the shell ignores SIGINT with `signal(SIGINT, SIG_IGN)`. Every child sets SIGINT back to `SIG_DFL` before `execvp`.
2. Background jobs: a trailing `&`. All processes of the job join one new process group whose ID is the first child's pid. `setpgid(pid, pgid)` moves process `pid` into group `pgid`. A `pid` of 0 means the calling process, and a `pgid` of 0 means a group named by that process's own pid. So the first child calls `setpgid(0, 0)` and the parent calls `setpgid(pid, pid)` with that child's pid. Later children of the job use the first child's pid as `pgid` in both calls. Calling it on both sides makes the group exist whichever process runs first.
3. Before each prompt, reap finished children with `WNOHANG`. When `isatty(0)` is true, print `[<pid>]` to stderr for the last process of a job when it starts, and `[<pid>] done` to stderr for each background child the loop reaps. A non-interactive `sh` prints no job notices, so this keeps them out of the compared output.
4. Add one case with three lines to `tests/shell.sh`: `check 'ls | grep c | wc -l > out.txt &' 'sleep 1' 'cat out.txt'`.

### Done when

`sh tests/shell.sh` passes every case, the background one included. By hand, in a terminal: `sleep 100` followed by Ctrl-C returns to the prompt and the shell keeps running. `sleep 100 &` followed by Ctrl-C at the prompt leaves `sleep` running, and `ps -o pid,pgid,stat,comm` shows it in its own process group. After `kill <pid>` from another terminal, the next prompt prints `[<pid>] done` and `ps` shows no process in state `Z`, the zombie state.

## System calls: from ecall to the kernel and back

Your shell makes several system calls for every command line. A system call has to let a program ask the kernel for work without letting the program do that work itself. This step follows one call into xv6 and back.

The CPU runs in one of two modes. In **user mode**, an instruction that touches a device, a page table or another process's memory fails. In **supervisor mode**, the kernel's mode, everything is allowed. A program runs directly on the CPU at full speed, in user mode. OSTEP calls this design limited direct execution.

The only ways into supervisor mode are **traps**. There are three kinds:

- a system call instruction: `syscall` on x86-64, as in chapter 05, and `ecall` on RISC-V.
- a fault, such as a load from an address the program may not use.
- an **interrupt** from a device or the timer, as defined in chapter 06.

Each one switches the CPU to supervisor mode and jumps to an address the kernel chose at boot, its trap handler.

RISC-V has 32 registers. Its calling convention gives them names, as x86-64's does. a0 to a7 carry arguments and a0 carries the result, the jobs rdi, rsi and rax had in chapter 05. xv6 puts the system call number in a7 and the arguments in a0 to a5, and the result comes back in a0. Here is one `write` in xv6:

![write(1, "hi", 2) goes from the user stub's ecall through uservec, usertrap, syscall and sys_write in supervisor mode, and back through prepare_return and userret with sret, with a0 = 2.](figures/08-syscall-path.svg)

This step covers the dispatch in the middle. The entry code has saved the user's registers in the **trapframe**, a page set aside for each process. `syscall` reads the number from the saved a7 and calls a function from a table. The handler reads its arguments from the saved registers with `argint` and `argaddr`, then copies the user's buffer in and checks every address on the way.

A program can pass any pointer, and the kernel must never read or write memory the program could not reach itself. The entry and exit code at the top and bottom of the figure come two steps later.

The lab's sandbox sits at the dispatch point. `syscall` checks a per-process mask before it calls the handler, and `fork` copies the mask to the child. The attack exercise shows what happens when the kernel forgets to zero a page before giving it to another process.

A system call costs more than a function call, because of the mode switch and the saving of registers. You have the tool to measure that from chapter 07.

### Study

- [OSTEP chapter 6: Mechanism: Limited Direct Execution](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf) (read, 1 h): Sections 6.1 to 6.3 and the summary in 6.5. Redraw figures 6.2 and 6.3, the two protocol timelines. Skip 6.4, which belongs to the concurrency chapter. The chapter's measurement homework is the second Build task below.
- [xv6 book, chapter 2: Operating system organization](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=21) (read, 1 h 30 min): All of chapter 2, pages 21 to 29, then sections 4.3 and 4.4 on pages 47 and 48. Stop before 4.5.
- [6.1810 Fall 2025: Lab System calls](https://pdos.csail.mit.edu/6.1810/2025/labs/syscall.html) (do, 10 h): "Using gdb" with its questions, "Sandbox a command", "Sandbox with allowed pathnames" and "Attack xv6".

### Build

1. Commit your util work, run `git checkout syscall` and `make clean`, and do the four parts of the lab in order. Answer the gdb questions in `answers-syscall.txt` before you write any kernel code.
2. In Linux, measure a system call with the repetition tester from chapter 07. Time a loop of `syscall(SYS_getpid)` from `<sys/syscall.h>` and `<unistd.h>`, which always enters the kernel. As the baseline, time a loop of calls to an empty function marked `__attribute__((noinline))` whose body is `__asm__ volatile("");`. clang deletes a call to a function that does nothing, even one it may not inline. `__asm__ volatile("")` is **inline assembly**, assembly text written inside C, here with no instructions at all. `volatile` tells clang to keep the statement, so the function is no longer empty and the call stays. Report the minimum time per call for both, from a release build.

> **If it fails:** If gdb prints `warning: File ".../.gdbinit" auto-loading has been declined`, add the line it suggests, `add-auto-load-safe-path` and the path, to `~/.gdbinit`, as the guidance page says, and start gdb again.

### Done when

`make grade` on the syscall branch reports every test as OK, and `answers-syscall.txt` answers each question. You have a time per system call and per function call from your own machine, and the ratio between them. Without notes, you can draw the path of a `read` from the user stub to `sys_read` and back, naming the file each piece lives in.

## Page tables

In the last step, `sys_write` checked every user address it copied from. That check walks the process's page table, the structure this step covers. Every address a program uses is a **virtual address**. The CPU translates it into a **physical address**, a position in the real memory, on every load and store.

The kernel describes the translation in the page table you met in chapter 07, one per process. It maps each 4096-byte virtual page the process may use to a physical page. RISC-V's Sv39 scheme, which xv6 uses, splits the low 39 bits of a virtual address into three 9-bit indexes and a 12-bit offset. The register `satp` holds the physical address of the root table:

![An Sv39 virtual address splits into L2, L1 and L0 indexes and a 12-bit offset. satp points at the root table, entry L2 points at a middle table, entry L1 at a leaf table, entry L0 at the physical page, and the offset picks the byte.](figures/08-page-walk.svg)

Each table is one page of 512 eight-byte entries. An entry, a **PTE**, holds a physical page number and flag bits:

- V: valid. An entry without V maps nothing.
- R, W, X: the page may be read, written, executed.
- U: user mode may use the page.
- A and D: accessed and dirty, which the hardware sets when the page is used and written.

The lab prints PTEs with their flags, so decode a few by hand. `perm 0x5B` is binary `0101 1011`, which is V, R, X, U and A: program text. `perm 0xC7` is V, R, W, A and D with no U: the trapframe, which only the kernel may touch.

Walking three tables on every memory access would make every load four loads. The CPU caches recent translations in the **TLB**, the translation lookaside buffer, and most accesses hit it. When the kernel changes a PTE, it must flush the stale cached translation with the instruction `sfence.vma`.

A TLB holds a few thousand entries at most, so with 4 KB pages it covers a few megabytes. A program that jumps around a large array misses in the TLB as well as in the caches you measured in chapter 07. A **superpage**, a valid leaf entry one level up, maps 2 MB with a single TLB entry. The last part of the lab adds superpages to xv6.

The lab's second part uses a page table to make a system call cheaper. The kernel maps one read-only page at the address `USYSCALL` in every process and stores the process's pid there, so `ugetpid()` reads it with a plain load and never enters the kernel.

### Study

- [OSTEP chapter 18: Paging: Introduction](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf) (read, 1 h): Sections 18.1 to 18.5. Work the memory trace in 18.5 with a pencil. The chapter first builds a single flat table and shows why it is too large. Its PTE example in figure 18.5 is 32-bit x86, and the xv6 book gives the RISC-V layout. Skip the homework.
- [xv6 book, chapter 3: Page tables](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=31) (read, 2 h): Sections 3.1 to 3.7, pages 31 to 41, with `kernel/vm.c` and `kernel/memlayout.h` open. Figures 3.2, 3.3 and 3.4 are the ones the lab refers to. Skip 3.8 and the exercises.
- [6.1810 Fall 2025: Lab Page tables](https://pdos.csail.mit.edu/6.1810/2025/labs/pgtbl.html) (do, 12 h): All four parts: "Inspect a user-process page table", "Speed up system calls", "Print a page table" and "Use superpages". The lab mentions the RISC-V privileged manual for superpages. The book and the lab hints are enough without it.

### Build

1. Commit, run `git checkout pgtbl` and `make clean`, do the four parts in order and answer the questions about each PTE in the answers file.
2. Before the superpage part, draw on paper the tables `vmprint` prints for `pgtbltest`, with the index of every entry at each level.
3. Do exercise 1 of section 5.6 in the xv6 book here, on this branch, because `vmprint` exists only here. Each lab branch starts from unmodified xv6. Write `user/sbrktest.c`, add it to `UPROGS`, and have it call `kpgtbl()`, then `sbrk(1)`, then `kpgtbl()` again. `sbrk(1)` grows the process by one byte, as xv6 chapter 1 showed. Find the PTE that appeared, decode its flags, and say how much memory the kernel allocated for one byte. Commit before you leave the branch.

> **Optional:** Your x86-64 laptop does the same with four levels instead of three. It translates 48-bit addresses through four 9-bit indexes and a 12-bit offset, the register CR3 holds the root, and Linux calls a 2 MB page a huge page. If you watched Casey's optional video "Four-Level Paging" in chapter 07, this is the layout it showed.

### Done when

`make grade` on the pgtbl branch reports every test as OK. By hand, you can split `0x3fffffe000` (TRAPFRAME) into its three indexes, 255, 511 and 510, and its offset 0, and match them to the last lines of the `vmprint` output. You can say how many page-table pages a process needs that uses one 4 KB page at address 0 and the two pages at the top of the address space.

## RISC-V assembly and the trap entry

The system call step skipped the two ends of the path: the code that runs right after `ecall` and right before the return to user mode. That code is RISC-V assembly, and the traps lab opens with questions about RISC-V assembly, so this step teaches enough of it.

The calling convention works like the x86-64 one from chapter 05: arguments in a0 to a7, the return address in a register, some registers callee-saved. Only loads and stores touch memory, as on ARM64. Instructions are 4 bytes long, but xv6 is built with RISC-V's compressed extension, which encodes common instructions in 2 bytes, so `kernel/kernel.asm` shows both sizes. The instructions you meet:

- `li` and `mv` load a constant and copy a register.
- `addi` adds a constant to a register.
- `addiw` adds a constant and keeps only the low 32 bits of the sum, then fills bits 32 to 63 with copies of bit 31. That is **sign extension**, which keeps a negative 32-bit `int` negative in a 64-bit register.
- `ld` and `sd` load and store 64 bits. `lw` and `sw` do the same with 32 bits.
- `lui` loads a constant, shifted left by 12 bits, into a register.
- `auipc` adds a constant, shifted left by 12 bits, to the pc.
- `jal` jumps to a label and writes the return address into a register, ra unless the instruction names another.
- `jalr` jumps to a register plus an offset and writes the return address into its destination register.
- **Pseudo-instructions** are names the assembler expands into real instructions. `call` becomes `auipc` and `jalr`. `ret` becomes a single `jalr` through ra that saves no return address. `sext.w` becomes `addiw` with a constant of 0, a plain sign extension.

When a trap arrives in user mode, the RISC-V hardware does only a little. It uses a few special registers that only supervisor mode can touch. It saves the user pc in `sepc`, records the old mode in `sstatus` and the cause in `scause`, disables interrupts, switches to supervisor mode and jumps to the address in `stvec`. It does not switch page tables or stacks, and it saves no other registers. The figure shows one `ecall` before and after:

![What the RISC-V hardware does on an ecall from user mode: it copies the user pc into sepc, the old mode into sstatus.SPP and the cause into scause, then jumps to the address in stvec in supervisor mode, and it leaves the 31 general registers and satp alone.](figures/08-trap-hw.svg)

xv6's `uservec` does that work in assembly. It lives in the **trampoline**, a page mapped at the same virtual address in the user and the kernel page tables, so the code keeps running when it switches `satp`. The 32 user registers go into the trapframe page you saw in the page table lab.

The backtrace part walks **frame pointers**. The xv6 kernel is compiled with frame pointers, like your `fib` in chapter 05. Register s0 holds the current frame pointer. The return address sits at s0 minus 8 and the caller's frame pointer at s0 minus 16. That is the same chain as rbp on x86-64, where the saved rbp sits at rbp and the return address at rbp plus 8.

![The RISC-V frame chain: s0 points just above the current frame, the return address is at s0 - 8 and the caller's frame pointer at s0 - 16, which points just above the caller's frame, and so on.](figures/08-frame-chain.svg)

### Study

- [xv6 book, chapter 4: Traps and system calls](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=43) (read, 1 h 30 min): Sections 4.1, 4.2 and 4.5, pages 43 to 49, with `kernel/trampoline.S` and `kernel/trap.c` open. You read 4.3 and 4.4 in the system call step.
- [RISC-V Assembly Programmer's Manual](https://github.com/riscv-non-isa/riscv-asm-manual/blob/main/src/asm-manual.adoc) (reference, as needed): "General registers" for each register's ABI name and whether calls preserve it. "Function Calls" and "A listing of standard RISC-V pseudoinstructions" for `call`, `ret`, `li` and `mv`. Skip the directive and relocation sections.
- [6.1810 Fall 2025: Lab Traps](https://pdos.csail.mit.edu/6.1810/2025/labs/traps.html) (do, 4 h): "RISC-V assembly" and "Backtrace". "Alarm" is for the next step.

### Build

1. Commit, run `git checkout traps` and `make clean`, and answer the assembly questions in `answers-traps.txt`.
2. Write `backtrace`, call it from `sys_pause` and from `panic`, run `bttest`, and check the addresses with `addr2line -e kernel/kernel` as the lab shows. Ubuntu's own `addr2line` reads the RISC-V kernel too.

### Done when

`bttest` prints a backtrace, and `addr2line` turns each address into a line of `kernel/sysproc.c`, `kernel/syscall.c` or `kernel/trap.c`. Your answers file answers each assembly question. Without notes, you can list what the hardware saves on a trap and what `uservec` saves.

## The timer interrupt and the context switch

A process that loops forever never makes a system call, so it never enters the kernel by itself. The kernel still has to take the CPU away from it to run other processes. A timer does that. The kernel sets the timer to raise an interrupt every **tick**, a tenth of a second in xv6, whatever the process is doing.

`usertrap` sees the timer interrupt and calls `yield`, which gives the CPU to another process. Saving one process and resuming another is a **context switch**. xv6 never switches straight from one process to the next. Each process has a **kernel thread**, its own kernel stack and saved registers for the time it runs in the kernel. The old process's kernel thread switches to the CPU's scheduler thread, and the scheduler switches to the next process:

![A timer interrupt in the shell enters its kernel thread, which calls swtch to the CPU's scheduler thread. The scheduler finds cat RUNNABLE and calls swtch into cat's kernel thread, which returns to cat in user mode.](figures/08-context-switch.svg)

Two different sets of registers get saved here:

- The trapframe holds all 32 user registers, because the interrupt can land between any two user instructions.
- `struct context` holds only ra, sp and s0 to s11, the callee-saved registers. The kernel calls `swtch` as an ordinary C function, so the compiler has already saved every caller-saved register it still needs. On x86-64 the same set would be rbx, rbp, r12 to r15 and rsp, the registers chapter 05's functions had to restore.

The scheduler code takes and releases `p->lock`. Read those calls as "only one CPU touches this process at a time" for now. Chapter 09 explains locks.

A process also gives up the CPU when it has to wait. A `read` on an empty pipe cannot return yet, and neither can the shell's `wait` while its child runs. The kernel then calls `sleep`, which marks the process SLEEPING instead of RUNNABLE, xv6's word for ready to run, and switches to the scheduler as `yield` does. The scheduler skips sleeping processes. When data arrives in the pipe or the child exits, the kernel calls `wakeup`, which marks the waiting processes RUNNABLE again.

The alarm part of the lab is a small version of a Unix signal handler. The kernel diverts a process to a user function by changing the saved pc in its trapframe, and `sigreturn` restores the registers saved when the alarm fired. Linux delivers the signals your shell ignored in the same way: it edits the saved user registers before it returns to user mode.

### Study

- [xv6 book, section 6.4 and chapter 8](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=59) (read, 1 h): Section 6.4, "Timer interrupts", on pages 59 and 60. Then sections 8.1 to 8.3 on pages 75 to 77, with `kernel/swtch.S` and `scheduler()` in `kernel/proc.c` open. Stop before 8.4, which the next step reads.
- [xv6 book, chapter 9: Sleep and wakeup](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=81) (read, 1 h): Sections 9.1 to 9.4, pages 81 to 86, with `sleep` and `wakeup` in `kernel/proc.c` and all of `kernel/pipe.c` open. Section 9.1 explains why `sleep` takes a lock. Follow the problem it describes, a wakeup lost between checking a condition and going to sleep, and take the lock details on trust until chapter 09. Stop before 9.5.
- [6.1810 Fall 2025: Lab Traps](https://pdos.csail.mit.edu/6.1810/2025/labs/traps.html) (do, 4 h): "Alarm" with its parts test0 to test3.

### Build

1. Write `sigalarm` and `sigreturn`. Before writing `sigreturn`, list on paper which registers it must restore and where each saved copy lives.
2. Watch one context switch. Run `make CPUS=1 qemu-gdb` in one terminal and `gdb-multiarch` in another, from the repository directory. `CPUS=1` gives QEMU one CPU, so there is one scheduler thread.
3. In gdb, run `break swtch`, then `continue`. At each stop, `bt` shows the caller. Continue until frame #1 is `sched`, a process giving up the CPU.
4. Print `p/x $ra` and `p/x $sp`, the values `swtch` is about to save. a0 holds the address of the process's `struct context`, so keep it with `set $old = (struct context *)$a0`.
5. Run `stepi 29`, which steps through the 14 stores, the 14 loads and the `ret` of `swtch`. `bt` now shows `scheduler`. Print `p/x *$old` and find the `ra` and `sp` you printed before the switch.

### Done when

`make grade` on the traps branch reports every test as OK, `alarmtest` prints passes for test0 to test3, and `usertests -q` prints `ALL TESTS PASSED`. Without notes, you can draw the switch from the shell to `cat` on one CPU, with each `swtch` call and the registers it saves, and say which registers live in the trapframe and which in `struct context`. You can say what happens to the shell's process between its call to `wait` and the exit of its child, naming `sleep`, `wakeup` and the two process states.

## Scheduling policy

The last step showed how xv6 switches between processes. It did not ask which process should run next. That choice is the **scheduling policy**. xv6's `scheduler()` loops over its process table and runs the next process that is ready to run, in the state xv6 calls RUNNABLE, and the timer interrupt takes the CPU back after one tick. Giving each ready process a turn of one time slice is called **round robin**.

OSTEP judges a policy by two numbers per job:

- **Turnaround time**: when the job finished minus when it arrived.
- **Response time**: when the job first ran minus when it arrived.

**First in, first out** (FIFO) runs each job to the end before the next. With three equal jobs of length T, their turnaround times are T, 2T and 3T, and their response times 0, T and 2T. Round robin gives each job a slice in turn. Every job starts almost at once, so response times are near 0, but all three finish near 3T.

![Three equal jobs A, B and C. FIFO runs them one after another and they finish at T, 2T and 3T. Round robin interleaves short slices, all three start at once and all finish near 3T.](figures/08-sched.svg)

A real system does not know how long a job will run. OSTEP's chapter 8 builds the **multi-level feedback queue** (MLFQ), which guesses from behavior: a job that uses its whole slice drops to a lower priority, and a job that gives up the CPU early, such as one waiting for keys, stays high. Linux's scheduler is different in detail and has the same goal.

You test the round robin claim on xv6. This user program forks three children that each run the same loop and print their response and turnaround time in ticks. `uptime()` returns the number of ticks since boot:

```c
#include "kernel/types.h"
#include "user/user.h"

int
main(int argc, char *argv[])
{
  int n = argc > 1 ? atoi(argv[1]) : 100;  // millions of loop iterations per child
  int start = uptime();
  for (int i = 0; i < 3; i++) {
    if (fork() == 0) {
      int first = uptime();
      volatile uint64 sum = 0;
      for (uint64 j = 0; j < (uint64)n * 1000000; j++)
        sum += j;
      printf("child %d: response %d, turnaround %d ticks\n", i, first - start, uptime() - start);
      exit(0);
    }
  }
  for (int i = 0; i < 3; i++)
    wait(0);
  exit(0);
}
```

`volatile` keeps the compiler from deleting the loop, as in chapter 07. The children's lines can interleave, because xv6's `printf` writes one character at a time.

> **Practice:** Change one thing at a time, measure, and put it back. Commit the measurement program before you change the kernel, so `git diff` shows exactly the change you measured.

### Study

- [OSTEP chapter 7: Scheduling: Introduction](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf) (read, 45 min): Sections 7.1 to 7.7 and the summary in 7.10. Skip 7.8, 7.9 and the homework.
- [OSTEP chapter 8: Scheduling: The Multi-Level Feedback Queue](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched-mlfq.pdf) (read, 45 min): Sections 8.1 to 8.6. The homework simulator `mlfq.py` is optional.
- [xv6 book, section 8.4: Code: Scheduling](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=77) (read, 20 min): Pages 77 to 79, with `scheduler()` in `kernel/proc.c` open. Stop before 8.5.

### Build

1. On top of your finished traps work, make a branch with `git checkout -b sched`. Save the program as `user/schedtest.c`, add `$U/_schedtest\` to `UPROGS` in the `Makefile`, and commit.
2. Run `make CPUS=1 qemu` and `schedtest 100`. Raise the argument until the turnaround of every child is at least 15 ticks, about 5 ticks of work per child. When this step was tested, 300 was enough. Run it three times and write the numbers down.
3. In `usertrap` in `kernel/trap.c`, turn off the `yield()` that follows a timer interrupt. Comment out both lines of the `if`, the condition and the call:

   ```c
     // give up the CPU if this is a timer interrupt.
     // if (which_dev == 2)
     //   yield();

     prepare_return();
   ```

   If you comment out only `yield();`, the `if` has no braces, so the next statement, `prepare_return();`, becomes its body. Then only timer interrupts return to user mode and xv6 hangs at boot after `xv6 kernel is booting`. With both lines out, xv6 is FIFO for user processes. Run `schedtest` three times with the same argument and write the numbers down.
4. Still on the changed kernel, run `usertests -q` and watch it stop at the test `preempt`, which needs the timer to take the CPU away from a looping process. Leave QEMU with Ctrl-a x, restore the two lines, and check that `git diff kernel` is empty.

### Done when

You have the response and turnaround times of the three children under round robin and under FIFO. Under round robin, the response times are within a tick or two of 0 and the turnarounds are close to each other. Under FIFO, both step up by about one job length per child. You can explain both patterns with the figure, and say which policy an interactive shell prefers and why.

## Page faults and copy-on-write fork

A page fault is a trap like the others. The CPU raises one when a PTE is missing or invalid, or when its flags forbid the access. On RISC-V, `scause` is 12 for an instruction fetch, 13 for a load and 15 for a store, and `stval` holds the virtual address that failed. The kernel can fix the page table and return to the faulting instruction, which runs again and succeeds.

These are the faults you counted in chapter 07 when a fresh buffer read slower than a reused one. xv6 already does this for **lazy allocation**, when a program grows its memory with `sbrklazy` in place of `sbrk`. The kernel only records the new size of the process, and `vmfault` allocates each page the first time the program touches it.

Copy-on-write fork uses the same mechanism to avoid copying memory in `fork`. Your shell forks and then calls `exec` in the child, which throws the copy away. With **copy-on-write** (COW), `fork` maps the parent's physical pages into the child and clears the W flag in both page tables. Reads work as before. The first write by either process faults, and only then does the kernel copy that one page:

![After fork, the parent's and child's PTEs both point at physical page P, read-only and marked COW, with P's reference count at 2. After the child writes, the fault handler copied P into P', the child's PTE points at P' with W set, and both reference counts are 1.](figures/08-cow.svg)

Three details decide whether your version passes the tests:

- The kernel needs a **reference count** per physical page, the number of page tables that map it, so that `kfree` returns a page only when the last page table drops it.
- Each PTE needs a mark that says "copy on write" as opposed to "read-only". The two RSW bits of a RISC-V PTE are free for the kernel's own use.
- The kernel sometimes writes into user memory without a fault. `copyout` walks the page table in software, so it has to handle COW pages itself.

After changing a PTE, flush the TLB as the page table step described.

Linux implements `fork` this way. It also fills file data and **anonymous memory**, memory that no file backs, lazily through page faults. The `mmap` call in the next step returns at once even for a large region, and you pay a fault the first time you touch each page.

### Study

- [xv6 book, chapter 5: Page faults](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=51) (read, 1 h): Sections 5.1 to 5.5, pages 51 to 54, with `vmfault` in `kernel/vm.c` and its callers in `kernel/trap.c` open. You did exercise 1 of section 5.6 in the page tables step. Skip the other exercises.
- [6.1810 Fall 2025: Lab Copy on-write](https://pdos.csail.mit.edu/6.1810/2025/labs/cow.html) (do, 10 h): The whole page. Follow its plan of attack: `uvmcopy`, `vmfault`, reference counts in `kalloc.c`, then `copyout`.

### Build

1. Commit, run `git checkout cow` and `make clean`, and implement the lab in the order of its plan.
2. Count the copies. Add a counter of COW copies to `struct proc`, and print the pid, the name and the count when a process exits. Run `echo hi` from the xv6 shell and compare the count with the shell's size `p->sz` divided by 4096, its number of pages. Expect a few copies, far fewer than the shell's pages. The shell and its child each write to their stack and some data before the child's `exec` throws its copy away, and after that each page has one owner again. Remove the print before you run the tests.

### Done when

`cowtest` prints `ALL COW TESTS PASSED`, `usertests -q` prints `ALL TESTS PASSED`, and `make grade` on the cow branch reports every test as OK. You can say what happens on a store fault when the page's reference count is 1, and why a write to a text page still kills the process. You can say which writes caused the COW copies you counted for `echo hi`, and why there were so few.

## A malloc on top of mmap

The chapter 04 arena handed out memory by moving a pointer and freed everything at once. A general-purpose **allocator** such as `malloc` has to accept `free` in any order, reuse the freed space and stay fast. It gets its memory from the kernel in large pieces and divides them up itself. On Linux the call for that is `mmap` with `MAP_PRIVATE | MAP_ANONYMOUS`, which returns zeroed, page-aligned memory not backed by any file. You have not read `mmap` inside a kernel, but xv6's `sbrklazy` from the last step is a close cousin: it records a range, and the pages arrive one fault at a time when you touch them.

The CMU slides build the classic design step by step:

- Every **block** starts with a **header**, one word that holds the block's size and a bit that says whether it is allocated.
- In the version on slides 40 to 47, every block also ends with a **footer**, a copy of the header. `free` reads the footer just before its block to find the previous block, and merges with it if it is free. Merging neighbors is **coalescing**, and header and footer together are called **boundary tags**.
- Free blocks link into one or more **free lists**. The links live inside the free blocks themselves, where the payload was.

![One chunk from mmap: an allocated prologue, an allocated block of 48 bytes with its header and footer, a free block of 96 bytes whose next and prev words link it into the free list, and the epilogue header of size 0.](figures/08-malloc-block.svg)

Build this version first. Slides 52 to 56 then drop the footer from allocated blocks to save space. That needs a second bit in each header that records whether the previous block is allocated. Treat it as an optional change once everything else passes.

The slides grow one contiguous heap with `sbrk`. Your heap is a set of **chunks** from `mmap`, which need not touch each other. Give each chunk its own allocated prologue and epilogue, as the slides' "Heap Structure" slide does for the whole heap, and coalescing stops at the chunk edges by itself. Requests above a threshold, say 256 KB, skip the free lists. Map them directly, record the mapping size in the header, and `munmap` them on `free`.

![Two kinds of mapping in the allocator: a chunk of 1 MB holds many blocks between its own prologue and epilogue, and a large request gets a mapping of its own with a 16-byte header, which free hands back with munmap.](figures/08-malloc-chunks.svg)

Align every pointer you return to 16 bytes, as glibc's `malloc` does on x86-64. With a one-word header, four numbers make that work:

- Every block size is a multiple of 16.
- Every header sits 8 bytes before a 16-byte boundary, so the payload after it starts on one. A chunk from `mmap` starts on a page boundary. An 8-byte pad word and the 16-byte prologue put the first header at offset 24 and its payload at 32.
- The smallest block is 32 bytes, because a free block holds a header, the next and prev links and a footer, 8 bytes each.
- A directly mapped block gets a 16-byte header, so its payload starts 16 bytes into its first page.

The page size is 4096 bytes on your machine, which `getconf PAGESIZE` prints. Round chunk sizes with `sysconf(_SC_PAGESIZE)` at run time all the same, so the code needs no change on a machine with larger pages.

`realloc` and `calloc` follow the rules of the malloc(3) page from chapter 02. You read its `realloc` paragraph there, and its `calloc` paragraph adds the third rule:

- `realloc(NULL, n)` acts like `malloc(n)`.
- `realloc(p, 0)` frees `p` in glibc. Yours does the same and returns NULL.
- `calloc(n, size)` must fail when `n * size` overflows. Check with your `mul_size` from chapter 04.

> **Practice:** Write the heap checker before the second feature. An allocator bug corrupts memory that a later call reads, far from the bug, and a checker that runs every 1000 operations finds it close to where it happened.

### Study

- [CMU 15-213 Fall 2025: Dynamic Memory Allocation: Basic Concepts](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/13-malloc-basic.pdf#page=21) (read, 1 h 30 min): Slides 21 to 58: headers, the implicit list, splitting, boundary tags, the four coalescing cases, the heap structure and the top-level code.
- [CMU 15-213 Fall 2025: Dynamic Memory Allocation: Advanced Concepts](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/14-malloc-advanced.pdf#page=7) (read, 45 min): Slides 7 to 21, explicit free lists and segregated lists. Skip slides 22 to 39, the memory-bug catalogue that the sanitizers from chapter 01 already catch.
- [Linux man page: mmap(2)](https://man7.org/linux/man-pages/man2/mmap.2.html) (reference, as needed): The DESCRIPTION for `MAP_PRIVATE` and `MAP_ANONYMOUS`, RETURN VALUE for `MAP_FAILED`, and `munmap` on the same page.

### Build

Write `src/mm.c` with `mm_malloc`, `mm_free`, `mm_calloc`, `mm_realloc` and `mm_check`, and a test driver `src/mmtest.c` that includes it, as chapter 04's programs include `base.c`.

1. Start with one chunk, an implicit free list, first fit, splitting and boundary-tag coalescing, with a footer on every block as on slides 40 to 47.
2. Write `mm_check`, a heap checker. It walks every chunk and fails if a header and footer disagree, if two free blocks are adjacent, if a free block is missing from its list, or if a payload is not 16-byte aligned.
3. Write the driver. It runs a random trace of one million operations with up to 2000 live blocks. Most sizes are below 512 bytes and a few are above the direct-map threshold. Every block is filled with a byte pattern derived from its index, and the driver checks the pattern before each free and each realloc. It calls `mm_check` every 1000 operations. Seed the random generator from the command line so a failing trace can be replayed.
4. Switch to an explicit free list.
5. Add new chunks of at least 1 MB when no free block fits, and map large requests directly.
6. Benchmark the same trace against glibc's `malloc` with your repetition tester from chapter 07, in a release build. Report time per operation and the peak bytes mapped against the peak bytes requested.
7. Try segregated lists by size class, and keep them only if the benchmark says they help.

> **Optional:** Replace the allocator of another program. Build `mm.c` as a shared library that exports `malloc`, `free`, `calloc` and `realloc`, and start a program with `LD_PRELOAD` set to it. A real program also calls `posix_memalign` and may use threads, so expect crashes until you add those.

### Done when

The driver runs one million operations with three different seeds, with `mm_check` passing and no sanitizer reports in a debug build. The benchmark prints times for both allocators and you can explain the gap, either way. You can draw the blocks around a `free` for each of the four coalescing cases.

## Inodes and large files

The kernel track has one lab left, on the file system. Since the first steps you have called `open`, `read` and `write` on files, and the descriptor table showed only the first layer of what sits behind them. A **file system** is a data structure on a disk that the kernel reads and writes in **blocks**, 1024 bytes each in xv6. The xv6 file system has the same parts as larger Unix file systems, in a few C files under `kernel/`. It is built in layers, and each layer uses only the one below it:

![The xv6 file system layers from top to bottom: file descriptor, pathname, directory, inode, logging, buffer cache and disk, each with the job it does.](figures/08-fs-layers.svg)

- The **buffer cache** keeps copies of recently used disk blocks in memory and lets one user change a block at a time.
- The logging layer makes the writes of one system call reach the disk all together or not at all. The next step covers it.
- An **inode** describes one file: its type, its size and the list of its data blocks. Inodes are numbered, and the number names the file inside the file system.
- A **directory** is a file whose data is a list of entries, each a name and an inode number.
- The pathname layer resolves a path such as `/a/b/c` one directory at a time.

An inode lists its data blocks in an array. xv6 keeps 12 direct block numbers and one **indirect block**, a disk block that holds 256 more block numbers. `bmap` maps a block number within the file to a block number on the disk. The lab gives up one direct block for a doubly indirect one, which raises the largest file from 268 blocks to 65,803:

![The inode's addrs array after the lab: addrs[0] to addrs[10] point at data blocks 0 to 10, addrs[11] at an indirect block of 256 block numbers for blocks 11 to 266, and addrs[12] at a double indirect block of 256 indirect blocks for the next 65,536 blocks.](figures/08-inode.svg)

The xv6 code takes locks on buffers and inodes, in `bread` and `ilock`. As in the scheduler, read them as "one user at a time" until chapter 09.

### Study

- [xv6 book, chapter 10: File system](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=89) (read, 1 h 30 min): Sections 10.1 to 10.3 on pages 89 to 92, then 10.7 to 10.10 on pages 95 to 99, with `kernel/fs.c` and `kernel/bio.c` open. Figure 10.3 is the inode diagram the lab refers to. The logging sections are for the next step.
- [6.1810 Fall 2025: Lab File system](https://pdos.csail.mit.edu/6.1810/2025/labs/fs.html) (do, 5 h): "Large files".

### Build

1. Commit, run `git checkout fs` and `make clean`. Before you change `bmap`, write down the mapping from a file block number to `addrs` slots and indirect block indexes for the block numbers 10, 11, 266, 267 and 65,802.
2. Do the large files part, including freeing the double indirect blocks in `itrunc`.

### Done when

`bigfile` prints `wrote 65803 blocks` and `usertests -q` prints `ALL TESTS PASSED`. For block 65,802 you can name the slot in `addrs`, the index in the double indirect block and the index in the indirect block below it.

## The log and symbolic links

Creating a file writes several blocks: the new inode, the directory entry, the bitmap of free blocks. The power can fail between any two of those writes. A crash in the middle leaves the disk inconsistent, for example with a directory entry that names an inode still marked free. xv6 avoids that with a **log**, an area of the disk where a system call's writes go first.

A **transaction** is the group of block writes one system call makes. xv6 commits a transaction in four steps:

1. Write the changed blocks into the log area.
2. Write the log header block with the count of blocks. This one block write is the **commit**: from now on the transaction counts as done.
3. Copy each block from the log to its home location.
4. Write the header again with a count of 0, which empties the log.

![The log protocol on a time line: blocks go to the log, then the header write commits, then the blocks are copied home and the header is cleared. A crash before the commit loses the whole transaction, and a crash after it is repaired by replaying the log at boot.](figures/08-log.svg)

At boot, recovery reads the header. A count above 0 means a committed transaction that may not have reached home, so recovery copies the blocks again. A count of 0 means there is nothing to replay, and a transaction that crashed before its commit leaves no trace. So every system call's writes appear completely or not at all. Each file system call wraps its work in `begin_op()` and `end_op()`, and `end_op` commits.

OSTEP's crash consistency chapter walks through the same protocol for a general file system, with a timeline of every write. Read it first, then read how `kernel/log.c` does it. Chapter 18 of this book builds a write-ahead log for a key-value store on the same principle.

The second part of the lab adds **symbolic links**: a file whose data is a path to another file, which `open` follows. Your `sys_symlink` creates an inode and writes its data, so it runs inside `begin_op()` and `end_op()` like every other file system call. The pathname and system call sections of the xv6 book show the code you copy that pattern from.

### Study

- [OSTEP chapter 42: Crash Consistency: FSCK and Journaling](https://pages.cs.wisc.edu/~remzi/OSTEP/file-journaling.pdf) (read, 45 min): Section 42.1 for the crash scenarios and 42.3 for the journaling protocol, recovery and the timelines in figures 42.1 and 42.2. Skip 42.2 on fsck, 42.4 and the homework.
- [xv6 book, chapter 10: File system](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=92) (read, 1 h): Sections 10.4 to 10.6 on pages 92 to 95 with `kernel/log.c` open, then 10.11 to 10.14 on pages 99 to 103 with `kernel/sysfile.c` open. Skip 10.15 and the exercises.
- [6.1810 Fall 2025: Lab File system](https://pdos.csail.mit.edu/6.1810/2025/labs/fs.html) (do, 5 h): "Symbolic links".

### Build

1. Do the symbolic links part. Store the target path in the link's data blocks. Follow links in `open` up to a depth of 10, and do not follow them when `open` gets `O_NOFOLLOW`.
2. In `sys_symlink`, mark the line where the transaction begins and the line where it commits.

### Done when

`symlinktest` passes both tests, `usertests -q` prints `ALL TESTS PASSED`, and `make grade` on the fs branch reports every test as OK. You can say, for a crash during the creation of a file, what the disk holds after recovery when the crash happened before the header write of step 2 and when it happened after.

## Sockets and an event loop

The kernel track is done, and the last user programs talk to the network. A **socket** is a file descriptor for a network connection. This step uses **TCP**, the protocol that carries a reliable stream of bytes between two programs.

A TCP server creates a socket, binds it to a **port**, a number that names a service on the machine, and marks it as listening. `accept` then returns one new descriptor per client. The server calls `read` and `write`, or `recv` and `send`, on it as on a pipe. The listening socket itself never carries a client's bytes:

![A server holds one listening socket that new clients connect to, and one connected socket per client that accept returned. Bytes to and from a client move only on that client's own socket.](figures/08-sockets.svg)

By default each of those calls can block. Beej's simple server handles that by forking one process per client. That costs a process, its memory and a context switch for every client.

An **event loop** serves every client from one thread. All sockets are **nonblocking**: a call that would wait fails at once with the error `EAGAIN` instead. One call waits until any socket can make progress, and the loop handles each ready socket without blocking:

![The event loop: wait for events, then for each ready descriptor accept new clients on the listening socket, read from a readable client into its input buffer, write queued bytes to a writable client, and close a client on end of file, error or timeout, then wait again.](figures/08-event-loop.svg)

**Readiness** means that the next call on the socket will make some progress. `read` may return one byte of a ten-byte line, and `write` may accept only part of what you hand it. Check for `EWOULDBLOCK` as well as `EAGAIN`, since some systems use that name. Three more rules apply to every server:

- On Linux a socket returned by `accept` does not inherit `O_NONBLOCK` from the listening socket, so set it on every new one.
- Writing to a socket whose peer has gone sends SIGPIPE, as in the shell, and its default action kills the server. The server ignores SIGPIPE at startup and handles the `EPIPE` error instead.
- When a client stops reading, its output queue grows. Cap it, and stop reading from that client until the queue drains. That is **backpressure**.

Linux's waiting call is **epoll**. You create an epoll instance with `epoll_create1`, register each descriptor once with `epoll_ctl` and the events you want, then call `epoll_wait`, which returns the ready descriptors. epoll reports level-triggered by default: a descriptor stays reported for as long as it is ready. Use only that mode. Put it behind one small interface, which chapter 09 reuses and chapter 10 ports to Rust:

```c
typedef struct { int fd; bool readable, writable, closed; } LoopEvent;

int  loop_new(void);
bool loop_watch(int loop, int fd, bool want_read, bool want_write); // add or change
void loop_forget(int loop, int fd);
int  loop_wait(int loop, LoopEvent *out, int max, int timeout_ms);  // count or -1
```

Three details of the interface, because chapters 09 and 10 rely on them:

- `closed` is true when epoll reports `EPOLLHUP` or `EPOLLERR`, a connection that is gone or broken. A peer that only finished sending shows up as `readable`, and the next `read` returns 0.
- `loop_watch` with both flags false keeps the descriptor registered with no events wanted. epoll still reports `EPOLLHUP` and `EPOLLERR` for it, so a client you stopped reading can still be closed.
- `loop_wait` calls `epoll_wait` again when it fails with `EINTR`, which happens when a signal arrives during the wait. It returns -1 only for other errors.

Keep per-client state in a fixed array of structs with a free list of slots, sized by the connection limit. The server then allocates nothing per connection, which is chapter 07's data layout applied to a server.
### Study

- [Beej's Guide to Network Programming: System Calls or Bust](https://beej.us/guide/bgnet/html/split/system-calls-or-bust.html) (read, 2 h 30 min): Sections 5.1 to 5.7 and 5.9 on this page. Then follow Next to chapter 6 for 6.1 and 6.2, the stream server and client, and to chapter 7 for 7.1, 7.2 and 7.4: blocking, `poll` and partial sends. Skip 5.8 and 6.3 on datagrams and the rest of chapter 7.
- [Linux man page: epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html) (reference, as needed): DESCRIPTION, "Level-triggered and edge-triggered" and "Questions and answers". The calls themselves are in `epoll_create1(2)`, `epoll_ctl(2)` and `epoll_wait(2)`, linked under SEE ALSO.

### Build

1. Write `src/loop.h` and `src/loop_epoll.c`. The server programs include `loop_epoll.c`, as your other programs include `base.c`.
2. Write `src/echod.c`, an echo server on `127.0.0.1` and a port from the command line. Bind only to loopback, the address that only your own machine can reach. Each client gets a 4 KB input buffer and a 64 KB output queue. When the output queue is full, stop watching that client for reading until it drains. Set the client limit with a constant, `#define MAX_CLIENTS 1100`, so the load test of the next step with 1000 connections fits under it, and close any client that is idle for 30 seconds. Set `SO_REUSEADDR` on the listening socket, as Beej shows in 5.3, so you can restart the server at once.
3. Write `src/echotest.c`, a client program with blocking sockets. It forks four clients that run against the server at the same time, and kills the stalled one at the end:
   - a slow writer that sends `hello world\n` one byte at a time, 10 ms apart, and checks the echo
   - a stalled reader that sends 10 MB and never reads
   - a quitter that sends half a line and closes
   - a pinger that sends a short line every 100 ms for 10 seconds and records each round trip
4. Trace the server. Start it with `strace -o echod.txt ./out/Linux-debug/echod 9000`, send one line with `printf 'hi\n' | nc -q1 127.0.0.1 9000` from another terminal (`sudo apt install -y netcat-openbsd` if `nc` is missing), and stop the server with Ctrl-C. In `echod.txt`, find `epoll_wait` returning the listening socket, the `accept` that returns the client's descriptor, the `accept` that fails with `EAGAIN`, the `read` that returns 0 when `nc` closes, and the `close`.

> **Optional, on the Mac:** macOS has `kqueue` in place of epoll. Write `src/loop_kqueue.c` behind the same `loop.h`, using `EVFILT_READ`, `EVFILT_WRITE` and `EV_EOF` from the [FreeBSD kqueue(2) page](https://man.freebsd.org/cgi/man.cgi?query=kqueue&sektion=2), and run `echotest` there.

### Done when

`echotest` reports a correct echo for the slow writer and a worst pinger round trip under 50 ms while the stalled reader sits on a full queue. The server's memory stays flat while the stalled reader runs: check it with `ps -o rss -p <pid>` a few times. RSS, the resident set size, is the memory of the process that sits in RAM, in kilobytes. After the test, `ls /proc/<pid>/fd` lists only the standard streams, the listening socket and the epoll descriptor.

## An HTTP/1.1 subset on the event loop

Your loop moves bytes. A web server has to find whole requests in those bytes. **HTTP/1.1** is text over a TCP connection. A request is a request line, header lines, and an empty line, each ending in the two bytes carriage return and line feed, written `\r\n` and called CRLF:

```
GET /index.html HTTP/1.1\r\n
Host: 127.0.0.1:8080\r\n
\r\n
```

The server answers with a status line, headers and a body whose length it states in `Content-Length`. In HTTP/1.1 the connection stays open for the next request unless either side sends `Connection: close`, and a client may send several requests before reading any response. An HTTP/1.0 request closes the connection by default, so answer it with `Connection: close` and close.

Your echo loop already handles the hard part, bytes that arrive in pieces. The new part is **framing**, finding where one request ends. A request is complete when its input buffer contains `\r\n\r\n`. Until then, wait for more bytes. If the buffer fills first, the request is too large.

Parse with the `Str` and `str_cut` functions from chapter 04, as you parsed JSON. Support only `GET` and `HEAD`, and only requests without a body. RFC 9112 section 6.3 says a request with neither `Content-Length` nor `Transfer-Encoding` has no body. Answer anything outside the subset with a status code from RFC 9110 and close the connection:

- 400 for malformed requests and oversized headers.
- 501 for other methods and for `Transfer-Encoding`. Check the method first, so a POST gets 501 whatever its body.
- 413 for a GET or HEAD with a nonzero `Content-Length`.
- 505 for a version other than HTTP/1.0 or 1.1.

Read the RFC 9112 sections before you write the parser. Take three things from it: the grammar of the request line and field lines with their CRLF endings, how `Content-Length` and `Transfer-Encoding` decide whether a body follows, and when a connection stays open for the next request.

The grammar is written in **ABNF**, a notation for rules. Read `request-line = method SP request-target SP HTTP-version` as "a request line is a method, one space, a target, one space and a version". `SP` is a space and `CRLF` the line ending. A `*` in front of an element means it repeats any number of times, and square brackets mark an optional part.

Load every file to serve into memory at startup, into a table keyed by its URL path. Take the files from the command line: `./httpd 8080 www index.html style.css` maps `/index.html` to the bytes of `www/index.html`. Read them with `fopen` and `fread`, as your CHIP-8 runner read its ROM in chapter 06.

A request path that is not in the table gets 404. With exact lookup, a path like `/../etc/passwd` cannot reach the disk at all. It also keeps the loop free of disk reads. A nonblocking socket does not make `read` on a file nonblocking, and a slow disk read would stall every client. Moving that work to other threads comes in chapter 09.

### Study

- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112.html#section-2) (read, 50 min): Section 1.2 (syntax notation), then sections 2 (message format and parsing), 3 up to and including 3.2.1 (request line, origin-form), 4 (status line), 5.1 (field line parsing), 6.3 (message body length) and 9.3 (persistence, including 9.3.2 on pipelining). Skip transfer codings and TLS.
- [RFC 9110: HTTP Semantics, section 15](https://www.rfc-editor.org/rfc/rfc9110.html#section-15) (reference, as needed): Only the codes you send: 15.3.1 (200), 15.5.1 (400), 15.5.5 (404), 15.5.14 (413), 15.6.2 (501) and 15.6.6 (505). Sections 9.3.1 and 9.3.2 define GET and HEAD.

### Build

1. Write `src/httpd.c` on top of the loop. Keep the input and output limits from the echo server. Send `Content-Length` on every response and send no body for HEAD. Honor `Connection: close`, and close after any error response and after every HTTP/1.0 request.
2. Install the test tools with `sudo apt install -y curl netcat-openbsd wrk`. `wrk` is a load generator for HTTP servers.
3. Write `tests/http.sh`. The tests cover a normal GET, a HEAD, a 404, two requests sent in one write on one connection, a request split into one-byte writes, a POST with a body (501), a GET with `Content-Length: 5` and five bytes of body (413), a header block larger than the input buffer, and `GET /../etc/passwd`. Check the status line of each response. Three kinds of command send them:
   - A single request with `curl`. `-s` hides the progress bar, `-i` prints the status line and headers, and `--path-as-is` sends `/../` as written, where plain `curl` would remove it first:

     ```sh
     curl -si --path-as-is http://127.0.0.1:8080/../etc/passwd | head -1
     ```

   - Exact bytes with `printf` and `nc`, for two requests in one write or a malformed one. `-q1` makes `nc` wait one second for the answer after its input ends, then quit:

     ```sh
     printf 'GET /index.html HTTP/1.1\r\nHost: x\r\n\r\nGET /index.html HTTP/1.1\r\nHost: x\r\n\r\n' |
         nc -q1 127.0.0.1 8080
     ```

   - One byte at a time, from a request saved in `req.txt`. `tail -c +$i` starts at byte `i` and `head -c 1` keeps one byte:

     ```sh
     printf 'GET /index.html HTTP/1.1\r\nHost: x\r\n\r\n' > req.txt
     n=$(wc -c < req.txt)
     i=1
     while [ "$i" -le "$n" ]; do
         tail -c +"$i" req.txt | head -c 1
         sleep 0.01
         i=$((i + 1))
     done | nc -q1 127.0.0.1 8080 | head -1
     ```

4. Adapt `echotest` into `httptest`: a stalled client that sends GET requests on one connection and never reads the responses, and a pinger that sends one GET every 100 ms on its own connection and records each round trip.
5. Load test the release build: `wrk -t2 -c100 -d10s --latency http://127.0.0.1:8080/index.html`, then the same with `-c1000`. `-t` is the number of client threads, `-c` the number of open connections and `-d` the duration. Every socket is a file descriptor, so each connection uses one descriptor in `wrk` and one in your server. Before 1000 connections, run `ulimit -n` to see the descriptor limit of your shell, note what fails, then raise it with `ulimit -n 4096` in both terminals.

### Done when

`sh tests/http.sh` passes, and each error case gets the status listed above. The slow-client run keeps the pinger's worst round trip under 50 ms. You have a `wrk` result for 100 and for 1000 connections, the descriptor limit you used, and one sentence on what limits the throughput, from a profile with the tools from chapter 07. Running 10,000 connections is a stretch goal, with `MAX_CLIENTS` and `ulimit -n` raised to match.

## Namespaces: a process with its own view

Every process you started in this chapter saw the whole machine: every other process, the real host name, every network interface. A **container** is a process whose view the kernel restricts and whose resources it limits. Two kernel features do the work, and the WSL2 kernel has both. This step restricts the view, and the next step adds the limits.

A **namespace** gives a process its own copy of one kind of kernel state. The ones you use:

- PID: the process sees only processes in its namespace, and the first one gets pid 1.
- UTS: its own host name.
- mount: its own list of mounted file systems, so it can mount its own `/proc`.
- network: its own network interfaces, with only a loopback that nobody else can reach.

A process in a new PID namespace has two pids. The host still sees it under its ordinary pid, and inside the namespace it is pid 1:

![One process seen from two PID namespaces: on the host, mysh is pid 982, a child of unshare. Inside the new namespace the same process is pid 1, and ps there lists only mysh and its own children.](figures/08-namespaces.svg)

The command `unshare` creates new namespaces and runs a program in them. `--fork` makes the program a child of `unshare`, which a new PID namespace needs, and `--mount-proc` mounts a fresh `/proc` that lists only the new namespace's processes. Creating namespaces needs root, so you run it with `sudo`.

Each namespace has an ID number, and `/proc/<pid>/ns/` holds one link per kind that names the namespace the process is in. Two processes in the same namespace show the same number.

### Study

- [Linux man page: namespaces(7)](https://man7.org/linux/man-pages/man7/namespaces.7.html) (read, 20 min): DESCRIPTION up to and including "Namespace types", and "The /proc/pid/ns/ directory". Skip the rest.
- [Linux man page: unshare(1)](https://man7.org/linux/man-pages/man1/unshare.1.html) (reference, as needed): The options `--pid`, `--uts`, `--net`, `--fork` and `--mount-proc`.

### Build

1. Start your shell in new namespaces:

   ```sh
   sudo unshare --pid --uts --mount-proc --net --fork ./out/Linux-release/mysh
   ```

2. In `mysh`, run each of these and read the result:
   - `ps -o pid,ppid,comm`: your shell is pid 1.
   - `hostname box` then `hostname`. In another terminal, `hostname` still prints the old name.
   - `ip link`, which lists the network interfaces: only `lo`, the loopback, exists.
   - `readlink /proc/self/ns/uts /proc/self/ns/pid`, which prints what each link names. Run the same command in another terminal and compare the numbers.
3. From another terminal, run `ps -o pid,ppid,comm -C unshare,mysh`. `-C` selects processes by command name. Find your shell's pid on the host and its parent, `unshare`.
4. Leave `mysh` with `exit`.

### Done when

Inside `mysh`, `ps` lists only your shell and its children with your shell as pid 1, the host name change stays inside, and `ip link` shows only `lo`. You can name your shell's pid on the host and say which namespace caused each of the three results.

## Limits with a cgroup

Your shell now has its own view, but it can still use all the memory of the machine and start as many processes as it likes. The second kernel feature limits that.

A **cgroup**, short for control group, is a set of processes that the kernel limits as one. It appears as a directory under `/sys/fs/cgroup`. You create one with `mkdir`, set limits by writing to files in it, and move a process in by writing its pid to `cgroup.procs`. Children of a process start in its cgroup.

- `memory.max` caps the memory of all its processes together. When they go over, the kernel's **out-of-memory killer** (OOM killer) kills one of them.
- `memory.swap.max` caps **swap**, disk space the kernel uses as extra memory. Set it to 0, or WSL2's swap file absorbs the excess and nothing is killed.
- `pids.max` caps the number of processes, so `fork` fails past it.

![A container: mysh runs as pid 1 in new PID, UTS, mount and network namespaces, and it and its children sit in the cgroup lab, whose memory.max and pids.max limit them as one.](figures/08-container.svg)

A failed `fork` is new for your shell. In a pipeline, some children may already be running when a later `fork` fails. The shell has to close the pipes it made and wait for those children by pid. If it left them, the `waitpid(-1, WNOHANG)` loop of the signals step would reap them later and print `[pid] done` for processes that were never background jobs.

Docker and similar tools set up these same namespaces and cgroups, plus a separate root file system.

### Study

- [Linux kernel documentation: Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) (reference, as needed): "Basic Operations" for creating a cgroup and moving processes, `memory.max`, `memory.events` and `memory.swap.max` under "Memory Interface Files", and `pids.max` under "PID Interface Files".

### Build

1. Check the setup. `stat -fc %T /sys/fs/cgroup` prints the type of the file system mounted there, which must be `cgroup2fs`, and `cat /sys/fs/cgroup/cgroup.subtree_control` lists `memory` and `pids`.
2. Make your shell handle a failed `fork`: print `mysh: fork: ` and the error with `perror`, close the pipes already made, wait by pid for the children already started, and return to the prompt.
3. Write `src/hog.c`, a program that takes memory, and build it with `sh build.sh hog release`. Your shell splits words at spaces and has no quotes, so the size comes as one argument:

   ```c
   #include <stdio.h>
   #include <stdlib.h>

   int main(int argc, char **argv) {
       if (argc != 2) { fprintf(stderr, "usage: hog MEGABYTES\n"); return 2; }
       size_t n = (size_t)atol(argv[1]) << 20;
       volatile char *p = malloc(n);
       if (p == NULL) { perror("malloc"); return 1; }
       for (size_t i = 0; i < n; i += 4096) p[i] = 1;  // one store per page
       printf("done\n");
       free((void *)p);
       return 0;
   }
   ```

   `<< 20` multiplies by 1,048,576, the bytes in a megabyte. The `volatile` pointer keeps clang from deleting the stores, as in chapter 07's fault probe, and the cast in `free` drops it again.
4. Create the cgroup and set its limits:

   ```sh
   sudo mkdir /sys/fs/cgroup/lab
   echo 50M | sudo tee /sys/fs/cgroup/lab/memory.max
   echo 0 | sudo tee /sys/fs/cgroup/lab/memory.swap.max
   echo 6 | sudo tee /sys/fs/cgroup/lab/pids.max
   ```

   `sudo tee file` writes its input into a file that only root may write. `sudo echo 50M > file` would fail, because your own shell opens the file before `sudo` runs.
5. Start your shell inside the cgroup, in new namespaces as in the last step:

   ```sh
   sudo sh -c 'echo $$ > /sys/fs/cgroup/lab/cgroup.procs &&
       exec unshare --pid --uts --mount-proc --net --fork ./out/Linux-release/mysh'
   ```

   `$$` is the pid of the shell that reads it. The outer `sh` moves itself into the cgroup, then `exec` replaces it with `unshare`, which keeps the same process and so the same cgroup.
6. In `mysh`, run each of these and read the result:
   - `cat /proc/self/cgroup`: `0::/lab`.
   - `ls | cat | cat | cat | cat | cat`: with `unshare` and your shell already in the cgroup, the seventh process makes `fork` fail. Your shell prints the error and keeps running.
   - `./out/Linux-release/hog 10` prints `done`. `./out/Linux-release/hog 100` does not, because the kernel kills it.
7. From another terminal, read `/sys/fs/cgroup/lab/memory.events` and `/sys/fs/cgroup/lab/pids.events`. Exit `mysh`, then remove the cgroup with `sudo rmdir /sys/fs/cgroup/lab`.

> **If it fails:** If `stat` prints `tmpfs`, your WSL is too old to use cgroup v2 only. Run `wsl --update` in Windows PowerShell, then `wsl --shutdown`, and open Ubuntu again. If `memory` or `pids` is missing from `cgroup.subtree_control`, enable them with `echo "+memory +pids" | sudo tee /sys/fs/cgroup/cgroup.subtree_control`.

### Done when

Inside the container, the pipeline prints your fork error, no stray `[pid] done` line follows at the next prompt, and the shell keeps running. `hog 100` dies without printing `done`. `memory.events` shows `oom_kill 1` and `pids.events` shows `max` above 0. You can say which cgroup file caused each of those results.

## Where this leads

You have changed a real kernel in six labs. You can trace a `write` from the user stub to the disk, add a system call, change a page table, explain what the kernel does on a store fault to a copy-on-write page, say which registers `swtch` saves, and show with numbers what round robin buys over FIFO. In user space you wrote a shell that drives `fork`, `exec`, pipes and signals, an allocator that carves `mmap` pages into blocks, and a server that handles hundreds of sockets in one thread. You read their system calls with `strace` and ran your shell in a container you built from namespaces and a cgroup.

Two things are still missing. Your server uses one core of a machine that has many, and any blocking work, such as a disk read, stalls every client. And the xv6 code you modified is full of `acquire` and `release` calls that you were told to take on trust.

Chapter 09, Concurrency and parallelism, covers both. It starts with threads. A thread is the saved registers and stack that `swtch` handled in xv6, scheduled by Linux, and two threads that share one address space can lose increments in a plain `counter++`. From there it builds locks from single atomic instructions, returns to xv6 for one more lab on its locks, and adds condition variables, memory ordering and a lock-free ring. It ends with a job system built on a queue you test and a memory model you state, and moves the server's slow requests onto it.
