#!/bin/sh
set -e
mkdir -p out
clang -std=c11 -g -O0 \
  -Wall -Wextra -Wconversion -Wshadow -Werror \
  -Wstrict-prototypes -fsanitize=undefined \
  tests/list_test.c -o out/list_test
./out/list_test
