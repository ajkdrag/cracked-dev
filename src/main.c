#include <limits.h>
#include <stdio.h>

int total(int arr[], int sz) {
  int i = 0;
  int j = sz;
  int sum = 0;

  while (i < j) {
    sum += arr[i];
    i++;
  }
  return sum;
}

int minimum(int arr[], int sz) {
  int i = 0;
  int j = sz;
  int min = INT_MAX;

  while (i < j) {
    if (arr[i] < min) {
      min = arr[i];
    }
    i++;
  }
  return min;
}

int maximum(int arr[], int sz) {
  int i = 0;
  int j = sz;
  int max = INT_MIN;

  while (i < j) {
    if (arr[i] > max) {
      max = arr[i];
    }
    i++;
  }
  return max;
}

struct Report {
  int total;
  int min;
  int max;
  int avg;
  char *verdict;
};

struct Report create_report(int arr[], int sz) {
  struct Report report;
  report.total = total(arr, sz);
  report.min = minimum(arr, sz);
  report.max = maximum(arr, sz);
  report.avg = report.total / sz;
  report.verdict = report.avg > 4 ? "PASS" : "FAIL";

  return report;
}

int main(void) {
  int scores[] = {3, 4, 5, 6, 8};
  int sz = 5;

  struct Report report = create_report(scores, sz);
  printf("**** Verdict ****\n");
  printf("%d \n", report.total);
  printf("%d \n", report.min);
  printf("%d \n", report.max);
  printf("%d \n", report.avg);
  printf("%s \n", report.verdict);
  printf("****************");

  return 0;
}
