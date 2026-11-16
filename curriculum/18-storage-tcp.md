---
id: 18
title: Storage and network internals
part: Storage, networks and real codebases
weeks: 8
project: A key-value store with a checksummed log, crash tests on a simulated disk, a B+ tree on a buffer pool and a page-level write-ahead log, then a userspace TCP over a Linux TUN device that serves a file to curl through 5% packet loss.
---

Chapter 17 ended with firmware that forgets everything at power-off and talks over a serial line with no protocol on it. This chapter takes on both gaps with code you have used for years from the outside. A database keeps data across crashes. A TCP stack moves bytes across a network that drops, duplicates and reorders packets. You build a small version of each in C.

The storage half starts with the simplest store that survives a crash: one append-only file of checksummed records and a hash table in memory, the design of Bitcask. Then you write a simulated disk that loses unsynced writes, tears them and fails `fsync`, and a harness that crashes the store at every write and checks what comes back. With that harness in place you replace the in-memory index with pages on disk: a buffer pool, a B+ tree on top of it, and a write-ahead log of page images in the style of SQLite. From the write-ahead log on, the same crash tests check the page-based store.

The network half runs in the Linux VM. A TUN device hands your program the raw IP packets that the kernel routes to an address, and takes your replies. You parse IPv4 and TCP headers, answer with resets, then write the TCP state machine from RFC 9293 until `nc` and `curl` on the same machine talk to your stack as to any other host. The last step adds retransmission and congestion control, and drops packets on purpose to prove they work.

You lean on four earlier chapters. Chapter 04 gave you the arena, the hash trie, byte-level parsing and libFuzzer. Chapter 07 gave you the repetition tester. Chapter 08 gave you `fork`, `kill` and pipes from the shell, xv6's logging layer, sockets, the event loop and the HTTP subset. The chapter does not cover SQL, concurrent transactions, `O_DIRECT`, `io_uring` or IPv6. Each is a separate subject, and none of them changes how durability or TCP works.

## A log that survives a crash

Chapter 08 showed you xv6's log: write the blocks to the log area, write a commit block, then copy the blocks home. There the log protects data that lives elsewhere on the disk. Bitcask keeps the data only in the log. Every `put` appends one record to the end of a file. An in-memory hash table, the keydir, maps each key to the file offset of its newest record. A `get` is one hash lookup and one `pread`. A delete appends a tombstone record. On startup the store reads the file from the start and rebuilds the keydir.

Give each record a fixed header and write its fields one byte at a time in little-endian order, with shifts and masks. Never `write` a C struct to disk. Chapter 02 showed you the padding the compiler puts inside one, and its layout can change with the compiler and the flags.

```
  0       4       8       12      16           16+klen
  +-------+-------+-------+-------+------------+--------------+
  | crc   | seq   | klen  | vlen  | key bytes  | value bytes  |
  +-------+-------+-------+-------+------------+--------------+
  crc: CRC-32 of every byte after the crc field
  vlen 0xFFFFFFFF: tombstone, no value bytes follow
```

A crash can stop the file at any byte. On open, read records until one fails a check: the header does not fit in the file, `klen` or `vlen` is larger than your limits, the record runs past the end, or the CRC does not match. Treat the first failing record as the end of the log, cut the file there with `ftruncate`, and `fsync`. A bad record followed by good ones means the disk corrupted data, which is outside this chapter's failure model. Report it and stop. CRC-32 is eight lines:

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

`crc32("123456789", 9)` must return `0xCBF43926`. Test that first.

`write` returns when the bytes are in the kernel's page cache. A crash of the process keeps them, because the kernel still has them. A crash of the machine loses them. `fsync` returns after the device reports the data stored. A `put` is acknowledged at the moment it returns success to the caller, so the order inside `put` is: append the record, `fsync`, update the keydir, return. On the Mac, `fsync` hands the data to the drive without flushing the drive's own cache. `fcntl(fd, F_FULLFSYNC)` does the flush. Read `man 2 fsync` and `man 2 fcntl` on the Mac for the details, and measure both.

The file keeps every old version of every key. Bitcask's merge writes the live records to a new file and swaps it in. The swap uses the pattern from OSTEP: write the new file, `fsync` it, `rename` it over the old name, then `fsync` the directory so that the rename itself reaches the disk. To sync a directory, open it with `open(dir, O_RDONLY)` and call `fsync` on that descriptor.

### Study

- [Bitcask: A Log-Structured Hash Table for Fast Key/Value Data](https://riak.com/assets/bitcask-intro.pdf) (read, 30 min): Justin Sheehy and David Smith, Basho, 2010. All six pages. Pages 2 to 4 are the design: the entry format, the keydir, merging and hint files. The API on page 6 is in Erlang, and you only need its shape. Hint files are optional here.
- [OSTEP chapter 39: Interlude: Files and Directories](https://pages.cs.wisc.edu/~remzi/OSTEP/file-intro.pdf) (read, 25 min): Sections 39.7 "Writing Immediately With fsync()" and 39.8 "Renaming Files", pages 12 to 14. Skip the aside on `mmap` and persistent memory.
- [Linux man page: fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html) (reference, as needed): DESCRIPTION for what is flushed and the note on the directory entry, and ERRORS for EIO.

### Build

1. Write `src/kv.h` and `src/kv.c` with `kv_open(dir)`, `kv_put`, `kv_get`, `kv_del`, `kv_merge` and `kv_close`. Keys are 1 to 255 bytes, values 0 to 64 KB. Use one data file. Keep the keydir in your chapter 04 hash trie, with the keys copied into an arena.
2. Handle short writes from `write` in a loop, and treat any error from `write` or `fsync` as fatal for the store: return an error and refuse further puts until it is reopened. Step 2 explains why a failed `fsync` cannot be retried.
3. On open, scan, truncate a bad tail, and `fsync` both the file and the directory when the file is new or was cut.
4. `kv_merge` writes the live records to `data.tmp`, syncs it, renames it to `data`, and syncs the directory.
5. Write `src/kvcrash.c`, a process crash test. The parent forks a writer that puts random keys in a loop and writes the key and sequence number of each acknowledged put to a pipe. The parent sends `SIGKILL` after a random delay between 1 and 200 ms, reads the pipe, reopens the store and checks that every acknowledged put is present with its value or a newer one.
6. Measure puts per second for 100-byte values with the repetition tester from chapter 07, in three modes: no sync, `fsync`, and on the Mac `F_FULLFSYNC`. Run the same test in the Linux VM, where `fsync` reaches a virtual disk.

### Done when

`kvcrash` passes 1000 rounds in a row on both machines. A file cut at every byte offset of its last record opens cleanly and keeps every record before it. You have three puts-per-second numbers per machine, and you can say why `F_FULLFSYNC` is slower than `fsync` on the Mac. `kvcrash` kills a process while the kernel keeps running, so it has not tested a power cut. You can say which writes a power cut could lose that `SIGKILL` cannot.

## Crash tests on a simulated disk

`SIGKILL` leaves the page cache intact, so it never loses an unsynced write, never tears a write in half and never makes `fsync` fail. Pulling the power does all three, and pulling it a thousand times is not practical. The SQLite developers test their commit protocol with a fake file layer that simulates these failures, and they report that it found bugs that reading the code did not. You build the same thing for your store.

Put every file operation the store makes behind a small interface:

```c
typedef struct Disk Disk;
int  disk_open(Disk *d, const char *name, bool create);   // file handle or -1
int  disk_pwrite(Disk *d, int f, const void *buf, size_t n, uint64_t off);
int  disk_pread(Disk *d, int f, void *buf, size_t n, uint64_t off);
int  disk_sync(Disk *d, int f);
int  disk_truncate(Disk *d, int f, uint64_t size);
int  disk_rename(Disk *d, const char *from, const char *to);
int  disk_sync_dir(Disk *d);
```

One implementation calls the real system calls. The other keeps every file in memory twice: the bytes the program sees, and the bytes that are durable. A sync copies the first to the second. The names in the directory work the same way, with `disk_sync_dir` making a rename durable. The simulated disk counts operations, and when the count reaches a chosen crash point it crashes. A crash starts from the durable bytes and applies a random subset of the unsynced writes in random order. It may tear the last one at a 512-byte boundary, and it may leave garbage in bytes that were appended but not synced. Seed all choices from one number, so a failing seed replays the same crash. Chapter 06's xorshift32 is enough.

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

The harness can also make `disk_sync` fail. When `fsync` fails on Linux, the kernel may mark the failed pages clean and drop the error, so a second `fsync` can return success with the data lost. A store that retries the call can acknowledge writes it does not have. Stop the store on the first failure, and let recovery decide what survived.

### Study

- [Files are hard](https://danluu.com/file-consistency/) (read, 45 min): Dan Luu, 2015. "Crash Consistency" and "Filesystem semantics". They follow one small update through each missing `fsync` and show which file system reorders what. Skim "Filesystem correctness" and "Error recovery", which cover disks and file systems that fail and that you do not need to simulate.
- [SQLite: Atomic Commit In SQLite](https://www.sqlite.org/atomiccommit.html#hardware) (read, 30 min): Section 2, "Hardware Assumptions", section 6.2, "Dealing With Garbage Written Into Journal Files", section 8, "Testing Atomic Commit Behavior", and section 9.2, "Incomplete Disk Flushes". These state the failure model your simulated disk implements. Skip the rollback journal in sections 3 to 5. Your store uses a different design.

### Build

1. Move the store onto the `Disk` interface. Write `src/disk_posix.c` with the real calls and `src/disk_sim.c` with the simulation.
2. Write `src/kvsim.c`, the harness above. Run each seed with a workload of 200 operations: puts, deletes, overwrites and one merge, with the crash point anywhere in the run.
3. Add a mode that makes the n-th `disk_sync` fail, and check that the store refuses later puts and that its acknowledged puts survive a reopen.
4. Break the store on purpose three times and check that the harness catches each break: move the `fsync` after the keydir update and the return, drop the directory sync after the merge's rename, and skip the CRC check on open.

### Done when

`kvsim` passes 100,000 seeds. Each of the three deliberate bugs fails within the first 1000 seeds, and the failing seed replays to the same failure. You can state your store's failure model in three sentences: what a crash may do to the files, what the store promises for acknowledged puts, and what it promises for puts that were in progress.

## Pages and a buffer pool

The keydir holds every key in memory. That limits the store to keys that fit in RAM, and every open reads the whole file. A database instead keeps its index on disk, in fixed-size pages, and caches the pages it uses. This step builds the two layers below the index: the page format and the buffer pool.

A page is 4096 bytes, addressed by its page number. Page `n` lives at offset `n * 4096` in `data.db`. Page 0 is a header page: a magic number, a format version, the page size, the page count and the number of the B+ tree's root page. Every page starts with a small header of its own: its type, a count, and a CRC of the page.

Records of different lengths go into slotted pages. The slot array grows from the front of the page, the record bytes grow from the back, and the page is full when the two meet:

```
  +--------+----------------------+---------- free ---------+-----------------+
  | header | slot 0 | slot 1 | .. |                         | rec 1 | rec 0   |
  +--------+----------------------+-------------------------+-----------------+
            each slot: 2-byte offset and 2-byte length of one record
```

In the B+ tree of the next step the slots are kept sorted by key. Inserting a record moves 4-byte slots, never the records themselves. SQLite's b-tree pages use the same layout with a cell pointer array, and its file format document is a real example to compare yours against.

The buffer pool holds a fixed number of frames, each the size of one page. A page table maps a page number to its frame. Each frame has a pin count and a dirty bit. Callers fetch a page, which pins it, and unpin it when done, saying whether they changed it. When the pool needs a frame it evicts an unpinned page chosen by the clock policy, and writes it back first if it is dirty. Until step 5 that write goes straight to `data.db`, which is not crash-safe. Step 5 fixes it.

### Study

- [CMU 15-445 Fall 2025: Database Storage I, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/03-storage1.pdf) (read, 30 min): Andy Pavlo's lecture notes. Sections 6 "File Storage", 7 "Database Pages" and 9 "Page Layout", pages 3 and 4. Section 7 says the device writes a hardware page atomically. Your simulated disk does not assume that, and SQLite does not either.
- [CMU 15-445 Fall 2025: Memory and Disk Management, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/04-bufferpool.pdf) (read, 45 min): Section 2 "Buffer Pool", "Why not use the OS?" in section 3, and section 4 "Buffer Replacement Policies" up to and including CLOCK, plus the "Dirty Pages" part and the side note on `fsync` at the end of section 5. Skip locks and latches, LRU-K and ARC.
- [SQLite: Database File Format, B-tree Pages](https://www.sqlite.org/fileformat.html#btree) (reference, as needed): Section 1.6, the b-tree page header and the cell pointer array. Compare the fields with your own page header.

### Build

1. Write `src/page.c`: functions that read and write the page header and slots of a 4096-byte buffer, all by explicit byte offsets. `slot_insert(page, index, rec, len)` fails when the record does not fit. `page_check(page)` verifies the CRC and that every slot lies inside the page and outside the header and slot array.
2. Write `src/pool.c` with `pool_fetch(pool, pgno)`, `pool_new(pool)`, `pool_unpin(pool, frame, dirty)` and `pool_flush(pool)`, on top of the `Disk` interface. Check the CRC of every page read from disk and set it on every page written.
3. Fuzz `page_check` and the slot functions with libFuzzer in the VM, as in chapter 04: random bytes must never make them read outside the 4096-byte buffer.

### Done when

A test with a pool of 8 frames writes 10,000 pages with known contents, reads them back in random order, and gets every byte right. Fetching a ninth page while all 8 frames are pinned returns an error. The pool never evicts a pinned page or drops a dirty one. The fuzzer runs for 10 minutes under ASan with no finding.

## A B+ tree on the buffer pool

A B+ tree is a search tree whose nodes are pages. Interior pages hold keys and child page numbers. Leaf pages hold the keys and values, sorted, with a pointer to the next leaf for range scans. All leaves sit at the same depth. A lookup reads one page per level, and with a few hundred keys per page, three or four levels hold millions of keys.

```
                     [ 40 | 80 ]                 root (interior)
                    /     |     \
     [10 20 30] -> [40 50 60 70] -> [80 90]       leaves, linked left to right
```

An insert finds the leaf and adds the key in sorted position. If the leaf is full, it splits into two, moves the upper half of the entries to a new page, and copies the first key of the new page up into the parent as a separator. If the parent is full it splits as well, pushing its middle key up instead of copying it. A root split makes a new root and the tree one level taller. Write the root's page number in page 0.

Keep deletion simple. Remove the key from its leaf and leave the leaf underfull. The notes describe this choice under "Merge Threshold". Merging and borrowing are a stretch goal.

Test the tree against an oracle, as chapter 07 tested every fast version against the slow one: run the same random operations against the tree and against a sorted array, and compare after each one. Write a checker that walks the whole tree and verifies its invariants: keys sorted within each page, each subtree within the bounds its parent's separators give it, all leaves at one depth, the leaf chain visiting every key in order, and every page reachable exactly once.

### Study

- [CMU 15-445 Fall 2025: Indexes and Filters I, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/08-indexes1.pdf) (read, 45 min): Section 2 "B+Tree" through "Deletion", then 3.1 "Node Size", 3.2 "Merge Threshold", 3.3 "Variable Length Keys" and 3.4 "Intra-Node Search". Skip composite keys, duplicates, clustered indexes and section 4.
- [CMU 15-445 Fall 2025, lecture 08: B+Trees](https://www.youtube.com/watch?v=u7ii_Lvm9rM) (watch, 1 h 25 min): Andy Pavlo's lecture for the same notes, on the CMU Database Group channel. Watch it for the drawn splits and merges. Skim the parts on composite keys and optimizations.
- [B+ Tree Visualization](https://www.cs.usfca.edu/~galles/visualization/BPlusTree.html) (do, 20 min): David Galles, University of San Francisco. Set "Max. Degree = 3", insert 1 to 20 and watch each split. Then predict the tree after each insert before you click.

### Build

1. Write `src/btree.c` on the buffer pool: `bt_get`, `bt_put` (insert or replace), `bt_del`, and a cursor with `bt_seek(key)` and `bt_next` for range scans. Keys up to 255 bytes and values up to 1000 bytes, so that every leaf holds at least three entries and a split always succeeds. Compare keys with `memcmp` on the shorter length, then by length.
2. Write `bt_check`, the invariant checker above.
3. Write `src/btfuzz.c`: one million random operations with a seed, 70% puts, 20% deletes and 10% range scans of up to 100 keys, against the sorted-array oracle, with a pool of 16 frames so that pages are evicted all the time. Run `bt_check` every 1000 operations and at the end.
4. Reopen the tree from `data.db` after a clean close and compare it with the oracle again.

### Done when

`btfuzz` passes for 20 seeds under ASan and UBSan. `bt_check` passes at every check. With 1 million keys of 16 bytes and values of 100 bytes the tree has 4 levels or fewer, and you can compute the height from your page layout before you print it.

## A write-ahead log of pages

The tree from the last step writes dirty pages into `data.db` whenever the pool evicts them. A crash in the middle of a split can leave the new leaf on disk and the parent without its separator, and no rule can repair that afterwards. The fix is the one xv6 used and SQLite uses: never change `data.db` except from a log that already holds the change.

Your log holds whole page images, as SQLite's WAL does. A batch of puts is one transaction. At commit, the store appends one frame for each page the batch dirtied: a frame header with the page number, a checksum and, on the last frame, a commit mark with the page count, followed by the 4096 bytes of the page. Then it calls `fsync` on the log and acknowledges the batch. Pages in the pool stay dirty until commit and cannot be evicted before it. The CMU notes call this a no-steal policy. After commit, a page's newest version lives in the log, so the pool may drop the page and read it back from the log when needed. An in-memory map from page number to the offset of its newest committed frame tells the pool where to look. `data.db` is written only by a checkpoint.

```
  put, put, put        dirty pages pinned in the pool
  commit               append frames, last one marked commit, fsync(wal), acknowledge
  read page p          wal map has p? read the frame : read data.db
  checkpoint           copy newest frame of each page into data.db, fsync(data.db),
                       then start a new log generation (new salt, fsync)
  recovery             scan frames while salt and checksum chain are valid,
                       keep everything up to the last commit frame, ignore the rest
```

A crash during a checkpoint leaves `data.db` half updated, with the log still complete. Recovery rebuilds the map from the log, and the next checkpoint copies the same pages again. Copying twice gives the same bytes, so the checkpoint can repeat any number of times. The log is reset only after `data.db` has been synced.

Group commit puts many puts behind one `fsync`. Collect puts until the batch reaches a count or a time limit, commit once, and acknowledge all of them. Run checkpoints only between batches. Throughput rises with the batch size and so does the latency of the first put in a batch. Measure both.

### Study

- [CMU 15-445 Fall 2025: Database Logging, notes](https://15445.courses.cs.cmu.edu/fall2025/notes/21-logging.pdf) (read, 1 h): All seven pages, sections 1 to 8. Section 2 defines steal and force. Your store is no-steal with respect to commits and no-force with respect to `data.db`. Section 6 states the write-ahead rule and group commit. Transactions in the notes are concurrent. Yours run one batch at a time.
- [SQLite: Database File Format, The Write-Ahead Log](https://www.sqlite.org/fileformat.html#walformat) (reference, as needed): Sections 4.1 "WAL File Format", 4.2 "Checksum Algorithm", 4.3 "Checkpoint Algorithm", 4.4 "WAL Reset" and 4.5 "Reader Algorithm". Copy the idea of the salts and the cumulative checksum. Use your CRC-32 in place of SQLite's checksum if you like. Skip the wal-index in 4.6, which serves concurrent readers in other processes.

### Build

1. Write `src/wal.c`: `wal_open` with recovery, `wal_append_frame`, `wal_commit`, `wal_lookup(pgno)` and `wal_checkpoint`. The log header holds a magic number, the page size, a checkpoint sequence number, two salts and a checksum. Each frame header holds the page number, the commit page count or zero, both salts and the cumulative checksum.
2. Change the pool so that a dirty page cannot be evicted before commit, a page counts as clean once its frame is in the log, a clean page is dropped on eviction, and reads go to the log first. When a batch has dirtied half the frames in the pool, commit it early.
3. Build `src/kv2.c`, the same API as step 1 with values limited to 1000 bytes, on top of the B+ tree and the log, with `kv_commit` for explicit batches and automatic checkpoints when the log passes 1000 frames.
4. Run the step 2 harness against `kv2` with crashes during commits and during checkpoints, and with `fsync` failures.
5. Measure puts per second and the 99th percentile commit latency for batch sizes 1, 8, 64 and 512, in the VM with `fsync` and on the Mac with `F_FULLFSYNC`.

### Done when

`kvsim` passes 100,000 seeds against `kv2`, including seeds that crash inside a checkpoint. Removing the `fsync` of `data.db` before the log reset makes the harness fail, and putting it back makes it pass. You have a table of throughput and latency per batch size on both machines, and you can explain from it where the time of a commit goes.

## Raw IP packets from a TUN device

The storage half is finished. Everything from here on runs in the Linux VM. The TUN interface in this chapter is Linux's, and macOS has its own utun devices with a different API. A TUN device is a network interface whose other end is a file descriptor. When the kernel routes a packet to the interface, your program reads one IPv4 packet from the descriptor. When your program writes a packet to the descriptor, the kernel receives it as if it had arrived from a network. Give the interface the address 10.0.0.1 and route 10.0.0.0/24 to it. The kernel then sends everything for 10.0.0.2 to your program, which plays the host 10.0.0.2. Programs in the VM such as `nc`, `curl` and `tcpdump` are your test peers.

```
   nc / curl            kernel TCP/IP              tun0 10.0.0.1           your program
   connect(10.0.0.2) -> SYN from 10.0.0.1 -----> read(fd) gets the IP packet -> parse
                        <------------------------ write(fd) a reply packet  <- build
```

Set it up once per boot. In the OrbStack machine, check that `/dev/net/tun` exists, install `tcpdump`, `netcat-openbsd` and `curl`, and create a device that your user may open without root:

```sh
sudo ip tuntap add dev tun0 mode tun user $USER
sudo ip addr add 10.0.0.1/24 dev tun0
sudo ip link set tun0 up
sudo sysctl -w net.ipv6.conf.tun0.disable_ipv6=1
```

The last line stops IPv6 router solicitations from reaching your program. Open the device with `IFF_TUN | IFF_NO_PI`, as the kernel documentation shows, and each `read` returns exactly one packet. If `/dev/net/tun` is missing in the OrbStack machine, run this half in a full Linux VM instead. The device and the 10.0.0.0/24 network exist only inside the VM. Keep it that way, and never bridge this stack to a real network.

Every multi-byte field in IP and TCP is big-endian. Read fields byte by byte, `(uint16_t)(p[0] << 8 | p[1])`, after checking that the bytes exist. A packet is untrusted input. Never cast it to a struct. The IPv4 header checksum and the TCP checksum use the same sum, the one's complement of the one's complement sum of 16-bit words:

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

To verify a received header, sum all of it including the checksum field. The folded result is 0 when the header is intact. To fill in a checksum, set the field to zero, sum, and store the folded result. The TCP checksum also covers a 12-byte pseudo-header built from the IP addresses, the protocol number and the TCP length. Add it with one more `csum_add` call before the segment.

The first thing your stack sends is a reset. RFC 9293 says what a host does with a segment for a connection that does not exist. For a SYN, it answers RST with ACK, with acknowledgment number SEQ plus the segment length, where the SYN counts as one. `nc` then reports "Connection refused" at once.

### Study

- [Linux kernel documentation: Universal TUN/TAP device driver](https://docs.kernel.org/networking/tuntap.html) (reference, as needed): Section 3.1 "Network device allocation" for `tun_alloc` and section 3.2 "Frame format" for what `IFF_NO_PI` removes. Section 2 explains why a device owned by your user needs no root to open. Skip multiqueue and the rest.
- [RFC 791: Internet Protocol](https://www.rfc-editor.org/rfc/rfc791#section-3.1) (read, 45 min): Section 3.1 "Internet Header Format", with the header layout in Figure 4. Skim the part on options. Your stack drops any packet with options or fragments, so you only need to recognize them. Skip the appendices.
- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293#section-3.1) (read, 1 h 15 min): Section 3.1 "Header Format" with Figure 1 and the IPv4 pseudo-header in Figure 2, section 3.2 "Specific Option Definitions" stopping before 3.2.1, section 3.5.2 "Reset Generation", and section 3.10.7.1 "CLOSED STATE" under "SEGMENT ARRIVES".

### Build

1. Write `src/tun.c` with `tun_open("tun0")`, and `src/tundump.c`, which writes every packet it reads to `pkts/0001.bin`, `pkts/0002.bin` and so on. Capture the SYNs that `nc 10.0.0.2 7000` sends while `sudo tcpdump -i tun0 -n -vv` runs in another shell. `nc` gives up after a while, so run it a few times.
2. Write `src/ip.c` with `parse_ipv4(p, n, &hdr)` and `parse_tcp(p, n, &ip, &seg)`. Check the version, a header length of at least 20 bytes that fits inside the total length, a total length no larger than what was read, the header checksum, no fragmentation, protocol 6 for TCP, a TCP data offset of at least 5 words that fits, and the TCP checksum. Walk the options: kind 0 ends the list, kind 1 is one byte, every other kind has a length byte of at least 2 that must stay inside the header. Record the MSS option (kind 2, length 4) and skip the others.
3. Write a test that runs the parser on every saved packet, on every truncation of each one, and on every single-bit flip of each one. Run the same parser under libFuzzer for 10 minutes.
4. Write `src/tcpstack.c`, version 0: read packets in a loop, parse them, print one line per TCP segment, and answer every SYN with RST and ACK per section 3.10.7.1.

### Done when

The parser accepts every captured packet, rejects every single-bit flip, and survives every truncation and the fuzzer under ASan. `nc -v 10.0.0.2 7000` prints "Connection refused" immediately, and `tcpdump -vv` prints your reset with no "bad cksum" warning on the IP header and with `cksum ... (correct)` on the TCP header.

## The TCP state machine: handshake, data and close

A TCP connection is two byte streams, one in each direction. Every byte has a 32-bit sequence number. The SYN and the FIN each take one number as well. Each side keeps a handful of variables, the transmission control block. For sending: `SND.UNA`, the oldest byte not yet acknowledged, `SND.NXT`, the next byte to send, and `SND.WND`, the window the peer advertised. For receiving: `RCV.NXT`, the next byte expected, and `RCV.WND`, the free space in your receive buffer.

```
  send side          SND.UNA            SND.NXT          SND.UNA + SND.WND
                        |  sent, unacked   |  may send now  |  must wait
  ----------------------+------------------+----------------+-------------
         acknowledged
```

Sequence numbers wrap around after 2^32 bytes. Compare them by the sign of the difference, never with `<` directly:

```c
static bool seq_lt(uint32_t a, uint32_t b) { return (int32_t)(a - b) < 0; }
```

Your stack is the server side. In LISTEN it answers a SYN with SYN and ACK from a random initial sequence number, taken from `getrandom`, and moves to SYN-RECEIVED. The ACK of its SYN moves it to ESTABLISHED. In ESTABLISHED every arriving segment first passes the acceptability test of section 3.4, which checks that the segment overlaps the receive window. Then the ACK field advances `SND.UNA`. Then any data that starts exactly at `RCV.NXT` goes into the receive buffer, and the stack answers with an ACK. This version drops segments that arrive out of order and lets the peer resend them. The next step buffers them.

Closing takes two FINs, one per direction. When the peer's FIN arrives, acknowledge it and move to CLOSE-WAIT. Your application sees end of stream, finishes sending, and closes, which sends your FIN and moves to LAST-ACK. The peer's ACK of your FIN moves the connection to CLOSED. A RST in any synchronized state closes the connection at once. The diagram in Figure 5 of RFC 9293 has every state. Your server walks through LISTEN, SYN-RECEIVED, ESTABLISHED, CLOSE-WAIT, LAST-ACK and CLOSED, and you can leave the client-side states out.

Linux sends options in its SYN: MSS, window scaling, SACK-permitted and timestamps. Send only the MSS option back. Linux then uses none of the others for the connection. Advertise a window of at most 65535 bytes, the largest value without window scaling, and send segments no larger than the peer's MSS.

Give the stack a small application interface in place of sockets, with events like those of chapter 08's event loop: data received, room to send, peer closed, connection reset. The echo server of this step and the HTTP server of the next are written against it.

### Study

- [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293#section-3.3) (read, 3 h): Section 3.3 "TCP Terminology Overview" with Figures 3 to 5, section 3.4 "Sequence Numbers" up to and including 3.4.1, section 3.5 "Establishing a Connection" with Figure 6, section 3.6 "Closing a Connection" with 3.6.1, and the opening part of 3.8.6 "Managing the Window". Skip 3.4.2 and 3.4.3 on quiet time and 3.5.1 on half-open connections. Then keep section 3.10.7 "SEGMENT ARRIVES" open while you code: its LISTEN, SYN-RECEIVED and "Other States" parts are the rules your receive function follows, in order.

### Build

1. Add a connection table to `tcpstack.c`, keyed by the four addresses and ports, with one transmission control block per connection, a 64 KB receive buffer and a 64 KB send buffer, both rings.
2. Implement LISTEN on port 7000, the handshake, in-order receive with acknowledgments, sending within the peer's window and MSS, the passive close and RST handling. Write every received segment and every state change as a log line with the sequence numbers relative to the initial ones, so you can read it next to `tcpdump`.
3. Write an echo application on the interface: everything received is sent back, and a peer close is answered with your own close once the send buffer is empty.
4. Write `test/echo.sh`: 100 connections in a row with `nc -N 10.0.0.2 7000`, each sending a random file of between 1 byte and 1 MB and comparing the echo with `cmp`.

### Done when

`test/echo.sh` passes, and after it every connection in your table is CLOSED and freed. For one connection you can match each line of `tcpdump -i tun0 -n`, which prints sequence numbers relative to the initial ones, with a line of your log, from the SYN to the last ACK. In a unit test, a saved segment with an old sequence number, passed to your receive function, produces an ACK and changes no state.

## Loss, retransmission and congestion control

On a link that never loses packets the last step's stack works. Real links lose packets, and so does yours once you lose them on purpose. Add a loss injector at the point where your stack reads from and writes to the TUN device: with a seeded random generator, drop a chosen percentage of packets in each direction. Now every byte you send needs a timer, and every gap in what you receive needs a buffer.

The sender keeps sent bytes in the send buffer until they are acknowledged. RFC 6298 gives the timer. Measure the round-trip time of one segment at a time, keep a smoothed average and a variance, and set the retransmission timeout from both. Rule 2.4 asks for a minimum of one second. Linux uses 200 ms, and so can your lab stack, or the loss tests take hours. When the timer fires, resend the oldest unacknowledged segment and double the timeout. Never take a time sample from a segment that was sent twice, because its ACK cannot say which copy it answers. That is Karn's algorithm. Your SYN-ACK and your FIN need the same timer.

The receiver stops dropping out-of-order segments. It keeps them in the receive buffer at their offset from `RCV.NXT`, tracks which ranges it holds, and moves `RCV.NXT` forward when the gap fills. Each out-of-order arrival is answered with an ACK for `RCV.NXT`, the duplicate ACK that tells the sender something is missing.

Congestion control limits how much the sender puts in flight. The sender keeps a congestion window, `cwnd`, and sends no more than the smaller of `cwnd` and the peer's window. Slow start grows `cwnd` by one segment for each ACK, which doubles it every round trip. Above the threshold `ssthresh`, congestion avoidance grows it by about one segment per round trip. A timeout sets `ssthresh` to half the data in flight and drops `cwnd` back to one segment.

Waiting for a timeout after every lost segment is slow, even at 200 ms. Fast retransmit uses the duplicate ACKs instead: the third duplicate ACK for the same byte makes the sender resend that segment at once and halve `cwnd`. Fast recovery keeps data flowing until the gap is acknowledged. With 5% loss, most losses in this lab end this way.

Your stack needs a clock now. Run it on the event loop from chapter 08: wait on the TUN descriptor with a timeout equal to the time until the earliest timer, then handle packets and expired timers.

### Study

- [RFC 6298: Computing TCP's Retransmission Timer](https://www.rfc-editor.org/rfc/rfc6298#section-2) (read, 30 min): Section 2 "The Basic Algorithm", rules 2.1 to 2.5, section 3 "Taking RTT Samples", and section 5 "Managing the RTO Timer", rules 5.1 to 5.7. Skip section 4 on clock granularity.
- [RFC 5681: TCP Congestion Control](https://www.rfc-editor.org/rfc/rfc5681#section-2) (read, 40 min): Section 2 "Definitions", section 3.1 "Slow Start and Congestion Avoidance" and section 3.2 "Fast Retransmit/Fast Recovery". Skip section 4.

### Build

1. Add the loss injector with a seed and a percentage per direction, set from the command line.
2. Add retransmission per RFC 6298, including the SYN-ACK and the FIN, and the event loop with timers.
3. Add out-of-order buffering on the receive side, with duplicate ACKs.
4. Add slow start and congestion avoidance per RFC 5681 section 3.1, then fast retransmit and fast recovery per section 3.2. Log `cwnd` and `ssthresh` with a timestamp on every change.
5. Write a file server on the stack's interface, listening on port 8080, that answers `GET /<name>` with a file from one directory. Reuse the HTTP/1.1 subset from chapter 08: a status line, `Content-Length` and the body, then close. Answer anything else with 400 or 404.

### Done when

With 5% loss in both directions, 10 runs of `curl -o out http://10.0.0.2:8080/big.bin` for a 10 MB file all finish, and `sha256sum` of each output matches the original. You have the download time at 0%, 1% and 5% loss. The `cwnd` log of one 5% run shows slow start, the halving at each fast retransmit, the drop to one segment at each timeout and the linear growth in between. You can point to the place in your log where Karn's algorithm skipped a sample.

## Where this leads

You have built a store that keeps every acknowledged write through any crash your simulated disk can produce, with a checksummed log, a B+ tree on a buffer pool, and checkpoints that can run any number of times. You have also built a TCP that a Linux kernel accepts as a peer, keeps its byte stream intact through lost and reordered packets, and backs off when the path loses data. Both are a few thousand lines of C that you can read end to end, and each comes with a written failure model and a test that checks the code against it.

The production versions of these programs are much larger. SQLite's pager and b-tree files, the Linux TCP stack and Redis's persistence code solve the same problems with decades of fixes on top. Chapter 19, Reading real code and contributing, teaches you to find your way through code bases of that size. You pick one project such as SQLite, Lua, Redis or TigerBeetle, read it with the questions this chapter gave you, and land a fix in it.
