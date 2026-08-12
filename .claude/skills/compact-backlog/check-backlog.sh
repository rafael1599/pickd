#!/bin/bash
# check-backlog.sh — Checks backlog size and warns if compaction is needed.
# Used by Claude Code session-start hook. Output goes directly into conversation context.
#
# Usage: check-backlog.sh [max_lines] [pending_warning]

MAX_LINES=${1:-200}
PENDING_WARN=${2:-10}

# Find BACKLOG.md
BACKLOG=""
for candidate in \
  "BACKLOG.md" \
  ".agent/management/BACKLOG.md" \
  "docs/BACKLOG.md"; do
  if [ -f "$candidate" ]; then
    # Check if it's a pointer file (< 10 lines, contains "puntero" or "source of truth")
    if [ "$(wc -l < "$candidate")" -lt 10 ] && grep -qi "puntero\|source of truth\|autoritativo" "$candidate" 2>/dev/null; then
      # Try to extract the real path
      REAL=$(grep -oE '\.[a-zA-Z0-9_/.-]+BACKLOG\.md' "$candidate" | head -1)
      if [ -n "$REAL" ] && [ -f "$REAL" ]; then
        BACKLOG="$REAL"
        break
      fi
    fi
    BACKLOG="$candidate"
    break
  fi
done

if [ -z "$BACKLOG" ]; then
  exit 0  # No backlog found, silent exit
fi

# Count lines
LINES=$(wc -l < "$BACKLOG" | tr -d ' ')

# Count pending items
PENDING_CHECKBOXES=$(grep -c '^\- \[ \]' "$BACKLOG" 2>/dev/null || echo 0)
PENDING_HEADINGS=$(grep -c '^### [0-9].*Por hacer\|^### [0-9].*Estado.*Por hacer' "$BACKLOG" 2>/dev/null || echo 0)
# Headings without strikethrough or COMPLETADO that have a number
PENDING_P1=$(grep '^### [0-9]' "$BACKLOG" 2>/dev/null | grep -cv '~~\|COMPLETADO\|COMPLETED' || echo 0)
PENDING_TOTAL=$((PENDING_CHECKBOXES + PENDING_P1))

# Only output if there's something to warn about
WARNINGS=""

if [ "$LINES" -gt "$MAX_LINES" ]; then
  WARNINGS="${WARNINGS}Backlog: ${LINES} lines (>${MAX_LINES} limit). Consider running /compact-backlog.\n"
fi

if [ "$PENDING_TOTAL" -gt "$PENDING_WARN" ]; then
  WARNINGS="${WARNINGS}Backlog: ${PENDING_TOTAL} pending items (>${PENDING_WARN} threshold). Consider triaging before adding more.\n"
fi

if [ -n "$WARNINGS" ]; then
  printf "$WARNINGS"
fi
