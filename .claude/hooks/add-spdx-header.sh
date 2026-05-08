#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Claude Code PostToolUse hook: ensure the Apache-2.0 SPDX header is present
# at the top of newly-written source files. Runs after any Write tool call;
# idempotent.

set -e

input=$(cat)

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

[ "$tool_name" = "Write" ] || exit 0
[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

case "$file_path" in
  *.go|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    ;;
  *)
    exit 0
    ;;
esac

if head -1 "$file_path" | grep -q "SPDX-License-Identifier"; then
  exit 0
fi

header="// SPDX-License-Identifier: Apache-2.0"
tmp=$(mktemp)
{ printf '%s\n\n' "$header"; cat "$file_path"; } > "$tmp"
mv "$tmp" "$file_path"
echo "Added SPDX header to $file_path" >&2
