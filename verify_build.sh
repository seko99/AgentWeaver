#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${VERIFY_BUILD_ROOT_DIR:-$(pwd)}"
BUILD_TARGET="./cmd/user-service"
BUILD_OUTPUT="$ROOT_DIR/user-service"

log() {
  printf '%s\n' "$*" >&2
}

details_json() {
  local template="$1"
  shift
  if command -v jq >/dev/null 2>&1; then
    jq -cn "$@" "$template"
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

  emit_result false "verify-build" "verify_build" "$exit_code" "$summary" "$command" "$details_json"
  exit "$exit_code"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail 2 "Missing required command: $1" "$1" "$(details_json --arg failedStage "require_cmd" --arg missingCommand "$1" '{failedStage: $failedStage, missingCommand: $missingCommand}')"
  fi
}

run_stage() {
  local stage_name="$1"
  local script_path="$2"
  local output
  local exit_code=0

  if output=$("$script_path"); then
    :
  else
    exit_code=$?
  fi

  printf '%s\n' "$output" >&2

  if [[ "$exit_code" -ne 0 ]]; then
    fail "$exit_code" "${stage_name} stage failed" "$script_path" "$(details_json --arg failedStage "$stage_name" --arg rawOutput "$output" '{failedStage: $failedStage, stageResult: ($rawOutput | fromjson? // {raw: $rawOutput})}')"
  fi
}

require_cmd go

cd "$ROOT_DIR"

run_stage "run_go_linter" "$ROOT_DIR/run_go_linter.py"
run_stage "run_go_tests" "$ROOT_DIR/run_go_tests.sh"
run_stage "run_go_coverage" "$ROOT_DIR/run_go_coverage.sh"

log "==> Building binary (go build ${BUILD_TARGET})"
if ! go build -o "$BUILD_OUTPUT" "$BUILD_TARGET" >&2; then
  fail 1 "go build failed" "go build -o <output> ./cmd/user-service" "$(details_json --arg failedStage "go-build" --arg buildTarget "$BUILD_TARGET" --arg buildOutput "$BUILD_OUTPUT" '{failedStage: $failedStage, buildTarget: $buildTarget, buildOutput: $buildOutput}')"
fi

emit_result true "verify-build" "verify_build" 0 "All verification stages passed" "run_go_linter.py && run_go_tests.sh && run_go_coverage.sh && go build -o <output> ./cmd/user-service" "$(details_json --arg buildTarget "$BUILD_TARGET" --arg buildOutput "$BUILD_OUTPUT" '{completedStages: ["run_go_linter", "run_go_tests", "run_go_coverage", "go-build"], buildTarget: $buildTarget, buildOutput: $buildOutput}')"
