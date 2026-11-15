#!/bin/sh
set -e
mkdir -p out
clang -std=c11 -g -O0 \
  -Wall -Wextra -Wconversion -Wshadow -Werror \
  -Wstrict-prototypes -fsanitize=undefined \
  tests/wordcount_test.c -o out/wordcount_test
./out/wordcount_test
