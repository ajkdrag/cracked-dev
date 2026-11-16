---
id: 15
title: A small kernel
part: Kernels and bare metal
weeks: 8
project: A Rust kernel for x86-64 that boots on QEMU, handles exceptions and hardware interrupts, builds its own page mappings and heap, and switches between two tasks on the timer interrupt.
---

Chapter 14 ended with two shipped games. Under each of them sat macOS. It loaded the program, mapped its memory, delivered keyboard events and scheduled its threads. In chapter 08 you saw that machinery from inside xv6. But someone else had booted xv6 and written its trap entry and its scheduler, and you changed parts of a kernel that already worked.

This chapter opens the part on kernels and bare metal. You write a kernel from its first instruction. You follow Philipp Oppermann's Writing an OS in Rust from a binary with no standard library through output, exceptions, hardware interrupts, paging and a heap. That is eleven posts, and one author carries you through six steps. Then you leave the tutorial and add what it does not have: two tasks, each with its own stack, that the timer interrupt switches between.

The kernel is in Rust. Chapter 10 taught you `unsafe`, and a kernel needs it in a few exact places: raw addresses, port I/O and the instructions that load CPU tables. The kernel targets x86-64, because the tutorial does and because it pins a BIOS bootloader that works. Your Mac cannot run x86 code, so QEMU emulates a whole PC in software. A kernel this small runs fine that way. You read x86-64 assembly and its calling convention in chapter 05. This chapter adds the privileged half of the same instruction set. Chapters 16 and 17 go back to ARM.

The boot path below is the contract you work inside. Everything above `_start` belongs to the bootloader. Writing a bootloader is a separate project, and this chapter does not do it.

```
  power on
     |
  BIOS firmware in QEMU's emulated PC
     |  loads the first sector of the disk image and jumps to it
  bootloader crate, version 0.9
     |  switches the CPU from 16-bit real mode to 64-bit long mode
     |  reads your kernel's ELF file and maps its segments
     |  zeroes .bss, sets up a stack with an unmapped guard page below it
     |  jumps to your entry point
  _start, later kernel_main: your Rust code
     |  output, interrupt tables, page mappings, heap, tasks
  idle loop: hlt until the next interrupt
```

## A freestanding binary that boots

Every Rust program you wrote so far linked the standard library, and `std` assumes an operating system underneath: files, threads, a heap and a C runtime that calls `main`. A kernel has none of those. `#![no_std]` drops `std` and keeps `core`, the part of the library that needs nothing from an OS. `core` has `Option`, iterators, slices and formatting. You then supply two things the runtime used to supply: a panic handler and an entry point named `_start`.

The first post builds such a binary for an ARM microcontroller target, only to show that the linker errors go away when the target has no OS. The second post defines a custom target in a JSON file and recompiles `core` for it with Cargo's `build-std`. Three lines in that JSON file matter later. `"disable-redzone": true` turns off the red zone. The System V ABI from chapter 05 lets a leaf function use 128 bytes below `rsp` without moving `rsp`, and an interrupt would push its frame right on top of them. `"features": "-mmx,-sse,+soft-float"` keeps the compiler away from the SSE registers, so the kernel's whole register state is the 16 general registers plus flags. Step 7 depends on that.

Do the chapter on the Mac. Install the tools with Homebrew:

```sh
brew install qemu x86_64-elf-gdb
cargo install bootimage        # run this outside the kernel's directory
```

The tutorial needs nightly Rust. Nightly changes every day, so pin one. Instead of the post's one-line `rust-toolchain` file, put this `rust-toolchain.toml` in the kernel's directory. rustup then installs that nightly and both components the first time you run Cargo there:

```toml
[toolchain]
channel = "nightly-2026-11-16"
components = ["rust-src", "llvm-tools-preview"]
```

The tutorial's code lives in the `phil-opp/blog_os` repository on GitHub, with one branch per post. Its CI builds and tests every branch each night against the latest nightly on macOS and Linux. If a later nightly breaks your build, move the date back to one that worked. Compare your code with the post's branch when you are stuck.

### Study

- [Writing an OS in Rust: A Freestanding Rust Binary](https://os.phil-opp.com/freestanding-rust-binary/) (do, 1 h): From "Introduction" through "Building for a Bare Metal Target", typed in and built. Skip "Linker Arguments", an optional host-specific detour. Read "Making rust-analyzer happy" only if your editor shows errors.
- [Writing an OS in Rust: A Minimal Rust Kernel](https://os.phil-opp.com/minimal-rust-kernel/) (do, 2 h): The whole post. "The Boot Process" explains BIOS boot and the jump to long mode. "How does it work?" under "Creating a Bootimage" states what the bootloader has done before `_start`. Skip "Real Machine".

### Build

1. Install the tools as above. Follow both posts in a new crate named `blog_os`, so that your paths match the tutorial's. Use `rust-toolchain.toml` instead of the post's `rust-toolchain`.
2. Set up `cargo run` as the post's last section shows. It should open a QEMU window with "Hello World!" at the top.
3. Look at what the bootloader loads. The `llvm-tools-preview` component ships ELF tools for the Mac:

   ```sh
   T=$(rustc --print sysroot)/lib/rustlib/aarch64-apple-darwin/bin
   $T/llvm-readobj --elf-output-style=GNU --headers target/x86_64-blog_os/debug/blog_os
   $T/llvm-nm target/x86_64-blog_os/debug/blog_os | grep _start
   ```

   In `NOTES.md`, write down the entry point address, the `LOAD` segments with their virtual addresses and flags, and which segment holds `_start`.

### Done when

`cargo run` shows "Hello World!" in the QEMU window. The entry point in the ELF header equals the address `llvm-nm` prints for `_start`. Without the post open, you can list what the bootloader did before your first instruction ran: long mode, page mappings for each segment, a zeroed `.bss` and a stack.

## Printing: the VGA buffer, the serial port and tests

A kernel talks to devices in two ways on x86. The VGA text buffer is memory-mapped I/O. The video hardware reads the 80 by 25 character cells from physical address `0xb8000`, so a store to that address changes the screen. The compiler does not know that, and it may drop a store that nothing in the program reads back. The post wraps the buffer in `Volatile` to forbid that. Chapter 04 showed you what an optimizer assumes about ordinary memory, and device memory breaks those assumptions.

The serial port uses the other way, port I/O. x86 has a separate 16-bit address space for devices, reached with the `in` and `out` instructions. A 16550 UART sits at port `0x3F8`. QEMU connects it to your terminal when you pass `-serial stdio`. From the next step on, serial output is your `printf`. It still works when the screen is garbage, and you can copy and search its text.

The testing post also builds a test runner for a kernel. Cargo's normal harness needs `std`, so the post uses the unstable custom test frameworks feature. QEMU's `isa-debug-exit` device lets the kernel end the emulator with an exit code, which turns a kernel run into a pass or fail result. The global writer sits behind `spin::Mutex`, a spinlock like the ones you built in chapter 09. A kernel has no OS that could put a waiting thread to sleep.

The tutorial explains `macro_rules!` as far as its `println!` needs. Keep the QEMU option list open for the rest of the chapter.

### Study

- [Writing an OS in Rust: VGA Text Mode](https://os.phil-opp.com/vga-text-mode/) (do, 2 h): The whole post.
- [Writing an OS in Rust: Testing](https://os.phil-opp.com/testing/) (do, 2 h 30 min): The whole post. "Integration Tests" sets up the `lib.rs` and `tests/` layout that every later post builds on, so do not skip it.
- [QEMU docs: Invocation](https://www.qemu.org/docs/master/system/invocation.html#hxtool-9) (reference, as needed): "Debug/Expert options" has `-d`, `-D` and `-no-reboot`. "Character device options" explains what `-serial stdio` connects.

### Build

1. Follow both posts.
2. Add `run-args = ["-serial", "stdio", "-no-reboot"]` to `[package.metadata.bootimage]` in `Cargo.toml`, next to the post's `test-args`. Make the non-test panic handler print to serial as well as to the screen.
3. Add your own test in `vga_buffer.rs`: print a line of 100 `x` characters and check, by reading the buffer back, that one row holds 80 of them and the row below holds the other 20.
4. Add a `#[should_panic]`-style integration test of your own under `tests/`, modelled on the post's `should_panic.rs`, that fails an `assert_eq!` on purpose.

### Done when

`cargo test` runs every unit and integration test, prints `[ok]` for each on your terminal and leaves QEMU without you closing a window. `cargo run` prints the same text in the QEMU window and in your terminal. A `panic!` in `_start` shows its message with file and line on the serial output.

## CPU exceptions, double faults and a debugger

An exception is the CPU refusing to go on with the current instruction. x86 numbers them 0 to 31: 0 is divide error, 3 is breakpoint, 6 is invalid opcode, 8 is double fault, 13 is general protection fault and 14 is page fault. The Interrupt Descriptor Table (IDT) holds one entry per vector with the handler's address and some options. The `lidt` instruction tells the CPU where the table is. xv6 on RISC-V had one trap address in `stvec` and a cause register. x86 dispatches on the vector instead.

The two ISAs also save state differently. RISC-V copied the pc into `sepc` and saved nothing else. x86 pushes an interrupt stack frame onto the stack before it jumps to the handler:

```
  higher addresses
     SS          the interrupted stack segment
     RSP         the interrupted stack pointer
     RFLAGS      flags, including IF (interrupts enabled, bit 9)
     CS          the interrupted code segment
     RIP         the interrupted instruction
     error code  only for some exceptions, such as page fault
  <- rsp when the handler starts
```

Before pushing, the CPU aligns `rsp` down to 16 bytes. The `x86-interrupt` calling convention makes the compiler save every register the handler touches and return with `iretq`, which pops the frame. Step 7 replaces one such handler with assembly you write, so read "The Interrupt Calling Convention" closely.

A fault raised while the CPU is delivering another exception becomes a double fault. A fault while delivering the double fault is a triple fault, and the CPU resets. QEMU then reboots, which looks like a flicker and a loop. `-no-reboot` makes QEMU exit instead. The second post walks the worst case. The kernel overflows its stack into the guard page, the page fault cannot push its frame because the stack pointer still points into that page, and the double fault cannot either. The fix is the Interrupt Stack Table in the Task State Segment, which gives the double fault handler a separate stack. Loading a TSS needs a Global Descriptor Table, a leftover of x86 segmentation. In 64-bit mode the GDT only has to hold a code segment and the TSS.

You need to see what the CPU did when the screen shows nothing. QEMU gives you two tools. `-d int -D qemu.log` writes one entry per exception or interrupt. Each entry starts with a counter, then `v=` with the vector, `e=` with the error code, `IP=` with the code segment and instruction pointer, and `CR2=` with the faulting address for a page fault. A `check_exception old: 0xe new 0xe` line marks a fault raised while delivering another one. The second tool is gdb. `-s -S` makes QEMU wait for a gdb connection on port 1234. Under QEMU's software emulation, hardware breakpoints are unlimited, so use `hbreak`. Put the manual command in a script, because `cargo run` does not take these flags:

```sh
# debug.sh
qemu-system-x86_64 \
  -drive format=raw,file=target/x86_64-blog_os/debug/bootimage-blog_os.bin \
  -serial stdio -no-reboot -d int -D qemu.log "$@"
```

Run `cargo bootimage` first, then `./debug.sh -s -S`. In a second terminal run `x86_64-elf-gdb target/x86_64-blog_os/debug/blog_os` and type `target remote localhost:1234`.

### Study

- [Writing an OS in Rust: CPU Exceptions](https://os.phil-opp.com/cpu-exceptions/) (do, 2 h): The whole post. "Too much Magic?" points to first-edition posts with an older Rust syntax. Do not follow that link.
- [Writing an OS in Rust: Double Faults](https://os.phil-opp.com/double-fault-exceptions/) (do, 2 h 30 min): The whole post, including "A Stack Overflow Test".
- [QEMU docs: GDB usage](https://www.qemu.org/docs/master/system/gdb.html) (reference, as needed): The top of the page for `-s -S`, `target remote` and `info reg`, and "Breakpoint and Watchpoint support".

### Build

1. Follow the CPU exceptions post. Then, at its breakpoint test, stop in gdb before the handler's prologue with `hbreak *blog_os::interrupts::breakpoint_handler` and run `x/5gx $rsp`. Match the five words to RIP, CS, RFLAGS, RSP and SS. Check that the saved RIP points just past the `int3` instruction with `x/2i <address>-1`.
2. Follow the double faults post up to "Kernel Stack Overflow". Run the overflowing kernel with `./debug.sh`. In `qemu.log`, find the first `v=0e` entry with a `CR2` address just below the stack, the `check_exception` line that turns it into `v=08`, and the last `check_exception` line before QEMU exits. Copy the three into `NOTES.md` and say what each one means.
3. Finish the post. Run the overflow again with gdb attached and `hbreak` on your double fault handler. `info symbol $rsp` should name the `STACK` array from `gdt.rs`.

### Done when

`cargo test` passes, including the post's `stack_overflow` test. Your `NOTES.md` explains the three log lines in order. You can draw the interrupt stack frame without notes and say why the double fault handler needs its own stack while the breakpoint handler does not.

## Hardware interrupts: the PIC, the timer and the keyboard

Exceptions come from the instruction that is running. Hardware interrupts come from devices, between any two instructions. QEMU's PC has the two chained 8259 Programmable Interrupt Controllers of the original IBM PC. Each collects the interrupt lines of a few devices and forwards one to the CPU with a vector number. Their default vectors collide with the CPU exceptions, so the post remaps them to 32 to 47. The PIC then waits for an End of Interrupt before it delivers the next interrupt from that line or a lower-priority one. Forget the EOI and the timer fires once and never again.

The timer is the Programmable Interval Timer. At its default setting it fires about 18.2 times a second: its input clock of 1,193,182 Hz divided by 65,536. That rate is slow, and it is enough for this chapter. The keyboard puts each scancode at I/O port `0x60`, and the handler must read it before the controller sends another.

The post then provokes a deadlock. The main code holds the writer's spinlock, the timer interrupt arrives, and its handler spins on the same lock forever. The fix is to turn interrupts off while the lock is held. In chapter 09 you explained why xv6's `acquire` turns interrupts off before it spins. This is the same bug on one CPU. The post ends with `hlt`, which parks the CPU until the next interrupt instead of spinning.

### Study

- [Writing an OS in Rust: Hardware Interrupts](https://os.phil-opp.com/hardware-interrupts/) (do, 2 h 30 min): The whole post. "Configuring the Timer" links to the OSDev wiki on the PIT. You do not need it, as the default rate is enough.

### Build

1. Follow the post through keyboard input.
2. Replace the dots with a tick counter: a `static TICKS: AtomicU64` that the timer handler increments. In `kernel_main`, print the count once per second of ticks, from a loop that runs `hlt` between checks.
3. Comment out the EOI in the timer handler and run with `./debug.sh`. Count the `v=20` entries in `qemu.log`. Put the EOI back.

### Done when

Keys you type appear on the screen. Over 60 seconds by a clock, the counter grows by about 1,092. With the EOI removed, `qemu.log` shows exactly one `v=20` entry. You can tell the deadlock from the post as a sequence of events, naming who holds the lock and who spins.

## Paging on x86-64

In chapter 08 you walked RISC-V's Sv39 tables: three levels and a 39-bit address. x86-64 uses four levels and a 48-bit address. Each level is a 4 KB table of 512 eight-byte entries, so each level eats 9 bits of the address, and the last 12 bits are the offset into the page. Bits 48 to 63 must copy bit 47, or the CPU raises a general protection fault. `CR3` holds the physical address of the level 4 table, the job `satp` did on RISC-V. `invlpg` drops one stale translation from the TLB, as `sfence.vma` did.

```
  virtual address 0x0000_4444_4444_0000

  bits    47..39   38..30   29..21   20..12   11..0
          L4 = 136 L3 = 273 L2 = 34  L1 = 64  offset 0

  CR3 -> L4 table, entry 136 -> L3 table, entry 273
      -> L2 table, entry 34  -> L1 table, entry 64 -> frame + offset
```

A page fault on x86 sets `CR2` to the faulting address, the job `stval` did, and pushes an error code with bits for "page was present", "write" and "user mode".

A kernel has one problem that xv6 hid from you. Page table entries hold physical addresses, but once paging is on, the kernel can only load from virtual addresses. To edit a table, it needs a virtual address that maps to the table's frame. The second post lists the ways out and picks one: the bootloader maps all of physical memory at a fixed offset and tells the kernel the offset in its `BootInfo`. The bootloader also hands over the firmware's memory map, and the post turns its usable regions into a frame allocator. A frame is 4 KB of physical memory. A page is 4 KB of virtual addresses. The allocator hands out frames, and the page tables decide where each frame appears.

### Study

- [Writing an OS in Rust: Introduction to Paging](https://os.phil-opp.com/paging-introduction/) (read, 1 h 30 min): The whole post. "Segmentation" is history and can be skimmed. Work the "Example Translation" with a pencil.
- [Writing an OS in Rust: Paging Implementation](https://os.phil-opp.com/paging-implementation/) (do, 3 h): The whole post. Read "Temporary Mapping" and "Recursive Page Tables" once as alternatives. The code uses "Map the Complete Physical Memory".

### Build

1. Follow both posts.
2. Write `dump_level4(phys_offset)`. It prints each present entry of the level 4 table with its index, the physical address of the level 3 table it points to and its flags. Explain each line in `NOTES.md`: which one covers the kernel's code, which the bootloader's map of physical memory, and which the stack.
3. Write `map_stack(slot, mapper, frame_allocator) -> VirtAddr` in `memory.rs`. A slot is 64 KB of address space at `0x5555_0000_0000 + slot * 0x1_0000`. Leave the first page of the slot unmapped as a guard. Map the next four pages present and writable to fresh frames, and return the address just past the last one, which becomes the top of the stack. Step 7 uses it for task stacks.
4. Test `map_stack(0, ...)`: write a `u64` just below the top and read it back. Then read from the slot's first page. The page fault handler from the first post should print a `CR2` equal to `0x5555_0000_0000`.

### Done when

The post's tests and your write-and-read test pass. By hand, you can split `0x4444_4444_0000` into the indexes 136, 273, 34 and 64 and offset 0. The guard page read stops in the page fault handler with the address you predicted. You can say how many new page-table frames `map_stack(0, ...)` needed and why.

## A kernel heap

Now that you can map pages, the kernel can have a heap. Rust's interface to an allocator is the `GlobalAlloc` trait with two methods: `alloc` takes a `Layout`, a size plus an alignment, and returns a pointer, and `dealloc` takes the pointer and the same `Layout` back. Unlike C's `free`, `dealloc` is told the size. Once a type implementing the trait is marked `#[global_allocator]`, the `alloc` crate gives the kernel `Box`, `Vec` and `Rc`. The heap itself is 100 KB of pages that `init_heap` maps at `0x4444_4444_0000`, the address from the last step's diagram.

The second post builds three allocators, and you have met two of them before. The bump allocator is the arena from chapter 04. It moves a pointer forward on each allocation and can only reuse memory once every allocation is freed. The linked list allocator keeps the free regions in a list threaded through the free memory itself, like the free list of the malloc you built on `mmap` in chapter 08. The fixed-size block allocator keeps one free list per size class, the way production allocators serve small requests. `GlobalAlloc` takes `&self`, so each allocator sits behind a spinlock for mutation, the same `spin::Mutex` again.

### Study

- [Writing an OS in Rust: Heap Allocation](https://os.phil-opp.com/heap-allocation/) (do, 1 h 30 min): The whole post.
- [Writing an OS in Rust: Allocator Designs](https://os.phil-opp.com/allocator-designs/) (do, 3 h): The whole post. "Variations" describes slab and buddy allocators. Read it, but do not build them.

### Build

1. Follow both posts. Keep all three allocators in the tree, so that switching the `#[global_allocator]` line switches the allocator.
2. Run `tests/heap_allocation.rs` with each allocator in turn.
3. Add a test that allocates 1,000 boxes of mixed sizes (8, 64 and 2,048 bytes in rotation), keeps every third one, drops the rest, then allocates 1,000 more. Run it with each allocator.

### Done when

All four heap tests and your mixed test pass with the linked list and the fixed-size block allocators. With the bump allocator, `many_boxes_long_lived` fails, and you can say why in one sentence that uses chapter 04's arena. You can say which allocator in this step is closest to your chapter 08 malloc and where the two differ.

## Two tasks and a context switch

The tutorial stops here. Its last post builds cooperative multitasking from Rust's `async`/`await`, where tasks are state machines that share one stack. You build what xv6 has instead: tasks with their own stacks and saved registers, switched by the timer.

A task is a stack plus the registers that were live when it stopped. Chapter 08 showed you xv6 doing this in two ways. `swtch` saves only the callee-saved registers, because the kernel calls it as an ordinary function, and the compiler has already saved every caller-saved register it still needs. The trap path saves every register, because an interrupt can land between any two instructions. You build both, in that order.

The cooperative switch comes first. On x86-64 the callee-saved registers are `rbx`, `rbp` and `r12` to `r15`, from your chapter 05 table. `switch(old_rsp: *mut u64, new_rsp: u64)` pushes those six, stores `rsp` through `old_rsp`, loads `new_rsp` into `rsp`, pops six and returns. The `ret` pops whatever return address sits on the new stack. A task that has never run needs a stack that looks as if it had called `switch`:

```
  stack top (16-byte aligned)
    top - 8     task_exit      the entry function's "return address", panics if reached
    top - 16    entry          popped by switch's ret
    top - 24    0              rbp
    ...         0              rbx, r12, r13, r14
    top - 64    0              r15    <- saved rsp of the new task
```

After the `ret`, `rsp` is `top - 8`, which leaves it 8 past a 16-byte boundary. A function expects exactly that right after a `call`.

Preemption needs the full state. Point the timer's IDT entry at a handler you write in assembly. The CPU has already pushed the five-word frame from step 3. The handler pushes the 15 general registers other than `rsp`, passes `rsp` to a Rust function `schedule(rsp: u64) -> u64`, loads the returned value into `rsp`, pops the 15 registers and runs `iretq`. `schedule` stores the old task's `rsp`, sends the EOI, picks the next task and returns that task's saved `rsp`. The stack is aligned for the call without any extra work: the CPU aligned `rsp` before the frame, and 5 plus 15 words make 160 bytes. Because your target has no SSE, those registers plus the frame are a task's whole state. A task that has never run needs a fake frame:

```
  stack top (16-byte aligned)
    top - 8     task_exit
    top - 16    SS        the current SS
    top - 24    RSP       top - 8
    top - 32    RFLAGS    0x202: IF set, plus bit 1, which is always 1
    top - 40    CS        the current CS
    top - 48    RIP       entry
    top - 56    0         rax, pushed first
    ...         0         rbx, rcx, rdx, rsi, rdi, rbp, r8 to r14
    top - 168   0         r15    <- saved rsp of the new task
```

Copy CS and SS from the running kernel with `CS::get_reg()` and `SS::get_reg()` from `x86_64::registers::segmentation`. `iretq` already accepts those values when your other handlers return. The frame's RFLAGS enables interrupts in the new task, so the first `iretq` into it also turns preemption on.

Both functions are naked functions. `#[unsafe(naked)]` tells the compiler to emit no prologue or epilogue, and the body is one `naked_asm!` block. Declare the timer entry `unsafe extern "custom"`, as the Rust reference's note on naked functions advises, because it follows no calling convention. Install it with `set_handler_addr` instead of `set_handler_fn`. Rust's inline assembly uses Intel syntax by default. The destination comes first, and registers have no `%`, the reverse of the AT&T syntax you read in chapter 05. A `sym` operand puts the address of a Rust function into the assembly, which is how the handler calls `schedule`.

The scheduler's table of tasks is shared between task code and the timer handler. The handler runs with interrupts off and cannot wait for a lock. So task code touches the table only inside `without_interrupts`, the rule from step 4.

### Study

- [Rust By Example: Inline assembly](https://doc.rust-lang.org/rust-by-example/unsafe/asm.html) (read, 1 h): "Basic usage" through "Symbol operands and ABI clobbers", then "Options". The examples are x86-64.
- [The Rust Reference: The naked attribute](https://doc.rust-lang.org/reference/attributes/codegen.html#the-naked-attribute) (read, 20 min): The whole section, including the note on `extern "custom"`.
- [x86_64 crate: idt::Entry](https://docs.rs/x86_64/0.15.5/x86_64/structures/idt/struct.Entry.html) (reference, as needed): `set_handler_addr` and the defaults it sets: interrupts off on entry, no IST stack.

### Build

1. Write `task.rs` with a fixed table of up to four tasks, each a saved `rsp`. Slot 0 is the boot context: whatever runs `kernel_main` after `init` becomes task 0 the first time it is switched away from. `spawn(entry)` takes a stack from `map_stack` with the next free slot and writes the initial frame.
2. Cooperative version: write the naked `switch` and `yield_now()`, which picks the next task round robin and calls `switch`. Spawn task A and task B. Each prints its name and a counter to serial, then yields. Task 0 loops on `yield_now()`. Commit this version.
3. Preemptive version: write the naked timer entry and `schedule`, change `spawn` to write the interrupt frame, and remove every call to `yield_now`. Task 0 runs `hlt_loop()`. Tasks A and B print and then busy-wait about 10 million iterations of `core::hint::spin_loop()` between prints.
4. Change task A to `loop {}` after its first print. Then spawn a task C that recurses without end.

### Done when

The cooperative version prints A and B in strict alternation. The preemptive version prints runs of A and runs of B with no yields in the code, and B keeps printing after A enters `loop {}`. Task C ends in your double fault handler with its message on serial, not in a QEMU reset. In gdb, with `hbreak` on `schedule`, `x/20gx $rdi` shows the 15 saved registers followed by a RIP inside a task function, CS, RFLAGS with bit 9 set, RSP and SS. You can say which registers `switch` saves and which the timer entry saves, and why the two sets differ.

## Where this leads

You have written each mechanism of a kernel once with nothing beneath it but the bootloader. You filled in the IDT, gave the double fault its own stack, acknowledged the PIC by hand, built page mappings from a frame allocator, put a heap on top and switched between tasks on the timer. Your kernel also knew where every device lived: the screen at `0xb8000`, the UART at port `0x3F8`, the keyboard at port `0x60`. It had no user mode, no files and one CPU, and every new device would need register-level code of its own.

Chapter 16, Linux drivers, moves to a kernel that has all of that. You compile Linux for ARM64, boot it under QEMU and write a driver for an emulated PCI device. Linux's core owns the interrupt entry, the page tables and the scheduler you just wrote. A driver fills in interfaces that the core calls, and it asks the PCI core where its device lives instead of hard-coding an address.
