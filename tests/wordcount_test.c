// Tests for src/wordcount.c. Run from the project root: sh tests/run_wordcount_test.sh
//
// We include the .c file so the tests see your globals. Your main(), if you
// write one, is renamed out of the way.
//
// Your wordcount.c must define:
//   struct WordCount { char *word; size_t count; };
//   struct WordTable { struct WordCount *items; size_t len; size_t cap; };
//   int alloc_calls, alloc_count, free_count, fail_at_alloc;
// alloc_calls counts EVERY counted_malloc and counted_realloc call.
// fail_at_alloc == 0 means never fail. N means the Nth call returns NULL.
// alloc_count counts new blocks that were obtained. free_count counts freed blocks.

#define main wordcount_demo_main
#include "../src/wordcount.c"
#undef main

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

static int failures = 0;

static void check(const char *label, bool ok) {
  printf("%s  %s\n", ok ? "OK  " : "FAIL", label);
  if (!ok)
    failures++;
}

static void reset_counters(void) {
  alloc_calls = 0;
  alloc_count = 0;
  free_count = 0;
  fail_at_alloc = 0;
}

static bool entry_is(const struct WordTable *t, size_t i, const char *word,
                     size_t count) {
  return i < t->len && t->items != NULL && t->items[i].word != NULL &&
         strcmp(t->items[i].word, word) == 0 && t->items[i].count == count;
}

static void test_init(void) {
  struct WordTable t = {(struct WordCount *)0x1, 99, 99};
  reset_counters();
  table_init(&t);
  check("init: items NULL, len 0, cap 0",
        t.items == NULL && t.len == 0 && t.cap == 0);
  check("init: allocates nothing", alloc_calls == 0);
}

static void test_add_word_basic(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);

  check("add 'The': true", table_add_word(&t, "The", 3));
  check("add 'The': one entry 'the' x1, stored lowercase",
        t.len == 1 && entry_is(&t, 0, "the", 1));
  check("add 'The': cap 4, two allocations (copy, then array)",
        t.cap == 4 && alloc_calls == 2);

  int calls_before = alloc_calls;
  check("add 'THE': true", table_add_word(&t, "THE", 3));
  check("add 'THE': same entry, count 2", t.len == 1 && entry_is(&t, 0, "the", 2));
  check("add 'THE': existing word allocates nothing", alloc_calls == calls_before);

  table_free(&t);
  check("free: 1 word + 1 array = 2 frees, balanced",
        alloc_count == 2 && free_count == 2);
}

static void test_add_word_distinctness(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  table_add_word(&t, "the", 3);
  table_add_word(&t, "th", 2);
  table_add_word(&t, "then", 4);
  check("'th', 'the', 'then' are three entries", t.len == 3);

  const char *text = "hello world";
  table_add_word(&t, text, 5);
  check("slice (text, 5) of 'hello world' stores 'hello', not the rest",
        t.len == 4 && entry_is(&t, 3, "hello", 1));
  table_free(&t);
}

static void test_add_word_bad_arguments(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  check("add(NULL table) false", !table_add_word(NULL, "a", 1));
  check("add(start NULL) false", !table_add_word(&t, NULL, 1));
  check("add(length 0) false", !table_add_word(&t, "a", 0));
  check("bad arguments: table unchanged, nothing allocated",
        t.len == 0 && t.items == NULL && alloc_calls == 0);
}

static void test_growth(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  const char *words[] = {"a", "b", "c", "d", "e"};
  for (int i = 0; i < 4; i++)
    table_add_word(&t, words[i], 1);
  check("4 distinct words: cap 4", t.len == 4 && t.cap == 4);
  table_add_word(&t, words[4], 1);
  check("5 distinct words: cap 8, earlier entries intact",
        t.len == 5 && t.cap == 8 && entry_is(&t, 0, "a", 1) &&
            entry_is(&t, 4, "e", 1));
  table_free(&t);
  check("5 words: 6 frees, balanced", alloc_count == 6 && free_count == 6);
}

static void test_add_text(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);

  check("add_text: true",
        table_add_text(&t, "The cat. the dog; THE end 42 don't"));
  check("add_text: 6 distinct words", t.len == 6);
  check("add_text: 'the' x3 first", entry_is(&t, 0, "the", 3));
  check("add_text: cat, dog, end in order of first appearance",
        entry_is(&t, 1, "cat", 1) && entry_is(&t, 2, "dog", 1) &&
            entry_is(&t, 3, "end", 1));
  check("add_text: apostrophe and digits split words: 'don' and 't'",
        entry_is(&t, 4, "don", 1) && entry_is(&t, 5, "t", 1));
  table_free(&t);
  check("add_text: counters balance", alloc_count == free_count);
}

static void test_add_text_edges(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  check("text '' returns true", table_add_text(&t, ""));
  check("text '123 !! --' returns true", table_add_text(&t, "123 !! --"));
  check("no letters: no entries, nothing allocated",
        t.len == 0 && alloc_calls == 0);
  check("text ends right after a word: last word counted",
        table_add_text(&t, "end") && entry_is(&t, 0, "end", 1));
  check("text starts with separators: '  \\n\\tx' gives 'x'",
        table_add_text(&t, "  \n\tx") && entry_is(&t, 1, "x", 1));
  check("text NULL returns false", !table_add_text(&t, NULL));
  check("table NULL returns false", !table_add_text(NULL, "a"));
  table_free(&t);
}

static void test_repeated_word_is_cheap(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  enum { REPEATS = 50000 };
  static char text[REPEATS * 4 + 1];
  for (int i = 0; i < REPEATS; i++)
    memcpy(text + (size_t)i * 4, "the ", 4);
  text[REPEATS * 4] = '\0';

  check("50000 x 'the': true", table_add_text(&t, text));
  check("50000 x 'the': one entry, count 50000",
        t.len == 1 && entry_is(&t, 0, "the", REPEATS));
  check("50000 x 'the': only 2 allocation calls", alloc_calls == 2);
  table_free(&t);
}

static void test_copy_fails(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  fail_at_alloc = 1;
  check("fail at call 1 (the copy): false", !table_add_word(&t, "a", 1));
  check("fail at call 1: table still empty, nothing live",
        t.len == 0 && t.items == NULL && alloc_count == 0);
}

static void test_growth_fails_after_copy(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  fail_at_alloc = 2;
  check("fail at call 2 (array growth): false", !table_add_word(&t, "a", 1));
  check("fail at call 2: table still empty",
        t.len == 0 && t.items == NULL && t.cap == 0);
  check("fail at call 2: the word copy was freed, not leaked",
        alloc_count == 1 && free_count == 1);
}

static void test_later_growth_fails(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  table_add_word(&t, "a", 1);
  table_add_word(&t, "b", 1);
  table_add_word(&t, "c", 1);
  table_add_word(&t, "d", 1);
  struct WordCount *items_before = t.items;
  fail_at_alloc = alloc_calls + 2;

  check("fail at 5th word's growth: false", !table_add_word(&t, "e", 1));
  check("fail at 5th word's growth: items pointer, len, cap unchanged",
        t.items == items_before && t.len == 4 && t.cap == 4);
  check("fail at 5th word's growth: old entries intact",
        entry_is(&t, 0, "a", 1) && entry_is(&t, 3, "d", 1));
  check("fail at 5th word's growth: only 5 blocks live (4 words + array)",
        alloc_count - free_count == 5);

  fail_at_alloc = 0;
  table_free(&t);
  check("fail at 5th word's growth: free balances", alloc_count == free_count);
}

static void test_text_fails_midway(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  fail_at_alloc = 3;
  check("text 'aa bb cc', fail at 2nd word's copy: false",
        !table_add_text(&t, "aa bb cc"));
  check("text failed midway: 'aa' is counted, table is consistent",
        t.len == 1 && entry_is(&t, 0, "aa", 1));
  fail_at_alloc = 0;
  table_free(&t);
  check("text failed midway: free balances", alloc_count == free_count);
}

static void test_free(void) {
  struct WordTable t;
  reset_counters();
  table_init(&t);
  table_add_text(&t, "one two three");
  table_free(&t);
  check("free: 3 words + 1 array = 4 frees", free_count == 4);
  check("free: struct zeroed", t.items == NULL && t.len == 0 && t.cap == 0);
  table_free(&t);
  check("free twice: nothing more freed", free_count == 4);
  table_free(NULL);
  check("free(NULL) does nothing", free_count == 4);
}

int main(void) {
  test_init();
  test_add_word_basic();
  test_add_word_distinctness();
  test_add_word_bad_arguments();
  test_growth();
  test_add_text();
  test_add_text_edges();
  test_repeated_word_is_cheap();
  test_copy_fails();
  test_growth_fails_after_copy();
  test_later_growth_fails();
  test_text_fails_midway();
  test_free();

  printf("%d failure(s)\n", failures);
  return failures;
}
