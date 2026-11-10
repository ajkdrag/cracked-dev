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

void counted_free(void *ptr) {
  if (ptr != NULL) {
    free(ptr);
    free_count++;
  }
}

void list_reverse(struct Node **head) {
  if (head == NULL)
    return;
  if (*head == NULL)
    return;

  struct Node *curr = *head;
  struct Node *prev = NULL;

  while (curr != NULL) {
    struct Node *next = curr->next;
    curr->next = prev;
    prev = curr;
    curr = next;
  }
  // if *head was NULL, the while loop won't run
  // and we just reassign NULL to *head again, thus nothing changed
  *head = prev;
}

bool list_pop_front(struct Node **head, int *out_value) {
  if (head == NULL || out_value == NULL)
    return false;
  struct Node *first_item = *head;
  if (first_item == NULL)
    return false;

  *head = first_item->next;
  *out_value = first_item->value;
  counted_free(first_item);
  return true;
}

bool list_remove_first(struct Node **head, int value) {
  if (head == NULL)
    return false;
  while ((*head != NULL) && ((*head)->value != value)) {
    head = &((*head)->next);
  }
  if (*head == NULL)
    return false;
  struct Node *to_remove = *head;
  *head = (*head)->next;
  counted_free(to_remove);
  return true;
}

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

size_t get_length(struct Node **head) {
  if (head == NULL) {
    return 0;
  }

  struct Node *curr = *head;
  size_t size = 0;
  while (curr != NULL) {
    struct Node *next = curr->next;
    size++;
    curr = next;
  }
  return size;
}

void print_ll(struct Node **head) {
  printf("Items: ");
  if (head == NULL) {
    return;
  }

  struct Node *curr = *head;
  while (curr != NULL) {
    printf("%d, ", curr->value);
    struct Node *next = curr->next;
    curr = next;
  }
  printf("\n");
}

int main(void) {

  struct Node *head = NULL;

  list_push_front(&head, 1);
  print_ll(&head);
  list_reverse(&head);
  print_ll(&head);
  return 0;
}
