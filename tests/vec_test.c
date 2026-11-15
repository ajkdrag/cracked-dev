// Tests for src/vec.c. Run from the project root: sh tests/run_vec_test.sh
//
// We include the .c file so the tests see your globals. Your main(), if you
// write one, is renamed out of the way.
//
// Your vec.c must define: struct Vec { int *data; size_t len; size_t cap; };
// and the globals: int alloc_count, free_count, realloc_calls, fail_at_alloc;
// fail_at_alloc == 0 means never fail. N means the Nth counted_realloc call
// returns NULL and leaves the old block untouched.

#define main vec_demo_main
#include "../src/vec.c"
#undef main

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#ifdef __APPLE__
#include <malloc/malloc.h>
#define usable_bytes(p) malloc_size(p)
#else
#include <malloc.h>
#define usable_bytes(p) malloc_usable_size(p)
#endif

static int failures = 0;

static void check(const char *label, bool ok) {
  printf("%s  %s\n", ok ? "OK  " : "FAIL", label);
  if (!ok)
    failures++;
}

static void reset_counters(void) {
  alloc_count = 0;
  free_count = 0;
  realloc_calls = 0;
  fail_at_alloc = 0;
}

static bool vec_matches(const struct Vec *v, const int *expected, size_t n) {
  if (v->len != n || (n > 0 && v->data == NULL))
    return false;
  for (size_t i = 0; i < n; i++)
    if (v->data[i] != expected[i])
      return false;
  return true;
}

static bool push_all(struct Vec *v, const int *values, size_t n) {
  bool all_pushed = true;
  for (size_t i = 0; i < n; i++)
    all_pushed = vec_push(v, values[i]) && all_pushed;
  return all_pushed;
}

static void test_init(void) {
  struct Vec v = {(int *)0x1, 99, 99};
  reset_counters();
  vec_init(&v);
  check("init: data NULL, len 0, cap 0",
        v.data == NULL && v.len == 0 && v.cap == 0);
  check("init: allocates nothing", alloc_count == 0 && realloc_calls == 0);
}

static void test_push_growth(void) {
  struct Vec v;
  reset_counters();
  vec_init(&v);

  check("push 1st: true", vec_push(&v, 10));
  check("push 1st: len 1, cap 4, one realloc",
        v.len == 1 && v.cap == 4 && realloc_calls == 1);
  vec_push(&v, 20);
  vec_push(&v, 30);
  vec_push(&v, 40);
  check("push 4th: still cap 4, still one realloc",
        v.len == 4 && v.cap == 4 && realloc_calls == 1);
  vec_push(&v, 50);
  check("push 5th: cap doubles to 8, two reallocs",
        v.len == 5 && v.cap == 8 && realloc_calls == 2);
  const int expected[] = {10, 20, 30, 40, 50};
  check("push 5th: old elements survive the move", vec_matches(&v, expected, 5));
  check("push 5th: block is at least cap * sizeof(int) bytes",
        v.data != NULL && usable_bytes(v.data) >= v.cap * sizeof(int));
  check("push 5th: block is under 2 * cap * sizeof(int) bytes (no sizeof(int *))",
        v.data != NULL && usable_bytes(v.data) < 2 * v.cap * sizeof(int));

  vec_free(&v);
  check("push: counters balance (one block, one free)",
        alloc_count == 1 && free_count == 1);
}

static void test_push_many(void) {
  struct Vec v;
  reset_counters();
  vec_init(&v);
  const int count = 100000;
  bool values_ok = true;
  for (int i = 0; i < count; i++)
    vec_push(&v, i);
  for (int i = 0; i < count && values_ok; i++)
    values_ok = v.len == (size_t)count && v.data[i] == i;

  check("100000 pushes: len and cap", v.len == 100000 && v.cap == 131072);
  check("100000 pushes: exactly 16 reallocs (doubling, not +1)",
        realloc_calls == 16);
  check("100000 pushes: every value intact", values_ok);
  vec_free(&v);
  check("100000 pushes: counters balance", alloc_count == 1 && free_count == 1);
}

static void test_first_growth_fails(void) {
  struct Vec v;
  reset_counters();
  vec_init(&v);
  fail_at_alloc = 1;

  check("fail at 1st realloc: push returns false", !vec_push(&v, 1));
  check("fail at 1st realloc: vec still empty",
        v.data == NULL && v.len == 0 && v.cap == 0);
  fail_at_alloc = 0;
  check("fail at 1st realloc: next push works", vec_push(&v, 2) && v.len == 1);
  vec_free(&v);
  check("fail at 1st realloc: counters balance",
        alloc_count == 1 && free_count == 1);
}

static void test_later_growth_fails(void) {
  struct Vec v;
  reset_counters();
  vec_init(&v);
  const int four[] = {1, 2, 3, 4};
  push_all(&v, four, 4);
  int *block_before = v.data;
  fail_at_alloc = 2;

  check("fail at 2nd realloc: 5th push returns false", !vec_push(&v, 5));
  check("fail at 2nd realloc: data pointer, len, cap unchanged",
        v.data == block_before && v.len == 4 && v.cap == 4);
  check("fail at 2nd realloc: old elements intact", vec_matches(&v, four, 4));

  fail_at_alloc = 0;
  vec_free(&v);
  check("fail at 2nd realloc: old block was still ours, freed once",
        alloc_count == 1 && free_count == 1);
}

static void test_third_growth_fails(void) {
  struct Vec v;
  reset_counters();
  vec_init(&v);
  const int eight[] = {1, 2, 3, 4, 5, 6, 7, 8};
  push_all(&v, eight, 8);
  fail_at_alloc = 3;

  check("fail at 3rd realloc: 9th push returns false", !vec_push(&v, 9));
  check("fail at 3rd realloc: len 8, cap 8, elements intact",
        v.len == 8 && v.cap == 8 && vec_matches(&v, eight, 8));

  fail_at_alloc = 0;
  vec_free(&v);
}

static void test_size_overflow(void) {
  struct Vec v = {NULL, 0, 0};
  reset_counters();
  v.cap = SIZE_MAX / sizeof(int) / 2 + 1;
  v.len = v.cap;

  check("overflow: push returns false", !vec_push(&v, 1));
  check("overflow: no realloc attempted", realloc_calls == 0);
  check("overflow: len and cap unchanged",
        v.len == SIZE_MAX / sizeof(int) / 2 + 1 && v.cap == v.len);
}

static void check_remove(const char *label, const int *before, size_t before_n,
                         size_t index, bool expect_removed, const int *after,
                         size_t after_n) {
  char text[96];
  struct Vec v;
  reset_counters();
  vec_init(&v);
  push_all(&v, before, before_n);
  int reallocs_for_setup = realloc_calls;
  size_t cap_before = v.cap;

  bool removed = vec_remove_at(&v, index);

  snprintf(text, sizeof text, "remove %s: return value", label);
  check(text, removed == expect_removed);
  snprintf(text, sizeof text, "remove %s: remaining elements", label);
  check(text, vec_matches(&v, after, after_n));
  snprintf(text, sizeof text, "remove %s: cap unchanged, no realloc, no free", label);
  check(text, v.cap == cap_before && realloc_calls == reallocs_for_setup &&
                  free_count == 0);

  vec_free(&v);
  snprintf(text, sizeof text, "remove %s: counters balance after free", label);
  check(text, alloc_count == free_count);
}

static void test_remove_at(void) {
  const int list[] = {1, 2, 3};
  const int without_first[] = {2, 3};
  const int without_middle[] = {1, 3};
  const int without_last[] = {1, 2};
  const int single[] = {7};

  check_remove("first", list, 3, 0, true, without_first, 2);
  check_remove("middle", list, 3, 1, true, without_middle, 2);
  check_remove("last", list, 3, 2, true, without_last, 2);
  check_remove("only element", single, 1, 0, true, NULL, 0);
  check_remove("index == len", list, 3, 3, false, list, 3);
  check_remove("index far past len", list, 3, 1000, false, list, 3);
  check_remove("empty vec", NULL, 0, 0, false, NULL, 0);
}

static void test_null_and_free(void) {
  struct Vec v;
  reset_counters();
  vec_init(&v);
  vec_push(&v, 1);

  check("push(NULL, v) returns false", !vec_push(NULL, 1));
  check("remove_at(NULL, 0) returns false", !vec_remove_at(NULL, 0));
  vec_free(NULL);
  check("free(NULL) does nothing", free_count == 0);

  vec_free(&v);
  check("free: zeroes the struct", v.data == NULL && v.len == 0 && v.cap == 0);
  vec_free(&v);
  check("free twice: second call frees nothing",
        alloc_count == 1 && free_count == 1);

  struct Vec empty;
  vec_init(&empty);
  vec_free(&empty);
  check("free of never-pushed vec frees nothing", free_count == 1);
}

int main(void) {
  test_init();
  test_push_growth();
  test_push_many();
  test_first_growth_fails();
  test_later_growth_fails();
  test_third_growth_fails();
  test_size_overflow();
  test_remove_at();
  test_null_and_free();

  printf("%d failure(s)\n", failures);
  return failures;
}
