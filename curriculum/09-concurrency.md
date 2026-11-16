---
id: 09
title: Concurrency and parallelism
part: Performance and the operating system
weeks: 6
project: A work-stealing job system in C with a tested bounded queue, a lock-free single-producer ring and a written memory-ordering argument, used to parallelize the haversine sum and to keep the chapter 08 HTTP server responsive under heavy requests.
---

Chapter 08 left you with two loose ends. Your HTTP server runs one event loop on one core of a machine that has many, and any slow work inside the loop stalls every client. The xv6 kernel you changed in six labs calls `acquire` and `release` all over the place, and you took those calls on trust. You also saw the other half of a thread already: the context switch in xv6 saves a set of registers and swaps stacks. A thread in user space is the same thing, run by the Mac's or Linux's scheduler instead of yours.

This chapter starts with threads that share an address space and shows how two of them break a plain `counter++`. You build locks from single atomic instructions, read how xv6 builds its own, and then reduce lock contention inside xv6 in one more lab. You add condition variables and build a bounded queue that a pool of threads can wait on. Then you measure what sharing costs on your Mac's cores, learn the memory-ordering rules that let one thread publish data to another without a lock, and write a ring buffer that uses them. The project is a job system: one queue per worker, idle workers steal from busy ones, and a waiting thread runs other jobs while it waits. The last step moves the server's slow requests onto it.

The chapter comes after chapter 07 because every claim about parallel speed here is a measurement with the timers you wrote there, and the cache lines you measured there decide what sharing costs. It comes after chapter 08 because a lock that sleeps needs the kernel, and you now know what the kernel does when a thread blocks.

Most of the work runs on the Mac. Apple Silicon is weakly ordered, which means the CPU can make one core's writes visible to another core in a different order than they were made. An x86 machine hides many ordering bugs that your Mac shows. Use the Linux machine for the xv6 lab, for the futex lock and for the epoll side of the server. The sanitizer for this chapter is ThreadSanitizer. Build it with `SAN=thread sh build.sh name`. Clang refuses to combine it with AddressSanitizer, so keep your usual debug build as well and run both.

## Threads, shared memory and data races

A process from chapter 08 has one address space and one thread of execution. `pthread_create` adds a second thread to the same process. The new thread gets its own registers and its own stack, and shares everything else: globals, the heap, open file descriptors. `pthread_join` waits for a thread to finish and collects its return value, the way `waitpid` collects a child process.

```
  one process, two threads

  code   globals   heap                  shared by both threads
  ------------------------------------
  stack of T1   |   stack of T2          one each
  registers T1  |   registers T2         one each, saved on a switch
```

Shared memory lets threads hand each other data without copying it, and it also lets them damage each other's data. `counter++` on a global compiles to three instructions on your Mac: `ldr`, `add`, `str`. If the scheduler or a second core runs the other thread between the load and the store, one increment is lost. OSTEP calls this a race condition and shows it in 32-bit x86 assembly, which you can read from chapter 05. The C standard has a stricter name for the case where two threads touch the same variable, at least one writes, and nothing orders the two accesses: a data race. A data race is undefined behavior, like the cases in chapter 04. The compiler may assume it never happens, so the result can be worse than a lost increment.

The fix in this step is a mutex: `pthread_mutex_lock` before the increment and `pthread_mutex_unlock` after. The better fix, where the problem allows it, is to share nothing while the threads work. Give each thread its own range of the input and its own result slot, and combine the results after `pthread_join`. The join orders everything the thread did before everything the joining thread does next, so the combine step needs no lock.

ThreadSanitizer (TSan) watches every memory access at run time and reports two accesses from different threads that nothing orders. It only sees code that actually runs. A clean run shows that the paths your test took had no race it could detect. It slows the program down 5 to 15 times, so never time a TSan build.

### Study

- [OSTEP chapter 26: Concurrency: An Introduction](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf) (read, 1 h): Sections 26.1 to 26.7. Figure 26.6 (`t1.c`) is the program you run below, and figure 26.7 traces the lost update instruction by instruction. Skip the homework, which uses a Python simulator of x86.
- [OSTEP chapter 27: Interlude: Thread API](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-api.pdf) (read, 45 min): Sections 27.1 to 27.6: create, join, the argument and return-value casts, locks, condition variables and how to compile. Section 27.4 previews condition variables, which get their own step later. Skip the homework, which uses valgrind's helgrind. TSan does the same job here.
- [Clang: ThreadSanitizer](https://clang.llvm.org/docs/ThreadSanitizer.html) (read, 15 min): Introduction, Supported Platforms, Usage and Limitations. Darwin arm64 and Linux aarch64 are both supported, so it runs on both your machines.

### Build

1. Write `src/race.c` from figure 26.6: two threads each add 1 to a global `counter` ten million times, and `main` prints the total. Keep the `volatile` on `counter`, as in the figure. Without it the optimizer may turn the loop into one addition, and step 5 uses the same effect on purpose. Run the release build five times and record the totals. Look at the loop in `objdump -d` (or `otool -tvV` on the Mac) and find the load, add and store.
2. Build it with `SAN=thread sh build.sh race` and run it. Read the report: which two accesses, which threads, and where each thread was created.
3. Add a `pthread_mutex_t` around the increment. Check the total, run it under TSan again, and time the locked version against a single-threaded loop that does 20 million increments.
4. Write `src/psum.c`. Fill an array of 100 million `uint64_t` with `i * 2654435761 % 1000`. Sum it with T threads for T from 1 to the number of cores (`sysctl -n hw.ncpu` on the Mac, `nproc` in Linux). Pass each thread a struct with its start, end and a `uint64_t sum` field that only that thread writes. Join all threads, then add the partial sums. Compare with a single-threaded sum, which is the oracle. Check every `pthread_create` and `pthread_join` return value and exit with a message if one fails. Time each T with the timer from chapter 07 and save the times for step 5.

### Done when

`race` loses increments in the release build and TSan reports the race, with both stack traces pointing at the increment. The mutex version prints exactly 20000000 with no TSan report. `psum` matches the oracle exactly for every T, on the Mac and in Linux, and runs clean under TSan and under your normal sanitizer build. You can say why the per-thread `sum` fields need no lock.

## Locks from one atomic instruction

A mutex has to solve the problem from the last step for its own flag. Checking that the flag is 0 and then setting it to 1 is two steps, and two threads can both pass the check. The hardware supplies instructions that read and write a memory location as one indivisible step. With one of them, a lock is a few lines:

```c
#include <stdatomic.h>

typedef struct { atomic_int locked; } SpinLock;

void spin_lock(SpinLock *l)   { while (atomic_exchange(&l->locked, 1)) {} }
void spin_unlock(SpinLock *l) { atomic_store(&l->locked, 0); }
```

`atomic_exchange` writes 1 and returns the old value in one step. If the old value was 0, this thread took the lock. Otherwise it tries again. OSTEP builds this lock from test-and-set, then a ticket lock from fetch-and-add that serves threads in arrival order, then locks that give up the CPU instead of spinning.

`<stdatomic.h>` is C11. Its definition is section 7.17 of N1570, the standard draft you have used as a reference since chapter 04, on printed pages 273 to 286. Look up `atomic_exchange`, `atomic_fetch_add`, `atomic_compare_exchange_strong` and `atomic_load` there. An object declared `_Atomic` or `atomic_int` can be read and written by several threads without a data race. Every operation in this step uses the default ordering, called sequentially consistent, which is the strictest. Step 6 explains what ordering means and when a weaker one is correct.

Bos's chapter shows what these operations compile to on x86-64 and on ARM64. The book's examples are Rust. Each one is a function of one or two lines next to its assembly, and the assembly is the part to read. Read `x.fetch_add(10, Relaxed)` as `atomic_fetch_add_explicit(x, 10, memory_order_relaxed)` and `AtomicI32` as `atomic_int`. Rust starts in chapter 10, so this step uses only the parts of Bos's chapter 7 that are about instructions. Your Mac's cores implement ARMv8.1 atomics, so clang emits single instructions like `swpal`, `ldaddal` and `casal` where Bos shows `ldxr`/`stxr` loops. Read both forms.

A spinning thread burns a core while it waits. If the thread that holds the lock has been descheduled, the waiter spins for a whole time slice. A sleeping lock asks the kernel to park the waiter. On Linux the kernel call is `futex`: `FUTEX_WAIT` puts the thread to sleep only if a given int still holds an expected value, and `FUTEX_WAKE` wakes sleepers on that int. A common futex mutex uses three states, 0 for unlocked, 1 for locked with no waiters and 2 for locked with possible waiters:

```
lock:    c = compare_exchange(m, 0 -> 1)      returns the old value
         if c == 0: return                     fast path, no system call
         if c != 2: c = exchange(m, 2)
         while c != 0:
             futex_wait(m, 2)                  sleeps only if *m is still 2
             c = exchange(m, 2)
unlock:  if exchange(m, 0) == 2: futex_wake(m, 1)
```

OSTEP's figure 28.10 shows glibc's version, which packs the same information differently. glibc has no wrapper for `futex`, so call it with `syscall(SYS_futex, ...)` as the man page's example does. The `yield` lock in the Build calls `sched_yield()`, which takes no arguments, returns 0, and puts the calling thread at the back of the run queue. macOS has no public futex, so the futex lock is Linux only.

### Study

- [OSTEP chapter 28: Locks](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf) (read, 1 h 30 min): Sections 28.1 to 28.17. Test-and-set, compare-and-swap (figure 28.4), load-linked/store-conditional (figure 28.5) and fetch-and-add are each written as C pseudocode for one hardware operation. Figures 28.3, 28.6 and 28.7 build a lock from test-and-set, LL/SC and fetch-and-add. Compare-and-swap (28.4) is the operation your futex lock uses. Section 28.5 on disabling interrupts comes back in the xv6 step. Skip the homework, which uses an x86 simulator.
- [Mara Bos: Rust Atomics and Locks, chapter 7: Processor Instructions](https://marabos.nl/atomics/hardware.html#instructions) (read, 45 min): From "Brief Introduction to Assembly" through "Compare-and-exchange on ARM", including the boxed notes "ARMv8.1 Atomic Instructions" and "Optimization of Compare-and-Exchange Loops". Stop at "Caching", which step 5 uses.
- [Linux man page: futex(2)](https://man7.org/linux/man-pages/man2/futex.2.html) (reference, as needed): DESCRIPTION up to "Futex operations", then EXAMPLES for the `syscall` wrapper. Then follow the links to FUTEX_WAIT(2const) and FUTEX_WAKE(2const) and read DESCRIPTION, RETURN VALUE and ERRORS on both: the expected value, `EAGAIN` when the value already changed, and `EINTR`.

### Build

Write `src/locks.c` with five locks behind the same two-function interface:

1. `spin`: `atomic_exchange` in a loop, as above.
2. `ticket`: OSTEP figure 28.7 with `atomic_fetch_add` on `ticket` and an atomic load of `turn`.
3. `yield`: the spin lock with `sched_yield()` in the loop body, figure 28.8.
4. `mutex`: `pthread_mutex_t`.
5. `futex`: the three-state lock above, inside `#ifdef __linux__`.

The benchmark starts T threads that each run one million iterations of lock, `shared++` on a plain `int64_t`, unlock. Run every lock at T = 1, 2, 4, 8 and twice the core count. Time the whole run with the chapter 07 timer, take the best of five runs, and print nanoseconds per lock-unlock pair. After every run check that `shared` equals T times one million. Run a smaller version under TSan for every lock. Compile `spin_lock` and `ticket_lock` in release mode and find the atomic instructions in the disassembly on the Mac, then in Linux.

### Done when

Every lock produces the exact count at every T, on both machines, with no TSan report. You have a table of nanoseconds per pair for five locks (four on the Mac) and five thread counts. You can explain from the table and OSTEP sections 28.8 and 28.12 what happens to `spin` and `ticket` when there are more threads than cores, and why `yield`, `mutex` and `futex` degrade less. You can point at the instruction that makes `spin_lock` atomic on the Mac.

## Locks inside xv6

xv6 locks the same way you just did. Its `acquire` spins on `__sync_lock_test_and_set`, which becomes the RISC-V instruction `amoswap`, the same atomic exchange as your `spin` lock. `release` stores 0 with `__sync_lock_release`. The chapter also explains two things your user-space lock did not need. A kernel spinlock turns interrupts off while it is held, because an interrupt handler on the same CPU that tries to take the same lock would spin forever. That answers the question OSTEP section 6.4 left open in chapter 08. And `acquire` and `release` each contain `__sync_synchronize()`, a memory barrier, so that neither the compiler nor the CPU moves the protected loads and stores outside the critical section. Step 6 is about that second point. For now, note where the barriers are.

The lab is about contention. `kalloc` and `kfree` share one free list and one lock, so every CPU that allocates a page waits for the others. The fix gives each CPU its own free list and its own lock. When a CPU's list runs dry, it steals pages from another CPU's list. Keep this design in mind: per-worker queues with stealing are also the structure of the job system in step 7.

The second half of the lab is a read-write spinlock: many readers at once, or one writer, and a waiting writer blocks new readers so it cannot starve. You write it with GCC's `__atomic` builtins, which the kernel's compiler supports. They are the same operations as `<stdatomic.h>`, with the ordering spelled as an argument such as `__ATOMIC_SEQ_CST`. Use `__ATOMIC_SEQ_CST` everywhere in this lab.

Work in the Linux machine with the xv6 setup from chapter 08. Section 3.5 of the xv6 book, which the lab asks for, was part of the page-table reading in chapter 08.

### Study

- [xv6 book, chapter 7: Locking](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf#page=63) (read, 1 h 15 min): Sections 7.1 to 7.8, pages 63 to 73, with `kernel/spinlock.c` and `kernel/kalloc.c` open. Figure 7.3 lists every lock in xv6. Exercise 1 in 7.9 shows how rarely a missing lock causes a visible failure. Try it if you have time.
- [6.1810 Fall 2025: Lab Lock](https://pdos.csail.mit.edu/6.1810/2025/labs/lock.html) (do, 10 h): "Memory allocator" (per-CPU free lists with stealing) and "Read-write lock". The optional KCSAN race detector run is worth doing once on the allocator. Skip "Submit the lab".
- [GCC: Built-in Functions for Memory Model Aware Atomic Operations](https://gcc.gnu.org/onlinedocs/gcc/_005f_005fatomic-Builtins.html) (reference, as needed): `__atomic_load_n`, `__atomic_store_n`, `__atomic_fetch_add`, `__atomic_compare_exchange_n` and the list of memory orders. The lab's read-write lock hint points to this page.

### Build

1. `git checkout lock` in the lab repository, as in chapter 08. Run `kalloctest` before changing anything and save the output.
2. Implement per-CPU free lists with stealing. Name every lock starting with `kmem`, as the lab requires. Turn interrupts off with `push_off` and `pop_off` around `cpuid()`.
3. Implement the read-write spinlock with writer priority and pass `rwlktest`.
4. Run `usertests -q` and `make grade`.

### Done when

`make grade` passes every test on the lock branch, and `usertests -q` passes. Your `kalloctest` output before and after shows the drop in `#test-and-set` iterations on the `kmem` locks. You can explain why `acquire` disables interrupts before it spins and not after, and why your stealing code cannot deadlock when two CPUs try to steal from each other at the same time.

## Condition variables and a bounded queue

Locks protect data. They do not let a thread wait for something to happen. A consumer that finds a queue empty could loop, taking and releasing the lock until an item appears, but that burns a core. A condition variable lets the thread sleep until another thread signals that the state may have changed. `pthread_cond_wait` releases the mutex and sleeps as one step, and takes the mutex again before it returns. That combined step closes the window where a signal could arrive between the check and the sleep.

The step depends on two rules. Wait in a `while` loop that checks the condition, never in an `if`, because a wakeup does not prove that the condition holds: another thread may have taken the item first. And keep a state variable that the condition checks, such as the item count, because a signal sent when nobody waits is lost.

The queue you build is the standard producer and consumer shape: a fixed array used as a ring, a count, one mutex and two condition variables, one for "not full" and one for "not empty". It also needs a way to stop. A `closed` flag set under the mutex, followed by a broadcast on both condition variables, wakes every waiter. Define the shutdown rule and test it: after `queue_close`, pushes fail, and pops keep returning items until the queue is empty and then return false.

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

A thread pool sits on top: N worker threads that loop on `pop` and call the function pointer they get. Tests for concurrent code need a time limit, because a deadlock looks like a test that never ends. Call `alarm(10)` at the start of each test program. It asks the kernel to send SIGALRM to the process in 10 seconds. A program with no handler for SIGALRM terminates, so a hung test ends with a nonzero exit status.

### Study

- [OSTEP chapter 30: Condition Variables](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-cv.pdf) (read, 1 h 15 min): Sections 30.1 to 30.4. Figures 30.8 to 30.11 are two broken producer/consumer versions with traces of how they fail. Find the failing interleaving yourself before you read each trace. Figures 30.12 to 30.14 are the correct version. Skip the homework.

### Build

1. Write `src/queue.c` with `queue_init(q, cap)`, `queue_push`, `queue_pop`, `queue_close` and a non-blocking `queue_try_push` that returns false when the queue is full. The queue holds `struct { void (*fn)(void *); void *arg; }` items.
2. Write `src/pool.c` with `pool_start(n)`, `pool_submit(fn, arg)` and `pool_stop()`. `pool_stop` closes the queue, lets the workers drain it, and joins them.
3. Write `src/queue_test.c`, each test under `alarm(10)`:
   - Exactly once: 4 producers push items with distinct ids and 4 consumers pop them. Each consumer does `atomic_fetch_add(&seen[id], 1)`. At the end every `seen[id]` is 1. At capacity 1024, push 250,000 items per producer, ids 0 to 999,999. At capacities 1, 2 and 3, push 20,000 per producer, ids 0 to 79,999. Every handoff at a small capacity costs a sleep and a wake, and the large count would run past the alarm.
   - Wraparound: one producer and one consumer, capacity 3, 200,000 items, checked in order.
   - Close while idle: start 8 consumers on an empty queue, close it, and join all of them within 100 ms.
   - Close with pending items: push 1000 items with no consumers, close, then start consumers. All 1000 are popped and the next pop returns false.
   - The pool: submit 100,000 jobs that each increment an atomic counter, stop the pool, and check the counter.
4. Run the tests in the debug build, under TSan, and in release mode, on both machines. The TSan build uses a tenth of every item count.

### Done when

Every test passes 100 times in a row in the release build (`for i in $(seq 100); do ./out/Darwin-release/queue_test || break; done`) and once under TSan with no report, on both machines. Change one `while` in `queue_pop` to `if` and find a test that fails, then change it back. You can state, for each condition variable, which condition it stands for and who signals it.

## Cache lines, contention and speedup

The threads in `psum` share nothing while they work, and their times from step 1 still did not fall as 1/T. Two costs explain most of the gap. The first is the hardware. Caches keep copies of memory lines, and a coherence protocol keeps the copies consistent. A core that writes a line takes it into its own cache in an exclusive state and invalidates every other copy. If two cores keep writing to the same line, the line moves back and forth between their caches on every write. That happens even when they write different variables that sit in the same line. That case is false sharing.

```
  core 0 writes c[0]          core 1 writes c[1]
        |                            |
        v                            v
  +--------------------------------------------------------------+
  | c[0] | c[1] | c[2] | ...          one 128-byte cache line    |
  +--------------------------------------------------------------+
  the line moves between the two caches on every write.
  fix: give each counter its own line (_Alignas(128)), or keep counts
  in locals and combine them at the end.
```

Your Mac's cache line is 128 bytes (`sysctl hw.cachelinesize`, from chapter 07). Most x86 examples assume 64, and Bos notes that some processors need 128.

The second cost is the part of the program that stays serial. If a fraction s of the run cannot be split, T threads finish in at least s + (1 - s)/T of the single-thread time. That is Amdahl's law. Your haversine pipeline from chapter 07 reads and parses the JSON on one thread. Splitting only the distance sum leaves the parse untouched, so the end-to-end speedup has a ceiling you can compute from your profile before you measure it.

Apple Silicon adds a third effect. The Mac has performance cores and efficiency cores (`sysctl hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu`), and macOS decides where each thread runs. Set every benchmark thread's QoS class to `QOS_CLASS_USER_INTERACTIVE`, as in chapter 07, at the start of each thread function. With more threads than performance cores, some threads run on efficiency cores, and an equal split of the work makes the threads finish at different times. Record when each thread finishes. The difference between the first and the last finish is load imbalance, and step 7 attacks it.

### Study

- [Mara Bos: Rust Atomics and Locks, chapter 7: Caching](https://marabos.nl/atomics/hardware.html#caching) (read, 40 min): "Caching", "Cache Coherence" with "The write-through protocol" and "The MESI protocol", then "Impact on Performance" with "Failing Compare-and-Exchange Operations". Each Rust program is a loop of one load or store on an atomic, timed. Read the prose and the timings, including the M1 numbers, and write the same loops in C below. Stop at "Reordering".
- [OSTEP chapter 29: Lock-based Concurrent Data Structures](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks-usage.pdf) (read, 30 min): Section 29.1 only, "Concurrent Counters", with figures 29.2 to 29.6. The approximate counter keeps one local count per CPU and moves it to the global count every S increments. Skip 29.2 onward.

### Build

Run everything in this step on the Mac, release build, best of five runs, with T from 1 to the core count.

1. `src/counters.c`: T threads each do 100 million increments in five layouts. (a) One shared `atomic_long`, all threads adding to it. (b) An array of T `atomic_long`, one per thread, adjacent in memory. (c) The same array with each counter in a struct declared `_Alignas(128)`. (d) A plain local `long` in each thread, stored to the thread's result slot once at the end. Clang may turn that loop into a single addition. Check the disassembly and record what it did. (e) OSTEP's approximate counter with thresholds S = 1, 64 and 4096. With S = 1 every increment takes the global mutex, so use 10 million increments per thread for S = 1 and keep 100 million for the others. Print nanoseconds per increment per thread. Check every total.
2. Repeat Bos's experiment in C: one thread loads `a[1]` a billion times while a second thread stores to `a[0]` and `a[2]`. Add each loaded value to a sum that you print, so the loads stay in the program. Time it with `a` as three adjacent `atomic_long` and again with each one `_Alignas(128)`, and once with no second thread.
3. Add a test-and-test-and-set lock to `locks.c` from step 2: spin on `atomic_load` until the lock looks free, then try `atomic_exchange`. Rerun the step 2 table for `spin` and the new lock.
4. `src/hav3.c`: copy `hav2` from chapter 07 and split only the distance loop across T threads, with static chunks of the four arrays and a private partial sum per thread. Record per-thread finish times. Measure the time of the sum stage alone and of the whole run at 10,000,000 pairs. The sum's floating-point order changes with T, so check the average against the answer file with the 1e-9 rule, not with `==`.
5. Plot the speedup of `psum`, of the haversine sum stage and of the whole haversine run against T with matplotlib, next to the Amdahl curve for the serial fraction your chapter 07 profiler reports.

### Done when

You have the five-layout counter table and the three-case Bos table, and you can explain each number with the coherence argument: who owns the line, and how often it has to move. `hav3` passes the 1e-9 rule at every T. Your plot shows the measured end-to-end speedup at or below the Amdahl curve, and you can say how far below and why. You can name the T at which threads first land on efficiency cores, from the per-thread finish times.

## Memory ordering and a single-producer ring

Every atomic operation so far used the default ordering, and every hand-off went through a lock. This step is about handing data from one thread to another with no lock at all, which needs a precise rule for what the second thread can see.

Within one thread, the compiler and the CPU may reorder loads and stores whenever the thread itself cannot tell. Your Mac's cores keep stores in a buffer before they reach the cache, and they let loads run ahead of earlier stores. Another core can therefore see thread A's second write before its first. x86 forbids most of these reorderings in hardware. ARM64 allows nearly all of them, so code that runs fine on an x86 laptop can fail on your Mac.

C11 states the rule in terms of the program. A store with `memory_order_release` and a load with `memory_order_acquire` on the same atomic variable pair up when the load reads the value the store wrote. Then everything the storing thread did before the release happens before everything the loading thread does after the acquire. Preshing calls the atomic variable the guard and the data it protects the payload:

```
  thread A (producer)                      thread B (consumer)

  data.x = 42;          plain stores
  data.y = 7;
  atomic_store_explicit(&ready, 1,         while (!atomic_load_explicit(&ready,
      memory_order_release);  ------------->       memory_order_acquire)) {}
                         synchronizes-with   use(data.x, data.y);   sees 42 and 7

  if B's acquire load reads the 1 that A's release store wrote, A's earlier
  writes happen before B's later reads. If it reads 0, nothing is promised.
```

`memory_order_relaxed` makes a single access atomic and promises nothing about other memory. It suits a statistics counter and nothing that publishes data. `memory_order_seq_cst`, the default, adds one global order over all sequentially consistent operations. On ARM64, Bos shows that an acquire load and a sequentially consistent load both compile to `ldar`, and a release store and a sequentially consistent store both compile to `stlr`, so the default costs little on your Mac. This book uses the default ordering or a lock. Write `acquire` or `release` only where you can name the guard, the payload and the pair of operations that synchronize, and write that argument next to the code. Bos writes these operations in Rust, and Preshing writes them in C++ with `std::memory_order_release` and the like. The C spellings are:

```
  Bos (Rust)                        C11
  x.store(v, Release)               atomic_store_explicit(&x, v, memory_order_release)
  x.load(Acquire)                   atomic_load_explicit(&x, memory_order_acquire)
  x.swap(v, Relaxed)                atomic_exchange_explicit(&x, v, memory_order_relaxed)
  compiler_fence(Acquire)           atomic_signal_fence(memory_order_acquire)
```

Sections 7.17.3 and 7.17.4 of N1570 are the C wording of the orderings and fences. Look there if a name is unclear.

A mutex lock is an acquire and an unlock is a release. The barriers in xv6's `acquire` and `release` give those two functions the same acquire and release properties. Bos ends his chapter with an experiment you will repeat: a spinlock written with relaxed operations loses increments on an M1 and never on x86.

The ring buffer is the payload-and-guard pattern used over and over. One producer and one consumer share an array and two indexes. The producer owns the slot at `tail`. It writes the item there, then publishes it by storing `tail + 1` with release. The consumer loads `tail` with acquire, reads the item at `head`, then hands the slot back by storing `head + 1` with release. The producer loads `head` with acquire before it reuses the slot. Wellons calls the release store the commit: it transfers ownership of one slot to the other thread, and neither thread touches a slot it does not own. Wellons names the indexes the other way round: his consumer pops at `tail` and his producer pushes at `head`. Keep this chapter's names.

```
         head (consumer owns head..tail-1)      tail (producer owns the rest)
          |                                      |
  +---+---+---+---+---+---+---+---+---+---+---+---+---+---+---+---+
  |   | 7 | 8 | 9 |10 |11 |   ...  items ready to pop  |   free     |
  +---+---+---+---+---+---+---+---+---+---+---+---+---+---+---+---+
  capacity is a power of two, indexes count up forever, slot = index & (cap - 1)
```

The section "As a concurrent hash map" in Wellons's arena hash map post, which chapter 04 told you to skip, uses the same acquire and release pair to insert into your hash trie from several threads. Read it now if you want a third example.

### Study

- [Mara Bos: Rust Atomics and Locks, chapter 7: Reordering](https://marabos.nl/atomics/hardware.html#reordering) (read, 1 h): "Reordering", then "Memory Ordering" through "Memory Fences": "Other-Multi-Copy Atomicity", "x86-64: Strongly Ordered", "ARM64: Weakly Ordered", "An Experiment" and "Memory Fences". The text refers to its chapter 3 for the formal rules. Preshing covers those rules for C and C++ below, so skip the references. In the experiment, `compiler_fence` is `atomic_signal_fence` in C, which clang compiles to no instruction.
- [Jeff Preshing: The Synchronizes-With Relation](https://preshing.com/20130823/the-synchronizes-with-relation/) (read, 25 min): The whole post. It uses C++11 atomics. Read `g_guard.store(1, std::memory_order_release)` as `atomic_store_explicit(&g_guard, 1, memory_order_release)`. The guard and payload vocabulary in the post is the one this chapter uses for every argument you write.
- [Chris Wellons: A lock-free, concurrent, generic queue in 32 bits](https://nullprogram.com/blog/2022/05/14/) (read, 25 min): From the start through "Push operation". Note the comments that say "consider acquire" and "consider release". Your ring uses those orderings and two separate indexes instead of one packed integer. "Multiple-consumers" is optional, and its last paragraph points at the false sharing your step 5 counters measured.

### Build

1. `src/relaxed.c`: Bos's experiment in C on the Mac, release build. Four threads each do a million iterations of: spin with `atomic_exchange_explicit(&locked, 1, memory_order_relaxed)`, `atomic_signal_fence(memory_order_acquire)`, a relaxed load of `counter`, a relaxed store of the loaded value plus 1, `atomic_signal_fence(memory_order_release)`, and `atomic_store_explicit(&locked, 0, memory_order_relaxed)`. Print the final counter over 20 runs. Then change the exchange to acquire and the unlock store to release and run 20 more. Find `swp` and `swpa`, `str` and `stlr` in the two disassemblies. If you still have the `lab86` machine from chapter 05, build and run the relaxed version there too. It runs x86 code, and x86 orders stores for you.
2. `src/ring.c`: a bounded single-producer, single-consumer ring of `uint64_t` with `ring_init(r, cap)`, `ring_try_push` and `ring_try_pop`, which return false when full or empty instead of blocking. Put `head` and `tail` in separate `_Alignas(128)` fields. Each thread may keep a private copy of the other index and reload it only when the ring looks full or empty.
3. Write the memory-ordering argument as a comment block at the top of `ring.c`. For each atomic access, state its ordering and the access it pairs with, and for each slot, which thread owns it at each moment.
4. `src/ring_test.c` under `alarm(10)`: push 0 to N - 1 from one thread and pop in another, checking that each value equals the previous plus 1. Use N = 10,000,000 at capacities 2 and 4, where the index lines move between cores every few items, and N = 100,000,000 at capacity 1024. A spin when full or empty is fine here. Run it under TSan with a smaller count.
5. Time the ring against your step 4 queue with one producer and one consumer at capacity 1024, in items per second.

### Done when

You have the 20 totals of each version of `relaxed.c` from the Mac. Bos saw totals about 0.4 percent low on an M1. If your relaxed version never drops below 4,000,000, run it 200 times and record what your chip did. The acquire and release version prints exactly 4,000,000 every time, and you can name the reordering that loses an increment in the relaxed one. `ring_test` passes 100 release runs in a row at every capacity with N = 10,000,000, and once under TSan with no report. The comment block in `ring.c` names every pairing. If you change one acquire or release in the ring to relaxed, TSan reports a race in the item array, and you can say which happens-before edge you removed.

## A work-stealing job system

The static split in step 5 works when every chunk costs the same and every core runs at the same speed. Neither holds in general. The fix is dynamic assignment: cut the work into many more pieces than there are threads, and let a thread take the next piece when it finishes the last one. The step 4 pool does this with one shared queue, and every take goes through one mutex. With small jobs that mutex is the same contention you measured on `kmem.lock` in xv6.

A job system gives each worker its own double-ended queue, a deque. A worker pushes new jobs onto the bottom of its own deque and pops from the bottom, so it runs its newest job next while that job's data is still in cache. When its deque is empty, it picks another worker at random and steals from the top, which holds that worker's oldest and usually largest job. Owner and thief work at opposite ends, so they rarely want the same lock at the same moment.

```
  worker 0 deque        worker 1 deque         worker 2 deque
  top  -> j0            top  -> (empty)        top  -> j6
          j1                                           j7
          j2                                           j8
  bottom-> j3                                  bottom-> j9
     ^                                             ^       ^
     | push and pop at the bottom                  |       | worker 1 is idle
     | (owner only)                                |       | and steals j6
                                                   owner pops j9
```

A job can create child jobs. Each job has an atomic count of unfinished work: 1 for itself plus 1 per child not yet finished. `job_new` with a parent adds 1 to the parent's count. When a job's function returns, its count drops by 1, and when the count reaches 0 the job tells its parent by dropping the parent's count, the same way. `job_wait(j)` runs other jobs, its own or stolen ones, until `j` is done. A thread that waits therefore keeps a core busy.

A job cannot wait on its own count, because the 1 for itself stays until its function returns. A job that needs results from children before it returns makes a group instead: a root job with no parent and an empty function, the children under that root, `job_run` on all of them, then `job_wait(root)`. Create every child before you run the root, or the root's count can reach 0 while you are still adding to it. `parallel_for` does exactly this, so it works the same from `main` and from inside a job. Because `job_wait` runs other jobs while it waits, this works without deadlock even with a single worker.

Reinalter's post builds this design with locked deques, and the slides show the same structure in Cilk with its scheduling choices. Reinalter also shows a lifetime bug: the thread that finishes a job may still touch it after another thread has seen the count reach 0. His fix lets the count fall to -1 after the parent has been told, and `Wait` treats only -1 as done. His post never frees a job early. It collects every job in a global array and deletes them all at the end of a frame. This chapter has no frame, so use this ownership rule instead:

- The last write a finishing job makes to itself is storing -1 in its own count, after it has told its parent.
- `job_wait` takes only a root, a job with no parent. The thread that calls it owns the root and every job created under it. Every root gets exactly one `job_wait`.
- Each root keeps a list of its descendants behind a mutex. `job_new` with a parent adds the new job to the list of that parent's root.
- `job_wait(root)` returns after the root's count reads -1. Before it returns, it walks the list, waits until each job's count reads -1, and frees it, then frees the root. A descendant that has told its parent is at most one store from -1, so that wait is short.
- A detached job from `job_new_detached` has no group and nobody waits on it. The worker that runs it frees it after its function returns. The server in the next step uses these.

His post also assumes x86 ordering, as its last paragraph says. Use `<stdatomic.h>` with the default ordering for every count and you get correct code on ARM64.

Keep every deque behind a mutex. A lock-free deque (the Chase-Lev design) is a stretch goal for after this chapter, and only after the locked version is tested and measured. Idle workers must not spin forever. After a full round of failed steals, a worker sleeps on a condition variable, and `job_run` signals it. Use a count of queued jobs under that same mutex as the predicate, as in step 4.

Use this interface:

```c
typedef struct Job Job;
typedef void JobFn(void *arg);

void jobs_start(int nworkers);
Job *job_new(JobFn *fn, void *arg, Job *parent);  // parent may be NULL
Job *job_new_detached(JobFn *fn, void *arg);      // no parent, no children, never waited on
void job_run(Job *job);      // push on this worker's deque, or on the injection queue
void job_wait(Job *root);    // root only: runs other jobs until root is -1, then frees the group
void jobs_stop(void);        // waits for all queued jobs, then joins the workers
void parallel_for(int64_t n, int64_t grain,
                  void (*body)(int64_t lo, int64_t hi, void *ctx), void *ctx);
```

A thread that is not a worker, such as `main` or the server's event loop in the next step, has no deque. Its `job_run` puts the job on one shared injection queue, your step 4 queue, and workers check it after their own deque and before stealing. Store the worker index in a `_Thread_local int`, which is C11's per-thread variable, set to -1 outside the workers. `parallel_for` makes a root, splits `[0, n)` in half recursively as jobs under that root until a range is at most `grain` long, calls `body` on each range, and returns after `job_wait(root)`.

Mandelbrot is the uneven workload. For a 1024 by 1024 image over real parts -2.0 to 1.0 and imaginary parts -1.5 to 1.5, each pixel's point c starts with z = 0 and repeats z = z * z + c until |z|^2 > 4 or 1000 iterations pass. Store the iteration count, scaled to 0 to 255, as one byte. Rows through the middle of the set run all 1000 iterations for many pixels, and rows near the top and bottom stop after a few. Write the image as a binary PGM, the header `P5\n1024 1024\n255\n` followed by the bytes, and open it on the Mac to check it.

### Study

- [Stanford CS149 Fall 2025: Work Distribution and Scheduling (slides)](https://gfxcourses.stanford.edu/cs149/fall25content/media/perfopt1/05_progperf1.pdf#page=5) (read, 1 h): Slides 5 to 22 on static and dynamic assignment, task size, scheduling long tasks first and distributed queues. Then slides 26 to 49. Slides 26 to 32 introduce the `cilk_spawn` and `cilk_sync` notation, and 33 to 49 build the scheduler: a worker pool, per-thread deques, child-first or continuation-first execution, stealing from the top and choosing a victim. Slides 51 to 62 on implementing `cilk_sync` are optional. They solve the same problem as your `job_wait`.
- [Stefan Reinalter: Job System 2.0: Lock-Free Work Stealing, Part 1: Basics](https://blog.molecular-matters.com/2015/08/24/job-system-2-0-lock-free-work-stealing-part-1-basics/) (read, 40 min): The whole post. The code is C++ that reads as C: `nullptr` is `NULL`, `new` and `delete` are `malloc` and `free`, and `atomic::Decrement` is `atomic_fetch_sub(..., 1) - 1`. Skip the later parts of the series. Part 3 builds a lock-free deque with barriers chosen for x86.

### Build

1. `src/mandel.c`: the single-threaded image, which is the oracle, then a static version that gives each of T threads 1024/T consecutive rows. Record per-thread finish times.
2. `src/jobs.c` with the interface above: a fixed-capacity deque per worker behind a mutex (if a push finds it full, run the job right away instead), the injection queue, random victims, sleeping when idle, and the -1 ownership rule above for freeing jobs.
3. `src/jobs_test.c`, each test under `alarm(10)`:
   - Exactly once: one root job with 1,000,000 children, each doing `atomic_fetch_add(&seen[i], 1)`. Every entry ends at 1.
   - Nested: `parallel_for` over 10,000,000 elements with grain 1, 64 and 100,000, each summing into a per-chunk slot, checked against a plain loop.
   - Wait inside a job: a job that makes a root with 100 children and calls `job_wait` on that root, run with 1 worker and with all cores. Then a job that calls `parallel_for`.
   - No leaks: run the exactly-once and nested tests under your AddressSanitizer debug build. LeakSanitizer reports any job that was never freed.
   - Uneven: 10,000 jobs where job i spins for (i % 100) microseconds, with no lost or doubled jobs.
   - Shutdown with an idle pool, and shutdown right after submitting 10,000 jobs under one root, where every job still runs once. Call `jobs_stop` first and `job_wait(root)` after it. The root is already at -1 by then, so the wait only frees the group.
4. Run the tests 100 times in release mode and once under TSan, on both machines.
5. Port the haversine sum of `hav3` and the Mandelbrot rows to `parallel_for`. On the Mac, at T equal to the core count, compare the job system with the static split from step 5 and from item 1.
6. Write `docs/jobs-ordering.md`. List every variable that more than one thread touches. For each, say whether a mutex guards it (which one) or it is atomic (which ordering, and which operation it pairs with). Then write the happens-before chain from a job writing its result to the thread after `job_wait` reading it.

### Done when

All job tests pass 100 release runs in a row and one TSan run with no report, on both machines. `mandel` with the job system produces the same bytes as the single-threaded oracle (`cmp` prints nothing). The haversine sum through `parallel_for` runs within 10 percent of the static split, and Mandelbrot through the job system beats the static row split. You can say why, from the per-thread finish times. `docs/jobs-ordering.md` covers every shared variable, and you can point to the line of code for each pairing it names.

## The HTTP server on the job system

Chapter 08's server loads every file at startup so the event loop never waits on the disk. Now it can serve work that takes time without stalling other clients. The loop stays on its own thread and keeps sole ownership of every socket. Slow requests become detached jobs, since the loop never calls `job_wait`. Each job's result travels back to the loop through the rings from step 6, and a pipe wakes the loop up.

```
  event loop thread                          worker k (any worker)
  -----------------                          ---------------------
  request needs work:
    stop watching the client for reading
    copy what the job needs into a request
    job_run(job)  ---- injection queue --->  runs the job, builds the response
                                             ring_try_push(&done[k], result)
                                             write(wake_pipe[1], "x", 1)
  wake_pipe[0] readable:  <----------------
    read until EAGAIN
    pop every done[k] ring
    check the client slot's generation, attach the response buffer, watch for writing
```

Each worker k is the only producer for its ring `done[k]`, and the loop is the only consumer of all of them, so the step 6 single-producer ring fits without changes. The loop stops reading from a client while that client's job runs, so each client has at most one job in flight. With the chapter 08 limit of 1000 clients, rings of 1024 slots can never fill.

The write end of the pipe is nonblocking. If the pipe is full, `write` fails with `EAGAIN`, and that is fine because the loop already has a wakeup pending and drains every ring when it wakes. Watch the read end with your `loop_watch` from chapter 08, so the same code runs on epoll and kqueue. A client can disconnect while its job runs, and its slot can be reused by a new client before the result arrives. Store a generation number in every client slot, increment it when the slot is reused, and copy it into the job. When a result's generation does not match, the loop drops the result and frees it.

The image is about 1 MiB, and a file under `/disk/` can be any size, but the chapter 08 limits give each client a 64 KB output queue. Responses from jobs bypass that queue. The job builds the whole response in a heap buffer and the result carries the buffer. The loop gives the client slot a pointer to the buffer, its length and a send offset. While the offset is below the length, the loop watches the client for writing and writes from the offset each time the socket is writable. When the offset reaches the length, it frees the buffer, stops watching for writing and watches the client for reading again. It also frees the buffer when the generation check fails or the client disconnects partway through.

Two kinds of slow request exercise this. `GET /mandel.pgm` renders the step 7 image, with `parallel_for` inside the job, and `job_wait` lets that job help with its own rows. `GET /disk/<name>` reads a file at request time with `fopen` and `fread`, so the disk read happens on a worker. Take the allowed names from the command line as in chapter 08 and keep exact lookup, so a request cannot reach any other path.

### Study

- [Linux man page: pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html) (reference, as needed): "I/O on pipes and FIFOs", "Pipe capacity" and "Open file status flags" for `O_NONBLOCK` and `EAGAIN`. The Mac's `man 2 pipe` describes the same call. Everything else in this step builds on the event loop and HTTP subset from chapter 08 and on your rings and job system.

### Build

1. Copy `httpd.c` from chapter 08 to `src/httpd2.c`. Start the job system with one worker fewer than the core count, since the loop thread needs a core. Add the wake pipe, one done ring per worker and the generation number in each client slot.
2. Add `GET /mandel.pgm` and `GET /disk/<name>` as jobs. Keep a `-inline` flag that runs both in the loop thread instead, for comparison.
3. Extend `tests/http.sh` with both new paths, a 404 for a disk name that is not on the command line, a client that sends a `/mandel.pgm` request and disconnects before the response, and a client that reads the first 64 KB of a `/mandel.pgm` response and then disconnects. Check that `/mandel.pgm` over HTTP has the same bytes as `mandel`'s output file.
4. Rerun `httptest` from chapter 08 while 8 clients request `/mandel.pgm` in a loop, with and without `-inline`. Record the pinger's worst round trip in both modes.
5. In Linux, load test `/mandel.pgm` with `wrk -t2 -c16 -d10s` in both modes and record requests per second.
6. Add a section to `docs/jobs-ordering.md` for the server: the pipe, the rings, the generation numbers, and which thread owns each client slot's fields at each moment.

### Done when

`sh tests/http.sh` passes on the Mac and in Linux, and a TSan build of `httpd2` serves the whole test run with no report. With the job system, the pinger's worst round trip stays under 50 ms while the `/mandel.pgm` clients run, and with `-inline` it does not. The `wrk` numbers show the job-system mode serving more `/mandel.pgm` requests per second than `-inline`, and you can explain the ratio from the core count and the step 7 Mandelbrot timings. Neither disconnecting client leaves a leaked slot, buffer or descriptor, checked with `ls /proc/<pid>/fd` as in chapter 08.

## Where this leads

You can now split work across cores and predict how much faster it will run. You know what a lock is made of, from one atomic exchange up to a futex, and you have changed the locks inside a kernel. You built a queue that threads sleep on, a ring that two threads share with no lock, and a work-stealing job system. You wrote down why each one is correct: who owns each piece of data at each moment, and which release and acquire pair moves it from one thread to the next. The server now uses every core for slow work and still answers a ping in under 50 ms.

All of those ownership rules live in comments and in `docs/jobs-ordering.md`. The compiler does not read them, and TSan only checks the paths your tests happen to run. Chapter 10, Rust, introduces a language whose type system tracks ownership and borrowing. It rejects at compile time a program that lets two threads mutate the same data without synchronization. You port your SIMD hash table and the event loop to Rust and benchmark the two languages against each other, and the ordering arguments you wrote here carry over unchanged.
