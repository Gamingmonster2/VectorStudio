#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os
import sys
import json
import base64
import subprocess
import tempfile
from pathlib import Path

PORT = 5050
HOST = "127.0.0.1"
BASE_DIR = Path(__file__).resolve().parent
POTRACE_DIR = BASE_DIR.parent
POTRACE_EXE = POTRACE_DIR / "potrace.exe"
MKBITMAP_EXE = POTRACE_DIR / "mkbitmap.exe"

class VectorHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        # Enable CORS and disable cache during development
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def guess_type(self, path):
        if str(path).endswith(".js"):
            return "application/javascript"
        if str(path).endswith(".wasm"):
            return "application/wasm"
        return super().guess_type(path)

    def do_POST(self):
        if self.path == "/api/native-trace":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                data = json.loads(body)

                image_data = data.get("image", "")
                if "," in image_data:
                    image_data = image_data.split(",", 1)[1]
                
                raw_bytes = base64.b64decode(image_data)

                turdsize = str(data.get("turdsize", 2))
                alphamax = str(data.get("alphamax", 1.0))
                opttolerance = str(data.get("opttolerance", 0.2))

                with tempfile.TemporaryDirectory() as tmpdir:
                    in_bmp = Path(tmpdir) / "input.bmp"
                    out_svg = Path(tmpdir) / "output.svg"

                    # Convert incoming PNG/data to BMP using Windows or Python PIL/CLI if available,
                    # or write raw bytes directly
                    in_bmp.write_bytes(raw_bytes)

                    # Execute potrace.exe
                    cmd = [
                        str(POTRACE_EXE),
                        "-s",
                        "-t", turdsize,
                        "-a", alphamax,
                        "-O", opttolerance,
                        str(in_bmp),
                        "-o", str(out_svg)
                    ]

                    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                    if out_svg.exists():
                        svg_content = out_svg.read_text(encoding="utf-8")
                        self.send_response(200)
                        self.send_header("Content-Type", "image/svg+xml")
                        self.end_headers()
                        self.wfile.write(svg_content.encode("utf-8"))
                        return
                    else:
                        raise RuntimeError(proc.stderr or "Potrace failed")

            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"Native error: {str(e)}".encode("utf-8"))
                return

        super().do_POST()

def run_server():
    os.chdir(str(BASE_DIR))
    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    # Try PORT or next available
    port = PORT
    httpd = None
    for p in range(PORT, PORT + 20):
        try:
            httpd = socketserver.TCPServer((HOST, p), VectorHandler)
            port = p
            break
        except OSError:
            continue

    if not httpd:
        print("Could not bind to any port.")
        sys.exit(1)

    url = f"http://localhost:{port}"
    print(f"==================================================")
    print(f" VectorStudio Server Started at: {url}")
    print(f" Native Potrace CLI: {POTRACE_EXE}")
    print(f" WebAssembly Engine: Active")
    print(f"==================================================")
    print("Press Ctrl+C to stop the server.")

    webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")

if __name__ == "__main__":
    run_server()
