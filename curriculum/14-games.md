---
id: 14
title: Game engines and shipped games
part: Graphics and games
weeks: 10
project: A small engine on SDL3's GPU API with a sprite batcher, a fixed-step loop, a mixer, Lua scripting and a cooked asset pack, plus two games built with it, a 2D platformer and a small lit 3D game, both published on itch.io.
---

Chapter 13 ended with a software rasterizer. A platform layer feeds a game library input, time and memory, reloads that library while it runs and replays recorded input. The game draws textured 3D scenes on the CPU through every stage a graphics API has, and golden images check each stage. Chapter 11 left you able to embed Lua in a C program, call into it under `lua_pcall`, and reload scripts without restarting.

This chapter moves rendering to the GPU and builds two games on the result. You learn the GPU pipeline through SDL3's GPU API, which runs on Metal on your Mac and on Vulkan or Direct3D 12 elsewhere. Then you build only the engine pieces a game needs: a fixed-step loop, a sprite batcher, collision, a mixer, Lua scripting, an asset cooker, lighting and shadows. The first game is a 2D platformer. You ship it to itch.io before you start the 3D work. The second game is a small 3D game with one level and one mechanic, and you ship that too.

The rule for the whole chapter: a system goes into the engine only after a game needs it. An engine written without a game grows features nobody calls. Handmade Hero works the same way, and so did your chapter 13 renderer, which grew one stage at a time because the next picture needed it.

The chapter comes now because the GPU pipeline is the chapter 13 pipeline with hardware under it. The vertex shader runs the transform code you wrote. The rasterizer runs your edge functions and fill rule. The fragment shader runs your per-pixel code, and the depth test is your depth buffer. You will recognize every fixed stage, so the new material is how a CPU program talks to a second processor that has its own memory and its own timeline.

## The GPU pipeline and a first triangle

The GPU is a separate processor with its own memory. Your program does not call it the way it calls a function. It writes commands into a command buffer, submits the buffer, and carries on. The GPU runs those commands later, while the CPU already prepares the next frame. Everything in a GPU API follows from that split.

The pipeline is the chapter 13 pipeline, with two stages you program and the rest done in hardware:

```
  chapter 13, on the CPU                    GPU pipeline
  ------------------------------------      ------------------------------------
  transform: projection * view * model      vertex shader      (your program)
  clip in clip space, divide by w           clipping, divide   (fixed hardware)
  viewport to pixels                        viewport           (fixed hardware)
  edge functions, fill rule, bounding box   rasterizer         (fixed hardware)
  per-pixel color, texture sample           fragment shader    (your program)
  depth test, write the pixel               depth test, blend  (fixed hardware)
```

A shader is a small program the GPU runs once per vertex or once per pixel, many at a time. The vertex shader gets one vertex and returns its clip-space position plus any values you want interpolated. The hardware clips, divides, rasterizes and interpolates those values with perspective-correct weights, as you did by hand. The fragment shader gets the interpolated values for one pixel and returns a color.

SDL3's GPU API wraps Metal, Vulkan and Direct3D 12 in one C interface. Its objects map onto the steps of a frame:

```
  once at startup                          every frame
  ---------------------------------------  -------------------------------------------
  SDL_CreateGPUDevice                      cmd = SDL_AcquireGPUCommandBuffer
  SDL_ClaimWindowForGPUDevice              SDL_WaitAndAcquireGPUSwapchainTexture(cmd)
  SDL_CreateGPUShader     x2               pass = SDL_BeginGPURenderPass(cmd, target)
  SDL_CreateGPUGraphicsPipeline              SDL_BindGPUGraphicsPipeline(pass)
     (shaders, vertex layout, blending,      SDL_DrawGPUPrimitives(pass, 3, 1, 0, 0)
      culling, depth state, target format) SDL_EndGPURenderPass(pass)
                                           SDL_SubmitGPUCommandBuffer(cmd)
```

A graphics pipeline bundles the two shaders with all the fixed-function state that chapter 13 kept in flags: cull mode, front face winding, depth test, blending and the format of the target. You build it once and bind it per draw.

Each backend wants shaders in its own format: MSL source for Metal, SPIR-V for Vulkan, DXIL for Direct3D 12. You write shaders once in HLSL, Microsoft's shading language, and SDL_shadercross compiles them offline to the other formats. HLSL reads like C with vector types. `float4` is four floats, `mul(M, v)` multiplies a matrix by a vector, and a value after a colon names its role. `SV_Position` marks the clip-space position the vertex shader returns, `SV_Target0` marks the color the fragment shader returns, `SV_VertexID` is the index of the vertex being processed, and `TEXCOORD0`, `TEXCOORD1` mark values to interpolate. The SDL examples you build in this step use exactly these.

shadercross has no prebuilt release, so build it from source on the Mac once. Its macOS build in CI uses the vendored dependencies, which include Microsoft's HLSL compiler. That compiler is a large LLVM-based project, so expect the build to take a while:

```
  brew install sdl3 cmake ninja
  git clone --recursive https://github.com/libsdl-org/SDL_shadercross
  cd SDL_shadercross
  cmake -S . -B build -GNinja -DCMAKE_BUILD_TYPE=Release -DSDLSHADERCROSS_VENDORED=ON
  cmake --build build
  ./build/shadercross --help
```

Then `shadercross tri.vert.hlsl -o tri.vert.msl` compiles a vertex shader to MSL. The stage comes from `.vert` or `.frag` in the file name. Two details trip people up on Metal. The MSL entry point is called `main0`, not `main`, so pass `"main0"` to `SDL_CreateGPUShader` for MSL. And the counts in `SDL_GPUShaderCreateInfo` (samplers, uniform buffers, storage buffers) must match what the shader declares. A triangle with no resources has all four at 0.

### Study

- [LearnOpenGL: Hello Triangle](https://learnopengl.com/Getting-started/Hello-Triangle) (read, 20 min): From the top of the page to the heading "Vertex input". This part describes the stages of the pipeline with a diagram and has no OpenGL calls. Stop at "Vertex input", where the OpenGL API starts.
- [SDL3 wiki: CategoryGPU](https://wiki.libsdl.org/SDL3/CategoryGPU) (read, 40 min): From the top through "Coordinate System", then "Debugging". The overview at the top walks through device, shaders, pipelines, command buffers, render passes and submission in the order you will write them. Note that NDC depth runs from 0 to 1, not from -1 to 1 as in chapter 13. Leave "Uniform Data" and "A Note On Cycling" for the next step.
- [SDL_gpu_examples](https://github.com/TheSpydog/SDL_gpu_examples) (do, 1 h 30 min): Caleb Cornett of the FNA team, who co-wrote the API, keeps one example per feature here. With Homebrew's SDL3 installed, `cmake -S . -B build && cmake --build build` builds them without the README's SDL build. Run `./build/SDL_gpu_examples`, and press D and A to step through the examples. Read `Examples/BasicTriangle.c`, `Examples/Common.c` (the `CommonInit` and `LoadShader` functions) and the shaders `RawTriangle.vert.hlsl` and `SolidColor.frag.hlsl` in `Content/Shaders/Source`.

### Build

1. Build shadercross. Recompile the two example shaders to MSL with it and diff your output against `Content/Shaders/Compiled/MSL`.
2. `shaders/build.sh`: compiles every `*.vert.hlsl` and `*.frag.hlsl` in `shaders/` to `.msl` in `$out/shaders/`, and stops on the first error.
3. `src/gpu_hello.c`, a separate program next to the platform layer: create a device that accepts `SDL_GPU_SHADERFORMAT_MSL`, claim a resizable 1280 by 720 window, load your two shaders and build a pipeline whose color target uses `SDL_GetGPUSwapchainTextureFormat`. Each frame, clear to dark gray and draw one triangle with red, green and blue corners. The vertex shader picks each corner's position and color from `SV_VertexID`.
4. Experiments, one at a time: swap two corners in the shader with `cull_mode` set to `SDL_GPU_CULLMODE_BACK` and `front_face` to `SDL_GPU_FRONTFACE_COUNTER_CLOCKWISE`. Set one corner's z to 1.5. Return `float4(input.Position.x / 1280.0, 0, 0, 1)` from the fragment shader, reading the `SV_Position` the vertex shader passed through.
5. Capture one frame in Xcode as the "Debugging" section describes.

### Done when

The window shows the triangle with smooth color between its corners, at any window size. With the corners swapped, the culled triangle disappears, and you can say which way it now winds on screen. With z at 1.5 the triangle is clipped against the far plane, and you can name the chapter 13 inequality that removed it. The fragment shader experiment shows a horizontal red ramp, which tells you `SV_Position` reaches the fragment shader in pixels. In the Xcode capture you can find your draw call, its vertex count and the bound pipeline.

## Buffers, textures and frames in flight

The triangle had no inputs. A real draw reads vertex buffers, index buffers, textures and a few matrices, and all of them must get from CPU memory to GPU memory. On SDL3 that takes three objects. A transfer buffer is memory the CPU can map and write. A copy pass on a command buffer copies from the transfer buffer into a GPU buffer or texture. The GPU buffer or texture is what shaders read. Small values that change every draw, such as a matrix, go through uniforms instead: `SDL_PushGPUVertexUniformData` copies up to a few matrices into the command buffer itself.

The hard part is time. When you write a transfer buffer for frame N+1, the GPU may still be reading the same memory for frame N. Evan Hemsley's post walks through the four ways an API can handle that and explains the one SDL chose, cycling. When you pass `cycle = true`, SDL hands you a fresh internal buffer if the old one is still in use, and the old contents stay valid for the commands that already reference them. Your rule is short. Cycle on the first write of each frame to anything you rewrite every frame. Do not cycle a resource whose old contents you still need.

```
  CPU   | build frame 1 | build frame 2 | build frame 3 |
  GPU           |  draw frame 1  |  draw frame 2  |  draw frame 3 |
                 ^ still reading frame 1's vertices while the CPU writes frame 2's
```

You can make the CPU wait for the GPU. `SDL_SubmitGPUCommandBufferAndAcquireFence` returns a fence, and `SDL_WaitForGPUFences` blocks until the GPU has finished that command buffer. You need a fence to read results back. Waiting on one every frame removes the overlap in the picture above, and you will measure what that costs.

Your platform layer now owns a GPU device in place of chapter 13's `SDL_Renderer`. The game keeps its fixed render size. The platform renders into an offscreen 960 by 540 color texture, then draws that texture into the swapchain with a viewport set to the letterbox rectangle. A full-screen pass like that takes a vertex shader that makes a full-screen triangle from `SV_VertexID` and a fragment shader that samples one texture with a nearest sampler and returns its color with alpha 1. The same pass shows chapter 13's CPU framebuffer too: upload it each frame into a `B8G8R8A8_UNORM` texture, which matches the byte order of `XRGB8888` in memory, and sample it the same way.

To draw chapter 13's textured scene on the GPU, two conventions change. SDL's depth range is [0, 1], so you need a projection matrix whose third row maps `z = -near` to 0 and `z = -far` to 1:

```
  f = 1 / tan(fovy / 2)
  | f/aspect  0   0                  0                      |
  | 0         f   0                  0                      |
  | 0         0   far/(near - far)   near*far/(near - far)  |
  | 0         0   -1                 0                      |
```

The other change is how the matrix reaches HLSL. Your `M4` stores `m[row][col]`, row after row. HLSL reads a `float4x4` in a constant buffer column after column unless you declare it `row_major`, so declare it `row_major float4x4` and keep writing `mul(M, v)`. The examples use XNA-style matrices built for the opposite convention, so copy their shader structure and not their matrix code. Camera space, front-face winding and texture coordinates stay as `docs/conventions.md` says: SDL's NDC has y up like yours, and its texture coordinates put (0, 0) at the first row of the image like yours.

Chapter 13 left the far checkerboard shimmering because a far pixel covers many texels and bilinear sampling reads only four. A mipmap chain stores the texture again at half size, quarter size and so on down to 1 by 1. The sampler picks the level whose texels are about one pixel in size, and with `SDL_GPU_SAMPLERMIPMAPMODE_LINEAR` it blends the two nearest levels. `SDL_GenerateMipmapsForGPUTexture` builds the chain on the GPU from level 0. The texture needs `num_levels` set at creation and the color-target usage flag, as the GenerateMipmaps example shows.

Because both renderers now draw the same scene, chapter 13's golden images become a test for the GPU path. Read the offscreen texture back with `SDL_DownloadFromGPUTexture` into a download transfer buffer, wait on the fence, and write a PPM. The two images will not match bit for bit. GPUs snap vertices to finer sub-pixel grids than your 4 bits, use the top-left fill rule in y-down screen space where your rasterizer took bottom and left edges, and filter textures with their own rounding. The differences should sit along triangle edges and be small everywhere else.

### Study

- [Evan Hemsley: SDL GPU API Concepts: Data Transfer and Cycling](https://moonside.games/posts/sdl-gpu-concepts-cycling/) (read, 30 min): All of it. Hemsley designed the API. Then reread "Uniform Data" and "A Note On Cycling" on the CategoryGPU page from step 1, which state the same rules in short form.
- [SDL_gpu_examples: TexturedQuad.c](https://github.com/TheSpydog/SDL_gpu_examples/blob/main/Examples/TexturedQuad.c) (do, 1 h 30 min): Vertex and index buffers, a texture upload through transfer buffers and a copy pass, and six samplers. Then read `CopyAndReadback.c` for the download and fence, `GenerateMipmaps.c` for the mipmap chain and the depth state in `DepthSampler.c`'s scene pipeline, all in the same folder. Run each one.
- [SDL3 wiki: SDL_CreateGPUShader](https://wiki.libsdl.org/SDL3/SDL_CreateGPUShader) (reference, as needed): The "Remarks" give the register spaces HLSL must use: `space1` for vertex uniforms, `space2` for fragment textures and samplers, `space3` for fragment uniforms. A shader that compiles and draws nothing usually breaks one of these rules.

### Build

1. Replace `SDL_Renderer` in the platform with the GPU device. Keep the CPU path: upload the game's framebuffer each frame through a transfer buffer mapped with `cycle = true`, and draw it letterboxed with the full-screen pass. Every chapter 13 scene still runs.
2. `m4_perspective_z01` in `math.c` with unit tests: `z = -near` maps to depth 0 and `z = -far` to depth 1.
3. A GPU scene mode in the platform: the chapter 13 textured scene (checkerboard floor and textured cubes) drawn with indexed vertex buffers, one uniform matrix per object, a `D32_FLOAT` depth texture with the LESS test, back-face culling and the bilinear sampler. Check the depth format with `SDL_GPUTextureSupportsFormat` at startup.
4. A key that downloads the offscreen texture and writes `gpu.ppm`. Render the same camera and time with both renderers and compare them with `ppmdiff`.
5. Mipmaps for the checkerboard, and a key that switches between a sampler with mipmaps and one without.
6. Turn vsync off with `SDL_SetGPUSwapchainParameters` and `SDL_GPU_PRESENTMODE_IMMEDIATE` (check `SDL_WindowSupportsGPUPresentMode` first). Measure frames per second and the CPU time per frame with and without a fence wait after every submit.

### Done when

The GPU scene matches the CPU golden with fewer than 1% of pixels differing by more than 8 in any channel, and the `ppmdiff` image is white only along edges. With mipmaps on, the far checkerboard turns smooth gray instead of shimmering while you fly. All chapter 13 scenes still display through the CPU path. You have the two frame rates from the fence experiment, and you can explain the gap with the timeline picture above.

## A fixed-step loop with actions and interpolation

Chapter 13's game took one step per displayed frame, with whatever `dt` the frame had. A jump then depends on the frame rate: at a long frame the player moves further between collision checks, and float rounding makes the arc differ from run to run. Games fix this the way your CHIP-8 front end did. The simulation advances in fixed ticks, here 1/120 s, and the platform runs as many ticks as the elapsed time allows. Rendering happens once per displayed frame.

Fiedler's last section handles the leftover time. After the ticks of a frame, the accumulator holds a remainder smaller than one tick. Drawing the state of the last tick would show motion that lags real time by a varying amount, which looks like stutter. Drawing a blend of the previous tick's state and the current one, weighted by `alpha = accumulator / dt`, removes it. The game API splits in two:

```c
void game_update(GameMemory *memory, GameInput *input, float dt);       // one tick
void game_render(GameMemory *memory, RenderOutput *out, float alpha);   // once per frame
```

`game_update` copies each entity's position into `prev_position` before it moves anything. `game_render` draws `lerp(prev_position, position, alpha)`. Interpolate only what you draw. The state itself stays exactly as the ticks left it.

Input needs care once a frame can contain several ticks. Chapter 13 counted `transitions` per frame. Give the press to the first tick of the frame only, and give later ticks of the same frame the held state with zero transitions. A jump press then fires once, even when a stall makes the platform run five ticks to catch up. Cap the catch-up at 8 ticks and count the dropped time, so a debugger pause does not make the game fast-forward.

The game should not know about keys. It knows actions: left, right, jump, shoot, pause. The platform holds a table that maps scancodes and gamepad buttons to actions, and the left stick to a move axis with a dead zone. SDL3's gamepad API names buttons by position (south, east, d-pad up), so the mapping works for any supported controller. Open gamepads when `SDL_EVENT_GAMEPAD_ADDED` arrives, not only at startup, since macOS reports controllers after the program has started.

Recording from chapter 13 now records per tick. A recording becomes a list of tick inputs, and playback feeds them through `game_update` with the same fixed `dt`. The FNV-1a hash of the permanent block at the end of a playback pass must match every pass.

### Study

- [Glenn Fiedler: Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) (read, 15 min): Only "The final touch", the section chapter 06 told you to skip. The rest you already know.
- [SDL3 wiki: CategoryGamepad](https://wiki.libsdl.org/SDL3/CategoryGamepad) (reference, as needed): The overview, then `SDL_OpenGamepad`, `SDL_EVENT_GAMEPAD_ADDED`, `SDL_GamepadButton`, `SDL_GamepadAxis` and `SDL_GamepadButtonEvent`. Initialize SDL with `SDL_INIT_GAMEPAD`.

### Build

1. Split the game API as above and move the platform to fixed ticks of 1/120 s with an accumulator in `uint64_t` nanoseconds, a cap of 8 ticks per frame and a counter of dropped ticks.
2. `GameInput` with an array of actions, each `{ bool down; int transitions; }`, plus a float move axis. Keyboard and gamepad mappings in the platform, with hotplug.
3. A test scene drawn on the CPU path: a square that runs and jumps under gravity with a fixed jump velocity. Print the peak height of every jump.
4. A key that stalls the platform with `SDL_Delay(100)` every second. A second key switches the tick rate between 120 Hz and 50 Hz. A third turns interpolation off.
5. Recording and playback per tick, with the hash check.

### Done when

Every jump prints the same peak height, bit for bit, with and without stalls, and one press during a stall gives one jump. At 50 Hz with interpolation off the square stutters on your display, and with interpolation on it moves smoothly. A gamepad plugged in while the game runs moves the square. Playback passes print identical hashes.

## Sprites in one draw call, and text

The first game draws sprites: the player, enemies, bullets, tiles, particles, letters. Each sprite is a textured rectangle. Drawing each one with its own draw call costs a fixed amount of CPU and driver time per call, and a level with a few thousand tiles and particles spends the frame on that overhead. A sprite batcher draws all sprites that share a texture with one call.

Two ideas make that work. All sprite images go into one texture, an atlas, and each sprite stores the rectangle of its image as texture coordinates. And the vertex shader builds the quads itself. Hemsley's version puts one 64-byte record per sprite into a storage buffer: position, rotation, size, atlas rectangle and color. The draw asks for `6 * count` vertices with no vertex buffer bound. Vertex `id` reads record `id / 6` and corner `id % 6` of the two triangles. The CPU writes 64 bytes per sprite and the GPU does the rest. His post has a typo in the vertex shader that the repository's version does not: the corner index is `triangleIndices[id % 6]`.

The game cannot call SDL, so the sprites cross the boundary as data. `game_render` fills a `RenderOutput` in transient memory: a camera matrix, an array of sprite records and a list of batches, each one a texture handle with a first index and a count. A new batch starts when the texture changes. The platform uploads the sprite array with one transfer buffer, cycled on the first map of the frame, binds the storage buffer and issues one draw per batch.

Textures are platform objects. The game asks for them through function pointers in `GameMemory`, the way it calls `parallel_for` since chapter 13. `load_texture(path)` uses `SDL_LoadPNG` and `SDL_ConvertSurface` to `SDL_PIXELFORMAT_ABGR8888`, which puts the bytes in R, G, B, A order for an `R8G8B8A8_UNORM` texture. `create_texture(width, height, rgba)` takes pixels the game made. Both return a small integer handle that the game stores in its permanent memory. The handle survives a code reload because the texture lives in the platform.

The projection for sprites is orthographic: it maps x from 0 to 960 and y from 0 to 540, y down, straight to NDC, with no divide. Alpha blending uses the blend state in Hemsley's pipeline. Pixel art needs the nearest sampler and sprite positions rounded to whole pixels after interpolation, or edges shimmer as the camera moves.

Text is sprites from a font atlas. stb_truetype's `stbtt_BakeFontBitmap` rasterizes a range of characters from a TrueType file into a one-channel bitmap and records each glyph's rectangle and advance. Expand the bitmap to RGBA with white color and the coverage in alpha, make a texture of it, and turn each character into a sprite with `stbtt_GetBakedQuad`. The header warns that it does no range checking on font files, so load only fonts you ship yourself. Kenney's asset packs at kenney.nl are released as CC0 and include pixel fonts and sprite sheets you can use while you have no art of your own.

### Study

- [Evan Hemsley: SDL GPU API Concepts: Sprite Batcher](https://moonside.games/posts/sdl-gpu-sprite-batcher/) (read, 40 min): All of it. "The Vertex Shader" and "The Sprite Storage Buffer" carry the design. The padding note under the vertex shader explains why the record has two unused floats.
- [SDL_gpu_examples: PullSpriteBatch.c](https://github.com/TheSpydog/SDL_gpu_examples/blob/main/Examples/PullSpriteBatch.c) (do, 45 min): The complete program from the post, with `PullSpriteBatch.vert.hlsl` in `Content/Shaders/Source`. Run it and raise `SPRITE_COUNT` until the frame time passes 16.7 ms on your Mac.
- [stb_truetype.h](https://github.com/nothings/stb/blob/master/stb_truetype.h) (reference, as needed): Sean Barrett's single-file font rasterizer, documented in its header. The "USAGE" comment and the "SAMPLE PROGRAMS" block that bakes a font and draws text with `stbtt_GetBakedQuad`.

### Build

1. `RenderOutput` in `game.h`, with `SpriteInstance` laid out as in the post and a `static_assert` that it is 64 bytes. Batches as above.
2. The platform side: the sprite pipeline, an upload per frame, one draw per batch into the offscreen target, then the letterbox pass.
3. `load_texture` and `create_texture` as platform services, with handle 0 meaning none. A failed load prints the path and returns 0, and the game draws a magenta placeholder.
4. `draw_sprite` and `draw_text` in the game. Port the chapter 13 frame-time graph to sprites, using a 1 by 1 white texture for solid rectangles.
5. A benchmark scene: N sprites bouncing inside the screen, N set by keys from 1,000 to 200,000. Show N and the work time on screen with `draw_text`. Profile the CPU side with the chapter 07 profiler.

### Done when

The benchmark holds 60 Hz with 100,000 sprites on the Mac, and you know from the profile how the frame divides between game update, sprite writes and the upload. Text renders crisply at its baked size. Reloading the game code with F5 keeps every texture. `nm -u` on `game.dylib` still lists no SDL symbols.

## Entities, tiles and collision

Now the first game takes shape: a 2D platformer with a player who runs, jumps and shoots, enemies that patrol and shoot back, and three levels. Every system in this step exists because that game needs it.

Entities live in one flat array in permanent memory. Use one struct for every kind, with a `kind` field and flags such as `COLLIDES` or `HURTS_PLAYER`, so a projectile and an enemy share the movement and collision code. Other code refers to an entity by a handle, an index plus a generation, never by pointer. Weissflog's post explains why. A pointer to a destroyed entity points at whatever reuses the slot. A handle whose generation no longer matches the slot fails the lookup and returns null.

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

Levels are tilemaps. Keep them as text files, one character per 16-pixel tile: `#` for solid, `-` for a one-way platform, `P` for the player start, `E` for an enemy, `.` for empty. The loader turns the characters into a tile array and spawns entities. A camera follows the player, and the renderer draws only the tiles inside the camera rectangle.

Player movement against tiles follows Monteiro's tile-based smooth method. Move along x first, then along y. For each axis, find the rows or columns of tiles the player's box covers, scan from the leading edge in the direction of motion for the nearest solid tile, and move by the smaller of the wanted distance and the distance to that tile. The scan covers every tile between the start and the end of the move, so a fast fall cannot skip a one-tile floor. Two small timers make the jump feel fair. Coyote time lets a jump start within about 0.1 s after the player walks off a ledge. A jump buffer remembers a press for about 0.1 s and fires it on landing. Both are counters in ticks.

Entities against entities need a broadphase. Comparing every pair costs n squared checks, which is fine for 30 entities and too slow for 2,000 bullets. A uniform grid in transient memory, rebuilt every tick, puts each entity into the cells its box covers. Then only entities that share a cell get an exact box overlap test. Bullets move less than their own size per tick at 120 Hz, so an overlap test after each move does not miss hits. State that bound in a comment and assert it.

### Study

- [Andre Weissflog: Handles are the better pointers](https://floooh.github.io/2018/06/17/handles-vs-pointers.html) (read, 30 min): All of it, including the update at the end on per-slot generation counters. Weissflog writes the sokol libraries, and the post comes from replacing smart pointers in large C++ code bases.
- [Rodrigo Monteiro: The guide to implementing 2D platformers](http://higherorderfun.com/blog/2012/05/20/the-guide-to-implementing-2d-platformers/) (read, 45 min): "Type #2: Tile Based (Smooth)" through "One-way platforms", then "Acceleration" and "Jump control" under "General Considerations". Skip slopes, ladders, the bitmask and vectorial types.
- [Robert Nystrom: Game Programming Patterns, Spatial Partition](https://gameprogrammingpatterns.com/spatial-partition.html) (read, 40 min): All of it. Nystrom wrote Crafting Interpreters, which you know from chapter 11. His grid stores a linked list per cell. Yours is rebuilt every tick in the transient arena, so a count per cell and one flat array of entries is simpler.

### Build

1. `World` with an entity array, free list, handles and `entity_get`. Unit tests: a handle to a destroyed entity returns null, a handle to a reused slot returns null, index 0 and an index past capacity return null.
2. The level loader and three level files. The camera, and tiles drawn as sprites from the atlas.
3. Player movement with acceleration, variable jump height, coyote time, jump buffer and one-way platforms, all tuned by constants in one struct.
4. Enemies that walk until a wall or ledge and turn, projectiles from the player and enemies, damage and death.
5. The grid broadphase, plus a debug key that draws every entity box and the occupied grid cells.
6. `tests/collide_test.c`, run headless with no SDL: drop the player from 100 tiles up at maximum fall speed onto a one-tile floor, run into walls at maximum speed from both sides, and jump through and land on a one-way platform. Check the end positions.
7. A stress scene with 2,000 bullets. Time the pair checks with brute force and with the grid.

### Done when

The collision tests pass, and the player never ends a tick inside a solid tile in any test or in a ten-minute play session with the box debug view on. The handle tests pass under AddressSanitizer. Jumping off a ledge a few ticks late still jumps, and a press just before landing jumps on landing. You have both stress timings, and the grid version keeps the tick under 1 ms.

## Sound, Lua and game feel

The game plays but feels flat and silent. This step adds sound, moves enemy behavior and tuning numbers to Lua, and spends the rest of the time on feel.

Sound works like the framebuffer of chapter 13: the platform hands the game a buffer and the game fills it. In chapter 06 you kept a few frames of samples queued in an SDL audio stream. Do the same here, with stereo float samples at 48,000 Hz. Each frame the platform asks `game_get_sound_samples(memory, out, frames)` for enough samples to keep about three frames queued, then puts them into the stream. The game mixes. Each playing voice holds a sound handle, a read position, a volume and a pan. Mixing is a loop that adds each voice's samples, scaled by its volume, into the output buffer, followed by a clamp to [-1, 1]. A platform service `load_sound(path)` reads a WAV with `SDL_LoadWAV`, converts it to stereo float at 48,000 Hz with `SDL_ConvertAudioSamples`, and returns a handle and a pointer to the samples in platform memory.

Gameplay code does not touch the mixer. It posts a request, "play sound S at volume V", into a queue, as in Nystrom's event queue chapter, and the mixer drains the queue. The queue lets you merge duplicates: ten bullets hitting a wall in the same tick play one sound slightly louder, not ten copies of it on top of each other.

Lua comes back from chapter 11 for two jobs. `scripts/tuning.lua` returns a table of numbers: run speed, jump velocity, gravity, coyote ticks, shake strength. `scripts/enemies.lua` holds one update function per enemy type. The C side calls it once per tick for each enemy with a small table of that enemy's fields and copies the returned values back. The platform checks the modification time of `scripts/` once per second, as your HTTP server did, and sets a flag in `GameInput`. The game then reloads the scripts under `lua_pcall` and keeps the old ones if the new file has an error.

Code reload adds one rule. The Lua state belongs to the game library: its allocator, its C functions and its library code all live in the library's pages, which `dlclose` unmaps. That is chapter 13's planted string-literal bug again, in a bigger form. Add `game_unload(memory)`, which the platform calls before `dlclose`, and close the Lua state there. After a reload the game opens a new state and runs the scripts again. All game state lives in C structs, and Lua holds only behavior and numbers, so nothing is lost. That also keeps replay working, since the hash covers the permanent block and the scripts keep no state between ticks.

Game feel is the last part. Jan Willem Nijman's talk takes a dull shooter and adds about 30 small changes, one at a time, until it feels good: bigger bullets, muzzle flash, knockback, screen shake, hit pause, permanent shell casings, sounds with varied pitch, a camera that leads the player. Most of them are a few lines each. Every one of them is a number you will tune many times, so every one goes in `tuning.lua` with a switch to turn it off.

### Study

- [Jan Willem Nijman: The art of screenshake](https://www.youtube.com/watch?v=AJdEqssNZ-U) (watch, 45 min): All of it. INDIGO Classes 2013, from the Vlambeer co-founder who made Nuclear Throne. Write down each change as he adds it.
- [Robert Nystrom: Game Programming Patterns, Event Queue](https://gameprogrammingpatterns.com/event-queue.html) (read, 40 min): All of it. His running example is an audio engine. Skip "Spanning threads", since your mixer runs on the main thread.
- [SDL3 wiki: SDL_LoadWAV](https://wiki.libsdl.org/SDL3/SDL_LoadWAV) (reference, as needed): And `SDL_ConvertAudioSamples` from its "See Also" list. The audio stream calls are the ones you used in chapter 06. For Lua, use the registry, `luaL_traceback` and `lua_sethook` pages from chapter 11.

### Build

1. `load_sound`, `game_get_sound_samples`, the voice mixer and the request queue with merging. Music as a looping voice with its own volume.
2. Sounds for jump, shot, hit, enemy death, pickup and player death. Generate them with a sound effect tool such as jsfxr, or take them from a CC0 pack.
3. `game_unload`, a Lua state created on the first update after each load, `tuning.lua` read into a C struct, and `enemies.lua` with at least two enemy behaviors. An instruction budget per call with `lua_sethook`, as in chapter 11.
4. At least eight effects from the talk, each with a switch in `tuning.lua`.
5. A title screen, three levels, a death and restart, and a win screen.
6. Play the whole game with all effects off, then with all on. Ask someone else to play both versions.

### Done when

The whole game can be played from title to win screen. A change to a number in `tuning.lua` shows in the running game within a second, and a syntax error there prints a traceback and leaves the game running on the old values. F5 after a C change works while enemies run Lua behavior, with no crash and no sanitizer report. Ten simultaneous hits play as one sound. Sound starts no later than one frame after the event that caused it, which you check by recording the screen and the audio together and stepping through the video. Your tester can tell which version had the effects on.

## Shipping game one

A game that runs only from your build directory is not finished. Shipping takes a release build, a package that runs on a Mac that has never seen your source, and a page where people download it.

The release build compiles the platform and the game as one unit with `-O2`, no sanitizers and no code reload. Link everything that is not part of macOS statically, so the executable depends only on system libraries. Lua is already a static library from chapter 11. For SDL, build the 3.4 release you use from source with `-DSDL_SHARED=OFF -DSDL_STATIC=ON` and an install prefix in your home directory, then link with the flags `pkg-config --static --libs sdl3` prints when `PKG_CONFIG_PATH` points into that prefix. `otool -L` on the result should list only `/System/Library` and `/usr/lib` paths.

A Mac app is a directory with a fixed layout:

```
  Platformer.app/
    Contents/
      Info.plist          CFBundleExecutable, CFBundleIdentifier, CFBundleName,
                          CFBundlePackageType = APPL, CFBundleShortVersionString
      MacOS/platformer    the executable
      Resources/          shaders, textures, sounds, levels, scripts
```

Inside a bundle, `SDL_GetBasePath` returns `Contents/Resources/`, so build every asset path from it. Writable files go to `SDL_GetPrefPath`, which lives in the user's Library folder: a log file and later the saves. Both functions are in the SDL3 API index from chapter 06. Write the log there and flush it on every line, so a crash on a tester's machine leaves you something to read.

macOS checks the signature of apps downloaded from the internet. clang already signs your executable ad hoc on Apple Silicon. After you assemble the bundle, sign the whole bundle ad hoc with `codesign --force --sign - Platformer.app` so its resources are sealed too. An app signed this way runs, but Gatekeeper blocks the first launch of a downloaded copy. The player then opens System Settings, Privacy & Security, and clicks "Open Anyway" in the Security section, which Apple's support page describes. Say that on your itch.io page. To remove that step, Apple requires a paid Developer Program membership, a Developer ID certificate, the hardened runtime and notarization. Apple's notarization page lists those requirements. Whether that is worth the fee for a first game is your call.

itch.io hosts the files. butler, itch.io's command-line uploader, pushes a directory or zip to a channel of your project, and a channel name containing `mac` tags the upload as a Mac download. Keep the project in draft or restricted mode until a second machine has started it. If your NVIDIA laptop runs Windows, a Windows build is a stretch goal: Homebrew's `mingw-w64` cross compiler with SDL's `SDL3-devel-3.4.x-mingw` package builds the executable on the Mac, shadercross compiles your shaders to SPIR-V, and the device then selects Vulkan.

### Study

- [SDL3 wiki: README-macos](https://wiki.libsdl.org/SDL3/README-macos) (read, 20 min): "Command Line Build" for building SDL from source with CMake, and "Using the Simple DirectMedia Layer with a traditional Makefile" for the bundle layout and the Info.plist. Ignore the Xcode sections.
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) (read, 15 min): "Overview" and "Prepare your software for notarization", so you know what the paid route asks for. The Xcode workflow below that does not apply to a command-line build.
- [itch.io: Pushing builds with butler](https://itch.io/docs/butler/pushing.html) (read, 15 min): The top section and "Channel names". The "Installing butler" and "Logging in" pages are linked from the same manual's sidebar.

### Build

1. `build.sh release`: the unity build with static SDL and Lua, then the bundle, the Info.plist and the ad hoc signature.
2. All asset and script paths from `SDL_GetBasePath`, the log file in `SDL_GetPrefPath`, and a clear error screen for a missing file, which you test by deleting one sound from the bundle.
3. A version number shown on the title screen and in the log.
4. An itch.io page with screenshots, controls and the "Open Anyway" instructions. Push with butler to a `mac` channel while the page is restricted.
5. Download the build on a second Mac, or in a new macOS user account if you have no second Mac, and play it through. Then publish the page.

### Done when

`otool -L` on the shipped executable lists only system libraries. The downloaded copy starts on a machine or account that never built it, after the "Open Anyway" step, and plays from title to win screen. The log file appears in the pref folder. The page is public, and its download is tagged for macOS.

## Models and a cooked asset pack

The 3D game needs meshes, and meshes come from modeling tools as glTF files. glTF stores a scene as JSON that points into binary buffers. A node holds a transform and a mesh. A mesh holds primitives. A primitive names accessors for its positions, normals, texture coordinates and indices. An accessor describes how to read one array out of a buffer view, which is a byte range of a buffer. glTF uses a right-handed system with +Y up and meters as the unit, the same as your `docs/conventions.md`.

Parsing all of that at startup is the wrong place for the work. Source formats are for tools: PNG compresses, glTF supports dozens of layouts, and both need validation. A cook step turns them once into the exact bytes the engine uploads. `tools/cook.c` is a separate program, so it may link SDL and cgltf. It reads a manifest of source files and writes one `data.pack`:

```
  header    magic "PAK1", version, entry count, offset of the entry table
  entries   name hash, type (texture, mesh, sound), offset, size
  texture   width, height, then width * height * 4 bytes RGBA
  mesh      vertex count, index count, bounds (min, max),
            vertices: position, normal, uv as 8 floats each, then uint32 indices
```

Write every field with a fixed width in little-endian order, one field at a time. Do not `fwrite` a struct, because padding and layout are compiler choices. Bake each node's world transform into its vertices with `cgltf_node_transform_world` and keep only triangle primitives. cgltf's `cgltf_accessor_unpack_floats` and `cgltf_accessor_unpack_indices` read accessors of any layout into flat arrays. Images inside a `.glb` file are PNG bytes in a buffer view, which `SDL_LoadPNG_IO` with `SDL_IOFromConstMem` decodes.

The runtime trusts nothing in the pack. Check the magic and the version, check that every offset plus size fits inside the file without overflowing, check that counts times element sizes fit in their entries, and check every index against the vertex count. That is the defensive parsing of your chapter 04 JSON parser, aimed at binary data. Fuzz the loader the way you fuzzed that parser.

The game reads the pack through a `read_file` service into its permanent arena and asks the platform to create a GPU texture with mipmaps or a mesh from the bytes. Sprites and sounds for game one can move into a pack too, but they do not have to.

### Study

- [Khronos glTF Tutorial: The Basic Structure of glTF](https://github.khronos.org/glTF-Tutorials/gltfTutorial/gltfTutorial_002_BasicGltfStructure.html) (read, 1 h 15 min): Marco Hutter's tutorial in the Khronos repository. This page and the next three through the "Next" links, ending with "Buffers, BufferViews, and Accessors". Then "Meshes" and "Textures, Images, and Samplers" from the index. Skip animations, morph targets, skins and cameras.
- [cgltf](https://github.com/jkuhlmann/cgltf) (reference, as needed): The README's "Usage: Loading", then the reference comment at the top of `cgltf.h` for `cgltf_parse_file`, `cgltf_load_buffers`, `cgltf_validate`, `cgltf_node_transform_world` and the two unpack functions.

### Build

1. `tools/cook.c` with a manifest file, texture and mesh entries, and a `--dump` mode that prints the table of a pack.
2. The pack loader in the game with every check above, and unit tests with hand-made broken packs: wrong magic, an offset past the end, an offset plus size that overflows, an index past the vertex count.
3. A fuzz run of the loader under AddressSanitizer: truncate a good pack at every length and flip random bits.
4. `create_mesh` in the platform and a mesh pipeline with one uniform block per draw. Load a scene from Kenney's prototype or platformer kits, or one you model in Blender and export as glTF, and fly through it with the chapter 13 camera, textured and unlit.

### Done when

`cook --dump` lists every entry with its sizes. The broken-pack tests fail cleanly with a message, and the fuzz run finds no crash or sanitizer report in 100,000 inputs. The scene draws with correct textures and winding, and nothing in the game's startup path parses JSON or decodes PNG.

## Lighting and a shadow map

An unlit scene has no shape. Lighting computes, per pixel, how much light reaches the surface and how much of it leaves toward the camera. Blinn-Phong is the standard first model, built from three terms. Ambient is a constant. Diffuse is `max(dot(N, L), 0)`, where `N` is the surface normal and `L` points toward the light. Specular is `pow(max(dot(N, H), 0), shininess)`, where `H` is the normalized halfway vector between `L` and the direction to the camera. Normals need their own matrix, the inverse transpose of the model matrix's upper 3 by 3, or non-uniform scaling bends them. Your meshes are baked into world space by the cooker, so the normal matrix is identity until objects move.

A shadow map answers whether the light sees a point. First render the scene from the light into a depth texture, with no color target. Then, while shading a pixel from the camera, transform its world position into the light's clip space and compare its depth with the stored one. A directional light such as the sun uses an orthographic projection that covers the level. The frame now has two render passes:

```
  pass 1  shadow    target: 2048 x 2048 D32_FLOAT       light's view-projection, depth only
  pass 2  main      target: color + depth               camera; samples the shadow map
  pass 3  present   target: swapchain                   letterbox pass from step 2
```

LearnOpenGL teaches all of this in OpenGL, and three of its conventions differ from SDL's. Its shader maps NDC from [-1, 1] to [0, 1] with `* 0.5 + 0.5` for both the texture lookup and the depth. On SDL, NDC depth is already in [0, 1], so use z as it is. Texture y runs down on SDL while NDC y runs up, so the lookup is `u = x * 0.5 + 0.5` and `v = 0.5 - y * 0.5`. And its border-color trick for points outside the shadow map becomes an explicit range check in your shader. Make the depth texture with both the depth-target and the sampler usage flags so the main pass can read it. Its bias, front-face culling in the shadow pass and percentage-closer filtering all carry over unchanged.

Frustum culling on the CPU skips meshes the camera cannot see. Each row combination of the view-projection matrix gives one clip plane: row 4 plus row 1 is the left plane, row 4 minus row 1 the right, and so on, with row 3 alone for SDL's near plane at depth 0. Test each mesh's bounding sphere against the six planes before you record its draw.

### Study

- [LearnOpenGL: Basic Lighting](https://learnopengl.com/Lighting/Basic-Lighting) (read, 45 min): All of it. "One last thing" covers the normal matrix. Skip the exercises.
- [LearnOpenGL: Advanced Lighting](https://learnopengl.com/Advanced-Lighting/Advanced-Lighting) (read, 15 min): The "Blinn-Phong" section, which replaces the reflection vector with the halfway vector.
- [LearnOpenGL: Shadow Mapping](https://learnopengl.com/Advanced-Lighting/Shadows/Shadow-Mapping) (read, 1 h): From "Shadow mapping" through "PCF". Read "Orthographic vs perspective" too, then stop. Translate the coordinate mapping as described above. The `DepthSampler.c` example from step 2 shows a depth texture bound as a sampler on SDL.

### Build

1. Normals in the cooked meshes, and a Blinn-Phong fragment shader with one directional light and ambient. Light direction, color and shininess come from `tuning.lua`.
2. The shadow pass and the shadow lookup with a slope-scaled bias and 3 by 3 PCF. A debug key draws the shadow map in a corner of the screen.
3. CPU frustum culling with bounding spheres, and a counter of drawn and culled meshes on screen.
4. An Xcode frame capture showing both passes, their targets and the draw count of each.
5. Profile a frame: CPU time with your profiler, GPU time per pass from the Xcode capture.

### Done when

Shadows touch the objects that cast them, with no acne on lit floors and no visible gap under boxes. The culled count rises when you turn away from most of the level, and nothing visible ever disappears. The capture shows the shadow pass writing depth only. You have the CPU and GPU time of a frame and can say which one limits the frame rate.

## Game two, shipped

The second game uses everything so far: one level, one mechanic, done well. A reasonable scope is a third-person or first-person game where the player runs and jumps through a level of boxes and platforms to collect items against a clock, with one twist such as a dash, a grappling point or moving platforms. Write the scope down before you start and cut from it, not add to it.

Movement against the level reuses step 5 in three dimensions. The player is an axis-aligned box. The level's collision is a list of boxes, which the cooker takes from glTF nodes whose names start with `col_`, so the art and the collision come from the same file. Move along x, then z, then y. For each axis, find the nearest box in the direction of motion within the move distance and stop short of it. With a few hundred boxes a linear scan per axis is fast enough. Measure it before you add a grid. Arbitrary triangle collision, slopes and stairs are a project of their own and outside this chapter.

The game now has modes: title, playing, paused, settings, finished. A switch over an enum in `game_update` handles them, as Nystrom's state chapter starts out. A pause menu that returns to the mode it came from is his pushdown automaton, a small stack of modes. While paused the simulation does not tick, the music volume drops and sound effects stop.

Saves and settings go to `SDL_GetPrefPath`. Store the best time per level and the settings (music volume, effects volume, mouse sensitivity, invert-y, fullscreen) in a small file with a version number first. A file from an older version loads with defaults for the new fields. A corrupted or truncated file loads as defaults and does not crash. Write to a temporary name and rename it over the old file, as your build does with the game library, so a crash during a save leaves the old file intact.

### Study

- [Robert Nystrom: Game Programming Patterns, State](https://gameprogrammingpatterns.com/state.html) (read, 40 min): From the start through "Enums and Switches", then "Pushdown Automata". The class-per-state sections are C++ design you do not need in C.
- [SDL3 wiki: SDL_GetPrefPath](https://wiki.libsdl.org/SDL3/SDL_GetPrefPath) (reference, as needed): The rules for the `org` and `app` strings and the paths it returns on each platform.

### Build

1. A written scope in `docs/game2.md`: the mechanic, the win condition, the level and what you will cut if time runs short.
2. 3D box collision with gravity, ground check, coyote time and jump buffer from step 5, a camera that follows the player, and collision boxes from `col_` nodes.
3. The level, the mechanic, collectibles, a clock and a finish.
4. Modes with a pause stack, a settings screen with the five settings, and saving and loading as above. Tests that load a file from an older version, a truncated file and a file of random bytes.
5. Profile one full frame of the finished level and write down in `docs/frame.md` where the 16.7 ms go, on the CPU and on the GPU.
6. Ship it as in step 7, to a second itch.io page.

### Done when

The game plays from title to finish, and the best time survives a restart. The three broken save files load as defaults. Pausing stops the clock and the simulation, and settings persist across launches. The frame holds 60 Hz on the Mac in the heaviest view of the level, and `docs/frame.md` accounts for the frame time. Both games are public on itch.io and start on a machine or account that did not build them.

## Where this leads

You have taken two games from an empty window to a public download. Your engine draws through a GPU pipeline you can explain stage by stage, keeps CPU and GPU work overlapped without overwriting data in flight, simulates at a fixed rate, plays mixed sound, runs gameplay scripts that reload while the game runs, loads validated binary assets and ships as a signed app bundle. Each piece exists because one of the two games needed it.

All of that ran as an ordinary process. macOS created it, gave it virtual memory, scheduled its threads, and passed its commands to the GPU driver. Chapter 08 showed you those services from the user side and in xv6. Chapter 15, A small kernel, writes them yourself: you boot your own kernel on QEMU, set up interrupts and page tables by hand and switch between two tasks. The GPU returns in chapter 20, where CUDA shows you the execution model under the shaders you wrote here.
