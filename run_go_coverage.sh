#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${VERIFY_BUILD_ROOT_DIR:-$(pwd)}"
MIN_COVERAGE="${MIN_COVERAGE:-70}"
COVER_DIR="$ROOT_DIR/build"
COVER_FILE="$COVER_DIR/coverage.out"

log() {
  printf '%s\n' "$*" >&2
}

list_test_packages() {
  go list -f '{{if or (gt (len .TestGoFiles) 0) (gt (len .XTestGoFiles) 0)}}{{.ImportPath}}{{end}}' ./... | sed '/^$/d'
}

details_json() {
  local template="${@: -1}"
  local argc=$#
  local jq_args=()
  if (( argc > 1 )); then
    jq_args=("${@:1:argc-1}")
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -cn "${jq_args[@]}" "$template"
  else
    printf '{}'
  fi
}

emit_result() {
  local ok="$1"
  local kind="$2"
  local stage="$3"
  local exit_code="$4"
  local summary="$5"
  local command="$6"
  local details_json="${7:-{}}"

  if ! command -v jq >/dev/null 2>&1; then
    printf '{"ok":%s,"kind":"%s","stage":"%s","exitCode":%s,"summary":"%s","command":"%s","details":{"error":"jq is required for structured output"}}\n' \
      "$ok" "$kind" "$stage" "$exit_code" "$summary" "$command"
    return
  fi

  jq -cn \
    --arg ok "$ok" \
    --arg kind "$kind" \
    --arg stage "$stage" \
    --arg exitCode "$exit_code" \
    --arg summary "$summary" \
    --arg command "$command" \
    --arg details "$details_json" \
    '{
      ok: ($ok == "true"),
      kind: $kind,
      stage: $stage,
      exitCode: ($exitCode | tonumber),
      summary: $summary,
      command: $command,
      details: ($details | fromjson? // {raw: $details})
    }'
}

fail() {
  local exit_code="$1"
  local summary="$2"
  local command="$3"
  local details_json="${4:-{}}"

  emit_result false "coverage" "run_go_coverage" "$exit_code" "$summary" "$command" "$details_json"
  exit "$exit_code"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail 2 "Missing required command: $1" "$1" "$(details_json --arg failedStep "require_cmd" --arg missingCommand "$1" '{failedStep: $failedStep, missingCommand: $missingCommand}')"
  fi
}

require_cmd go
cd "$ROOT_DIR"
mkdir -p "$COVER_DIR"

log "==> Resolving package list for coverage"
if ! PKGS=$(list_test_packages | paste -sd "," -); then
  fail 2 "Failed to resolve package list for coverage" "go list ./..." '{"failedStep":"go-list"}'
fi

if [[ -z "$PKGS" ]]; then
  fail 2 "Coverage package list is empty" "go list ./..." '{"failedStep":"go-list","reason":"no-test-packages"}'
fi

log "==> Running coverage check (go test -coverprofile)"
if ! go test -coverpkg="$PKGS" -coverprofile="$COVER_FILE" -count=1 ./... >&2; then
  fail 1 "go test for coverage failed" "go test -coverpkg=<pkgs> -coverprofile=<file> -count=1 ./..." "$(details_json --arg failedStep "go-test" --arg coverFile "$COVER_FILE" '{failedStep: $failedStep, coverFile: $coverFile}')"
fi

log "==> Calculating coverage summary"
if ! coverage=$(go tool cover -func "$COVER_FILE" | awk '/^total:/{print substr($3, 1, length($3)-1)}'); then
  fail 2 "Failed to calculate coverage summary" "go tool cover -func" "$(details_json --arg failedStep "go-tool-cover" --arg coverFile "$COVER_FILE" '{failedStep: $failedStep, coverFile: $coverFile}')"
fi

if [[ -z "$coverage" ]]; then
  fail 2 "Failed to parse coverage" "go tool cover -func" "$(details_json --arg failedStep "parse-coverage" --arg coverFile "$COVER_FILE" '{failedStep: $failedStep, coverFile: $coverFile}')"
fi

if ! awk -v c="$coverage" -v min="$MIN_COVERAGE" 'BEGIN {exit (c >= min ? 0 : 1)}'; then
  fail 3 "Coverage ${coverage}% is below required ${MIN_COVERAGE}%" "go test -coverprofile && go tool cover -func" "$(details_json --argjson coverage "$coverage" --argjson minCoverage "$MIN_COVERAGE" --arg failedStep "coverage-threshold" --arg coverFile "$COVER_FILE" '{coverage: $coverage, minCoverage: $minCoverage, failedStep: $failedStep, coverFile: $coverFile}')"
fi

emit_result true "coverage" "run_go_coverage" 0 "Coverage passed" "go test -coverpkg=<pkgs> -coverprofile=<file> -count=1 ./..." "$(details_json --argjson coverage "$coverage" --argjson minCoverage "$MIN_COVERAGE" --arg coverFile "$COVER_FILE" '{coverage: $coverage, minCoverage: $minCoverage, coverFile: $coverFile}')"
