#!/bin/bash
# Real-app smoke test for the packaged Quill.app on macOS.
# Verifies: launch speed, file-association open, window-close keepalive,
# relaunch-from-keepalive speed, quit behavior, memory footprint.
# Usage: bash harness/smoke-macos.sh [path/to/Quill.app]
set -u

APP="${1:-src-tauri/target/release/bundle/macos/Quill.app}"
PROC="Quill"
SHOTS="harness/shots"
mkdir -p "$SHOTS"

if [ ! -d "$APP" ]; then
  echo "FAIL: app bundle not found at $APP"
  exit 1
fi
APP="$(cd "$APP" && pwd)"

now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

window_count() {
  # CGWindowList is permission-free (unlike System Events)
  uv run --quiet --with pyobjc-framework-Quartz python3 - <<'EOF'
import Quartz
wins = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
n = sum(1 for w in wins if w.get('kCGWindowOwnerName') == 'Quill' and w.get('kCGWindowLayer', 1) == 0 and w.get('kCGWindowBounds', {}).get('Height', 0) > 100)
print(n)
EOF
}

wait_for_windows() { # $1 = expected count, $2 = timeout seconds
  local deadline=$((SECONDS + ${2:-15}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(window_count)" -ge "$1" ] && return 0
    sleep 0.05
  done
  return 1
}

screenshot_quill() { # $1 = output file
  uv run --quiet --with pyobjc-framework-Quartz python3 - "$1" <<'EOF'
import sys, subprocess
import Quartz
wins = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
for w in wins:
    if w.get('kCGWindowOwnerName') == 'Quill' and w.get('kCGWindowLayer', 1) == 0 and w.get('kCGWindowBounds', {}).get('Height', 0) > 100:
        subprocess.run(['screencapture', '-o', '-x', f"-l{w['kCGWindowNumber']}", sys.argv[1]])
        break
EOF
}

app_running() { pgrep -ix "$PROC" >/dev/null && echo yes || echo no; }

mem_mb() {
  local pid rss
  pid=$(pgrep -ix "$PROC" | head -1)
  [ -z "$pid" ] && { echo "0"; return; }
  rss=$(ps -o rss= -p "$pid" | tr -d ' ')
  echo $((rss / 1024))
}

pass=0; fail=0
check() { # $1 = name, $2 = ok(0)/fail(1)
  if [ "$2" -eq 0 ]; then pass=$((pass+1)); echo "  ✓ $1"; else fail=$((fail+1)); echo "  ✗ $1"; fi
}

# Clean slate
pkill -x "$PROC" 2>/dev/null; sleep 1

echo "— launch (empty) —"
t0=$(now_ms)
open -a "$APP"
wait_for_windows 1 15; ok=$?
t1=$(now_ms)
check "window appears" $ok
echo "    empty launch -> window: $((t1 - t0))ms"
sleep 1
screenshot_quill "$SHOTS/smoke-empty.png"
echo "    memory (main process): $(mem_mb)MB"

echo "— open file via file association —"
t0=$(now_ms)
open -a "$APP" tmp-test-files/medium.md
wait_for_windows 2 15; ok=$?
t1=$(now_ms)
check "second window opens with file" $ok
echo "    open medium.md -> window: $((t1 - t0))ms"
sleep 1.5
screenshot_quill "$SHOTS/smoke-medium.png"

echo "— large file —"
t0=$(now_ms)
open -a "$APP" tmp-test-files/large.md
wait_for_windows 3 30; ok=$?
t1=$(now_ms)
check "large.md window opens" $ok
echo "    open large.md (209KB) -> window: $((t1 - t0))ms"
sleep 1
echo "    memory (main process): $(mem_mb)MB"

echo "— close all windows: app should stay alive —"
osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "quill" or name is "Quill") to true' 2>&1 | head -1
sleep 0.5
for i in 1 2 3; do
  osascript -e 'tell application "System Events" to keystroke "w" using command down' 2>&1 | head -1
  sleep 0.7
done
sleep 1.5
wc=$(window_count)
[ "$wc" -eq 0 ]; check "all windows closed (count=$wc)" $?
[ "$(app_running)" = "yes" ]; check "process still alive after closing windows" $?
echo "    memory after close (keepalive): $(mem_mb)MB"

echo "— reopen from keepalive (dock-style reopen) —"
t0=$(now_ms)
open -a "$APP"
wait_for_windows 1 10; ok=$?
t1=$(now_ms)
check "window reappears" $ok
echo "    reopen -> window: $((t1 - t0))ms"

echo "— quit —"
osascript -e 'tell application "Quill" to quit' >/dev/null 2>&1
sleep 2
[ "$(app_running)" = "no" ]; check "process exits on quit" $?

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
