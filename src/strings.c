#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

size_t my_strlen(const char *s) {

  size_t sz = 0;
  while (s[sz] != '\0') {
    sz++;
  }

  return sz;
}

struct CopyResult {
  bool status;
  const char *msg;
};

struct CopyResult copy_bounded(char *dst, size_t dst_capacity,
                               const char *src) {
  size_t i = 0;
  size_t src_sz = my_strlen(src) + 1;

  struct CopyResult result;

  if (src_sz > dst_capacity) {
    result.status = false;
    result.msg = "Can't copy completely because dst can't fit src. Skipping";
  } else {
    while (i < src_sz) {
      dst[i] = src[i];
      i++;
    }
    result.status = true;
    result.msg = "Copied to dst successfully";
  }
  return result;
}

static void swap_ints(int *a, int *b) {
  int temp = *a;
  *a = *b;
  *b = temp;
}

static void swap_chars(char *a, char *b) {
  char temp = *a;
  *a = *b;
  *b = temp;
}

static void reverse_in_place(char *s) {
  size_t sz = my_strlen(s);
  if (sz <= 1)
    return;
  size_t start = 0;
  size_t end = sz - 1;

  while (start < end) {
    swap_chars(&s[start], &s[end]);
    start++;
    end--;
  }
}

static bool check_reverse(const char *src, const char *expected) {
  char dst[20];
  struct CopyResult res = copy_bounded(dst, sizeof(dst), src);
  if (res.status) {
    reverse_in_place(dst);
    bool verdict = strcmp(dst, expected) == 0;
    printf("%s, %s\n", verdict ? "OK" : "FAIL", dst);
    return verdict;
  }
  printf("Couldn't copy og string, hence failed to check reverse");
  return false;
}

static bool check_copy(const char *src, size_t dst_capacity, bool expect_copied,
                       const char *expected_dst) {
  char dst[16] = "XXXXXXXXXXXXXXX";
  struct CopyResult res = copy_bounded(dst, dst_capacity, src);
  bool verdict = false;

  if (res.status == expect_copied) {
    verdict = (strcmp(dst, expected_dst) == 0);
  }
  printf("%s, %s, %s, %s \n", verdict ? "OK" : "FAIL", src, dst, res.msg);
  return verdict;
}

int test_copy(void) {
  bool r1 = check_copy("hello", 6, true, "hello");
  bool r2 = check_copy("hello!", 6, false, "XXXXXXXXXXXXXXX");
  bool r3 = check_copy("", 6, true, "");
  bool r4 = check_copy("", 0, false, "XXXXXXXXXXXXXXX");
  bool r5 = check_copy("hello", 5, false, "XXXXXXXXXXXXXXX");

  int num_correct = r1 + r2 + r3 + r4 + r5;
  printf("num_correct: %d/%d \n", num_correct, 5);

  return 5 - num_correct;
}

static bool check_strlen(const char *s) {
  size_t l1 = my_strlen(s);
  size_t act_l1 = strlen(s);
  bool verdict = act_l1 == l1;

  printf("res: %s, act: %zu, got: %zu \n", verdict ? "OK" : "FAIL", act_l1, l1);
  return verdict;
}

int test_swap(void) {
  int x = 3;
  int y = 4;
  int arr[] = {1, 2, 3};

  swap_ints(&x, &y);
  int r1 = (x == 4 && y == 3);

  swap_ints(&x, &x);
  int r2 = x == 4;

  swap_ints(&arr[0], &arr[2]);
  int r3 = (arr[0] == 3 && arr[2] == 1);

  int num_correct = r1 + r2 + r3;
  return 3 - num_correct;
}

int test_strlen(void) {
  const char *s1 = "hello";
  const char *s2 = "a";
  const char *s3 = "";

  bool r1 = check_strlen(s1);
  bool r2 = check_strlen(s2);
  bool r3 = check_strlen(s3);
  int num_correct = r1 + r2 + r3;

  printf("num_correct: %d/%d \n", num_correct, 3);
  return 3 - num_correct;
}

int test_reverse(void) {
  const char *s1 = "hello";
  const char *s2 = "abcd";
  const char *s3 = "a";
  const char *s4 = "";

  int r1 = check_reverse(s1, "olleh");
  int r2 = check_reverse(s2, "dcba");
  int r3 = check_reverse(s3, "a");
  int r4 = check_reverse(s4, "");

  // adhoc test: reversing literal string directly
  // this should fail because string literal can't be mutated
  // how do i handle exception? how do i make reverse_in_place "reject"
  // pointers to string literals?
  // char *s = "abcde";
  // reverse_in_place(s);
  // int r5 = strcmp(s, "edcba") == 0;

  // another adhoct test: reversing a reversed string
  // should bring back og string
  char s5[] = "abcde";
  reverse_in_place(s5);
  int r6 = strcmp(s5, "edcba") == 0;
  reverse_in_place(s5);
  int r7 = strcmp(s5, "abcde") == 0;

  char s6[] = "abcd";
  reverse_in_place(s6);
  int r8 = strcmp(s6, "dcba") == 0;
  reverse_in_place(s6);
  int r9 = strcmp(s6, "abcd") == 0;

  int num_correct = r1 + r2 + r3 + r4 + r6 + r7 + r8 + r9;

  printf("num_correct: %d/%d \n", num_correct, 8);
  return 8 - num_correct;
}

int main(void) {

  int r1 = test_strlen();
  int r2 = test_copy();
  int r3 = test_reverse();
  int r4 = test_swap();
  return r1 + r2 + r3 + r4;
}
