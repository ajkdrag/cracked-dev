#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>

int alloc_count, free_count, fail_at_alloc = 0;

struct Node {
  int value;
  struct Node *next;
};

void *counted_malloc(size_t sz) {
  if (alloc_count + 1 == fail_at_alloc)
    return NULL;
  void *ptr = malloc(sz);
  if (ptr != NULL)
    alloc_count++;
  return ptr;
}

bool list_pop_front(struct Node **head, int *out_value) { return true; }

bool list_remove_first(struct Node **head) {}

int list_push_front(struct Node **head, int value) {
  // head is [addr1] -> [addr2] -> (Node: [el_1], next) ...
  // head is pointer to a pointer
  // This func returns the number of allocation done
  // 0 means failed to allocate, 1 means successfully allocated
  struct Node *new_node = counted_malloc(sizeof *new_node);
  if (new_node == NULL) {
    return 0; // allocation failed
  }
  new_node->value = value;
  new_node->next = *head;
  *head = new_node;
  return 1;
}

void counted_free(void *ptr) {
  if (ptr != NULL) {
    free(ptr);
    free_count++;
  }
}

void list_free(struct Node **head) {
  if (head == NULL)
    return;
  struct Node *curr = *head;
  while (curr != NULL) {
    *head = curr->next;
    counted_free(curr);
    curr = *head;
  }
}

void print_ll(struct Node **head) {
  if (head == NULL)
    return;

  struct Node *curr = *head;
  if (curr == NULL)
    return;
  int size = 0;
  while (curr != NULL) {
    printf("Curr: %d \n", curr->value);
    struct Node *next = curr->next;
    size++;
    curr = next;
  }
  printf("size of LL: %d\n", size);
}

int main(void) {

  struct Node *head = NULL;

  list_push_front(&head, 3);
  list_push_front(&head, 4);
  list_push_front(&head, 2);
  list_push_front(&head, 1);
  print_ll(&head);

  return 0;
}
