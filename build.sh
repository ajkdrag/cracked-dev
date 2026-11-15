#!/bin/sh

# set -e
# mkdir -p out
# clang -std=c11 -g -O0 \
#   -Wall -Wextra -Wconversion -Wshadow -Werror \
#   -Wstrict-prototypes -fsanitize=undefined \
#   -o out/vec src/vec.c
#
#
set -e
clang -std=c11 -O0 -Wall -Wextra -o out/try src/try.c
