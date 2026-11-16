---
id: 16
title: Linux drivers
part: Kernels and bare metal
weeks: 3
project: A Linux driver for QEMU's edu PCI device that exposes a character device with blocking reads, handles the device's interrupt with work deferred to process context, and maps an event ring into user space, all loaded into a kernel you compile and boot yourself.
---

Chapter 15 ended with a kernel of your own booting on QEMU. You filled in an interrupt table, acknowledged the interrupt controller by hand, built page tables and switched between two tasks. Every device that kernel touched needed code you wrote from the register level up.

Linux supports thousands of devices, so it splits the work. The kernel core owns the interrupt entry path, the page tables, the scheduler and the file system. A driver fills in interfaces that the core calls. A character driver fills in a table of functions that the kernel calls when a process opens, reads, writes or maps a file in `/dev`. A PCI driver fills in a `probe` function that the kernel calls when it finds a matching device on the bus. An interrupt handler is a function the kernel calls after its own entry code has saved the registers and found out which device fired. This chapter has you write one driver that does all three, for a device that QEMU emulates for teaching.

You will not load modules into the kernel of your OrbStack machine. That kernel belongs to OrbStack. The OrbStack machines page from chapter 01 has a "Kernel headers" section that says custom modules are possible but not supported and need a rebuild after nearly every OrbStack update. You compile Linux yourself instead, boot it in QEMU with a tiny root file system, and load your modules there. A bug in your driver then crashes a virtual machine that boots again in seconds.

The chapter sits between your own kernel and Embedded firmware. Your kernel showed you the mechanisms with nothing in between. Linux shows you how a production kernel wraps the same mechanisms in interfaces that thousands of drivers share. Chapter 17 removes every layer again on a real microcontroller.

## A Linux kernel you can crash

The setup has three layers. The Mac runs your OrbStack machine. The OrbStack machine builds the kernel and your modules and runs QEMU. QEMU runs your kernel on an emulated ARM64 board called `virt`, with one extra PCI device, `edu`.

```
  Mac
   OrbStack machine: Ubuntu 24.04, ARM64
     ~/linux-6.18.63     kernel source and build output
     ~/drivers           your modules, test programs, initramfs
     qemu-system-aarch64 -M virt
       your kernel + a busybox initramfs
       /mnt            = ~/drivers, shared over 9p
       PCI 1234:11e8   = the edu device
```

The OrbStack page also says, under "Nested virtualization", that Apple Silicon cannot run KVM inside a VM. So QEMU here translates every guest instruction in software. A minimal system still boots to a shell in about five to ten seconds.

The kernel needs a root file system to run anything. The smallest one is an initramfs: a cpio archive that the kernel unpacks into a RAM file system at boot. The kernel then runs `/init` from it as process 1. Yours holds one static binary, busybox, which provides a shell and the usual tools (`ls`, `dmesg`, `insmod`, `mount`) as one program. `/init` is a shell script that mounts `/proc`, `/sys` and `/dev`, mounts your `~/drivers` directory at `/mnt` and starts a shell. Any program you run in the guest must be linked statically, because the guest has no C library.

Read the initramfs document for the idea and the file list format. It names the packing tool `scripts/gen_init_cpio`. In current kernels the tool is `usr/gen_init_cpio`, built with the kernel.

### Study

- [Linux kernel docs: Ramfs, rootfs and initramfs](https://docs.kernel.org/filesystems/ramfs-rootfs-initramfs.html) (read, 30 min): By Rob Landley. Read "What is ramfs?", "What is rootfs?", "What is initramfs?", "Populating initramfs" and "Contents of initramfs". Skip the comparisons with ramdisk and tmpfs and "Future directions".
- [QEMU docs: 'virt' generic virtual platform](https://www.qemu.org/docs/master/system/arm/virt.html) (reference, as needed): "Supported devices" lists what the board emulates. "Linux guest kernel configuration" confirms that `defconfig` covers it.
- [Linux kernel docs: Debugging kernel and modules via gdb](https://docs.kernel.org/process/debugging/gdb-kernel-debugging.html) (reference, as needed): "Setup" for attaching gdb to QEMU, and the `lx-dmesg` and `lx-symbols` commands under "Examples of using the Linux-provided gdb helpers".

### Build

1. In the OrbStack machine, install the build dependencies, fetch Linux 6.18 (the current longterm release) and build it. Keep the tree in the Linux home directory. The Mac's file system ignores case, and the kernel tree has file names that differ only in case.

   ```sh
   sudo apt install -y flex bison bc libssl-dev libelf-dev qemu-system-arm busybox-static
   cd ~
   curl -LO https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.18.63.tar.xz
   tar xf linux-6.18.63.tar.xz && cd linux-6.18.63
   make defconfig
   scripts/config -d DEBUG_INFO_REDUCED -e GDB_SCRIPTS -e DEBUG_ATOMIC_SLEEP
   make olddefconfig
   make -j$(nproc)
   make scripts_gdb
   ```

   If 6.18.63 has been superseded, use the newest 6.18.y. The full build takes 15 to 40 minutes. It builds `arch/arm64/boot/Image`, `vmlinux` with debug symbols, `usr/gen_init_cpio` and the `Module.symvers` file that your modules link against. The ARM64 `defconfig` already turns on debug information but trims it. Turning off `DEBUG_INFO_REDUCED` keeps the full types that gdb's kernel helpers need. `GDB_SCRIPTS` and `make scripts_gdb` set up those helpers. `DEBUG_ATOMIC_SLEEP` makes the kernel complain when code sleeps where it must not. You will trigger that check in the interrupt step.

2. In `~/drivers`, write `init`:

   ```sh
   #!/bin/busybox sh
   /bin/busybox --install -s /bin
   mount -t proc proc /proc
   mount -t sysfs sysfs /sys
   mount -t devtmpfs devtmpfs /dev
   mount -t 9p -o trans=virtio,version=9p2000.L host /mnt
   echo "booted in $(cut -d' ' -f1 /proc/uptime) s"
   exec setsid cttyhack sh
   ```

   and `initramfs.list`:

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

   Pack it with `~/linux-6.18.63/usr/gen_init_cpio initramfs.list > initramfs.cpio`.

3. Write `run.sh` and start the guest with it. Leave QEMU with Ctrl-a then x.

   ```sh
   #!/bin/sh
   exec qemu-system-aarch64 -M virt -cpu max -smp 2 -m 1G -nographic -nic none \
       -kernel ~/linux-6.18.63/arch/arm64/boot/Image \
       -initrd ~/drivers/initramfs.cpio \
       -append "console=ttyAMA0 nokaslr" \
       -device edu \
       -virtfs local,path=$HOME/drivers,mount_tag=host,security_model=none \
       -s
   ```

   `nokaslr` keeps kernel addresses the same on every boot, so gdb's symbols match. `-nic none` leaves out the network card, which the guest does not use. `-s` opens a gdb server on port 1234.

4. Run `echo "add-auto-load-safe-path $HOME/linux-6.18.63" >> ~/.gdbinit`, so gdb loads the kernel's helper scripts. In a second OrbStack shell, `cd ~/linux-6.18.63`, run `gdb-multiarch vmlinux` (installed in chapter 08), then `target remote :1234`. gdb stops the guest. Run `bt` and `lx-dmesg`, then `continue` to resume the guest.

### Done when

The guest prints its boot time and a `#` prompt. In the guest, `uname -r` prints `6.18.63`, `ls /mnt` lists your `~/drivers` files, and `grep -l 0x11e8 /sys/bus/pci/devices/*/device` names exactly one device. From gdb, `lx-dmesg` prints the same log as `dmesg` in the guest. You can say what runs as process 1 and where its file came from.

## Modules: code loaded into the running kernel

A module is an ELF relocatable object, a `.ko` file. `insmod` hands it to the kernel, which allocates memory for its sections, resolves its undefined symbols against the symbols the kernel exports, applies the relocations and calls its init function. That is chapter 05's static linker running inside the kernel at load time. `rmmod` calls the exit function and frees the memory.

You build a module with the kernel's own build system, Kbuild, pointed at the kernel tree it will load into. The kernel and the module must come from the same tree and configuration, so build against `~/linux-6.18.63`, never against the OrbStack kernel's headers. LKMPG's Makefile uses `/lib/modules/$(shell uname -r)/build`. Replace that with your tree:

```make
KDIR ?= $(HOME)/linux-6.18.63
obj-m += hello.o

all:
	$(MAKE) -C $(KDIR) M=$(CURDIR) modules
clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) clean
```

Code in a module is kernel code, with the kernel's rules. There is no C library, so `printf` becomes `pr_info` and `malloc` becomes `kmalloc`. Floating point is off limits. The stack is 16 KB on ARM64 and does not grow. Every function runs in some context. Your init function runs in user context, on behalf of the `insmod` process, and may sleep. An interrupt handler runs in hard interrupt context and must not. Rusty Russell's guide names these contexts, and the next four steps keep asking which one a piece of code runs in.

A bad pointer dereference in a module does not kill one process. The kernel prints an oops: the faulting address, the registers and a call trace with entries like `oops_init+0x14/0x30 [oops]`. That entry means 0x14 bytes into `oops_init`, a function 0x30 bytes long, in module `oops`. `gdb oops.ko`, then `list *oops_init+0x14`, turns it into a source line, because your modules carry debug information from the kernel's configuration. The process that triggered the oops dies, and the kernel may be left in a broken state. Reboot the guest after every oops.

### Study

- [The Linux Kernel Module Programming Guide](https://sysprog21.github.io/lkmpg/#hello-world) (read, 1 h 30 min): Sections 4.1 to 4.5, then 5.1 to 5.6. Skip the part of 4.1 about `sudo` and `env_reset`, which does not apply in the guest, and skip 1.8, whose QEMU scripts build an x86 guest.
- [Unreliable Guide To Hacking The Linux Kernel](https://docs.kernel.org/kernel-hacking/hacking.html) (read, 30 min): By Rusty Russell. Read "Introduction", "The Players" with its three subsections, and "Some Basic Rules". Skip the rest until a later step points back to it.
- [Linux kernel docs: Bug hunting](https://docs.kernel.org/admin-guide/bug-hunting.html) (reference, as needed): "Finding the bug's location", the gdb subsection. Its examples are 32-bit x86 oopses. The `list *function+offset` method works the same on ARM64.

### Build

1. `hello.c` with an `int count` module parameter. Init prints "hello" `count` times with `pr_info` and returns `-EINVAL` if `count` is negative. Exit prints "goodbye". Mark the functions `__init` and `__exit` and fill in `MODULE_LICENSE` and `MODULE_DESCRIPTION`.
2. Build in the OrbStack machine with `make`. Boot the guest, then `insmod /mnt/hello.ko count=3`, `lsmod`, `cat /sys/module/hello/parameters/count`, `rmmod hello` and `dmesg | tail`.
3. `oops.c`, whose init writes through a NULL pointer. Load it, read the oops, find the faulting line with gdb on the host, reboot the guest.

### Done when

`insmod hello.ko count=3` prints three lines, `rmmod hello` prints "goodbye", and `insmod hello.ko count=-1` fails with "Invalid argument" and leaves nothing in `lsmod`. For the oops, you have the source line gdb printed and you can read the faulting address and the call trace in the oops text. You can name the context that `hello`'s init runs in and one thing that context allows which an interrupt handler may not do.

## A character device: a pipe in the kernel

A character device is a file in `/dev` whose `read`, `write` and `ioctl` go to a driver. The file carries a major and a minor number. The major picks the driver and the minor picks one of its devices. The driver asks for a number range with `alloc_chrdev_region`, fills a `struct file_operations` with its functions, and registers a `struct cdev` that ties the two together. From then on, chapter 08's `read(fd, buf, n)` arrives in your `read` function as a `struct file *`, a user pointer, a count and a file offset.

A user pointer is an address in the calling process's page table, which may be unmapped, swapped out or simply wrong. The kernel never dereferences one directly. `copy_to_user` and `copy_from_user` do the copy and handle the fault if the address is bad. They return the number of bytes they could not copy, and your driver turns a nonzero result into `-EFAULT`. Both may sleep while a page is brought in, which is legal in user context. The lab includes `<asm/uaccess.h>`. Current kernels want `<linux/uaccess.h>`.

The device you build is a pipe with a 4 KB ring buffer. `write` copies in what fits and `read` copies out what is there. When the buffer is empty, `read` sleeps on a wait queue until a writer adds data. When it is full, `write` sleeps until a reader makes room. A wait queue plays the role of chapter 09's condition variable. Several processes can call into the driver at once, so a mutex protects the buffer. You must not sleep on the wait queue while holding the mutex, or the writer that would wake you can never take it. The shape of `read` is:

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
/* copy at most p->len bytes out, advance the read index */
mutex_unlock(&p->lock);
wake_up_interruptible(&p->writeq);
```

The condition is checked again under the lock, because another reader may have emptied the buffer between the wake-up and `mutex_lock`. `-ERESTARTSYS` tells the kernel a signal interrupted the call. The process sees `EINTR`, or the call restarts if the signal handler asked for that.

The guest has `devtmpfs` but your driver does not create a device node. Read the major from `/proc/devices` and make the node by hand: `mknod /dev/kpipe c <major> 0`.

### Study

- [Linux Kernel Labs: Character device drivers](https://linux-kernel-labs.github.io/refs/heads/master/labs/device_drivers.html) (read, 1 h 15 min): From the University POLITEHNICA of Bucharest's Linux kernel course. Read from "Overview" through "Waiting queues", which includes "Access to the address space of the process" and "ioctl". Skip "Exercises" and "Extra Exercises". They need the course's x86 VM and skeleton code.
- [Unreliable Guide To Locking](https://docs.kernel.org/kernel-hacking/locking.html#locking-in-the-linux-kernel) (read, 20 min): By Rusty Russell. Read "Locking in the Linux Kernel" through "Locking Only In User Context", then "What Functions Are Safe To Call From Interrupts?" with "Some Functions Which Sleep". Skip the sections in between, which cover softirqs and timers.

### Build

1. `kpipe.c`: a 4096-byte ring buffer, a mutex and two wait queues in one `struct kpipe`. Register one minor with `alloc_chrdev_region` and `cdev_add`. In `open`, set `file->private_data` from `inode->i_cdev` with `container_of`, as the lab shows. Undo every registration in reverse order on any init failure and in exit.
2. `read` and `write` follow the shape above. Each returns the number of bytes it moved, which may be fewer than asked. A count of zero returns 0 at once. With `O_NONBLOCK`, an empty or full buffer returns `-EAGAIN`.
3. `ioctl` with two commands built with `_IOR` and `_IO`, the shorthand forms of the lab's `_IOC`: `KPIPE_LEVEL` copies the number of buffered bytes to a user `int`, and `KPIPE_CLEAR` empties the buffer and wakes writers. Unknown commands return `-ENOTTY`. Put the command numbers in `kpipe.h`, shared with user space.
4. `kpipetest.c`, built in the OrbStack machine with `gcc -static`. `kpipetest w N` writes N bytes of the pattern `i * 7 % 251` in chunks of random size up to 10,000. `kpipetest r N` reads N bytes in random chunks and checks the pattern. `kpipetest errors` checks that a read into address 1 returns `EFAULT`, a nonblocking read on an empty pipe returns `EAGAIN`, an unknown ioctl returns `ENOTTY`, and `KPIPE_LEVEL` reports a value it just wrote.

### Done when

In the guest, `./kpipetest w 1000000 & ./kpipetest r 1000000` reports no mismatch, and `./kpipetest errors` passes. A reader blocked on an empty pipe returns `EINTR` when you send it `kill -INT`. `rmmod kpipe` fails while any process holds the device open and succeeds after the last one closes it. You can say why the mutex is dropped before the wait and why the condition is checked again after it.

## A PCI driver for QEMU's edu device

The pipe had no hardware behind it. Now you drive a device. QEMU's `edu` device exists for teaching driver writing. It sits on the PCI bus with vendor ID 0x1234 and device ID 0x11e8. It exposes 1 MB of registers through its first base address register (BAR 0). It computes factorials, raises interrupts on request and performs DMA. Its specification is one page. Read all of it before writing code.

Software can discover PCI devices. At boot the kernel walks the bus, reads each device's configuration space and records the vendor and device IDs and the address ranges of its BARs. Your driver registers a `struct pci_driver` with a table of IDs it supports. For each match, the PCI core calls your `probe` with a `struct pci_dev`. You never hard-code a physical address. Your kernel in chapter 15 knew where its devices lived. A PCI driver asks the core.

`probe` takes the device in a fixed order. It enables the device, claims its BAR regions so no other driver can, maps BAR 0 into kernel virtual memory with `pci_iomap`, initializes its own state and registers the character device. `remove` undoes the same steps in reverse. The mapping returns a `void __iomem *`. You access it only through `ioread32` and `iowrite32`, never with `*p`. The accessors make exactly one access of the width the device expects, which the compiler is free to change for a plain pointer. On ARM64 they also contain the barriers that order device accesses against ordinary memory accesses. The kernel maps device registers uncached, so a read always reaches the device.

```
  BAR 0 (MMIO)        edu registers you use now
  +0x00  RO   identification   0xRRrr00ed
  +0x04  RW   liveness check   reads back ~value
  +0x08  RW   factorial        write n, read n! when done
  +0x20  RW   status           bit 0x01: computing
```

The factorial runs in a separate QEMU thread, so a result is ready only when the "computing" bit clears. For this step your `read` polls that bit with `usleep_range(10, 20)` between checks and gives up with `-ETIMEDOUT` after 100 ms. Polling is legal here because `read` runs in user context and may sleep. The device computes in 32 bits, so 13! wraps modulo 2^32.

### Study

- [QEMU docs: EDU device](https://www.qemu.org/docs/master/specs/edu.html) (read, 15 min): The whole page. Leave "DMA controller" for later, as this chapter does not use DMA.
- [Linux kernel docs: How To Write Linux PCI Drivers](https://docs.kernel.org/PCI/pci.html) (read, 50 min): By Martin Mares and Grant Grundler. Read 1.1, 1.2, 1.4.1, 1.4.2, 1.4.5, then 1.5.5 to 1.5.7 and 1.11 on write posting. Skip 1.4.3, 1.4.4 and 1.5.3 to 1.5.4, which cover DMA. Leave 1.4.6, 1.5.1 and 1.5.2 for the next step.
- [Linux kernel docs: Bus-Independent Device Accesses](https://docs.kernel.org/driver-api/device-io.html#memory-mapped-io) (reference, as needed): "Memory Mapped IO" and "__iomem pointer tokens" for why `ioread32` exists, "Differences between I/O access functions" for the `ioread32` family, and `pci_iomap` under "Higher-level ioremap abstractions". Skip "Port Space Accesses", which is an x86 feature.

### Build

1. `edu.c`: an ID table with `PCI_DEVICE(0x1234, 0x11e8)` and `MODULE_DEVICE_TABLE(pci, ...)`. `module_pci_driver(edu_driver)` writes the module's init and exit functions for you, which call `pci_register_driver` and `pci_unregister_driver`. Allocate one `struct edu` per device in `probe` with `kzalloc` and attach it with `pci_set_drvdata`.
2. `probe`: `pci_enable_device`, `pci_request_regions`, `pci_iomap` of BAR 0. Print the major and minor version from the identification register with `dev_info`, which is `pr_info` with the device's name in front. Write a value to the liveness register and fail `probe` with `-ENODEV` unless you read back its complement. Unwind with `goto` labels in reverse order on every failure.
3. Move the character device code from `kpipe.c` into `struct edu`. `write` takes exactly 4 bytes, a `u32` n, writes it to the factorial register and returns 4. `read` takes at least 4 bytes, polls as described, and returns the result as a `u32`. A mutex keeps two processes from interleaving their write and read.
4. `remove` reverses `probe`: `cdev_del`, `unregister_chrdev_region`, `pci_iounmap`, `pci_release_regions`, `pci_disable_device`, `kfree`.
5. `edutest.c`: for n from 0 to 13, write n, read the result and compare it with a 32-bit factorial computed in user space.

### Done when

`insmod edu.ko` prints the device's version. `grep edu /proc/iomem` shows the claimed BAR and `ls /sys/bus/pci/drivers/edu` shows the bound device. `./edutest` matches all 14 values. `rmmod edu` succeeds, the BAR disappears from `/proc/iomem`, and `insmod` then works again. You can say what would break if `remove` ran `pci_release_regions` before `cdev_del`.

## Interrupts and deferred work

Polling makes `read` wake up again and again to check one bit. The edu device can raise an interrupt instead: set bit 0x80 in the status register before writing n, and the device raises interrupt 0x01 when the factorial is done. Writing any value to register 0x60 raises an interrupt with that value. The handler reads the interrupt status register at 0x24, writes the same bits to 0x64 to acknowledge them, and returns `IRQ_HANDLED`. If it does not acknowledge, the device keeps the interrupt raised.

In chapter 15 your handler ran straight from the vector table. In Linux, the kernel's entry code saves the registers, asks the interrupt controller which line fired and calls every handler registered on that line. You register with `request_irq`. A PCI device can signal on a shared pin (INTx) or by writing a message to the interrupt controller (MSI). `pci_alloc_irq_vectors(pdev, 1, 1, PCI_IRQ_ALL_TYPES)` picks whichever works, and `pci_irq_vector(pdev, 0)` gives the Linux IRQ number to pass to `request_irq`. On the `virt` board you get MSI. Pass `IRQF_SHARED` and return `IRQ_NONE` when the status register is zero, so the handler is also correct on a shared INTx line.

An MSI is a memory write that the device makes to the interrupt controller. A PCI device may write to memory only when its bus master bit is set, and `pci_enable_device` does not set it. Call `pci_set_master` in `probe`, as section 1.4.1 of the PCI guide describes. Without it the edu device sets its status bit and no interrupt ever arrives.

The handler runs in hard interrupt context. It must not sleep, so it cannot take your mutex, call `copy_to_user` or allocate with `GFP_KERNEL`. Data shared between the handler and your `read` needs a spinlock. In process context take it with `spin_lock_irqsave` or `spin_lock_irq`, which also disable interrupts on the local CPU. Otherwise the handler could interrupt you on the same CPU and spin forever on the lock you hold. In the handler a plain `spin_lock` is enough. The handler stores the result, sets a done flag and calls `wake_up_interruptible`. `read` waits on the queue with `wait_event_interruptible` instead of polling.

Some work after an interrupt is slow or needs to sleep. Here that work is keeping an event log: a 64-entry array of records with a timestamp, the interrupt status bits and the result register. User space reads the log with an ioctl, and the ioctl calls `copy_to_user`, which may sleep. So the log needs the mutex, and the handler cannot take the mutex. The handler instead appends a record to a 16-entry pending array under the spinlock and calls `schedule_work`. A kernel worker thread later runs your work function in process context. It moves the pending records out under the spinlock, then appends them to the log under the mutex. If the pending array is full, the handler counts a dropped record.

```
  device                 hard IRQ context                 process context
  irq ------> handler: read 0x24, ack 0x64,      ----> worker: take pending
              spin_lock, store result,                  under spin_lock_irq,
              add record to pending[16],                mutex_lock, append
              wake_up(readq), schedule_work             to log, mutex_unlock
                     |
                     +----> read() wakes in the process that called it
```

An interrupt tells the driver that the device needs attention. It does not count events. If the device raises a second interrupt while the first is still pending in the interrupt controller, the two merge into one. The edu interrupt status register is a bitmask, so two raises with the same value also look like one. Your handler must handle every bit it finds in one call.

Teardown order matters. `free_irq` waits for a running handler to finish and stops new ones, so after it nothing can call `schedule_work`. Then `cancel_work_sync` waits for queued work to finish. Only then may `remove` free the state the work function uses. The lab mentions `flush_scheduled_work`. Current kernels warn when a module calls it, so use `cancel_work_sync` on your own work item.

### Study

- [Linux Kernel Labs: I/O access and Interrupts](https://linux-kernel-labs.github.io/refs/heads/master/labs/interrupts.html#interrupt-handling) (read, 45 min): Read the end of "Background information", from "When we need to access shared resources", on locking between an interrupt handler and process context. Then read "Interrupt handling" with its four subsections. Skip "Accessing the hardware", which is x86 I/O ports, and the exercises, which use the x86 keyboard controller.
- [Linux Kernel Labs: Deferred work](https://linux-kernel-labs.github.io/refs/heads/master/labs/deferred_work.html#background-information) (read, 30 min): "Background information", then "Workqueues". Skip "Softirqs", "Kernel threads" and the exercises. Tasklets, in the skipped part, are being phased out of the kernel.
- [Linux kernel docs: How To Write Linux PCI Drivers](https://docs.kernel.org/PCI/pci.html#register-irq-handler) (read, 15 min): The parts you skipped last step: 1.4.6 "Register IRQ handler", then 1.5.1 "Stop IRQs on the device" and 1.5.2 "Release the IRQ".

### Build

1. In `probe`, call `pci_set_master` after `pci_enable_device`. After mapping BAR 0, call `pci_alloc_irq_vectors`, then `request_irq(pci_irq_vector(pdev, 0), edu_irq, IRQF_SHARED, "edu", edu)`. Log which kind of vector you got with `pdev->msi_enabled`. Add the matching `free_irq` and `pci_free_irq_vectors` to the unwind path and to `remove`.
2. Replace polling. `write` clears the done flag under the spinlock, sets bit 0x80 in the status register and writes n. The handler reads 0x24, acknowledges, and on bit 0x01 reads the result and sets done. `read` waits with `wait_event_interruptible` and returns `-ERESTARTSYS` on a signal.
3. Add an ioctl `EDU_RAISE` that writes its argument to register 0x60. Reject 0 and values with bit 0x01 set, which would look like a finished factorial.
4. Add a `work_struct`, the pending array and the 64-entry log to `struct edu`. The handler stamps each record with `ktime_get_ns`. Add an ioctl `EDU_EVENTS` that copies the number of records ever logged, the dropped count and the newest 64 records to a user struct, under the mutex. In `remove`, call `free_irq` before `cancel_work_sync`.
5. Break it on purpose. Put a `mutex_lock` and `mutex_unlock` on your mutex inside the handler, load the module and run `edutest`. Read the `DEBUG_ATOMIC_SLEEP` report, then remove the lines.
6. Extend `edutest` with `edutest raise N`, which issues N `EDU_RAISE` calls with value 0x10, and `edutest events`, which prints the log. Write a stress script that runs `edutest raise 2000` and then `rmmod edu` straight after it exits, 20 times in a row with `insmod` in between.

### Done when

`./edutest` still matches all 14 values, now without polling. Each factorial waits for its own interrupt, so `grep edu /proc/interrupts` grows by exactly 14 per run and `edutest events` shows 14 new records with status 0x01 and the right results. After `edutest raise 10000` the count grows by fewer than 10,000, and you can explain where the rest went. You can say whether your device uses MSI or INTx. The broken handler produced a "BUG: sleeping function called from invalid context" report and you can point at the line in the report that names your handler. The stress script finishes 20 rounds with no oops and no warning in `dmesg`. You can say what could go wrong in `remove` if `cancel_work_sync` came before `free_irq`.

## mmap: an event ring shared with user space

So far every byte crossed the user and kernel boundary through `copy_to_user`, one system call at a time. `mmap` removes the copy. The driver puts the same physical page into the calling process's page table. Afterwards the process reads kernel memory with ordinary loads, and the kernel's writes show up without any system call. This is how chapter 08's page tables look from a driver.

When a process calls `mmap` on your device, the kernel creates a `struct vm_area_struct` for the new address range and calls your `mmap` file operation with it. Your function decides which physical pages back the range and fills in the page table entries, here with `remap_pfn_range`. It also decides what the process may do. Your event ring is written only by the kernel, so the driver refuses a writable mapping. It returns `-EPERM` if `vma->vm_flags` contains `VM_WRITE` and calls `vm_flags_clear(vma, VM_MAYWRITE)` so `mprotect` cannot add write access later.

The lab was written for 32-bit x86 and older kernels, so read it with three corrections. Lowmem and highmem matter only on 32-bit machines. On ARM64 all of RAM is mapped in the kernel and `virt_to_phys` works on any `kmalloc` or `__get_free_page` address. `vm_next` and `vm_prev` were removed in Linux 6.1. The advice to set `PG_reserved` so pages are not swapped out does not apply here, because kernel memory is never swapped. Skip the `SetPageReserved` code.

The ring is one page laid out for both sides:

```c
struct edu_event { __u64 t_ns; __u32 status; __u32 value; };
struct edu_ring {
        __u32 head;             /* number of events ever written */
        __u32 pad;
        struct edu_event ev[];  /* (4096 - 8) / 16 = 255 slots */
};
```

Only the work function writes the ring, and the kernel never runs one work item on two CPUs at once, so the ring has a single writer. The work function fills `ev[head % 255]` and then publishes it with `smp_store_release(&ring->head, head + 1)`. The reader loads `head` with `__atomic_load_n(&ring->head, __ATOMIC_ACQUIRE)` and reads the slots before it. This is chapter 09's release and acquire pair, with the kernel on one side and a user process on the other. A slow reader can be lapped. It detects that when `head` moves more than 255 past the last event it read.

The page has to outlive every mapping of it. The mapping holds a reference to the open file, and the open file holds a reference to your module through `.owner = THIS_MODULE` in `file_operations`. So `rmmod` fails while any process has the ring mapped. Freeing the page in `remove` is then safe for this chapter's use. A device that can be unplugged while mapped needs reference counting on its state, so that the last of `remove` and the final `close` frees it. The edu device is never unplugged in this chapter.

### Study

- [Linux Kernel Labs: Memory mapping](https://linux-kernel-labs.github.io/refs/heads/master/labs/memory_mapping.html#overview) (read, 40 min): Read "Overview", "Structures used for memory mapping" with its three subsections, and "Device driver memory mapping", with the corrections above. Skip the exercises.
- [Linux kernel docs: Memory Management APIs](https://docs.kernel.org/core-api/mm-api.html) (reference, as needed): Search the page for `remap_pfn_range` for its exact signature and return value. `vm_flags_clear` is a short inline function in `include/linux/mm.h` of your kernel tree.

### Build

1. In `probe`, allocate the ring with `get_zeroed_page(GFP_KERNEL)` and free it with `free_page` in `remove` and in the unwind path. The work function appends each record to the ring as well as to the log.
2. `mmap`: accept only an offset of 0 and a length of exactly one page, refuse writable mappings as above, then `remap_pfn_range(vma, vma->vm_start, virt_to_phys(ring) >> PAGE_SHIFT, PAGE_SIZE, vma->vm_page_prot)`.
3. `edumon.c`: open the device, map the ring read-only, and print each new event as it appears. `edumon` polls `head` every millisecond, or at an interval in milliseconds given as its argument. It reports laps and how many events each lap lost.
4. Add `edutest loop N`, which computes 5! N times. `edutest` checks that a `PROT_READ | PROT_WRITE` mapping fails with `EPERM` and that a two-page mapping fails with `EINVAL`.

### Done when

With `./edumon &` running, `./edutest` makes it print 14 events with status 0x01, increasing timestamps and the factorial results, the same records `edutest events` shows. `./edumon 2000 &` followed by `./edutest loop 1000` reports a lap. Writable and oversized mappings fail with the expected errors. `rmmod edu` fails while `edumon` runs and succeeds after you stop it. `grep edu /proc/$(pidof edumon)/maps` shows the mapping with permissions `r--s`. You can say which line of the work function makes an event visible to `edumon` and why the order of the two stores matters.

## Where this leads

You now have a driver that a production kernel calls in three different ways. The PCI core calls `probe` when it finds your device. The file system calls your file operations when a process uses `/dev`. The interrupt core calls your handler when the device fires, and a kernel thread runs your deferred work. Each entry point runs in a known context with known rules, and the kernel did the part your chapter 15 kernel did by hand: saving registers, finding the device and the handler, and owning the page tables.

What Linux hid is the hardware itself. QEMU emulated a simple PCI device, and the PCI core found it, mapped it and routed its interrupt. Chapter 17, Embedded firmware, removes all of that. On the Raspberry Pi Pico 2's RP2350 there is no kernel and no bus enumeration. You read register addresses from a datasheet, write the startup code and linker script yourself, and turn on a pin by writing a bit at a fixed address. That chapter needs a Pico 2 and a debug probe, so order them now if you have not.
