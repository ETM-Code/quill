# Real-app launch checks that work when the display is asleep/locked (no window is ever "on screen",
# so launch-timing.py / smoke-macos.sh cannot see anything). Uses kCGWindowListOptionAll, which lists
# windows that exist even when hidden or off-screen, and counts editor windows by size
# (not the 1x1 keepalive, not system 500x500 helper windows).
# Usage: uv run --quiet --with pyobjc-framework-Quartz python3 harness/launch-timing-headless.py <Quill.app> [rounds]
# Measures: cold launch -> first editor window created; cold launch with a file -> editor window count settles at 1;
# open a file into the running app -> count 2; RSS of main + WebContent processes with one editor window.
import subprocess, sys, time, os
import Quartz

APP = os.path.abspath(sys.argv[1]); ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 5
DOC = os.path.abspath("tmp-test-files/small.md"); DOC2 = os.path.abspath("tmp-test-files/medium.md")
def sh(*a): return subprocess.run(a, capture_output=True, text=True).stdout
def pid():
    out = sh("pgrep", "-f", APP + "/Contents/MacOS/").split()
    return int(out[0]) if out else None
def editor_windows(p):
    n = 0
    for w in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID):
        b = w.get("kCGWindowBounds", {})
        if w.get("kCGWindowOwnerPID") == p and w.get("kCGWindowLayer", 1) == 0 and b.get("Height", 0) > 100 and (b["Width"], b["Height"]) != (500, 500):
            n += 1
    return n
def kill():
    p = pid()
    if p: subprocess.run(["kill", str(p)])
    t0 = time.time()
    while pid() and time.time() - t0 < 5: time.sleep(0.1)
    time.sleep(0.8)
def launch(file=None):
    t0 = time.perf_counter()
    subprocess.run(["open", "-a", APP] + ([file] if file else []))
    return t0
def first_window(t0, timeout=20):
    while time.perf_counter() - t0 < timeout:
        p = pid()
        if p and editor_windows(p) >= 1: return (time.perf_counter() - t0) * 1000
        time.sleep(0.005)
def med(a): s = sorted(a); return s[len(s) // 2]
def rss(p): o = sh("ps", "-o", "rss=", "-p", str(p)).strip(); return int(o) / 1024 if o else 0
WC = "com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent"
def wc_pids(): return {int(l) for l in sh("pgrep", "-f", WC).split()}
if pid(): sys.exit("this app is already running; quit it first")
res = {"cold launch -> first editor window exists (ms)": [], "cold launch with file -> editor window count after 4 s": [],
       "open file into running app -> count": [], "RSS main MB (1 editor window)": [], "RSS new WebContent MB": [], "WebContent procs": []}
for r in range(ROUNDS):
    kill(); before = wc_pids()
    res["cold launch -> first editor window exists (ms)"].append(first_window(launch()))
    time.sleep(3.0)
    res["RSS main MB (1 editor window)"].append(rss(pid())); new = wc_pids() - before
    res["RSS new WebContent MB"].append(sum(rss(p) for p in new)); res["WebContent procs"].append(len(new))
    launch(DOC2); time.sleep(3.0); res["open file into running app -> count"].append(editor_windows(pid()))
    kill()
    launch(DOC); time.sleep(4.0); res["cold launch with file -> editor window count after 4 s"].append(editor_windows(pid()))
kill()
for k, v in res.items(): print(f"{k:58s} median {med(v):8.1f}   all: {[round(x, 1) for x in v]}")
