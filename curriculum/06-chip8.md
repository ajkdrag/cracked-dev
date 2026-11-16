---
id: 06
title: A CHIP-8 emulator
part: The machine and C
weeks: 2
project: A CHIP-8 emulator in C with an SDL3 window, keypad, sound and a single-step debugger that passes the Timendus CHIP-8 test ROMs.
---

Chapter 05 ended with an 8086 decoder and simulator. You read machine code byte by byte, pulled out the fields, and ran each instruction against registers and flags kept in a C struct. Chapter 03 built the same fetch, decode and execute cycle out of gates. The Hack computer had a screen and a keyboard, but the simulator drew the screen and read the keys for you. The 8086 simulator had no screen, no keys and no clock. In this chapter you write that part too: the code that turns a pixel buffer into a window, key presses into machine state, and wall-clock time into timer ticks.

The machine is CHIP-8, a small virtual machine from 1977, made for the COSMAC VIP hobby computer. It has 4 KB of memory, sixteen 8-bit registers, 35 instructions, a 64 by 32 pixel display, two timers that count down at 60 Hz, a hex keypad and a buzzer. You write an emulator for it in C, give it a window and sound with SDL3, add a debugger, and test it against the Timendus test ROMs. Those ROMs check every instruction and also the details where CHIP-8 interpreters disagree.

Decoding goes fast after chapter 05, because every CHIP-8 instruction is two bytes. The new work is elsewhere. Timers have to tick at 60 Hz however fast the instructions run, key state has to persist between frames, and you have to decide which of several historical CHIP-8 interpreters you copy. This chapter closes part one. It uses the C from chapters 02 and 04, the machine model from chapter 03 and the decoding from chapter 05 in one program.

## The machine and the first six instructions

Write down the whole machine state before you write any code. All of it fits in one struct:

```
  memory, 4096 bytes
  0x000 +----------------------+
        | free, except the font|
        | at 0x050 to 0x09F    |
  0x200 +----------------------+  <- the ROM is loaded here, PC starts here
        | program and data     |
  0xFFF +----------------------+

  V0 .. VF   sixteen 8-bit registers. VF doubles as the flag register.
  I          16-bit index register. Points into memory.
  PC         program counter
  stack      16 return addresses, plus a stack pointer
  DT, ST     delay timer and sound timer, 8 bits each, count down at 60 Hz
  display    64 x 32 pixels, each on or off
  keys       16 keys, 0 to F, each held or not
```

An instruction is two bytes, high byte first. That is big-endian, the opposite of the 8086 and of your Mac. The top 4 bits pick the instruction class. The other three nibbles are operands, and each instruction uses one of a few fixed splits:

```
  opcode 0xD123
     D    1    2    3
     |    |    |    +--  N    4-bit constant
     |    |    +-------  Y    register index
     |    +------------  X    register index
     +-----------------  class

  NN  = low byte      = 0x23
  NNN = low 12 bits   = 0x123, an address
```

Fetch reads two bytes at PC and adds 2 to PC at once. Then pull out all the fields before the `switch`, so that no case gets the masks wrong on its own:

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

The casts keep gcc quiet under `-Wconversion`. Masking every address with `0xFFF` keeps a broken ROM inside the 4096 bytes, so a bad jump cannot become an out-of-bounds read in your C program.

Langhoff's guide starts the instruction set with six instructions: clear screen, jump, set register, add to register, set I, and draw. The two simplest test ROMs use only those. DXYN is the hard one. It XORs an 8-pixel-wide sprite of N rows, read from memory at I, onto the display at (VX, VY). VF becomes 1 if any lit pixel was turned off, which is how games detect collisions. The start position wraps around the screen and the sprite itself is clipped at the right and bottom edges:

```
  VX = 70, VY = 2, sprite 8 wide
  start x = 70 & 63 = 6       wraps
  VX = 60, VY = 2
  columns 60 61 62 63 are drawn, 64 to 67 are cut off, nothing appears at 0 to 3
```

Keep the machine apart from everything that talks to the outside world. The emulator grows into four files:

```
  src/chip8_core.c     the machine: struct, reset, load, step. No main, no printf, no SDL.
  src/chip8.c          headless runner: #include "chip8_core.c", runs a ROM, prints the display
  src/chip8_sdl.c      the window front end (step 3)
  tests/chip8_test.c   unit tests: #include "../src/chip8_core.c" (step 2)
```

The core has no `main`, so the runner, the front end and the tests can include it directly. You do not need the `#define main` trick from chapter 02 here.

### Study

- [Tobias V. I. Langhoff: Guide to making a CHIP-8 emulator](https://tobiasvl.github.io/blog/write-a-chip-8-emulator/) (read, 50 min): From "Specifications" through "Execute", which includes Timers, Keypad and Timing. Then the start of "Instructions" and the sections 0NNN, 00E0, 1NNN, 6XNN, 7XNN, ANNN and DXYN. The other instruction sections are for the next step. The guide describes behavior and has no implementation code, so the C is yours.
- [Timendus: CHIP-8 test suite](https://github.com/Timendus/chip8-test-suite#chip-8-splash-screen) (do, 20 min): Clone it with git into your project directory and add it to `.gitignore`. Read "CHIP-8 splash screen" and "IBM logo" and open the "Run this ROM in Octo" link of each to see the expected screen. You come back to the other sections of this README as each test comes up. Only `bin/1-*.ch8` to `bin/7-*.ch8` are CHIP-8 tests. The scrolling test is for SUPER-CHIP.
- [Steffen Schümann: Classic CHIP-8 Technical Reference](https://chip8kb.gulrak.net/reference/variants/classic-chip-8/) (reference, as needed): A description of the original COSMAC VIP interpreter by the author of the Cadmium emulator, which the Timendus suite is checked against. Section 2.1 lists the state with types, 2.6 has the font bytes and 6 the reset sequence. The orange "COSMAC VIP" boxes describe the real hardware and you can skip them.

### Build

1. In `src/chip8_core.c`, write `typedef struct Chip8` with the state from the diagram, plus an `error` field that holds the failing opcode and its address. Display as `uint8_t display[32][64]`, one byte per pixel.
2. Write `void chip8_reset(Chip8 *c)`: zero everything, copy the 80 font bytes to `0x050`, set PC to `0x200`. Write `bool chip8_load(Chip8 *c, const uint8_t *rom, ptrdiff_t len)`. It copies the ROM to `0x200` and returns false for a ROM longer than 3584 bytes.
3. Write `void chip8_step(Chip8 *c)` with fetch, the field extraction above and a `switch` that handles 00E0, 1NNN, 6XNN, 7XNN, ANNN and DXYN. 7XNN wraps at 8 bits and leaves VF alone. Every other opcode, including 0NNN, records an error. `chip8_step` does nothing once `error` is set.
4. In `src/chip8.c`, write the runner. `chip8 ROM CYCLES` reads the file with `fread`, as in chapter 04, runs up to CYCLES steps and stops early on an error. Then it prints the display as 32 lines of 64 characters, `#` for on and `.` for off, and a last line with PC and the error, if any.
5. Run `1-chip8-logo.ch8` for 39 cycles and `2-ibm-logo.ch8` for 20, as the README says. Then run each for 1000 cycles.

### Done when

The splash screen and the IBM logo print in `#` characters and match the README pictures, built with `sh build.sh chip8` on the Mac and in Linux with the sanitizers on. At 1000 cycles both pictures are unchanged and there is no error, because each ROM ends in a jump to itself. Running `3-corax+.ch8` stops with an error that names an opcode you have not written yet and its address.

## The rest of the instruction set and the flag register

The remaining instructions fall into five groups. Flow control is call and return (2NNN, 00EE), four conditional skips (3XNN, 4XNN, 5XY0, 9XY0) and BNNN. Arithmetic and logic is the 8XYN group, where the last nibble picks the operation and most of them write a flag to VF. Memory is BCD (FX33), store and load of registers (FX55, FX65), add to I (FX1E) and the font address (FX29). Then come random (CXNN), the timers (FX07, FX15, FX18) and the keys (EX9E, EXA1, FX0A).

Two of those groups need the outside world. Give the struct a `bool keys[16]` array now. EX9E and EXA1 read it, and the unit tests set it by hand. The window fills it in step 3. FX07, FX15 and FX18 only read and write the DT and ST fields for now. Nothing counts them down until step 3. FX0A waits for a key press and release, so it also waits for step 3 and records an error until then.

Langhoff marks three sections "Ambiguous instruction!": the shifts, BNNN, and FX55 with FX65. He also notes that the logic instructions changed VF on the COSMAC VIP. Later interpreters for HP48 calculators changed all of these, and many games from the 1990s on expect the changed versions. This book emulates the original COSMAC VIP interpreter. The Timendus quirks test checks that behavior when you choose its CHIP-8 setting, and Schümann's table in section 4 states it opcode by opcode. Where Langhoff leaves the choice open or recommends the later behavior, follow the table:

| Instruction | Original COSMAC VIP, this chapter | CHIP-48 and SUPER-CHIP |
| --- | --- | --- |
| 8XY1, 8XY2, 8XY3 | VF is set to 0 afterwards | VF unchanged |
| 8XY6, 8XYE | VX = VY shifted by one bit, VF = the bit shifted out | VX shifted in place, VY ignored |
| BNNN | jump to NNN + V0 | jump to XNN + VX |
| FX55, FX65 | I ends at I + X + 1 | I unchanged |

Langhoff also writes that the test ROMs expect the later FX55 and FX65. The corax+ and flags ROMs pass with either version, so they cannot tell you which one you built. Step 4 runs the quirks test, which can.

VF is both a general register and the flag. When an instruction uses VF as an operand, the flag still wins, so compute the result and the flag into locals first, then write VX, then VF:

```
  8F14 with VF = 0x80, V1 = 0x80
  sum  = 0x80 + 0x80 = 0x100
  VF   = 0x00   the low 8 bits, written first
  VF   = 0x01   the carry, written last. This is the final value.
```

If you set VF first and then add, the add reads the flag instead of the operand. The flags test checks exactly this case for every 8XYN instruction.

CXNN needs random bytes. Keep the generator state in the struct, so a test run is the same every time. Marsaglia's xorshift32 takes four lines:

```c
uint32_t r = c->rng;   // any nonzero seed, set in chip8_reset
r ^= r << 13;
r ^= r >> 17;
r ^= r << 5;
c->rng = r;
uint8_t byte = (uint8_t)(r >> 24);
```

The stack holds 16 addresses. A 2NNN with a full stack and a 00EE with an empty one are errors, not crashes.

### Study

- [Tobias V. I. Langhoff: Guide to making a CHIP-8 emulator](https://tobiasvl.github.io/blog/write-a-chip-8-emulator/#00ee-and-2nnn-subroutines) (read, 45 min): From "00EE and 2NNN: Subroutines" to the end of "FX55 and FX65: Store and load memory", including EX9E and FX0A. Read the warnings marked "Ambiguous instruction", then use the table above to decide. Ignore the suggestion in FX1E to set VF when I passes 0xFFF. The original interpreter leaves VF alone there, and the flags test checks only the value of I.
- [Steffen Schümann: Classic CHIP-8 Technical Reference](https://chip8kb.gulrak.net/reference/variants/classic-chip-8/) (reference, as needed): The table in section 4, "Original CHIP-8 Opcode Set", and the NOTE under "Specific Notes on Opcodes" about VF being written last. Check each instruction against the table as you write it.

### Build

1. Add every instruction except FX0A to `chip8_step`, with the behavior from the table above.
2. Write `tests/chip8_test.c` with the `check` function from chapter 02. A helper `exec(Chip8 *c, uint16_t op)` writes the opcode at PC and calls `chip8_step`. Test at least these cases:
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
   - `D015` drawing the glyph for 0 twice at the same place sets VF = 0, then VF = 1, and leaves the display blank. Drawn at (62, 30) it lights only the pixels left of x = 64 and above y = 32. Drawn with V0 = 66 and V1 = 35 it appears at (2, 3).
   - `E09E` skips when `keys[V0 & 0xF]` is true. `E0A1` skips when it is false.
3. Run `3-corax+.ch8` and `4-flags.ch8` for 2000 cycles and compare them with the README pictures. A check mark means that instruction passed. A cross means it failed.
4. Plant a bug: in 8XY4, write VF before you compute the sum. Run the flags test and find which marks changed. Then remove the bug.

### Done when

The unit tests pass with no sanitizer report on the Mac and in Linux. Corax+ shows only check marks, and so does the flags test. With the planted bug, the entries for 8XY4 in the HAPPY and CARRY rows lose their third and fourth check marks, the ones for VF used as an operand. You can say why the first two marks stayed.

## A window, a 60 Hz frame and the keypad

The runner counts instructions. A real CHIP-8 runs against a clock. The original redrew the screen 60 times a second and counted the timers down in the same interrupt, while the instructions ran as fast as the 1802 processor could execute them. Your emulator gets the same structure: a frame is 1/60 of a second. Each frame decrements DT and ST if they are above zero, then runs a fixed number of instructions per frame (IPF). The timers go first, so that a delay of 1 still lasts one frame. Section 2.4 of Schümann's reference explains why, and section 5 lists the whole loop. Use IPF = 15 for now. Langhoff's 700 instructions per second is about 12 per frame.

```c
void chip8_frame(Chip8 *c, int ipf) {
    if (c->dt > 0) c->dt--;
    if (c->st > 0) c->st--;
    for (int i = 0; i < ipf && !c->error; i++) {
        chip8_step(c);
    }
}
```

Your Mac's display may refresh at 60 Hz, at 120 Hz, or at a rate that varies. The host loop therefore cannot run exactly one CHIP-8 frame per pass. It measures real elapsed time and runs as many 1/60 s frames as fit, carrying the remainder over. Glenn Fiedler calls this an accumulator. His version keeps seconds in a `double`. You can keep nanoseconds in a `uint64_t` and stay exact by scaling by 60 instead of dividing:

```c
uint64_t now = SDL_GetTicksNS();
acc += (now - last) * 60;          // in units of 1/60 ns
last = now;
if (acc > 4000000000ull) acc = 4000000000ull;   // at most 4 frames behind
while (acc >= 1000000000ull) {     // one CHIP-8 frame is 1e9 of those units
    chip8_frame(&c, ipf);
    acc -= 1000000000ull;
}
```

The cap matters when the program stops for a while, in the debugger or with the lid closed. Without it, the emulator would try to catch up on minutes of frames at once.

SDL3 gives you the window, the pixels on it and the keyboard. It works the same way on macOS, Linux and Windows. Install it on the Mac with `brew install sdl3 pkgconf`. `pkg-config --cflags --libs sdl3` prints the flags you need: `-I` adds the directory with SDL's headers, `-L` the directory with the library, and `-l` names the library to link. Add `$LIBS` at the end of the compiler line in `build.sh`, then build the front end with `LIBS="$(pkg-config --cflags --libs sdl3)" sh build.sh chip8_sdl`. The front end runs on the Mac only. The VM has no display, and Ubuntu 24.04 has no SDL3 package. The core, the runner and the tests keep running on both machines.

The SDL examples use SDL's callback entry points instead of `main`. Write a plain `main` and move the pieces:

```c
int main(int argc, char **argv) {
    // read the ROM, SDL_Init, window, renderer, texture    <- SDL_AppInit in the example
    while (running) {
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            // quit, key down, key up                       <- SDL_AppEvent
        }
        // run CHIP-8 frames, upload pixels, present        <- SDL_AppIterate
    }
    SDL_Quit();
    return 0;
}
```

Draw the display through a 64 by 32 texture with format `SDL_PIXELFORMAT_XRGB8888` and access `SDL_TEXTUREACCESS_STREAMING`. Set its scale mode to `SDL_SCALEMODE_NEAREST`, or SDL blurs the pixels when it stretches them. Each pass, fill a `uint32_t pixels[32][64]` with `0xFFFFFF` or `0x000000`, call `SDL_UpdateTexture` with a pitch of `64 * 4`, and draw it with `SDL_RenderTexture(renderer, texture, NULL, NULL)` to fill a 640 by 320 window. `SDL_SetRenderVSync(renderer, 1)` makes `SDL_RenderPresent` wait for the display, so the loop does not spin.

Map keys by scancode, which is the physical position of the key, so the layout works on any keyboard. The usual mapping puts the COSMAC VIP keypad on the left side of the keyboard:

```
  CHIP-8 keypad        keyboard
  1 2 3 C              1 2 3 4
  4 5 6 D              Q W E R
  7 8 9 E              A S D F
  A 0 B F              Z X C V
```

On `SDL_EVENT_KEY_DOWN` and `SDL_EVENT_KEY_UP`, look up `e.key.scancode` in a 16-entry table and set `keys[k] = e.key.down`.

FX0A completes the instruction set. It waits in two phases. While no key is held, the machine stays on the instruction. When a key goes down, the machine remembers which one and keeps waiting. When that key comes back up, its number goes into VX and execution continues. Keep `wait_reg` and `wait_key` in the struct, with -1 for "not waiting". While `wait_reg` is set, `chip8_step` checks the keys and returns without fetching. The frames keep coming, so the timers keep counting while the program waits, which the keypad test checks.

### Study

- [SDL3 examples: renderer/07-streaming-textures](https://examples.libsdl.org/SDL3/renderer/07-streaming-textures/) (do, 30 min): The official example for a texture you rewrite every frame. Build it on the Mac against your Homebrew SDL3 and run it. Then change it to fill a 64 by 32 texture from an array with `SDL_UpdateTexture`, in place of `SDL_LockTextureToSurface`. The surface functions it uses are not needed.
- [Glenn Fiedler: Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) (read, 20 min): From "Fixed delta time" through "Free the physics". Read "integrate" as "run one CHIP-8 frame". Skip "The final touch", which interpolates physics state and has no CHIP-8 counterpart.
- [SDL3 wiki: API by name](https://wiki.libsdl.org/SDL3/CategoryAPI) (reference, as needed): One page per function and struct. Look up `SDL_CreateWindowAndRenderer`, `SDL_CreateTexture`, `SDL_SetTextureScaleMode`, `SDL_UpdateTexture`, `SDL_PollEvent`, `SDL_KeyboardEvent`, `SDL_GetTicksNS` and `SDL_SetRenderVSync`. Every page has the signature and the return value. Most functions return `false` on failure and `SDL_GetError()` says why.

### Build

1. Add `chip8_frame` to the core. Change the runner to `chip8 ROM FRAMES [PRESET]`. It runs FRAMES frames at IPF 15. If PRESET is given, it writes that byte to address `0x1FF` after loading. The Timendus menus read that address and skip the menu, as their README sections explain.
2. Write `src/chip8_sdl.c` with the loop above: a 640 by 320 window, vsync on, the streaming texture, the accumulator and the key table. Take the ROM path, and optionally the IPF and the preset, from the command line.
3. Add FX0A to the core and unit tests for it: with `keys[5]` held, a step leaves the machine waiting and V3 unchanged. After `keys[5]` goes false, the next step sets V3 = 5 and the machine runs on.
4. Once per second of real time, print the number of CHIP-8 frames that ran in that second.
5. Read the "Keypad test" section of the Timendus README and run `6-keypad.ch8` in the window. Try all three modes.

### Done when

The IBM logo shows in the window as sharp white blocks. The frame counter prints 60 each second with IPF 15 and with IPF 1000, and still 60 after you turn vsync off. In the keypad test, mode 1 lights the keys you hold, mode 2 lights the keys you do not hold, and mode 3 shows a check mark and "all good". In mode 3 the program does not move on while you keep the key held.

## Quirks, display wait and the beep

CHIP-8 interpreters disagree on six behaviors, called quirks. You already chose the original behavior for four of them in step 2. The other two concern DXYN. The original interpreter waited for the next display interrupt before it drew a sprite, so a program could draw at most one sprite per frame. This is the display wait quirk. The second is clipping: sprites that cross the right or bottom edge are cut off, as you built in step 1. Many games written for later interpreters expect those pixels to wrap around to the other side.

The quirks test checks all six. Its README says it needs timer support, which you added in step 3. To emulate display wait, `chip8_frame` stops running instructions for the rest of the frame after a DXYN. With display wait on, Schümann recommends 15 instructions per frame. With fewer, the test cannot measure reliably and shows SLOW.

Make the quirks a struct in the machine, so you can run games written for other interpreters:

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

The "vip" preset sets the first four to true and the last two to false, which matches the behavior you built in steps 1 and 2. The "octo" preset sets all six to false. Octo is the CHIP-8 development environment most modern games were written in, and its own source gives those defaults. You need that preset for the games in step 5.

The sound timer drives a buzzer. While ST is above zero, the speaker beeps. SDL3 plays sound through an audio stream: you open it with a sample format and a rate, and push samples into it. A square wave is enough, a constant value that flips sign every few samples. At 8000 samples per second, flipping every 4 samples gives a 1000 Hz tone. The SDL example keeps half a second of audio queued, which would make every beep start and stop half a second late. Keep the queue short instead. After each CHIP-8 frame, if fewer than about three frames of samples are queued, push one frame's worth, 8000 / 60, about 134 samples. Push the square wave if ST is above zero and zeros if it is not.

### Study

- [Steffen Schümann: Classic CHIP-8 Technical Reference](https://chip8kb.gulrak.net/reference/variants/classic-chip-8/) (read, 15 min): Section 7, "CHIP-8 Quirks", and the paragraph on display wait at the end of "Specific Notes on Opcodes". The "COSMAC VIP" box after that paragraph explains why a draw can take two frames on the real machine. You do not need to emulate that.
- [SDL3 examples: audio/01-simple-playback](https://examples.libsdl.org/SDL3/audio/01-simple-playback/) (do, 20 min): Build and run it. It opens a stream with `SDL_OpenAudioDeviceStream`, starts it with `SDL_ResumeAudioStreamDevice`, and feeds a sine wave with `SDL_PutAudioStreamData` whenever `SDL_GetAudioStreamQueued` is low. Change the sine to a square wave and the queue limit to three frames before you move the code into your front end.

### Build

1. Add `Quirks quirks` to `Chip8`, use each flag at its instruction, and set the "vip" preset in `chip8_reset`. When `clipping` is off, DXYN wraps every pixel with `& 63` and `& 31` instead of cutting it off.
2. Make `chip8_frame` stop after a DXYN when `display_wait` is on. Give the front end and the runner an optional `vip` or `octo` argument.
3. Read the "Quirks test" section of the Timendus README. Run `5-quirks.ch8` with preset 1 in the runner for 300 frames, then in the window.
4. Turn each quirk flag around in turn, and run the test again. Then run it with IPF 5.
5. Add the audio stream to the front end. Read the "Beep test" section and run `7-beep.ch8`. Keypad B is the C key on your keyboard.

### Done when

The quirks test shows six check marks with the vip preset, the same screen as the README picture. Each flipped flag changes its own row to a cross, and IPF 5 shows SLOW for display wait. The beep test plays SOS in time with the flashing speaker icon, and holding C beeps for as long as you hold it. You can say why the timers are decremented before the instructions of a frame and not after.

## A debugger, regression tests and real games

The test ROMs tell you that something is wrong, and roughly which instruction. A game that misbehaves tells you less. You need to see the machine state at the moment it goes wrong. lldb from chapter 01 shows the state of your C program, but you want the state of the CHIP-8 machine: PC, the opcode, V0 to VF, I, the stack pointer and the timers, one instruction at a time. Three tools cover most bugs:

- A trace. The runner prints one line per instruction to `stderr`, so `stdout` keeps the display. Write the address, the opcode and the registers, in a fixed format that `grep` and `diff` can work with.
- Pause, single step and a breakpoint in the window. While paused, one key runs one instruction and prints the state. A breakpoint address on the command line pauses the machine when PC reaches it.
- Regression tests. Once a test ROM passes and you have checked its screen by eye, save the runner's output as a golden file. A script reruns every ROM and compares, like the round-trip script for your 8086 decoder in chapter 05. The next change that breaks an instruction fails the script, even if you were not looking at that test.

Then play games. The CHIP-8 Archive collects programs released under CC0, most of them written in Octo for Octo's defaults. Its `programs.json` gives each program a `tickrate`, the instructions per frame Octo runs it at, and an `options` object with Octo's quirk flags. A missing flag is false. They map to your struct like this:

| Octo option | Your quirk |
| --- | --- |
| `logicQuirks` | `vf_reset` |
| `loadStoreQuirks` | true means I is not changed, so `memory` is its opposite |
| `vBlankQuirks` | `display_wait` |
| `clipQuirks` | `clipping` |
| `shiftQuirks` | `shift_vx` |
| `jumpQuirks` | `jump_vx` |

### Study

- [Tobias V. I. Langhoff: Guide to making a CHIP-8 emulator](https://tobiasvl.github.io/blog/write-a-chip-8-emulator/#troubleshooting) (read, 10 min): "Troubleshooting" and "Add debug capabilities". Skip the rest of "What next". The SUPER-CHIP and XO-CHIP extensions are outside this chapter.
- [John Earnest: CHIP-8 Archive](https://github.com/JohnEarnest/chip8Archive) (do, 1 h): Clone it next to the test suite and add it to `.gitignore`. ROMs are in `roms/`, and the README's "Schema" section describes `programs.json`. Play only entries whose `platform` is `chip8`. Start with `br8kout` (tickrate 7), `outlaw` (15), `down8` (15) and `caveexplorer` (20) on the octo preset.

### Build

1. Add the trace to the runner as an optional last argument, `trace`. One line per instruction, for example `0x2A4 8F14 V0=00 V1=80 ... VF=80 I=0x300 SP=1 DT=00 ST=00`.
2. In the front end, Space pauses and resumes, N runs one instruction while paused and prints the same line, and an optional hex address on the command line sets a breakpoint. Parse it with the hex digit code from chapter 04's `\u` escapes.
3. Plant the 8XY4 bug from step 2 again. In the trace of `4-flags.ch8`, find the first 8XY4 whose X or Y is F. Set a breakpoint at its address in the window, step over it, and compare VF and VX with what the instruction should produce. Remove the bug.
4. Write `tests/run_roms.sh`. It builds the runner, runs ROMs 1 to 5 headless with fixed frame counts (300 frames is enough for each, with preset 1 for the quirks test), and diffs each output with `tests/golden/<rom>.txt`. Create the golden files once, after you have checked each screen against its README picture. The script exits nonzero on any difference.
5. Play the four games. Set IPF from `tickrate` and the quirks from `options`.

### Done when

`sh tests/run_roms.sh; echo $?` prints 0 on the Mac and in Linux. With the planted bug, it fails on `4-flags` and `5-quirks` and passes the other three. The quirks test uses the same instruction and shows ERR2 in its clipping row. Stepping over the buggy instruction shows VF overwritten before the add reads it. You can stop at a breakpoint and step through a subroutine call and its return. The four games play at a speed that feels right, and their controls respond.

## Where this leads

You have built a computer in software and checked it against a reference. Fetch, decode and execute run inside a 60 Hz frame. A pixel buffer, a key array and an audio stream connect the machine to the host. Quirk flags make the incompatibilities between interpreters explicit, and golden files hold every behavior you have verified. That finishes part one. You went from NAND gates to a CPU, from C basics to arenas and undefined behavior, from assembly to instruction decoding, and now to a complete machine.

You have not measured how fast any of this runs. The emulator does 15 instructions per frame and the host could do millions, so speed never came up. In real programs it does, and guessing does not work. Chapter 07, Memory hierarchy, measurement and SIMD, starts with measurement. You profile and speed up the haversine pipeline from the Computer Enhance course, then study caches, data layout and the vector instructions that your Mac and your VM both have.