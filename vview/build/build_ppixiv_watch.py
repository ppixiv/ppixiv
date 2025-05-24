import argparse
import subprocess
import sys
import threading
import time
import pathspec
import hashlib
import os

from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


def find_git_root(start_path: Path) -> Path:
    try:
        result = subprocess.run(
            ["git", "-C", str(start_path), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(result.stdout.strip())
    except subprocess.CalledProcessError:
        return start_path


def load_gitignore_spec(git_root: Path):
    lines = []
    for fname in [".gitignore", ".git/info/exclude"]:
        f = git_root / fname
        if f.exists():
            lines.extend(f.read_text().splitlines())
    return pathspec.PathSpec.from_lines("gitwildmatch", lines)


class BuildHandler(FileSystemEventHandler):
    def __init__(self, build_command, ignore_spec, watch_root):
        self.build_command = build_command
        self.ignore_spec = ignore_spec
        self.watch_root = watch_root.resolve()
        self.last_hash = None
        self.build_lock = threading.Lock()
        self.last_build_time = 0
        self.pending_files = set()

    def _calc_dir_hash(self):
        sha1 = hashlib.sha1()
        for path in self.watch_root.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(self.watch_root)
            if self.ignore_spec.match_file(str(rel)):
                continue
            if "output" in rel.parts or any(
                part.startswith(".git") for part in rel.parts
            ):
                continue
            try:
                stat = path.stat()
                sha1.update(f"{rel}{stat.st_mtime}".encode())
            except OSError:
                continue
        return sha1.hexdigest()

    def on_any_event(self, event):
        if event.is_directory:
            return

        abs_path = Path(event.src_path).resolve()
        try:
            rel_path = abs_path.relative_to(self.watch_root)
        except ValueError:
            return

        if self.ignore_spec.match_file(str(rel_path)):
            return
        if "output" in rel_path.parts or any(
            part.startswith(".git") for part in rel_path.parts
        ):
            return

        self.pending_files.add(str(rel_path))

        now = time.time()
        if now - self.last_build_time < 1:
            return

        new_hash = self._calc_dir_hash()
        if new_hash == self.last_hash:
            return

        with self.build_lock:
            self.last_build_time = now
            self.last_hash = new_hash
            timestamp = time.time()
            print(f"[Build] {timestamp} Change detected in:")
            for f in sorted(self.pending_files):
                print("    •", f)
            self.pending_files.clear()
            subprocess.run(self.build_command)


class VerboseHTTPRequestHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        print("[HTTP]", self.address_string(), "-", format % args)


def start_http_server(port):
    handler = VerboseHTTPRequestHandler
    with TCPServer(("", port), handler) as httpd:
        print(f"[HTTP] Serving at http://127.0.0.1:{port}")
        httpd.serve_forever()


def start_watcher(build_command, ignore_spec, watch_root):
    event_handler = BuildHandler(build_command, ignore_spec, watch_root)
    observer = Observer()
    observer.schedule(event_handler, str(watch_root), recursive=True)
    observer.start()
    print(f"[Watch] Monitoring changes in: {watch_root}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


def parse_args():
    parser = argparse.ArgumentParser(description="Auto build/watch for ppixiv")
    parser.add_argument("-p", "--port", type=int, default=8000, help="HTTP server port")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    port = args.port

    script_dir = Path(__file__).resolve().parent
    watch_root = find_git_root(script_dir)
    ignore_spec = load_gitignore_spec(watch_root)

    build_command = [
        sys.executable,
        "-m",
        "vview.build.build_ppixiv",
        "--port",
        str(port),
    ]

    threading.Thread(target=start_http_server, args=(port,), daemon=True).start()
    start_watcher(build_command, ignore_spec, watch_root)
