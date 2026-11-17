---
id: 21
title: A tensor library
part: GPUs and a tensor library
weeks: 8
project: MiniTorch modules 1 to 4 on top of its module 0 foundations, with a parallel CPU backend and a CUDA backend, then one differentiable operation of your own with hand-written forward and backward kernels on both backends, checked against finite differences and PyTorch.
---

Chapter 20 ended with CUDA kernels that you can test, profile and explain: a matrix multiply that gets within reach of cuBLAS, a softmax that reads each row once, and the same two kernels in Triton. Each of them handled one operation with a fixed shape and ran from a harness you wrote for that operation. PyTorch, which you have used for years, wraps kernels like these in a lot of machinery: tensors of any shape and stride, broadcasting, a graph that records every operation, and a backward pass through that graph. This chapter builds that machinery.

MiniTorch is a teaching library by Sasha Rush, written for the Machine Learning Engineering course at Cornell Tech. It is a pure Python reimplementation of the Torch API. Each module is a template repository with TODO markers and a test suite, and you are done with a task when its tests pass. You build scalar automatic differentiation first, then tensors with strides and broadcasting, then a fast CPU backend and a CUDA backend, then convolutions and two real classifiers. The last step is yours. You design one differentiable operation, write its forward and backward kernels for both backends, and check the result against finite differences and PyTorch.

Almost everything you built in this book shows up again. A MiniTorch tensor is one flat buffer plus a shape and strides, and a view shares that buffer the way a `str_slice` from chapter 04 points into the original string. The CPU backend runs loops in parallel across cores, as your chapter 09 job system did, and Numba compiles those loops to machine code through LLVM, the compiler you drove by hand in chapter 12. You read that machine code for NEON instructions as you did in chapter 07. The CUDA backend needs the map, the shared-memory reduction and the tiled matrix multiply from chapter 20, rewritten in the Numba syntax you met in GPU Puzzles.

Everything except the GPU half of module 3 runs on the Mac. Numba ships Apple Silicon wheels, and MiniTorch's CPU code runs there. The CUDA parts run on the NVIDIA laptop under the Ubuntu install from chapter 20.

## Setup, module 0 and property tests

MiniTorch has five template repositories on GitHub, `minitorch/Module-0` to `minitorch/Module-4`. Each one starts from the files of the previous module, so you carry your own code forward. From module 1 on, each template has a `sync_previous_module.py` script and a `files_to_sync.txt` that lists what to copy. Put all five repositories side by side in one workspace directory. The script expects that layout.

The setup guide asks for Python 3.11 or newer. Use Python 3.12. Modules 0, 3 and 4 pin `numba == 0.60` and `numpy == 2.0.0`, and PyPI has wheels of numba 0.60 for Python 3.9 to 3.12 only, so 3.13 will not install. The module 1 and module 2 templates are older and pin `numba == 0.56` and `numpy == 1.22`, which have wheels only up to Python 3.10. So make one virtual environment per machine, install module 0's two requirement files into it, and keep that environment for every module. In modules 1 and 2, skip their `requirements.txt` and run only `pip install -e .` for the package itself. If a pinned package from `requirements.extra.txt` fails to install later, install it unpinned and write the version you got into the README.

Module 0 is ordinary Python, and you could finish it in an evening. Do it properly anyway, because three of its pieces carry through the chapter. The operators in `operators.py` become the scalar functions of every later module. Task 0.4's `Module` class is the parameter tree that every model in module 4 is built from. It overrides `__setattr__` to sort attributes into parameters, child modules and plain data, and it walks the tree recursively to collect named parameters.

The third piece is property testing. A unit test checks one input. A property test states something that must hold for every input, and the Hypothesis library generates hundreds of inputs and looks for one that breaks it. When it finds one, it shrinks the input to the simplest failing case it can and reports that. This is close to the fuzzing you did on your JSON parser in chapter 04, with the shrinking added. MiniTorch's tests use Hypothesis throughout, and every later module adds more.

Floats will break some of the properties you write, as chapter 04 promised. `z * (x + y) == z * x + z * y` fails for floats, so the distributive test needs `is_close`. Sigmoid is mathematically strictly increasing, and in double precision it is not. Near x = 37 the term `exp(-x)` drops below half of the gap between 1.0 and the next double, so `1 / (1 + exp(-x))` rounds to exactly 1.0 from there on. Two inputs that differ in the last bits also give the same sigmoid. Hypothesis will find a pair of one kind or the other. MiniTorch's own `is_close` uses a tolerance of 1e-2, so the provided `assert_close` hides this, and your strict check does not.

The template runs style checks through pre-commit: ruff for lint and formatting, and pyright for types. `pytest -m task0_1` runs only the tests marked for Task 0.1. The Contributing guide in the module 0 menu lists the other `pytest` forms.

### Study

- [MiniTorch: Setup](https://minitorch.github.io/install/) (reference, as needed): The virtual environment, forking a template, and the three install commands. Use Python 3.12 and module 0's requirement files as described above.
- [MiniTorch Module 0: Fundamentals](https://minitorch.github.io/module0/module0/) (do, 6 h): Tasks 0.1 to 0.5. Read its "Contributing" guide, listed under Guides on the page, before Task 0.1, and its "Modules" guide before Task 0.4.
- [MiniTorch: Property Testing](https://minitorch.github.io/module0/property_testing/) (read, 30 min): The whole guide, before Task 0.2.

### Build

1. Create your own repository from each of the five templates on GitHub. Clone `Module-0` into a workspace directory, for example `~/mt/`. Make the Python 3.12 environment in `~/mt/.venv`, install module 0's `requirements.txt` and `requirements.extra.txt`, then `pip install -e .` inside `Module-0`. Check that `python -c "import numba, numpy; print(numba.__version__, numpy.__version__)"` prints 0.60.0 and 2.0.0.
2. Tasks 0.1, 0.3 and 0.4. Run `pytest -m task0_1`, `-m task0_3` and `-m task0_4` after each.
3. Task 0.2. Write the sigmoid test with all four properties from its docstring, including "strictly increasing" as a check that `a < b` implies `sigmoid(a) < sigmoid(b)`. Run it and copy Hypothesis's shrunk counterexample into a comment. Then restate the property so that it holds in double precision, and write next to it why the original fails.
4. Task 0.5. Start the Streamlit app, as the task describes, and pick parameters for the linear dataset by hand.
5. Run `pre-commit run -a` and fix everything it reports.

### Done when

`pytest -m "task0_1 or task0_2 or task0_3 or task0_4"` passes and `pre-commit run -a` reports no problems. Your sigmoid test file contains the counterexample Hypothesis found, and you can say from the float format why `sigmoid(40.0) == sigmoid(50.0)` is true in Python.

## Scalar autodiff: derivatives, graphs and backpropagation

Module 1 builds automatic differentiation for single numbers. There are three ways to get a derivative out of a program. Symbolic differentiation applies calculus rules to a formula, and it needs the formula. Numerical differentiation calls the function twice near the point, `(f(x + e) - f(x - e)) / (2e)`, which is the central difference of Task 1.1. It works on any black-box function, it needs two calls per input, and its result has two errors. A large `e` gives a truncation error, and a small `e` gives rounding error from subtracting two nearly equal doubles. The default `e = 1e-6` balances them well enough in double precision for a test. Automatic differentiation records which operations produced a value and applies the chain rule to that record.

`Scalar` wraps a float together with its history: the function that produced it, a context object, and the input scalars. Python calls `__add__`, `__mul__`, `__lt__` and the rest when you use operators on a `Scalar`, so `x * y + 1` on scalars builds a graph without any change to the code that computes it. Each operation is a `ScalarFunction` with two static methods. `forward` gets plain floats and returns a float. `backward` gets the context and a number d, the derivative of the final output with respect to this function's output, and returns d times the local derivative for each input. The context saves whatever `backward` will need, such as the inputs of a multiply.

Backpropagation runs the graph in reverse. Start at the output with d = 1. Every node must receive all of its contributions before it passes anything on, because a value used twice gets the sum of both derivatives. So you visit nodes in topological order: a node comes before every node that produced its inputs. A depth-first search that appends a node after visiting all of its inputs, then reverses the list, gives that order. For `h = log(z) + exp(z)` with `z = x * y`:

```
  forward                         backward, in topological order

  x --+                           h:   d = 1
      +-- z = x*y --+-- log z --+     log z: d = 1          exp z: d = 1
  y --+             |           +-- h
                    +-- exp z --+     z: d = 1/z + exp(z)   (two uses, summed)
                                      x: d * y              y: d * x
```

Only leaves, the scalars you created yourself, store a final `.derivative`. Intermediate derivatives live in a dictionary keyed by the variable's unique id for the length of one backward pass. This matches PyTorch, which keeps `.grad` only on leaf tensors by default.

One backward pass gives the derivative with respect to every input at a cost of a small multiple of one forward pass. Central differences need two forward passes per input. Frameworks use reverse mode for training because of that cost. Task 1.1 is still worth writing, because central differences become the oracle for every gradient you write in this chapter.

### Study

- [MiniTorch Module 1: Autodiff](https://minitorch.github.io/module1/module1/) (do, 8 h): Tasks 1.1 to 1.5. Before Task 1.1 read its "Derivatives" guide, and before Task 1.2 its "Scalar" guide, both listed under Guides on the page. For Task 1.5, train on Simple, Diag, Split and Xor from `minitorch/datasets.py`.
- [MiniTorch: Autodifferentiation](https://minitorch.github.io/module1/chainrule/) (read, 40 min): The whole guide, before Task 1.3. It defines `backward` and the chain rule for one argument, two arguments and an argument used twice.
- [MiniTorch: Backpropagate](https://minitorch.github.io/module1/backpropagate/) (read, 30 min): The whole guide, before Task 1.4. Its "Algorithm" section is the specification for `backpropagate`.

### Build

1. Clone your `Module-1` next to `Module-0`. Inside `Module-1`, run `python sync_previous_module.py Module-0 Module-1`, then `pip install -e .` without the module's own requirements. Run `pytest -m task0_1` there once to see that the synced code works.
2. Tasks 1.1 to 1.4, with `pytest -m task1_1` and so on after each.
3. `check_grad.py`: for five expressions of your choice over two or three scalars, compare the derivative from `backward()` with `central_difference` at 100 random points each and report the largest error. Include `x * x + x`, where x is used twice, and `relu(x)` at points near 0. Write down why ReLU disagrees at exactly 0.
4. Trace `h(x, y) = log(x * y) + exp(x * y)` at x = 2, y = 3. Print the topological order and the derivative dictionary after each node, and check the final values against the derivative you work out on paper.
5. Task 1.5 on all four datasets. Add a timer around each epoch in `run_scalar.py` and record the time per epoch for Xor with 10 hidden units.

### Done when

`pytest -m "task1_1 or task1_2 or task1_3 or task1_4"` passes. `check_grad.py` reports a largest error below 1e-6 for every expression away from the ReLU kink, measured as `|a - b| / max(1, |b|)`. Your trace matches your paper derivative. The README has the four training logs, the final images and the time per epoch.

## Tensor data: storage, strides and broadcasting

The scalar library builds one Python object and one graph node for every number. A two-layer network with 10 hidden units on 50 points builds thousands of them per epoch, which is why Task 1.5 was slow. A tensor replaces many numbers with one object: a flat storage array, a shape and strides.

The strides say how far to move in storage for one step along each dimension. The position of an index is the sum of index times stride over all dimensions. For a contiguous row-major tensor, each stride is the product of all the sizes to its right. You computed `row * N + col` by hand in every 2D kernel of chapter 20, and this is the same calculation for any number of dimensions.

```
  shape (2, 3), strides (3, 1)          storage: [a b c d e f]

      a b c                             t[1, 2] -> 1*3 + 2*1 = 5 -> f
      d e f

  permute(1, 0): shape (3, 2), strides (1, 3), same storage

      a d                               t[2, 1] -> 2*1 + 1*3 = 5 -> f
      b e
      c f
```

`permute` swaps the shape and the strides and copies nothing. A transposed matrix is the same storage read with swapped strides, which is the trick you used to call column-major cuBLAS from row-major code in chapter 20. `view` changes the shape of the same storage, so it only works when the storage is in contiguous order. After a `permute` you call `contiguous()`, which copies.

Task 2.1 asks for two conversions. `index_to_position` is the stride sum above. `to_index` goes from an ordinal, a number from 0 to size - 1, to an index in a shape, by repeated division and remainder from the last dimension backward. Enumerating ordinals 0 to size - 1 through `to_index` visits every index of the shape exactly once. That is how every MiniTorch loop walks an output tensor.

Broadcasting has three rules in the guide. A dimension of size 1 can pair with a dimension of size n, as if it were copied n times. Missing dimensions count as size 1. Missing dimensions are added on the left. `shape_broadcast` applies the rules to two shapes and raises an error when two sizes differ and neither is 1. `broadcast_index` maps an index in the big output shape back to an index in a smaller input: align the shapes on the right, drop the extra leading dimensions, and use 0 wherever the input's size is 1. Nothing is ever copied. PyTorch's `expand` gets the same effect by setting a stride to 0. MiniTorch computes the smaller index instead.

### Study

- [MiniTorch Module 2: Tensors](https://minitorch.github.io/module2/module2/) (do, 4 h): Tasks 2.1 and 2.2 only, with the function specifications on the page. Read the four files it lists at the top, `tensor.py` first, before you start. Tasks 2.3 to 2.5 are the next step.
- [MiniTorch: Tensors](https://minitorch.github.io/module2/tensordata/) (read, 30 min): The whole guide. "Tensor Strides" is the part Task 2.1 depends on.
- [MiniTorch: Broadcasting](https://minitorch.github.io/module2/broadcasting/) (read, 30 min): The whole guide, with its three rules and the worked shapes.

### Build

1. Clone `Module-2`, sync from `Module-1` and install as in the previous step.
2. Tasks 2.1 and 2.2, with `pytest -m task2_1` and `-m task2_2`.
3. `tests/test_layout.py`, your own Hypothesis tests. For random shapes of 1 to 4 dimensions with sizes 1 to 5: (a) on contiguous strides, `index_to_position(to_index(i))` equals i for every ordinal i, (b) after a random `permute`, the positions of all indices are a permutation of 0 to size - 1, (c) `shape_broadcast(a, b)` equals `numpy.broadcast_shapes(a, b)` whenever NumPy accepts the pair, and raises `IndexingError` exactly when NumPy raises.
4. Add these fixed cases to (c): (5, 3) with (3,), (5, 1) with (1, 3), (2, 1, 4) with (3, 1), and (2, 3) with (3, 2), which must fail.

### Done when

`pytest -m "task2_1 or task2_2"` and your layout tests pass. You can draw the storage, shape and strides of a (2, 3, 4) tensor before and after `permute(2, 0, 1)`, and say why `view(4, 6)` on the permuted tensor needs `contiguous()` first.

## Tensor operations and tensor autograd

Every tensor operation in MiniTorch goes through three higher-order functions, the same three you wrote for lists in module 0. `map` applies a one-argument function to every element. `zip` applies a two-argument function to pairs of elements from two tensors that broadcast together. `reduce` combines all elements along one dimension, leaving that dimension with size 1. The low-level versions in `tensor_ops.py` take raw storage, shape and strides for every tensor. Each one loops over output ordinals, converts the ordinal to an output index with `to_index`, maps that index into each input with `broadcast_index`, and reads and writes storage through `index_to_position`. Module 3 replaces only these loops with fast versions, and everything built on top of them speeds up with no other change.

Tensor functions mirror scalar functions. `forward` calls the backend's map, zip or reduce. `backward` receives `grad_output`, a tensor of the same shape as the output that holds the d of every element, and returns one gradient tensor per input. For a map the gradient is the local derivative times `grad_output`, element by element. For a sum along a dimension, every input element gets the `grad_output` value of its output slot.

Most tensor gradient bugs come from broadcasting. If `b` of shape (3,) was broadcast against `x` of shape (4, 3) in `x + b`, each element of `b` was used four times. Its gradient is the sum of those four contributions, so the gradient of shape (4, 3) has to be summed over dimension 0 to get back to shape (3,). MiniTorch does this for you in `Tensor.expand`, which `chain_rule` calls on every gradient. Read that method before Task 2.4, so you know which reductions happen outside your `backward` code.

Autodiff Puzzles, also by Sasha Rush, trains the same reasoning in a notebook. Each puzzle gives a tensor function and asks for its full Jacobian, the derivative of every output element with respect to every input element, written as one line of broadcasting code. Checking your answers against JAX shows you which index you got wrong.

### Study

- [MiniTorch: Operations](https://minitorch.github.io/module2/tensorops/) (read, 30 min): The whole guide. "Reductions" explains the reduce shape that Task 2.3's `tensor_reduce` writes into.
- [MiniTorch: Auto-Grad](https://minitorch.github.io/module2/tensor/) (read, 30 min): The whole guide, before Task 2.4. Its map, zip and reduce rules are the backward functions you write.
- [Sasha Rush: Autodiff Puzzles](https://github.com/srush/Autodiff-Puzzles) (do, 2 h): Open the notebook in Colab from the README. Problems 1 Id to 11 Running Mean, then 13 Elementwise mean, 14 Elementwise mul, 16 Transpose, 18 Mean Reduce and 19 Matmul as vectors. Leave both convolution problems for the convolution step. The notebook numbers two problems 15, and the second one, View, is optional.

### Build

1. Tasks 2.3 and 2.4 from the module 2 page, with `pytest -m task2_3` and `-m task2_4`.
2. `check_torch.py`: build the same computation in MiniTorch and in PyTorch with `dtype=torch.float64` and compare every gradient. Use `relu(x @ w1 + b1)`, a sum over dimension 1, and a mean, with x of shape (5, 4), w1 of shape (4, 3) and b1 of shape (3,). Build the MiniTorch matrix multiply from a broadcast multiply of shape (5, 4, 3) and a sum over dimension 1, as the module expects at this point. Then check `x + b` with b of shape (3,) and of shape (4, 1) against x of shape (4, 3), and `(x * x).sum()` where the same tensor is used twice.
3. Task 2.5. Write the three-layer network in `run_tensor.py`, train on all four datasets, and record the time per epoch next to your scalar time from the previous step.

### Done when

`pytest -m "task2_3 or task2_4"` passes. Every gradient in `check_torch.py` matches PyTorch within 1e-10. You can say from the broadcasting rules which dimensions `expand` sums for b of shape (3,) and for b of shape (4, 1). The README has the four tensor training runs and both times per epoch. If the tensor version is not faster yet, you can say which Python loop costs the time.

## A parallel CPU backend with Numba

Your tensor code is correct and slow, because every element still passes through Python bytecode. Numba is a JIT compiler for a subset of Python: functions over numbers, NumPy arrays and loops. On the first call with new argument types, it infers types, generates LLVM IR and compiles it to machine code, the pipeline you drove yourself in chapter 12. Later calls run the machine code. `njit` refuses anything it cannot compile instead of falling back to the interpreter, so a successful compile means the loop runs without Python.

`njit(parallel=True)` with `prange` instead of `range` runs a loop's iterations on a pool of threads. By default Numba cuts the iterations into roughly equal chunks, one per thread. That is the static split from chapter 09, and it works here because every output element costs about the same. You choose which loop is parallel, and the iterations must not depend on each other or write to the same location. For map and zip, parallelize over output positions. For reduce, also parallelize over output positions, and run the loop along the reduced dimension inside each iteration, sequentially. `numba.set_num_threads(n)` limits a run to n threads, so you can measure scaling as in chapter 09.

The docstrings in `fast_ops.py` list optimizations that the course checks. Index buffers are NumPy arrays allocated inside the parallel loop, so each iteration has its own. When the output and the input have the same shape and strides, element i of one is element i of the other, so skip the index arithmetic. That path covers most real calls, and its inner loop is a plain array walk that LLVM can vectorize. The reduce inner loop calls no functions and writes no shared variable. It accumulates into a local and stores once, as each thread did in your chapter 20 reductions.

Matrix multiply gets its own function. In module 2 it was a broadcast multiply into an (n, k, m) temporary followed by a sum, which reads and writes k times more memory than the output. The guide calls the replacement operator fusion. One function loops over output positions in parallel and runs the dot product over k in an inner loop with one multiply and no writes to memory. The strides matter as they did in chapter 07: the inner loop walks a row of A along its last stride and a column of B along its second-to-last stride.

Numba shows you what it built. `parallel_diagnostics(level=3)` lists which loops it parallelized, which loops it fused, and which allocations it hoisted out of loops. `project/parallel_check.py` prints this for all four functions, and the assignment wants its output in your README. `inspect_asm()` returns the machine code, which on the Mac is ARM64 you can read after chapter 05. A double-precision NEON multiply-add on two lanes looks like `fmla v0.2d, v1.2d, v2.2d`. LLVM does not reorder a floating-point sum unless you allow it, because reordering changes the rounding. A dot product loop therefore stays scalar unless you pass `fastmath=True`, which gives that permission.

### Study

- [MiniTorch Module 3: Efficiency](https://minitorch.github.io/module3/module3/) (do, 8 h): Tasks 3.1 and 3.2, then the CPU commands of Task 3.5. Read its short "Parallel Computation" and "Fusing Operations" guides, listed under Guides on the page, first. Leave Tasks 3.3 and 3.4 for the next step.
- [Numba 0.60: Automatic parallelization with @jit](https://numba.readthedocs.io/en/0.60.0/user/parallel.html#explicit-parallel-loops) (read, 45 min): "Explicit Parallel Loops" with its race-condition examples, "Diagnostics" with "The parallel diagnostics report sections", and "Scheduling". Skim "Supported Operations", which covers array expressions MiniTorch does not use.
- [Numba 0.60: Just-in-Time compilation](https://numba.readthedocs.io/en/0.60.0/reference/jit-compilation.html#dispatcher-objects) (reference, as needed): "Dispatcher objects" for `inspect_llvm`, `inspect_asm` and `parallel_diagnostics`, and the `fastmath` and `boundscheck` options of `@jit`.

### Build

1. Clone `Module-3` and sync from `Module-2`. In this module install the template's own `requirements.txt` and `requirements.extra.txt`, which pin the same numba and numpy as module 0. Copy the `MatMul` function from the starter code into `tensor_functions.py`, as Task 3.2 describes.
2. Tasks 3.1 and 3.2, with `pytest -m task3_1` and `-m task3_2`. Put the output of `python project/parallel_check.py` in the README and check that every main loop is reported as parallel.
3. `bench_cpu.py`: time the simple backend from module 2 against your fast backend for `exp` and add on a contiguous 1000 x 1000 tensor and on its permuted view, sum over dimension 0 and over dimension 1, and matrix multiply. Use n = 16, 32 and 64 for the simple matmul and n = 64, 128, 256, 333 and 512 for the fast one. Time the first call separately, because it includes compilation. Report speedups.
4. Scaling: time the fast matmul at n = 512 with `numba.set_num_threads(n)` for n from 1 to your core count, and plot the speedup as you did in chapter 09. Mark where the efficiency cores join.
5. Print `inspect_asm()` for your matmul and find the inner loop. Record whether it uses vector instructions. Then compile a copy with `fastmath=True`, look again, and measure the change in time and the largest change in any output element at n = 512.
6. Task 3.5 on the CPU: `python project/run_fast_tensor.py --BACKEND cpu --HIDDEN 100 --DATASET split --RATE 0.05`, then again with `--HIDDEN 500`, with the time per epoch for each.

### Done when

`pytest -m "task3_1 or task3_2"` passes and the README has the diagnostics output with every main loop parallel. Your benchmark table shows the fast matmul at least 100 times faster than the simple one at n = 64. The CPU run with 100 hidden units takes less than 2 seconds per epoch, the target the assignment gives for Colab. You can explain the shape of your scaling plot, and say from the assembly what `fastmath=True` changed in the dot product loop and why the results changed in the last bits.

## A CUDA backend

The GPU half of module 3 writes `map`, `zip`, `reduce` and matrix multiply as CUDA kernels in Numba. `@cuda.jit` compiles a Python function into a kernel, and `f[blocks, threads](args)` launches it, the syntax you used in GPU Puzzles in chapter 20. `cuda.threadIdx.x`, `cuda.blockIdx.x` and `cuda.blockDim.x` are the CUDA C variables. `cuda.shared.array(shape, numba.float64)` declares shared memory, with a shape that must be a constant, and `cuda.syncthreads()` is `__syncthreads()`. `cuda.local.array` gives each thread a small private array, which you use for index buffers. Local arrays can end up in local memory in DRAM, the `LDL` and `STL` you looked for in chapter 20's SASS. `cuda_ops.py` compiles your `to_index`, `index_to_position` and `broadcast_index` as device functions, so your module 2 index code runs on the GPU unchanged.

Map and zip are one thread per output element with a bounds check, the first kernels of chapter 20. `_sum_practice` sums each block of 32 values in shared memory, the tree reduction from chapter 20. The reduce launcher in `cuda_ops.py` starts one block of 1024 threads per output position. Each thread loads one element along the reduced dimension, or the start value past its end, and the block reduces in shared memory. `_mm_practice` multiplies two square matrices smaller than 32 inside one block: load both into shared memory, synchronize, compute, and write each output once. The full `_tensor_matrix_multiply` is your chapter 20 kernel 3, the tiled multiply with zero fill, plus a batch dimension on `blockIdx.z`. Give a batch stride of 0 to an input whose batch size is 1, so batches broadcast.

Two numbers from chapter 20 predict the results. MiniTorch stores float64, and consumer GPUs run float64 far slower than float32. The CUDA C++ Best Practices Guide from chapter 20 has the numbers in Table 5 of section 12.1.1, "Throughput of Native Arithmetic Instructions". For compute capability 7.5 and 8.6/8.9 it lists 2 float64 results per clock per SM, against 64 or 128 for float32. Second, MiniTorch's map and zip launch blocks of 32 threads, one warp each, and chapter 20's occupancy step told you what that costs. Every launch also passes the shape and stride arrays as NumPy arrays, and Numba copies host arrays to the device and back around each launch. Horace He would call that overhead. Launches return before the kernel finishes, as they did in chapter 20, so call `cuda.synchronize()` before you stop a timer.

The laptop needs Numba's CUDA target to match the CUDA 13 driver you installed in chapter 20. That target now ships as a separate NVIDIA package, `numba-cuda`, which requires numba 0.60 or newer and supports CUDA 12 and 13 through pip extras. Once installed, `from numba import cuda` loads it. If the laptop fails, the module 3 page links a Colab setup notebook, which is the course's own route.

Debug kernels on the Mac first. Setting `NUMBA_ENABLE_CUDASIM=1` before Numba is imported runs kernels in the CUDA simulator. It runs one block at a time with one Python thread per CUDA thread, so `print` works inside a kernel, and you can stop a single thread in `pdb`. It is slow and it does not detect a `syncthreads()` that only some threads reach. Final tests run on the real GPU.

### Study

- [MiniTorch: GPU Programming](https://minitorch.github.io/module3/cuda/) (read, 20 min): The whole guide. It maps threads, blocks, shared memory and local arrays onto Numba's API.
- [Numba-CUDA: Installation](https://nvidia.github.io/numba-cuda/user/installation.html) (reference, as needed): "Supported GPUs", "Supported CUDA Toolkits" and the pip command for CUDA 13.
- [Numba-CUDA: Memory management](https://nvidia.github.io/numba-cuda/user/memory.html#shared-memory-and-thread-synchronization) (reference, as needed): "Shared memory and thread synchronization" for `cuda.shared.array` and `syncthreads`, "Local memory", and "Data transfer" for what Numba copies around a launch.

### Build

1. On the Ubuntu laptop, make a Python 3.12 environment, clone your `Module-3`, install its requirement files and the package, then `pip install "numba-cuda[cu13]"`. Run `python -c "from numba import cuda; print(cuda.__file__); cuda.detect()"`. The path should be inside the `numba_cuda` package and the list should show your GPU.
2. Task 3.3: `tensor_map`, `tensor_zip`, `_sum_practice` and `tensor_reduce`. Get each working under the simulator on the Mac, then run `pytest -m task3_3` on the laptop.
3. Task 3.4: `_mm_practice`, then `_tensor_matrix_multiply`, with `pytest -m task3_4` on the laptop. Then write `mm_check.py`, which multiplies a (2, 33, 47) tensor by a (1, 47, 65) tensor on the GPU backend and compares the result with the fast CPU backend. Run it under `compute-sanitizer --tool racecheck python mm_check.py` and record the summary.
4. `bench_gpu.py`: matmul at n = 64, 128, 256, 512 and 1024 on the fast CPU backend and the GPU backend, with a warmup call first and `cuda.synchronize()` before each stop time. Plot both, as the assignment asks. Compute GFLOP/s at n = 1024 and compare it with the float64 peak: SMs times float64 results per clock from Table 5 times 2 times the clock from your chapter 20 `deviceQuery` table.
5. Change `THREADS_PER_BLOCK` for map and zip from 32 to 128 and 256, and time `exp` on a tensor of 2^24 elements for each value.
6. Task 3.5 on the GPU: `--BACKEND gpu --HIDDEN 100` and `--HIDDEN 500` on the split dataset. Compare each time per epoch with your CPU numbers from the previous step.

### Done when

`pytest -m "task3_3 or task3_4"` passes on the laptop GPU, not under the simulator. Racecheck reports no hazards. Your plot shows where the GPU matmul overtakes the CPU one, and you have its percentage of the float64 peak at n = 1024. You can explain, with occupancy and launch overhead, how the block size changed the time of `exp`, and why the GPU barely helps or even loses with 100 hidden units.

## Convolution and pooling

Module 4 builds networks for images and text. A 1D convolution slides a weight vector of width K along an input of width T. Each output element is a dot product between the weights and the K inputs starting at its position, and inputs past the right edge count as 0. With channels, the input has shape (batch, in_channels, width), the weight has shape (out_channels, in_channels, K), and each output channel sums over every input channel and every weight position.

The convolution guide explains it by unrolling. Copy each window of K inputs into a row of a matrix, and the convolution is a matrix multiply of that matrix with the weights. Production libraries use this trick, which is called im2col, to reuse a fast matrix multiply. MiniTorch computes the sum directly in a Numba loop instead, and the result is the same.

The backward pass is again a convolution. Input element j was used by outputs j - K + 1 to j, once with each weight, so its gradient is the gradient of the output convolved with the weights in reverse order, anchored on the other side. The `reverse` flag of `_tensor_conv1d` selects that anchoring. The weight gradient is a convolution of the input with the output gradient, after permuting batch and channel dimensions. `Conv1dFun.backward` in `fast_conv.py` is already written. Read it until you can say which call computes which gradient. The 2D version does the same over height and width.

Pooling reduces a window to one value. Task 4.3's `tile` does it with views alone: split height into (new_height, kh) and width into (new_width, kw) with `view`, move the two kernel dimensions to the end with `permute`, call `contiguous`, and `view` the last two as one dimension of kh * kw. Average pooling is then a mean over that dimension. This uses step 3's rule that a permuted tensor needs a copy before a new view.

### Study

- [MiniTorch Module 4: Networks](https://minitorch.github.io/module4/module4/) (do, 6 h): Tasks 4.1 to 4.3. Read its short "Pooling" guide, listed under Guides on the page, before Task 4.3. Tasks 4.4 and 4.5 are the next step.
- [MiniTorch: Convolution](https://minitorch.github.io/module4/convolution/) (read, 45 min): The whole guide, with the unrolling code and the diagrams of the backward pass for 1D and 2D.
- [Sasha Rush: Autodiff Puzzles](https://github.com/srush/Autodiff-Puzzles) (do, 1 h): The notebook from the tensor autograd step. Problem 15 "1D Convolution" and Problem 20 "2D Conv".

### Build

1. Clone `Module-4` and sync from `Module-3`. Its README also requires `fast_ops.py` and `cuda_ops.py`, which are in the sync list. The MNIST files are already in `project/data`.
2. Tasks 4.1 and 4.2, with `pytest -m task4_1` and `-m task4_2`.
3. `check_conv.py`: compare forward results and both gradients with PyTorch in float64. MiniTorch pads only on the right, so the PyTorch version is `F.conv1d(F.pad(x, (0, K - 1)), w)` and `F.conv2d(F.pad(x, (0, kw - 1, 0, kh - 1)), w)`. Test three shapes for each, including an input narrower than the kernel and more than one batch, input channel and output channel.
4. Task 4.3: `tile` and `avgpool2d`, with `pytest -m task4_3`.
5. Time your `conv2d` forward on an input of shape (16, 1, 28, 28) with weights of shape (4, 1, 3, 3), against `F.conv2d` on the CPU, and record the ratio.

### Done when

`pytest -m "task4_1 or task4_2 or task4_3"` passes. `check_conv.py` matches PyTorch within 1e-10 on every shape, forward and backward. You can explain from the index ranges why the input gradient of a convolution is a convolution with reversed weights, and you can write the sequence of shapes that `tile` produces for a (2, 3, 8, 6) input and a (2, 3) kernel.

## Softmax, dropout and two real classifiers

Task 4.4 adds the operations a classifier needs, mostly built from operations you already have. `max` along a dimension is a reduction. Its gradient goes to the position that held the maximum, so its backward multiplies `grad_output` by a one-hot mask from `argmax`. Softmax is `exp(x - m) / sum(exp(x - m))` with m the maximum, the stable form from chapter 20. Log-softmax is `x - logsumexp(x)`, with `logsumexp(x) = m + log(sum(exp(x - m)))`. Computing it directly avoids taking the log of a softmax value that has rounded to 0. `maxpool2d` is `tile` followed by `max`.

Dropout sets each element to 0 with probability p during training and scales the survivors by 1 / (1 - p), so the expected value stays the same. MiniTorch's tests expect `dropout(t, 1.0)` to return zeros, so handle p = 1 without dividing by zero. In evaluation dropout does nothing. MiniTorch's `dropout` takes an `ignore` argument for that, and your networks pass it the `training` flag that the module 0 `train()` and `eval()` methods set.

Built this way, softmax is several MiniTorch operations. Each one allocates a full tensor and makes a pass over memory, and each one records a node for the backward pass. Chapter 20 fused all of that into one kernel. The last step of this chapter does the same inside MiniTorch.

Task 4.5 trains two models. The sentiment model is a 1D convolutional network over word vectors for SST-2, a dataset of movie review sentences labeled positive or negative. The script downloads SST-2 with the Hugging Face `datasets` library and 50-dimensional GloVe vectors with the `embeddings` package on its first run, so the first start takes a while. The image model is a small LeNet-style network on a subset of MNIST. Its docstring in the script lists the layers: two 3 x 3 convolutions with ReLU, 4 x 4 pooling, two linear layers with dropout between them, and log-softmax.

### Study

- [MiniTorch: Multiclass Classification](https://minitorch.github.io/module4/softmax/) (read, 30 min): The whole guide: from sigmoid to softmax, argmax and its gradient, and max pooling.

### Build

1. Task 4.4 from the module 4 page: `max`, `softmax`, `logsoftmax`, `maxpool2d` and `dropout`. Fill in the `test_max` TODO in `tests/test_nn.py` with a value check and a gradient check, then `pytest -m task4_4`.
2. Your own property tests for softmax: each row sums to 1 within 1e-12, adding a constant to a row changes nothing, and `logsoftmax` matches `log(softmax)` where softmax is not tiny. Add the extreme rows from chapter 20: values of 1e4 and -1e4 mixed in one row must give finite outputs.
3. Task 4.5: implement `Conv1d`, `Conv2d` and `Network` in `project/run_sentiment.py` and `project/run_mnist_multiclass.py`. Train both on the fast CPU backend, and save the logs as `sentiment.txt` and `mnist.txt`.
4. Profile one MNIST epoch with `python -m cProfile -s cumulative` and write down the three functions that take the most time.

### Done when

`pytest -m task4_4` passes, including your `test_max`, and your softmax property tests pass. `sentiment.txt` shows a best validation accuracy above 70 percent, as the assignment requires. `mnist.txt` shows the training loss falling and the validation accuracy rising over the epochs. You can name the three most expensive functions in an MNIST epoch and say which of them your own operation in the next step will replace.

## Your own operation, end to end

Everything so far filled in a design someone else made. In this step you make the design. Pick one differentiable operation with a reduction inside it and write it as a single MiniTorch `Function` with its own kernels: forward and backward, on the CPU backend and on the CUDA backend. The default is a fused softmax along the last dimension, because you have its chapter 20 kernel and its composed MiniTorch version to compare against. Log-softmax, logsumexp and layer normalization without learned parameters are good alternatives. Whichever you pick, derive the backward pass on paper before you write code.

For softmax, y_i = exp(x_i) / sum_j exp(x_j) has the Jacobian dy_i/dx_j = y_i (delta_ij - y_j), where delta_ij is 1 when i = j and 0 otherwise. Multiplied by an incoming gradient g, this gives:

```
  forward, per row:    m = max(x)            (online, as in chapter 20)
                       s = sum(exp(x - m))
                       y = exp(x - m) / s

  backward, per row:   dot = sum(g * y)      (one more reduction)
                       dx  = y * (g - dot)

  save y for backward, not x: backward never needs x again
```

Both directions are one pass of reductions per row plus one elementwise pass. On the CPU that is a `prange` over rows with sequential inner loops. On the GPU it is one block per row with the shared-memory reduction from module 3, or the online normalizer from chapter 20. Add the operation to the backends the way `matrix_multiply` is added: a static method on `FastOps` and on `CudaOps`, exposed through `TensorBackend`. Your `Function` then calls the backend of its input, and `backend.cuda` tells you which one you have.

PyTorch has the same contract. Its `torch.autograd.Function` also has static `forward` and `backward` methods and a context with `save_for_backward`, and its documentation explains the rules you followed by habit in MiniTorch. It also gives you an independent check. Wrap your MiniTorch kernels in a `torch.autograd.Function` whose `forward` and `backward` convert between float64 PyTorch tensors and MiniTorch tensors. Then `torch.autograd.gradcheck` compares your backward with finite differences over every element. MiniTorch's `grad_check` samples one element per input.

Edward Yang's essay, from a talk he gave as a PyTorch core developer, describes how PyTorch organizes the same ideas at scale. A tensor there has storage, sizes, strides and also an offset into the storage. Each call dispatches twice, first on the device and layout and then on the data type. Autograd metadata travels with each tensor. Read it with your MiniTorch code open and note every place where the two designs differ.

### Study

- [PyTorch 2.15: Extending torch.autograd](https://docs.pytorch.org/docs/2.15/notes/extending.html#extending-torch-autograd) (read, 40 min): "When to use", "When not to use", "How to use" with its four steps, and the `LinearFunction` and `MulConstant` examples. Skip the paragraphs on `ctx.input_grad_buffers`, `clear_saved_tensors_on_access` and `boxed_grads_call`, and stop before "Forward mode AD".
- [PyTorch 2.15: torch.autograd.gradcheck](https://docs.pytorch.org/docs/2.15/generated/torch.autograd.gradcheck.gradcheck.html) (reference, as needed): The signature, the defaults for `eps`, `atol` and `rtol`, and the notes that the defaults assume double precision and that non-differentiable points can fail.
- [Edward Z. Yang: PyTorch internals](https://blog.ezyang.com/2019/05/pytorch-internals/) (read, 45 min): The first part, from the start to "Enough about concepts, let's look at some code": tensors, strides, storage, the two dispatches, extension points and autograd. The code tour after that describes the 2019 source layout, which has changed since, so skip it.

### Build

1. `minitorch/fused.py` in your `Module-4`: a CPU kernel and a CUDA kernel for the forward pass and for the backward pass, `FastOps` and `CudaOps` methods, and one `Function` that calls them. Save only what the backward pass needs.
2. `tests/test_fused.py`: forward and backward against `torch.softmax` in float64, with a random `grad_output`, for shapes (1, 1), (4, 1), (3, 5), (2, 3, 7), (64, 1000) and (8, 50257), on both backends. Add the extreme rows from the previous step and a fully `-inf` row with the output you chose in chapter 20.
3. The `gradcheck` wrapper described above, run for shapes (3, 5) and (2, 3, 7) with float64 inputs.
4. `bench_fused.py`: your fused operation against the composed `softmax` from Task 4.4, forward plus backward, at (1024, 1024) and (64, 50257), on the CPU and the GPU backend. Count the number of tensors each version allocates. Add `torch.softmax` in float64 on the CPU as a reference.
5. Replace the composed `logsoftmax` in your MNIST network with your operation, or with a log-softmax version of it. Set `random.seed` and `numpy.random.seed` at the top of the script, then run three epochs with the composed version and three with yours. The two loss curves should agree within rounding, and the time per epoch should drop.
6. `notes/runtime.md`: draw the path of one call, `y = fused_softmax(x)`, from the Python call through `Function.apply`, the history record, the backend dispatch, the kernel launch and its argument copies, to the output tensor, and then the backward call back to the accumulated gradient on a leaf. Under the drawing, list five things PyTorch does that MiniTorch does not, with the place in Yang's essay or in your own earlier chapters where you saw each one.

### Done when

Every test in `test_fused.py` passes `numpy.testing.assert_allclose` with `rtol=1e-9` and `atol=1e-12` on both backends, and `gradcheck` returns True. The fused version beats the composed one forward plus backward at both sizes on both backends, or you can explain from your measurements which size it loses at and why. MNIST trains with your operation, and its loss curve agrees with the composed version's. `notes/runtime.md` has the drawing and the five differences.

## Where this leads

This is the end of the book. You started with a compiler, a debugger and a build script you trusted. You then built a CPU from gates, wrote C that manages its own memory, read the assembly it compiles to, and emulated two machines. You measured caches and vector units, worked inside an operating system kernel, and wrote a job system you could argue was correct. You wrote a bytecode VM and an LLVM front end, drew triangles in software and shipped two games. You booted your own kernel, wrote a driver and firmware with no SDK, made a key-value store survive crashes and a TCP survive packet loss, and sent a fix to a large codebase you did not write. Then you wrote GPU kernels and, in this chapter, the framework that calls them. When PyTorch does something slow or surprising, you can now follow the call from Python through dispatch, storage and strides down to the kernel and the hardware counters, because you have built a small version of each layer.

The next project should come from something you want to make faster or understand better. Three follow from this chapter. You can move MiniTorch's storage out of NumPy into a C library of your own, arena allocated as in chapter 04, with float32 and your chapter 20 kernels behind it, loaded the way you loaded the softmax extension in chapter 20. You can port the tensor core of MiniTorch to Rust and compare the two as you did in chapter 10. Or you can take the method of chapter 19 to PyTorch itself, with Yang's essay as the map: find a slow operator in a model you run at work, trace it to its kernel, and send the fix upstream.
