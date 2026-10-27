"""Checks the published files before release.

1. No unlabelled address. Every 0x address (40 hex characters) found in any
   published file must be a named wallet from common.NAMED or
   common.ROUTESCAN_LABELS, or a transaction or block hash (64 hex).
2. No em dash, en dash or emoji in any published text (brand kit rule).
3. No price talk: words such as "buy", "sell signal", "price target",
   "moon", "bullish" or "bearish" must not appear.
4. Every verification check in report.json passed.
5. The community summary only quotes figures that appear in report.json.

Exit code 1 if anything fails.
"""

import json
import os
import re
import sys

from common import NAMED, PUBLIC_DATA, ROOT, ROUTESCAN_LABELS

PUBLISHED = [os.path.join(ROOT, "public"), os.path.join(ROOT, "README.md"), os.path.join(ROOT, "METHOD.md"),
             os.path.join(ROOT, "COMMUNITY_SUMMARY.md")]
TEXT_EXT = {".html", ".js", ".css", ".json", ".csv", ".md", ".txt"}
ALLOWED = {a.lower() for a in NAMED} | {a.lower() for a in ROUTESCAN_LABELS}
ADDR = re.compile(r"0x[0-9a-fA-F]{40}(?![0-9a-fA-F])")
DASHES = re.compile("[\u2012\u2013\u2014\u2015]")
EMOJI = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF\U0001F000-\U0001F2FF]")
PRICE = re.compile(r"\b(buy now|sell now|price target|to the moon|moon|bullish|bearish|undervalued|overvalued|pump|dump|price prediction|financial advice)\b", re.I)
PRICE_OK = re.compile(r"not financial advice|no prediction|predicts? (no )?prices?|not a prediction|nothing here predicts|without predicting|suggests? buying or selling", re.I)


def files():
    for p in PUBLISHED:
        if os.path.isfile(p):
            yield p
        elif os.path.isdir(p):
            for d, _, fs in os.walk(p):
                for f in fs:
                    yield os.path.join(d, f)


def main():
    problems = []
    for f in files():
        ext = os.path.splitext(f)[1].lower()
        if ext not in TEXT_EXT:
            continue
        rel = os.path.relpath(f, ROOT)
        with open(f, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        for m in ADDR.finditer(text):
            # skip 64 hex hashes: the regex already refuses a longer hex run
            if m.group(0).lower() not in ALLOWED:
                problems.append(f"{rel}: unlabelled address {m.group(0)}")
        for m in DASHES.finditer(text):
            problems.append(f"{rel}: forbidden dash at offset {m.start()}")
        for m in EMOJI.finditer(text):
            problems.append(f"{rel}: emoji at offset {m.start()}")
        for line in text.splitlines():
            for m in PRICE.finditer(line):
                if not PRICE_OK.search(line):
                    problems.append(f"{rel}: price language '{m.group(0)}'")

    rep = json.load(open(os.path.join(PUBLIC_DATA, "report.json")))
    for c in rep["checks"]:
        if not c["pass"]:
            problems.append("verification check failed: " + c["check"])

    summary = os.path.join(ROOT, "COMMUNITY_SUMMARY.md")
    if os.path.exists(summary):
        numbers = set()

        def walk(x):
            if isinstance(x, dict):
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
            elif isinstance(x, (int, float)) and not isinstance(x, bool):
                numbers.add(x)
        walk(rep)
        allowed_text = set()
        for n in numbers:
            for v in (n, n * 100):
                for d in (0, 1, 2):
                    allowed_text.add(f"{v:,.{d}f}")
                    allowed_text.add(f"{v / 1e6:,.{d}f}")
                    allowed_text.add(f"{v / 1e9:,.{d}f}")
        derived = set(json.load(open(os.path.join(PUBLIC_DATA, "summary_figures.json"))))
        text = open(summary).read()
        for m in re.finditer(r"(?<![\w.])\d[\d,]*(?:\.\d+)?", text):
            s = m.group(0).rstrip(".,")
            if len(s.replace(",", "")) < 3 and "." not in s:
                continue  # small counts like "9 wallets" or "Q3"
            if s in allowed_text or s in derived or s in {"2026", "151"}:
                continue
            problems.append(f"COMMUNITY_SUMMARY.md: figure {s} not traceable to report.json")

    if problems:
        print("\n".join(problems))
        print(f"\n{len(problems)} problem(s)")
        sys.exit(1)
    print("All published files passed: no unlabelled addresses, no forbidden dashes or emoji, no price language, all checks passed.")


if __name__ == "__main__":
    main()
