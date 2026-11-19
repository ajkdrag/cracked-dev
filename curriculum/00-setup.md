---
id: 00
title: Setup
part: The machine and C
weeks: 1
project: Ubuntu under WSL2 with clang and gdb installed, and one C program compiled and run.
---

You know Python, git and a terminal. This book takes you from there to a tensor library you write yourself, by way of C, hardware, assembly, operating systems, compilers and GPUs. Every chapter asks you to write C, run it and find out why it did what it did. This chapter gets your laptop ready for that, and it should take one evening.

Each chapter is a list of steps. A step explains one idea and then gives you three things: a Study list, a Build and a "Done when" check. Work through them in that order: read the step's opening text, do the Study items, and only the sections their notes name, then do the Build. When a Build item stalls, look back at the Study item. A step ends when its "Done when" check passes.

Plan on about 12 hours a week. Spend most of it on the Build, with the program in front of you, and about a quarter on reading. Once a week, write a few lines in your notes on what you built and what confused you. A box that starts with **If it fails:** covers a problem your machine may have, and a box that starts with **Optional:** is extra work that never blocks the next chapter.

## Ubuntu under WSL2

The tools in this book run on Linux, and your laptop runs Windows. **WSL2** (Windows Subsystem for Linux, version 2) runs a real Linux system next to Windows on the same laptop. It does this with a **virtual machine**, a computer that Windows creates in software on top of your real CPU. Inside it runs **Ubuntu 24.04**, the Linux distribution this book uses. Every command in the book runs there, and the package names in the book are the ones Ubuntu 24.04 uses.

![Windows runs a WSL2 virtual machine, and Ubuntu 24.04 runs inside it on the same x86-64 CPU.](figures/00-wsl.svg)

The install command names the release with `-d Ubuntu-24.04`. A plain `wsl --install` installs whatever Ubuntu release is newest, and its package names may not match the book.

> **If it fails:** If the install stops with error `0x80370102`, Windows cannot start the virtual machine. Turn on virtualization in the BIOS or UEFI setup, the settings screen you reach by pressing a key (often F2 or Del) while the laptop starts. Then open "Turn Windows features on or off" from the Start menu, tick "Virtual Machine Platform", restart, and run the command again. Microsoft's [WSL troubleshooting page](https://learn.microsoft.com/en-us/windows/wsl/troubleshooting) lists that error and the other install failures.

### Study

- [Microsoft: Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install) (do, 30 min): "Prerequisites", "Install WSL command", "Change the default Linux distribution installed", "Set up your Linux user info" and "Check which version of WSL you are running". Skip the rest.

### Build

1. Open PowerShell, the Windows command line, with "Run as administrator" and run `wsl --install -d Ubuntu-24.04`.
2. Restart Windows when the installer asks.
3. Open "Ubuntu 24.04" from the Start menu. Pick a Linux user name and password when it asks. The password does not show while you type it.
4. In the Ubuntu window, run `uname -m`. It prints the kind of CPU Linux runs on.
5. In PowerShell, run `wsl -l -v`. It lists the installed Linux systems and the WSL version of each.

### Done when

`wsl -l -v` lists `Ubuntu-24.04` with version 2, and `uname -m` in Ubuntu prints `x86_64`, Linux's name for your laptop's x86-64 CPU.

## clang and gdb

Ubuntu installs software from **packages**, files that each hold one piece of software. **apt** is the program that downloads them from Ubuntu's servers and installs them, along with every package they need. `sudo` in front of a command runs it as the administrator. It asks for the password you picked in the last step.

This book needs two programs to start with. **clang** is a C compiler: it turns the C you write into a program the CPU can run. **gdb** is a debugger: it stops a running program so you can look inside it. Chapter 01 explains both.

Three commands set them up:

1. `sudo apt update` downloads the current list of packages, so that apt finds the newest versions.
2. `sudo apt upgrade -y` installs newer versions of everything already on the system. `-y` answers yes to apt's question about using disk space.
3. `sudo apt install -y clang gdb manpages-dev` installs the tools. `manpages-dev` adds the manual pages for C functions, which chapter 01 shows you how to read.

### Study

- [Microsoft: Set up a WSL development environment](https://learn.microsoft.com/en-us/windows/wsl/setup/environment#update-and-upgrade-packages) (read, 5 min): The section "Update and upgrade packages" only. The Build runs both of its commands. Run them again every few weeks.

### Build

1. In Ubuntu, run `sudo apt update`.
2. Run `sudo apt upgrade -y`.
3. Run `sudo apt install -y clang gdb manpages-dev`.
4. Run `clang --version` and `gdb --version`.

### Done when

The upgrade and the install ended without an error. The first line of `clang --version` starts with `Ubuntu clang version 18`, and the first line of `gdb --version` starts with `GNU gdb (Ubuntu 15`.

## A home for your code

Your work goes in one directory per project, and that directory lives in Ubuntu's own file system, under your Linux **home directory**, `/home/<you>`. The shell writes the home directory as `~`. Ubuntu can also see your Windows drives under `/mnt/c`, but every file read or write there crosses from the virtual machine to Windows and back. Builds and `git` are many times slower there, so keep projects under `~`.

![Projects live in Ubuntu's own file system under the home directory, and the Windows drive under /mnt/c is reachable but slow.](figures/00-files.svg)

Use any editor you like, for example `nano`, which runs in the terminal (Ctrl+O saves and Ctrl+X quits).

### Study

- [Microsoft: Set up a WSL development environment](https://learn.microsoft.com/en-us/windows/wsl/setup/environment#file-storage) (read, 5 min): The section "File storage" only. It says where to keep project files and shows the slow path to avoid.

### Build

1. Run `mkdir -p ~/code/hello`. `mkdir` makes a directory, and `-p` also makes `~/code` on the way.
2. Run `cd ~/code/hello`, then `pwd`, which prints the directory you are in.

### Done when

`pwd` prints `/home/<you>/code/hello`, a path under `/home` and not under `/mnt/c`.

## Hello, world

The last step checks that the whole chain works: you write C, clang turns it into a program, and the program runs. This is the program, `hello.c`:

```c
#include <stdio.h>

int main(void) {
    printf("hello, world\n");
    return 0;
}
```

`#include <stdio.h>` makes the standard input and output functions available, `printf` among them. `main` is the function that runs when the program starts. `printf` prints its text, and `\n` ends the line. `return 0` ends the program and reports success. Beej explains `#include` and `main` in the reading below.

![clang reads hello.c and writes a.out, a file of machine code, and running ./a.out prints hello, world.](figures/00-compile.svg)

`clang hello.c` compiles the file. With no other instructions, clang names the program it writes `a.out`. `./a.out` runs it. The `./` means "the file `a.out` in this directory", and chapter 01 shows why the shell needs it.

### Study

- [Beej's Guide to C: Hello, World!](https://beej.us/guide/bgc/html/split/hello-world.html#hello-world-1) (read, 15 min): Section 2.2 only. Where Beej types `gcc -o hello hello.c`, type `clang hello.c` for now. Chapter 01 explains `gcc` and `-o`.

### Build

1. In `~/code/hello`, run `nano hello.c` and type the program. Press Ctrl+O, then Enter to keep the name `hello.c`, then Ctrl+X to quit.
2. Run `clang hello.c`, then `ls`. A new file `a.out` sits next to `hello.c`.
3. Run `./a.out`.

### Done when

`./a.out` prints `hello, world`, and `ls` shows `a.out` next to `hello.c`.

## Where this leads

You have Ubuntu under WSL2, clang and gdb, a project directory in your Linux home directory, and a C program that you compiled and ran. You typed every command on trust. You do not yet know what is inside `a.out`, what started it, or why it needs the `./`.

The next chapter, "How a program runs", answers those questions from the bottom up: bytes and memory, the CPU, the operating system, the shell and the compiler. Then it gives you the three tools every later chapter uses: a build script with warnings turned on, sanitizers that stop a program at a memory bug, and gdb.
