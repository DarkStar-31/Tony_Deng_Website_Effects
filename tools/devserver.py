#!/usr/bin/env python3
"""Local preview of the site *and* the admin, with no Cloudflare in the loop.

    python tools/devserver.py          # http://localhost:5502

Serves the built site and stands in for the admin Worker: /api/admin/* reads
and writes content/*.json on disk instead of committing to GitHub, and
re-runs the build after every save so the pages update immediately.

THIS HAS NO AUTHENTICATION. It binds to localhost only and is for trying
changes on your own machine before they go anywhere near the live site.
Real access control is Cloudflare Access in front of the deployed Worker.
"""

from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
CONTENT_FILES = ["content/shared.json", "content/en.json", "content/zh.json"]

FAKE_USER = "you@localhost"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ------------------------------------------------------------ plumbing

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            sys.stderr.write(f"  {self.command} {self.path}\n")

    def end_headers(self):
        # The pages carry ?v=<hash> on their assets and look after themselves,
        # but admin.js and admin.css have no such thing: edit one and the
        # browser keeps running the copy it already has. Nothing served here
        # is worth caching anyway — this is a preview of files on disk.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()          # adds Cache-Control: no-store
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def rebuild(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "build.py")],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        if result.returncode != 0:
            sys.stderr.write(result.stdout + result.stderr)
        return result.returncode == 0

    # ------------------------------------------------------------ routes

    def do_GET(self):
        if self.path.startswith("/api/admin/"):
            route = self.path[len("/api/admin/"):].split("?")[0]

            if route == "status":
                return self.send_json({
                    "email": FAKE_USER,
                    "canPublish": True,
                    "liveBranch": "main (local)",
                    "draftBranch": "working copy",
                    "ahead": 0,
                    "behind": 0,
                    "unpublished": [],
                })

            if route == "content":
                files = {}
                for rel in CONTENT_FILES:
                    files[rel] = json.loads((ROOT / rel).read_text(encoding="utf-8"))
                return self.send_json({"headSha": "local", "files": files})

            return self.send_json({"error": f"No dev route for GET {route}"}, 404)

        return super().do_GET()

    def do_PUT(self):
        if self.path == "/api/admin/content":
            body = self.read_json()
            for rel, data in (body.get("files") or {}).items():
                if rel not in CONTENT_FILES:
                    return self.send_json({"error": f"Refusing to write {rel}"}, 400)
                (ROOT / rel).write_text(
                    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                    newline="\n",
                )
            ok = self.rebuild()
            return self.send_json(
                {"ok": ok, "commit": "local"} if ok
                else {"error": "Saved, but the build failed — see the terminal"}, 200 if ok else 500
            )
        return self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        if self.path == "/api/admin/upload":
            body = self.read_json()
            path = body.get("path", "")
            if not re.fullmatch(r"(img|audio)/[A-Za-z0-9._/-]+", path) or ".." in path:
                return self.send_json({"error": "Bad upload path"}, 400)
            dest = ROOT / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(base64.b64decode(body.get("contentBase64", "")))
            return self.send_json({"ok": True, "commit": "local", "path": path})

        if self.path == "/api/message":
            # Stands in for the not-yet-built message Worker: logs to the
            # terminal and to messages.local.jsonl (gitignored), so the
            # contact window can be tried end to end.
            body = self.read_json()
            if body.get("website"):
                return self.send_json({"ok": True})
            if not str(body.get("message", "")).strip() or not str(body.get("replyTo", "")).strip():
                return self.send_json({"error": "message and replyTo are required"}, 400)
            entry = {k: body.get(k) for k in ("name", "replyTo", "message", "lang", "page")}
            with (ROOT / "messages.local.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            sys.stderr.write(f"  message from {entry['replyTo']}: {entry['message'][:60]!r}\n")
            return self.send_json({"ok": True})

        if self.path in ("/api/admin/login", "/api/admin/logout"):
            # No auth locally: any sign-in succeeds, so the form can be tried.
            return self.send_json({"ok": True, "email": FAKE_USER, "canPublish": True})

        if self.path == "/api/admin/publish":
            self.rebuild()
            return self.send_json({"ok": True, "commit": "local"})

        return self.send_json({"error": "Not found"}, 404)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5502
    subprocess.run([sys.executable, str(ROOT / "build.py")], cwd=ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"\n  site   http://localhost:{port}/")
    print(f"  admin  http://localhost:{port}/admin/   (no auth — local only)\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
