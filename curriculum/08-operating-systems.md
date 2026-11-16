---
id: 08
title: Operating systems
part: Performance and the operating system
weeks: 12
project: Six xv6 kernel labs on RISC-V, then a Unix shell, a malloc built on mmap and a nonblocking HTTP server that runs one event loop on both epoll and kqueue.
---

Chapter 07 made your programs fast. You measured them with your own profiler and repetition tester, changed their data layout to suit the caches and wrote vector code for the hot loops. All of that work happened inside one process. Whenever the program read a file, asked for memory or touched a fresh page, the operating system did work on its behalf, and you saw that work only as a count of page faults or a slower time. In chapter 05 you made a system call by hand, with the call number in x8 and `svc #0`. This chapter follows that call into the kernel and out again.

The chapter has two tracks that take turns. The kernel track uses xv6, a small Unix that MIT wrote for teaching, and six labs from MIT's course 6.1810. You add system calls, print and change page tables, handle timer interrupts, implement copy-on-write fork and extend the file system. Each lab comes with a grading script, so you know when you are done. The user track runs on your Linux machine and on the Mac. You write a shell, a general-purpose `malloc` and an HTTP server that serves many clients from one thread.

The tracks feed each other. The shell uses the `fork`, `exec` and pipes you first meet in xv6. The allocator asks the kernel for pages, and by then you have written the kernel code that hands pages out. The server waits on file descriptors whose kernel side you read in the file system step. The chapter comes before concurrency because a thread is a saved set of registers plus a stack that the scheduler switches between, and you write the code around that switch here.

xv6 runs on RISC-V, emulated by QEMU inside your Linux machine. RISC-V is your third instruction set after ARM64 and x86-64. Its base integer set has about 40 instructions, and the labs introduce the few they need. Install the tools in the Ubuntu 24.04 machine from chapter 01 and clone the lab repository:

```sh
sudo apt update
sudo apt install -y git build-essential gdb-multiarch qemu-system-misc \
    gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu
git clone git://g.csail.mit.edu/xv6-labs-2025
```

Use the Fall 2025 offering of 6.1810 for everything: its book (revision 5), its lab pages and its repository belong together. A later offering can rename labs and change tests. Each lab lives on its own git branch and starts from unmodified xv6, so commit your work before you check out the next branch. The lab pages talk about Gradescope, `time.txt` and `make zipball`. Those parts are for MIT students, so skip them. `make grade` runs the same tests the course uses. When a lab asks questions, write your answers in the `answers-*.txt` file it names, for yourself. Do not try to build xv6 on macOS. The Linux machine is the supported setup.

## Processes, file descriptors and xv6 user programs

A process is a running program plus the state the kernel keeps for it: an address space, the saved registers while it is not running, a process ID, a parent, and a table of open files. The first chapter of the xv6 book describes that interface from the outside, through the system calls a program makes. There are only a few. `fork` creates a copy of the calling process, and both copies return from it: the parent gets the child's ID and the child gets 0. `exec` replaces the calling process's memory with a program loaded from a file. `exit` ends a process, and `wait` lets the parent collect a child's exit status.

A file descriptor is a small integer that indexes the process's table of open files. The kernel keeps the real state, such as which file, the current offset and whether it was opened for reading. The process holds only the index. Files, pipes and the console all sit behind the same `read` and `write`.

```
  one process's file table          kernel objects
  fd 0  -------------------------> console
  fd 1  -------------------------> console
  fd 2  -------------------------> console
  fd 3  -------------------------> open file: inode 17, offset 512, read-only
  fd 4  -------------------------> pipe, write end
```

`fork` copies the table, so parent and child refer to the same open files and share their offsets. `exec` keeps the table. Together those two rules let a shell redirect output. It forks, closes fd 1 in the child, opens the output file (which gets the lowest free number, 1), and then calls `exec`. The program writes to fd 1 and never learns where the bytes go. Read the shell examples in chapter 1 slowly, because you write your own shell in the next step.

The util lab has you write five user programs for xv6. xv6 has its own tiny C library, declared in `user/user.h`: `printf`, `strcmp`, `atoi`, `malloc` and one stub per system call. There is no `FILE` and no `stdio.h`. The lab points to K&R for C. Beej's guide from chapter 02 covers the same ground, so skip those pointers. The `memdump` exercise prints raw bytes as integers, characters and pointers, which is chapter 04's material on the bytes of a value.

### Study

- [xv6 book, chapter 1: Operating system interfaces](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=9) (read, 1 h 15 min): Sections 1.1 to 1.4, pages 9 to 19. Figure 1.2 lists every xv6 system call. Skip 1.5 and the exercises.
- [6.1810 Fall 2025: Lab Utilities](https://pdos.csail.mit.edu/6.1810/2025/labs/util.html) (do, 8 h): "Boot xv6", then sleep, sixfive, memdump, find and exec. Skip "Submit the lab" and the optional challenge exercises.
- [6.1810 Fall 2025: Lab guidance](https://pdos.csail.mit.edu/6.1810/2025/labs/guidance.html) (reference, as needed): The difficulty scale at the top, then "Debugging tips": print debugging, `kernel/kernel.asm`, `addr2line` and gdb through `make qemu-gdb` and `gdb-multiarch`.

### Build

1. Install the tools and clone the repository as above. Run `make qemu` in the repository, type `ls` at the xv6 prompt, press Ctrl-p to list the processes, and leave QEMU with Ctrl-a then x.
2. Do the five exercises in order. After each one, run `./grade-lab-util <name>` outside QEMU, for example `./grade-lab-util sleep`.
3. Commit after each exercise that passes.

### Done when

`make grade` on the util branch reports every test as OK. You can say, for `find . wc -exec echo hi`, which processes exist while it runs and which process waits for which: the xv6 shell waits for `find`, and `find` forks one child per match, which execs `echo`, and waits for it.

## A shell for Linux and macOS

xv6's `user/sh.c` parses a command line into a tree of commands and runs it with the system calls from chapter 1. You now write a shell for Linux and the Mac with the same core, plus two things xv6 leaves out: background jobs that someone has to reap, and Ctrl-C.

The process calls are close to xv6's. `execvp` searches `PATH`, so `ls` runs `/bin/ls`. `waitpid` waits for one particular child, and with the `WNOHANG` flag it returns at once if that child has not exited. The status it fills in is decoded with macros such as `WIFEXITED` and `WEXITSTATUS`. `dup2(old, new)` makes descriptor `new` refer to what `old` refers to. It replaces xv6's trick of closing a descriptor and calling `dup`.

A pipeline is mostly descriptor bookkeeping. For `ls | grep c | wc -l > out.txt` the shell creates two pipes and three children:

```
             pipe A                  pipe B
  ls    fd 1 ------> fd 0  grep  fd 1 ------> fd 0  wc  fd 1 ---> out.txt

  ls     keeps A's write end as fd 1 and closes the other three pipe ends
  grep   keeps A's read end as fd 0 and B's write end as fd 1, closes the rest
  wc     keeps B's read end as fd 0, opens out.txt as fd 1, closes the rest
  shell  closes all four pipe ends after the last fork, then waits for all three
```

A reader sees end of file only when every write end of its pipe is closed, in every process. If the shell forgets to close A's write end, `grep` waits for more input forever and the pipeline hangs. The read ends matter too. In `cat /dev/zero | head -c 5`, `head` exits after five bytes. The next write by `cat` then kills it with the signal SIGPIPE, but only if no process still holds the read end. If the shell kept it open, `cat` fills the pipe, blocks and never exits.

A signal is a notification the kernel delivers to a process, such as SIGINT when you press Ctrl-C or SIGCHLD when a child exits. A process sets a disposition for each signal: the default action, ignore, or a handler function. The terminal sends SIGINT to every process in its foreground process group. Children start in the shell's process group, so Ctrl-C reaches the shell and the command it runs. The shell has to survive, and the command should die. Two rules from signal(7) decide how to do that. A child inherits all of its parent's dispositions. `execve` resets signals that have a handler to the default, but leaves ignored signals ignored. So if the shell ignores SIGINT, each child must set SIGINT back to the default before it calls `exec`. Otherwise Ctrl-C stops working for every program the shell starts.

A command that ends in `&` runs in the background. The shell does not wait for it, and it moves the job's processes into a new process group with `setpgid`, so Ctrl-C at the prompt leaves the job alone. Someone still has to reap a finished job, or it stays a zombie in the process table. The CMU slides reap from a SIGCHLD handler and then spend many slides on the races that creates. A simpler design is enough here. Before each prompt, call `waitpid(-1, &status, WNOHANG)` in a loop and report every background child it returns. Wait for foreground children by their pids, so the foreground wait never collects a background job.

The CMU examples run on x86-64 Linux, and the signal and process code in them behaves the same in your Linux machine and on the Mac. Some slide examples call `Fork`, a wrapper from the course's `csapp.c` that calls `fork` and exits on error, and the signal slides use the course's safe I/O functions. Call the plain functions and check the return values yourself. Inside a signal handler, `write` is safe to call and `printf` is not.

### Study

- [CMU 15-213 Fall 2025: Processes and Multitasking](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/16-processes.pdf#page=39) (read, 45 min): Slides 39 to 46 on reaping, zombies, `wait` and `waitpid`, then slides 53 to 65 on a simple shell. Skip the rest, which repeats xv6 chapter 1.
- [CMU 15-213 Fall 2025: Exceptional Control Flow](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/17-ecf.pdf#page=21) (read, 1 h 30 min): Slides 21 to 61: signals, process groups, Ctrl-C, handlers, blocking signals and the SIGCHLD races in a shell. Stop before slide 62 (`sigsuspend`). Slides 10 to 20 cover exceptions with x86-64 examples, and the next step covers the same ground on RISC-V.
- [Linux man page: signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html) (reference, as needed): "Signal dispositions" for the fork and execve rules, "Standard signals" for the default action of each signal, and "Interruption of system calls and library functions by signal handlers" when a call fails with EINTR.

### Build

Write `src/mysh.c` with the build script from chapter 01. It must build with no warnings on the Mac and in Linux.

1. The loop: print `mysh> ` only when `isatty(0)` returns true, read a line with `getline`, and split it into words at whitespace. Require `|`, `<`, `>` and `&` to be separate words, which keeps the parser small. Allocate the words and argv arrays from a chapter 04 arena and reset it after each line.
2. The built-ins `cd` and `exit`. They must run in the shell process itself. Section 1.4 of the xv6 book says why for `cd`.
3. One command: `fork`, `execvp` in the child, `waitpid` in the parent. If `execvp` returns, the child prints `mysh: <name>: not found` to stderr and calls `_exit(127)`.
4. Redirection: `< file` on the first command of a line and `> file` on the last. Open the output with `O_WRONLY | O_CREAT | O_TRUNC` and mode `0644`. Draw the descriptor table of the child before you write the code.
5. Pipelines of any length. Draw the pipe ends for three commands as in the diagram above, then write the code. The shell closes every pipe end after the last fork.
6. Ctrl-C: the shell ignores SIGINT. Every child sets SIGINT back to `SIG_DFL` before `execvp`.
7. Background jobs: a trailing `&`. All processes of the job join one new process group whose ID is the first child's pid. Call `setpgid` in the child and in the parent, so the group exists whichever process runs first. Print `[<pid>]` for the last process of the job when it starts. Before each prompt, reap finished children with `WNOHANG` and print `[<pid>] done`.
8. Write `tests/shell.sh` for the Linux machine. For each case it runs the command line through `timeout 5 ./mysh` and through `sh`, with the line on standard input, and compares standard output. A hang counts as a failure. The cases:

```
echo hello
ls / | sort | head -3
cat < /etc/hostname | tr a-z A-Z
ls | grep c | wc -l > out.txt
cat /dev/zero | head -c 5 | wc -c
nosuchcommand
```

Add one case with three lines: `ls | grep c | wc -l > out.txt &`, then `sleep 1`, then `cat out.txt`.

### Done when

`sh tests/shell.sh` passes every case in Linux and nothing times out. By hand, in a terminal: `sleep 100` followed by Ctrl-C returns to the prompt and the shell keeps running. `sleep 100 &` followed by Ctrl-C at the prompt leaves `sleep` running, and `ps -o pid,pgid,stat,comm` shows it in its own process group. After `kill <pid>` from another terminal, the next prompt prints `[<pid>] done` and `ps` shows no process in state `Z`. The same commands behave the same way on the Mac.

## System calls: from ecall to the kernel and back

In chapter 05 your ARM64 `hello` put a number in x8 and executed `svc #0`. The CPU switched to a privileged mode and jumped to an address the kernel had chosen at boot. OSTEP calls this design limited direct execution. A program runs directly on the CPU at full speed, in a mode where it cannot touch devices, page tables or other processes' memory. The only ways into the kernel are traps: a system call instruction, a fault such as a bad memory access, or an interrupt from a device or the timer. Each one switches the CPU to supervisor mode and jumps to the kernel's trap handler.

On RISC-V the system call instruction is `ecall`. xv6 passes the call number in a7 and the arguments in a0 to a5, and puts the result back in a0. Here is one `write` in xv6:

```
  user mode                          supervisor mode
  write(1, "hi", 2)
    user/usys.S:
      li a7, SYS_write
      ecall  ----------------------> uservec (kernel/trampoline.S)
                                       save the 32 user registers in the trapframe
                                       switch to the kernel page table and stack
                                     usertrap (kernel/trap.c)
                                       scause says: ecall from user mode
                                       saved pc += 4, past the ecall
                                     syscall (kernel/syscall.c)
                                       num = trapframe->a7
                                       trapframe->a0 = syscalls[num]()
                                     sys_write (kernel/sysfile.c)
                                       argint, argaddr read a0, a1, a2 from the trapframe
                                       copy the user buffer in, checking every address
                                     prepare_return, then userret
                                       restore the user registers, sret
    a0 = 2  <---------------------
```

This step covers the dispatch in the middle: how a call number becomes a function, how arguments come out of the trapframe, and why the kernel checks every pointer a program hands it. The entry and exit code at the top and bottom comes in the traps step. The lab's sandbox sits at the dispatch point. `syscall` checks a per-process mask before it calls the handler, and `fork` copies the mask to the child. The attack exercise shows what happens when the kernel forgets to zero a page before giving it to another process.

A system call costs more than a function call, because of the mode switch and the register saving. OSTEP's chapter ends with a homework about measuring that cost, and you have the tool for it from chapter 07.

### Study

- [OSTEP chapter 6: Mechanism: Limited Direct Execution](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf) (read, 1 h): Sections 6.1 to 6.3 and the summary in 6.5. Redraw figures 6.2 and 6.3, the two protocol timelines. Skip 6.4, which belongs to the concurrency chapter. The chapter's measurement homework is the second Build task below.
- [xv6 book, chapter 2: Operating system organization](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=21) (read, 1 h 30 min): All of chapter 2, pages 21 to 29, then sections 4.3 and 4.4 on pages 47 and 48. Stop before 4.5.
- [6.1810 Fall 2025: Lab System calls](https://pdos.csail.mit.edu/6.1810/2025/labs/syscall.html) (do, 10 h): "Using gdb" with its questions, "Sandbox a command", "Sandbox with allowed pathnames" and "Attack xv6".

### Build

1. Check out the `syscall` branch and do the four parts of the lab in order. Answer the gdb questions in `answers-syscall.txt` before you write any kernel code.
2. In the Linux machine, measure a system call with the repetition tester from chapter 07. Time a loop of `syscall(SYS_getpid)` (from `<sys/syscall.h>`), which always enters the kernel. Time a loop of calls to an empty function marked `__attribute__((noinline))` as the baseline. Report the minimum time per call for both.

### Done when

`make grade` on the syscall branch reports every test as OK, and `answers-syscall.txt` answers each question. You have a time per system call and per function call from your own machine, and the ratio between them. Without notes, you can draw the path of a `read` from the user stub to `sys_read` and back, naming the file each piece lives in.

## Page tables

Every address a user program uses is virtual. The CPU translates it to a physical address through a page table that the kernel builds, one table per process. RISC-V's Sv39 scheme, which xv6 uses, splits the low 39 bits of a virtual address into three 9-bit indexes and a 12-bit offset:

```
  virtual address (Sv39, low 39 bits used)
  +---------+---------+---------+--------------+
  | L2 (9)  | L1 (9)  | L0 (9)  | offset (12)  |
  +---------+---------+---------+--------------+

  satp -> root table, 512 entries
            entry [L2] -> middle table, 512 entries
                           entry [L1] -> leaf table, 512 entries
                                          entry [L0] -> physical page, 4096 bytes
                                                         + offset = physical address
```

Each table is one 4096-byte page of 512 eight-byte entries. An entry (PTE) holds a physical page number and flag bits: V (valid), R, W, X (read, write, execute), U (user mode may use it), A and D (accessed and dirty, set by hardware). The lab prints PTEs with their flags, so decode a few by hand. `perm 0x5B` is binary `0101 1011`, which is V, R, X, U and A: program text. `perm 0xC7` is V, R, W, A and D with no U: the trapframe, which only the kernel may touch.

Walking three tables on every memory access would make every load four loads. The CPU caches recent translations in the TLB, and most accesses hit it. When the kernel changes a PTE, it must flush the stale cached translation with `sfence.vma`. A TLB holds a few thousand entries at most, so with 4 KB pages it covers a few megabytes. That ties back to chapter 07: a program that jumps around a large array misses in the TLB as well as in the caches. A superpage, a valid leaf entry one level up, maps 2 MB with a single TLB entry. The last part of the lab adds superpages to xv6.

OSTEP's paging chapter builds a single flat table first and shows why it is too large: a 4 KB page and 4-byte entries give a 4 MB table per process for a 32-bit address space. RISC-V's tree only allocates the tables a process uses. OSTEP's PTE example is x86. The xv6 book gives the RISC-V layout in figure 3.2.

### Study

- [OSTEP chapter 18: Paging: Introduction](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf) (read, 1 h): Sections 18.1 to 18.5. Work the memory trace in 18.5 with a pencil. Skip the homework.
- [xv6 book, chapter 3: Page tables](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=31) (read, 2 h): Sections 3.1 to 3.7, pages 31 to 41, with `kernel/vm.c` and `kernel/memlayout.h` open. Figures 3.2, 3.3 and 3.4 are the ones the lab refers to. Skip 3.8 and the exercises.
- [6.1810 Fall 2025: Lab Page tables](https://pdos.csail.mit.edu/6.1810/2025/labs/pgtbl.html) (do, 12 h): All four parts: "Inspect a user-process page table", "Speed up system calls", "Print a page table" and "Use superpages". The lab mentions the RISC-V privileged manual for superpages. The book and the lab hints are enough without it.

### Build

1. Check out the `pgtbl` branch. Do the four parts in order and answer the questions about each PTE in the answers file.
2. Before the superpage part, draw on paper the tables `vmprint` prints for `pgtbltest`, with the index of every entry at each level.

### Done when

`make grade` on the pgtbl branch reports every test as OK. By hand, you can split `0x3fffffe000` (TRAPFRAME) into its three indexes, 255, 511 and 510, and its offset 0, and match them to the last lines of the `vmprint` output. You can say how many page-table pages a process needs that uses one 4 KB page at address 0 and the two pages at the top of the address space.

## Traps, timer interrupts and the context switch

Step 3 covered the middle of the system call path. This step covers its two ends and the third kind of trap, the timer interrupt. When a trap arrives in user mode, RISC-V disables interrupts, saves the user pc in `sepc`, records the old mode in `sstatus` and the cause in `scause`, switches to supervisor mode and jumps to the address in `stvec`. It does not switch page tables or stacks, and it saves no other registers. xv6's `uservec` does that work in assembly, in the trampoline page. That page is mapped at the same virtual address in the user and kernel page tables, so the code keeps running when it switches `satp`. The 32 user registers go into the trapframe page you saw in the page table lab.

A timer interrupt arrives every tick, whatever the process is doing. `usertrap` sees it and calls `yield`, which gives the CPU to another process. xv6 never switches straight from one process to the next. The old process's kernel thread switches to the CPU's scheduler thread, and the scheduler switches to the next process:

```
  shell (user)                                               cat (user)
     | timer interrupt                                          ^
     v                                                          | userret, sret
  shell kernel thread                                       cat kernel thread
     usertrap -> yield -> sched                                 ^
        swtch(&shell->context, &cpu->context)                   |
                 |                                              |
                 v                                              |
           scheduler thread: finds cat RUNNABLE                 |
              swtch(&cpu->context, &cat->context) --------------+
```

Two different sets of registers get saved here. The trapframe holds all 32 user registers, because the interrupt can land between any two user instructions. `struct context` holds only ra, sp and s0 to s11, the callee-saved registers. The kernel calls `swtch` as an ordinary C function, so the compiler has already saved every caller-saved register it still needs. On ARM64 the callee-saved set is x19 to x28, which chapter 05's stack frames preserved. The scheduler code takes and releases `p->lock`. Read those calls as "only one CPU touches this process at a time" for now. Chapter 09 explains locks.

The lab has three parts. The RISC-V assembly questions use the calling convention, which you know in its ARM64 form. The backtrace walks frame pointers: s0 holds the current frame pointer, the return address sits at s0 minus 8 and the caller's frame pointer at s0 minus 16, like x29 and x30 in ARM64 frame records. The alarm is a small version of a Unix signal handler. The kernel diverts a process to a user function by changing the saved pc in its trapframe, and `sigreturn` restores the registers saved when the alarm fired. Linux delivers the signals your shell handled in the same way: it edits the saved user registers before it returns to user mode.

### Study

- [xv6 book, chapter 4: Traps and system calls](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=43) (read, 2 h): Sections 4.1, 4.2 and 4.5, pages 43 to 49, with `kernel/trampoline.S` and `kernel/trap.c` open. Then section 6.4, "Timer interrupts", on page 59, and sections 8.1 to 8.3 on pages 75 to 77 with `kernel/swtch.S` and `scheduler()` in `kernel/proc.c`. Stop before 8.4.
- [RISC-V calling convention](https://pdos.csail.mit.edu/6.1810/2025/readings/riscv-calling.pdf) (reference, as needed): Table 18.2 lists every register, its ABI name and whether the caller or the callee saves it. Use it for the assembly questions and for `swtch`.
- [6.1810 Fall 2025: Lab Traps](https://pdos.csail.mit.edu/6.1810/2025/labs/traps.html) (do, 8 h): "RISC-V assembly", "Backtrace" and "Alarm" with its test0 to test3 parts.

### Build

1. Check out the `traps` branch. Answer the assembly questions in `answers-traps.txt`.
2. Write `backtrace`, call it from `sys_pause` and from `panic`, and check the addresses with `addr2line` as the lab shows.
3. Write `sigalarm` and `sigreturn`. Before writing `sigreturn`, list on paper which registers it must restore and where each saved copy lives.

### Done when

`make grade` on the traps branch reports every test as OK, `alarmtest` prints passes for test0 to test3, and `usertests -q` prints `ALL TESTS PASSED`. Without notes, you can draw the switch from the shell to `cat` on one CPU, with each `swtch` call and the registers it saves, and say which registers live in the trapframe and which in `struct context`.

## Page faults and copy-on-write fork

A page fault is a trap like the others. On RISC-V, `scause` is 12 for an instruction fetch, 13 for a load and 15 for a store, and `stval` holds the virtual address that failed. The CPU raises one when the PTE is missing or invalid, or when its flags forbid the access. The kernel can then fix the page table and return to the faulting instruction, which runs again and succeeds. These are the faults you counted in chapter 07 when a fresh buffer read slower than a reused one. xv6 already does this for lazy `sbrk`. The kernel only records the new size, and `vmfault` allocates each page the first time the program touches it.

Copy-on-write fork uses the same mechanism to avoid copying memory in `fork`. Your shell forks and then calls `exec` in the child, which throws the copy away. With COW, `fork` maps the parent's physical pages into the child and clears the W flag in both page tables. Reads work as before. The first write by either process faults, and only then does the kernel copy that one page:

```
  after fork                          after the child writes page P
  parent PTE -> P  (R, COW)           parent PTE -> P   (R, COW)  refcount(P) = 1
  child  PTE -> P  (R, COW)           child  PTE -> P'  (R, W)    refcount(P') = 1
  refcount(P) = 2                     fault handler: kalloc P', copy P, map P' writable
```

Three details decide whether your version passes the tests. The kernel needs a reference count per physical page, so that `kfree` returns a page only when the last page table drops it. It needs a mark on each PTE that says "copy on write" as opposed to "read-only", and the two RSW bits of a RISC-V PTE are free for the kernel's own use. And the kernel sometimes writes into user memory without a fault: `copyout` walks the page table in software, so it has to handle COW pages itself. After changing a PTE, flush the TLB as the page table step described.

Linux implements `fork` this way, and it also maps file data and anonymous memory lazily through page faults. The `mmap` call in the next step returns at once even for a large region, and you pay a fault the first time you touch each page.

### Study

- [xv6 book, chapter 5: Page faults](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=51) (read, 45 min): Sections 5.1 to 5.5, pages 51 to 54, with `vmfault` in `kernel/vm.c` and its callers in `kernel/trap.c` open. Do exercise 1 in section 5.6 if you want to see a lazy page appear in `vmprint`.
- [6.1810 Fall 2025: Lab Copy on-write](https://pdos.csail.mit.edu/6.1810/2025/labs/cow.html) (do, 10 h): The whole page. Follow its plan of attack: `uvmcopy`, `vmfault`, reference counts in `kalloc.c`, then `copyout`.

### Build

1. Check out the `cow` branch. Implement the lab in the order of its plan.
2. Add a temporary counter of COW copies, print it when a process exits, run `echo hi` from the xv6 shell and explain the number you see. Remove the print before you run the tests.

### Done when

`cowtest` prints `ALL COW TESTS PASSED`, `usertests -q` prints `ALL TESTS PASSED`, and `make grade` on the cow branch reports every test as OK. You can say what happens on a store fault when the page's reference count is 1, and why a write to a text page still kills the process.

## A malloc on top of mmap

The chapter 04 arena handed out memory by moving a pointer and freed everything at once. A general-purpose `malloc` has to accept `free` in any order, reuse the freed space and stay fast. It gets its memory from the kernel in large pieces and divides them up itself. On Linux and macOS the call for that is `mmap` with `MAP_PRIVATE | MAP_ANON`, which returns zeroed, page-aligned memory. After the last two steps you know what that does inside the kernel: it records a range, and the pages arrive one fault at a time when you touch them.

The CMU slides build the classic design step by step. Every block starts with a header that holds its size and an allocated bit. A free block also ends with a footer, a copy of the header, so that `free` can find the previous block and merge with it in constant time. Free blocks link into one or more free lists that live inside the free blocks themselves.

```
  one chunk from mmap
  +--------+----------------------+--------+-------------------------+--------+
  | prolog | hdr  payload ...     | hdr    next prev ...      ftr    | epilog |
  | alloc  | 48|1                 | 96|0                       96|0   | 0|1    |
  +--------+----------------------+--------+-------------------------+--------+
            allocated block         free block on a free list
```

The slides grow one contiguous heap with `sbrk`. Your heap is a set of chunks from `mmap`, which need not touch each other. Give each chunk its own allocated prologue and epilogue, as the slides' "Heap Structure" slide does for the whole heap, and coalescing stops at the chunk edges by itself. Requests above a threshold, say 256 KB, skip the free lists: map them directly, record the mapping size in the header, and `munmap` them on `free`.

Align every pointer you return to 16 bytes, as the system `malloc` does on both of your machines. The page size differs between your machines. Run `getconf PAGESIZE` on the Mac and in Linux, and round chunk sizes with `sysconf(_SC_PAGESIZE)` at run time instead of a constant.

`realloc` and `calloc` have rules you already read in chapter 02's malloc(3) page. `realloc(NULL, n)` acts like `malloc(n)`. `realloc(p, 0)` frees `p` in glibc, and yours does the same and returns NULL. `calloc(n, size)` must fail when `n * size` overflows, using the overflow checks from chapter 04.

### Study

- [CMU 15-213 Fall 2025: Dynamic Memory Allocation: Basic Concepts](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/13-malloc-basic.pdf#page=21) (read, 1 h 30 min): Slides 21 to 58: headers, the implicit list, splitting, boundary tags, the four coalescing cases, the heap structure and the top-level code.
- [CMU 15-213 Fall 2025: Dynamic Memory Allocation: Advanced Concepts](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/14-malloc-advanced.pdf#page=7) (read, 45 min): Slides 7 to 21, explicit free lists and segregated lists. Skip slides 22 to 39, the memory-bug catalogue that the sanitizers from chapter 01 already catch.
- [Linux man page: mmap(2)](https://man7.org/linux/man-pages/man2/mmap.2.html) (reference, as needed): The DESCRIPTION for `MAP_PRIVATE` and `MAP_ANON`, RETURN VALUE for `MAP_FAILED`, and `munmap` on the same page. The Mac's `man mmap` describes the same calls.

### Build

Write `src/mm.c` and `src/mm.h` with `mm_malloc`, `mm_free`, `mm_calloc` and `mm_realloc`, and build them on both machines.

1. Start with one chunk, an implicit free list, first fit, splitting and boundary-tag coalescing, as on the slides. Then switch to an explicit free list. Then try segregated lists by size class and keep them only if your benchmark says they help.
2. Add new chunks of at least 1 MB when no free block fits, and map large requests directly.
3. Write `mm_check`, a heap checker. It walks every chunk and fails if a header and footer disagree, if two free blocks are adjacent, if a free block is missing from its list, or if a payload is not 16-byte aligned.
4. Write a test driver. It runs a random trace of one million operations with up to 2000 live blocks. Most sizes are below 512 bytes and a few are above the direct-map threshold. Every block is filled with a byte pattern derived from its index, and the driver checks the pattern before each free and each realloc. It calls `mm_check` every 1000 operations. Seed the random generator from the command line so a failing trace can be replayed.
5. Benchmark the same trace against the system `malloc` with your repetition tester from chapter 07, on both machines. Report time per operation and the peak bytes mapped versus the peak bytes requested.

Replacing the system allocator in other programs is a stretch. On Linux, build `mm.c` as a shared library that exports `malloc`, `free`, `calloc` and `realloc` and start a program with `LD_PRELOAD`. A real program also calls `posix_memalign` and may use threads, so expect crashes until you add those.

### Done when

The driver runs one million operations with three different seeds, with `mm_check` passing and no sanitizer reports in a debug build, on the Mac and in Linux. The benchmark prints times for both allocators and you can explain the gap, either way. You can draw the blocks around a `free` for each of the four coalescing cases.

## The xv6 file system

A file system is a data structure on a disk that has to survive a crash at any moment. The xv6 file system has the same parts as larger Unix file systems, in a few C files under `kernel/`. It is built in layers:

```
  file descriptor   read(fd, ...), the per-process table from step 1
  pathname          "/a/b/c" resolved one directory at a time
  directory         a file of (name, inode number) entries
  inode             metadata and the list of a file's blocks
  logging           groups the block writes of a system call into one transaction
  buffer cache      in-memory copies of disk blocks, one user of a block at a time
  disk              virtio driver, 1024-byte blocks
```

An inode lists its data blocks. xv6 keeps 12 direct block numbers and one indirect block holding 256 more. `bmap` maps a block number within the file to a block number on the disk. The lab adds a doubly indirect block, which raises the limit from 268 blocks to 65,803:

```
  addrs[0..10]   direct          blocks 0 to 10 of the file
  addrs[11]      indirect        -> 256 block numbers: blocks 11 to 266
  addrs[12]      double indirect -> 256 indirect blocks -> 256 x 256 block numbers
```

Creating a file writes several blocks: the inode, the directory, the free bitmap. A crash between two of those writes leaves the disk inconsistent. xv6 avoids that with a log. A system call writes its blocks to the log area first, then writes a header block that marks the transaction as committed, then copies the blocks to their real places and clears the header. After a crash, recovery replays a committed log and ignores an uncommitted one, so every system call's writes appear completely or not at all. OSTEP describes the same idea for a general file system before you read xv6's code. Chapter 18 of this book builds a write-ahead log for a key-value store on the same principle.

The xv6 code takes locks on buffers and inodes (`bread`, `ilock`). As in the scheduler, read them as "one user at a time" until chapter 09.

### Study

- [OSTEP chapter 40: File System Implementation](https://pages.cs.wisc.edu/~remzi/OSTEP/file-implementation.pdf) (read, 1 h 15 min): Sections 40.1 to 40.7. Figures 40.3 and 40.4, the read and create timelines, list the blocks each operation touches. Skip the homework.
- [xv6 book, chapter 10: File system](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=89) (read, 2 h 30 min): Sections 10.1 to 10.14, pages 89 to 103, with `kernel/fs.c` and `kernel/log.c` open. Figure 10.3 is the inode diagram the lab refers to. Skip 10.15 and the exercises.
- [6.1810 Fall 2025: Lab File system](https://pdos.csail.mit.edu/6.1810/2025/labs/fs.html) (do, 10 h): "Large files" and "Symbolic links".

### Build

1. Check out the `fs` branch. Before you change `bmap`, draw the mapping from a file block number to the indirect blocks for block numbers 10, 11, 266, 267 and 65,802.
2. Do the large files part, including freeing double indirect blocks in `itrunc`.
3. Do the symbolic links part. Store the target path in the link's data blocks. Follow links in `open` up to a depth of 10.

### Done when

`bigfile` prints `wrote 65803 blocks`, `symlinktest` passes both tests, `usertests -q` prints `ALL TESTS PASSED`, and `make grade` on the fs branch reports every test as OK. You can say, for a crash during the creation of a file, what the disk holds after recovery when the crash happened before the commit block was written and when it happened after.

## Sockets and a nonblocking event loop

A TCP socket is another file descriptor. A server creates one, binds it to a port, marks it as listening, and calls `accept` to get one new descriptor per client. Then it calls `read` and `write`, or `recv` and `send`, as on a pipe. By default each of those calls can block. Beej's simple server handles that by forking one process per client, with a SIGCHLD handler like the ones from the shell step. That costs a process, its memory and a context switch for every client.

An event loop serves every client from one thread. All sockets are nonblocking. One call waits until any of them can make progress, and the loop handles each ready socket without blocking:

```
  set the listening socket nonblocking, watch it for "readable"
  loop:
    wait for events (with a timeout)
    listening socket readable: accept until EAGAIN, set each new socket nonblocking
    client readable:  read some bytes, append to the client's bounded input buffer
                      read returns 0: the client closed its side
    client writable:  send queued bytes, keep any unsent suffix
    EOF, error or idle too long: stop watching, close, release the client's state
```

Readiness means that the next call on the socket will make some progress. `read` may return one byte of a ten-byte line, and `write` may accept only part of what you hand it. A nonblocking call that would block fails with `EAGAIN` (or `EWOULDBLOCK`, which you check too). Three more rules apply to every server. On Linux a socket returned by `accept` does not inherit `O_NONBLOCK` from the listening socket, so set it on every new one. Writing to a socket whose peer has gone sends SIGPIPE, whose default action kills the server, so the server ignores SIGPIPE at startup and handles the `EPIPE` error instead. And when a client stops reading, its output queue grows. Cap it, and stop reading from that client until the queue drains. That is backpressure.

Linux and macOS use different calls for the wait. Linux has `epoll`: you register each descriptor once with `epoll_ctl` and an interest mask, then call `epoll_wait`. macOS has `kqueue`, from FreeBSD: you pass a list of changes to `kevent`, with separate read and write filters per descriptor, and the same call returns the events. Both report level-triggered by default, which means a descriptor stays reported for as long as it is ready. Use level-triggered mode only. Put both behind one small interface, so the server code does not know which one it runs on:

```c
typedef struct { int fd; bool readable, writable, closed; } LoopEvent;

int  loop_new(void);
bool loop_watch(int loop, int fd, bool want_read, bool want_write); // add or change
void loop_forget(int loop, int fd);
int  loop_wait(int loop, LoopEvent *out, int max, int timeout_ms);  // count or -1
```

Keep per-client state in a fixed array of structs with a free list of slots, sized by the connection limit. The server then allocates nothing per connection, which is chapter 07's data layout applied to a server.

### Study

- [Beej's Guide to Network Programming: System Calls or Bust](https://beej.us/guide/bgnet/html/split/system-calls-or-bust.html) (read, 2 h 30 min): Sections 5.1 to 5.7 and 5.9 on this page. Then follow Next to chapter 6 for 6.1 and 6.2, the stream server and client, and to chapter 7 for 7.1, 7.2 and 7.4: blocking, `poll` and partial sends. Skip 5.8 and 6.3 on datagrams and the rest of chapter 7.
- [Linux man page: epoll(7)](https://man7.org/linux/man-pages/man7/epoll.7.html) (reference, as needed): DESCRIPTION, "Level-triggered and edge-triggered" and "Questions and answers". The calls themselves are in `epoll_create1(2)`, `epoll_ctl(2)` and `epoll_wait(2)`, linked under SEE ALSO.
- [FreeBSD man page: kqueue(2)](https://man.freebsd.org/cgi/man.cgi?query=kqueue&sektion=2) (reference, as needed): `struct kevent`, the flags `EV_ADD`, `EV_DELETE` and `EV_EOF`, the filters `EVFILT_READ` and `EVFILT_WRITE`, and EXAMPLES. On the Mac, `man 2 kqueue` is Apple's copy of the same interface. Use the Mac's page for anything platform-specific.

### Build

1. Write `src/loop.h` and two implementations, `src/loop_epoll.c` and `src/loop_kqueue.c`. Extend the build script to compile the first in Linux and the second on the Mac.
2. Write `src/echod.c`, an echo server on `127.0.0.1` and a port from the command line. Bind only to loopback. Each client gets a 4 KB input buffer and a 64 KB output queue. When the output queue is full, stop watching that client for reading until it drains. Allow at most 1000 clients and close any client that is idle for 30 seconds. Set `SO_REUSEADDR` on the listening socket, as Beej shows in 5.3, so you can restart the server at once.
3. Write `src/echotest.c`, a client program with blocking sockets. It forks four clients that run against the server at the same time, and kills the stalled one at the end:
   - a slow writer that sends `hello world\n` one byte at a time, 10 ms apart, and checks the echo
   - a stalled reader that sends 10 MB and never reads
   - a quitter that sends half a line and closes
   - a pinger that sends a short line every 100 ms for 10 seconds and records each round trip

### Done when

On the Mac and in Linux, `echotest` reports a correct echo for the slow writer and a worst pinger round trip under 50 ms while the stalled reader sits on a full queue. The server's memory stays flat while the stalled reader runs. Check it with `ps -o rss -p <pid>` a few times. After the test, the server holds no descriptors for the quitter or the finished clients: `ls /proc/<pid>/fd` in Linux lists only the standard streams, the listening socket and the epoll descriptor.

## An HTTP/1.1 subset on the event loop

HTTP/1.1 is text over a TCP connection. A request is a request line, header lines, and an empty line, each ending in CRLF:

```
GET /index.html HTTP/1.1\r\n
Host: 127.0.0.1:8080\r\n
\r\n
```

The server answers with a status line, headers and a body whose length it states in `Content-Length`. The connection stays open for the next request unless either side sends `Connection: close`, and a client may send several requests before reading any response. Your echo loop already handles the hard part, bytes that arrive in pieces. The new part is framing: a request is complete when its input buffer contains `\r\n\r\n`. Until then, wait for more bytes, and if the buffer fills first, the request is too large.

Parse with the `Str` and `str_cut` functions from chapter 04, as you parsed JSON. Support only `GET` and `HEAD`, and only requests without a body. RFC 9112 section 6.3 says a request with neither `Content-Length` nor `Transfer-Encoding` has no body. Answer anything outside the subset with a status from RFC 9110 and close the connection: 400 for malformed requests and oversized headers, 501 for other methods and for `Transfer-Encoding`, 413 for a nonzero `Content-Length`, 505 for a version other than HTTP/1.0 or 1.1.

Load every file to serve into memory at startup, into a table keyed by its URL path. Take the files from the command line, for example `./httpd 8080 www index.html style.css`, which maps `/index.html` to the bytes of `www/index.html`. Read them with `fopen` and `fread` as in chapter 02. A request path that is not in the table gets 404. With exact lookup, a path like `/../etc/passwd` cannot reach the disk at all. It also keeps the loop free of disk reads. A nonblocking socket does not make `read` on a file nonblocking, and a slow disk read would stall every client. Moving that work to other threads comes in chapter 09.

### Study

- [RFC 9112: HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9112#section-2) (reference, as needed): Sections 2 (message format and parsing), 3 up to and including 3.2.1 (request line, origin-form), 4 (status line), 5.1 (field line parsing), 6.3 (message body length) and 9.3 (persistence, including 9.3.2 on pipelining). Skip transfer codings and TLS.
- [RFC 9110: HTTP Semantics, section 15](https://www.rfc-editor.org/rfc/rfc9110#section-15) (reference, as needed): Only the codes you send: 15.3.1 (200), 15.5.1 (400), 15.5.5 (404), 15.5.14 (413), 15.6.2 (501) and 15.6.6 (505). Sections 9.3.1 and 9.3.2 define GET and HEAD.

### Build

1. Write `src/httpd.c` on top of the loop. Keep the input and output limits from the echo server. Send `Content-Length` on every response and send no body for HEAD. Honor `Connection: close` and close after any error response.
2. Write `tests/http.sh` with `curl` and `printf ... | nc`. In Linux, `sudo apt install -y curl netcat-openbsd wrk` installs what the tests and the load test need. The tests cover a normal GET, a HEAD, a 404, two requests sent in one write on one connection, a request split into one-byte writes, a POST with a body, a header block larger than the input buffer, and `GET /../etc/passwd`. Check the status line of each response.
3. Adapt `echotest` into `httptest`: a stalled client that sends GET requests on one connection and never reads the responses, and a pinger that sends one GET every 100 ms on its own connection and records each round trip.
4. In Linux, load test with `wrk`: `wrk -t2 -c100 -d10s http://127.0.0.1:8080/index.html`, then 1000 connections. Raise the descriptor limit with `ulimit -n` first and note what fails before you raise it. Record requests per second and the latency percentiles from `wrk --latency`.

### Done when

`sh tests/http.sh` passes on both machines, and each error case gets the status listed above. The slow-client run keeps the pinger's worst round trip under 50 ms. You have a `wrk` result for 100 and for 1000 connections, the descriptor limit you used, and one sentence on what limits the throughput, from a profile with the tools from chapter 07. Running 10,000 connections is a stretch goal.

## Where this leads

You have changed a real kernel in six places and seen each mechanism from both sides. A system call is a trap with a number in a register. A process's memory is a page table that the kernel edits, and a page fault is a chance to edit it lazily. A context switch saves fourteen registers and swaps stacks. A file system survives crashes by logging. In user space you used the same mechanisms: the shell drives `fork`, `exec`, pipes and signals, the allocator turns `mmap` pages into blocks, and the server multiplexes hundreds of sockets in one thread.

Two things are still missing. Your server uses one core of a machine that has many, and any blocking work, such as a disk read, stalls every client. And the xv6 code you modified is full of `acquire` and `release` calls that you were told to take on trust. Chapter 09, Concurrency and parallelism, covers both. It starts from the threads and the context switch you wrote, explains what a lock does at the level of atomic instructions and memory ordering, and ends with a job system built on a queue you test and a memory model you state.
