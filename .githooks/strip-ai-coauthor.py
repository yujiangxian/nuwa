#!/usr/bin/env python3
"""Strip AI co-author trailers from a git commit message file (commit-msg hook)."""
import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else None
if not path:
    sys.exit(0)

with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# Match Co-authored-by lines for Cursor / Claude / Copilot / common AI agents
patterns = [
    re.compile(r"^Co-authored-by:\s*Cursor\b.*$", re.I | re.M),
    re.compile(r"^Co-authored-by:\s*Claude\b.*$", re.I | re.M),
    re.compile(r"^Co-authored-by:.*cursoragent@.*$", re.I | re.M),
    re.compile(r"^Co-authored-by:.*@anthropic\.com.*$", re.I | re.M),
    re.compile(r"^Co-authored-by:\s*GitHub Copilot\b.*$", re.I | re.M),
    re.compile(r"^Co-authored-by:\s*Copilot\b.*$", re.I | re.M),
]

cleaned = text
for p in patterns:
    cleaned = p.sub("", cleaned)

# Collapse excess blank lines at end
lines = cleaned.splitlines()
while lines and lines[-1].strip() == "":
    lines.pop()
# Also drop consecutive blank lines left by removals (keep max one)
out = []
blank = 0
for line in lines:
    if line.strip() == "":
        blank += 1
        if blank <= 1:
            out.append(line)
    else:
        blank = 0
        out.append(line)

with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(out) + "\n")
