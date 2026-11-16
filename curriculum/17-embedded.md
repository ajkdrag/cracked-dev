---
id: 17
title: Embedded firmware
part: Kernels and bare metal
weeks: 3
project: Bare-metal firmware for the Raspberry Pi Pico 2 (RP2350) with no SDK code, built on your own linker script and startup code, with GPIO from the datasheet, a timer interrupt and an interrupt-driven UART console in a cooperative event loop.
---

Chapter 16 ended with a driver inside Linux for QEMU's edu device. The PCI core found the device and mapped its registers for you, the interrupt core decided when your handler ran, and the kernel owned the page tables. Chapter 15 went one level lower: your own kernel on QEMU, with your own interrupt table, page tables and two tasks. Even there, a bootloader loaded your image and handed you a machine in a known state, and QEMU's emulated devices were more forgiving than real ones.

This chapter removes those layers. The Raspberry Pi Pico 2 carries an RP2350 microcontroller: two Arm Cortex-M33 cores, 520 KB of SRAM, a boot ROM, and 4 MB of flash on the board. It has no MMU and no operating system. Every peripheral is a block of registers at a fixed physical address listed in the datasheet. The boot ROM finds your image in flash and jumps to it, and from that instruction on, everything that is set up is set up by you. You write the linker script, the vector table and the startup code, take the GPIO, timer and UART blocks out of reset, switch the chip to its crystal, and handle interrupts in plain C functions. The result is a small firmware with a serial console that blinks two LEDs, takes commands and sleeps when idle, with no line of Raspberry Pi's SDK in it. At the end you read the SDK's startup code and UART driver and compare them with yours.

You need hardware. Buy a Raspberry Pi Pico 2, from about 5 USD. Get the plain Pico 2 and not the Pico 2 W, because the W's LED hangs off the wireless chip and needs a driver to blink. Buy a Raspberry Pi Debug Probe as well. It gives you a debugger connection (SWD) and a USB serial port in one device. A second Pico 2 running Raspberry Pi's `debugprobe` firmware does the same job, and the guide in step 2 covers both. The Pico 2 needs pin headers soldered on, including the 3-pin debug header at the end of the board, unless you buy one with headers already fitted. For step 6 you also want a breadboard, one LED and a 330 ohm resistor. Order everything before you start. Step 1 needs no board.

Everything runs on the Mac, because USB devices are simpler there than inside the Linux VM. Install Arm's GNU toolchain for bare-metal targets, which brings `arm-none-eabi-gcc`, `objdump`, `readelf`, `nm` and `arm-none-eabi-gdb`, and two small tools:

```sh
brew install --cask gcc-arm-embedded
brew install picotool minicom
```

The Linux VM can build the same code after `sudo apt install gcc-arm-none-eabi`, if you prefer to edit there. Flash and debug from the Mac. One more warning: the original Pico (RP2040, a Cortex-M0+) boots differently, with a checksummed 256-byte flash setup block and no pad isolation, and the RP2350's two RISC-V cores use another startup path. Everything here targets the RP2350's Arm cores.

## An image the boot ROM will run

At power-on both cores start in the boot ROM, a 32 KB program at address `0x00000000` that Raspberry Pi burned into the chip. Core 1 goes to sleep and waits. Core 0 decides where to boot from. With no button held, it sets up the flash chip so that its contents appear at `0x10000000`, which the datasheet calls XIP (execute in place), and searches the first 4 KB of the image for a metadata block called an IMAGE_DEF. An IMAGE_DEF tells the ROM that this flash holds a program, for which CPU and in which security state. If the ROM finds none, it assumes the flash is blank and starts its USB bootloader instead. The smallest valid Arm IMAGE_DEF is five words, listed in section 5.9.5 of the datasheet:

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

That block does not name an entry point, so the ROM treats the start of the image as a Cortex-M vector table. A vector table is an array of 32-bit words. Word 0 is the initial stack pointer. Word 1 is the address of the reset handler, the first code to run. Words 2 to 15 are handlers for the core's own exceptions, such as HardFault. Word 16 onwards holds one handler per peripheral interrupt, and the RP2350 has 52 of those, numbered IRQ 0 to 51. The ROM loads the stack pointer from word 0 and jumps to the address in word 1.

```
  flash, as the core sees it                     SRAM
  0x10000000  vector table, 68 words             0x20000000  .data  (copied from flash)
              [0] initial SP = 0x20082000                    .bss   (zeroed)
              [1] Reset_Handler | 1                           ...
              [2..15] core exceptions                          ^
              [16..67] IRQ 0 to 51                             | stack grows down
  0x10000110  IMAGE_DEF, 20 bytes                0x20082000  top of SRAM
              .text, .rodata
              initial values of .data
```

Your code runs from flash. Initialized globals live in RAM, but RAM holds garbage at power-on, so the image keeps their initial values in flash and the reset handler copies them into RAM before `main`. The reset handler also zeroes `.bss`. François Baldassari's two posts below walk through exactly this on a different Cortex-M chip. The linker script places sections with two addresses each: where a section runs (the VMA) and where it is stored in the image (the LMA). `.data` runs in RAM and is stored in flash, written `> RAM AT > FLASH`. The script also defines symbols such as `_sdata` and `_ebss` that have an address and no storage. The reset handler declares them as `extern uint32_t _sdata[];` and uses their addresses as loop bounds. You read linker output and relocations in chapter 05. Here you write the script that tells the linker where everything goes.

Three things differ from the posts. His chip has flash at `0x00000000` and yours has it at `0x10000000`. His complete script and his symbol definitions sit in separate snippets, so merge them. And he copies `.data` from `_etext`, which works only if `.data` is stored right after `.text`. Define `_sidata = LOADADDR(.data);` after the `.data` section instead, which asks the linker for the load address directly. Add `ENTRY(Reset_Handler)` at the top, which records the entry point in the ELF header for tools that read it, and wrap the vector table and the IMAGE_DEF in `KEEP(...)` so that a later `--gc-sections` cannot drop them.

The Cortex-M33 runs Thumb-2, a 32-bit Arm instruction set, not the AArch64 code you read in chapter 05. The ideas carry over. There are 13 general registers `r0` to `r12`, plus `sp`, `lr` and `pc`. A function gets its first four arguments in `r0` to `r3` and returns in `r0`, and `r4` to `r11` are callee-saved. Instructions are 16 or 32 bits long. A 32-bit constant such as a peripheral address is loaded from a nearby "literal pool" with `ldr r3, [pc, #12]`. The core only executes Thumb, and every code address in the vector table must have bit 0 set to say so. The compiler sets that bit for you when you write a function's name, so the reset vector in your dump ends in an odd hex digit.

### Study

- [Interrupt: From Zero to main(): Bare metal C](https://interrupt.memfault.com/blog/zero-to-main-1) (read, 30 min): "Setting the stage", "Power on!" and "Writing a Reset_Handler". The board, the Arduino OpenOCD fork and the CMSIS-DAP commands are his setup, so read past them. The point to take away is the Reset_Handler that copies `.data` and zeroes `.bss`.
- [Interrupt: From Zero to main(): Demystifying Firmware Linker Scripts](https://interrupt.memfault.com/blog/how-to-write-linker-scripts-for-firmware) (read, 45 min): The whole post, by the same author. "Memory Layout", the four section definitions and "Variables" are the parts you copy and adapt. His addresses are for a SAMD21 with 256 KB of flash at 0 and 32 KB of RAM.
- [RP2350 Datasheet, 5.9.5: Minimum viable image metadata](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=390) (reference, as needed): Table 503 has the five words above. Section 5.1.12 "Flash image boot" (PDF page 332) states the 4 KB rule, and 2.2 "Address map" (PDF page 28) lists where ROM, XIP flash and SRAM live. PDF page numbers are one higher than the numbers printed on the pages.

### Build

Make a directory `pico` with `link.ld`, `startup.c`, `main.c` and a `build.sh` in the style of chapter 01's script. Compile with:

```sh
arm-none-eabi-gcc -mcpu=cortex-m33 -mthumb -O1 -g -Wall -Wextra -Wno-override-init \
    -ffreestanding -nostdlib -T link.ld startup.c main.c -o fw.elf
```

1. `link.ld`: `FLASH` at `0x10000000`, length 4M. `RAM` at `0x20000000`, length 520K. Sections in order: `.text` holding `KEEP(*(.vectors))`, then `KEEP(*(.image_def))`, then code and read-only data, all in `FLASH`. Then `.data` in `RAM AT > FLASH`, then `.bss (NOLOAD)` in `RAM`. Define `_sdata`, `_edata`, `_sbss`, `_ebss`, `_sidata` and `_estack = ORIGIN(RAM) + LENGTH(RAM)`.
2. `startup.c`: `Default_Handler` (an infinite loop), `Reset_Handler` (copy `.data`, zero `.bss`, call `main`, then loop forever), the IMAGE_DEF above, and the vector table as `void (*const vectors[68])(void)` in section `.vectors`. Fill every slot. GCC's range initializer `[2 ... 67] = Default_Handler` followed by `[1] = Reset_Handler` does it in two lines, and `-Wno-override-init` silences the warning about overwriting. Word 0 is `(void (*)(void))_estack`.
3. `main.c`: `uint32_t boot_value = 7;` and `uint32_t ticks;` as globals. `main` increments `ticks` forever.
4. Inspect the result:

```sh
arm-none-eabi-readelf -lS fw.elf          # sections and the two LOAD segments
arm-none-eabi-nm -n fw.elf                # every symbol, sorted by address
arm-none-eabi-objcopy -O binary fw.elf fw.bin
od -A x -t x4 fw.bin | head -4            # the first words of the flash image
arm-none-eabi-objdump -d fw.elf           # Thumb disassembly
```

5. In the disassembly of `Reset_Handler`, find the copy loop and the zero loop, and mark which register holds the source pointer. If the link fails with an undefined `memcpy` or `memset`, the compiler recognized your loop and replaced it with a library call. Add `-fno-tree-loop-distribute-patterns` to the flags.
6. Delete `AT > FLASH` from `.data`, rebuild, and look at `readelf -l` again. Write one sentence on what the boot ROM would load and what `boot_value` would hold at `main`. Put it back.

### Done when

`od` shows `20082000` as the first word and an odd address inside your `Reset_Handler` as the second. `nm` puts `image_def` below `0x10001000`. In `readelf -l`, the second LOAD segment has VirtAddr `0x20000000` and a PhysAddr inside flash, and `od -A x -t x4 -j <offset> -N 4 fw.bin`, with the offset of that PhysAddr from `0x10000000`, shows the word `00000007`. You can point at the instructions in `Reset_Handler` that read `_sidata` and `_ebss`.

## Flashing, the debug probe and the first boot

The image from step 1 has no visible output. It changes a counter in RAM. To see it run you need a debugger that works with no software on the chip, and SWD gives you that. SWD (Serial Wire Debug) is a two-wire port on the chip itself. Through it, a debugger can halt the core, read and write registers and memory, set hardware breakpoints and program the flash, all without the cooperation of the code running there. The Debug Probe turns USB into SWD. OpenOCD runs on the Mac, talks to the probe, and opens a GDB server on port 3333. `arm-none-eabi-gdb` connects to that port and works much like the gdb you used in chapter 01, with one change: your program is already on the target, so you attach and reset instead of `run`.

```
  Mac                                         Debug Probe          Pico 2
  arm-none-eabi-gdb --tcp 3333--> openocd --USB--> SWD side ---SWCLK/SWDIO/GND--> debug header
  minicom ----------------- /dev/cu.usbmodem* --> UART side ---TX/RX/GND--------> GP1 / GP0 / GND
                                                                    USB cable --> power, BOOTSEL drive
```

There are two ways to put an image into flash. The boot ROM has a USB bootloader: hold the BOOTSEL button while you plug in the Pico 2 and it appears as a drive called `RP2350`. Copying a UF2 file onto that drive writes it to flash. The same bootloader also speaks a USB protocol that `picotool` uses, so `picotool load -x fw.elf` writes an ELF and reboots into it. The other way is OpenOCD's `program` command over SWD, which needs no button. Use OpenOCD while you develop, and keep `picotool` for when the probe is not attached.

Prove each piece with something known to work before you trust your own image. First, Raspberry Pi's prebuilt blink UF2 shows that the board and USB cable are fine. Then OpenOCD connecting through the probe shows that the wiring is fine. Only then flash your own image. When it does not run, you then know the problem is in your image.

Getting OpenOCD: the Homebrew `open-ocd` package is version 0.12.0, which predates the RP2350. Raspberry Pi publishes builds with RP2350 support, and the guide's section A.6.1 links to them. Download `openocd-<version>-mac.zip` from the newest release there and unzip it into `~/tools/openocd`. It is a universal binary and carries its `scripts` directory next to it. If macOS refuses to run it, `xattr -dr com.apple.quarantine ~/tools/openocd` clears the download flag. The guide's commands use `target/rp2040.cfg` in most places. For the Pico 2 you need `target/rp2350.cfg` everywhere. The guide also suggests `lldb` on Apple silicon. Use `arm-none-eabi-gdb` from Arm's toolchain instead, as the Debug Probe documentation does.

### Study

- [Getting started with Raspberry Pi Pico-series, Appendix A: Debugprobe](https://datasheets.raspberrypi.com/pico/getting-started-with-pico.pdf#page=16) (do, 1 h): A.1 and A.1.1 for the wiring, including the note for a Pico 2 without the JST debug connector. Read A.2 and A.3 only if a second Pico 2 is your probe. Then A.4, A.5.3 (macOS), A.6.1 and A.6.2. Skip the Windows and Linux parts and the SDK build commands.
- [Raspberry Pi documentation: Your first binaries](https://www.raspberrypi.com/documentation/microcontrollers/c_sdk.html#your-first-binaries) (do, 10 min): "Blink an LED" only. It links the prebuilt `blink_universal.uf2` and confirms that the Pico 2 LED sits on GP25. Skip the SDK setup above it.
- [picotool README](https://github.com/raspberrypi/picotool) (reference, as needed): The `info`, `load`, `reboot` and `uf2 convert` sections.

### Build

1. Solder the headers if you have to. Hold BOOTSEL, plug the Pico 2 into the Mac, drag `blink_universal.uf2` onto the `RP2350` drive and watch the LED blink. Hold BOOTSEL and replug, then run `picotool info -a` and check that it lists the board.
2. Wire the probe as in A.1.1: the "D" cable to SWCLK, GND and SWDIO on the debug header, and the "U" cable to GP0, GP1 and GND, with the probe's RX on the Pico's TX (GP0). Plug both USB cables in.
3. Start the server and leave it running in its own terminal:

```sh
cd ~/tools/openocd
./openocd -s scripts -f interface/cmsis-dap.cfg -f target/rp2350.cfg -c "adapter speed 5000"
```

4. Stop the server with Ctrl-C. Flash your step 1 image with the same command plus `-c "program /path/to/fw.elf verify reset exit"`, then start the server again.
5. Debug the boot. Run `arm-none-eabi-gdb fw.elf`, then `target remote localhost:3333`, `monitor reset halt`, `break *Reset_Handler` and `continue`. The star puts the breakpoint on the first instruction instead of after the function's prologue. The core comes through the boot ROM and stops there. Print `$sp`. SRAM keeps its contents across a reset, so `boot_value` may still hold 7 from the last run. Run `set var boot_value = 0`, then `break main`, `continue`, and print `boot_value` again to see the copy loop's work. Continue once more, press Ctrl-C and print `ticks`. Dump the start of flash with `x/4xw 0x10000000` and compare it with your `od` output.
6. Remove the IMAGE_DEF from `startup.c`, rebuild and flash it. Replug the board without touching BOOTSEL and run `picotool info`. The ROM found no IMAGE_DEF and started its bootloader instead. Put the IMAGE_DEF back and flash again.
7. Convert the good image with `picotool uf2 convert fw.elf fw.uf2`, then load it the other way: BOOTSEL, drag the UF2 onto the drive, and check with gdb that `ticks` is moving. To attach to a running board without resetting it, connect with `target remote` and press Ctrl-C.

### Done when

After a cold power-up from USB, you can attach gdb without a reset and see `ticks` grow between two halts, with `boot_value` equal to 7. You have seen `$sp` equal `0x20082000` at the first instruction of `Reset_Handler`. The image without an IMAGE_DEF brings up the `RP2350` drive on a plain power-up, and you can say which word of the flash image the boot ROM was looking for.

## Registers: resets, the IO mux, pads and the LED

A peripheral register is an address where loads and stores go to a piece of hardware instead of RAM. A store to `0xd0000028` toggles output pins. A load from a UART's data register takes a byte out of its receive queue, so reading it twice gives two different bytes. The compiler does not know any of this. To the compiler, a store whose value is never read back is a dead store, and two loads from the same address can be merged into one. `volatile` tells it that every access in the source must happen in the machine code, in order relative to other volatile accesses. John Regehr's post below covers what `volatile` does and does not give you, and its limits matter in step 4, when an interrupt handler starts sharing variables with `main`.

```c
#define REG(addr) (*(volatile uint32_t *)(addr))

REG(0xd0000038) = 1u << 25;      /* SIO GPIO_OE_SET: GP25 becomes an output */
REG(0xd0000028) = 1u << 25;      /* SIO GPIO_OUT_XOR: flip GP25 */
```

Driving the LED on GP25 takes four blocks of the chip, and each has to be set up:

```
  SIO (core 0)                  IO_BANK0                       PADS_BANK0               pin
  GPIO_OE   bit 25 --+
                     +--> GPIO25_CTRL.FUNCSEL = 5 (SIO) --> GPIO25: ISO=0, OD=0 --> GP25 --> LED
  GPIO_OUT  bit 25 --+
```

First, RESETS. Most peripherals start held in reset, and a register access to a block in reset does nothing useful. You clear the block's bit in the RESETS `RESET` register and wait until the same bit reads 1 in `RESET_DONE`. IO_BANK0 is bit 6 and PADS_BANK0 is bit 9. The boot ROM may already have released some blocks. Release them yourself anyway, so that your code does not depend on what the ROM happened to do.

Second, the IO mux. Each pin can carry one of several functions: a UART, SPI, PWM, or plain software control through the SIO block. `GPIOn_CTRL` in IO_BANK0 picks one with its FUNCSEL field. For software control of GP25 that is function 5.

Third, the pad, the electrical part of the pin. Its register sets drive strength, pull-ups and two bits that most other chips do not have. At reset the RP2350 latches every pad in isolation (`ISO` set) and turns its input buffer off (`IE` clear). Output does not reach the pin until you clear `ISO`, and the chip cannot read the pin until you set `IE`. The RP2040 had neither behavior, so code ported from it fails here in silence.

Fourth, SIO, the block wired directly to each core. Its `GPIO_OE` register enables the output drivers and `GPIO_OUT` sets the levels. Each has `_SET`, `_CLR` and `_XOR` versions at separate addresses, so one store changes only the bits you name. Most other peripherals offer the same thing through address aliases: add `0x1000` to a register's address for an XOR on write, `0x2000` for set, `0x3000` for clear. A plain read-modify-write, `REG(x) |= bit`, is a load, an OR and a store. An interrupt handler that changes the same register between the load and the store loses its change. The aliases make each update a single store.

Write your own `regs.h` with the base addresses and offsets you need, copied from the datasheet's register tables. Do not include the SDK's headers in the build. After you have written each address, check it against the SDK's generated headers, which come from the same source as the datasheet.

### Study

- [John Regehr: Nine ways to break your systems code using volatile](https://blog.regehr.org/archives/28) (read, 30 min): Read 1 to 6. Number 1 has a device register and an interrupt flag, and numbers 5 and 6 explain why `volatile` neither orders ordinary memory accesses nor makes anything atomic. Skim 7 to 9, which cover threads and multiprocessors from chapter 09.
- [RP2350 Datasheet, chapter 9: GPIO](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=539) (read, 1 h 30 min): 9.1 to 9.8, PDF pages 539 to 546, and in 9.11 the entries for `GPIO25_CTRL` (IO_BANK0) and `GPIO25` (PADS_BANK0). Also read 2.1.3 "Atomic register access" (PDF page 24), 7.5 "Subsystem resets" with its `RESET` and `RESET_DONE` registers (PDF page 458), and 3.1.3 "GPIO control" for the SIO registers (PDF page 37).
- [Pico SDK: RP2350 register headers](https://github.com/raspberrypi/pico-sdk/tree/master/src/rp2350/hardware_regs/include/hardware/regs) (reference, as needed): `addressmap.h` for base addresses, then `resets.h`, `io_bank0.h`, `pads_bank0.h` and `sio.h`. Use them to check your numbers, never to replace them.

### Build

1. `regs.h` with the base addresses of RESETS, IO_BANK0, PADS_BANK0 and SIO, the offsets you use, and `REG`, `REG_SET` and `REG_CLR` macros for the aliases.
2. `gpio_init_output(pin)`: release IO_BANK0 and PADS_BANK0 from reset if needed, set FUNCSEL to SIO, clear `ISO` in the pad with the clear alias, and set the pin's bit in `GPIO_OE_SET`.
3. `main` blinks GP25 with a busy-wait delay, `for (volatile uint32_t i = 0; i < N; i++) {}`. The chip still runs from its ring oscillator, whose frequency is only roughly known, so pick N by eye for a blink of about one per second.
4. Disassemble `gpio_init_output` and match each store to a line of C, including the literal-pool load of each address.
5. Remove `volatile` from the `REG` macro, build with `-O2`, and find what disappeared from the blink loop. Restore it.
6. Halt the core in gdb while the LED is on and run `set *(unsigned *)0xd0000028 = 0x02000000`. The LED changes while the core is stopped, because the debugger wrote to SIO over the bus itself. Print the pad register with `x/xw 0x40038068` and decode it bit by bit against the datasheet table.

### Done when

The LED blinks after a cold power-up. `arm-none-eabi-nm fw.elf` lists only symbols you wrote. You can toggle the LED from gdb with the core halted, and you can name every set bit in the pad register you printed. You can explain in two sentences what happened to the loop without `volatile`.

## Clocks, the system timer and the first interrupt

The busy-wait blink has no fixed rate, because the chip boots on its ring oscillator (ROSC), whose frequency changes with voltage and temperature. The Pico 2 has a 12 MHz crystal on the board, driven by the chip's crystal oscillator (XOSC). A clock generator selects a source for each clock domain. You switch `clk_ref` to the crystal and `clk_sys`, which runs the cores and the bus, to `clk_ref`. The SDK goes further and multiplies the crystal up to 150 MHz with a PLL. You stay at 12 MHz, which is plenty here.

```
  XOSC 12 MHz --> clk_ref (CTRL.SRC = 2) --> clk_sys (CTRL.SRC = 0) --> cores, bus
                    |
                    +--> TICKS, TIMER0 generator (CYCLES = 12) --> 1 us tick --> TIMER0 counter, alarms
  XOSC 12 MHz --> clk_peri (CTRL.AUXSRC = 4, ENABLE) --> UART0 (next step)
```

Starting the XOSC is three register writes and a wait. Set the frequency range, set a startup delay in units of 256 crystal cycles (47 gives about 1 ms at 12 MHz), then enable it, and poll the `STABLE` bit. The XOSC `CTRL` register uses magic values: `0xaa0` selects the 1 to 15 MHz range and `0xfab` in bits 23 to 12 enables the oscillator. A clock generator with a glitchless mux, which `clk_ref` and `clk_sys` both have, reports the source it actually uses in a one-hot `SELECTED` register. After writing a new `SRC`, wait until bit `SRC` of `SELECTED` is set.

TIMER0 is a 64-bit counter that counts microseconds. It does not count the system clock. It counts ticks made by the tick generator from `clk_ref`, and that generator is off at reset. Set its divider to 12, so that a 12 MHz reference makes one tick per microsecond, and enable it. TIMER0 has four alarms. Writing a value to `ALARM0` arms it, and when the low 32 bits of the counter reach that value the timer raises IRQ 0. The handler acknowledges by writing 1 to bit 0 of `INTR`. To get a steady period, add the period to the old alarm value, not to the current time, so lateness in one handler does not shift the next tick. An alarm matches one exact value, so a target that is already in the past fires only after the 32-bit counter wraps, about 72 minutes later. One more detail affects debugging: the timer's `DBGPAUSE` register is set at reset, so the counter stops whenever the debugger halts a core.

Now the core's side. Chris Coleman's post covers the Cortex-M exception model. Peripheral interrupts go through the NVIC, the interrupt controller inside the core. Each IRQ has an enable bit in the `NVIC_ISER` registers at `0xE000E100` and up, a pending bit and a priority. IRQ n uses vector table slot 16 + n. On entry the core pushes eight words onto the current stack by itself: `r0` to `r3`, `r12`, `lr`, the return address and the status register `xPSR`. Those are exactly the registers the C calling convention lets a function clobber, so a C function can serve as a handler with no assembly around it. The core then puts a special value, EXC_RETURN, in `lr`. When the handler returns with an ordinary `bx lr`, that value tells the core to unstack the eight words and resume the interrupted code. In chapter 15, saving the rest of the registers was your code's job, whether you wrote the entry stub or the compiler generated it. Here the hardware does it.

A handler and `main` now share state. A counter that the handler increments and `main` reads needs `volatile` at the least, for the reason in Regehr's number 1. The core in this chapter is a single in-order core, and an interrupt sees memory exactly as the interrupted code left it. Only the compiler can reorder the accesses, so your code has to stop the compiler and nothing else. Step 5 uses C11 atomics, which you used in chapter 09, to say what you mean.

Faults use the same machinery. A bad memory access, an undefined instruction or a jump to an address with bit 0 clear raises an exception. You have not enabled the separate fault handlers, so each of those escalates to HardFault, vector 3. Coleman's second post explains how to read the fault status registers and how to find the faulting code in the eight stacked words. Its handler starts with a short assembly shim that passes the address of those words to a C function. Your code uses only the main stack, so your shim can be a naked function with two instructions:

```c
__attribute__((naked)) void HardFault_Handler(void)
{
    __asm volatile("mrs r0, msp\n\tb hardfault_c");   /* r0 = address of the stacked frame */
}

volatile uint32_t *fault_frame;

void hardfault_c(uint32_t *frame)   /* frame[5] = stacked lr, frame[6] = stacked pc */
{
    fault_frame = frame;            /* keep it where gdb can always print it */
    __asm volatile("bkpt #0");      /* stop here when the debugger is attached */
    for (;;) {}
}
```

### Study

- [Interrupt: A Practical guide to ARM Cortex-M Exception Handling](https://interrupt.memfault.com/blog/arm-cortex-m-exceptions-and-nvic) (read, 1 h): "ARM Exception Model Overview" with both subsections, then under "Registers used to configure Cortex-M Exceptions" the "NVIC Registers" subsection, then "Exception Entry & Exit", "Tail-Chaining" and "Execution Priority & Priority Boosting". Skim the other registers and the code examples, which run on an nRF52. Skip "Lazy State Preservation", since your code uses no floating point.
- [RP2350 Datasheet, chapter 8: Clocks](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=468) (read, 1 h 15 min): The first part of 8.1 up to 8.1.2 for the clock tree, 8.2.3 and 8.2.4 on starting the XOSC (PDF page 508) with its `CTRL`, `STATUS` and `STARTUP` registers in 8.2.8, 8.5 "Tick generators" (PDF page 522), and 12.8.1 to 12.8.4 "System timers" (PDF page 1095). Table 95 in 3.2 "Interrupts" (PDF page 81) lists the IRQ numbers. Skip the PLL, ROSC and frequency counter sections.
- [Interrupt: How to debug a HardFault on an ARM Cortex-M MCU](https://interrupt.memfault.com/blog/cortex-m-hardfault-debug) (reference, as needed): "Relevant Status Registers" and "Recovering the Call Stack" when a fault lands. Its examples run on a Cortex-M4, whose registers sit at the same addresses as on your M33.

### Build

1. `clocks_init()`: release TIMER0 from reset (bit 23 of RESETS), start the XOSC, switch `clk_ref` and then `clk_sys`, and set up the TIMER0 tick generator. Stop the generator before writing `CYCLES`, as 8.5 says.
2. Change the vector table so that slot 3 holds `HardFault_Handler` and slot 16 holds `timer0_irq`.
3. `timer0_irq` acknowledges the alarm, re-arms it 500,000 us after the previous target, toggles the LED with `GPIO_OUT_XOR` and increments a `volatile uint32_t toggles`. `main` follows the order in 12.8.3: set bit 0 in `INTE`, set bit 0 in `NVIC_ISER0`, then arm the first alarm at `TIMERAWL` plus 500,000. Then it loops doing nothing.
4. In gdb, break in `timer0_irq` and run `bt`. The backtrace goes through the exception frame into the loop in `main`. Print `$lr` and compare it with the EXC_RETURN values in Coleman's post.
5. Raise a fault on purpose. Call a function `fn` through a pointer whose bit 0 you cleared, `((void (*)(void))((uintptr_t)fn & ~1u))()`, with one more statement after the call so the compiler does not turn it into a tail jump. When gdb stops at the `bkpt`, read CFSR with `x/xw 0xE000ED28` and HFSR with `x/xw 0xE000ED2C`, then print `fault_frame[5]` and `fault_frame[6]` and run `info symbol` on each.

### Done when

The LED toggles every 500 ms: count 30 full blinks against a stopwatch and get 30 seconds. With the core halted twice in gdb, the change in `toggles` equals the change in `TIMERAWL` (`0x400b0028`) divided by 500,000, plus or minus 1. The deliberate fault shows CFSR `0x00020000` (INVSTATE) and HFSR `0x40000000` (FORCED). The stacked PC equals the address of `fn` with bit 0 clear, and the stacked LR points just after the call in the caller, which you can show with `info symbol` and `list *fault_frame[5]`.

## A UART driver fed by an interrupt

A UART sends bytes one bit at a time over a single wire per direction. The line idles high. A frame is a start bit (low), eight data bits with the least significant first, and a stop bit (high). Nothing carries a clock, so both ends must agree on the bit rate in advance. At 115200 baud one bit lasts 8.68 us. The RP2350's UARTs are the Arm PL011 design. Each has 32-byte transmit and receive FIFOs, a flag register for their state, and an interrupt that fires when the receive FIFO fills to a trigger level or when bytes sit in it with no new arrival for 32 bit periods.

The baud rate comes from `clk_peri` through a divisor with 16 integer bits and 6 fraction bits: divisor = clk_peri / (16 x baud). With `clk_peri` on the 12 MHz crystal, 12,000,000 / (16 x 115,200) = 6.5104. The integer part goes in `UARTIBRD` = 6, and the fraction times 64, rounded, goes in `UARTFBRD` = 33. The actual rate is 115,108 baud, 0.08% slow, far inside what a UART tolerates. The divisors take effect only on the next write to `UARTLCR_H`, so write `IBRD`, `FBRD`, then `LCR_H` with 8 data bits and the FIFOs enabled. Then enable the UART and both directions in `UARTCR`. The pins need the same treatment as GP25. GP0 and GP1 both take function 2 for UART0, and GP1, the receive pin, also needs `IE` set in its pad.

Transmit polls. Wait while `TXFF` (transmit FIFO full) is set in `UARTFR`, then write the byte to `UARTDR`. At 115200 baud a 60-byte line takes about 5 ms, so in this chapter only `main` transmits, never a handler. Receive uses the interrupt. Unmask `RXIM` and `RTIM` in `UARTIMSC` and enable IRQ 33 in the NVIC, which is bit 1 of `NVIC_ISER1`, and vector slot 49. The handler reads `UARTDR` until `RXFE` (receive FIFO empty) is set. Reading the data also clears both receive interrupts. Bits 8 to 11 of each read carry error flags. Ignore them or count them, but strip them before storing the byte.

The handler cannot parse commands, because parsing is slow and a handler that runs long delays every other interrupt. It puts bytes into a ring buffer, and `main` takes them out. This is the single-producer ring from chapter 09, with the interrupt handler as the producer and `main` as the consumer. Each side writes only its own index, as before:

```
  buf[64]                 tail: written only by the handler (next free slot)
  +---+---+---+---+---+   head: written only by main (next byte to read)
  |   | a | b | c |   |   count = tail - head       (unsigned, both counters run freely)
  +---+---+---+---+---+   empty when tail == head, full when tail - head == 64
        ^head       ^tail slot = index % 64
```

Two things may differ from your chapter 09 version. First, keep `head` and `tail` as free-running `uint32_t` counters and reduce them modulo the size only to index the array. Unsigned subtraction gives the right count even after the counters wrap past 2^32, provided the size is a power of two. The release and acquire pairs stay as you argued them in chapter 09: the handler writes the byte, then stores `tail + 1` with release, and `main` loads `tail` with acquire before it reads the byte. On this core those compile to `stl` and `lda`, the 32-bit counterparts of the `stlr` and `ldar` you found on ARM64. Second, the full case. The handler cannot wait for `main`, because `main` cannot run until the handler returns. When the ring is full, the handler drops the byte and increments a `dropped` counter.

### Study

- [RP2350 Datasheet, 12.1: UART](https://datasheets.raspberrypi.com/rp2350/rp2350-datasheet.pdf#page=872) (read, 1 h 15 min): 12.1.1 to 12.1.3 for the FIFOs and the baud divisor, 12.1.6 "Interrupts" with 12.1.6.2 and 12.1.6.4 for the receive and timeout interrupts, and 12.1.7 "Programmer's model", which shows the SDK's code including the `LCR_H` write that latches the divisors. In 12.1.8 read the tables for `UARTDR`, `UARTFR`, `UARTIBRD`, `UARTFBRD`, `UARTLCR_H`, `UARTCR` and `UARTIMSC`. Skip flow control and DMA. Table 3 in 1.2.3 (PDF page 18) shows which pins carry UART0.

### Build

1. Adapt your chapter 09 ring into `ring.c` and `ring.h` for bytes, with a fixed size of 64 and no allocation: `ring_try_push` (returns false and counts the drop when full) and `ring_try_pop` (returns false when empty). Drop the `_Alignas(128)` padding, since you use one core and SRAM has no cache in front of it. Test it on the Mac first, compiled with `clang -fsanitize=address,undefined`: empty pop, 64 pushes then a 65th that drops, both counters started at `0xFFFFFFF0` and run across the wrap, and a million random pushes and pops checked against a simple reference queue.
2. `uart.c`: enable `clk_peri` from the XOSC (`CLK_PERI_CTRL` with `AUXSRC` 4 and `ENABLE`), release UART0 from reset (bit 26), set up the pins and the divisors, then write `uart_putc`, `uart_puts` and `uart_puthex32`.
3. Print a boot banner with the value of `RESET_DONE` in hex. Read it in minicom with `minicom -D /dev/cu.usbmodem<tab> -b 115200`.
4. Add `uart0_irq` in vector slot 49, feeding the ring. `main` pops bytes and echoes them, and on carriage return prints the whole line back inside brackets. A line longer than 63 bytes is discarded up to the next newline with the message `error: line too long`.
5. A burst test from Python on the Mac. In a venv, `pip install pyserial` and write `burst.py`: open the port at 115200, send 50 lines of 40 bytes in one write, and count the bracketed lines that come back. Then add a 20 ms busy-wait in `main` for each line handled, run the burst again, and add a `stats` command that prints `dropped`.

### Done when

The host ring tests pass under the sanitizers, wraparound included. On the board, `burst.py` gets back all 50 lines at full speed. With the slow `main`, `stats` reports a nonzero `dropped`, the firmware keeps running, and the next line you type comes back intact. The LED keeps toggling every 500 ms through every burst.

## An event loop, sleep and the SDK side by side

You now have two interrupt sources and a loop in `main` that polls the ring. This step gives the firmware a structure that still works as it grows. Handlers do the minimum: acknowledge the hardware, capture the data, record that something happened. `main` runs an event loop. Each pass takes the pending events, runs the work for each to completion and goes back. No task has its own stack and nothing preempts a task, so tasks need no locks against each other. The cost is that one slow task delays all the others, so the loop measures how long each pass takes.

Events can be bits in one word. A handler sets its bit with `atomic_fetch_or`, and `main` takes them all with `atomic_exchange(&pending, 0)`. Each of those is a read-modify-write. This core has no single atomic OR instruction, so each compiles to a retry loop around a load-exclusive (`ldrex`) and a store-exclusive (`strex`). Change the timer to fire every millisecond and post a tick event. Software timers then live in `main`: a small array of `{next_due, period, function}`, checked on each tick.

When no event is pending, the core should sleep instead of spinning. `wfi` (wait for interrupt) stops the core until an interrupt becomes pending. The obvious code has a race:

```c
if (pending == 0)        /* an interrupt arriving here sets pending ...      */
    __asm volatile("wfi");  /* ... and the core sleeps anyway until the next one */
```

The fix uses one property of `wfi`: an interrupt that becomes pending wakes the core even when `PRIMASK` masks interrupts. So disable interrupts, check, sleep, then enable:

```c
__asm volatile("cpsid i" ::: "memory");   /* set PRIMASK: interrupts stay pending */
if (atomic_load_explicit(&pending, memory_order_acquire) == 0)
    __asm volatile("wfi");                /* wakes on any pending interrupt       */
__asm volatile("cpsie i" ::: "memory");   /* the pending handler runs right here  */
```

An interrupt that arrives between the check and the `wfi` stays pending, makes the `wfi` return at once, and runs when `cpsie` clears `PRIMASK`. The `"memory"` clobber stops the compiler from moving memory accesses across the instruction.

Last, read the SDK's version of what you built. `crt0.S` is the SDK's vector table and reset handler. Much of it is `#if` branches for other chips and other memory layouts, but the default flash path is short, and you can now match each instruction to something you wrote or chose to leave out. `uart.c` is the SDK's UART driver, and its `uart_set_baudrate` computes the same divisors you did with integer arithmetic.

### Study

- [Pico SDK: crt0.S](https://github.com/raspberrypi/pico-sdk/blob/master/src/rp2_common/pico_crt0/crt0.S) (read, 45 min): From `.section .vectors` through `_entry_point`, `_reset_handler` and `data_cpy_table`. In each `#if`, follow the branch for an RP2350 Arm flash build: not `PICO_RP2040`, not `PICO_NO_FLASH`, and treat `PICO_EMBED_XIP_SETUP` as off. Skip `crt0_riscv.S`.
- [Pico SDK: hardware_uart/uart.c](https://github.com/raspberrypi/pico-sdk/blob/master/src/rp2_common/hardware_uart/uart.c) (read, 20 min): `uart_init`, `uart_set_baudrate` and `uart_set_format`. Skip the functions for break, CRLF translation and deinit.

### Build

1. Events: `EV_TICK` from the timer (now every 1 ms) and `EV_RX` from the UART handler. `main` loops over `atomic_exchange`, runs software timers on each tick and drains the ring on `EV_RX`.
2. Two blink tasks as software timers: GP25 at a settable period and an external LED on GP15 at 300 ms. Wire GP15 to the LED's longer leg and the shorter leg through the 330 ohm resistor to a GND pin. Set up GP15 with your `gpio_init_output`.
3. Commands on the console: `help`, `led <ms>` (period of the GP25 task, 50 to 5000, anything else gives `error: range`), `uptime` (seconds since boot from TIMER0), `stats` and `fault`. `stats` prints `dropped`, the number of loop passes, the number of `wfi` calls and the longest time taken by a pass that ran no console command, measured with `TIMERAWL`. `fault` triggers the INVSTATE fault from step 4. Make `hardfault_c` print CFSR, HFSR and the stacked LR and PC over the UART with polled writes, then loop forever.
4. Sleep with the `cpsid`/`wfi`/`cpsie` sequence above. Run `stats` twice ten seconds apart, once with the `wfi` line commented out and once with it.
5. Write `notes.md` with two lists. The first names five things `crt0.S` does that your startup does not, with one sentence each on why it does them, for example sending core 1 back to the ROM, or the table of several regions to copy. The second walks through `uart_set_baudrate` with clk_peri at 12 MHz and 115200 baud and checks that it gives your `IBRD` and `FBRD`.

### Done when

Both LEDs blink at their own rates while you type, and `led 100` changes the GP25 rate within one period. `uptime` agrees with a stopwatch to within a second over five minutes. With `wfi`, the loop count over ten seconds is close to the number of events, about 10,000 ticks plus your typing. Without it, the count is hundreds of times larger. The longest pass that ran no command stays under 1 ms. `fault` prints CFSR `0x00020000` and a stacked LR that `arm-none-eabi-addr2line -e fw.elf` maps to the line of the bad call. `arm-none-eabi-nm fw.elf` still lists only your symbols, and `notes.md` exists with both lists.

## Where this leads

You have built a program for a machine with nothing on it. You decided where every byte lives, wrote the code that runs before `main`, and brought up clocks, pins, a timer and a UART from their register tables alone. The interrupts reached plain C functions because the core saves the caller-saved registers itself, and you kept the handlers short and passed work to a loop through a ring buffer and a word of event bits. You also matched the SDK's startup code and UART driver against your own.

The firmware forgets everything at power-off, and its only connection to the world is a serial line with no protocol on it. Chapter 18, Storage and network internals, works on both problems. It builds a key-value store whose write-ahead log survives a crash at any point, with a B+ tree on disk, then a userspace TCP over a TUN device. TCP is a state machine over incoming bytes with buffers on both ends, larger than your line parser, and the log is a ring of records that must reach stable storage in the right order.
