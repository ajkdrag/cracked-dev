#include <malloc/malloc.h>
#include <stdio.h>
#include <stdlib.h>

int main(void) {
  size_t sizes[] = {16, 400, 100000};
  for (int i = 0; i < 3; i++) {
    char *q = malloc(sizes[i]);
    printf("req=%6zu  malloc_size=%6zu  [-1]=%zu\n", sizes[i], malloc_size(q),
           ((size_t *)q)[-1]);
    free(q);
  }
  int *p = malloc(100 * sizeof(int));
  printf("sizeof(p)        = %zu\n", sizeof p);
  printf("malloc_size(p)   = %zu\n", malloc_size(p));
  printf("word at p[-1]    = %zu\n", ((size_t *)p)[-1]);
  p = realloc(p, 1000 * sizeof(int));
  printf("after realloc    = %zu\n", malloc_size(p));
  free(p);
  return 0;
}
