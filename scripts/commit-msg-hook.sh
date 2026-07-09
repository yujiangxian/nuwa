#!/bin/bash
# ── Nuwa commit-msg hook ──────────────────────────────────────
# 阻止在提交信息中包含 "Co-Authored-By" 或 "Claude" 署名。
# ───────────────────────────────────────────────────────────────

MSG=$(cat "$1")

if echo "$MSG" | grep -qiE "Co-Authored-By|Co-authored-by"; then
  echo ""
  echo "  Blocked: commit message contains 'Co-Authored-By'."
  echo "  This project's commits are authored solely by yujiangxian."
  echo ""
  exit 1
fi

exit 0
