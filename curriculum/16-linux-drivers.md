---
id: 16
title: Linux drivers
part: Kernels and bare metal
weeks: 4
project: A Linux driver for QEMU's edu PCI device that exposes a character device with blocking reads, handles the device's interrupt with work deferred to a kernel thread, and maps an event ring into user space, all loaded into a kernel you compile yourself and boot in QEMU.
---

Chapter 15 ended with a kernel of your own running in QEMU. You filled in the interrupt table, acknowledged the interrupt controller by hand, built page tables, switched between two tasks and ran a user program that came back into your kernel through a system call. Every device that kernel touched needed code you wrote from the register level up.

Linux supports thousands of devices, so it splits the work. The kernel core owns the interrupt entry path, the page tables, the scheduler and the file system. A **driver** is the code that knows one kind of device. It fills in interfaces that the core calls: a table of functions for when a process opens, reads or maps a file in `/dev`, a `probe` function for when the kernel finds a matching device on a bus, and an interrupt handler for when the device signals. In this chapter you write one driver that does all three, for a device that QEMU emulates for teaching.

You will not load your code into the kernel that runs WSL2. Building modules for it needs Microsoft's kernel source, and one bad pointer in your driver would crash WSL2 with every terminal and editor connected to it. Instead you compile Linux yourself, boot it in QEMU with a tiny root file system and load your code there. A bug then crashes a virtual machine that boots again in a few seconds.

The chapter sits between your own kernel and Embedded firmware. Your kernel showed you the mechanisms with nothing in between. Linux shows how a production kernel wraps the same mechanisms in interfaces that thousands of drivers share. Chapter 17 removes every layer again on a real microcontroller.

## A Linux kernel you build yourself

Your driver will run inside a Linux kernel, and it must be compiled against that exact kernel: the same source, the same configuration and the same compiler. So the first job is a kernel whose source tree sits in your home directory, built by you.

The kernel's build is driven by its **configuration**, a file named `.config` in the source tree with one line per option, such as `CONFIG_PCI=y`. Each option turns a feature or a driver on or off. There are thousands, so you never write the file by hand:

- `make defconfig` writes the default configuration for your CPU's architecture. For x86-64 it already includes PCI, the serial port and the virtual devices QEMU offers.
- `scripts/config` turns single options on (`-e`) or off (`-d`).
- `make olddefconfig` fills in every option that your changes left open with its default.

You turn on four options, all from the kernel's debugging menu:

- `DEBUG_INFO_DWARF5` adds debug information in **DWARF**, the standard format that records which source line and which variable each machine address belongs to. clang's `-g` writes the same format. gdb needs it to turn a kernel address into a source line.
- `GDB_SCRIPTS` builds Python helpers that teach gdb the kernel's data structures, such as the kernel log.
- `DEBUG_ATOMIC_SLEEP` makes the kernel report code that sleeps where it must not. You trigger that report on purpose in the interrupt step.
- `PROVE_LOCKING` turns on **lockdep**, the kernel's lock checker. The kernel records the order in which locks are taken and in which contexts, and reports a lock that an interrupt handler takes while other code holds it with interrupts on. You trigger that report in the locking step.

The README in this step's Study says to answer no to debugging features, because they make a kernel bigger and slower. That advice is for a kernel you run every day. This one exists to be debugged.

The kernel builds with gcc. Kbuild, the kernel's build system, uses gcc unless told otherwise, and a module must be built by the compiler that built its kernel. So all kernel code in this chapter goes through gcc, and your user programs keep using clang.

![make writes four files: QEMU boots bzImage, gdb reads vmlinux, your module builds read Module.symvers, and gen_init_cpio packs the initramfs.](figures/16-build.svg)

The build writes the files you use for the rest of the chapter:

- `arch/x86/boot/bzImage`: the compressed kernel that QEMU boots.
- `vmlinux`: the same kernel as an uncompressed ELF file with symbols and debug information, for gdb.
- `Module.symvers`: the list of kernel functions that modules may call, which your module builds read.
- `usr/gen_init_cpio`: a small tool that packs the root file system of the next step.

On a 4-core machine the build took 7 minutes 20 seconds and left the tree at 5.6 GB. More cores make it faster. The same build without lockdep took about as long and left 5.4 GB. Lockdep costs its time while the kernel runs: with it, the guest of the next step boots in about five seconds instead of three.

> **Practice:** Keep one kernel tree and one configuration for the whole chapter. If you ever change the configuration, rebuild the kernel and then every module, because a module built against a different configuration may refuse to load or crash.

### Study

- [Linux kernel docs: Linux kernel release 6.x](https://docs.kernel.org/admin-guide/README.html#configuring-the-kernel) (read, 15 min): The kernel's README. Read "Configuring the kernel" for what `defconfig`, `olddefconfig` and `menuconfig` do, and the first two paragraphs of "Compiling the kernel". Skip everything about installing. You never install this kernel.

### Build

1. Install the build tools. `build-essential` (gcc and make) is there since chapter 06. `flex` and `bison` generate the parsers of the configuration tools, `bc` computes constants during the build, and the two `-dev` packages are libraries the build's own tools link against.

   ```sh
   sudo apt install -y build-essential flex bison bc libssl-dev libelf-dev
   ```

2. Fetch Linux 6.18.64 into `~/code`, next to xv6 and Lua, and unpack it with `curl -LO` and `tar` as you did for SDL in chapter 06. This archive is compressed with xz, which `tar xf` recognizes by itself. 6.18 is the current longterm release, which kernel.org keeps fixing for years. Keep 6.18.64 even if kernel.org lists a newer 6.18 release, because every path and check in this chapter names it. A tree under `/mnt/c` would build many times slower and lose the symbolic links the kernel source contains.

   ```sh
   cd ~/code
   curl -LO https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.64.tar.xz
   tar xf linux-6.18.64.tar.xz
   cd linux-6.18.64
   ```

3. Configure:

   ```sh
   make defconfig
   scripts/config -e DEBUG_INFO_DWARF5 -e GDB_SCRIPTS -e DEBUG_ATOMIC_SLEEP -e PROVE_LOCKING
   make olddefconfig
   ```

4. Build with `time make -j$(nproc)`. `time` is a shell keyword that prints how long the command after it ran. `nproc` prints the number of CPU cores and `-j` runs that many compile jobs at once. Then run `make scripts_gdb`, which links the gdb helpers into the tree.
5. Check the results with `ls -lh arch/x86/boot/bzImage vmlinux` and `make kernelrelease`.

> **If it fails:** If the build stops with `Killed`, or gcc reports that it was killed by signal 9, WSL2 ran out of memory. By default it gets half of the laptop's RAM, and the final link of `vmlinux` alone used over 4 GB here. Run `make -j4` to start fewer jobs at once. make continues where it stopped.

### Done when

`make kernelrelease` prints `6.18.64`, and `bzImage` and `vmlinux` exist. `grep -E 'DEBUG_INFO_DWARF5|GDB_SCRIPTS|DEBUG_ATOMIC_SLEEP|PROVE_LOCKING' .config` shows all four set to `y`. You know how long your build took. You can say why your module must be built against this tree and not against the kernel WSL2 runs.

## Booting your kernel in QEMU

A kernel on its own shows nothing. It needs a machine to run on and a first program to start.

QEMU provides the machine. You ran `qemu-system-riscv64` for xv6 in chapter 08 and `qemu-system-x86_64` for your own kernel in chapter 15. Here `qemu-system-x86_64` emulates a PC that runs your Linux, with a serial port as its console and one extra device, `edu`, which the driver steps use.

![QEMU runs inside WSL2's Ubuntu and boots your kernel with the initramfs and the edu device. The arrows show what QEMU loads, the directory it shares at /mnt and the port gdb connects to.](figures/16-setup.svg)

The first program comes from an archive the kernel unpacks at boot. Four terms describe it:

- An **initramfs** is an archive that the kernel unpacks into a file system in RAM at boot. The kernel then runs the file `/init` from it as process 1.
- **cpio** is the archive format, an old Unix format like tar.
- **busybox** is the one program yours holds. It is a single binary that acts as a shell and as about 270 small tools, such as `ls`, `insmod`, `mount` and `dmesg`, which prints the kernel log. It picks the tool by the name it is started under.
- A **static** binary carries its C library inside. Ubuntu's `busybox-static` package is one. The initramfs has no C library, so your own test programs must be static too.

Your `/init` is a shell script with four jobs:

- Mount `/proc` (processes and kernel state) and `/sys` (devices and drivers).
- Mount `/dev` as **devtmpfs**, a file system in which the kernel creates device files itself.
- Mount your `~/code/drivers` directory from WSL2 at `/mnt` over **9p**, a file sharing protocol that QEMU serves to the guest through a virtual device. Every module you build in WSL2 then shows up in the guest at once.
- Start a shell in `/mnt`.

The QEMU command line has one flag per piece of the picture:

- `-m 1G -smp 2`: 1 GB of RAM and two CPUs. With two CPUs, your locking mistakes can show up.
- `-nographic`: no window. The serial port goes to your terminal. You leave QEMU with Ctrl-a, then x.
- `-kernel` and `-initrd`: load the kernel and the initramfs straight into memory, with no bootloader and no disk.
- `-append`: the kernel's command line. `console=ttyS0` sends the kernel's messages to the first serial port. `nokaslr` turns off the random placement of the kernel in memory, so its addresses match `vmlinux` in gdb.
- `-device edu`: the teaching device.
- `-virtfs`: shares `~/code/drivers` with the guest under the name `host`. `security_model=none` makes QEMU read and write the files as your own user.
- `-s`: a gdb server on port 1234, as in chapter 15. The next step attaches to it.

### Study

- [Linux kernel docs: Ramfs, rootfs and initramfs](https://docs.kernel.org/filesystems/ramfs-rootfs-initramfs.html#what-is-initramfs) (read, 15 min): By Rob Landley. Read "What is initramfs?" and "Populating initramfs". Skip the rest. The page calls the packing tool `scripts/gen_init_cpio`. In 6.18 it is `usr/gen_init_cpio`, built with the kernel.
- [QEMU docs: Direct Linux Boot](https://www.qemu.org/docs/master/system/linuxboot.html) (reference, as needed): One page on `-kernel`, `-initrd`, `-append` and `-nographic` with `console=ttyS0`. Its examples boot from a disk image. You use `-initrd` instead.

### Build

1. QEMU for x86 is installed since chapter 15. Install busybox: `sudo apt install -y busybox-static`.
2. Make the directory for everything you write in this chapter: `mkdir -p ~/code/drivers && cd ~/code/drivers`.
3. In `~/code/drivers`, write `init`. Its first line, `#!` followed by a path, is a **shebang**: it names the program that runs the script, here busybox's shell.

   ```sh
   #!/bin/busybox sh
   /bin/busybox --install -s /bin
   mount -t proc proc /proc
   mount -t sysfs sysfs /sys
   mount -t devtmpfs devtmpfs /dev
   mount -t 9p -o trans=virtio,version=9p2000.L host /mnt
   echo "booted in $(cut -d' ' -f1 /proc/uptime) s"
   cd /mnt
   exec setsid cttyhack sh
   ```

   `busybox --install -s` creates a link named after each tool, so `ls` runs busybox as `ls`. In the 9p mount, `trans=virtio` names QEMU's virtual device as the transport and `version=9p2000.L` picks the Linux dialect of the protocol. The last line replaces the script with a shell that owns the console, so Ctrl-c reaches the programs you start.

4. Write `initramfs.list`, the file list that `gen_init_cpio` reads. Each line names a directory, a device node or a file, with its permissions and owner. The device node `/dev/console` has to exist before `/dev` is mounted, because the kernel opens it for process 1.

   ```
   dir /bin 755 0 0
   dir /dev 755 0 0
   nod /dev/console 600 0 0 c 5 1
   dir /proc 755 0 0
   dir /sys 755 0 0
   dir /mnt 755 0 0
   file /bin/busybox /usr/bin/busybox 755 0 0
   file /init init 755 0 0
   ```

   Pack it with `~/code/linux-6.18.64/usr/gen_init_cpio initramfs.list > initramfs.cpio`.

5. Write `run.sh`, make it executable with `chmod +x run.sh` and start the guest with `./run.sh`:

   ```sh
   #!/bin/sh
   exec qemu-system-x86_64 -m 1G -smp 2 -nographic \
       -kernel ~/code/linux-6.18.64/arch/x86/boot/bzImage \
       -initrd ~/code/drivers/initramfs.cpio \
       -append "console=ttyS0 nokaslr" \
       -device edu \
       -virtfs local,path=$HOME/code/drivers,mount_tag=host,security_model=none \
       -s
   ```

> **Optional:** If KVM worked for you in the optional item of chapter 15's step "Booting the kernel in QEMU", add `-accel kvm -cpu host` to `run.sh`, and the guest runs at the speed of your CPU. `-cpu host` shows the guest your real CPU model instead of QEMU's default one. If QEMU reports that it cannot open `/dev/kvm`, leave the two flags out. Without KVM, QEMU translates every instruction and this guest still boots in about five seconds.

### Done when

The guest prints its boot time and a `/mnt #` prompt. In the guest, `uname -r` prints `6.18.64`, `ls /mnt` lists your `~/code/drivers` files, and `grep -l 0x11e8 /sys/bus/pci/devices/*/device` names exactly one device. You can say what runs as process 1 and where its file came from.

## Modules: code loaded into the running kernel

The guest boots, but nothing in it is yours yet. Rebuilding the kernel for every change would take minutes. A module takes a second to build and load.

A **module** is a piece of kernel code in a `.ko` file, which is an ELF relocatable object like the `.o` files of chapter 05. `insmod` hands it to the kernel's module loader. The loader copies the module's sections into kernel memory and resolves its undefined symbols, such as `printk`, against the functions the kernel exports.

Then the loader applies the relocations and calls the module's init function. That is chapter 05's linker running inside the kernel at load time. `rmmod` calls the module's exit function and frees the memory, and `lsmod` lists the loaded modules.

![insmod hands hello.ko to the module loader, which copies, links and relocates it and calls hello_init. If init returns 0 the module stays loaded until rmmod calls hello_exit and the kernel frees it. If init returns an error the kernel frees it at once.](figures/16-module-life.svg)

You build a module with Kbuild, pointed at the kernel tree it will load into. LKMPG's Makefile points at `/lib/modules/$(shell uname -r)/build`, which is the WSL2 kernel. Use your tree instead:

```make
KDIR ?= $(HOME)/code/linux-6.18.64
obj-m += hello.o

all:
	$(MAKE) -C $(KDIR) M=$(CURDIR) modules
clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) clean
```

- `KDIR ?=` sets the kernel tree unless you name another one on the command line.
- `obj-m` names the objects to build as modules. Each later module adds its own `obj-m += name.o` line.
- `-C $(KDIR)` runs make inside the kernel tree, which holds all the build rules.
- `M=$(CURDIR)` tells it that your source is in the current directory.

A module runs in the kernel's address space with no C library. `printf` becomes `pr_info` and `malloc` becomes `kmalloc`. Floating point is off limits. Each thread's kernel stack is 16 KB on x86-64 and does not grow.

A kernel function reports failure by returning the negative of an error number, such as `-EINVAL`. The system call layer turns that into a return value of -1 and sets `errno` in the process, the `errno` you checked after `strtod` in chapter 04.

> **Practice:** Return a negative error number, such as `-EINVAL` or `-ENOMEM`, from every kernel function of yours that fails. When a function you called returns a negative number, pass that same number back to your caller.

Every kernel function runs in a **context**, which decides what it may do. To **sleep** means to give up the CPU until some event happens, as a `read` from an empty pipe does. Your init function runs in **user context**, on behalf of the `insmod` process, and may sleep. An interrupt handler runs in **hard interrupt context** and must never sleep. The rest of the chapter keeps asking which context a piece of code runs in.

A bad pointer in a module makes the kernel print an **oops**: the faulting address, the registers and a call trace. The process that loaded the module is killed, and the module stays in `lsmod`, stuck halfway through loading.

The line that starts with `RIP:` names the faulting instruction as a function plus an offset, such as `RIP: 0010:oops_start+0x12/0xff0 [oops]`: 0x12 bytes into `oops_start`, in the module `oops`. The name may also be `init_module`, which `module_init` makes a second name for your init function at the same address. gdb turns that into a source line, because your module carries DWARF from the kernel's configuration.

> **Practice:** Reboot the guest after every oops. The kernel may still hold a lock or half-built state from the code that crashed, and the next test would fail for a reason that is not in your code.

### Study

- [The Linux Kernel Module Programming Guide](https://sysprog21.github.io/lkmpg/) (read, 1 h 15 min): Chapter 4, "Hello World", sections 4.1 to 4.5, then chapter 5, sections 5.1 to 5.5. Skip the part of 4.1 about `sudo` and `env_reset`, which does not apply in the guest. Skip 5.6, because the next step covers character devices from a fuller source.
- [Unreliable Guide To Hacking The Linux Kernel](https://docs.kernel.org/kernel-hacking/hacking.html) (read, 30 min): By Rusty Russell. Read "Introduction", "The Players" with its three subsections, and "Some Basic Rules". Skip the rest until a later step points back to it.
- [Linux kernel docs: Debugging kernel and modules via gdb](https://docs.kernel.org/process/debugging/gdb-kernel-debugging.html) (reference, as needed): "Setup" for attaching gdb to QEMU, and `lx-dmesg` and `lx-symbols` under "Examples of using the Linux-provided gdb helpers".

### Build

1. `hello.c` with an `int count` module parameter. Init prints "hello" `count` times with `pr_info` and returns `-EINVAL` if `count` is negative. Exit prints "goodbye". Mark the functions `__init` and `__exit` and fill in `MODULE_LICENSE` and `MODULE_DESCRIPTION`.
2. Build in `~/code/drivers` with `make`. In the guest, run `insmod hello.ko count=3`, `lsmod`, `cat /sys/module/hello/parameters/count`, `rmmod hello` and `dmesg | tail`.
3. Attach gdb to the running guest. Run `echo "add-auto-load-safe-path $HOME/code/linux-6.18.64" >> ~/.gdbinit` once, so gdb loads the kernel's helper scripts. In a second Ubuntu terminal, `cd ~/code/linux-6.18.64`, run `gdb vmlinux`, then `target remote :1234`. gdb stops the guest. Run `bt`, which shows what the CPU was doing, then `lx-dmesg`, then `continue` to let the guest run again.
4. `oops.c`, whose init function writes through a NULL pointer. Name its functions `oops_start` and `oops_stop`: the kernel already declares a function named `oops_exit`, and a module function with that name fails to build with "static declaration of 'oops_exit' follows non-static declaration". Add `oops.o` to the Makefile, load the module and read the oops. On the WSL2 side, run `gdb oops.ko`, then `list *oops_start+0x12` with the offset from your oops (`list *init_module+0x12` gives the same line). Reboot the guest.

### Done when

`insmod hello.ko count=3` prints three lines, `rmmod hello` prints "goodbye", and `insmod hello.ko count=-1` fails with "Invalid argument" and leaves nothing in `lsmod`. From gdb, `lx-dmesg` prints the same log as `dmesg` in the guest. For the oops, gdb printed the line `*p = 42` or your equivalent, and you can find the faulting address (`address: 0000000000000000`) and the call trace in the oops text. You can name the context that `hello`'s init runs in and one thing that context allows which an interrupt handler may not do.

## A character device and the path of read()

Your modules so far only write to the kernel log. For a process to talk to a module, the module needs a file in `/dev`.

A **character device** is a file in `/dev` whose `read`, `write` and `ioctl` calls go to a driver as a stream of bytes. The file carries two numbers. The **major** number picks the driver and the **minor** number picks one of that driver's devices. The driver asks the kernel for a free major with `alloc_chrdev_region`, fills a `struct file_operations` with pointers to its functions, and registers a `struct cdev` that ties the two together with `cdev_add`.

From then on, a process's `read(fd, buf, n)` arrives in your driver. In chapter 08 you followed a system call into xv6. Linux adds a layer, the **VFS** (virtual file system), which every file operation goes through.

The VFS looks up the descriptor in the process's table and finds the `struct file` that `open` made. When `open` saw a character device with your major, it set that file's `f_op` to your `file_operations`. So the VFS calls your `read` with the `struct file`, the user's buffer pointer, the count and the file offset.

![read(3, buf, 100) enters the kernel with a system call. The kernel looks up descriptor 3 to find the struct file that open made, its f_op points at your file_operations, and the kernel calls your kp_read, which copies bytes into the process's buffer with copy_to_user.](figures/16-read-path.svg)

The buffer pointer is a **user pointer**, an address in the calling process's page table. It may be unmapped or wrong, so the kernel never dereferences one directly. `copy_to_user` and `copy_from_user` do the copy and survive a bad address. They return the number of bytes they could not copy, and your driver turns a nonzero result into `-EFAULT`. Both may sleep while a page is brought in, which is allowed in user context.

The device you build is a pipe with a 4 KB ring buffer. `write` copies in what fits and `read` copies out what is there. Several processes can call into the driver at once, so a mutex protects the buffer. For this step, a `read` from an empty pipe and a `write` to a full one return `-EAGAIN` at once. The next step makes them wait.

An **ioctl** is a system call for device commands that are neither a read nor a write. Its command number encodes a direction, a type letter, a number and the size of the argument. The macros `_IO`, `_IOR` and `_IOW` build it.

Init registers several things, and any of them can fail. The kernel's way to undo the earlier ones is a `goto` to a label that undoes them in reverse order:

```c
err = alloc_chrdev_region(&p->devt, 0, 1, "kpipe");
if (err)
        return err;
cdev_init(&p->cdev, &kp_fops);
err = cdev_add(&p->cdev, p->devt, 1);
if (err)
        goto out_region;
return 0;
out_region:
        unregister_chrdev_region(p->devt, 1);
        return err;
```

> **Practice:** Unwind a failed init with `goto` labels, one label per step to undo, written in reverse order of the steps. Exit undoes all the steps, also in reverse order.

### Study

- [Linux Kernel Labs: Character device drivers](https://linux-kernel-labs.github.io/refs/heads/master/labs/device_drivers.html#overview) (read, 1 h): From the University POLITEHNICA of Bucharest's Linux kernel course. Read from "Overview" through "ioctl". Leave "Waiting queues" for the next step. Skip "Exercises" and "Extra Exercises", which need the course's VM and skeleton code. When you read the lab: it includes `<asm/uaccess.h>`, and current kernels want `<linux/uaccess.h>`.
- [Unreliable Guide To Locking](https://docs.kernel.org/kernel-hacking/locking.html#locking-in-the-linux-kernel) (read, 20 min): By Rusty Russell. Read "Locking in the Linux Kernel" through "Locking Only In User Context", then "What Functions Are Safe To Call From Interrupts?" with "Some Functions Which Sleep". Skip everything in between, from "Locking Between User Context and Softirqs" to "Data Which Mostly Used By An IRQ Handler". The locking step later in this chapter reads the part on hard interrupts.

### Build

1. `kpipe.c`: a 4096-byte ring buffer, a start index, a length and a mutex in one `struct kpipe`. Register one minor with `alloc_chrdev_region` and `cdev_add`. Set `.owner = THIS_MODULE` in `file_operations`, which makes the kernel count each open file as a user of your module, so the module cannot be unloaded under it. In `open`, set `file->private_data` from `inode->i_cdev` with `container_of`, as the lab shows. `container_of(ptr, type, member)` turns a pointer to a member back into a pointer to the struct that contains it. Unwind every registration with `goto` on any init failure and in exit.
2. Make the node in the guest. Real drivers also call `device_create`, and devtmpfs then makes the node in `/dev`. This chapter skips that call to keep the step small, so you make the node by hand. After `insmod kpipe.ko`, `grep kpipe /proc/devices` prints the major the kernel picked, such as `247 kpipe`. Then `mknod /dev/kpipe c 247 0` makes a character device node with that major and minor 0. Use your number.
3. `read` and `write` take the mutex with `mutex_lock_interruptible` and return `-ERESTARTSYS` if that fails. Each returns the number of bytes it moved, which may be fewer than asked. A count of zero returns 0 at once. An empty buffer for `read`, or a full one for `write`, returns `-EAGAIN`.
4. `ioctl` with two commands: `KPIPE_LEVEL`, built with `_IOR('k', 1, int)`, copies the number of buffered bytes to a user `int`, and `KPIPE_CLEAR`, built with `_IO('k', 2)`, empties the buffer. Unknown commands return `-ENOTTY`. Put the command numbers in `kpipe.h`, which user programs include too. Include `<linux/ioctl.h>` and `<linux/types.h>` in it, which work on both sides.
5. `kpipetest.c`, built in `~/code/drivers` with `clang -static -Wall -Wextra -O2`. `kpipetest errors` opens the pipe with `O_NONBLOCK` and checks four things: a read from an empty pipe fails with `EAGAIN`, a read into address 1 fails with `EFAULT` once the pipe holds data, an unknown ioctl fails with `ENOTTY`, and `KPIPE_LEVEL` reports the number of bytes it just wrote. It ends with `KPIPE_CLEAR`.

### Done when

In the guest, `echo hello > /dev/kpipe` followed by `head -c 6 /dev/kpipe` prints `hello`, and a second read with `cat /dev/kpipe` reports "Resource temporarily unavailable". `./kpipetest errors` passes. `rmmod kpipe` fails while a process holds the device open (`exec 3</dev/kpipe` in the guest shell holds it, and `exec 3<&-` closes it) and succeeds after. You can name each function the kernel runs between your `read` call and `kp_read`.

## Blocking reads with a wait queue

A `read` from an empty pipe should wait for data, as the pipes of chapter 08 do, instead of failing. The process has to sleep: give up the CPU until a writer adds data, and run again after that.

A **wait queue** is a list of sleeping processes that wait for a condition, plus the functions to sleep on it and to wake it. `wait_event_interruptible(q, cond)` puts the process to sleep on `q` until `cond` is true or a signal arrives. `wake_up_interruptible(&q)` wakes the processes sleeping on `q`, and each of them checks its condition again. A wait queue plays the role of chapter 09's condition variable.

![Process A finds the pipe empty, releases the mutex and sleeps on readq, using no CPU. Process B writes five bytes under the mutex and calls wake_up on readq. A wakes, takes the mutex, finds the data, copies it out and returns 5.](figures/16-wait-queue.svg)

You must not sleep on the wait queue while holding the mutex, because the writer that would wake you needs the mutex first. So `read` drops the mutex before it waits and takes it again after:

```c
if (mutex_lock_interruptible(&p->lock))
        return -ERESTARTSYS;
while (p->len == 0) {
        mutex_unlock(&p->lock);
        if (file->f_flags & O_NONBLOCK)
                return -EAGAIN;
        if (wait_event_interruptible(p->readq, READ_ONCE(p->len) > 0))
                return -ERESTARTSYS;   /* a signal arrived */
        if (mutex_lock_interruptible(&p->lock))
                return -ERESTARTSYS;
}
/* copy at most p->len bytes out, advance the start index */
mutex_unlock(&p->lock);
wake_up_interruptible(&p->writeq);
```

The lines you have not seen:

- `O_NONBLOCK` is the flag a process passes to `open` when it wants the old behavior of the previous step. Such a read still returns `-EAGAIN`.
- `READ_ONCE` reads `p->len` exactly once, from memory. The condition runs without the mutex, and a plain read could be cached in a register by the compiler. Its definition and comment are in `include/asm-generic/rwonce.h` of your kernel tree.
- The `while` checks the condition again under the mutex, because another reader may have emptied the buffer between the wake-up and `mutex_lock`.
- `-ERESTARTSYS` tells the kernel that a signal interrupted the call. The process sees the error `EINTR`, or the call starts again if the signal handler asked for that.

`write` has the same shape with a second queue, `writeq`, for a full buffer, and it wakes `readq` after copying in.

### Study

- [Linux Kernel Labs: Character device drivers](https://linux-kernel-labs.github.io/refs/heads/master/labs/device_drivers.html#waiting-queues) (read, 15 min): Only "Waiting queues", the section you left in the previous step.
- [Unreliable Guide To Hacking The Linux Kernel](https://docs.kernel.org/kernel-hacking/hacking.html#wait-queues-include-linux-wait-h) (read, 10 min): The section "Wait Queues include/linux/wait.h" with its three subsections, in the guide you started in the modules step.

### Build

1. Add `readq` and `writeq` to `struct kpipe` and initialize them with `init_waitqueue_head`. Change `read` to the shape above, and `write` to the same shape with `writeq`. Both keep returning `-EAGAIN` under `O_NONBLOCK`.
2. `kpipetest w N` writes N bytes of the pattern `i * 7 % 251` in chunks of random size up to 10,000. `kpipetest r N` reads N bytes in random chunks and checks the pattern.
3. `kpipetest r` installs a `SIGINT` handler with `sigaction` and without `SA_RESTART`, as in the signal(7) section "Interruption of system calls and library functions by signal handlers" from chapter 08. It prints "read: EINTR" when `read` fails with `EINTR`.

> **Optional:** Your server from chapter 08 waits on many descriptors with `epoll`, and it cannot wait on `/dev/kpipe` yet, because the driver has no `poll` file operation. Read LKMPG section 10.1, "poll, select, and epoll", in the guide from the modules step. Then add `.poll`: call `poll_wait` on `readq` and on `writeq`, and return `EPOLLIN | EPOLLRDNORM` when the buffer holds data and `EPOLLOUT | EPOLLWRNORM` when it has room. A small program that calls `poll` on the empty pipe with a 5 second timeout should return 0, and should return 1 with `POLLIN` set once you write to the pipe from the shell.

### Done when

In the guest, `./kpipetest w 1000000 & ./kpipetest r 1000000` reports no mismatch, and `./kpipetest errors` still passes. `./kpipetest r 10 & sleep 1; kill -INT $!` on an empty pipe prints "read: EINTR". You can say why the mutex is dropped before the wait and why the condition is checked again after it.

## A PCI driver for QEMU's edu device

The pipe had no hardware behind it. Now you drive a device. QEMU's `edu` device exists for teaching driver writing. It computes factorials, raises interrupts on request and can copy memory by itself. Its specification is one page.

`edu` sits on **PCI**, the bus that connects devices to the CPU in a PC. Software can find PCI devices by itself. Each device has a **configuration space**, a small block of registers that the kernel reads at boot. It holds the vendor ID (0x1234 for `edu`), the device ID (0x11e8), a command register and up to six **BARs** (base address registers). A BAR holds the physical address where a range of the device's registers appears.

Those registers are **memory-mapped I/O** (MMIO): loads and stores to those physical addresses reach the device instead of RAM. In chapter 15 you talked to the serial port and the interrupt controller with the `in` and `out` instructions. That is x86's other kind of device access, **port I/O**. The `edu` device has only MMIO, 1 MB of it, behind BAR 0.

![BAR 0 holds the physical address 0xfea00000. pci_iomap adds a kernel page table entry from the virtual address bar to it, and the driver's ioread32 at bar plus 0x08 goes through that entry to the factorial register.](figures/16-pci.svg)

Your driver registers a `struct pci_driver` with a table of the IDs it supports. For each match, the PCI core calls your `probe` with a `struct pci_dev`. You never write a physical address in your code. Your kernel in chapter 15 knew where its devices lived. A PCI driver asks the core.

`probe` takes the device in a fixed order:

1. Enable the device with `pci_enable_device`.
2. Claim its BAR ranges with `pci_request_regions`, so no other driver can.
3. Map BAR 0 into kernel virtual memory with `pci_iomap`, which returns a `void __iomem *`. The kernel maps device registers uncached, so every access reaches the device.
4. Set up the driver's own state and register the character device.

`remove` undoes the same steps in reverse. You access the mapping only through `ioread32` and `iowrite32`, never with `*p`. Through a plain pointer the compiler may merge, split or drop accesses, and each of those changes what the device sees. `ioread32` makes exactly one 32-bit access. On x86-64 it also checks whether the address came from a port BAR or a memory BAR and uses `in` or a plain load to match.

The registers you use now:

| Offset | Access | Register | Use |
| --- | --- | --- | --- |
| 0x00 | read | identification | `0xRRrr00ed`, major and minor version |
| 0x04 | read, write | liveness check | reads back the complement of what you wrote |
| 0x08 | read, write | factorial | write n, read n! when done |
| 0x20 | read, write | status | bit 0x01 is set while computing |

The factorial runs in a separate QEMU thread, so a result is ready only when the "computing" bit clears. For this step your `read` polls that bit and sleeps a few microseconds between checks. Sleeping is allowed here because `read` runs in user context. The device computes in 32 bits, so 13! wraps modulo 2^32.

### Study

- [QEMU docs: EDU device](https://www.qemu.org/docs/master/specs/edu.html) (read, 15 min): Everything except "DMA controller". This chapter does not use DMA.
- [Linux kernel docs: How To Write Linux PCI Drivers](https://docs.kernel.org/PCI/pci.html) (read, 45 min): By Martin Mares and Grant Grundler. Read 1.1, 1.2, 1.4.1, 1.4.2, 1.4.5, then 1.5.5 to 1.5.7. Skip 1.4.3, 1.4.4, 1.5.3 and 1.5.4, which cover DMA. Leave 1.4.6, 1.5.1 and 1.5.2 for the interrupt step.
- [Linux kernel docs: Bus-Independent Device Accesses](https://docs.kernel.org/driver-api/device-io.html#memory-mapped-io) (reference, as needed): "Memory Mapped IO" and "__iomem pointer tokens" for why `ioread32` exists, "Differences between I/O access functions" for the `ioread32` family, and `pci_iomap` under "Higher-level ioremap abstractions". "Port Space Accesses" explains the `in` and `out` of chapter 15, which `edu` does not use.

### Build

1. `edu.c`: an ID table with `PCI_DEVICE(0x1234, 0x11e8)` and `MODULE_DEVICE_TABLE(pci, ...)`. `module_pci_driver(edu_driver)` writes the module's init and exit functions for you, which call `pci_register_driver` and `pci_unregister_driver`. Allocate one `struct edu` per device in `probe` with `kzalloc`, which is `kmalloc` that also fills the memory with zeros, and attach it with `pci_set_drvdata`.
2. `probe`: `pci_enable_device`, `pci_request_regions`, `pci_iomap` of BAR 0. Print the major and minor version from the identification register with `dev_info`, which is `pr_info` with the device's name in front. Write a value to the liveness register and fail `probe` with `-ENODEV` unless you read back its complement. Unwind with `goto` labels in reverse order on every failure.
3. Move the character device code from `kpipe.c` into `struct edu`. `write` takes exactly 4 bytes, a `u32` n, writes it to the factorial register and returns 4. `read` takes at least 4 bytes, polls the status register with `usleep_range(10, 20)` between checks, gives up with `-ETIMEDOUT` after 100 ms and returns the result as a `u32`. `usleep_range` sleeps for a time between its two arguments in microseconds, and `include/linux/delay.h` in your tree documents it. A mutex keeps two processes from interleaving their write and read.
4. `remove` reverses `probe`: `cdev_del`, `unregister_chrdev_region`, `pci_iounmap`, `pci_release_regions`, `pci_disable_device`, `kfree`.
5. `edutest.c`, built like `kpipetest`: open `/dev/edu`, then for n from 0 to 13, write n, read the result and compare it with a 32-bit factorial computed in user space. In the guest, make the node as for `kpipe`, with the major from `grep -w edu /proc/devices`.

### Done when

`insmod edu.ko` prints `edu version 1.0`. `grep edu /proc/iomem` shows the claimed BAR, `fea00000-feafffff : edu` on QEMU's default PC, and `ls /sys/bus/pci/drivers/edu` shows the bound device `0000:00:04.0`. `./edutest` matches all 14 values. `rmmod edu` succeeds, the BAR disappears from `/proc/iomem`, and `insmod` then works again. You can say what would break if `remove` ran `pci_release_regions` before `cdev_del`.

## Interrupts: registration and the top half

Polling makes `read` wake up again and again to check one bit. The `edu` device can raise an interrupt instead:

- Set bit 0x80 in the status register before writing n, and the device raises interrupt 0x01 when the factorial is done.
- Writing a value to register 0x60 raises an interrupt with that value.
- The device ORs each value into its interrupt status register at 0x24. It keeps the interrupt raised until the driver writes the same bits to 0x64.

In chapter 15 your handler ran straight from the interrupt table, and you acknowledged the old PIC by hand. A PCI device on x86 sends an **MSI** (message signaled interrupt) instead, and the **local APIC**, the interrupt controller in each CPU core that replaced the PIC, receives it. The path from device to driver:

1. The device writes a small message to the local APIC's address. The MSI is that memory write.
2. The APIC interrupts the CPU with a vector number.
3. Linux's entry code saves the registers and finds the Linux IRQ number for that vector.
4. The kernel calls every handler registered for that IRQ number, including yours.

Older PCI devices signal on a pin shared with other devices instead, called **INTx**.

![The edu device sends an MSI to the local APIC, which interrupts the CPU. The kernel's entry code calls edu_irq, the top half, in hard interrupt context. edu_irq sets the done flag under the spinlock, wakes the process waiting in read and calls schedule_work, and later a kworker thread runs edu_work in process context, where it may sleep.](figures/16-irq.svg)

The figure shows the whole path that the next three steps build. This step builds the top row. Connecting your handler takes four calls in `probe`:

1. `pci_set_master` sets the device's **bus master** bit. An MSI is a memory write by the device, and a PCI device may write to memory only with that bit set. `pci_enable_device` does not set it, as section 1.4.1 of the PCI guide says.
2. `pci_alloc_irq_vectors(pdev, 1, 1, PCI_IRQ_ALL_TYPES)` asks for one interrupt of the best kind the device supports. On QEMU's PC, `edu` gets MSI.
3. `pci_irq_vector(pdev, 0)` returns the Linux IRQ number.
4. `request_irq` registers your handler for that number. Pass `IRQF_SHARED` anyway, and return `IRQ_NONE` when 0x24 reads zero, so the handler is also correct on a shared pin.

Your handler reads 0x24, writes the same bits to 0x64 and returns `IRQ_HANDLED`. The PCI guide covers registration in the three sections you left: 1.4.6 "Register IRQ handler", 1.5.1 "Stop IRQs on the device" and 1.5.2 "Release the IRQ". Read them now, about 15 minutes. Section 1.4.6 says that `request_irq` enables the interrupt at once, so your handler can run before `request_irq` returns, and everything it touches must be ready before the call.

The handler runs in hard interrupt context. It must not sleep, so it cannot take your mutex or call `copy_to_user`. It also cannot allocate with `GFP_KERNEL`, the flag that lets `kmalloc` sleep while it finds free memory. Code that must allocate in a handler passes `GFP_ATOMIC`, which never sleeps and may fail.

### Study

- [Linux Kernel Labs: I/O access and Interrupts](https://linux-kernel-labs.github.io/refs/heads/master/labs/interrupts.html#background-information) (read, 35 min): Read "Background information" and stop at its last two paragraphs, which start "When we need to access shared resources". The next step reads them. Then read "Interrupt handling" with "Requesting an interrupt", "Implementing an interrupt handler" and "Interrupt statistics". Skip "Accessing the hardware", which is port I/O, and the exercises, which need the course's VM and its keyboard controller.

### Build

1. In `probe`, call `pci_set_master` after `pci_enable_device`. After mapping BAR 0, quiet the device as section 1.4.6 asks: clear bit 0x80 in the status register and acknowledge any pending bits by writing the value of 0x24 to 0x64. Then call `pci_alloc_irq_vectors`, then `request_irq(pci_irq_vector(pdev, 0), edu_irq, IRQF_SHARED, "edu", edu)`. Log the IRQ number and `pdev->msi_enabled`. Add the matching `free_irq` and `pci_free_irq_vectors` to the unwind path and to `remove`, before `pci_iounmap`.
2. `write` now sets bit 0x80 in the status register before it writes n. The handler reads 0x24, returns `IRQ_NONE` if it is zero, and otherwise writes the bits to 0x64 and returns `IRQ_HANDLED`. `read` keeps polling for this step.
3. Break it on purpose. Put a `mutex_lock` and `mutex_unlock` on your mutex inside the handler, load the module and run `edutest`. Read the report from `DEBUG_ATOMIC_SLEEP`, then remove the lines and reboot the guest.

### Done when

`./edutest` still matches all 14 values. `grep -w edu /proc/interrupts` shows a line with `PCI-MSI` and `edu`, and its count grows by exactly 14 per run, one per factorial. You can say whether your device uses MSI or INTx and where you read that. The broken handler produced "BUG: sleeping function called from invalid context", and you can point at the line `edu_irq+0x.../0x... [edu]` inside the `<IRQ>` part of its call trace. Lockdep follows it with a second report, "BUG: Invalid wait context", about the same mutex.

## Locking between the handler and process context

Now `read` should sleep until the handler says the result is there. The handler and `read` then share data: the result and a done flag. The handler cannot take the mutex, so this data needs a different lock.

A **spinlock** is a lock that waits by spinning in a loop instead of sleeping, like the ones of chapter 09. A handler may take one, because spinning is not sleeping. The handler stores the result, sets the done flag under the spinlock and calls `wake_up_interruptible`. `read` waits with `wait_event_interruptible` on the done flag instead of polling.

A spinlock alone is not enough. Process context must take it with `spin_lock_irq` or `spin_lock_irqsave`, which also turn off interrupts on the local CPU until the matching unlock. Otherwise the handler could interrupt the lock holder on the same CPU and spin forever on the lock that the interrupted code holds.

![Top row: write takes the lock with plain spin_lock, the MSI interrupts it on the same CPU, and edu_irq spins forever. Bottom row: write takes it with spin_lock_irq, so the MSI waits until the unlock and edu_irq then takes the free lock.](figures/16-irq-deadlock.svg)

In the handler, a plain `spin_lock` is enough, because interrupts are already off on that CPU while it runs. A handler on another CPU only spins until the holder unlocks.

`spin_lock_irqsave(&lock, flags)` saves whether interrupts were on into `flags`, and `spin_unlock_irqrestore` puts them back. Use it in code that may run with interrupts already off. `spin_lock_irq` turns them back on at unlock, and fits code that always runs with interrupts on, like `read` and `write`.

This deadlock needs an interrupt at the wrong moment, so a test can pass with the bug in place. Your `edutest` will. Lockdep finds it without the timing. It notes that your handler takes the lock in hard interrupt context, and that `write` once held the same lock with interrupts on. That pair can deadlock, and lockdep reports it the first time it sees both, even when nothing hung.

### Study

- [Linux Kernel Labs: I/O access and Interrupts](https://linux-kernel-labs.github.io/refs/heads/master/labs/interrupts.html#locking) (read, 15 min): The last two paragraphs of "Background information", from "When we need to access shared resources", then "Locking" under "Interrupt handling".
- [Unreliable Guide To Locking](https://docs.kernel.org/kernel-hacking/locking.html#hard-irq-context) (read, 10 min): "Hard IRQ Context" through "Locking Between Two Hard IRQ Handlers", in the guide you started in the character device step. Softirqs and tasklets there are other kinds of bottom half. Read them as "code that a hardware interrupt can interrupt".
- [Linux kernel docs: Runtime locking correctness validator](https://docs.kernel.org/locking/lockdep-design.html#state) (reference, as needed): "State" and "Single-lock state rules", for the `{IN-HARDIRQ-W}` notation in lockdep's report.

### Build

1. Add a `spinlock_t`, a done flag, the result and a wait queue to `struct edu`. Call `spin_lock_init` and `init_waitqueue_head` in `probe` before `request_irq`.
2. Replace polling. `write` clears the done flag under `spin_lock_irq`, then sets bit 0x80 and writes n. The handler, after acknowledging, takes the spinlock and on bit 0x01 reads the result from 0x08 and sets done, then unlocks and wakes the queue. `read` waits with `wait_event_interruptible` on the done flag, returns `-ERESTARTSYS` on a signal, and reads the result under `spin_lock_irq`.
3. Break it on purpose. In `write`, change `spin_lock_irq` and `spin_unlock_irq` to `spin_lock` and `spin_unlock`. Load the module, run `./edutest`, and read the lockdep report in `dmesg`. Lockdep reports only the first problem it finds and then turns itself off, so put the lines back and reboot the guest.

### Done when

`./edutest` matches all 14 values with no polling left in the driver, and the `edu` line of `/proc/interrupts` still grows by 14 per run. The broken `write` produced "WARNING: inconsistent lock state" with `inconsistent {HARDIRQ-ON-W} -> {IN-HARDIRQ-W} usage`, and you can find `edu_irq` and `edu_write` in the report. Its "Possible unsafe locking scenario" draws the same deadlock as the figure, on `CPU0`. You can draw the deadlock of the figure for your own `write` and say which line of it the fix changed.

## Deferred work: the bottom half

Some work after an interrupt is slow or needs to sleep, and the handler may do neither. So a driver splits the work. The handler is the **top half**: it does the minimum with the device and returns. The rest runs later in process context and is the **bottom half**.

The usual bottom half is a **workqueue**. Kernel threads named `kworker` take queued work items and call their functions in process context, where they may sleep and take mutexes. You embed a `struct work_struct` in your device state, set it up with `INIT_WORK(&e->work, edu_work)`, and the handler calls `schedule_work(&e->work)`. Many drivers use `request_threaded_irq` instead, which runs a second handler function in a kernel thread of its own. This chapter uses a workqueue because the lab teaches it.

Your bottom half keeps statistics. Each interrupt produces a record with a timestamp from `ktime_get_ns` (nanoseconds since boot, declared in `include/linux/timekeeping.h`), the interrupt status bits and the result register. The driver keeps a count of all records and the newest one, and user space reads both with an ioctl. That state lives under the mutex, which the handler cannot take, so the records travel through a pending array:

![edu_irq adds each record to pending under the spinlock and schedules edu_work. edu_work drains pending into a local array and adds the records to the statistics under the mutex. remove frees the interrupt, then cancels the work, then frees the state.](figures/16-deferred.svg)

1. The handler appends the record to a 16-entry pending array under the spinlock. If the array is full, it counts a dropped record instead. Then it calls `schedule_work`.
2. The work function moves the pending records into a local array under `spin_lock_irq` and unlocks.
3. It takes the mutex, adds the records to the count, keeps the newest and unlocks.

An interrupt tells the driver that the device needs attention. It does not count events. If the device raises a second interrupt while the first is still pending, the two can merge into one. The `edu` interrupt status register is a bitmask, so two raises with the same value can look like one. Your handler must handle every bit it finds in one call.

A raise can also land between the handler's read of 0x24 and its write to 0x64. The write acknowledges it unseen, but its MSI is already on the way, so the handler runs again, reads 0 and returns `IRQ_NONE`. Count those calls too.

In the same way, `schedule_work` on a work item that is already queued does nothing, so one run of the work function must drain everything pending.

Teardown has an order, the bottom row of the figure. `free_irq` waits for a running handler to finish and stops new ones, so after it nothing can call `schedule_work`. Then `cancel_work_sync` waits for queued work to finish. Only then may `remove` free the state the work function uses.

### Study

- [Linux Kernel Labs: Deferred work](https://linux-kernel-labs.github.io/refs/heads/master/labs/deferred_work.html#background-information) (read, 30 min): "Background information", then "Workqueues". Skip "Softirqs", "Kernel threads" and the exercises. Tasklets, in the skipped part, are being phased out of the kernel. When you read the lab: it mentions `flush_scheduled_work`, and current kernels print a build warning when a module calls it, so use `cancel_work_sync` on your own work item.

### Build

1. Add an ioctl `EDU_RAISE`, built with `_IOW('e', 1, __u32)`, that writes its argument to register 0x60. Reject 0 and values with bit 0x01 set, which would look like a finished factorial.
2. Add the `work_struct`, the pending array, the dropped count, a count of `IRQ_NONE` returns, the record count and the newest record to `struct edu`, with `INIT_WORK` in `probe` before `request_irq`. The handler counts `IRQ_NONE` returns and dropped records under the spinlock. In `remove` and the unwind path, call `free_irq` before `cancel_work_sync`.
3. Add an ioctl `EDU_STATS`, built with `_IOR('e', 2, struct edu_stats)`, that copies the record count, the dropped count, the `IRQ_NONE` count and the newest record to user space. Copy them into a local struct under the mutex and the spinlock, unlock, then call `copy_to_user`. Put the struct and both commands in `edu.h`, and include `<linux/types.h>` there for `__u32` and `__u64`, which mean the same in the kernel and in user programs.
4. Extend `edutest` with `edutest raise N`, which issues N `EDU_RAISE` calls with the value 0x10, and `edutest stats`, which prints what `EDU_STATS` returns.
5. Write `stress.sh` for the guest. Each `insmod` may get a different major, and a node made with `mknod` stays after `rmmod`, so each round makes a fresh node:

   ```sh
   #!/bin/sh
   for i in $(seq 20); do
       insmod edu.ko || exit 1
       rm -f /dev/edu
       mknod /dev/edu c $(grep -w edu /proc/devices | cut -d' ' -f1) 0
       ./edutest raise 2000 || exit 1
       rmmod edu || exit 1
   done
   echo "20 rounds done"
   ```

   `grep -w edu` matches the line whose word is exactly `edu`, and `cut -d' ' -f1` keeps the text before the first space, the major.

### Done when

After `./edutest`, `./edutest stats` shows the record count up by 14 and a newest record with status 0x1 and the value 13! mod 2^32, 1932053504. Around `./edutest raise 10000`, the growth of the record count, the dropped count and the `IRQ_NONE` count adds up to the growth of the `edu` line in `/proc/interrupts`. That total may be below 10,000, and you can explain where the missing raises went. `stress.sh` finishes 20 rounds with no oops and no warning in `dmesg`. You can say what could go wrong in `remove` if `cancel_work_sync` came before `free_irq`.

> **Optional:** Two more debugging options catch teardown bugs that `stress.sh` may miss. `KASAN` reports any access to freed memory, and `DEBUG_OBJECTS_WORK` reports a work item that is freed while still queued. Turn them on with `scripts/config`, rebuild the kernel and your modules, and run `stress.sh` again.

## mmap: an event ring shared with user space

So far every byte crossed between user space and the kernel through `copy_to_user`, one system call at a time. `mmap` removes the copy. The driver puts one physical page into the calling process's page table. Afterwards the process reads kernel memory with ordinary loads, and the kernel's writes show up with no system call at all. This is chapter 08's page tables seen from a driver.

When a process calls `mmap` on your device, the kernel creates a `struct vm_area_struct` (a VMA) for the new address range and calls your `mmap` file operation with it. Your function fills in the page table entries, here with `remap_pfn_range`, which takes a **page frame number** (PFN): a physical address divided by the page size. It also decides what the process may do. Your event ring is written only by the kernel, so the driver refuses a writable mapping. It returns `-EPERM` if `vma->vm_flags` contains `VM_WRITE`, and calls `vm_flags_clear(vma, VM_MAYWRITE)` so that `mprotect` cannot add write access later.

The ring is one page that the kernel and the process both map. On x86-64 the kernel maps all of RAM at a fixed offset, the **direct map**, at addresses that start with `0xffff888` in your guest. So `virt_to_phys` works on any address from `kmalloc` or `get_zeroed_page`.

![One physical page holds the ring: head, pad and 255 event slots. edu_work writes it through the kernel's direct map at e->ring, and edumon reads the same page through the read-only entry that remap_pfn_range put in its page table, checking head before and after each copy.](figures/16-ring.svg)

```c
struct edu_event { __u64 t_ns; __u32 status; __u32 value; };
struct edu_ring {
        __u32 head;             /* number of events ever written */
        __u32 pad;
        struct edu_event ev[];  /* (4096 - 8) / 16 = 255 slots */
};
```

Only the work function writes the ring, and the kernel never runs one work item on two CPUs at once, so the ring has a single writer. The work function fills `ev[head % 255]` and then publishes it with `smp_store_release(&ring->head, head + 1)`, whose comment is in `include/asm-generic/barrier.h`.

The reader loads `head` with `__atomic_load_n(&ring->head, __ATOMIC_ACQUIRE)` and then reads the slots before it. `__atomic_load_n` is the clang and gcc builtin behind chapter 09's `atomic_load_explicit`, and it works on the plain `__u32` field. This is chapter 09's release and acquire pair, with the kernel on one side and a process on the other. On x86-64 both compile to plain moves. They still state the order for the compiler and for ARM64.

A slow reader can be lapped, and it checks twice:

1. Before copying, if `head` has moved more than 255 past the next event it wants, it skips to the oldest event still in the ring and counts the lost ones.
2. After copying a slot, it loads `head` again. If `head` is now more than 255 past that event, the writer may have overwritten the slot during the copy, so the reader drops the copy.

The open file holds a reference to your module through `.owner`, and a mapping holds a reference to the open file. So `rmmod` fails while any process has the ring mapped, and freeing the page in `remove` is safe for a device like `edu` that is never unplugged.

### Study

- [Linux Kernel Labs: Memory mapping](https://linux-kernel-labs.github.io/refs/heads/master/labs/memory_mapping.html#overview) (read, 40 min): Read "Overview", "Structures used for memory mapping" with its three subsections, and "Device driver memory mapping". Skip the exercises. When you read the lab: it was written for 32-bit x86 and older kernels. Lowmem and highmem matter only on 32-bit machines, `vm_next` and `vm_prev` were removed in Linux 6.1, and kernel memory is never swapped, so skip its `SetPageReserved` code.
- [Linux kernel docs: Memory Management APIs](https://docs.kernel.org/core-api/mm-api.html) (reference, as needed): Search the page for `remap_pfn_range` for its exact signature and return value. `vm_flags_clear` is a short inline function in `include/linux/mm.h` of your kernel tree.

### Build

1. In `probe`, allocate the ring with `get_zeroed_page(GFP_KERNEL)` and free it with `free_page` in `remove` and in the unwind path. The work function now also writes each record it takes from the pending array into the ring. It does that outside the mutex, since it is the ring's only writer.
2. `mmap`: accept only an offset of 0 and a length of exactly one page, refuse writable mappings as above, then call `remap_pfn_range(vma, vma->vm_start, virt_to_phys(ring) >> PAGE_SHIFT, PAGE_SIZE, vma->vm_page_prot)`.
3. `edumon.c`: open `/dev/edu`, map the ring read-only with `mmap(NULL, 4096, PROT_READ, MAP_SHARED, fd, 0)`, and print each new event as it appears. `edumon` polls `head` every millisecond, or at an interval in milliseconds given as its argument. It checks `head` before and after each copy as described, and reports laps and how many events each lap lost.
4. Add `edutest loop N`, which computes 5! N times and then checks two mappings. A `PROT_READ | PROT_WRITE`, `MAP_SHARED` mapping must fail with `EPERM`, and a two-page mapping with `EINVAL`. With a read-only file descriptor the kernel refuses a shared writable mapping with `EACCES` before your driver sees it, so `edutest` opens the device `O_RDWR` for this test.

### Done when

With `./edumon &` running, `./edutest` makes it print 14 events with status 0x1, increasing timestamps and the factorial results, and the last one matches the newest record `./edutest stats` shows. `./edumon 2000 &` followed by `./edutest loop 1000` reports a lap. Writable and oversized mappings fail with the expected errors.

`rmmod edu` fails while `edumon` runs and succeeds after you stop it. `grep /dev/edu /proc/$(pidof edumon)/maps` shows the mapping with permissions `r--s`. You can say which line of the work function makes an event visible to `edumon` and why the order of the two stores matters.

## Where this leads

You now have a driver that a production kernel calls in four ways. The PCI core calls `probe` when it finds your device. The VFS calls your file operations when a process uses `/dev/edu`. The interrupt core calls your handler when the device signals, and a kernel thread runs your deferred work. The memory manager lets your `mmap` put a page of yours into a process.

Real drivers write less teardown code than yours. The kernel's `devm_` functions, such as `devm_kzalloc` and `devm_request_irq`, record each resource against the device and free them all after `remove`, which replaces most of the `goto` unwinding you wrote by hand. You will recognize them in any driver you read.

Linux also hid the hardware from you. QEMU emulated a simple PCI device, and the PCI core found it, mapped it and routed its interrupt. Chapter 17, Embedded firmware, removes all of that.

On the Raspberry Pi Pico 2's RP2350 there is no kernel and no bus to search. The chapter starts with a cross compiler for the chip's Arm core and the chip's memory map, the fixed address of every piece of hardware. Then you write the linker script and the startup code that the boot ROM needs before it runs your image, all before the board arrives. After that you flash the image over a debug probe, step through it in gdb and turn on a pin by writing a bit at an address from the datasheet.

WSL2 sees a USB device only after you attach it from Windows, and that chapter shows how. The hardware takes a while to arrive, so order a Pico 2 and a debug probe now from the list at the top of chapter 17.
