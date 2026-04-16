#!/bin/bash

DIST_INDEX="dist/index.js"
PASS=0
FAIL=0
TIMEOUT=60

echo "Running doctor command smoke tests..."

# Test 1: doctor runs without arguments
echo -n "Test 1: doctor runs without arguments... "
OUTPUT=$(timeout $TIMEOUT node "$DIST_INDEX" doctor 2>&1)
STATUS=$?
if [ $STATUS -ne 124 ] && echo "$OUTPUT" | grep -q "## System"; then
    echo "PASS"
    PASS=$((PASS+1))
else
    echo "FAIL (exit=$STATUS)"
    FAIL=$((FAIL+1))
fi

# Test 2: JSON mode produces valid JSON
echo -n "Test 2: JSON mode produces valid JSON... "
JSON_OUT=$(timeout $TIMEOUT node "$DIST_INDEX" doctor --json 2>&1)
JSON_STATUS=$?
if echo "$JSON_OUT" | python3 -m json.tool > /dev/null 2>&1; then
    echo "PASS"
    PASS=$((PASS+1))
else
    echo "FAIL (exit=$JSON_STATUS)"
    FAIL=$((FAIL+1))
fi

# Test 3: JSON has expected structure
echo -n "Test 3: JSON has expected structure... "
if echo "$JSON_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'overall' in d and 'checks' in d and 'timestamp' in d" 2>/dev/null; then
    echo "PASS"
    PASS=$((PASS+1))
else
    echo "FAIL"
    FAIL=$((FAIL+1))
fi

# Test 4: Grouped sections exist
echo -n "Test 4: Grouped sections exist... "
if echo "$OUTPUT" | grep -q "^## " && echo "$OUTPUT" | grep -q "## System"; then
    echo "PASS"
    PASS=$((PASS+1))
else
    echo "FAIL"
    FAIL=$((FAIL+1))
fi

# Test 5: Overall status shown
echo -n "Test 5: Overall status shown... "
if echo "$OUTPUT" | grep -q "Overall:"; then
    echo "PASS"
    PASS=$((PASS+1))
else
    echo "FAIL"
    FAIL=$((FAIL+1))
fi

# Test 6: Exit code matches JSON readiness
echo -n "Test 6: Exit code matches JSON readiness... "
OVERALL=$(echo "$JSON_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['overall'])" 2>/dev/null)
if { [ "$OVERALL" = "ready" ] || [ "$OVERALL" = "ready_with_warnings" ]; } && [ $JSON_STATUS -eq 0 ]; then
    echo "PASS"
    PASS=$((PASS+1))
elif [ "$OVERALL" = "not_ready" ] && [ $JSON_STATUS -ne 0 ]; then
    echo "PASS"
else
    echo "FAIL (overall=$OVERALL, exit=$JSON_STATUS)"
    FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
