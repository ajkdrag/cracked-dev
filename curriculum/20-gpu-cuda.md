---
id: 20
title: GPU programming with CUDA
part: GPUs and a tensor library
weeks: 10
project: A CUDA matrix multiply taken from a naive kernel through shared-memory and register tiling to tensor cores and measured against cuBLAS, then a fused online-softmax kernel called from PyTorch, with both kernels rewritten in Triton at the end.
---

Chapter 19 ended with a bug fix sent to Valkey as a review-ready pull request, and with small ports of your own C to C++, Zig and Odin. You can now find your way through a large C code base, trace a request through it, and change one part without breaking the rest. You also write C++ as C with a few additions, small templates included, and you read the code the compiler emits for each feature before you use it. For years you have used a GPU through PyTorch: `.cuda()`, a matmul, a softmax, a training loop that runs fast for reasons you took on trust. This chapter writes those kernels.

You start with a driver, a toolkit and a first kernel, and you learn to check every launch for errors. Then you measure the card the way chapter 07 measured your Mac: memory bandwidth first, then arithmetic throughput, then the number of warps the card needs in flight to reach either one. Shared memory and barriers come next, with reductions as the first algorithm that needs them. The project follows. You take matrix multiplication from a naive kernel to a tiled one, then to register tiling, then to tensor cores, and you compare each version against cuBLAS on the same laptop. After that you write a softmax that reads each row once, using the online normalizer that FlashAttention is built on, and you call it from PyTorch. The last step rewrites both kernels in Triton, so you can see which of your decisions a compiler can make for you.

The chapter comes this late because it uses almost everything before it. Chapter 07 gave you bandwidth plateaus, latency and throughput, and SIMD lanes with masks. A warp is 32 lanes under one instruction, and the GPU builds the mask for you when threads branch apart. Chapter 09 gave you races, locks and the rule that one thread sees another's write only through a synchronizing operation. Chapter 14 showed you a CPU that records commands for the GPU and moves on before they run. A CUDA kernel launch works the same way. Chapters 15 and 16 showed you a kernel from the inside and a driver under a system call. In this chapter the GPU's kernel driver runs in Windows, and your Linux programs reach it through a device that forwards each call out of the virtual machine. Step 1 traces that path. Chapter 21, A tensor library, builds a framework whose GPU backend is written from the kernels of this chapter.

macOS has no CUDA. Everything in this chapter runs on your NVIDIA laptop, in Ubuntu under WSL2 on the laptop's Windows install. WSL2 runs a real Linux kernel in a lightweight virtual machine, so NVIDIA's Linux toolkit and the Linux tools from earlier chapters work there unchanged. Keep your `cuda/` repository in the Linux file system under your home directory, not under `/mnt/c`. Microsoft's WSL guidance says Linux tools work fastest on files stored in the WSL file system. Use the Mac for reading and notes. Every number you compare comes from that laptop: your kernels against cuBLAS on the same card, never against numbers from a blog post. The one exception is step 10 on an older card, which the first step explains. Laptop GPUs lower their clocks when they get hot or run on battery, so plug the laptop in before you measure anything.

## An NVIDIA machine and the CUDA model

CUDA needs two installs. The driver is a kernel-mode driver plus a user-space library that the CUDA runtime calls into. The toolkit holds the compiler `nvcc`, the runtime library, cuBLAS, the profiler `ncu` and the checker `compute-sanitizer`. Since CUDA 13.4 the toolkit and the driver install separately. You install the driver first, in Windows, and the toolkit second, inside Ubuntu.

Under WSL2 the NVIDIA driver is not a Linux kernel module of the chapter 16 kind. The NVIDIA kernel-mode driver runs in Windows. The Linux kernel that WSL2 boots carries a small Microsoft driver, dxgkrnl, that exposes one device, `/dev/dxg`. Its ioctls mirror the Windows graphics kernel interface, and dxgkrnl forwards each call over VMBus, the channel between the virtual machine and Windows, to the graphics kernel on the host. Microsoft calls this GPU paravirtualization: the Linux side sees a stand-in device, and the real driver answers from Windows. WSL also mounts libraries that ship with NVIDIA's Windows driver into Ubuntu at `/usr/lib/wsl/lib`, including `libcuda.so` and `nvidia-smi`. So the CUDA runtime calls `libcuda.so`, `libcuda.so` talks to `/dev/dxg`, and Windows does the rest. NVIDIA's WSL guide gives one hard rule for this setup. Never install an NVIDIA Linux driver inside WSL, neither `nvidia-open` nor `cuda-drivers`, because a Linux driver overwrites the one mapped in from Windows.

```
  Ubuntu (WSL2 virtual machine)          Windows
  your program
  CUDA runtime (toolkit)
  libcuda.so  <- /usr/lib/wsl/lib, mounted from the Windows driver
     | ioctl
  /dev/dxg  (dxgkrnl, Linux side)  ==VMBus==>  graphics kernel, NVIDIA driver
                                                    |
                                                   GPU
```

The order is: NVIDIA's Windows driver, then WSL with Ubuntu, then the toolkit. Install the latest GeForce or RTX driver for your GPU in Windows from NVIDIA's driver page. Then install WSL from a PowerShell window opened as administrator. `wsl --install` installs whatever Ubuntu release Microsoft currently ships as the default. This chapter uses Ubuntu 24.04 LTS, so list the distributions with `wsl --list --online` and install the 24.04 entry by its name with `wsl --install -d`. Restart, open Ubuntu from the Start menu and create the Linux user it asks for. That user is separate from your Windows account and can use `sudo`. Run `wsl --update` once in PowerShell to get the latest WSL kernel. Inside Ubuntu, install the toolkit from NVIDIA's standard Ubuntu 24.04 repository. NVIDIA used to ship a separate WSL-Ubuntu repository. It is deprecated and stops before CUDA 13.4, so do not use it.

Secure Boot can stay on, and nothing asks you to enroll a key. The kernel driver is a Windows driver, and nothing you install in Ubuntu loads a kernel module.

Check the card once the Windows driver is in. Run `nvidia-smi` in Ubuntu. It works before the toolkit is installed, because it comes from `/usr/lib/wsl/lib`. Under WSL2 `nvidia-smi` has a limited feature set: NVIDIA's guide lists GPU utilization and the list of running compute processes among the queries it does not support yet. NVIDIA's WSL guide lists GeForce and RTX GPUs in WDDM mode as supported, and WDDM is the normal mode for a laptop GPU. The `nvcc` in CUDA 13.5 starts its list of architectures at `sm_75`, which is Turing: the RTX 20 series and the GTX 16 series. Every newer card works for steps 1 to 9. Step 8 needs tensor cores. Every RTX card has them. Reviews of the GTX 16 series report that its chips have none, so on such a card the step 8 kernels run without the speedup. Step 10 uses Triton, which supports compute capability 8.0 and newer, the RTX 30 series on. On an RTX 20 or GTX 16 card you rent a newer GPU for that step.

Most laptops are Optimus laptops. The integrated GPU drives the screen and the NVIDIA GPU computes. Windows and its NVIDIA driver decide when the NVIDIA GPU powers down and wakes up, and CUDA in Ubuntu sees only the NVIDIA GPU. The first launch after a pause takes a little longer. Step 3's warmup launch pays that cost before you time anything.

One Windows rule reaches into Ubuntu. The GPU stays under the Windows Display Driver Model (WDDM), and Windows resets a GPU that cannot finish or preempt its current task within two seconds, by default. Microsoft calls this Timeout Detection and Recovery (TDR). A kernel that runs past the limit is killed and your program gets an error. Keep every kernel you write well under a second. You will meet the limit in two places: a naive matrix multiply at 4096 in step 6, and any kernel run under `ncu` or Compute Sanitizer, which both make kernels run longer.

While the packages download, read how CUDA describes the hardware. A CUDA program has host code, which runs on the CPU, and kernels, which run on the GPU. A kernel launch starts a grid of thread blocks. Every block has the same number of threads, at most 1024. A block runs on one streaming multiprocessor (SM) from start to finish. The SM splits the block into warps of 32 threads, and each warp executes one instruction at a time for all of its threads. Blocks run in any order, on any SM, possibly one after another, so no block may wait for another block.

```
  your launch                         the hardware

  grid                                GPU
   +- block (0,0)  -+                  +- SM 0:  warps from several blocks
   +- block (1,0)   |  blocks go to    +- SM 1:  warps from several blocks
   +- block (2,0)   |  free SMs, in    +- ...
   +- ...          -+  any order       +- SM n
                                       +- L2 cache, shared by all SMs
  block = up to 1024 threads           +- DRAM (GDDR on your laptop)
  warp  = 32 consecutive threads,
          one instruction at a time
```

Two earlier chapters help here. A thread block behaves like a job from your chapter 09 job system with one extra rule: it can never wait on another job. Inside a block, threads can cooperate through shared memory and a barrier, which the next steps use. A warp behaves like a NEON register from chapter 07 that is 32 lanes wide. The difference is how you write the code. With NEON you wrote one instruction for four floats. With CUDA you write the code for one thread, and the hardware runs 32 of them in lockstep. When threads of a warp take different branches, the warp runs both paths and masks off the lanes that do not belong to each one. You built that mask by hand in chapter 07. Here the hardware builds it.

An SM keeps many warps resident at once, each with its own registers already allocated. Switching between them costs nothing. When one warp waits for memory, the scheduler issues an instruction from another. Chapter 07's out-of-order core hid latency inside one thread. A GPU hides it across warps, and step 4 measures how many it needs.

### Study

- [Microsoft: Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install) (do, 30 min): "Prerequisites", "Install WSL command", "Change the default Linux distribution installed", which you use to pick Ubuntu 24.04, "Set up your Linux user info" and "Check which version of WSL you are running", where your Ubuntu must show version 2. Skip the multiple-distribution and preview sections.
- [NVIDIA: CUDA on WSL User Guide](https://docs.nvidia.com/cuda/wsl-user-guide/index.html#getting-started-with-cuda-on-wsl-2) (do, 1 h 30 min): Section 3 "Getting Started with CUDA on WSL", steps 1 to 4 in order, then section 4 "WSL System Requirements and Limitations" in full. Read 3.4.2 only if you once set up the old WSL-Ubuntu repository. Step 4 links the CUDA Installation Guide for Linux for the toolkit. In that guide follow section 3 "Pre-installation Actions" without the `lspci` check in 3.1, then 4.7 "Ubuntu" with 4.7.3 "Network Repository Installation", where `<distro>` is `ubuntu2404` and `<arch>` is `x86_64`, and 4.7.4 "Common Installation Instructions" (`apt install cuda-toolkit`). Finish with 11.1.1 "Environment Setup" for `PATH` and 11.2.2 "Verify the Installation". Skip its section 5 "Driver Installation" and the runfile, conda and pip sections.
- [CUDA Programming Guide: 1.2 Programming Model](https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html) (read, 40 min): 1.2.1 "Heterogeneous Systems", 1.2.2 "GPU Hardware Model" with 1.2.2.1 "Thread Blocks and Grids" and 1.2.2.2 "Warps and SIMT", then 1.2.3 "GPU Memory" through 1.2.3.3 "On-Chip Memory in GPUs". Skip 1.2.2.1.1 on clusters, which need compute capability 9.0, 1.2.2.3 on tile programming, 1.2.3.2 and 1.2.3.4.

### Build

1. Install the Windows driver, then WSL with Ubuntu 24.04. In Ubuntu, run `nvidia-smi`, then `ls -l /dev/dxg /usr/lib/wsl/lib`. Compare `/dev/dxg` with the device node your chapter 16 driver created, and write down in `notes/gpu.md` which side of the virtual machine runs the NVIDIA kernel driver. Install the toolkit and set `PATH`. Check `nvcc --version` and `nvidia-smi --query-gpu=name,compute_cap --format=csv`. Make sure `ncu --version` and `compute-sanitizer --version` both run. The deb packages put Nsight Compute under `/opt/nvidia/nsight-compute/`, so add its directory there to `PATH` if `ncu` is not found.
2. Clone `https://github.com/NVIDIA/cuda-samples`, the repository that 11.2.2 points to, and build only `deviceQuery`, as its README describes for a single sample: `cd cpp/1_Utilities/deviceQuery && mkdir -p build && cd build && cmake -DCMAKE_CUDA_ARCHITECTURES=86 .. && make`. Replace 86 with your compute capability without the dot. Run it.
3. Start `notes/gpu.md` with a table of what `deviceQuery` prints: name, compute capability, number of SMs, CUDA cores per SM, GPU max clock, memory clock, memory bus width, L2 cache size, shared memory per block and per SM, registers per block, maximum threads per SM and per block, warp size, and "Run time limit on kernels". If that last line says Yes, the TDR limit described above is active and kills a kernel that runs for about two seconds, so keep test kernels short.
4. Compute two numbers from the table. Resident threads: SMs times maximum threads per SM, and the same in warps. Compare that with the core count of your Mac from chapter 09. Peak FP32 rate: SMs times CUDA cores per SM times 2 times the max clock, because one fused multiply-add counts as two floating-point operations. Step 4 measures how close a kernel gets to it.

### Done when

`deviceQuery` ends with `Result = PASS`, and `notes/gpu.md` has the table and both computed numbers. You can trace a CUDA call from your program through `libcuda.so` and `/dev/dxg` to the driver in Windows, and say why installing `nvidia-open` in Ubuntu would break it. You can say how many warps your GPU keeps resident at once, why it needs that many when your Mac runs one or two threads per core, and what CUDA promises about the order in which blocks run (nothing).

## First kernels: indexing, bounds and errors

Step 1 left you with a working toolkit and a table of what your card has. Now you write code for it. CUDA C++ is C++ with a few additions, and the kernels in this chapter use little C++ beyond the C-with-a-few-things style of chapter 19. `nvcc` compiles a `.cu` file. It splits the file into device code, which it compiles for the GPU, and host code, which it hands to the system's C++ compiler. A kernel is a function marked `__global__`. The host launches it with the grid and block sizes between triple angle brackets:

```cpp
__global__ void vadd(const float *a, const float *b, float *c, int n)
{
    int i = blockIdx.x * blockDim.x + threadIdx.x;   // this thread's element
    if (i < n) c[i] = a[i] + b[i];                   // the last block runs past n
}

int threads = 256;
int blocks = (n + threads - 1) / threads;            // round up
vadd<<<blocks, threads>>>(da, db, dc, n);
```

Every thread runs the whole function with its own `threadIdx`, and its block's `blockIdx`. The index computation and the bounds check are the two lines you will write in every kernel. Rounding the block count up means the last block has threads with no element, and without the check they write past the end of the array.

The GPU has its own memory. `cudaMalloc` returns a device pointer, which the host must not dereference, the same way a kernel address from chapter 15 means nothing in a user process. `cudaMemcpy` copies between host and device memory. This chapter uses explicit copies everywhere, so you always know when data crosses the bus. The guide also describes unified memory, which migrates pages on demand. It hides exactly the costs this chapter measures.

Errors arrive in three ways. Every runtime API call returns a `cudaError_t`. A launch returns nothing, so you call `cudaGetLastError()` right after it to catch a bad configuration, such as 4096 threads per block. Errors that happen while the kernel runs, such as an out-of-bounds write, appear only at the next call that waits for the GPU, such as `cudaDeviceSynchronize()` or a `cudaMemcpy`. The launch returned long before the kernel ran, as a command buffer submit did in chapter 14. The guide's `CUDA_CHECK` macro prints the error and carries on. Yours exits, because a failed check means every later result is suspect.

GPU Puzzles comes before the CUDA C. Sasha Rush wrote it as a Python notebook that runs CUDA kernels through Numba. `cuda.threadIdx.x` in Numba is `threadIdx.x` in CUDA C. Each puzzle draws which thread read and wrote which cell, so you see an indexing mistake before you debug one. Run it in Google Colab with a GPU runtime, as its README says. Chapter 21's GPU backend uses the same Numba syntax.

Compute Sanitizer is AddressSanitizer for the device. `compute-sanitizer ./out/vadd 1000` runs the program with every device memory access checked and reports invalid reads and writes with a source line, if you compiled with `-lineinfo`. It slows the program down a lot, so never time a sanitizer run. Compute Sanitizer supports WSL2, and its release notes list one WSL2 gap, coredumps, which this chapter does not use. The slowdown matters more on your setup, because a sanitized kernel that runs past the two-second TDR limit gets killed. The sizes in this step stay far below that.

### Study

- [CUDA Programming Guide: 2.1 Intro to CUDA C++](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/intro-to-cuda-cpp.html) (read, 1 h): 2.1.1 to 2.1.9. In 2.1.3 read "Explicit Memory Management" closely and skim "Unified Memory". 2.1.7 "Error Checking in CUDA" is the part to reread before you write `check.h`. Skip 2.1.10 on clusters.
- [GPU Puzzles](https://github.com/srush/GPU-Puzzles) (do, 1 h 30 min): Puzzles 1 to 7, Map to Blocks 2D, in Colab with the GPU runtime. Stop at Puzzle 8. Step 5 picks up from there.
- [Compute Sanitizer documentation](https://docs.nvidia.com/compute-sanitizer/ComputeSanitizer/index.html) (reference, as needed): "Introduction", "Compute Sanitizer" (command line and compilation options), "Memcheck Tool" through "Understanding Memcheck Errors", and "Windows Specific Behavior" for the TDR timeout. For step 5, the same page's "Racecheck Tool" through "Understanding Racecheck Hazard Reports" and "Synccheck Tool" through "Understanding Synccheck Reports". Skip "Initcheck Tool".

### Build

Make a repository `cuda/` with a `build.sh` in the style of chapter 01: `nvcc -O3 -arch=native -lineinfo -std=c++17 -o out/$1 src/$1.cu`, plus any extra flags after the name. `-arch=native` compiles for the card in the machine.

1. `src/check.h`: `CHECK(call)` prints file, line and `cudaGetErrorString` and exits on any error. `CHECK_LAUNCH()` calls `CHECK(cudaGetLastError())`, and in builds with `-DSYNC_CHECK` also `CHECK(cudaDeviceSynchronize())`, so a debug build reports a kernel's error at its own launch.
2. `src/vadd.cu`: vector add with `n` from the command line, random inputs, a CPU loop as the oracle, exact comparison. Run n = 1, 31, 32, 33, 255, 256, 257, 1000003 and 16777216. Skip the launch when n is 0, then try launching zero blocks once and record what `CHECK_LAUNCH` says.
3. `src/saxpy.cu`: `y[i] = a * x[i] + y[i]`. Compare first against `a * x[i] + y[i]` computed on the CPU, then against `fmaf(a, x[i], y[i])`. `nvcc` contracts a multiply followed by an add into one fused multiply-add by default, which rounds once instead of twice. Find which CPU version matches exactly, then build with `-fmad=false` and check again. Print a mismatching pair with `%a`, as in chapter 04's float step, to see that they differ in the last bit.
4. `src/grid2d.cu`: CUDA C versions of puzzles 4 to 7 with `dim3` blocks of 16 by 16 and two-dimensional indices, for rows by columns of 1 x 1, 1 x 1000, 1000 x 1, 999 x 777 and 4096 x 4096, each checked against a CPU loop.
5. Break things on purpose. Remove the bounds check from `vadd` and run n = 1000 plainly, then under `compute-sanitizer`. Launch `vadd` with 4096 threads per block. Pass `cudaMemcpy` a size one element larger than the allocation. Record what reports each mistake, and where.

### Done when

Every size passes in `vadd`, `saxpy` and `grid2d`, and `compute-sanitizer` prints `ERROR SUMMARY: 0 errors` for each correct program. Without the bounds check, the plain run may look correct, and the sanitizer reports an invalid `__global__` write at the source line of the store. You can say which of your three CPU oracles `saxpy` matches with and without `-fmad=false`, and why. You can say why the out-of-bounds write is reported at the synchronize and not at the launch.

## Memory bandwidth, coalescing and the profiler

Your step 2 kernels are correct, and nothing yet tells you how fast they are or how fast they could be. Chapter 07 measured your Mac's DRAM bandwidth with a read loop. The GPU version of that loop is a copy kernel: each thread loads one float and stores it elsewhere. Effective bandwidth is the bytes the kernel reads plus the bytes it writes, divided by its time. The theoretical peak comes from the memory clock and bus width in `deviceQuery`, doubled for double data rate. Check that number against the memory bandwidth on NVIDIA's spec page for your card. The two should agree.

Time kernels with CUDA events. An event is a marker in the GPU's command stream that records a timestamp when the GPU reaches it, so the time between two events covers only the GPU work between them. Do a warmup launch first. The first launch in a process pays for loading the module and waking the card. Then take the best of several runs, as with chapter 07's repetition tester.

Under WSL2 every launch and every event record travels from Ubuntu through `/dev/dxg` and VMBus to the driver in Windows. Raphael Boissel and Arthy Sundaram of NVIDIA name that launch latency as one of the leading causes of slowdowns against native Linux, in their post "Leveling up CUDA Performance on WSL2 with New Enhancements". On a Blender benchmark with long-running kernels they measured WSL2 within 1 percent of native Linux. They also explain that the gap grows as the work per launch shrinks toward the launch latency. Your step 3 kernels move hundreds of megabytes per launch, so the crossing does not show in their times. When a kernel runs for only microseconds, time a loop of many launches between one pair of events and divide. The same post recommends hardware-accelerated GPU scheduling for WSL2. Turn it on in Windows under Settings, System, Display, Graphics, if your GPU and driver offer it.

The memory system serves a warp's loads in 32-byte sectors. When 32 threads load 32 consecutive floats, the warp touches 128 bytes, four sectors, and every fetched byte is used. When thread i loads element 32 * i, each thread touches its own sector, the warp moves 1024 bytes to use 128, and bandwidth drops to an eighth. This is the struct-of-arrays argument from chapter 07, applied to the 32 lanes of a warp. Neighboring threads should touch neighboring addresses.

```
  coalesced: thread t reads a[t]         strided: thread t reads a[32*t]

  t0 t1 t2 ... t31                       t0          t1          t2
  |  |  |      |                         |           |           |
  [ sector ][ sector ][ sector ][ sector ]   [ sector ] ... [ sector ] ... 32 sectors
  4 sectors, 128 bytes used of 128       32 sectors, 128 bytes used of 1024
```

Copies between host and device go over PCIe, which is far slower than the card's own memory. Host memory from `malloc` is pageable, which means the operating system may move it. Pinned memory, from `cudaMallocHost` as in the guide's 2.1 example, stays in place, and the Best Practices guide reports that it transfers at the highest rate. NVIDIA's WSL guide lists pinned memory as limited under WSL2, without a number. If a `cudaMallocHost` of 256 MiB fails, your `CHECK` says so. Halve the size and write that down. NVIDIA publishes no WSL2 figures for host transfers, so your pinned and pageable rates are the only ones you can compare.

Nsight Compute, `ncu`, replays a kernel many times with hardware counters attached. `ncu --set full -o rep ./out/bw` writes a report, and `ncu-ui rep.ncu-rep` opens it. The Memory Workload Analysis section shows the memory chart and tables, and the Sectors/Req column in the tables gives the number of sectors one warp-wide load touched: 4 for the coalesced copy and 32 for the worst stride. `ncu` fixes the clocks and flushes the caches before each replay, so its durations differ from your event timings. Take timings from events and use `ncu` to find the cause of a number. Nsight Compute supports profiling under WSL2 on Windows 11 with display driver 525 or newer, and on Windows 10 build 19044 or newer with driver 545 or newer. Reading GPU performance counters needs permission. On native Linux you would use `sudo`. Under WSL2 the Profiling Guide says access must be enabled on the Windows host, so turn it on there once and then run `ncu` as your normal user. The `ERR_NVGPUCTRPERM` entry in the guide's FAQ links NVIDIA's page with the Windows steps. In the NVIDIA App the switch is under System, Advanced, Developer, Manage GPU Performance Counters, set to allow all users. Older drivers have the same switch in the NVIDIA Control Panel: tick Desktop, Enable Developer Settings, then choose Developer, Manage GPU Performance Counters. Both need Windows administrator rights. Without the switch, `ncu` stops with `ERR_NVGPUCTRPERM`.

`ncu-ui` is a Qt program. WSL2 shows Linux GUI programs on the Windows desktop, and the Nsight Compute release notes list the packages it needs on Ubuntu 24.04 under WSL2: `sudo apt install libopengl0 libxcb-icccm4 libxcb-keysyms1 libxcb-cursor0 libxcb-shape0 libxkbcommon-x11-0 libnss3`. If the window still does not open, `ncu --import rep.ncu-rep` prints the same sections as text.

### Study

- [CUDA C++ Best Practices Guide: Performance Metrics](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#performance-metrics) (read, 45 min): 9.1 "Timing" with 9.1.2 "Using CUDA GPU Timers", 9.2.1 "Theoretical Bandwidth Calculation" and 9.2.2 "Effective Bandwidth Calculation". Skip 9.2.3, which describes the older Visual Profiler. Then in chapter 10 read 10.1 "Data Transfer Between Host and Device" through 10.1.1 "Pinned Memory", and 10.2.1 "Coalesced Access to Global Memory" with 10.2.1.1 to 10.2.1.4. The `offsetCopy` and `strideCopy` kernels there are the ones you write below.
- [Nsight Compute CLI](https://docs.nvidia.com/nsight-compute/NsightComputeCli/index.html) (reference, as needed): 5.2 "Quickstart", then the command line options as you need them, such as `--set`, `-o` and `--kernel-name`.
- [Nsight Compute Profiling Guide](https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html) (reference, as needed): 2.2.1 "Sets and Sections", 2.6.2 "Clock Control", 2.6.3 "Cache Control", 2.10 "Memory Chart" and 2.11 "Memory Tables", and the `ERR_NVGPUCTRPERM` entry in 2.12 "FAQ" with the NVIDIA page it links, whose "Windows" steps are the ones you need. Keep 2.9 "Roofline Charts" for step 4.

### Build

`src/bw.cu`, run on the laptop plugged in, with all results written as CSV and plotted with matplotlib:

1. A timing helper: warmup launch, then 20 timed launches between CUDA events, return the best. Use it for everything below.
2. `copy` over two buffers of 64 Mi floats each (256 MiB per buffer). Print effective GB/s and the ratio to the theoretical peak from `deviceQuery`. Add a `fill` kernel that only writes and a `read` kernel that only loads, adding each value into a per-thread register that it stores once at the end. Compare all three, and compare with the DRAM bandwidth you measured on the Mac in chapter 07.
3. `offsetCopy` for offsets 0 to 32 and `strideCopy` for strides 1 to 32, as in the Best Practices guide. Plot GB/s against offset and against stride.
4. Profile `copy`, `strideCopy` with stride 2 and `strideCopy` with stride 32 under `ncu`. Record Sectors/Req for global loads and the DRAM throughput for each.
5. Host transfers: time `cudaMemcpy` of 256 MiB host to device and back, from `malloc` memory and from `cudaMallocHost` memory, with half the size for both if the pinned allocation fails. Time a `vadd` of 64 Mi elements including its three transfers and without them. Write down what fraction of the total the kernel is.

### Done when

The copy kernel reaches at least 70 percent of the theoretical bandwidth, or you can explain the gap with the `ncu` DRAM throughput. Your stride plot falls as the stride grows and flattens once each thread has its own sector, and the Sectors/Req values you recorded match that shape. You can explain the offset plot from the 32-byte sectors and the L2 cache, as the guide does for its V100 figure. You have the pinned and pageable transfer rates, and you can say from your `vadd` numbers why a single elementwise kernel is not worth moving to the GPU when its data starts on the host.

## Warps, occupancy and the roofline

Step 3 found the memory ceiling. This step finds the arithmetic ceiling and the number of warps it takes to reach either one. A fused multiply-add on an SM has a latency of several cycles before its result can feed the next instruction. A warp whose next instruction needs that result has to wait, and the SM issues from another warp. If every warp has one long dependency chain, the SM needs many warps to keep its units busy. If each thread has four independent chains, it needs fewer. That is the dependency-chain experiment from chapter 07. The Mac hid the wait by running later instructions of the same thread out of order. The GPU hides it by issuing from another warp.

Occupancy is the number of resident warps on an SM divided by the most it can hold. Three resources limit it: threads per block against the threads per SM, registers per thread against the SM's register file, and shared memory per block against the SM's shared memory. `nvcc --resource-usage` prints each kernel's registers and shared memory, so you can compute occupancy before you run anything. Higher occupancy hides more latency, but a kernel with enough independent work per thread reaches peak with fewer warps. The kernels in step 7 give each thread many registers and run fewer warps as a result.

Horace He's article sorts every deep learning workload into three regimes: compute-bound, memory-bound and overhead-bound. The roofline puts the first two on one plot. The x axis is arithmetic intensity, the floating-point operations a kernel does per byte it moves to or from DRAM. The y axis is achieved FLOP/s. A kernel below the ridge point, where the bandwidth line meets the peak line, cannot beat the bandwidth line however good its arithmetic is. Section 2.9 "Roofline Charts" of the Profiling Guide from step 3 shows how `ncu` draws the same chart for a profiled kernel.

```
  FLOP/s (log)
     |                       ________________  peak FP32 (step 4)
     |                     /
     |                   /   ridge = peak FLOP/s / peak bytes/s
     |                 /
     |               /   slope = DRAM bandwidth (step 3)
     |   copy *    /
     +-----------------------------------------> FLOP per byte (log)
       memory-bound   |   compute-bound
```

The CS149 lecture on GPU architecture, from the Stanford course you used in chapter 09, walks one kernel through a GPU block by block: what each block needs, which SM takes it, and when the next block can start. It also draws the inside of an SM, with four warp schedulers and their 32-lane units. The slides compare warps with ISPC gangs. ISPC is a SIMD compiler that this book has not used, and a gang is the group of program instances that share one vector register, like the lanes of a NEON register.

### Study

- [Stanford CS149 Fall 2025: GPU Architecture and CUDA Programming (slides)](https://gfxcourses.stanford.edu/cs149/fall25content/media/gpuarch/07_gpuarch.pdf#page=35) (read, 1 h 15 min): Slides 35 to 72. Slides 35 to 43 write the 1D convolution kernel and show what the compiled binary records about its resources. Slides 45 to 54 build the V100 SM and the whole chip. Slides 55 to 65 run the kernel on a small GPU, and 66 to 72 ask the scheduling questions that show why blocks may not wait on each other. Shared memory and `__syncthreads()` appear in slides 36 to 43 and 55 to 65. Read those slides for the scheduling, and expect the details in step 5. Slides 1 to 34 are history and the CUDA syntax you already have.
- [CUDA Programming Guide: 2.3.7 Kernel Launch and Occupancy](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html#kernel-launch-and-occupancy) (read, 15 min): The whole section, with its worked limits for blocks of 768 and of 32 threads.
- [Horace He: Making Deep Learning Go Brrrr From First Principles](https://horace.io/brrr_intro.html) (read, 40 min): The whole article. "Compute", "Bandwidth" with "Reasoning about Memory-Bandwidth Costs", and "Overhead". The experiment that raises compute intensity by repeating an operation is the one you write in CUDA below.

### Build

1. `src/fma.cu`: each thread runs a loop of 4096 iterations of `x = fmaf(x, a, b)` on C independent accumulators, C = 1, 2, 4 and 8, and stores their sum once so the compiler keeps the work. Launch blocks of 32, 64, 128, 256, 512 and 1024 threads, with the number of blocks equal to the SM count times 1, 2, 4, 8 and 16. Print GFLOP/s, counting 2 per FMA, as a fraction of the peak you computed in step 1. Watch the SM clock with `nvidia-smi -q -d CLOCK` while the largest configuration runs. NVIDIA's WSL guide does not say whether this query works under WSL2. If the clock lines read N/A, profile that configuration once with `ncu --clock-control none`, which leaves the clocks as the driver set them, and read the SM Frequency that `ncu` reports.
2. Compile `fma.cu` with `--resource-usage`. For three of your configurations, compute the theoretical occupancy by hand with the 2.3.7 method, then compare it with the theoretical and achieved occupancy in `ncu`'s Occupancy section.
3. `src/intensity.cu`: Horace He's experiment. Each thread loads one float, applies R fused multiply-adds to it, and stores it, for R = 1, 2, 4 and so on up to 1024. Compute FLOP per byte and GFLOP/s for each R and plot them on log axes together with the two rooflines from your measured peaks, the copy bandwidth from step 3 and the best `fma` rate from item 1. Mark the ridge point.
4. `src/diverge.cu`: a kernel with two branches of equal cost, chosen once by `threadIdx.x % 2` and once by `(threadIdx.x / 32) % 2`. Time both, and time a version without the branch.

### Done when

Your best `fma` configuration reaches at least 80 percent of the peak FP32 rate, or you can explain the gap from the SM clock you recorded during the run. You can name the smallest number of warps per SM, for C = 1 and for C = 4, at which the rate stops rising, and explain the difference with latency and independent chains. Your hand occupancy matches `ncu`'s theoretical occupancy. The intensity plot bends at the ridge point you computed. You can say why splitting branches by warp costs nothing and splitting them by thread doubles the time.

## Shared memory, barriers and reductions

Every kernel so far had threads that never talked to each other. Shared memory changes that. It is on-chip memory that each block allocates for itself and all of the block's threads can read and write. It lives in the same on-chip storage as the L1 cache. You fill it and you decide what stays in it. Chapter 07's caches made that decision for you.

Threads that share data need a barrier. `__syncthreads()` waits until every thread of the block that has not exited reaches it. It also orders memory: everything a thread wrote before the call is visible to every thread of the block after it. That is chapter 09's release and acquire pair, applied to the whole block at once. Two rules come with it. Every thread of the block that has not exited must reach the same `__syncthreads()` call, so the call must not sit inside a branch that some of them skip. And a write by one thread and a read of the same location by another always need a synchronization between them: `__syncthreads()`, or `__syncwarp()` when both threads are in the same warp.

Shared memory is split into 32 banks of 4 bytes. Consecutive 32-bit words go to consecutive banks. When two threads of a warp access different words in the same bank, the accesses take turns. A 32 by 32 float tile read by column puts all 32 threads in one bank. Padding each row to 33 floats moves each row's start to the next bank and removes the conflict. The guide's matrix transpose example shows both the coalescing fix and the padding fix.

A reduction is the first algorithm that needs all of this. Summing n numbers with n threads takes log2 of the block size rounds inside a block. In each round half of the remaining threads add a partner's value to their own. A barrier separates the rounds.

```
  shared:  s0  s1  s2  s3  s4  s5  s6  s7        block of 8 threads
  stride 4: s0+=s4  s1+=s5  s2+=s6  s3+=s7         __syncthreads()
  stride 2: s0+=s2  s1+=s3                         __syncthreads()
  stride 1: s0+=s1                                 s0 holds the block's sum
```

The last five rounds happen inside one warp. Warp shuffle functions let threads of a warp read each other's registers without shared memory: `__shfl_down_sync(0xffffffff, v, 16)` gives each lane the value of the lane 16 above it. The first argument is a mask that names the lanes taking part. Older code skipped the barrier in the last rounds and assumed that a warp runs in lockstep. GPUs since Volta schedule each thread independently, and the blog post below shows how that assumption breaks. Use the `_sync` functions.

Each block produces one partial sum. A second level combines them. The simplest way is one atomic add per block into a single global result. CS149's slides write it as `atomicAdd(&result, v)`, and the guide's 2.3.5 writes the same operation with `cuda::atomic_ref` and `fetch_add`. Either spelling works. The other way is a second kernel launch that reduces the partial sums. Make each thread first add up many elements in a grid-stride loop, `for (i = start; i < n; i += gridDim.x * blockDim.x)`, so that a fixed grid of a few blocks per SM handles any n.

Floating-point addition is not associative, so a GPU sum differs from a sequential CPU sum in the last bits, and differs again when you change the block size. State the error policy before you test. Use inputs that sum exactly first, then random inputs compared against a sum in double with a tolerance you can justify.

Compute Sanitizer has two tools for this step. Racecheck reports shared-memory accesses from different threads with no barrier between them. It only watches shared memory, while TSan in chapter 09 watched everything. Synccheck reports a `__syncthreads()` that some threads of a block skipped. The Racecheck and Synccheck sections of the Compute Sanitizer documentation from step 2 show how to run each tool and how to read its reports.

### Study

- [CUDA Programming Guide: 2.3 Writing SIMT Kernels](https://docs.nvidia.com/cuda/cuda-programming-guide/02-basics/writing-cuda-kernels.html#thread-block-synchronization) (read, 1 h 15 min): 2.3.2.1 "Thread Block Synchronization", 2.3.3.2 "Shared Memory" with static and dynamic allocation, 2.3.3.3 "Registers" and 2.3.3.4 "Local Memory", then 2.3.4 "Memory Performance" in full, with both matrix transpose examples and 2.3.4.2.2 "Shared Memory Bank Conflicts". Finish with 2.3.5 "Atomics" up to the Python part. Skip 2.3.3.5 to 2.3.3.8 and 2.3.6.
- [GPU Puzzles](https://github.com/srush/GPU-Puzzles) (do, 3 h): Puzzles 8 to 13, Shared to Axis Sum, in the same Colab notebook. Puzzle 12, "Prefix Sum", is the tree reduction drawn above, and Puzzle 13 sums along one axis of a matrix. Stop before Puzzle 14.
- [Yuan Lin and Vinod Grover: Using CUDA Warp-Level Primitives](https://developer.nvidia.com/blog/using-cuda-warp-level-primitives/) (read, 40 min): The whole post, by two NVIDIA compiler engineers. Listing 1 is the warp reduction you write below, and "Implicit Warp-Synchronous Programming is Unsafe" explains why your code passes a mask. Skip the "AI-Generated Summary" box at the top of the page.

### Build

1. `src/transpose.cu`: transpose of a 4096 x 4096 float matrix, and of 4095 x 4097, in three versions: naive, through a 32 by 32 shared tile, and through a 32 by 33 tile. Report GB/s against your copy kernel from step 3, and the shared-memory bank conflicts `ncu` reports for the two tiled versions.
2. `src/reduce.cu`, sum of n floats, in four versions: (a) every thread does `atomicAdd` on one global float, (b) a shared-memory tree per block with one `atomicAdd` per block, (c) the tree down to 32 values, then `__shfl_down_sync` for the last five rounds, (d) version c with a grid-stride loop and a grid of a few blocks per SM. Use n = 1, 31, 33, 1000, 1000003 and 2^26.
3. Tests for every version: inputs `(float)(i % 7)` with n up to 2^21, where every partial sum is an integer below 2^24 and the result must be exact. Then uniform random inputs in [-1, 1] against a CPU sum in double, with the rule `|gpu - ref| <= 1e-5 * sum of |x[i]|`. Write in a comment why 1e-5 is safe for versions b to d, whose sums form a tree of depth 26 in float. Version a is a chain of 2^26 adds in arbitrary order, and its worst-case bound is far above 1e-5. Add a one-line note that version a passes only because random rounding errors tend to cancel.
4. Report GB/s for each version at n = 2^26 against your copy bandwidth.
5. Break it on purpose: delete one `__syncthreads()` from version b and run `compute-sanitizer --tool racecheck`. Move a `__syncthreads()` inside `if (tid < s)` and run `--tool synccheck`. Record both reports.
6. `src/rowstats.cu`: for an M x N matrix, one block per row computes the row maximum and the row sum, using the warp and shared-memory pattern from version c. Test N = 1, 31, 32, 33, 1000 and 50257, with M = 1000. Step 9 builds on this kernel.

### Done when

Every reduction passes the exact test and the tolerance test for every n. The best version reaches at least 70 percent of your copy bandwidth at 2^26, and you have the GB/s of all four versions in a table. The padded transpose shows no bank conflicts in `ncu` and runs faster than the unpadded one. Racecheck and synccheck each report your deliberate bug, and both report nothing for the correct code. `rowstats` matches a CPU loop for every shape.

## Matrix multiply: naive, coalesced and tiled

The project starts here. It puts the ceilings from steps 3 and 4 and the shared memory from step 5 to work on one operation. `C = A x B` with A of size M x K, B of size K x N, all row-major floats, takes 2MNK floating-point operations. The minimum traffic is reading A and B once and writing C once. For square 4096 matrices that is about 137 GFLOP against 201 MB, an arithmetic intensity far above the ridge point from step 4. Matrix multiply can be compute-bound. A naive kernel is nowhere near it, because each thread reads a whole row of A and a whole column of B from DRAM, and every input element is read N or M times.

Tiling fixes that. A block loads a tile of A and a tile of B into shared memory, every thread of the block uses those tiles for its partial dot products, and the block moves to the next tiles along K. Each element read from DRAM is now used by a whole tile's worth of threads.

```
  C tile (row block bm, column block bn), BS x BS threads, one output each:

  for k0 in 0, BS, 2*BS, ... < K:
      As[ty][tx] = A[bm*BS + ty][k0 + tx]     coalesced along a row of A, 0 outside
      Bs[ty][tx] = B[k0 + ty][bn*BS + tx]     coalesced along a row of B, 0 outside
      __syncthreads()                         tiles complete
      for k in 0 .. BS-1:  acc += As[ty][k] * Bs[k][tx]
      __syncthreads()                         nobody overwrites a tile still in use
  if inside C: C[bm*BS + ty][bn*BS + tx] = acc
```

Simon Boehm's worklog takes one kernel from naive to within a few percent of cuBLAS in ten versions, and measures each one with `ncu`. This step covers the first three, the next step the rest. Boehm's kernels assume that M, N and K are multiples of the tile size. Yours must handle any shape. Load zeros for tile elements outside A or B, and skip the store for outputs outside C. Boehm's code uses templates with integer parameters, `template <const int BLOCKSIZE> __global__ void k(...)`, launched as `k<32><<<grid, block>>>(...)`. Chapter 19's templates took a type. These take a number. They work like the associated constant `WIDTH` on your chapter 10 `GroupMatch` trait. The value is fixed at compile time, so the compiler can unroll loops over it and size arrays with it.

cuBLAS is NVIDIA's matrix library and your reference. It stores matrices column-major, as Fortran does. A row-major C = A x B is the column-major product C^T = B^T x A^T. You get it from `cublasSgemm` by passing B before A and swapping M and N: `cublasSgemm(h, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &one, dB, N, dA, K, &zero, dC, N)`. Leave the math mode at `CUBLAS_DEFAULT_MATH`. For `cublasSgemm` it keeps full FP32 precision, so the comparison stays fair. Link with `-lcublas`.

The error policy for matrix multiply comes from how float dot products round. Computed in float, each entry of C can be off from the exact value by roughly K times the float rounding unit 2^-24, times the dot product of the absolute values of its row and column. Compute a reference in double on the CPU and accept `|c - ref| <= 2 * K * 2^-24 * (|A| x |B|)` for each entry, with `|A| x |B|` computed in double too. A full double reference at 4096 cubed takes minutes on the CPU, so check every entry for small shapes and 2000 random entries for large ones.

### Study

- [Simon Boehm: How to Optimize a CUDA Matmul Kernel for cuBLAS-like Performance](https://siboehm.com/articles/22/CUDA-MMM) (read, 1 h 15 min): The introduction, "Kernel 1: Naive Implementation" with both subsections, "Kernel 2: Global Memory Coalescing", and "Kernel 3: Shared Memory Cache-Blocking" with "Occupancy Calculation for Kernel 3". His numbers come from an RTX A6000, so compare ratios to cuBLAS and not absolute GFLOP/s. The code for every kernel is in the repository linked near the top. Open a kernel there only after yours passes its tests.
- [GPU Puzzles](https://github.com/srush/GPU-Puzzles) (do, 1 h): Puzzle 14, Matrix Multiply. Do the single-block case first, then the tiled case with its limit of global reads.
- [cuBLAS documentation](https://docs.nvidia.com/cuda/cublas/index.html#data-layout) (reference, as needed): 1.1 "Data Layout", 2.7.1 "cublas<t>gemm()", 2.4.22 "cublasSetMathMode()" with 2.2.10 "cublasMath_t". Step 8 uses 2.8.12 "cublasGemmEx()" and 2.1.11 "Tensor Core Usage".

### Build

1. `src/mm.cu`: a harness that creates random A and B in [-1, 1], runs a chosen kernel, checks C under the policy above, and reports the median time over 10 runs and GFLOP/s. Shapes: square 128, 256, 512, 1024, 2048 and 4096, and the irregular (M, N, K) = (1000, 777, 333), (1, 4096, 4096), (4096, 1, 4096), (4097, 129, 65) and (33, 33, 1).
2. Kernel 0 is `cublasSgemm` as above. Its result goes through the same policy check as yours.
3. Kernel 1: Boehm's naive kernel, which maps consecutive threads to consecutive rows of C. Kernel 2: the coalesced mapping, consecutive threads to consecutive columns. Kernel 3: the shared-memory tile with BS = 32, with the zero-fill bounds rules.
4. Profile kernels 1, 2 and 3 at 4096 with `ncu`. Record DRAM bytes moved, Sectors/Req for global loads, shared-memory bank conflicts and achieved occupancy. If the TDR limit kills kernel 1 at 4096, in the timed run or under `ncu`, use 2048 for that kernel and mark the row.
5. Run kernel 3 under `compute-sanitizer --tool racecheck` at (1000, 777, 333).

### Done when

All kernels, cuBLAS included, pass the policy on every shape. You have a table of GFLOP/s and percent of cuBLAS for kernels 1 to 3 at 4096, or 2048 where TDR forced it, kept in `notes/matmul.md` for the rest of the project. You can explain the step from kernel 1 to 2 with the Sectors/Req you recorded, and the step from 2 to 3 with the DRAM bytes. Racecheck reports no hazards. You can say how far kernel 3 is from cuBLAS and which resource `ncu` says it waits on.

## Register tiling, vector loads and SASS

Kernel 3 does one FMA for every two shared-memory loads. Shared-memory loads have their own bandwidth limit, and kernel 3 runs into it. The fix is the move that every fast matrix multiply makes: each thread computes several outputs, keeps them in registers, and reuses each value it loads from shared memory several times. With a TM by TN block of outputs per thread, one pass over k loads TM values of A and TN values of B and does TM times TN FMAs. That raises the arithmetic intensity of shared memory the way tiling raised it for DRAM.

```
  per thread, per k:             regA[0..TM-1]  = column k of the A tile (TM loads)
                                 regB[0..TN-1]  = row k of the B tile    (TN loads)
                                 acc[i][j] += regA[i] * regB[j]          (TM*TN FMAs)
  TM = TN = 8: 16 loads for 64 FMAs, against 2 loads per FMA in kernel 3
```

Boehm continues with 1D and then 2D blocktiling, then vectorized loads with `float4`, then a search over tile sizes, then warptiling, which adds a level for each warp's share of the block tile. `float4` loads need 16-byte alignment. That holds when the row length is a multiple of 4 and the base pointer is aligned, which `cudaMalloc` gives you. For irregular shapes, copy A and B into zero-padded buffers whose sizes are multiples of the tile sizes, run the kernel, and copy the M x N part of C back out. Time the padding separately.

Now you read what the compiler made. `cuobjdump -sass out/mm` prints SASS, the GPU's real machine code, the way `objdump -d` printed ARM64 in chapter 05. The compiler goes through PTX, a virtual instruction set, on the way. Look for `FFMA` (fused multiply-add), `LDS` (shared-memory load), `LDG` (global load) and their `.128` forms for vector loads. `LDL` and `STL` are loads and stores to local memory. Local memory is per-thread memory in DRAM that the compiler uses for spilled registers. An `LDL` or `STL` inside an inner loop is enough to make a kernel slow. The instruction tables in chapter 4 of the CUDA Binary Utilities list every SASS opcode for your architecture.

### Study

- [Simon Boehm: How to Optimize a CUDA Matmul Kernel](https://siboehm.com/articles/22/CUDA-MMM#kernel-4-1d-blocktiling-for-calculating-multiple-results-per-thread) (read, 2 h): Kernel 4 with "Sidenote on Compiler Optimizations" and "Areas of Improvement: Arithmetic Intensity", Kernel 5, Kernel 6, "Kernel 9: Autotuning", "Kernel 10: Warptiling" and the "Conclusion". Skip "Work in Progress: Kernel 11".
- [CUDA Binary Utilities](https://docs.nvidia.com/cuda/cuda-binary-utilities/index.html#cuobjdump) (reference, as needed): 2 "cuobjdump" with 2.1.1 "Dumping SASS, ELF, and PTX" and 2.1.3 "Resource Usage Information", then 4 "Instruction Set Reference" for your architecture: Turing, or Ampere and Ada.

### Build

1. Add Boehm's kernels 4 (1D blocktiling), 5 (2D blocktiling) and 6 (vectorized loads) to `mm.cu`, written by you, with tile sizes as template parameters and the padding path for irregular shapes. Every kernel passes the step 6 policy on every shape before you time it.
2. An autotuner in the style of kernel 9: a script that builds kernel 6 for a grid of BM, BN, BK, TM and TN values that fit your card's shared memory and register limits, runs each at 4096, and keeps the fastest. Record the winning values. They will differ from Boehm's, because your card differs.
3. For kernels 3, 5 and 6, find the inner loop in `cuobjdump -sass` output and count `FFMA` against `LDS` instructions per iteration. Check for `LDL` and `STL`. Run `cuobjdump -res-usage` for registers per thread.
4. Extend the table in `notes/matmul.md` with kernels 4 to 6 and the tuned kernel: GFLOP/s at 1024, 2048 and 4096, percent of cuBLAS, registers per thread, achieved occupancy, and the FFMA to LDS ratio.
5. Stretch: kernel 10, warptiling.

### Done when

Every kernel passes the policy on every shape. Your best kernel reaches at least 50 percent of `cublasSgemm` at 4096, and 80 percent is the stretch. You can explain each row of the table from one change in the kernel and one number from `ncu` or the SASS. You can point at the `FFMA` and `LDS.128` instructions in the inner loop of kernel 6, and you can say whether any of your kernels spill registers.

## Tensor cores

Every kernel in step 7 is bounded by the FP32 peak you measured in step 4. Tensor cores raise that ceiling. Since Volta, each SM also has tensor cores: units that multiply small matrices in one operation. A warp hands the tensor cores a 16 by 16 tile of A, a 16 by 16 tile of B and a 16 by 16 accumulator, and gets back D = A x B + C. The inputs are half precision and the accumulator is float. One such operation does 8192 floating-point operations, and the rate is several times the FP32 rate of the same card.

CUDA exposes them through the warp matrix functions in `nvcuda::wmma`. A fragment holds one tile, spread across the registers of the 32 threads of a warp in a layout the guide leaves unspecified. You never index a fragment element by position. You load a fragment from memory with `load_matrix_sync`, multiply with `mma_sync`, and store with `store_matrix_sync`. Every call is made by all 32 threads of the warp together, so all of them must reach it.

```
  one warp, one 16x16 tile of C:

  wmma::fragment<wmma::matrix_a, 16, 16, 16, half, wmma::row_major> a;
  wmma::fragment<wmma::matrix_b, 16, 16, 16, half, wmma::row_major> b;
  wmma::fragment<wmma::accumulator, 16, 16, 16, float> acc;
  wmma::fill_fragment(acc, 0.0f);
  for k0 in 0, 16, 32, ... < K:
      wmma::load_matrix_sync(a, A + row0*K + k0, K);     leading dimension K
      wmma::load_matrix_sync(b, B + k0*N + col0, N);     leading dimension N
      wmma::mma_sync(acc, a, b, acc);
  wmma::store_matrix_sync(C + row0*N + col0, acc, N, wmma::mem_row_major);
```

Half precision is the float format of chapter 04 with a 5-bit exponent and a 10-bit fraction: an 11-bit significand and a largest finite value of 65504. bf16 needs compute capability 8.0, the RTX 30 series, and keeps the exponent range of float. On an RTX 20 card use half. Two 11-bit significands multiply into at most 22 bits, which fit in float's 24, so each product is exact before accumulation. Round the inputs with `__float2half` from `cuda_fp16.h`, which runs on the host as well as the device, and compute the reference in double from the rounded values, read back with `__half2float`. Then every remaining error comes from the accumulation, and the step 6 policy applies. The guide does not promise that tensor cores round each partial sum the way an FFMA does, so if an entry fails, record by how much before you change the policy.

The first kernel is the naive one from the Appleyard and Yokim post: one warp per 16 by 16 tile of C, reading straight from global memory. It is still far from the hardware, for the reason kernels 1 and 2 were slow in step 6: no loaded value is reused. The second kernel applies steps 6 and 7 again. A block stages tiles of A and B in shared memory, and each warp computes several 16 by 16 output tiles from them, which reuses every loaded fragment.

### Study

- [CUDA Programming Guide: 5.4.11 Warp Matrix Functions](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/cpp-language-extensions.html#warp-matrix-functions) (read, 30 min): 5.4.11.1 "Description", 5.4.11.5 "Restrictions", 5.4.11.6 "Element Types and Matrix Sizes" and 5.4.11.7 "Example". Read 5.4.11.2 "Alternate Floating Point" only if your card has compute capability 8.0 or higher. Skip 5.4.11.3 and 5.4.11.4.
- [CUDA Math API: Half Precision Conversion and Data Movement](https://docs.nvidia.com/cuda/cuda-math-api/cuda_math_api/group__CUDA__MATH____HALF__MISC.html) (reference, as needed): `__float2half` and `__half2float`, both marked `__host__ __device__`, and the round-to-nearest-even note on each.
- [Jeremy Appleyard and Scott Yokim: Programming Tensor Cores in CUDA 9](https://developer.nvidia.com/blog/programming-tensor-cores-cuda-9/) (read, 15 min): "Programmatic access to Tensor Cores in CUDA 9.0" through "Finishing up" only. The guide's 5.4.11.7 example multiplies a single tile. This section adds the loop over K with one warp per output tile, which is your kernel H1. Their example is column-major. Yours is row-major, so the layouts in your fragments and loads differ. Skip everything else on the page, including the "AI-Generated Summary" box and the cuBLAS and cuDNN sections, which use a mode cuBLAS has since deprecated.

### Build

1. `src/mmh.cu`: the step 6 harness for half inputs and float output. Round the random inputs to half on the host with `__float2half`, keep both copies, and compute the reference from the half values in double. Shapes: square 256 to 4096, plus (4096, 4096, 1024) and (1000, 777, 336). For shapes that are not multiples of 16, pad as in step 7.
2. Reference: `cublasGemmEx` with `CUDA_R_16F` for A and B, `CUDA_R_32F` for C and `CUBLAS_COMPUTE_32F`, using the row-major argument swap from step 6. Check it against the policy too.
3. Kernel H1: one warp per 16 by 16 output tile, fragments loaded from global memory.
4. Kernel H2: a block of 4 or 8 warps computes a 64 by 64 or 128 by 128 tile of C. Tiles of A and B go through shared memory, and each warp computes a 2 by 2 or 4 by 2 group of 16 by 16 tiles. Pad shared-memory rows to avoid bank conflicts, and keep fragment pointers aligned to 256 bits as 5.4.11.1 requires.
5. Find the `HMMA` instructions in the SASS of H1 and H2. In `ncu`, look at the Tensor Core roofline in the Speed Of Light section, read the way 2.9 "Roofline Charts" in the Profiling Guide from step 3 describes.
6. Add both kernels and `cublasGemmEx` to `notes/matmul.md`, in TFLOP/s next to your best FP32 kernel and `cublasSgemm`.

### Done when

H1, H2 and `cublasGemmEx` pass the policy on every shape, or you have recorded the size of every failure relative to the bound. H2 beats H1, and H2 beats your best FP32 kernel at 4096. You can say what fraction of `cublasGemmEx` H2 reaches and name the next change that would close the gap. You can explain why a fragment must be loaded and stored by the whole warp.

## A fused softmax kernel

Matrix multiply does enough arithmetic per byte to sit right of the ridge point from step 4. The second kernel of the project sits left of it. Softmax of a row x is `exp(x[i] - m) / sum_j exp(x[j] - m)`, where m is the row's maximum. Subtracting m keeps every exponent at or below zero, so nothing overflows, and the result does not change. Each output needs the maximum and the sum of the whole row, which makes softmax two reductions followed by an elementwise pass. In PyTorch written out by hand, as `(x - x.max(1)).exp() / ...`, each operation is a separate kernel that reads and writes the whole matrix. Horace He's bandwidth section counts the cost of that. A fused kernel reads each row from DRAM once or twice and writes it once. Softmax does a handful of operations per byte, so it is memory-bound, and your target is the copy bandwidth from step 3.

Your `rowstats` kernel from step 5 already computes the maximum and the sum per row. The plain fused kernel does three passes over the row inside one block: maximum, then the sum of `exp(x - m)`, then the outputs. The online normalizer from Milakov and Gimelshein merges the first two passes. Keep a running maximum m and a running sum d. When a new element raises the maximum from m to m', the old sum was computed against the wrong maximum, and multiplying it by `exp(m - m')` corrects it:

```
  start: m = -inf, d = 0
  each x:  m' = max(m, x)
           d  = d * exp(m - m') + exp(x - m')
           m  = m'

  combine two partial results (m1, d1) and (m2, d2):
           m = max(m1, m2)
           d = d1 * exp(m1 - m) + d2 * exp(m2 - m)
```

The combine rule is associative, so it works as the operator of a tree reduction and of a warp shuffle reduction, the same way `+` did in step 5. Each thread runs the loop over its share of the row, then the block combines the pairs. FlashAttention applies this rescaling to whole tiles of attention scores and to a running weighted output. It never writes the full attention matrix to memory.

Decide the edge cases before writing the code. A row of `-inf`, which is what a fully masked attention row looks like, makes `exp(-inf - (-inf))` a NaN. Choose an output for it, zeros or NaN, write the choice down and test it. Inputs of 1e4 and -1e4 in one row must not overflow. A row of length 1 has the output 1.

PyTorch can call your kernel directly. `torch.utils.cpp_extension.load_inline` takes the CUDA source as a string plus a small C++ wrapper that takes and returns `torch::Tensor`, compiles them with `nvcc`, and imports the result as a Python module. Then you can compare against `torch.softmax(x, dim=-1)` on the same tensors and time both with `torch.cuda.Event(enable_timing=True)`, which wraps the CUDA events from step 3.

Andrej Karpathy's llm.c trains GPT-2 in plain C and CUDA. Its `dev/cuda` directory keeps every version of each kernel with a CPU reference and a benchmark. The softmax file goes from a one-thread-per-row port to warp reductions and the online normalizer, the same path you just took. Read it after your kernel works, and compare decisions.

### Study

- [Maxim Milakov and Natalia Gimelshein: Online normalizer calculation for softmax](https://arxiv.org/abs/1805.02867) (read, 45 min): The PDF, by two NVIDIA engineers. Sections 1 to 3 with Algorithms 1 to 3, the proof, and the parallel operator in equations 3 and 4. Skim 5 and 6 for their bandwidth argument and results. Skip section 4 on top-k.
- [Andrej Karpathy: llm.c, dev/cuda/softmax_forward.cu](https://github.com/karpathy/llm.c/blob/master/dev/cuda/softmax_forward.cu) (read, 1 h): The header comment, both CPU references, then `softmax_forward_kernel1` to `kernel4`, `softmax_forward_online_kernel1`, `online_kernel2` and `online_kernel8`. `online_kernel2` uses Cooperative Groups, an API on top of the warp functions you used. Read its reduction as a shuffle reduction. `kernel7` is optional.
- [PyTorch: torch.utils.cpp_extension.load_inline](https://docs.pytorch.org/docs/stable/cpp_extension.html#torch.utils.cpp_extension.load_inline) (reference, as needed): The signature, the example, and the arguments `cuda_sources`, `functions`, `extra_cuda_cflags` and `build_directory`. The description of `load` just above it explains the Ninja build and `CUDA_HOME`.

### Build

1. A Python environment in Ubuntu on the laptop for PyTorch. PyTorch's Linux wheels run there and use the `libcuda.so` from `/usr/lib/wsl/lib`. Make a venv and install PyTorch from the CUDA index that matches the toolkit's major version, `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu134` for CUDA 13, plus `pip install ninja`. `load_inline` writes a Ninja build file, so it fails without `ninja`. Run `python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"` and compare the version with `nvcc --version`. `torch.utils.cpp_extension` stops with an error when the two major versions differ and only warns when the minor versions differ. If the extension build cannot find `nvcc`, set `CUDA_HOME` to the toolkit directory you put on `PATH` in step 1, as the `load` description on the reference page advises.
2. `src/softmax.cu` with the step 5 harness style: a CPU reference in double, and three kernels over an M x N float matrix, one block per row: S1 with three passes, S2 with the online normalizer in one pass followed by the output pass, and S3, which is S2 with the row held in registers when N is small enough, so the row is read from DRAM once. Use `expf` and not `__expf` until all tests pass.
3. Test shapes N = 1, 31, 32, 33, 1000, 4096, 50257 and 100000 with M = 1000. Test the extreme rows: values of 1e4 and -1e4 mixed, a row with one `-inf`, and a fully `-inf` row with the output you chose. State an error policy for float outputs in [0, 1], start from `atol = 1e-6` and `rtol = 1e-5`, and write next to it why those values hold for N up to 100000.
4. Report GB/s for each kernel on a 4096 x 4096 input, counting one read and one write of the matrix, next to your copy bandwidth.
5. `py/softmax_ext.py`: load S2 with `load_inline`, run it on CUDA tensors, compare with `torch.softmax` under your policy for every shape above except the all `-inf` row, and time both with CUDA events at 4096 x 4096 and 1000 x 50257. Add `torch.compile(lambda x: torch.softmax(x, -1))` to the timing. `torch.compile` generates Triton kernels, so on a card below compute capability 8.0 it may fail. Record the error and leave that timing for step 10.
6. Read `softmax_forward.cu` and write in `notes/softmax.md` how each of its versions maps to yours. `online_kernel8` returns early when `tid >= C` and later calls `__shfl_down_sync` with a full mask. Say for which shapes that combination breaks the rule from the warp primitives post, and why the benchmark in the file never hits them.

### Done when

S1, S2 and S3 pass your policy on every shape, and the extreme rows produce what you wrote down. S2 or S3 reaches at least 70 percent of your copy bandwidth at 4096 x 4096. Your extension matches `torch.softmax`, and you have the three timings with a sentence each on why they differ. You can derive the combine rule for two partial (m, d) pairs on paper without looking.

## The same kernels in Triton

Every kernel you wrote made the same decisions by hand: which thread loads which element so that loads coalesce, what goes into shared memory and when the barrier comes, how many outputs each thread keeps in registers, when to use tensor cores. Triton is a language embedded in Python, with its own compiler, that takes over most of those decisions. A Triton program describes what one block does to whole tiles. `tl.load` of a block of pointers with a mask loads a tile, `tl.dot` multiplies two tiles, and `tl.max` and `tl.sum` reduce one. The compiler picks the thread mapping, stages data through shared memory, vectorizes loads, emits tensor core instructions and pipelines the loads of the next tile behind the math of this one. You still pick the tile sizes and the number of warps, or let its autotuner try a list of them.

The three tutorials map onto steps you have done. Vector add is your step 2 kernel with masks in place of the bounds check. The fused softmax tutorial is your S3 written in a dozen lines, and its launcher computes occupancy from the kernel's register count with the arithmetic from step 4. The matrix multiply tutorial is your H2 with an autotuner and one idea you have not used: it orders the blocks so that blocks running at the same time share tiles of A and B in the L2 cache. `torch.compile`, which you timed in step 9, generates Triton kernels on NVIDIA GPUs.

Triton's README lists NVIDIA GPUs of compute capability 8.0 and newer as supported, and Linux as its platform. It says nothing about WSL2. Triton installs as a Linux wheel in your Ubuntu environment and reaches the GPU through the same `libcuda.so` as your CUDA programs. On an RTX 30 card or newer, do this step on the laptop. If Triton fails there with an error you cannot trace to your own code, treat the laptop like an older card and use the rented machine below. On an RTX 20 or GTX 16 card, rent a Linux cloud machine with the CUDA toolkit and a GPU of compute capability 8.0 or newer for a day, copy your `cuda/` repository and `py/` scripts to it, and rebuild with `-arch=native`. Run your CUDA kernels on that machine too, so that every comparison in this step comes from one card.

### Study

- [Triton tutorial: Vector Addition](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html) (do, 30 min): The whole tutorial, run in the Python environment from step 9. Check `python -c "import triton"` first and `pip install triton` if it fails.
- [Triton tutorial: Fused Softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html) (do, 1 h): "Motivations", "Compute Kernel", "Unit Test" and "Benchmark". Skip the AMD-specific branches marked `is_hip`.
- [Triton tutorial: Matrix Multiplication](https://triton-lang.org/main/getting-started/tutorials/03-matrix-multiplication.html) (do, 1 h 30 min): "Motivations", "Compute Kernel" with "Pointer Arithmetic" and "L2 Cache Optimizations", "Final Result", "Unit Test" and "Benchmark". Skip the fp8 configurations.

### Build

1. Run all three tutorials unchanged and keep their benchmark plots.
2. `py/tri_softmax.py`: the tutorial's softmax handles a row only if it fits in one block. Write a second Triton kernel that loops over a long row in blocks with the online normalizer from step 9. Test it with your step 9 shapes and policy, and benchmark it against your S2, `torch.softmax` and the tutorial kernel at 1000 x 50257 and 4096 x 4096.
3. `py/tri_matmul.py`: run the tutorial kernel with half inputs at your step 8 shapes. Its output is half, so compare it with `cublasGemmEx` and your H2 on time, and check its values against a float reference with the tutorial's own tolerance. Print the winning autotune configuration.
4. For the tutorial softmax, print `kernel.n_regs` and `kernel.metadata.shared` as its launcher does, and compare them with `nvcc --resource-usage` for your S2.
5. Write `notes/triton.md`: for each kernel, the decisions Triton made that you made by hand, the ones you still made, and where your CUDA version wins or loses and why.

### Done when

Your looped Triton softmax passes the step 9 tests and policy. You have one table with every softmax and every half-precision matrix multiply you built, in GB/s or TFLOP/s, all measured on the card you ran this step on. `notes/triton.md` names at least four decisions Triton made for you, each tied to the step where you made it by hand.

## Where this leads

You can now write a CUDA kernel, check it with a CPU oracle under a stated error policy, find its bottleneck with `ncu` and the SASS, and explain its speed from the bandwidth and arithmetic peaks you measured on your own card. You took matrix multiply from a naive kernel far below cuBLAS to a large fraction of it, then onto tensor cores. You wrote a softmax that reads each row once, called it from PyTorch, and saw what Triton automates. Each kernel was one operation with a fixed shape, launched from a C++ harness you wrote for that operation.

A deep learning framework needs much more around those kernels: tensors of any shape and stride, broadcasting, a graph that records every operation, and a backward pass that computes gradients through all of it. Chapter 21, A tensor library, builds that from scratch in MiniTorch, a teaching library written in Python. It starts away from the GPU, on the Mac: a Python environment pinned for Numba, property tests with Hypothesis, and automatic differentiation for single numbers. Strides and broadcasting come next, the `row * N + col` arithmetic of your 2D kernels extended to any number of dimensions. The GPU comes back in module 3, which asks for map, zip, reduce and matrix multiply kernels written with the same Numba syntax as GPU Puzzles. Your tiling, reductions and occupancy work from this chapter decide how fast they run.
