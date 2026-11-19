---
id: 19
title: Replication with Raft
part: Storage, networks and real codebases
weeks: 8
project: The chapter 18 key-value store replicated across three processes with Raft, tested in a deterministic simulator with crashes and partitions.
---

Chapter 18 left you with a key-value store that keeps every acknowledged write through any crash its simulated disk can produce. It still runs as one process on one machine. While that process is down, every client waits. This chapter keeps the store answering while one of its machines is down, by running three copies of it that agree on every change.

Agreement is the hard part. Messages between the copies get lost, arrive late or arrive twice. A copy can crash halfway through an update and come back with only what it had written to disk. The network can split, so that two groups of copies keep running without hearing each other.

**Raft** is a published algorithm, a set of rules that every copy follows, that keeps the copies in agreement through all of this. You implement it in C from its paper, one section at a time.

Most of the chapter runs inside one process with no network. You write Raft's rules as code that only reacts to its inputs, then a **simulator** that runs three or five copies on a fake clock and a fake network. The simulator loses, delays and duplicates messages, splits the network and crashes copies, with every choice drawn from one random seed, and after every step it checks the promises the paper makes. It is chapter 18's simulated disk applied to a whole cluster. Only when tens of thousands of seeds pass do you put the same code into three real processes that talk over TCP on the event loop from chapter 08.

You need no new library or tool.

From chapter 18 you need `kv.c`, the log-structured store with `kv_open`, `kv_put`, `kv_get` and `kv_del` on the `Disk` interface, and the `log.c` of checksummed records under it. The B+ tree store `kv2.c` is not used here. You also need the simulated disk from the step "Crash tests on a simulated disk", the event loop from chapter 08 and chapter 06's xorshift32. The paper also covers log compaction and changing the set of machines. A long-running system needs both, and this chapter marks them optional.

## One server, three replicas

Your store runs as one process. If the process dies, the store is gone until someone restarts it. Running several copies removes that wait, but only if the copies hold the same data. This step is about what "the same" has to mean.

A **replica** is one copy of the service, running as its own process, usually on its own machine. With three replicas, a client can still be served while one of them is down:

![With one server, a client gets no answer while the server is down. With three replicas, one can be down and the other two still answer.](figures/19-replicas.svg)

Two kinds of failure matter in this chapter. A **crash** stops a replica, and it may restart later with whatever it had saved on disk. A **network partition** cuts the network into groups that cannot reach each other while every replica keeps running. From the inside the two look the same: a replica that gets no reply cannot tell whether the other side is dead or just unreachable.

Raft makes decisions by **majority**: more than half of all replicas, counted whether they are up or not. Three replicas need two, and five need three. Any two majorities share at least one replica, and that shared replica carries what the first majority decided into the second. So three replicas survive one failure and five survive two. Four replicas still survive only one, because a majority of four is three.

The copies stay equal through the **replicated state machine** design. A **state machine** here is a program whose state depends only on the commands it has applied, in order. Your store is one: start empty, apply "put a 1", "put b 2", "del a", and the result is always the same. If every replica applies the same commands in the same order, every replica ends in the same state. The ordered list of commands is the **log**, and each command has a position in it, its **index**.

![The same log of commands goes to three replicas. Each applies the commands in order to its own store and ends in the same state.](figures/19-rsm.svg)

Raft's whole job is to put the same command at each index of every replica's log, through crashes and partitions. Agreeing on one value among replicas that can fail is called **consensus**, and Raft is a **consensus algorithm**.

### Study

- [In Search of an Understandable Consensus Algorithm (Extended Version)](https://raft.github.io/raft.pdf) (read, 25 min): Diego Ongaro and John Ousterhout's Raft paper, the main text of this chapter. Read section 1 "Introduction" and section 2 "Replicated state machines" with Figure 1. Skip section 3, on Paxos, an older consensus algorithm, and section 4, on how the authors designed Raft.
- [MIT 6.5840 Lecture 6 notes: RSM and Raft (1)](https://pdos.csail.mit.edu/6.824/notes/l-raft.txt) (read, 15 min): Plain-text notes from MIT's distributed systems course. Read the top part on failures and how many replicas, then the topics "replicated state machine" and "state-machine replication with raft". Stop at "leader election", which is a later step.

### Build

1. Write `src/rsm.c` with `kv_apply(store, cmd, len)`. A command is a line of text: `put <key> <value>` or `del <key>`. `kv_apply` splits the line and calls `kv_put` or `kv_del` of your chapter 18 `kv.c`. A text command is easy to type with `nc` later and easy to read in a log dump.
2. Write `src/rsmdemo.c`. From a seed, generate 1000 random commands over 50 keys, about three puts for each delete. Delete the directories `rsm/a`, `rsm/b` and `rsm/c` if they exist, open a store with `kv_open` in each, and apply the list to all three. Then call `kv_get` for all 50 keys on each store and compare.
3. Add a flag that swaps two commands on the same key in replica `c`'s copy of the list before it applies them. Print every key whose value differs.

Your chapter 18 store calls `fsync` on every put, so the 3000 puts take a few seconds. That is fine for now.

### Done when

The three stores agree on all 50 keys for 10 seeds. With the swap flag, `rsmdemo` prints at least one key that differs, and you can say which two commands caused it. You can say why three replicas survive one crash and why a fourth replica does not let them survive two.

## A node as a function of its inputs, and a simulator

Bugs in replicated systems depend on timing: which message arrives first, which replica crashes between which two writes. Run three real processes and a bug may show up once a week and never again when you look. This step builds the tool that makes such a bug show up on demand and replay exactly.

Call the Raft code of one replica a **node**. Write it so that it never reads a clock, opens a socket or touches a file. It only reacts to its inputs, and it only writes its outputs into its own struct:

```c
typedef struct { MsgType type; int from, to; /* more fields in later steps */ } Msg;

void raft_init(Node *n, int id, int nnodes, uint32_t seed); // start, or restart after a crash
void raft_tick(Node *n);                       // 10 ms of time have passed
void raft_recv(Node *n, const Msg *m);         // a message arrived
bool raft_propose(Node *n, const uint8_t *cmd, uint32_t len, uint64_t *index); // a client command

// output, read and cleared by the driver after every call:
//   n->out[0 .. n->nout-1]   messages to send
// later steps add more outputs
```

A **tick** is one unit of time handed to the node from outside. Here a tick is 10 ms. The code that calls these functions and carries out the outputs is the **driver**. The real process of the step "Three real processes" has one driver, and the simulator is another.

Such a node is **deterministic**: the same inputs in the same order always produce the same outputs. `raft_propose` stays empty until replication. `raft_init` sets the node's id and seed, resets its timers and the other state a crash loses, and leaves the rest of the struct alone.

> **Practice:** Keep `raft.c` free of system calls. No `clock_gettime`, no `rand`, no `write`. If the node needs randomness, the driver hands it a seed. A function that only depends on its arguments can be tested by calling it.

The simulator runs several nodes in one process:

![One process holds three Raft cores, a virtual clock and a queue of messages in flight. Every node is ticked, messages are delivered when their time comes, every message a node sends passes through fault choices made from one seed, and the checker reads every node after every step.](figures/19-simulator.svg)

- A **virtual clock** is a counter of milliseconds that the simulator advances itself. Thirteen seconds of cluster time take a few milliseconds of real time.
- Every message a node sends goes into a queue of messages in flight with a delivery time.
- One xorshift32 generator from chapter 06, started from the run's seed, makes every random choice: whether a message is dropped or duplicated, how late it arrives, when the network splits and which node crashes.
- After every step, the simulator calls a checker.

The loop is short. For each millisecond: tick every node whose turn it is, deliver every message whose time has come, then maybe change a fault. Each node input is followed by the driver work and then the check. The run is a pure function of the seed, so a failing seed replays the same failure every time. To prove it, fold every delivered message into a running 64-bit hash, the trace hash, and print it at the end.

A crashed node gets no ticks and no messages. When it restarts, the simulator calls `raft_init` on the node's old struct. Until the step "Persistence and crash recovery" a restart keeps everything else in the struct, as if the node had been paused.

### Study

- [Will Wilson: Testing Distributed Systems w/ Deterministic Simulation](https://www.youtube.com/watch?v=4fFDFbi3toc) (watch, 40 min): Strange Loop 2014. Will Wilson, an engineer at FoundationDB, explains how they ran their whole database in one simulated process with a fake network, fake disks and fake clocks, and why that found bugs no other test found. Watch for the rules that keep a simulation deterministic. The parts on language features for building such a framework are background.

### Build

1. Write `src/raft.h` with `Msg`, `Node` and the four functions. For this step `raft.c` holds a no-op node: every 5 ticks it sends a `PING` to every other node, and it counts the pings it receives.
2. Write `src/sim.c` with nodes in a fixed array and a fixed array of messages in flight. Use these fault settings, which this chapter's checks were tuned with: delivery 1 to 30 ms after sending, 10% of messages dropped, 2% duplicated, a new partition or a heal every 200 to 2200 ms, and a 5% chance every 100 ms of crashing one node, which restarts 100 to 3100 ms later through `raft_init`.
3. Run 10 seconds of faults followed by 3 quiet seconds with no drops, no duplicates, no partitions and every node up. From the step "Replicating entries" on, checks at the end of the run use this quiet tail to ask whether the cluster recovered.
4. Give each node its own seed, taken from the simulator's generator. Print the trace hash at the end of a run. Take `-seed N` for one run, `-seeds N` for N runs in a row, and `-drop N` to set the drop rate to N percent.
5. Write the first check. Keep each node's partition group, the side of the split it is on, in an array. When a ping is delivered, its sender and receiver must be in the same group, and the check fails otherwise.

### Done when

`./sim -seed 7` prints the same trace hash every time you run it, and seed 8 prints a different one. With `-drop 100`, no node counts a ping. The partition check never fires in 1000 seeds.

## Terms and leader election

The pings move no data. Before the nodes can agree on a log, one of them has to be in charge of it. Raft lets one node, the leader, decide the order of commands, and this step elects it.

Each node has one of three roles:

- A **follower** answers requests from other nodes and starts nothing.
- A **candidate** is asking the others to vote for it.
- The **leader** receives all client commands and sends them to the followers.

![Every server starts as a follower. A follower that hears no leader times out and becomes a candidate. A candidate with votes from a majority becomes leader. Any server that sees a higher term goes back to follower.](figures/19-roles.svg)

Time in Raft is counted in **terms**, numbered 1, 2, 3 and so on. A term starts with an election and has at most one leader.

Every message carries the sender's term. A node that sees a higher term than its own adopts it and becomes a follower. A node ignores or rejects a message from an older term. Terms let a node notice that it has missed an election.

![Time is divided into terms. Each term starts with an election. Term 3 ended with a split vote and no leader, so term 4 started with a new election.](figures/19-terms.svg)

The leader sends an **AppendEntries** message to every follower at least every 50 ms, the **heartbeat**. In this step it carries no entries.

A follower that hears nothing for its **election timeout** becomes a candidate. It adds one to its term, votes for itself and sends **RequestVote** to all the others. A node grants at most one vote per term, to the first candidate that asks. A candidate with votes from a majority becomes leader and starts sending heartbeats at once.

Two rules here are easy to get wrong. A node resets its election timer only when it grants a vote or gets an AppendEntries from the leader of its current term, not on every message it receives. A candidate that gets an AppendEntries from a leader of its own term steps down to follower, because that leader has already won.

If two candidates start together, they can split the votes and nobody wins. Raft avoids this by choosing each election timeout at random, from 150 to 300 ms here, which is 15 to 30 ticks. Draw it from the node's own generator every time the timer resets.

The paper lists five properties that Raft guarantees, in its Figure 3. The first is **Election Safety**: at most one leader per term. Your checker tests it after every step. It keeps an array indexed by term with the node that was leader in that term, and fails when a second node claims the same term.

### Study

- [Raft paper, sections 5.1 and 5.2](https://raft.github.io/raft.pdf#page=3) (read, 1 h): Read the opening of section 5 with Figure 2 and Figure 3, then sections 5.1 "Raft basics" and 5.2 "Leader election". In Figure 2, use the RequestVote box and the "Rules for Servers" now and leave the AppendEntries details for the next step. Figure 2 is the specification you code against for the rest of the chapter.
- [Raft: RaftScope visualization](https://raft.github.io/) (do, 20 min): The section "Raft Visualization" on the official Raft site runs five servers in the browser. Click a server and choose "stop" on the leader, then watch a new term begin. Press A to align the timers for a split vote and watch the term numbers climb.
- [MIT 6.5840 Lecture 6 notes: leader election](https://pdos.csail.mit.edu/6.824/notes/l-raft.txt) (read, 15 min): The topic "leader election (Lab 3A)" to the end of the notes, on why one vote per term means one leader and how to choose the timeout.

### Build

1. Replace the ping node. Add `currentTerm`, `votedFor` and the role to `Node`, and the term to `Msg`, plus `RequestVote`, its reply, and an empty `AppendEntries` with its reply, as Figure 2 defines them.
2. Implement the rules: the random election timeout, the timer reset only on a granted vote or a current leader's AppendEntries, the rule that a higher term turns any node into a follower, a candidate stepping down for a leader of its term, one vote per term, and the leader's heartbeat every 5 ticks.
3. Add the Election Safety check to the checker.
4. Break it on purpose: let a node vote for every candidate that asks in a term. Run the seeds and see the check fail. Then undo the change.

### Done when

10,000 seeds pass with 3 nodes and with 5 nodes. The vote-twice bug fails within the first 20 seeds, and the failing seed fails the same way when you run it alone. For one passing seed, you can print every role change with its virtual time and term and explain each one.

## Replicating entries

With a leader in place, client commands can flow. The leader puts each command in its own log and copies it to the followers. The hard part is a follower whose log differs from the leader's, because it was down or cut off. This step gets every follower's log to match the leader's.

Each **log entry** holds an index, the term in which a leader created it, and the command. A client command reaches the leader through `raft_propose`, which appends an entry and returns its index. The leader copies entries to followers with AppendEntries, which now carries entries. Each message also names the entry just before the new ones, by its index and term, `prevLogIndex` and `prevLogTerm`. The follower accepts the entries only if its own log holds an entry at `prevLogIndex` with term `prevLogTerm`. This is the **consistency check**:

![The leader sends entry 3 with the index and term of the entry before it. The follower finds its entry 2 has term 1, as the message says, so it appends entry 3 and replies with success.](figures/19-append.svg)

If the check succeeds, the follower deletes any entries of its own that conflict with the new ones, appends the rest and replies with success and the index of its last matching entry. If the check fails, it replies with failure.

The leader keeps `nextIndex` for each follower, the next entry to send it. A success reply sets `nextIndex` to one past the follower's last matching entry. A failure reply lowers `nextIndex` by one, and the leader sends again at once, not at the next heartbeat. It steps back like this until the logs match, and the follower takes the leader's entries from there:

![A follower's log differs from the leader's after index 3. The leader steps back one entry at a time until the check succeeds at index 3, then the follower deletes its entries 4 and 5 and takes the leader's 4 to 6.](figures/19-repair.svg)

The "at once" matters. A leader cut off for 2 seconds can come back with about 100 entries that no one else has. Stepping back one entry per 50 ms heartbeat would take about 5 seconds to repair that, longer than the 3-second quiet tail.

Send at most 8 entries per message. When a success reply arrives and the follower is still behind, send the next batch at once too. Otherwise a follower that comes back 500 entries behind needs 60 heartbeats, 3 seconds, to catch up.

This step adds the first check at the end of a run, after the quiet tail: exactly one node is leader, and every node's log has the leader's length. If it fails, the cluster did not recover.

### Study

- [Raft paper, section 5.3](https://raft.github.io/raft.pdf#page=6) (read, 45 min): Section 5.3 "Log replication" with Figures 6 and 7, and the AppendEntries box of Figure 2, receiver steps 1 to 4. Figure 7 shows the ways a follower's log can differ from a new leader's. The paragraphs on committing are the subject of the next step.
- [MIT 6.5840 Lecture 7 notes: Raft (2)](https://pdos.csail.mit.edu/6.824/notes/l-raft2.txt) (read, 20 min): The topic "the Raft log (Lab 2B)" from its start to "leader 1 in term 3 forces logs to be identical", a trace of a partitioned leader rejoining. The fast backup with XTerm, XIndex and XLen under "how to roll back quickly" is optional.

### Build

1. Add the log to `Node`: entries 1 to `log_len` in a fixed array, each with a term, a length and up to 64 bytes of command, so keys and values in this chapter stay short. Entry 0 is a placeholder with term 0, so `prevLogIndex` 0 always matches.
2. Implement `raft_propose`, AppendEntries with entries and the consistency check, the follower's conflict rule, and `nextIndex` with its step back. On a failure reply, and on a success reply that leaves the follower behind, send the next AppendEntries at once.
3. In the simulator, every 20 ms propose a command at any node that believes it is the leader, as long as the run has more than a second left.
4. Add the end-of-run check: one leader, and every log as long as the leader's.

### Done when

10,000 seeds pass Election Safety and the end-of-run check, with 3 and with 5 nodes. For one seed, you can print the probes of one repair: each `prevLogIndex` the leader tried, and the answer it got.

## Committing and checking

Entries now reach every log, but none of them may be applied to a store yet. An entry is safe to apply only once enough nodes hold it that no future leader can lose it. This step decides when that is, and adds the checks that tell you whether it worked.

An entry is **committed** once the leader has stored it on a majority. Raft promises that a committed entry is never lost, and only committed entries are applied to the store. To count copies, the leader keeps a second number per follower, `matchIndex`, the highest entry known to be on that follower. It sets `matchIndex` from each success reply. The leader's **commit index** is the highest index that a majority of the `matchIndex` values reach, its own log counting as one of them:

![The leader S1 knows how far each log matches its own. Entries 1 to 5 are on three of five servers, a majority, so the commit index is 5. Sorting the match indexes and taking the third highest gives the same number.](figures/19-commit.svg)

Every AppendEntries carries the leader's commit index. A follower sets its own commit index to the smaller of that number and the index of its last new entry. Each node then applies its newly committed entries in index order. The middle paragraphs of section 5.3, which you read in the last step, explain the same rules, so reread them now.

Two of Figure 3's properties hold from this step on:

- **Log Matching**: if two logs have an entry with the same index and term, the logs are identical up to that index.
- **Leader Append-Only**: a leader never deletes or overwrites its own entries.

Checking Log Matching naively compares whole logs after every step, which gets slow. Keep a running hash of each node's log instead, entry by entry, and compare the hashes at the highest index where two logs have the same term.

A third check, **State Machine Safety**, says that no two nodes apply different commands at the same index. Your rules so far break it, and the next two steps explain why. You add the check now so that you see it fail.

### Study

- [Raft paper, Figure 2](https://raft.github.io/raft.pdf#page=4) (reference, as needed): Keep it open while you code. AppendEntries receiver step 5 sets the follower's commit index. Under "Rules for Servers", the first rule for all servers applies committed entries, and the last rule for leaders sets the commit index from `matchIndex`. Ignore that rule's term condition until the step "What a leader may count".

### Build

1. Add `matchIndex`, the commit index on the leader and on followers, and the leader's commit rule without the term condition. Add the output `n->commit`, the index up to which entries may be applied.
2. In the simulator, after each step, apply each node's newly committed entries.
3. Add Log Matching and Leader Append-Only to the checker.
4. Add State Machine Safety: record the first command applied at each index, and compare every later one.
5. Extend the end-of-run check: every node's commit index equals its log length, so the last command proposed in the quiet tail committed everywhere.
6. Give the checker a switch that turns off State Machine Safety and the commit part of the end-of-run check, so that the other checks can run to the end of every seed.

### Done when

With State Machine Safety switched off, Log Matching, Leader Append-Only and the rest of the end-of-run check pass 10,000 seeds with 3 and with 5 nodes. With it switched on, State Machine Safety fails within the first 10 seeds, and for one failing seed you can print the two commands that landed on the same index and the terms they came from.

## Which leader may win

The last step's rules let two nodes apply different commands at the same index. The first cause is the election. A node whose log lacks committed entries can win, and then its AppendEntries overwrite those entries on everyone else. This step closes that gap.

The fix is the **election restriction**. RequestVote carries the index and term of the candidate's last log entry. A voter refuses a candidate whose log is less **up-to-date** than its own. Compare the terms of the two last entries first: the higher term wins. If they are equal, the longer log wins.

![Two comparisons of a candidate's log with a voter's. In (a) the candidate's last entry has a higher term, so its shorter log is more up-to-date and it gets the vote. In (b) the last terms are equal and the voter's log is longer, so the voter refuses.](figures/19-uptodate.svg)

The last term comes first because a later term's entries came from a later leader, who knew more. A longer log from an old term may hold entries that a later leader already replaced.

A committed entry sits on a majority, and every winner needs votes from a majority. The two majorities share at least one voter, and that voter holds the entry and refuses any candidate without it. This gives the fourth property, **Leader Completeness**: a leader's log holds every entry committed before its term.

Your checker can test it directly. When a node becomes leader, its log must hold every entry the checker has seen applied.

### Study

- [Raft paper, section 5.4.1](https://raft.github.io/raft.pdf#page=8) (read, 15 min): The opening of section 5.4 "Safety" and 5.4.1 "Election restriction". Stop at 5.4.2.
- [MIT 6.5840 Lecture 7 notes: the election restriction](https://pdos.csail.mit.edu/6.824/notes/l-raft2.txt) (read, 15 min): In the topic "the Raft log (Lab 2B)", read from "could new leader roll back *committed* entries" to "why is Figure 7 analysis important", which asks who may win an election in the paper's Figure 7.
- [Jon Gjengset: Students' Guide to Raft](https://thesquareplanet.com/blog/students-guide-to-raft/) (read, 40 min): Written by a teaching assistant of MIT's distributed systems course after watching students implement Raft. Read "Implementing Raft" through "Term confusion", which list the mistakes that pass simple tests and break under faults. Skip the aside on optimizations and the sections after it for now.

### Build

1. Add the last log index and term to RequestVote, and the up-to-date check to the vote handler.
2. Add the Leader Completeness check to the checker.
3. Break it on purpose: remove the up-to-date check, run the seeds and see Leader Completeness fail. Then put the check back.

### Done when

1000 seeds pass with 3 nodes and with 5 nodes. Without the up-to-date check, Leader Completeness fails within the first 10 seeds. Run 10,000 seeds as well. A rare failure can remain: at this point the prototype failed 2 of 10,000 seeds with 3 nodes, both on Leader Completeness, the first at seed 7068. Keep one such seed for the next step.

## What a leader may count

The second cause is in the commit rule. A leader can count copies of an entry from an earlier term, call it committed, and be wrong. Random runs hit this rarely, so this step also writes the bad schedule out by hand.

The paper's Figure 8 shows an entry stored on three of five servers that a later leader still replaces:

![Five servers over four terms. In (c) the entry at index 2 from term 2 is stored on three of five servers, yet in (d) S5 wins an election and replaces it on every server that is up, so counting copies did not make it committed.](figures/19-old-term.svg)

In (d), S5's last entry has term 3 and the others' last entries have term 2, so S5 is more up-to-date and wins votes from S2, S3 and S4. The election restriction did its job. The mistake was in (c): S1 counted three copies of an entry from term 2 and called it committed.

The rule: a leader counts copies only for entries from its own current term. When such an entry is committed, every entry before it is committed with it. A new leader therefore cannot commit anything until it has an entry of its own term on a majority. So every leader appends a **no-op entry**, an entry with an empty command, as soon as it wins. The state machine skips it.

With both rules, the fifth property holds. **State Machine Safety**: once a node has applied an entry at an index, no node applies a different entry at that index. Section 5.4.3 of the paper proves it.

In this chapter's prototype, a node that granted votes without the up-to-date check failed within 10 seeds. Old-term counting with everything else correct failed 3 times in the first 20,350 seeds, the first at seed 7068. For a bug that rare, write the bad schedule as a script, `fig8.c`, that delivers each message by hand.

### Study

- [Raft paper, sections 5.4.2 and 5.4.3](https://raft.github.io/raft.pdf#page=8) (read, 35 min): 5.4.2 "Committing entries from previous terms" with Figure 8, and 5.4.3 "Safety argument" with Figure 9. Read the argument slowly, one numbered step at a time.

### Build

1. Add the current-term condition to the commit rule, and the no-op entry when a node becomes leader.
2. Run the seed you kept from the last step and check that it passes now.
3. Write `src/fig8.c`, the Figure 8 sequence as a scripted test with five nodes and no simulator. Deliver messages by hand only between the nodes each stage names. Crash a node by calling `raft_init` on it, which keeps its term, vote and log. Force an election by setting a node's election timer to one tick before it expires. Give `fig8` a switch that turns off the no-op, so the logs look like the paper's.
4. Break the commit rule on purpose: let the leader count copies of entries from any term. Run the seeds, then run `fig8` with the break.

### Done when

100,000 seeds pass with 3 nodes and 20,000 with 5 nodes. With old-term counting, `fig8` reports that index 2 holds one command on S1 and another on S5, and with the correct rule it reports no violation. You can explain from your `fig8` output why S5 was allowed to win in stage (d).

## Persistence and crash recovery

So far a crash in the simulator restarts a node with its whole memory intact, which no real crash does. A real node keeps only what it wrote to disk. Raft needs three things to survive a crash, and they have to reach the disk at the right moment.

Figure 2 lists the **persistent state**: `currentTerm`, `votedFor` and the log. Everything else, the role, the commit index, `nextIndex` and `matchIndex`, is **volatile** and starts from zero after a restart. Each persistent item protects a promise. Without `votedFor`, a node could vote, crash, restart and vote for a second candidate in the same term, and two leaders would follow. Without the log, an entry counted as committed could vanish from the majority that holds it.

The node reports what changed through two new outputs: `n->persist_state` is set when the term or the vote changed, and `n->persist_from` holds the first log index that changed. The rule for the moment: the state has to be on disk before any other node can learn of it. So the driver runs every step in this order:

![After every input the driver first makes the new term, vote and log entries durable, then sends the messages the core produced, then applies newly committed entries to the store and answers clients.](figures/19-drive.svg)

Store the two parts in two files in the node's directory, both written with `log.c` from chapter 18's step "A log of checksummed records":

- `log` holds one record per entry: the index, the term and the command, written byte by byte. Appending is `log_append` followed by one `log_sync`. Keep the offset that `log_append` returns for each entry. When a follower has to delete conflicting entries, call `log_truncate` at the offset of the first deleted entry, then append the new ones.
- `state` is a second log, whose records hold a term and a vote. Saving appends one record and syncs it. On startup the last record wins. A record is a few bytes per election, so the file stays small.

On startup, `log_open` cuts a torn tail from both files, as it did for the store. Then `log_scan` rebuilds the term, the vote and the in-memory log from the records, and `raft_init` sets up the rest.

Write all of this against the `Disk` interface from chapter 18. In the simulator each node gets its own simulated disk, and a node crash is that disk's crash, with unsynced writes lost or torn. The real process of the step "Three real processes" uses `disk_posix.c` with the same code.

### Study

- [Raft paper, section 5.5](https://raft.github.io/raft.pdf#page=10) (read, 10 min): Section 5.5 "Follower and candidate crashes", with the "Persistent state on all servers" part of Figure 2. It explains why Raft messages can be repeated safely.
- [MIT 6.5840 Lecture 7 notes: persistence](https://pdos.csail.mit.edu/6.824/notes/l-raft2.txt) (read, 15 min): The topic "persistence (Lab 2C)", on why each of the three items must survive and which state may be lost. Skip "log compaction and Snapshots".

### Build

1. Add the outputs `persist_state` and `persist_from` to `Node`.
2. Write `src/raftlog.c` on `log.c` and the `Disk` interface, with `rlog_open`, which scans both files, `rlog_save_state` and `rlog_save_entries(from)`, which truncates at entry `from` if needed and appends the entries from there on.
3. Give each simulated node its own simulated disk. On a crash, throw away the node's memory and its disk's unsynced writes. On a restart, rebuild the node from its disk with `rlog_open` and `raft_init`.
4. Break the order on purpose: send the messages first and persist after, and let the simulator crash a node between the two in 3% of steps. Run the seeds, then restore the order.

### Done when

100,000 seeds pass with crashes and restarts, with every node rebuilt from its simulated disk. With send-before-persist, the seeds fail within the first 10, either on a safety check or on the end-of-run check because the cluster stopped making progress. You can say which persistent item each failure lost.

## The key-value store as the state machine

The log now survives crashes and holds the same commands on every node. This step puts your chapter 18 store underneath it, so that each committed command changes the store, and the leader answers a client once its command has been applied.

Each node keeps `lastApplied`, the index of the last entry it applied. It applies committed entries in index order, from `lastApplied + 1` up to the commit index, and calls `kv_apply` from the first step for each one. The no-op entries do nothing.

On the leader, `raft_propose` returned an index for each client command. Keep a small table from index to waiting client. When the entry at that index is applied, answer the client with the result. If a different command turns up at that index, a new leader replaced the entry, and the client has to try again.

After a restart the commit index and `lastApplied` start at zero. The easy way to rebuild the store is the one Figure 2 implies: start from an empty store and apply the log again from index 1, as entries become committed. The store's files from before the crash are still on the disk, so delete them before `kv_open`, or use a fresh store directory each time. The Raft log is the durable record, so the store does not need its own `fsync` per put any more. Add a flag to `kv_open` that turns the sync off for this use.

Replaying the whole log gets slow once the log is long. Real systems save a **snapshot** of the store and drop the log before it. That is section 7 of the paper, and this chapter leaves it out.

### Study

- [Students' Guide to Raft: Applying client operations](https://thesquareplanet.com/blog/students-guide-to-raft/#applying-client-operations) (read, 15 min): The subsection "Applying client operations" under "Applications on top of Raft", on how the service learns that its command was committed and what it does when a different command shows up at that index. Leave "Duplicate detection" for the step "Clients".

### Build

1. Give each node in the simulator a store on its simulated disk. On every start, delete the store's files with `disk_unlink`, open it empty and fill it by applying committed entries.
2. Add the leader's table of waiting clients. In the simulator, three clients each send a random put or delete to the node that is leader and wait for its answer. The simulator finds the leader by reading the nodes' roles, a shortcut that the step "Clients" replaces with redirects. A client that gets no answer within 300 ms gives up on that command and sends a new one. The step "Clients" replaces giving up with retrying.
3. At the end of each run, after the quiet tail, check that every node's store holds the same value for every key.

### Done when

10,000 seeds pass with the store check, with 3 and with 5 nodes. In a passing run, a node that crashed and restarted ends with the same store as the others. You can show in the trace one client command that was answered by a leader and one that was dropped because a new leader replaced its entry.

## Three real processes

The core has passed tens of thousands of simulated runs. Now it runs as three processes on your machine, talking over real TCP, with real time and real files. Only the driver changes: the code in `raft.c` stays as it is.

Write `raftd`, one process per node, started as `raftd <id> 3 <dir>`. It listens on two ports on `127.0.0.1`: `9000 + id` for messages from the other nodes and `9100 + id` for clients. It keeps its `state` and `log` files and a `store/` directory in its own directory, and it deletes and recreates `store/` at every start:

![Three raftd processes on one machine, each listening on a peer port and a client port, connected to each other over TCP, and each keeping its own state file, log file and store directory on disk.](figures/19-processes.svg)

The process runs on the event loop from chapter 08, with these parts:

- **Peers.** Each node connects out to every other node and sends its messages on that connection. It reads messages only on the connections it accepted. If a connection is down or its output queue is full, drop the message. Raft already copes with lost messages, and the leader will send again.
- **Framing.** TCP delivers a stream of bytes, not messages. Send each message as a 4-byte length followed by its fields, written byte by byte in little-endian order as you wrote chapter 18's records. Never send a C struct.
- **Time.** Read the time with `clock_gettime(CLOCK_MONOTONIC)`, the clock your chapter 07 timers used. Pass `loop_wait` the milliseconds left until the next tick as its timeout.
- **Clients.** A client sends one line, `put <key> <value>`, `get <key>` or `del <key>`, and gets one line back. A node that is not the leader answers `redirect <id>` with the leader it last heard from. Until the last step, the leader answers `get` from its own store at once, and that step shows why this can return an old value. Add `status`, which any node answers with its role, term, log length and commit index.

A client such as `nc` may close its sending side right after its line, so the `read` that returns 0 can come in the same wakeup as the line. Answer the lines you have before you close, as your chapter 08 server did.

Connecting out is new. Chapter 08's servers only accepted. The `connect` call from Beej's guide, which chapter 08 assigned, blocks until the other side answers, and `raftd` must not block.

Set `O_NONBLOCK` on the socket first. Then `connect` returns -1 with `errno` set to `EINPROGRESS`, and the event loop reports the socket writable when the attempt has finished, and also closed when it failed. Read the option `SO_ERROR` with `getsockopt`: 0 means connected, anything else is the error. A peer that is not up yet refuses the connection, so on any failure close the socket and let the tick try again 100 ms later.

The prototype for this chapter hit two bugs that the simulator could not show. Both come from the outside world:

1. Each node seeded its generator from the current time in milliseconds. Two processes that one script started in the same millisecond got the same seed. When the leader was killed, those two chose the same election timeouts every time, split every vote and elected no leader. Seed from `getrandom`, as chapter 18's TCP stack chose its initial sequence numbers.
2. After the process had been paused, the loop ran every missed tick at once, and the node started ten elections in a row. Run at most one tick per loop pass, and set the next tick from the current time. A pause can come from Windows going to sleep, or from `kill -STOP`, which sends SIGSTOP and freezes a process without ending it, followed by `kill -CONT`, which sends SIGCONT and lets it run again.

### Study

- [Linux man page: connect(2)](https://man7.org/linux/man-pages/man2/connect.2.html) (reference, as needed): The DESCRIPTION, and under ERRORS the entry `EINPROGRESS`, which says how a nonblocking connect reports that it finished.
- [Linux man page: clock_gettime(2)](https://man7.org/linux/man-pages/man2/clock_gettime.2.html) (reference, as needed): The DESCRIPTION of `CLOCK_MONOTONIC`, and why it suits timeouts better than `CLOCK_REALTIME`.

### Build

1. Write `src/raftd.c` with the parts above, on `loop.h` from chapter 08 and your `raftlog.c` on `disk_posix.c`. It prints a line to stderr at every role change and, at startup, the term, the vote and the number of entries it loaded.
2. Write `tests/start.sh`, which starts three nodes in the background, each writing to its own directory and its own stderr file and saving its process ID in a file.
3. Send `status` to each node with `printf 'status\n' | nc -q1 127.0.0.1 9100`.
4. Kill the leader with `kill -9`, which sends SIGKILL as your chapter 18 crash test did, watch the other two elect a new one, then restart the killed node and watch it load its log and catch up.
5. Build with ASan and UBSan, as every program since chapter 01, and repeat steps 3 and 4.

### Done when

Within a second of `start.sh`, exactly one node reports itself leader. After `kill -9` of the leader, one of the others reports itself leader in a higher term within one second, usually within 400 ms. The restarted node prints the entries it loaded, and a second later all three report the same log length and commit index. ASan and UBSan print nothing.

## Clients: finding the leader and retrying

A client in the last step had to know which node leads. This step gives clients the rules from section 8 of the paper: find the leader, retry on failure, and never have one command applied twice.

A client sends its command to any node. A follower answers `redirect <id>` with the leader it last heard from, or with -1 if it knows none. The client then tries that node, or the next one after a short wait. A node that crashes or loses leadership never answers, so the client also needs a timeout. Wait one second, then try another node.

Retrying creates a new problem: any retried command can be applied twice. Suppose client A's `put a 1` is committed and applied, and the leader crashes before it answers. Client C reads `a` and gets 1, then client B puts `a 2` and gets its answer. A retries at the new leader, its `put a 1` is applied a second time, and the next read of `a` returns 1. The value 1 came back after B overwrote it, which no single moment for A's put can explain.

Raft's answer is **duplicate detection**:

1. Each client picks a client ID and numbers its commands 1, 2, 3, the **sequence number**. A retry reuses the same number.
2. The command line carries both: `7 12 put a 1` is client 7, command 12.
3. The state machine keeps, for each client, the highest sequence number it has applied and that command's reply. A command whose number is not higher is not run again. The node answers it with the saved reply.

![Client 7 sends command 12. S1 commits and applies it, then crashes before it answers. The client times out and sends the same command 12 to S2, the new leader. The entry goes into the log a second time, and the duplicate table makes the state machine skip it and answer with the saved reply.](figures/19-dedupe.svg)

The table keeps one reply per client, so a client sends its next command only after it has the answer to the last one. The duplicate table is part of the state machine. Every node builds it by applying the same log, so it survives leader changes, and after a restart the replay rebuilds it. Together these rules give **exactly-once** behavior: each client command changes the store once, however often it is sent.

### Study

- [Raft paper, section 8](https://raft.github.io/raft.pdf#page=13) (read, 10 min): Section 8 "Client interaction", the first three paragraphs: finding the leader, and serial numbers for duplicate commands. Leave the last paragraph, on read-only operations, for the next step.
- [Students' Guide to Raft: Duplicate detection](https://thesquareplanet.com/blog/students-guide-to-raft/#duplicate-detection) (read, 10 min): The subsection "Duplicate detection" and the "Hairy corner-cases" after it.

### Build

1. Add the client ID and sequence number to the command, and the per-client table to the state machine.
2. Write `src/raftc.c`: `raftc <client> <seq> put|get|del <key> [value]`. Connect with a plain blocking `connect`, send the line, read one reply line. Set a one-second receive timeout with `setsockopt` and the option `SO_RCVTIMEO`, which makes a blocking `read` fail with `EAGAIN` when no byte arrives in that time. Follow redirects, wait 100 ms before trying the next node after a failure, and give up after 50 tries. Add an option that names the node to try first.
3. In the simulator, each client keeps one command in flight. Let clients time out after 300 ms and retry at a random node with the same sequence number. Add an exactly-once check: each node counts how often it ran each client command, and the count must never pass one. Break it by removing the duplicate check in the state machine, and see the check fail.
4. Write `tests/killtest.sh`: 20 rounds of killing the leader with `kill -9`, writing a new key with `raftc`, and restarting the killed node. At the end, read back all 20 keys.

### Done when

10,000 seeds pass with retrying clients, and without duplicate detection the exactly-once check fails within the first 10 seeds. `killtest.sh` reads back all 20 keys. Every write after a kill is answered within a second, most within about 300 ms: an election plus the client's 100 ms waits. In 40 rounds the prototype measured 203 to 306 ms, and once 606 ms.

## Linearizable reads

Writes are safe now. Reads are not yet, because the leader answers them from its own store. A leader cut off by a partition does not know it was replaced. It keeps answering reads with values that the new leader has already overwritten.

The guarantee this step gives is **linearizability**: each operation appears to take effect at one instant between the moment the client sends it and the moment the answer arrives. In practice: once a write has been acknowledged, every read that starts afterward sees that write or a newer one. A read that returns an older value is a **stale read**.

![A partition leaves S1 alone, still believing it leads term 1, while S2 and S3 have moved on to term 2 and x = new. In (a) S1 answers a read from its own store and client B gets the old value. In (b) the read goes through the log, S1 cannot reach a majority, and client B times out and gets x = new from S2.](figures/19-stale-leader.svg)

This chapter takes the simplest correct way: a read goes through the log like a write. The leader appends `get x` as an entry and answers when that entry is applied. A stale leader cannot get a majority to store the entry, so it never answers, and the client times out and finds the real leader. A read that gets an answer was ordered after every write committed before it.

Every read now costs a round of messages and a disk write. The paper's section 8 and the MIT notes describe faster ways: the leader confirms with a round of heartbeats that it still leads before answering, or it holds a time-limited lease. They are optional here.

To check reads in the simulator, record each client operation with the virtual time it started, the time its answer came and the log index it was applied at. A read answered from a store at once has no log index of its own, so record the answering node's `lastApplied` for it. Then compare every read with every write to the same key. If a write's answer came before the read started, the write's index must be lower than the read's.

### Study

- [Jepsen: Linearizability](https://jepsen.io/consistency/models/linearizable) (read, 10 min): Kyle Kingsbury's definition, from the Jepsen project, which tests real databases for these guarantees. The first paragraphs are enough. Skip the formal definitions.
- [Raft paper, section 8, read-only operations](https://raft.github.io/raft.pdf#page=13) (read, 10 min): The last paragraph of section 8, on why a leader must not answer reads from its own state, and the two precautions the paper takes.
- [MIT 6.5840 Lecture 7 notes: read-only operations](https://pdos.csail.mit.edu/6.824/notes/l-raft2.txt) (read, 10 min): The topic "read-only operations (end of Section 8)", with the stale leader example and the lease idea.

### Build

1. Add `get` entries to the log in the simulator and in `raftd`, answered when applied.
2. Record each client operation in the simulator and add the read check at the end of each run.
3. Break it: let the leader answer `get` from its store at once, recording its `lastApplied` as the index. Run the seeds and see the check fail. Then undo it.
4. Run a stale leader with real processes. Freeze the leader with `kill -STOP`, write a new value through the others, let the old leader run again with `kill -CONT` and at once send it a `get`, with `raftc` told to try the old leader first.

### Done when

10,000 seeds pass the read check with 3 nodes. Answering reads from the local store fails the check within the first 100 seeds. In the real test, the read after `kill -CONT` returns the new value. You can say what the resumed node did between waking up and your read: which message told it about the new term.

## Where this leads

You have a key-value store that keeps answering while one of its three processes is down, and that never loses an acknowledged write or returns a stale read, as far as tens of thousands of simulated schedules can tell. You wrote the protocol as a function of its inputs, tested it in a simulator that controls time, the network and the disks, and found that the bugs left for the real processes came from the outside world: seeds and clocks.

Chapter 20, Reading real code and contributing, moves from code you wrote to code you did not. It starts with Valkey, a production key-value server of about 180,000 lines of C that runs one event loop in one thread, as your chapter 08 server did. You build it at a pinned release, run its tests, map its source files and follow one `SET` command under gdb from the socket to the reply. Then you find a bug or an untested path in it and send the change as a pull request. While review runs, you read C++, Zig and Odin in real code.

Valkey's replicas copy a primary's writes without waiting for a majority, so its replication code makes an optional read in that chapter, next to your Raft.
