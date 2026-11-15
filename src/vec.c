#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

struct Vec {
  int *data; // our internal "growable" data array
  size_t len;
  size_t cap;
};
// all these are 0 as they are global vars
int alloc_count, free_count, realloc_calls, fail_at_alloc;

void *counted_realloc(void *ptr, size_t new_size) {
  realloc_calls++;
  if (realloc_calls == fail_at_alloc)
    return NULL;
  void *new_ptr = realloc(ptr, new_size);
  if (new_ptr != NULL && ptr == NULL)
    alloc_count++;
  return new_ptr;
}

void counted_free(void *ptr) {
  if (ptr != NULL) {
    free(ptr);
    free_count++;
  }
}

void vec_init(struct Vec *v) {
  if (v == NULL) {
    return;
  }

  v->data = NULL;
  v->len = 0;
  v->cap = 0;
}

void print_vec(struct Vec *v) {
  printf("Items: ");
  for (size_t i = 0, mx = v->len; i < mx; i++) {
    printf("%d, ", (v->data)[i]);
  }
  printf("\n");
}

bool vec_remove_at(struct Vec *v, size_t index) {
  if (v == NULL) {
    return false;
  }

  if (index >= v->len)
    return false;
  while (index < (v->len) - 1) {
    (v->data)[index] = (v->data)[index + 1];
    index++;
  }

  (v->len)--;
  return true;
}

void vec_free(struct Vec *v) {
  if (v == NULL)
    return;

  counted_free(v->data);
  vec_init(v);
}

bool vec_push(struct Vec *v, int value) {
  if (v == NULL) {
    return false;
  }

  // precondition: have enough capacity!
  size_t og_cap = v->cap;
  if (v->len == v->cap) {
    if (v->cap == 0)
      v->cap = 4;
    else {
      if (v->cap > (SIZE_MAX / (sizeof(int) * 2)))
        return false;
      v->cap = 2 * (v->cap);
    }
  }

  if (v->cap != og_cap) {
    void *new_data = counted_realloc(v->data, v->cap * sizeof(*v->data));
    if (new_data == NULL) {
      v->cap = og_cap;
      return false;
    }
    v->data = new_data;
  }

  (v->data)[v->len] = value;
  (v->len)++;

  return true;
}

int main(void) {
  struct Vec v;
  vec_init(&v);
  vec_push(&v, 1);
  vec_push(&v, 2);
  vec_push(&v, 3);
  vec_push(&v, 4);
  vec_push(&v, 5);
  vec_push(&v, 6);

  print_vec(&v);

  vec_remove_at(&v, 5);

  printf("len: %zu\n", v.len);
  print_vec(&v);
  vec_free(&v);
  return 0;
}
