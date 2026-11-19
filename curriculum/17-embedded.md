---
id: 17
title: Embedded firmware
part: Kernels and bare metal
weeks: 4
project: Bare-metal firmware for the Raspberry Pi Pico 2 (RP2350), built and debugged from WSL2 with no SDK code, on your own linker script and startup code, with GPIO from the datasheet, a timer interrupt and an interrupt-driven UART console in a cooperative event loop.
---

Chapter 16 ended with a driver inside Linux for QEMU's `edu` device. The PCI core found the device and mapped its registers for you, the interrupt core decided when your handler ran, and the kernel owned the page tables. In chapter 15 you went one level lower with a kernel of your own, but a bootloader still loaded it and handed it a machine in a known state.

This chapter removes those layers. A **microcontroller** is a small computer on one chip: CPU cores, RAM, a boot ROM and devices such as timers and serial ports, with a flash chip next to it that holds the program. The program it runs is called **firmware**.

The Raspberry Pi Pico 2 is a board with the RP2350 microcontroller: two Arm Cortex-M33 cores, 520 KB of RAM and 4 MB of flash. It has no operating system and no **MMU**, the part of a CPU that translates virtual addresses through page tables. Code that runs with nothing under it is called **bare metal**.

You write all of it: the linker script, the code that runs before `main`, and drivers for the pins, the clocks, a timer and a serial port, each from the chip's datasheet. At the end the firmware blinks two LEDs, answers commands over a serial console and sleeps when it has nothing to do, with no line of Raspberry Pi's SDK in it. The chapter comes after your kernel and your driver because it uses both. The vector table and interrupt entry repeat chapter 15 on hardware that boots nothing for you, and the registers are the kind that chapter 16 reached through the kernel's helpers.

The first three steps need only WSL2. Order the hardware now, so that it is there for the fourth:

- A Raspberry Pi Pico 2 with headers. That version has its pins soldered on and a small keyed connector for the debug cable. Do not buy the Pico 2 W, whose LED hangs off the wireless chip. A plain Pico 2 also works if you solder its pins and debug header yourself.
- A Raspberry Pi Debug Probe. It comes with the cables that connect it to the Pico 2.
- Two USB cables with a micro-USB plug that carry data. Some cables only charge.
- A breadboard, one LED, one 330 ohm resistor and two jumper wires, for the last step.

## The RP2350 and a cross compiler

Every program in this book so far ran on the machine that compiled it, or in QEMU on the same laptop. Firmware runs on a different CPU. You need a compiler that writes code for that CPU, and a picture of the machine the code will run on.

A **cross compiler** runs on one machine and writes code for another. You used one in chapter 05, where `aarch64-linux-gnu-gcc` wrote ARM64 programs for Linux. This chapter uses `arm-none-eabi-gcc`, and its name says what it targets. `arm` is the CPU family, `none` means there is no operating system, and `eabi` names Arm's calling convention for embedded code.

Ubuntu packages it with its own binutils, such as `arm-none-eabi-objdump`. The debugger is `gdb-multiarch` from chapter 05, which reads Arm programs too. clang can also compile for this chip, but Ubuntu ships the bare-metal linker and C headers as one GNU toolchain, so the firmware is built with gcc and everything that runs on the laptop stays with clang.

The RP2350 has no virtual memory. Every address the core uses is a physical address, and the **memory map** in the datasheet says which piece of hardware answers at each one:

![The RP2350's address space from the bottom up: the boot ROM at 0x00000000, the flash chip through XIP at 0x10000000, 520 KB of SRAM at 0x20000000, the registers of the chip's devices at 0x40000000 and 0x50000000, SIO, the block that drives the pins, at 0xd0000000 and the core's own registers at 0xe0000000.](figures/17-memory-map.svg)

Your code runs from flash. The chip reads the flash chip over a serial bus and keeps a cache of it, so the core can fetch instructions from `0x10000000` as if flash were memory. The datasheet calls this **XIP**, execute in place. Variables live in SRAM, the chip's RAM.

The ranges from `0x40000000` up hold the registers of the chip's devices, which the datasheet calls **peripherals**: timers, serial ports, the pin controls and more. The "faster peripherals" at `0x50000000` sit on a faster bus, and this chapter uses none of them. SIO is a small block wired to each core that drives the pins. The register step explains how code talks to all of them.

The RP2350 also has two RISC-V cores that can run in place of the Arm cores. This chapter uses only the Arm cores.

The Cortex-M33 runs **Thumb-2**, a 32-bit Arm instruction set whose instructions are 16 or 32 bits long. It differs from the AArch64 you read in chapter 05, but the ideas carry over:

- There are 13 general registers, `r0` to `r12`, plus `sp`, `lr` and `pc`. `lr` holds the return address, as `x30` did.
- The first four arguments arrive in `r0` to `r3`, and the result goes back in `r0`. `r4` to `r11` are callee-saved.
- `bx lr` returns.
- A 32-bit constant such as an address does not fit inside an instruction. The compiler stores it in a **literal pool**, words placed after the function, and loads it with an instruction such as `ldr r3, [pc, #4]`, which reads memory at an offset from the program counter.

### Study

- [RP2350 Datasheet, 2.2: Address map](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=28) (read, 20 min): The introduction of 2.2 and the opening paragraphs of 2.2.1 "ROM" to 2.2.7 "Cortex-M33 private peripherals", PDF pages 28 to 32. Skip the tables of single bus endpoints and everything about Non-secure access and RISC-V. PDF page numbers in this chapter are one higher than the numbers printed on the pages.

### Build

1. Install the cross toolchain and check it:

   ```sh
   sudo apt install -y gcc-arm-none-eabi gdb-multiarch
   arm-none-eabi-gcc --version
   ```

2. Make a directory `~/code/pico/first` and write `first.c` in it. The firmware gets `~/code/pico` itself in the next step.

   ```c
   #include <stdint.h>

   int add3(int a, int b, int c)
   {
       return a + b + c;
   }

   void store_at(uint32_t value)
   {
       *(uint32_t *)0x20001000 = value;
   }
   ```

3. Compile it for the M33 and disassemble it. `-mcpu=cortex-m33` names the core, so the compiler uses its instructions, and `-mthumb` asks for Thumb code. `-c` stops after the object file, as in chapter 05.

   ```sh
   arm-none-eabi-gcc -mcpu=cortex-m33 -mthumb -O1 -Wall -Wextra -c first.c -o first.o
   arm-none-eabi-objdump -d first.o
   file first.o
   ```

4. Compile the same file for your laptop with `clang -O1 -c first.c -o first-x86.o` and disassemble it with `objdump -d first-x86.o`. Compare the two versions of each function.

### Done when

`file first.o` says "ELF 32-bit LSB relocatable, ARM". You can point at the registers that hold the three arguments of `add3` on both machines, and at `bx lr` and `ret`. You can say where the address `0x20001000` sits in each version: inside the `mov` instruction on x86-64, and in the literal pool word `20001000` after `store_at` on the M33, loaded with `ldr`.

## The vector table, the IMAGE_DEF and a linker script

The compiler writes code at address 0 of an object file. The chip runs an image only if its pieces sit at the right flash addresses and it carries the marker that the boot ROM looks for.

At power-on both cores start in the **boot ROM**, a 32 KB program that Raspberry Pi built into the chip at address 0. Core 1 waits. Core 0 decides where to boot from.

With no button held, it makes the flash visible at `0x10000000` and searches the first 4 KB for an **IMAGE_DEF**, a small block that says the flash holds a program, for which CPU and in which security state. If it finds none, it treats the flash as blank and starts its USB bootloader instead. The smallest valid IMAGE_DEF for an Arm program is five words, given in section 5.9.5 of the datasheet:

```c
__attribute__((section(".image_def"), used))
const uint32_t image_def[5] = {
    0xffffded3,   /* start marker */
    0x10210142,   /* item: image type = executable, Secure, Arm, RP2350 */
    0x000001ff,   /* item: last item, size 1 */
    0x00000000,   /* link to the next block: 0 means this block loops to itself */
    0xab123579,   /* end marker */
};
```

The Cortex-M33 can split itself into a Secure and a Non-secure world. Your image runs in the Secure one, which can reach all of the chip, and this chapter never uses the other.

This IMAGE_DEF names no entry point, so the ROM treats the start of the image as a Cortex-M **vector table**, an array of 32-bit words that the core reads at reset and at every interrupt:

- Word 0 is the initial stack pointer.
- Word 1 is the address of the **reset handler**, the first function of yours that runs.
- Words 2 to 15 are handlers for the core's own exceptions, such as a fault.
- Words 16 to 67 hold one handler for each device interrupt. The RP2350 has 52 of them, IRQ 0 to 51.

The ROM loads `sp` from word 0 and jumps to the address in word 1. The core runs only Thumb code, and every address it jumps to through a table must have bit 0 set to say so. The compiler sets that bit whenever C takes a function's address, so word 1 is an odd number.

![The flash image starts at 0x10000000 with the 68-word vector table, followed by the 5-word IMAGE_DEF at 0x10000110, then code and constants, then the initial values of .data. The boot ROM finds the IMAGE_DEF, loads sp from word 0 and jumps to word 1.](figures/17-flash-image.svg)

A **linker script** tells the linker where each part of the program goes. In chapter 05 the linker used its default script for Linux programs. Here you write your own. Its `MEMORY` command names the address ranges of the chip. Its `SECTIONS` command lists the output sections in order, with the input sections from your object files that go into each.

**picotool** is Raspberry Pi's tool for images of its chips. Its `info` command reads an image file the way the boot ROM will and prints the IMAGE_DEF it finds, so you can check your image before the board arrives.

### Study

- [Interrupt: From Zero to main(): Demystifying Firmware Linker Scripts](https://interrupt.memfault.com/blog/how-to-write-linker-scripts-for-firmware) (read, 45 min): By François Baldassari. For this step, "Brief Primer on Linking", "Anatomy of a Linker Script", "Memory Layout" and, under "Section Definitions", only the part on `.text`. His chip has 256 KB of flash at address 0, and yours has 4 MB at `0x10000000`. For the next step, the parts on `.bss` and `.data` under "Section Definitions", and "Variables". Skip the part on `.stack`, because your stack starts at `_estack`, the top of RAM.
- [RP2350 Datasheet, 5.9.5: Minimum viable image metadata](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=390) (read, 15 min): The first paragraph of 5.9.5 for the 4 KB rule, then 5.9.5.1 with Table 503 and the paragraph after it on the vector table. Then 5.1.12 "Flash image boot" on PDF pages 332 and 333.
- [picotool README](https://github.com/raspberrypi/picotool) (reference, as needed): The `info` section for this step, and `convert` under `uf2` for the flashing step.

### Build

1. Download picotool, built for Linux, from Raspberry Pi's tools release:

   ```sh
   mkdir -p ~/code/tools && cd ~/code/tools
   curl -LO https://github.com/raspberrypi/pico-sdk-tools/releases/download/v2.3.1-0/picotool-2.3.1-x86_64-lin.tar.gz
   tar xf picotool-2.3.1-x86_64-lin.tar.gz
   ~/code/tools/picotool/picotool version
   ```

2. Write `~/code/pico/link.ld`:

   ```
   ENTRY(Reset_Handler)

   MEMORY
   {
       FLASH (rx)  : ORIGIN = 0x10000000, LENGTH = 4M
       RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 520K
   }

   SECTIONS
   {
       .text :
       {
           KEEP(*(.vectors))
           KEEP(*(.image_def))
           *(.text*)
           *(.rodata*)
       } > FLASH

       _estack = ORIGIN(RAM) + LENGTH(RAM);
   }
   ```

   The lines you have not seen:
   - `ENTRY(Reset_Handler)` records the entry point in the ELF header, for gdb and picotool.
   - `(rx)` and `(rwx)` say which regions hold code and which may be written.
   - `.text` is one output section. It takes the vector table first, then the IMAGE_DEF, then all code (`*(.text*)`) and constants (`*(.rodata*)`) from every object file. `> FLASH` places it in the flash region.
   - `KEEP(...)` stops the linker from dropping a section that no code refers to. Nothing calls the vector table or the IMAGE_DEF.
   - `_estack` is a symbol with an address and no storage: the top of RAM, `0x20082000`.

3. Write `~/code/pico/startup.c` with the IMAGE_DEF from above and this:

   ```c
   #include <stdint.h>

   extern uint32_t _estack[];
   int main(void);

   void Reset_Handler(void)
   {
       main();
       for (;;) {}
   }

   void Default_Handler(void)
   {
       for (;;) {}
   }

   __attribute__((section(".vectors"), used))
   void (*const vectors[68])(void) = {
       [0] = (void (*)(void))_estack,
       [1] = Reset_Handler,
       [2 ... 67] = Default_Handler,
   };
   ```

   `section(".vectors")` puts the array in the section the script keeps first, and `used` stops the compiler from dropping a variable that no code reads. `_estack` is declared as an array, so its name is its address, and the cast turns that address into the type of a table entry. `[2 ... 67] = Default_Handler` is a gcc extension that fills a range of entries.

4. Write `~/code/pico/main.c` with a `main` that does nothing yet:

   ```c
   int main(void)
   {
       for (;;) {}
   }
   ```

5. Write `~/code/pico/build.sh` in the style of chapter 01's script:

   ```sh
   #!/bin/sh
   # usage: sh build.sh
   # Builds every .c file in this directory into out/fw.elf and out/fw.bin.
   set -e
   opt=${OPT:--O1}
   mkdir -p out
   arm-none-eabi-gcc -std=gnu11 -mcpu=cortex-m33 -mthumb $opt -g \
       -Wall -Wextra -Werror \
       -ffreestanding -nostdlib -T link.ld *.c -o out/fw.elf
   arm-none-eabi-objcopy -O binary out/fw.elf out/fw.bin
   echo "built out/fw.elf ($opt)"
   ```

   The new flags:
   - `${OPT:--O1}` takes the optimization level from the variable `OPT`, so `OPT=-O2 sh build.sh` builds at `-O2`. `-O1` keeps the code small and still readable.
   - `-ffreestanding` tells the compiler there is no C library, so it must not assume one. For example, it no longer turns a copy loop into a call to `memcpy`.
   - `-nostdlib` links no C library and no startup files. Your `startup.c` is the startup code.
   - `-T link.ld` replaces the linker's default script with yours.
   - `objcopy -O binary` writes `fw.bin`, the raw bytes of the image as they will sit in flash, starting at `0x10000000`.

6. Build with `sh build.sh` and inspect the result. `nm -n` lists symbols by address, and `od -A x -t x4` prints a file as 32-bit words in hex.

   ```sh
   arm-none-eabi-nm -n out/fw.elf
   od -A x -t x4 out/fw.bin | head -3
   ~/code/tools/picotool/picotool info -a out/fw.elf
   arm-none-eabi-objdump -d out/fw.elf
   ```

> **If it fails:** A program downloaded as a binary needs the shared libraries it was linked against, and a fresh Ubuntu may lack some. `readelf -d ~/code/tools/picotool/picotool | grep NEEDED` lists them. If `picotool version` reports that `libusb-1.0.so.0` cannot be found, run `sudo apt install -y libusb-1.0-0`, the USB library that picotool uses.

### Done when

`od` shows `20082000` as the first word and an odd second word, one more than the address `nm` gives for `Reset_Handler`. `nm` puts `vectors` at `10000000` and `image_def` at `10000110`, inside the first 4 KB. `picotool info -a` prints a metadata block at `0x10000110` of type "image def" for RP2350, "ARM Secure". You can say what the boot ROM does with words 0 and 1.

## Startup code: .data and .bss before main

The image has no global variables yet. C promises that a global starts with the value you wrote, or with zero when you wrote none. RAM holds garbage at power-on, and nothing has loaded your program into RAM, so your own code has to keep that promise.

The compiler puts globals in two sections:

- **`.data`** holds globals with an initial value, such as `uint32_t boot_value = 7;`.
- **`.bss`** holds globals with no initial value, which C requires to start at zero.

On Linux the loader of chapter 05 set both up before `main`. Here the reset handler does it in three moves:

![Before main runs, Reset_Handler copies the initial values of .data from flash, starting at _sidata, into RAM from _sdata to _edata, then writes zeros from _sbss to _ebss, then calls main. The stack starts at _estack, the top of RAM, and grows down.](figures/17-startup.svg)

So `.data` has two addresses. The **VMA** is the address where the section lives while the program runs, in RAM. The name says virtual, but there is nothing virtual here. The **LMA** (load memory address) is the address of its bytes in the image, in flash.

The linker script writes this as `> RAM AT > FLASH`. `.bss` needs addresses and no bytes in the image, which `(NOLOAD)` says.

The reset handler needs those addresses as numbers. The linker script defines symbols such as `_sdata` and `_ebss` at the start and end of each section, and C declares them as `extern uint32_t _sdata[];` and uses their addresses as loop bounds. Baldassari's post copies `.data` from `_etext`, the end of the code, which is right only while `.data` is stored straight after `.text`. `_sidata = LOADADDR(.data);` asks the linker for the load address itself and is right wherever the section is stored.

Nothing guards the stack. If it grows down into `.bss`, it overwrites your globals with no error. This firmware uses a few hundred bytes of stack out of 520 KB, so the chapter leaves it unguarded.

Read the rest of Baldassari's linker script post now, the parts the previous step listed for this one.

### Study

- [Interrupt: From Zero to main(): Bare metal C](https://interrupt.memfault.com/blog/zero-to-main-1) (read, 10 min): By the same author. "Writing a Reset_Handler" only, for the C function that copies `.data` and zeroes `.bss`. His chip needs an errata fix at the end. Yours does not.

### Build

1. Add the RAM sections to `link.ld`, after `.text` and before `_estack`:

   ```
       .data :
       {
           _sdata = .;
           *(.data*)
           . = ALIGN(4);
           _edata = .;
       } > RAM AT > FLASH
       _sidata = LOADADDR(.data);

       .bss (NOLOAD) :
       {
           _sbss = .;
           *(.bss*)
           *(COMMON)
           . = ALIGN(4);
           _ebss = .;
       } > RAM
   ```

   `.` is the linker's current address, so `_sdata = .;` names the address where `.data` starts. `ALIGN(4)` moves the address up to a multiple of 4, so the loops can copy whole words. `COMMON` collects old-style globals that some compilers emit.

2. In `startup.c`, declare `extern uint32_t _sidata[], _sdata[], _edata[], _sbss[], _ebss[];` next to `_estack`. Give `Reset_Handler` two loops before `main()`: one copies words from `_sidata` to `_sdata` until the destination reaches `_edata`, and one writes zeros from `_sbss` to `_ebss`.
3. Replace `main.c` with two globals and a loop:

   ```c
   #include <stdint.h>

   uint32_t boot_value = 7;
   volatile uint32_t ticks;

   int main(void)
   {
       for (;;)
           ticks++;
   }
   ```

   You will read `ticks` with the debugger, and nothing in the program reads it. gcc would delete the stores and turn the loop into a jump to itself. `volatile` stops that, as it kept the writes of chapter 07's fault probe. The register step looks at it again.

4. Build and look at the result. `readelf -l` prints the **segments**, the parts of the file a loader copies into memory, with both addresses of each. `od -j` skips to an offset in the file and `-N 4` prints one word.

   ```sh
   arm-none-eabi-readelf -lS out/fw.elf
   arm-none-eabi-nm -n out/fw.elf
   od -A x -t x4 -j <offset> -N 4 out/fw.bin
   ```

   For `<offset>`, use the second segment's PhysAddr minus `0x10000000`, in hex, such as `0x198`.

5. Disassemble `Reset_Handler` with `arm-none-eabi-objdump -d out/fw.elf`. Find the copy loop and the zero loop, the literal pool words that hold the section addresses, and the register that holds the source pointer.
6. See where every byte went. In `build.sh`, add `-Wl,-Map=out/fw.map` before `*.c`. `-Wl,` passes the option after the comma to the linker, and `-Map` asks it for a **map file**, a listing of every output section with its address, size and the symbols in it. Rebuild, run `arm-none-eabi-size out/fw.elf`, which prints the size of the code, the initialized data and the zeroed data, and find `boot_value` and `ticks` in `out/fw.map`. The object file names in the map are temporary files, because `build.sh` compiles and links in one command.
7. Delete `AT > FLASH` from `.data`, rebuild, and look at `readelf -l` and at `ls -l out/fw.bin`. `objcopy` writes every byte from the lowest load address to the highest, and the load address of `.data` is now in RAM, 256 MB above the flash. Write one sentence on what the boot ROM would have loaded and what `boot_value` would hold at `main`. Put `AT > FLASH` back.

### Done when

In `readelf -l`, the second LOAD segment has VirtAddr `0x20000000` and a PhysAddr in flash, such as `0x10000198`. `od` at that PhysAddr's offset into `fw.bin` prints `00000007`. In `Reset_Handler` you can point at the loads of `_sidata` and `_ebss` from the literal pool. `size` reports `data` 4 and `bss` 4, and the map puts `boot_value` at `0x20000000` with load address `0x10000198` and `ticks` at `0x20000004`. Without `AT > FLASH` the PhysAddr was `0x20000000` and `fw.bin` grew to about 256 MB.

## Share the probe with WSL2

The image is ready. It needs a way into the chip's flash, and you need a way to watch it run. Both go over USB, and WSL2 sees no USB devices by default.

**SWD** (Serial Wire Debug) is a debug port built into the chip, two signal wires plus ground. Through it a debugger can halt the core, read and write registers and memory, set breakpoints and write the flash, with no help from the code on the chip. The **Debug Probe** is a small board that turns USB into SWD. It also carries a serial line to two of the Pico 2's pins, which shows up on the laptop as a serial port and comes into use in the UART step.

WSL2 runs Linux in a virtual machine that has no USB ports of its own. **usbipd-win** is a Windows service that shares a USB device with WSL2 over **USB/IP**, a protocol that carries USB traffic over a network connection. Once you attach the probe, Ubuntu sees it and Windows cannot use it. Only the probe goes to WSL2:

![Two USB cables leave the laptop. The Pico 2's cable stays with Windows, which shows the RP2350 drive in Explorer. The Debug Probe's cable is shared by usbipd and attached to WSL2, where OpenOCD, gdb-multiarch and minicom use it. The probe reaches the Pico 2 over the SWD wires and the UART wires.](figures/17-setup.svg)

The Pico 2's own cable stays with Windows. It powers the board. When you hold the **BOOTSEL** button while you plug it in, the boot ROM starts its USB bootloader, and a drive called `RP2350` appears in Explorer. Copying a **UF2** file, an image format for this kind of drive, onto it writes the image into flash.

Ubuntu creates device files for USB devices through **udev**, a service that follows rule files. Without a rule, only root may open the probe. You write one rule for Raspberry Pi's USB vendor ID, `2e8a`. The probe's serial port appears as `/dev/ttyACM0` and belongs to the group `dialout`.

> **Practice:** Prove each link with something known to work before you trust your own image: Raspberry Pi's prebuilt blink first, then the probe in WSL2, then OpenOCD in the next step. When your own image then fails, the fault is in your image.

### Study

- [Microsoft: Connect USB devices](https://learn.microsoft.com/en-us/windows/wsl/connect-usb) (do, 20 min): "Prerequisites", "Install the USBIPD-WIN project" with its note on winget, and "Attach a USB device". The Build runs these steps for the Debug Probe.
- [Getting started with Raspberry Pi Pico-series, Appendix A: Debugprobe](https://datasheets.raspberrypi.com/pico/getting-started-with-pico.pdf#page=16) (read, 15 min): A.1 and A.1.1 for the wiring, A.4 on the probe's two USB interfaces and A.5.1 for the serial port on Linux. Skip A.2 and A.3, which use a second Pico as the probe, and the Windows and macOS parts. Its commands use `sudo`, which your udev rule makes unnecessary.
- [Raspberry Pi documentation: Your first binaries](https://www.raspberrypi.com/documentation/microcontrollers/c_sdk.html#your-first-binaries) (do, 10 min): "Blink an LED" only, for the prebuilt `blink_universal.uf2`. It also confirms that the Pico 2's LED is on GP25. Skip the SDK setup above it.

### Build

1. Download `blink_universal.uf2` in Windows. Hold BOOTSEL, plug the Pico 2 into the laptop, release the button and drag the file onto the `RP2350` drive in Explorer. The LED blinks.
2. Open PowerShell as administrator and install usbipd-win with winget, Windows' package manager: `winget install --interactive --exact dorssel.usbipd-win`. `--interactive` shows the installer, so it cannot restart Windows without asking.
3. In Ubuntu, install `lsusb` with `sudo apt install -y usbutils`.
4. Write the udev rule and check your groups:

   ```sh
   echo 'SUBSYSTEM=="usb", ATTRS{idVendor}=="2e8a", MODE="0660", GROUP="plugdev"' | sudo tee /etc/udev/rules.d/99-raspberrypi.rules
   sudo udevadm control --reload-rules
   groups
   ```

   `sudo tee` writes the line into a file that only root may write. The rule lets the group `plugdev` read and write every USB device from vendor `2e8a`, and `udevadm control --reload-rules` makes udev read its rules again. `groups` must list `plugdev` and `dialout`. If one is missing, add yourself to both with `sudo usermod -aG plugdev,dialout $USER`, then `wsl --shutdown` in PowerShell, and open Ubuntu again.
5. Wire the probe as in A.1.1. The "D" cable goes into the Pico 2's debug connector. The "U" cable goes to GP0, GP1 and GND, with the probe's RX on the Pico's TX (GP0) and the probe's TX on the Pico's RX (GP1). The Pico 2 sits in the breadboard, so the U cable's pins go into the same rows. Plug the probe's USB cable into the laptop.
6. Keep an Ubuntu terminal open. In the administrator PowerShell, run `usbipd list` and find the probe by its VID:PID `2e8a:000c`. Note its BUSID, such as `2-3`. Run `usbipd bind --busid 2-3` once, which shares the device for good, then `usbipd attach --wsl --busid 2-3`.
7. In Ubuntu, run `lsusb` and `ls -l /dev/ttyACM0`.

> **If it fails:** An attached device is detached when you unplug it or when WSL restarts, and you run `usbipd attach --wsl --busid 2-3` again. `usbipd attach --wsl --busid 2-3 --auto-attach` attaches it again by itself each time it comes back, for as long as that PowerShell window stays open.

### Done when

The prebuilt blink runs. In Ubuntu, `lsusb` lists a device with ID `2e8a:000c`, and `/dev/ttyACM0` belongs to `dialout`. You can say which of the two USB cables belongs to Windows and which to WSL2, and why.

## OpenOCD, flashing and the first boot

The probe is in WSL2. A program on the laptop now has to drive it, write your image into flash and let gdb watch the image boot.

**OpenOCD** (Open On-Chip Debugger) drives the probe and opens a **GDB server** on port 3333. gdb-multiarch connects to it the way gdb connected to QEMU's stub in chapter 15. The probe speaks **CMSIS-DAP**, Arm's standard USB protocol for debug probes. Ubuntu's OpenOCD package is version 0.12.0, which knows only the older RP2040. Raspberry Pi publishes builds with RP2350 support, so you download one, from the same release as picotool.

There are two ways to write the flash:

- Over SWD, with OpenOCD's `program` command. It needs no button, and it is the one you use while you work.
- As a UF2 file through the BOOTSEL drive. `picotool uf2 convert` turns your ELF file into UF2. Use it when the probe is not connected.

gdb works as it did against QEMU, with one difference: the program is already on the chip, so you attach and reset instead of typing `run`. gdb's `monitor` command passes the rest of the line to OpenOCD. `monitor reset halt` resets the chip and stops core 0 at its first instruction in the boot ROM. gdb cannot write a breakpoint instruction into flash, so it uses the core's hardware breakpoint units for breakpoints there, chosen by itself from the memory map that OpenOCD reports.

SRAM keeps its contents across a reset. `boot_value` may still hold 7 from the last run, so you set it to 0 by hand before the copy loop runs, and then watch the loop put the 7 back.

A **cold boot** means that the board loses power and starts again, with no debugger attached. That is how the board runs on its own, and several checks from here on use it.

### Study

- [Getting started with Raspberry Pi Pico-series, A.6: Debug with OpenOCD](https://datasheets.raspberrypi.com/pico/getting-started-with-pico.pdf#page=21) (read, 15 min): Read A.6.1 "Getting OpenOCD" only to see what the tool is. Do not build it, because you download a binary below. Then A.6.2 "Debug with SWD" for the two terminals, OpenOCD in one and gdb in the other, and the `target remote localhost:3333` command. It uses `target/rp2040.cfg` in places, and you use `rp2350.cfg` everywhere. Its `load` command is another way to write the flash. This chapter uses `program`.

### Build

1. Install the three shared libraries the downloaded OpenOCD needs, then download it:

   ```sh
   sudo apt install -y libusb-1.0-0 libftdi1-2 libhidapi-hidraw0
   mkdir -p ~/code/tools/openocd && cd ~/code/tools/openocd
   curl -LO https://github.com/raspberrypi/pico-sdk-tools/releases/download/v2.3.1-0/openocd-0.12.0+dev-x86_64-lin.tar.gz
   tar xf openocd-0.12.0+dev-x86_64-lin.tar.gz
   ls openocd scripts/target/rp2350.cfg
   ```

2. Write `~/code/pico/ocd.sh`, which starts OpenOCD with the probe and the chip. `-s` names the directory of OpenOCD's configuration scripts, each `-f` loads one, and `"$@"` passes on any arguments you give the script. `interface/cmsis-dap.cfg` selects the probe's protocol.

   ```sh
   #!/bin/sh
   # usage: sh ocd.sh [more openocd arguments]
   exec ~/code/tools/openocd/openocd -s ~/code/tools/openocd/scripts \
       -f interface/cmsis-dap.cfg -f target/rp2350.cfg \
       -c "adapter speed 5000" "$@"
   ```

   Run `sh ocd.sh` in `~/code/pico`, read its output and stop it with Ctrl-C.
3. Install a serial terminal with `sudo apt install -y minicom` and open the probe's serial port with `minicom -D /dev/ttyACM0 -b 115200`. Nothing arrives yet, because your firmware does not use the UART. Leave minicom with Ctrl-A, then X.
4. In `~/code/pico`, flash the image from the startup step. `program` writes the file to flash, `verify` reads it back, `reset` restarts the chip and `exit` ends OpenOCD.

   ```sh
   sh ocd.sh -c "program out/fw.elf verify reset exit"
   ```

5. Start `sh ocd.sh` in one terminal and leave it running. In a second terminal, run `gdb-multiarch out/fw.elf -ex "target remote :3333"` and type:

   ```
   monitor reset halt
   break *Reset_Handler
   continue
   p/x $sp
   set var boot_value = 0
   break main
   continue
   p boot_value
   continue
   ```

   The star puts the breakpoint on the first instruction of `Reset_Handler`, not after its prologue. `p/x` prints in hex, and `set var` writes a variable. After the last `continue`, press Ctrl-C and print `ticks`. Dump the start of flash with `x/4xw 0x10000000` and compare it with your `od` output.
6. Comment out the IMAGE_DEF in `startup.c`, rebuild, and run `~/code/tools/picotool/picotool info -a out/fw.elf`. Flash the image with `ocd.sh`. Unplug the Pico 2's USB cable and plug it in again without touching BOOTSEL. The `RP2350` drive appears in Explorer, because the ROM found no IMAGE_DEF and started its bootloader. Put the IMAGE_DEF back and flash again.
7. Convert the good image with `~/code/tools/picotool/picotool uf2 convert out/fw.elf out/fw.uf2`. Run `explorer.exe .` in `~/code/pico/out`. WSL starts Explorer, a Windows program, as it started your game's `.exe` in chapter 14, and Explorer opens that directory. Plug the Pico 2 in with BOOTSEL held and drag `fw.uf2` onto the drive.
8. Attach to the running board without a reset: start `sh ocd.sh`, then `gdb-multiarch out/fw.elf -ex "target remote :3333"`. Connecting halts the core where it is. Print `ticks`, `continue`, press Ctrl-C and print it again.

> **If it fails:** If OpenOCD stops with a message that a `.so` file cannot be opened, a library is missing. `readelf -d ~/code/tools/openocd/openocd | grep NEEDED` lists the three it needs. If OpenOCD reports that it cannot open the CMSIS-DAP device, the udev rule was probably added after the attach. Run `usbipd detach --busid 2-3` in PowerShell and attach again.

### Done when

`sh ocd.sh` runs without `sudo` and reports that it is listening on port 3333 for gdb connections. After a cold boot from the UF2 file, gdb attached without a reset shows `ticks` growing between two halts and `boot_value` equal to 7. At the first instruction of `Reset_Handler`, `$sp` was `0x20082000`. The image without an IMAGE_DEF brought up the `RP2350` drive on a plain power-up, and picotool found no metadata block in it.

## Registers, resets and the LED pin

The image boots and gdb watches it. To make the board do something you can see, the code has to talk to the peripherals from the memory map, and the first one to drive is the LED.

A **peripheral register** is an address where loads and stores go to a piece of hardware instead of RAM. A store to `0xd0000028` flips output pins. A load from the UART's data register takes a byte out of its receive queue, so two loads give two different bytes.

The compiler knows none of this. To the compiler, a store that nothing reads back is dead, and two loads from one address can merge into one. `volatile`, which you met in chapter 07's fault probe, tells the compiler that something outside the program sees the variable. Every access in the source then happens in the machine code, in program order relative to the other volatile accesses. `ticks` in the startup step needed it for the same reason.

```c
#define REG(addr) (*(volatile uint32_t *)(addr))

REG(0xd0000028) = 1u << 25;   /* SIO GPIO_OUT_XOR: flip GP25 */
```

Most peripherals start in **reset**: switched off, so a register access to them does nothing useful. The **RESETS** block has one bit per peripheral in its `RESET` register. To start a peripheral you clear its bit, then wait until the same bit reads 1 in `RESET_DONE`. Do this even for blocks the boot ROM may have released, so your code does not depend on what the ROM happened to do.

Clearing one bit with `REG(x) &= ~bit` is a load, an AND and a store. An interrupt handler that changes the same register between the load and the store loses its change. So each peripheral register also answers at three more addresses that change only the bits you write, in a single store:

![The pad register of GPIO25 at 0x40038068 holds eight fields in bits 8 to 0 and reads 0x116 at reset, with ISO set. The same register answers at three more addresses: plus 0x1000 flips the bits you write, plus 0x2000 sets them and plus 0x3000 clears them. Writing 0x100 to the clear alias clears ISO and leaves the other bits alone.](figures/17-register.svg)

The LED on the Pico 2 is wired to the pin GP25. Three blocks stand between your code and that pin, and each needs one setting:

![SIO drives GP25 only after three settings line up: the function select in IO_BANK0 picks input 5, SIO, out of the functions the pin can carry, the pad in PADS_BANK0 has ISO cleared so the signal reaches the pin, and SIO's output enable bit for pin 25 is set. Then SIO's output bit lights the LED.](figures/17-pin-path.svg)

1. The **function select** in IO_BANK0. Each pin can carry one of several functions: a UART, SPI, PWM, or plain control by software through SIO. The `FUNCSEL` field of the pin's `GPIOn_CTRL` register picks one. For SIO it is 5.
2. The **pad** in PADS_BANK0, the electrical part of the pin. At reset the RP2350 isolates every pad (`ISO` set) and turns its input buffer off (`IE` clear). No output reaches the pin until you clear `ISO`, and the chip cannot read the pin until you set `IE`. The pad of GP25 reads `0x116` at reset and `0x016` once `ISO` is clear.
3. **SIO**, the block wired straight to each core. Its `GPIO_OE` register turns on a pin's output driver, and `GPIO_OUT` sets the levels. SIO does not use the aliases. It has its own `_SET`, `_CLR` and `_XOR` registers at separate offsets, such as `GPIO_OUT_XOR` above.

For now the blink waits in a busy loop that counts to a number N. The chip still runs on its internal oscillator, whose speed is only roughly known, so you pick N by eye. The next step replaces the loop with a timer.

> **Practice:** Copy every address, offset and bit you use from the datasheet into your own `regs.h`, then check each one against the SDK's headers, which are generated from the same source as the datasheet. Never include the SDK's headers in the build.

### Study

- [John Regehr: Nine ways to break your systems code using volatile](https://blog.regehr.org/archives/28) (read, 30 min): Read 1 to 6. Number 1 has a timer register and a flag set by an interrupt, and numbers 5 and 6 explain why `volatile` neither orders ordinary memory accesses nor makes anything atomic. Skim 7 to 9, which cover threads and multiprocessors from chapter 09.
- [RP2350 Datasheet: register aliases, resets and GPIO](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=24) (read, 1 h 30 min): 2.1.3 on PDF page 24 for the aliases, then 7.5 "Subsystem resets" on PDF page 458 with the entries for `RESET` and `RESET_DONE` in its list of registers. Then chapter 9 "GPIO", 9.1 to 9.8 on PDF pages 539 to 546, and in 9.11 the entries for `GPIO25_CTRL` under "IO - User Bank" and `GPIO25` under "Pad Control - User Bank". Last, 3.1.3 "GPIO control" on PDF page 37 for the SIO registers.
- [Pico SDK 2.3.1: RP2350 register headers](https://github.com/raspberrypi/pico-sdk/tree/2.3.1/src/rp2350/hardware_regs/include/hardware/regs) (reference, as needed): `addressmap.h` for base addresses, then `resets.h`, `io_bank0.h`, `pads_bank0.h` and `sio.h`, and in later steps `clocks.h`, `xosc.h`, `ticks.h`, `timer.h`, `uart.h` and `m33.h`. Use them to check your numbers, never to replace them.

### Build

1. Start `regs.h` with `#include <stdint.h>`, the `REG` macro, and `REG_XOR`, `REG_SET` and `REG_CLR` macros that add `0x1000`, `0x2000` and `0x3000` to the address. Add the base address of RESETS, the offsets of `RESET` and `RESET_DONE`, and the bits for IO_BANK0 (6) and PADS_BANK0 (9). Add the bases of IO_BANK0 (`0x40028000`), PADS_BANK0 (`0x40038000`) and SIO (`0xd0000000`). Name the registers of a pin with macros: `GPIOn_CTRL` sits at IO_BANK0 + 8n + 4, and the pad of GPn at PADS_BANK0 + 4n + 4.
2. In a new file `gpio.c`, write `unreset(uint32_t bits)`: write `bits` to the clear alias of `RESET`, then loop until all of `bits` read 1 in `RESET_DONE`.
3. `main` calls `unreset` for IO_BANK0 and PADS_BANK0, then loops. Flash it, break at `main` in gdb, and print `RESET_DONE` with `x/xw 0x40020008` before and after the call. `next` runs one line of C.
4. Disassemble `unreset` and find the store to the clear alias and the load from `RESET_DONE`, each with its address in the literal pool. Then remove `volatile` from `REG`, build with `OPT=-O2 sh build.sh`, disassemble `unreset` again, and restore `volatile`.
5. In `gpio.c`, write `gpio_init_output(pin)`: `unreset` IO_BANK0 and PADS_BANK0, set `FUNCSEL` to 5, clear `ISO` in the pad with the clear alias, and set the pin's bit in `GPIO_OE_SET`.
6. `main` sets up GP25 and blinks it with `REG(GPIO_OUT_XOR) = 1u << 25;` and a busy wait, `for (volatile uint32_t i = 0; i < N; i++) {}`. Pick N for about one blink per second.
7. gdb can write a peripheral register while the core is halted, because OpenOCD writes over the chip's bus itself. Halt the core while the LED is on and run `set *(unsigned *)0xd0000028 = 0x02000000`. The LED changes while the core stands still. Print the pad register with `x/xw 0x40038068` and decode it bit by bit against the datasheet's table.
8. Comment out the line that clears `ISO`, flash, and watch the LED stay dark while SIO's bits change. Put the line back.

### Done when

After `unreset`, `RESET_DONE` has bits 6 and 9 set. In the `-O2` build without `volatile`, you can point at the load of `RESET_DONE` that now comes before the store that releases the reset, and at the branch that jumps back to the compare without loading again. You can explain in two sentences why the compiler was allowed to do both.

The LED blinks after a cold boot, and `arm-none-eabi-nm out/fw.elf` lists only symbols you wrote. You can toggle the LED from gdb with the core halted. The pad register reads `0x00000016`, and you can name each set bit. Without the `ISO` clear the LED stayed dark and the pad read `0x116`.

## Clocks and a microsecond timer

The busy-wait blink has no fixed rate. The chip boots on its **ring oscillator** (ROSC), a circuit on the chip whose frequency drifts with voltage and temperature. The Pico 2 also has a 12 MHz **crystal**, a part whose frequency is exact to a few parts per million, which the chip's crystal oscillator (XOSC) drives. This step moves the chip onto the crystal and starts a timer that counts microseconds.

A **clock generator** picks the source of one clock and sends it to the hardware that uses it. Three matter here:

- `clk_ref`, the reference clock, which feeds the timer.
- `clk_sys`, which runs the cores and the bus.
- `clk_peri`, which runs the UART in a later step.

![The chip boots on the ring oscillator. You start the 12 MHz crystal oscillator and select it for clk_ref, then select clk_ref for clk_sys, which runs the cores and the bus. clk_ref also feeds the TIMER0 tick generator, which divides by 12 to make a 1 MHz tick. The crystal also feeds clk_peri, which clocks UART0.](figures/17-clocks.svg)

Starting the crystal takes three writes and a wait:

1. Write `0xaa0` to the XOSC `CTRL` register, which selects the 1 to 15 MHz range.
2. Write 47 to `STARTUP`, a delay in units of 256 crystal cycles, about 1 ms at 12 MHz.
3. Write `0xfab` into bits 23 to 12 of `CTRL`, together with the range again. That value enables the oscillator.
4. Wait until bit 31 of `STATUS`, `STABLE`, reads 1.

The magic values protect the oscillator from a stray write. `clk_ref` and `clk_sys` switch sources without a glitch and report the source they actually use in a `SELECTED` register, with one bit per source. After you write a new `SRC`, wait until bit `SRC` of `SELECTED` is set. The SDK goes further and multiplies the crystal up to 150 MHz with a PLL. You stay at 12 MHz, which is plenty here.

TIMER0 is a 64-bit counter of microseconds. It counts the pulses of a **tick generator** fed by `clk_ref`, which is off at reset. Its register `TIMER0_CTRL` in the TICKS block has an `ENABLE` bit (bit 0) and a `RUNNING` bit (bit 1). Stop it, set its divider, `CYCLES`, to 12, so that 12 MHz makes one tick per microsecond, then set `ENABLE` and wait for `RUNNING`. `TIMERAWL` reads the low 32 bits of the count.

TIMER0 also has to leave reset, through bit 23 of RESETS. Its `DBGPAUSE` register is set at reset, so the count stops whenever the debugger halts a core.

### Study

- [RP2350 Datasheet, chapter 8: Clocks](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=468) (read, 1 h 30 min): 8.1 to 8.1.3.1 for the clock tree, skipping 8.1.2.2.1 to 8.1.2.2.5 on the ring oscillator's drift and 8.1.2.6 on PLLs. Then 8.1.3.2 "Multiplexers" (PDF page 473) and 8.1.6.1 "Configuring a clock generator" (PDF page 477), whose SDK code is a model to read, not to copy. In 8.1.7 read the entries for `CLK_REF_CTRL`, `CLK_REF_SELECTED`, `CLK_SYS_CTRL`, `CLK_SYS_SELECTED` and `CLK_PERI_CTRL` (PDF pages 489 to 491). Then 8.2.3 and 8.2.4 on starting the XOSC (PDF page 508) with its `CTRL`, `STATUS` and `STARTUP` registers in 8.2.8, 8.5 "Tick generators" (PDF page 522), and from 12.8 "System timers" (PDF page 1095) the sections 12.8.1, 12.8.2 and 12.8.4.1.

### Build

1. Add the bases of CLOCKS (`0x40010000`), XOSC (`0x40048000`), TICKS (`0x40108000`) and TIMER0 (`0x400b0000`) to `regs.h`, with the offsets of every register above. In TICKS, `TIMER0_CTRL` is at offset `0x18` and `TIMER0_CYCLES` at `0x1c`. Check each against the SDK headers.
2. In `clocks.c`, write `clocks_init()`: `unreset` TIMER0, start the XOSC, switch `clk_ref` and then `clk_sys` and wait on each `SELECTED`, then set up the TIMER0 tick generator: clear `ENABLE` in `TIMER0_CTRL` (8.5 says to stop the generator before you change `CYCLES`), write 12 to `CYCLES`, then set `ENABLE` and wait until `RUNNING` reads 1.
3. Write `delay_us(uint32_t us)`, which reads `TIMERAWL` once and loops until `REG(TIMERAWL) - start >= us`. The unsigned subtraction stays right when the counter wraps past 2^32.
4. `main` calls `clocks_init`, sets up GP25 and blinks it with `delay_us(500000)`.
5. In gdb, check `CLK_REF_SELECTED` with `x/xw 0x40010038` and `CLK_SYS_SELECTED` with `x/xw 0x40010044`. Print `TIMERAWL` with `x/xw 0x400b0028` twice while the core is halted, then once more after a `continue` and Ctrl-C.

### Done when

The LED toggles every 500 ms: 30 full blinks take 30 seconds on a stopwatch. `CLK_REF_SELECTED` reads `0x4` and `CLK_SYS_SELECTED` reads `0x1`. `TIMERAWL` does not move while the core is halted and moves while it runs, and you can say which register makes it stop.

## Interrupts: the timer, the NVIC and the handler

`delay_us` keeps the core busy doing nothing. The timer can instead tell the core when the time has come, and the core can run a function at that moment wherever it was.

TIMER0 has four **alarms**. Writing a time to `ALARM0` arms alarm 0. When the low 32 bits of the counter reach that value, the timer sets bit 0 of its `INTR` register and raises IRQ 0, if bit 0 of `INTE` enables it. The handler acknowledges by writing 1 to bit 0 of `INTR`.

On the core's side, an **interrupt** is a signal that makes the core stop what it is running, run a handler, and then go back. The **NVIC** (nested vectored interrupt controller) is the interrupt controller inside the Cortex-M33. Each IRQ has an enable bit in the `NVIC_ISER` registers from `0xE000E100` on, a pending bit and a priority. IRQ n uses slot 16 + n of the vector table.

Every priority starts at 0, so neither of this chapter's handlers can interrupt the other. One that fires while the other runs waits until it returns.

The core finds the table through **VTOR**, a register at `0xE000ED08`. Write it at the start of `Reset_Handler`, so the table in use does not depend on what ran before. VTOR needs the table aligned to a power of two at least as large as the table, 512 bytes for 68 words. Yours is at `0x10000000` only because the linker script puts `.vectors` first, so keep it first.

![When TIMER0's alarm 0 fires, it sets bit 0 of INTR and raises IRQ 0. The NVIC, with IRQ 0 enabled, marks it pending and interrupts the core. The core pushes eight words onto main's stack, puts 0xFFFFFFF9 in lr, reads the handler's address from vector table slot 16 and runs timer0_irq. Its bx lr makes the core pop the eight words and resume main.](figures/17-interrupt.svg)

On entry the core pushes eight words onto the current stack by itself: `r0` to `r3`, `r12`, `lr`, the return address and the status register `xPSR`. Those are exactly the registers the C calling convention lets a function overwrite, so a plain C function can be a handler. The core then puts a special value, an **EXC_RETURN**, in `lr`. When the handler returns with an ordinary `bx lr`, that value tells the core to pop the eight words and resume the interrupted code.

In chapter 15 the compiler generated the code that saved registers for the `x86-interrupt` calling convention. Here the hardware does it.

The handler and `main` now share variables, and a counter that both touch needs `volatile` at least, for the reason in Regehr's number 1. On this core a handler sees memory exactly as the interrupted code left it, so only the compiler can reorder the accesses. The UART step uses C11 atomics from chapter 09 to say what you mean.

The Cortex-M33 also has a 24-bit timer of its own, **SysTick**, with its handler in slot 15. Small operating systems written for Cortex-M cores use it for their clock tick. This chapter stays with TIMER0, which you already set up.

### Study

- [Interrupt: A Practical guide to ARM Cortex-M Exception Handling](https://interrupt.memfault.com/blog/arm-cortex-m-exceptions-and-nvic) (read, 40 min): By Chris Coleman. "ARM Exception Model Overview" with both subsections, then under "Registers used to configure Cortex-M Exceptions" only "NVIC Registers", then under "Advanced Exception Topics" only "Exception Entry & Exit". Skip the other registers, the other advanced topics and the code examples, which run on an nRF52.
- [RP2350 Datasheet, 12.8.3: Alarms](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=1096) (read, 20 min): 12.8.3 and 12.8.4.2 "Set an alarm", then the entries for `ALARM0`, `INTR` and `INTE` in 12.8.5 (PDF pages 1102 to 1105). Table 95 in 3.2 "Interrupts" (PDF page 81) lists the IRQ numbers.
- [Interrupt: How to debug a HardFault on an ARM Cortex-M MCU](https://interrupt.memfault.com/blog/cortex-m-hardfault-debug) (read, 40 min): Only for the optional fault item at the end of this step. By Chris Coleman. "Determining What Caused The Fault", then from "Relevant Status Registers" the parts on CFSR, UFSR and HFSR, then "Recovering the Call Stack". Its examples run on a Cortex-M4, whose fault registers sit at the same addresses as on your M33.

### Build

1. Make `Reset_Handler` start with `*(volatile uint32_t *)0xe000ed08 = (uint32_t)vectors;`, which needs `extern void (*const vectors[68])(void);` above it.
2. Put `timer0_irq` in vector slot 16 with `[16 + 0] = timer0_irq,` after the range. gcc warns when an entry overrides an earlier one, and `-Werror` makes that an error, so add `-Wno-override-init` to the warning flags in `build.sh`.
3. `timer0_irq` acknowledges the alarm, re-arms it 500,000 us after the previous target (not after the current time, so a late handler does not shift the next tick), toggles GP25 with `GPIO_OUT_XOR` and increments a `volatile uint32_t toggles`. An alarm matches one exact value, so a target already in the past fires only when the counter comes round again, about 72 minutes later.
4. `main` calls `clocks_init` and `gpio_init_output(25)`, then follows the order in 12.8.3: set bit 0 of `INTE`, set bit 0 of `NVIC_ISER0`, then arm the first alarm at `TIMERAWL` plus 500,000. Then it loops doing nothing.
5. In gdb, run `break *timer0_irq` and `continue`. `bt` shows the handler, a frame gdb calls `<signal handler called>`, and the loop in `main`. Print `$lr` in hex. Dump the frame with `x/8xw $sp` and run `info symbol` on the seventh word.

> **Optional:** The core runs ordinary code in **thread mode** and handlers in **handler mode**. In the EXC_RETURN value, bit 3 says that the interrupted code ran in thread mode, and bit 2 says which of the core's two stack pointers holds the frame. Your code uses only the main stack, so bit 2 is clear. Decode the `0xfffffff9` you printed in item 5 and name what bits 3 and 2 say.

> **Optional:** A jump to a bad address stops the core in `Default_Handler` forever, with no word about where or why. A **fault** is an exception the core raises itself when an instruction cannot run, such as a jump to an address with bit 0 clear. The M33's separate fault handlers are off at reset, so every fault escalates to **HardFault**, vector 3.
>
> `CFSR` at `0xE000ED28` has one bit per cause, and bit 17, `INVSTATE`, means a jump to an even address. `HFSR` at `0xE000ED2C` bit 30, `FORCED`, means a fault of another kind escalated. The handler finds the same eight stacked words as an interrupt handler: word 6 is the faulting instruction and word 5 is `lr` at that moment. Your code uses only the main stack, so the handler that reads the frame is two instructions:
>
> ```c
> __attribute__((naked)) void HardFault_Handler(void)
> {
>     __asm volatile("mrs r0, msp\n\tb hardfault_c");   /* r0 = address of the stacked frame */
> }
>
> volatile uint32_t *fault_frame;
>
> void hardfault_c(uint32_t *frame)   /* frame[5] = stacked lr, frame[6] = stacked pc */
> {
>     fault_frame = frame;            /* keep it where gdb can always print it */
>     if (*(volatile uint32_t *)0xe000edf0 & 1)   /* DHCSR: a debugger is attached */
>         __asm volatile("bkpt #0");  /* stop here in gdb */
>     for (;;) {}
> }
> ```
>
> `naked` makes the compiler emit the function with no prologue, so `sp` still points at the frame. `mrs r0, msp` copies the main stack pointer into `r0`, the first argument of the C function that `b` jumps to. `bkpt` stops the core for the debugger, and with no debugger attached it would raise a fault inside the HardFault handler, which locks the core up. Bit 0 of `DHCSR`, a debug register, says whether a debugger is attached.
>
> Put this in `fault.c` and `HardFault_Handler` in vector slot 3. Call a function `fn` through a pointer with bit 0 cleared, `((void (*)(void))((uintptr_t)fn & ~1u))();`, with one more statement after the call so the compiler does not turn it into a plain jump.
>
> When gdb stops at the `bkpt`, `x/xw 0xE000ED28` shows `0x00020000` and `x/xw 0xE000ED2C` shows `0x40000000`. `fault_frame[6]` equals the address `nm` gives for `fn` with bit 0 clear, and `list *fault_frame[5]` shows the statement right after the bad call, because the stacked `lr` holds the return address of the bad call.

### Done when

The LED toggles every 500 ms, 30 blinks in 30 seconds. With the core halted twice in gdb, the change in `toggles` equals the change in `TIMERAWL` (`0x400b0028`) divided by 500,000, plus or minus 1. `$lr` in the handler is `0xfffffff9`. The seventh word of the frame is an address in `main`.

## A UART driver fed by an interrupt

The firmware keeps time, but an LED is still its only output. The Debug Probe's serial wires have sat on GP0 and GP1 since you shared the probe with WSL2, so the next block to bring up is the UART.

A **UART** sends bytes one bit at a time over one wire per direction. The line rests high. Each byte travels as a **frame**: a start bit (low), eight data bits with the least significant first, and a stop bit (high). No wire carries a clock, so both ends must agree on the bit rate, the **baud rate**, in advance. At 115,200 baud one bit lasts 8.68 us, and a byte with its start and stop bits takes 87 us.

The RP2350's UARTs are Arm's PL011 design. Each has a 32-byte transmit queue and a 32-byte receive queue, called **FIFOs** (first in, first out), a flag register that reports their state, and an interrupt that fires when bytes wait in the receive FIFO.

The bit rate comes from `clk_peri` through a divisor with 16 integer bits and 6 fraction bits:

1. divisor = clk_peri / (16 x baud) = 12,000,000 / (16 x 115,200) = 6.5104.
2. The integer part goes in `UARTIBRD`: 6.
3. The fraction times 64, rounded, goes in `UARTFBRD`: 0.5104 x 64 = 32.67, so 33.
4. The divisors take effect only at the next write to `UARTLCR_H`, which also sets 8 data bits and turns the FIFOs on. Then `UARTCR` enables the UART and both directions.

The result is 115,108 baud, 0.08% slow, far inside what a UART tolerates. The pins need the treatment GP25 got. GP0 and GP1 take function 2 for UART0, and GP1, the receive pin, also needs `IE` set in its pad.

Sending polls: wait while `TXFF` (transmit FIFO full) is set in `UARTFR`, then write the byte to `UARTDR`. Receiving uses the interrupt, IRQ 33. The handler cannot parse commands, because a long handler delays every other interrupt. It moves bytes into a ring buffer, and `main` takes them out:

![Bytes arrive on GP1 into the UART's 32-byte receive FIFO. uart0_irq empties the FIFO into the ring buffer and advances tail. main advances head as it takes bytes out, parses lines and writes replies through uart_putc into the transmit FIFO, which sends them on GP0.](figures/17-uart-ring.svg)

This is the single-producer ring from chapter 09, with the handler as producer and `main` as consumer. Each side writes only its own index, and the release and acquire pairs stay as you argued them there. On the M33 they compile to `stl` and `lda`, the 32-bit forms of the `stlr` and `ldar` that chapter 09 named for ARM64.

One case differs. The handler cannot wait for `main` when the ring is full, because `main` cannot run until the handler returns. So the handler drops the byte and counts it.

The ring's size comes from the traffic. The burst test below sends 50 lines of 41 bytes, 2,050 bytes in about 180 ms:

- For each line, `main` echoes 42 bytes and sends a 44-byte bracketed copy, about 86 bytes back through the same 115,200 baud wire. So it takes bytes out at less than half the rate they arrive.
- By the end of the burst, `main` has consumed about 1,000 bytes, and about 1,050 wait in the ring. The 32-byte FIFO holds almost none of that.
- 2,048 bytes, the next power of two, leaves about twice the room the burst needs and uses 0.4% of SRAM.

### Study

- [RP2350 Datasheet, 12.1: UART](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=872) (read, 1 h 15 min): 12.1.1 to 12.1.3 for the FIFOs and the baud divisor, 12.1.6 "Interrupts" with 12.1.6.2 and 12.1.6.4 for the receive and receive timeout interrupts, and 12.1.7 "Programmer's model", which shows the `LCR_H` write that latches the divisors. In 12.1.8 read the tables for `UARTDR`, `UARTFR`, `UARTIBRD`, `UARTFBRD`, `UARTLCR_H`, `UARTCR` and `UARTIMSC`. Skip flow control and DMA. Table 3 in 1.2.3 (PDF page 18) shows which pins carry UART0.

### Build

1. Adapt your chapter 09 ring into `ring.c` and `ring.h` for bytes, with no allocation and a size `RING_SIZE` fixed at compile time: `#ifndef RING_SIZE`, `#define RING_SIZE 2048`. Keep `head` and `tail` as `_Atomic uint32_t` counters that run freely and index the array with `% RING_SIZE`. Drop the `_Alignas(64)` fields and the private copies of the other index, since one core runs both sides and SRAM has no cache in front of it. `ring_try_push` returns false and increments `dropped` when the ring is full. `ring_try_pop` returns false when it is empty.
2. Test the ring on the laptop first. Put `ring_test.c` in `~/code/pico/tests`, so `build.sh` does not pick it up, and build it with `clang -std=gnu11 -Wall -Wextra -g -fsanitize=address,undefined -DRING_SIZE=64 -I.. ../ring.c ring_test.c -o ring_test`. Test an empty pop, 64 pushes and then a 65th that drops, both counters started at `0xFFFFFFF0` so they wrap during the test, and a million random pushes and pops checked against a simple reference queue.
3. `uart.c`: enable `clk_peri` from the XOSC (`CLK_PERI_CTRL` with `AUXSRC` 4 and `ENABLE`, bit 11), `unreset` UART0 (bit 26), set up the pins and the divisors, then write `uart_putc`, `uart_puts` and `uart_puthex32`.
4. Print a boot banner with the value of `RESET_DONE` in hex, and read it in `minicom -D /dev/ttyACM0 -b 115200`.
5. Add `uart0_irq` in vector slot 16 + 33. It reads `UARTDR` until `RXFE` (receive FIFO empty) is set in `UARTFR` and pushes each byte. Bits 8 to 11 of each read are error flags, so keep only the low 8 bits. In `main`, set `RXIM` and `RTIM` in `UARTIMSC` and bit 1 of `NVIC_ISER1`, which is IRQ 33.
6. `main` pops bytes and echoes them. On a carriage return it prints the whole line back inside brackets. A line longer than 63 bytes is thrown away up to the next carriage return, with the message `error: line too long`.
7. A burst test from Python. Install pyserial with `sudo apt install -y python3-serial` and write `burst.py`: open `/dev/ttyACM0` at 115200, send a number of lines given as its argument, 50 by default, each 40 bytes and a carriage return, in one write, and count the bracketed lines that come back.
8. Add a 20 ms `delay_us` in `main` for each line it handles and a `stats` command that prints `dropped`. Run the burst with 100 lines. In the 360 ms those 4,100 bytes take to arrive, `main` handles fewer than 18 lines, so more than 3,300 bytes back up and the ring must drop some. Remove the delay.

### Done when

The ring tests pass under the sanitizers, wraparound included. On the board, `burst.py` gets back all 50 lines at full speed and `dropped` stays 0. With the slow `main` and 100 lines, `stats` reports a nonzero `dropped`, the firmware keeps running, and the next line you type comes back intact. The LED keeps toggling every 500 ms through every burst.

## An event loop and sleep

You have two interrupt sources and a `main` that polls the ring in a tight loop. This step gives the firmware a shape that still works as it grows, and lets the core sleep when there is nothing to do.

Handlers do the minimum: acknowledge the hardware, capture the data, record that something happened. `main` runs an **event loop**: each pass takes the events that are pending, runs the work for each to completion, and goes round again. No task has its own stack and nothing interrupts a task to run another, so tasks need no locks against each other. The cost is that one slow task delays all the others, so the loop measures how long each pass takes.

The events can be bits in one word, `pending`:

- A handler sets its bit with `atomic_fetch_or`.
- `main` takes all the bits at once with `atomic_exchange(&pending, 0)`.

Both are read-modify-write operations. The M33 has no single atomic OR instruction, so each compiles to a retry loop around `ldaex` and `stlex`, the acquire and release forms of the load-exclusive `ldrex` and the store-exclusive `strex`. The store fails and the loop retries if an interrupt came in between. The timer now fires every millisecond and posts a tick event. Software timers live in `main`: a small array of `{next_due, period, function}`, checked on each tick.

When nothing is pending, the core should sleep instead of spinning. `wfi` (wait for interrupt) stops the core until an interrupt becomes pending. The obvious code has a race:

```c
if (pending == 0)            /* an interrupt arriving here sets pending ...      */
    __asm volatile("wfi");   /* ... and the core sleeps anyway until the next one */
```

The fix uses one property of `wfi`: an interrupt that becomes pending wakes the core even while `PRIMASK`, the core's switch that holds back all interrupts, is set. So mask interrupts, check, sleep, then unmask:

```c
__asm volatile("cpsid i" ::: "memory");   /* set PRIMASK: interrupts stay pending */
if (atomic_load_explicit(&pending, memory_order_acquire) == 0)
    __asm volatile("wfi");                /* wakes on any pending interrupt       */
__asm volatile("cpsie i" ::: "memory");   /* the pending handler runs right here  */
```

An interrupt that arrives between the check and the `wfi` stays pending, makes `wfi` return at once, and runs when `cpsie` clears `PRIMASK`. The `"memory"` clobber stops the compiler from moving memory accesses across the instruction.

![The two handlers set bits in the pending word with atomic_fetch_or. main's loop masks interrupts, checks pending and sleeps in wfi only when it is zero, unmasks so that a waiting handler runs, takes all bits at once with atomic_exchange, runs the work for each event and goes round again.](figures/17-event-loop.svg)

### Study

- [Pico SDK 2.3.1: crt0.S](https://github.com/raspberrypi/pico-sdk/blob/2.3.1/src/rp2_common/pico_crt0/crt0.S) (reference, as needed): The SDK's vector table and reset handler, only for the optional item at the end of this step. That item names the lines to read.
- [Pico SDK 2.3.1: hardware_uart/uart.c](https://github.com/raspberrypi/pico-sdk/blob/2.3.1/src/rp2_common/hardware_uart/uart.c) (reference, as needed): The SDK's UART driver, only for the optional item. Read `uart_set_baudrate`.

### Build

1. Events: `EV_TICK` from the timer, which now fires every 1 ms, and `EV_RX` from the UART handler. `main` loops over `atomic_exchange`, runs the software timers on each tick and drains the ring on `EV_RX`.
2. Two blink tasks as software timers: GP25 at a period you can change and an external LED on GP15 at 300 ms. Wire GP15 to the LED's longer leg, and the shorter leg through the 330 ohm resistor to a GND pin. Set up GP15 with your `gpio_init_output`.
3. Commands on the console:
   - `help` lists the commands.
   - `led <ms>` sets the period of the GP25 task, 50 to 5000. Anything else prints `error: range`.
   - `uptime` prints the seconds since boot from `TIMERAWL`.
   - `stats` prints `dropped`, the number of loop passes, the number of `wfi` calls and the longest time taken by a pass that ran no command, measured with `TIMERAWL`.
4. Sleep with the `cpsid`, `wfi`, `cpsie` sequence above. Run `stats` twice ten seconds apart, once with the `wfi` line commented out and once with it.
5. Disassemble the handler that calls `atomic_fetch_or` and find the `ldaex` and `stlex` pair and the branch that retries.

> **Optional:** Read the SDK's version of what you built, in `crt0.S`. Every `#if` there takes the branch for an RP2350 Arm flash build: `PICO_RP2040` is 0, `PICO_NO_FLASH` is 0, `PICO_EMBED_XIP_SETUP` is 0, and `PICO_CRT0_DEBUG_ENTRY_RESETS_VIA_BOOTROM` is 1. Read the first two words under `__vectors`, then `_entry_point`, `_reset_handler` with `hold_non_core0_in_bootrom`, the loop over `data_cpy_table`, `bss_fill_loop`, and the calls to `runtime_init`, `main` and `exit`.
>
> Write `NOTES.md` with two lists. The first names five things `crt0.S` does that your startup does not, with one sentence each on why, such as sending core 1 back to the boot ROM or copying several regions from one table. The second walks through `uart_set_baudrate` in `uart.c` with `clk_peri` at 12 MHz and 115,200 baud and checks that it gives your `IBRD` of 6 and `FBRD` of 33.
>
> If you did the fault item of the interrupt step, also add a `fault` command that raises the `INVSTATE` fault, and make `hardfault_c` print CFSR, HFSR and the stacked LR and PC over the UART with polled writes before it stops. `arm-none-eabi-addr2line -e out/fw.elf` then maps the printed LR to the line after the bad call.

### Done when

Both LEDs blink at their own rates while you type, and `led 100` changes the GP25 rate within one period. With no debugger halts, `uptime` agrees with a stopwatch to within a second over five minutes. With `wfi`, the loop count over ten seconds is close to the number of events, about 10,000 ticks plus your typing. Without it, the count is hundreds of times larger.

After a reset, while you type by hand, the longest pass that ran no command stays under 1 ms. You can point at the `ldaex` and `stlex` retry loop. `arm-none-eabi-nm out/fw.elf` still lists only your symbols.

## Where this leads

The firmware forgets everything at power-off, and its only link to the world is a serial line with no protocol on it. Chapter 18, Storage and network internals, works on both problems. It starts with the simplest store that survives a crash, one append-only file of checksummed records with a hash table in memory. Then it crashes that store at every write on a simulated disk and moves the index onto disk pages with a B+ tree and a write-ahead log, where each record must reach stable storage before the store reports it saved.

The second half is a TCP stack in user space over a Linux TUN device. TCP is a state machine over incoming bytes with buffers on both ends, a larger version of your line parser.
