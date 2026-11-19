---
id: 18
title: Storage and network internals
part: Storage, networks and real codebases
weeks: 10
project: A key-value store with a checksummed log, crash tests on a simulated disk, a B+ tree on a buffer pool and a page-level write-ahead log, then a userspace TCP over a Linux TUN device that serves a file to curl through 5% packet loss.
---

Chapter 17 ended with firmware that forgets everything at power-off and talks over a serial line with no protocol on it. This chapter takes on both gaps with programs you have used for years from the outside. A database keeps data across crashes. A TCP stack moves bytes across a network that drops, duplicates and reorders packets. You build a small version of each in C, in Ubuntu under WSL2.

The storage half starts with the simplest store that survives a crash: one file of checksummed records and a hash table in memory. Then you write a simulated disk that loses, tears and fails writes, and a harness that crashes the store at every write and checks what comes back. With that harness in place you move the index onto disk pages: a buffer pool, a B+ tree on top of it, and a write-ahead log of pages. The same crash tests check every version.

The network half uses a TUN device, a network interface whose other end is your program. You parse IPv4 and TCP headers, answer with resets, then write the TCP state machine until `nc` and `curl` talk to your stack as to any other host. The last two steps add retransmission and congestion control, and drop packets on purpose to prove they work.

You lean on five earlier chapters:

- Chapter 04: the arena, the hash trie, byte-level parsing and libFuzzer.
- Chapter 06: xorshift32 for seeded randomness.
- Chapter 07: the repetition tester, `getrandom` and `perf`.
- Chapter 08: `fork`, pipes and signals, `strace`, xv6's log, sockets, the event loop and the HTTP subset.
- Chapter 16: kernel modules.

The chapter leaves out SQL, concurrent transactions, `O_DIRECT`, `io_uring` and IPv6. Each is a subject of its own, and none of them changes how durability or TCP works.

## A log of checksummed records

A program that keeps data has to find it again after a crash. The simplest file layout that allows that is a **log**: a file that only ever grows at its end. Chapter 08 showed you one in xv6, which wrote blocks to its log before it copied them home. This step builds a log that holds the data itself.

The design comes from **Bitcask**, the storage engine of the Riak database. Every `put` appends one **record** with the key and the value to the end of the file. A hash table in memory, the **keydir**, maps each key to the file offset of its newest record. A `get` is one lookup in the keydir and one read at that offset.

A delete appends a **tombstone**, a record that says the key is gone. When the store opens, it reads the file from the start and builds the keydir again.

Split the work into two files. `log.c` writes and checks records of bytes, and knows nothing about keys. `kv.c` puts a key and a value inside each record and keeps the keydir. Chapter 19 reuses `log.c` for a second log of its own.

![The log file is a row of records, each an 8-byte header with the payload length and a CRC, then the payload. The key-value store's payload holds the key length, value length, key and value. The last record was cut by a crash, so opening the log stops at the end of the last whole record and truncates the torn tail.](figures/18-log-records.svg)

Each record starts with an 8-byte header: the length of the payload, then a checksum. A **checksum** is a number computed from a run of bytes, so that a changed byte almost always changes the number.

A crash can stop the file at any byte, so the last record may be **torn**: only partly written. When the log opens, it reads records from the start until one fails a check:

- fewer than 8 bytes remain for a header
- the length is above your limit, or the record runs past the end of the file
- the CRC does not match

The first record that fails marks the end of the log. Cut the file there with `ftruncate`. A bad record followed by good ones means the disk changed bytes it had already stored, which this chapter does not handle. Report it and stop.

Write every header field one byte at a time in little-endian order, with shifts and masks. The checksum is **CRC-32**, the one zip files and Ethernet use, and it takes eight lines:

```c
uint32_t crc32(const uint8_t *p, size_t n) {
    uint32_t c = 0xFFFFFFFF;
    for (size_t i = 0; i < n; i++) {
        c ^= p[i];
        for (int k = 0; k < 8; k++)
            c = (c >> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return ~c;
}
```

It processes one bit at a time. `0xEDB88320` is the constant that the CRC-32 standard fixes, and `-(c & 1)` is all ones when the low bit is set and zero otherwise, so the XOR happens only for a set bit. The CRC covers the length field and the payload, so a run of zero bytes at the end of a file never passes as an empty record.

> **Practice:** Never write a C struct to a file or read one from it. Chapter 02 showed you the padding the compiler puts inside a struct, and the layout can change with the compiler and its flags. Read and write every field by its byte offset.

### Study

- [Bitcask: A Log-Structured Hash Table for Fast Key/Value Data](https://riak.com/assets/bitcask-intro.pdf) (read, 30 min): Justin Sheehy and David Smith, Basho, 2010. All six pages. Pages 2 to 4 are the design: the entry format, the keydir, merging and hint files. The API on page 6 is in Erlang, and you only need its shape. Merging comes in the next step, and hint files are not part of this chapter.

### Build

1. Three system calls are new here. The manual pages you installed in chapter 00 describe each one, under `man 2 pread` and so on:
   - `pread(fd, buf, n, off)` reads `n` bytes at offset `off` without moving the file position.
   - `write` on a file opened with `O_APPEND` always writes at the end.
   - `ftruncate(fd, len)` sets the file's length to `len` bytes.
2. Write `crc32` and test it first: `crc32((const uint8_t *)"123456789", 9)` must return `0xCBF43926`.
3. Write `src/log.h` and `src/log.c` with this interface. `log_open` scans the file and cuts a torn tail. `log_scan` calls `fn` once for every record from the start, which is how the store rebuilds its keydir.

   ```c
   typedef struct Log Log;
   typedef void LogFn(void *ctx, uint64_t off, const uint8_t *rec, uint32_t n);

   Log    *log_open(const char *path);                       // NULL on error
   int     log_scan(Log *l, LogFn *fn, void *ctx);
   int64_t log_append(Log *l, const void *rec, uint32_t n);  // record offset or -1
   int     log_read(Log *l, uint64_t off, uint8_t *buf, uint32_t cap); // length or -1
   int     log_truncate(Log *l, uint64_t off);               // drop records from off on
   void    log_close(Log *l);
   ```

4. Write `src/kv.h` and `src/kv.c` on the log. Programs include `log.c` and `kv.c` as they include `base.c`. Give the store `kv_open(dir)`, `kv_put`, `kv_get`, `kv_del` and `kv_close`. Keys are 1 to 255 bytes and values 0 to 64 KB. The payload is the key length (4 bytes), the value length (4 bytes, `0xFFFFFFFF` for a tombstone), the key and the value. Keep the keydir in your chapter 04 hash trie, with the keys copied into an arena.
5. Write `tests/log_test.c` in the test pattern of chapter 02 and run it with `sh tests/run_test.sh log`. It writes a log of a few records with known payloads, then for every byte offset inside the last record copies the file cut to that length, opens the copy and checks what `log_scan` returns. A second loop flips one byte at a time in the last record.

### Done when

The CRC test passes. A log cut at any byte offset of its last record opens cleanly, keeps every record before it, and has the length of those records afterwards. A flipped byte in the last record drops only that record. A store reopened after puts, overwrites and deletes returns the newest value of every key and nothing for deleted keys.

## What write and fsync promise

The store writes records, but it cannot yet say when a put is safe. A put is **acknowledged** when it returns success to its caller, and from then on the caller may act as if the data is stored. This step finds out what `write` actually promises, adds the call that makes a put safe, and crashes the store a thousand times to check.

`write` copies your bytes into the **page cache**, memory where the kernel keeps file data, and returns. The kernel sends the data to the disk later, in its own order. `fsync(fd)` sends the file's data and its size to the disk and waits until the disk reports them stored. So a put does four things in this order: append the record, `fsync`, update the keydir, return.

![Bytes go from your buffer to the kernel's page cache with write, and from the page cache to the disk with fsync. After write returns, the data survives a crash of your process but not a crash of the machine. After fsync returns, it survives a power cut too.](figures/18-write-fsync.svg)

A file's name is stored in its directory, and the directory is a file with its own page cache. A new file, or a `rename`, reaches the disk only when the directory is synced. To sync a directory, open it with `open(dir, O_RDONLY)` and call `fsync` on that descriptor.

The log keeps every old version of every key. Bitcask's **merge** writes the live records to a new file and swaps it in. OSTEP describes the pattern for the swap:

1. Write the new file, `data.tmp`, and `fsync` it.
2. `rename` it over `data`. The rename replaces the old file in one step, so other code sees either the old file or the new one.
3. `fsync` the directory, so the rename itself reaches the disk.

![What the program sees and what is on disk after each call of a merge. The new bytes reach the disk at the fsync of data.tmp, but the name data points at the new file on disk only after the directory is synced. A crash after any call leaves either the old file or the new one under the name data.](figures/18-merge.svg)

In WSL2 your files live in ext4 inside a virtual disk, a file named `ext4.vhdx` on the Windows drive. `fsync` sends the data to that virtual disk and waits for Windows to confirm it. A crash of the Linux side does not lose what Windows has already received, and how far a flush travels past Windows depends on the laptop's drive. No crash you can cause on this laptop tests a lost disk cache, so the next step simulates the disk.

Your first crash test kills the writing process with **SIGKILL**, a signal that ends a process at once. Unlike the SIGINT of chapter 08's shell, a process cannot catch or ignore it. `kill(pid, SIGKILL)` sends it from C, and `kill -9 <pid>` from the shell. The kernel keeps running, so only the process dies.

### Study

- [OSTEP chapter 39: Interlude: Files and Directories](https://pages.cs.wisc.edu/~remzi/OSTEP/file-intro.pdf) (read, 25 min): Sections 39.7 "Writing Immediately With fsync()" and 39.8 "Renaming Files", pages 12 to 14. Skip the aside on `mmap` and persistent memory.
- [Linux man page: fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) (reference, as needed): DESCRIPTION, including the paragraph on syncing the directory that holds a new file, and EIO under ERRORS.

### Build

1. Add `int log_sync(Log *l)` to the log and make `kv_put` and `kv_del` call it before they update the keydir and return. Handle a short `write` in a loop. Treat any error from `write` or `fsync` as fatal for the store: return an error and refuse further puts until the store is reopened. The next step explains why a failed `fsync` cannot be retried.
2. On open, when the file is new or was cut, `fsync` the file and the directory.
3. Write `kv_merge` as above. On open, delete any `data.tmp` that a crashed merge left behind.
4. Write `src/kvcrash.c`. The parent forks a writer that puts random keys in a loop, with the put's sequence number as the value, and writes the key and number of each acknowledged put to a pipe. The parent sends `SIGKILL` after a random delay between 1 and 200 ms, reads the pipe, reopens the store and checks that every acknowledged put is present with its number or a newer one.
5. Write `src/kvbench.c`, which does as many puts of 100-byte values as its argument says. Measure puts per second with the repetition tester from chapter 07, with and without `log_sync`, in a release build: `sh build.sh kvbench release`.
6. Look at the system calls behind one put. `strace -e trace=write,fsync` prints each call, and `-c -w` prints a table of the calls with their count and the wall-clock time spent in them:

   ```sh
   strace -e trace=write,fsync ./out/Linux-release/kvbench 3
   strace -c -w -e trace=write,fsync ./out/Linux-release/kvbench 2000
   ```

> **Optional, on the Mac:** On macOS `fsync` hands the data to the drive without flushing the drive's own cache, and `fcntl(fd, F_FULLFSYNC)` asks for the flush, as [Apple's fsync(2) page](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) says. Run the benchmark there with `fsync` and with `F_FULLFSYNC` and compare.

### Done when

`kvcrash` passes 1000 rounds in a row. You have two puts-per-second numbers, and the `strace` table shows one `write` and one `fsync` per put, with most of the time in `fsync`. When the store opens a file with a torn tail, `strace -e trace=ftruncate,fsync` shows the cut and then a sync of the file and of the directory. You can name the writes that a power cut could lose and `SIGKILL` cannot: anything still in the page cache.

## Crash tests on a simulated disk

`SIGKILL` leaves the page cache intact. It never loses an unsynced write, never tears a write in half and never makes `fsync` fail. A power cut can do all three, and you cannot pull the power a thousand times. The SQLite developers test their commit code with a fake file layer that simulates these failures, and it found bugs that reading the code did not. You build the same thing for your store.

Put every file operation the store makes behind a small interface:

```c
typedef struct Disk Disk;
int     disk_open(Disk *d, const char *name, bool create);   // file handle or -1
int     disk_pwrite(Disk *d, int f, const void *buf, size_t n, uint64_t off);
int     disk_pread(Disk *d, int f, void *buf, size_t n, uint64_t off);
int64_t disk_size(Disk *d, int f);                           // bytes or -1
int     disk_sync(Disk *d, int f);
int     disk_truncate(Disk *d, int f, uint64_t size);
int     disk_rename(Disk *d, const char *from, const char *to);
int     disk_unlink(Disk *d, const char *name);
int     disk_sync_dir(Disk *d);
```

One implementation calls the real system calls. The other, the **simulated disk**, keeps every file in memory twice: the bytes the program sees, and the bytes that are durable. `disk_sync` copies the first to the second. The names in the directory work the same way, and `disk_sync_dir` makes a rename or an unlink durable.

![The store calls the Disk interface. One implementation passes each call to a real file. The simulated one keeps a visible copy and a durable copy of each file, copies the visible bytes to the durable ones on disk_sync, counts operations and crashes at the chosen operation k.](figures/18-sim-disk.svg)

The simulated disk counts operations. When the count reaches a chosen **crash point**, it crashes. A crash starts from the durable bytes and applies a random subset of the unsynced writes in random order. It may tear the last one at a 512-byte boundary, and it may leave garbage in bytes that were appended but not synced. Take every choice from one xorshift32 generator, seeded from one number, as chapter 06 did. The harness then runs:

```
for each seed:
    run a random workload, record every put the store acknowledged
    crash at operation number k (k chosen from the seed)
    reopen on the durable bytes
    check: open succeeds
           every key shows the result of its last acknowledged put or delete,
             or of a later operation that was in progress
           every value present was written by some put
```

The simulated disk can also make `disk_sync` fail. When `fsync` fails on Linux, the kernel may mark the failed pages clean and drop the error, so a second `fsync` can return success with the data lost. A store that retries the call can acknowledge writes it does not have. Stop the store on the first failure, and let recovery decide what survived.

> **Practice:** Every randomized test takes a seed on the command line and prints it. A failure is then one command you can run again, in gdb if needed.

### Study

- [Files are hard](https://danluu.com/file-consistency/) (read, 45 min): Dan Luu, 2015. "Crash Consistency" and "Filesystem semantics". They follow one small update through each missing `fsync` and show which file system reorders what. Skim "Filesystem correctness" and "Error recovery", which cover disks and file systems that fail in ways you do not simulate.
- [SQLite: Atomic Commit In SQLite](https://www.sqlite.org/atomiccommit.html#hardware) (read, 30 min): Read sections 2, 6.2, 8 and 9.2. Together they state the failure model your simulated disk implements. Skip sections 3 to 5, the rollback journal, which is a different design from yours.
- [PostgreSQL's fsync() surprise](https://lwn.net/Articles/752063/) (read, 15 min): Jonathan Corbet, LWN, 2018. The whole article. It explains why the kernel marks pages clean after a failed write-back, so that retrying `fsync` cannot bring the data back.

### Build

1. Move `log.c` and the store onto the `Disk` interface: `log_open` takes a `Disk *` and a file name. Write `src/disk_posix.c` with the real calls and `src/disk_sim.c` with the simulation.
2. Write `src/kvsim.c`, the harness above. Run each seed with a workload of 200 operations: puts, deletes, overwrites and one merge, with the crash point anywhere in the run.
3. Add a mode that makes the n-th `disk_sync` fail. Check that the store refuses later puts and that its acknowledged puts survive a reopen.
4. Break the store on purpose three times and check that the harness catches each break: move the sync after the keydir update and the return, drop the directory sync after the merge's rename, and skip the CRC check on open.

### Done when

`kvsim` passes 100,000 seeds. After every seed that crashes inside a merge, the reopened store has no `data.tmp`. Each of the three deliberate bugs fails within the first 1000 seeds, and the failing seed replays to the same failure. You can state your store's failure model in three sentences: what a crash may do to the files, what the store promises for acknowledged puts, and what it promises for puts that were in progress.

## Pages and a buffer pool

The keydir holds every key in memory. That limits the store to keys that fit in RAM, and every open reads the whole file. A database keeps its index on disk instead, in fixed-size pages, and caches the pages it uses. This step builds the two layers under such an index: the page format and the cache.

A **page** here is a 4096-byte block of the file `data.db`, addressed by its **page number**. Page `n` lives at offset `n * 4096`. Page 0 describes the file and has a CRC of its own. All fields are little-endian, as in the log:

| offset | size | page 0 field |
| --- | --- | --- |
| 0 | 4 | magic number |
| 4 | 4 | format version |
| 8 | 4 | page size, 4096 |
| 12 | 4 | page count |
| 16 | 4 | root page number of the B+ tree |
| 20 | 4 | CRC-32 of bytes 0 to 19 |

Every other page starts with a 16-byte header:

| offset | size | page header field |
| --- | --- | --- |
| 0 | 1 | type: 1 for a leaf, 2 for an interior page |
| 1 | 1 | unused, zero |
| 2 | 2 | slot count |
| 4 | 2 | start of the record area |
| 6 | 2 | live record bytes |
| 8 | 4 | link: the next leaf of a leaf, or the rightmost child of an interior page, 0 for none |
| 12 | 4 | CRC-32 of the whole page, computed with this field set to zero |

Records of different lengths go into **slotted pages**. A **slot** is 4 bytes, the 2-byte offset and 2-byte length of one record. The slot array starts at offset 16 and grows toward the end of the page. The record bytes grow from the end of the page toward the front, and the header's record area field says where they start:

![A 4096-byte slotted page: the page header, then the slot array growing toward higher offsets, then free space, then the records growing down from the end of the page. Each slot holds the offset and length of one record.](figures/18-slotted-page.svg)

In the B+ tree of the next step the slots are kept sorted by key, so an insert moves 4-byte slots and never the records. Deleting a record removes its slot and leaves its bytes as a hole. SQLite tracks such holes in a chain. Your pages do something simpler:

- Keep the count of live record bytes in the page header.
- When a new record does not fit in the gap between the slots and the records, but the page's total free space would hold it, **compact** the page: copy the live records into a scratch buffer, write them back packed against the end, and fix every slot's offset.
- A page is full only when its total free space is too small.
- A record that grows is a delete followed by an insert.

The cache is the **buffer pool**: a fixed number of **frames** in memory, each the size of one page. A hash table maps a page number to its frame. The CMU notes call it the page table, which has nothing to do with the page tables of chapter 08. Each frame has a **pin count**, the number of callers using it, and a **dirty** bit, set when its page changed since it was read.

![The buffer pool: a table maps page numbers to frames, each frame has a pin count and a dirty bit, and the clock hand sweeps the frames. It skips pinned frames, gives a frame with its reference bit set a second chance, and evicts the first unpinned frame without one, writing it back first if it is dirty.](figures/18-buffer-pool.svg)

A caller fetches a page, which pins it, and unpins it when done, saying whether it changed the page. When the pool needs a free frame, it **evicts** an unpinned page, writing it back first if it is dirty. The **clock** policy picks which: each frame has a reference bit set on every fetch, and a hand sweeps the frames, clearing set bits and taking the first frame whose bit is already clear. Until the write-ahead log step, the write-back goes straight to `data.db`, which is not crash-safe.

### Study

- [CMU 15-445 Fall 2025: Database Storage I, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/03-storage1.pdf) (read, 30 min): Andy Pavlo's lecture notes. Read sections 6, 7 and 9, on pages 3 and 4. Section 7 says the device writes a hardware page atomically. Your simulated disk does not assume that, and SQLite does not either.
- [CMU 15-445 Fall 2025: Memory and Disk Management, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/04-bufferpool.pdf) (read, 45 min): Read section 2, "Why not use the OS?" in section 3, section 4 up to and including CLOCK, and "Dirty Pages". Then read the side note on `fsync` errors on the last page. Skip locks and latches, LRU-K and ARC.
- [SQLite: Database File Format, B-tree Pages](https://www.sqlite.org/fileformat.html#btree) (read, 20 min): Section 1.6, from the b-tree page header through the paragraph on defragmenting. Compare its fields with your own page header. Skip the cell formats and overflow pages after it.

### Build

1. Write `src/page.c`: functions that read and write the page header and slots of a 4096-byte buffer, all at the byte offsets of the tables above.
   - `slot_insert(page, index, rec, len)` calls `page_compact` when the gap is too small and fails only when the page's total free space is too small.
   - `slot_delete(page, index)` removes a slot.
   - `page_compact(page)` packs the live records against the end of the page.
   - `page_check(page)` verifies the CRC, that every slot lies inside the page and outside the header and slot array, and that the live byte count in the header matches the slots.
2. Write `src/pool.c` with `pool_fetch(pool, pgno)`, `pool_new(pool)`, `pool_unpin(pool, frame, dirty)` and `pool_flush(pool)`, on the `Disk` interface. Check the CRC of every page read from disk and set it on every page written.
3. Fuzz `page_check`, the slot functions and `page_compact` with libFuzzer, as in chapter 04: random bytes must never make them read outside the 4096-byte buffer. A second target runs random sequences of inserts and deletes on a valid page and checks after each one that `page_check` passes and that the records read back as written.

### Done when

A test with a pool of 8 frames writes 10,000 pages with known contents, reads them back in random order, and gets every byte right. Fetching a ninth page while all 8 frames are pinned returns an error. The pool never evicts a pinned page or drops a dirty one. The fuzzer runs for 10 minutes under ASan with no finding.

## A B+ tree on the buffer pool

The last step gave you pages that hold sorted records and a pool that caches them. This step builds the index on top of both. A **B+ tree** is a search tree whose nodes are pages:

- **Leaf** pages hold the keys and values, sorted, and the page number of the next leaf, so a range scan walks the leaves left to right.
- **Interior** pages hold **separator** keys and the page numbers of their children. The child between two separators holds the keys between them.
- All leaves sit at the same depth.

Both kinds of page use the slotted layout of the last step:

- A leaf record is the key length (2 bytes), the value length (2 bytes), the key and the value. The header's link field holds the next leaf.
- An interior record is the key length (2 bytes), a child page number (4 bytes) and the separator key. That child holds the keys below its separator and at or above the separator before it.
- The interior page's link field holds the rightmost child, which takes the keys at or above the last separator.

A lookup starts at the root and reads one page per level. An interior page holds over a hundred short separators, so three or four levels hold millions of keys.

![A lookup of key 55 in a two-level B+ tree: the root holds separators 40 and 80, 55 lies between them, so the lookup follows the middle child to the leaf that holds 40, 50, 55 and 60. The leaves are linked left to right.](figures/18-btree-lookup.svg)

An insert finds the leaf and adds the key in sorted position. If the leaf is full, it **splits**: a new page takes the upper half of the entries, and the first key of the new page is copied up into the parent as a separator. Your records have different lengths, so choose the split point by bytes. Walk the sorted entries, including the new one, and cut where the running total of record bytes first passes half. A split by entry count can leave one half too full for the record that caused it.

![A full leaf with 40, 50, 60 and 70 receives 55. It splits by bytes into a leaf with 40, 50 and 55 and a new leaf with 60 and 70, and the new leaf's first key, 60, is copied up into the parent as a separator.](figures/18-leaf-split.svg)

If the parent is full, it splits as well, and it pushes its middle key up instead of copying it. A root split makes a new root and the tree one level taller. Write the root's page number in page 0.

Keep deletion simple: remove the key from its leaf and leave the leaf underfull. The notes describe this choice under "Merge Threshold". Merging and borrowing between leaves are a stretch goal.

Test the tree against an oracle, a slow implementation that is obviously right, as chapter 07 tested every fast version against the slow one. Here the oracle is a sorted array. Run the same random operations against both and compare after each one. Also write a checker that walks the whole tree and verifies its **invariants**, the rules a correct tree always obeys:

- keys are sorted within each page
- each subtree stays within the bounds its parent's separators give it
- all leaves are at one depth
- the leaf chain visits every key in order
- every page is reachable exactly once

### Study

- [CMU 15-445 Fall 2025: Indexes and Filters I, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/08-indexes1.pdf) (read, 45 min): Read section 2 through "Deletion", then sections 3.1 to 3.4. Skip composite keys, duplicates, clustered indexes and section 4.
- [B+ Tree Visualization](https://www.cs.usfca.edu/~galles/visualization/BPlusTree.html) (do, 20 min): David Galles, University of San Francisco. Set "Max. Degree = 3", insert 1 to 20 and watch each split. Then predict the tree after each insert before you click.

### Build

1. Write `src/btree.c` on the buffer pool: `bt_get`, `bt_put` (insert or replace, with the page functions of the last step), `bt_del`, and a cursor with `bt_seek(key)` and `bt_next` for range scans. Allow keys up to 255 bytes and values up to 1000 bytes, so that every leaf holds at least three entries and a split always succeeds. Compare keys with `memcmp` on the shorter length, then by length.
2. Write `bt_check`, the invariant checker above.
3. Write `src/btfuzz.c`: one million random operations from a seed, 70% puts, 20% deletes and 10% range scans of up to 100 keys, against the sorted-array oracle, with a pool of 16 frames so that pages are evicted all the time. Run `bt_check` every 1000 operations and at the end.
4. Close the tree cleanly, reopen it from `data.db` and compare it with the oracle again.

### Done when

`btfuzz` passes for 20 seeds under ASan and UBSan. `bt_check` passes at every check. With 1 million keys of 16 bytes and values of 100 bytes the tree has 4 levels or fewer, and you computed the height from your page layout before you printed it.

## A write-ahead log and recovery

The tree writes a dirty page into `data.db` whenever the pool evicts it. A crash in the middle of a split can leave the new leaf on disk and the parent without its separator, and no rule can repair that afterwards. The fix is the one xv6 used in chapter 08 and SQLite uses: never change `data.db` except from a log that already holds the change. That rule is called **write-ahead logging**.

Your log holds whole page images, as SQLite's does, grouped by **transaction**: a batch of puts that becomes durable together. At **commit**, the store appends one **log frame** for each page the batch changed: a header with the page number and a checksum, then the 4096 bytes of the page. The last frame of the batch carries a commit mark. Then the store syncs the log and acknowledges the batch. The name log frame comes from SQLite and has nothing to do with the frames of the pool.

A batch starts with `kv_begin` and ends with `kv_commit`. A put counts as acknowledged only when `kv_commit` returns. A `kv_put` or `kv_del` outside `kv_begin` is a batch of one and commits before it returns. The crash harness records each acknowledgment at the commit, never at the put.

![Commit appends one frame per changed page to the WAL, the last one marked commit, and syncs the WAL. Recovery scans the WAL, keeps the frames up to the last commit mark, ignores the frames after it and builds the map from page number to newest frame. A checkpoint copies the newest frame of each page into data.db.](figures/18-wal.svg)

Two rules keep `data.db` consistent while the log grows:

- A page changed by the current batch stays dirty and pinned in the pool until commit. The CMU notes call this **no-steal**.
- After commit, a page's newest version lives in the log. An in-memory map from page number to the offset of its newest committed frame tells the pool where to read it, so the pool may drop the page and read it back from the log.

**Recovery** at open rebuilds the map. It scans the log while each frame's checksum is valid, keeps everything up to the last commit mark, and ignores the rest. SQLite's frame checksum is **cumulative**: each frame's checksum starts from the previous one, so a frame is valid only in its place, and a stray old frame after the end cannot pass.

In this step nothing writes `data.db` and the log grows without end. The next step adds the checkpoint that copies pages home. The figure shows it already.

`kv2` has no merge, because the B+ tree replaces the keydir and the log of records. Space freed inside a page is reused by later inserts into that page. Freed pages are never reused, so `data.db` only grows.

### Study

- [CMU 15-445 Fall 2025: Database Logging, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/21-logging.pdf) (read, 45 min): Read sections 1, 2, 6 and 7, and skim the older designs in sections 3 to 5. Section 2 defines steal and force. Your store is no-steal with respect to commits and no-force with respect to `data.db`. Transactions in the notes run concurrently, and yours run one batch at a time.
- [SQLite: Database File Format, The Write-Ahead Log](https://www.sqlite.org/fileformat.html#walformat) (read, 20 min): Read sections 4.1, 4.2 and 4.5. Copy the idea of the salts and the cumulative checksum. You may use your CRC-32 in place of SQLite's checksum. Leave 4.3 and 4.4 for the next step, and skip the wal-index in 4.6.

### Build

1. Write `src/wal.c` with `wal_open` (which runs recovery), `wal_append_frame`, `wal_commit` and `wal_lookup(pgno)`. The log header holds a magic number, the page size, a checkpoint sequence number, two random salts and a checksum. Each frame header holds the page number, the commit page count or zero, both salts and the cumulative checksum. The salts do their work in the next step.
2. Change the pool:
   - a dirty page cannot be evicted before commit
   - a page counts as clean once its frame is in the log, and a clean page is dropped on eviction
   - reads go to the log first
   - when a batch has dirtied half the frames in the pool, commit it early, but only between two puts. A commit in the middle of a split would log a tree with a separator missing.
3. Use a pool of at least 32 frames for the store. One put on a four-level tree can dirty about nine pages, and an early commit at half of a 16-frame pool would leave no room for the pages a lookup pins.
4. Build `src/kv2.c`, the same API as `kv.c` without `kv_merge`, with values limited to 1000 bytes, on the B+ tree and the log. Add `kv_begin` and `kv_commit`.
5. Run the crash harness against `kv2`, with batches of 1 to 20 puts and deletes, crashes during commits, and sync failures.

### Done when

`kvsim` passes 100,000 seeds against `kv2`. Acknowledging a batch before the log's sync makes the harness fail, and putting the sync back makes it pass. A unit test that appends frames of a batch with no commit mark, then reopens, finds none of them in the map.

## Checkpoints and group commit

The log from the last step grows with every commit, and recovery reads all of it. A **checkpoint** moves the committed pages home and lets the log start over:

1. Copy the newest frame of each page into `data.db`.
2. Sync `data.db`.
3. Reset the log.

A crash during steps 1 or 2 leaves `data.db` half updated with the log still complete. Recovery rebuilds the map from the log, and the next checkpoint copies the same pages again. Copying twice gives the same bytes, so a checkpoint can run any number of times.

The reset in step 3 has to be crash-safe as well. SQLite's log header holds two random **salts**, and every frame repeats them. The reset writes a new header with a higher checkpoint sequence number and new salts, in one write of a few dozen bytes at offset 0, and syncs the log. Your simulated disk tears writes only at 512-byte boundaries, so this write arrives whole or not at all. From then on every old frame fails the salt check and is unreachable, and later commits overwrite them from the start of the file.

A log whose header fails its checksum counts as empty. That is safe only because `data.db` was synced before the reset began. If you sync `data.db` after the reset, a crash between the two loses committed pages, and your harness should find that.

**Group commit** puts many puts behind one sync. Your store runs on one thread, so a group is one batch from `kv_begin` to `kv_commit`. Throughput rises with the batch size. So does the **latency** of a batch, the time from its `kv_begin` to the return of its `kv_commit`.

The **99th percentile** of the latencies is the value that 99% of the batches stay under. Measure throughput and this percentile, and look at where the time goes with `strace` and `perf stat` from chapters 07 and 08.

### Study

- [CMU 15-445 Fall 2025: Database Logging, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/21-logging.pdf) (read, 10 min): Section 8 "Checkpoints". Your checkpoint is the blocking kind, since only one batch runs at a time.
- [SQLite: Database File Format, Checkpoint Algorithm](https://www.sqlite.org/fileformat.html#checkpoint_algorithm) (read, 10 min): Read sections 4.3 and 4.4. Compare SQLite's two syncs in a checkpoint and its reset with yours.

### Build

1. Add `wal_checkpoint` and the reset. Checkpoint automatically when the log passes 1000 frames.
2. Run the crash harness against `kv2` with long workloads, so that seeds crash inside checkpoints and inside resets.
3. Measure puts per second and the 99th percentile batch latency for batch sizes 1, 16 and 256.
4. Run the batch size 1 benchmark under `strace -c -w` and under `perf stat -e task-clock`. Compare the time in `fsync` with the elapsed time, and compare `task-clock`, the CPU time, with the elapsed time.

### Done when

`kvsim` passes 100,000 seeds against `kv2`, including seeds that crash inside a checkpoint and inside a reset. Removing the sync of `data.db` before the log reset makes the harness fail, and putting it back makes it pass. You have throughput and latency for the three batch sizes. `perf stat` reports far less than one CPU utilized at batch size 1, and you can say from the `strace` table where the time of a commit goes.

## A TUN device and a packet dump

The storage half is finished. The rest of the chapter builds a TCP stack, and it needs a way to send and receive raw packets without a network card.

**IP**, the Internet Protocol, carries **packets**, blocks of bytes, from one address to another. Each packet starts with an **IPv4 header** that holds the two addresses. A TCP **segment** rides inside the packet, with its own header and then the data. Both protocols are defined in **RFCs**, the numbered standards documents of the Internet. RFC 791 defines IP.

The kernel sends and receives packets through **network interfaces**, such as `eth0`, WSL2's link to Windows. A **TUN device** is an interface whose other end is a file descriptor. When the kernel routes a packet to it, your program reads that packet from the descriptor. When your program writes a packet to the descriptor, the kernel receives it as if it came from a network.

![nc asks the kernel to connect to 10.20.0.2. The kernel's TCP sends a SYN out of tun0, your program reads the IP packet from the TUN descriptor and parses it, then writes a reply packet that the kernel receives on tun0 and hands to nc.](figures/18-tun-path.svg)

The TUN driver is a kernel module, like the ones you loaded with `insmod` in chapter 16. `modprobe` loads a module by name from the modules that came with the running kernel, so you need no `.ko` path. Current WSL kernels ship TUN as a module, and older ones have it built in, where there is nothing to load.

A **route** tells the kernel which interface to send a range of addresses to. You give the interface `tun0` the address 10.20.0.1, and `ip addr add` routes 10.20.0.0/24 to it. The `/24` says that the first 24 bits of an address name the network, so 10.20.0.0/24 covers 10.20.0.0 to 10.20.0.255.

The kernel then sends everything for 10.20.0.2 to your program, which plays the host 10.20.0.2. `nc`, `curl` and `tcpdump` in Ubuntu are your test peers. Keep this network inside WSL2, and never connect the stack to a real one.

Each `read` returns one whole packet, headers first. Every multi-byte field in IP and TCP is **big-endian**, as CHIP-8's opcodes were in chapter 06. A packet is untrusted input, so read each field by its byte offset after checking that the bytes exist:

![The IPv4 header and the TCP header drawn as rows of 4 bytes, with the byte offset of each row on the left and of each column on top. The fields your parser reads by offset are highlighted: IP bytes 0, 2, 6, 9, 12 and 16, and TCP bytes 0, 2, 4, 8, 12, 13, 14 and 16.](figures/18-packet.svg)

This step reads the IP header. The next one checks checksums and reads the TCP header.

### Study

- [Linux kernel documentation: Universal TUN/TAP device driver](https://docs.kernel.org/networking/tuntap.html) (reference, as needed): Section 3.1 "Network device allocation" for `tun_alloc`, and section 3.2 "Frame format" for what `IFF_NO_PI` removes. Section 2 explains why a device owned by your user needs no root to open. Skip multiqueue and the rest.
- [RFC 791: Internet Protocol](https://www.rfc-editor.org/rfc/rfc791#section-3.1) (read, 45 min): Section 3.1 "Internet Header Format", with the header layout in Figure 4. Skim the part on options. Your stack drops any packet with options or fragments, so you only need to recognize them. Skip the appendices.

### Build

1. Install tcpdump with `sudo apt install -y tcpdump`. `nc` and `curl` came with chapter 08's HTTP server.
2. Write `scripts/tun-up.sh`. It loads the TUN module if there is one, creates `tun0` owned by your user so that your program needs no root, gives it its address and brings it up. The last line turns off IPv6 on `tun0`, which would otherwise send IPv6 packets to your program. Creating a device that exists fails with "Device or resource busy", so the script stops early when `tun0` is already there:

   ```sh
   #!/bin/sh
   # Creates tun0 for the TCP stack. Safe to run more than once.
   set -e
   if ip link show tun0 >/dev/null 2>&1; then
       echo "tun0 is already up"
       exit 0
   fi
   sudo modprobe tun 2>/dev/null || true    # no module when TUN is built in
   sudo ip tuntap add dev tun0 mode tun user "$USER"
   sudo ip addr add 10.20.0.1/24 dev tun0
   sudo ip link set tun0 up
   sudo sysctl -w net.ipv6.conf.tun0.disable_ipv6=1
   ```

   Run `sh scripts/tun-up.sh` after each start of WSL.
3. Write `src/tun.c` with `tun_open("tun0")`, which opens `/dev/net/tun` and attaches to the device with the `TUNSETIFF` call from section 3.1, with `IFF_TUN | IFF_NO_PI`. Each `read` then returns exactly one packet.
4. Write `src/tundump.c`, which writes every packet it reads to `pkts/0001.bin`, `pkts/0002.bin` and so on. Run it, then `sudo tcpdump -i tun0 -n -vv` in a second terminal and `nc 10.20.0.2 7000` in a third. **tcpdump** prints every packet that crosses an interface:
   - Capturing packets needs root, which is why the command starts with `sudo`. Without it tcpdump says "You don't have permission to capture".
   - `-i tun0` picks the interface, and `-n` prints addresses and ports as numbers.
   - `-v` and `-vv` print more of each header and verify the checksums. A broken IP header shows `bad cksum`, and the TCP part shows `cksum 0x...` followed by `(correct)` or `(incorrect -> 0x...)`.

   `nc` waits for an answer that never comes and sends the SYN again, so stop it with Ctrl-C after a few seconds and run it a few times.
5. Write `src/ip.c` with `parse_ipv4(p, n, &hdr)`. Check that the version is 4, that the header length is at least 20 bytes and fits inside the total length, and that the total length is no larger than what was read. Then drop fragments and any protocol other than 6, TCP. Return the offset and length of the TCP segment.
6. Write a test that runs the parser on every saved packet and on every truncation of each one.

> **If it fails:** If `ip tuntap add` fails, run `ls -l /dev/net/tun`. If the file does not exist, update WSL with `wsl --update` in PowerShell, then `wsl --shutdown`, and open Ubuntu again.

> **If it fails:** If `ip addr` shows another interface already inside 10.20.0.0/24, pick another network, such as 10.21.0.0/24, and use it everywhere in this chapter.

### Done when

Running `sh scripts/tun-up.sh` twice in a row succeeds both times. `tcpdump` shows each SYN from `nc` as `Flags [S]`, with the options `mss 1460`, `sackOK`, `TS` and `wscale`, and `pkts/` holds one file per packet. The parser accepts every saved packet and rejects every truncation of it.

## Checksums, TCP headers and a reset

The parser of the last step trusts every byte it reads. This step checks the checksums, reads the TCP header and sends the stack's first packet, a reset.

IP and TCP protect their headers with the **Internet checksum**, a 16-bit sum of the header's 16-bit words with the carries added back in, then inverted:

```c
uint32_t csum_add(uint32_t sum, const uint8_t *p, size_t n) {
    for (size_t i = 0; i + 1 < n; i += 2)
        sum += (uint32_t)p[i] << 8 | p[i + 1];
    if (n & 1)
        sum += (uint32_t)p[n - 1] << 8;
    return sum;
}

uint16_t csum_fold(uint32_t sum) {
    while (sum >> 16)
        sum = (sum & 0xFFFF) + (sum >> 16);
    return (uint16_t)~sum;
}
```

`csum_add` adds big-endian 16-bit words into a 32-bit sum, padding an odd last byte with zero. `csum_fold` adds the carries back into the low 16 bits and inverts the result. To verify a received header, sum all of it including the checksum field, and the folded result is 0. To fill in a checksum, set the field to zero, sum, and store the folded result. The TCP checksum also covers a 12-byte **pseudo-header** of the two IP addresses, the protocol number and the TCP length, added with one more `csum_add` call.

A TCP header carries **flags**, single bits in byte 13 that say what the segment does:

- SYN opens a connection.
- ACK says the acknowledgment number is valid.
- FIN closes one direction.
- RST, a **reset**, refuses or aborts a connection.

After the 20 fixed bytes come the **options**, up to 40 bytes. Each option starts with a kind byte. Kind 0 ends the list, kind 1 is a single padding byte, and every other kind has a length byte next. Your stack keeps only the MSS option, which the next step explains.

Your stack's first reply is a reset. RFC 9293 says what a host does with a segment for a connection that does not exist. To a SYN it answers RST and ACK, and the acknowledgment number is the SYN's sequence number plus one, because TCP numbers the SYN as if it were one byte. The next step explains the numbering. `nc` then reports "Connection refused" at once.

Every reply needs an IP header of its own. Send version 4, header length 5, no options, type of service 0, ID 0, the "don't fragment" flag set (bytes 6 and 7 are `0x40 0x00`), TTL 64 and protocol 6. Put the addresses of the packet you answer in swapped places, then compute both checksums as above.

### Study

- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293#section-3.1) (read, 1 h): Read section 3.1 with Figure 1 and the IPv4 pseudo-header in Figure 2, and section 3.2 up to 3.2.1. In 3.5.2 "Reset Generation", read the first group only. Then read 3.10.7.1 "CLOSED STATE".

### Build

1. Add the header checksum check to `parse_ipv4`.
2. Write `parse_tcp(p, n, &ip, &seg)`. Check that the data offset is at least 5 words and fits, and that the checksum with the pseudo-header is valid. Walk the options: every option with a length byte needs a length of at least 2 that stays inside the header. Record the MSS option (kind 2, length 4) and skip the others.
3. Run the truncation test again with both parsers. Run them under libFuzzer for 10 minutes, with the saved packets as the seed corpus.
4. Write `src/tcpstack.c`, version 0: read packets in a loop, parse them, print one line per TCP segment, and answer every SYN with RST and ACK as section 3.10.7.1 says, in an IP header built as above.

### Done when

The parsers accept every captured packet, reject every truncation, and survive the fuzzer under ASan. `nc -v 10.20.0.2 7000` prints "Connection refused" at once. `tcpdump -vv` prints your reset as `Flags [R.]`, with no `bad cksum` on the IP header and with `cksum ... (correct)` on the TCP header.

## Sequence numbers and the handshake

Version 0 answers every SYN with a reset. This step makes the stack accept the connection, which means keeping state for each connection and numbering bytes.

A TCP connection is two byte streams, one in each direction. Every byte has a 32-bit **sequence number**, and the SYN and the FIN each take one number as well. A segment's sequence number is the number of its first byte. Its **acknowledgment number** says "I have every byte before this one".

![One connection with its sequence numbers. The peer's SYN carries seq x, and your SYN-ACK carries seq y and ack x+1, because the SYN takes one number. Five data bytes from x+1 are acknowledged with x+6, the peer's FIN takes x+6 and is acknowledged with x+7, and your FIN takes y+1 and is acknowledged with y+2. Your stack's state is on the right.](figures/18-handshake.svg)

The opening exchange of SYN, SYN-ACK and ACK is the **three-way handshake**. Each side picks its own first number. Your SYN-ACK starts from a random **initial sequence number**, taken from `getrandom`, the system call that gave you random test data in chapter 07.

Each side keeps a few variables per connection, the **transmission control block**. For the handshake you need three:

- `SND.UNA`, the oldest byte you sent that is not yet acknowledged
- `SND.NXT`, the next sequence number you send
- `RCV.NXT`, the next sequence number you expect from the peer

After your SYN-ACK, `SND.UNA` is y and `SND.NXT` is y+1. The peer's ACK with ack y+1 moves `SND.UNA` to y+1, and the connection is **ESTABLISHED**.

Sequence numbers wrap around after 2^32 bytes. Compare them by the sign of the difference, never with `<` directly:

```c
static bool seq_lt(uint32_t a, uint32_t b) { return (int32_t)(a - b) < 0; }
```

The unsigned subtraction wraps as well, so when `a` comes a little before `b`, `a - b` is a huge unsigned number that reads as a small negative one once cast to `int32_t`.

Linux's SYN carries four options: MSS, SACK-permitted, timestamps and window scaling. The **MSS**, maximum segment size, is the most data the sender accepts in one segment, 1460 bytes on `tun0`. Send only the MSS option back, and Linux then uses none of the others on the connection.

A RST that arrives in SYN-RECEIVED sends that connection back to LISTEN, as RFC 9293 says. Your stack keeps one table entry per connection and a listener apart from them, so it frees the entry, and the listener stays.

### Study

- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293#section-3.3) (read, 1 h 45 min): Read 3.3 with Figures 3 to 5, 3.4 up to 3.4.1, and 3.5 with Figure 6. Skip 3.4.2, 3.4.3 and 3.5.1. In 3.5.2 "Reset Generation", read the second group. Keep 3.10.7.2 "LISTEN STATE" and the SYN-RECEIVED cases of 3.10.7.4 open while you code.
- [tcpdump(1) man page](https://www.tcpdump.org/manpages/tcpdump.1.html) (reference, as needed): The options `-n`, `-v`, `-vv` and `-S`, and the TCP part of OUTPUT FORMAT, which explains the relative sequence numbers tcpdump prints by default.

### Build

1. Add a connection table to `tcpstack.c`, keyed by the two addresses and the two ports, with one transmission control block per connection.
2. Listen on port 7000. A SYN creates an entry in SYN-RECEIVED and gets a SYN-ACK with your initial sequence number, the acknowledgment x+1 and the MSS option. Any other segment for an unknown connection still gets a RST.
3. Move the entry to ESTABLISHED on the ACK of your SYN-ACK, and free it on a RST.
4. Log every received segment and every state change as one line, with sequence numbers relative to the initial ones, so you can read the log next to `tcpdump`.
5. Write a unit test for `seq_lt` with numbers on both sides of the wrap, such as `0xFFFFFFF0` and 5.

### Done when

`nc -v 10.20.0.2 7000` prints a line that starts with "Connection to 10.20.0.2 7000 port" and ends with "succeeded!". Your log shows SYN-RECEIVED, then ESTABLISHED. The three lines of `tcpdump -i tun0 -n` for the SYN, the SYN-ACK and the ACK match three lines of your log. When you stop `nc`, the kernel sends its FIN again and again, because nothing answers it yet. The next step does.

## Data, window and close

The connection is open, and nothing flows yet. This step carries data both ways, limits it to what each side has room for, and closes the connection.

Each side tells the other how much it can take. The **window** is that amount in bytes, counted from the acknowledgment number. Two more variables join the transmission control block:

- `SND.WND`, the window the peer advertised: you may send up to `SND.UNA + SND.WND`
- `RCV.WND`, the free space in your receive buffer, which you advertise in every segment

![The send sequence space: bytes before SND.UNA are acknowledged, bytes from SND.UNA to SND.NXT are sent and not yet acknowledged, bytes from SND.NXT to SND.UNA plus SND.WND may be sent now, and later bytes must wait. On the receive side, bytes before RCV.NXT have arrived in order, and the window of RCV.WND bytes after it may be accepted.](figures/18-seq-space.svg)

Both buffers are **rings**: fixed arrays where the write position wraps from the end back to the start, with a read position chasing it. A byte's place in the ring is its sequence number modulo the ring size, so the ring and the sequence space line up.

In ESTABLISHED, every arriving segment first passes the acceptability test of section 3.4, which checks that it overlaps the receive window. Then its ACK field advances `SND.UNA` and frees that much of the send ring. Then data that starts exactly at `RCV.NXT` goes into the receive ring, and the stack answers with an ACK. This version drops segments that arrive out of order and lets the peer send them again.

Advertise a window of at most 65535 bytes, the largest value without window scaling, and send no segment larger than the peer's MSS.

Your stack is the server side, and it closes along one path through the states of RFC 9293:

![The server's path through TCP's states. LISTEN receives a SYN and answers SYN-ACK, moving to SYN-RECEIVED. The ACK of that SYN-ACK moves it to ESTABLISHED. The peer's FIN is acknowledged and moves it to CLOSE-WAIT. The application closes, which sends a FIN and moves it to LAST-ACK, and the ACK of that FIN moves it to CLOSED. A RST in SYN-RECEIVED or any later state frees the connection's table entry at once, and the listener stays.](figures/18-tcp-states.svg)

The side that sends the first FIN takes the other path, through FIN-WAIT and TIME-WAIT. Both applications in this chapter wait for the peer's FIN before they close, so you can leave those states and SYN-SENT out. An application that has to give up on a peer aborts with a RST, which needs no extra state.

Give the stack a small application interface in place of sockets, with events like those of chapter 08's event loop: data received, room to send, peer closed, connection reset. The echo server of this step and the file server of the last step are written against it.

### Study

- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293#section-3.6) (read, 1 h): Read 3.6 and 3.6.1, following case 2, where the remote side closes first. Read 3.8.6 up to 3.8.6.1, and the third group of 3.5.2 "Reset Generation". Keep 3.10.7.4 "Other States" open while you code, and skip 3.10.7.3.

### Build

1. Give each connection a 64 KB receive ring and a 64 KB send ring.
2. Implement in-order receive with acknowledgments, sending within the peer's window and MSS, the passive close and RST handling in every state.
3. Write an echo application on the interface: everything received is sent back, and a peer close is answered with your own close once the send buffer is empty.
4. Write `tests/echo.sh N`: N connections in a row with `nc -N 10.20.0.2 7000`, each sending a random file of 1 byte to 1 MB and comparing the echo with `cmp`. `-N` makes `nc` close its sending side when its input ends.
5. Write a unit test that passes a saved segment with an old sequence number to your receive function.

### Done when

`tests/echo.sh 100` passes, and after it every connection in your table is CLOSED and freed. For one connection you can match each line of `tcpdump -i tun0 -n` with a line of your log, from the SYN to the last ACK. In the unit test, the old segment produces an ACK and changes no state.

## Retransmission and out-of-order receive

On a link that never loses packets the last step's stack works. Real links lose packets, and yours will too once you add a **loss injector** at the point where the stack reads from and writes to the TUN device. With a seeded random generator, it drops a chosen percentage of the packets in each direction. From then on every byte you send needs a timer, and every gap in what you receive needs a buffer.

The sender keeps sent bytes in its send ring until they are acknowledged. If no ACK comes within the **retransmission timeout** (RTO), it sends the oldest unacknowledged segment again and doubles the timeout. RFC 6298 sets the RTO from the **round-trip time** (RTT), the time from sending a segment to receiving its ACK:

- Measure the RTT of one segment at a time, and keep a smoothed average and a variance.
- Set the RTO from both. Rule 2.4 asks for a minimum of one second. Linux uses 200 ms, and so can your stack, or the loss tests take hours.
- Never take a sample from a segment that was sent twice, because its ACK cannot say which copy it answers. This is **Karn's algorithm**.
- Your SYN-ACK and your FIN need the same timer.

![Two ways a sender finds a lost segment. On the left, segment 2 is lost, no ACK comes back, and the retransmission timer fires and resends it. On the right, segment 2 is lost but 3, 4 and 5 arrive, each answered by a duplicate ACK for 2, and the third duplicate makes the sender resend 2 at once.](figures/18-retransmit.svg)

The receiver stops dropping out-of-order segments. It keeps them in the receive ring at their offset from `RCV.NXT`, tracks which ranges it holds, and moves `RCV.NXT` forward when the gap fills. It answers each out-of-order arrival with an ACK for `RCV.NXT`, a **duplicate ACK** that tells the sender something is missing. The left side of the figure is what this step builds. The right side is fast retransmit, which the last step adds.

One lost ACK can still stall a connection forever. When the peer advertises a window of zero, your sender stops. The ACK that later opens the window carries no data, so nobody retransmits it, and if the injector drops it both sides wait forever. RFC 9293 handles this with **zero-window probes**: while the window is zero and data is queued, send one byte after one RTO, and keep probing with the interval doubled each time. The peer answers each probe with an ACK that carries its current window.

The stack needs a clock now. Run it on the event loop from chapter 08: wait on the TUN descriptor with a timeout equal to the time until the earliest timer, then handle packets and expired timers.

### Study

- [RFC 6298: Computing TCP's Retransmission Timer](https://www.rfc-editor.org/rfc/rfc6298#section-2) (read, 30 min): Read section 2 with rules 2.1 to 2.5, section 3, and section 5 with rules 5.1 to 5.7. Skip section 4 on clock granularity.
- [RFC 9293: Zero-Window Probing](https://www.rfc-editor.org/rfc/rfc9293#section-3.8.6.1) (read, 10 min): Section 3.8.6.1 only. Stop at 3.8.6.2 on silly window syndrome.

### Build

1. Add the loss injector, with a seed and a percentage per direction set from the command line.
2. Add retransmission per RFC 6298, including the SYN-ACK and the FIN, and move the stack onto the event loop with timers.
3. Add out-of-order buffering on the receive side, with duplicate ACKs.
4. Add the persist timer: when `SND.WND` is 0 and data is queued, probe with one byte at the RTO, doubling the interval after each probe, and stop when an ACK opens the window.
5. Log every retransmission, every probe and every RTT sample with a timestamp.

> **Optional:** Linux can drop packets on its side as well. `sudo modprobe sch_netem` loads the network emulator, and `sudo tc qdisc add dev tun0 root netem loss 5%` drops 5% of the packets the kernel sends to your stack. `sudo tc qdisc del dev tun0 root` removes it. netem is a module in WSL kernels from 6.6 on. Unlike your injector, netem takes no seed, so a failure under it does not replay.

> **If it fails:** If `modprobe sch_netem` finds no module, run `uname -r`. A version that starts with 5.15 has no netem. Run `wsl --update` in PowerShell to get a newer kernel, or test with your own injector only.

### Done when

`tests/echo.sh 20` passes with 5% loss in each direction. Each lost segment costs at least one 200 ms timeout until the next step adds fast retransmit, so expect a few minutes for the 20 connections. `tests/echo.sh 100` still passes with no loss.

With a 10 MB file, `nc -N 10.20.0.2 7000 < big.bin | (sleep 5; cat) > out` finishes, `cmp` finds `out` equal to `big.bin`, and your log shows the peer's window at zero and your probes going out. If the window never reaches zero, use a larger file. You can point to the place in your log where Karn's algorithm skipped a sample.

## Congestion control and a file server

The stack now delivers every byte, but it sends as much as the peer's window allows, however much the path loses. A link that gets more packets than it can carry drops some, and every connection that uses it loses data. **Congestion control** limits how much a sender puts in flight, the bytes sent and not yet acknowledged. Your test link has no queue that fills, so the injector's random loss stands in for congestion. The sender cannot tell the two apart, and it reacts to both the same way.

The sender keeps a **congestion window**, `cwnd`, and keeps in flight no more than the smaller of `cwnd` and the peer's window. RFC 5681 grows and shrinks it in phases:

- **Slow start** begins at a few segments and grows `cwnd` by one segment for each ACK, which doubles it every round trip.
- Slow start ends at the threshold `ssthresh`. Its first value is as high as you like, and RFC 5681 suggests the largest window the peer can advertise, 65535 bytes here. A loss is what brings it down.
- Above `ssthresh`, **congestion avoidance** grows `cwnd` by about one segment per round trip.
- A timeout sets `ssthresh` to half the data in flight and drops `cwnd` to one segment, so slow start begins again.

![The congestion window over time: slow start doubles it each round trip up to ssthresh, congestion avoidance then grows it by one segment per round trip, three duplicate ACKs halve it, and a timeout drops it to one segment and starts slow start again toward the new, lower ssthresh.](figures/18-cwnd.svg)

Waiting for a timeout after every lost segment is slow, even at 200 ms. **Fast retransmit** uses the duplicate ACKs of the last step instead: the third duplicate ACK for the same byte makes the sender resend that segment at once and halve `cwnd`. **Fast recovery** then lets new data flow while the resent segment is on its way.

RFC 5681 ends fast recovery at the first ACK for new data. At 5% loss a window often loses two segments or more, and that first ACK covers only part of the window. RFC 6582, **NewReno**, calls it a **partial ACK**. The sender resends the next missing segment at once and stays in fast recovery until everything that was in flight when recovery began is acknowledged. Without that rule, each further loss in the window waits for a timeout.

The application on top is a file server. It answers `GET /<name>` with the HTTP/1.1 subset from chapter 08: a status line, `Content-Length`, `Connection: close` and the body. Then it waits. curl reads `Content-Length` bytes and closes its end, and your stack takes the passive close you wrote for the echo server. If no FIN arrives within 10 seconds after the last byte is acknowledged, the server aborts the connection with a RST.

### Study

- [RFC 5681: TCP Congestion Control](https://www.rfc-editor.org/rfc/rfc5681#section-2) (read, 40 min): Read sections 2, 3.1 and 3.2. Skip section 4.
- [RFC 6582: The NewReno Modification to TCP's Fast Recovery Algorithm](https://www.rfc-editor.org/rfc/rfc6582#section-3) (read, 15 min): Read 3.1 and steps 1 to 4 of 3.2, with full and partial acknowledgments under step 3. Skip section 4 and later.

### Build

1. Add slow start and congestion avoidance per RFC 5681 section 3.1.
2. Add fast retransmit and fast recovery per section 3.2, with the NewReno changes of RFC 6582 section 3.2: the `recover` variable, full ACKs and partial ACKs.
3. Log `cwnd` and `ssthresh` with a timestamp on every change.
4. Write the file server on the stack's interface, listening on port 8080, that answers `GET /<name>` with a file from one directory as described above. Answer anything else with 400 or 404, closed the same way.

### Done when

With 5% loss in both directions, 10 runs of `curl -o out http://10.20.0.2:8080/big.bin` for a 10 MB file all finish, and `sha256sum` of each output matches the original. Every connection ends through CLOSE-WAIT and LAST-ACK, with no RST from the 10-second timeout. You have the download time at 0%, 1% and 5% loss. The `cwnd` log of one 5% run shows slow start, the halving at each fast retransmit, partial ACKs that keep the sender in fast recovery, the drop to one segment at each timeout and the linear growth in between.

## Where this leads

You have built a store that keeps every acknowledged write through any crash your simulated disk can produce, with a checksummed log, a B+ tree on a buffer pool, and checkpoints that can run any number of times. You have also built a TCP that a Linux kernel accepts as a peer, keeps its byte stream intact through lost and reordered packets, and backs off when the path loses data.

Both live on one machine, and one machine can die. If the laptop's drive fails, every acknowledged put goes with it, however carefully you synced. The answer is to keep copies on several machines, which raises a new problem: the copies must agree on the order of the writes, even when machines crash and messages are lost.

Chapter 19, Replication with Raft, solves that problem with the Raft consensus algorithm. It starts small: three copies of your `kv.c` store apply one list of commands and end in the same state, which is the idea Raft is built on. Then you write Raft's rules in C as code that only reacts to messages and clock ticks, and a simulator drives three or five copies of it with a seeded schedule of dropped messages, partitions and crashes, as your simulated disk drove the store. Each copy keeps Raft's log and state with your `log.c` on the `Disk` interface.

Nothing in this chapter serves the store over the network. Chapter 19 does that last: once the simulator passes, the same Raft code runs in three processes that talk over TCP on the event loop of chapter 08, and clients send them puts, gets and deletes.
