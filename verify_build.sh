#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${VERIFY_BUILD_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MIN_COVERAGE=70
COVER_FILE="$ROOT_DIR/build/coverage.out"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd go
require_cmd golangci-lint

cd "$ROOT_DIR"

echo "==> Generating code (go generate ./...)"
go generate ./...

echo "==> Running linter (golangci-lint run)"
golangci-lint run

echo "==> Running unit tests with coverage (go test -coverprofile)"
PKGS=$(go list ./... | grep -vE '/mocks/|/cmd($|/)|/tests($|/)' | paste -sd "," -)
go test -coverpkg=$PKGS -coverprofile="$COVER_FILE" -count=1 ./...

coverage=$(go tool cover -func "$COVER_FILE" | awk '/^total:/{print substr($3, 1, length($3)-1)}')
if [[ -z "$coverage" ]]; then
  echo "Failed to parse coverage from $COVER_FILE" >&2
  exit 1
fi

if awk -v c="$coverage" -v min="$MIN_COVERAGE" 'BEGIN {exit (c >= min ? 0 : 1)}'; then
  echo "==> Coverage ${coverage}% (min ${MIN_COVERAGE}%)"
else
  echo "Coverage ${coverage}% is below required ${MIN_COVERAGE}%." >&2
  exit 1
fi

echo "==> Building binary (go build ./cmd/user-service)"
go build -o "${ROOT_DIR}/user-service" ./cmd/user-service

echo "==> All checks passed"
