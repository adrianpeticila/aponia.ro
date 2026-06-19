#!/usr/bin/env bash
# Pre-deploy guard: detects unclosed <noscript> tags that swallow <body> when JS is ON.
# Root cause of the S111-S114 blank-page bug (e.g. `<noscript>  <style>` with no </noscript>).
# A browser with scripting enabled parses everything after an unclosed <noscript> as raw
# text, eating </head> + the whole <body> -> blank page. curl/grep won't see it; a real
# parser does. This catches it at the byte level before deploy.
#
# Usage: ./check_noscript_balance.sh        (run from repo root)
# Exit:  0 = all balanced, 1 = imbalance found (blocks deploy in CI).

set -euo pipefail
cd "$(dirname "$0")"

bad=0
while IFS= read -r f; do
  open=$( { grep -o "<noscript" "$f" || true; } | wc -l | tr -d ' ')
  close=$( { grep -o "</noscript>" "$f" || true; } | wc -l | tr -d ' ')
  if [ "$open" != "$close" ]; then
    printf "IMBALANCE  %-45s open=%s close=%s\n" "$f" "$open" "$close"
    bad=$((bad + 1))
  fi
done < <(find . -name "*.html" -not -path "./.git/*")

if [ "$bad" -ne 0 ]; then
  echo ""
  echo "FAIL: $bad page(s) with unclosed <noscript>. These render BLANK with JS enabled."
  echo "Fix: remove the stray <noscript> prefix (usually before <style> in <head>)."
  exit 1
fi

echo "OK: all HTML pages have balanced <noscript> tags."
