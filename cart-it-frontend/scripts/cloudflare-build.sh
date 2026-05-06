#!/usr/bin/env bash
# Cloudflare Pages (Linux): run this as the build command from repo root, e.g.
#   bash cart-it-frontend/scripts/cloudflare-build.sh
# Set Pages "Build output directory" to: cart-it-frontend/build
# Production branch should be `main` so this matches Render + cart-it.com.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export REACT_APP_GIT_SHA="${CF_PAGES_COMMIT_SHA:-${REACT_APP_GIT_SHA:-}}"
npm ci
npm run build
