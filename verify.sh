#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "[1/2] Typechecking..."
npm run typecheck

echo "[2/2] Running test suite..."
npm test

echo "All x402-oracle checks passed."
