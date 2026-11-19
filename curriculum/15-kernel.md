---
id: 15
title: A small kernel
part: Kernels and bare metal
weeks: 10
project: A Rust kernel for x86-64 that boots on QEMU, handles exceptions and hardware interrupts, builds its own page mappings and heap, switches between tasks on the timer interrupt, and runs a user program in ring 3 that makes a system call and survives its own page fault.
---

Chapter 14 ended with two games on itch.io, each of which runs as an ordinary process. Windows or Linux creates that process, gives it virtual memory and schedules its threads. In chapter 08 you used those services from the user side and read the code of a small kernel that provides them, xv6. But someone else had booted xv6 and written its trap entry and its scheduler. You changed parts of a kernel that already worked.

In this chapter you write a kernel from its first instruction. A **kernel** is the program that runs with full control of the CPU and gives every other program its memory, its time and its access to devices. You follow Philipp Oppermann's Writing an OS in Rust through eleven posts: a binary with no operating system, text output, exceptions, hardware interrupts, paging and a heap. Then you leave the tutorial and add what it does not have: tasks that the timer interrupt switches between, and a user program that runs in the CPU's unprivileged mode and asks the kernel for work with a system call.

The kernel is written in Rust. Chapter 10 taught you `unsafe`, and a kernel needs it in a few exact places: raw addresses, device registers and the instructions that load CPU tables. The posts and this chapter introduce the rest as it comes: `no_std`, `extern` functions and assembly inside Rust.

The kernel targets x86-64, the instruction set of your laptop, whose user-mode half you learned in chapter 05. This chapter adds the privileged half. **QEMU**, the emulator from chapter 08, runs the kernel on an emulated PC inside WSL, and its window reaches your desktop through WSLg.

The chapter has eighteen steps, more than most, because each one adds a single mechanism and many are short. Every step compares a piece with what xv6 did on RISC-V. You will meet the same ideas under x86 names: the trap vector becomes a table of 256 entries, `satp` becomes `CR3`, and the kernel stack pointer that xv6 kept in the trapframe becomes a field of a CPU structure called the TSS.

## A Rust binary with no operating system

Every Rust program you wrote so far linked the **standard library**, `std`, and `std` assumes an operating system underneath it: files, threads, a heap and a C runtime that calls `main`. A kernel runs before any of those exist. This step builds a Rust program that needs nothing from an operating system.

The attribute `#![no_std]` drops `std` and keeps **`core`**, the part of Rust's library that needs no operating system. `core` has `Option`, `Result`, slices, iterators and formatting. It has no `Vec`, no `Box`, no `println!` and no files. Without `std` you supply two things it used to supply:

- a **panic handler**, the function that runs when the program panics. Under an operating system `std` printed the message and ended the process. A kernel has no process to end, so your handler loops forever for now.
- an **entry point**, the first function that runs. `std` used a C runtime that set things up and then called `main`. The post names its own function `_start`, the name linkers look for by default, and marks it `#[unsafe(no_mangle)]` so the compiler keeps that exact name.

Both functions return `!`, Rust's type for "never returns".

After a panic, a normal Rust program **unwinds**: it walks back up the stack and drops the values of each function it leaves. That needs a library that reads the unwind tables the compiler writes, and `std` brought it along. The post sets `panic = "abort"` in `Cargo.toml` instead, so a panic goes straight to your handler and nothing unwinds.

The post then builds the program for a **target** with no operating system. A target triple, as chapter 12 explained, names the CPU, the vendor and the system a program is built for. Building for your Linux target fails at the link step, because the linker adds Linux's C startup code, which also defines `_start`.

The post switches to `thumbv7em-none-eabihf`, an ARM microcontroller target whose `none` says there is no operating system, and the build succeeds. The ARM target only shows that the code itself needs nothing. The next step replaces it with an x86-64 target of your own.

### Study

- [Writing an OS in Rust: A Freestanding Rust Binary](https://os.phil-opp.com/freestanding-rust-binary/) (do, 1 h): From "Introduction" through "Building for a Bare Metal Target", typed in and built. Skip "Linker Arguments", which makes the program build for Linux, a detour this chapter does not take. Read "Making rust-analyzer happy" only if your editor shows errors.

### Build

1. Create the crate with the post's name, so your paths match the tutorial's. Like every crate since chapter 10, it lives in `rust/` of your book repository: `cd ~/code/hello/rust && cargo new blog_os`.
2. Follow the post. Run `cargo build` once at the point where the post expects the linker error and read it. It names `_start`.
3. Add the ARM target with `rustup target add thumbv7em-none-eabihf` and build with `cargo build --target thumbv7em-none-eabihf`.
4. Commit.

> **Practice:** Commit after each post builds and runs, with the post's title in the message. The tutorial's code for each post is on the post's branch of the `phil-opp/blog_os` repository on GitHub, and `git diff` against your commit is the quickest way to find a mistake.

### Done when

`cargo build --target thumbv7em-none-eabihf` finishes without errors. You can name three things `std` has that `core` lacks, and say why a kernel cannot use them yet. You can say what `panic = "abort"` turns off and why a kernel has nothing to unwind into.

## Booting the kernel in QEMU

The binary from the last step has no way to start. Something has to load it into memory and jump to `_start`, and on a PC that takes two programs before yours.

The **firmware** is the program stored in the computer's own chip that runs at power on. On QEMU's emulated PC it is a **BIOS**, the PC's original firmware, which tests the hardware, reads the first 512-byte sector of the disk into memory and jumps to it. Current PCs boot through **UEFI**, the BIOS's successor, which the post mentions. The bootloader this chapter uses works with the BIOS only, which QEMU provides.

That first sector starts the **bootloader**, the program that loads a kernel. Yours is the Rust crate `bootloader`, version 0.9, which the post requires. It does the jobs in the figure and then jumps to your entry point:

![At power on the BIOS in QEMU's PC loads the bootloader from the first sector of the disk image. The bootloader switches to 64-bit long mode, maps the kernel's segments, a stack and all of physical memory, writes BootInfo and jumps to _start, your first instruction.](figures/15-boot.svg)

An x86 CPU starts in **real mode**, a 16-bit mode kept from the 8086 of chapter 05. The bootloader switches it to **long mode**, the 64-bit mode your programs run in. It reads your kernel's ELF file and maps each `LOAD` segment, the program headers you read with `readelf` in chapter 05.

The bootloader also fills in a **BootInfo** structure, with the list of physical memory regions and the address where it mapped all of physical memory, and passes it to your entry point. Step 9 uses it. The tool **bootimage** glues the compiled bootloader and your kernel into one disk image file, which QEMU boots.

The post also defines an x86-64 target in a JSON file. Three of its lines matter later:

- `"disable-redzone": true` turns off the **red zone** (not the red zones of AddressSanitizer from chapter 01). The System V ABI lets a function that calls nothing use 128 bytes below `rsp` without moving `rsp`. An interrupt, which step 5 explains, writes its own data right there, so a kernel must not use the red zone.
- `"features": "-mmx,-sse,+soft-float"` keeps the compiler away from the SSE registers, the `xmm` vector registers of chapter 07. Floating-point math is then done in software. A task's whole register state becomes the 16 general registers and the flags, which keeps the task switch of step 14 small.
- `"rustc-abi": "softfloat"` tells `rustc` to use the calling convention that goes with `+soft-float`.

Rust has no prebuilt `core` for your own target, so the post has Cargo compile it from source with the unstable `build-std` option. Unstable options exist only in **nightly** Rust, the daily build of the compiler. Nightly changes every day, so pin one date. Put this `rust-toolchain.toml` in the crate's directory instead of the post's one-line `rust-toolchain` file. rustup installs that nightly and both components the first time you run Cargo there:

```toml
[toolchain]
channel = "nightly-2026-11-16"
components = ["rust-src", "llvm-tools-preview"]
```

`rust-src` is the source of `core` that `build-std` compiles, and `llvm-tools-preview` supplies the LLVM tools that `bootimage` uses to build the bootloader. Use the crate versions the posts give, which the documentation links in this chapter match: `bootloader` 0.9, `volatile` 0.2.6, `spin` 0.5.2 and `x86_64` 0.15.5.

> **If it fails:** If a later nightly breaks the build, move the date back to one that worked. The blog_os repository builds and tests every post's branch each night against the latest nightly.

### Study

- [Writing an OS in Rust: A Minimal Rust Kernel](https://os.phil-opp.com/minimal-rust-kernel/) (do, 2 h): The whole post except "Real Machine". "The Boot Process" covers the BIOS, UEFI and the switch to long mode. "How does it work?" under "Creating a Bootimage" lists what the bootloader does before `_start`. Use the `rust-toolchain.toml` above where the post installs nightly.

### Build

1. Install QEMU for x86 machines and its window code, which shows the emulated screen through WSLg: `sudo apt install -y qemu-system-x86 qemu-system-gui`.
2. From your home directory, run `cargo install bootimage`. Outside the kernel's directory the pinned nightly does not apply, so bootimage builds with your stable Rust from chapter 10.
3. Follow the post. Each build prints a warning that `core` contains code a future Rust will reject, about the `sse` target feature. It comes from the `-sse` line of your target file and does not stop the build.
4. Set up `cargo run` as the post's last section shows. It opens a QEMU window with "Hello World!" at the top. Close the window to stop QEMU.
5. Look at what the bootloader loads, with the tools from chapter 05:

   ```sh
   readelf -hlW target/x86_64-blog_os/debug/blog_os
   nm target/x86_64-blog_os/debug/blog_os | grep _start
   ```

   Start a file `NOTES.md` in the kernel's folder. Write down the entry point address, the `LOAD` segments with their virtual addresses and flags, and which segment holds `.text`.

> **If it fails:** If `cargo run` opens no window, run the WSLg checks from the step "SDL3 under WSLg" in chapter 06. To see the screen without a window, run `qemu-system-x86_64 -drive format=raw,file=target/x86_64-blog_os/debug/bootimage-blog_os.bin -display curses`, which draws the text screen inside your terminal. Press Esc, then 2, and type `quit` to leave it.

> **Optional:** QEMU here emulates every instruction in software, which is fast enough for this kernel. WSL2 on Windows 11 can also pass the CPU's hardware virtualization through, called **KVM** on Linux. The device `/dev/kvm` exists only when WSL's nested virtualization is on. If `ls -l /dev/kvm` lists the device and your user may open it, adding `-accel kvm` to QEMU's arguments runs the kernel at full speed. The debugging in the later steps relies on plain emulation, so leave it off there.

### Done when

`cargo run` shows "Hello World!" in the QEMU window. The entry point in the ELF header equals the address `nm` prints for `_start`. Without the post open, you can list what the bootloader did before your first instruction ran: long mode, mappings for each segment, a zeroed `.bss`, a stack and the BootInfo.

## Text on the screen: the VGA buffer

The "Hello World!" from the last step wrote bytes through a raw pointer to address `0xb8000`. This step turns that into a `println!` macro you can use from anywhere in the kernel.

A kernel talks to a device through the device's **registers**, small pieces of storage inside the device that the CPU reads and writes. x86 has two ways to reach them. This step uses the first, **memory-mapped I/O**: the device answers to ordinary memory addresses, and a `mov` to one of them reaches the device instead of RAM. The VGA text screen works this way. The video hardware keeps reading 80 by 25 character cells from physical address `0xb8000` and draws what it finds:

![The VGA text buffer at physical address 0xb8000 holds 80 by 25 cells of two bytes each, a character byte and a color byte. Cell n starts at 0xb8000 + 2n, and the video hardware draws whatever bytes are there.](figures/15-vga.svg)

The compiler does not know that the hardware reads those bytes. It sees stores that nothing in the program reads back, and it may delete them, as it would have deleted the writes of chapter 07's fault probe. There you declared the pointer `volatile`, which makes the compiler perform every access exactly as written. The post gets the same from the `volatile` crate's `Volatile` type, which wraps the buffer.

The post then makes one global writer that every part of the kernel shares. A plain `static` cannot be changed, so the post puts the writer behind `spin::Mutex`. That is a spin lock like the one you built in chapter 09, because a kernel has no operating system that could put a waiting thread to sleep. `lazy_static!` creates the writer the first time it is used, because Rust cannot build it at compile time. Last, the post defines `println!` with `macro_rules!`, explained as far as this macro needs, and makes the panic handler print its message.

### Study

- [Writing an OS in Rust: VGA Text Mode](https://os.phil-opp.com/vga-text-mode/) (do, 2 h): The whole post.

### Build

1. Follow the post.
2. The writer's color is a private field of `vga_buffer.rs`. Add a public function there that sets it, and use it in `_start` to print one line in a color of your choice, then set the color back.
3. Add `panic!("Some panic message")` at the end of `_start`, as the post does, and run it.

### Done when

`cargo run` shows your `println!` lines in the QEMU window, one of them in your color. The panic shows its message with the file name and line number. You can say what could go wrong without `Volatile` in a release build.

## The serial port and tests that run in QEMU

Text in the QEMU window disappears when QEMU exits, and you cannot copy or search it. This step adds a second output that ends up in your terminal, and a test runner that boots the kernel, runs tests and exits QEMU with a result.

The serial port uses the second way to reach a device, **port I/O**. x86 has a separate 16-bit address space for devices, the **I/O ports**, which only the instructions `in` and `out` reach:

![x86 has two address spaces. mov reaches memory, where RAM and the VGA buffer live. in and out reach the 16-bit I/O port space, where the keyboard, the serial port and QEMU's exit device live. QEMU connects each device to something on your machine.](figures/15-io-ports.svg)

A **UART** is the chip behind a serial port. It sends bytes one bit at a time over a wire. The PC's first UART answers at port `0x3F8`. QEMU connects it to your terminal when you pass `-serial stdio`, so every byte the kernel sends appears there. The post uses the `uart_16550` crate, named after the classic UART chip, for the port's registers.

Cargo's normal test harness needs `std`. The post uses the unstable **custom test frameworks** feature instead, which collects every `#[test_case]` function and hands the list to a runner function you write. QEMU's `isa-debug-exit` device ends the emulator when the kernel writes a value to port `0xf4`. QEMU then exits with the code `(value << 1) | 1`, so `cargo test` sees a pass or a failure.

The post ends with **integration tests**, the files under `tests/`. Each one is a separate kernel that boots on its own. They share the kernel's code through a library crate, `src/lib.rs`, which every later post builds on.

> **Practice:** From here on, print anything you want to read later with `serial_println!`. The terminal keeps it, and you can copy it into `NOTES.md`.

### Study

- [Writing an OS in Rust: Testing](https://os.phil-opp.com/testing/) (do, 150 min): The whole post. Do not skip "Integration Tests", which sets up the `lib.rs` and `tests/` layout.
- [QEMU docs: Invocation](https://www.qemu.org/docs/master/system/invocation.html) (reference, as needed): QEMU's command-line options. Use two sections: "Character device options" explains what `-serial stdio` connects, and "Debug/Expert options" has `-d`, `-D` and `-no-reboot`, which later steps use.

### Build

1. Follow the post.
2. In `Cargo.toml`, add `run-args = ["-serial", "stdio", "-no-reboot"]` to `[package.metadata.bootimage]`, next to the post's `test-args`. `-no-reboot` makes QEMU exit instead of restarting when the CPU resets, which step 7 relies on.
3. Make the non-test panic handler print its message with `serial_println!` as well as on the screen.
4. Add a test to `vga_buffer.rs`. Take the writer's lock once with `let mut writer = WRITER.lock();` and keep it for the whole test. Through `writer`, write a newline and then 100 `x` characters with `write_byte`. Read the buffer back through the same `writer`, the way the post's `test_println_output` reads it, and check that the second-to-last row holds 80 of them and the last row the other 20.

### Done when

`cargo test` runs every unit and integration test, prints `[ok]` for each in your terminal and ends QEMU by itself. `cargo run` prints the same text in the QEMU window and in your terminal. A `panic!` in `_start` shows its message with file and line in the terminal.

## CPU exceptions and the interrupt table

With output on serial and a test runner, you can make the kernel fail on purpose and check what it does next. An **exception** is an event the CPU raises when it cannot finish the current instruction, or when the instruction asks for one. Each kind has a number, its **vector**. x86 numbers the exceptions 0 to 31:

- 0 is a divide error, a division by zero.
- 3 is a breakpoint, raised by the one-byte instruction `int3`.
- 8 is a double fault, the subject of step 7.
- 13 is a general protection fault, raised by many kinds of forbidden actions.
- 14 is a page fault, raised by a load or store the page table does not allow.

The **Interrupt Descriptor Table** (IDT) holds one entry per vector, 256 in all. Each entry holds the address of a **handler**, the function to run, and a few options. The instruction `lidt` tells the CPU where the table is. xv6 on RISC-V had one trap address in `stvec` and read the cause from `scause`. x86 picks the handler by vector instead.

The two instruction sets also save different state. RISC-V copied the pc into `sepc` and saved nothing else. x86 pushes an **interrupt stack frame** onto the stack and then jumps to the handler:

![On int3 the CPU looks up vector 3 in the IDT that lidt loaded, pushes five words onto the current stack and jumps to the handler with rsp pointing at RIP. SS sits at the highest address. A fault like a page fault adds an error code below RIP, and rsp then points at the error code.](figures/15-idt.svg)

Before it pushes, the CPU rounds `rsp` down to a multiple of 16. The five words, from the highest address down:

- `SS`, the interrupted stack's segment.
- `RSP`, the interrupted stack pointer.
- `RFLAGS`, the flags register. Its bit 9, IF, is set while the CPU accepts hardware interrupts.
- `CS`, the code segment, which step 15 explains.
- `RIP`, the address to continue at.

A handler cannot be an ordinary function. An ordinary function may change the caller-saved registers, and it returns with `ret`, which pops one word. The `x86-interrupt` calling convention makes the compiler save every register the handler touches and return with `iretq`, which pops the whole frame. Step 14 replaces one such handler with assembly you write, so read "The Interrupt Calling Convention" closely.

### Study

- [Writing an OS in Rust: CPU Exceptions](https://os.phil-opp.com/cpu-exceptions/) (do, 2 h): The whole post. "Too much Magic?" links to first-edition posts with an older Rust syntax. Do not follow that link.

### Build

1. Follow the post. Keep its `int3` call in `_start`.
2. Print the stack frame the handler receives with `serial_println!("{:#?}", stack_frame)`, as the post prints it to the screen, and copy it into `NOTES.md`.

### Done when

`cargo test` passes, including the post's `test_breakpoint_exception`. You can draw the interrupt stack frame without notes and say why `iretq` pops five words where `ret` pops one.

## Watching the CPU: QEMU's gdb server and interrupt log

From the next step on, some failures leave nothing on the screen: the CPU resets, or an interrupt fires once and never again. This step sets up two ways to see what the CPU did, and tries both on the `int3` from the last step.

QEMU contains a gdb server. In chapter 08, `make qemu-gdb` started it for xv6 and you connected `gdb-multiarch`. This kernel is x86-64 like your laptop, so plain `gdb` reads it, and you start the server yourself. `-s` opens the server on port 1234, and `-S` stops the CPU before its first instruction.

QEMU can also write a line for every exception and interrupt into a file: `-d int` turns that log on and `-D qemu.log` names the file. `cargo run` does not take these flags, so keep the QEMU command in a script:

```sh
#!/bin/sh
# debug.sh: boot the last image built by cargo bootimage
exec qemu-system-x86_64 \
  -drive format=raw,file=target/x86_64-blog_os/debug/bootimage-blog_os.bin \
  -serial stdio -no-reboot -d int -D qemu.log "$@"
```

`"$@"` passes on any extra arguments, such as `-s -S`.

Each exception in `qemu.log` starts a line like `1: v=03 e=0000 i=1 cpl=0 IP=0008:00000000002074a0 ...`, followed by a dump of every register. The fields:

- The number before the colon counts the interrupts so far.
- `v=` is the vector in hex. The timer of step 8 shows up as `v=20`, which is 32.
- `e=` is the error code, 0 for exceptions that push none.
- `cpl=` is the privilege level the CPU was running at, which step 15 explains.
- `IP=` is the code segment and the address of the instruction that raised it.
- `SP=` is the stack segment and the stack pointer.
- `CR2=`, in the register dump below the line, is the faulting address of a page fault.

### Study

- [QEMU docs: GDB usage](https://www.qemu.org/docs/master/system/gdb.html) (reference, as needed): The top of the page for `-s -S`, `target remote` and `info registers`, and "Breakpoint and Watchpoint support".

### Build

1. Write `debug.sh` in the kernel's folder and make it executable with `chmod +x debug.sh`.
2. Run `cargo bootimage`, then `./debug.sh` and close the window. Find the `v=03` line in `qemu.log` with `grep v=03 qemu.log`.
3. Run `./debug.sh -s -S`. QEMU waits.
4. In a second terminal, in the crate's directory, run `gdb target/x86_64-blog_os/debug/blog_os` and type these commands:

   ```
   target remote localhost:1234
   set language rust
   hbreak *blog_os::interrupts::breakpoint_handler
   continue
   x/5gx $rsp
   ```

   gdb picks its language from the code it is stopped in. The BIOS code has none, so `set language rust` is needed before gdb can read the path `blog_os::interrupts::breakpoint_handler`. Start every gdb session in this chapter with the first two commands.

   `hbreak` sets a hardware breakpoint, which the CPU checks itself. A normal `break` writes an `int3` into memory, and the bootloader overwrites that memory when it loads the kernel. The `*` stops before the handler's first instruction, while `rsp` still points at the frame.
5. Match the five words to RIP, CS, RFLAGS, RSP and SS. Run `x/2i` with the saved RIP minus 1, for example `x/2i 0x2074a1-1`, and find the `int3` that raised the exception.

### Done when

In gdb, the saved RIP points just past an `int3` instruction and the saved RFLAGS has bit 9 set. The `IP=` of the `v=03` line in `qemu.log` is the address of the `int3` itself, one less than the saved RIP, and you can say why the two differ.

## Double faults and a stack from the TSS

The CPU itself can fail while it delivers an exception, for example when it cannot push the frame. It then raises a **double fault**, vector 8. A fault while it delivers the double fault is a **triple fault**, and the CPU resets. QEMU then reboots, which looks like a flicker and a loop, and `-no-reboot` makes it exit instead.

The post walks the worst case. The kernel recurses until its stack runs into the **guard page**, an unmapped page the bootloader left below the stack so that an overflow faults instead of overwriting other memory. The page fault cannot push its frame, because `rsp` still points into that page. The double fault cannot push its frame either:

![The kernel stack overflows into the unmapped guard page. The page fault and then the double fault both try to push their frame onto the same stack and fail, which resets the CPU. With an IST entry in the TSS, the CPU switches to a separate stack for the double fault, and the push succeeds.](figures/15-double-fault.svg)

The fix is a second stack that the CPU switches to by itself. The **Task State Segment** (TSS) is a small structure in memory that holds stack pointers for the CPU to load. Its **Interrupt Stack Table** (IST) has seven of them. An IDT entry can name one, and the CPU then loads that stack pointer before it pushes the frame. Step 15 uses another field of the same TSS.

The CPU finds the TSS through the **Global Descriptor Table** (GDT), a table of **segment descriptors**. Segments were how 16- and 32-bit x86 divided memory. In 64-bit mode they no longer translate addresses, and the GDT has only two jobs left: it says which privilege level code runs at, which step 15 explains, and it points at the TSS. The post's GDT holds a kernel code segment and the TSS.

In `qemu.log`, a fault raised while the CPU was delivering another one shows as a `check_exception` line, such as `check_exception old: 0xe new 0xe`.

### Study

- [Writing an OS in Rust: Double Faults](https://os.phil-opp.com/double-fault-exceptions/) (do, 150 min): The whole post, including "A Stack Overflow Test".

### Build

1. Follow the post through "Kernel Stack Overflow". Run the overflowing kernel with `cargo bootimage && ./debug.sh`.
2. In `qemu.log`, find the first `v=0e` line whose `CR2` lies just below the stack, the `check_exception` line that turns it into `v=08`, and the last `check_exception` line before QEMU exits. Copy the three into `NOTES.md` and say what each one means.
3. Finish the post. Run the overflow again under gdb with `hbreak *blog_os::interrupts::double_fault_handler`. When it stops, `info symbol $rsp` names the `STACK` array from `gdt.rs`.

### Done when

`cargo test` passes, including the post's `stack_overflow` test. `NOTES.md` explains the three log lines in order. You can say why the double fault handler needs its own stack and the breakpoint handler does not.

## Hardware interrupts: the PIC, the timer and the keyboard

Exceptions come from the instruction that is running. **Hardware interrupts** come from devices, between any two instructions. This step connects the timer and the keyboard to your IDT.

QEMU's PC has the two chained **8259 Programmable Interrupt Controllers** (PICs) of the original IBM PC. Each PIC collects the interrupt lines of up to eight devices and interrupts the CPU with a vector number. Real PCs today use the newer **APIC**, which also serves several CPUs, and Linux uses it, as chapter 16 will show. The 8259 is simpler and QEMU still emulates it.

![The timer and the keyboard raise lines 0 and 1 of the primary PIC, and the secondary PIC's lines arrive through line 2. The primary PIC interrupts the CPU with vector 32 plus the line number, and it delivers nothing more from that line until the handler sends an End of Interrupt.](figures/15-pic.svg)

The PICs' default vectors collide with the CPU exceptions 0 to 31, so the post moves them to 32 to 47. A PIC then waits for an **End of Interrupt** (EOI), a byte the handler writes to the PIC's port, before it delivers the next interrupt from that line or a lower-priority one. Without the EOI the timer fires once and never again.

The timer is the **Programmable Interval Timer** (PIT). At its default setting it fires about 18.2 times a second: its input clock of 1,193,182 Hz divided by 65,536. That is slow, and it is enough for this chapter. The keyboard controller puts each key's **scancode**, a number for the key that went down or up, at I/O port `0x60`, and the handler must read it there.

The post then provokes a deadlock. The main code holds the writer's spin lock, the timer interrupt arrives, and its handler spins on the same lock forever. The fix is to turn interrupts off while the lock is held.

In chapter 09 you explained why xv6's `acquire` turns interrupts off before it spins. This kernel runs on one CPU, so no other CPU can hold a lock, and turning interrupts off around the spin lock is all it needs. The post also adds `hlt`, which stops the CPU until the next interrupt instead of spinning.

### Study

- [Writing an OS in Rust: Hardware Interrupts](https://os.phil-opp.com/hardware-interrupts/) (do, 150 min): The whole post. "Configuring the Timer" links to another site about the PIT. You do not need it, because the default rate is enough.

### Build

1. Follow the post through keyboard input. When it changes `test_println_output`, wrap the lock in your step 4 test in `without_interrupts` the same way.
2. Replace the dots with a tick counter: a `static TICKS: AtomicU64` that the timer handler increments. In `kernel_main`, run a loop that executes `hlt` and prints the count with `serial_println!` each time it reaches a new multiple of 18.
3. Comment out the EOI in the timer handler, rebuild and run with `./debug.sh`. Count the `v=20` lines in `qemu.log` with `grep -c 'v=20' qemu.log`. Put the EOI back.

### Done when

Keys you type appear on the screen. Over 60 seconds by a clock, the counter grows by about 1,092. With the EOI removed, `qemu.log` holds exactly one `v=20` line. You can tell the deadlock from the post as a sequence of events, naming who holds the lock and who spins.

## Four-level page tables

The stack overflow in step 7 hit a guard page that the bootloader left unmapped. So far every mapping came from the bootloader. This step reads its page tables, and the next step adds mappings of your own.

In chapter 08 you walked RISC-V's Sv39 tables: three levels and a 39-bit address. x86-64 uses four levels and a 48-bit address. Each level is a 4 KiB table of 512 eight-byte entries, so each level uses 9 bits of the address, and the last 12 bits are the offset into the page:

![x86-64 splits the low 48 bits of a virtual address into four 9-bit indexes and a 12-bit offset, and bits 63 to 48 must copy bit 47. CR3 points at the level 4 table, and each index picks an entry in the next table. Sv39 in chapter 08 walks the same way without the level 4 step.](figures/15-page-walk.svg)

The register `CR3` holds the physical address of the level 4 table, the job `satp` did on RISC-V. Bits 48 to 63 of an address must copy bit 47, or the CPU raises a general protection fault. An entry's flags work like xv6's PTE flags: present, writable, user accessible, and accessed and dirty, which the hardware sets. The instruction `invlpg` drops one stale translation from the TLB, as `sfence.vma` did. On a page fault the CPU puts the faulting address in `CR2`, the job `stval` did, and pushes an error code with bits for "page was present", "write" and "user mode".

A kernel has one problem that xv6 hid from you. Page table entries hold physical addresses, but once paging is on, every load and store uses a virtual address. To edit a table, the kernel needs a virtual address that maps to the table's frame. The second post lists the ways out and picks one: the bootloader maps all of physical memory at a fixed **offset** and passes the offset to the kernel in the BootInfo from step 2. Physical address `p` is then readable at virtual address `offset + p`.

### Study

- [Writing an OS in Rust: Introduction to Paging](https://os.phil-opp.com/paging-introduction/) (read, 90 min): The whole post. "Segmentation" is history and can be skimmed. Work the "Example Translation" with a pencil.
- [Writing an OS in Rust: Paging Implementation](https://os.phil-opp.com/paging-implementation/) (do, 90 min): From "Introduction" through "Using OffsetPageTable". Read "Temporary Mapping" and "Recursive Page Tables" once as alternatives. The code uses "Map the Complete Physical Memory". Stop before "Creating a new Mapping", where the next step continues.

### Build

1. Follow both posts as far as the scope above. The first one adds a page fault handler, which the later steps rely on. Make it print with `serial_println!` too.
2. Write `dump_level4(physical_memory_offset)` in `memory.rs`. It prints each entry of the level 4 table that is not unused, with its index, the physical address it points to and its flags.
3. In `kernel_main`, print `boot_info.physical_memory_offset`, the address of `boot_info`, the address of a local variable and the address of `kernel_main` itself. Divide each by `1 << 39` to get its level 4 index.
4. In `NOTES.md`, explain each line of the dump: which entry covers the kernel's code, which the boot information and the stack, and which the map of physical memory.

### Done when

Every line of your dump has an explanation in `NOTES.md`, except possibly one at index 31. That one holds the empty tables of a temporary page at `0xfeeefeee000`, which the bootloader used while it zeroed `.bss` and then unmapped. By hand, you can split `0x4444_4444_0000`, where step 11 will put the heap, into the indexes 136, 273, 34 and 64 and offset 0. You can say why the map of physical memory takes more than one level 4 entry on QEMU's PC, using the memory map the bootloader passes in BootInfo.

## New mappings and stacks with guard pages

The last step read the bootloader's mappings. Now the kernel makes its own. The rest of the chapter needs fresh memory in three places: a heap, a stack for each task, and pages for a user program.

Two words keep the two address spaces apart. A **frame** is 4 KiB of physical memory. A **page** is 4 KiB of virtual addresses. A **frame allocator** hands out frames that nobody uses yet, and the page tables decide at which page each frame appears.

The post builds its frame allocator from the bootloader's **memory map**, the list of physical memory regions and what each holds, and hands out the usable ones in order. It never takes a frame back, which is enough for this chapter.

Mapping a page can need new tables. If the level 4 entry for the page is empty, the mapper takes three more frames from the allocator, for a level 3, a level 2 and a level 1 table, before it can write the final entry.

You use the mapper right away for task stacks. Each task in step 13 needs a stack of its own, and a stack overflow should hit a guard page as the bootloader's stack did:

![map_stack gives each slot 64 KiB of addresses starting at 0x5555_0000_0000. The first page stays unmapped as a guard, the next four pages are mapped to fresh frames, and the returned top is the address just past them. The stack grows down toward the guard.](figures/15-stack-slots.svg)

### Study

- [Writing an OS in Rust: Paging Implementation](https://os.phil-opp.com/paging-implementation/) (do, 90 min): The same post, continued from where step 9 stopped: "Creating a new Mapping" to the end.

### Build

1. Follow the rest of the post.
2. Write `map_stack(slot, mapper, frame_allocator) -> VirtAddr` in `memory.rs`. A slot is 64 KiB of address space at `0x5555_0000_0000 + slot * 0x1_0000`. Leave the first page of the slot unmapped, map the next four pages present and writable to fresh frames with `map_to`, and return the address just past the last one.
3. Test `map_stack(0, ...)`: write a `u64` just below the top and read it back. Then read the `u64` at `0x5555_0000_0000`, in the guard page. The page fault handler from step 9 should report a `CR2` of `0x5555_0000_0000`.
4. Run `dump_level4` before and after the first `map_stack` call and compare.

### Done when

The post's tests and your write-and-read test pass. The guard page read stops in the page fault handler with the address you predicted. The second dump has one new line, at index 170. There is no line at index 136 yet, because the heap comes in step 11. You can say how many frames `map_stack(0, ...)` took from the allocator and why.

## A kernel heap

With mappings of your own, the kernel can have a heap, and with a heap it can use `Box`, `Vec` and `Rc`. Those types live in the `alloc` crate, which sits between `core` and `std`. It needs one thing from you: an allocator.

Rust's interface to an allocator is the `GlobalAlloc` trait with two methods:

- `alloc` takes a `Layout`, a size and an alignment, and returns a pointer to that much memory, or null when there is none.
- `dealloc` takes the pointer and the same `Layout` back. Unlike C's `free`, it is told the size.

The attribute `#[global_allocator]` on a static of a type that implements the trait makes it the allocator for every `Box` and `Vec` in the program.

The heap itself is 100 KiB of address space at `0x4444_4444_0000`, the address you split into indexes in step 9. `init_heap` maps its 25 pages to whatever frames the frame allocator returns:

![init_heap maps the 25 pages from 0x4444_4444_0000 to frames that the frame allocator picks anywhere in physical memory. Box and Vec call the global allocator, which hands out pieces of those 100 KiB.](figures/15-heap-region.svg)

The frames do not have to be next to each other. The allocator only ever sees the virtual addresses, and those are contiguous. At the end of the post the allocator is a crate, `linked_list_allocator`. The next step replaces it with three of your own.

With the heap in place, the kernel's address space has every region it will have until the user program arrives. Each sits under its own level 4 entry, and the figure doubles as the answer key for your `dump_level4` notes:

![The kernel's virtual address space after the heap step. Each region sits under its own level 4 entry. The bootloader made the regions at indexes 0 to 31, and your kernel made the heap at index 136 and the task stacks at index 170.](figures/15-address-space.svg)

### Study

- [Writing an OS in Rust: Heap Allocation](https://os.phil-opp.com/heap-allocation/) (do, 90 min): The whole post.

### Build

1. Follow the post.
2. After `init_heap`, print the address of a `Box` and of a `Vec`'s buffer, and check that both lie inside the heap's 100 KiB.
3. Run `dump_level4` again and check that the new line at index 136 matches the figure.

### Done when

`cargo test` passes, including the post's `tests/heap_allocation.rs`. Both addresses lie between `0x4444_4444_0000` and `0x4444_4445_9000`. You can say what `alloc` returns when the heap is full and what `Box::new` then does.

## Allocator designs

The crate from the last step works, and you do not know how. This step writes three allocators, and you have met two of them before:

- The **bump allocator** is the arena from chapter 04. It moves a pointer forward on each allocation and can only reuse memory once every allocation is freed.
- The **linked list allocator** keeps the free regions in a list threaded through the free memory itself, like the free list of the malloc you built on `mmap` in chapter 08.
- The **fixed-size block allocator** keeps one free list per size class, the way production allocators serve small requests, and falls back to the linked list for large ones.

![The linked list allocator keeps a list of free regions inside the heap itself. Each free region starts with a node holding its size and a pointer to the next free region. alloc unlinks a region that fits, and dealloc pushes the region back on the front of the list.](figures/15-free-list.svg)

`GlobalAlloc` takes `&self`, not `&mut self`, so each allocator sits behind a lock, the same `spin::Mutex` again. The post wraps it in a small type, `Locked`, to be allowed to implement the trait for it.

A heap can fail with free memory left. The post's linked list allocator never merges neighboring free regions, so after many allocations of mixed sizes the free memory lies in pieces that are each too small for a large request. That is **fragmentation**. The post's section "Merging Freed Blocks" explains the fix and leaves it out. Your test below makes it visible.

### Study

- [Writing an OS in Rust: Allocator Designs](https://os.phil-opp.com/allocator-designs/) (do, 3 h): The whole post. "Variations" describes slab and buddy allocators. Read it, but do not build them.

### Build

1. Follow the post. Keep all three allocators in the tree, so that changing the `#[global_allocator]` line switches the allocator.
2. Run `tests/heap_allocation.rs` with each allocator in turn.
3. Add `tests/mixed_sizes.rs` with one test, `mixed_sizes`, that does this:
   1. Allocate 50 boxed slices of 8, 64 and 2,048 bytes in rotation, each filled with its index.
   2. Keep every fourth one in a `Vec::with_capacity(50)` and drop the others.
   3. Run ten rounds. Each round allocates 50 more slices in the same rotation into another `Vec::with_capacity(50)` and then drops them.
   4. At the end, check that the kept slices still hold their values.

   The test never has more than about 45 KB live, but it allocates about 370 KB in total, so the 100 KiB heap only holds it if freed memory comes back.
4. Run `mixed_sizes` with each allocator. Then raise the rounds to 100, run it with the linked list allocator, note the round where it fails in `NOTES.md`, and set the rounds back to ten.

### Done when

All four heap tests and `mixed_sizes` pass with the linked list and the fixed-size block allocators. With the bump allocator, `many_boxes_long_lived` and `mixed_sizes` fail, and you can say why in one sentence that uses chapter 04's arena. You can say why the linked list allocator runs out of memory at 100 rounds although 45 KB of live data would fit. You can say which allocator here is closest to your chapter 08 malloc and where the two differ.

## Two tasks that take turns

The tutorial stops here. Its last post builds tasks from Rust's `async` and `await`, where tasks are state machines that share one stack. You build what xv6 has instead: tasks with their own stacks, switched first by a call and then by the timer.

A **task** is a stack plus the registers that were live when it stopped. Chapter 08 showed you xv6 saving those registers in two places. `swtch` saves only the callee-saved registers, because the kernel calls it as an ordinary function, and the compiler has already saved every caller-saved register it still needs. The trap path saves every register, because an interrupt can land between any two instructions. You build both, the call first.

On x86-64 the callee-saved registers are `rbx`, `rbp` and `r12` to `r15`, from your chapter 05 table. `switch` pushes those six, stores `rsp` through its first argument, loads its second argument into `rsp`, pops six and returns:

```rust
#[unsafe(naked)]
unsafe extern "C" fn switch(old_rsp: *mut u64, new_rsp: u64) {
    naked_asm!(
        "push rbp", "push rbx", "push r12", "push r13", "push r14", "push r15",
        "mov [rdi], rsp",   // save this task's rsp through old_rsp
        "mov rsp, rsi",     // from here on, the other task's stack
        "pop r15", "pop r14", "pop r13", "pop r12", "pop rbx", "pop rbp",
        "ret",              // pops the other task's return address
    );
}
```

`switch` must not have the prologue and epilogue the compiler adds to a function, because it moves `rsp` itself. A **naked function**, marked `#[unsafe(naked)]`, gets no prologue or epilogue. Its body is one `naked_asm!` block of assembly. `extern "C"` makes it follow the C calling convention of chapter 05, so callers pass `old_rsp` in `rdi` and `new_rsp` in `rsi`. Rust's inline assembly uses Intel syntax by default, with no `%` and the destination first, the other syntax chapter 05 showed.

The `ret` pops whatever return address sits on the new stack, so the new task continues where it called `switch` itself:

![switch(old, new) pushes the six callee-saved registers on task A's stack and stores rsp in A's table entry. It then loads B's saved rsp, pops B's six registers and returns into B, which continues inside its own call to yield_now.](figures/15-switch.svg)

A task that has never run has no such frame yet. `spawn` writes one by hand, so that the task's first `switch` pops six zeros and returns into its entry function:

![The frame spawn writes for a task that has never run. switch pops the six zeros into the callee-saved registers, and its ret pops the entry address into rip. task_exit stays on the stack as the return address of the entry function.](figures/15-coop-frame.svg)

The top is 16-byte aligned. After the `ret`, `rsp` is `top - 8`, 8 past a 16-byte boundary, which is what a function expects right after a `call`.

### Study

- [Rust By Example: Inline assembly](https://doc.rust-lang.org/rust-by-example/unsafe/asm.html) (read, 1 h): "Basic usage" through "Symbol operands and ABI clobbers", then "Options". The examples are x86-64.
- [The Rust Reference: The naked attribute](https://doc.rust-lang.org/reference/attributes/codegen.html#the-naked-attribute) (read, 20 min): The whole section, including the note on `extern "custom"`, which the next step uses.

### Build

1. Write `task.rs` with the task table:
   1. Define `enum State { Free, Ready }` and `struct Task { rsp: u64, state: State }`, with `#[derive(Clone, Copy, PartialEq)]` on the enum and `#[derive(Clone, Copy)]` on the struct.
   2. Define `struct Table { tasks: [Task; 4], current: usize }` and a `static TABLE: spin::Mutex<Table>`. `current` is the index of the running task.
   3. Start slot 0 as `Ready` and the other three as `Free`. Slot 0 is the boot context, the code that runs `kernel_main`. It already runs on the bootloader's stack, so it needs no frame, and its first `switch` stores its `rsp` like any other task's.
2. In the posts, the mapper and the frame allocator are local variables of `kernel_main`, and `spawn` needs them too. After paging init, move both into `static MEMORY: spin::Mutex<Option<(OffsetPageTable<'static>, BootInfoFrameAllocator)>>` in `memory.rs`.
3. Write `spawn(entry: extern "C" fn() -> !)`. It takes a stack from `map_stack` with the next free slot, starting at 1 because your test in step 10 used slot 0. It writes the frame from the figure and puts the task in the first `Free` entry.
4. Add `switch` from above and write `yield_now()`, which picks the next `Ready` task round robin and calls `switch` inside `without_interrupts`. Release the table's lock before the call.
5. Spawn task A and task B. Each prints its name and a counter to serial, then yields. Task 0 loops on `yield_now()`. Commit this version.

### Done when

A and B print in strict alternation: A 0, B 0, A 1, B 1. In gdb, stopped at `hbreak blog_os::task::switch`, `x/8gx $rsi` on the first switch into a new task shows six zeros, the entry function's address and `task_exit`. A naked function has no debug information, so gdb knows it only by name, and the plain `hbreak` with no `*` already stops at its first instruction. You can say why `switch` saves six registers and not sixteen.

## Preemption on the timer

The cooperative tasks only switch when they call `yield_now`. A task that loops without yielding keeps the CPU forever. **Preemption** takes the CPU away on the timer interrupt, whatever the task is doing, as xv6's timer did in chapter 08.

The timer can land between any two instructions, so the switch must save every register. Point the timer's IDT entry at a handler you write in assembly, `timer_entry`. The CPU has already pushed the five-word frame from step 5. `timer_entry` pushes the 15 general registers other than `rsp`, passes `rsp` to a Rust function `schedule(rsp: u64) -> u64`, loads the returned value into `rsp`, pops 15 registers and runs `iretq`:

![A timer interrupt in task A makes the CPU push five words and timer_entry push the fifteen other registers. schedule takes A's rsp, sends the EOI and returns B's saved rsp. timer_entry pops B's registers and iretq resumes B wherever the timer stopped it.](figures/15-preempt.svg)

Push in this order: `rax`, `rbx`, `rcx`, `rdx`, `rsi`, `rdi`, `rbp`, then `r8` to `r15`. Pop in the reverse order. The beginning and the end of `timer_entry`, with the other eleven pushes and pops for you to fill in:

```rust
naked_asm!(
    "push rax", "push rbx", "push rcx", "push rdx",
    // push rsi, rdi, rbp and r8 to r15
    "mov rdi, rsp",          // first argument: this task's rsp
    "call {schedule}",
    "mov rsp, rax",          // the return value: the next task's rsp
    // pop r15 to r8, rbp, rdi and rsi
    "pop rdx", "pop rcx", "pop rbx", "pop rax",
    "iretq",
    schedule = sym schedule,
);
```

A `sym` operand puts the address of a Rust function into the assembly, here `schedule`. `schedule` is `extern "C"`, so the assembly passes `rsp` in `rdi` and gets the result in `rax`. It stores the old task's `rsp`, sends the EOI, picks the next task and returns that task's saved `rsp`. The stack is aligned for the call without extra work: the CPU aligned `rsp` before the frame, and 5 plus 15 words make 160 bytes. Because your target has no SSE, those words are a task's whole state.

A task that has never run needs a frame that `timer_entry` can pop and `iretq` can return through:

![The frame spawn writes for a preemptive task. timer_entry pops the fifteen zeros into the general registers, and iretq pops RIP, CS, RFLAGS, RSP and SS, which starts the entry function with interrupts on.](figures/15-preempt-frame.svg)

Copy CS and SS from the running kernel with `CS::get_reg()` and `SS::get_reg()`, after `use x86_64::registers::segmentation::{CS, SS, Segment};`. RFLAGS is `0x202`: bit 9, IF, enables interrupts, and bit 1 is always 1. So the first `iretq` into the task also turns preemption on.

`timer_entry` follows no calling convention, so declare it `unsafe extern "custom"`, as the Reference's note advises. Install it with `set_handler_addr` instead of `set_handler_fn`. The task table is shared between task code and the timer handler, which runs with interrupts off and cannot wait for a lock. So task code touches the table only inside `without_interrupts`, the rule from step 8.

### Study

- [x86_64 crate: idt::Entry](https://docs.rs/x86_64/0.15.5/x86_64/structures/idt/struct.Entry.html) (reference, as needed): `set_handler_addr` and the defaults it sets: interrupts off on entry, no IST stack.

### Build

1. Write the naked `timer_entry` and `schedule`, and install `timer_entry` for the timer vector.
2. Change `spawn` to write the interrupt frame from the figure, and remove every call to `yield_now`. Task 0 runs `hlt_loop()`.
3. Tasks A and B print and then busy-wait about a million iterations of `core::hint::spin_loop()` between prints.
4. Change task A to `loop {}` after its first print, and run again.
5. Put A back. Spawn a task C that recurses without end, the way the post's `stack_overflow` test does, and run again.

### Done when

The counters of A and B both keep growing with no yields in the code, and B keeps printing after A enters `loop {}`. Task C ends in your double fault handler with its message on serial, not in a QEMU reset. In gdb, stopped at `hbreak *blog_os::task::schedule`, `x/20gx $rdi` shows the 15 saved registers followed by RIP, CS, RFLAGS with bit 9 set, RSP and SS. You can say which registers `switch` saves and which `timer_entry` saves, and why the two sets differ.

## Privilege levels, selectors and the TSS stack

Every task so far runs with the kernel's full power. A bug in one can overwrite the page tables or the task table. xv6 ran its programs in user mode, where such instructions and pages are forbidden. This step prepares the CPU tables for user mode on x86, and the next step runs a program there.

x86 has four **privilege levels**, called **rings**, numbered 0 to 3. Kernels use only two: ring 0 for the kernel and ring 3 for user code. The **current privilege level** (CPL) is stored in the low two bits of the `CS` register. In ring 3, privileged instructions such as `cli`, `hlt` and `lidt` raise a general protection fault. The CPU also refuses pages whose entries lack the user-accessible bit, the U bit you decoded in xv6.

`CS` and `SS` hold **segment selectors**, values that pick a GDT entry. A selector is built from two parts:

- the entry's index in the GDT, times 8.
- a two-bit **requested privilege level** (RPL) in the low bits, the ring the selector is used for.

The kernel's CS of `0x8` that you saw in gdb in step 6 is index 1 with RPL 0. To run in ring 3 the kernel needs two more GDT entries, a user data segment and a user code segment. The TSS descriptor is twice as long as the others and fills indexes 2 and 3. Appended after it, the user data segment sits at index 4 and the user code segment at index 5, so their ring 3 selectors are `0x23` and `0x2b`:

![The user task runs in ring 3 with CS 0x2b and SS 0x23, selectors whose low two bits say 3. On an interrupt or int 0x80 the CPU loads rsp from the TSS's RSP0 and pushes the user's SS, RSP, RFLAGS, CS and RIP on that kernel stack. iretq pops them and returns to ring 3.](figures/15-rings.svg)

The way back into the kernel needs a stack. When an interrupt arrives in ring 3, the CPU does not trust the user's `rsp`. It loads `rsp` from the TSS field **RSP0** and pushes the frame there.

xv6 kept the same address in `p->trapframe->kernel_sp`, and its `uservec` loaded it by hand. With one user task, one static stack serves as RSP0. A kernel with many user tasks rewrites RSP0 on every switch.

### Study

- [xv6 for x86, chapter 3: Traps, interrupts, and drivers](https://pdos.csail.mit.edu/6.828/2018/xv6/book-rev11.pdf#page=39) (read, 30 min): The x86 edition of the xv6 book you read in chapter 08, from the course's 2018 offering. Pages 39 to 41: the chapter's opening, "Systems calls, exceptions, and interrupts" and "X86 protection". Stop at "Code: The first system call", where step 17 continues. Its x86 is 32-bit. In 64-bit mode the CPU pushes SS and RSP on every interrupt, not only on a change of privilege, and registers are 64 bits wide.
- [x86_64 crate: TaskStateSegment](https://docs.rs/x86_64/0.15.5/x86_64/structures/tss/struct.TaskStateSegment.html) (reference, as needed): `privilege_stack_table`, whose entry 0 is RSP0.
- [x86_64 crate: gdt::Descriptor](https://docs.rs/x86_64/0.15.5/x86_64/structures/gdt/enum.Descriptor.html) (reference, as needed): `user_code_segment` and `user_data_segment`.

### Build

1. In `gdt.rs`, append `Descriptor::user_data_segment()` and then `Descriptor::user_code_segment()` after the TSS, and keep the selectors `append` returns. Print them.
2. Add a second static stack of 20 KiB, made like the double fault stack, and set `tss.privilege_stack_table[0]` to its top.

### Done when

The kernel prints the selectors `0x23` and `0x2b`, and `cargo test` still passes. You can work out both selectors from their GDT indexes by hand, and say where the CPU will find a stack when an interrupt arrives in ring 3.

## A user program in ring 3

The CPU tables are ready. This step puts a program in user pages and enters ring 3 with the instruction you already use: `iretq`. It loads CS and SS from the frame, and if CS says ring 3, the CPU continues there. So a user task is a task whose first frame holds the user selectors, a user stack pointer and a user entry point. `schedule` needs no change.

The user program is a few instructions of assembly in the kernel's source. A `global_asm!` block takes the same assembly syntax as `asm!` and places the text in the output file outside any function:

```rust
global_asm!(
    ".global user_start",
    ".global user_end",
    "user_start:",
    "    inc rbx",          // count, so gdb can see it run
    "    jmp user_start",
    "user_end:",
);
```

`.global` makes the two labels visible to Rust. Rust declares things defined outside Rust in an `unsafe extern "C"` block, here as `static user_start: u8` and `static user_end: u8`. The bytes between their addresses are the program. Its jump is relative to `rip`, so the bytes run at any address.

The kernel copies those bytes into a fresh frame and maps it as a user page at `0x1000_0000_0000`, with one more user page below `0x1000_0002_0000` for the user stack. Both sit under level 4 index 32, a row that the address space figure of the heap step did not have yet. The CPU lets ring 3 use a page only when the U bit is set in the entry at every level of the walk:

![The user code page at 0x1000_0000_0000 and the user stack page at 0x1000_0001_f000 share one path of tables under level 4 entry 32. Every entry on that path has the U bit, so code in ring 3 may use the two pages. The kernel's entries, such as the heap's at level 4 index 136, lack it.](figures/15-user-pages.svg)

### Study

- [x86_64 crate: PageTableFlags](https://docs.rs/x86_64/0.15.5/x86_64/structures/paging/page_table/struct.PageTableFlags.html) (reference, as needed): `PRESENT`, `WRITABLE` and `USER_ACCESSIBLE`.

### Build

1. Add the user program above in a new file `user.rs`.
2. Write `spawn_user()`. It takes a frame from the frame allocator, copies the program's bytes into it through the physical memory offset, and maps it at `0x1000_0000_0000` with `PRESENT | USER_ACCESSIBLE`.
3. It maps one more frame at `0x1000_0001_f000` with `PRESENT | WRITABLE | USER_ACCESSIBLE` for the user stack. `map_to` also sets the U bit on the upper-level entries it creates, because the CPU checks the bit at every level.
4. Still in `spawn_user`, write a frame at the top of the RSP0 stack from step 15: SS `0x23`, RSP `0x1000_0002_0000`, RFLAGS `0x202`, CS `0x2b`, RIP `0x1000_0000_0000`, then 15 zeros. Add it to the task table with that stack pointer. Keep tasks A and B running.

### Done when

A and B keep printing while the user task runs. With `./debug.sh`, `qemu.log` has `v=20` lines with `cpl=3` and `IP=002b:00001000...`, timer interrupts that landed in ring 3. In gdb at `schedule`, a frame whose CS is `0x2b` shows a saved `rbx` that grows from one stop to the next. You can say where the CPU found the stack for those interrupts.

## A system call through int 0x80

The user task runs, and it cannot do anything visible. It may not touch the serial port or the screen. A **system call** asks the kernel to do the work, as `ecall` did in xv6 and `syscall` in your chapter 05 programs. This step adds one: `write`, which prints a string.

x86-64 offers two ways in. The instruction `int n` raises vector `n` through the IDT, with the same TSS stack switch and the same frame as the timer. The instruction `syscall` is faster. It saves only RIP in `rcx` and RFLAGS in `r11`, does not switch stacks, and needs four model-specific registers set up first.

Linux uses `syscall`, which you called in chapter 05. This kernel uses `int 0x80`, the vector 32-bit Linux used, because every piece of it already exists in your kernel: an IDT entry, an assembly entry like `timer_entry`, the RSP0 stack and `iretq`.

An IDT entry has its own privilege level, the **descriptor privilege level** (DPL). An `int n` from ring 3 succeeds only when entry `n` has DPL 3. Every other entry stays at DPL 0, so a user program cannot fake a timer interrupt or a page fault. Entry `0x80` gets `.set_privilege_level(PrivilegeLevel::Ring3)`.

The convention for this kernel, borrowed from Linux: the call number goes in `rax`, the arguments in `rdi` and `rsi`, and the result comes back in `rax`. Number 1 is `write(pointer, length)`:

![One write through int 0x80: the user program puts the number in rax and the arguments in rdi and rsi, the CPU enters through IDT entry 0x80 on the TSS stack, syscall_entry saves the registers, syscall_dispatch calls sys_write, and the return value travels back in the saved rax through iretq.](figures/15-syscall.svg)

`syscall_entry` is `timer_entry` with two changes: its `call` goes to `syscall_dispatch(regs: &mut SavedRegs)`, and it has no `mov rsp, rax`, so it returns to the same task. `SavedRegs` is a `#[repr(C)]` struct, which fixes the field order in memory as in C. Its fields follow the stack upward, `r15` first and `rax` last, then the CPU's five words. `syscall_dispatch` reads `regs.rax`, `regs.rdi` and `regs.rsi`, and writes the result into `regs.rax`, which the pops load into the user's `rax`.

`sys_write` must not trust the pointer. A user program could pass the address of the kernel's heap, and the kernel would print its secrets. It could also pass an unmapped address, and the kernel would fault in ring 0.

So the whole range must lie inside one of the two user pages: the code page from `0x1000_0000_0000` or the stack page below `0x1000_0002_0000`. Compute the end with `ptr.checked_add(len)`, so that a huge length cannot wrap past `u64::MAX` and look small. Anything else returns `u64::MAX`, the bit pattern of -1. xv6's `copyin` does the full job, walking the user page table for every page of the range.

The new user program:

```rust
"user_start:",
"    lea rdi, [rip + user_msg]",  // address of the message, relative to rip
"    mov rsi, 18",                 // its length
"    mov rax, 1",                  // call number 1: write
"    int 0x80",
"user_spin:",
"    jmp user_spin",
"user_msg:",
"    .ascii \"hello from ring 3\\n\"",
"user_end:",
```

`.ascii` places the bytes of the string in the program.

### Study

- [xv6 for x86, chapter 3: Traps, interrupts, and drivers](https://pdos.csail.mit.edu/6.828/2018/xv6/book-rev11.pdf#page=41) (read, 45 min): The same chapter, continued from where step 15 stopped. Pages 41 to 45: "Code: The first system call", "Code: Assembly trap handlers", "Code: C trap handler" and "Code: System calls". xv6 uses vector 64 and passes arguments on the user stack, where your kernel uses registers. Stop before "Code: Interrupts".
- [x86_64 crate: idt::EntryOptions](https://docs.rs/x86_64/0.15.5/x86_64/structures/idt/struct.EntryOptions.html) (reference, as needed): `set_privilege_level`.

### Build

1. Write `SavedRegs`, the naked `syscall_entry`, `syscall_dispatch` and `sys_write`. Install `syscall_entry` at entry `0x80` with DPL 3.
2. Replace the user program with the one above and run.
3. Remove `.set_privilege_level(...)`, run with `./debug.sh` and find the `v=0d` line in `qemu.log`. Its error code `e=0402` is `0x80 * 8 + 2`, the IDT entry that refused the call. Put the line back.
4. Replace the `lea` line with `movabs rdi, 0x444444440000`, an address in the kernel's heap. `movabs` loads a full 64-bit constant into a register. Print the result in `syscall_dispatch` and check that it is `u64::MAX` and that nothing else appears. Repeat with `0x100000008000`, which lies between the two user pages and is not mapped. Put the `lea` back.

### Done when

"hello from ring 3" appears once on serial while A and B keep printing. `qemu.log` shows a `v=80` line with `cpl=3`. Without the DPL, the call ends in a general protection fault with `e=0402`. Both bad pointers return `u64::MAX` and the kernel keeps running. You can say why `sys_write` checks the range before it reads a byte, and name the two jobs `int 0x80` does that `syscall` leaves to the kernel.

## A user fault the kernel survives

Until now every page fault was a kernel bug, and the handler stopped the machine. A fault in user code is a bug in that program, and the kernel should end the program and keep running, as xv6's `usertrap` does: for a fault it cannot fix, it prints the cause and marks the process killed with `setkilled`.

The page fault error code tells the two cases apart. Bit 2, `USER_MODE` in the `x86_64` crate, is set when the faulting access came from ring 3. Bit 0, `PROTECTION_VIOLATION`, is set when the page was present and the access broke its flags, as a user load from a page without the U bit does:

![The user task loads from the kernel heap. The page walk finds the page present but without the U bit, so the CPU raises a page fault with error code 0x5 and CR2 set to the address. The handler sees USER_MODE in the error code, marks the task dead and waits for the timer, and schedule never picks the task again.](figures/15-user-fault.svg)

Ending a task takes two changes:

- The page fault handler checks `USER_MODE`. If it is set, the handler prints `CR2`, the error code and the task's number, marks the running task dead in the table, and loops on `enable_and_hlt()`. The next timer interrupt lands in that loop, and `schedule` saves the task as usual.
- `schedule` skips dead tasks, so it never returns to that loop.

The loop runs on the user task's RSP0 stack, which nothing else uses, so leaving it there costs nothing. A kernel with many user tasks would also free the task's frames and its stacks. It would also give each user task a page table of its own, as xv6 gives each process one and switches `satp`. Here all tasks share the kernel's page table, so a second user program could read the first one's pages. With a table per task, `schedule` would also write the next task's table into `CR3`.

Give the user program a reason to fault. Replace its `jmp user_spin` loop with a delay and a load from the kernel's heap:

```rust
"    mov rcx, 50000000",           // count down for a moment
"user_delay:",
"    dec rcx",
"    jnz user_delay",
"    movabs rax, 0x444444440000",  // the kernel heap
"    mov rax, [rax]",              // a user load from a kernel page
```

### Study

- [x86_64 crate: PageFaultErrorCode](https://docs.rs/x86_64/0.15.5/x86_64/structures/idt/struct.PageFaultErrorCode.html) (reference, as needed): The flag names and the bit each one stands for.

### Build

1. Add a `Dead` state to the task table, and make `schedule` skip dead tasks.
2. Change the page fault handler as above. Keep the old behavior for faults from ring 0.
3. Change the user program and run.
4. Make the program execute `cli` instead of the load. Add a handler for the general protection fault that ends the task in the same way. Its error code has no user bit, so decide by the saved CS in the stack frame: `stack_frame.code_segment.rpl()` is `PrivilegeLevel::Ring3` for a fault in user code.

### Done when

The kernel prints "hello from ring 3", then a page fault report with `CR2` `0x4444_4444_0000` and error code `PROTECTION_VIOLATION | USER_MODE`, and A and B keep printing afterwards. `qemu.log` shows the fault as `v=0e e=0005 cpl=3`. The `cli` version ends the task with a general protection fault with error code 0, and the rest of the kernel keeps running. You can say what happens to the user task's kernel stack after it dies, and what a kernel with many user tasks would do instead.

## Where this leads

You have written each mechanism of a kernel once, with nothing beneath it but the bootloader. You filled in the IDT, gave the double fault its own stack, acknowledged the PIC by hand, built page mappings from a frame allocator, put a heap on top and switched between tasks on the timer. Then you ran code in ring 3, gave it one system call and ended it when it faulted. Your kernel also knew where every device lived: the screen at `0xb8000`, the UART at port `0x3F8`, the keyboard at port `0x60`. It had one user program, one page table, no files and one CPU, and every new device would need register-level code of its own.

Chapter 16, Linux drivers, moves to a kernel that has all of that. You compile Linux for x86-64 in your Ubuntu, boot it under QEMU with a root file system of one program, load your first modules into it, and then write a driver for an emulated PCI device. Linux's core owns the interrupt entry, the page tables and the scheduler you just wrote, on many CPUs and through the APIC. A driver fills in interfaces that the core calls, and it asks the PCI core where its device lives instead of hard-coding an address.
