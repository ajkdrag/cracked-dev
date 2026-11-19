---
id: 21
title: GPU programming with CUDA
part: GPUs and a tensor library
weeks: 12
project: A CUDA matrix multiply taken from a naive kernel through shared-memory and register tiling to tensor cores and measured against cuBLAS, then a fused online-softmax kernel called from PyTorch, with both kernels rewritten in Triton at the end.
---

Chapter 20 left you with a pull request in front of Valkey's maintainers and with C++, Zig and Odin read from below. The C++ is the part this chapter needs: constructors, destructors, templates and the code the compiler emits for each.

You have also used a GPU every working day for years, from Python: `.cuda()`, a matmul, a softmax, a training loop that runs fast for reasons you took on trust. In this chapter you write that GPU code yourself in **CUDA**, NVIDIA's C++ dialect for its GPUs. A function that runs on the GPU is called a **kernel**. The word has nothing to do with the operating system kernel of chapter 15.

Everything runs on your laptop, in Ubuntu under WSL2, and every number you compare comes from that laptop's GPU. The chapter has five parts:

- Steps 1 to 4 set up the toolkit, write first kernels and check them for errors.
- Steps 5 to 10 measure the card: how fast it moves memory, where a whole program spends its time, how threads are scheduled, how fast it computes, and which of the limits holds back a given kernel.
- Steps 11 and 12 let threads work together on one result, with a sum over an array as the first example.
- Steps 13 to 15 are the first project: matrix multiply from a naive kernel to the GPU's matrix units, measured against cuBLAS, NVIDIA's own matrix library.
- Steps 16 to 18 are the second project: a softmax that reads each row once, called from PyTorch, and then both kernels again in Triton, a compiler that makes many of your decisions for you.

The chapter comes this late because it uses almost everything before it. Chapter 07 gave you bandwidth, latency, dependency chains and SIMD lanes with masks. Chapter 09 gave you races and the rule that one thread sees another's write only through a synchronizing operation. Chapter 14 showed you a CPU that records commands for the GPU and moves on before they run, and shaders that the GPU runs once for every vertex and every pixel. Chapter 22, A tensor library, then builds a framework and runs your softmax kernel from this chapter under it.

## The GPU inside WSL2

Your Python code already reaches the GPU. To write kernels you also need a compiler and tools, and you need to know which pieces live in Windows and which in Ubuntu, because one wrong package breaks the setup.

Two pieces of NVIDIA software sit between a program and the GPU:

- The **driver** talks to the hardware. Its kernel part runs inside the operating system kernel. Its user part is a library, `libcuda.so`, that programs call.
- The **CUDA toolkit** is what you build with: the compiler `nvcc`, the CUDA runtime library, cuBLAS, and tools that check and profile programs.

Under WSL2 the driver lives in Windows. The Linux kernel that WSL2 boots carries a small Microsoft driver, **dxgkrnl**, which creates one device, `/dev/dxg`. dxgkrnl forwards each call over **VMBus**, the channel between the WSL2 virtual machine and Windows, to the graphics kernel of Windows. Microsoft calls this **GPU paravirtualization**: Linux sees a stand-in device, and the real driver answers from Windows.

![A CUDA call goes from your program through the CUDA runtime and libcuda.so to /dev/dxg, and from there over VMBus to the graphics kernel in Windows, the NVIDIA driver and the GPU. libcuda.so itself is part of the Windows driver, mounted into Ubuntu.](figures/21-wsl-gpu.svg)

WSL also mounts the user part of NVIDIA's Windows driver into Ubuntu at `/usr/lib/wsl/lib`. That includes `libcuda.so` and `nvidia-smi`, so `nvidia-smi` works before you install anything. Inside Ubuntu you install only the toolkit, from NVIDIA's standard repository for Ubuntu 24.04. NVIDIA's WSL guide says that the separate WSL-Ubuntu repository is deprecated and has no toolkit from 13.4 on.

> **Practice:** Never install an NVIDIA driver package inside Ubuntu, neither `cuda-drivers` nor `nvidia-open`. NVIDIA's WSL guide warns that a Linux driver overwrites the one mapped in from Windows. The package you install is `cuda-toolkit`.

Each GPU has a **compute capability**, a version number such as 8.6 for the RTX 30 series. It names the architecture, and `nvcc` compiles for one. CUDA 13 supports 7.5, the RTX 20 and GTX 16 series, and everything newer.

One Windows rule reaches into Ubuntu. Windows resets a GPU that does not finish its current work within two seconds, and the killed program gets an error. Microsoft calls this **Timeout Detection and Recovery** (TDR). Keep every kernel you write well under a second, also under the checking and profiling tools, which slow kernels down.

Some tools have limits under WSL2. Each limit below comes from the page named with it:

- `nvidia-smi` answers fewer queries. GPU utilization and the list of compute processes are not supported yet (WSL guide, 4.2).
- Compute Sanitizer, the checker of step 4, and the Nsight Systems command line, the timeline profiler of step 7, are supported (WSL guide, the table in 2.1).
- Nsight Compute, the profiler of step 6, needs Windows 11 with driver 525 or newer (Nsight Compute release notes, "System Requirements"). Its hardware counters need a switch in Windows, which step 6 sets.
- `cuda-gdb`, NVIDIA's gdb for GPU code, needs a registry key set in Windows, and from CUDA 13.1 on it cannot attach to a running process (CUDA-GDB documentation, 13.15 and 16).
- Unified memory, which moves data between CPU and GPU on demand, is limited. So is pinned memory, a kind of host memory that step 5 explains (WSL guide, 4.1).

### Study

- [NVIDIA: CUDA on WSL User Guide](https://docs.nvidia.com/cuda/wsl-user-guide/index.html#getting-started-with-cuda-on-wsl) (read, 30 min): Section 3, "Getting Started with CUDA on WSL": 3.1 to check that your Windows driver is current, then 3.4 "Step 4: Install the CUDA Toolkit" with 3.4.1. Skip 3.2 and 3.3, which chapter 00 did, and read 3.4.2 only if you once set up the WSL-Ubuntu repository. Then all of section 4, the requirements and limits.
- [Steve Pronovost: DirectX ❤ Linux](https://devblogs.microsoft.com/directx/directx-heart-linux/) (read, 10 min): The 2020 announcement on Microsoft's DirectX blog, by a development lead of the team that built GPU support for WSL. Read "GPU Virtualization", "Introducing dxgkrnl (Linux Edition)" and "NVIDIA CUDA". Skip the rest.
- [NVIDIA: CUDA Installation Guide for Linux](https://docs.nvidia.com/cuda/cuda-installation-guide-linux/index.html#ubuntu) (reference, as needed): 4.7.3 "Network Repository Installation", where `<distro>` is `ubuntu2404` and `<arch>` is `x86_64`, 4.7.4 "Common Installation Instructions", 11.1.1 "Environment Setup" and 11.2.2 "Verify the Installation". Skip section 5, "Driver Installation".

### Build

1. In Ubuntu, run `nvidia-smi`, then `ls -l /dev/dxg /usr/lib/wsl/lib`. `/dev/dxg` starts with `c`, a character device like the one your chapter 16 driver created. Start `notes/gpu.md` with the driver version `nvidia-smi` prints and one sentence on which side of the virtual machine runs the NVIDIA kernel driver.
2. Install the `cuda-keyring` package as 4.7.3 shows. A **keyring** here is the file of NVIDIA's signing keys, so that `apt` trusts packages from NVIDIA's repository. Then run `sudo apt update` and `sudo apt install cuda-toolkit`. Add the `PATH` line from 11.1.1 to `~/.bashrc`, with the version number it names, and open a new terminal.
3. Run `nvcc --version`, `compute-sanitizer --version`, `ncu --version` and `nsys --version`. The Ubuntu packages put Nsight Compute under `/opt/nvidia/nsight-compute/`, so add its directory there to `PATH` if `ncu` is not found. Run `nvidia-smi --query-gpu=name,compute_cap --format=csv` and note the compute capability.
4. Clone `https://github.com/NVIDIA/cuda-samples`, the repository 11.2.2 points to, into `~/code`. Build only `deviceQuery`, as its README describes for a single sample: `cd cpp/1_Utilities/deviceQuery && mkdir -p build && cd build && cmake -DCMAKE_CUDA_ARCHITECTURES=86 .. && make`. Replace 86 with your compute capability without the dot.
5. Run `./deviceQuery` and copy into `notes/gpu.md`: name, compute capability, number of multiprocessors, CUDA cores per multiprocessor, GPU max clock, memory clock, memory bus width, L2 cache size, shared memory per block and per multiprocessor, registers per block, maximum threads per multiprocessor and per block, warp size, "Concurrent copy and kernel execution" and "Run time limit on kernels". Later steps explain each line.

> **If it fails:** If a CUDA program stops with "CUDA driver version is insufficient for CUDA runtime version", the Windows driver is older than the toolkit. Update the driver in Windows from NVIDIA's driver page, run `wsl --shutdown` in PowerShell, and open Ubuntu again.

### Done when

`deviceQuery` ends with `Result = PASS`, and "Run time limit on kernels" says Yes, which is TDR. You can trace a CUDA call from your program through `libcuda.so` and `/dev/dxg` to the driver in Windows, and say why installing `nvidia-open` in Ubuntu would break it.

## Host, device and a first kernel

Python hid two facts from you. The GPU has its own memory, and a GPU function runs as thousands of copies at once. This step writes the smallest program that shows both.

CUDA calls the CPU and its memory the **host**, and the GPU and its memory the **device**. Device memory is separate DRAM on the GPU board, GDDR on your laptop. `cudaMalloc` allocates device memory and returns a device address. Host code must not dereference that pointer, the same way a kernel address from chapter 15 means nothing in a user process. `cudaMemcpy` copies between the two memories over **PCIe**, the bus between the CPU and the GPU.

![The host is the CPU with its RAM and the device is the GPU with its own memory. cudaMemcpy copies an array across PCIe into device memory, the kernel reads and writes it there, and a second cudaMemcpy copies the result back.](figures/21-host-device.svg)

A kernel is a C++ function marked `__global__`. The host **launches** it with the number of thread blocks, groups of threads that step 3 explains, and the number of threads per block between triple angle brackets. Every **thread** runs the whole function. Your chapter 14 fragment shader ran the same way, once for every pixel, and a kernel runs once for every thread. Each thread finds its own element from built-in variables, which step 3 takes apart:

```cpp
__global__ void vadd(const float *a, const float *b, float *c, int n)
{
    int i = blockIdx.x * blockDim.x + threadIdx.x;   // this thread's element
    if (i < n) c[i] = a[i] + b[i];
}

// on the host, after cudaMalloc and cudaMemcpy:
int threads = 256;
int blocks = (n + threads - 1) / threads;
vadd<<<blocks, threads>>>(da, db, dc, n);
cudaMemcpy(c, dc, n * sizeof(float), cudaMemcpyDeviceToHost);
```

`nvcc` compiles a `.cu` file in two halves. It compiles the device code for the GPU itself, and it hands the host code to gcc, the other C compiler from chapter 01, which `nvcc` uses on Linux. The kernels in this chapter use little C++ beyond the subset of chapter 20.

The launch returns before the kernel has run. The host only queues the work, as a command buffer submit did in chapter 14. `cudaMemcpy` from the device waits until the kernel has finished, so the result is complete when it returns. This chapter copies explicitly everywhere, so you always know when data crosses the bus. Unified memory would move it for you and hide exactly the costs this chapter measures.

> **Practice:** Build every CUDA program with one script in the style of chapter 01's, with warnings on:
>
> ```sh
> #!/bin/sh
> # usage: sh build.sh name [extra nvcc flags]
> set -e
> name=$1
> shift
> mkdir -p out
> nvcc -O3 -arch=native -lineinfo -std=c++17 -Xcompiler -Wall,-Wextra -o "out/$name" "src/$name.cu" "$@"
> ```
>
> `set -e` stops the script at the first command that fails, as in chapter 01. `shift` drops the name from the arguments, and `"$@"` passes the rest on to `nvcc`, such as `-lcublas` in step 13. `-O3` optimizes. `-arch=native` compiles the device code for the GPU in this machine. `-lineinfo` keeps source line numbers in the device code, so the checker and the profiler can name a line. `-std=c++17` picks the 2017 C++ standard, which every feature this chapter uses belongs to. `-Xcompiler -Wall,-Wextra` passes chapter 01's warning flags to gcc for the host half, and `nvcc` warns about the device half on its own.

### Study

- [CUDA Programming Guide: 1.2 Programming Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#heterogeneous-systems) (read, 20 min): 1.2.1 "Heterogeneous Systems", then 1.2.3 "GPU Memory" through 1.2.3.3 "On-Chip Memory in GPUs". Skip 1.2.2 until step 3, and skip 1.2.3.2 and 1.2.3.4.
- [CUDA Programming Guide: 2.1 Intro to CUDA C++](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/intro-to-cuda-cpp.html#compilation-with-nvcc) (read, 45 min): 2.1.1 to 2.1.5. In 2.1.3 read "Explicit Memory Management" closely and skim "Unified Memory". The program in 2.1.5 is a longer version of the one you write below.

### Build

1. Make `~/code/cuda` with a `src/` directory, `build.sh` from the callout above and `notes/` with your `gpu.md`. Run `git init` and put `out/` in `.gitignore`.
2. `src/vadd.cu`: read `n` from the command line, fill two host arrays with random floats, allocate three device arrays, copy two in, launch `vadd`, copy the result back and compare every element exactly with `a[i] + b[i]` computed on the CPU. Free the device memory with `cudaFree`. Check the return value of every CUDA call against `cudaSuccess` and print `cudaGetErrorString` of anything else. Step 4 turns this into a macro.
3. Run `sh build.sh vadd`, then `./out/vadd 1000` and `./out/vadd 1000003`.
4. Print one device pointer and one host pointer with `%p`. Both look like ordinary addresses, and only the host one can be read by the CPU.

### Done when

`vadd` matches the CPU for both sizes. You can point at each line of `vadd.cu` and say whether it runs on the CPU or the GPU, and where the data crosses PCIe.

## Grids, blocks and threads

One launch starts thousands of threads. Each one has to find its own element, and the element count rarely divides evenly into the threads you start.

All threads of one launch form a **grid**. The grid is split into **thread blocks** of equal size, with at most 1024 threads per block. Four built-in variables tell a thread where it is:

- `threadIdx.x` is the thread's index within its block.
- `blockIdx.x` is the block's index within the grid.
- `blockDim.x` is the number of threads per block.
- `gridDim.x` is the number of blocks.

![A grid of four blocks of eight threads covers an array of 30 elements. Thread 3 of block 2 computes i = 2 * 8 + 3 = 19. Threads 30 and 31 in the last block have no element, and the bounds check skips them.](figures/21-grid-index.svg)

So `i = blockIdx.x * blockDim.x + threadIdx.x` numbers the threads of the grid from 0. The host rounds the block count up with `(n + threads - 1) / threads`, so the last block usually has threads with no element. The bounds check `if (i < n)` stops them. Without it they write past the end of the array, and nothing may tell you.

Blocks and threads can also be two- or three-dimensional. `dim3 block(16, 16)` asks for blocks of 16 by 16 threads, and each variable then has `.x`, `.y` and `.z`. For a matrix stored row by row, the usual mapping is `col = blockIdx.x * blockDim.x + threadIdx.x` and `row` the same with `.y`. The element is then `row * ncols + col`, with a bounds check on both.

Blocks run in any order. CUDA promises nothing about which block runs first or whether two run at the same time, so a block that waits for another block can wait forever. Inside one block, threads can cooperate, and steps 11 and 12 use that.

Sasha Rush's GPU Puzzles teach this indexing before you debug it in C++. They run in **Google Colab**, Google's hosted Python notebooks with a free GPU, which needs a Google account. The puzzles use **Numba**, a Python library that compiles Python functions to machine code and to CUDA kernels, where `cuda.threadIdx.x` is `threadIdx.x`. Each puzzle draws which thread read and wrote which cell. Chapter 22's GPU backend uses the same Numba syntax.

Your vector add has one operation per element. `saxpy`, `y[i] = a * x[i] + y[i]`, has two, and it shows the fused multiply-add of chapter 07 from the compiler's side. `nvcc` contracts a multiply followed by an add into one fused multiply-add by default, which rounds once instead of twice. In the compiled code you would see one `FFMA` instruction, and with the flag `-fmad=false` an `FMUL` and an `FADD`.

### Study

- [CUDA Programming Guide: 1.2.2 GPU Hardware Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#gpu-hardware-model) (read, 15 min): 1.2.2 and 1.2.2.1 "Thread Blocks and Grids". Skip 1.2.2.1.1 on clusters, which need compute capability 9.0, and stop before 1.2.2.2, which step 8 reads.
- [GPU Puzzles](https://github.com/srush/GPU-Puzzles) (do, 1 h 30 min): Puzzles 1 to 7, Map to Blocks 2D. Run the notebook in Google Colab with the GPU runtime, as the README says. Stop at Puzzle 8, which step 11 picks up.

### Build

1. Run `vadd` with blocks of 256 threads for n = 1, 31, 32, 33, 255, 256, 257, 1000003 and 16777216. Skip the launch when n is 0. Step 4 shows what a launch with zero blocks does.
2. `src/grid2d.cu`: CUDA C versions of puzzles 4 to 7 with `dim3` blocks of 16 by 16 and two-dimensional indices. Use rows by columns of 1 x 1, 1 x 1000, 1000 x 1, 999 x 777 and 4096 x 4096, each checked against a CPU loop.
3. `src/saxpy.cu`: compare the GPU result first against `a * x[i] + y[i]` computed on the CPU, then against `fmaf(a, x[i], y[i])`. Find which one matches exactly. Build again with `sh build.sh saxpy -fmad=false` and check again. Print a mismatching pair with `%a`, as in chapter 04's float step, to see that they differ in the last bit.

### Done when

Every size passes in `vadd` and every shape in `grid2d`. You can say which CPU version `saxpy` matches with and without `-fmad=false`, and why.

## Errors and Compute Sanitizer

A GPU mistake does not crash your program at the line that made it. A bad launch reports nothing unless you ask, and a bad memory access inside a kernel shows up at a later call, or not at all.

Errors arrive in three ways:

1. Every runtime call returns a `cudaError_t`, and `cudaSuccess` means it worked.
2. A launch returns nothing. `cudaGetLastError()` right after it reports a launch that could not start, such as one with 4096 threads per block.
3. An error while the kernel runs, such as an out-of-bounds write, appears at the next call that waits for the GPU: `cudaDeviceSynchronize()`, which waits for all queued work, or a `cudaMemcpy`.

A macro checks every call and stops at the first error. `#call` turns the argument into a string, and `do { ... } while (0)` makes the macro behave as one statement after an `if`. The two includes declare `fprintf` and `exit`:

```cpp
#include <cstdio>
#include <cstdlib>

#define CHECK(call) do {                                              \
    cudaError_t err_ = (call);                                        \
    if (err_ != cudaSuccess) {                                        \
        fprintf(stderr, "%s:%d: %s: %s\n", __FILE__, __LINE__, #call, \
                cudaGetErrorString(err_));                            \
        exit(1);                                                      \
    }                                                                 \
} while (0)

#ifdef SYNC_CHECK
#define CHECK_LAUNCH() do { CHECK(cudaGetLastError()); CHECK(cudaDeviceSynchronize()); } while (0)
#else
#define CHECK_LAUNCH() CHECK(cudaGetLastError())
#endif
```

`CHECK_LAUNCH()` goes after every launch. A build with `-DSYNC_CHECK` waits after each launch, so a kernel's error is reported at its own launch line. The guide's `CUDA_CHECK` prints and carries on. Yours exits, because every result after a failed call is suspect.

**Compute Sanitizer** is AddressSanitizer for the device. `compute-sanitizer ./out/vadd 1000` runs the program with every device memory access checked. It reports an invalid read or write with the kernel, the thread and the source line, which `-lineinfo` keeps. It also checks the ranges of `cudaMemcpy` and `cudaMemset` calls against the device allocations. It slows kernels down a lot, so never time a sanitized run, and keep sizes small so TDR does not kill it.

> **Practice:** Run every new kernel once under `compute-sanitizer` before you time it, and keep the output line `ERROR SUMMARY: 0 errors`.

### Study

- [CUDA Programming Guide: 2.1.7 Error Checking in CUDA](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/intro-to-cuda-cpp.html#error-checking-in-cuda) (read, 20 min): 2.1.6 "Runtime Initialization", then 2.1.7 with 2.1.7.1 "Error State" and 2.1.7.2 "Asynchronous Errors", then 2.1.8 and 2.1.9. Skip 2.1.7.3 and 2.1.10.
- [Compute Sanitizer documentation](https://docs.nvidia.com/compute-sanitizer/ComputeSanitizer/index.html) (reference, as needed): "Introduction", "Compute Sanitizer" for the command line with the `check-api-memory-access` option, "Memcheck Tool" through "Understanding Memcheck Errors", and "Windows Specific Behavior" for TDR. Step 11 uses the Racecheck and Synccheck sections.

### Build

1. `src/check.h` with the includes, `CHECK` and `CHECK_LAUNCH` as above. Change `vadd`, `grid2d` and `saxpy` to use them on every call and launch.
2. Remove the bounds check from `vadd`. Run n = 1000 plainly, then under `compute-sanitizer`.
3. Launch `vadd` with 4096 threads per block. Then give the copy back to the host a size one element larger than the allocation, plainly and under `compute-sanitizer`. The driver hands out device memory in larger pieces than you asked for, so the plain run may report nothing, and the sanitizer reports the copy. Then try a launch with zero blocks once.
4. Build `vadd` without the bounds check once more with `-DSYNC_CHECK` and note where the error is reported now.
5. Write down in `notes/errors.md`, for each mistake, what reported it and at which line.

> **Optional:** `cuda-gdb` is gdb with commands for GPU threads. Under WSL2 it needs the registry key `HKEY_LOCAL_MACHINE\SOFTWARE\NVIDIA Corporation\GPUDebugger\EnableInterface` set to the DWORD 1 in Windows. Build with `-g -G`, which turns device optimization off, then `break vadd`, `run`, `cuda block 1 thread 3` and `print i`. The [CUDA-GDB documentation](https://docs.nvidia.com/cuda/cuda-gdb/index.html#switching-focus) covers focus in section 5 and WSL in 13.15, "Debugging on Windows Subsystem for Linux".

### Done when

`compute-sanitizer` prints `ERROR SUMMARY: 0 errors` for each correct program. Without the bounds check, the plain run may look correct, and the sanitizer reports an invalid `__global__` write at the source line of the store. You can say why the out-of-bounds write is reported at the next synchronizing call and not at the launch, and what reported the oversized copy.

## Timing kernels and memory bandwidth

Your kernels are correct, and nothing yet says how fast they are or how fast they could be. Memory bandwidth is the first limit to measure, because simple kernels like `vadd` hit it.

Time kernels with **CUDA events**. An event is a marker in the GPU's queue of work that records a timestamp when the GPU reaches it. Create two with `cudaEventCreate`, record one with `cudaEventRecord` before the launch and one after, wait for the second with `cudaEventSynchronize`, and `cudaEventElapsedTime` gives the milliseconds between them. The time covers only the GPU work in between.

> **Practice:** Time every kernel in this chapter the same way. Do one warm-up launch, because the first launch in a process loads the kernel and wakes the GPU. Then do 20 launches, each between its own pair of events, and keep the best, as chapter 07's repetition tester did. Plug the laptop in first, because laptop GPUs lower their clocks on battery.

**Effective bandwidth** is the bytes a kernel reads plus the bytes it writes, divided by its time. The **theoretical bandwidth** comes from `deviceQuery`: memory clock times bus width in bytes times 2, because the memory transfers twice per clock. Check it against the bandwidth on NVIDIA's spec page for your GPU. The GPU version of chapter 07's read loop is a copy kernel, where each thread loads one float and stores it elsewhere.

Under WSL2 every launch and every event record travels through `/dev/dxg` to Windows. Raphael Boissel and Arthy Sundaram of NVIDIA name this launch latency as a leading cause of slowdowns against native Linux. They also measured a Blender benchmark with long-running kernels within 1 percent of native. Your copy kernels move hundreds of megabytes per launch, so the crossing does not show. For a kernel that runs for microseconds, time a loop of many launches between one pair of events and divide.

Copies between host and device go over PCIe, which is much slower than the GPU's own memory. Memory from `malloc` is **pageable**: the operating system may move it, so the driver first copies it into a buffer it controls. **Pinned** memory, from `cudaMallocHost`, stays in place, and the Best Practices guide reports that it transfers at the highest rate. NVIDIA's WSL guide lists pinned memory as limited under WSL2, without a number. If a `cudaMallocHost` of 256 MiB fails, your `CHECK` says so, so halve the size and write that down.

### Study

- [CUDA C++ Best Practices Guide: Performance Metrics](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#performance-metrics) (read, 40 min): 9.1 "Timing" with 9.1.2 "Using CUDA GPU Timers", 9.2.1 "Theoretical Bandwidth Calculation" and 9.2.2 "Effective Bandwidth Calculation". Skip 9.2.3, which describes an older profiler. Then 10.1 "Data Transfer Between Host and Device" through 10.1.1 "Pinned Memory". Step 7 reads 10.1.2.
- [Raphael Boissel and Arthy Sundaram: Leveling up CUDA Performance on WSL2 with New Enhancements](https://developer.nvidia.com/blog/leveling-up-cuda-performance-on-wsl2-with-new-enhancements/) (read, 15 min): NVIDIA's 2021 post on what WSL2 adds to each launch. Read "Current state of WSL performance" for the benchmarks, then "Launch latency optimizations" through "Asynchronous submissions to reduce the launch latency". Skip the "AI-Generated Summary" box and "New allocation optimization".

### Build

`src/bw.cu`, with every result written as CSV and plotted with matplotlib:

1. A timing helper that follows the practice above and returns the best time. Use it for everything below and in every later step.
2. `copy` over two buffers of 64 Mi floats, 256 MiB each. Print effective GB/s and the ratio to the theoretical bandwidth. Add `fill`, which only writes, and `read`, which adds each value into a per-thread register and stores that register once at the end, so the compiler cannot drop the loads. Compare the three, and compare them with the DRAM bandwidth of your CPU from chapter 07.
3. Time a kernel that does nothing, as a loop of 1000 launches between one pair of events. Divide to get the cost of one launch.
4. Host transfers: time `cudaMemcpy` of 256 MiB to the device and back, from `malloc` memory and from `cudaMallocHost` memory.
5. Time a `vadd` of 64 Mi elements with its three transfers and without them. Write down what fraction of the total the kernel is.

> **Optional:** The post recommends hardware-accelerated GPU scheduling for WSL2. If your Windows offers it, the switch is in Windows Settings under System, Display, Graphics. Measure the empty-launch time from item 3 before and after.

### Done when

The copy kernel reaches at least 70 percent of the theoretical bandwidth, or you have written down the gap for the next step's profiler to explain. You have the pinned and pageable transfer rates and the cost of one empty launch. You can say from your `vadd` numbers why a single elementwise operation is not worth moving to the GPU when its data starts on the host.

## Coalescing and the profiler

The copy kernel gets close to the theoretical bandwidth because neighboring threads read neighboring floats. Change only the pattern of addresses and the same number of bytes takes several times longer.

The GPU runs the threads of a block in groups of 32 consecutive threads, called **warps**, and step 8 looks at them closely. One load instruction of a warp asks for 32 addresses at once. The memory system serves them in **sectors** of 32 bytes. When the 32 addresses lie in as few sectors as possible, the access is **coalesced**.

![Top: the 32 threads of a warp read 32 neighboring floats in four 32-byte sectors, so the warp moves 128 bytes and uses all of them. Bottom: thread t reads element 32 * t, every thread touches its own sector, and the warp moves 1024 bytes to use 128.](figures/21-coalescing.svg)

When thread i reads element 32 * i, the warp moves eight times the bytes it uses, and bandwidth drops to about an eighth. This is the structure-of-arrays argument from chapter 07, applied to the 32 threads of a warp. Neighboring threads should touch neighboring addresses.

**Nsight Compute**, the command `ncu`, is NVIDIA's kernel profiler. It replays each kernel it profiles many times with the GPU's hardware counters attached. In chapter 07, `perf stat` may have printed `<not supported>` for `cycles`, because WSL2 often keeps the CPU's counters from Linux. The GPU's counters come through the Windows driver once you allow it, as below.

On `bw`, which launches hundreds of kernels over 256 MiB buffers, a full profile of everything takes tens of minutes. So give `bw` a command-line argument that runs one kernel with one setting, such as `./out/bw stride 32`, and profile one launch of that kernel:

```sh
ncu --set full -k regex:strideCopy -c 1 -o stride32 ./out/bw stride 32
ncu --import stride32.ncu-rep
```

`-k regex:strideCopy` profiles only kernels whose name contains `strideCopy`, and `-c 1` stops after one launch. `--set full` collects every section, `-o` writes the report file, and `--import` prints it as text.

In the Memory Workload Analysis section, the column Sectors/Req gives the number of sectors one warp-wide load touched: 4 for the coalesced copy and 32 for the worst stride. `ncu` fixes the clocks and empties the caches before each run, so its durations differ from your event timings. Take timings from events, and use `ncu` to find the cause.

Reading the counters needs permission, given once in Windows with administrator rights:

1. In the NVIDIA App, open System, Advanced, Developer, Manage GPU Performance Counters.
2. Choose access for all users.
3. On an older driver without that page, open the NVIDIA Control Panel, tick Desktop, Enable Developer Settings, and choose the same option under Developer, Manage GPU Performance Counters.

Without it, `ncu` stops with `ERR_NVGPUCTRPERM`.

### Study

- [CUDA C++ Best Practices Guide: Coalesced Access to Global Memory](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#coalesced-access-to-global-memory) (read, 30 min): 10.2.1 with 10.2.1.1 to 10.2.1.4. The `offsetCopy` and `strideCopy` kernels there are the ones you write below.
- [Nsight Compute CLI](https://docs.nvidia.com/nsight-compute/NsightComputeCli/index.html) (reference, as needed): 5.2 "Quickstart", 5.3.4 "Profile Import", and in 5.4.4 "Profile" the options `--set`, `-k` (`--kernel-name`) and `-c` (`--launch-count`).
- [Nsight Compute Profiling Guide](https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html) (reference, as needed): 2.2.1 "Sets and Sections", 2.6.2 "Clock Control", 2.6.3 "Cache Control", 2.10 "Memory Chart", 2.11 "Memory Tables", and the `ERR_NVGPUCTRPERM` entry in 2.12 "FAQ".

### Build

1. Add `offsetCopy` for offsets 0 to 32 and `strideCopy` for strides 1 to 32 to `bw.cu`, as in the guide. Plot GB/s against offset and against stride.
2. Add the command-line argument that picks one kernel and one setting, and keep running everything when no argument is given.
3. Profile `copy`, `strideCopy` with stride 2 and `strideCopy` with stride 32, one launch each, as above. Record Sectors/Req for global loads and the DRAM throughput of each.
4. If the copy kernel missed 70 percent in the last step, read its DRAM throughput in `ncu` and write down where the gap is.

> **Optional:** `ncu-ui stride32.ncu-rep` opens the report in a window through WSLg. The Nsight Compute release notes list the packages it needs on Ubuntu 24.04: `sudo apt install libopengl0 libxcb-icccm4 libxcb-keysyms1 libxcb-cursor0 libxcb-shape0 libxkbcommon-x11-0 libnss3`.

### Done when

Your stride plot falls as the stride grows and flattens once each thread has its own sector, and your Sectors/Req values follow the same shape. Each `ncu` run takes seconds, not minutes. You can explain the offset plot from the 32-byte sectors and the L2 cache, as the guide does for its own figure.

## Streams and the timeline

`ncu` looks inside one kernel. Your `vadd` numbers from step 5 said that the copies cost more than the kernel, and no kernel profile shows copies, launch gaps or the time the CPU spends between calls. This step adds a profiler for the whole program and the tool that lets copies and kernels run at the same time.

**Nsight Systems**, the command `nsys`, records a timeline: every CUDA call on the CPU and every kernel and copy on the GPU, each with its start time and duration. `nsys profile -o vadd ./out/vadd 16777216` runs the program and writes `vadd.nsys-rep`. `nsys stats --report cuda_gpu_trace vadd.nsys-rep` prints the GPU's work as rows in time order. The `cuda-toolkit` package installed it next to `ncu`, and NVIDIA's WSL guide lists its command line as supported under WSL2.

Every launch and copy so far went into one queue, so each started after the previous one finished. That queue is a **stream**: GPU work that runs in the order it was queued. Work in two different streams may run at the same time. `cudaStreamCreate(&s)` makes a stream, `kernel<<<blocks, threads, 0, s>>>` launches into it, where the 0 is the shared memory of step 11, and `cudaMemcpyAsync(dst, src, bytes, kind, s)` queues a copy and returns at once. A copy from host memory runs asynchronously only when the host buffer is pinned, so the pinned memory of step 5 pays off here.

![Vector add in one stream: copy in, kernel, copy out, each waiting for the last. Split into four chunks in four streams: the copy of chunk 1 runs while the kernel of chunk 0 runs, and with two copy engines the copies out overlap the copies in, so the whole job ends sooner.](figures/21-streams.svg)

Split `vadd` into chunks, and give chunk k its copies in, its kernel and its copy out in stream k. The GPU then copies chunk 1 in while it computes chunk 0. The line "Concurrent copy and kernel execution" in your `deviceQuery` notes gives the number of **copy engines**, the units that move data over PCIe. With two, a copy in and a copy out also overlap.

Events recorded without a stream go into the **default stream**. Streams made with `cudaStreamCreate` wait for work in the default stream, and it waits for them, so one pair of events around the whole loop times all four streams together.

### Study

- [CUDA Programming Guide: 2.5 Asynchronous Execution](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/asynchronous-execution.html#cuda-streams) (read, 30 min): 2.5.1, 2.5.2 with 2.5.2.1 to 2.5.2.4, 2.5.5 "CUDA Stream Ordering", 2.5.6 with 2.5.6.1 "Legacy Default Stream", and 2.5.7. Skip 2.5.3, 2.5.4 and 2.5.9.
- [CUDA C++ Best Practices Guide: Asynchronous and Overlapping Transfers with Computation](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#asynchronous-and-overlapping-transfers-with-computation) (read, 15 min): 10.1.2, with its "Staged concurrent copy and execute" listing, which is the program you write below.
- [Nsight Systems User Guide: Profiling from the CLI](https://docs.nvidia.com/nsight-systems/UserGuide/index.html#example-stats-command-sequences) (reference, as needed): "Example Single Command Lines" and "Example Stats Command Sequences" for `nsys profile`, `nsys stats` and its `cuda_gpu_trace`, `cuda_gpu_kern_sum` and `cuda_api_sum` reports.

### Build

1. `src/overlap.cu`: `vadd` of 64 Mi elements from pinned host buffers. Version 1 uses `cudaMemcpy` and one launch in the default stream. Version 2 splits the work into 4 chunks in 4 streams, with `cudaMemcpyAsync` and one launch per chunk, then `cudaDeviceSynchronize`. Try 8 and 16 chunks too. Check every element of both results and time both versions with one pair of events around all the work.
2. Run both versions under `nsys profile` and print `cuda_gpu_trace`. For version 1, write down the start and the duration of each copy and of the kernel, and the gaps between them.
3. In version 2, find a copy that starts before the kernel of an earlier chunk ends, and a copy in that runs at the same time as a copy out. Compare with the number of copy engines in your notes.
4. Run version 2 once with `malloc` buffers in place of pinned ones and read its trace.

> **Optional:** `nsys-ui overlap.nsys-rep` opens the timeline as a picture through WSLg. The package installed the libraries it needs.

### Done when

Both versions match the CPU. You have the timelines of both and can say from `cuda_gpu_trace` how much of the copy time version 2 hid behind kernels and other copies, and why the `malloc` run hides less.

## Warps and divergence

The coalescing step named warps for loads. A warp also decides how branches run, and a kernel whose threads take different branches can run at half speed with no visible cause in the source.

A GPU is built from **streaming multiprocessors** (SMs), tens of them on a laptop GPU. Each block runs on one SM from start to finish. The GPU hands each block to an SM with room for it, as your chapter 09 job system handed each job to a free worker, which is why step 3 found no promise about the order of blocks. The SM splits the block into warps of 32 threads, and a warp executes one instruction at a time for all 32 of them. A warp is like an AVX2 register from chapter 07 with 32 lanes instead of 8.

With AVX2 you wrote one instruction for eight floats. In CUDA you write the code for one thread, and the hardware runs 32 of them in step. When threads of a warp take different branches of an `if`, the warp runs both paths one after the other. During each path an **active mask** switches off the lanes that do not belong to it. This is **warp divergence**, and its cost is the time of both paths added.

![Eight lanes of a warp, where a real warp has 32, reach an if that calls A on odd lanes and B on even lanes. The warp issues A with only the odd lanes active, then B with only the even lanes active, then all lanes go on together.](figures/21-divergence.svg)

You built that mask by hand in chapter 07, with a compare and a blend, and here the hardware builds it. Your chapter 14 fragment shaders ran in warps too, one pixel per thread, so an `if` in a shader split warps the same way. A branch costs nothing extra when all 32 threads of each warp go the same way, even if different warps go different ways. So the question for any `if` in a kernel is whether it splits warps or only splits the block between warps.

### Study

- [CUDA Programming Guide: 1.2.2.2 Warps and SIMT](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html#warps-and-simt) (read, 10 min): The whole subsection.

### Build

1. `src/diverge.cu`: a kernel with two branches of equal cost, each a loop of a few hundred `fmaf` calls on a register. Choose the branch once by `threadIdx.x % 2` and once by `(threadIdx.x / 32) % 2`, and write a third version without the branch. Time all three with your helper.
2. Add a version that branches on `threadIdx.x % 32 < 16`. Predict its time before you run it.

### Done when

You can say why splitting branches by warp costs nothing and splitting them by thread doubles the time, and your `% 32 < 16` prediction was right or you can say why it was not.

## Warps and occupancy

A CPU core hides waiting inside one thread, by running later instructions out of order, as you saw in chapter 07. A GPU hides it across warps. To keep it busy you need to know how many warps it wants and what limits that number.

An SM keeps many warps **resident** at once, each with its registers already allocated, so switching between them costs nothing. When one warp waits for memory or for the result of an earlier instruction, the SM issues an instruction from another.

**Occupancy** is the number of resident warps on an SM divided by the most it can hold. Three resources limit it:

- threads per block, against the threads an SM holds
- registers per thread, against the SM's register file
- shared memory per block, against the SM's shared memory, which step 11 introduces

![An SM with 48 warp slots and 65,536 registers runs blocks of 256 threads at 64 registers per thread. Each block takes 16,384 registers, so four blocks fill the register file, 16 warp slots stay empty, and occupancy is 67 percent.](figures/21-warps-sm.svg)

`nvcc --resource-usage` prints each kernel's registers and shared memory, so you can compute occupancy before you run anything. More resident warps hide more waiting. A thread with several independent dependency chains, as in chapter 07, gives the SM independent instructions of its own, so it reaches the peak with fewer warps. The fast matrix multiply kernels of step 14 use many registers and run at low occupancy for that reason.

The peak you compare against is the **FP32** rate, FP32 being the 32-bit `float`. The CS149 lecture on GPU architecture, from the Stanford course chapter 09 used, walks one kernel through a GPU block by block and draws the inside of an SM. Its slides compare warps with ISPC gangs. ISPC is a SIMD compiler this book has not used, and a gang is the group of program instances that share one vector register.

### Study

- [Stanford CS149 Fall 2025: GPU Architecture and CUDA Programming (slides)](https://gfxcourses.stanford.edu/cs149/fall25content/media/gpuarch/07_gpuarch.pdf#page=35) (read, 1 h 15 min): Slides 35 to 72. Slides 35 to 43 write a 1D convolution kernel and show what the compiled binary records about its resources. Slides 45 to 54 build the V100 SM and the whole chip, slides 55 to 65 run the kernel on a small GPU, and 66 to 72 ask why blocks may not wait on each other. Shared memory and `__syncthreads()` appear in the kernel, and step 11 explains them. Slides 1 to 34 are history and syntax you have.
- [CUDA Programming Guide: 2.3.7 Kernel Launch and Occupancy](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html#kernel-launch-and-occupancy) (read, 15 min): The whole section, with its worked limits for blocks of 768 and of 32 threads.

### Build

1. From your `deviceQuery` table compute two numbers in `notes/gpu.md`. Resident threads: SMs times maximum threads per SM, and the same in warps. Compare with the cores `lscpu` reported in chapter 07. Peak FP32 rate: SMs times CUDA cores per SM times 2 times the max clock, because one fused multiply-add counts as two floating-point operations.
2. `src/fma.cu`: each thread runs 4096 iterations of `x = fmaf(x, a, b)` on C independent accumulators, C = 1, 2, 4 and 8, and stores their sum once so the compiler keeps the work. Launch blocks of 32, 64, 128, 256, 512 and 1024 threads, with the SM count times 1, 2, 4, 8 and 16 blocks, from one loop in a script. Print GFLOP/s as a fraction of your peak.
3. Watch the SM clock with `nvidia-smi -q -d CLOCK` while the largest configuration runs. If the clock lines read N/A under WSL2, profile that configuration once with `ncu --clock-control none -k regex:fma -c 1`, which leaves the clocks as the driver set them, and read the SM Frequency it reports.
4. Build `fma.cu` with `--resource-usage`. For three configurations, compute the theoretical occupancy by hand with the method of 2.3.7, then compare with the theoretical and achieved occupancy in `ncu`'s Occupancy section.

### Done when

Your best `fma` configuration reaches at least 80 percent of the peak FP32 rate, or you can explain the gap from the SM clock you recorded. You can name the smallest number of warps per SM at which the rate stops rising, for C = 1 and for C = 4, and explain the difference with latency and independent chains. Your hand occupancy matches `ncu`'s theoretical occupancy.

## The roofline

You now have two ceilings: the memory bandwidth from step 5 and the arithmetic peak from step 9. Which one limits a kernel depends on how much arithmetic it does for each byte it moves.

**Arithmetic intensity** is the number of floating-point operations a kernel does per byte it moves to or from DRAM. A kernel with intensity I can at most reach I times the bandwidth in FLOP/s, and never more than the peak. The **roofline** plots both limits on log scales: a sloped line for the bandwidth and a flat line for the peak. The two lines meet at the **ridge point**, at an intensity of peak FLOP/s divided by bandwidth.

![Achieved FLOP/s against arithmetic intensity, both on log scales. Left of the ridge point the bandwidth line is the limit, right of it the compute peak is. Copy and softmax sit far left, and a large matrix multiply sits right of the ridge.](figures/21-roofline.svg)

A kernel left of the ridge is **memory-bound**: better arithmetic does not help it, and only fewer bytes do. A kernel right of it is **compute-bound**. `vadd` does 1 operation per 12 bytes. A matrix multiply of two 4096 by 4096 float matrices does about 137 billion operations on about 201 MB of input and output, close to 700 per byte, far right of any ridge.

Horace He's article sorts deep learning work into three regimes. Two of them are the two sides of the roofline. The third is **overhead**: time spent outside the kernels, such as Python, the framework and launches, which you measured as launch cost in step 5 and saw as gaps in the timeline of step 7. Section 2.9 of the Nsight Compute Profiling Guide shows how `ncu` draws a roofline for a profiled kernel.

### Study

- [Horace He: Making Deep Learning Go Brrrr From First Principles](https://horace.io/brrr_intro.html) (read, 40 min): The whole article: "Compute", "Bandwidth" with "Reasoning about Memory-Bandwidth Costs", and "Overhead". The experiment that raises intensity by repeating an operation is the one you write below.
- [Nsight Compute Profiling Guide: Roofline Charts](https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html#roofline-charts) (reference, as needed): 2.9, for reading the roofline in an `ncu` report.

### Build

1. `src/intensity.cu`: each thread loads one float, applies R fused multiply-adds to it and stores it, for R = 1, 2, 4 and so on up to 1024.
2. Compute FLOP per byte and GFLOP/s for each R. Plot them on log axes together with your two measured ceilings: the copy bandwidth from step 5 and the best `fma` rate from step 9. Mark the ridge point.
3. Profile R = 1 and R = 1024 under `ncu`, one launch each, and find both in its roofline chart.

### Done when

Your intensity plot follows the bandwidth line, bends near the ridge point you computed, and flattens under the peak. You can place `vadd`, `copy` and a 4096 matrix multiply on the plot from their intensity alone.

## Shared memory and barriers

Every kernel so far had threads that never talked to each other. Many algorithms need the threads of a block to share what they loaded, and that needs fast shared storage and a way to wait for each other.

**Shared memory** is on-chip memory that each block allocates for itself, written `__shared__ float s[256];` inside a kernel. Every thread of the block can read and write all of it, and other blocks cannot see it. It lives in the same on-chip storage as the L1 cache. You decide what goes into it and when, where chapter 07's caches decided for you.

Threads that share data need a **barrier**. `__syncthreads()` waits until every thread of the block that has not exited reaches it. It also orders memory: everything a thread wrote before the call is visible to every thread of the block after it. That is chapter 09's release and acquire pair, applied to the whole block at once.

![Each of the block's eight threads loads one element from global memory into shared memory. __syncthreads() waits until all eight stores are done, and only then does thread 3 read s[4], which thread 4 wrote.](figures/21-shared-barrier.svg)

Two rules come with the barrier:

- Every thread of the block that has not exited must reach the same `__syncthreads()`. A barrier inside an `if` that some threads skip is a bug.
- A write by one thread and a read of the same location by another always need a barrier between them.

Shared memory is split into 32 **banks** of 4 bytes, and consecutive 4-byte words go to consecutive banks. When threads of one warp access different words in the same bank, the accesses take turns, which is called a **bank conflict**. A 32 by 32 float tile read down a column puts all 32 threads in one bank. Padding each row to 33 floats shifts every row by one bank and removes the conflict.

![Shared memory drawn with 8 banks instead of 32. Left: rows of 8 floats, so the 8 threads reading column 2 all hit bank 2 and take turns. Right: rows padded to 9 floats, so column 2 moves one bank per row and the 8 reads go to 8 different banks at once.](figures/21-bank-conflict.svg)

Compute Sanitizer has two tools for this step. **Racecheck** reports shared-memory accesses from different threads with no barrier between them. It watches only shared memory, where ThreadSanitizer in chapter 09 watched everything. **Synccheck** reports a `__syncthreads()` that some threads of a block skipped.

### Study

- [CUDA Programming Guide: 2.3 Writing SIMT Kernels](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html#thread-block-synchronization) (read, 1 h): 2.3.2.1 "Thread Block Synchronization", 2.3.3.2 "Shared Memory" with static and dynamic allocation, 2.3.3.3 "Registers" and 2.3.3.4 "Local Memory", then 2.3.4 "Memory Performance" in full, with both matrix transpose examples and 2.3.4.2.2 "Shared Memory Bank Conflicts". Skip 2.3.3.5 to 2.3.3.8.
- [GPU Puzzles](https://github.com/srush/GPU-Puzzles) (do, 2 h): Puzzles 8 to 11, Shared to 1D Convolution, in the same Colab notebook. Stop before Puzzle 12, which step 12 picks up.
- [Compute Sanitizer documentation](https://docs.nvidia.com/compute-sanitizer/ComputeSanitizer/index.html#racecheck-tool) (reference, as needed): "Racecheck Tool" through "Understanding Racecheck Hazard Reports", and "Synccheck Tool" through "Understanding Synccheck Reports".

### Build

1. `src/transpose.cu`: transpose a 4096 x 4096 float matrix, and a 4095 x 4097 one, in three versions: naive, through a 32 by 32 shared tile, and through a 32 by 33 tile. Report GB/s next to your copy kernel.
2. Profile the two tiled versions under `ncu`, one launch each, and record the shared-memory bank conflicts it reports.
3. Delete the `__syncthreads()` between the load and the use in the tiled version and run `compute-sanitizer --tool racecheck`. Then put it back inside an `if (threadIdx.y < 16)` and run `--tool synccheck`. Record both reports.

### Done when

All three transposes match a CPU transpose for both shapes. The padded version shows no bank conflicts in `ncu` and runs faster than the unpadded one. Racecheck and synccheck each report your deliberate bug and report nothing for the correct code.

## Reductions

Summing an array is the first algorithm where every thread's result has to meet every other's. It uses the barrier, a new kind of exchange inside a warp, and atomics across blocks.

Inside a block, a **tree reduction** sums the block's values in shared memory. In each round, the lower half of the remaining threads adds the value one stride above its own, and a barrier separates the rounds. A block of 256 threads needs 8 rounds.

![Eight values in shared memory are summed in three rounds with strides 4, 2 and 1, and a barrier separates the rounds. After the last round s[0] holds the block's sum.](figures/21-tree-reduction.svg)

The last five rounds happen inside one warp, and a warp can skip shared memory for them. A **warp shuffle** lets a thread read another thread's register within the warp. `__shfl_down_sync(0xffffffff, v, 16)` gives each thread the `v` of the thread 16 lanes above it, and the first argument is the mask of step 8, naming the threads taking part:

```cpp
__device__ float warp_sum(float v)
{
    for (int offset = 16; offset > 0; offset /= 2)
        v += __shfl_down_sync(0xffffffff, v, offset);
    return v;                       // lane 0 holds the warp's sum
}
```

`__device__` marks a function that kernels call on the GPU. Older code did these rounds without any synchronization and assumed that a warp runs in lockstep. GPUs since Volta, NVIDIA's architecture of 2017 with compute capability 7.0, schedule each thread on its own, and the post by Lin and Grover shows how that assumption breaks. Use the `_sync` functions.

Each block ends with one partial sum. The simplest way to combine them is one **atomic add** per block into a single global result, `atomicAdd(&result, v)`, which reads, adds and writes as one step that no other thread can interrupt. The guide's 2.3.5 writes the same operation with `cuda::atomic_ref` and `fetch_add`. To handle any n with a fixed grid of a few blocks per SM, each thread first adds up many elements in a **grid-stride loop**, `for (i = start; i < n; i += gridDim.x * blockDim.x)`.

### Study

- [GPU Puzzles](https://github.com/srush/GPU-Puzzles) (do, 1 h): Puzzles 12 and 13. Puzzle 12, "Prefix Sum", is the block tree sum drawn above, and Puzzle 13 sums along one axis of a matrix. Stop before Puzzle 14.
- [Yuan Lin and Vinod Grover: Using CUDA Warp-Level Primitives](https://developer.nvidia.com/blog/using-cuda-warp-level-primitives/) (read, 40 min): The whole post, by two NVIDIA compiler engineers. Listing 1 is the warp reduction above, and "Implicit Warp-Synchronous Programming is Unsafe" explains the mask. Skip the "AI-Generated Summary" box at the top of the page.
- [CUDA Programming Guide: 2.3.5 Atomics](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html#atomics) (read, 10 min): 2.3.5 and 2.3.5.1. Skip 2.3.5.2 on Python.

### Build

1. `src/reduce.cu`, the sum of n floats, in four versions: (a) every thread does `atomicAdd` on one global float, (b) a shared-memory tree per block with one `atomicAdd` per block, (c) the tree down to 32 values, then `warp_sum`, (d) version c with a grid-stride loop and a grid of a few blocks per SM. Use n = 1, 31, 33, 1000, 1000003 and 2^26.
2. The error policy, part one: exact tests. Floating-point addition is not associative, so a GPU sum differs from a CPU sum in the last bits, and differs again when the block size changes. Inputs whose every partial sum is an integer below 2^24 avoid that, because a float holds those integers exactly and every order gives the same result. Test every version with `(float)(i % 7)` for n up to 2^21. At n = 2^26, use 1 where `i % 8 == 0` and 0 elsewhere, which must sum to exactly 8388608. A version that drops one block or one grid-stride chunk fails this test.
3. The error policy, part two: random inputs. Use uniform random inputs in [-1, 1] against a CPU sum in double, and accept `|gpu - ref| <= 1e-5 * sum of |x[i]|`. The proven bound for a float sum is about the length of the longest chain of additions times 2^-24 times `sum of |x[i]|`. Write that bound in a comment for each version at n = 2^26: about 4 for version a, a chain of 2^26 additions, about 0.016 for versions b and c, whose 2^18 block results meet in a chain of atomic adds, and the length of your grid-stride chain plus your block count times 2^-24 for version d. Every bound is far above 1e-5. The test still passes because rounding errors of random inputs mostly cancel: a float simulation of version a on the CPU is off by about 5e-9 of `sum of |x[i]|`. So this test catches gross bugs and item 2 proves the sum.
4. Report GB/s for each version at n = 2^26 next to your copy bandwidth.
5. `src/rowstats.cu`: for an M x N matrix, one block per row computes the row maximum m and then, in a second pass over the row, the sum of `exp(x[i] - m)`, both with the pattern of version c. These are the first two passes of a softmax. Test N = 1, 31, 32, 33, 1000 and 50257, with M = 1000. Step 16 merges the two passes into one.

### Done when

Every reduction passes the exact tests, including the one at 2^26, and the random test for every n, and `compute-sanitizer --tool racecheck` reports nothing for them. Your comment states the bound for each version. The best version reaches at least 70 percent of your copy bandwidth at 2^26, and you have the GB/s of all four in a table. `rowstats` matches a CPU loop in double for every shape.

## Matrix multiply: naive, coalesced and tiled

The first project starts here. It puts the ceilings of steps 5 to 10 and the shared memory of step 11 to work on one operation, and it ends with a table of your kernels against cuBLAS.

`C = A x B`, with A of M x K, B of K x N, all row-major floats, takes 2MNK floating-point operations. The roofline puts it far right of the ridge, so it can be compute-bound. A naive kernel with one thread per element of C is nowhere near that, because each thread reads a whole row of A and a whole column of B from DRAM. Every input element is read N or M times.

**Tiling** fixes that. A block computes one tile of C. It loads a tile of A and a tile of B into shared memory, waits at a barrier, and every thread uses those tiles for its share of the dot products. A second barrier keeps any thread from overwriting a tile that others still read, and then the block moves on along K. Each element read from DRAM is now used by a whole row or column of threads.

![To compute one tile of C, a block walks along K. The tile's rows of A and columns of B, drawn dashed through C, are the only ones it reads. At each step its threads load one tile of A and one tile of B into shared memory, wait at a barrier, and every thread adds the tiles' share of its dot product.](figures/21-tiled-matmul.svg)

Simon Boehm's worklog takes one kernel from naive to within a few percent of cuBLAS, measuring each version with `ncu`. The post shows eight kernels, numbered 1 to 10 with 7 and 8 left out. This step covers his first three, and the next step the rest.

His kernels assume that M, N and K are multiples of the tile size. Yours load zeros for tile elements outside A or B and skip the store for outputs outside C. Boehm writes tile sizes as template parameters, `template <const int BLOCKSIZE> __global__ void k(...)`, launched as `k<32><<<grid, block>>>(...)`. Chapter 20's templates took a type, and these take a number that is fixed at compile time, so the compiler can unroll loops over it and size arrays with it.

The error policy comes from how float dot products round. Each entry of C can be off from the exact value by about K times 2^-24 times the dot product of the absolute values of its row and column. Accept `|c - ref| <= 2 * K * 2^-24 * (|A| x |B|)` for each entry, with the reference and `|A| x |B|` computed in double on the CPU.

### Study

- [Simon Boehm: How to Optimize a CUDA Matmul Kernel for cuBLAS-like Performance](https://siboehm.com/articles/22/CUDA-MMM) (read, 1 h 15 min): The introduction, "Kernel 1: Naive Implementation" with both subsections, "Kernel 2: Global Memory Coalescing", and "Kernel 3: Shared Memory Cache-Blocking" with "Occupancy Calculation for Kernel 3". His numbers come from an RTX A6000, so compare ratios to cuBLAS and not absolute GFLOP/s. Open his code for a kernel only after yours passes its tests.
- [GPU Puzzles](https://github.com/srush/GPU-Puzzles) (do, 1 h): Puzzle 14, Matrix Multiply. Do the single-block case first, then the tiled case with its limit of global reads.
- [cuBLAS documentation](https://docs.nvidia.com/cuda/cublas/index.html#data-layout) (reference, as needed): 1.1 "Data Layout", 2.7.1 "cublas<t>gemm()", 2.4.22 "cublasSetMathMode()" with 2.2.10 "cublasMath_t". Step 15 uses 2.8.12 "cublasGemmEx()" and 2.1.11 "Tensor Core Usage".

### Build

1. `src/mm.cu`: a harness that creates random A and B in [-1, 1], runs a chosen kernel, checks C under the policy and reports the best time from your step 5 helper and GFLOP/s. A full double reference at 4096 takes minutes on the CPU, so check every entry for small shapes and 2000 random entries for large ones. Take the kernel and the shape from the command line, so that `ncu` can profile one of them.
2. Shapes: square 128, 256, 512, 1024, 2048 and 4096, and the irregular (M, N, K) = (1000, 777, 333), (1, 4096, 4096), (4096, 1, 4096), (4097, 129, 65) and (33, 33, 1).
3. Kernel 0 is cuBLAS, checked under the same policy. cuBLAS stores matrices column by column, as Fortran does. A row-major C = A x B is the column-major product C^T = B^T x A^T, so you pass B before A and swap M and N: `cublasSgemm(h, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &one, dB, N, dA, K, &zero, dC, N)`, where `h` is a handle from `cublasCreate(&h)`. The default math mode keeps full FP32 precision, so the comparison is fair. Link with `sh build.sh mm -lcublas`.
4. Kernel 1: Boehm's naive kernel, which maps consecutive threads to consecutive rows of C. Kernel 2: consecutive threads to consecutive columns. Kernel 3: the shared-memory tile with a block size of 32 and the zero-fill rules.
5. Profile kernels 1, 2 and 3 at 4096 under `ncu`, one kernel and one launch per run. Record DRAM bytes moved, Sectors/Req for global loads, shared-memory bank conflicts and achieved occupancy. If TDR kills kernel 1 at 4096, use 2048 for that kernel and mark the row.
6. Run kernel 3 under `compute-sanitizer --tool racecheck` at (1000, 777, 333).

### Done when

All kernels, cuBLAS included, pass the policy on every shape. `notes/matmul.md` has GFLOP/s and percent of cuBLAS for kernels 1 to 3 at 4096, or 2048 where TDR forced it. You can explain the step from kernel 1 to 2 with Sectors/Req, and the step from 2 to 3 with DRAM bytes. Racecheck reports no hazards, and you can say which resource `ncu` says kernel 3 waits on.

## Register tiling, vector loads and SASS

Kernel 3 loads two floats from shared memory for every multiply-add, and shared memory has its own bandwidth limit, which kernel 3 runs into. The fix is the move every fast matrix multiply makes: each thread computes several outputs and keeps them in registers.

With a TM by TN tile of outputs per thread, one step along k loads TM values of A's column and TN values of B's row into registers, then does TM times TN multiply-adds. Each loaded value is used several times. That raises the arithmetic intensity of shared memory, the way tiling raised it for DRAM.

![One thread with a 4 by 4 register tile. For each k it loads four values of A's column k and four of B's row k from shared memory into registers, then does 16 multiply-adds into its 16 accumulators.](figures/21-register-tile.svg)

Boehm continues with one-dimensional and then two-dimensional block tiling, then **vectorized loads** with `float4`, which move four floats in one instruction, then a search over tile sizes, then warp tiling, which adds a level for each warp's share of the block's tile. `float4` loads need 16-byte alignment. That holds when the row length is a multiple of 4 and the base pointer comes from `cudaMalloc`. For irregular shapes, copy A and B into zero-padded buffers whose sizes are multiples of the tile sizes, run the kernel, and copy the M x N part of C back out.

Now read what the compiler made. `cuobjdump -sass out/mm` prints **SASS**, the GPU's own machine code, the way `objdump -d` printed x86-64 in chapter 05. The driver made the same kind of code from your SPIR-V shaders in chapter 14. The compiler goes through **PTX**, a virtual instruction set, on the way. These opcodes matter here:

- `FFMA` is a fused multiply-add.
- `LDS` loads from shared memory and `LDG` from global memory. A `.128` suffix loads 16 bytes at once.
- `LDL` and `STL` load and store **local memory**, per-thread memory in DRAM. When a kernel needs more registers than the compiler will give it, the compiler keeps some values there instead, which is called **spilling** registers. An `LDL` in an inner loop makes a kernel slow.

Compiled with `nvcc` 13.5 for compute capability 8.6, the inner loop of a kernel 3 has 32 `FFMA`, 32 `LDS` and 8 `LDS.128`, because the compiler merged the loads along a row of the A tile. A two-dimensional tile of 8 by 8 compiles to 64 `FFMA` and 4 `LDS.128` per step, with no local memory.

### Study

- [Simon Boehm: How to Optimize a CUDA Matmul Kernel](https://siboehm.com/articles/22/CUDA-MMM#kernel-4-1d-blocktiling-for-calculating-multiple-results-per-thread) (read, 2 h): Kernel 4 with "Sidenote on Compiler Optimizations" and "Areas of Improvement: Arithmetic Intensity", Kernel 5, Kernel 6, "Kernel 9: Autotuning", "Kernel 10: Warptiling" and the "Conclusion". Skip "Work in Progress: Kernel 11".
- [CUDA Binary Utilities](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html#cuobjdump) (reference, as needed): 2 "cuobjdump" with 2.1.1 "Dumping SASS, ELF, and PTX" and 2.1.3 "Resource Usage Information", then in 4 "Instruction Set Reference" the table for your GPU: 4.1 for Turing (7.5), 4.2 for Ampere and Ada (8.6, 8.9), or 4.4 for Blackwell (12.0, the RTX 50 series).

### Build

1. Add Boehm's kernels 4 (1D block tiling), 5 (2D block tiling) and 6 (vectorized loads) to `mm.cu`, written by you, with tile sizes as template parameters and the padding path for irregular shapes. Every kernel passes the policy on every shape before you time it.
2. For kernels 3, 5 and 6, find the inner loop in `cuobjdump -sass` and count `FFMA` against `LDS` instructions per step, counting a `.128` load as four floats. Look for `LDL` and `STL`. Run `cuobjdump -res-usage` for registers per thread.
3. Extend `notes/matmul.md` with kernels 4 to 6: GFLOP/s at 1024, 2048 and 4096, percent of cuBLAS, registers per thread, achieved occupancy, and floats loaded from shared memory per `FFMA`.

> **Optional:** An autotuner in the style of kernel 9: a script that builds kernel 6 for a grid of BM, BN, BK, TM and TN values that fit your GPU's shared memory and register limits, runs each at 4096, and keeps the fastest. Then kernel 10, warp tiling.

### Done when

Every kernel passes the policy on every shape. Your best kernel reaches at least 50 percent of `cublasSgemm` at 4096, and 80 percent is the stretch. You can explain each row of the table from one change in the kernel and one number from `ncu` or the SASS. You can point at the `FFMA` and `LDS.128` instructions in the inner loop of kernel 6 and say whether any of your kernels spill registers.

## Tensor cores

Every kernel in step 14 is bounded by the FP32 peak you measured in step 9. Tensor cores raise that ceiling for the half-precision multiplies that deep learning uses.

**Tensor cores** are units in each SM, since Volta, that multiply small matrices in one operation. A warp hands them a 16 by 16 tile of A, a 16 by 16 tile of B and a 16 by 16 accumulator C, and gets back D = A x B + C. That is 8192 floating-point operations, at a rate several times the FP32 rate of the same GPU. RTX cards have tensor cores, and reviews of the GTX 16 series report that its chips have none.

The inputs are **half precision**, the float format of chapter 04 with 16 bits: a 5-bit exponent and a 10-bit fraction, an 11-bit significand, and a largest finite value of 65504. Two 11-bit significands multiply into at most 22 bits, which fit in float's 24, so each product is exact and only the accumulation in float rounds. Round your inputs with `__float2half` from `cuda_fp16.h`, which also runs on the host, and compute the reference in double from the rounded values. Then the policy of step 13 applies. On the host, `__float2half(70000.0f)` gives infinity and `__float2half(2049.0f)` gives 2048.

Training mostly uses two other formats. **BF16** keeps float's 8-bit exponent with a 7-bit fraction, so it has float's range. **TF32** also has float's range and keeps at least 10 bits of fraction, and tensor cores use it to multiply float inputs. GPUs of compute capability 8.0 and newer support both, and section 5.4.11.2 of the guide lists them.

CUDA exposes tensor cores through the warp matrix functions in `nvcuda::wmma`, from the header `mma.h`. A **fragment** holds one tile, spread over the registers of the 32 threads of a warp:

![One mma_sync: the 32 threads of a warp together multiply a 16 by 16 half tile of A by a 16 by 16 half tile of B and add a 16 by 16 float tile. The accumulator fragment gives each thread 8 of the 256 floats, and which 8 is not specified.](figures/21-tensor-core.svg)

Because the layout is not specified, you never index a fragment by position. All 32 threads call each function together, so all of them must reach it:

```cpp
wmma::fragment<wmma::matrix_a, 16, 16, 16, half, wmma::row_major> a;
wmma::fragment<wmma::matrix_b, 16, 16, 16, half, wmma::row_major> b;
wmma::fragment<wmma::accumulator, 16, 16, 16, float> acc;
wmma::fill_fragment(acc, 0.0f);
for (int k0 = 0; k0 < K; k0 += 16) {
    wmma::load_matrix_sync(a, A + row0 * K + k0, K);   // K: elements per row of A
    wmma::load_matrix_sync(b, B + k0 * N + col0, N);
    wmma::mma_sync(acc, a, b, acc);
}
wmma::store_matrix_sync(C + row0 * N + col0, acc, N, wmma::mem_row_major);
```

The last argument of a load or store is the row length in elements. For `half` it must be a multiple of 8, and the pointer must be aligned to 32 bytes. Compiled with `nvcc` 13.5, one `mma_sync` becomes two `HMMA.16816.F32` instructions for compute capability 8.6 and for 12.0, and four `HMMA.1688.F32` for 7.5.

The first kernel, H1, uses one warp per 16 by 16 tile of C and reads straight from global memory. Like kernels 1 and 2, it reuses nothing it loads. The second, H2, applies steps 13 and 14 again: a block stages tiles of A and B in shared memory, and each warp computes several output tiles from them.

### Study

- [CUDA Programming Guide: 5.4.11 Warp Matrix Functions](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/cpp-language-extensions.html#warp-matrix-functions) (read, 30 min): 5.4.11.1 "Description", 5.4.11.5 "Restrictions", 5.4.11.6 "Element Types and Matrix Sizes" and 5.4.11.7 "Example". Read 5.4.11.2 "Alternate Floating Point" for BF16 and TF32. Skip 5.4.11.3 and 5.4.11.4.
- [Jeremy Appleyard and Scott Yokim: Programming Tensor Cores in CUDA 9](https://developer.nvidia.com/blog/programming-tensor-cores-cuda-9/) (read, 15 min): "Programmatic access to Tensor Cores in CUDA 9.0" through "Finishing up" only. It adds the loop over K with one warp per output tile, which is your kernel H1. Their example is column-major and yours is row-major, so the layouts in your fragments and loads differ. Skip the "AI-Generated Summary" box and the cuBLAS and cuDNN sections, which use a mode cuBLAS has since deprecated.
- [CUDA Math API: Half Precision Conversion and Data Movement](https://docs.nvidia.com/cuda/cuda-math-api/cuda_math_api/group__CUDA__MATH____HALF__MISC.html) (reference, as needed): `__float2half` and `__half2float`, both marked `__host__ __device__`, and the rounding note on each.

### Build

1. `src/mmh.cu`: the step 13 harness for half inputs and float output. Round the random inputs to half on the host, keep both copies, and compute the reference from the half values in double. Shapes: square 256 to 4096, plus (4096, 4096, 1024) and (1000, 777, 336). Pad shapes that are not multiples of 16, as in step 14.
2. Reference: `cublasGemmEx` with `CUDA_R_16F` for A and B, `CUDA_R_32F` for C and `CUBLAS_COMPUTE_32F`, with the row-major argument swap from step 13, checked against the policy too.
3. Kernel H1: one warp per 16 by 16 output tile, fragments loaded from global memory.
4. Kernel H2: a block of 4 or 8 warps computes a 64 by 64 or 128 by 128 tile of C. Tiles of A and B go through shared memory, and each warp computes a 2 by 2 or 4 by 2 group of 16 by 16 tiles. Pad shared rows by 8 halves against bank conflicts, which keeps the row length a multiple of 8.
5. Print `acc.num_elements` and `a.num_elements` from inside a kernel, and explain the accumulator's number from 256 and 32.
6. Find the `HMMA` instructions in the SASS of H1 and H2. In `ncu`, read the tensor core roofline in the Speed Of Light section.
7. Add both kernels and `cublasGemmEx` to `notes/matmul.md` in TFLOP/s, next to your best FP32 kernel and `cublasSgemm`.

### Done when

H1, H2 and `cublasGemmEx` pass the policy on every shape, or you have recorded the size of every failure relative to the bound. H2 beats H1 and your best FP32 kernel at 4096. You can say what fraction of `cublasGemmEx` H2 reaches and name the next change that would close the gap. You can explain why a fragment must be loaded and stored by the whole warp.

## A fused softmax kernel

Matrix multiply sits right of the ridge point. The second project kernel sits far left of it, so its target is your copy bandwidth, and the way to reach it is to read memory as few times as possible.

Softmax of a row x is `exp(x[i] - m) / sum_j exp(x[j] - m)`, where m is the row's maximum. Subtracting m keeps every exponent at or below zero, so nothing overflows, and the result does not change. Written out in PyTorch as `(x - x.max(1)).exp() / ...`, each operation is a separate kernel that reads and writes the whole matrix. A **fused** kernel does all of it in one kernel and touches DRAM once or twice per row.

Your `rowstats` kernel from step 12 already finds the maximum and the sum of exponentials per row in two passes, so a plain fused kernel makes three passes over the row inside one block. The **online normalizer** of Milakov and Gimelshein merges the first two passes. It keeps a running maximum m and a running sum d. When a new element raises the maximum from m to m', the old sum was computed against the wrong maximum, and multiplying it by `exp(m - m')` corrects it:

```
  start: m = -inf, d = 0
  each x:  m' = max(m, x)
           d  = d * exp(m - m') + exp(x - m')
           m  = m'

  combine two partial results (m1, d1) and (m2, d2):
           m = max(m1, m2)
           d = d1 * exp(m1 - m) + d2 * exp(m2 - m)
```

![The three-pass softmax reads the row three times and writes it once. The online version keeps the running maximum and sum together and rescales the sum when the maximum grows, so it reads the row twice and writes it once.](figures/21-online-softmax.svg)

The combine rule is associative, so it can replace `+` in the tree reduction and the warp shuffle of step 12. Each thread runs the loop over its share of the row, then the block combines the pairs. FlashAttention applies the same rescaling to whole tiles of attention scores, so it never writes the full attention matrix to memory.

Decide the edge cases before you write the code. A row of `-inf`, which is what a fully masked attention row looks like, makes `exp(-inf - (-inf))` a NaN. Choose an output for it, zeros or NaN, write the choice down and test it. A row with 1e4 and -1e4 must not overflow, and a row of length 1 gives 1.

Andrej Karpathy's llm.c trains GPT-2 in plain C and CUDA. Its `dev/cuda` directory keeps every version of each kernel with a CPU reference and a benchmark. The softmax file goes from one thread per row to warp reductions and the online normalizer. Read it after your own kernels work.

### Study

- [Maxim Milakov and Natalia Gimelshein: Online normalizer calculation for softmax](https://arxiv.org/abs/1805.02867) (read, 45 min): The PDF, by two NVIDIA engineers. Sections 1 to 3 with Algorithms 1 to 3, the proof, and the parallel operator in equations 3 and 4. Skim 5 and 6 for their bandwidth argument and results. Skip section 4 on top-k.
- [Andrej Karpathy: llm.c, dev/cuda/softmax_forward.cu](https://github.com/karpathy/llm.c/blob/master/dev/cuda/softmax_forward.cu) (read, 1 h): The header comment, both CPU references, then `softmax_forward_kernel1` to `kernel4`, `softmax_forward_online_kernel1`, `online_kernel2` and `online_kernel8`. `online_kernel2` uses Cooperative Groups, a library on top of the warp functions you used, so read its reduction as a shuffle reduction. `kernel7` is optional.

### Build

1. `src/softmax.cu` in the style of the step 12 harness: a CPU reference in double, and three kernels over an M x N float matrix with one block per row. S1 makes three passes. S2 uses the online normalizer in one pass, then the output pass. S3 is S2 with the row held in registers, 16 floats per thread in blocks of 256 threads, so the row is read from DRAM once. S3 handles N up to 4096 this way and calls the S2 path for longer rows. Use `expf` and not the faster, less accurate `__expf` until all tests pass.
2. Test N = 1, 31, 32, 33, 1000, 4096, 50257 and 100000 with M = 1000. Test the extreme rows: 1e4 and -1e4 mixed, a row with one `-inf`, and a fully `-inf` row with the output you chose.
3. State an error policy for outputs in [0, 1]. Start from `atol = 1e-6` and `rtol = 1e-5`, and write next to it why those values hold for N up to 100000.
4. Report GB/s for each kernel on a 4096 x 4096 input, counting one read and one write of the matrix, next to your copy bandwidth.
5. Read `softmax_forward.cu` and write in `notes/softmax.md` how each of its versions maps to yours. `online_kernel8` returns early when `tid >= C` and later calls `__shfl_down_sync` with a full mask. Say for which shapes that breaks the rule from the warp primitives post, and why the benchmark in the file never hits them.

### Done when

S1, S2 and S3 pass your policy on every shape, and the extreme rows give what you wrote down. S2 or S3 reaches at least 70 percent of your copy bandwidth at 4096 x 4096. You can derive the combine rule for two (m, d) pairs on paper without looking.

## Calling your kernel from PyTorch

Your softmax runs from a C++ harness. You use softmax every day from PyTorch, so the last check is against `torch.softmax` on the same tensors, in the same process.

PyTorch can compile and load a CUDA kernel at run time. `torch.utils.cpp_extension.load_inline` takes your CUDA source as a string and a C++ declaration of the function Python calls. It writes a build file for Ninja, the build tool that ran under CMake when you built SDL3 in chapter 06, compiles the sources with `nvcc` and gcc, and imports the result as a Python module. Chapter 22 loads this same kernel into its tensor library this way. Here it is for `vadd`:

```python
import torch
from torch.utils.cpp_extension import load_inline

cuda_src = r"""
#include <c10/cuda/CUDAStream.h>
#include <c10/cuda/CUDAException.h>

__global__ void vadd_kernel(const float *a, const float *b, float *c, int n)
{
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}

torch::Tensor vadd(torch::Tensor a, torch::Tensor b)
{
    TORCH_CHECK(a.is_cuda() && b.is_cuda(), "inputs must be on the GPU");
    TORCH_CHECK(a.dtype() == torch::kFloat32 && b.dtype() == torch::kFloat32, "inputs must be float32");
    TORCH_CHECK(a.sizes() == b.sizes(), "shapes differ");
    a = a.contiguous();
    b = b.contiguous();
    torch::Tensor c = torch::empty_like(a);
    int n = a.numel();
    if (n == 0) return c;
    int threads = 256;
    int blocks = (n + threads - 1) / threads;
    cudaStream_t stream = c10::cuda::getCurrentCUDAStream();
    vadd_kernel<<<blocks, threads, 0, stream>>>(a.data_ptr<float>(), b.data_ptr<float>(), c.data_ptr<float>(), n);
    C10_CUDA_KERNEL_LAUNCH_CHECK();
    return c;
}
"""
cpp_src = "torch::Tensor vadd(torch::Tensor a, torch::Tensor b);"
ext = load_inline(name="vadd_ext", cpp_sources=cpp_src, cuda_sources=cuda_src, functions=["vadd"])
```

The new lines, in order:

- `torch::Tensor` is the C++ type behind a Python tensor.
- `TORCH_CHECK(cond, message)` raises a Python `RuntimeError` with the message when the condition is false. Check the device, the type and the shape, because your kernel assumes all three.
- `contiguous()` returns the tensor itself when its elements already sit in row-major order with no gaps, and a packed copy otherwise. Your kernel indexes `a[i]` and needs that order.
- `torch::empty_like(a)` allocates an output of the same shape, type and device without filling it.
- `data_ptr<float>()` gives the device address of the first element, the same kind of pointer `cudaMalloc` gave you.
- `getCurrentCUDAStream()` is the stream PyTorch queues its own work in. Launching into it keeps your kernel in order with PyTorch's kernels before and after it.
- `C10_CUDA_KERNEL_LAUNCH_CHECK()` is PyTorch's `CHECK_LAUNCH()`.
- `cpp_sources` declares the function for the C++ half that `load_inline` generates, and `functions` names the functions Python can call, here as `ext.vadd(x, y)`.

`load_inline` sets its own compiler flags, among them `-std=c++20`, which PyTorch's headers require, so do not pass your `build.sh` flags to it.

PyTorch ships as **wheels**, ready-built package files that pip installs without compiling anything. Its Linux wheels run in Ubuntu under WSL2 and use the `libcuda.so` from `/usr/lib/wsl/lib`. Ubuntu 24.04 refuses `pip install` outside a **virtual environment**, as chapter 07 found. A virtual environment is a directory with its own Python interpreter and its own installed packages, made with `python3 -m venv`, the tool chapter 22 also uses.

The pip command comes from the selector on pytorch.org, because its index URL names a CUDA version, such as `https://download.pytorch.org/whl/cu134`, and that number changes with each release. `torch.utils.cpp_extension` stops with an error when the CUDA major version of PyTorch differs from your `nvcc`, and only warns when the minor version differs.

Time your kernel and `torch.softmax` with `torch.cuda.Event(enable_timing=True)`, which wraps the CUDA events from step 5. `torch.compile` is PyTorch's compiler: it turns a Python function into fused GPU kernels, which it writes in Triton. Timing it next to yours shows what a compiler gets on this kernel, and step 18 looks inside.

### Study

- [PyTorch: Get Started](https://pytorch.org/get-started/locally/) (do, 15 min): Choose Stable, Linux, Pip, Python, and the CUDA version whose major number matches your `nvcc`, then copy the command it prints.
- [PyTorch: torch.utils.cpp_extension.load_inline](https://docs.pytorch.org/docs/stable/cpp_extension.html#torch.utils.cpp_extension.load_inline) (reference, as needed): The signature, the example, and the arguments `cpp_sources`, `cuda_sources`, `functions`, `extra_cuda_cflags` and `build_directory`. The description of `load` just above it explains the Ninja build and `CUDA_HOME`.

### Build

1. Run `sudo apt install python3-venv python3-dev`. The second package holds `Python.h`, which the extension build and Triton's launcher both compile against. Then `python3 -m venv ~/code/cuda/.venv`, activate it, add `.venv/` to `.gitignore`, and run the pip command from the selector. Then `pip install ninja numpy`.
2. Run `python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"` and compare the version with `nvcc --version`.
3. `py/vadd_ext.py`: the skeleton above. Compare `ext.vadd(x, y)` with `x + y` on CUDA tensors of 1, 1000 and 1000003 elements, and pass a CPU tensor once to see your `TORCH_CHECK` message.
4. `py/softmax_ext.py`: the same wrapper around S2, taking an M x N float32 tensor and returning a new one. Compare it with `torch.softmax(x, -1)` under your policy for every shape of step 16 except the fully `-inf` row.
5. Time your S2, `torch.softmax` and `torch.compile(lambda x: torch.softmax(x, -1))` with CUDA events at 4096 x 4096 and 1000 x 50257, with warm-up calls first.
6. Run the timing script under `nsys profile` and print `cuda_gpu_kern_sum` and `cuda_gpu_trace`. Find the kernels each of the three versions launches and the gaps between them.

> **If it fails:** If the extension build stops with `fatal error: Python.h: No such file or directory`, install `python3-dev` as in item 1. If it cannot find `nvcc`, set `CUDA_HOME` to the toolkit directory you put on `PATH` in step 1. `torch.compile` may fail on a GPU below compute capability 8.0, because Triton needs 8.0. Record the error and leave out that timing.

### Done when

`ext.vadd` matches `x + y`, and your softmax extension matches `torch.softmax` on every shape. You have the three timings and the kernel list from `nsys`, with one sentence each on why the timings differ.

## The same kernels in Triton

Every kernel you wrote made the same decisions by hand: which thread loads which element, what goes into shared memory and when the barrier comes, how many outputs each thread keeps in registers, when to use tensor cores. Triton makes most of them for you, and this step shows which.

**Triton** is a language embedded in Python, with its own compiler. A Triton kernel describes what one **program** does to whole tiles, and one launch runs many programs. `tl.load` of a block of pointers with a mask loads a tile, `tl.dot` multiplies two tiles, and `tl.max` and `tl.sum` reduce one. The compiler picks the thread mapping, stages data in shared memory, vectorizes loads, emits tensor core instructions, and loads the next tile while it computes on this one. You still choose the tile sizes and the number of warps, or let its autotuner try a list.

![Vector add of 13 elements written twice. In CUDA you write one thread, and 16 threads each take one element behind a bounds check. In Triton you write one program, and two programs each take a tile of 8 elements behind a mask.](figures/21-cuda-triton.svg)

The three tutorials map onto steps you have done:

- Vector add is your step 2 kernel, with a mask in place of the bounds check.
- Fused softmax is your S3 in a dozen lines. Its launcher computes occupancy from the kernel's register count with the arithmetic of step 9.
- Matrix multiply is your H2 with an autotuner, plus one idea you have not used. It orders the blocks so that blocks running at the same time share tiles of A and B in the L2 cache.

Triton's README lists NVIDIA GPUs of compute capability 8.0 and newer, the RTX 30 series on, and Linux as its platform. It installs as a Linux wheel in your virtual environment and reaches the GPU through the same `libcuda.so` as your CUDA programs. Before it runs a kernel the first time, it compiles a small C launcher with gcc against `Python.h`, which is why step 17 installed `python3-dev`.

> **If it fails:** On an RTX 20 or GTX 16 GPU, Triton does not run. Read the three tutorials and their kernels, skip Build items 1 to 4, and write `notes/triton.md` from reading, comparing each tutorial kernel line by line with your CUDA version. On such a GPU, the Done when asks for that note alone.

### Study

- [Triton tutorial: Vector Addition](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html) (do, 30 min): The whole tutorial, run in the environment from step 17. Check `python -c "import triton"` first and `pip install triton` if it fails.
- [Triton tutorial: Fused Softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html) (do, 1 h): "Motivations", "Compute Kernel", "Unit Test" and "Benchmark". Skip the AMD branches marked `is_hip`.
- [Triton tutorial: Matrix Multiplication](https://triton-lang.org/main/getting-started/tutorials/03-matrix-multiplication.html) (do, 1 h 30 min): "Motivations", "Compute Kernel" with "Pointer Arithmetic" and "L2 Cache Optimizations", "Final Result", "Unit Test" and "Benchmark". Skip the fp8 configurations.

### Build

1. Run all three tutorials unchanged and keep their benchmark plots.
2. `py/tri_softmax.py`: the tutorial's softmax handles a row only if it fits in one block. Write a second Triton kernel that loops over a long row in blocks with the online normalizer from step 16. Test it with your step 16 shapes and policy, and time it against your S2, `torch.softmax` and the tutorial kernel at 1000 x 50257 and 4096 x 4096.
3. `py/tri_matmul.py`: run the tutorial kernel with half inputs at your step 15 shapes. Its output is half, so compare it with `cublasGemmEx` and your H2 on time, and check its values against a float reference with the tutorial's own tolerance. Print the winning autotune configuration.
4. For the tutorial softmax, print `kernel.n_regs` and `kernel.metadata.shared` as its launcher does, and compare them with `nvcc --resource-usage` for your S2.
5. `notes/triton.md`: for each kernel, the decisions Triton made that you made by hand, the ones you still made, and where your CUDA version wins or loses and why.

### Done when

Your looped Triton softmax passes the step 16 tests and policy. You have one table with every softmax and every half-precision matrix multiply you built, in GB/s or TFLOP/s. `notes/triton.md` names at least four decisions Triton made for you, each tied to the step where you made it by hand.

## Where this leads

You can now write a CUDA kernel, check it with a CPU oracle under a stated error policy, find its bottleneck with `ncu`, `nsys` and the SASS, and explain its speed from the bandwidth and arithmetic ceilings you measured on your own GPU. You took matrix multiply from a naive kernel far below cuBLAS to a large fraction of it and onto tensor cores. You wrote a softmax that reads each row once, called it from PyTorch, and saw what Triton automates. Each kernel was one operation with a fixed shape, launched from a harness you wrote for that operation.

A deep learning framework needs much more around those kernels: tensors of any shape and stride, broadcasting, a graph that records every operation, and a backward pass that computes gradients through all of it. Chapter 22, A tensor library, builds that from scratch in MiniTorch, a teaching library written in Python. It starts away from the GPU, with one Python environment for MiniTorch's five template repositories and then automatic differentiation on single numbers. Tensors come next, whose strides and broadcasting extend the `row * ncols + col` of your 2D kernels to any number of dimensions.

The GPU returns in MiniTorch's CUDA backend, which asks for map, zip, reduce and matrix multiply kernels in the Numba syntax of GPU Puzzles. The last step of the book loads your own softmax kernel from this chapter, and your AVX2 code from chapter 07, under MiniTorch as a backend.
