#!/bin/sh
set -e
mkdir -p out
clang -std=c11 -g -O0 \
  -Wall -Wextra -Wconversion -Wshadow -Werror \
  -Wstrict-prototypes -fsanitize=undefined \
  tests/vec_test.c -o out/vec_test
./out/vec_test
