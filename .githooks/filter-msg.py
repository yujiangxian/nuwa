import sys
import re
text = sys.stdin.read()
patterns = [
    r"^Co-authored-by:\s*Cursor\b.*$",
    r"^Co-authored-by:\s*Claude\b.*$",
    r"^Co-authored-by:.*cursoragent@.*$",
    r"^Co-authored-by:.*@anthropic\.com.*$",
    r"^Co-authored-by:\s*GitHub Copilot\b.*$",
    r"^Co-authored-by:\s*Copilot\b.*$",
]
for p in patterns:
    text = re.sub(p, "", text, flags=re.I | re.M)
lines = [l for l in text.splitlines()]
while lines and lines[-1].strip() == "":
    lines.pop()
# collapse double blanks
out, blank = [], 0
for line in lines:
    if line.strip() == "":
        blank += 1
        if blank <= 1: out.append(line)
    else:
        blank = 0
        out.append(line)
sys.stdout.write("\n".join(out) + "\n")
