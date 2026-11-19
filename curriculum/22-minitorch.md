---
id: 22
title: A tensor library
part: GPUs and a tensor library
weeks: 9
project: MiniTorch modules 0 to 4 with a parallel CPU backend and a CUDA backend, then one differentiable operation of your own, then your chapter 07 AVX2 code and your chapter 21 softmax kernel plugged in under MiniTorch as a backend that trains the MNIST classifier.
---

Chapter 21 ended with CUDA kernels that you can test, profile and explain: a matrix multiply within reach of cuBLAS, a softmax that reads each row once, and the same kernels in Triton. Each of them did one operation on one fixed shape and ran from a harness you wrote for it. PyTorch wraps kernels like these in a lot of machinery: tensors of any shape and stride, broadcasting, a graph that records every operation, and a backward pass through that graph. You use that machinery every day from the outside, as `x.T`, `x + b` and `loss.backward()`. This chapter builds it from the inside.

The library is MiniTorch, written by Sasha Rush for the Machine Learning Engineering course at Cornell Tech. It reimplements the core of the Torch API in Python. The course hands it out as five **template repositories**, GitHub repositories you copy as the start of your own, each with TODO markers and a test suite. A task is done when its tests pass. You build the layers of the figure one module at a time.

![The layers of MiniTorch, top to bottom: your model, autograd, the tensor, the three primitives and the backends that run them.](figures/22-layers.svg)

Much of what you built in this book comes back. A MiniTorch tensor is one flat buffer plus a shape and strides, and a view shares that buffer the way a `str_slice` from chapter 04 points into its string. The CPU backend splits loops across cores as your chapter 09 job system did, and Numba compiles those loops to machine code through LLVM, the compiler library of chapter 12. The CUDA backend needs the map, the shared-memory reduction and the tiled matrix multiply of chapter 21. In the last two steps you design one operation of your own and then put your own C and CUDA code under MiniTorch as a backend: the AVX2 code of chapter 07 and the softmax kernel of chapter 21.

Everything runs in Ubuntu under WSL2 on the laptop. The GPU steps use the NVIDIA card through the Windows driver and the CUDA toolkit you set up in chapter 21.

## Setup and module 0

A requirement file **pins** a package when it names one exact version, such as `numpy==2.0.0`, instead of a range. MiniTorch pins NumPy and Numba, and its five modules do not all pin the same versions. So the first job is one Python environment that every module can share. Module 0 then builds three small pieces that the rest of the chapter stands on.

Each module is its own repository. From module 1 on, each one has a script `sync_previous_module.py` and a file `files_to_sync.txt`, and the script copies the files on that list from your finished previous module. The script expects all five repositories side by side in one directory.

![The workspace: five template repositories side by side in ~/mt, one virtual environment and one constraints file for all of them. From module 1 on, sync_previous_module.py copies your finished files from the module before.](figures/22-workspace.svg)

A **virtual environment** is a directory with its own Python interpreter and its own installed packages, so the versions this chapter pins touch nothing else on the machine. MiniTorch's setup page makes one with Python's `venv` module, the same tool chapter 21 used, and this chapter stays with it. Ubuntu 24.04's `python3` is Python 3.12, the newest version that every pin here installs on. Three things go wrong if you follow the module READMEs as they are:

- Modules 1 and 2 pin `numba == 0.56` and `numpy == 1.22`. Neither has a **wheel** for Python 3.12, a ready-built package file that pip installs without compiling anything. Modules 0, 3 and 4 pin `numba == 0.60` and `numpy == 2.0.0`. Install module 0's requirement files once and keep that environment for every module.
- `requirements.extra.txt` pins `datasets==2.4.0`, Hugging Face's library that downloads and caches public datasets by name. That version fails on import with any current `pyarrow`. Drop the version from that line.
- Some packages in `requirements.extra.txt` pull in newer libraries without a pin, and pip then upgrades numpy past what numba 0.60 accepts, without an error. A **constraints file** lists versions that pip must keep. Passed to pip with `-c`, it makes pip refuse any install that would move them.

`requirements.extra.txt` also lists `torch` without a version. Install PyTorch before the requirement files, from the same index URL that the pytorch.org selector gave you in chapter 21. This environment then holds the CUDA build of PyTorch that matches your toolkit, and the last step of this chapter needs that build.

> **Practice:** Pass `-c ~/mt/constraints.txt` to every `pip install` in this chapter.

Module 0 itself is ordinary Python. Three of its pieces carry through the chapter:

- The functions in `operators.py` become the scalar functions that every backend applies to tensors. Among them are `sigmoid` and `relu_back`, the derivative of **ReLU**, the function max(0, x) that most networks use between layers.
- Task 0.4's `Module` class is the parameter tree that every model in module 4 is built from. It overrides `__setattr__` to sort attributes into parameters, child modules and plain values, and it walks the tree to collect named parameters.
- Task 0.2's tests are **property tests**. A unit test checks one input. A property test states something that must hold for every input, and the Hypothesis library generates hundreds of inputs and looks for one that breaks it. This is the fuzzing of chapter 04, and Build 5 shows the one thing Hypothesis adds.

> **If it fails:** If `python3 -m venv` stops and names a missing package such as `python3.12-venv`, install that package with `sudo apt install` and run the command again.

### Study

- [MiniTorch: Setup](https://minitorch.github.io/install/) (reference, as needed): The `venv` commands and the three install commands. Follow the order of Build 2 here, which adds the constraints file and installs PyTorch first.
- [MiniTorch Module 0: Fundamentals](https://minitorch.github.io/module0/module0/) (do, 6 h): Tasks 0.1 to 0.5. Read its "Contributing" guide, listed under Guides on the page, before Task 0.1, and its "Modules" guide before Task 0.4.
- [MiniTorch: Property Testing](https://minitorch.github.io/module0/property_testing/) (read, 30 min): The whole guide, before Task 0.2.

### Build

1. On GitHub, create your own repository from each of the five templates, `minitorch/Module-0` to `minitorch/Module-4`. Clone your `Module-0` into `~/mt/`.
2. Make the environment and install everything, in this order:
   1. Create the environment, activate it and write the constraints file:

      ```sh
      cd ~/mt
      python3 -m venv .venv
      source .venv/bin/activate
      printf 'numpy==2.0.0\nnumba==0.60.0\n' > constraints.txt
      ```

      `source` runs the activation script in your current shell, so `python` and `pip` now mean the ones inside `.venv`. Run `source ~/mt/.venv/bin/activate` again in every new terminal before you work.
   2. Install PyTorch alone. Take the index URL from the pip command the pytorch.org selector gave you in chapter 21. It has the shape `https://download.pytorch.org/whl/cu134`, where the last part names the CUDA version:

      ```sh
      pip install -c ~/mt/constraints.txt torch --index-url https://download.pytorch.org/whl/cu134
      ```

   3. In `Module-0/requirements.extra.txt`, change the line `datasets==2.4.0` to `datasets`.
   4. Install module 0's two requirement files together with matplotlib, which later steps use for plots, in one command. Then install module 0 itself. The `-e` flag installs the package in place, so your edits take effect without a reinstall:

      ```sh
      cd ~/mt/Module-0
      pip install -c ~/mt/constraints.txt -r requirements.txt -r requirements.extra.txt matplotlib
      pip install -c ~/mt/constraints.txt -e .
      ```

3. Check the pins: `python -c "import numba, numpy; print(numba.__version__, numpy.__version__)"` prints `0.60.0 2.0.0`. Write the `datasets` version you got into the README.
4. Tasks 0.1, 0.3 and 0.4. `pytest -m task0_1` runs only the tests marked for Task 0.1. Run it after Task 0.1, and `pytest -m task0_3` and `pytest -m task0_4` after the other two.
5. Task 0.2. Hypothesis adds **shrinking** to fuzzing: when it finds an input that breaks a property, it reduces that input to the simplest one that still fails and reports that. Sigmoid is strictly increasing on paper and not in double precision. From x of about 37 on, `exp(-x)` is less than half the gap between 1.0 and the next double, so `1 / (1 + exp(-x))` rounds to exactly 1.0. MiniTorch's own `assert_close` uses a tolerance of 1e-2 and hides this.
   1. Write the sigmoid test with all four properties from its docstring, with "strictly increasing" as a check that `a < b` implies `sigmoid(a) < sigmoid(b)`.
   2. Run it and copy Hypothesis's shrunk counterexample into a comment.
   3. Restate the property so that it holds in double precision, and write next to it why the original fails.
   4. Fill in the other four task0_2 tests, `test_transitive`, `test_symmetric`, `test_distribute` and `test_other`, which raise `NotImplementedError` until you do.
6. Task 0.5. The task's app uses **Streamlit**, a Python library that serves a small web page with sliders and plots. Start the app as the task describes and open the address it prints in your Windows browser, since WSL2 forwards `localhost` to Windows. Pick parameters for the linear dataset by hand.
7. The template checks style with **pre-commit**, a tool that runs checkers over your files before a commit: ruff for lint and formatting, and pyright for types. Run `pre-commit run -a` and fix everything it reports.

### Done when

`pytest -m "task0_1 or task0_2 or task0_3 or task0_4"` passes and `pre-commit run -a` reports no problems. Your sigmoid test file holds the counterexample Hypothesis found, and you can say from the float format why `sigmoid(40.0) == sigmoid(50.0)` is true in Python.

## Scalar autodiff: derivatives, graphs and backpropagation

You call `loss.backward()` and get a gradient for every parameter. Module 1 builds the mechanism behind that call for single numbers, with the module 0 operators as the forward functions. There are three ways to get a derivative out of a program:

- **Symbolic differentiation** applies the rules of calculus to a formula, so it needs the formula.
- **Numerical differentiation** calls the function twice near the point. The **central difference** `(f(x + e) - f(x - e)) / (2e)` is Task 1.1. It works on any function, costs two calls per input, and carries two errors: a large `e` gives truncation error, and a small `e` gives rounding error from subtracting two nearly equal doubles. The default `e = 1e-6` is good enough in double precision for a test.
- **Automatic differentiation** records which operations produced a value and applies the chain rule to that record. Module 1 builds this one.

`Scalar` wraps a float together with its **history**: the function that produced it, a context object and the input scalars. Python calls `__mul__`, `__add__` and the rest when you use an operator on a `Scalar`, so `x * y + 1` builds a graph with no change to the code that computes it.

Each operation is a `ScalarFunction` with two static methods. `forward` takes plain floats and returns a float. `backward` takes the context and a number d, the derivative of the final output with respect to this function's output, and returns d times the local derivative for each input. The **context** keeps whatever `backward` will need, such as the two inputs of a multiply.

![The chain rule at one Mul node. The forward pass computes z = x * y and saves x and y in the context. The backward pass receives d, the derivative of the final output with respect to z, and sends d * y to x and d * x to y.](figures/22-chain-rule.svg)

**Backpropagation** runs the graph in reverse. It starts at the output with d = 1 and hands each node's d to its inputs through `backward`. A value used twice receives the sum of both contributions, so a node may pass its d on only after every contribution has arrived. MiniTorch's guide runs this on `h = log(z) + exp(z)` with `z = x * y`:

![The graph of h = log(z) + exp(z) with z = x * y at x = 2, y = 3. Each box holds the value from the forward pass. The accent numbers under the boxes are the derivatives of h that the backward pass leaves on each node.](figures/22-graph.svg)

A **topological order** makes sure no node goes early: every node comes before the nodes that produced its inputs. A depth-first search that appends a node after visiting all of its inputs, followed by reversing the list, gives that order.

![The backward pass visits the nodes in topological order: h, exp, log, z, y, x. z comes after both exp and log, so it has received both contributions before it passes its derivative on to x and y.](figures/22-topo-order.svg)

Only **leaves**, the scalars you created yourself, keep a final `.derivative`. Intermediate derivatives live in a dictionary keyed by each variable's unique id for the length of one backward pass. PyTorch does the same and keeps `.grad` only on leaf tensors by default.

One backward pass gives the derivative for every input at the cost of a few forward passes. Central differences need two forward passes per input, and frameworks train with the backward pass for that reason. Task 1.1 is still worth writing, because central differences are the oracle for every gradient in this chapter.

> **Practice:** Check every backward function you write against central differences before you build on it.

### Study

- [MiniTorch Module 1: Autodiff](https://minitorch.github.io/module1/module1/) (do, 8 h): Tasks 1.1 to 1.5. Before Task 1.1 read its "Derivatives" guide, and before Task 1.2 its "Scalar" guide, both listed under Guides on the page. For Task 1.5, train on Simple, Diag, Split and Xor from `minitorch/datasets.py`.
- [MiniTorch: Autodifferentiation](https://minitorch.github.io/module1/chainrule/) (read, 40 min): The whole guide, before Task 1.3. It defines `backward` and the chain rule for one argument, two arguments and an argument used twice.
- [MiniTorch: Backpropagate](https://minitorch.github.io/module1/backpropagate/) (read, 30 min): The whole guide, before Task 1.4. Its "Algorithm" section is the specification for `backpropagate`.

### Build

1. Clone your `Module-1` next to `Module-0`. Inside `Module-1`, run `python sync_previous_module.py Module-0 Module-1`, then `pip install -c ~/mt/constraints.txt -e .` without the module's own requirement files. Run `pytest -m task0_1` there once to see that the synced code works.
2. Tasks 1.1 to 1.4, with `pytest -m task1_1` and so on after each.
3. `check_grad.py`: for five expressions of your choice over two or three scalars, compare the derivative from `backward()` with `central_difference` at 100 random points each and report the largest error. Include `x * x + x`, where x is used twice, and `relu(x)` at points near 0. Write down why ReLU disagrees at exactly 0.
4. Trace `h(x, y) = log(x * y) + exp(x * y)` at x = 2, y = 3. Print the topological order and the derivative dictionary after each node, and check the numbers against the two figures above and against the derivative you work out on paper.
5. Task 1.5 on all four datasets. Add a timer around each epoch in `run_scalar.py` and record the time per epoch for Xor with 10 hidden units.

### Done when

`pytest -m "task1_1 or task1_2 or task1_3 or task1_4"` passes. `check_grad.py` reports a largest error below 1e-6 for every expression away from the ReLU kink, measured as `|a - b| / max(1, |b|)`. Your trace matches the figures and your paper derivative. The README has the four training logs, the final images and the time per epoch.

## Tensor data: storage, strides and broadcasting

The scalar library builds one Python object and one graph node for every number. A two-layer network with 10 hidden units on 50 points builds thousands of them per epoch, and that made Task 1.5 slow. A **tensor** replaces many numbers with one object. In MiniTorch that object, `TensorData`, holds three things:

- the **storage**, one flat NumPy array of float64 values,
- the **shape**, the size of each dimension,
- the **strides**, how many positions to move in storage for one step along each dimension.

The storage position of an index is the sum of index times stride over all dimensions. In a **contiguous** tensor the elements sit in storage in row-major order with no gaps, and each stride is the product of all the sizes to its right. You computed `row * ncols + col` by hand in every 2D kernel of chapter 21, and this is the same sum for any number of dimensions.

![A 2 by 3 tensor and its transpose share one storage of six numbers. Only the shape and the strides differ, and both index formulas land on position 5 for the element f.](figures/22-strides.svg)

`permute` reorders the shape and the strides and copies nothing. A transposed matrix is the same storage read with swapped strides, the trick you used to call column-major cuBLAS from row-major code in chapter 21. A **view** puts a new shape over the same storage. MiniTorch's `view` accepts only a tensor whose storage is in contiguous order, so after a `permute` you call `contiguous()`, which copies. PyTorch's `view` is less strict and also accepts a non-contiguous tensor when the dimensions it merges have compatible strides.

Task 2.1 asks for two conversions. `index_to_position` is the stride sum above. `to_index` turns an **ordinal**, a number from 0 to size - 1, into an index in a shape, by repeated division and remainder from the last dimension backward. Counting ordinals from 0 to size - 1 through `to_index` visits every index exactly once, and every MiniTorch loop walks its output tensor this way.

**Broadcasting** lets one operation combine tensors of different shapes, as `x + b` does when it adds a bias of shape (3,) to every row of x. You use it in PyTorch without thinking about it. Task 2.2 writes the rules down as code.

![Broadcasting two shapes in three moves: line them up on the right, pad the shorter one with 1 on the left, then compare each dimension. Equal sizes stay, a 1 stretches to the other size, and any other pair is an error.](figures/22-broadcast.svg)

`shape_broadcast` applies these rules to two shapes and raises `IndexingError` when two sizes differ and neither is 1. `broadcast_index` goes the other way. It maps an index in the big output shape to an index in a smaller input: align the shapes on the right, drop the extra leading dimensions, and use 0 wherever the input's size is 1. Nothing is copied. PyTorch's `expand` gets the same effect by setting a stride to 0, and MiniTorch computes the smaller index instead.

### Study

- [MiniTorch Module 2: Tensors](https://minitorch.github.io/module2/module2/) (do, 4 h): Tasks 2.1 and 2.2 only, with the function specifications on the page. This step has two parts: Task 2.1 with the Tensors guide is strides, and Task 2.2 with the Broadcasting guide is broadcasting. Read the four files it lists at the top, `tensor.py` first, before you start. Tasks 2.3 to 2.5 are the next step.
- [MiniTorch: Tensors](https://minitorch.github.io/module2/tensordata/) (read, 30 min): The whole guide. "Tensor Strides" is the part Task 2.1 depends on.
- [MiniTorch: Broadcasting](https://minitorch.github.io/module2/broadcasting/) (read, 30 min): The whole guide, with its three rules and the worked shapes.

### Build

1. Clone `Module-2`, sync from `Module-1` and install as in the previous step.
2. Tasks 2.1 and 2.2, with `pytest -m task2_1` and `-m task2_2`.
3. Read `tests/test_tensor_data.py`, which already checks enumeration, indexing and permutation, and `tests/tensor_strategies.py`, whose `shapes` strategy draws shapes of 1 to 4 dimensions with sizes 1 to 3. Then write `tests/test_broadcast.py`, your own Hypothesis test: for two shapes drawn with `shapes()`, `shape_broadcast(a, b)` equals `numpy.broadcast_shapes(a, b)` whenever NumPy accepts the pair, and raises `IndexingError` exactly when NumPy raises.
4. Add the three pairs of the broadcasting figure as plain tests, plus (5, 1) with (1, 3).

### Done when

`pytest -m "task2_1 or task2_2"` and your broadcast tests pass. You can draw the storage, shape and strides of a (2, 3, 4) tensor before and after `permute(2, 0, 1)`, and say from those strides why `view(8, 3)` on the permuted tensor needs `contiguous()` first, in MiniTorch and in PyTorch.

## Tensor operations and tensor autograd

Tasks 2.1 and 2.2 gave you index arithmetic and no operations yet. Tasks 2.3 to 2.5 build the operations and their gradients on top of it. Every tensor operation in MiniTorch goes through three **higher-order functions**, functions that take another function as an argument. You wrote list versions of all three in module 0.

![The three primitives. map applies a one-argument function to every element. zip applies a two-argument function to pairs of elements from two tensors that broadcast. reduce folds one dimension down to size 1.](figures/22-map-zip-reduce.svg)

The low-level versions in `tensor_ops.py` take the raw storage, shape and strides of every tensor. Each one runs the same loop over the output:

1. Convert the output ordinal to an output index with `to_index`.
2. Map that index into each input with `broadcast_index`.
3. Read the inputs and write the output through `index_to_position`.

Module 3 replaces only these loops with fast versions, and everything built on them speeds up with no other change.

Tensor functions mirror scalar functions. `forward` calls the backend's map, zip or reduce. `backward` receives `grad_output`, a tensor of the output's shape that holds the d of every element, and returns one gradient tensor per input. For a map, the gradient is the local derivative times `grad_output`, element by element. For a sum along a dimension, every input element gets the `grad_output` value of its output slot.

Most tensor gradient bugs come from broadcasting. In `x + b` with `b` of shape (3,) and `x` of shape (4, 3), each element of `b` was used four times. Its gradient is the sum of those four contributions, so the (4, 3) gradient has to be summed over dimension 0 to get back to shape (3,). MiniTorch does this in `Tensor.expand`, which `chain_rule` calls on every gradient. Read that method before Task 2.4, so you know which reductions happen outside your `backward` code.

Autodiff Puzzles, also by Sasha Rush, trains the same reasoning in a notebook. Each puzzle gives a tensor function and asks for its full **Jacobian**, the derivative of every output element with respect to every input element, written as one line of broadcasting code. The notebook checks your answer against JAX, a numerical library with its own autodiff, and shows which index you got wrong. It runs in **Colab**, Google's service that runs Jupyter notebooks in the browser and needs a Google account. These puzzles are the only work in the chapter that runs outside WSL2.

### Study

- [MiniTorch Module 2: Tensors](https://minitorch.github.io/module2/module2/) (do, 6 h): Tasks 2.3 to 2.5. Before Task 2.3 read its "Tensor Operations" guide, listed under Guides on the page. That guide's "Reductions" section explains the reduce shape that `tensor_reduce` writes into.
- [MiniTorch: Auto-Grad](https://minitorch.github.io/module2/tensor/) (read, 30 min): The whole guide, before Task 2.4. Its map, zip and reduce rules are the backward functions you write.
- [Sasha Rush: Autodiff Puzzles](https://github.com/srush/Autodiff-Puzzles) (do, 3 h): Open the notebook in Colab from the README. Problems 1 Id to 11 Running Mean, then 13 Elementwise mean, 14 Elementwise mul, 16 Transpose, 18 Mean Reduce and 19 Matmul as vectors in this step. Keep the notebook for Problem 15 "1D Convolution" and Problem 20 "2D Conv", which you do in the convolution step. The notebook numbers two problems 15, and the second one, View, is optional.

### Build

1. Tasks 2.3 and 2.4, with `pytest -m task2_3` and `-m task2_4`.
2. `check_torch.py`: build the same computation in MiniTorch and in PyTorch with `dtype=torch.float64`, and compare every gradient. Start from NumPy arrays and make both kinds of tensor from the same array:
   - PyTorch: `torch.tensor(a, requires_grad=True)`.
   - MiniTorch: `t = minitorch.Tensor.make(a.ravel().copy(), a.shape, backend=minitorch.SimpleBackend)`, then `t.requires_grad_(True)`, so that `backward()` fills `t.grad`. Put these two lines in a helper `from_numpy(a, backend)`, which later steps reuse.
   - After `backward()` on both, `t.grad.to_numpy()` on the MiniTorch tensor and `.grad.numpy()` on the PyTorch one give NumPy arrays of the same shape to compare.

   The module 2 backend has no matrix multiply yet, and `@` raises `NotImplementedError`. So first write `bcast_matmul(x, w)` for x of shape (n, k) and w of shape (k, m) as `(x.view(n, k, 1) * w.view(1, k, m)).sum(1).view(n, m)`. MiniTorch's `sum` keeps the reduced dimension with size 1, so the result has shape (n, 1, m) until the last `view`. Then use `relu(bcast_matmul(x, w1) + b1)`, a sum over dimension 1 and a mean, with x of shape (5, 4), w1 of shape (4, 3) and b1 of shape (3,). Also check `x + b` with b of shape (3,) and of shape (4, 1) against x of shape (4, 3), and `(x * x).sum()`, where the same tensor is used twice.
3. Task 2.5. Write the three-layer network in `run_tensor.py`, train on all four datasets, and record the time per epoch next to your scalar time from the previous step.

### Done when

`pytest -m "task2_3 or task2_4"` passes. Every gradient in `check_torch.py` matches PyTorch within 1e-10. You can say from the broadcasting rules which dimensions `expand` sums for b of shape (3,) and for b of shape (4, 1). The README has the four tensor training runs and both times per epoch. If the tensor version is not faster yet, you can say which Python loop costs the time.

## A parallel CPU backend with Numba

Your tensor code is correct and slow, because every element still passes through the Python interpreter. **Numba** is a **just-in-time (JIT) compiler** for a subset of Python: functions over numbers, NumPy arrays and loops. On the first call with new argument types, it infers the types, generates LLVM IR and compiles that to machine code, the pipeline you drove yourself in chapter 12. Later calls run the machine code. Its `njit` decorator refuses anything it cannot compile instead of falling back to the interpreter, so a successful compile means the loop runs without Python.

`njit(parallel=True)` with `prange` in place of `range` runs the iterations of a loop on a pool of threads. Numba cuts the iterations into roughly equal chunks, one per thread. That is the static split of chapter 09, and it works here because every output element costs about the same. The iterations must not depend on each other or write to the same place.

![How the Numba backend runs a map with prange on four threads. The output positions are cut into four equal chunks. Each thread walks its own chunk with its own index buffers, so no two threads write the same element.](figures/22-parallel-map.svg)

The docstrings in `fast_ops.py` list the optimizations the course checks:

- Map and zip run `prange` over output positions. Reduce does too, and runs the loop along the reduced dimension inside each iteration, in sequence.
- Index buffers are NumPy arrays allocated inside the parallel loop, so each iteration has its own.
- When the output and the inputs have the same shape and strides, element i of one is element i of the other. That fast path skips the index arithmetic and leaves a plain array walk that LLVM can vectorize.
- The reduce inner loop calls no function and writes no shared variable. It adds into a local and stores once, as each thread did in your chapter 21 reductions.

Matrix multiply gets its own function. In module 2 it was a broadcast multiply into an (n, k, m) temporary followed by a sum, which reads and writes k times more memory than the output. The guide calls the replacement **operator fusion**: one function loops over output positions in parallel and runs the dot product over k in an inner loop that writes nothing to memory. That loop walks a row of A along its last stride, which is 1, and a column of B along its second-to-last stride, which is the row length. The strides matter as they did in the `strideCopy` experiment of chapter 21.

Numba shows you what it built. `parallel_diagnostics(level=3)` lists the loops it parallelized, the loops it fused and the allocations it moved out of loops, and `project/parallel_check.py` prints this for all four functions.

### Study

- [MiniTorch Module 3: Efficiency](https://minitorch.github.io/module3/module3/) (do, 8 h): Tasks 3.1 and 3.2, then the CPU commands of Task 3.5. Read its short "Parallelism" and "Matrix Multiply" guides, listed under Guides on the page, first. Leave Tasks 3.3 and 3.4 for the next step.
- [Numba 0.60: Automatic parallelization with @jit](https://numba.readthedocs.io/en/0.60.0/user/parallel.html#explicit-parallel-loops) (read, 45 min): "Explicit Parallel Loops" with its race condition examples, "Diagnostics" with "The parallel diagnostics report sections", and "Scheduling". Skim "Supported Operations", which covers array expressions MiniTorch does not use.
- [Numba 0.60: Just-in-Time compilation](https://numba.readthedocs.io/en/0.60.0/reference/jit-compilation.html#dispatcher-objects) (reference, as needed): "Dispatcher objects" for `parallel_diagnostics`, and for `inspect_asm` with the `fastmath` option of `@jit` if you do the optional item at the end of this step.

### Build

1. Clone `Module-3`, sync from `Module-2` and run `pip install -c ~/mt/constraints.txt -e .`. Its two requirement files are the same as module 0's, so the environment already has them. Copy the `MatMul` function from the starter code into `tensor_functions.py`, as Task 3.2 describes.
2. Tasks 3.1 and 3.2, with `pytest -m task3_1` and `-m task3_2`. Put the output of `python project/parallel_check.py` in the README and check that every main loop is reported as parallel.
3. `bench_cpu.py`: time the simple backend from module 2 against your fast backend for `exp` and add on a contiguous 1000 x 1000 tensor and on its permuted view, sum over dimension 0 and over dimension 1, and matrix multiply. The simple matmul is your `bcast_matmul` from the previous step on the simple backend. Use n = 16, 32 and 64 for the simple matmul and n = 64, 128, 256, 333 and 512 for the fast one. Time the first call separately, because it includes compilation. Report speedups.
4. Scaling: time the fast matmul at n = 512 with `numba.set_num_threads(t)` for t from 1 to the number `nproc` prints, and plot the speedup as you did in chapter 09. If your CPU has performance and efficiency cores, mark where the efficiency cores join.
5. Task 3.5 on the CPU: `python project/run_fast_tensor.py --BACKEND cpu --HIDDEN 100 --DATASET split --RATE 0.05`, then again with `--HIDDEN 500`, with the time per epoch for each.

### Done when

`pytest -m "task3_1 or task3_2"` passes and the README has the diagnostics output with every main loop parallel. Your benchmark table shows the fast matmul at least 100 times faster than the simple one at n = 64. The CPU run with 100 hidden units takes less than 2 seconds per epoch, the target the assignment gives for Colab. You can explain the shape of your scaling plot.

> **Optional:** Look at the machine code Numba made. `inspect_asm()` on your compiled matmul returns its x86-64 code in the AT&T syntax of chapter 05. Find the inner loop: LLVM keeps a floating-point multiply and add as two instructions, `vmulsd` and `vaddsd`, and does not reorder a sum, because both changes alter the rounding. The option `fastmath=True` allows both, so the pair can become one **fused multiply-add** that rounds once, `vfmadd231sd` on one double or `vfmadd231pd` on the four doubles of a `ymm` register. Compile a copy with `fastmath=True`, look again, and measure the change in time and the largest change in any output element at n = 512.

## A CUDA backend

The GPU half of module 3 writes map, zip, reduce and matrix multiply as CUDA kernels in Numba. Numba's CUDA target now ships as a separate NVIDIA package, `numba-cuda`, which needs numba 0.60 or newer and supports CUDA 12 and 13 through pip extras. Once it is installed, `from numba import cuda` loads it. The syntax is the one you used in GPU Puzzles in chapter 21:

- `@cuda.jit` compiles a Python function into a kernel, and `f[blocks, threads](args)` launches it.
- `cuda.threadIdx.x`, `cuda.blockIdx.x` and `cuda.blockDim.x` are the CUDA C variables of the same names.
- `cuda.shared.array(shape, numba.float64)` declares shared memory with a constant shape, and `cuda.syncthreads()` is `__syncthreads()`.
- `cuda.local.array` gives each thread a small private array, which you use for index buffers. It can end up in local memory in DRAM, the `LDL` and `STL` you looked for in chapter 21's SASS.

`cuda_ops.py` compiles your `to_index`, `index_to_position` and `broadcast_index` as device functions, so your module 2 index code runs on the GPU unchanged.

Map and zip are one thread per output element with a bounds check, the first kernels of chapter 21. `_sum_practice` sums each block of 32 values in shared memory with the tree reduction of chapter 21. The reduce launcher in `cuda_ops.py` needs a fix first. It sizes the reduced dimension of the output as one slot per 1024 input elements, so a reduced dimension longer than 1024 comes back with the wrong shape, and the tests, whose dimensions are at most 3, never see it.

Set that size to 1, launch one block per output position, and have thread t add up the elements at t, t + 1024, t + 2048 and so on before the tree. This is the grid-stride loop of chapter 21's "Reductions" step, inside one block.

![The reduce for one output position over 10 elements, drawn with 4 threads where MiniTorch uses 1024. Thread t adds the elements at t, t + 4 and t + 8 into a register, the partial sums go to shared memory, and the tree reduction of chapter 21 leaves one value that thread 0 writes to out[o].](figures/22-cuda-reduce.svg)

`_mm_practice` multiplies two square matrices smaller than 32 inside one block: load both into shared memory, synchronize, compute, and write each output once. The full `_tensor_matrix_multiply` is Kernel 3 of chapter 21, the shared-memory tile with zero fill, plus a batch dimension on `blockIdx.z`. Give a batch stride of 0 to an input whose batch size is 1, so batches broadcast.

Three facts predict the results. MiniTorch stores float64, and Table 5 in section 12.1.1 of the Best Practices Guide from chapter 21 lists 2 float64 results per clock per SM for compute capability 7.5 and 8.6/8.9, against 64 or 128 for float32. Map and zip launch blocks of 32 threads, one warp each, and chapter 21's step "Warps and occupancy" told you what that costs. And every launch passes the shape and stride arrays as NumPy arrays, which Numba copies to the device and back around the kernel. Launches return before the kernel finishes, so call `cuda.synchronize()` before you stop a timer.

### Study

- [MiniTorch Module 3: Efficiency](https://minitorch.github.io/module3/module3/) (do, 8 h): Tasks 3.3 and 3.4, then the GPU commands of Task 3.5. First read its "CUDA" guide, listed under Guides on the page, which maps threads, blocks, shared memory and local arrays onto Numba's API.
- [Numba-CUDA: Installation](https://nvidia.github.io/numba-cuda/user/installation.html) (reference, as needed): "Supported GPUs", "Supported CUDA Toolkits" and the pip commands with the `cu12` and `cu13` extras.
- [Numba-CUDA: Memory management](https://nvidia.github.io/numba-cuda/user/memory.html#shared-memory-and-thread-synchronization) (reference, as needed): "Shared memory and thread synchronization" for `cuda.shared.array` and `syncthreads`, "Local memory", and "Data transfer" for what Numba copies around a launch.

### Build

1. In `Module-3`, run `pip install -c ~/mt/constraints.txt "numba-cuda[cu13]"`. The `cu13` extra installs the CUDA 13 runtime libraries as wheels, matching the CUDA 13 toolkit of chapter 21. CUDA 13 supports compute capability 7.5 and newer. If your chapter 21 `deviceQuery` notes show a lower compute capability, install `numba-cuda[cu12]` instead. Run `python -c "from numba import cuda; print(cuda.__file__); cuda.detect()"`. The path should be inside the `numba_cuda` package, and the list should show your GPU.
2. Task 3.3: `tensor_map`, `tensor_zip`, `_sum_practice` and `tensor_reduce`, with the launcher fix and the strided loop described above. Run `pytest -m task3_3`. Add your own test that sums 5000 random elements along one dimension on the GPU backend and compares the result and its shape with NumPy.
3. Task 3.4: `_mm_practice`, then `_tensor_matrix_multiply`, with `pytest -m task3_4`. Then write `mm_check.py`, which multiplies a (2, 33, 47) tensor by a (1, 47, 65) tensor on the GPU backend and compares the result with the fast CPU backend. Run it under `compute-sanitizer --tool racecheck python mm_check.py` and record the summary.
4. `bench_gpu.py`: matmul at n = 64, 128, 256, 512 and 1024 on the fast CPU backend and the GPU backend, with a warmup call first and `cuda.synchronize()` before each stop time. Plot both, as the assignment asks. Compute GFLOP/s at n = 1024 and compare it with the float64 peak: SMs times float64 results per clock from Table 5, times 2, times the clock from your chapter 21 `deviceQuery` notes.
5. Block size. `THREADS_PER_BLOCK` is also the side of the square blocks in matrix multiply and the practice kernels, and 128 x 128 threads is more than a block can hold. So give map and zip their own constant, `MAP_THREADS`, and leave `THREADS_PER_BLOCK` at 32. For `MAP_THREADS` of 32, 128 and 256, time `exp` on a tensor of 2^24 elements two ways. First end to end, through the tensor's `exp` method. Then the kernel alone: copy the storage, shape and stride arrays to the device once with `cuda.to_device`, launch your compiled map kernel on them 100 times, and call `cuda.synchronize()` before you stop the timer.
6. Task 3.5 on the GPU: `--BACKEND gpu --HIDDEN 100` and `--HIDDEN 500` on the split dataset. Compare each time per epoch with your CPU numbers from the previous step.

### Done when

`pytest -m "task3_3 or task3_4"` passes on the GPU. Racecheck reports no hazards. Your plot shows where the GPU matmul overtakes the CPU one, and you have its percentage of the float64 peak at n = 1024. Your 5000-element sum matches NumPy in value and shape. You can say how much of the end-to-end time of `exp` is copying, explain with occupancy how the block size changed the kernel-alone time, and say why the GPU barely helps or even loses with 100 hidden units.

> **If it fails:** If `cuda.detect()` finds no device or reports a driver that is too old, run `nvidia-smi` in the same terminal. When `nvidia-smi` also fails, the Windows driver is the problem, and chapter 21's setup step covers it. When it works, compare the "CUDA Version" it prints with the extra you installed: a driver that shows 12.x needs `numba-cuda[cu12]` or a newer Windows driver.

> **Optional:** Numba also has a CUDA simulator. Set `NUMBA_ENABLE_CUDASIM=1` before Numba is imported, and kernels run in plain Python, one block at a time with one Python thread per CUDA thread, so `print` works inside a kernel and you can stop one thread in `pdb`. It is slow, and it does not catch a `syncthreads()` that only some threads reach. MiniTorch's `TensorData.to_cuda_` calls `numba.cuda.is_cuda_array`, which the simulator lacks, so add `numba.cuda.is_cuda_array = lambda a: hasattr(a, "copy_to_host")` at the top of a script that runs tensors on the simulator. The [simulator page](https://nvidia.github.io/numba-cuda/user/simulator.html) shows how to stop a single thread.

## Convolution and pooling

Both backends now run map, zip, reduce and matrix multiply fast. Module 4 uses them to build networks for images and text, and images need a new operation. A **convolution** slides a small weight vector or grid over the input and takes a dot product at every position. In 1D, a weight of width K slides along an input of width T, and inputs past the right edge count as 0, so the output is as wide as the input. With channels, the input has shape (batch, in_channels, width), the weight has shape (out_channels, in_channels, K), and each output channel sums over every input channel and every weight position.

![A 1D convolution with a kernel of width 3. Output t is the dot product of the weights with the inputs at t, t + 1 and t + 2. Positions past the right edge count as 0, so the output is as wide as the input.](figures/22-conv.svg)

The convolution guide explains it by unrolling. Copy each window of K inputs into a row of a matrix, and the convolution becomes a matrix multiply of that matrix with the weights. Production libraries use this trick, called **im2col**, to reuse a fast matrix multiply. MiniTorch computes the sums directly in a Numba loop instead, and the result is the same.

The backward pass is again a convolution. Output t used input t + k with weight k, so input j was used by outputs j - K + 1 to j, once with each weight. Its gradient collects the output gradient of each of those outputs times the weight that connected them. That is a convolution with the weights anchored on the other side, at j - k instead of j + k, and the `reverse` flag of `_tensor_conv1d` selects that anchoring.

![The input gradient of a 1D convolution with a kernel of width 3. Input x4 was used by outputs o2, o3 and o4, with weights w2, w1 and w0. So its gradient collects g2*w2 + g3*w1 + g4*w0, the weights anchored at j - k instead of j + k.](figures/22-conv-backward.svg)

The weight gradient is a convolution of the input with the output gradient, after swapping the batch and channel dimensions. `Conv1dFun.backward` in `fast_conv.py` is already written, so read it until you can say which call computes which gradient. The 2D version does the same over height and width.

**Pooling** reduces each window of an image to one value, such as its average. Task 4.3's `tile` prepares the windows with four moves:

1. `view` splits height into (new_height, kh) and width into (new_width, kw).
2. `permute` moves the two kernel dimensions to the end.
3. `contiguous` copies, because the permuted tensor cannot be viewed, as the tensor data step showed.
4. `view` merges the last two dimensions into one of size kh * kw.

The figure follows one 6 by 4 image with a 3 by 2 kernel through the four moves. Average pooling is then a mean over the last dimension.

![The tile function on one 6 by 4 image with a 3 by 2 kernel. The image holds four windows a, b, c and d. Four moves turn shape (1, 1, 6, 4) into (1, 1, 2, 2, 6), where the last dimension holds the six values of one window.](figures/22-tile.svg)

### Study

- [MiniTorch Module 4: Networks](https://minitorch.github.io/module4/module4/) (do, 6 h): Tasks 4.1 to 4.3. Read its short "Pooling" guide, listed under Guides on the page, before Task 4.3. Tasks 4.4 and 4.5 are the next step.
- [MiniTorch: Convolution](https://minitorch.github.io/module4/convolution/) (read, 45 min): The whole guide, with the unrolling code and the diagrams of the backward pass for 1D and 2D.

### Build

1. Clone `Module-4`, sync from `Module-3` and run `pip install -c ~/mt/constraints.txt -e .`. Its README also requires `fast_ops.py` and `cuda_ops.py`, which are on the sync list. The MNIST files are already in `project/data`.
2. Problems 15 "1D Convolution" and 20 "2D Conv" in the Autodiff Puzzles notebook you kept from the tensor autograd step.
3. Tasks 4.1 and 4.2, with `pytest -m task4_1` and `-m task4_2`.
4. `check_conv.py`: compare forward results and both gradients with PyTorch in float64. MiniTorch pads only on the right, so the PyTorch version is `F.conv1d(F.pad(x, (0, K - 1)), w)` and `F.conv2d(F.pad(x, (0, kw - 1, 0, kh - 1)), w)`. Test three shapes for each, including an input narrower than the kernel and more than one batch, input channel and output channel.
5. Task 4.3: `tile` and `avgpool2d`, with `pytest -m task4_3`.
6. Time your `conv2d` forward on an input of shape (16, 1, 28, 28) with weights of shape (4, 1, 3, 3) against `F.conv2d` on the CPU, and record the ratio.

### Done when

`pytest -m "task4_1 or task4_2 or task4_3"` passes. `check_conv.py` matches PyTorch within 1e-10 on every shape, forward and backward. You can explain from the index ranges why the input gradient of a convolution is a convolution with the weights anchored the other way, and you can write the sequence of shapes that `tile` produces for a (2, 3, 8, 6) input and a (2, 3) kernel.

## Softmax, dropout and two real classifiers

Task 4.4 adds the operations a classifier needs, mostly built from operations you already have:

- `max` along a dimension is a reduction. Its gradient goes only to the position that held the maximum, so its backward multiplies `grad_output` by a one-hot mask from `argmax`.
- Softmax is `exp(x - m) / sum(exp(x - m))` with m the maximum, the stable form from chapter 21.
- Log-softmax is `x - logsumexp(x)`, with `logsumexp(x) = m + log(sum(exp(x - m)))`. Computing it directly avoids taking the log of a softmax value that has rounded to 0.
- `maxpool2d` is `tile` followed by `max`.

**Dropout** sets each element to 0 with probability p during training and scales the survivors by 1 / (1 - p), so the expected value stays the same. MiniTorch's tests expect `dropout(t, 1.0)` to return zeros, so handle p = 1 without dividing by zero. In evaluation dropout does nothing. MiniTorch's `dropout` takes an `ignore` argument for that, and your networks pass it the `training` flag that the module 0 `train()` and `eval()` methods set.

Built this way, softmax is several MiniTorch operations. Each one allocates a full tensor, makes a pass over memory and records a node for the backward pass. Chapter 21 fused all of that into one kernel, and the next step does the same inside MiniTorch.

Task 4.5 trains two models. The sentiment model is a 1D convolutional network over word vectors for SST-2, a dataset of movie review sentences labeled positive or negative.

On its first run the script downloads two things. SST-2 comes through the `datasets` library from the setup step. The 50-dimensional GloVe word vectors come through the `embeddings` package, a small library that downloads pretrained word vectors. The GloVe download is `glove.6B.zip`, about 860 MB.

The image model is a small LeNet-style network on part of MNIST, a dataset of 28 by 28 images of handwritten digits.

![The MNIST network of Task 4.5 with the shape after each layer, for a batch of 16 images. Log-softmax at the end is the operation your own kernel replaces later.](figures/22-mnist-net.svg)

### Study

- [MiniTorch Module 4: Networks](https://minitorch.github.io/module4/module4/) (do, 6 h): Tasks 4.4 and 4.5.
- [MiniTorch: Multiclass Classification](https://minitorch.github.io/module4/softmax/) (read, 30 min): The whole guide, listed as "Softmax" under Guides on the module 4 page, before Task 4.4: from sigmoid to softmax, argmax and its gradient, and max pooling.

### Build

1. Task 4.4: `max`, `softmax`, `logsoftmax`, `maxpool2d` and `dropout`. Fill in the `test_max` TODO in `tests/test_nn.py` with a value check and a gradient check, then run `pytest -m task4_4`.
2. Your own property tests for softmax: each row sums to 1 within 1e-12, adding a constant to a row changes nothing, and `logsoftmax` matches `log(softmax)` where softmax is not tiny. Add the extreme rows from chapter 21: values of 1e4 and -1e4 mixed in one row must give finite outputs.
3. Task 4.5: implement `Conv1d`, `Conv2d` and `Network` in `project/run_sentiment.py` and `project/run_mnist_multiclass.py`, following the figure for MNIST. The template's `run_sentiment.py` calls `load_dataset("glue", "sst2")`, a name the current `datasets` from the setup step no longer accepts. Change it to `load_dataset("nyu-mll/glue", "sst2")`, the same data with the same `sentence`, `label` and `idx` fields. Train both on the fast CPU backend, and save the logs as `sentiment.txt` and `mnist.txt`.
4. Profile the second MNIST epoch with a `cProfile.Profile()` that you enable and disable around that epoch in the script, then print its stats sorted by cumulative time. The first epoch includes Numba's compile time, which would swamp the numbers. Write down the three functions that take the most time and the cumulative time of `logsoftmax`.

### Done when

`pytest -m task4_4` passes, including your `test_max`, and your softmax property tests pass. `sentiment.txt` shows a best validation accuracy above 70 percent, as the assignment requires. `mnist.txt` shows the training loss falling and the validation accuracy rising over the epochs. You can name the three most expensive functions in an MNIST epoch and say what fraction of the epoch `logsoftmax` takes.

## Your own operation, end to end

Everything so far filled in a design someone else made. In this step you make the design. Pick one differentiable operation with a reduction inside it and write it as a single MiniTorch `Function` with its own kernels, forward and backward, on the CPU backend and on the CUDA backend. The default is a fused softmax along the last dimension, because you have its chapter 21 kernel and its composed MiniTorch version to compare with.

Log-softmax, logsumexp and layer normalization without learned parameters are good alternatives. Derive the backward pass on paper before you write code.

For softmax, y_i = exp(x_i) / sum_j exp(x_j) has the Jacobian dy_i/dx_j = y_i (delta_ij - y_j), where delta_ij is 1 when i = j and 0 otherwise. Multiplied by an incoming gradient g, that gives dx = y * (g - sum(g * y)) for each row.

![Your fused softmax, one row. The forward pass takes two reductions and one pass and saves only y. The backward pass takes the incoming gradient g, one more reduction for the dot product, and one pass to write dx.](figures/22-softmax-backward.svg)

The kernels work on rows. Call `.contiguous()` on the input first, so that every row sits in storage as one run of `n = shape[-1]` values. A tensor of any number of dimensions then has `size // n` rows, and row r starts at position `r * n`. On the CPU, each direction is a `prange` over rows with sequential inner loops. On the GPU it is one block per row with the shared-memory reduction from the CUDA backend step.

Add the operation to the backends the way `matrix_multiply` is added: a placeholder on `TensorOps` that raises `NotImplementedError`, static methods on `FastOps` and `CudaOps`, and one line in `TensorBackend.__init__` that copies the method onto the backend object. This chapter names the two methods `fused_softmax` for the forward pass and `fused_softmax_back` for the backward pass. Your `Function` calls them on the backend of its input, so the same `Function` runs on either backend.

PyTorch has the same contract. Its `torch.autograd.Function` also has static `forward` and `backward` methods and a context with `save_for_backward`, and its documentation states the rules you followed by habit in MiniTorch. It also gives you an independent check. Wrapped in a `torch.autograd.Function`, your MiniTorch kernels can go through `torch.autograd.gradcheck`, which compares a backward with finite differences over every element, where MiniTorch's `grad_check` samples one element per input.

Edward Yang, a PyTorch core developer, describes how PyTorch organizes the same ideas at scale. A PyTorch tensor has storage, sizes and strides, and also an offset into the storage. In 2019 each call dispatched twice, first on the device and layout and then on the data type. Since 2020 every call goes through one dispatcher that picks a kernel from a set of dispatch keys, with autograd as one of the keys, so read that part of the essay as history.

### Study

- [PyTorch 2.15: Extending torch.autograd](https://docs.pytorch.org/docs/2.15/notes/extending.html#extending-torch-autograd) (read, 40 min): "When to use", "When not to use", "How to use" with its four steps, and the `LinearFunction` and `MulConstant` examples. Skip the paragraphs on `ctx.input_grad_buffers`, `clear_saved_tensors_on_access` and `boxed_grads_call`, and stop before "Forward mode AD".
- [PyTorch 2.15: torch.autograd.gradcheck](https://docs.pytorch.org/docs/2.15/generated/torch.autograd.gradcheck.gradcheck.html) (reference, as needed): The signature, the defaults for `eps`, `atol` and `rtol`, and the notes that the defaults assume double precision and that non-differentiable points can fail.
- [Edward Z. Yang: PyTorch internals](https://blog.ezyang.com/2019/05/pytorch-internals/) (read, 45 min): The first part, from the start to "Enough about concepts, let's look at some code": tensors, strides, storage, the 2019 dispatch, extension points and autograd. The code tour after that describes the 2019 source layout, which has changed since, so skip it.

### Build

1. `minitorch/fused.py` in your `Module-4`, in this order, each part tested before the next:
   1. The CPU forward kernel: a Numba `prange` over rows of a contiguous float64 array. Test it alone on NumPy arrays against a NumPy softmax.
   2. The CPU backward kernel, which takes y and g and writes dx with the formula above. Test it alone the same way.
   3. The wiring: the `TensorOps` placeholders, `FastOps.fused_softmax` and `FastOps.fused_softmax_back` that call the two kernels, the line in `TensorBackend.__init__`, and one `Function` whose `forward` saves only y. Test it on the CPU backend.
   4. The CUDA forward kernel and `CudaOps.fused_softmax`.
   5. The CUDA backward kernel and `CudaOps.fused_softmax_back`.
2. `tests/test_fused.py`: forward and backward against `torch.softmax` in float64, with a random `grad_output`, for shapes (1, 1), (4, 1), (3, 5), (2, 3, 7), (64, 1000) and (8, 50257), on both backends. Add the extreme rows from the previous step. Add a fully `-inf` row too, and check it against the output you chose and wrote down in chapter 21, not against `torch.softmax`, which returns NaN there.
3. The `gradcheck` wrapper, on the fast CPU backend. Its `forward` and `backward` convert between float64 PyTorch tensors and MiniTorch tensors. From PyTorch to MiniTorch, use your `from_numpy` helper from the tensor autograd step on `t.detach().numpy()`. Back again, `torch.from_numpy(m.to_numpy())` wraps a MiniTorch tensor `m`. The `forward` calls your `Function` and keeps its output y on `ctx`. The `backward` calls `fused_softmax_back(y, g)` on the backend directly, because `gradcheck` calls `backward` many times for one `forward`, and a MiniTorch `backward()` would add into the same `.grad` each time. Run it for shapes (3, 5) and (2, 3, 7) with float64 inputs.
4. `bench_fused.py`: your fused operation against the composed `softmax` from Task 4.4, forward plus backward, at (1024, 1024) and (64, 50257), on the CPU and the GPU backend. Before timing anything, check the composed GPU softmax against `torch.softmax` at (64, 50257). Its `max` and `sum` reduce over 50257 elements, so this checks your reduce launcher fix from the CUDA backend step. Count the tensors each version allocates. Every MiniTorch tensor is built through `TensorData.__init__`, so wrap that method to add one to a module-level counter, and read the counter before and after a call. Add `torch.softmax` in float64 on the CPU as a reference.
5. Replace the composed `logsoftmax` in your MNIST network with `log` of your fused softmax, or with a log-softmax version of your operation. Set `random.seed` and `numpy.random.seed` at the top of the script, then run three epochs with the composed version and three with yours. The two loss curves should agree within rounding. Profile the second epoch of each as in the previous step and report the time spent in the log-softmax call separately, then say from the profile why the total time barely moves.
6. `notes/runtime.md`: draw the path of one call, `y = fused_softmax(x)`, from the Python call through `Function.apply`, the history record, the backend dispatch, the kernel launch and its argument copies, to the output tensor, and then the backward call back to the accumulated gradient on a leaf. Under the drawing, list five things PyTorch does that MiniTorch does not, each with the place in Yang's essay or in your own earlier chapters where you saw it.

### Done when

Every test in `test_fused.py` passes `numpy.testing.assert_allclose` with `rtol=1e-9` and `atol=1e-12` on both backends, and `gradcheck` returns True. The fused version beats the composed one forward plus backward at both sizes on both backends, or you can explain from your measurements which size it loses at and why. The composed GPU softmax matches `torch.softmax` at (64, 50257). MNIST trains with your operation, its loss curve agrees with the composed version's, and you have the log-softmax time per epoch for both. `notes/runtime.md` has the drawing and the five differences.

## Your own kernels as a MiniTorch backend

Every kernel under MiniTorch so far is Numba code. Your AVX2 array add of chapter 07 and your fused softmax of chapter 21 can run there too. A backend is the class you hand to `TensorBackend`, so a class whose methods call your code puts that code under every MiniTorch model. This step builds that class, `NativeOps`, and trains the MNIST network on it.

![Your kernels under MiniTorch. NativeOps answers every call the backend makes. An add or multiply of two packed tensors of equal shape goes through ctypes to your AVX2 library. The fused softmax goes through PyTorch to your chapter 21 kernel on the GPU. Everything else falls back to the Numba code of FastOps.](figures/22-native-backend.svg)

`TensorBackend.__init__` asks its class once for each operation, for example `ops.zip(operators.add)`, and keeps the function it gets back. So `NativeOps` can subclass `FastOps`, override `zip`, look at which scalar function it was given, and return a function that calls C when the tensors allow it and the Numba version otherwise.

Your chapter 07 `add_f32_avx2` adds eight floats per instruction. MiniTorch's storage holds doubles, so the C side uses `__m256d`, which holds four doubles, with `_mm256_loadu_pd` and `_mm256_add_pd`, and keeps a scalar loop for the tail. `<immintrin.h>` declares the intrinsics as in chapter 07, and `<stddef.h>` declares `ptrdiff_t`, the signed type for a count of elements:

```c
#include <immintrin.h>
#include <stddef.h>

void mt_add_f64(double *dst, const double *a, const double *b, ptrdiff_t n) {
    ptrdiff_t i = 0;
    for (; i + 4 <= n; i += 4) {
        __m256d va = _mm256_loadu_pd(a + i);
        __m256d vb = _mm256_loadu_pd(b + i);
        _mm256_storeu_pd(dst + i, _mm256_add_pd(va, vb));
    }
    for (; i < n; i++) dst[i] = a[i] + b[i];
}
```

**ctypes** is the module of Python's standard library that loads a shared library and calls its C functions. This chapter uses it over the `cffi` package because it ships with Python and these functions take only pointers and a length.

`ctypes.CDLL(path)` loads the library. Each function then gets `argtypes`, the C type of each argument, and `restype = None` for a `void` result. Without `argtypes`, ctypes passes a Python integer as a C `int` and cuts a 64-bit address down to 32 bits. For `mt_add_f64` the list is `[c_void_p, c_void_p, c_void_p, c_ssize_t]`: three addresses, then `c_ssize_t`, the signed 64-bit type that matches `ptrdiff_t`. A NumPy array's `.ctypes.data` is the address of its first element as a Python integer.

The C function walks `n` doubles from each pointer, so it is right only when every element of each tensor sits in storage in row-major order. Call such a tensor **packed**: its strides equal `strides_from_shape(shape)`. A transposed view is not packed, and a broadcast pairs two different shapes, so those calls go to Numba:

```python
_C_ZIPS = {operators.add: _lib.mt_add_f64, operators.mul: _lib.mt_mul_f64}

class NativeOps(FastOps):
    @staticmethod
    def zip(fn):
        fallback = FastOps.zip(fn)
        cfn = _C_ZIPS.get(fn)
        if cfn is None:
            return fallback

        def ret(a, b):
            if a.shape == b.shape and packed(a) and packed(b):
                out = a.zeros(a.shape)
                cfn(out._tensor._storage.ctypes.data, a._tensor._storage.ctypes.data,
                    b._tensor._storage.ctypes.data, out.size)
                return out
            return fallback(a, b)

        return ret
```

`_C_ZIPS.get(fn)` looks the scalar function up by identity, so only `operators.add` and `operators.mul` reach C.

The GPU half reuses chapter 21's step "Calling your kernel from PyTorch", where `load_inline` turned your softmax kernel S2 into a Python module that takes float32 CUDA tensors. That kernel normalizes the rows of an M by N matrix. So `NativeOps.fused_softmax` treats a tensor of any shape as rows of its last dimension, as your CPU kernel does. It makes the input contiguous, wraps the storage with `torch.from_numpy`, which shares the memory, and views it as (size // n, n) with n the last dimension. Then it:

1. copies it to the GPU as float32 with `.to("cuda", torch.float32)`,
2. calls your kernel,
3. copies the result back with `.to(torch.float64).cpu()`, which waits for the kernel to finish, and makes a MiniTorch tensor of the original shape from it.

The float32 round trip limits the agreement with float64 to about 1e-7. Only the forward pass changes. For the backward pass your `Function` still calls `fused_softmax_back`, the CPU kernel that `NativeOps` inherits from `FastOps`.

### Study

- [Python: ctypes tutorial](https://docs.python.org/3/library/ctypes.html#ctypes-tutorial) (read, 40 min): "Loading dynamic link libraries", "Accessing functions from loaded dlls", "Calling functions", "Fundamental data types", "Specifying the required argument types (function prototypes)" and "Return types". Skip the Windows examples and stop before "Passing pointers".
- [NumPy: ndarray.ctypes](https://numpy.org/doc/stable/reference/generated/numpy.ndarray.ctypes.html) (reference, as needed): The `data` attribute, and the note that C code must respect the array's flags and data type.

### Build

1. `native/mtk.c` in your `Module-4` with `mt_add_f64` and `mt_mul_f64`. Test both in `native/test_mtk.c` against a scalar loop for every n from 0 to 33, with guard values after `dst` that must not change, built with `-mavx2 -mfma -fsanitize=address,undefined` as in chapter 07. Then build the library. As in chapter 05's `libjson.so`, `-fPIC` compiles position-independent code, which works wherever the loader puts it, and `-shared` links a shared library instead of an executable: `clang -std=gnu11 -O2 -Wall -Wextra -mavx2 -mfma -shared -fPIC -o native/libmtk.so native/mtk.c`. Check with `objdump -d` that the loop uses `vaddpd` on `ymm` registers.
2. `minitorch/native_ops.py`: load `libmtk.so` with ctypes, set `argtypes` and `restype`, and write `packed` and `NativeOps` with the `zip` override above. Count the calls that reach C and the calls that fall back to Numba.
3. In the same file, `fused_softmax` for `NativeOps`, calling the module that your chapter 21 `py/softmax_ext.py` builds with `load_inline`. If that script runs its tests when imported, move the `load_inline` call into a function first. Run `pip install -c ~/mt/constraints.txt ninja` in this environment, since `load_inline` needs it.
4. `tests/test_native.py`: add and multiply on `NativeOps` equal `FastOps` exactly, with `numpy.testing.assert_array_equal`, for shapes (1,), (3,), (4,), (5,), (33,), (7, 9) and (2, 3, 5). A permuted input and a broadcast input give the `FastOps` result and are counted as Numba calls. The gradients of `(a * b + a).sum()` match. `fused_softmax` on `NativeOps` matches `torch.softmax` in float64 within `rtol=1e-5` at (3, 5), (16, 10) and (64, 50257).
5. `bench_native.py` at 1000 x 1000. `NativeOps.zip` allocates `out` with `a.zeros`, the way `FastOps` does, so time that allocation too. Measure `a + b` on `FastOps` and on `NativeOps`, the C function alone on two NumPy arrays and a preallocated output, NumPy's own `+`, and `zeros` alone. Find where the time of the whole call goes. Replace the allocation with `Tensor.make(np.zeros(a.size), a.shape, backend=a.backend)` and time again. Then time `fused_softmax` on `NativeOps` and on `FastOps` at (16, 10) and at (64, 50257).
6. `project/run_mnist_native.py`: a copy of your MNIST script with the fused log-softmax of the previous step and a `BACKEND` you choose from the command line. Offer `FastOps` and `NativeOps` only. A tensor made with `CudaOps` keeps its storage in GPU memory, and the convolutions in `fast_conv.py` are Numba CPU code that cannot read it. On the CUDA simulator the first `conv2d` stops with a `TypeError`. With the seeds fixed, run three epochs on `FastOps` and three on `NativeOps`, record the time of epochs 2 and 3, since the first includes Numba's compile time, and count the C and Numba calls of one epoch.
7. `project/torch_mnist.py` (the first item to cut if the step runs long): the same network in PyTorch with `F.conv2d` and the right and bottom padding from the convolution step, the same 16-image batches and plain SGD. Time one epoch on the CPU in float64 and on the GPU in float32, with `torch.cuda.synchronize()` before the timer stops.

### Done when

`test_mtk.c` passes under the sanitizers and `tests/test_native.py` passes. MNIST trains on `NativeOps`, and its loss curve agrees with the `FastOps` run to within the float32 rounding of the softmax. The README has one table with the epoch time of `FastOps`, `NativeOps`, PyTorch on the CPU in float64 and PyTorch on the GPU in float32 (the PyTorch rows only if you did Build 7), and one sentence for each row on where its time goes. You can say what fraction of add and multiply calls reached C and why the rest did not, how much of the 1000 x 1000 add was allocation before your fix, and why the GPU softmax loses to the CPU one at (16, 10).

> **Optional:** Link the job system of chapter 09 into `libmtk.so` and split the add across threads with `parallel_for`. Compare it with the one-thread version and with Numba's `prange` at 1000 x 1000 and at (16, 10), and explain both results from the cost of waking threads and from the memory bandwidth you measured in chapter 07.

## Where this leads

This is the end of the book. You can take a model you train at work and follow one call all the way down: from Python through autograd and a backend, to strides and a kernel, to the instructions the CPU or the GPU runs and the counters that say why it is slow. You built a small version of each of those layers, and in the last step your own C and CUDA code ran underneath them.

MiniTorch stays small in ways PyTorch is not. It stores only float64, keeps tensors on the host, allocates a new tensor for every result, pays a Python call for every operation, and fuses nothing unless you write the fused kernel by hand. Each direction below takes up one of those gaps or another thread of the book, and each has one place to start.

- **Contribute to PyTorch.** Take the method of chapter 20 to the library you use every day. PyTorch's [CONTRIBUTING.md](https://github.com/pytorch/pytorch/blob/main/CONTRIBUTING.md) asks that a pull request link to an issue a maintainer has labeled `actionable`, and the label `good first issue` marks the simplest of those. Pick an operator whose kernel you can now read.
- **Read a framework that fits in your head.** Andrej Karpathy's [train_gpt2.c](https://github.com/karpathy/llm.c/blob/master/train_gpt2.c) in llm.c trains GPT-2 on the CPU in one C file, with a forward and a backward function written out for every layer. Match each one to a MiniTorch `Function`, then read its CUDA versions in the same repository, whose `dev/cuda` directory you met in chapter 21.
- **Compile tensor programs.** You fused matrix multiply and softmax by hand. Tensor compilers fuse whole graphs. MLIR's [Toy tutorial](https://mlir.llvm.org/docs/Tutorials/Toy/) follows the Kaleidoscope model of chapter 12 and lowers a small language of tensors through its own dialects down to LLVM.
- **Go deeper into a systems layer.** CMU's [15-445 Intro to Database Systems](https://15445.courses.cs.cmu.edu/) has four C++ projects, a buffer pool manager, a database index, query execution and concurrency control, which continue the storage of chapter 18 and the replication of chapter 19 inside one server.
