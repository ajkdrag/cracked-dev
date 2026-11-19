---
id: 09
title: Concurrency and parallelism
part: Performance and the operating system
weeks: 8
project: A work-stealing job system in C with a tested bounded queue, a lock-free single-producer ring and a written memory-ordering argument, used to parallelize the haversine sum and to keep the chapter 08 HTTP server responsive under heavy requests.
---

Chapter 08 left you with two loose ends. Your HTTP server runs one event loop on one core of a machine that has many, and any slow work inside the loop stalls every client. The xv6 kernel you changed in six labs calls `acquire` and `release` all over the place, and you took those calls on trust. You have also seen half of a thread already: xv6's `swtch` saves a set of registers and switches stacks. A thread in your own programs is the same pair of registers and stack, scheduled by Linux.

This chapter starts with two threads that share memory and lose increments in a plain `counter++`. You build locks from single atomic instructions, read how xv6 builds its own in one more lab, and cause a deadlock on purpose. Then you make waiting threads sleep in the kernel, first in a lock and then in a bounded queue that a pool of threads can wait on.

Then you measure what sharing costs on your laptop's cores, watch your CPU reorder memory operations, and learn the rules that let one thread hand data to another without a lock. A ring buffer uses those rules. The project is a job system: one queue per worker, idle workers steal from busy ones, and a waiting thread runs other jobs while it waits. The last step moves the server's slow requests onto it.

The chapter comes after chapter 07 because every claim about parallel speed here is a measurement with the timers you wrote there, and the cache lines you measured there decide what sharing costs. It comes after chapter 08 because a lock that sleeps needs the kernel, and you now know what the kernel does when a thread blocks.

Your laptop's x86-64 cores keep most memory operations in program order, as seen from other cores. ARM64 cores, like the Mac's, keep far fewer, so a program can pass every test on x86-64 and fail on ARM64. This chapter therefore never argues from what your CPU happens to do. Every argument follows the rules of the C standard, which hold on both, and a tool introduced in step 1 checks those rules while your program runs.

## Threads, shared memory and data races

Your server uses one core because a process from chapter 08 runs one flow of instructions at a time. To use more cores, a program needs more threads.

A **thread** is one flow of execution inside a process. It has its own registers, including the instruction pointer `rip` and the stack pointer `rsp`, and its own stack. Everything else in the process is shared by all its threads: the code, the globals, the heap and the open file descriptors. Linux's scheduler runs each thread on some core, the way it runs a process.

The thread functions come from **pthreads**, the threads interface of POSIX, the standard that Unix systems such as Linux and macOS follow for their system calls and C library. On Ubuntu 24.04 pthreads is part of the C library, so `build.sh` needs no extra flag.

- `pthread_create(&t, NULL, fn, arg)` starts a new thread that runs `fn(arg)` and stores its handle in `pthread_t t`. `fn` takes a `void *` and returns one.
- `pthread_join(t, &result)` waits until that thread's function returns and collects its return value, the way `waitpid` collects a child process.

![One process with two threads. Code, globals, the heap and the file descriptors are shared, and each thread has its own registers and its own stack.](figures/09-threads.svg)

Shared memory lets threads hand each other data without copying it, and it also lets them damage each other's data. `counter = counter + 1` on a global is three steps: load the value into a register, add 1, store it back. If another thread stores to `counter` between this thread's load and its store, one increment is lost:

![Two threads each load counter as 50, add 1 in a register and store 51, so the memory ends at 51 and one increment is lost.](figures/09-lost-update.svg)

In the release build clang writes the three steps as one instruction, `incl counter(%rip)`. One instruction does not help. The core still loads, adds and stores in separate steps, and another core can write the same memory in between.

OSTEP calls a result that depends on this timing a **race condition**. The C standard has a stricter rule. When two threads access the same variable, at least one of them writes, and nothing orders the two accesses, that is a **data race**, and a data race is undefined behavior, like the cases in chapter 04. The compiler may assume that it never happens, so the result can be worse than a lost increment.

The fix in this step is a **mutex**, a lock that only one thread can hold at a time. Call `pthread_mutex_lock` before the increment and `pthread_mutex_unlock` after it. The code between the two calls is a **critical section**.

**ThreadSanitizer**, TSan for short, is the sanitizer for threads. It watches every memory access at run time and reports two accesses from different threads that nothing orders.

Build with it through the `SAN` variable of chapter 01's `build.sh`: `SAN=thread sh build.sh race`. clang cannot combine TSan with AddressSanitizer, so this build replaces `out/Linux-debug/race`. Run `sh build.sh race` again afterwards to get ASan and UBSan back. TSan sees only code that runs, and it slows the program down 5 to 15 times, so never time a TSan build.

> **Practice:** Run every program with threads in three builds: the normal debug build with ASan and UBSan, a TSan build, and the release build many times in a row. A race that shows up once in 50 runs is still a bug. Because TSan is slow, give every threaded test a command-line argument that divides its item counts, and run the TSan build with a tenth of each count.

### Study

- [OSTEP chapter 26: Concurrency: An Introduction](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf) (read, 1 h): Sections 26.1 to 26.7. Figure 26.6 (`t1.c`) is the program you run below, and figure 26.7 traces the lost update instruction by instruction, in 32-bit x86 assembly that you can read from chapter 05. Skip the homework, which uses a Python simulator of x86.
- [OSTEP chapter 27: Interlude: Thread API](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-api.pdf) (read, 45 min): Sections 27.1 to 27.6: create, join, the argument and return-value casts, locks, condition variables and how to compile. On Ubuntu 24.04 the `-pthread` flag it shows is not needed. Section 27.4 previews condition variables, which get their own step later. Skip the homework, which uses valgrind's helgrind. TSan does the same job here.
- [Clang: ThreadSanitizer](https://clang.llvm.org/docs/ThreadSanitizer.html) (read, 15 min): Introduction, Supported Platforms, Usage and Limitations. Linux on x86_64 is on the list.

### Build

1. Write `src/race.c` after figure 26.6: two threads each add 1 to a global `counter` ten million times, and `main` prints the total. The figure calls `Pthread_create` and `Pthread_join`, capitalized wrappers from a header the chapter does not print. Call `pthread_create` and `pthread_join` directly, as in sections 27.1 and 27.2, check that each returns 0, and exit with a message if one does not. Keep the `volatile` on `counter`, as in the figure. As in chapter 07, `volatile` makes clang keep every load and store. Without it the optimizer may turn the loop into one addition. Run the release build five times and record the totals.
2. Run `objdump -d out/Linux-release/race` and find `mythread`. The loop is `incl` on `counter` five times in a row, because clang unrolled the loop: each pass does five increments. Do the same for the debug build and find the separate `mov` that loads `counter` and the `mov` that stores it.
3. Build with `SAN=thread sh build.sh race`, run it, and print the exit status with `echo $?`. Shortened, with your own paths and addresses, the report looks like this:

   ```
   WARNING: ThreadSanitizer: data race (pid=11043)
     Write of size 4 at 0x55f21f010698 by thread T2:
       #0 mythread src/race.c:9:48
     Previous write of size 4 at 0x55f21f010698 by thread T1:
       #0 mythread src/race.c:9:48
     Location is global 'counter' of size 4 at 0x55f21f010698
     Thread T2 (tid=11047, running) created by main thread at:
       #0 pthread_create <null>
       #1 main src/race.c:16:9
   SUMMARY: ThreadSanitizer: data race src/race.c:9:48 in mythread
   ```

   Read it: which two accesses, by which threads, and where each thread was created.
4. Add a `pthread_mutex_t` around the increment. Check the total, run it under TSan again, and time the locked version against a single-threaded loop that does 20 million increments. Time with `read_os_timer` from chapter 07's `platform.c`, included as in chapter 07. Then run `sh build.sh race` to get the ASan and UBSan build back, and run it once.

> **If it fails:** If each TSan run starts with `WARNING: ThreadSanitizer: memory layout is incompatible, possibly due to high-entropy ASLR` and a line about re-executing, the program still runs and the report is valid. The `vm.mmap_rnd_bits` fix from chapter 01 removes the message.

### Done when

`race` loses increments in the release build. TSan reports the race with both stack traces at the increment, and the program exits with status 66, TSan's status for "reported a problem". The mutex version prints exactly 20000000 with no TSan report, and runs clean in the ASan and UBSan build. You can say how much slower the locked version is than the single-threaded loop.

## Atomic instructions and a spin lock

A mutex has to solve the problem from the last step for its own flag. Checking that the flag is 0 and then setting it to 1 is two steps, and two threads can both pass the check before either one sets the flag.

The hardware has **atomic** instructions, which read and write a memory location as one indivisible step. No other core can touch that location in between. On x86-64 the `lock` prefix, an extra byte in front of an instruction, makes an instruction such as `add` or `cmpxchg` atomic, and `xchg` with a memory operand is always atomic. With one of them, a lock is a few lines:

```c
#include <stdatomic.h>

typedef struct { atomic_int locked; } SpinLock;

void spin_lock(SpinLock *l)   { while (atomic_exchange(&l->locked, 1)) {} }
void spin_unlock(SpinLock *l) { atomic_store(&l->locked, 0); }
```

`atomic_exchange` writes 1 and returns the old value in one step. If the old value was 0, this thread took the lock. Otherwise another thread holds it, and this one tries again. A lock whose waiters loop like this is a **spin lock**:

![A spin lock on one word. Thread A's exchange returns 0, so A holds the lock. Thread B's exchanges return 1 until A stores 0, and B's next exchange returns 0.](figures/09-spinlock.svg)

`<stdatomic.h>` is part of C11. Its definition is section 7.17 of N1570, the standard draft you have used as a reference since chapter 04, on printed pages 273 to 286. Look up `atomic_exchange`, `atomic_fetch_add`, `atomic_compare_exchange_strong` and `atomic_load` there. A variable declared `_Atomic int`, or `atomic_int`, can be read and written by several threads without a data race. Every operation in this step uses the default ordering, which step 6 explains.

OSTEP builds this lock from **test-and-set**, an exchange that writes 1. It then builds a **ticket lock** from **fetch-and-add**, an atomic add that returns the old value. Each thread takes the next number from `ticket` and waits until `turn` reaches it, so threads get the lock in arrival order. **Compare-and-swap** writes a new value only if the location still holds an expected one, and the futex lock in step 4 uses it.

Bos's chapter shows what these operations compile to. Her examples are Rust, a language chapter 10 teaches. In this chapter you read Rust and C++ only for the assembly, the timings and the argument, never to write it.

Each of her examples is a function of one or two lines next to its assembly. Read `x.fetch_add(10, Relaxed)` as `atomic_fetch_add_explicit(x, 10, memory_order_relaxed)` and `AtomicI32` as `atomic_int`. Her x86-64 listings are in Intel syntax, as `objdump -d -M intel` prints them. In your own default disassembly, look for these:

- `atomic_exchange` becomes `xchg`.
- `atomic_fetch_add` becomes `lock xadd`, or `lock inc` when the result is not used.
- `atomic_compare_exchange_strong` becomes `lock cmpxchg`.
- `atomic_store` with the default ordering also becomes `xchg`. Step 6 explains why.

A spinning thread burns a core while it waits. If the thread that holds the lock is not running, because the scheduler gave its core to someone else, the waiter spins until that thread runs again. The `yield` lock in the Build gives up the core instead. It calls `sched_yield()`, which takes no arguments, returns 0, and moves the calling thread to the back of the scheduler's queue.

### Study

- [OSTEP chapter 28: Locks](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf) (read, 1 h 15 min): Sections 28.1 to 28.13. Test-and-set, compare-and-swap (figure 28.4), load-linked/store-conditional (figure 28.5) and fetch-and-add are each written as C pseudocode for one hardware operation. Figures 28.3, 28.6 and 28.7 build a lock from test-and-set, LL/SC and fetch-and-add, and figure 28.8 is the yield lock. Section 28.5 on disabling interrupts comes back in the xv6 step. Stop before 28.14, which step 4 assigns. Skip the homework, which uses an x86 simulator.
- [Mara Bos: Rust Atomics and Locks, chapter 7: Processor Instructions](https://marabos.nl/atomics/hardware.html#instructions) (read, 30 min): From "Brief Introduction to Assembly" through "x86 compare-and-exchange instruction". The ARM sections that follow, through "Optimization of Compare-and-Exchange Loops", go with the optional ARM64 item below. Stop at "Caching", which step 5 assigns.

### Build

1. Write `src/locks.c` with three locks behind the same two-function interface, `lock` and `unlock`. Include `platform.c` for the timer, as chapter 07's programs do. Later files with no `main` (`queue.c`, `pool.c`, `ring.c` and `jobs.c`) are shared the same way: each program that uses one includes it with `#include`.
   - `spin`: the `atomic_exchange` loop above.
   - `ticket`: OSTEP figure 28.7 with `atomic_fetch_add` on `ticket` and an atomic load of `turn`.
   - `yield`: the spin lock with `sched_yield()` in the loop body, as in figure 28.8.
2. Write the benchmark. It starts T threads that each run one million iterations of lock, `shared++` on a plain `int64_t`, unlock. Run every lock at T = 1, 2, 4, the `nproc` count and twice the `nproc` count, and skip a count that repeats one before it. Time the whole run with `read_os_timer`, take the best of five runs, and print nanoseconds per lock-unlock pair. After every run, check that `shared` equals T times the iterations.
3. At twice the `nproc` count, give each thread 10,000 iterations instead of a million. A ticket lock with more threads than CPUs can take tens of microseconds per pair, and a million iterations per thread would run for many minutes.
4. Run the benchmark under TSan for every lock, with the iteration counts divided by 10.
5. Compile in release mode and find, in `objdump -d`, the `xchg` in `spin_lock`, the `lock xadd` in `ticket_lock`, and the instruction `spin_unlock` compiles to.

> **Optional:** See the same lock on ARM64, the second instruction set from chapter 05. `locks.c` includes `platform.c`, whose `rdtsc` exists only on x86, so copy `spin_lock` and `spin_unlock` with their `#include <stdatomic.h>` into `spin_arm.c`. Compile it with the cross compiler from chapter 05, `aarch64-linux-gnu-gcc -O2 -S -o - spin_arm.c`, and add `-march=armv8.1-a`, which lets gcc use the single atomic instructions of ARMv8.1, such as `swpal`. Then compile with `-mno-outline-atomics` and no `-march`, and find the `ldaxr` and `stlxr` loop that Bos shows. With neither flag, gcc calls helper functions such as `__aarch64_swp4_acq_rel`, which pick one of the two forms when the program starts.

### Done when

Every lock produces the exact count at every T, with no TSan report. You have a table of nanoseconds per pair for three locks at every thread count. You can explain from the table and OSTEP sections 28.8 and 28.12 what happens to `spin` and `ticket` when there are more threads than CPUs, and why `yield` degrades less. You can point at the instruction that makes `spin_lock` atomic.

## Locks inside xv6, and deadlock

xv6 locks the same way you just did. Its `acquire` spins on `__sync_lock_test_and_set`, a GCC built-in function that becomes the RISC-V instruction `amoswap`, the same atomic exchange as your `spin` lock. `release` stores 0 with `__sync_lock_release`.

The xv6 book explains two things your user-space lock did not need. First, a kernel spin lock turns interrupts off on its CPU while it is held. If an interrupt handler on the same CPU tried to take the same lock, it would spin forever, because the holder cannot run until the handler returns. OSTEP section 6.4, which chapter 08 told you to skip, raises the same question about interrupts that arrive while the kernel is busy.

Second, `acquire` and `release` each contain `__sync_synchronize()`, a **memory barrier**: an instruction that stops the compiler and the CPU from moving loads and stores across it. The barriers keep the protected loads and stores inside the critical section. Steps 6 and 7 are about that second point. For now, note where the barriers are.

Code that holds two locks at once can stop for good. A **deadlock** is a set of threads that each wait for a lock that another one of them holds, so none of them can go on. The smallest case is two threads and two locks: thread 1 holds `a` and waits for `b`, while thread 2 holds `b` and waits for `a`. Section 7.4 of the xv6 book gives the rule that prevents it: every path that takes several locks takes them in one global order. TSan records the order in which each thread takes locks and reports a cycle as a lock-order inversion, even in a run where the timing let both threads finish.

The lab is about contention. `kalloc` and `kfree` share one free list and one lock, so every CPU that allocates a page waits for the others. The fix gives each CPU its own free list and its own lock. When a CPU's list runs dry, it steals pages from another CPU's list, and two CPUs can try to steal from each other at the same moment. Keep this design in mind: per-worker queues with stealing are also the structure of the job system in step 8.

Work in the xv6 lab repository from chapter 08. Section 3.5 of the xv6 book, which the lab asks for, was part of the page-table reading in chapter 08.

> **Practice:** Give every test of concurrent code a time limit, because a deadlock looks like a test that never ends. Call `alarm(10)` at the start of the test program. It asks the kernel to send the signal SIGALRM to the process in 10 seconds. A program with no handler for SIGALRM terminates, so a hung test ends with a nonzero exit status.

### Study

- [xv6 book, chapter 7: Locking](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=63) (read, 1 h 15 min): Sections 7.1 to 7.8, pages 63 to 73, with `kernel/spinlock.c` and `kernel/kalloc.c` open. Figure 7.3 lists every lock in xv6. Section 7.4 is the lock-ordering rule.
- [6.1810 Fall 2025: Lab Lock](https://pdos.csail.mit.edu/6.1810/2025/labs/lock.html) (do, 6 h): "Memory allocator" (per-CPU free lists with stealing) is required. "Read-write lock" is the optional item below. Skip "Submit the lab".
- [GCC: Built-in Functions for Memory Model Aware Atomic Operations](https://gcc.gnu.org/onlinedocs/gcc/_005f_005fatomic-Builtins.html) (reference, as needed): Only for the optional read-write lock: `__atomic_load_n`, `__atomic_store_n`, `__atomic_fetch_add`, `__atomic_compare_exchange_n` and the list of memory orders. The lab's read-write lock hint points to this page.

### Build

1. In the lab repository, commit, run `git checkout lock` and `make clean`, as in chapter 08. Run `kalloctest` before changing anything and save the output.
2. Implement per-CPU free lists with stealing. Name every lock starting with `kmem`, as the lab requires. Turn interrupts off with `push_off` and `pop_off` around `cpuid()`.
3. Run `kalloctest`, `usertests -q` and `make grade`.
4. Back in your own repository, write `src/deadlock.c` with two global mutexes `a` and `b` and `alarm(10)` at the start of `main`. Thread 1 locks `a`, sleeps for a millisecond with `usleep(1000)`, locks `b`, then unlocks both. Thread 2 does the same with `b` first. Run the release build. It hangs until the alarm ends it, the shell prints `Alarm clock`, and `echo $?` prints 142, which is 128 plus 14, the number of SIGALRM.
5. Add a command-line argument `seq` that joins thread 1 before it starts thread 2, so the two never overlap. Run `./out/Linux-debug/deadlock seq` in a TSan build. It finishes, and TSan still prints `WARNING: ThreadSanitizer: lock-order-inversion (potential deadlock)` with the two places where each mutex was taken while the other was held.
6. Fix the order: thread 2 takes `a` first too. Check that the two-thread run finishes and that the TSan build reports nothing.

> **Optional:** The second half of the lab is a read-write spin lock: many readers at once, or one writer, and a waiting writer blocks new readers so it cannot starve. You write it with GCC's `__atomic` built-in functions, the same operations as `<stdatomic.h>` with the ordering spelled as an argument. Use `__ATOMIC_SEQ_CST` everywhere and pass `rwlktest`. Two shorter extras: exercise 1 in section 7.9 of the xv6 book removes the locks from `kalloc` to show how rarely a missing lock causes a visible failure, and the lab's KCSAN race detector checks your allocator with `make clean`, then `make KCSAN=1 qemu`, then `kalloctest` inside xv6.

### Done when

`make grade` says the kalloc tests pass, and `usertests -q` passes. Your `kalloctest` output before and after shows the drop in `#test-and-set` iterations on the `kmem` locks. You can explain why `acquire` disables interrupts before it spins and not after, and why your stealing code cannot deadlock when two CPUs try to steal from each other at the same time. `deadlock` hangs and is ended by the alarm, TSan reports the inversion in the `seq` run, and the fixed order makes both go away.

## Sleeping instead of spinning: futex and condition variables

`yield` gives the core away, but the waiting thread still wakes up again and again to retry. A sleeping lock asks the kernel to put the waiter to sleep until the holder lets go, and the waiter then uses no CPU at all.

On Linux the system call for this is **futex**, short for fast user-space mutex. It works on one `int` in your own memory:

- `FUTEX_WAIT` puts the calling thread to sleep, but only if the `int` still holds a value you pass. The kernel checks the value and starts the sleep as one step. If the value already changed, the call returns at once with the error `EAGAIN`, so a wakeup that arrives between your check and your sleep is never lost.
- `FUTEX_WAKE` wakes up to a given number of threads that sleep on that `int`.

A common futex lock uses three states: 0 for unlocked, 1 for locked with no waiters, and 2 for locked with possible waiters. It calls the kernel only when a thread must sleep or must be woken:

![The futex lock's word has three states: 0 unlocked, 1 locked with no waiters, 2 locked with possible waiters. Locking a free lock and unlocking from 1 need no system call. Only waiting at 2 and unlocking from 2 enter the kernel.](figures/09-futex-states.svg)

```
lock:    c = compare_exchange(m, 0 -> 1)      returns the old value
         if c == 0: return                     fast path, no system call
         if c != 2: c = exchange(m, 2)
         while c != 0:
             futex_wait(m, 2)                  sleeps only if *m is still 2
             c = exchange(m, 2)
unlock:  if exchange(m, 0) == 2: futex_wake(m, 1)
```

A thread that wakes up takes the lock with `exchange(m, 2)`, not with 1, because other threads may still be asleep, and its own unlock must wake one of them. glibc's `pthread_mutex_lock` is built on the same system call. glibc has no wrapper function for `futex`, so call it through the C library's `syscall` function, which makes any system call by its number: `syscall(SYS_futex, ...)`. The `-c` option of `strace` from chapter 08 prints a count of each system call instead of listing every call.

A lock lets a thread wait for another thread to leave. A **condition variable** lets a thread sleep until some other thread signals that a condition may have changed, such as a queue no longer being empty. `pthread_cond_wait(&cv, &mutex)` releases the mutex and sleeps as one step, and takes the mutex again before it returns. That closes the same window that `FUTEX_WAIT` closes. `pthread_cond_signal` wakes one waiting thread and `pthread_cond_broadcast` wakes all of them. Two rules make it work:

- Wait in a `while` loop that checks the condition, never in an `if`. A wakeup does not prove that the condition holds, because another thread may have taken the item first.
- Keep a state variable that the condition checks, such as the item count. A signal sent when nobody waits is lost, and the count still records what happened.

The queue you build has the **producer and consumer** shape: producer threads push items and consumer threads pop them. Inside it are a fixed array used as a ring, a count, one mutex and two condition variables:

![The bounded queue holds a ring of slots, a mutex and two condition variables. Producers that find it full wait on not_full, and each pop signals it. Consumers that find it empty wait on not_empty, and each push signals it.](figures/09-bounded-queue.svg)

```
  push(q, x):  lock; while (count == cap && !closed) wait(not_full)
               if closed: unlock; return false
               store x at tail; tail = (tail + 1) % cap; count++
               signal(not_empty); unlock; return true

  pop(q, &x):  lock; while (count == 0 && !closed) wait(not_empty)
               if count == 0: unlock; return false     closed and drained
               load x from head; head = (head + 1) % cap; count--
               signal(not_full); unlock; return true
```

A `closed` flag set under the mutex, followed by a broadcast on both condition variables, wakes every waiter. After `queue_close`, pushes fail, and pops keep returning items until the queue is empty and then return false. A **thread pool** sits on top: N worker threads that loop on `pop` and call the function pointer in each item.

### Study

- [OSTEP chapter 28: Locks](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf) (read, 20 min): Sections 28.14 to 28.17: a lock with a queue of sleeping threads, Linux's futex lock in figure 28.10 (glibc's version, which packs the same three states differently), and two-phase locks, which spin for a while before they sleep. Skip the homework.
- [Linux man page: futex(2)](https://man7.org/linux/man-pages/man2/futex.2.html) (read, 20 min): DESCRIPTION up to "Futex operations", then EXAMPLES for the `syscall` wrapper. Then follow the links to FUTEX_WAIT(2const) and FUTEX_WAKE(2const) and read DESCRIPTION, RETURN VALUE and ERRORS on both: the expected value, `EAGAIN` when the value already changed, and `EINTR` when a signal interrupted the sleep. Your loop handles both by checking the value again.
- [OSTEP chapter 30: Condition Variables](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-cv.pdf) (read, 1 h 15 min): Sections 30.1 to 30.4. Figures 30.8 to 30.11 are two broken producer/consumer versions with traces of how they fail. Find the failing interleaving yourself before you read each trace. Figures 30.12 to 30.14 are the correct version. Skip the homework.

### Build

1. Add two locks to `locks.c`: `mutex`, a `pthread_mutex_t`, and `futex`, the three-state lock above, with `FUTEX_WAIT` and `FUTEX_WAKE` from `<linux/futex.h>` and `SYS_futex` from `<sys/syscall.h>`. Rerun the step 2 benchmark for all five locks, and run the two new ones under TSan.
2. Give `locks` a mode that runs one lock at one T, such as `./out/Linux-release/locks futex 4`. Run `strace -f -c -e trace=futex` on it at T = 1 and at T = 4. `-f` follows every thread, as it followed child processes in chapter 08. Find the `lock cmpxchg` of the fast path in the disassembly of `futex_lock`.
3. Write `src/queue.c` with `queue_init(q, cap)`, `queue_push`, `queue_pop`, `queue_close` and a non-blocking `queue_try_push` that returns false when the queue is full. The queue holds `struct { void (*fn)(void *); void *arg; }` items.
4. Write `src/pool.c` with `pool_start(n)`, `pool_submit(fn, arg)` and `pool_stop()`. `pool_stop` closes the queue, lets the workers drain it, and joins them.
5. Write `src/queue_test.c`, under `alarm(10)` as in step 3. The thread tests of this chapter live in `src/` and build with `build.sh`, because you run each one in the release build and under TSan as well, and `tests/run_test.sh` makes only the debug build. They keep chapter 02's `check` function and exit status:
   - Exactly once: 4 producers push items with distinct ids and 4 consumers pop them. Each consumer does `atomic_fetch_add(&seen[id], 1)`. At the end every `seen[id]` is 1. At capacity 1024, push 250,000 items per producer, ids 0 to 999,999. At capacities 1, 2 and 3, push 20,000 per producer, ids 0 to 79,999. Every handoff at a small capacity costs a sleep and a wake, and the large count would run past the alarm.
   - Wraparound: one producer and one consumer, capacity 3, 200,000 items, checked in order.
   - Close while idle: start 8 consumers on an empty queue, close it, and join all of them within 100 ms.
   - Close with pending items: push 1000 items with no consumers, close, then start consumers. All 1000 are popped and the next pop returns false.
   - The pool: submit 100,000 jobs that each increment an atomic counter, stop the pool, and check the counter.
6. Run the tests in the debug build, in release mode, and under TSan with every item count divided by 10.

### Done when

Every lock produces the exact count at every T with no TSan report, and you have the table for five locks. You can explain why `mutex` and `futex` degrade less than `spin` and `ticket` past the CPU count. At T = 1 the strace table shows at most a few `futex` calls, from thread start and join, and at T = 4 it shows thousands, some of them failing. You can say which failure that is and why it is harmless. Every queue test passes 100 times in a row in the release build (`for i in $(seq 100); do ./out/Linux-release/queue_test || break; done`) and once under TSan with no report. Change one `while` in `queue_pop` to `if` and find a test that fails, then change it back. You can state, for each condition variable, which condition it stands for and who signals it.

## Cache lines, contention and speedup

Where the problem allows it, threads should share nothing while they work. Give each thread its own range of the input and its own result slot, and combine the results after `pthread_join`. The join orders everything the thread did before everything the joining thread does next, so the combine step needs no lock. Even then, T threads rarely run T times faster. Three effects explain most of the gap: the caches, the serial part of the program, and the cores themselves.

Each core's cache keeps copies of 64-byte lines, the line size you read from `coherency_line_size` in chapter 07. A **coherence protocol** keeps the copies consistent. A core that writes a line takes it into its own cache as the only copy and invalidates every other copy. If two cores keep writing to the same line, the line moves back and forth between their caches on every write. That happens even when they write different variables that sit in the same line, which is called **false sharing**:

![Two cores write different counters that sit in the same 64-byte line, so the line moves between their caches on every write. With each counter aligned to 64 bytes, each line stays in one cache.](figures/09-false-sharing.svg)

`_Alignas(64)` on a struct member starts it on a 64-byte boundary, so a struct with one counter and that alignment fills a line of its own. Bos notes that some processors need 128 bytes to stop the effect, and the Build checks yours.

If a fraction s of the run cannot be split, T threads finish in at least s + (1 - s)/T of the single-thread time. That is **Amdahl's law**. Your haversine pipeline from chapter 07 reads and parses the JSON on one thread. Splitting only the distance sum leaves the parse untouched, so the end-to-end speedup has a ceiling you can compute from your profile.

`nproc` counts logical CPUs, and Windows Task Manager's Performance tab shows how many cores and logical processors the laptop has. Many x86-64 cores run two threads at the same time, which then share that core's execution units, so `nproc` can be twice the number of cores. Many recent Intel laptop chips are also hybrid, with fast performance cores and slower efficiency cores, as chapter 07 said.

Under WSL2, Windows decides which physical core runs each of Linux's CPUs at any moment. An equal split of the work then makes threads finish at different times. Record when each thread finishes. The difference between the first and the last finish is **load imbalance**, and step 8 attacks it.

### Study

- [Mara Bos: Rust Atomics and Locks, chapter 7: Caching](https://marabos.nl/atomics/hardware.html#caching) (read, 40 min): "Caching", "Cache Coherence" with "The write-through protocol" and "The MESI protocol", then "Impact on Performance" with "Failing Compare-and-Exchange Operations". Each Rust program is a loop of one load or store on an atomic, timed. Read the prose and the x86-64 timings, and write the same loops in C below. Her `black_box` keeps the compiler from deleting the loads, and in C printing a sum of the loaded values does that job. Stop at "Reordering".
- [OSTEP chapter 29: Lock-based Concurrent Data Structures](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks-usage.pdf) (read, 30 min): Section 29.1 only, "Concurrent Counters", with figures 29.2 to 29.6. The approximate counter keeps one local count per CPU and moves it to the global count every S increments. Skip 29.2 onward.

### Build

Run the timings in this step in the release build, plugged in and in Windows' best performance power mode as in chapter 07, best of five runs, at T = 1, 2, 4, half the `nproc` count and the `nproc` count. Skip a count that repeats one before it.

1. Write `src/psum.c`. Take the element count from the command line. Fill an array of that many `uint64_t` with `i * 2654435761 % 1000` and sum it with T threads. Pass each thread a struct with its start, end and a `uint64_t sum` field that only that thread writes. Join all threads, then add the partial sums. A single-threaded sum is the oracle. Check every `pthread_create` and `pthread_join` return value. Time each T at 100 million elements, and run the debug build and the TSan build at 10 million.
2. `src/counters.c`: T threads each do 20 million increments in five layouts. Print nanoseconds per increment per thread, and check every total.
   - (a) One shared `atomic_long`, all threads adding to it.
   - (b) An array of T `atomic_long`, one per thread, next to each other in memory.
   - (c) The same array with each counter in a struct declared `_Alignas(64)`.
   - (d) A plain local `long` in each thread, stored to the thread's result slot once at the end. clang may turn that loop into a single addition. Check the disassembly and record what it did.
   - (e) OSTEP's approximate counter with thresholds S = 1, 64 and 4096. With S = 1 every increment takes the global mutex, so use 10 million increments per thread for S = 1.
3. Repeat Bos's experiment in C: one thread loads `a[1]` a billion times while a second thread stores to `a[0]` and `a[2]`. Add each loaded value to a sum that you print, so the loads stay in the program. Time it with `a` as three adjacent `atomic_long`, again with each one `_Alignas(64)`, and once with no second thread. If 64 does not bring the time back to the no-thread case, try 128 and record the result.
4. Add a test-and-test-and-set lock to `locks.c`: spin on `atomic_load` until the lock looks free, then try `atomic_exchange`. Rerun the step 2 table for `spin` and the new lock.
5. `src/hav3.c`: copy `hav2` from chapter 07 and split only the distance loop across T threads, with static chunks of the four arrays and a private partial sum per thread. Record per-thread finish times. Measure the time of the sum stage alone and of the whole run at 10,000,000 pairs. The sum's floating-point order changes with T, so check the average against the answer file with the 1e-9 rule, not with `==`.
6. Plot the speedup of `psum`, of the haversine sum stage and of the whole haversine run against T with matplotlib, next to the Amdahl curve for the serial fraction your chapter 07 profiler reports.

### Done when

`psum` matches the oracle exactly for every T and runs clean under TSan and in the debug build, and you can say why the per-thread `sum` fields need no lock. You have the five-layout counter table and the three-case Bos table, and you can explain each number with the coherence argument: who owns the line, and how often it has to move. `hav3` passes the 1e-9 rule at every T. Your plot shows the measured end-to-end speedup at or below the Amdahl curve, and you can say how far below and why. From the per-thread finish times, you can say at which T the threads stop finishing together, and whether the cause is two threads per core, efficiency cores, or both.

## The store buffer and sequential consistency

Every hand-off so far went through a lock or a join. To hand data from one thread to another without them, you need a precise rule for what the second thread can see, and when. This step shows what the hardware does, and the next step gives the rule.

Within one thread, the compiler and the CPU may reorder loads and stores whenever the thread itself cannot tell. The reordering other cores can see on x86-64 comes from the **store buffer**: a queue in each core where stores wait before they reach the cache. The core goes on with later instructions while a store waits, so a later load from a different address can read the cache before the earlier store has left the buffer. For another core, the load happened first.

The **litmus test** for this, a tiny program whose possible results define what the hardware allows, has two threads that each store 1 to one variable and then load the other. Both loads can return 0:

![Each core's store of 1 waits in its store buffer while its next load reads the other variable from memory, where it is still 0. Both loads return 0.](figures/09-store-buffer.svg)

That is the only reordering x86-64 allows. Its rules are called **TSO**, for total store order. ARM64 lets a core reorder almost any two memory operations, and your ring and job system must be correct there too. So the C standard gives you rules that hold on every CPU, and the compiler emits whatever instructions your CPU needs to keep them. Each atomic operation has an `_explicit` form, such as `atomic_store_explicit(&x, 1, memory_order_relaxed)`, that takes an ordering as its last argument. Two orderings matter in this step:

- `memory_order_seq_cst`, **sequentially consistent**, is the default that every operation so far used. All such operations in the program appear in one global order that every thread agrees on, and each thread's own operations keep their program order in it. On x86-64 a sequentially consistent store becomes `xchg`, which waits for the store buffer to drain. That is why `spin_unlock` compiled to `xchg` in step 2.
- `memory_order_relaxed` makes a single access atomic and promises nothing about other memory. A relaxed store and load are plain `mov` instructions. Relaxed suits a statistics counter and nothing that publishes data.

`atomic_thread_fence(memory_order_seq_cst)` is a full barrier on its own, the kind xv6 calls with `__sync_synchronize()`. It compiles to `mfence` on x86-64. Bos writes these two orderings in Rust as `SeqCst` and `Relaxed`. Sections 7.17.3 and 7.17.4 of N1570 are the C wording of the orderings and fences.

### Study

- [Mara Bos: Rust Atomics and Locks, chapter 7: Reordering](https://marabos.nl/atomics/hardware.html#reordering) (read, 1 h): "Reordering", then "Memory Ordering" through "Memory Fences": "Other-Multi-Copy Atomicity", "x86-64: Strongly Ordered", "ARM64: Weakly Ordered", "An Experiment" and "Memory Fences". The text refers to its chapter 3 for the formal rules. Preshing covers those rules for C and C++ in the next step, so skip the references.
- [Jeff Preshing: Memory Reordering Caught in the Act](https://preshing.com/20120515/memory-reordering-caught-in-the-act/) (read, 20 min): The whole post. It is the store buffer litmus test, with semaphores that start both threads together in each round. The code is C++ that reads as C. Its `MersenneTwister` is a random number generator, and any small one works, such as xorshift: `x ^= x << 13; x ^= x >> 17; x ^= x << 5;` on a `uint32_t`.

### Build

1. Write `src/litmus.c` after Preshing's post. A **semaphore** is a counter that threads can wait on. `sem_post` adds 1 and wakes a waiter, and `sem_wait` waits until the count is above 0 and then subtracts 1. They come from `<semaphore.h>`, and `sem_init(&s, 0, 0)` starts one at 0. `main` posts one semaphore per thread to start a round, so both threads start their store at almost the same moment, and then waits twice on a third semaphore until both have stored their result.
2. Make `X` and `Y` `atomic_int`, and `r1` and `r2` plain `int`. The semaphores order `r1` and `r2` against `main`, so they need no atomics. A command-line argument picks one of three versions of the store and the load:
   - relaxed store, then relaxed load
   - default store, then default load
   - relaxed store, `atomic_thread_fence(memory_order_seq_cst)`, relaxed load
3. Before each store, add the post's short random delay, `while (next_random(&seed) % 8 != 0) {}`, with a different seed in each thread. A second command-line argument turns the delay off.
4. Run each version for 1,000,000 rounds in the release build and print how many rounds ended with both `r1` and `r2` at 0. Run the relaxed version with and without the delay and record both counts.
5. In `objdump -d`, find the `mov` pair of the first version, the `xchg` of the second and the `mfence` of the third.
6. Run the first version again with `taskset -c 0`, which keeps all its threads on CPU 0.
7. Run the first version once under TSan with a tenth of the rounds.

### Done when

The relaxed version reports reorderings (if none show up in a million rounds, run ten million and record what you see), and the other two versions report none. You can say which instruction prevents the reordering in each of them. With `taskset -c 0` the first version reports none, and you can say why one CPU never sees its own stores out of order. TSan reports nothing, and you can say why: every shared access is atomic, so there is no data race, even though the result is one that no interleaving of the two threads could produce.

## Release, acquire and a single-producer ring

A sequentially consistent store costs an `xchg` on x86-64, which waits for the store buffer to drain. Most hand-offs between two threads need a weaker pair of orderings.

A store with `memory_order_release` and a load with `memory_order_acquire` on the same atomic variable pair up when the load reads the value the store wrote. The two then **synchronize**, and everything the storing thread did before the release **happens before** everything the loading thread does after the acquire. A happens before B means that B is guaranteed to see every write A made. Preshing calls the atomic variable the guard and the data it protects the payload:

![Thread A writes the payload, then stores 1 to the guard with release. Thread B loads the guard with acquire. When B's load reads A's 1, the two synchronize, and B's later reads see the payload.](figures/09-release-acquire.svg)

On x86-64 an acquire load and a release store are plain `mov` instructions, because TSO already keeps those orders. On ARM64 they are `ldar` and `stlr`. They do not stop the store buffer case of the last step, because there the store and the load touch different variables. A mutex lock is an acquire and an unlock is a release, and the barriers in xv6's `acquire` and `release` give those functions the same properties. A missing release or acquire does not show up on your laptop, but the code still has a data race under C's rules, can fail on ARM64, and TSan reports it. The C spellings of the Rust and C++ you read are:

```
  Rust or C++                        C11
  x.store(v, Release)                atomic_store_explicit(&x, v, memory_order_release)
  x.load(Acquire)                    atomic_load_explicit(&x, memory_order_acquire)
  x.swap(v, Relaxed)                 atomic_exchange_explicit(&x, v, memory_order_relaxed)
  compiler_fence(Acquire)            atomic_signal_fence(memory_order_acquire)
  std::memory_order_release          memory_order_release
```

A **lock-free** queue is one that threads share without taking any lock. The simplest one has exactly one producer thread and one consumer thread, and it is guard and payload used over and over.

The **ring buffer** is an array and two indexes. The producer writes the item into the slot at `tail`, then publishes it by storing `tail + 1` with release. The consumer loads `tail` with acquire, reads the item at `head`, then hands the slot back by storing `head + 1` with release. The producer loads `head` with acquire before it reuses a slot.

![A ring of 16 slots with head = 19 and tail = 25, so the items 19 to 24 sit in slots 3 to 8. The consumer owns those slots, and the producer owns the free ones. Each index sits on its own cache line next to a private copy of the other index.](figures/09-spsc-ring.svg)

The capacity is a power of two. The indexes count up forever, and the slot of index i is `i & (cap - 1)`. The ring is full when `tail - head == cap` and empty when they are equal. Wellons calls the release store the commit: it moves one slot to the other thread, and neither thread touches a slot it does not own.

His indexes have the opposite names: his consumer pops at `tail`. Keep this chapter's names.

Each thread also keeps a private copy of the other thread's index and reloads it only when the ring looks full or empty, so most pushes and pops touch only the thread's own line. Put each index and that copy on a cache line of its own with `_Alignas(64)`, for the reason step 5 measured.

> **Practice:** Use the default ordering or a lock. Write `acquire` or `release` only where you can name the guard, the payload and the pair of operations that synchronize, and write that argument in a comment next to the code.

### Study

- [Jeff Preshing: The Synchronizes-With Relation](https://preshing.com/20130823/the-synchronizes-with-relation/) (read, 25 min): The whole post. It uses C++11 atomics. Read `g_guard.store(1, std::memory_order_release)` as `atomic_store_explicit(&g_guard, 1, memory_order_release)`. The guard and payload vocabulary in the post is the one this chapter uses for every argument you write.
- [Chris Wellons: A lock-free, concurrent, generic queue in 32 bits](https://nullprogram.com/blog/2022/05/14/) (read, 25 min): From the start through "Push operation". Note the comments that say "consider acquire" and "consider release". Your ring uses those orderings and two separate indexes instead of one packed integer. The later sections are in the optional item below.

### Build

1. Add a fourth version to `litmus.c`: release store, then acquire load. Run it for 1,000,000 rounds and find its `mov` pair in the disassembly.
2. `src/ring.c`: a bounded single-producer, single-consumer ring of `uint64_t` with `ring_init(r, cap)`, `ring_try_push` and `ring_try_pop`, which return false when full or empty instead of blocking. Put `head` and `tail` in separate `_Alignas(64)` fields, each next to the private copy that the same thread keeps.
3. Write the memory-ordering argument as a comment block at the top of `ring.c`. For each atomic access, state its ordering and the access it pairs with, and for each slot, which thread owns it at each moment.
4. `src/ring_test.c` under `alarm(10)`: push 0 to N - 1 from one thread and pop in another, checking that each value equals the previous plus 1. Use N = 10,000,000 at capacities 2 and 4, where the index lines move between cores every few items, and N = 100,000,000 at capacity 1024. A spin when full or empty is fine here. Run it under TSan with N = 100,000.
5. Change the release store of `tail` to relaxed. Run the release build and the TSan build, then change it back.
6. Time the ring against your step 4 queue with one producer and one consumer at capacity 1024, in items per second.

> **Optional:** Wellons's sections "Multiple-consumers" and "A less cheeky design" extend the queue to several consumers with compare-and-swap, and the last lines of "A less cheeky design" point at the false sharing your step 5 counters measured. The section "As a concurrent hash map" in his arena hash map post, which chapter 04 told you to skip, uses the same acquire and release pair to insert into your hash trie from several threads.

> **Optional, on the Mac:** Bos ends her chapter with a spin lock whose exchange and store are relaxed, which loses increments on an M1 and never on x86-64. Write it in C as `src/relaxed.c`: four threads each do a million iterations of `atomic_exchange_explicit(&locked, 1, memory_order_relaxed)` in a loop, `atomic_signal_fence(memory_order_acquire)`, a relaxed load of `counter`, a relaxed store of that value plus 1, `atomic_signal_fence(memory_order_release)`, and `atomic_store_explicit(&locked, 0, memory_order_relaxed)`. Build it with `clang -O2` on the Mac, print the final counter over 200 runs, then make the exchange acquire and the store release. In WSL2 the relaxed version never loses an increment, and `qemu-aarch64` does not reproduce ARM64's reordering reliably, so the Mac is the only place to see it.

### Done when

The release and acquire version of `litmus` still reports reorderings, and you can say why release and acquire do not stop them. `ring_test` passes 100 release runs in a row at every capacity, and once under TSan with no report. The comment block in `ring.c` names every pairing. With the relaxed store, the release build still passes, because x86-64 emits the same `mov` for both, and TSan reports a race on the item array. You can say which happens-before edge you removed and what an ARM64 core could then do. You have items per second for the ring and the queue.

## Work stealing

The static split in step 5 works when every chunk costs the same and every core runs at the same speed. Neither holds in general. The fix is **dynamic assignment**: cut the work into many more pieces than there are threads, and let a thread take the next piece when it finishes the last one. The step 4 pool does this with one shared queue, and every take goes through one mutex. With small jobs that mutex is the same contention you measured on `kmem.lock` in xv6.

A job system gives each worker its own **deque**, a double-ended queue. A worker pushes new jobs onto the bottom of its own deque and pops from the bottom, so it runs its newest job next while that job's data is still in cache. When its deque is empty, it picks another worker at random and steals from the top, which holds that worker's oldest and usually largest job. That is **work stealing**. Owner and thief work at opposite ends, so they rarely want the same lock at the same moment.

![Each worker has a deque. Its owner pushes and pops jobs at the bottom. Worker 1's deque is empty, so it steals j6, the oldest job, from the top of worker 2's deque and runs it.](figures/09-work-stealing.svg)

A thread that is not a worker, such as `main` or the server's event loop in step 10, has no deque. Its `job_run` puts the job on one shared **injection queue**, your step 4 queue, and workers check it after their own deque and before stealing. Each thread finds out whether it is a worker from a `_Thread_local int`. `_Thread_local` is C11's per-thread storage: every thread sees its own copy of the variable.

Store the worker's index in it, and -1 in every other thread. Reading it costs one `mov` from an address relative to the `%fs` register, the same register as the stack canary of chapter 05.

Keep every deque behind its own mutex. Idle workers must not spin forever, and must not take a lock that every `job_run` takes. Use this design:

- One `idle` mutex and one condition variable `wake`, an atomic `queued` count of jobs in any deque or the injection queue, and an atomic `sleepers` count, all with the default ordering.
- `job_run` pushes the job, adds 1 to `queued`, and only if `sleepers` is above 0 takes `idle` and signals `wake`. Each pop or steal subtracts 1 from `queued`.
- A worker that finds nothing after a full round of steals takes `idle`, adds 1 to `sleepers`, reads `queued` again, and waits on `wake` only while `queued` is 0. When it wakes, it subtracts 1 from `sleepers`, releases `idle` and looks for work.
- `jobs_stop` sets a stop flag under `idle` and broadcasts on `wake`, and a worker leaves its loop when the flag is set and `queued` is 0.

Without the second read of `queued`, a job pushed between a worker's last failed steal and its wait would sit in a deque while every worker sleeps. The two counts form the store buffer pattern of step 6, which is why both use the default ordering.

This step builds the part of the job system that runs independent jobs. A **detached** job has no parent and no children, and nobody waits for it, so the worker that runs it frees it when its function returns. `malloc` and `free` are safe to call from any thread, and a block may be freed by a different thread than the one that allocated it. The next step adds jobs that wait for other jobs:

```c
typedef struct Job Job;
typedef void JobFn(void *arg);

void jobs_start(int nworkers);
Job *job_new_detached(JobFn *fn, void *arg);
void job_run(Job *job);      // push on this worker's deque, or on the injection queue
void jobs_stop(void);        // waits for all queued jobs, then joins the workers
```

### Study

- [Stanford CS149 Fall 2025: Work Distribution and Scheduling (slides)](https://gfxcourses.stanford.edu/cs149/fall25content/media/perfopt1/05_progperf1.pdf#page=5) (read, 1 h): Slides 5 to 22 on static and dynamic assignment, task size, scheduling long tasks first and distributed queues. Then slides 26 to 49. Slides 26 to 32 introduce the `cilk_spawn` and `cilk_sync` notation, and 33 to 49 build the scheduler: a worker pool, per-thread deques, child-first or continuation-first execution, stealing from the top and choosing a victim.

### Build

1. `src/mandel.c` renders an image of the Mandelbrot set, the uneven workload of this step. Each pixel stands for a complex number c, kept as two `double`s, its real and imaginary parts. Start with z = 0 and repeat z = z * z + c until |z|^2 > 4 or 1000 iterations pass. Rows through the middle of the set run all 1000 iterations for many pixels, and rows near the top and bottom stop after a few. Make the image 1024 by 1024 over real parts -2.0 to 1.0 and imaginary parts -1.5 to 1.5, and store each pixel's iteration count, scaled to 0 to 255, as one byte. Write the single-threaded image first, which is the oracle, then a static version that gives each of T threads 1024/T consecutive rows. Record per-thread finish times.
2. Write each image as a binary PGM file: the header `P5\n1024 1024\n255\n` followed by the bytes. `ls -l` shows 1048591 bytes, the 15-byte header plus one byte per pixel, and `cmp oracle.pgm static.pgm` prints nothing when the two are equal. Pillow from chapter 05 reads PGM, so `python3 -c "from PIL import Image; Image.open('mandel.pgm').save('mandel.png')"` converts it if you want to look at it.
3. Add `queue_try_pop` to your step 4 queue, which returns false at once when the queue is empty. Workers use it on the injection queue.
4. `src/jobs.c` with the interface above: a fixed-capacity deque per worker behind a mutex (if a push finds it full, run the job right away instead), the injection queue, random victims and the sleeping design above. Count each worker's successful steals.
5. `src/jobs_test.c`, each test under `alarm(10)`:
   - Exactly once: 1,000,000 detached jobs from `main`, each doing `atomic_fetch_add(&seen[i], 1)`, then `jobs_stop`. Every entry ends at 1.
   - From inside a worker: one job that runs 100,000 detached jobs of its own. They land on its worker's deque, and the steal counts show the other workers taking them.
   - Uneven: 10,000 jobs where job i spins for (i % 100) microseconds, with no lost or doubled jobs.
   - Shutdown with an idle pool, and shutdown right after submitting 10,000 jobs, where every job still runs once.
   - No leaks: run the exactly-once test under your AddressSanitizer debug build. LeakSanitizer reports any job that was never freed.
6. Run the tests 100 times in release mode, and once under TSan with every job count divided by 10.
7. Render Mandelbrot with one detached job per row. Submit them from one job, so they start on one deque and the other workers must steal them. Time it from `jobs_start` to the return of `jobs_stop` at T equal to the `nproc` count, against the static split of item 1.

> **Optional:** CS149 slides 51 to 62 implement `cilk_sync`, which solves the problem of the next step another way. A lock-free deque, the Chase-Lev design, is a stretch goal for after this chapter, and only after the locked version is tested and measured.

### Done when

All job tests pass 100 release runs in a row and one TSan run with no report. The row jobs produce the same bytes as the single-threaded oracle (`cmp` prints nothing). Mandelbrot through the job system beats the static row split, every worker has steals, and you can explain the difference from the static version's per-thread finish times.

## Waiting for jobs: groups and parallel_for

Detached jobs cannot return results to anyone who waits. A parallel sum needs every chunk done before it adds the partial sums, and a job that splits its work needs its children done before it can use them.

A job can create child jobs. Each job has an atomic count of unfinished work: 1 for itself plus 1 per child not yet finished. `job_new` with a parent adds 1 to the parent's count. When a job's function returns, its count drops by 1, and when the count reaches 0 the job tells its parent by dropping the parent's count the same way. `job_wait(j)` runs other jobs, its own or stolen ones, until `j` is done, so a thread that waits keeps a core busy.

A job cannot wait on its own count, because the 1 for itself stays until its function returns. A job that needs results from children makes a group instead: a root job with no parent and an empty function, the children under that root, `job_run` on all of them, then `job_wait(root)`. Create every child before you run the root, or the root's count can reach 0 while you are still adding to it. Because `job_wait` runs other jobs while it waits, this works without deadlock even with a single worker.

Reinalter's post builds this design. It also shows a lifetime bug: the thread that finishes a job may still touch it after another thread has seen the count reach 0. His fix lets the count fall to -1 after the parent has been told, and `Wait` treats only -1 as done:

![A root with three children. Each count is 1 for the job itself plus 1 per unfinished child. When a's count reaches 0 it tells the root, then stores -1. Only when every count reads -1 may job_wait free the group.](figures/09-job-counts.svg)

His post never frees a job early. It collects every job in a global array and deletes them all at the end of a frame. This chapter has no frame, so use this ownership rule instead:

- The last write a finishing job makes to itself is storing -1 in its own count, after it has told its parent.
- `job_wait` takes only a root, a job with no parent. The thread that calls it owns the root and every job created under it. Every root gets exactly one `job_wait`.
- Each job stores a `root` pointer. A root points to itself, and `job_new` with a parent copies the parent's `root`. Each root keeps a list of its descendants behind a mutex, and `job_new` adds the new job to the list of its `root`.
- `job_wait(root)` returns after the root's count reads -1. Before it returns, it walks the list, waits until each job's count reads -1, and frees it, then frees the root. A descendant that has told its parent is at most one store from -1, so that wait is short.
- Detached jobs from the last step stay as they are. The server in step 10 uses them.

His post relies on x86's ordering, as its disclaimer says. Your laptop is x86-64, so a copy of his barriers would pass every test there and still race under C's rules. Use `<stdatomic.h>` with the default ordering for every count. The step adds three functions to the interface:

```c
Job *job_new(JobFn *fn, void *arg, Job *parent);  // parent may be NULL for a root
void job_wait(Job *root);    // root only: runs other jobs until root is -1, then frees the group
void parallel_for(int64_t n, int64_t grain,
                  void (*body)(int64_t lo, int64_t hi, void *ctx), void *ctx);
```

`parallel_for` makes a root, splits `[0, n)` in half recursively as jobs under that root until a range is at most `grain` long, calls `body` on each range, and returns after `job_wait(root)`. It works the same from `main` and from inside a job.

### Study

- [Stefan Reinalter: Job System 2.0: Lock-Free Work Stealing, Part 1: Basics](https://blog.molecular-matters.com/2015/08/24/job-system-2-0-lock-free-work-stealing-part-1-basics/) (read, 40 min): The whole post. Its queues and stealing repeat the last step, and the parts on parent jobs, `Wait` and the -1 fix are new. The code is C++ that reads as C: `nullptr` is `NULL`, `new` and `delete` are `malloc` and `free`, and `atomic::Decrement` is `atomic_fetch_sub(..., 1) - 1`. Skip the later parts of the series. Part 3 builds a lock-free deque with barriers chosen for x86.

### Build

1. Add `job_new`, `job_wait` and `parallel_for` to `src/jobs.c`, with the `root` pointer and the -1 ownership rule for freeing jobs.
2. Add to `src/jobs_test.c`, each test under `alarm(10)`:
   - Exactly once in a group: one root job with 1,000,000 children, each doing `atomic_fetch_add(&seen[i], 1)`, then `job_wait(root)`. Every entry ends at 1.
   - Nested: `parallel_for` with grain 1 over 100,000 elements, and with grain 64 and grain 100,000 over 10,000,000 elements, each summing into a per-chunk slot, checked against a plain loop. Grain 1 over 10,000,000 elements would make about 20 million jobs and gigabytes of job structs, so keep it out of the test.
   - Wait inside a job: a job that makes a root with 100 children and calls `job_wait` on that root, run with 1 worker and with all CPUs. Then a job that calls `parallel_for`.
   - No leaks: run the group and nested tests under your AddressSanitizer debug build.
   - Shutdown right after submitting 10,000 jobs under one root, where every job still runs once. Call `jobs_stop` first and `job_wait(root)` after it. The root is already at -1 by then, so the wait only frees the group.
3. Run all job tests 100 times in release mode, and once under TSan with every job and element count divided by 10.
4. Port the haversine sum of `hav3` and the Mandelbrot rows to `parallel_for`. At T equal to the `nproc` count, compare both with the static splits from step 5 and from the last step.
5. Write `docs/jobs-ordering.md`. List every variable that more than one thread touches. For each, say whether a mutex guards it (which one) or it is atomic (which ordering, and which operation it pairs with). Then write the happens-before chain from a job writing its result to the thread after `job_wait` reading it.

### Done when

All job tests pass 100 release runs in a row and one TSan run with no report, and LeakSanitizer reports nothing. `mandel` through `parallel_for` produces the same bytes as the oracle. The haversine sum through `parallel_for` runs within 10 percent of the static split, and Mandelbrot through `parallel_for` beats the static row split. `docs/jobs-ordering.md` covers every shared variable, and you can point to the line of code for each pairing it names.

## The HTTP server on the job system

Chapter 08's server loads every file at startup so the event loop never waits on the disk. Now it can serve work that takes time without stalling other clients.

The loop stays on its own thread and keeps sole ownership of every socket. Slow requests become detached jobs, since the loop never calls `job_wait`. Each job's result travels back to the loop through the rings from step 7, and a pipe wakes the loop up:

![The event loop thread hands a slow request to the workers through the injection queue. Each worker pushes its result into its own done ring and writes one byte to the wake pipe, which wakes the loop to pop the rings.](figures/09-server-jobs.svg)

In order, a slow request goes like this:

1. The loop stops watching the client for reading, copies what the job needs into a request struct, and calls `job_run`.
2. Some worker k runs the job, builds the whole response in a heap buffer, pushes the result into its own ring `done[k]` with `ring_try_push`, and writes one byte to the pipe.
3. The pipe's read end becomes readable. The loop reads it until `EAGAIN`, pops every `done[k]` ring, checks each result's generation against the client slot, attaches the response buffer and watches the client for writing.

Each worker k is the only producer for its ring `done[k]`, and the loop is the only consumer of all of them, so the step 7 single-producer ring fits without changes. The loop stops reading from a client while that client's job runs, so each client has at most one job in flight. Chapter 08 set `MAX_CLIENTS` to 1100, so one worker can hold up to 1100 finished results before the loop drains its ring. Give each done ring 2048 slots, the first power of two above 1100, and give the injection queue the same capacity. Then `ring_try_push` never fails, and the loop's `job_run` never waits on a full queue.

The write end of the pipe is nonblocking. If the pipe is full, `write` fails with `EAGAIN`, and that is fine, because the loop already has a wakeup pending and drains every ring when it wakes. Watch the read end with your `loop_watch` from chapter 08, like any socket.

A client can disconnect while its job runs, and a new client can take its slot before the result arrives. Store a **generation number** in every client slot, increment it when the slot is reused, and copy it into the job. When a result's generation does not match the slot's, the loop drops the result and frees it.

The image is about 1 MiB, and a file under `/disk/` can be any size, but the chapter 08 limits give each client a 64 KB output queue. Responses from jobs bypass that queue:

- The loop gives the client slot a pointer to the job's buffer, its length and a send offset.
- While the offset is below the length, the loop watches the client for writing and writes from the offset each time the socket is writable.
- When the offset reaches the length, the loop frees the buffer, stops watching for writing and watches the client for reading again.
- The loop also frees the buffer when the generation check fails or the client disconnects partway through.

Two kinds of slow request exercise this. `GET /mandel.pgm` renders the step 8 image, with `parallel_for` inside the job, and `job_wait` lets that job help with its own rows. `GET /disk/<name>` reads a file at request time with `fopen` and `fread`, so the disk read happens on a worker. Take the allowed names from the command line as in chapter 08 and keep exact lookup, so a request cannot reach any other path.

### Study

- [Linux man page: pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html) (read, 10 min): "I/O on pipes and FIFOs", "Pipe capacity" and "Open file status flags" for `O_NONBLOCK` and `EAGAIN`. Everything else in this step builds on the event loop and HTTP subset from chapter 08 and on your rings and job system.

### Build

1. Copy `httpd.c` from chapter 08 to `src/httpd2.c`. Start the job system with `max(1, nproc - 1)` workers, where `nproc` is the CPU count, since the loop thread needs a CPU. `sysconf(_SC_NPROCESSORS_ONLN)` from `<unistd.h>` returns the number of CPUs, the count the `nproc` command prints, as `sysconf(_SC_PAGESIZE)` returned the page size in chapter 08. Add the wake pipe, one 2048-slot done ring per worker, a 2048-item injection queue and the generation number in each client slot.
2. Add `GET /mandel.pgm` and `GET /disk/<name>` as jobs. Keep a `-inline` flag that runs both in the loop thread instead, for comparison.
3. Extend `tests/http.sh` with both new paths, a 404 for a disk name that is not on the command line, a client that sends a `/mandel.pgm` request and disconnects before the response, and a client that reads the first 64 KB of a `/mandel.pgm` response and then disconnects. Check that `/mandel.pgm` over HTTP has the same bytes as `mandel`'s output file.
4. Rerun `httptest` from chapter 08 while 8 clients request `/mandel.pgm` in a loop, with and without `-inline`. Record the pinger's worst round trip in both modes.
5. Load test `/mandel.pgm` with `wrk -t2 -c16 -d10s` in both modes and record requests per second.
6. Add a section to `docs/jobs-ordering.md` for the server: the pipe, the rings, the generation numbers, and which thread owns each client slot's fields at each moment.

### Done when

`sh tests/http.sh` passes, and a TSan build of `httpd2` serves the whole test run with no report. With the job system, the pinger's worst round trip stays under 50 ms while the `/mandel.pgm` clients run, and with `-inline` it does not. The `wrk` numbers show the job-system mode serving more `/mandel.pgm` requests per second than `-inline`, and you can explain the ratio from the CPU count and the step 8 Mandelbrot timings. Neither disconnecting client leaves a leaked slot, buffer or descriptor, checked with `ls /proc/<pid>/fd` as in chapter 08.

## Where this leads

You can now split work across cores and predict how much faster it will run. You know what a lock is made of, from one atomic exchange up to a futex, you have changed the locks inside a kernel, and you have caused and fixed a deadlock. You built a queue that threads sleep on, a ring that two threads share with no lock, and a work-stealing job system. You caught your own CPU reordering a store and a load, and you know which orderings stop it.

You wrote down why each structure is correct: who owns each piece of data at each moment, and which release and acquire pair moves it from one thread to the next. The server now uses every core for slow work and still answers a ping in under 50 ms.

All of those ownership rules live in comments and in `docs/jobs-ordering.md`. The compiler does not read them, and TSan only checks the paths your tests happen to run. Chapter 10, Rust, introduces a language whose type system tracks ownership and borrowing. It rejects at compile time a program that lets two threads mutate the same data without synchronization.

The chapter starts with the language itself, on programs you already wrote in C: Cargo and ownership on the chapter 02 word counter, then structs, enums and error handling on the chapter 03 Hack assembler. Then you port the chapter 07 Swiss table, share it between threads, where the compiler rejects the races you kept out of C by discipline here, and port the chapter 08 event-loop server. Both ports run the tests and benchmarks of the C versions.
