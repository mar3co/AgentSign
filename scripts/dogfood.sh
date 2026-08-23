#!/usr/bin/env bash
# Local dogfood helper: check /health and print the homepage one-off curl.
# Requires a running server (pnpm dev). Does not fetch any network PDF URL.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "==> GET ${BASE_URL}/health"
curl -fsS "${BASE_URL}/health"
echo
echo

echo "==> Homepage one-off curl (local PDF file, no URL ingest):"
cat <<'CURL'
curl -F title=Repair\ authorization \
     -F sender_email=shop@example.com \
     -F signers='[{"name":"Jane","email":"jane@example.com"}]' \
     -F file=@form.pdf \
     http://localhost:3000/v1/documents
CURL
