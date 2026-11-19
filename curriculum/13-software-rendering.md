---
id: 13
title: Software rendering
part: Graphics and games
weeks: 10
project: An SDL3 platform layer with live code reload and input replay, a software rasterizer that draws clipped, depth-tested, perspective-correct textured 3D scenes and runs on AVX2 and the job system, and a multithreaded C port of Ray Tracing in One Weekend.
---

Chapter 12 ended with Kaleidoscope compiled through LLVM IR into object files that link with C. Most programs in this book so far read input, compute and write output, or answer requests on a socket. The CHIP-8 front end of chapter 06 was the exception. It opened a window through WSLg, pushed a 64 by 32 texture to it and ran a 60 Hz loop.

This chapter builds on that loop. A **pixel** is one dot of the picture, and **rendering** is computing the color of every pixel. You write a program that renders a 960 by 540 picture from a list of triangles and a camera, 60 times a second, with no graphics library between your code and the pixels. Doing that on the CPU is called **software rendering**. A **rasterizer** is the kind of renderer you build: it takes each triangle and fills the pixels the triangle covers.

Graphics is new in this book, so every graphics term is defined where it first comes up. From ML work you know vectors and matrices as arrays of numbers. Here a matrix gets a second job: it moves points, and a chain of matrices moves a 3D model onto the screen.

The program has two halves. The platform layer talks to Linux and WSLg through SDL3: window, input, timing, memory and loading code. The game is everything else, one function that the platform calls once per frame. That split lets you reload the game code while it runs and replay recorded input, two tools you build in the first two steps and use for the rest of the chapter.

Then comes the renderer: lines, triangles with exact edge rules, the transforms from a 3D model to the screen, clipping, a depth buffer and textures. You also write a ray tracer, a second way to turn geometry into pixels, and you finish by making the rasterizer fast with AVX2 and the job system. The rasterizer has no lighting, no transparency and no model files. Chapter 14 adds model files and lighting on the **GPU**, the graphics processor in your laptop, which this chapter leaves idle.

The chapter uses almost everything before it. The arenas of chapter 04 hold all memory, and shared libraries from chapter 05 make live reload possible. Chapter 07 gave you the profiler, `perf` and AVX2, chapter 08 gave you `mmap`, and chapter 09 the job system that spreads the frame across cores. Chapter 14 moves rendering to the GPU, and you will recognize each of its fixed stages, because you wrote all of them here.

## A platform layer and a frame you own

The chapter 06 front end did everything in one loop in `main`. The next step reloads the drawing code while the program runs, which needs a clean line between the code that talks to the OS and the code that draws.

Casey Muratori's Handmade Hero draws that line. The **platform layer** talks to the operating system through SDL3 for the window, input, time, memory and showing the picture. The **game** is one function that the platform calls once per **frame**, one pass of the loop that produces one picture:

```c
void game_update_and_render(GameMemory *memory, GameInput *input, Framebuffer *fb);
```

The game never calls the OS. Everything arrives as arguments, and the game writes its results into memory it was given.

![The platform layer calls SDL3 and owns the window, input, time and memory. Each frame it fills GameInput and calls the game with GameInput, GameMemory and the frame buffer. The game writes pixels into the frame buffer and the platform presents it.](figures/13-platform-game.svg)

A **frame buffer** is the block of memory that holds one picture. Each pixel is one `uint32_t` in SDL's `XRGB8888` format from chapter 06, `0x00RRGGBB`. This time the game writes straight into the texture's own memory. `SDL_LockTexture` hands you a pointer and a **pitch**, the number of bytes from the start of one row to the start of the next. A row may end in padding, so the pitch can be larger than `width * 4`. Find the row from the pitch, then index the row by `x`:

```c
uint32_t *row = (uint32_t *)((char *)fb->pixels + y * fb->pitch);
row[x] = color;
```

![The frame buffer is rows of 32-bit pixels. Each row holds width times 4 bytes of pixels and may end in padding. Pitch is the number of bytes from one row start to the next, so pixel (5, 2) lives at pixels plus 2 times pitch plus 5 times 4.](figures/13-pitch.svg)

Memory follows the arena rules of chapter 04. The platform calls `mmap` once at startup, as your chapter 08 `malloc` did, and splits the block in two:

- The **permanent** part holds the game's state for the whole run. The game casts its start to a `GameState` and builds its arenas from the rest.
- The **transient** part is scratch space that the game may reset every frame.

`mmap` returns zeroed memory, so a `bool initialized` field in `GameState` starts false and tells the game to set itself up on the first call. Nothing in the frame loop calls `malloc`.

Input arrives as plain data. `GameInput` holds `dt`, the seconds since the last frame, the mouse motion of this frame, and one record per button: `{ bool down; int transitions; }`. The platform zeroes `transitions` each frame and counts every key down and key up into it, so a press and release inside one frame still reaches the game. Cap `dt` as you capped the accumulator in chapter 06, so a pause in gdb does not produce one giant step.

Under WSLg, `SDL_RenderPresent` goes through the compositor and RDP of chapter 06, so its timing is rougher than on a native display. Measure your own code on its own with `SDL_GetTicksNS`, read at the start of the frame, before `SDL_RenderPresent` and after it:

![One pass of the frame loop on a time line. Work runs from t0 to t1. Present runs from t1 to t2 and waits for the display, which under WSLg also goes through the compositor and RDP. The frame interval runs from one t0 to the next.](figures/13-frame-timing.svg)

The **work time** is what has to fit in the 16.7 ms budget of a 60 Hz frame. The present time and the interval tell you what WSLg does on your machine.

> **Practice:** Write each conversion between an integer and a `float` as a cast, such as `(float)x`, and each `float` constant with an `f`, as in `0.5f`. Call `sinf`, `cosf` and `sqrtf`, the `float` versions of the math functions. Renderer code mixes these types on almost every line, and `-Wconversion` and `-Wdouble-promotion` from chapter 01 stop the build at each quiet conversion.

### Study

- [Handmade Hero day 011: The Basics of Platform API Design](https://guide.handmadehero.org/code/day011/) (watch, 50 min): From 11:23 "Topic of the day revealed!" to 1:01:00, where the Q&A starts. Casey works in C-style C++ on Windows. Watch for the shape of the boundary and ignore the Windows calls. Note the question at 1:03:22 about threading in the platform layer. It comes back in the last step of this chapter.
- [Handmade Hero day 014: Platform-independent Game Memory](https://guide.handmadehero.org/code/day014/) (watch, 15 min): From 17:25 "Adding memory to the platform abstraction" to 28:40 "Put it where you want it", plus his answer at 1:04:13 on permanent and transient storage. He gets memory with the Windows call `VirtualAlloc`. You use `mmap` with a null address and `MAP_PRIVATE | MAP_ANONYMOUS`, as in chapter 08.
- [SDL3 wiki: SDL_LockTexture](https://wiki.libsdl.org/SDL3/SDL_LockTexture) (reference, as needed): The `pitch` parameter and the remark that the locked memory is write-only and may not hold last frame's pixels. Look up the other functions in the API by name page from chapter 06: `SDL_UnlockTexture`, `SDL_SetRenderLogicalPresentation`, `SDL_GetTicksNS` and `SDL_DelayNS`.

### Build

1. `src/game.h`: `Framebuffer { uint32_t *pixels; int32_t width, height, pitch; }` with the pitch in bytes, `GameButton`, `GameInput` with `dt`, `mouse_dx`, `mouse_dy`, a fixed set of buttons (W, A, S, D, arrows, space, mouse left) and `last_work_ns`, and `GameMemory` with the two blocks and their sizes. Also the prototype of `game_update_and_render`.
2. `src/game.c`: a `GameState` with a time counter and a square's position. Draw a gradient that scrolls over time and a 20 by 20 square that WASD moves at 200 pixels per second, scaled by `dt`. Start `game.c` with `#include "base.c"`, your chapter 04 library, so the game builds its arenas with the code you already trust. Beyond that, the game includes only `game.h` and C standard headers.
3. `src/platform_sdl.c`: `#include "game.c"` for now. Map 64 MB permanent and 256 MB transient memory with one `mmap`. Open a resizable 1280 by 720 window and create a 960 by 540 streaming texture with nearest scaling. `SDL_SetRenderLogicalPresentation(renderer, 960, 540, SDL_LOGICAL_PRESENTATION_LETTERBOX)` scales the picture to fit any window size and fills the leftover space with bars. Turn vsync on.
4. Run the frame loop with the three timestamps from the figure. Put the last work time into `GameInput`. Once per second, print the median and the maximum work time, the median present time and the median frame interval.
5. If vsync does not wait on your machine, as chapter 06 showed you, sleep for the rest of the 16.7 ms with `SDL_DelayNS` at the end of the frame, so the loop does not keep a core busy.
6. Build with `LIBS="$(pkg-config --cflags --libs sdl3)" sh build.sh platform_sdl` and run it.
7. `src/pitch_test.c`: call `game_update_and_render` on a frame buffer whose pitch is `width * 4 + 64`, with the 64 padding bytes of every row filled with `0xAB`. After three frames every padding byte must still be `0xAB`. Build it with `sh build.sh pitch_test`, which keeps the sanitizers on.

### Done when

- The window shows the moving gradient on the Windows desktop, and the square follows WASD at the same speed whatever the window size. Resizing letterboxes the picture without stretching it.
- The once-per-second line shows a work time well under 16.7 ms. You have written down your median present time and frame interval, and you can say which of the three numbers your code controls.
- `pitch_test` passes with no sanitizer report.
- `grep -n 'SDL\|malloc' src/game.c` prints nothing.

## Live code reload and input replay

Every change so far costs a restart, and a restart throws away the state you were looking at. **Live code reload** replaces the game's code while the program runs and keeps its state.

Handmade Hero day 021 moves the game into a shared library, which chapter 05 built with `-fPIC` and `-shared`. The platform loads it itself with three calls from `<dlfcn.h>`:

- `dlopen(path, RTLD_NOW)` maps the library into the process and returns a **handle**, a pointer that names the loaded library in later calls. `RTLD_NOW` resolves every symbol at once, so a missing one fails here and not in the middle of a frame.
- `dlsym(handle, "game_update_and_render")` returns the function's address, which the platform stores in a function pointer.
- `dlclose(handle)` unmaps the library again.

When you rebuild the library, the platform closes the old one and loads the new one between two frames. All state lives in `GameMemory`, which belongs to the platform, so the new code continues where the old code stopped:

![On F5 the platform copies the freshly built game.so to game_loaded_2.so, opens it with dlopen, points its function pointer at the new game_update_and_render and closes game_loaded_1.so. GameMemory belongs to the platform and stays mapped, so the new code continues from the same state.](figures/13-reload.svg)

Three details decide whether reloading works:

- Linux's `dlopen` returns the handle it already has when you open a path that is still loaded, even after the file on disk was replaced. So copy `game.so` to a new name each time, such as `game_loaded_7.so`, open the copy, and only then close the old one. Casey copies his library for a different reason, because Windows locks a loaded file, and the fix is the same.
- The build must never leave a half-written library where the platform looks. Link to `game.tmp.so`, then `mv` it to `game.so`. A rename within one directory replaces the file in one step.
- Nothing in game memory may point into the library. Function pointers and string literals live in the library's own pages, which are gone after `dlclose`. `static` variables inside `game.c` belong to the library too, and the new library starts with fresh copies. Casey moves his local statics into the game state for that reason.

The platform reloads when you press F5, so you decide when the new code takes over. If the load fails, print `dlerror()`, which returns a string that describes the last failed `dl` call, and keep running the old code. Before the first load succeeds, the platform calls a **stub**, a placeholder function of the same type that only clears the screen.

Day 023 adds the second tool, input replay. Press L and the platform copies the whole permanent block into a snapshot and starts appending each frame's `GameInput` to a recording. Press L again and it restores the snapshot and feeds the recorded inputs back, frame by frame, in a loop.

`dt` is part of the input, so playback runs the same arithmetic as the recording, whatever the real frame times. Combine the two tools and you can loop five seconds of play, change a constant, rebuild and see the change in the same five seconds. Casey writes the snapshot and the recording to files. Keep yours in memory, in one extra `mmap` at startup with room for one copy of the permanent block plus 600 `GameInput` records, ten seconds at 60 frames per second.

> **If it fails:** If `dlopen` reports `undefined symbol: __asan_register_elf_globals` or another `__asan_` name, the library was built with the sanitizers and the platform without them. Build both in the same mode, both debug or both release.

### Study

- [Handmade Hero day 021: Loading Game Code Dynamically](https://guide.handmadehero.org/code/day021/) (watch, 1 h): From 1:29 to 1:02:00. The stretch from 31:00 to 47:27 is about Windows build flags and exports, and you can watch it fast. Keep the ideas: a function type declared once and used on both sides, a stub when loading fails, state moved out of local statics, and the copy before loading.
- [Handmade Hero day 023: Looped Live Code Editing](https://guide.handmadehero.org/code/day023/) (watch, 40 min): From 16:52 "Problems with gameplay tuning and a solution" to 54:50, where he starts on transparent windows. He stores the recording in files through Windows calls. Store yours in memory.
- [CMU 15-213 Fall 2025: Linking](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/07-linking.pdf#page=42) (read, 10 min): PDF pages 42 to 44, the run-time linking slides that chapter 05 told you to skip. The example uses `dlopen`, `dlsym`, `dlerror` and `dlclose` on a Linux `.so`, as you do here.

### Build

1. Extend `build.sh`: when the environment variable `LIB` is set, compile `src/$name.c` with `-fPIC -shared` into `$out/$name.tmp.so`, `mv` it to `$out/$name.so` and stop. `LIB=1 sh build.sh game` then writes `out/Linux-debug/game.so`. Keep the sanitizer flags in debug builds of both the library and the platform.
2. In `game.h`, declare `typedef void GameUpdateAndRender(GameMemory *, GameInput *, Framebuffer *);`. The platform holds a pointer of that type, set to the stub when no library is loaded. Remove `#include "game.c"` from the platform.
3. Write `load_game(n)` in the platform: copy `game.so` to `game_loaded_<n>.so` with `fopen`, `fread` and `fwrite`, `dlopen` the copy with `RTLD_NOW`, look up the function, and on success `dlclose` the previous handle. F5 calls it. Print the load count and any error.
4. Recording and playback on L, as above. At the start and at the end of each playback pass, print an FNV-1a hash of the permanent block. You typed the 32-bit FNV-1a into clox in chapter 11. Use the 64-bit version here: start a `uint64_t` at 14695981039346656037, then for each byte xor the byte in and multiply by 1099511628211.
5. Record five seconds of moving the square. While it loops, change the gradient colors in `game.c`, run `LIB=1 sh build.sh game` in a second terminal and press F5.
6. Plant a bug: add `const char *label` to `GameState`, set it to a string literal on the first frame, and print the string and the pointer's value with `%p` every second.
7. Start the platform in gdb with `gdb out/Linux-debug/platform_sdl` and `run`. Before any reload, press Ctrl-C in the terminal to stop the program. `info proc mappings` lists every mapping of the process with its permissions and the file it comes from. `r--p` means readable, not writable, not executable and private to this process. Find the `r--p` mapping of the loaded `game_loaded_<n>.so` that holds the printed pointer.
8. Type `continue`, change a line of `game.c`, rebuild and press F5. The most likely result is a crash. The next print reads the old address, the old library is no longer mapped, and gdb stops by itself with `SIGSEGV` in a `strlen` that `printf` called. Run `info proc mappings` again and look for the address.

### Done when

- A rebuild plus F5 changes the picture within a second, and the square keeps its position.
- Every playback pass prints the same end hash, also after a reload that did not change the movement code.
- `nm -u out/Linux-debug/game.so | grep SDL` prints nothing. `nm -u` lists the symbols a file needs from elsewhere, so the game needs nothing from SDL.
- With the planted bug the program crashes at the first reload. You can say which library's mapping held the address before the reload, that no mapping holds it after, and why the read faults. The program prints another library's text or garbage instead only when a later load happens to place a library over the old address.

## Lines, rectangles and image files

The game still draws only a gradient and a square. Before triangles, write the 2D tools you will debug everything else with. Rectangles draw a frame-time graph. Lines draw wireframes and debug markers. Image files give you screenshots for tests, a viewer, and later the textures and the ray tracer's output.

A rectangle is two loops, over x from `x0` to `x1` and over y from `y0` to `y1`, after you clamp both ranges to the buffer. Each range is **half-open**, written `[x0, x1)`: it includes `x0` and stops before `x1`, so a rectangle from 0 to 10 is 10 pixels wide.

A line needs more care, because it has to pick which pixels best approximate a thin slanted line. **Bresenham's algorithm** steps one pixel at a time along the longer axis and decides with an integer error term when to step along the other axis. Sokolov's lesson builds it in four attempts.

Two properties make a good test: `line(a, b)` and `line(b, a)` light the same pixels, and a line lights exactly `max(|dx|, |dy|) + 1` pixels. For now, skip pixels outside the buffer one at a time. Clipping comes in a later step.

Chapter 06 compared the CHIP-8 display as text with golden files. Here the golden files are images in the **PPM** format, the color version of the PGM files you wrote for the Mandelbrot images in chapter 09: a short text header and then raw RGB bytes, row by row from the top.

```
  P6\n960 540\n255\n          header: magic, width, height, maxval
  R G B R G B R G B ...       width * height * 3 bytes, no row padding
```

**maxval** is the largest value a channel can hold, 255 when each channel is one byte. To write a PPM file, drop the unused top byte of each `XRGB8888` pixel. To read one, parse the header, which may contain `#` comments, into an `Image { uint32_t *pixels; int32_t width, height; }` in the permanent arena.

A **headless** runner, a program with no window, turns this into a test. `src/render_test.c` includes `game.c`, maps memory, and runs the game for a number of frames with scripted input and a fixed `dt` of 1/60 s. Then it writes the frame buffer to a PPM file. A scene number in the game state selects what to draw, so one runner covers every test scene in the chapter.

Exact comparisons need one more build flag. Chapter 07 added `-mfma` to `build.sh`, and with it clang turns `a * b + c` inside one statement into one fused multiply-add, which rounds once instead of twice. Your AVX2 code will round twice. `-ffp-contract=off` stops clang from fusing, so the same C gives the same bits in every build.

> **Practice:** A renderer change is done when every golden image still passes. Save a new golden image only after you have looked at it.

### Study

- [Dmitry Sokolov, tinyrenderer: Bresenham's line drawing algorithm](https://haqr.eu/tinyrenderer/bresenham/) (read, 40 min): From the start through "Round 4, postscriptum". Skip "Homework: wireframe rendering", which needs his model loader. His code is C++ and writes TGA image files. Yours writes into your frame buffer.
- [Netpbm: PPM format specification](https://netpbm.sourceforge.net/doc/ppm.html) (reference, as needed): "THE FORMAT" and "Minimal Subset". Write files in the minimal subset, with maxval 255. Accept comments when you read.

### Build

1. Add `-ffp-contract=off` to both flag lines of `build.sh` and to `tests/run_test.sh`.
2. In `game.c`: `draw_rect(fb, x0, y0, x1, y1, color)` and `draw_line(fb, x0, y0, x1, y1, color)` with integer endpoints.
3. A frame-time graph: the game keeps the last 240 values of `last_work_ns` in `GameState` and draws them as bars along the bottom of the screen, with a line at 16.7 ms.
4. `ppm_write(FILE *, Framebuffer *)` and `Image ppm_read(Arena *, FILE *)`, plus `draw_image(fb, image, dst_x0, dst_y0, dst_x1, dst_y1)` that scales with nearest sampling: each destination pixel copies the source pixel its position falls in. F12 in the platform saves a screenshot.
5. `src/render_test.c` with three scenes: a fan of 64 lines from the center, rectangles that cross every edge of the buffer, and a loaded test image drawn at three scales. A unit test checks the two line properties above for 1000 random endpoint pairs.
6. `src/ppmdiff.c`: compares two PPM files, prints the number of differing pixels and the largest channel difference, and writes a third image that is black where they agree and white where they differ. `tests/run_images.sh` renders every scene, compares each with its golden file in `tests/golden/` and exits with 1 on any difference.
7. A viewer mode: when the platform gets a PPM path on the command line, the game shows that image. Install the Netpbm tools with `sudo apt install -y netpbm`, convert a photo of your own with `pngtopam photo.png > photo.ppm`, and view it.

### Done when

- The line properties hold for all 1000 pairs.
- `sh tests/run_images.sh; echo $?` prints 0, the debug build has no sanitizer report, and the debug and release builds produce identical images.
- Change one pixel of a golden file and the script fails, and `ppmdiff` points at the pixel.
- The frame-time graph shows in the window, and a 10 ms busy loop that you add to the game for a test shows up as taller bars crossing the 16.7 ms line.

## Triangles: edge functions and fill rules

The lines of the last step outline shapes. A renderer fills them, and every surface in this chapter is built from triangles. Filling a triangle means deciding, for every pixel center, whether it lies inside.

An **edge function** answers that for one edge. For an edge from `a` to `b` and a point `p`:

```
  E(a, b, p) = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
```

`E` is positive on one side of the line through `a` and `b`, negative on the other side and zero on the line. A triangle is the region on the inner side of all three of its edges, so a pixel is inside when all three edge functions agree in sign:

![Left: the edge function of an edge from a to b is positive on one side of the line, negative on the other side and zero on the line. Right: a point is inside the triangle when the edge functions of all three edges are positive.](figures/13-edge-function.svg)

The same three numbers do a second job. Divided by the triangle's doubled area, they are the **barycentric weights** of the pixel: three numbers that add up to 1 and say how close the pixel is to each corner. A value at the pixel, such as its color, is the weighted sum of the values at the corners. Computing a value between known points this way is **interpolation**.

![A point p inside a triangle splits it into three smaller triangles. The weight of v0 is the area of the small triangle opposite v0 divided by the whole area. Here p has weights 0.5, 0.3 and 0.2, and its color is the weighted sum of the corner colors.](figures/13-barycentric.svg)

Giesen's first post derives all of that. His second turns it into a rasterizer: loop over the triangle's **bounding box**, the smallest rectangle of pixels around it, test each pixel, and handle three details that decide whether the result is right:

- **Fixed point** stores a number as a whole count of small fixed units. Snap vertex positions to 1/16 of a pixel, store them as integers, and do the edge math in integers. Every sum and product is then exact, and two triangles that share an edge compute exactly opposite values along it. Giesen shows that 32-bit edge functions stay exact for inputs in [-16384, 16383], which at 1/16 pixel is ±1024 pixels. Put the origin at the center of the screen and even a 1920 by 1080 frame fits.
- **Orientation.** Giesen's pictures have y pointing up, and your screen has y pointing down, which flips the sign of `E` for a triangle that looks the same. Do not convert anything. If `E(v0, v1, v2)` is negative, swap `v1` and `v2`, and if it is zero, draw nothing. Every triangle then reaches the loop with a positive area.
- **The fill rule.** A pixel center that lies exactly on an edge shared by two triangles must go to exactly one of them. Giesen's top-left rule does that with one bias per edge, 0 for an edge the rule accepts and -1 for the others.

```
  pixel coordinates, y down, 4 fraction bits, origin at the screen center
      X = round((x - width/2) * 16)
      Y = round((y - height/2) * 16)
  pixel (px, py) is sampled at its center
      ((px - width/2) * 16 + 8,  (py - height/2) * 16 + 8)
  an edge from a to b gets bias 0 when, after the swap,
      is_top_left(a, b) = (a.y == b.y && b.x < a.x) || b.y < a.y
```

Giesen states the rule in words, and with y down the words can be read two ways, so use the numeric version. On screen it accepts the bottom and left edges instead of the top and left ones. Any rule passes the test below as long as every shared edge goes to exactly one side.

![A square of two triangles with its corners and its diagonal on pixel centers. The centers on the shared diagonal go to A only, the top and right edges draw no pixels, and the square covers 36 pixels with none drawn twice.](figures/13-top-left.svg)

To test coverage, draw into a buffer of counters instead of colors. Each covered pixel adds 1 to its counter. A grid of quads that tiles the screen must leave every counter at exactly 1.

### Study

- [Fabian Giesen: The barycentric conspiracy](https://fgiesen.wordpress.com/2013/02/06/the-barycentric-conspirac/) (read, 40 min): All of it. The post sets up the orientation test, edge functions as signed areas, and barycentric interpolation. Giesen wrote the series about the software rasterizer in Intel's Software Occlusion Culling demo, while he worked at RAD Game Tools.
- [Fabian Giesen: Triangle rasterization in practice](https://fgiesen.wordpress.com/2013/02/08/triangle-rasterization-in-practice/) (read, 40 min): All of it. His loop samples at integer coordinates. Yours samples at pixel centers, which is the `+ 8` above. Use the numeric `is_top_left` above in place of his description in words.

### Build

1. `draw_triangle(Framebuffer *, const Vertex2 v[3])`, where a `Vertex2` has float `x`, `y` in pixels and float `r`, `g`, `b`. Snap to fixed point, fix the orientation, compute the three biases, clamp the bounding box to the buffer and loop. Interpolate color with weights computed from the unbiased edge values divided by the area.
2. A coverage mode that adds 1 to a `uint8_t` counter per pixel in place of writing color.
3. Coverage tests in `render_test.c`:
   - A 12 by 8 grid of quads over the whole screen, with interior vertices moved by up to 6 pixels at random, alternating the diagonal direction, and some vertices placed exactly on pixel centers.
   - A fan of 64 triangles around the screen center.
   - A 64 by 64 pixel square made of two triangles, with corners on pixel centers.
   - A triangle whose three vertices lie on one line.
4. A color scene: one large triangle with red, green and blue corners, as a golden image.
5. Sub-pixel motion: a thin triangle that moves 1/20 pixel per frame. Add a key that rounds vertices to whole pixels before the fixed-point step, and compare the two motions in the window.

### Done when

- Every counter in the grid and fan tests is exactly 1, the square covers exactly 4096 pixels, and the collinear triangle covers none.
- The color golden passes.
- With whole-pixel rounding the thin triangle jumps every twenty frames, and without it the triangle moves smoothly.
- You can say which pixels would be drawn twice if every bias were 0, and which would be missing if every bias were -1.

## Matrices that move points

So far every vertex arrived in pixels. A 3D model arrives in its own coordinates: a cube might have its corners at ±1 around its own center. Before you can draw it, something has to turn it, size it and put it somewhere. This step does that with matrices.

A **vector** here is a point or a direction, written as its coordinates `(x, y, z)`. A **transform** is a function that moves every point of a model the same way: a **rotation** turns it around an axis, a **scaling** makes it larger or smaller, and a **translation** shifts it. Rotation and scaling are each a 3 by 3 matrix times the vector, the matrix-vector product you know from ML code. Translation is an addition, and a 3 by 3 matrix cannot add a constant.

**Homogeneous coordinates** fix that. Give each point a fourth coordinate `w = 1` and use 4 by 4 matrices. The last column of a 4 by 4 matrix then gets multiplied by that 1, so it adds a constant, and translation becomes a matrix too. This matrix moves a point 5 units along x:

```
  | 1 0 0 5 |   | x |   | x + 5 |
  | 0 1 0 0 | * | y | = | y     |
  | 0 0 1 0 |   | z |   | z     |
  | 0 0 0 1 |   | 1 |   | 1     |
```

The first row gives `1*x + 0*y + 0*z + 5*1`, and the last row keeps `w` at 1. Every transform is now one kind of object, and transforms compose by matrix multiplication: `M = T * R * S` scales first, then rotates, then translates, because the matrix nearest the vector applies first.

The chain from a model to the screen has six spaces. A **space** is a choice of origin and axes that coordinates are measured in. This step covers the first two and the last one. The next step adds the camera and perspective in the middle:

![A vertex goes through six coordinate spaces. The model matrix moves it from the model's own coordinates into the world, the view matrix into camera space, and the projection matrix into clip space. Dividing by w gives normalized device coordinates, and the viewport turns those into pixels.](figures/13-spaces.svg)

- **Model space** is the model's own coordinates. The **model matrix** places the model in **world space**, the shared coordinates of the whole scene.
- The **viewport** transform maps x and y from [-1, 1] to pixels, with y flipped so it points down. For this step, draw world x and y straight through the viewport and ignore z. That flattening is an **orthographic** view, as if the camera were infinitely far away.

A model is a **mesh**: an array of vertices and an array of triangles that index into it, which Lisitsa's "Indexed rendering" explains. A cube whose faces have their own colors needs 24 vertices, 4 per face, because a vertex carries one color.

Write your conventions down before you write a matrix function, because every source picks its own and few say which. Mixed conventions cause most bugs in the next two steps:

```
  handedness     right-handed: +X right, +Y up, +Z toward the viewer,
                 so the camera will look down -Z
  vectors        column vectors, matrix * vector
  storage        float m[4][4], m[row][col]
  front faces    counterclockwise as the viewer sees them, with y up
  screen         y down, so front faces arrive with E(v0, v1, v2) < 0
```

A triangle's **winding** is the direction its vertices go around, clockwise or counterclockwise. The last line gives you **back-face culling** for free. On a closed mesh such as a cube, the triangles facing away from the viewer are hidden behind the others. They wind clockwise as the viewer sees them, so after the y flip their `E` is positive. Skip a triangle whose `E` is positive, before the swap from the last step, and about half the triangles are never drawn.

### Study

- [LearnOpenGL: Transformations](https://learnopengl.com/Getting-started/Transformations) (read, 45 min): From "Vectors" through "Combining matrices". Skim the parts you know from ML work, but read "Cross product", "Scaling", "Translation", "Rotation" and "Combining matrices" closely. Stop at "In practice", which is about GLM and OpenGL. LearnOpenGL is Joey de Vries' free OpenGL book, and these sections hold only the math.
- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 4: Changing perspective](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-4.html) (read, 25 min): "Viewport", "Indexed rendering", "3D transformations" and "The Cube". Stop at "Perspective projection: theory", which is the next step's reading. Lisitsa teaches OpenGL at a university and wrote this series to show what the GPU does. His code is C++ around his own rasterizer, so take the math and the order of operations, and use your rasterizer from the last step in place of his.

### Build

1. `src/math.c`, included by `game.c`: `V3`, `V4`, `M4` and the functions `m4_mul`, `m4_mul_v4`, `m4_translate`, `m4_scale`, `m4_rotate_x`, `m4_rotate_y`, `m4_rotate_z`, plus `v3_cross`, `v3_dot`, `v3_normalize`. Write `docs/conventions.md` first.
2. `sinf` and `cosf` live in the math library, so add `-lm` to `LIBS` for every program and library that includes `game.c`, as you did for the haversine code in chapter 07. Without it the release build fails to link with an `undefined reference` to `sinf`. The debug build links anyway, because the sanitizer runtime pulls the math library in.
3. Unit tests: `m4_rotate_z(π/2)` maps (1, 0, 0) to (0, 1, 0) within 1e-6. Translate-then-rotate and rotate-then-translate give different results for the same point, and you can predict both on paper first.
4. An indexed mesh type with a vertex array and an index array. A cube with 24 vertices and a color per face.
5. Draw the cube spinning, scaled by 0.5 in the model matrix so that it spans half the screen height: model matrix, viewport, cull, rasterize. A key toggles culling.
6. A key toggles a wireframe drawn with `draw_line` over the filled faces.

### Done when

- The math tests pass, and your two predictions match.
- With culling on, the spinning cube looks solid. With culling off, back faces paint over front faces in some orientations.
- You can point to the line of `docs/conventions.md` that decides the sign of the culling test.

## A camera and perspective

The cube spins, but it looks flat. A far edge is drawn as large as a near one. This step adds a camera and perspective, the two middle links of the chain.

A **camera** is a position and a direction to look in. The **view matrix** moves the whole world so the camera sits at the origin and looks down -Z, which is **view space**. LearnOpenGL builds it with a function called look-at, from the camera position, a point to look at and a direction that counts as up.

In **perspective**, things look smaller the farther away they are. The camera sees a **view frustum**, a pyramid with its tip cut off: four sides set by the **field of view**, the opening angle, plus a **near plane** and a **far plane** that bound the distances drawn.

The **projection matrix** maps the frustum into **clip space**. It copies the distance in front of the camera, `-z`, into `w`. The **perspective divide** then divides `x`, `y` and `z` by `w`, so a point twice as far away lands half as far from the center. The result is **normalized device coordinates**, NDC, where everything visible lies in [-1, 1] on all three axes:

![Side view. The view frustum is the part of space the camera sees, between the near and the far plane. Points P1 and P2 have the same height, but P2 is farther away. After the divide by w the frustum becomes a box from -1 to 1, and P2 lands closer to the middle, so it looks smaller.](figures/13-frustum.svg)

The full chain is now `clip = projection * view * model * v`, then the divide, then the viewport. Add these lines to `docs/conventions.md`:

```
  NDC            x, y, z all in [-1, 1], y up (the OpenGL convention)
  projection     the near plane maps to z = -1, the far plane to z = +1
```

Two problems remain until the next step, and you should see both. A vertex behind the camera has a negative `w`, and dividing by it flips the vertex to the other side of the screen. A vertex very close to the camera can land far outside the screen, past the range where your 32-bit edge functions are exact. For now, drop any triangle with a vertex whose `w` is less than the near distance, or whose fixed-point coordinates leave [-16384, 16383].

### Study

- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 4: Changing perspective](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-4.html) (read, 25 min): "Perspective projection: theory" and "Perspective projection: implementation", the rest of the post from the last step. In the implementation listing, two lines swap `v1` and `v2` by mistake. Divide each vertex by its own `w`.
- [LearnOpenGL: Camera](https://learnopengl.com/Getting-started/Camera) (read, 15 min): "Camera/View space" and "Look At". Stop at "Walk around", which the next step assigns. The page uses GLM, a C++ math library, whose `glm::lookAt` and `glm::cross` are your `m4_look_at` and `v3_cross`.

### Build

1. Add `m4_perspective(fovy, aspect, near, far)` and `m4_look_at(eye, target, up)` to `math.c`. `fovy` is the vertical field of view in radians and `aspect` is width divided by height.
2. Unit tests: the projection maps a point at `z = -near` to NDC z = -1 and one at `z = -far` to +1. `m4_look_at(eye, target, up)` maps `eye` to the origin and `target` onto the negative z axis.
3. Draw the spinning cube through the whole chain, with the two temporary checks.
4. W and S move the eye toward the cube and away from it along the line between them, with the speed scaled by `dt`.
5. A golden scene with a fixed camera and a fixed rotation angle.

### Done when

- The math tests pass.
- The cube spins with correct perspective at any window size.
- The golden passes.
- When you move the eye into the cube with W, triangles disappear abruptly, and you can say which of the two temporary checks removed each one.

## A fly camera and clipping

To see clipping work, you need to move freely through a scene. LearnOpenGL's fly camera does that. Mouse motion turns the camera by two angles, **yaw** to the left and right and **pitch** up and down, and WASD moves it along its own axes. SDL's relative mouse mode, `SDL_SetWindowRelativeMouseMode`, hides the cursor and reports raw motion in the `xrel` and `yrel` fields of each motion event. That replaces the GLFW cursor callback the page uses.

> **If it fails:** Under WSLg, mouse motion reaches Linux through the remote desktop connection, and relative mode may report no motion. Start the program with `SDL_VIDEO_DRIVER=x11` in front of the command, or with `SDL_VIDEO_DRIVER=wayland`, as in chapter 06. If the camera still does not turn, turn it with the arrow keys, which the camera supports anyway.

The two temporary checks throw away whole triangles that are partly visible. **Clipping** cuts a triangle to the part inside the **view volume**, the frustum as it looks in clip space, instead. Do it in clip space, before the divide, where the volume is six inequalities: `-w <= x <= w`, `-w <= y <= w` and `-w <= z <= w`. Write each one as a signed distance `d` that is not negative inside: `x + w`, `w - x`, `y + w`, `w - y`, `z + w`, `w - z`. A point behind the camera fails `z + w >= 0`, so the near plane removes it before the divide can flip it.

Clip a triangle as a polygon, one plane at a time. That method is called the **Sutherland-Hodgman algorithm**. Walk the polygon's edges. For each directed edge from `a` to `b`, with signed distances `da` and `db`:

| a | b | emit |
| --- | --- | --- |
| inside | inside | `b` |
| inside | outside | `crossing(a, b)` |
| outside | inside | `crossing(b, a)`, then `b` |
| outside | outside | nothing |

```
  crossing(in, out):  t = d_in / (d_in - d_out),  P = in + t * (out - in)
                      and the same t for every attribute: color, later u and v
```

![Triangle a, b, c with vertex a on the wrong side of the near plane. Clipping keeps b and c and adds the two points where the edges cross the plane. The result is a polygon of four vertices in the order new 1, b, c, new 2, drawn as two triangles fanned from new 1, the first vertex the clipper emits.](figures/13-near-clip.svg)

Each plane can add at most one vertex, so a triangle clipped by six planes has at most 9. Split the result into triangles as a fan from its first vertex. After all six planes every vertex satisfies `|x|, |y| <= w`, so every fixed-point coordinate lies inside the viewport. That replaces both temporary checks.

Clipping can open cracks between triangles that share an edge. Two neighbors walk the shared edge in opposite directions, and in floating point the crossing from `a` toward `b` can differ in the last bit from the crossing from `b` toward `a`. The `crossing` above always starts at the inside vertex. Both triangles then do the same arithmetic on the same inputs and get the same point.

### Study

- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 5: Fixing issues with 3D](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-5.html) (read, 40 min): "Clipping" through "Clipping a triangle: testing". Stop at "Perspective-correct interpolation: the problem", which the textures step assigns. He shows two methods, one case per sign pattern and then Sutherland-Hodgman, and he clips against the near and far planes only. Take his equations and test scenes, and write the polygon version above against all six planes.
- [LearnOpenGL: Camera](https://learnopengl.com/Getting-started/Camera) (read, 25 min): "Walk around" through "Mouse input", the rest of the page from the last step. Skip "Zoom" and "Camera class".

### Build

1. The fly camera, with the movement speed scaled by `dt`. Mouse motion and the arrow keys both turn it. A key turns relative mouse mode on and off, so you can get the cursor back. Fly through the cube with the two temporary checks still in place and watch triangles vanish.
2. `int clip_polygon(ClipVertex *v, int n)`, where a `ClipVertex` holds the clip-space position and the attributes. It works in place in an array of 9, with a scratch array of 9. One function clips by one plane, and a loop calls it for all six.
3. Unit tests on clip-space triangles:
   - Wholly inside comes back unchanged. Wholly outside one plane gives 0 vertices.
   - Crossing the near plane with one vertex behind it gives 4 vertices, and with two behind it gives 3.
   - A huge triangle that crosses all six planes gives at most 9 vertices, each within `|x|, |y|, |z| <= w (1 + 1e-6)`.
4. Remove the temporary checks.
5. Scenes, each with a golden: the camera inside a cube with culling off (Lisitsa's first clipping test), a cube cut by a near plane set through its center, and a large floor quad that passes under and behind the camera.
6. A coverage test in 3D: a 16 by 16 grid of quads on a plane that crosses the near plane at an angle, in coverage mode, with culling off.

### Done when

- The clip tests pass.
- Flying through the cube and over the floor never shows a triangle stretched across the screen, and no triangle vanishes until it is fully behind you.
- Every counter in the 3D grid test is exactly 1.
- You can say what the screen showed before clipping when a vertex had a negative `w`, and why.

## The depth buffer

Back-face culling was enough for one cube, because the front faces of a cube never overlap on screen. With several objects they do, and whichever triangle is drawn last covers the others, near or far. The **depth buffer** solves that. It holds one number per pixel, the depth of the nearest surface drawn there so far:

![The depth buffer starts at 1.0, the far value. The near triangle, depth 0.3, is drawn first and stores 0.3. The far triangle, depth 0.7, comes second and passes the test only where the stored depth is larger, so on the pixels it shares with the near triangle 0.7 is rejected and 0.3 stays.](figures/13-depth-buffer.svg)

Clear it to 1.0f every frame. A pixel is drawn only if its depth is less than the stored one, and then it stores its own.

For the depth, use NDC `z` interpolated with the plain barycentric weights, and store `z * 0.5f + 0.5f`, a `float` in [0, 1]. NDC `z` changes linearly across the screen, so plain weights are exact for it. Lisitsa's part 6 interpolates depth with the perspective-correct weights of the next step. Those are right for colors and texture coordinates and wrong for NDC `z`.

Keep the near plane at 0.1 or more. NDC `z` spends most of its precision close to the near plane, and with a smaller near distance two distant surfaces get the same depth and flicker through each other, which is called **z-fighting**.

### Study

- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 6: Adding some depth](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-6.html) (read, 25 min): All of it. Interpolate depth with the plain weights, as explained above. His list of depth test modes is more than you need. Implement LESS, the less-than test.

### Build

1. A `float` depth buffer next to the frame buffer, cleared to 1.0f each frame, and the LESS test. A key turns the depth test off, so you can compare.
2. A scene of five intersecting cubes that rotate, with a golden. Lisitsa's part 6 builds the same scene.
3. Render the scenes of the clipping step again. Where an image changed, look at it, say why the depth test changed it, and only then save it as the new golden.

### Done when

- The goldens pass.
- Where two cubes intersect, the boundary is a straight line, and it stays straight while they rotate. With the depth test off, the cube drawn last covers the others.
- You can say why the depth is interpolated with the plain weights and why the near plane stays at 0.1 or more.

## Textures and perspective-correct interpolation

Overlapping cubes now draw correctly, and each face still has one flat color. A **texture** is an image mapped onto a triangle, and one pixel of a texture is a **texel**. Each vertex carries **texture coordinates** `(u, v)`, a position in the image where (0, 0) and (1, 1) are opposite corners. The rasterizer interpolates `u` and `v` per pixel and reads the color there.

The plain barycentric weights from the triangle step are wrong for `u` and `v` on a triangle that is not parallel to the screen. Equal steps on the screen are not equal steps on the surface, because the far end of the surface is squeezed together. Interpolating with plain weights is called **affine** interpolation, and it bends the texture at the edge between two triangles:

![A floor of two triangles with an 8 by 8 checker texture, in perspective. Left, with screen-space weights, the checker lines bend where they cross the diagonal between the two triangles. Right, with perspective-correct weights, the lines stay straight and the squares shrink with distance.](figures/13-perspective-texture.svg)

The second half of Lisitsa's part 5 shows that `1/w` changes linearly across the screen while `u` and `v` do not. The fix changes the weights. Divide each barycentric weight by its own vertex's `w`, then scale the three so they add up to 1. These **perspective-correct** weights apply to every attribute except depth, which stays on the plain weights from the last step.

Reading a color from the texture is called **sampling**. Casey's day 093 does it for a 2D sprite on a blackboard first and in code after:

```
  nearest:   tx = floor(u * W),  ty = floor(v * H),  one texel
  bilinear:  x = u * W - 0.5,  y = v * H - 0.5
             tx = floor(x), fx = x - tx  (same for y)
             blend the 2 x 2 texels at (tx, ty) .. (tx+1, ty+1)
             by fx horizontally, then by fy vertically
  wrapping:  for power-of-two sizes, tx & (W - 1) repeats the texture
```

**Nearest** sampling takes the one texel the point falls in. **Bilinear** sampling blends the four nearest texels by distance, which smooths a texture seen up close. **Wrapping** repeats the texture when `u` or `v` leaves [0, 1].

A checkerboard floor that stretches to the horizon shows all of it in one picture. With plain weights its lines bend at the diagonal of each quad. With nearest sampling the distant squares sparkle as the camera moves, because each pixel there covers many texels and picks one almost at random.

Bilinear sampling smooths near texels and does not fix the far ones. The fix is **mipmaps**, smaller filtered copies of the texture chosen by distance, which GPUs support in hardware. Mipmaps are outside this chapter.

### Study

- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 5: Fixing issues with 3D](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-5.html) (read, 30 min): "Perspective-correct interpolation: the problem" to the end, the rest of the post from the clipping step. He also corrects depth this way. Keep depth on the plain weights.
- [Handmade Hero day 093: Textured Quadrilaterals](https://guide.handmadehero.org/code/day093/) (watch, 50 min): From 7:26 "Blackboard: Texture mapping" to 56:55. His quad is 2D and its `u` and `v` come from its own axes, so skip the details of his edge setup. The texel lookup at 24:59 and the bilinear blend from 38:56 on carry over to your rasterizer unchanged.

### Build

1. Add `u`, `v` to the vertex and to `ClipVertex`, so clipping interpolates them. Give each cube face the full texture.
2. `Texture { uint32_t *texels; int32_t width, height; }` with power-of-two sizes. Generate a 256 by 256 checkerboard into the permanent arena, and make a second 256 by 256 texture from your photo of the image step with the nearest scaling of `draw_image`.
3. `sample_nearest` and `sample_bilinear`, both wrapping. Blend the four texels per channel in float as `a + (b - a) * f`, and turn each blended channel back into a byte with `(int32_t)(c + 0.5f)`. The AVX2 version will repeat this arithmetic exactly.
4. Perspective-correct weights for `u`, `v` and color. Keys toggle between plain and corrected weights and between nearest and bilinear sampling.
5. A scene: the checkerboard floor stretching far into the distance, and textured cubes standing on it. Goldens for each combination of the two toggles.

### Done when

- With corrected weights the checkerboard lines are straight at every camera angle.
- With plain weights they bend at each quad's diagonal, and you can point to the diagonal in a screenshot.
- Bilinear sampling removes the blocky texels on a cube face close to the camera. Far squares still shimmer while you move, and you can say why bilinear sampling cannot help there.
- The four goldens pass.

## A ray tracer

The rasterizer loops over triangles, and for each one over the pixels it covers. A **ray tracer** turns the loops around. For each pixel it shoots a **ray**, a half-line from the camera through that pixel, and finds the nearest surface the ray hits. Then it asks where the light at that point came from by shooting more rays from there. Shadows, reflections and refraction follow from the same loop, at the cost of many rays per pixel.

![A ray starts at the camera and passes through the center of one pixel. It hits the sphere where the quadratic for t has solutions, and the smaller t is the visible hit, where the surface normal points away from the center. A ray through another pixel misses, and the quadratic has no solution.](figures/13-ray-sphere.svg)

A point on a ray is `origin + t * direction` for some number `t`. It lies on a sphere when its distance from the center equals the radius. Put the first formula into the second and you get a quadratic equation in `t`. No solution means a miss. Two solutions mean the ray enters and leaves, and the smaller positive `t` is the hit you see.

The **normal** at the hit is the direction straight out of the surface, from the center through the hit point, and the materials use it to decide where the light came from.

Shirley's book builds a ray tracer in 13 short chapters, in this order:

- rays, spheres and their normals
- **antialiasing**, which averages several random **samples** per pixel to smooth jagged edges
- diffuse, metal and glass materials
- a camera you place with a position, a point to look at and an up direction, and a blur for things out of focus

The book is C++ with classes, virtual functions and `shared_ptr`, which is a `unique_ptr` from chapter 12 that several owners can share. Port it to C in the style of this book:

- Its `vec3` arithmetic is written as operator overloads such as `operator+` and `operator*`. Each one is a function of two values. Your `V3` with plain functions replaces them.
- Its `ray` class becomes a struct of an origin and a direction, with a plain function for the point at `t`.
- Its `interval` class becomes a struct of a minimum and a maximum, with plain functions such as `interval_contains`.
- Its `hittable_list` class becomes one flat array of spheres and a plain function that returns the nearest hit.
- A material is a `struct` with a type tag and a `switch`, in place of the virtual `scatter`.
- The arena replaces `shared_ptr`.
- Write the output with your `ppm_write` in place of the book's text format, and view it with your viewer.

Every pixel is independent, so the work splits across cores with your chapter 09 `parallel_for`, one range of rows per job.

The book uses one global random number generator. Shared between threads it would be a data race, and the image would depend on which thread rendered which pixel. Seed a small generator per pixel from the pixel's index instead, hashed so that no seed is zero. The xorshift from chapter 06 is enough. Then the image is the same bytes for any number of threads, and `cmp` can check the parallel version against the serial one.

### Study

- [Peter Shirley, Trevor David Black, Steve Hollasch: Ray Tracing in One Weekend](https://raytracing.github.io/books/RayTracingInOneWeekend.html) (do, 12 h): Version 4.0.2. Chapters 1 to 13, then section 14.1 "A Final Render". Skip 6.6 "Some New C++ Features" and replace 8.1 "Some Random Number Utilities" with your per-pixel generator. Each section ends with an image. Compare yours before you move on.

### Build

1. `src/rt.c`, a separate program with no SDL, built with `LIBS=-lm`: the book's renderer in C, section by section, writing `out.ppm`. Keep each section's image as a golden for a fixed sample count, so a later change that breaks an early feature shows up.
2. Render the final scene at 1200 by 675 with 10 samples per pixel on one thread and time it. Estimate the time for 500 samples.
3. Parallelize the row loop with `parallel_for`. Pick the grain size by measurement, as in chapter 09.
4. Render the final scene with 500 samples and depth 50, on all CPUs.

### Done when

- The final image shows the book's field of spheres with matte, metal and glass balls and a blurred background.
- `cmp` prints nothing for 1 thread against all threads, for every golden.
- You have the speedup at 2, 4 and `nproc` threads, and you can explain why it stays below `nproc` on your laptop, from what chapter 09 said about logical CPUs, hybrid cores and WSL2.

## Incremental edges and AVX2

The ray tracer can take minutes for one image. The rasterizer has 16.7 ms per frame. Its scalar version is now the oracle: every faster version must produce the same bytes, and `run_images.sh` checks that. Start with a profile of the textured scene at 960 by 540 and at 1920 by 1080, with your own profiler from chapter 07 and with `perf`.

Then make two changes to the pixel loop, in this order, and measure after each. The next step spreads the work across cores.

**Incremental edge functions** come first. Each edge function changes by a constant per pixel: one step right adds a constant `A`, one step down adds a constant `B`. Giesen's post replaces two multiplies per edge per pixel with one add, still in integers, so the coverage stays exact.

AVX2 comes second. Process 8 pixels of a row at once, one per lane of a `__m256i` or `__m256` from chapter 07:

- The three edge values become `__m256i`. Add each edge's bias, then OR the three. A pixel is inside where the result is not negative, so the sign bit of each lane decides, as in Giesen's post.
- Depth, the corrected weights and the texture coordinates become `__m256`.
- A **gather** loads 8 values from 8 different addresses in one instruction. `_mm256_i32gather_epi32` reads the 8 texels for nearest sampling.
- Merge the new colors and depths into the old ones under the coverage and depth mask with `_mm256_blendv_epi8` and `_mm256_blendv_ps`.

Bilinear sampling repeats the scalar arithmetic of the texture step in every lane:

1. `_mm256_floor_ps` rounds `x` and `y` down, and `_mm256_cvttps_epi32` turns the results into the integer texel positions. The fractions are `x` and `y` minus their floors.
2. `_mm256_and_si256` with `W - 1` wraps each position, as `&` did in the scalar code. The texel index is the row times `W` plus the column, and for a 256-wide texture the multiply is a shift left by 8 with `_mm256_slli_epi32`.
3. Four gathers fetch the 2 by 2 texels.
4. For each channel, `_mm256_srli_epi32` by 0, 8 or 16 and an AND with 255 pick the byte, and `_mm256_cvtepi32_ps` turns it into a float. Blend with the same `a + (b - a) * f` as the scalar code.
5. Add 0.5, convert back with `_mm256_cvttps_epi32`, shift each channel to its place with `_mm256_slli_epi32` and OR the three into `0x00RRGGBB`.

Start each row's loop at an `x` that is a multiple of 8, and keep the frame buffer width a multiple of 8, so the last group of a row never runs past it. With `-ffp-contract=off`, the vector code rounds exactly like the scalar code, as long as you keep the same order of operations and divide with `_mm256_div_ps`, not the approximate reciprocal `_mm256_rcp_ps`.

> **Practice:** After every change for speed, render every scene with the debug build and with the release build and compare the two with `ppmdiff`, as well as with the goldens. A difference between the builds points at undefined behavior or at a change in rounding.

> **Optional, on the Mac:** NEON has 4 float lanes and no gather instruction. Port the pixel loop to `<arm_neon.h>` with 4 by 1 pixels per step and scalar texture reads, and check it against the same goldens.

### Study

- [Fabian Giesen: Optimizing the basic rasterizer](https://fgiesen.wordpress.com/2013/02/10/optimizing-the-basic-rasterizer/) (read, 30 min): From the start through "Next steps and a bit of perspective". Stop at "A match made in Github", which the next step assigns. His `Vec4i` stands for a 4-lane integer vector with C++ operators. Map each operation to an AVX2 intrinsic with 8 lanes.
- [Intel Intrinsics Guide](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html) (reference, as needed): The guide from chapter 07. Look up each intrinsic this step names, such as `_mm256_i32gather_epi32`, `_mm256_floor_ps`, `_mm256_cvttps_epi32`, `_mm256_cvtepi32_ps`, `_mm256_cmp_ps`, `_mm256_blendv_ps` and `_mm256_blendv_epi8`.

### Build

1. Check for AVX2 again with `grep -o -m1 -w avx2 /proc/cpuinfo`, and check that `build.sh` still has the `arch` line from chapter 07 and passes `$arch` to the compiler. If the grep prints nothing, write the pixel loop with SSE2's 4 lanes, `__m128i` and `__m128`. SSE2 has no gather, floor or blend, so read texels and take floors one lane at a time, and merge with `_mm_and_si128`, `_mm_andnot_si128` and `_mm_or_si128`.
2. Profile the scalar version in the headless `render_test`, drawing the textured scene for 600 frames, so the window and WSLg stay out of the numbers. Write down where the time goes at both resolutions: clearing, vertex work and clipping, triangle setup, the pixel loop. Build a copy with `-g -fno-omit-frame-pointer` as in chapter 07, and compare your profiler's blocks with `perf report`.
3. Read the IR and the assembly clang produces for the pixel loop, as in chapter 12. Check with `-Rpass-missed=loop-vectorize` from chapter 07 whether clang vectorized it, and if not, why.
4. Incremental edge functions. All goldens still pass.
5. The AVX2 pixel loop, 8 by 1 pixels per step, with nearest sampling first and bilinear sampling second. All goldens still pass, the four texture goldens included.
6. A table in `docs/raster-perf.md`: median and maximum work time for scalar, incremental and AVX2, at 960 by 540 and at 1920 by 1080. Measure as in chapter 07: plugged in, in Windows' best performance power mode and pinned to one core with `taskset`. Note the CPU model from `lscpu`.

### Done when

- `run_images.sh` passes for all three versions, in the debug build and the release build. The AVX2 version runs clean under ASan and UBSan.
- Your table has all 12 numbers, and you can explain each ratio from the profile: what fraction of the scalar time AVX2 could touch, and what the gathers cost.

## Tiles on the job system

The AVX2 loop uses one core. Your laptop has several, and chapter 09 gave you a job system to use them. The rasterizer cannot split its list of triangles across workers, because two triangles may cover the same pixel and must be drawn in submission order. Splitting the screen instead keeps each pixel on one worker.

Split the screen into 64 by 64 pixel **tiles**. After clipping and setup, append each triangle to the **bin**, a per-tile list, of every tile its bounding box touches, in the transient arena. Then run one job per tile with `parallel_for`. A job draws its tile's triangles in the order they were submitted, with the bounding box clamped to the tile. Tiles do not share pixels, so no job needs a lock, and each pixel sees the same triangles in the same order as in the scalar version:

![The 960 by 540 screen split into 64 by 64 tiles, 15 across and 9 down. A triangle goes into the bin of every tile its bounding box touches, shaded here for one triangle. parallel_for then runs one job per tile, and the workers take tiles as they finish.](figures/13-tiles.svg)

The color and depth of one tile take 32 KB, about the size of the L1 data cache you read from `/sys` in chapter 07.

The platform owns the job system, which is the answer Casey gave on day 011 at 1:03:22. The platform starts the workers once and puts a pointer to its `parallel_for` in `GameMemory`, so the game calls it like any other platform service. `parallel_for` returns before `game_update_and_render` does, so no job is still running code from the old library when F5 unloads it. `render_test` starts the same workers, so the goldens test the tiled path too.

### Study

- [Fabian Giesen: Optimizing the basic rasterizer](https://fgiesen.wordpress.com/2013/02/10/optimizing-the-basic-rasterizer/) (read, 15 min): "A match made in Github", the last section of the post from the last step, up to the comments. It walks through the binner and the per-tile rasterizer of the demo he studies. Its tiles are 320 by 90 pixels, sized for the L2 cache, and its loop runs over 2 by 2 blocks. Yours are 64 by 64 and 8 by 1.

### Build

1. In the platform, start the chapter 09 workers once at startup and put a pointer to `parallel_for` in `GameMemory`. Do the same in `render_test`, with the number of workers taken from the command line.
2. Binning: one bin per tile, 15 by 9 bins at 960 by 540 and 30 by 17 at 1920 by 1080, each a list of triangle indices in the transient arena, filled after clipping and setup.
3. One job per tile, drawing its bin with the AVX2 loop and the bounding box clamped to the tile. All goldens still pass with 1, 2 and `nproc` workers.
4. Press F5 while the tiled scene is running, ten times. The program keeps running.
5. Add AVX2 with tiles to the table in `docs/raster-perf.md`, at both resolutions, with the number of workers.

### Done when

- `run_images.sh` passes with any number of workers, and the tiled version runs clean under ASan and UBSan.
- Your table has all 16 numbers, and you can explain how close the tiled version comes to the number of workers.
- The textured scene at 960 by 540 runs within the 16.7 ms budget with room to spare, which the frame-time graph shows. Judge that from the work time, not the frame interval, which WSLg shapes. Reaching 60 Hz at 1920 by 1080 is a stretch goal.

## Where this leads

You own a whole real-time program. A platform layer feeds a game function input, time and memory, reloads its code while it runs, and replays recorded input exactly. The game draws a textured 3D scene through the same stages every graphics API has: vertex transforms, clipping, perspective divide, viewport, rasterization with exact coverage rules, perspective-correct interpolation, texture sampling and a depth test.

All of that work ran on the CPU, and your laptop's NVIDIA GPU sat idle. A GPU runs the same stages with thousands of lanes, fixed-function hardware for clipping, rasterization and texture filtering, and small programs you supply for the per-vertex and per-pixel parts.

Chapter 14, Game engines and shipped games, puts that pipeline to work through SDL3's GPU API. Under WSL2, a Linux program finds no driver that lets SDL's GPU API use the real GPU, so the chapter first has clang build Windows programs from inside WSL: SDL's streaming-texture example from chapter 06, then this platform layer with its memory, threads and code reload. Then it draws one triangle with two small shaders. The vertex shader takes the place of your transform code, the fragment shader takes the place of your per-pixel code, and the hardware does the rest. Then you move this chapter's textured scene to the GPU, build a small engine, script it with the Lua you embedded in chapter 11, and ship two games, one 2D and one 3D.
