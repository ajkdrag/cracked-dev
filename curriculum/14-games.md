---
id: 14
title: Game engines and shipped games
part: Graphics and games
weeks: 11
project: A small engine on SDL3's GPU API, built in WSL as a Windows program and as a Linux program, with a sprite batcher, a fixed-step loop, a mixer, Lua scripting and a cooked asset pack, plus two games built with it, a 2D platformer and a small lit 3D game, both published on itch.io.
---

Chapter 13 ended with a software rasterizer. A platform layer gives a game library input, time and memory, reloads that library while it runs and replays recorded input. The game draws textured 3D scenes on the CPU through every stage a graphics API has, and golden images check each stage. Chapter 11 left you able to embed Lua in a C program, call into it under `lua_pcall`, and reload scripts without restarting.

This chapter moves the drawing to the GPU and builds two games on the result. You learn the GPU pipeline through SDL3's GPU API, then build only the engine pieces a game needs: a fixed-step loop, a sprite batcher, collision, a mixer, Lua scripting, an asset cooker, lighting and shadows.

The first game is a 2D platformer, which you ship to itch.io before you start the 3D work. The second is a small 3D game with one level and one mechanic, and you ship that too. Items marked optional are the first to cut when the weeks run short.

The rule for the whole chapter: a system goes into the engine only after a game needs it. An engine written without a game collects features no game calls. Handmade Hero works the same way, and so did your chapter 13 renderer, which grew one stage at a time because the next picture needed it.

The chapter comes now because the GPU pipeline is the chapter 13 pipeline with hardware under it. You will recognize every fixed stage. The new material is how a CPU program talks to a second processor that has its own memory and its own timeline, and how to build and ship a program for the Windows side of your laptop.

## A Windows program built in WSL

Your NVIDIA GPU belongs to Windows, and a Linux program in WSL2 reaches it only through translation layers. SDL's GPU API does not talk to the GPU itself. It draws through the graphics interface of the driver: **Vulkan** on Windows and Linux, Direct3D 12 on Windows or Metal on a Mac. Vulkan is a specification written by Khronos, an industry group, and each GPU vendor ships a driver that implements it.

WSLg passes OpenGL, an older interface, to the GPU through a driver from **Mesa**, the collection of open-source graphics drivers that Linux uses. Ubuntu 24.04's Mesa has no Vulkan driver that reaches the GPU from WSL2. The one that works there is **lavapipe**, which runs Vulkan on the CPU.

So this chapter builds the game as a Windows program from inside WSL and starts the `.exe` from the WSL terminal. It then draws through the NVIDIA driver's Vulkan at full speed, and it is the same file your players download. The Linux build stays, with three jobs: the sanitizers and gdb, the tests, and a second download for Linux players. On your laptop it draws through lavapipe in a WSLg window, slowly but correctly.

![One source tree builds twice: clang with the Windows target makes an .exe that runs on Windows and draws on the NVIDIA GPU, and clang for Linux makes a program with the sanitizers that draws through lavapipe on the CPU into a WSLg window.](figures/14-two-builds.svg)

A **cross-compiler** runs on one system and writes programs for another. You have used one already: in chapter 12, `--target=aarch64-linux-gnu` made clang write ARM64 programs with the cross toolchain from chapter 05. Windows is one more target triple of the kind chapter 12 explained. In `--target=x86_64-w64-mingw32` the CPU is `x86_64`, the vendor is `w64` and the system with its conventions is `mingw32`.

clang still needs the Windows half of a C toolchain: headers such as `windows.h`, a C library, and **import libraries**, which tell the linker which function lives in which DLL. A **DLL** is a Windows shared library, the counterpart of the `.so` files from chapter 05. The **mingw-w64** project provides that half, and Ubuntu packages it.

SDL publishes a Windows build made for this toolchain. The release page of 3.4.20, the version you built in chapter 06, has `SDL3-devel-3.4.20-mingw.tar.gz`. Its `x86_64-w64-mingw32` directory holds the headers, the import library `libSDL3.dll.a` and `SDL3.dll`. Your `.exe` loads `SDL3.dll` when it starts, so the DLL goes next to it.

WSL starts Windows programs from the Linux shell. You type the path of the `.exe`, Windows runs it as an ordinary Windows process, and its output comes back to your terminal.

> **Practice:** Build both targets from the same source files after every change. Code that compiles for only one of them breaks the day you need the other.

### Study

- [Microsoft: Working across file systems](https://learn.microsoft.com/en-us/windows/wsl/filesystems#run-windows-tools-from-linux) (read, 10 min): The section "Run Windows tools from Linux" only. Note that a Windows program needs `.exe` in its name, keeps your working directory and can be piped like a Linux program.

### Build

1. Install the toolchain with `sudo apt install -y gcc-mingw-w64-x86-64-posix`. The package is named after gcc, mingw-w64's own compiler, because clang borrows its runtime library and its linker. The `posix` variant includes the thread library your job system needs in the next step.
2. Download SDL for Windows into its own directory. Its archive unpacks to `SDL3-3.4.20`, the same name as your chapter 06 source, so keep it apart:

   ```sh
   mkdir -p ~/src/windows && cd ~/src/windows
   curl -LO https://github.com/libsdl-org/SDL/releases/download/release-3.4.20/SDL3-devel-3.4.20-mingw.tar.gz
   tar xzf SDL3-devel-3.4.20-mingw.tar.gz
   ```

3. Copy `examples/renderer/07-streaming-textures/streaming-textures.c` from your chapter 06 SDL source into a scratch directory. Add `#include <stdio.h>` and, after the window is created, `fprintf(stderr, "video driver: %s\n", SDL_GetCurrentVideoDriver());`.
4. Build it for Windows, copy the DLL next to it and run it:

   ```sh
   sdlw=~/src/windows/SDL3-3.4.20/x86_64-w64-mingw32
   clang --target=x86_64-w64-mingw32 -o streaming.exe streaming-textures.c -I$sdlw/include -L$sdlw/lib -lSDL3
   cp $sdlw/bin/SDL3.dll .
   ./streaming.exe
   ```

   `-I` adds a directory to search for headers, `-L` adds one to search for libraries, and `-lSDL3` links the import library `libSDL3.dll.a`.
5. Build the same file for Linux as in chapter 06 and run it.
6. List the DLLs the `.exe` needs with `x86_64-w64-mingw32-objdump -p streaming.exe | grep "DLL Name"`. This is the objdump of chapter 05, built for Windows files. `-p` prints the file's headers, which include the import table.

> **If it fails:** If Windows reports that `SDL3.dll` was not found, or the program exits at once with no output, check that `SDL3.dll` sits in the same directory as the `.exe`. If Windows instead shows a message that it blocked the app, Smart App Control stopped it, because every `.exe` you build is unsigned. To see its state, open Windows Security, then App & browser control, then Smart App Control settings. You can turn it off there to run your own builds, and Microsoft's page in "Shipping game one" says that recent Windows updates let you turn it back on later without reinstalling Windows. If the Linux build opens no window, go through the WSLg checks from chapter 06.

### Done when

`./streaming.exe` opens a window with the moving green bar and prints `video driver: windows`. The Linux build opens the same window through WSLg and prints `x11` or `wayland`. objdump lists exactly three DLLs: `SDL3.dll`, `KERNEL32.dll`, the core of the Windows API, and `msvcrt.dll`, the C library that ships with Windows.

## The platform layer on Windows: memory, threads and output

The example ran on Windows because it calls only SDL. Your chapter 13 platform layer also calls Linux itself: `mmap` for memory, pthreads in the job system and `dlopen` for the game library. This step ports memory, threads and the program's output. The next step ports code loading.

A branch for one system uses the preprocessor from chapter 04. clang defines the macro `_WIN32` whenever it targets Windows, so `#ifdef _WIN32` selects the Windows code and `#else` the Linux code. Where SDL has a call for the job, use it on both systems and write no branch.

- Memory: `VirtualAlloc(NULL, size, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE)` from `<windows.h>` takes the place of `mmap`. It reserves a range of addresses, backs it with memory and returns pages that read as zero, as `mmap` did.
- Threads: the job system uses pthreads and C11 atomics, and mingw-w64 includes a pthreads library for Windows. Link it with `-l:libpthread.a`. `-l:` names an exact file, here the static library, so the `.exe` carries the thread code and needs no extra DLL. Replace any `sysconf` call for the core count with `SDL_GetNumLogicalCPUCores()`.
- Output: the Windows program's stdout reaches your terminal through a pipe, and the C library buffers pipe output until the buffer fills or the program exits. Call `setvbuf(stdout, NULL, _IONBF, 0)` at the start of `main` so every `printf` appears at once.

Until the next step, the Windows build loads no game library. It compiles the game into the platform as one program. A **unity build** compiles several `.c` files as one, by including them into a single file. `-D` sets a preprocessor name from the command line, as `-DNDEBUG` did in chapter 01, so `-DGAME_STATIC` switches the platform to this mode:

```c
#ifdef GAME_STATIC
#include "game.c"   // the game's code becomes part of this file
#endif
```

In the same mode, the platform sets its function pointer to `game_update_and_render` directly, in an `#ifdef GAME_STATIC` branch, instead of calling its loader. The shipped release build uses this switch too.

Two tools stay on Linux. Ubuntu's clang has sanitizer runtimes only for Linux targets, and gdb runs Linux programs. So you hunt bugs in the Linux build, and you play and measure in the Windows build.

> **Practice:** Keep everything that does not need a window buildable for Linux, and run its tests there under the sanitizers.

### Study

- [Microsoft: VirtualAlloc function](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualalloc) (reference, as needed): The parameters `flAllocationType` and `flProtect`, and the remark that committed pages are zeroed.

### Build

1. Give `build.sh` a target. With `TARGET=windows` it uses `clang --target=x86_64-w64-mingw32`, writes into `out/Windows-$mode`, adds `.exe` to programs, drops the sanitizer flags and keeps `-g`. With no `TARGET` it does what it did before.
2. Build the Windows platform with `LIBS="-DGAME_STATIC -I$sdlw/include -L$sdlw/lib -lSDL3 -l:libpthread.a"`, and copy `SDL3.dll` into `out/Windows-debug` once.
3. Write `void *os_alloc(uint64_t size)` in the platform with the two branches, and use it for both memory blocks.
4. Add the `GAME_STATIC` include and the direct function pointer.
5. Add the `setvbuf` call and replace any Linux-only call that is left. The compiler names each one in the Windows build.
6. Run every chapter 13 scene from `./out/Windows-debug/platform_sdl.exe`. Record and play back with L.

### Done when

Both targets build from the same files with no warnings. Every chapter 13 scene runs in the Windows window, and playback prints the same end hash on every pass. The chapter 13 tests and golden images still pass in the Linux debug build with no sanitizer report.

## Loading game.dll on Windows

The Windows build runs with the game compiled in, so F5 does nothing there yet. This step brings code reload to Windows, so the edit, rebuild and F5 loop of chapter 13 works in the build you play.

SDL wraps the three calls of chapter 13. `SDL_LoadObject`, `SDL_LoadFunction` and `SDL_UnloadObject` call `dlopen`, `dlsym` and `dlclose` on Linux and their Windows counterparts on Windows, so one code path serves both. There is no `RTLD_NOW` flag, because Windows resolves all of a DLL's imports when it loads it.

On Windows the game library is `game.dll`, built with `-shared` as on Linux. A DLL **exports** the functions that a program may look up in it by name. mingw-w64's linker exports every global function of a DLL that marks none for export, so `SDL_LoadFunction` finds `game_update_and_render`.

Keep the copy before loading. Windows refuses to replace a DLL file while a program has it loaded, which is why Casey copies his DLL on day 021. `SDL_CopyFile` does the copy on both systems.

### Study

- [SDL3 wiki: CategorySharedObject](https://wiki.libsdl.org/SDL3/CategorySharedObject) (reference, as needed): The overview and the three functions. Note the warning that pointers from `SDL_LoadFunction` die with the library, as chapter 13's planted bug showed.

### Build

1. In `build.sh`, make `TARGET=windows` with `LIB=1` write `game.dll` instead of `game.so`.
2. Drop `-DGAME_STATIC` from the Windows debug build. Replace `dlopen`, `dlsym` and `dlclose` with the SDL functions, and the file copy with `SDL_CopyFile`. On a failed load, print `SDL_GetError()` and keep the old code running.
3. Run `./out/Windows-debug/platform_sdl.exe`. Change the gradient colors, rebuild the library with `TARGET=windows LIB=1 sh build.sh game` and press F5.

### Done when

F5 swaps the code while the Windows program runs, and the Linux build still reloads `game.so` as before. `x86_64-w64-mingw32-objdump -p out/Windows-debug/game.dll | grep "DLL Name"` lists no `SDL3.dll`, and `nm -u` on `game.so` still lists no SDL symbols.

## The GPU pipeline and shaders

The platform now runs on Windows, and it still draws every pixel on the CPU. The GPU, short for graphics processing unit, is a second processor built for work that splits into many independent pieces, such as the pixels of a frame. It has its own memory and runs thousands of threads at once. To draw with it, you hand it triangles and two small programs, and it runs the chapter 13 pipeline in hardware.

![The GPU pipeline from vertices to pixels. The vertex shader and the fragment shader are programs you write. Clipping, the divide by w, the viewport, the rasterizer and the depth test are fixed hardware, and each one does what a chapter 13 function did.](figures/14-pipeline.svg)

A **shader** is a program the GPU runs once per vertex or once per pixel, many at a time. The **vertex shader** gets one vertex and returns its clip-space position plus any values to interpolate across the triangle. The hardware clips, divides by `w`, maps to pixels, rasterizes and interpolates those values with perspective-correct weights, as you did by hand. The **fragment shader** gets the interpolated values for one pixel and returns its color. Then the depth test and blending decide what reaches the target.

This book writes shaders in **HLSL**, the shading language of Direct3D, because SDL's examples use it. It reads like C with vector types. The vertex shader of the first triangle picks a corner and a color by vertex number:

```hlsl
struct Output {
    float4 color : TEXCOORD0;
    float4 position : SV_Position;
};

static const float2 corner[3] = { float2(-0.8, -0.8), float2(0.8, -0.8), float2(0.0, 0.8) };
static const float3 tint[3] = { float3(1, 0, 0), float3(0, 1, 0), float3(0, 0, 1) };

Output main(uint id : SV_VertexID) {
    Output output;
    output.position = float4(corner[id], 0.0, 1.0);
    output.color = float4(tint[id], 1.0);
    return output;
}
```

`float2` to `float4` are vectors of two to four floats, and `static const` arrays live in the shader itself.

A name after a colon is a **semantic**, the role of a value. `SV_VertexID` is the index of the vertex being processed. `SV_Position` marks the clip-space position the hardware needs. `TEXCOORD0` marks a value to interpolate, and the fragment shader receives it under the same semantic. The fragment shader returns that color unchanged:

```hlsl
float4 main(float4 color : TEXCOORD0) : SV_Target0 {
    return color;
}
```

`SV_Target0` on the function names the first color target, the texture the color is written to.

### Study

- [SDL3 wiki: CategoryGPU](https://wiki.libsdl.org/SDL3/CategoryGPU) (read, 30 min): The overview at the top of the page, then "Coordinate System". Note that depth runs from 0 to 1 here, where chapter 13 used -1 to 1. You write each call of the overview in the triangle step.
- [Microsoft: HLSL semantics](https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-semantics) (reference, as needed): "System-Value Semantics", for `SV_VertexID`, `SV_Position` and `SV_Target`. The Direct3D 9 tables above it are history.

### Build

1. Write `shaders/tri.vert.hlsl` and `shaders/tri.frag.hlsl` as above.
2. In `notes/gpu.md`, write one line per stage of the figure: the stage, whether you program it, and the chapter 13 function that did its job.
3. In the same file, write for each semantic in the two shaders which stage produces the value and which reads it.

### Done when

Both shader files exist and `notes/gpu.md` covers all six stages and all four semantics. You can say what color the fragment shader gets for a pixel halfway along the edge between the red and the green corner, and why: `(0.5, 0.5, 0, 1)`, because the hardware interpolates `TEXCOORD0` between the two vertices.

## Compiling shaders to SPIR-V

The shaders are text, and a driver does not take HLSL. A Vulkan driver takes shaders as **SPIR-V**, a binary format for shader programs defined by Khronos. **glslang**, Khronos's reference shader compiler, reads HLSL and writes SPIR-V. You compile once, before the program runs, and both builds load the same files. The driver then translates SPIR-V into its GPU's own machine code when the program creates the shader.

![At build time glslangValidator compiles tri.vert.hlsl into tri.vert.spv. At run time the program reads the file, SDL hands it to the Vulkan driver, and the driver translates it into the GPU's own machine code.](figures/14-shader-toolchain.svg)

SDL's examples compile their shaders with SDL_shadercross, a wrapper around Microsoft's DXC compiler that also writes the formats of Direct3D 12 and Metal. You need only SPIR-V, and glslang comes from Ubuntu's packages.

The glslang project declared its HLSL front end deprecated in April 2026 and plans to remove it in a later major version. Ubuntu 24.04's glslang keeps it, and the SPIR-V you compile now stays valid. If you move to a glslang without HLSL one day, DXC also writes SPIR-V from the same source.

The command-line program is `glslangValidator`. It reads the shader stage from the file name, so name your files with a double suffix such as `tri.vert.hlsl`.

### Study

- [glslang README](https://github.com/KhronosGroup/glslang#how-to-use-glslang) (reference, as needed): "How to Use Glslang" for the file-name rules, and the status note under "HLSL -> AST Front End". `glslangValidator --help` lists every option.

### Build

1. Install the compiler with `sudo apt install -y glslang-tools`.
2. Compile each shader by hand: `glslangValidator -V -e main -o tri.vert.spv shaders/tri.vert.hlsl`. `-V` makes SPIR-V for Vulkan, `-e main` names the entry function and `-o` the output file.
3. Write `shaders/build.sh DIR`: it compiles every `*.vert.hlsl` and `*.frag.hlsl` in `shaders/` into `DIR/shaders/` with the name ending in `.spv`, and stops at the first error with `set -e`. Run it for `out/Linux-debug` and `out/Windows-debug`.
4. Delete one closing parenthesis in the vertex shader and run the script.
5. Print the compiled vertex shader as text with `glslangValidator -V -H -e main -o /dev/null shaders/tri.vert.hlsl`. `-H` prints the SPIR-V in readable form. Do the same for the fragment shader.

### Done when

Both `.spv` files exist in both output directories. With the planted error the script stops with the file name and line number and exits with status 2. In the text listing you can find the `EntryPoint Vertex` line, the `BuiltIn VertexIndex` that `SV_VertexID` became, the `BuiltIn Position` of `SV_Position`, and `Location 0` on the color in both shaders, which is how the vertex output meets the fragment input.

## A first triangle

The shaders are compiled, and nothing runs them yet. This step writes the C side: a program that creates a GPU device, builds a pipeline from the two shaders and draws the triangle every frame.

The GPU runs on its own timeline. Your program does not call it the way it calls a function. It records commands into a **command buffer**, submits the buffer and carries on, and the GPU runs those commands later, while the CPU already prepares the next frame.

Inside the buffer, commands come in **passes**. A **copy pass** moves data between CPU-written memory and GPU memory. A **render pass** draws into a set of target textures. The window's picture is a **swapchain texture**, which SDL hands you for each frame.

![One frame: the CPU acquires a command buffer, records a copy pass and a render pass with its draws, and submits it. The GPU runs the recorded passes later, and the swapchain texture is shown when they finish.](figures/14-frame.svg)

The setup runs once. `SDL_CreateGPUDevice(SDL_GPU_SHADERFORMAT_SPIRV, true, NULL)` creates the device. SPIR-V as the only format selects SDL's Vulkan backend on both targets, and `true` turns on debug checks. `SDL_ClaimWindowForGPUDevice` connects a window to the device.

`SDL_LoadFile` reads a `.spv` file, and `SDL_CreateGPUShader` turns its bytes into a shader, with the entry point `"main"`. Build the path from `SDL_GetBasePath()`, the directory of the program, so it works wherever you start it.

A **graphics pipeline** bundles the two shaders with the fixed state that chapter 13 kept in flags: the primitive type, culling, depth test, blending and the format of each target. You create it once and bind it before you draw. Fields you leave out stay zero, which means no culling, no depth test and no blending:

```c
SDL_GPUColorTargetDescription color = {
    .format = SDL_GetGPUSwapchainTextureFormat(dev, window),
};
SDL_GPUGraphicsPipelineCreateInfo info = {
    .vertex_shader = vs,
    .fragment_shader = fs,
    .primitive_type = SDL_GPU_PRIMITIVETYPE_TRIANGLELIST,
    .target_info = { .color_target_descriptions = &color, .num_color_targets = 1 },
};
SDL_GPUGraphicsPipeline *pipeline = SDL_CreateGPUGraphicsPipeline(dev, &info);
```

The color target must have the swapchain's pixel format, which `SDL_GetGPUSwapchainTextureFormat` reports. After this call the pipeline holds what it needs, so release the two shaders with `SDL_ReleaseGPUShader`.

Each frame records one render pass:

```c
SDL_GPUCommandBuffer *cmd = SDL_AcquireGPUCommandBuffer(dev);
SDL_GPUTexture *swapchain;
SDL_WaitAndAcquireGPUSwapchainTexture(cmd, window, &swapchain, NULL, NULL);
if (swapchain) {   // NULL while the window is minimized
    SDL_GPUColorTargetInfo target = {
        .texture = swapchain, .clear_color = { 0.2f, 0.2f, 0.2f, 1.0f },
        .load_op = SDL_GPU_LOADOP_CLEAR, .store_op = SDL_GPU_STOREOP_STORE,
    };
    SDL_GPURenderPass *pass = SDL_BeginGPURenderPass(cmd, &target, 1, NULL);
    SDL_BindGPUGraphicsPipeline(pass, pipeline);
    SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0);   // 3 vertices, drawn once, from 0
    SDL_EndGPURenderPass(pass);
}
SDL_SubmitGPUCommandBuffer(cmd);
```

`load_op` says what the pass does with the target first, here clear it, and `store_op` keeps what the pass drew. The vertex shader gets `SV_VertexID` 0, 1 and 2 and reads no vertex data from memory.

### Study

- [SDL_gpu_examples](https://github.com/TheSpydog/SDL_gpu_examples) (do, 90 min): One small program per feature, kept by Caleb Cornett of the FNA team, who worked on the API. Clone it and build it for Linux against your chapter 06 SDL with `cmake -S . -B build -G Ninja && cmake --build build`. Run `./build/SDL_gpu_examples` and step through the examples with D and A, on lavapipe. Read `Examples/BasicTriangle.c`, the functions `CommonInit` and `LoadShader` in `Examples/Common.c`, and the shaders `RawTriangle.vert.hlsl` and `SolidColor.frag.hlsl` in `Content/Shaders/Source`.

### Build

1. In WSL, run `sudo apt install -y mesa-vulkan-drivers`. The package holds lavapipe, which the Linux build needs to draw at all.
2. Write `src/gpu_hello.c`, a program apart from the platform layer. It creates the device, prints `SDL_GetGPUDeviceDriver(dev)` and the device name from `SDL_GetGPUDeviceProperties` under `SDL_PROP_GPU_DEVICE_NAME_STRING`, opens a resizable 1280 by 720 window, loads the two shaders from `shaders/` next to the program and builds the pipeline. Each frame runs the code above. On quit, release the pipeline, the window and the device.
3. Build it for both targets and run both.
4. Experiments, one at a time. Set the pipeline's `rasterizer_state.cull_mode` to `SDL_GPU_CULLMODE_BACK` with `front_face` `SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE`, then swap two corners in the shader. Give one corner a z of 1.5, then also set `rasterizer_state.enable_depth_clip` to true. Make the fragment shader also take `float4 pos : SV_Position` and return `float4(pos.x / 1280.0, 0, 0, 1)`.

> **If it fails:** If the Linux build prints `No supported SDL_GPU backend found!` when it creates the device, no Vulkan driver is installed. Install `mesa-vulkan-drivers` as in item 1 and run it again.

### Done when

The window shows the triangle with smooth color between red, green and blue corners at any window size. The Windows build names `vulkan` and your NVIDIA GPU, and the Linux build names `vulkan` and `llvmpipe`, the name lavapipe reports.

For the experiments: with the corners swapped, the culled triangle disappears, and you can say which way it now winds. With z at 1.5 the triangle still draws whole, because SDL clamps depth by default. With depth clipping on, its tip is cut off along the far plane, the chapter 13 inequality `z <= w`. The fragment experiment shows a red ramp from left to right, which tells you `SV_Position` reaches the fragment shader in pixels.

## Seeing what the GPU got: validation layers and RenderDoc

When a frame shows nothing, the program has no error to print. The GPU took your commands and drew what they said. This step sets up the two tools that show what the GPU actually got, before the next steps add data that can go wrong.

On Linux, Vulkan's **validation layers** check every call against the specification and print a message for each misuse. They sit between SDL and the driver, and SDL's debug mode turns them on when they are installed. They also report GPU objects your program created and never released, the way LeakSanitizer reports heap blocks.

On Windows, **RenderDoc** records one frame of a running program. It then shows every pass, every draw, the resources bound to each draw and the contents of each target. You start the program from RenderDoc, which loads itself into it, and capture a frame with a key.

### Study

- [RenderDoc: Quick Start](https://renderdoc.org/docs/getting_started/quick_start.html) (read, 15 min): "Capturing a frame", "RenderDoc in-app" and the "Event Browser" and "Pipeline State" parts of "RenderDoc layout". Install RenderDoc on Windows from renderdoc.org.

### Build

1. In WSL, run `sudo apt install -y vulkan-validationlayers`.
2. Run the Linux build of `gpu_hello`, then remove the `SDL_ReleaseGPUGraphicsPipeline` call and run it again. Put the call back.
3. Capture one frame of the Windows build in RenderDoc. `wslpath -w out/Windows-debug/gpu_hello.exe` prints the Windows path of the program to paste into the Executable box. F12 is your screenshot key from chapter 13, so capture with Print Screen.
4. In the capture, find the render pass, its draw and the bound pipeline, and look at the swapchain texture after the draw.

> **If it fails:** If RenderDoc cannot start the program from its `\\wsl.localhost\...` path, copy the build to the Windows side, for example with `cp -r out/Windows-debug /mnt/c/Users/<you>/gpu-debug`, and start `gpu_hello.exe` from that folder. Keep the source in WSL and copy only the build.

### Done when

Validation stays silent until you skip the release, and then it reports a `VK_OBJECT_TYPE_PIPELINE` that "has not been destroyed". In RenderDoc you can find the render pass, its one draw of 3 vertices and the bound pipeline with your two shaders.

## Uploading the frame buffer: transfer buffers and copy passes

The triangle had no inputs. A real draw reads vertex buffers, textures and a few matrices, and all of them must get from CPU memory to GPU memory. The GPU cannot read your arrays, so every upload takes three objects in SDL:

- A **transfer buffer** is memory the CPU can **map**, which means get a pointer to and write.
- A copy pass on a command buffer copies from the transfer buffer into a GPU buffer or texture.
- Shaders read the **GPU buffer** or the texture.

![A texture upload: the CPU copies pixels into the mapped transfer buffer, a copy pass in the command buffer copies them into a GPU texture, and the fragment shader samples that texture in a later render pass.](figures/14-texture-upload.svg)

The first upload is your chapter 13 picture. Upload the CPU frame buffer each frame into a texture and draw it with one triangle that covers the screen. The texture format is `B8G8R8A8_UNORM`: four bytes per pixel in the order blue, green, red, alpha, which matches `XRGB8888` in memory. **UNORM** means each byte is an unsigned number that the shader reads as a float from 0.0 to 1.0, so 255 becomes 1.0.

The fragment shader reads the texture through a **sampler**, an object that holds how a texture is read, such as nearest or bilinear filtering and wrapping. A fragment shader gets a texture and a sampler as a pair.

Shaders find their inputs by slot. Vulkan groups a shader's inputs into numbered **descriptor sets**, and SDL fixes which set holds what. In HLSL you write the set as the `space` of a `register`, as in `Texture2D<float4> Tex : register(t0, space2)`, and glslang turns `space2` into set 2. `SDL_GPUShaderCreateInfo` also needs the count of each kind of input, here `num_samplers = 1`. The figure also shows the two other kinds of input, which later steps add: uniforms in the 3D scene step and storage buffers in the sprite batcher step.

![SDL gives each shader stage two descriptor sets: a vertex shader reads textures and storage buffers from set 0 and uniforms from set 1, and a fragment shader reads textures with samplers from set 2 and uniforms from set 3. The space of an HLSL register names the set.](figures/14-descriptor-sets.svg)

A transfer buffer is mapped again every frame. Map it with `cycle` set to true. The next step explains what that does and what goes wrong without it.

### Study

- [SDL_gpu_examples: TexturedQuad.c](https://github.com/TheSpydog/SDL_gpu_examples/blob/main/Examples/TexturedQuad.c) (do, 60 min): A quad's vertices, its indices and a texture uploaded through transfer buffers in one copy pass, then six samplers. The 3D scene step explains the vertex and index buffers.
- [SDL3 wiki: SDL_CreateGPUShader](https://wiki.libsdl.org/SDL3/SDL_CreateGPUShader) (reference, as needed): The "Remarks" list the sets for SPIR-V. A shader that compiles and draws nothing usually breaks one of them.

### Build

1. Replace `SDL_Renderer` in the platform with the GPU device. Create a 960 by 540 `B8G8R8A8_UNORM` texture with sampler usage and an upload transfer buffer of the same size.
2. Each frame, map the transfer buffer with `cycle` true, copy the game's frame buffer in row by row (its pitch may differ from 960 * 4), upload it in a copy pass, then draw it into the swapchain.
3. The full-screen pass: a vertex shader that makes one triangle covering the screen from `SV_VertexID`, and a fragment shader that samples the texture with a nearest sampler and returns its color with alpha 1. Set the viewport with `SDL_SetGPUViewport` to the letterbox rectangle, which you compute from the window size.

### Done when

Every chapter 13 scene displays through the GPU on both targets, letterboxed at any window size, and the Linux build runs with no validation message.

## Frames in flight: cycling and fences

The upload works, and it hides a problem of time. When you write a transfer buffer for frame N+1, the GPU may still be reading the same memory for frame N.

![The CPU records frame 2 while the GPU still draws frame 1. Without cycling, frame 2's write lands in memory that frame 1's draw is reading.](figures/14-frames-in-flight.svg)

Evan Hemsley's post walks through the ways an API can handle that and the one SDL chose, **cycling**. When you map with `cycle` set to true, SDL hands you a fresh internal buffer if the old one is still in use, and the old contents stay valid for the commands that already reference them. Cycle on the first write of each frame to anything you rewrite every frame. Do not cycle a resource whose old contents you still need.

You can also make the CPU wait. `SDL_SubmitGPUCommandBufferAndAcquireFence` returns a **fence**, and `SDL_WaitForGPUFences` blocks until the GPU has finished that command buffer. You need one to read results back. Waiting on one every frame removes the overlap in the picture, and you will measure what that costs.

To measure frame rates, turn off the wait for the display. SDL's swapchain uses the **present mode** `SDL_GPU_PRESENTMODE_VSYNC` by default, which shows each frame at the display's next refresh, the vsync of chapter 06. `SDL_GPU_PRESENTMODE_IMMEDIATE` shows each frame as soon as it is done, which can tear the picture but lets you see how fast the frame really is. Measure with immediate mode and ship with vsync.

### Study

- [Evan Hemsley: SDL GPU API Concepts: Data Transfer and Cycling](https://moonside.games/posts/sdl-gpu-concepts-cycling/) (read, 30 min): All of it. Hemsley designed the API with Cornett. The post's code uses the older spellings `SDL_TRUE` and `SDL_FALSE`, where SDL 3.4 takes `true` and `false`, and one of its map calls leaves out the device argument.
- [SDL_gpu_examples: CopyAndReadback.c](https://github.com/TheSpydog/SDL_gpu_examples/blob/main/Examples/CopyAndReadback.c) (read, 20 min): The submit with a fence and the wait before the program reads the downloaded data.

### Build

1. Turn vsync off with `SDL_SetGPUSwapchainParameters` and `SDL_GPU_PRESENTMODE_IMMEDIATE`, after checking `SDL_WindowSupportsGPUPresentMode`. A key switches back to vsync.
2. A key that maps the transfer buffer with `cycle` false. Watch a moving scene with it on and off in the Windows build.
3. A key that adds a fence wait after every submit. Measure frames per second and CPU time per frame with and without it, on the Windows build.

### Done when

With `cycle` false you may see torn or mixed frames on Windows, and you can say why from the timeline figure. You have the two frame rates from the fence experiment and can explain the gap with the same figure.

## The 3D scene on the GPU: depth and mipmaps

Chapter 13's textured scene still goes through the CPU path. This step draws it with the GPU's own vertex and fragment stages. A **vertex buffer** is a GPU buffer that holds a mesh's vertices, and an **index buffer** lists the three vertex numbers of each triangle, as chapter 13's indexed mesh did. Each object gets its own matrix, and the depth buffer becomes a depth texture.

A matrix that changes every draw takes a shorter path than a transfer buffer. `SDL_PushGPUVertexUniformData` copies a few bytes into the command buffer itself, and the shader reads them as **uniforms**, values that stay the same for every vertex or pixel of one draw. A vertex shader's uniforms live in set 1, so the block is declared `cbuffer Object : register(b0, space1)`, and the shader is created with `num_uniform_buffers = 1`.

Two conventions change. SDL's depth range is [0, 1], so you need a projection matrix whose third row maps `z = -near` to 0 and `z = -far` to 1:

```
  f = 1 / tan(fovy / 2)
  | f/aspect  0   0                  0                      |
  | 0         f   0                  0                      |
  | 0         0   far/(near - far)   near*far/(near - far)  |
  | 0         0   -1                 0                      |
```

The other change is how the matrix reaches HLSL. Your `M4` stores `m[row][col]`, row after row. HLSL reads a `float4x4` from a uniform block column after column, unless you declare it `row_major float4x4`. Do that, and keep writing `mul(M, v)` as in C.

The examples build their matrices for the opposite convention, so copy their shader structure and not their matrix code. Camera space, winding and texture coordinates stay as `docs/conventions.md` says: SDL's normalized device coordinates have y up like yours, and its texture coordinates put (0, 0) at the first row of the image like yours.

The depth buffer becomes a texture in the format `D32_FLOAT`, one 32-bit float per pixel, bound to the render pass as its depth target. The pipeline enables the depth test and depth writes with the LESS comparison, as chapter 13 did in C.

Chapter 13 left the far checkerboard shimmering, because a far pixel covers many texels and bilinear sampling reads only four. A **mipmap chain** stores the texture again at half size, quarter size and so on down to 1 by 1. Each copy is a **level**, and each texel of a level averages four texels of the level above.

![A mipmap chain for an 8 by 8 texture: levels 0 to 3 at 8, 4, 2 and 1 texels square, each texel the average of four above it. A near pixel samples level 0, and a far pixel that covers many texels samples a smaller level.](figures/14-mipmaps.svg)

The sampler picks the level whose texels come closest to one pixel in size. With `SDL_GPU_SAMPLERMIPMAPMODE_LINEAR` it blends the two nearest levels. `SDL_GenerateMipmapsForGPUTexture` builds the chain on the GPU from level 0. The texture needs `num_levels` set at creation and both the sampler and the color-target usage flags.

### Study

- [SDL_gpu_examples: GenerateMipmaps.c](https://github.com/TheSpydog/SDL_gpu_examples/blob/main/Examples/GenerateMipmaps.c) (read, 20 min): The texture's usage flags and `num_levels`, and where the generate call sits in the command buffer. Then read `DepthSampler.c` in the same folder for the `depth_stencil_state` of its scene pipeline and the depth texture it binds to the render pass.

### Build

1. `m4_perspective_z01` in `math.c` with unit tests: `z = -near` maps to depth 0 and `z = -far` to depth 1.
2. A GPU scene mode in the platform: the checkerboard floor and the textured cubes with indexed vertex buffers, one uniform matrix per object pushed before its draw, a `D32_FLOAT` depth texture with the LESS test, back-face culling and the bilinear sampler. Check the depth format with `SDL_GPUTextureSupportsFormat` at startup. A key switches between the CPU and GPU renderers with the same camera.
3. Mipmaps for the checkerboard, and a key that switches between a sampler with mipmaps and one without.

### Done when

The `m4_perspective_z01` tests pass. Switching between the CPU and GPU renderers leaves the floor, the cubes and their textures in the same place on screen, with the same faces visible. With mipmaps on, the far checkerboard turns smooth gray instead of shimmering while you fly.

## A fixed-step loop with interpolation

The platform now draws through the GPU, and the next steps build the first game on it. Before any gameplay code, the game needs a clock that gives the same result on every run. Chapter 13's game took one step per displayed frame, with whatever `dt` the frame had. A jump then depends on the frame rate. At a long frame the player moves further between collision checks, and float rounding makes the arc differ from run to run.

Games fix this the way your CHIP-8 front end did. The simulation advances in fixed **ticks**, here 1/120 s, and the platform runs as many ticks as the elapsed time allows. Rendering happens once per displayed frame.

After the ticks of a frame, the accumulator holds a remainder smaller than one tick. Drawing the state of the last tick would show motion that lags real time by a varying amount, which looks like stutter. Drawing a blend of the previous tick's state and the current one, weighted by `alpha = accumulator / tick`, removes it. Fiedler's last section, which chapter 06 skipped, does exactly this.

![Ticks every 1/120 s and frames at uneven times. At each frame the accumulator holds the time since the last tick, and the frame draws the state alpha of the way from the previous tick to the current one.](figures/14-fixed-step.svg)

The game API splits in two:

```c
void game_update(GameMemory *memory, GameInput *input, float dt);       // one tick
void game_render(GameMemory *memory, RenderOutput *out, float alpha);   // once per frame
```

`game_update` copies each entity's position into `prev_position` before it moves anything. `game_render` draws `lerp(prev_position, position, alpha)`. Interpolate only what you draw. The state itself stays exactly as the ticks left it.

The accumulator counts `uint64_t` nanoseconds, and 1/120 s is not a whole number of them. Set `tick_ns = 8333333` and pass the game `dt = tick_ns * 1e-9f`, so the game steps by exactly the time the platform subtracts. The tick then runs a third of a nanosecond short, which does not matter for play, and replay stays exact because every pass uses the same `dt`. At 50 Hz the tick is exactly 20,000,000 ns.

Input needs care once a frame can contain several ticks:

- Give a press to the first tick of the frame only. Later ticks of the same frame get the held state with zero transitions, so one press fires one jump even when a stall makes the platform run five ticks to catch up.
- Cap the catch-up at 8 ticks and count the dropped time, so a pause in a debugger does not make the game fast-forward.
- The game knows **actions**, not keys: left, right, jump, shoot, pause. The platform maps scancodes and gamepad buttons to actions, and the left stick to a move axis with a dead zone. SDL names gamepad buttons by position (south, east, d-pad up), so one mapping works for any supported controller.
- Open gamepads when `SDL_EVENT_GAMEPAD_ADDED` arrives, not only at startup, since a player can plug one in at any time. Plug controllers into Windows and test them in the Windows build. WSL does not see USB devices.

Recording from chapter 13 now records per tick. A recording becomes a list of tick inputs, and playback feeds them through `game_update` with the same `dt`.

### Study

- [Glenn Fiedler: Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) (read, 10 min): Chapter 06 assigned this page. Read only "The final touch" now, the section chapter 06 told you to skip.
- [SDL3 wiki: CategoryGamepad](https://wiki.libsdl.org/SDL3/CategoryGamepad) (reference, as needed): The overview, then `SDL_OpenGamepad`, `SDL_GamepadButton` and `SDL_GamepadAxis`. Initialize SDL with `SDL_INIT_GAMEPAD`.
- [SDL3 wiki: SDL_GamepadDeviceEvent](https://wiki.libsdl.org/SDL3/SDL_GamepadDeviceEvent) (reference, as needed): The event that carries `SDL_EVENT_GAMEPAD_ADDED` and `SDL_EVENT_GAMEPAD_REMOVED`, and the "Remarks" on the added events SDL sends for controllers already plugged in at startup.

### Build

1. Split the game API as above. Move the platform to ticks of 1/120 s with an accumulator in `uint64_t` nanoseconds, `dt` derived from `tick_ns`, a cap of 8 ticks per frame and a counter of dropped ticks.
2. `GameInput` with an array of actions, each `{ bool down; int transitions; }`, plus a float move axis. Keyboard and gamepad mappings in the platform, with hotplug.
3. A test scene on the CPU path: a square that runs and jumps under gravity with a fixed jump velocity. Print the peak height of every jump.
4. A key that stalls the platform with `SDL_Delay(100)` every second. A second key switches the tick rate between 120 Hz and 50 Hz. A third turns interpolation off.
5. Recording and playback per tick, with the FNV-1a hash of the permanent block at the end of each pass.

### Done when

Every jump prints the same peak height, bit for bit, with and without stalls, and one press during a stall gives one jump. At 50 Hz with interpolation off the square stutters, and with interpolation on it moves smoothly. A gamepad plugged in while the Windows build runs moves the square. Playback passes print identical hashes.

## A sprite batcher

The first game draws sprites: the player, enemies, bullets, tiles, particles and letters. A **sprite** here is a textured rectangle on screen. Drawing each one with its own draw call costs a fixed amount of CPU and driver time per call, and a level with a few thousand tiles and particles would spend the frame on that overhead. A **sprite batcher** draws all sprites that share a texture with one call.

Hemsley's batcher lets the vertex shader build the rectangles itself. The CPU writes one 64-byte record per sprite into a **storage buffer**, a GPU buffer that shaders read as an array of structs: position, rotation, size, texture rectangle and color. The draw asks for `6 * count` vertices with no vertex buffer bound. Vertex `id` reads record `id / 6` and takes corner `triangleIndices[id % 6]` of the rectangle's two triangles.

![One storage buffer holds a 64-byte record per sprite. The draw runs 6 vertices per sprite: vertex 7 reads record 1 and corner triangleIndices[1] = 1, and the six vertices of a sprite make the triangles 0, 1, 2 and 3, 2, 1 of its rectangle.](figures/14-sprite-batch.svg)

The shader declares the records as `StructuredBuffer<SpriteData> DataBuffer : register(t0, space0)`, the first storage buffer of a vertex shader, so create the shader with `num_storage_buffers = 1`. The comment at the top of the example's shader warns that this kind of buffer fails when compiled straight for Direct3D 12. That problem belongs to the Direct3D 12 backend. Your SPIR-V runs on Vulkan, where the buffer works as written.

The game cannot call SDL, so the sprites cross the boundary as data. `game_render` fills a `RenderOutput` in transient memory: a camera matrix, an array of sprite records and a list of **batches**, each one a texture number with a first index and a count. A new batch starts when the texture changes. The platform uploads the sprite array through one transfer buffer, cycled on the first map of the frame, binds the storage buffer and issues one draw per batch.

The projection for sprites is **orthographic**: it maps x from 0 to 960 and y from 0 to 540, y down, straight to normalized device coordinates, with no divide. Alpha blending uses the blend state in Hemsley's pipeline, which mixes the sprite's color with what is already there by the sprite's alpha: `src * a + dst * (1 - a)`. Your textures and sprite colors therefore store plain color with a separate alpha, not color already multiplied by alpha.

### Study

- [Evan Hemsley: SDL GPU API Concepts: Sprite Batcher](https://moonside.games/posts/sdl-gpu-sprite-batcher/) (read, 20 min): "The Vertex Shader" and "The Sprite Storage Buffer", which carry the design. The padding note under the vertex shader explains why the record has two unused floats. The rest of the post walks through the code of the next item.
- [SDL_gpu_examples: PullSpriteBatch.c](https://github.com/TheSpydog/SDL_gpu_examples/blob/main/Examples/PullSpriteBatch.c) (do, 45 min): The complete program from the post, with `PullSpriteBatch.vert.hlsl` in `Content/Shaders/Source`. Keep it open as the code reference for the batcher. Its uniform matrix is built for HLSL's column order, so declare yours `row_major` as in the 3D scene step.

### Build

1. `RenderOutput` in `game.h`, with `SpriteInstance` laid out as in the post, and batches as above. Add `_Static_assert(sizeof(SpriteInstance) == 64, "sprite record is 64 bytes");` below the struct. `_Static_assert` is an assert that the compiler checks while it compiles, so a wrong size stops the build before the shader reads garbage.
2. Copy the example's vertex shader with `row_major` added, and a fragment shader that multiplies the sprite color by the texture sample, into `shaders/`.
3. The platform side: the sprite pipeline, one upload per frame, and one draw per batch into an offscreen 960 by 540 color target, a texture created with the color-target and sampler usage flags that you draw into instead of the swapchain. Then the letterbox pass from the upload step draws that texture into the swapchain.
4. `draw_sprite` in the game. For now the platform creates one 1 by 1 white texture as texture number 1, and the game draws solid rectangles with it. Port the chapter 13 frame-time graph to sprites.
5. A benchmark scene: N sprites bouncing inside the screen, N set by keys from 1,000 to 200,000. Profile the CPU side with the chapter 07 profiler.

### Done when

With immediate present mode, the Windows build draws 100,000 sprites in less than 16.7 ms per frame, and you know from the profile how the frame divides between game update, sprite writes and the upload. The Linux build draws the same picture, slower, with no sanitizer report and no validation message. F5 still reloads the game code, and the game library still imports nothing from SDL.

## Textures, an atlas and text

The batcher draws one batch per texture, so every texture switch costs a draw. All sprite images of a game therefore go into one texture, an **atlas**, and each sprite stores the rectangle of its image as texture coordinates.

![A 256 by 256 atlas holding sixteen 64 by 64 images. One sprite's image starts at pixel (128, 64), so its rectangle in texture coordinates is u 0.5, v 0.25, width 0.25, height 0.25.](figures/14-atlas.svg)

Textures are platform objects. The game asks for them through function pointers in `GameMemory`, the way it calls `parallel_for` since chapter 13:

- `load_texture(path)` reads a PNG with `SDL_LoadPNG` and converts it with `SDL_ConvertSurface` to `SDL_PIXELFORMAT_ABGR8888`, which puts the bytes in R, G, B, A order for an `R8G8B8A8_UNORM` texture.
- `create_texture(width, height, rgba)` takes pixels the game made.

Both return a small integer handle that the game stores in its permanent memory. The handle survives a code reload because the texture lives in the platform.

Animation is a list of atlas rectangles. A walk cycle is, say, six rectangles shown in order, each for a fixed number of ticks. Each entity stores its current animation and a tick counter, and `game_render` picks the rectangle from the counter. Particles for dust, sparks and shell casings are the same thing in bulk: small entities with a position, a velocity and a lifetime, each drawn as one sprite.

Pixel art needs the nearest sampler and sprite positions rounded to whole pixels after interpolation, or edges shimmer as the camera moves. Leave one texel of padding around each image in an atlas, so bilinear filtering of a neighbor never bleeds in.

Text is sprites from a font atlas. Sean Barrett's single-file library stb_truetype rasterizes a range of characters from a TrueType font file with `stbtt_BakeFontBitmap`. It writes a one-channel bitmap and records each glyph's rectangle and advance.

Expand the bitmap to RGBA with white color and the coverage in alpha, make a texture of it, and turn each character into a sprite with `stbtt_GetBakedQuad`. The header warns that it does no range checking on font files, so load only fonts you ship yourself. Kenney's asset packs at kenney.nl are released as CC0, so you may use them freely, and they include pixel fonts and sprite sheets for the time before you have art of your own.

### Study

- [stb_truetype.h](https://github.com/nothings/stb/blob/master/stb_truetype.h) (reference, as needed): The "USAGE" comment and the first program in "SAMPLE PROGRAMS", which bakes a font and draws text with `stbtt_GetBakedQuad`.
- [SDL3 wiki: SDL_LoadPNG](https://wiki.libsdl.org/SDL3/SDL_LoadPNG) (reference, as needed): Then look up `SDL_ConvertSurface` in the API by name page from chapter 06.

### Build

1. `load_texture` and `create_texture` as platform services, with handle 0 meaning none. A failed load prints the path and returns 0, and the game draws a magenta placeholder.
2. An atlas of your sprites with one texel of padding, made by hand in an image editor or taken from a Kenney pack, and a table of rectangles in the game.
3. `draw_text` with a baked font, and the benchmark from the last step showing N and the work time on screen.
4. An animation table: for each animation, a list of atlas rectangles and the ticks per frame. Use it for a walk cycle of six frames on the test square.
5. Reload the game with F5 while text is on screen.

### Done when

Text renders crisply at its baked size in both builds. Sprites from the atlas show no colored seams at their edges while the camera moves. F5 keeps every texture, and the benchmark text updates live.

## Entities and handles

The game now has a renderer and a clock, and it takes shape here: a 2D platformer with a player who runs, jumps and shoots, enemies that patrol and shoot back, and three levels. Each object in a level that moves or can be hit is an **entity**.

Entities live in one flat array in permanent memory. Use one struct for every kind, with a `kind` field and flags such as `COLLIDES` or `HURTS_PLAYER`, so a projectile and an enemy share the movement and collision code.

Entities refer to each other, as a bullet remembers who fired it. A pointer would point at whatever reuses the slot after its entity dies. Weissflog's post replaces the pointer with a **handle**, an index plus a **generation**, a counter that goes up each time the slot is freed. A handle whose generation no longer matches the slot fails the lookup and returns null.

![Slot 3 holds an enemy with generation 7, and a handle {3, 7} finds it. After the enemy dies the slot's generation is 8, a new bullet takes the slot, and the old handle {3, 7} now returns null.](figures/14-handles.svg)

```c
typedef struct { uint32_t index; uint32_t generation; } EntityHandle;

Entity *entity_get(World *w, EntityHandle h) {
    if (h.index == 0 || h.index >= w->capacity) return NULL;   // slot 0 is never used
    Entity *e = &w->entities[h.index];
    if (!e->alive || e->generation != h.generation) return NULL;
    return e;
}
```

Free slots go on a free list. Destroying an entity marks it dead and increments its generation. Do not reuse a slot inside the tick that freed it. Free at the end of the tick, after every system has finished iterating. A generation counter that reaches its maximum retires the slot for good.

### Study

- [Andre Weissflog: Handles are the better pointers](https://floooh.github.io/2018/06/17/handles-vs-pointers.html) (read, 30 min): All of it, including the update at the end on per-slot generation counters. Weissflog writes the sokol libraries, and the post comes from replacing smart pointers in large C++ code bases.

### Build

1. `World` with an entity array, a free list, handles and `entity_get`.
2. Unit tests in the Linux build: a handle to a destroyed entity returns null, a handle to a reused slot returns null, and index 0 and an index past capacity return null.
3. Spawning and destroying from game code, with frees deferred to the end of the tick.

### Done when

The handle tests pass under AddressSanitizer and UBSan. A test that sets one slot's generation to one below its maximum, then frees and respawns, shows that slot retired and never handed out again.

## Tiles and collision

Levels are **tilemaps**, grids of square tiles. Keep them as text files, one character per 16-pixel tile: `#` for solid, `-` for a one-way platform, `P` for the player start, `E` for an enemy, `.` for empty. The loader turns the characters into a tile array and spawns entities. A camera follows the player, and the renderer draws only the tiles inside the camera rectangle.

Player movement against tiles follows Monteiro's tile-based smooth method. Move along x first, then along y. For each axis, find the rows or columns of tiles the player's box covers, scan from the leading edge in the direction of motion for the nearest solid tile, and move by the smaller of the wanted distance and the distance to that tile. The scan covers every tile between the start and the end of the move, so a fast fall cannot skip a one-tile floor.

![A move of (+20, +12) resolved one axis at a time. Along x the scan from the right edge finds a wall 6 pixels away, so the box moves 6. Along y the scan from the bottom edge finds the floor 4 pixels away, so the box moves 4 and lands.](figures/14-tile-collision.svg)

Two small timers make the jump feel fair. **Coyote time** lets a jump start within about 0.1 s after the player walks off a ledge. A **jump buffer** remembers a press for about 0.1 s and fires it on landing. Both are counters in ticks.

Entities against entities need a **broadphase**, a cheap pass that finds the pairs worth an exact test. Comparing every pair costs n squared checks, which is fine for 30 entities and too slow for 2,000 bullets. A uniform grid in transient memory, rebuilt every tick, puts each entity into the cells its box covers. Then only entities that share a cell get an exact box overlap test.

Bullets move less than their own size per tick at 120 Hz, so an overlap test after each move does not miss hits. State that bound in a comment and assert it.

### Study

- [Rodrigo Monteiro: The guide to implementing 2D platformers](http://higherorderfun.com/blog/2012/05/20/the-guide-to-implementing-2d-platformers/) (read, 45 min): "Type #2: Tile Based (Smooth)" through "One-way platforms", then "Acceleration" and "Jump control" under "General Considerations". Skip slopes, ladders, the bitmask and vectorial types.
- [Robert Nystrom: Game Programming Patterns, Spatial Partition](https://gameprogrammingpatterns.com/spatial-partition.html) (read, 40 min): All of it. Nystrom wrote Crafting Interpreters, which you know from chapter 11. His grid stores a linked list per cell. Yours is rebuilt every tick in the transient arena, so a count per cell and one flat array of entries is simpler.

### Build

1. The level loader and three level files. The camera, and tiles drawn as sprites from the atlas.
2. Player movement with acceleration, variable jump height, coyote time, jump buffer and one-way platforms, all tuned by constants in one struct.
3. Enemies that walk until a wall or ledge and turn, projectiles from the player and enemies, damage and death.
4. The grid broadphase, plus a debug key that draws every entity box and the occupied grid cells.
5. `src/collide_test.c`, a headless test with no SDL that includes `game.c` and builds with `build.sh` in the Linux debug build, like `pitch_test` in chapter 13: drop the player from 100 tiles up at maximum fall speed onto a one-tile floor, run into walls at maximum speed from both sides, and jump through and land on a one-way platform. Check the end positions.
6. A stress scene with 2,000 bullets. Time the pair checks with brute force and with the grid.

### Done when

The collision tests pass with no sanitizer report, and the player never ends a tick inside a solid tile in any test or in a ten-minute play session with the box view on. Jumping off a ledge a few ticks late still jumps, and a press just before landing jumps on landing. You have both stress timings, and the grid version keeps the tick under 1 ms in the Windows build.

## Sound: a mixer and a request queue

The game plays but is silent. Sound works like the frame buffer of chapter 13: the platform hands the game a buffer and the game fills it.

In chapter 06 you kept about three frames of samples queued in an SDL audio stream. Do the same here with stereo float samples at 48,000 Hz, but keep the queue shorter. A sound mixed this frame goes in behind everything already queued, so the queue length is the delay before you hear it. Three frames, 50 ms, was fine for a beeper and is late for a gunshot.

Each frame the platform calls the game back with `game_get_sound_samples(memory, out, frames)` for enough samples to keep about 1.5 frames (1,200 sample frames) queued, then puts them into the stream. A **sample frame** is one sample per channel, here a left and a right float. The game mixes. Each playing **voice** holds a sound handle, a read position, a volume and a pan. Mixing is a loop that adds each voice's samples, scaled by its volume and pan, into the output buffer, followed by a clamp to [-1, 1].

![The mixer: three voices, each with a position in its sound, a volume and a pan, are scaled and added sample by sample into the output buffer, clamped to [-1, 1], and put into SDL's audio stream, which feeds the device.](figures/14-mixer.svg)

A platform service `load_sound(path)` reads a WAV file with `SDL_LoadWAV`, converts it to stereo float at 48,000 Hz with `SDL_ConvertAudioSamples`, and returns a handle and a pointer to the samples in platform memory.

Gameplay code does not touch the mixer. It posts a request, "play sound S at volume V", into a queue, as in Nystrom's event queue chapter, and the mixer drains the queue. The queue lets you merge duplicates: ten bullets hitting a wall in the same tick play one sound slightly louder, not ten copies on top of each other.

The Windows build plays through Windows' own audio, and the Linux build through WSLg's sound server from chapter 06, which adds its own delay. Judge timing in the Windows build.

### Study

- [Robert Nystrom: Game Programming Patterns, Event Queue](https://gameprogrammingpatterns.com/event-queue.html) (read, 40 min): All of it. His running example is an audio engine. Skip "Spanning threads", since your mixer runs on the main thread.
- [SDL3 wiki: SDL_LoadWAV](https://wiki.libsdl.org/SDL3/SDL_LoadWAV) (reference, as needed): Then look up `SDL_ConvertAudioSamples` in the API by name page from chapter 06. The audio stream calls are the ones you used in chapter 06.

### Build

1. `load_sound`, `game_get_sound_samples`, the voice mixer and the request queue with merging. Music as a looping voice with its own volume.
2. Sounds for jump, shot, hit, enemy death, pickup and player death. Generate them with a sound effect tool such as jsfxr, or take them from a CC0 pack.
3. A unit test of the mixer in the Linux build: two voices of known samples mix to their scaled sum, a sum above 1 clamps, and a voice that reaches its end stops.

### Done when

Every game event has its sound in both builds. Ten simultaneous hits play as one sound. In the Windows build, sound starts no later than two frames after the event that caused it. Check it with the Xbox Game Bar, which Windows includes: Win+Alt+R records the game window with its sound, and in the video you count the frames between the jump on screen and the start of its sound.

## Lua scripting and game feel

The game plays and makes sound, and it still feels flat. Feel comes from many small numbers you tune by playing. This step moves those numbers and the enemy behavior into Lua, so you change them without a rebuild, and then spends the rest of the time on feel.

Lua comes back from chapter 11 for two jobs. `scripts/tuning.lua` returns a table of numbers: run speed, jump velocity, gravity, coyote ticks, shake strength. `scripts/enemies.lua` holds one update function per enemy type. The C side calls it once per tick for each enemy with a small table of that enemy's fields and copies the returned values back.

The platform checks the modification time of `scripts/` once per second, as your HTTP server did, and sets a flag in `GameInput`. The game then reloads the scripts under `lua_pcall` and keeps the old ones if the new file has an error.

Both game libraries need their own Lua. Your chapter 11 `liblua.a` does not link into `game.so`: the linker stops with `relocation R_X86_64_PC32 against symbol 'stderr@@GLIBC_2.2.5' can not be used when making a shared object; recompile with -fPIC`. A shared library must contain only position-independent code, as chapter 05 showed for your own files, so Lua is rebuilt with `-fPIC`. The Windows game library needs Lua built for Windows, from a second copy of the source and the cross-compiler.

Code reload adds one rule. The Lua state belongs to the game library: its allocator, its C functions and its library code all live in the library's pages, which unloading unmaps. That is chapter 13's planted string-literal bug again, in a bigger form. Add `game_unload(memory)`, which the platform calls before `SDL_UnloadObject`, and close the Lua state there.

![The Lua state holds pointers into the game library's pages: its allocator, the C functions it calls and the VM code. game_unload closes the state before SDL_UnloadObject unmaps those pages, and the new library opens a fresh state.](figures/14-lua-reload.svg)

After a reload the game opens a new state and runs the scripts again. All game state lives in C structs, and Lua holds only behavior and numbers, so nothing is lost. That also keeps replay working, since the hash covers the permanent block and the scripts keep no state between ticks.

Jan Willem Nijman's talk takes a dull shooter and adds about 30 small changes, one at a time, until it feels good: bigger bullets, muzzle flash, knockback, screen shake, hit pause, shell casings that stay, sounds with varied pitch, a camera that leads the player. Most of them are a few lines each. Each is a number you will tune many times, so each goes in `tuning.lua` with a switch to turn it off.

The title screen, the levels and the win screen need a **mode**. Use a plain `enum` for it and a `switch` in `game_update`. Game two puts a stack on top of it for the pause menu.

### Study

- [Jan Willem Nijman: The art of screenshake](https://www.youtube.com/watch?v=AJdEqssNZ-U) (watch, 35 min): All of it. INDIGO Classes 2013, from the Vlambeer co-founder who made Nuclear Throne. Write down each change as he adds it.
- [Lua 5.5 Reference Manual, section 4.6: Functions and Types](https://www.lua.org/manual/5.5/manual.html#4.6) (reference, as needed): The page from chapter 11. Section 4.6 for `lua_pcall`, 4.7 "The Debug Interface" for `lua_sethook`, 5.1 for `luaL_traceback` and 4.3 "Registry" for the registry.

### Build

1. Rebuild your chapter 11 Lua with position-independent code. In `~/code/lua-5.5.1`, run `make clean`, then `make linux MYCFLAGS=-fPIC`, then `make local`. `MYCFLAGS` is the Makefile's variable for extra compiler flags. Your chapter 11 host still links against the new library. Link the Linux game library with `LIBS="-I$HOME/code/lua-5.5.1/install/include $HOME/code/lua-5.5.1/install/lib/liblua.a -lm"`.
2. Build Lua for Windows in a second copy of the source. Unpack the chapter 11 archive into `~/code/lua-5.5.1-windows` with `tar xzf lua-5.5.1.tar.gz -C lua-5.5.1-windows --strip-components=1` after a `mkdir`. `--strip-components=1` drops the archive's top directory name. In the new directory run:

   ```sh
   make -C src a CC="clang --target=x86_64-w64-mingw32 -std=gnu99" AR="x86_64-w64-mingw32-ar rc" RANLIB=x86_64-w64-mingw32-ranlib
   ```

   `-C src` runs make in `src`. The target `a` builds only `src/liblua.a`, and the three variables replace the Makefile's compiler and archive tools with the Windows ones. Link the Windows game library with `-I$HOME/code/lua-5.5.1-windows/src $HOME/code/lua-5.5.1-windows/src/liblua.a` added to its `LIBS`.
3. `game_unload`, a Lua state created on the first update after each load, `tuning.lua` read into a C struct, and `enemies.lua` with at least two enemy behaviors. An instruction budget per call with `lua_sethook`, as in chapter 11.
4. At least six effects from the talk, each with a switch in `tuning.lua`.
5. Engine work for the modes: an `enum` of title, playing, dead and won, a `switch` in `game_update` and `game_render`, and a restart that resets the level from its file.
6. Content: the title screen and the win screen as text and sprites, and levels 2 and 3 as new level files with a way from each level to the next.
7. Play the whole game with all effects off, then with all on. Ask someone else to play both versions.

### Done when

The whole game can be played from title to win screen. A change to a number in `tuning.lua` shows in the running game within a second, and a syntax error there prints a traceback and leaves the game running on the old values. In the Linux debug build, F5 after a C change works while enemies run Lua behavior, with no crash and no sanitizer report, and the same works in the Windows build. Your tester can tell which version had the effects on.

## Shipping game one

A game that only runs from your build directory cannot be given to anyone. Shipping takes a release build for each target, a package that runs on a machine that has never seen your source, and a page where people download it.

The release build is the unity build from the platform step: `-DGAME_STATIC` compiles the game into the platform, with `-O2`, no sanitizers and no code reload. Everything that is not part of the system goes into the program or next to it:

- Lua and the thread library are already static, so they are inside the `.exe`.
- `SDL3.dll` goes next to the `.exe`. SDL's zlib license allows that.
- The Windows release adds `-mwindows`, which marks the program as a **GUI program**, so Windows opens no console window when a player double-clicks it. Include `<SDL3/SDL_main.h>` in the file with `main`, which lets SDL supply the entry point Windows expects.
- The Linux release ships `libSDL3.so.0` next to the program. That file in `/usr/local/lib` is a symbolic link, a file that only names another file, so copy it with `cp -L`, which copies the file it points to. The program links with `-L/usr/local/lib -lSDL3 -Wl,-rpath,'$ORIGIN'`, where `-Wl,` hands the option after it to the linker. An **rpath** is a list of directories the loader from chapter 05 searches for shared libraries, and `$ORIGIN` stands for the directory of the program itself. Do not use `pkg-config --libs sdl3` here. Its output adds `/usr/local/lib` to the rpath, so on your machine the program would load your own copy of SDL and hide a missing library in the download.

Ship with vsync on, as the frames in flight step said, and keep immediate mode behind a key for your own measurements.

Build every asset path from `SDL_GetBasePath()`. Writable files go to `SDL_GetPrefPath`, which is in the user's `AppData` folder on Windows and under `~/.local/share` on Linux: a log file and later the saves. Write the log there and flush it on every line, so a crash on a tester's machine leaves you something to read.

![The shipped Windows zip holds one folder: platformer.exe with Lua and the thread library inside, SDL3.dll next to it, the shaders as .spv files, the game's assets and a README. The log is written later to the player's AppData folder, outside the zip.](figures/14-zip.svg)

Windows checks programs downloaded from the internet. Your `.exe` has no **code signature**, a certificate-backed mark of who published it, so Windows' SmartScreen may show a warning that it is unrecognized. "More info" and then "Run anyway" start it.

On a Windows 11 machine with Smart App Control turned on, an unsigned program is blocked and cannot be allowed one by one. The way around both is to sign the program with a code signing certificate, which costs money every year. Whether that is worth it for a first game is your call. Put the steps for players on your itch.io page.

itch.io hosts the files. Create the project on itch.io's dashboard first, as a downloadable game. **butler**, itch.io's command-line uploader, runs in WSL and pushes a directory or a zip to a **channel** of that project. A channel name containing `windows` tags the upload as a Windows download, and one containing `linux` as a Linux download. Keep the project in draft or restricted mode until the downloads have been tested.

### Study

- [itch.io: Installing butler](https://itch.io/docs/butler/installing.html) (read, 15 min): "Downloading" and "On Linux". Then follow the sidebar to "Logging in / authentication" for `butler login`, and to "Pushing builds" for its top section, "Channel names" and "Specifying your own version number".
- [Microsoft: What is Smart App Control?](https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003) (read, 5 min): What happens to an unsigned app, and the statement that a single app cannot be allowed. Some of your players will have it on.

### Build

1. Release builds for both targets with `-DGAME_STATIC` in `LIBS`, with `release` as in chapter 01 and `TARGET=windows` for the second. A script `tools/dist.sh` then fills `dist/platformer-windows/` and `dist/platformer-linux/`, each with the program, the SDL library, `shaders/`, the assets and a `README.txt` with the controls, the version, SDL's license and Lua's license. Lua's MIT license asks that its notice travel with every copy, which includes your binary. Copy the Linux library with `cp -L /usr/local/lib/libSDL3.so.0 dist/platformer-linux/`.
2. `zip -r platformer-1.0.0-windows.zip platformer-windows` from `dist/` (`sudo apt install -y zip unzip` if they are missing). `-r` packs the folder with everything inside it. Check the result with `unzip -l`, which lists the files a zip holds.
3. All asset and script paths from `SDL_GetBasePath`, the log file in `SDL_GetPrefPath`, and a clear error screen for a missing file, which you test by deleting one sound from `dist/`.
4. A version number on the title screen and in the log.
5. An itch.io page with screenshots, controls, the SmartScreen steps and "Linux: Ubuntu 24.04 or newer", because the Linux program needs the C library version of the system it was built on. Put the same line in the Linux README. Push the zip to a `windows` channel and the Linux directory to a `linux` channel with `--userversion`, while the page is restricted.
6. Download the Windows zip in your Windows browser, extract it into your Downloads folder and play it through from there. Unpack the Linux download in `/tmp` in WSL and start it there.

### Done when

`x86_64-w64-mingw32-objdump -p` on the shipped `.exe` lists only `SDL3.dll`, `KERNEL32.dll` and `msvcrt.dll`, and `ldd`, which lists each shared library a program needs and the file the loader would use for it, finds `libSDL3.so.0` in the Linux program's own directory. The downloaded Windows copy starts from the Downloads folder, with no WSL path involved, and plays from title to win screen. The log file appears in the pref folder. The page is public, with one download tagged for Windows and one for Linux.

## A cooked asset pack

The 3D game loads models, textures and sounds, and so far every asset is a source file that the game decodes at startup. Source formats are for tools: PNG compresses, glTF supports dozens of layouts, and both need validation. A **cook** step turns them once into the exact bytes the engine uploads. Start with the assets you already have, game one's textures and sounds, and add models in the next step.

`tools/cook.c` is a separate Linux program, so it may link SDL. It reads a manifest and writes one `data.pack`, which both builds load. The manifest is a text file with one entry per line, a type and a source path:

```
texture crate.png
sound   jump.wav
mesh    level.glb
boxes   level.glb
```

![The cooker reads a manifest that lists PNG, glTF and WAV files and writes data.pack: a header, a table of entries with name hash, type, offset and size, then the texture, mesh, collision box and sound data each entry points to.](figures/14-cooker.svg)

Write every field with a fixed width in little-endian order, one field at a time. Do not `fwrite` a struct, because padding and layout are compiler choices. A texture entry holds its width, its height and then the RGBA bytes. A sound entry holds a count of sample frames, then the stereo float samples at 48,000 Hz that `load_sound` makes today.

The runtime trusts nothing in the pack. Check the magic and the version, and check that every offset plus size fits inside the file without overflowing. Check that counts times element sizes fit in their entries. That is the defensive parsing of your chapter 04 JSON parser, aimed at binary data.

### Study

- [SDL3 wiki: SDL_LoadPNG](https://wiki.libsdl.org/SDL3/SDL_LoadPNG) (reference, as needed): The page from the atlas step. The cooker calls the same functions as `load_texture` and `load_sound`, only once and ahead of time.

### Build

1. `tools/cook.c` with the manifest, texture and sound entries, and a `--dump` mode that prints the table of a pack.
2. The pack loader in the game, reading the pack through a `read_file` service into the permanent arena, with every check above. Game one's textures and sounds now come from the pack.
3. Unit tests with hand-made broken packs: wrong magic, an offset past the end, an offset plus size that overflows, a sample count larger than its entry.
4. A test that truncates a good pack at every length and loads each one under AddressSanitizer.

> **Optional:** Fuzz the loader with libFuzzer, as you fuzzed the JSON parser in chapter 04, with good packs as the starting inputs.

### Done when

`cook --dump` lists every entry with its sizes. The broken-pack tests fail cleanly with a message, and every truncated pack is rejected with no sanitizer report. Game one runs from the pack in both builds, and nothing in its startup path decodes PNG or WAV.

## Models from glTF

The 3D game needs **meshes**, triangle lists with positions, normals and texture coordinates, and meshes come from modeling tools as glTF files. This step teaches the cooker to read them.

glTF stores a scene as JSON that points into binary buffers.

![A glTF node holds a mesh, the mesh holds primitives, a primitive names one accessor per attribute, and an accessor reads typed elements from a buffer view, which is a byte range of one buffer.](figures/14-gltf.svg)

- A node holds a transform and a mesh. A node's name is free text, such as `col_wall_3`.
- A mesh holds primitives, and a primitive names accessors for its positions, normals, texture coordinates and indices.
- An accessor describes how to read one array out of a buffer view, which is a byte range of a buffer.

glTF uses a right-handed system with +Y up and meters as the unit, the same as your `docs/conventions.md`.

cgltf is a glTF parser in C in one header file. Download `cgltf.h` from the top of its repository into `tools/`. In exactly one `.c` file, write `#define CGLTF_IMPLEMENTATION` before the `#include`, which makes that file hold the code and every other file only the declarations.

Bake each node's world transform into its vertices with `cgltf_node_transform_world` and keep only triangle primitives. `cgltf_accessor_unpack_floats` and `cgltf_accessor_unpack_indices` read accessors of any layout into flat arrays. Images inside a `.glb` file are PNG bytes in a buffer view, which `SDL_LoadPNG_IO` with `SDL_IOFromConstMem` decodes.

A mesh entry holds the vertex and index counts, the bounds, then 8 floats per vertex (position, normal, uv) and `uint32_t` indices. A boxes entry holds a count, then 6 floats per box: the minimum and maximum corner of each node whose name starts with `col_`, over that node's vertices in world space. Mesh entries leave those nodes out, and game two collides with the boxes.

Normals need their own transform. A matrix that scales one axis more than the others tilts a transformed normal away from its surface. Transform each normal by the inverse transpose of the upper 3 by 3 of the world matrix, then renormalize it.

Call the three columns of the upper 3 by 3 `a`, `b` and `c`. The inverse transpose has the columns `cross(b, c)`, `cross(c, a)` and `cross(a, b)`, divided by the determinant `dot(a, cross(b, c))`. You renormalize anyway, so skip the division and keep only its sign. A negative determinant means the node mirrors the mesh, which also flips the winding: swap two indices of every triangle from that node.

### Study

- [Khronos glTF Tutorial: The Basic Structure of glTF](https://github.khronos.org/glTF-Tutorials/gltfTutorial/gltfTutorial_002_BasicGltfStructure.html) (read, 75 min): Marco Hutter's tutorial in the Khronos repository. This page and the next three through the "Next" links, ending with "Buffers, BufferViews, and Accessors". Then "Meshes" and "Textures, Images, and Samplers" from the index. Skip animations, morph targets, skins and cameras.
- [cgltf](https://github.com/jkuhlmann/cgltf) (reference, as needed): The README's "Usage: Loading", then the reference comment at the top of `cgltf.h` for `cgltf_parse_file`, `cgltf_load_buffers`, `cgltf_validate`, `cgltf_node_transform_world` and the two unpack functions. Look up `SDL_LoadPNG_IO` and `SDL_IOFromConstMem` in the API by name page from chapter 06.

### Build

1. Mesh entries in the cooker, with normals transformed as above, and the textures inside `.glb` files as texture entries.
2. Boxes entries from `col_` nodes.
3. Loader checks for the new entries: every index against the vertex count, and a box count against the entry size. Add a broken pack for each to the tests.
4. `create_mesh` in the platform and a mesh pipeline with one uniform block per draw. Load a scene from Kenney's prototype or platformer kits, or one you model in Blender and export as glTF, and fly through it with the chapter 13 camera, textured and unlit.

### Done when

`cook --dump` lists the meshes and boxes of your scene with their counts. The new broken-pack tests fail cleanly. The scene draws with correct textures and winding in both builds, and nothing in the game's startup path parses JSON.

## Lighting and a shadow map

The cooked scene draws textured and unlit, so every face of a cube has the same color. **Lighting** computes, per pixel, how much light reaches the surface and how much of it leaves toward the camera. Blinn-Phong is the standard first model, built from three terms:

- Ambient: a constant, the light that arrives from everywhere.
- Diffuse: `max(dot(N, L), 0)`, where `N` is the surface normal and `L` points toward the light.
- Specular: `pow(max(dot(N, H), 0), shininess)`, where `H` is the normalized halfway vector between `L` and the direction to the camera.

The cooker already transformed the normals into world space, so the shader uses them as they are until objects move.

A **shadow map** answers whether the light reaches a point at all. It is a depth texture rendered from the light. The frame now has three render passes, and each one reads what the one before it wrote:

![The lit frame has three render passes. The shadow pass writes the shadow map, the main pass samples it and writes the offscreen scene color, and the present pass samples the scene color and writes the letterboxed picture into the swapchain.](figures/14-three-passes.svg)

The shadow pass sees the scene from the light. In the main pass, each pixel asks the shadow map whether something nearer to the light covers it:

![Pass 1 renders the scene from the light into a depth texture. In pass 2 a pixel's world position is moved into the light's clip space, and its depth there is compared with the stored depth. The point behind the box is farther than the stored value, so it is in shadow.](figures/14-shadow-map.svg)

A directional light such as the sun uses an orthographic projection that covers the level. Like the perspective matrix of the depth step, it must map depth to [0, 1], so `z = -near` goes to 0 and `z = -far` to 1. LearnOpenGL's `glm::ortho` maps to [-1, 1] and does not work here:

```
  | 2/(r - l)   0           0              -(r + l)/(r - l)  |
  | 0           2/(t - b)   0              -(t + b)/(t - b)  |
  | 0           0           -1/(f - n)     -n/(f - n)        |
  | 0           0           0              1                 |
```

Here `l`, `r`, `b`, `t` are the edges of the light's box in light view space, and `n`, `f` its near and far distances. Choose them so the box covers the level and nothing more, since every unused texel of the shadow map costs resolution.

LearnOpenGL teaches all of this in OpenGL, and three of its conventions differ from SDL's:

- Its shader maps from [-1, 1] to [0, 1] with `* 0.5 + 0.5` for both the texture lookup and the depth. On SDL depth is already in [0, 1], so use z as it is.
- Texture y runs down on SDL while NDC y runs up, so the lookup is `u = x * 0.5 + 0.5` and `v = 0.5 - y * 0.5`.
- Its border-color trick for points outside the map becomes an explicit range check in your shader.

Make the depth texture with both the depth-target and the sampler usage flags. Give the shadow pipeline a fragment shader whose `main` is empty, since the pass writes only depth. The bias and front-face culling in the shadow pass carry over unchanged.

### Study

- [LearnOpenGL: Basic Lighting](https://learnopengl.com/Lighting/Basic-Lighting) (read, 45 min): All of it. "One last thing" covers the normal matrix. Skip the exercises.
- [LearnOpenGL: Advanced Lighting](https://learnopengl.com/Advanced-Lighting/Advanced-Lighting) (read, 15 min): The "Blinn-Phong" section, which replaces the reflection vector with the halfway vector.
- [LearnOpenGL: Shadow Mapping](https://learnopengl.com/Advanced-Lighting/Shadows/Shadow-Mapping) (read, 1 h): From "Shadow mapping" up to "PCF", and "PCF" itself only for the optional item. Read "Orthographic vs perspective" too, then stop. Translate the coordinate mapping as described above. `DepthSampler.c` from the depth step shows a depth texture bound as a sampler on SDL.

### Build

1. A Blinn-Phong fragment shader that uses the cooked normals, with one directional light and ambient. Light direction, color and shininess come from `tuning.lua`.
2. `m4_ortho_z01` in `math.c`, with unit tests next to the perspective ones: `z = -near` maps to depth 0, `z = -far` to 1, and the corners of the box map to x and y of -1 and 1.
3. The shadow pass and the shadow lookup with a slope-scaled bias. A debug key draws the shadow map in a corner of the screen.
4. A RenderDoc capture of the Windows build showing the three passes, their targets and the draw count of each. Click the Event Browser's timer button for the GPU time of each draw.
5. Profile a frame: CPU time with your profiler, GPU time per pass from the capture.

> **Optional:** Soften the shadow edges with 3 by 3 percentage-closer filtering, the "PCF" section of the shadow page, which carries over to SDL unchanged.

### Done when

Shadows touch the objects that cast them, with no acne on lit floors and no visible gap under boxes. The `m4_ortho_z01` tests pass. The capture shows the shadow pass writing depth only. You have the CPU and GPU time of a frame on Windows and can say which one limits the frame rate.

## Game two, shipped

The second game uses everything so far, in one level. A reasonable scope is a third-person or first-person game where the player runs and jumps through a level of boxes and platforms to collect items against a clock. One twist, such as a dash, a grappling point or moving platforms, is optional. Write the scope down before you start. When time runs short, cut from the list.

Movement against the level reuses the tile collision in three dimensions. The player is an axis-aligned box. The level's collision is the boxes entry of the pack, which the cooker takes from glTF nodes whose names start with `col_`, so the art and the collision come from the same file.

Move along x, then z, then y. For each axis, find the nearest box in the direction of motion within the move distance and stop short of it. With a few hundred boxes a linear scan per axis is fast enough. Measure it before you add a grid. Arbitrary triangle collision, slopes and stairs are a project of their own and outside this chapter.

A camera that follows the player turns with the mouse. Use relative mouse mode, `SDL_SetWindowRelativeMouseMode`, as for the chapter 13 fly camera, and test mouse look in the Windows build, since chapter 13's callout on WSLg mouse motion applies to the Linux build. Laptops often scale Windows to 150 percent. Create the window with `SDL_WINDOW_HIGH_PIXEL_DENSITY` and compute the letterbox from `SDL_GetWindowSizeInPixels`, so the picture uses every pixel of the window.

Game two has the title, playing and finished modes of game one, plus a paused mode. Nystrom's state chapter starts from the same `switch` over an `enum` that you wrote for game one. A pause menu that returns to the mode it came from is his **pushdown automaton**, a small stack of modes. While paused the simulation does not tick, the music volume drops and sound effects stop.

Saves go to `SDL_GetPrefPath`. Store the best time and the music and effects volumes in a small file with a version number first. A file from an older version loads with defaults for the new fields. A corrupted or truncated file loads as defaults and does not crash.

Write to a temporary name and rename it over the old file with `SDL_RenamePath`, as your build does with the game library, so a crash during a save leaves the old file intact. C's `rename` fails on Windows when the target exists, and `SDL_RenamePath` replaces it on both systems.

### Study

- [Robert Nystrom: Game Programming Patterns, State](https://gameprogrammingpatterns.com/state.html) (read, 40 min): From the start through "Enums and Switches", then "Pushdown Automata". The class-per-state sections are C++ design you do not need in C.
- [SDL3 wiki: SDL_GetPrefPath](https://wiki.libsdl.org/SDL3/SDL_GetPrefPath) (reference, as needed): The rules for the `org` and `app` strings and the paths it returns on each platform.

### Build

1. A written scope in `docs/game2.md`: the win condition, the level, the twist if you plan one, and what you will cut if time runs short.
2. 3D box collision with gravity, ground check, coyote time and jump buffer against the boxes entry of the pack. A test level of a floor and three `col_` boxes, modeled in Blender and cooked.
3. A camera that follows the player with mouse look.
4. The level: block it out in Blender with plain boxes, name the solid ones `col_`, cook it and load it. Replace the boxes with art only when the level plays well.
5. Collectibles as entities with the handles and the spawn code from game one, and a pickup sound from the pack.
6. A clock on screen with `draw_text`, and a finish trigger, a box that ends the run when the player touches it.
7. Optional: the twist from your scope.
8. Modes with a pause stack, volume keys in the pause menu, and saving and loading as above. Tests in the Linux build that load a file from an older version, a truncated file and a file of random bytes.
9. Profile one full frame of the finished level in the Windows build and write down in `docs/frame.md` where the 16.7 ms go, on the CPU and on the GPU.
10. Ship it as you shipped game one, to a second itch.io page.

### Done when

The game plays from title to finish, and the best time survives a restart. The three broken save files load as defaults. Pausing stops the clock and the simulation, and the volumes persist across launches. With immediate present mode, the Windows build draws the heaviest view of the level in less than 16.7 ms per frame, and `docs/frame.md` accounts for the frame time. Both games are public on itch.io with Windows and Linux downloads, and the Windows downloads start from a folder outside WSL.

## Where this leads

You have taken two games from an empty window to a public download, on an engine whose GPU pipeline you can explain stage by stage. You built every part twice from one source tree, as a Windows program on the real GPU and as a Linux program under the sanitizers. You have not yet written the layer under your process.

Every part of both games ran as an ordinary process. Windows or Linux created it, gave it virtual memory, scheduled its threads, and passed its commands to the GPU driver. Chapter 08 showed you those services from the user side and in xv6.

In chapter 15, A small kernel, you write them yourself. You start from a Rust binary with no standard library, boot it as a kernel on an x86-64 PC that QEMU emulates in WSL, set up interrupts and page tables by hand and switch between two tasks. The GPU returns in chapter 20, where CUDA shows you the execution model under the shaders you wrote here.
