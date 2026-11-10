// Property test for list_reverse. You write test_reverse_matches_array_oracle.
// Run from the project root: sh tests/run_list_oracle_test.sh
#define main list_demo_main
#include "../src/list.c"
#undef main

static unsigned int rng_state = 12345;

static unsigned int next_random(void) {
  rng_state = rng_state * 1664525u + 1013904223u;
  return rng_state >> 8;
}

// Fills values[0..n) with random ints in [0, mod) so duplicates are common.
static void fill_random(int *values, size_t n, unsigned int mod) {
  for (size_t i = 0; i < n; i++)
    values[i] = (int)(next_random() % mod);
}

// TODO(me): for 1000 random lengths in [0, 64], build a list from a random
// array, reverse the list, reverse an array copy by hand (the oracle),
// compare element by element and length. Print the seed state and the failing
// length if a case fails. Return the number of failing cases.
static int test_reverse_matches_array_oracle(void) {

  int values[1000];
  int reversed[1000];

  int num_failures = 0;
  size_t n_test_cases = 1000;
  size_t max_size = 65;
  for (size_t cnt = 0; cnt < n_test_cases; ++cnt) {
    unsigned int rng_state_local = rng_state;
    size_t len = (next_random() % max_size);
    fill_random(values, len, 5);

    struct Node *head = NULL;
    for (size_t i = len; i > 0; i--) {
      list_push_front(&head, values[i - 1]);
      reversed[len - i] = values[i - 1];
    }

    list_reverse(&head);
    size_t sz_ll = get_length(&head);

    bool failed = false;

    if (sz_ll != len) {
      num_failures++;
      failed = true;
    } else {
      // compare the elements
      struct Node *curr = head;
      int index = 0;
      while (curr != NULL) {
        if (curr->value != reversed[index]) {
          num_failures++;
          failed = true;
          break;
        }
        struct Node *next = curr->next;
        index++;
        curr = next;
      }
    }

    // cleanup
    list_free(&head);

    // reporting
    if (failed) {
      printf("Failed at iter: %zu, length: %zu, rng: %u\n", cnt, len,
             rng_state_local);
    }
  }

  return num_failures;
}

int main(void) {
  int failures = test_reverse_matches_array_oracle();
  printf("%d failure(s)\n", failures);
  return failures;
}
