---
id: 03
title: From gates to a CPU
part: The machine and C
weeks: 6
project: The Hack CPU in HDL plus an assembler written in C.
---

Chapter 02 ended with you reading the x86-64 instructions clang made from your C. You watched `movl` copy a value between memory and a register, `cmpb` and `jne` drive a loop, and `retq` take the return address off the stack and jump to it. You can say what each instruction does. You cannot yet say what a register is made of, how the CPU picks the next instruction, or why an instruction is a number.

This chapter answers those questions by building a computer, the Hack computer, a 16-bit machine designed for teaching. You start from one logic gate and build every other part from it: more gates, an adder, the unit that does the arithmetic, registers, memory, and finally a CPU that runs programs. You describe each part in a small language and test it in a simulator that runs in your browser. The last two steps go back to C, where you write the program that turns Hack assembly text into the numbers your CPU runs.

The source for the chapter is Nand2Tetris, a course by Noam Nisan and Shimon Schocken that walks this exact path. Its site gives away the book chapters as PDFs, a test for every chip, and the online simulator. You follow its projects 1 to 6. Two small extras fill gaps: Charles Petzold's clickable circuits for negative numbers and for memory, and one short chapter of Beej's Guide to C on bit operations.

The chapter comes now because later chapters lean on the picture it builds. Chapter 04 looks at how C stores numbers as bits. Chapter 05 decodes 8086 machine code, which is your assembler run backwards. Chapter 06 builds a whole machine in software.

## The project files and the simulator

The chips you write in this chapter are text files, and the simulator that tests them runs in a web page on Windows. This step puts the project files in your repository and points the simulator at them, so every chip you finish is a file git can commit.

The simulator is part of the Nand2Tetris online **IDE** (integrated development environment), a set of tools that runs in the browser. By default the IDE keeps its files inside the browser's own storage. Git cannot see them there, and clearing the browser's data deletes them. The IDE's **desktop storage** setting makes it read and write a folder on your computer instead. You give it the project folder inside your repository.

The project files come as one zip file, `projects.zip`, with a numbered folder for each project of the course. You use projects 1 to 6.

Windows reaches your Ubuntu files through a path that starts with `\\wsl.localhost\Ubuntu-24.04\`. The command `wslpath -w` prints that Windows path for a Linux folder, and you paste it into the browser's folder dialog. This book uses Edge, which comes with Windows, for the IDE. Desktop storage needs a browser built on Chromium, the open-source core of Chrome, and Edge is one.

### Study

- [Online IDE: File System guide](https://nand2tetris.github.io/web-ide/user_guide/file_system.pdf) (read, 5 min): One page on browser storage and PC storage, which the IDE's settings call desktop storage. Its paragraph on creating new files says that a file you create in the project folder outside the IDE shows up after a page refresh. You rely on that later.

### Build

1. In Ubuntu, go to your repository with `cd ~/code/hello`.
2. Download the project files:

   ```sh
   curl -L -o projects.zip 'https://drive.google.com/uc?export=download&id=1oD0WMJRq1UPEFEXWphKXR6paFwWpBS4o'
   ```

   `curl` downloads a URL. `-L` follows the link on to where Google keeps the file, and `-o` names the file it writes. The single quotes matter, because without them the shell reads `&` as the end of a command and cuts the URL short. This is the same file as the IDE's "Download the projects folder" button.
3. Run `sudo apt install -y unzip`, then `unzip projects.zip -d nand2tetris` and `rm projects.zip`. `-d nand2tetris` makes `unzip` put the files into a new folder `nand2tetris`. You get `nand2tetris/projects/` with one numbered folder per project.
4. Commit the untouched files: `git add nand2tetris && git commit -m "Nand2Tetris project files"`. From now on, `git status` lists exactly the files you changed.
5. Run `wslpath -w nand2tetris/projects` and copy the path it prints.
6. Open the [Nand2Tetris IDE](https://nand2tetris.github.io/web-ide/chip) in Edge. In its settings, under "Project files", choose "Use Desktop Storage" and click "Select Projects Folder". Paste the path into the address bar of the folder dialog, select the folder, and allow the IDE to edit it when Edge asks.
7. In the IDE, choose project 1 and check that it lists the chip Not.

> **If it fails:** If `unzip` says `projects.zip` is not a zip file, Google sent a web page instead of the file. Download the file with the IDE's "Download the projects folder" button, copy it with `cp /mnt/c/Users/<your Windows user>/Downloads/projects.zip ~/code/hello/`, and go on from item 3. If the folder dialog refuses the folder, update Edge and try again. If it still refuses, switch the IDE back to browser storage. Then download your chips with the IDE's download button at the end of every session and copy them from your Windows Downloads folder into `nand2tetris/projects`.

### Done when

`git log` shows the commit with the project files. The IDE's settings show desktop storage with your folder, and project 1 lists Not. You can say why the IDE needs desktop storage for git to see your chips.

## Your first chip: Not

Before you build hardware, you need a way to describe a circuit and check it. This step writes and tests the smallest chip.

A **logic gate** is a tiny circuit that takes bits in and puts one bit out. A **chip** is a circuit built from smaller chips, its **parts**. A chip's named inputs and outputs are its **pins**. A **wire** connects one pin to other pins and carries one bit between them.

Nand2Tetris gives you one chip ready-made, **Nand**. Its output is 0 when both inputs are 1, and 1 otherwise. A **truth table** lists a gate's output for every combination of its inputs. Nand's has four rows:

```
  a  b   Nand
  0  0    1
  0  1    1
  1  0    1
  1  1    0
```

You describe a chip in a **hardware description language** (HDL). An HDL file lists the chip's parts and the wires between them. It describes wiring, so the order of the lines does not matter, and nothing runs from top to bottom the way C does. Each chip starts as a **stub**, a file that names its pins and leaves the section below `PARTS:` for you to fill.

The line `Nand(a=x, b=y, out=w)` places one Nand part. The left side of each `=` is a pin of the part, and the right side is a wire of the chip you are building. One wire can feed any number of pins.

The **hardware simulator** checks a chip against a test. A **test script**, a `.tst` file, sets the inputs, computes the outputs and writes them as one row of a table. The simulator compares every row with the same row of a **compare file**, a `.cmp` file that holds the right answers:

![The simulator builds Not from your HDL, the test script sets its input and records each output as a row, and every row must match the same row of Not.cmp.](figures/03-chip-test.svg)

> **Practice:** Commit each chip as soon as its test passes. You can then always get back to a version that worked.

### Study

- [Nand2Tetris, Appendix 2: Hardware Description Language](https://drive.google.com/file/d/1dPj4XNby9iuAs-47U9k3xtYy9hJ-ET0T/view?usp=sharing) (read, 20 min): A2.1 HDL basics only. It builds a small chip from four parts and gives the rule for reading lines such as `Xor(a=a, b=b, out=neq1)`. The paragraph that starts "Pins have fan-in 1 and unlimited fan-out" shows one wire feeding several pins, which your Not needs.
- [Online IDE: Hardware Simulator guide](https://nand2tetris.github.io/web-ide/user_guide/chip.pdf) (reference, as needed): Two pages on the HDL editor, the pins panel, the test panel and the diff table that shows where a test failed.

### Build

1. In the IDE's Hardware Simulator, choose project 1 and the chip Not.
2. Run the test against the stub. Read the diff table and say why each failing row fails.
3. Write Not in the IDE's HDL editor, with one Nand part. Run the test again.
4. In Ubuntu, run `git status`. It lists `nand2tetris/projects/1/Not.hdl` as modified.
5. Commit `Not.hdl`.

### Done when

The Not test runs to the end with no differences, and `Not.hdl` is committed. For each `=` in your Not, you can say which side is a pin of the Nand part and which side is a wire of Not.

## Basic gates

With Nand and the simulator you can build the gates that every later chip uses. Each chip you finish becomes a part for the next one.

Three of them work like Python's `and`, `or` and `not` on single bits. And is 1 when both inputs are 1. Or is 1 when at least one input is 1. Not flips its one input. **Xor**, exclusive or, is 1 when exactly one of its two inputs is 1, so it tells you whether two bits differ.

Not is a Nand with both inputs on one wire. And is a Nand followed by a Not:

![Not ties both inputs of one Nand to the same wire, and And feeds the output of a Nand into a second Nand that works as a Not.](figures/03-nand-gates.svg)

The **multiplexer** (Mux) is the chip to understand best, because the arithmetic unit and the CPU of later steps are full of them. It has two data inputs, `a` and `b`, and a **select** input, `sel`. It passes `a` through when `sel` is 0 and `b` when `sel` is 1. Built from gates, it computes `(a And Not sel) Or (b And sel)`:

![Inside a Mux with a = 0, b = 1 and sel = 1: the lower And passes b, the upper And outputs 0, and the Or passes the 1 from b to out.](figures/03-mux.svg)

The **demultiplexer** (DMux) does the reverse. It sends its one input to output `a` or output `b`, as `sel` says, and puts 0 on the other.

The book chapters on the site come from the book's first edition, except chapter 5 and the appendices. The project files come from the second. Where the two disagree, the project files are right.

> **Practice:** Build each chip only from Nand and chips you have already built, in the order the IDE lists them. Never switch a chip to its builtin version to skip it.

### Study

- [Nand2Tetris, chapter 1: Boolean Logic](https://www.nand2tetris.org/_files/ugd/44046b_f2c9e41f0b204a34ab78be0ae4953128.pdf) (read, 1 h): Sections 1.1, 1.2.1 The Nand Gate, 1.2.2 Basic Logic Gates and 1.3. Section 1.1.4 repeats HDL from the last step, with Xor as the example. Sections 1.2.3, 1.2.4 and 1.5 wait for the next step.
- [Nand2Tetris, Appendix 2: Hardware Description Language](https://drive.google.com/file/d/1dPj4XNby9iuAs-47U9k3xtYy9hJ-ET0T/view?usp=sharing) (read, 20 min): A2.3 Built-In Chips and A2.6 HDL Survival Guide. A2.6 explains why a chip fails when one of its parts is still a stub, that an unconnected pin is 0 without an error, and how to test one part alone to find a broken one. It was written for an older simulator, so skip its advice on the File menu and on moving windows.

### Build

1. Before you write each of And, Or, Xor, Mux and DMux, write on paper its truth table and a **Boolean expression**, a formula in And, Or and Not such as `a And Not b`.
2. Implement And, Or, Xor, Mux and DMux, in that order. Commit each one when its test passes.
3. For Mux, set `a=1`, `b=0`, `sel=1` in the pins panel and write down the value on every internal wire before you press Eval. Do the same for `sel=0`.
4. For Xor, count the Nand gates in your design once every part is expanded down to Nand.

### Done when

The five tests pass. You can write Xor using only Nand on paper without looking at your HDL. You can explain why moving a line under `PARTS:` to another position does not change the chip.

## Buses and multi-way chips

A CPU works on 16-bit numbers, so most of its chips move 16 bits at once. This step builds the wide versions of your gates.

A group of wires that carries one number is a **bus**. HDL writes a 16-wire bus as `a[16]`, and `a[0]` is its lowest bit. The 16-bit chips, such as And16, apply one gate to each of the 16 wire pairs at once:

![And16 on two 16-wire buses: wire i of a and wire i of b go into the i-th And, which drives wire i of out, so bit 2 of 0x0005 And 0x0006 is 1 and the others are 0.](figures/03-bus.svg)

To wire part of a bus, name its bits. `a[0..7]` is the low eight bits of `a`, and `a[3]` is one bit.

A **multi-way** chip chooses among more than two inputs or outputs. Or8Way is 1 when any of its eight input bits is 1. Mux4Way16 passes one of four 16-bit buses, and Mux8Way16 one of eight. Their `sel` is a bus of 2 or 3 bits that counts in binary which input to pass. DMux4Way and DMux8Way send their one input to one of four or eight outputs.

Every chip in project 1 is **combinational**. Its outputs depend only on its inputs at this moment, and it remembers nothing. A later step adds chips that remember.

### Study

- [Nand2Tetris, chapter 1: Boolean Logic](https://www.nand2tetris.org/_files/ugd/44046b_f2c9e41f0b204a34ab78be0ae4953128.pdf) (read, 30 min): Sections 1.2.3 Multi-Bit Versions of Basic Gates, 1.2.4 Multi-Way Versions of Basic Gates and 1.5 Project. Skip 1.4 Perspective.
- [Nand2Tetris, Appendix 2: Hardware Description Language](https://drive.google.com/file/d/1dPj4XNby9iuAs-47U9k3xtYy9hJ-ET0T/view?usp=sharing) (read, 15 min): A2.2 Multi-bit busses. You will look up how to take the bits `x[i..j]` of a part's output more than anything else in the appendix. A2.4 and A2.5 wait for later.

### Build

1. Implement the rest of project 1 in the order the IDE lists the chips: Not16, And16, Or16, Mux16, Or8Way, Mux4Way16, Mux8Way16, DMux4Way, DMux8Way. Commit each one when its test passes.
2. Before you write Mux4Way16, write down on paper which input it passes for each of the four values of `sel`, from `00` to `11`.

### Done when

Every project 1 test runs to the end with no differences. You can say which input Mux8Way16 passes when `sel` is `101`, and why And16 needs no wire between neighboring bits.

## Binary numbers and adders

In chapter 01 you converted bytes between binary, hex and decimal. Here you build the hardware that adds such numbers.

A 16-bit number travels on a 16-wire bus, and bit `i` is worth 2 to the power `i`. Adding two of them works like decimal addition on paper: one column at a time, right to left. When a column adds up to 2 or more, a **carry** of 1 goes to the next column.

A **half adder** adds two bits and outputs a sum bit and a carry bit. A **full adder** adds three bits, the two input bits plus the carry from the column to its right. Chain 16 full adders, each one's carry out feeding the next one's carry in, and you have Add16:

![Add16 as a chain of full adders adding 0xFFFF and 0x0001: a carry of 1 ripples from bit 0 up to bit 15, every sum bit is 0, and the carry out of bit 15 is dropped.](figures/03-adder-chain.svg)

The carry out of bit 15 has nowhere to go and is dropped. So 16-bit addition **wraps around**: 0xFFFF plus 1 gives 0.

Negative numbers use **two's complement**, the rule from chapter 01 where the leftmost bit of an `int` counts as negative. In 16 bits, `-x` is stored as the bit pattern of 65536 minus `x`, so -1 is stored as 0xFFFF. To negate a number, flip every bit and add 1. Bit 15 is 1 for every negative number, and the range is -32768 to 32767:

```
       5   0000 0000 0000 0101   0x0005
      -5   1111 1111 1111 1011   0xFFFB   flip 5, add 1
      -1   1111 1111 1111 1111   0xFFFF
   32767   0111 1111 1111 1111   0x7FFF
  -32768   1000 0000 0000 0000   0x8000
```

The figure above is also -1 plus 1, and the wrapped result, 0, is the right answer. The adder does not know whether its inputs are signed, and the same bits come out either way. So the hardware needs no second adder for negative numbers.

What can differ is whether those bits are the right answer. 0x7FFF plus 1 gives 0x8000, which is right as the unsigned 32768 and wrong as the signed -32768. A signed result that does not fit in 16 bits is an **overflow**. The Hack hardware does not report it.

### Study

- [Nand2Tetris, chapter 2: Boolean Arithmetic](https://www.nand2tetris.org/_files/ugd/44046b_89c60703ebfc4bf39acef13bdc050f5d.pdf) (read, 40 min): Sections 2.1 and 2.2.1, then the paragraphs from Half-Adder to Incrementer at the start of 2.3. The ALU waits for the next step.
- [Code, interactive illustrations: chapter 16](https://codehiddenlanguage.com/Chapter16/) (do, 15 min): Charles Petzold's companion site to his book Code. Use the eight-bit adder/subtractor and watch the Xor gates flip the second number while the carry in adds 1. That is two's complement negation. Then add two large positive numbers in the two's complement adder and watch the Overflow output turn on when the sum does not fit and comes out negative. The site is free, and the book is not needed.

### Build

1. On paper, write 7, -7, 100 and -100 as 16-bit binary and as hex. Check each one with Python: `python3 -c 'print(hex(-7 & 0xFFFF))'` prints `0xfff9`. The `& 0xFFFF` keeps the low 16 bits, which turns Python's unlimited integer into the 16-bit pattern.
2. On paper, add 0x7FFF and 0x0001 in binary. Say what the result means as a signed number and as an unsigned number, and where the carry went.
3. Implement HalfAdder, FullAdder, Add16 and Inc16, which adds 1.
4. Commit.

### Done when

The four tests pass. Your paper answers match Python. You can explain why one adder handles both signed and unsigned numbers, and why 32767 plus 1 gives -32768.

## The ALU

The adder is one part of the CPU's arithmetic. This step wraps it in the chip that computes everything a Hack instruction can ask for.

The **arithmetic logic unit** (ALU) is the part of a CPU that computes. The Hack ALU takes two 16-bit inputs, `x` and `y`, and six **control bits** that choose what it computes. It always runs the same stages in the same order, and each control bit turns one stage on or off:

- `zx` and `zy` replace `x` or `y` with 0.
- `nx` and `ny` flip every bit of `x` or `y`.
- `f` chooses between `x + y` and `x & y`, the bitwise And, which applies And to each pair of bits.
- `no` flips every bit of the result.

Two more outputs, the **flags**, describe the result. `zr` is 1 when the result is 0, and `ng` is 1 when it is negative.

Every row of the ALU's table follows from one fact: flipping all bits of a number `a` gives `-a - 1`. Try it on 5: flipping `0000 0000 0000 0101` gives `1111 1111 1111 1010`, which is 0xFFFA, the pattern of -6. The figure follows `x - y` through the stages:

![The ALU computes x - y with zx=0 nx=1 zy=0 ny=0 f=1 no=1: x is flipped to -x-1, added to y to give y-x-1, and the result is flipped to x-y. The flags zr and ng come from the final output.](figures/03-alu.svg)

HDL has no `if`. To make a stage optional, compute both versions and let a Mux16 pick one, with the control bit as `sel`. `ng` is bit 15 of the result. A wire inside a chip cannot be split into bits afterwards, so take the bits you need where a part's output is connected, as in `out[15]=ng` and `out[0..7]=low`.

### Study

- [Nand2Tetris, chapter 2: Boolean Arithmetic](https://www.nand2tetris.org/_files/ugd/44046b_89c60703ebfc4bf39acef13bdc050f5d.pdf) (read, 30 min): Section 2.2.2 with the ALU table, the ALU paragraph of 2.3, and 2.5 Project. Skip 2.4 Perspective.

### Build

1. On paper, derive the control bits for `y - x` and for `x + 1` from the flip fact, the way the figure does for `x - y`. Check them against the ALU table in 2.2.2.
2. Implement the ALU in two passes. Get `out` right against `ALU-basic.tst` first. Then add `zr` and `ng` and pass `ALU.tst`.
3. Commit.

### Done when

Both ALU tests pass. Your paper answers match the book's table. You can point at the line in your ALU where `ng` comes from.

## A bit that remembers

Every chip so far is combinational. Change its inputs and the old outputs are gone. A computer has to carry values from one step to the next, so it needs **sequential** chips, whose outputs also depend on what happened before. Those need a clock.

A **clock** is a signal that switches between 0 and 1 at a steady rate. One **clock cycle** is one step of the machine. The simulator splits each cycle into two halves, a tick and a tock, and its clock button advances one half per click. So two clicks make one cycle. In a test script, `tick` and `tock` run the two halves.

The **data flip-flop** (DFF) is the one new **primitive** chip, a chip the simulator supplies because this course does not build it from Nand. Its output during this cycle is whatever its input was during the previous cycle. It can be built from gates wired in a loop, and Petzold's pages below let you click through such a loop.

A **register** keeps a value until it is told to replace it. The one-bit register, Bit, is a DFF plus a Mux. The Mux feeds the DFF either the new input or the DFF's own output, and the `load` input chooses:

![The one-bit register: the Mux feeds the DFF either in or the DFF's own output, chosen by load, and the wire from out back to the Mux keeps the value while load is 0.](figures/03-bit.svg)

The wire from the DFF's output back to the Mux is a **feedback loop**. While `load` is 0, the DFF receives its own value every cycle, so it keeps it. When `load` is 1, `out` shows the new value from the next cycle on:

![Four cycles of a Bit that starts at 0: in is 1 during cycle 2, but load is 0 then, so nothing is stored. In cycle 3 both are 1, and out shows the 1 only from cycle 4.](figures/03-bit-timing.svg)

A 16-bit Register is 16 Bits that share one `load` wire. The registers of chapter 02 are the same idea at 64 bits.

> **Practice:** Write down what you expect before you run anything. A wrong guess shows you where your picture of the chip is wrong.

### Study

- [Nand2Tetris, chapter 3: Sequential Logic](https://www.nand2tetris.org/_files/ugd/44046b_1801b5682e4d4a67bd05e14235665d8b.pdf) (read, 40 min): Sections 3.1, 3.2.1 and 3.2.2, then the paragraphs Flip-Flop, 1-Bit Register and Register in 3.3. Figure 3.1 is the Bit you build.
- [Nand2Tetris, Appendix 2: Hardware Description Language](https://drive.google.com/file/d/1dPj4XNby9iuAs-47U9k3xtYy9hJ-ET0T/view?usp=sharing) (reference, as needed): A2.4 Sequential chips only, for how the built-in DFF and clocked chips appear in HDL.
- [Code, interactive illustrations: chapter 17](https://codehiddenlanguage.com/Chapter17/) (do, 30 min): From "First Flip-Flop" through "Eight-Bit Accumulating Adder". Toggle the inputs and watch the output hold after the input goes away. Compare the level-triggered and edge-triggered D-type flip-flops. The Nand2Tetris DFF behaves like the edge-triggered one.

### Build

1. Implement Bit and Register from project 3.
2. Load Bit in the simulator. Run four cycles with these inputs: `in=1, load=0`, then `in=1, load=1`, then `in=0, load=0`, then `in=0, load=1`. For each cycle, set the inputs, write down what `out` will be at the start of the next cycle, then click the clock button twice and compare.
3. Commit.

### Done when

The Bit and Register tests pass, and your four predictions matched. You can explain why Bit needs the Mux, and what goes wrong if the DFF's output is wired straight back to its own input.

## RAM and the memory map

One register holds one number. A program needs thousands of them, each one found by its number.

**RAM** (random access memory) is a row of registers with an **address** input that picks one of them. Each register holds one **word**, here 16 bits. RAM8 is eight Registers. All eight see the same `in`, but a DMux8Way passes `load` only to the register the address picks. A Mux8Way16 passes that same register's output to `out`:

![RAM8 with address 5: the in bus reaches all eight registers, the DMux8Way sends load only to register 5, and the Mux8Way16 passes register 5's output to out.](figures/03-ram8.svg)

Bigger RAM is built from smaller RAM. RAM64 is eight RAM8 chips, and its 6-bit address splits in two. The high 3 bits pick a RAM8, and the low 3 bits pick a register inside it:

```
  RAM64, address 43 = 101 011
                      |   |
                      |   +--- register 3 inside that RAM8
                      +------- RAM8 number 5
```

The same split repeats up to RAM16K, with 16384 words and a 14-bit address. The address in chapter 02's `movl (%rdi), %eax` picks memory the same way. x86-64 memory holds one byte per address, so that `movl` reads the four bytes at `rdi` to `rdi + 3`.

The CPU sees one data memory, the Memory chip of project 5. It joins RAM16K, the screen and the keyboard into one range of addresses. The **screen** is 8192 words in which each bit is one pixel, and writing a word there changes the picture. The **keyboard** is one word that holds the code of the key being pressed, or 0. As in your RAM64, the top address bits pick the part:

![Hack's data memory from address 0 down: RAM16K, then the screen from 16384, then the keyboard at 24576, and the top two bits of the 15-bit address pick the part.](figures/03-memory-map.svg)

### Study

- [Nand2Tetris, chapter 3: Sequential Logic](https://www.nand2tetris.org/_files/ugd/44046b_1801b5682e4d4a67bd05e14235665d8b.pdf) (read, 20 min): Section 3.2.3 Memory and the paragraphs 8-Register Memory and n-Register Memory in 3.3.
- [Nand2Tetris, chapter 5: Computer Architecture](https://www.nand2tetris.org/_files/ugd/44046b_552ed0898d5d491aabafd8a768a87c6f.pdf) (read, 30 min): Sections 5.2.4 Input / Output, 5.2.6 Data Memory and 5.3.2 Memory. The rest of the chapter waits for the CPU.

### Build

1. Implement RAM8, RAM64, RAM512, RAM4K and RAM16K from project 3, in that order.
2. Implement Memory from project 5, with the built-in Screen and Keyboard chips, and pass `Memory.tst`.
3. Commit.

### Done when

The five RAM tests and `Memory.tst` pass. You can say which address bits RAM4K uses to pick one of its eight RAM512 parts, and which part of Memory the address 24575 reaches.

## The program counter

A CPU runs a program one instruction at a time, so it has to keep track of where it is. This step builds the register that does.

The **program counter** (PC) is a register that holds the address of the next instruction. Each cycle it does one of four things. The first case that applies wins:

```
  reset  load  inc    out in the next cycle    example: out = 7, in = 100
    1     any   any    0                         0
    0      1    any    in                        100
    0      0     1     out + 1                   8
    0      0     0     out, unchanged            7
```

A **jump** is the PC loading a new value instead of adding 1. On x86-64 the PC is `%rip`, and the `jne` at the bottom of chapter 02's `str_len` loop loads it with the address of the loop's top.

### Study

- [Nand2Tetris, chapter 3: Sequential Logic](https://www.nand2tetris.org/_files/ugd/44046b_1801b5682e4d4a67bd05e14235665d8b.pdf) (read, 20 min): Section 3.2.4 Counter, the Counter paragraph of 3.3, and 3.5 Project. Skip 3.4 Perspective. Figure 3.5, the counter timing table, is the model for the paper exercise.

### Build

1. Before building PC, copy the input rows of figure 3.5, cover its `out` row, and fill it in yourself. Then do the same for this sequence, starting from `out = 0`: `inc=1` for three cycles, then `load=1` with `in=100` for one cycle, then `inc=1` again for two cycles, then `reset=1` for one cycle.
2. Implement PC.
3. Commit.

### Done when

The PC test passes. Your paper `out` rows match the book's figure and the simulator. You can say what PC does in a cycle where `reset`, `load` and `inc` are all 1.

## Hack assembly

You have the parts of a CPU but not yet the CPU. Before you wire it, write programs for it. The **instruction set**, the list of instructions a CPU understands, says what the CPU must do, so programming it first tells you what to build.

Hack has two registers. `D` holds a value. `A` holds a value or an address. `M` is the RAM word at the address in `A`, so writing `M` reads or writes memory:

![After @21, register A holds 21, so M names RAM[21], which holds 7, and D=M+1 puts 8 into D.](figures/03-hack-model.svg)

There are two kinds of instruction. An **A-instruction** such as `@21` puts a number into `A`. A **C-instruction** computes and has three parts, written `dest=comp;jump`:

- `comp` is one of the ALU's functions, such as `M+1` or `D-A`. It is the one part every C-instruction has.
- `dest` names where the result goes: any of `A`, `D` and `M`.
- `jump` compares the result with 0. If the test passes, the PC loads the address in `A`. `JGT` jumps when the result is greater than 0, `JEQ` when it is 0, and `JMP` always.

A jump takes two instructions: an A-instruction that puts the target address in `A`, then a C-instruction with a jump part. You can name an instruction's address with a line such as `(LOOP)` and write `@LOOP` to use it, as section 4.2.4 shows. The last two steps explain how such names become numbers.

Hack has no separate load and store instructions. It names RAM[0] to RAM[15] `R0` to `R15`, so `@R0` is `@0`. Following a pointer kept in RAM takes three instructions: `@R0`, then `A=M` puts the address stored in RAM[0] into `A`, then `D=M` reads the word it points at.

### Study

- [Nand2Tetris, chapter 4: Machine Language](https://www.nand2tetris.org/_files/ugd/44046b_d70026d8c1424487a451eaba3e372132.pdf) (read, 1 h 15 min): Sections 4.1, 4.2 and 4.4. Skip 4.3 Perspective. In 4.2.2 and 4.2.3, read the symbolic forms and the mnemonic columns of figures 4.3 to 4.5. The binary forms wait for the next step.
- [Online IDE: CPU Emulator guide](https://nand2tetris.github.io/web-ide/user_guide/cpu.pdf) (reference, as needed): One page on loading a program, setting RAM values, stepping, and running a test script.

### Build

Write each program in your editor in Ubuntu and save it in its folder under `nand2tetris/projects/4`. Then load it in the IDE's [CPU Emulator](https://nand2tetris.github.io/web-ide/cpu), which reads the same folder. If a file you created does not show, refresh the page.

1. `Mult.asm` in `projects/4/mult` computes `R2 = R0 * R1` by repeated addition. Assume both inputs are 0 or more and that the product fits. Test it with `Mult.tst`.
2. `Fill.asm` in `projects/4/fill` loops forever. While any key is held, it blackens every pixel of the screen. When no key is held, it clears every pixel. The screen has 256 rows of 32 words each, 8192 words from `SCREEN` (16384) on, so the loop covers 8192 addresses. `KBD` (24576) holds the code of the key being pressed, or 0. Test by hand with the keyboard enabled, then with `FillAutomatic.tst`.
3. `Sum.asm` adds up an array. R0 holds the address of the first element, R1 the number of elements, and the program writes the sum to R2. In C it is a loop over `p[i]` with a pointer and a length, as in chapter 02. Here the pointer waits in RAM, so the loop needs the `A=M` pattern. Create its folder with `mkdir nand2tetris/projects/4/sum` and save it as `Sum.asm` there. There is no test script, so set RAM by hand in the emulator: R0 = 100, R1 = 5, and RAM[100] to RAM[104] = 3, 1, 4, 1, 5.
4. Commit.

### Done when

`Mult.tst` and `FillAutomatic.tst` pass, and `Fill.asm` works by hand. `Sum.asm` leaves 14 in R2 for the array above, and 0 when R1 is 0. For each line of `Mult.asm` you can say what `A`, `D` and `M` hold after it runs.

## Hack machine code

The CPU you build next does not read text. It reads numbers, and this step shows how each instruction becomes one.

**Machine code** is the instructions as the numbers the CPU reads. Every Hack instruction is one 16-bit word, and bit 15 tells the two kinds apart. An A-instruction is a 0 followed by its number in 15 bits. A C-instruction starts with three 1s and then packs its three parts into fixed fields:

![Machine code for @21 is a 0 followed by 21 in 15 bits. A C-instruction is a 1, two unused 1 bits, the a bit, six comp bits, three dest bits and three jump bits.](figures/03-instruction-fields.svg)

The six comp bits are your ALU's control bits in order, `zx nx zy ny f no`. The `a` bit chooses whether the ALU reads `A` or `M`. So `M+1` and `A+1` share their six comp bits and differ only in `a`.

The three dest bits are one bit each for `A`, `D` and `M`, in that order. `D` alone is `010`, and `MD` is `011`. The three jump bits are one bit each for "less than 0", "equal to 0" and "greater than 0". `JGT` is `001`, and `JMP` is `111`, which jumps in all three cases.

The CPU uses these bits directly. In the next step, the comp bits become wires to the ALU's control pins, and the dest bits become the `load` pins of the registers.

### Study

- [Nand2Tetris, chapter 4: Machine Language](https://www.nand2tetris.org/_files/ugd/44046b_d70026d8c1424487a451eaba3e372132.pdf) (reference, as needed): Back to 4.2.2 and 4.2.3, now for the binary forms: the A-instruction's bit layout and the bit columns of figures 4.3, 4.4 and 4.5. Your assembler encodes from these tables later, so mark the page.

### Build

1. On paper, encode the first six instructions of `projects/6/max/MaxL.asm`: `@0`, `D=M`, `@1`, `D=D-M`, `@10`, `D;JGT`.
2. Compare your six words with the first six lines of `nand2tetris/projects/5/Max.hack`, which the official assembler produced.
3. On paper, decode `1110110000010000` and `1111110111001000` back into assembly.

### Done when

Your six hand-encoded words match `Max.hack`. Your two decoded instructions are `D=A` and `M=M+1`. You can say which bit of a C-instruction tells the ALU to read `M` instead of `A`.

## The CPU and the computer

The programs of the Hack assembly step ran on the IDE's built-in CPU. Now you build your own from the ALU, the registers and the PC, and the same kind of program tests it.

The program sits in **ROM** (read-only memory), which the CPU reads instructions from and never writes. Hack keeps the program in ROM and the data in RAM, two separate memories. x86-64 keeps both in one memory, so `%rip` holds an address in the same memory that `movl` reads. Once per clock cycle, the CPU goes around one loop:

![The CPU's loop: fetch the instruction at ROM[PC], decode its bits into control wires, execute it in the ALU and store the result, then set the PC to A on a jump or to PC + 1 otherwise.](figures/03-cpu-loop.svg)

A real x86-64 CPU runs the same loop on several instructions at once. Chapter 07 measures what that does.

The decode step needs no decoder chip. The instruction's bits go straight to the parts as control wires:

![Inside the Hack CPU: the instruction's bits drive the select pins of the two Mux16s, the load pins of A and D, the ALU's six control pins, writeM and the jump logic that loads the PC.](figures/03-cpu-datapath.svg)

Bit 15 picks what `A` loads: the instruction itself for an A-instruction, the ALU's output for a C-instruction. The `a` bit picks whether the ALU's `y` input is `A` or `inM`, the word read from RAM.

The dest bits `d1`, `d2` and `d3` become the `load` pins of `A` and `D` and the `writeM` output. `writeM` tells memory to store `outM`, the ALU's output, at `addressM`, the address held in `A`. The jump logic combines the three jump bits with `zr` and `ng` into the PC's `load`. An A-instruction must not write `D` or `M` or jump, so those wires also check bit 15.

The Computer chip wires ROM32K, the CPU and your Memory together.

### Study

- [Nand2Tetris, chapter 5: Computer Architecture](https://www.nand2tetris.org/_files/ugd/44046b_552ed0898d5d491aabafd8a768a87c6f.pdf) (read, 1 h 30 min): Sections 5.1, 5.2.1 to 5.2.3, 5.2.7, 5.3.1, 5.3.3 and 5.4. Skip 5.5 Perspective. You implement diagram 5.8, the proposed CPU. Section 5.3.1 explains it without giving the jump logic away.
- [Nand2Tetris, Appendix 4: The Hack Chip Set](https://drive.google.com/file/d/1IsDnH0t7q_Im491LQ7_5_ajV0CokRbwR/view?usp=sharing) (reference, as needed): One page with the pins of every chip, including the built-in ARegister, DRegister and ROM32K. Copy the pin names from it instead of retyping them.

### Build

1. Implement the CPU with the built-in ARegister and DRegister, as the book suggests. They behave like your Register, and the simulator shows their values. Build it in three passes:
   1. A-instructions only, with the PC always adding 1.
   2. C-instructions without jumps.
   3. Jumps. First write a table on paper with one row per `j1 j2 j3` value from figure 4.5 of chapter 4, and four columns for `zr` and `ng`: both 0, `zr` only, `ng` only, both 1 (which never happens). Fill each cell with the PC's `load` bit. JGT, for example, loads when neither `zr` nor `ng` is 1. Write your HDL from the table.

   The early passes fail parts of `CPU.tst`. Use the failing rows in the diff table to check that only the instructions you have not handled yet fail. Then pass `CPU.tst` and `CPU-external.tst`.
2. Implement Computer. Before running `ComputerMax.tst`, read it. Its first run puts 3 in RAM[0] and 5 in RAM[1] and then runs 14 clock cycles. On paper, follow `MaxL.asm` with those values and write down PC, `A` and `D` after each of the first eight cycles. Then run the test and compare your page with its output, which lists `A`, `D` and PC after every cycle.
3. Pass `ComputerAdd.tst`, `ComputerMax.tst` and `ComputerRect.tst`, and commit.

### Done when

All five tests pass. Your paper trace of Max matches the simulator cycle by cycle. For the instruction `D;JGT` you can name every wire in your CPU that its bits drive, and say what value each one carries when `D` is 2.

## An assembler in C, without symbols

The CPU runs 16-bit words, and you write text. An **assembler** is the program that turns assembly text into machine code. For Hack the translation is a table lookup per field plus one number to convert, and this step writes it in C.

This step handles programs that use only numbers. Project 6 has symbol-less versions of three programs, `MaxL.asm`, `RectL.asm` and `PongL.asm`. They are Max, Rect and Pong with every label and variable already replaced by its number. Labels and variables come in the next step.

Most of the program is chapter 02's word counter with a different input. It reads all of standard input into a growing buffer, then works through it one line at a time:

![The assembler cleans one line, splits it into its dest, comp and jump fields, looks each field up in its table, and combines the three codes into one 16-bit word.](figures/03-encode-line.svg)

Keep each table as an array of structs, one row per **mnemonic**, the short name such as `MD` or `JGT` that a field holds. Chapter 02 used array initializers and struct initializers separately. Together they take one brace pair per row:

```c
struct Code { const char *text; unsigned bits; };
static const struct Code dest_table[] = { {"M", 1}, {"D", 2}, {"MD", 3} };
```

The rest of the rows go after the first three. `unsigned` is short for `unsigned int`, a 32-bit type with no negative values. A field is a slice of the line with no terminator of its own. So compare it with a row using `strncmp(field, row.text, n) == 0 && row.text[n] == '\0'`, where `n` is the field's length. Entry 26.5 of the Beej `string.h` reference from chapter 02 says what `strncmp` returns.

To build the word, shift each code into its place with `<<` and combine the codes with `|`. `x << n` moves the bits of `x` left by `n` places, so `5 << 3` turns `101` into `101000`, which is 40. `|` is the bitwise Or, so `0x28 | 0x1` is `0x29`. To print it, test `(word >> i) & 1` for `i` from 15 down to 0.

> **Practice:** Check your output against a reference with `diff`. Silence from `diff` is a stronger check than reading the output yourself.

### Study

- [Nand2Tetris, chapter 6: Assembler](https://www.nand2tetris.org/_files/ugd/44046b_b73759b866b249a0b3a715bf5a18f668.pdf) (read, 1 h): Sections 6.1, 6.2.1, 6.2.2, 6.2.4 and 6.3.1 to 6.3.3. The book proposes Parser and Code modules. In C they become functions in one file. Leave 6.2.3 and 6.3.4 on symbols for the next step.
- [Beej's Guide to C: Bitwise Operations](https://beej.us/guide/bgc/html/split/bitwise-operations.html) (read, 15 min): Sections 24.1 and 24.2. Note the warnings about shifting by more than the width of the type and about right-shifting negative numbers. Keep your instruction words in an `unsigned` type.

### Build

1. Write `src/hasm.c` with `#include "counted.h"` from chapter 02, these functions, and a `main` that ties them together:
   - `bool parse_line(const char *line, size_t len, char *out, size_t cap)` copies the line into `out` without its comment and without spaces, and returns false if it does not fit. A **line ending** is the character that ends a line of text. Linux ends lines with `\n`, and Windows with the two characters `\r\n`. Every file from `projects.zip` uses `\r\n`, so treat `\r` as a space.
   - `bool encode_a(const char *s, unsigned *word)` converts the digits after `@`. The digit characters have consecutive codes, so `c - '0'` is the value of the digit `c`, and each digit does `value = value * 10 + (c - '0')`. It returns false on a non-digit or a value above 32767.
   - `bool encode_c(const char *s, unsigned *word)` encodes a whole C-instruction and returns false on any unknown field. To split the fields, find the `=` and the `;` with a loop over the characters, or with `strchr`. Entry 26.8 of the same Beej reference says that `strchr` returns a pointer to the first match, or `NULL`. The copies of Rect and Pong built into the IDE, the ones it shows in browser storage, write `DM` where the book writes `MD`. Accept both for the same bits.
   - `void word_to_bits(unsigned word, char out[17])` writes the 16 characters `'0'` and `'1'` for bits 15 down to 0, then the terminator.
   - `bool assemble(const char *text, struct Words *out)` translates a whole program into a growable array of words, `struct Words { unsigned *data; size_t len; size_t cap; }`. Grow it like chapter 02's `Vec`, with `counted_realloc`. On an error it prints the line number and the line to `stderr` and returns false.
   - `main` reads standard input, calls `assemble`, prints each word with `word_to_bits` and `printf` on a line of its own, frees everything and returns 0, or 1 after an error.
2. Write `tests/hasm_test.c` in the test pattern of chapter 02 and run it with `sh tests/run_test.sh hasm`. Test:
   - `encode_c("D=M+1;JGT")` gives 0xFDD1, `"0;JMP"` gives 0xEA87, `"M=D"` gives 0xE308, `"AM=M-1"` gives 0xFCA8, and `"DM=M+1"` gives the same word as `"MD=M+1"`.
   - `encode_a("21")` gives 0x0015, `"32767"` passes, and `"32768"`, `""` and `"2x"` fail.
   - `"D=Q"`, `"D=M;JXX"` and `"X=D"` fail.
   - `parse_line` on `"  // only a comment"` gives an empty string, and on `"\tD=A  // c\r"` gives `"D=A"`.
   - `word_to_bits(0xFDD1, s)` gives `"1111110111010001"`.
   - `assemble` on `"@2\nD=A\n@3\nD=D+A\n@0\nM=D\n"` gives the six words of `Add.hack`, and on `"@2\nD=Q\n"` returns false. The counters balance after every test.
3. Build with `sh build.sh hasm`. Copy project 6's programs into a directory of their own with `mkdir -p hack && cp nand2tetris/projects/6/*/*.asm hack/`. Add the line `hack/` to `.gitignore`, so git leaves these copies and your outputs alone.
4. Assemble `Add.asm`, `MaxL.asm`, `RectL.asm` and `PongL.asm`, for example `./out/Linux-debug/hasm < hack/MaxL.asm > hack/MaxL.hack`.
5. Project 5's folder holds `Add.hack`, `Max.hack` and `Rect.hack` from the official assembler, the same programs as project 6's `Add.asm`, `Max.asm` and `Rect.asm`. Their lines end in `\r\n` and yours in `\n`. `tr -d '\r'` deletes every `\r`, so compare like this:

   ```sh
   tr -d '\r' < nand2tetris/projects/5/Max.hack > hack/Max.ref
   diff hack/Max.ref hack/MaxL.hack
   ```

6. Pong has no reference file yet. Check that `wc -l hack/PongL.hack` prints 27483, one line per instruction. The next step compares it with your output for `Pong.asm`.
7. Commit `src/hasm.c`, `tests/hasm_test.c` and `.gitignore`.

> **Optional:** The IDE's [Assembler](https://nand2tetris.github.io/web-ide/asm) can compare your PongL output with its own. Load `PongL.asm`, translate it, and paste your file into the "Compare code" panel. `clip.exe < hack/PongL.hack` runs the Windows clipboard program from Ubuntu and copies the file for pasting.

### Done when

`sh tests/run_test.sh hasm` passes with no ASan, UBSan or LeakSanitizer report. `diff` prints nothing for Add, MaxL and RectL, and `hack/PongL.hack` has 27483 lines. Delete the `MD` row from your dest table on purpose and confirm that RectL and PongL then fail with an error that names a line. Put the row back.

## Labels, variables and Pong

The last piece is names. A **label** like `(LOOP)` names the address of the instruction after it. A **variable** like `@sum` names a RAM word that the assembler picks. **Predefined symbols** such as `R0` to `R15`, `SCREEN` and `KBD` have fixed values.

All three kinds live in one **symbol table**, which maps a name to a number. You built the same shape in chapter 02: the word counter's table of owned strings, where the count is now an address.

A jump can name a label that appears further down the file, so the assembler reads the program twice:

![Pass 1 counts instructions and records each label, here END = 6. Pass 2 encodes every line, looks up END, and gives the new variables n and sum the addresses 16 and 17.](figures/03-two-passes.svg)

- The first pass counts instructions and adds each label with the count at that point. A label line is not an instruction, so it does not move the count.
- The second pass encodes every instruction. An `@` followed by a digit is a number. An `@name` already in the table gets its value. Any other `@name` is a new variable and gets the next free RAM address, starting at 16.

The table owns a heap copy of every name and frees them all at the end, like `table_free` in chapter 02.

Pong has about 27,000 instructions and nearly 900 labels. A linear scan of the table for every `@` line still finishes in well under a second, so keep the scan. Chapter 04 replaces the word counter's linear scan with a hash trie, the structure that would also speed up this table, and chapter 07 measures what its lookups cost.

### Study

- [Nand2Tetris, chapter 6: Assembler](https://www.nand2tetris.org/_files/ugd/44046b_b73759b866b249a0b3a715bf5a18f668.pdf) (read, 30 min): Sections 6.2.3, 6.3.4, 6.3.5 and 6.5. Section 6.2.3 has the table of predefined symbols your table starts with.

### Build

1. Add a symbol table to `src/hasm.c`, with every allocation through chapter 02's counted wrappers:
   - `bool sym_add(struct SymTable *t, const char *name, size_t len, unsigned value)` copies the name and returns false if the copy or the growth fails.
   - `bool sym_find(const struct SymTable *t, const char *name, size_t len, unsigned *value)`.
   - `void sym_free(struct SymTable *t)` frees every name and the array.
   - A function that loads the 23 predefined symbols.
2. Change `assemble` to make the two passes.
3. Extend `tests/hasm_test.c`:
   - Through `assemble`: a program that uses `@i` and then `@sum` gives `i` address 16 and `sum` address 17.
   - A label used before its definition resolves to the right instruction number.
   - `@LOOP` and `@loop` are different symbols.
   - A label defined twice is an error.
   - A failed allocation in `sym_add` leaves the table unchanged, and the counters balance after every test.
4. Assemble `Max.asm`, `Rect.asm` and `Pong.asm`. Each must give exactly the output your previous step gave for its symbol-less version:

   ```sh
   ./out/Linux-debug/hasm < hack/Pong.asm > hack/Pong.hack
   diff hack/Pong.hack hack/PongL.hack
   ```

5. Copy your `Pong.hack` into `nand2tetris/projects/6/pong`, refresh the IDE, load the file into the CPU Emulator, enable the keyboard and play a round.
6. Commit.

### Done when

`diff` prints nothing for Max, Rect and Pong. The tests pass with balanced counters and no sanitizer report. You played a round of Pong on code your assembler produced.

## Where this leads

You built a computer from Nand gates and wrote the tool that produces its programs. You can say what a register is, how RAM picks a word by its address, how an instruction's bits drive the ALU and the registers, and how the program counter picks the next instruction. Hack is a minimal machine, though. It has one size of number, no bytes, no stack and no call instruction, and real C programs on x86-64 break in ways Hack cannot show you.

The next chapter, "C properly: memory, undefined behavior, arenas", goes back to C with the machine model from this one. It starts where your ALU stopped: the same two's complement bits, now 8 to 64 bits wide, with C's integer types and the rules that convert between them. Then come the bits of floating-point numbers, the code the compiler is allowed to assume never runs, and arenas, which replace one `malloc` per object with one large block. The word counter comes back on an arena with a hash trie, and the line parsing you did here grows into a JSON parser.
