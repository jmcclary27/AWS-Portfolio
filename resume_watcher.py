# resume_watcher.py  (VERSION 4 — absolute paths, no shell, strong logging, Python 3.9+)
import os, sys, time, subprocess, threading
from pathlib import Path
from typing import Optional
from watchdog.observers.polling import PollingObserver as Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

# ----- CONFIG -----
REPO_ROOT    = Path(r"C:\Users\jaden\AWS-Portfolio")
LOCAL_RESUME = REPO_ROOT / "site" / "resume" / "Resume.pdf"
S3_BUCKET    = os.environ.get("S3_BUCKET", "portfolio-jaden")
AWS_REGION   = os.environ.get("AWS_REGION", "us-east-2")
BRANCH       = os.environ.get("BRANCH", "main")
LOG_PATH     = REPO_ROOT / "resume_watcher.log"  # keep log in repo for certainty

# ABSOLUTE tool paths (no quotes; we won't use a shell)
AWS = r"C:\Program Files\Amazon\AWSCLIV2\aws.exe"
GIT = r"C:\Program Files\Git\cmd\git.exe"

DEBOUNCE_SECONDS   = 3.0
MTIME_POLL_SECONDS = 2.0

_debounce: Optional[threading.Timer] = None
_last_mtime: Optional[float] = None

def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def run_cmd(args, check=True, cwd=None):
    # args is a list, NO shell=True
    return subprocess.run(args, check=check, cwd=cwd)

def upload_to_s3():
    run_cmd([
        AWS, "s3", "cp",
        r"C:\Users\jaden\AWS-Portfolio\site\resume\Resume.pdf",
        "s3://portfolio-jaden/resume/Resume.pdf",
        "--region", "us-east-2",
        "--content-type", "application/pdf",
        "--cache-control", "no-cache, no-store, must-revalidate",
        "--metadata-directive", "REPLACE",
    ])

def commit_and_push():
    repo = r"C:\Users\jaden\AWS-Portfolio"
    pdf  = r"C:\Users\jaden\AWS-Portfolio\site\resume\Resume.pdf"
    # only commit if changed
    if subprocess.run([GIT, "diff", "--quiet", "--", pdf], cwd=repo).returncode == 0:
        return
    run_cmd([GIT, "add", pdf], cwd=repo)
    run_cmd([GIT, "commit", "-m", "chore: update resume"], cwd=repo)
    run_cmd([GIT, "push", "origin", "main"], cwd=repo)

def run_actions():
    upload_to_s3()
    commit_and_push()

def debounce_fire():
    global _debounce
    if _debounce and _debounce.is_alive():
        _debounce.cancel()
    _debounce = threading.Timer(DEBOUNCE_SECONDS, run_actions)
    _debounce.start()

class Handler(FileSystemEventHandler):
    def _is_resume(self, path: str) -> bool:
        try:
            return Path(path).resolve().samefile(LOCAL_RESUME)
        except Exception:
            return str(Path(path).resolve()).lower() == str(LOCAL_RESUME.resolve()).lower()

    def on_modified(self, event: FileSystemEvent):
        if not event.is_directory and self._is_resume(event.src_path):
            log("[event] modified")
            debounce_fire()

    def on_created(self, event: FileSystemEvent):
        if not event.is_directory and self._is_resume(event.src_path):
            log("[event] created")
            debounce_fire()

    def on_moved(self, event: FileSystemEvent):
        if not event.is_directory and self._is_resume(event.dest_path):
            log("[event] moved")
            debounce_fire()

def mtime_poll_loop():
    global _last_mtime
    while True:
        try:
            if LOCAL_RESUME.exists():
                m = LOCAL_RESUME.stat().st_mtime
                if _last_mtime is None:
                    _last_mtime = m
                    log(f"[poll] initial mtime = {m}")
                elif m > _last_mtime + 1e-6:
                    log(f"[poll] mtime changed -> {m}")
                    _last_mtime = m
                    debounce_fire()
            else:
                log(f"[poll] file not found at {LOCAL_RESUME}")
        except Exception as e:
            log(f"[poll] error: {e}")
        time.sleep(MTIME_POLL_SECONDS)

def main():
    # Strong identity banner so we know *which file* ran
    log("=== RESUME WATCHER START (VERSION 4) ===")
    log(f"__file__: {Path(__file__).resolve()}")
    log(f"python: {sys.version}")
    log(f"repo: {REPO_ROOT}")
    log(f"watching: {LOCAL_RESUME}")
    log(f"AWS exe: {AWS}")
    log(f"GIT exe: {GIT}")

    if not LOCAL_RESUME.parent.exists():
        log(f"[error] Folder missing: {LOCAL_RESUME.parent}")
        return

    threading.Thread(target=mtime_poll_loop, daemon=True).start()

    obs = Observer(timeout=1.0)
    obs.schedule(Handler(), str(LOCAL_RESUME.parent), recursive=False)
    obs.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        obs.stop()
    obs.join()

if __name__ == "__main__":
    main()
