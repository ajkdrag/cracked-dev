---
id: 13
title: Software rendering
part: Graphics and games
weeks: 10
project: An SDL3 platform layer with live code reload and input replay, a software rasterizer that draws clipped, depth-tested, perspective-correct textured 3D scenes and runs on NEON and the job system, and a multithreaded C port of Ray Tracing in One Weekend.
---

Chapter 12 ended with Kaleidoscope compiled through LLVM IR into object files that link with C. Most programs in this book so far read input, compute and write output, or answer requests on a socket. The CHIP-8 front end of chapter 06 was the exception. It opened a window, pushed a 64 by 32 texture to it and ran a 60 Hz loop. This chapter builds on that loop and makes the picture the whole job. You write a program that computes every pixel of a 960 by 540 frame from a list of triangles and a camera, 60 times a second, with no graphics API between your code and the pixels.

The program has two halves. The platform layer talks to macOS through SDL3: window, input, timing, memory and loading code. The game is everything else, one function that the platform calls once per frame with the input and a pixel buffer. That split lets you reload the game code while it runs and replay recorded input, two tools you build in the first two steps and use for the rest of the chapter. Then comes the renderer: lines, triangles with exact edge rules, the transforms from a 3D model to the screen, clipping, a depth buffer and textures. You also write a ray tracer, a second way to turn geometry into pixels, and you finish by making the rasterizer fast with NEON and the job system.

The chapter comes now because it uses almost everything before it. The arenas of chapter 04 hold all memory. Chapter 05 explained shared libraries, which live reload depends on. Chapter 07 gave you the profiler and NEON, chapter 08 gave you `mmap`, and chapter 09 the job system that spreads the frame across cores. Chapter 14 moves rendering to the GPU. You will recognize each of its fixed stages, because you wrote all of them here.

## A platform layer and a frame you own

The chapter 06 front end had one loop in `main` that did everything: poll SDL, run the machine, upload 64 by 32 pixels, present. That works for one emulator. Casey Muratori's Handmade Hero splits the same loop into two parts with a narrow boundary between them. The platform layer owns the OS: it opens the window, collects input, keeps time, allocates memory and presents the picture. The game is a service the platform calls once per frame:

```c
void game_update_and_render(GameMemory *memory, GameInput *input, Framebuffer *fb);
```

The game never calls the OS. It gets everything as arguments and returns its results by writing into memory it was given. A frame of the whole program then looks like this:

```
  while (running) {
      t0 = now
      poll events into GameInput             ─┐
      lock the texture, get pixels + pitch    │  work: must fit in 16.67 ms at 60 Hz
      game_update_and_render(...)             │
      unlock the texture                     ─┘
      present                                    vsync waits for the display here
  }
```

The framebuffer is a block of 32-bit pixels in SDL's `XRGB8888` format, as in chapter 06: `0x00RRGGBB` in each `uint32_t`. This time you write into the texture's own memory. `SDL_LockTexture` hands you a pointer and a pitch, the number of bytes from the start of one row to the start of the next. The pitch can be larger than `width * 4`, so you never compute an address as `y * width + x`. Address a row from the pitch and index the row by `x`:

```
  pitch: bytes from one row start to the next
  |<--------------------------------------------->|
  +-----------------------------------+-----------+
  | width * 4 bytes of pixels         | padding   |   row 0
  +-----------------------------------+-----------+
  | width * 4 bytes of pixels         | padding   |   row 1

  uint32_t *row = (uint32_t *)((char *)pixels + y * pitch);
  row[x] = color;
```

Keep `Framebuffer` as `{ uint32_t *pixels; int32_t width, height, pitch; }` with the pitch in bytes. The render size is fixed at 960 by 540. The window can have any size: `SDL_SetRenderLogicalPresentation` with `SDL_LOGICAL_PRESENTATION_LETTERBOX` scales the texture to fit, and nearest scaling keeps the pixels sharp.

Memory follows the arena rules of chapter 04, applied to the whole program. The platform calls `mmap` once at startup, as your chapter 08 `malloc` did, and splits the block in two. The permanent part holds the game state and lives for the whole run. The transient part is scratch space the game may reset every frame. The game casts the start of the permanent part to its `GameState` and builds its arenas from the rest. Nothing in the frame loop calls `malloc`. Memory from `mmap` starts zeroed, so `GameState` starts zeroed too, and a `bool initialized` field tells the game when to set itself up on the first call.

The platform passes input to the game as plain data. `GameInput` holds `dt`, the seconds since the last frame, the mouse motion of this frame, and one record per button: `{ bool down; int transitions; }`. The platform zeroes `transitions` at the start of each frame and counts every key down and key up event into it. A press and release inside one frame then still reaches the game as two transitions. Measure the work time of each frame with `SDL_GetTicksNS`, from the start of the frame to just before `SDL_RenderPresent`, and pass the last value to the game in `GameInput` for later use. Clamp `dt` the way you clamped the accumulator in chapter 06, so a pause in the debugger does not produce one giant step.

### Study

- [Handmade Hero day 011: The Basics of Platform API Design](https://guide.handmadehero.org/code/day011/) (watch, 50 min): From 11:23 "Topic of the day revealed!" to 1:01:00, where the Q&A starts. Casey works in C-style C++ on Win32. Watch for the shape of the boundary and ignore the Windows calls. Note the question at 1:03:22 about threading in the platform layer. It comes back in the last step of this chapter.
- [Handmade Hero day 014: Platform-independent Game Memory](https://guide.handmadehero.org/code/day014/) (watch, 1 h): From 0:58 to 58:24, plus his answer at 1:04:13 on permanent and transient storage. He reserves memory with `VirtualAlloc` at a fixed base address. Use `mmap` with a null address instead. A fixed address only matters for his later snapshot files.
- [SDL3 wiki: SDL_LockTexture](https://wiki.libsdl.org/SDL3/SDL_LockTexture) (reference, as needed): The `pitch` parameter and the remark that the locked memory is write-only and may not hold last frame's pixels. Other functions are in the API list from chapter 06: `SDL_UnlockTexture`, `SDL_SetRenderLogicalPresentation`, `SDL_EVENT_MOUSE_MOTION` and `SDL_GetTicksNS`.

### Build

1. `src/game.h`: `Framebuffer`, `GameButton`, `GameInput` with `dt`, `mouse_dx`, `mouse_dy`, a fixed set of buttons (W, A, S, D, arrows, space, mouse left) and `last_work_ns`, and `GameMemory` with the two blocks and their sizes. Also the prototype of `game_update_and_render`.
2. `src/game.c`: a `GameState` with a time counter and a square's position. Draw a gradient that scrolls over time and a 20 by 20 square that WASD moves at 200 pixels per second, scaled by `dt`. The game includes only `game.h` and C standard headers.
3. `src/platform_sdl.c`: `#include "game.c"` for now. Map 64 MB permanent and 256 MB transient with `mmap`. Open a resizable 1280 by 720 window, create a 960 by 540 streaming texture with nearest scaling, set letterbox presentation and vsync. Run the frame loop above. Once per second, print the median and maximum work time and the median frame interval.
4. `src/pitch_test.c`: call `game_update_and_render` on a framebuffer whose pitch is `width * 4 + 64`, with the 64 padding bytes of every row filled with `0xAB`. After three frames every padding byte is still `0xAB`. Run it on the Mac and in Linux with the sanitizers.

### Done when

The window shows the moving gradient and the square follows WASD at the same speed whatever the window size. Resizing letterboxes the picture without stretching it. The once-per-second line shows a frame interval near 16.7 ms and a work time well under it. `pitch_test` passes on both machines with no sanitizer report. `grep -n 'SDL\|malloc' src/game.c` prints nothing.

## Live code reload and input replay

Every change so far costs a restart, and a restart throws away the state you were looking at. Handmade Hero day 021 moves the game into a shared library. The platform loads it with `dlopen`, finds `game_update_and_render` with `dlsym` and calls it through a function pointer. When you rebuild the library, the platform unloads the old one and loads the new one between two frames. All state lives in `GameMemory`, which belongs to the platform, so the new code continues from exactly where the old code stopped. Chapter 05 showed how the loader maps a shared library at startup. Here your own code does the loading, at a time it chooses.

On the Mac a shared library is a `.dylib`. clang builds one with `-dynamiclib`, macOS's name for the `-shared` you used in chapter 05. Three details decide whether reloading works:

- macOS's `dlopen` returns the handle it already has when you open a path that is still loaded. Copy `game.dylib` to a new name each time, such as `game_loaded_7.dylib`, and open the copy. Casey copies his DLL for a different reason (Windows locks a loaded file), and the fix is the same.
- The build must never leave a half-written library where the platform looks. Link to `game.tmp.dylib`, then `mv` it to `game.dylib`. A rename within one directory replaces the file in one step.
- Nothing in game memory may point into the library. Function pointers and string literals live in the library's own pages, which are gone after `dlclose`. `static` variables inside `game.c` belong to the library too, and the new library starts with fresh copies. Casey moves his local statics into the game state for that reason.

The platform reloads when you press F5, so you decide when the new code takes over. Pass `RTLD_NOW` to `dlopen` so a missing symbol fails at load time and not in the middle of a frame. If the load fails, print `dlerror()` and keep running the old code.

Day 023 adds the second tool. Press L and the platform copies the whole permanent block into a snapshot buffer and starts appending each frame's `GameInput` to a recording. Press L again and it restores the snapshot and feeds the recorded inputs back, frame by frame, in a loop. `dt` is part of the input, so playback runs the same arithmetic as the recording, whatever the real frame times. Combine the two tools and you can loop five seconds of play, change a constant, rebuild and see the change in the same five seconds. Keep the snapshot and the recording in memory, in a block the platform maps for them. Casey writes his to disk, which you do not need at these sizes.

### Study

- [Handmade Hero day 021: Loading Game Code Dynamically](https://guide.handmadehero.org/code/day021/) (watch, 1 h): From 1:29 to 1:02:00. The stretch from 31:00 to 47:27 is about Windows DLL build flags and exports, and you can watch it fast. Keep the ideas: a function type declared once and used on both sides, a stub when loading fails, state moved out of local statics, and the copy before loading.
- [Handmade Hero day 023: Looped Live Code Editing](https://guide.handmadehero.org/code/day023/) (watch, 40 min): From 16:52 "Problems with gameplay tuning and a solution" to 54:50, where he starts on transparent windows. He stores the recording in files through Win32 calls. Store yours in memory.
- [CMU 15-213 Fall 2025: Linking](https://www.cs.cmu.edu/afs/cs/academic/class/15213-f25/www/lectures/07-linking.pdf#page=42) (read, 10 min): PDF pages 42 to 44, the run-time linking slides that chapter 05 told you to skip. The example uses `dlopen`, `dlsym`, `dlerror` and `dlclose` on a Linux `.so`. The Mac has the same functions in `<dlfcn.h>`.

### Build

1. Extend `build.sh` so that `LIB=1 sh build.sh game` compiles `src/game.c` with `-dynamiclib` into `$out/game.tmp.dylib` and then moves it to `$out/game.dylib`. Keep the sanitizer flags in debug builds of both the library and the platform.
2. In `game.h`, declare `typedef void GameUpdateAndRender(GameMemory *, GameInput *, Framebuffer *);`. The platform holds a pointer of that type, set to a stub that clears the screen when no library is loaded.
3. Write `load_game(n)` in the platform: copy `game.dylib` to `game_loaded_<n>.dylib`, `dlopen` it with `RTLD_NOW`, look up the function, and on success `dlclose` the previous handle. F5 calls it. Print the load count and any error.
4. Recording and playback on L, as above. At the start and at the end of each playback pass, print an FNV-1a hash of the permanent block, the hash from chapter 04.
5. Record five seconds of moving the square. While it loops, change the gradient colors in `game.c`, rebuild and press F5.
6. Plant a bug: add `const char *label` to `GameState`, set it to a string literal on the first frame and print it every second. Add a few lines of code above that function, rebuild and reload, twice, and watch what happens.

### Done when

A rebuild plus F5 changes the picture within a second, and the square keeps its position. Every playback pass prints the same end hash, also after a reload that did not change the movement code. `nm -u` on `game.dylib` lists no SDL symbols. With the planted bug the program prints garbage or the wrong text, crashes or gets an AddressSanitizer report after a reload, and you can say which page the pointer points into and why that page is gone.

## Lines, rectangles and image files

Before triangles, write the 2D tools you will debug everything else with. Rectangles draw a frame-time graph. Lines draw wireframes and debug markers. Image files give you screenshots for tests, a viewer, and later the textures and the ray tracer's output.

A rectangle is two loops over a half-open range `[x0, x1) × [y0, y1)` after you clamp the range to the buffer. A line needs more care. Sokolov's lesson builds Bresenham's algorithm in four attempts: step along the longer axis, swap endpoints so the loop always runs forward, then replace the floating-point `y` with an integer error term. Two properties make a good test. `line(a, b)` and `line(b, a)` must light the same pixels, and a line lights exactly `max(|dx|, |dy|) + 1` pixels. For now, skip pixels outside the buffer one at a time. The renderer clips properly later, and debug lines can afford the test.

Tests for a renderer compare pictures. Chapter 06 compared the CHIP-8 display as text with golden files. Here the golden files are PPM images: a short text header and then raw RGB bytes, row by row from the top.

```
  P6\n960 540\n255\n          header: magic, width, height, maxval
  R G B R G B R G B ...       width * height * 3 bytes, no row padding
```

Write the framebuffer as PPM by dropping the unused top byte of each `XRGB8888` pixel. Read PPM by parsing the header, which may contain `#` comments, into an `Image { uint32_t *pixels; int32_t width, height; }` in the permanent arena.

A headless runner turns this into a test. `src/render_test.c` includes `game.c`, maps memory, and runs the game for a number of frames with scripted input and a fixed `dt` of 1/60 s. Then it writes the framebuffer to a PPM file. A scene number in the game state selects what to draw, so one runner covers every test scene in the chapter. The runner has no SDL, so it also runs in the Linux VM under the sanitizers.

Bit-exact comparisons need one more build flag. clang on the Mac contracts `a * b + c` inside one statement into a single fused multiply-add, which rounds once instead of twice. Your NEON code in the last step will round twice. Add `-ffp-contract=off` to `build.sh` so the same C gives the same bits in every build you compare. The math library still differs between macOS and Linux, so keep golden files per OS, in `tests/golden/Darwin/` and `tests/golden/Linux/`.

### Study

- [Dmitry Sokolov, tinyrenderer: Bresenham's line drawing algorithm](https://haqr.eu/tinyrenderer/bresenham/) (read, 40 min): From the start through "Round 4, postscriptum". Skip "Homework: wireframe rendering", which needs his model loader. His code is C++ and writes TGA files. Yours writes into your framebuffer.
- [Netpbm: PPM format specification](https://netpbm.sourceforge.net/doc/ppm.html) (reference, as needed): "THE FORMAT" and "Minimal Subset". Write files in the minimal subset, with maxval 255. Accept comments when you read.

### Build

1. In `game.c`: `draw_rect(fb, x0, y0, x1, y1, color)` and `draw_line(fb, x0, y0, x1, y1, color)` with integer endpoints.
2. A frame-time graph: the game keeps the last 240 values of `last_work_ns` in `GameState` and draws them as bars along the bottom of the screen, with a line at 16.7 ms.
3. `ppm_write(FILE *, Framebuffer *)` and `Image ppm_read(Arena *, FILE *)`, plus `draw_image(fb, image, dst_x0, dst_y0, dst_x1, dst_y1)` that scales with nearest sampling. F12 in the platform saves a screenshot.
4. `src/render_test.c` with three scenes: a fan of 64 lines from the center, rectangles that cross every edge of the buffer, and a loaded test image drawn at three scales. A unit test checks the two line properties above for 1000 random endpoint pairs.
5. `src/ppmdiff.c`: compares two PPM files, prints the number of differing pixels and the largest channel difference, and writes a third image that is black where they agree and white where they differ. `tests/run_images.sh` renders every scene, compares each with its golden file and exits nonzero on any difference.
6. A viewer mode: when the platform gets a PPM path on the command line, the game shows that image. Convert a photo of your own to PPM with `brew install netpbm` and `pngtopam photo.png > photo.ppm`, and view it.

### Done when

The line properties hold for all 1000 pairs. `sh tests/run_images.sh; echo $?` prints 0 on the Mac and in Linux, the debug build has no sanitizer report, and the debug and release builds produce identical images. Change one pixel of a golden file and the script fails, and `ppmdiff` points at the pixel. The frame-time graph shows in the window, and a 10 ms busy loop that you add to the game for a test shows up as taller bars crossing the 16.7 ms line.

## Triangles: edge functions and fill rules

A triangle is the intersection of three half-planes, one per edge. For an edge from `a` to `b`, the 2D cross product `orient2d(a, b, p) = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)` is positive on one side of the line, negative on the other and zero on it. Evaluate it for all three edges at a pixel center. If all three agree in sign, the pixel is inside. The same three numbers, divided by the triangle's doubled area, are the barycentric weights of the pixel, so the same numbers also drive interpolation. Giesen's first post derives all of that. His second turns it into a rasterizer: loop over the triangle's bounding box, test each pixel, and handle three details that decide whether the result is correct.

Fixed point comes first. Snap vertex positions to 1/16 of a pixel and do the edge math in integers. Every sum and product is then exact, and two triangles that share an edge compute exactly opposite values along it. Giesen shows that `orient2d` on p-bit inputs needs 2p + 2 bits. With 32-bit integers the inputs must stay in [-16384, 16383], which at 1/16 pixel is ±1024 pixels. Put the origin at the center of the screen, as his guard band paragraph suggests, and even a 1920 by 1080 target fits:

```
  pixel coordinates, y down, 4 fraction bits, origin at the screen center
      X = round((x - width/2) * 16)
      Y = round((y - height/2) * 16)
  pixel (px, py) is sampled at its center
      ((px - width/2) * 16 + 8,  (py - height/2) * 16 + 8)
```

Orientation comes second. Giesen's pictures have y pointing up. Your coordinates have y pointing down, which flips the sign of `orient2d` for a triangle that looks the same on screen. Do not convert anything. Apply his formulas to your numbers as they are: if `orient2d(v0, v1, v2)` is negative, swap `v1` and `v2`, and if it is zero, draw nothing. Every triangle then reaches the loop with a positive area.

The fill rule comes third. A pixel center that lies exactly on an edge shared by two triangles must go to exactly one of them. Giesen's top-left rule does that with one bias per edge, computed once per triangle. Use his rule as written, on your y-down numbers. On screen it then selects the bottom and left edges instead of the top and left ones, which is just as consistent. The only requirement is that every shared edge goes to one side.

To test all three, draw into a buffer of counters instead of colors. Each covered pixel increments its counter. A grid of quads that tiles the screen, with jittered shared vertices, must leave every counter at exactly 1.

### Study

- [Fabian Giesen: The barycentric conspiracy](https://fgiesen.wordpress.com/2013/02/06/the-barycentric-conspirac/) (read, 40 min): All of it. The post sets up the orientation test, edge functions as signed areas, and barycentric interpolation. Giesen is a programmer at RAD Game Tools, and the series takes apart the software rasterizer in Intel's Software Occlusion Culling demo.
- [Fabian Giesen: Triangle rasterization in practice](https://fgiesen.wordpress.com/2013/02/08/triangle-rasterization-in-practice/) (read, 40 min): All of it. His loop samples at integer coordinates. Yours samples at pixel centers, which is the `+ 8` in the box above. His `isTopLeft` is described in words, so write it from the two rules he states for counterclockwise triangles.

### Build

1. `draw_triangle(Framebuffer *, const Vertex2 v[3])`, where a `Vertex2` has float `x`, `y` in pixels and float `r`, `g`, `b`. Snap to fixed point, fix the orientation, compute the three biases, clamp the bounding box to the buffer and loop. Interpolate color with weights computed from the unbiased edge values divided by the area.
2. A coverage mode that increments a `uint8_t` counter per pixel in place of writing color.
3. Coverage tests in `render_test.c`: a 12 by 8 grid of quads over the whole screen with interior vertices jittered by up to 6 pixels, alternating the diagonal direction, and some vertices placed exactly on pixel centers. A fan of 64 triangles around the screen center. A 64 by 64 pixel square made of two triangles, with corners on pixel centers. A triangle whose three vertices lie on one line.
4. A color scene: one large triangle with red, green and blue corners, as a golden image.
5. Sub-pixel motion: a thin triangle that moves 1/20 pixel per frame. Add a key that rounds vertices to whole pixels before the fixed-point step, and compare the two motions in the window.

### Done when

Every counter in the grid and fan tests is exactly 1, the square covers exactly 4096 pixels, and the collinear triangle covers none. The color golden passes. With whole-pixel rounding the thin triangle jumps every twenty frames, and without it the triangle moves smoothly. You can say which pixels would be drawn twice if every bias were 0, and which would be missing if every bias were -1.

## From a 3D model to the screen

So far every vertex arrived in pixels. A 3D renderer gets vertices in the model's own coordinates and moves them to the screen through a chain of 4 by 4 matrices and one division:

```
  model vertex (x, y, z, 1)
     -> model matrix       -> world position
     -> view matrix        -> camera space, camera at the origin looking down -Z
     -> projection matrix  -> clip space (x, y, z, w), w = distance in front of the camera
     -> divide by w        -> normalized device coordinates, x, y, z in [-1, 1], y up
     -> viewport           -> pixels, y down, then fixed point as in the last step
```

The matrices compose by multiplication, and the rightmost one applies first: `clip = projection * view * model * v`. Rotation, scaling and translation are all 4 by 4 matrices in homogeneous coordinates, where a point carries `w = 1`. The projection matrix copies `-z` into `w` and maps the depth range from the near plane to the far plane onto [-1, 1]. The divide by `w` then makes distant things small. Lisitsa's part 4 builds this matrix step by step.

Mixed conventions cause many of the bugs in this step, because every source picks its own and few say which. Write yours down in `docs/conventions.md` before you write a matrix function and follow it everywhere:

```
  handedness     right-handed, camera looks down -Z, +Y is up
  vectors        column vectors, matrix * vector
  storage        float m[4][4], m[row][col]
  NDC            x, y, z all in [-1, 1], y up (the OpenGL convention)
  front faces    counterclockwise in NDC
  screen         y down, so front faces arrive with orient2d < 0
```

The last line combines two facts. A counterclockwise triangle in NDC flips to negative `orient2d` when the viewport turns y downward. Back-face culling is one sign test before the swap from the last step: skip triangles whose `orient2d` is positive. On a closed mesh that removes the triangles facing away from the camera, about half of them. On a single convex object such as a cube it also hides every face that should be hidden.

The view matrix comes from a camera. LearnOpenGL builds a look-at matrix from a position and a direction, then a fly camera: yaw and pitch from mouse motion, WASD to move along the camera's own axes. SDL's relative mouse mode, `SDL_SetWindowRelativeMouseMode`, hides the cursor and reports raw motion in the `xrel` and `yrel` fields of each motion event. That replaces the GLFW cursor callback the page uses.

Two problems remain until the next step, and you should see both. A vertex behind the camera has a negative `w`, and dividing by it flips the vertex to the other side of the screen. A vertex very close to the camera can land far outside the screen, past the range where your 32-bit edge functions are exact. For now, drop any triangle with a vertex whose `w` is less than the near distance, or whose fixed-point coordinates leave [-16384, 16383].

### Study

- [LearnOpenGL: Transformations](https://learnopengl.com/Getting-started/Transformations) (read, 45 min): From "Vectors" through "Combining matrices". Skim the parts you know from ML work, but read "Cross product", "Translation", "Rotation" and "Combining matrices" closely. Stop at "In practice", which is about GLM and OpenGL. LearnOpenGL is Joey de Vries' free OpenGL book, and these sections hold only the math.
- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 4: Changing perspective](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-4.html) (read, 40 min): From "Viewport" to the end. Lisitsa teaches OpenGL at a university and wrote this series to show what the GPU does. His code is C++ around his own rasterizer, so take the math and the order of operations, and put your step 4 rasterizer in place of his. In "Perspective projection: implementation" two lines swap `v1` and `v2` by mistake. Divide each vertex by its own `w`.
- [LearnOpenGL: Camera](https://learnopengl.com/Getting-started/Camera) (read, 40 min): From "Camera/View space" through "Mouse input". Skip "Zoom" and "Camera class".

### Build

1. `src/math.c`, included by `game.c`: `V3`, `V4`, `M4` and the functions `m4_mul`, `m4_mul_v4`, `m4_translate`, `m4_scale`, `m4_rotate_x`, `m4_rotate_y`, `m4_rotate_z`, `m4_perspective(fovy, aspect, near, far)` and `m4_look_at(eye, target, up)`, plus `v3_cross`, `v3_dot`, `v3_normalize`.
2. Unit tests: `m4_rotate_z(π/2)` maps (1, 0, 0) to (0, 1, 0) within 1e-6. The projection maps a point at `z = -near` to NDC z = -1 and one at `z = -far` to +1. `m4_look_at(eye, target, up)` maps `eye` to the origin. Translate-then-rotate and rotate-then-translate give different results, and you can predict both.
3. An indexed mesh type as in Lisitsa's "Indexed rendering": a vertex array and an index array. A cube with 24 vertices and a color per face. Draw it spinning: transform, cull, divide, viewport, rasterize. A key toggles culling.
4. The fly camera, with the movement speed scaled by `dt`. A key toggles a wireframe drawn with `draw_line` over the filled faces.
5. A golden scene with a fixed camera and a fixed rotation angle.

### Done when

The math tests pass. The cube spins with correct perspective at any window size. With culling off, back faces paint over front faces in some orientations, and with culling on the cube looks solid. You can fly around the cube with the mouse and WASD, and the golden passes on both machines. When you fly through the cube, triangles disappear abruptly, and you can say which of the two temporary checks removed them.

## Clipping and the depth buffer

The fix for both problems is clipping in clip space, before the divide. A point is inside the view volume when six inequalities hold: `-w <= x <= w`, `-w <= y <= w` and `-w <= z <= w`. Write each one as a signed distance that is not negative inside: `x + w`, `w - x`, `y + w`, `w - y`, `z + w`, `w - z`. A point behind the camera fails `z + w >= 0`, so the near plane removes it before the divide can flip it.

Clip a triangle as a polygon, one plane at a time. This is the Sutherland-Hodgman algorithm. For each directed edge from `a` to `b`, with signed distances `da` and `db`:

```
  a inside,  b inside    emit b
  a inside,  b outside   emit the crossing point
  a outside, b inside    emit the crossing point, then b
  a outside, b outside   emit nothing

  crossing:  t = da / (da - db),  P = a + t * (b - a)
             and the same t for every attribute: color, later UV
```

Each plane can add at most one vertex, so a triangle clipped by six planes has at most 9. Triangulate the result as a fan from its first vertex. After all six planes every vertex satisfies `|x|, |y| <= w`, so every fixed-point coordinate lies inside the viewport. That replaces both temporary checks from the last step.

Clipping can open cracks between triangles that used to share an edge exactly. Two neighbors walk the shared edge in opposite directions, so one computes the crossing from `a` toward `b` and the other from `b` toward `a`. In floating point the two results can differ in the last bit. Always compute the crossing from the inside vertex toward the outside vertex. Then both triangles do the same arithmetic on the same inputs and get the same point.

Lisitsa clips against only the near and far planes, and he re-triangulates after each plane with a case per sign pattern. Read his part 5 for the clip-space equations, the edge intersection and the test scenes, then write the polygon version above against all six planes.

The depth buffer solves overlapping objects. It holds one value per pixel, the depth of the nearest surface drawn there so far. Clear it to the far value every frame. A pixel is drawn only if its depth is less than the stored one, and then it stores its own. Use NDC `z`, interpolated across the triangle. NDC `z` is linear in screen space, so interpolate it with the plain barycentric weights from step 4. Lisitsa's part 6 uses the perspective-corrected weights from his part 5 for depth too. Those weights are right for color and texture coordinates, which you add in the next step, and wrong for `z/w`. Store depth as a `float` in [0, 1], and keep the near plane at 0.1 or more. NDC `z` crowds most of its precision close to the near plane, and a smaller near distance makes distant surfaces fight.

### Study

- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 5: Fixing issues with 3D](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-5.html) (read, 40 min): From "Clipping" through "Clipping a triangle: testing". The rest of the post is for the next step.
- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 6: Adding some depth](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-6.html) (read, 25 min): All of it. Interpolate depth with screen-space weights, as explained above. His enum of depth test modes is more than you need. Implement LESS.

### Build

1. `int clip_polygon(ClipVertex *v, int n)`, where a `ClipVertex` holds the clip-space position and the attributes, working in place in an array of 9 with a scratch array of 9. One function clips by one plane, and a loop calls it for all six.
2. Unit tests on clip-space triangles: wholly inside comes back unchanged. Wholly outside one plane gives 0 vertices. Crossing the near plane with one vertex behind it gives 4 vertices, and with two behind it gives 3. A huge triangle that crosses all six planes gives at most 9 vertices, each within `|x|, |y|, |z| <= w (1 + 1e-6)`.
3. Remove the temporary checks. Add a `float` depth buffer to the framebuffer pair, cleared each frame, and the LESS test.
4. Scenes: the camera inside a cube with culling off (Lisitsa's first clipping test), a cube cut by a near plane set through its center, five intersecting cubes, and a large floor quad that passes under and behind the camera. Goldens for each.
5. A coverage test in 3D: a 16 by 16 grid of quads on a plane that crosses the near plane at an angle, in coverage mode, with culling and depth test off.

### Done when

The clip tests pass. Flying through and between the cubes never shows a triangle stretched across the screen, and no triangle vanishes until it is fully behind you. Every counter in the 3D grid test is exactly 1. Where two cubes intersect, the boundary is a straight line, and it stays straight while they rotate. You can say what the screen showed before clipping when a vertex had a negative `w`, and why.

## Textures and perspective-correct interpolation

A texture is an image glued to a triangle. Each vertex carries a texture coordinate `(u, v)`, where (0, 0) and (1, 1) are opposite corners of the image. The rasterizer interpolates `u` and `v` per pixel and reads the color there.

Interpolating with the screen-space weights from step 4 is wrong for a triangle that is not parallel to the screen. Equal steps on the screen are not equal steps on the surface, because the far end of the surface is compressed. Lisitsa shows that `1/w` is linear across the screen while `u` and `v` are not, and that the fix is a change of weights: divide each barycentric weight by its vertex's `w`, then normalize the three so they sum to 1. Use these corrected weights for every attribute except depth.

Reading the texture is sampling. Casey's day 093 does it for a 2D sprite on a blackboard first and in code after:

```
  nearest:   tx = floor(u * W),  ty = floor(v * H),  one texel
  bilinear:  x = u * W - 0.5,  y = v * H - 0.5
             tx = floor(x), fx = x - tx  (same for y)
             blend the 2 x 2 texels at (tx, ty) .. (tx+1, ty+1)
             by fx horizontally, then by fy vertically
  wrapping:  for power-of-two sizes, tx & (W - 1) repeats the texture
```

A checkerboard floor that stretches to the horizon shows all of it in one picture. With screen-space weights its lines bend at the diagonal of each quad. With nearest sampling the distant squares sparkle as the camera moves. Bilinear sampling smooths near texels and does not fix the far ones. The fix is mipmaps, smaller filtered copies of the texture chosen by distance, which GPUs support in hardware. Mipmaps are outside this chapter.

### Study

- [Nikita Lisitsa: Implementing a tiny CPU rasterizer, part 5: Fixing issues with 3D](https://lisyarus.github.io/blog/posts/implementing-a-tiny-cpu-rasterizer-part-5.html) (read, 30 min): From "Perspective-correct interpolation: the problem" to the end.
- [Handmade Hero day 093: Textured Quadrilaterals](https://guide.handmadehero.org/code/day093/) (watch, 50 min): From 7:26 "Blackboard: Texture mapping" to 56:55. His quad is 2D and its `u` and `v` come from its own axes, so skip the details of his edge setup. The texel lookup at 24:59 and the bilinear blend from 38:56 on carry over to your rasterizer unchanged.

### Build

1. Add `u`, `v` to the vertex and to `ClipVertex`, so clipping interpolates them. Give each cube face the full texture.
2. `Texture { uint32_t *texels; int32_t width, height; }` with power-of-two sizes. Generate a 256 by 256 checkerboard into the permanent arena, and make a second 256 by 256 texture from your step 3 photo with the nearest scaling of `draw_image`.
3. `sample_nearest` and `sample_bilinear`, both wrapping. Blend the four texels per channel in float.
4. Perspective-correct weights for `u`, `v` and color. Keys toggle between screen-space and corrected weights and between nearest and bilinear sampling.
5. A scene: the checkerboard floor stretching far into the distance, and textured cubes standing on it. Goldens for each combination of the two toggles.

### Done when

With corrected weights the checkerboard lines are straight at every camera angle. With screen-space weights they bend at each quad's diagonal, and you can point to the diagonal in a screenshot. Bilinear sampling removes the blocky texels on a cube face close to the camera. Far squares still shimmer while you move, and you can say why bilinear sampling cannot help there. The four goldens pass on both machines.

## A ray tracer

The rasterizer loops over triangles and then over the pixels each one covers. A ray tracer turns the loops around. For each pixel it shoots a ray from the camera through that pixel, finds the nearest surface the ray hits, and asks that surface where the light came from by shooting more rays. Shadows, reflections and refraction then follow from the same loop, at the cost of many rays per pixel. Shirley's book builds one in 13 short sections: spheres, a camera you position with look-from, look-at and an up vector, antialiasing by averaging random samples per pixel, then diffuse, metal and glass materials.

The book is C++ with classes, virtual functions and `shared_ptr`. Port it to C in the style of this book. A `V3` with plain functions, which you have from step 5. One flat array of spheres. A material as a `struct` with a type tag and a `switch`, in place of the virtual `scatter`. The arena in place of `shared_ptr`. Write the output with your step 3 `ppm_write` in place of the book's text format, and view it with your viewer.

Every pixel is independent, so the work splits across cores with your chapter 09 `parallel_for`, one range of rows per job. The book uses one global random number generator. Shared between threads it would be a data race, and the image would depend on which thread rendered which pixel. Seed a small generator per pixel from the pixel's index instead, hashed so that no seed is zero. The xorshift from chapter 06 is enough. Then the image is the same bytes for any number of threads, and `cmp` can check the parallel version against the serial one.

### Study

- [Peter Shirley, Trevor David Black, Steve Hollasch: Ray Tracing in One Weekend](https://raytracing.github.io/books/RayTracingInOneWeekend.html) (do, 12 h): Version 4.0.2. Sections 1 to 13, then 14.1 "A Final Render". Skip 6.6 "Some New C++ Features" and replace 8.1 "Some Random Number Utilities" with your per-pixel generator. Each section ends with an image. Compare yours before you move on.

### Build

1. `src/rt.c`, a separate program with no SDL: the book's renderer in C, section by section, writing `out.ppm`. Keep each section's image as a golden for a fixed sample count, so a later change that breaks an early feature shows up.
2. Render the final scene at 1200 by 675 with 10 samples per pixel on one thread and time it. Estimate the time for 500 samples.
3. Parallelize the row loop with `parallel_for`. Pick the grain size by measurement, as in chapter 09.
4. Render the final scene with 500 samples and depth 50, on all cores.

### Done when

The final image shows the book's field of spheres with matte, metal and glass balls and a blurred background. `cmp` prints nothing for 1 thread against all threads, for every golden. You have the speedup at 2, 4 and all cores, and you can explain why it stays below the core count on a Mac with performance and efficiency cores.

## A faster rasterizer: incremental edges, NEON and tiles

The scalar rasterizer is now the oracle. Every faster version must produce the same bytes, and `run_images.sh` checks that. Start with a profile, using the profiler from chapter 07, of the textured scene at 960 by 540 and at 1920 by 1080. Then make three changes, in this order, and measure after each.

Incremental edge functions come first. Each edge function is affine in `x` and `y`. One step right adds a constant `A`, one step down adds a constant `B`. Giesen's post for this step replaces two multiplies per edge per pixel with one add, still in integers, so the coverage stays bit-exact.

NEON comes second. Process 4 pixels of a row at once. The three edge values become `int32x4_t`, a pixel is inside where all three are non-negative, and the sign test of OR-ed values from Giesen works lane by lane. Depth, the corrected weights and the texture coordinates become `float32x4_t`. NEON has no gather instruction, so the four texture reads stay scalar. Merge the new colors into the old ones under the coverage and depth mask with a bitwise select. Keep your start `x` a multiple of 4 and the framebuffer width a multiple of 4 so loads and stores stay aligned. The Arm intrinsics reference from chapter 07 has every operation you need. With `-ffp-contract=off` from step 3, the vector arithmetic rounds the same way as the scalar code, as long as you keep the same order of operations and divide with `vdivq_f32`, not the reciprocal estimate.

Tiles come third. Split the screen into 64 by 64 pixel tiles. After clipping and setup, append each triangle to the list of every tile its bounding box touches, in the transient arena. Then run one job per tile with `parallel_for`. A job rasterizes its tile's triangles in the order they were submitted, with the bounding box clamped to the tile. Tiles do not share pixels, so no job needs a lock, and each pixel sees the same triangles in the same order as in the scalar version. The color and depth of one tile take 32 KB, which fits in the L1 cache of a performance core. Giesen's last section describes the same binning in the rasterizer he studies.

The job system belongs to the platform, the question Casey answered at 1:03:22 on day 011. The platform starts the workers once and puts a pointer to its `parallel_for` in `GameMemory`, so the game calls it like any other platform service. `parallel_for` returns before `game_update_and_render` does, so no job is still running code from the old library when F5 unloads it.

### Study

- [Fabian Giesen: Optimizing the basic rasterizer](https://fgiesen.wordpress.com/2013/02/10/optimizing-the-basic-rasterizer/) (read, 40 min): All of it. His `Vec4i` stands for a 4-lane integer vector with overloaded operators. Map each operation to a NEON intrinsic. "A match made in Github" describes tiles, bins and the 2 by 2 blocks of the rasterizer he studies.

### Build

1. Profile the scalar version and write down where the time goes at both resolutions: clearing, vertex work and clipping, triangle setup, the pixel loop. Read the IR and the assembly clang produces for the pixel loop, as in chapter 12, and check with `-Rpass-missed=loop-vectorize` from chapter 07 whether clang vectorized it, and if not, why.
2. Incremental edge functions. All goldens still pass.
3. The NEON pixel loop, 4 by 1 pixels per step. All goldens still pass.
4. Binning and tiles on the job system through the platform's `parallel_for`. All goldens still pass, with any number of workers.
5. A table in `docs/raster-perf.md`: median and maximum frame work time for scalar, incremental, NEON and NEON with tiles, at 960 by 540 and at 1920 by 1080, with the number of cores used.

### Done when

`run_images.sh` passes for all four versions on the Mac, and the scalar and incremental versions pass in Linux too. Your table has all 16 numbers, and you can explain each ratio from the profile: what fraction of the scalar time NEON could touch, what the scalar texture reads cost, and how close the tiled version comes to the core count. The textured scene at 960 by 540 runs within the 16.7 ms budget with room to spare, which the frame-time graph shows. Reaching 60 Hz at 1920 by 1080 is a stretch goal.

## Where this leads

You own a whole real-time program. A platform layer feeds a game function input, time and memory, reloads its code while it runs, and replays recorded input exactly. The game draws a textured 3D scene through the same stages every graphics API has: vertex transforms, clipping, perspective divide, viewport, rasterization with exact coverage rules, perspective-correct interpolation, texture sampling and a depth test. Golden images check every stage, the job system and NEON make it fast, and a ray tracer showed you the other way to make an image.

All of that work ran on the CPU. A GPU runs the same stages with thousands of lanes, fixed-function hardware for clipping, rasterization and texture filtering, and programs you supply for the per-vertex and per-pixel parts. Chapter 14, Game engines and shipped games, introduces that pipeline. The vertex shader is your transform code, the fragment shader is your per-pixel code, and the hardware does the rest. You build a small engine, script it with the Lua you embedded in chapter 11, and ship two games, one 2D and one 3D.
