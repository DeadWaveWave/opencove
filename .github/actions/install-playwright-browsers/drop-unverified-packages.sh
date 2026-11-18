#!/usr/bin/env bash
# Deletes every .deb file in the given directory whose SHA256 differs from the one the current
# apt package index lists for its package, version and architecture, or whose version the index
# no longer lists. apt itself reuses a file already in its archive directory when only the size
# matches, so this is what keeps a restored cache from changing what gets installed. apt then
# downloads whatever was deleted.
#
# Usage: drop-unverified-packages.sh <archive-dir>   (run after `apt-get update`)
set -euo pipefail

archive_dir="${1:?usage: drop-unverified-packages.sh <archive-dir>}"
kept=0
dropped=0

shopt -s nullglob
for deb in "$archive_dir"/*.deb; do
  expected=''
  # shellcheck disable=SC2016 # the dpkg-deb format fields are meant literally
  if fields="$(dpkg-deb --show --showformat='${Package} ${Version} ${Architecture}' "$deb" 2>/dev/null)"; then
    read -r package version architecture <<<"$fields"
    if [ "$architecture" = all ]; then
      selector="${package}=${version}"
    else
      selector="${package}:${architecture}=${version}"
    fi
    # An explicit version selects that version's record from the index, so no candidate lookup
    # (--no-all-versions) is needed; it would build apt's policy for every package on each call.
    # awk reads all input rather than exiting at the first match, so apt-cache never gets SIGPIPE.
    expected="$(apt-cache show "$selector" 2>/dev/null | awk '/^SHA256: / && !found { print $2; found = 1 }')" || expected=''
  fi
  actual="$(sha256sum "$deb" | cut -d' ' -f1)"
  if [ -n "$expected" ] && [ "$expected" = "$actual" ]; then
    kept=$((kept + 1))
  else
    rm -f -- "$deb"
    dropped=$((dropped + 1))
  fi
done

echo "Cached package files verified against the package index: ${kept} kept, ${dropped} dropped"
