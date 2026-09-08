#!/usr/bin/env python3
"""Static file server for SimYou, plus a POST /_log sink that appends each
LLM request/response as one JSON line to llm.log."""

import datetime
import http.server
import json
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(ROOT, "llm.log")


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path.split("?")[0].rstrip("/") == "/_log":
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n)
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
