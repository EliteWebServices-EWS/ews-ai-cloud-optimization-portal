#!/usr/bin/env bash
# Troubleshoot GitHub Pages for ews-ai-cloud-optimization-portal
# Usage: ./scripts/troubleshoot-pages.sh [local-repo-path]

set -euo pipefail

REPO_URL="https://github.com/EliteWebServices-EWS/ews-ai-cloud-optimization-portal"
SITE_BASE="https://elitewebservices-ews.github.io/ews-ai-cloud-optimization-portal"
REPO_DIR="${1:-$(dirname "$0")/..}"

echo "=== EWS GitHub Pages Troubleshooter ==="
echo ""

# Clone or pull latest
if [[ -d "$REPO_DIR/.git" ]]; then
  echo ">> Pulling latest from main..."
  git -C "$REPO_DIR" pull --ff-only origin main 2>/dev/null || echo "   (pull skipped — check network/auth)"
else
  echo ">> Cloning repository..."
  git clone "$REPO_URL.git" "$REPO_DIR"
fi

echo ""
echo ">> GitHub Pages configuration:"
gh api repos/EliteWebServices-EWS/ews-ai-cloud-optimization-portal/pages \
  --jq '"  build_type: \(.build_type)\n  source: \(.source.branch) / \(.source.path)\n  url: \(.html_url)"' \
  2>/dev/null || echo "  (install gh CLI and authenticate to view Pages config)"

echo ""
echo ">> Checking live URLs (expect 200):"
URLS=(
  "$SITE_BASE/"
  "$SITE_BASE/frontend/index.html"
  "$SITE_BASE/frontend/pages/about.html"
  "$SITE_BASE/frontend/pages/services.html"
  "$SITE_BASE/frontend/pages/security.html"
  "$SITE_BASE/frontend/pages/terms.html"
  "$SITE_BASE/frontend/pages/assessment.html"
  "$SITE_BASE/frontend/pages/dashboard.html"
  "$SITE_BASE/Portal/dashboard/index.html"
  "$SITE_BASE/frontend/master-theme.js"
)

FAIL=0
for url in "${URLS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo "000")
  if [[ "$code" == "200" ]]; then
    echo "  OK  $code  $url"
  else
    echo "  FAIL $code  $url"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo ">> Checking known-broken absolute paths (expect 404):"
BROKEN=(
  "https://elitewebservices-ews.github.io/frontend/index.html"
  "https://elitewebservices-ews.github.io/Portal/dashboard/index.html"
)
for url in "${BROKEN[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo "000")
  if [[ "$code" == "404" ]]; then
    echo "  OK (correctly 404)  $url"
  else
    echo "  WARN $code  $url — absolute path may be linked somewhere"
  fi
done

echo ""
echo ">> Scanning for absolute /frontend/ links in source:"
if grep -rn 'href="/frontend/' "$REPO_DIR/frontend" 2>/dev/null; then
  echo "  ^ Found absolute /frontend/ links — these break on GitHub Pages project sites."
  FAIL=$((FAIL + 1))
else
  echo "  None found."
fi

echo ""
echo ">> Checking for empty HTML pages (< 100 bytes):"
find "$REPO_DIR/frontend/pages" -name '*.html' -size -100c -print 2>/dev/null | while read -r f; do
  echo "  EMPTY: $f"
  FAIL=$((FAIL + 1))
done

echo ""
echo ">> Checking terms.html exists (terms.tsx alone won't deploy):"
if [[ -f "$REPO_DIR/frontend/pages/terms.html" ]]; then
  echo "  OK  terms.html exists"
else
  echo "  FAIL terms.html missing"
  FAIL=$((FAIL + 1))
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "=== All checks passed ==="
else
  echo "=== $FAIL issue(s) found — see above ==="
  exit 1
fi
