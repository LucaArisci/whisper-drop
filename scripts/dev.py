#!/usr/bin/env python3
"""
dev.py — hot-reload launcher for transcriber.py
Watches for file changes and restarts the app automatically.

Usage:
    .venv/bin/python dev.py
"""

import subprocess
import sys
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

APP_FILE = Path(__file__).parent.parent / "transcriber.py"
PYTHON = sys.executable
DEBOUNCE = 0.5  # seconds — avoid double-triggers on save


class RestartHandler(FileSystemEventHandler):
    def __init__(self):
        self.process = None
        self.last_restart = 0
        self.start()

    def start(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.process.wait()
        print(f"\n▶  Starting {APP_FILE.name}...\n{'─' * 40}")
        self.process = subprocess.Popen([PYTHON, str(APP_FILE)])

    def on_modified(self, event):
        if Path(event.src_path).resolve() != APP_FILE.resolve():
            return
        now = time.time()
        if now - self.last_restart < DEBOUNCE:
            return
        self.last_restart = now
        print(f"\n🔄  Change detected — restarting...\n{'─' * 40}")
        self.start()


if __name__ == "__main__":
    handler = RestartHandler()
    observer = Observer()
    observer.schedule(handler, str(APP_FILE.parent), recursive=False)
    observer.start()
    print(f"👀  Watching {APP_FILE.name} for changes. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
        if handler.process and handler.process.poll() is None:
            handler.process.terminate()
    observer.join()