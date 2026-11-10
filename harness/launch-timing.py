# Real-app launch/open timing + memory for the packaged Quill.app (macOS).
# Usage: uv run --quiet --with pyobjc-framework-Quartz python3 harness/launch-timing.py [Quill.app] [rounds]
# Polls CGWindowList every ~5ms in-process (the shell smoke script spawns uv per poll, ~300ms resolution).
import subprocess, sys, time, os, re
import Quartz

APP = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "src-tauri/target/release/bundle/macos/Quill.app")
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
DOCS = {k: os.path.abspath(f"tmp-test-files/{k}.md") for k in ("small", "medium", "large")}

def wins():
    ws = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
    return [w for w in ws if w.get("kCGWindowOwnerName") == "Quill" and w.get("kCGWindowLayer", 1) == 0 and w.get("kCGWindowBounds", {}).get("Height", 0) > 100]

def wait_wins(n, timeout=30):
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < timeout:
        if len(wins()) >= n: return time.perf_counter()
        time.sleep(0.005)
    return None

def sh(*a): return subprocess.run(a, capture_output=True, text=True).stdout
def pids(pat): return {int(l.split()[0]) for l in sh("pgrep", "-f", pat).splitlines() if l.strip()}
def rss_mb(pid): 
    out = sh("ps", "-o", "rss=", "-p", str(pid)).strip()
    return int(out) / 1024 if out else 0
def quill_pid():
    # only the instance launched from APP (never touch another Quill, e.g. the user's own)
    out = sh("pgrep", "-f", APP + "/Contents/MacOS/").split()
    return int(out[0]) if out else None
def any_other_quill():
    return [l for l in sh("ps", "-Ao", "pid,command").splitlines() if "Contents/MacOS/quill" in l.lower() and APP not in l]
WC = "com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent"
def kill():
    p = quill_pid()
    if p: subprocess.run(["kill", str(p)])
    t0 = time.time()
    while quill_pid() and time.time() - t0 < 5: time.sleep(0.1)
    time.sleep(0.8)

def launch(file=None, expect=1):
    t0 = time.perf_counter()
    subprocess.run(["open", "-a", APP] + ([file] if file else []))
    t1 = wait_wins(expect)
    return None if t1 is None else (t1 - t0) * 1000

def med(a): s = sorted(a); return s[len(s)//2]
if quill_pid() or any_other_quill():
    sys.exit("A Quill process is already running; refusing to touch it. Quit it first.")
res = {}
for r in range(ROUNDS):
    kill()
    wc_before = pids(WC)
    res.setdefault("cold launch (empty doc) -> window visible", []).append(launch())
    time.sleep(2.0)
    qp = quill_pid(); wc_new = pids(WC) - wc_before
    mem_main = rss_mb(qp); mem_wc = sum(rss_mb(p) for p in wc_new)
    res.setdefault("RSS main process MB (1 empty window + keepalive)", []).append(mem_main)
    res.setdefault("RSS new WebContent procs MB (count=%d)" % len(wc_new), []).append(mem_wc)
    n = 1
    for k in ("small", "medium", "large"):
        n += 1
        wc_pre = pids(WC)
        res.setdefault(f"open {k} into running app -> new window visible", []).append(launch(DOCS[k], n))
        time.sleep(1.5)
        res.setdefault(f"RSS WebContent procs MB after opening {k}", []).append(sum(rss_mb(p) for p in pids(WC) - wc_before))
    res.setdefault("RSS main process MB after 3 docs", []).append(rss_mb(quill_pid()))
    kill()
    # cold launch straight into a doc (file association path)
    for k in ("small", "large"):
        kill()
        res.setdefault(f"cold launch with {k} doc -> window visible", []).append(launch(DOCS[k], 1))
        time.sleep(1.0)
kill()
for k, v in res.items():
    print(f"{k:62s} median {med(v):8.1f}   all: {[round(x,1) for x in v]}")
