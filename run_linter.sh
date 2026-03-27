#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${VERIFY_BUILD_ROOT_DIR:-$(pwd)}"

log() {
  printf '%s\n' "$*" >&2
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

  emit_result false "linter" "run_linter" "$exit_code" "$summary" "$command" "$details_json"
  exit "$exit_code"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail 2 "Missing required command: $1" "$1" "$(details_json --arg failedStep "require_cmd" --arg missingCommand "$1" '{failedStep: $failedStep, missingCommand: $missingCommand}')"
  fi
}

require_cmd go
require_cmd golangci-lint
cd "$ROOT_DIR"

log "==> Generating code (go generate ./...)"
if ! go generate ./... >&2; then
  fail 1 "go generate failed" "go generate ./..." '{"failedStep":"go-generate"}'
fi

log "==> Running linter (golangci-lint run)"
if ! golangci-lint run >&2; then
  fail 1 "golangci-lint failed" "golangci-lint run" '{"failedStep":"golangci-lint"}'
fi

emit_result true "linter" "run_linter" 0 "Linter checks passed" "go generate ./... && golangci-lint run" "$(details_json '{steps:["go-generate","golangci-lint"]}')"
