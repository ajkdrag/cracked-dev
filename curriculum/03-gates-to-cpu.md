---
id: 03
title: From gates to a CPU
part: The machine and C
weeks: 6
project: The Hack CPU in HDL plus an assembler written in C.
---

Chapter 02 ended with you reading ARM64 output from clang. You watched `ldr` load a value from an address into a register, `str` store it back and `ret` jump to the address in `x30`. You can name what each instruction does. You cannot yet say what a register is made of, how the machine picks the next instruction, or why an instruction is a number.

This chapter answers those questions by building a computer. You start from one logic gate, NAND, and build every other gate from it. Then you build an adder, an arithmetic logic unit (ALU), registers, RAM, a CPU and finally the whole Hack computer, a 16-bit machine designed for teaching. The chips are written in a small hardware description language (HDL) and tested in a simulator that runs in your browser. The last two steps leave the simulator and return to C: you write an assembler that turns Hack assembly text into the 16-bit words your CPU runs.

The main source for the chapter is Nand2Tetris, the course by Noam Nisan and Shimon Schocken, which covers this exact path. Its site gives away the book chapters as PDFs, a test script for every chip, and an online IDE with the simulators. You follow its projects 1 to 6, one project per step except the assembler, which gets two. Two small extras fill gaps: Charles Petzold's interactive circuits for two's complement and flip-flops, and one short chapter of Beej's Guide to C for the bit operations in the assembler.

The chapter comes now because every later chapter assumes the picture it builds. Chapter 04 talks about how data sits in memory. Chapter 05 decodes real x86 instructions, which is your assembler run backwards. Chapter 06 builds a whole machine in software.

## Gates from NAND

A gate is a function from bits to bits. NAND outputs 0 only when both inputs are 1. Every other gate can be built from NAND alone. Not is a NAND with both inputs tied together. And is a NAND followed by a Not. Each chip you build becomes a part for the next one.

A chip in HDL is a list of parts and the wires between them. HDL is a description of wiring. The order of the lines under `PARTS:` does not matter, and nothing runs from top to bottom the way your C code does. The output of a chip in this step depends only on its inputs at that moment. Nothing is stored, and there is no clock.

The multiplexer (Mux) is the chip to understand best, because the ALU and the CPU are full of them. It picks one of two inputs based on a select bit:

```
  sel   out
   0     a
   1     b

  out = (a AND (NOT sel)) OR (b AND sel)

  a ----+
        [Mux]---- out
  b ----+
          |
         sel
```

The DMux does the reverse: it sends one input to one of two outputs and puts 0 on the other. The 16-bit versions apply the same gate to each of 16 wires at once. A group of wires carrying one value is called a bus, and HDL writes it as `a[16]`.

Set up the tools first. Open the Hardware Simulator in the [Nand2Tetris online IDE](https://nand2tetris.github.io/web-ide/chip). It needs no install and runs the same on your Mac as anywhere else. By default it keeps your files in browser storage. If you use Chrome or another Chromium browser, open Settings and choose desktop storage with a folder inside your repository, so your HDL files live on disk and in git. In Safari or Firefox, use the IDE's download button for your `.hdl` files at the end of every session.

The course site gives away chapters 1 to 4 and 6 from the book's first edition, and chapter 5 and the appendices from the second. The IDE ships second-edition project files. The editions differ in small details. Where they disagree, the files in the IDE are right.

### Study

- [Nand2Tetris, chapter 1: Boolean Logic](https://www.nand2tetris.org/_files/ugd/44046b_f2c9e41f0b204a34ab78be0ae4953128.pdf) (read, 1 h 30 min): Sections 1.1 to 1.3 and 1.5. Skip 1.4 Perspective.
- [Nand2Tetris, Appendix 2: Hardware Description Language](https://drive.google.com/file/d/1dPj4XNby9iuAs-47U9k3xtYy9hJ-ET0T/view?usp=sharing) (read, 40 min): A2.1 to A2.3. A2.2 on buses is the part you will look up most, including how to take bits `x[i..j]` of a part's output. Stop before A2.4, which the memory step uses.
- [Online IDE: Hardware Simulator guide](https://nand2tetris.github.io/web-ide/user_guide/chip.pdf) (reference, as needed): Two pages on the HDL editor, the pins panel, the test panel and the diff table that shows where a test failed.

### Build

Implement every chip of project 1 in the IDE, in the order the IDE lists them: Not, And, Or, Xor, Mux, DMux, Not16, And16, Or16, Mux16, Mux4Way16, Mux8Way16, DMux4Way, DMux8Way, Or8Way. Use only Nand and chips you have already built. Do not flip a chip to its builtin version to skip it.

Before writing each of the first six chips, write its truth table and a Boolean expression for it on paper. For Mux, set `a=0`, `b=1`, `sel=1` in the pins panel and predict the value on every internal pin before you press Eval. For Xor, count how many Nand gates your design uses once every part is expanded down to Nand.

### Done when

Every project 1 test script runs to the end with no comparison failures. You can write Xor using only Nand on paper without looking at your HDL. You can explain why moving a line under `PARTS:` to another position does not change the chip, and why none of these chips can remember a value.

## Binary numbers, adders and the ALU

In chapter 02 you dumped an `int` and saw its bytes in hex. Here you build the hardware that adds those numbers. A 16-bit number is 16 wires, and bit `i` counts `2^i`. Adding two of them works like decimal addition on paper, one column at a time, with a carry passed to the next column.

Negative numbers use two's complement. In 16 bits, `-x` is stored as the bit pattern of `2^16 - x`. To negate a number, flip every bit and add 1. The range is -32768 to 32767, and a number is negative when bit 15 is 1. The same adder then works for signed and unsigned numbers, so the hardware needs no separate subtraction circuit.

```
  16-bit two's complement
      5   0000 0000 0000 0101   0x0005
     -5   1111 1111 1111 1011   0xFFFB   (flip 5, add 1)
     -1   1111 1111 1111 1111   0xFFFF
  32767   0111 1111 1111 1111   0x7FFF
 -32768   1000 0000 0000 0000   0x8000
```

A half adder adds two bits and gives a sum bit and a carry bit. A full adder adds three bits, which are two input bits plus the carry from the column to the right. Chain 16 full adders and you have Add16. The carry out of bit 15 is dropped, which is why 16-bit addition wraps around.

The Hack ALU takes two 16-bit inputs, `x` and `y`, and six control bits. It always runs the same pipeline, and the control bits choose what happens at each stage:

```
  x --> zx: zero x --> nx: flip x --+
                                    +--> f: x+y or x&y --> no: flip out --> out
  y --> zy: zero y --> ny: flip y --+
                                                       zr = 1 if out == 0
                                                       ng = 1 if out < 0
```

HDL has no `if`. To choose between two values, compute both and let a Mux16 pick one with the control bit as `sel`. The flags come from the final output: `ng` is bit 15, and `zr` is 1 when no bit is set. Internal pins cannot be subscripted, so take the sub-buses you need where the last part's output is bound, as in `out[15]=ng` and `out[0..7]=low`.

Every row of the ALU table follows from one identity: flipping all bits of `a` gives `-a - 1`. For `x - y` the controls are `zx=0 nx=1 zy=0 ny=0 f=1 no=1`. Flip `x` to get `-x - 1`, add `y` to get `y - x - 1`, flip the result to get `-(y - x - 1) - 1`, which is `x - y`.

### Study

- [Nand2Tetris, chapter 2: Boolean Arithmetic](https://www.nand2tetris.org/_files/ugd/44046b_89c60703ebfc4bf39acef13bdc050f5d.pdf) (read, 1 h): Sections 2.1 to 2.3 and 2.5. Skip 2.4 Perspective.
- [Code, interactive illustrations: chapter 16](https://codehiddenlanguage.com/Chapter16/) (do, 15 min): Charles Petzold's companion site to his book Code. Use the eight-bit adder/subtractor and watch the XOR gates flip the second number while the carry-in adds 1. That is two's complement negation done by gates. Then add two large positive numbers in the two's complement adder and watch the Overflow output turn on. The site is free. The book is not needed.

### Build

Implement HalfAdder, FullAdder, Add16, Inc16 and ALU. Build the ALU in two passes: get `out` right against `ALU-basic.tst` first, then add `zr` and `ng` and pass `ALU.tst`.

On paper first:

1. Write 7, -7, 100 and -100 as 16-bit binary and as hex.
2. Add 0x7FFF and 0x0001 in binary. Say what the result means as a signed number and where the carry went.
3. Derive the control bits for `y - x` and for `x + 1` using the flip identity, then check them against the ALU table in the chapter.

### Done when

All project 2 test scripts pass, including both ALU scripts. Your paper answers for item 3 match the book's table. You can explain why one adder handles both signed and unsigned numbers, and you can point at the line in your ALU where `ng` comes from.

## Clocks, registers and RAM

None of the chips so far can keep a value. Change the inputs and the old outputs are gone. To keep a value from one step to the next, a chip needs a clock.

A clock is a signal that alternates between 0 and 1. One cycle is one tick and one tock. The data flip-flop (DFF) is the one new primitive: its output in this cycle is whatever its input was in the previous cycle. Nand2Tetris gives you the DFF as a built-in chip. It can be built from NAND gates wired in a loop, and Petzold's interactive pages below show how feedback holds a bit.

A one-bit register (Bit) is a DFF plus a Mux that feeds the DFF either a new value or its own old output:

```
             load
              |
   in ------>[Mux]----->[DFF]----+----> out
              ^                  |
              +------------------+
         load = 0: keep the old value
         load = 1: store in at the next cycle
```

A Register is 16 Bits sharing one `load` wire. RAM8 is eight Registers. A DMux8Way sends `load` to the register chosen by the address, and a Mux8Way16 picks that register's output. Bigger RAM is made from smaller RAM: the high address bits pick a block and the low bits pick a word inside it. These are the registers and memory addresses you saw in chapter 02. `x0` is a register like this one, 64 bits wide. The address in `ldr w8, [x0]` selects a word in a RAM like the one you build here.

The program counter (PC) holds the address of the next instruction. Each cycle it either resets to 0, loads a new value, adds 1, or keeps its value, in that order of priority. A jump is the PC loading a value instead of adding 1.

In the simulator, a test script's `tick` and `tock` are the two halves of a clock cycle. Read the outputs in a test's `.cmp` file as values after each half.

### Study

- [Nand2Tetris, chapter 3: Sequential Logic](https://www.nand2tetris.org/_files/ugd/44046b_1801b5682e4d4a67bd05e14235665d8b.pdf) (read, 1 h 15 min): Sections 3.1 to 3.3 and 3.5. Skip 3.4 Perspective. Figure 3.5, the counter timing table, is the model for the paper exercise below.
- [Nand2Tetris, Appendix 2: Hardware Description Language](https://drive.google.com/file/d/1dPj4XNby9iuAs-47U9k3xtYy9hJ-ET0T/view?usp=sharing) (reference, as needed): The appendix from the first step. Use A2.4 Sequential chips only, for how the built-in DFF and clocked chips appear in HDL.
- [Code, interactive illustrations: chapter 17](https://codehiddenlanguage.com/Chapter17/) (do, 30 min): From "First Flip-Flop" through "Eight-Bit Accumulating Adder". Toggle the inputs and watch the output hold after the input goes away. Compare the level-triggered and edge-triggered D-type flip-flops, since the Nand2Tetris DFF behaves like the edge-triggered one.

### Build

Implement Bit, Register, RAM8, RAM64, RAM512, RAM4K, RAM16K and PC.

Before building PC, copy the input rows of figure 3.5 from the chapter, cover the `out` row, and fill it in yourself. Then do the same for this sequence, starting from `out = 0`: `inc=1` for three cycles, then `load=1` with `in=100` for one cycle, then `inc=1` again for two cycles, then `reset=1` for one cycle.

### Done when

All eight test scripts pass. Your paper `out` rows match the book's figure and the simulator. You can explain why Bit needs the Mux and what goes wrong if the DFF's output is wired straight back to its input. You can say which address bits RAM4K uses to pick one of its RAM512 parts.

## Programming the Hack machine

You have the parts of a CPU but not yet the CPU. Before you wire it, learn to program it. The instruction set defines what the CPU must do, so writing programs first tells you what to build in the next step.

Hack has two registers. `D` holds data. `A` holds data or an address. `M` is not a register: it names the RAM word at the address in `A`. There are two kinds of instruction:

```
  @21          A-instruction: A = 21
  D=M+1;JGT    C-instruction: D = RAM[A] + 1, then jump to the
               address in A if the result is greater than 0
```

A C-instruction has three optional fields, `dest=comp;jump`. `comp` is one of the ALU functions you built. `dest` says which of A, D and M receive the result. `jump` compares the result with 0 and, if the test passes, loads the PC from `A`. So a jump always takes two instructions: `@LOOP` to put the target address in A, then a C-instruction with a jump field.

Compare this with chapter 02. ARM64's `ldr w8, [x0]` loads from the address in a register in one instruction. In Hack that takes `@R0`, `A=M` to put the address in A, then `D=M`. Hack has no load or store instruction. Every access to memory goes through `M`.

Every instruction is a 16-bit word. This is how `D=M+1;JGT` becomes `1111110111010001`:

```
  1  11  1  110111  010  001
  |  |   |  |       |    +-- jump: JGT
  |  |   |  |       +------- dest: D
  |  |   |  +--------------- comp: c1..c6 for M+1 (same bits as A+1)
  |  |   +------------------ a = 1: the ALU reads M instead of A
  |  +---------------------- unused, always 1
  +------------------------- 1: C-instruction (0 means A-instruction)
```

The c1 to c6 bits are your ALU's `zx nx zy ny f no` control bits in that order. The screen and keyboard are memory too. The screen starts at RAM address 16384 (`SCREEN`), with 32 words per row of 512 pixels. The keyboard is the single word at 24576 (`KBD`), which holds the code of the key pressed, or 0.

You run these programs in the IDE's [CPU Emulator](https://nand2tetris.github.io/web-ide/cpu), in the same browser tab and storage as the Hardware Simulator.

### Study

- [Nand2Tetris, chapter 4: Machine Language](https://www.nand2tetris.org/_files/ugd/44046b_d70026d8c1424487a451eaba3e372132.pdf) (read, 1 h 30 min): Sections 4.1, 4.2 and 4.4. Skip 4.3 Perspective. The tables in 4.2.3 for comp, dest and jump are the ones your assembler encodes later, so mark the page.
- [Online IDE: CPU Emulator guide](https://nand2tetris.github.io/web-ide/user_guide/cpu.pdf) (reference, as needed): One page on loading a program, setting RAM values, stepping, and running a test script.

### Build

Write the two programs of project 4 in the IDE's CPU Emulator:

1. `Mult.asm` computes `R2 = R0 * R1` by repeated addition. Assume both inputs are 0 or more and the product fits. Test with `Mult.tst`.
2. `Fill.asm` loops forever. While any key is held, it blackens every pixel. When no key is held, it clears every pixel. Test it by hand with the keyboard enabled, then with `FillAutomatic.tst`.

Then encode by hand, on paper, the first six instructions of `MaxL.asm` from the IDE's project 6 folder: `@0`, `D=M`, `@1`, `D=D-M`, `@10`, `D;JGT`.

### Done when

`Mult.tst` and `FillAutomatic.tst` pass, and `Fill.asm` works by hand. Your six hand-encoded words match the first six lines of `Max.hack` in the IDE's project 5 folder, which the official assembler produced. For each line of `Mult.asm` you can say what A, D and M hold after it runs.

## The CPU and the computer

The programs from the last step ran on the IDE's built-in CPU. Now you build your own from the ALU, registers and PC of the earlier steps, and the same programs test it. The CPU runs one loop, once per clock cycle:

```
          +------------------------------------------------+
          v                                                |
   fetch: ROM[PC] goes to the CPU's instruction input      |
          |                                                |
   decode: bit 15 says A- or C-instruction.                |
           For C: a and c1..c6 drive the ALU,              |
           d1..d3 say who stores the result,               |
           j1..j3 say when to jump                         |
          |                                                |
   execute: the ALU computes. A, D or RAM[A] store the     |
            result at the end of the cycle                 |
          |                                                |
   next PC: if the jump condition holds, PC = A            |
            else PC = PC + 1 --------------------------------+
```

A real ARM64 core runs the same loop on many instructions at once, out of order, with caches in between. Chapter 07 covers those.

The decode step needs no decoder chip. The instruction bits go straight to the parts as control wires. Bit 15 picks between the instruction and the ALU output as the A register's input. The `a` bit is the `sel` of a Mux16 that feeds A or `inM` into the ALU. The six `c` bits are the ALU's control pins. The three `d` bits become the load pins of A and D and the `writeM` output. The jump bits combine with the ALU's `zr` and `ng` into one bit that drives the PC's `load`. The load pins of A and D, `writeM` and the jump bit must also check bit 15, because an A-instruction must not write D or jump.

The Memory chip joins RAM16K, the Screen and the Keyboard into one address space. Addresses 0 to 16383 go to RAM, 16384 to 24575 go to the Screen, and 24576 is the Keyboard. Two address bits pick the part, the same trick you used to build RAM64 from RAM8. The Computer chip wires ROM32K, the CPU and Memory together.

### Study

- [Nand2Tetris, chapter 5: Computer Architecture](https://www.nand2tetris.org/_files/ugd/44046b_552ed0898d5d491aabafd8a768a87c6f.pdf) (read, 2 h): Sections 5.1 to 5.4. Skip 5.5 Perspective. You implement diagram 5.8, the proposed CPU. Section 5.3.1 explains it without giving the jump logic away.
- [Nand2Tetris, Appendix 4: The Hack Chip Set](https://drive.google.com/file/d/1IsDnH0t7q_Im491LQ7_5_ajV0CokRbwR/view?usp=sharing) (reference, as needed): One page with the signature of every chip, including the built-in ARegister, DRegister, ROM32K, Screen and Keyboard. Copy the signatures into your HDL instead of retyping pin names.

### Build

Implement Memory, CPU and Computer. Use the built-in ARegister and DRegister inside the CPU, as the book suggests. They behave like your Register, and the simulator can show their values.

Test in this order: `Memory.tst`, then `CPU.tst` and `CPU-external.tst`, then `ComputerAdd.tst`, `ComputerMax.tst` and `ComputerRect.tst`.

Before running `ComputerMax.tst`, read it. Its first run puts 3 in RAM[0] and 5 in RAM[1] and then runs 14 clock cycles. On paper, follow `MaxL.asm` with those values and write down PC, A and D after each of the first eight cycles. Then run the script and compare your page with its output file, which lists A, D and PC after every cycle.

### Done when

All six test scripts pass. Your paper trace of Max matches the simulator cycle by cycle. For the instruction `D;JGT` you can name every wire in your CPU that its bits drive and say what value each one carries when D is 2.

## An assembler in C, without symbols

This step goes back to C. An assembler turns text into numbers. For Hack the translation is a table lookup per field. Labels and variables come in the next step. This step handles programs that use only numbers, like the `MaxL.asm`, `RectL.asm` and `PongL.asm` files in project 6 ("L" for less symbols).

Most of the program is chapter 02's word counter with a different input format. Read all of standard input into a growing buffer, as `wordcount` did. Then walk it one line at a time:

```
  "   D=M+1;JGT   // compare\n"
        |
  strip the comment and all spaces  ->  "D=M+1;JGT"
        |
  empty?          skip the line
  starts with @   A-instruction: parse the digits, value must be 0..32767
  otherwise       C-instruction: split at '=' and ';'
                    dest "D"   -> 010
                    comp "M+1" -> a=1, 110111
                    jump "JGT" -> 001
        |
  word = 0xE000 | a << 12 | comp << 6 | dest << 3 | jump
        |
  print bits 15 down to 0 as '0' and '1', then '\n'
```

Keep each table as an array of structs, such as `struct Code { const char *text; unsigned bits; }`, and look up a field with a linear scan. A field is a slice of the line, so compare it with a table entry using `strncmp(field, text, n) == 0 && text[n] == '\0'`, where `n` is the field's length, or `memcmp` once you know the lengths match. Parse the number after `@` yourself. The character `'0'` has code 48 and the digits follow it in order, so `c - '0'` is the digit's value. For each digit, `value = value * 10 + (c - '0')`. Build the output word with shifts and OR, and turn it into text by testing `(word >> i) & 1` for `i` from 15 down to 0.

Three details trip people up. Files from other sources, such as the old desktop Nand2Tetris zip, may end lines with `\r\n`, so treat `\r` as a space. The book's dest table lists `MD`, but the compiled Rect and Pong programs also write `DM`, so accept both spellings for the same bits. An unknown mnemonic is an error: print the line number and the text to `stderr` and exit with status 1.

The program reads standard input and writes standard output, like `wordcount`. Build it with `sh build.sh hasm` and run it from your repository root:

```sh
./out/Darwin-debug/hasm < MaxL.asm > MaxL.hack
```

To check your output you need the `.asm` files and official `.hack` files on disk. With desktop storage they are already in your folder. Otherwise, use the IDE's settings to download the projects folder. Copy project 6's `.asm` files into your repository root. Project 5's folder holds `Add.hack`, `Max.hack` and `Rect.hack` from the official assembler. They are the same programs as project 6's `Add.asm`, `Max.asm` and `Rect.asm`. Make a `ref/raw/` directory and copy those three into it. The IDE stores them with stray blank lines and sometimes no final newline, so keep only the 16-bit lines before comparing:

```sh
grep -E '^[01]{16}$' ref/raw/Max.hack > ref/Max.hack
diff ref/Max.hack MaxL.hack
```

### Study

- [Nand2Tetris, chapter 6: Assembler](https://www.nand2tetris.org/_files/ugd/44046b_b73759b866b249a0b3a715bf5a18f668.pdf) (read, 1 h): Sections 6.1, 6.2.1, 6.2.2, 6.2.4 and 6.3.1 to 6.3.3. The book proposes Parser and Code modules. In C they become functions in one file. Leave 6.2.3 and 6.3.4 on symbols for the next step.
- [Beej's Guide to C: Bitwise Operations](https://beej.us/guide/bgc/html/split/bitwise-operations.html) (read, 15 min): Sections 24.1 and 24.2. Note the warning about shifting by more than the width of the type and about right-shifting negative numbers. Keep your instruction words in an `unsigned` type.
- [Online IDE: Assembler guide](https://nand2tetris.github.io/web-ide/user_guide/asm.pdf) (reference, as needed): One page. The "Comparing / Testing" paragraph explains the compare panel you use for PongL below.

### Build

Write `src/hasm.c` with these functions and a `main` that ties them together:

- `bool parse_line(const char *line, size_t len, char *out, size_t cap)` copies the line into `out` without comments and spaces, and returns false if it does not fit.
- `bool encode_a(const char *s, unsigned *word)` for text after `@`, false on a non-digit or a value above 32767.
- `bool encode_c(const char *s, unsigned *word)` for a whole C-instruction, false on any unknown field.
- `void word_to_bits(unsigned word, char out[17])` writes the 16 characters `'0'` and `'1'` for bits 15 down to 0, then the terminator.
- `bool assemble(const char *text, struct Words *out)` runs the whole translation into a growable array of words, `struct Words { unsigned *data; size_t len; size_t cap; }`, built like chapter 02's `Vec`. On an error it prints the line number and text to `stderr` and returns false.

`main` reads standard input, calls `assemble`, prints each word with `word_to_bits` and `printf`, frees everything and returns 0, or 1 after an error.

Write `tests/hasm_test.c` in the chapter 02 pattern: it includes `../src/hasm.c` with `main` renamed, prints OK or FAIL per case and returns the failure count. Copy `tests/run_add_test.sh` to `tests/run_hasm_test.sh` to build and run it:

- `encode_c("D=M+1;JGT")` gives 0xFDD1, `"0;JMP"` gives 0xEA87, `"M=D"` gives 0xE308, `"AM=M-1"` gives 0xFCA8, and `"DM=M+1"` gives the same word as `"MD=M+1"`.
- `encode_a("21")` gives 0x0015, `"32767"` passes, and `"32768"`, `""` and `"2x"` fail.
- `"D=Q"`, `"D=M;JXX"` and `"X=D"` fail.
- `parse_line` on `"  // only a comment"` gives an empty string, and on `"\tD=A  // c\r"` gives `"D=A"`.
- `word_to_bits(0xFDD1, s)` gives `"1111110111010001"`.
- `assemble` on `"@2\nD=A\n@3\nD=D+A\n@0\nM=D\n"` gives the six words of `Add.hack`, and on `"@2\nD=Q\n"` returns false.

Then assemble `Add.asm`, `MaxL.asm`, `RectL.asm` and `PongL.asm`. Compare the first three against project 5's files with `diff` as above. For `PongL.asm`, open the IDE's [Assembler](https://nand2tetris.github.io/web-ide/asm), load `PongL.asm`, translate it, paste your output into the compare panel and run the compare.

### Done when

All unit tests pass on the Mac and run clean under ASan in the Linux VM. `diff` prints nothing for Add, MaxL and RectL, and the IDE's compare reports no differences for PongL. Break the `DM` alias on purpose and confirm that RectL and PongL then fail with an error message naming a line.

## Labels, variables and Pong

The last piece is symbols. A label like `(LOOP)` names the address of the instruction after it. A variable like `@sum` names a RAM word that the assembler picks. Predefined symbols such as `R0` to `R15`, `SCREEN` and `KBD` have fixed values. All three kinds live in one symbol table, which maps a name to a number. You built the same thing in chapter 02: the word counter's table of owned strings with a count, where the count is now an address.

The assembler reads the program twice:

```
  pass 1: walk the lines with an instruction counter n = 0
          (NAME)          add NAME -> n, n does not change
          A or C line     n = n + 1
          blank/comment   nothing

  pass 2: walk the lines again
          @123            number, encode as before
          @NAME in table  encode its value
          @NAME not found new variable: add NAME -> next, next = next + 1
                          (next starts at 16)
          (NAME)          emit nothing
```

The first pass exists because a jump can name a label that appears later in the file. Labels count only real instructions, so a label line does not move the counter. Variables get addresses in the order they first appear in the second pass. The table owns a heap copy of every name and frees them all at the end, like `table_free` in chapter 02. A symbol that starts with a digit is a number, not a name.

Pong has about 27,000 instructions and nearly 900 labels. A linear scan of the table for every `@` line still finishes in well under a second, so keep the scan. Chapter 07 comes back to faster tables.

### Study

- [Nand2Tetris, chapter 6: Assembler](https://www.nand2tetris.org/_files/ugd/44046b_b73759b866b249a0b3a715bf5a18f668.pdf) (read, 30 min): Sections 6.2.3, 6.3.4, 6.3.5 and 6.5. Section 6.2.3 has the table of predefined symbols your table starts with.

### Build

Add a symbol table to `src/hasm.c` using your counted allocators from chapter 02:

- `bool sym_add(struct SymTable *t, const char *name, size_t len, unsigned value)` copies the name and returns false if the copy or the growth fails.
- `bool sym_find(const struct SymTable *t, const char *name, size_t len, unsigned *value)`.
- `void sym_free(struct SymTable *t)` frees every name and the array.
- A function that loads the 23 predefined symbols.

Extend `hasm_test.c`:

- Through `assemble`: a program that uses `@i` and then `@sum` gives `i` address 16 and `sum` address 17.
- A label used before its definition resolves to the right instruction number.
- `@LOOP` and `@loop` are different symbols.
- A label defined twice is an error.
- A failed allocation in `sym_add` leaves the table unchanged, and the counters balance after every test.

Then assemble `Max.asm`, `Rect.asm` and `Pong.asm`. Each must give exactly the same output as your previous step gave for its "L" version:

```sh
./out/Darwin-debug/hasm < Pong.asm > Pong.hack
./out/Darwin-debug/hasm < PongL.asm > PongL.hack
diff Pong.hack PongL.hack
```

### Done when

`diff` prints nothing for Max, Rect and Pong. The IDE's compare panel, used as in the previous step, reports no differences for `Pong.asm` translated by the IDE against your `Pong.hack`. The tests pass with balanced counters on the Mac and clean under ASan in the VM. Load your `Pong.hack` into the CPU Emulator, enable the keyboard and play a round on code your assembler produced.

## Where this leads

You built a computer from NAND gates and wrote the tool that produces its programs. You can now say what a register is, how RAM selects a word by address, how an instruction's bits drive the ALU and the registers, and how the program counter picks the next instruction. When chapter 02's `ldr w8, [x0]` runs, you know roughly what happens inside.

Hack is a minimal machine. It has one data size, no bytes, no stack and no call instruction. Real C programs on your Mac work with bytes, structs, stacks and allocators, and they break in ways Hack cannot show you. Chapter 04, C properly: memory, undefined behavior, arenas, goes back to C with the machine model from this chapter. It starts where your ALU stopped: the same two's complement bits, now 8 to 64 bits wide, with C's integer types and the rules that convert between them. Then you will see how C lays out data in memory, which code the compiler is allowed to assume never runs, and how to replace the many small `malloc` calls in your symbol table with an arena. The text parsing you did here grows into a JSON parser there.
