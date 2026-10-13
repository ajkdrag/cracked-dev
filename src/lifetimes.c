#include <stddef.h>
#include <stdio.h>

struct MyStruct {
  char z;
  int x;
  char *y;
};

void print_size(int *arr) {
  printf("size of arr inside func: %zu \n", sizeof(arr));
}

int main(void) {
  int x = 3;
  char y[6] = "abcde"; // last char is \0
  // A pointer to a local dangles once its function returns, because the frame
  // is gone and the pointer still holds the old address. here we don't worry
  // abt it because the pointer pt and the var x both are in main so they die
  // together
  int *pt = &x;
  struct MyStruct my_struct = {.y = "abcde"};
  my_struct.x = x;
  my_struct.z = y[0];

  printf("size of int: %zu, addr: %p \n", sizeof(x), (void *)&x);
  printf("size of char arr: %zu, addr: %p \n", sizeof(y), (void *)&y);
  printf("size of ptr: %zu, addr: %p \n", sizeof(pt), (void *)&pt);

  int arr[5] = {1, 2, 3, 4, 5};
  // size of arr inside func is basically size of the pointer to first el of arr
  // that's why sizeof differs
  print_size(arr);
  printf("size of int arr: %zu, addr: %p \n", sizeof(arr), (void *)&arr);
  printf("size of int arr first el: %zu, addr: %p \n", sizeof(arr[0]),
         (void *)&arr[0]);

  printf("printing struct stuff ....\n");
  printf("addr of struct: %p \n", (void *)&my_struct);
  // offset of z will be 0 anyway so not printing
  printf("struct offset x: %zu \n", offsetof(struct MyStruct, x));
  printf("struct offset y: %zu \n", offsetof(struct MyStruct, y));

  // expectation would be: 1 + 4 + 6 = 11, but C might add padding bytes
  // probably it will be 4 (1+3 padding) + 4 + 8 = 16
  printf("size of struct: %zu \n", sizeof(my_struct));

  // comparing addrs of my_struct.y (string literal on static data) and y (copy
  // on the stack) y is a stack copy, my_struct.y points at the literal
  printf("struct.y addr: %p , y addr: %p \n", (void *)my_struct.y, (void *)y);

  // *y dereferences y (which decayed to char * to 1st element of arr)
  // deferencing a char * gives us the 1st el, and size of first el is size of
  // char which is 1
  // &y is char (*)[6] , after dereferencing it we get the entire arr (instead
  // of just a char) so sizeof(char array of size 6) is 6
  printf("%zu , %zu , %zu, %zu \n", sizeof(y), sizeof(*y), sizeof(*&y),
         sizeof(y + 0));
}
