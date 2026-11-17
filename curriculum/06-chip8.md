---
id: 06
title: A CHIP-8 emulator
part: The machine and C
weeks: 3
project: A CHIP-8 emulator in C with an SDL3 window, keypad, sound and a single-step debugger that passes the Timendus CHIP-8 test ROMs.
---

Chapter 05 ended with an 8086 decoder and simulator. You read machine code byte by byte, pulled out its fields and ran each instruction against registers kept in a C struct. That simulator had no screen, no keys and no clock. In this chapter you write those parts too: code that turns a pixel buffer into a window, key presses into machine state, and time on the wall clock into timer ticks.

The machine is CHIP-8, from 1977. It never existed as hardware. It was a set of two-byte instructions, run by an interpreter program on the COSMAC VIP, a hobby computer. An **emulator** is a program that behaves like another machine closely enough to run that machine's programs. You write one for CHIP-8 in C, give it a window and sound, add a debugger, and check it against a set of test programs.

Decoding goes fast after chapter 05, because every CHIP-8 instruction is two bytes with fixed fields. The new work is timing, input and output. This chapter closes part one of the book. It uses the C from chapters 02 and 04, the machine model from chapter 03 and the decoding from chapter 05 in one program.

## The machine, fetch and decode

Every instruction reads or writes some part of the machine, so write the whole machine down first, as one C struct. CHIP-8 has five parts:

- Memory: 4 KB, addresses 0x000 to 0xFFF.
- Registers V0 to VF: sixteen 8-bit registers. VF doubles as the **flag register**, where some instructions write a 0 or a 1 to report a carry or a collision.
- I, PC and the stack: I is the **index register**, which holds a memory address for the instructions that use memory. PC is the program counter. The stack holds 16 return addresses, with a stack pointer SP.
- DT and ST: the delay timer and the sound timer, two 8-bit registers that count down 60 times a second.
- Display and keypad: 64 by 32 pixels, each on or off, and 16 keys, 0 to F.

![The CHIP-8 machine: 4 KB of memory with the font at 0x050 and the program from 0x200, sixteen registers, the timers, the stack, PC and I, the display and the keypad.](figures/06-machine.svg)

A CHIP-8 program comes as a **ROM**, a file of raw instruction bytes. The emulator copies it to address 0x200 and starts PC there. Below 0x200 your emulator keeps only the **font**: 16 small pictures of the hex digits 0 to F, 5 bytes each, at 0x050 to 0x09F.

An instruction is two bytes, high byte first. That order is called **big-endian**, the opposite of the little-endian order of your x86-64 CPU from chapter 02. The 16-bit value of an instruction is its **opcode**, short for operation code, written in this chapter as four hex digits such as D123.

Each hex digit is 4 bits, called a **nibble**. The first nibble picks the kind of instruction, and the other three are operands, split in one of a few fixed ways.

![The instruction 0xD123 split into its fields: the class D, the register numbers X and Y, the constant N, and the wider fields NN and NNN.](figures/06-opcode.svg)

Fetch reads the two bytes at PC and adds 2 to PC at once. Then pull out every field before the `switch`, so that no case gets a mask wrong on its own:

```c
uint16_t op = (uint16_t)(c->mem[c->pc & 0xFFF] << 8 | c->mem[(c->pc + 1) & 0xFFF]);
c->pc = (uint16_t)(c->pc + 2);
int x = op >> 8 & 0xF;
int y = op >> 4 & 0xF;
int n = op & 0xF;
uint8_t nn = (uint8_t)(op & 0xFF);
uint16_t nnn = (uint16_t)(op & 0xFFF);
switch (op >> 12) {
// one case per class
}
```

The casts keep clang quiet under `-Wconversion`. Masking every address with `& 0xFFF` keeps a broken ROM inside the 4096 bytes, so a bad jump cannot turn into an out-of-bounds read in your C program. The 8086 instructions of chapter 05 came in many encodings of one to six bytes. A CHIP-8 instruction always has two, and its first nibble picks its group, so a `switch` on that nibble, with a second `switch` inside a few cases, is the whole decoder.

The runner reads a ROM file by name. `fopen` from `<stdio.h>` opens a file and returns a `FILE *`, or `NULL` when it cannot. The mode `"rb"` means read, in binary, so no byte changes on the way in. `fread` copies up to a given number of bytes into a buffer and returns how many it copied, and `fclose` closes the file:

```c
FILE *f = fopen(path, "rb");
if (f == NULL) { fprintf(stderr, "cannot open %s\n", path); return 1; }
static uint8_t rom[3585];                  // one byte more than the largest ROM
size_t len = fread(rom, 1, sizeof rom, f);
fclose(f);
if (!chip8_load(&c, rom, (ptrdiff_t)len)) { fprintf(stderr, "ROM too long\n"); return 1; }
```

The largest ROM fills 0x200 to 0xFFF, 3584 bytes. A longer file fills the whole buffer, and `chip8_load` rejects that count. The window front end of step 5 reuses this code.

The emulator grows into four files. The last three pull in the core with `#include`, as the tests of chapter 02 did:

- `src/chip8_core.c`: the machine, with the struct, reset, load and step.
- `src/chip8.c`: the **headless** runner, which runs a ROM without a window and prints the machine as text.
- `src/chip8_sdl.c`: the window front end, from step 5.
- `tests/chip8_test.c`: the unit tests.

> **Practice:** Keep the machine apart from the outside world. The core has no `main`, no `printf` and no SDL, so the runner, the window and the tests can all include it, and you do not need chapter 02's `#define main` trick.

Test the first instructions on a ROM you write yourself. The six bytes `60 05 70 01 12 02` are three instructions. 6005 sets V0 to 5, 7001 adds 1 to V0, and 1202 jumps back to the add at 0x202. After seven steps V0 is 8 and PC is 0x202.

### Study

- [Tobias V. I. Langhoff: Guide to making a CHIP-8 emulator](https://tobiasvl.github.io/blog/write-a-chip-8-emulator/) (read, 40 min): From "Specifications" through "Execute", which includes Timers, Keypad and Timing. Then the start of "Instructions" and the sections 0NNN, 00E0, 1NNN, 6XNN, 7XNN and ANNN. DXYN is for the next step, and the other instruction sections for step 3. The guide describes behavior and has no implementation code, so the C is yours.
- [Timendus: CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite) (do, 10 min): Clone it with git into your project directory and add it to `.gitignore`. Read "Introduction" and the "CHIP-8" part of "Baseline". Only `bin/1-*.ch8` to `bin/7-*.ch8` are CHIP-8 tests. The scrolling test is for SUPER-CHIP, a later extension of CHIP-8.
- [Steffen Schümann: Classic CHIP-8 Technical Reference](https://chip8kb.gulrak.net/reference/variants/classic-chip-8/) (reference, as needed): A description of the original COSMAC VIP interpreter by the author of the Cadmium emulator, which the Timendus suite is checked against. Section 2.1 lists the state with types, 2.6 has the font bytes and 6 the reset sequence. The orange "COSMAC VIP" boxes describe the real hardware and you can skip them.

### Build

1. In `src/chip8_core.c`, write `typedef struct Chip8` with the state from the first figure. Store the display as `uint8_t display[32][64]`, one byte per pixel. Add a `bool failed`, and two `uint16_t` fields for the failing opcode and its address.
2. Write `void chip8_reset(Chip8 *c)`. It zeroes everything, copies the 80 font bytes to `0x050` and sets PC to `0x200`.
3. Write `bool chip8_load(Chip8 *c, const uint8_t *rom, ptrdiff_t len)`. It copies the ROM to `0x200` and returns false for a ROM longer than 3584 bytes.
4. Write `void chip8_step(Chip8 *c)` with the fetch, the field extraction above and a `switch` that handles 00E0, 1NNN, 6XNN, 7XNN and ANNN. 7XNN wraps at 8 bits and leaves VF alone. Every other opcode, 0NNN included, sets `failed` and records the opcode and its address. `chip8_step` does nothing once `failed` is set.
5. Write `tests/chip8_test.c` in chapter 02's test pattern, with its `check` function. Put the six bytes above in a `static const uint8_t` array, load it with `chip8_load` and call `chip8_step` seven times. Check that V0 is 8, PC is 0x202 and `failed` is false. Check that `chip8_load` rejects 3585 bytes. Run it with `sh tests/run_test.sh chip8`.
6. In `src/chip8.c`, write the runner. `chip8 ROM CYCLES` reads the file with the code above, converts CYCLES with `atoi` as in chapter 04, and runs up to CYCLES steps, stopping early when `failed` is set. Then it prints one line with PC, I and V0 to VF, followed by the failing opcode and its address, if any.
7. Build it with `sh build.sh chip8` and run `1-chip8-logo.ch8` from the test suite's `bin` directory for 39 cycles.

### Done when

The unit tests pass with no sanitizer report. The runner stops on the splash screen ROM with the opcode D01F at 0x208, its first draw instruction. `./out/Linux-debug/chip8 nosuchfile 10` prints the "cannot open" message and exits with status 1.

## Drawing sprites

The runner stops at the first draw instruction, DXYN, so nothing shows yet. This step writes DXYN and prints the display. A **sprite** is a small picture stored in memory, one byte per row and one bit per pixel. Bit 7, the 0x80 bit, is the leftmost pixel of a row.

DXYN reads N rows starting at address I and draws them with the top left corner at (VX, VY). It draws with XOR, the exclusive or of chapter 03's Xor gate: a 1 bit flips its pixel and a 0 bit leaves it alone. If any pixel goes from on to off, VF becomes 1, which is how games detect collisions. Otherwise VF becomes 0.

The start position wraps around the screen, so VX = 124 starts at column 124 & 63 = 60. The sprite itself does not wrap. Pixels past column 63 or row 31 are cut off, which is called **clipping**.

![D013 reads three rows at I and draws them at column 60, row 2: columns 60 to 63 are drawn and the four columns past the right edge are cut off.](figures/06-dxyn.svg)

DXYN has four rules: wrap the start, XOR each 1 bit, clip at the edges, and set VF. Write them in that order and test each with the splash screen and the IBM logo, which are the first two ROMs of the test suite. The README of each test shows the screen it should draw.

### Study

- [Tobias V. I. Langhoff: Guide to making a CHIP-8 emulator](https://tobiasvl.github.io/blog/write-a-chip-8-emulator/#dxyn-display) (read, 10 min): The section "DXYN: Display" only.
- [Timendus: CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite#chip-8-splash-screen) (do, 20 min): Read "CHIP-8 splash screen" and "IBM logo" and open the "Run this ROM in Octo" link of each to see the expected screen. Octo is a CHIP-8 development environment that runs in the browser. You come back to the other sections of this README as each test comes up.

### Build

1. Add DXYN to `chip8_step`. Start at column `VX & 63` and row `VY & 31`. For each of the N rows, read the byte at I plus the row number, and XOR each 1 bit into its pixel. Skip pixels past column 63 or row 31. Set VF to 1 if any pixel went from on to off, and to 0 otherwise.
2. Make the runner print the display before its last line: 32 lines of 64 characters, `#` for on and `.` for off.
3. Run `1-chip8-logo.ch8` for 39 cycles and `2-ibm-logo.ch8` for 20, as the README says. Then run each for 1000 cycles.

### Done when

The splash screen and the IBM logo print in `#` characters from `./out/Linux-debug/chip8` and match the README pictures, with no sanitizer report. At 1000 cycles both pictures are unchanged and there is no error, because each ROM ends in a jump to itself. Running `3-corax+.ch8` stops with an error that names an opcode you have not written yet and its address.

## The rest of the instruction set and the flag register

Two test ROMs pass, and the third stops at the first instruction you have not written. This step writes the remaining instructions and unit tests for the tricky ones. They fall into six groups:

- Flow control: call and return (2NNN, 00EE), the four conditional skips (3XNN, 4XNN, 5XY0, 9XY0) and the jump BNNN.
- Arithmetic and logic: the 8XYN group. The last nibble picks the operation, and most of them write a flag to VF.
- Memory: store and load of registers (FX55, FX65), add to I (FX1E), the font address (FX29) and FX33. FX33 writes **binary-coded decimal**: the three decimal digits of VX, one per byte.
- Random: CXNN.
- Timers: FX07, FX15 and FX18.
- Keys: EX9E, EXA1 and FX0A.

The key and timer groups need the outside world. Give the struct a `bool keys[16]` array now. EX9E and EXA1 read it, and the unit tests set it by hand until the window fills it in step 6. The timer instructions only read and write DT and ST for now, and nothing counts them down yet. FX0A waits for a key, so it waits for step 6 too and records an error until then.

A call, 2NNN, pushes PC onto the stack. PC already points at the instruction after the call, so that is the return address. Then the call adds 1 to SP and jumps to NNN. A return, 00EE, subtracts 1 from SP and jumps to the address it finds there. The stack holds 16 addresses, so record an error for a 2NNN with a full stack and for a 00EE with an empty one.

![2400 at 0x20A pushes the return address 0x20C, sets SP to 1 and jumps to 0x400. 00EE sets SP back to 0 and jumps to 0x20C.](figures/06-stack.svg)

CHIP-8 interpreters written after 1977, such as CHIP-48 and SUPER-CHIP for HP48 calculators, changed a few instructions, and many games from the 1990s on expect the changed versions. Langhoff marks those sections "Ambiguous instruction!". This book emulates the original COSMAC VIP interpreter. Where Langhoff leaves the choice open or recommends the later behavior, follow this table, taken from section 4 of Schümann's reference:

| Instruction | Original COSMAC VIP, this chapter | CHIP-48 and SUPER-CHIP |
| --- | --- | --- |
| 8XY1, 8XY2, 8XY3 | VF is set to 0 afterwards | VF unchanged |
| 8XY6, 8XYE | VX = VY shifted by one bit, VF = the bit shifted out | VX shifted in place, VY ignored |
| BNNN | jump to NNN + V0 | jump to XNN + VX |
| FX55, FX65 | I ends at I + X + 1 | I unchanged |

Langhoff also writes that the test ROMs expect the later FX55 and FX65. The corax+ and flags ROMs pass with either version, so they cannot tell you which one you built. Step 7 runs the quirks test, which can.

VF is both a general register and the flag. When an instruction such as 8F14 uses VF as an operand, the value that must stay in VF is the flag. If you write the flag first, the add reads the flag in place of the operand. The flags test checks this case for every 8XYN instruction.

![8F14 with VF = 0x80 and V1 = 0x80: the result and the carry go into locals first, VX gets the low byte, and VF gets the carry last, so it ends as 1.](figures/06-vf-order.svg)

> **Practice:** Compute an instruction's result and its flag into local variables first. Then write VX, and write VF last.

CXNN needs random bytes. A **pseudo-random number generator** computes a sequence of numbers that look random from a starting value, the seed. Keep its state in the struct, so a test run gives the same numbers every time. Marsaglia's xorshift32 takes four lines. Each line XORs the state with a shifted copy of itself:

```c
uint32_t r = c->rng;   // any nonzero seed, set in chip8_reset
r ^= r << 13;
r ^= r >> 17;
r ^= r << 5;
c->rng = r;
uint8_t byte = (uint8_t)(r >> 24);
```

### Study

- [Tobias V. I. Langhoff: Guide to making a CHIP-8 emulator](https://tobiasvl.github.io/blog/write-a-chip-8-emulator/#00ee-and-2nnn-subroutines) (read, 45 min): From "00EE and 2NNN: Subroutines" to the end of "FX55 and FX65: Store and load memory", including EX9E and FX0A. Read the warnings marked "Ambiguous instruction", then use the table above to decide. Ignore the suggestion in FX1E to set VF when I passes 0xFFF. The original interpreter leaves VF alone there, and the flags test checks only the value of I.
- [Steffen Schümann: Classic CHIP-8 Technical Reference](https://chip8kb.gulrak.net/reference/variants/classic-chip-8/#4-original-chip8-opcode-set) (reference, as needed): The table in section 4, "Original CHIP-8 Opcode Set", and the NOTE under "Specific Notes on Opcodes" about VF being written last. Check each instruction against the table as you write it.

### Build

1. Add every instruction except FX0A to `chip8_step`, with the behavior from the table above.
2. Add to `tests/chip8_test.c`. A helper `exec(Chip8 *c, uint16_t op)` writes the opcode at PC and calls `chip8_step`. Test at least these cases:
   - `7001` with V0 = 0xFF gives V0 = 0x00 and leaves VF alone.
   - `8014` with V0 = 0xFF, V1 = 0x01 gives V0 = 0x00, VF = 1.
   - `8F14` with VF = 0x80, V1 = 0x80 gives VF = 1.
   - `8015` with V0 = V1 = 5 gives V0 = 0, VF = 1. `8017` with V0 = 6, V1 = 5 gives V0 = 0xFF, VF = 0.
   - `8016` with V1 = 0x05 gives V0 = 0x02, VF = 1, whatever V0 held. `801E` with V1 = 0x81 gives V0 = 0x02, VF = 1.
   - `8011` with VF = 7 leaves VF = 0.
   - `F033` with V0 = 156 and I = 0x300 writes 1, 5, 6 to 0x300, 0x301 and 0x302.
   - `F255` with I = 0x300 writes V0 to V2 and leaves I = 0x303.
   - `F029` with V0 = 0x1A sets I to the address of the glyph for A.
   - `B300` with V0 = 4 sets PC to 0x304.
   - 17 nested calls set the error. A return with an empty stack sets the error.
   - `D015` with I set to the glyph for 0 first (`F029` with V0 = 0): drawing it twice at the same place sets VF = 0, then VF = 1, and leaves the display blank. Drawn at (62, 30) it lights only pixels left of x = 64 and above y = 32. Drawn with V0 = 66 and V1 = 35 it appears at (2, 3).
   - `E09E` skips when `keys[V0 & 0xF]` is true. `E0A1` skips when it is false.
3. Run `3-corax+.ch8` and `4-flags.ch8` for 2000 cycles and compare them with the README pictures. A check mark means that instruction passed. A cross means it failed.
4. Plant a bug: in 8XY4, write VF before you compute the sum. Run the flags test and find which marks changed. Then remove the bug.

### Done when

The unit tests pass with no ASan, UBSan or LeakSanitizer report. Corax+ shows only check marks, and so does the flags test. With the planted bug, the entries for 8XY4 in the HAPPY and CARRY rows lose their third and fourth check marks, the ones for VF used as an operand. You can say why the first two marks stayed.

## SDL3 under WSLg

The runner prints the display as text after the program has run. A game needs a window that shows the pixels while the program runs. This step installs the library that opens the window and checks that windows and sound reach Windows. The next step puts the emulator in a window.

**SDL** is a C library that gives a program a window, pixels, the keyboard and sound, with the same code on Linux, Windows and macOS. This book uses version 3, SDL3.

Your Linux programs run inside the WSL2 virtual machine, which has no screen of its own. **WSLg** is the part of WSL that shows their windows on the Windows desktop. It runs a **compositor**, a program that collects the windows of all programs and draws them together. It sends the result to Windows over RDP, the Remote Desktop protocol that also shows the desktop of a remote computer. Sound takes a similar path through a PulseAudio sound server that WSLg runs.

Linux programs talk to a display server in one of two ways, the older X11 protocol and the newer Wayland protocol. WSLg serves both. SDL calls the code it picks for the screen its video driver, and the code it picks for sound its audio driver.

![Your emulator calls SDL3, SDL3 hands pixels to the WSLg compositor and samples to the PulseAudio server, and WSLg sends both over RDP to Windows.](figures/06-wslg.svg)

Microsoft's page [Run Linux GUI apps with WSL](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps) says WSLg needs Windows 11, or Windows 10 build 19044 or later, and gives `wsl --update` to get a current WSL. WSLg sets the environment variables `DISPLAY`, `WAYLAND_DISPLAY` and `PULSE_SERVER` in your shell, so that programs find its servers. Before you build anything, check it. `xeyes`, from the package `x11-apps`, opens a window, and `pactl info`, from `pulseaudio-utils`, asks the sound server for its status.

Ubuntu 24.04 has no SDL3 package, so Build items 2 and 3 build SDL3 from its source code. SDL builds with **CMake**, a tool that reads a project's build description and writes out the compile commands. **Ninja** is the program that then runs those commands.

Your program has to tell clang where SDL's headers and library are. **pkg-config** prints those compiler flags for an installed library, and `$(pkg-config --cflags --libs sdl3)` on a command line pastes them in. The shell replaces `$(...)` with the output of the command inside it.

> **If it fails:** If `xeyes` opens no window, run `wsl --update` and then `wsl --shutdown` in PowerShell, open Ubuntu again and retry. If it still fails, work through Microsoft's checklist [Diagnosing "cannot open display" type issues with WSLg](https://github.com/microsoft/wslg/wiki/Diagnosing-%22cannot-open-display%22-type-issues-with-WSLg). Skip its first section, which is out of date, and start at the `DISPLAY` check.

> **If it fails:** If the CMake summary lacks `x11`, `wayland` or `pulseaudio`, a package from Build item 2 is missing. Install it, delete the `build` directory and run the three `cmake` commands again.

### Study

- [SDL3 examples: renderer/07-streaming-textures](https://examples.libsdl.org/SDL3/renderer/07-streaming-textures/) (do, 20 min): The official example for a texture that a program rewrites every frame. Its source is also in your SDL directory, at `examples/renderer/07-streaming-textures/streaming-textures.c`. Build it with `clang -o streaming streaming-textures.c $(pkg-config --cflags --libs sdl3)`, run it and read its code. You change it in the next step.

### Build

1. Run `sudo apt install -y x11-apps pulseaudio-utils`. Run `xeyes` and close its window, then `pactl info`. Look for its "Server Name" line.
2. Install the packages that SDL needs to build. The list comes from the "Build Dependencies" section of SDL's [README-linux](https://wiki.libsdl.org/SDL3/README-linux#build-dependencies), the Ubuntu list plus the four packages it adds for Ubuntu 22.04 and later. It is long because SDL supports many back ends, and its build skips any back end whose packages are missing. Without `libpulse-dev`, for example, your emulator stays silent.

   ```sh
   sudo apt install -y build-essential git make pkg-config cmake ninja-build gnome-desktop-testing libasound2-dev libpulse-dev libaudio-dev libfribidi-dev libjack-dev libsndio-dev libx11-dev libxext-dev libxrandr-dev libxcursor-dev libxfixes-dev libxi-dev libxss-dev libxtst-dev libxkbcommon-dev libdrm-dev libgbm-dev libgl1-mesa-dev libgles2-mesa-dev libegl1-mesa-dev libdbus-1-dev libibus-1.0-dev libudev-dev libthai-dev libusb-1.0-0-dev libpipewire-0.3-dev libwayland-dev libdecor-0-dev liburing-dev
   ```

3. Download, build and install SDL3, following SDL's [README-cmake](https://wiki.libsdl.org/SDL3/README-cmake#building-sdl-on-unix). Keep the source outside your project:

   ```sh
   mkdir -p ~/src && cd ~/src
   curl -LO https://github.com/libsdl-org/SDL/releases/download/release-3.4.20/SDL3-3.4.20.tar.gz
   tar xzf SDL3-3.4.20.tar.gz && cd SDL3-3.4.20
   cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DSDL_TESTS=OFF
   cmake --build build
   sudo cmake --install build --prefix /usr/local
   ```

   - `curl -LO` downloads the release, 3.4.20 at the time of writing. `-O` saves it under its own file name.
   - `tar xzf` unpacks the archive: `x` extracts, `z` undoes the gzip compression and `f` names the file.
   - `cmake -S . -B build` reads the source in the current directory and writes the build files into `build`. `-G Ninja` writes them for Ninja, `-DCMAKE_BUILD_TYPE=Release` asks for an optimized library, and `-DSDL_TESTS=OFF` skips SDL's own test programs.
   - `cmake --build build` runs Ninja, which compiles SDL in a few minutes.
   - `cmake --install` copies the headers and the library under `/usr/local`, the place for software you built yourself.

   The first `cmake` prints a summary near its end. Its "Video drivers" line must include `x11` and `wayland`, and its "Audio drivers" line must include `pulseaudio`.
4. Build and run the streaming textures example as the study item says.

### Done when

`xeyes` shows its window on the Windows desktop and `pactl info` prints a "Server Name" line. `pkg-config --modversion sdl3` prints `3.4.20`. The streaming example opens a window on the Windows desktop in which a green bar moves up and down.

## The emulator in a window

SDL works under WSLg, and the CHIP-8 core runs headless. This step joins them: a front end that runs the core and shows its display in a window while it runs. The clock and the keys come in the next step.

SDL draws through a **renderer**, the part of SDL that draws into a window, usually with the graphics card. The renderer draws **textures**, images it keeps in a form it can scale and draw fast. You make one texture of 64 by 32 pixels and stretch it over a 640 by 320 window. SDL reports each key press, key release and click on the window's close button as an **event**, a small struct in a queue.

The SDL examples hide the main loop behind callback functions that SDL calls. Write a plain `main` and move their pieces into it, so you can see the whole loop:

```c
int main(int argc, char **argv) {
    // read the ROM, SDL_Init, window, renderer, texture    <- SDL_AppInit in the example
    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            // quit, and in step 6 key down and key up      <- SDL_AppEvent
        }
        // run instructions, upload pixels, present         <- SDL_AppIterate
    }
    SDL_Quit();
    return 0;
}
```

![One pass of the front end: read the events, run 15 instructions, copy the pixels into the texture and show the picture, which waits for vsync, then start the next pass.](figures/06-hostloop.svg)

These calls set up the texture and show it on every pass:

- `SDL_PIXELFORMAT_XRGB8888` stores each pixel as one `uint32_t`, `0x00RRGGBB`.
- `SDL_TEXTUREACCESS_STREAMING` says you rewrite the texture on every pass.
- `SDL_SCALEMODE_NEAREST`, set with `SDL_SetTextureScaleMode`, keeps the stretched pixels sharp. SDL blurs them otherwise.
- `SDL_SetRenderVSync(renderer, 1)` asks for **vsync**: `SDL_RenderPresent` waits until the display is ready for the next picture, so the loop does not spin.
- Fill a `uint32_t pixels[32][64]` with `0xFFFFFF` or `0x000000` and pass it to `SDL_UpdateTexture` with a pitch, the bytes per row, of `64 * 4`.
- `SDL_RenderTexture(renderer, texture, NULL, NULL)` stretches the texture over the whole window, and `SDL_RenderPresent` shows the result.

If `SDL_SetRenderVSync` fails, nothing in the loop waits and it keeps one CPU core busy. In that case call `SDL_Delay(1)` at the end of each pass, which sleeps for one millisecond.

The debug build of the front end ends with a LeakSanitizer report even when your code frees everything and calls `SDL_Quit`. System libraries that SDL loads keep some memory until the process exits. A **suppression file** lists leaks that LeakSanitizer should not report. Write the line `leak:libdbus-1.so`, for the library SDL uses to talk to desktop services, into `lsan.supp`, and run the front end with `LSAN_OPTIONS=suppressions=lsan.supp` in front of the command.

> **Practice:** Suppress a leak only when no frame of its stack is in your `src/` files. Never suppress a leak whose stack runs through your own code.

> **If it fails:** If the window opens but flickers or stays blank, start the front end with `SDL_VIDEO_DRIVER=x11` in front of the command, or with `SDL_VIDEO_DRIVER=wayland`. WSLg serves both, and SDL picks one by itself.

### Study

- [SDL3 wiki: API by name](https://wiki.libsdl.org/SDL3/CategoryAPI) (reference, as needed): One page per function and struct. Look up `SDL_Init`, `SDL_CreateWindowAndRenderer`, `SDL_CreateTexture`, `SDL_SetTextureScaleMode`, `SDL_UpdateTexture`, `SDL_RenderTexture`, `SDL_PollEvent`, `SDL_SetRenderVSync` and `SDL_Delay`. Every page has the signature and the return value. Most functions return `false` on failure, and `SDL_GetError()` says why.

### Build

1. Change the streaming textures example from step 4 to fill a 64 by 32 texture from an array with `SDL_UpdateTexture`, in place of `SDL_LockTextureToSurface`. The surface functions it uses are not needed.
2. Add `$LIBS` at the end of the compiler line in `build.sh`. The core, the runner and the tests do not need SDL, so `LIBS` stays empty for them.
3. Write `src/chip8_sdl.c`. Its command line is `chip8_sdl ROM`, and it reads the ROM with the code from step 1. It opens a 640 by 320 window with the streaming texture and quits on `SDL_EVENT_QUIT`. After `SDL_Init`, print `SDL_GetCurrentVideoDriver()`.
4. Turn vsync on. If `SDL_SetRenderVSync` returns false, print `SDL_GetError()` and call `SDL_Delay(1)` at the end of each pass.
5. Each pass runs 15 instructions with `chip8_step`. The next step replaces that with a clock.
6. Build it with `LIBS="$(pkg-config --cflags --libs sdl3)" sh build.sh chip8_sdl` and run it on `2-ibm-logo.ch8`. Close the window and print the exit status with `echo $?`.
7. Write `lsan.supp` as above and run it again with `LSAN_OPTIONS=suppressions=lsan.supp`.

### Done when

The IBM logo shows in the window as sharp white blocks, and the driver line names `x11` or `wayland`. Without the suppression file the front end exits with status 1 after a leak report whose stack lies in system libraries such as `libdbus-1.so`. With `LSAN_OPTIONS=suppressions=lsan.supp` it prints a "Suppressions used" table and exits with status 0, and no line in `lsan.supp` matches your own code.

## A 60 Hz clock, the timers and the keypad

The window runs instructions as fast as its loop goes, and nothing counts the timers down. A real CHIP-8 runs against a clock that ticks 60 times a second, 60 **Hz** (hertz, times per second). This step gives the emulator that clock, then the keys.

The COSMAC VIP redrew its screen 60 times a second and counted the timers down at the same moment, inside an interrupt. An **interrupt** is a hardware signal that makes the CPU stop the running program, run a short handler routine, then resume the program where it stopped. Your emulator has no interrupts. It does the same work from its main loop once per **frame**, 1/60 of a second.

Each frame decrements DT and ST if they are above zero, then runs a fixed number of **instructions per frame**, IPF. The timers go first, so that a delay of 1 still lasts one frame. Section 2.4 of Schümann's reference explains why, and section 5 lists the whole loop. Use IPF = 15. Langhoff's 700 instructions per second is about 12 per frame.

![Two CHIP-8 frames on a time line: each frame first counts DT and ST down by one, then runs 15 instructions, and the rest of the frame is left for drawing and waiting.](figures/06-frame.svg)

```c
void chip8_frame(Chip8 *c, int ipf) {
    if (c->dt > 0) c->dt--;
    if (c->st > 0) c->st--;
    for (int i = 0; i < ipf && !c->failed; i++) {
        chip8_step(c);
    }
}
```

The host loop cannot assume that it passes once per CHIP-8 frame. Your laptop's panel may refresh at 60, 120 or 144 Hz, and under WSLg every picture also goes through the compositor and RDP. So the loop measures the real time since its last pass and runs as many 1/60 s frames as fit into it, keeping the rest for the next pass. Glenn Fiedler calls the variable that keeps the rest an **accumulator**.

![The host loop passes at 25, 31 and 62 ms. Each pass adds the elapsed time, counted in frames, to the accumulator, runs one frame per whole frame in it and keeps the rest.](figures/06-accumulator.svg)

Fiedler keeps seconds in a `double`. You can keep nanoseconds in a `uint64_t` and stay exact by multiplying by 60 instead of dividing:

```c
uint64_t now = SDL_GetTicksNS();   // nanoseconds since SDL_Init
acc += (now - last) * 60;          // 1 ns counts as 60 units, so one frame, 1/60 s, is 1e9 units
last = now;
if (acc > 4000000000ull) acc = 4000000000ull;   // at most 4 frames behind
while (acc >= 1000000000ull) {
    chip8_frame(&c, ipf);
    acc -= 1000000000ull;
}
```

The cap matters after a pause in gdb or with the laptop asleep. Without it, the emulator would run minutes of frames at once.

A **scancode** is the number of a key's physical position on the keyboard, whatever letter is printed on it. Map keys by scancode, so the layout works on any keyboard. The usual mapping puts the 4 by 4 keypad of the COSMAC VIP on the left side of the keyboard. On `SDL_EVENT_KEY_DOWN` and `SDL_EVENT_KEY_UP`, look up `e.key.scancode` in a 16-entry table and set `keys[k] = e.key.down`.

![Each CHIP-8 key sits on the keyboard key at the same position, so pressing W sends SDL_SCANCODE_W and the key table sets keys[5].](figures/06-keypad.svg)

FX0A completes the instruction set. It waits in two phases. While no key is held, the machine stays on the instruction. When a key goes down, the machine remembers which one and keeps waiting. When that key comes back up, its number goes into VX and execution continues.

![FX0A waits for a press, then for the release of the same key k, and only then sets VX to k. PC stays put and the timers keep counting in both waiting states.](figures/06-fx0a.svg)

Keep `wait_reg` and `wait_key` in the struct, with -1 for "not waiting". While `wait_reg` is set, `chip8_step` checks the keys and returns without fetching. The frames keep coming, so the timers keep counting while the program waits. The keypad test checks that.

### Study

- [Glenn Fiedler: Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) (read, 20 min): From "Fixed delta time" through "Free the physics". Read "integrate" as "run one CHIP-8 frame". Skip "The final touch", which smooths physics between steps and has no CHIP-8 counterpart.
- [SDL3 wiki: API by name](https://wiki.libsdl.org/SDL3/CategoryAPI) (reference, as needed): Look up `SDL_GetTicksNS`, `SDL_KeyboardEvent` and `SDL_Scancode`. The scancode page names each key, such as `SDL_SCANCODE_W`.

### Build

1. Add `chip8_frame` to the core. Change the runner to `chip8 ROM FRAMES [menu=N]`. It runs FRAMES frames at IPF 15. With `menu=N` it writes the byte N to address `0x1FF` after loading. The Timendus menus read that address and skip the menu, as their README sections explain.
2. Give optional arguments the form `name=value`, so their order does not matter. `strncmp(arg, "menu=", 5)` from `<string.h>` compares the first 5 characters and returns 0 when they match, and `atoi(arg + 5)` converts the rest. Print an error and exit with status 2 for an argument you do not know.
3. In the front end, replace the 15 instructions per pass with the accumulator. The command line becomes `chip8_sdl ROM [ipf=N] [menu=N]`, with IPF 15 when `ipf=` is missing.
4. Add the key table and fill `keys` from the key events.
5. Add FX0A to the core and unit tests for it. With `keys[5]` held, a step leaves the machine waiting and V3 unchanged. After `keys[5]` goes false, the next step sets V3 = 5 and the machine runs on.
6. Once per second of real time, print two numbers: the CHIP-8 frames that ran in that second and the passes through the host loop.
7. Run the IBM logo with `ipf=15` and with `ipf=1000`. Then change the 1 in `SDL_SetRenderVSync` to 0, rebuild and run it again. Put the 1 back afterwards.
8. Read the "Keypad test" section of the Timendus README and run `6-keypad.ch8` in the window. Try all three modes.

### Done when

The frame counter prints 60 each second with IPF 15 and with IPF 1000, and still 60 with vsync off. The first second can come out short while the window opens. The pass count shows what vsync does under WSLg on your machine. A pass count near your panel's refresh rate means `SDL_RenderPresent` waited, and hundreds or thousands mean it did not, so the loop keeps one core busy. You can say why the frame count stays at 60 either way.

In the keypad test, mode 1 lights the keys you hold, mode 2 lights the keys you do not hold, and mode 3 shows a check mark and "all good". In mode 3 the program does not move on while you keep the key held.

## Quirks, display wait and the beep

One behavior of the original interpreter, display wait, is still missing, and the speaker is silent. This step adds both, plus switches for games that expect a later interpreter.

CHIP-8 interpreters disagree on six behaviors, called **quirks**. You chose the original behavior for four of them in step 3. The other two concern DXYN. The original interpreter waited for the next display interrupt before it drew a sprite, so a program could draw at most one sprite per frame. This quirk is called display wait.

The second is clipping, which you built in step 2. Many games written for later interpreters expect those pixels to wrap around to the other side.

The Timendus quirks test checks all six, and it needs the timers of step 6. To emulate display wait, `chip8_frame` stops running instructions for the rest of the frame after a DXYN. With display wait on, Schümann recommends 15 instructions per frame. With fewer, the test cannot measure reliably and shows SLOW.

Make the quirks a struct in the machine:

```c
typedef struct {
    bool vf_reset;      // 8XY1, 8XY2, 8XY3 set VF to 0
    bool memory;        // FX55, FX65 leave I at I + X + 1
    bool display_wait;  // DXYN ends the frame
    bool clipping;      // sprites clip at the edges, otherwise every pixel wraps
    bool shift_vx;      // 8XY6, 8XYE shift VX in place and ignore VY
    bool jump_vx;       // BNNN jumps to XNN + VX
} Quirks;
```

The "vip" preset sets the first four to true and the last two to false, which is the behavior you already built. The "octo" preset holds the defaults of Octo, the browser environment from step 2, in which most modern games were written. It sets `memory` to true and the other five to false, because Octo's `loadStoreQuirks` is false by default and false there means that I is incremented. The games of step 8 need this preset.

The sound timer drives a buzzer that beeps while ST is above zero. Sound is a stream of **samples**, numbers that give the position of the speaker at evenly spaced moments. The **sample rate** says how many samples play per second. A **square wave** is enough for a buzzer: a constant value that flips its sign every few samples. At 8000 samples per second, flipping every 4 samples gives a 1000 Hz tone.

SDL3 plays sound through an **audio stream**, a queue that you push samples into and that SDL plays from at the sample rate. The SDL example keeps half a second of audio queued, which would make every beep start and stop half a second late. Under WSLg each stage on the way to Windows keeps a buffer of its own, and you cannot shorten those. So keep your own queue short, about three frames of samples. After each CHIP-8 frame, if less than that is queued, push one more frame of square wave if ST is above zero and of zeros if it is not.

![After each CHIP-8 frame the loop pushes 134 samples into an audio stream that holds about three frames, and SDL plays the stream at 8000 samples a second.](figures/06-audio.svg)

One frame of samples, 134, is not a whole number of wave periods of 8 samples. Keep a sample counter in the front end and continue the wave from it on the next frame. A wave that starts over every frame clicks 60 times a second.

> **If it fails:** `SDL_GetCurrentAudioDriver()` should return `pulseaudio`. If it returns `alsa`, SDL could not reach WSLg's sound server. Run `echo $PULSE_SERVER` and `pactl info` from step 4 to see why.

### Study

- [Steffen Schümann: Classic CHIP-8 Technical Reference](https://chip8kb.gulrak.net/reference/variants/classic-chip-8/#7-chip-8-quirks) (read, 15 min): Section 7, "CHIP-8 Quirks", and the paragraph on display wait at the end of "Specific Notes on Opcodes". The "COSMAC VIP" box after that paragraph explains why a draw can take two frames on the real machine. You do not need to emulate that.
- [SDL3 examples: audio/01-simple-playback](https://examples.libsdl.org/SDL3/audio/01-simple-playback/) (do, 20 min): Its source is in your SDL directory at `examples/audio/01-simple-playback/simple-playback.c`. Build and run it like the texture example, and check that you hear the tone through Windows. It opens a stream with `SDL_OpenAudioDeviceStream`, starts it with `SDL_ResumeAudioStreamDevice`, and feeds a sine wave with `SDL_PutAudioStreamData` whenever `SDL_GetAudioStreamQueued` is low. Change the sine to a square wave and the queue limit to three frames before you move the code into your front end.

### Build

1. Add `Quirks quirks` to `Chip8`, use each flag at its instruction, and set the "vip" preset in `chip8_reset`. When `clipping` is off, DXYN wraps every pixel with `& 63` and `& 31` instead of cutting it off.
2. Make `chip8_frame` stop after a DXYN when `display_wait` is on.
3. Give the runner and the front end the optional word `octo`, which switches to the octo preset, and `vip`, which keeps the default. The full command lines are now `chip8 ROM FRAMES [octo] [menu=N] [trace]` and `chip8_sdl ROM [ipf=N] [octo] [menu=N] [break=ADDRESS]`. The `trace` and `break=` arguments come in step 8.
4. Read the "Quirks test" section of the Timendus README. Run `5-quirks.ch8` with `menu=1` in the runner for 300 frames, then in the window.
5. Flip one quirk flag in the vip preset in `chip8_reset`, rebuild, and run the quirks test in the runner again. Put the flag back and do the same for the next one, until you have flipped all six.
6. Run the quirks test in the window with `chip8_sdl 5-quirks.ch8 ipf=5 menu=1`.
7. Add `SDL_INIT_AUDIO` to the flags of `SDL_Init` and the audio stream to the front end, with the sample counter. Print `SDL_GetCurrentAudioDriver()` next to the video driver.
8. `SDL_GetAudioStreamQueued` returns a count of bytes. With 32-bit float samples as in the example, one frame is 134 times 4 bytes, so push a frame while fewer than about 1600 bytes are queued.
9. Read the "Beep test" section and run `7-beep.ch8`. Keypad B is the C key on your keyboard.

### Done when

The quirks test shows six check marks with the vip preset, the same screen as the README picture. Each flipped flag, one at a time, changes its own row to a cross and leaves the other five rows alone. With `ipf=5` the display wait row shows SLOW.

The audio driver is `pulseaudio`. The beep test plays SOS, three short beeps, three long and three short, with the same rhythm as the flashing speaker icon and no clicking. Under WSLg the sound can trail the icon by a fraction of a second. Holding C beeps for as long as you hold it, give or take that delay. You can say why the timers are decremented before the instructions of a frame and not after.

## A debugger, regression tests and real games

The test ROMs tell you that something is wrong, and roughly which instruction. A game that misbehaves tells you less. You need to see the CHIP-8 machine at the moment it goes wrong: PC, the opcode, V0 to VF, I, the stack pointer and the timers, one instruction at a time. gdb from chapter 01 shows the variables of your C program, where the CHIP-8 registers are only bytes in a struct. Three tools cover most bugs:

- A **trace**: the runner prints one line per instruction with the address, the opcode and the registers. It goes to `stderr`, so `stdout` keeps the display. A fixed format lets `grep` and `diff` work with it.
- Pause, single step and a breakpoint in the window. While paused, one key runs one instruction and prints the state. A breakpoint address on the command line pauses the machine when PC reaches it.
- Regression tests. A **golden file** is saved output that you checked by eye once. A **regression test** reruns the program and compares its output with the golden file, so a change that breaks something old fails even when you were not looking at it. Your round-trip script for the 8086 decoder in chapter 05 worked the same way.

![run_roms.sh runs each test ROM in the headless runner, compares the printed display with its golden file, and exits with 1 if any output changed.](figures/06-regression.svg)

> **Practice:** Save a golden file only after you have checked that output by eye against its reference.

Then play games. The CHIP-8 Archive collects programs released under CC0, a dedication to the public domain, so anyone may use them. Most were written in Octo for Octo's defaults. Its `programs.json` gives each program a `tickrate`, the instructions per frame Octo runs it at. The four games of this step all run on the octo preset, and only their tickrates differ.

> **Optional:** To run other games from the archive, read the `options` object of their entry in `programs.json`. It holds Octo's quirk flags, and a missing flag is false: `logicQuirks` is your `vf_reset`, `vBlankQuirks` is `display_wait`, `clipQuirks` is `clipping`, `shiftQuirks` is `shift_vx` and `jumpQuirks` is `jump_vx`. `loadStoreQuirks` is the opposite of your `memory`. Some entries also carry `vfOrderQuirks`, and its default, false, writes VF last as you did in step 3. The front end only takes the two presets, so a game with other flags needs a third preset.

### Study

- [Tobias V. I. Langhoff: Guide to making a CHIP-8 emulator](https://tobiasvl.github.io/blog/write-a-chip-8-emulator/#troubleshooting) (read, 10 min): "Troubleshooting" and "Add debug capabilities". Skip the rest of "What next". The SUPER-CHIP and XO-CHIP extensions are outside this chapter.
- [John Earnest: CHIP-8 Archive](https://github.com/JohnEarnest/chip8Archive) (do, 1 h): Clone it next to the test suite and add it to `.gitignore`. ROMs are in `roms/`, and the README's "Schema" section describes `programs.json`. Play only entries whose `platform` is `chip8`. Start with `br8kout` (tickrate 7), `outlaw` (15), `down8` (15) and `caveexplorer` (20) on the octo preset. Two of them store the tickrate as a string, `"15"` and `"20"`.

### Build

1. Add the trace to the runner as the optional word `trace`. One line per instruction, for example `0x2A4 8F14 V0=00 V1=80 ... VF=80 I=0x300 SP=1 DT=00 ST=00`.
2. In the front end, Space pauses and resumes, and N runs one instruction while paused and prints the same line.
3. Add the `break=` argument, a hex address such as `break=0x2A4`. `strtoul(arg + 6, NULL, 16)` from `<stdlib.h>` reads the hex number after `break=` and accepts the `0x` in front of it. When PC reaches that address, the front end pauses.
4. Plant the 8XY4 bug from step 3 again. In the trace of `4-flags.ch8`, find the first 8XY4 whose X or Y is F. Set a breakpoint at its address in the window, step over it, and compare VF and VX with what the instruction should produce. Remove the bug.
5. Write `tests/run_roms.sh`. It builds the runner with `sh build.sh chip8`, runs ROMs 1 to 5 headless for 300 frames each, with `menu=1` for the quirks test, and compares each output with `tests/golden/<rom>.txt` using `diff`. It exits with 1 on any difference.
6. Create the golden files once, after you have checked each screen against its README picture.
7. Play the four games with the octo preset and the game's tickrate, for example `chip8_sdl roms/br8kout.ch8 ipf=7 octo`.

### Done when

`sh tests/run_roms.sh; echo $?` prints 0. With the planted bug, it fails on `4-flags` and `5-quirks` and passes the other three. The quirks test uses the same instruction and shows ERR2 in its clipping row. Stepping over the buggy instruction shows VF overwritten before the add reads it.

You can stop at a breakpoint and step through a subroutine call and its return. Each of the four games reaches its playfield. Keys 7 and 9 slide the paddle in `br8kout`, keys 5, 7, 8 and 9 move the gunman in `outlaw`, and key 5 makes the player fall in `down8`, as their `howto` fields in `programs.json` say. The caveexplorer source header names Octo's keyboard letters: A and D move in platformer levels, and A, S, W and D on the overworld.

On your keypad figure A is key 7, D is key 9, S is key 8 and W is key 5, and those keys move the player in `caveexplorer`.

## Where this leads

You have built a computer in software and checked it against a reference. That finishes part one.

You have not measured how fast any of this runs. The emulator does 15 instructions per frame and the host could do millions, so speed never came up. Real programs are slow for reasons you cannot see by reading the code, so chapter 07, Memory hierarchy, measurement and SIMD, starts with measurement.

Chapter 07 returns to Casey Muratori's Performance-Aware Programming course, whose Part 1 gave you the 8086 decoder. Casey works on x86-64, the instruction set of your laptop, so the instructions he writes and reads run on your CPU in WSL2. His Windows calls need Linux replacements. His assembly files take their arguments in the Windows registers, which you change to the System V ones from chapter 05.

The chapter's first step times one array sum in Python and in C with a monotonic clock. Casey names five causes for the gap, and chapter 07 covers four of them, leaving threads for chapter 09. Then it writes a generator for a JSON file of point pairs and a haversine distance processor that parses that file with your chapter 04 JSON parser. The rest of the chapter profiles that processor and speeds it up. It uses timers built on the `rdtsc` instruction, your own profiler, loops in x86-64 assembly that probe the core and the caches, data layout, and AVX2, the 256-bit vector instructions of your CPU.
