#!/usr/bin/env python3
"""Static file server for SimYou, plus a POST /_log sink that appends each
LLM request/response as one JSON line to llm.log."""

import datetime
import http.server
import json
import os
import re
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(ROOT, "llm.log")
ROOMS = {"window", "kitchen", "desk", "couch", "bed"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n)

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if path == "/_log":
            raw = self._body()
            try:
                entry = json.loads(raw)
            except Exception:
                entry = {"unparsed": raw.decode("utf-8", "replace")}
            entry.setdefault("ts", datetime.datetime.now().isoformat(timespec="seconds"))
            try:
                with open(LOG, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            except Exception as e:  # noqa: BLE001
                self.send_error(500, str(e))
                return
            self.send_response(204)
            self.end_headers()
        elif path == "/_world":
            try:
                entry = json.loads(self._body())
                seed = str(entry.get("seed", ""))
                room = entry.get("room", "")
            except Exception:
                self.send_error(400, "bad json")
                return
            if not re.fullmatch(r"\d{1,10}", seed) or room not in ROOMS:
                self.send_error(400, "bad seed/room")
                return
            d = os.path.join(ROOT, "worlds", seed)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, room + ".json"), "w", encoding="utf-8") as fh:
                json.dump(entry.get("doc", {}), fh, indent=2, ensure_ascii=False)
            self.send_response(204)
            self.end_headers()
        else:
            self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):  # keep the console quiet
        pass


http.server.ThreadingHTTPServer.allow_reuse_address = True
srv = http.server.ThreadingHTTPServer(("", PORT), Handler)
print(f"SimYou  http://localhost:{PORT}   ·   LLM calls -> {LOG}")
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
