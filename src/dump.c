#include <stdio.h>
#include <string.h>

struct MyStruct {
  char z;
  int x;
  char *y;
};

void dump_bytes(const void *p, size_t n) {
  const unsigned char *bytes_ptr = p;

  size_t i = 0;
  while (i < n) {
    if (i % 8 == 0) {
      printf("%zu: ", i);
    }
    printf("%02x ", *(bytes_ptr + i));
    i += 1;
    if (i % 8 == 0) {
      printf("\n");
    }
  }
  if (i % 8 != 0)
    printf("\n");
}

int main(void) {
  int x = 0x01020304;
  char s[] = "hi";
  struct MyStruct mys;
  memset(&mys, 0xAA, sizeof(mys));
  mys.x = x;
  mys.y = s;
  mys.z = 'h';
  //
  dump_bytes(&x, sizeof(x));
  dump_bytes(s, sizeof(s));
  dump_bytes(&mys, sizeof(mys));

  printf("%p", (void *)mys.y);
  return 0;
}
