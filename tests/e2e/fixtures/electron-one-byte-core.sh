#!/bin/sh
set -eu

# Preserve the original byte limits for failure diagnostics. This runs before
# Electron starts, including Chromium's zygotes (which precede JS preloads).
OPENCOVE_E2E_INITIAL_CORE_LIMIT=$(prlimit --pid "$$" --core --output SOFT,HARD --noheadings)
export OPENCOVE_E2E_INITIAL_CORE_LIMIT

# Zero is ignored for piped dumps. Exactly ONE BYTE aborts the pipe before the
# collector starts, and is below ELF's minimum dump size. prlimit uses bytes;
# `ulimit -c 1` uses blocks and does not select this kernel exception.
# https://github.com/torvalds/linux/blob/v7.0/fs/coredump.c#L918-L943
exec prlimit --core=1:1 -- "$OPENCOVE_TEST_ELECTRON_EXECUTABLE" \
  -r "$OPENCOVE_TEST_PLAYWRIGHT_LOADER" "$@"
