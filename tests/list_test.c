// Tests for src/list.c. Build and run from the project root:
//   clang -std=c11 -g -O0 -Wall -Wextra -Wconversion -Wshadow -Werror \
//     -Wstrict-prototypes -fsanitize=undefined tests/list_test.c -o /tmp/list_test \
//     && /tmp/list_test
//
// We include the .c file so the tests see your globals and static state.
// Your main() is renamed out of the way. @Incomplete: the stack-depth case
// at the bottom is a test of list_free, not of anything in this file.

#define main list_demo_main
#include "../src/list.c"
#undef main

#include <stdbool.h>

// Your list.c must define: int alloc_count, free_count, fail_at_alloc;
// fail_at_alloc == 0 means never fail. N means the Nth counted_malloc fails.

static int failures = 0;

static void check(const char *label, bool ok) {
  printf("%s  %s\n", ok ? "OK  " : "FAIL", label);
  if (!ok)
    failures++;
}

static void reset_counters(void) {
  alloc_count = 0;
  free_count = 0;
  fail_at_alloc = 0;
}

static bool counters_balanced(int expected) {
  return alloc_count == expected && free_count == expected;
}

// Walks the list and compares with expected[0..n). Also checks the list ends.
static bool list_matches(struct Node *head, const int *expected, size_t n) {
  struct Node *node = head;
  for (size_t i = 0; i < n; i++) {
    if (node == NULL || node->value != expected[i])
      return false;
    node = node->next;
  }
  return node == NULL;
}

static void test_push_then_free(int count) {
  char label[64];
  struct Node *head = NULL;
  reset_counters();

  bool all_pushed = true;
  for (int i = 0; i < count; i++)
    all_pushed = list_push_front(&head, i) && all_pushed;
  list_free(&head);

  snprintf(label, sizeof label, "%d nodes: every push succeeds", count);
  check(label, all_pushed);
  snprintf(label, sizeof label, "%d nodes: alloc_count == free_count == %d", count,
           count);
  check(label, counters_balanced(count));
  snprintf(label, sizeof label, "%d nodes: *head is NULL after free", count);
  check(label, head == NULL);
}

static void test_push_order(void) {
  struct Node *head = NULL;
  reset_counters();
  list_push_front(&head, 10);
  list_push_front(&head, 20);
  list_push_front(&head, 30);

  const int expected[] = {30, 20, 10};
  check("push order: newest node is first", list_matches(head, expected, 3));
  list_free(&head);
}

static void test_free_twice(void) {
  struct Node *head = NULL;
  reset_counters();
  list_push_front(&head, 1);
  list_push_front(&head, 2);
  list_free(&head);
  list_free(&head);

  check("free twice: counters unchanged by second call", counters_balanced(2));
  check("free twice: *head still NULL", head == NULL);
}

static void test_free_null_pointer(void) {
  reset_counters();
  list_free(NULL);
  check("list_free(NULL) does nothing", counters_balanced(0));
}

static void test_failed_allocation(void) {
  struct Node *head = NULL;
  reset_counters();
  fail_at_alloc = 3;

  bool first = list_push_front(&head, 1);
  bool second = list_push_front(&head, 2);
  bool third = list_push_front(&head, 3);

  check("fail at 3rd: first two pushes succeed", first && second);
  check("fail at 3rd: third push reports failure", !third);
  const int expected[] = {2, 1};
  check("fail at 3rd: list is still 2 -> 1", list_matches(head, expected, 2));
  check("fail at 3rd: failed call is not counted as an allocation",
        alloc_count == 2);

  list_free(&head);
  check("fail at 3rd: free balances the counters", counters_balanced(2));
}

static void test_long_list(void) {
  struct Node *head = NULL;
  reset_counters();
  const int count = 200000;
  for (int i = 0; i < count; i++)
    list_push_front(&head, i);
  list_free(&head);
  check("200000 nodes: free finishes and counters balance",
        counters_balanced(count) && head == NULL);
}

// Builds a list whose order from the front is values[0], values[1], ...
// Pushes from the back, so the list reads the same way the array does.
static struct Node *list_from_array(const int *values, size_t n) {
  struct Node *head = NULL;
  for (size_t i = n; i > 0; i--)
    list_push_front(&head, values[i - 1]);
  return head;
}

static void test_pop_front(void) {
  struct Node *head = NULL;
  reset_counters();
  const int values[] = {3, 2, 1};
  head = list_from_array(values, 3);

  int out = -99;
  check("pop: first pop returns true and 3",
        list_pop_front(&head, &out) && out == 3);
  check("pop: second pop returns true and 2",
        list_pop_front(&head, &out) && out == 2);
  check("pop: third pop returns true and 1",
        list_pop_front(&head, &out) && out == 1);
  check("pop: list is empty and 3 nodes were freed",
        head == NULL && free_count == 3);

  out = -99;
  check("pop: empty list returns false", !list_pop_front(&head, &out));
  check("pop: empty list leaves *out_value untouched", out == -99);
  check("pop: counters balance", counters_balanced(3));
}

// One list_remove_first case. before/after are the whole list as arrays.
static void check_remove(const char *label, const int *before, size_t before_n,
                         int value, bool expect_removed, const int *after,
                         size_t after_n) {
  char text[96];
  reset_counters();
  struct Node *head = list_from_array(before, before_n);
  int allocs_for_setup = alloc_count;

  bool removed = list_remove_first(&head, value);

  snprintf(text, sizeof text, "remove %s: return value", label);
  check(text, removed == expect_removed);
  snprintf(text, sizeof text, "remove %s: remaining list", label);
  check(text, list_matches(head, after, after_n));
  snprintf(text, sizeof text, "remove %s: one node freed iff removed", label);
  check(text, free_count == (expect_removed ? 1 : 0));
  snprintf(text, sizeof text, "remove %s: no new allocation", label);
  check(text, alloc_count == allocs_for_setup);

  list_free(&head);
  snprintf(text, sizeof text, "remove %s: counters balance after free", label);
  check(text, counters_balanced(alloc_count));
}

static void test_remove_first(void) {
  const int list[] = {1, 2, 3};
  const int without_first[] = {2, 3};
  const int without_middle[] = {1, 3};
  const int without_last[] = {1, 2};
  const int single[] = {7};
  const int dups[] = {5, 7, 5};
  const int dups_after[] = {7, 5};

  check_remove("first node", list, 3, 1, true, without_first, 2);
  check_remove("middle node", list, 3, 2, true, without_middle, 2);
  check_remove("last node", list, 3, 3, true, without_last, 2);
  check_remove("only node", single, 1, 7, true, NULL, 0);
  check_remove("missing value", list, 3, 99, false, list, 3);
  check_remove("empty list", NULL, 0, 1, false, NULL, 0);
  check_remove("duplicates (first match only)", dups, 3, 5, true, dups_after, 2);

  const int unsorted[] = {3, 1, 2};
  const int unsorted_after[] = {3, 1};
  check_remove("unsorted list, match after larger values", unsorted, 3, 2, true,
               unsorted_after, 2);
}

static void test_null_arguments(void) {
  struct Node *head = NULL;
  reset_counters();
  const int values[] = {2, 1};
  head = list_from_array(values, 2);

  int out = -99;
  check("pop(NULL, &out) returns false", !list_pop_front(NULL, &out));
  check("pop(NULL, &out) leaves out untouched", out == -99);
  check("pop(&head, NULL) returns false", !list_pop_front(&head, NULL));
  check("pop(&head, NULL) frees nothing, list intact",
        free_count == 0 && list_matches(head, values, 2));
  check("remove(NULL, v) returns false", !list_remove_first(NULL, 1));
  check("remove(NULL, v) frees nothing", free_count == 0);

  list_free(&head);
}

// Reverse must only rewire next pointers: same nodes, same addresses, no alloc, no free.
static void check_reverse(const char *label, const int *before, size_t n) {
  char text[96];
  reset_counters();
  struct Node *head = list_from_array(before, n);
  int allocs_for_setup = alloc_count;

  struct Node *old_nodes[8] = {0};
  struct Node *walk = head;
  for (size_t i = 0; i < n; i++, walk = walk->next)
    old_nodes[i] = walk;

  int reversed[8];
  for (size_t i = 0; i < n; i++)
    reversed[i] = before[n - 1 - i];
  fail_at_alloc = 1;
  list_reverse(&head);
  fail_at_alloc = 0;

  snprintf(text, sizeof text, "reverse %s: values reversed", label);
  check(text, list_matches(head, reversed, n));
  snprintf(text, sizeof text, "reverse %s: no alloc, no free", label);
  check(text, alloc_count == allocs_for_setup && free_count == 0);
  bool same_nodes = true;
  walk = head;
  for (size_t i = 0; i < n; i++, walk = walk->next)
    same_nodes = same_nodes && walk == old_nodes[n - 1 - i];
  snprintf(text, sizeof text, "reverse %s: same node addresses, flipped", label);
  check(text, same_nodes);

  list_free(&head);
  snprintf(text, sizeof text, "reverse %s: counters balance after free", label);
  check(text, counters_balanced(allocs_for_setup));
}

static void test_reverse(void) {
  const int one[] = {7};
  const int two[] = {1, 2};
  const int three[] = {1, 2, 3};
  const int dups[] = {4, 4, 9, 4};
  check_reverse("empty", NULL, 0);
  check_reverse("one node", one, 1);
  check_reverse("two nodes", two, 2);
  check_reverse("three nodes", three, 3);
  check_reverse("duplicates", dups, 4);

  list_reverse(NULL);
  check("reverse(NULL) does nothing and does not crash", true);

  struct Node *head = NULL;
  reset_counters();
  const int count = 200000;
  for (int i = 0; i < count; i++)
    list_push_front(&head, i);
  list_reverse(&head);
  bool ascending = true;
  int expected = 0;
  for (struct Node *node = head; node != NULL; node = node->next)
    ascending = ascending && node->value == expected++;
  check("reverse 200000 nodes: iterative, ascending, none lost",
        ascending && expected == count);
  list_free(&head);
}

int main(void) {
  test_push_then_free(0);
  test_push_then_free(1);
  test_push_then_free(5);
  test_push_order();
  test_free_twice();
  test_free_null_pointer();
  test_failed_allocation();
  test_long_list();
  test_pop_front();
  test_remove_first();
  test_null_arguments();
  test_reverse();

  printf("%d failure(s)\n", failures);
  return failures;
}
