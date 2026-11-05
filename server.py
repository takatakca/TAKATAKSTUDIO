"""Loopback-only development server. Run: python3 server.py"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from engine.studio import Studio

ROOT = Path(__file__).parent


def handler_for(studio):
    class Handler(BaseHTTPRequestHandler):
        def send(self, code, payload, kind='application/json'):
            raw = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
            self.send_response(code)
            self.send_header('Content-Type', kind + '; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def allowed(self):
            # Reject DNS rebinding. Server binds only to 127.0.0.1.
            host = self.headers.get('Host', '')
            return host in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

        def do_GET(self):
            if not self.allowed():
                return self.send(403, {'error': 'Loopback access only'})
            url = urlparse(self.path)
            try:
                if url.path == '/api/state':
                    return self.send(200, studio.snapshot())
                if url.path == '/api/export':
                    return self.send(200, studio.request_pack(parse_qs(url.query).get('project', [''])[0]))
                if url.path == '/':
                    return self.send(200, (ROOT / 'web/index.html').read_text(), 'text/html')
                return self.send(404, {'error': 'Not found'})
            except ValueError as e:
                return self.send(400, {'error': str(e)})

        def do_POST(self):
            expected = 'http://' + self.headers.get('Host', '')
            if not self.allowed() or self.headers.get('Origin') != expected:
                return self.send(403, {'error': 'Same-origin browser access required'})
            if self.headers.get('Content-Type') != 'application/json':
                return self.send(415, {'error': 'JSON required'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length < 1 or length > 160000:
                    return self.send(413, {'error': 'Invalid request size'})
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('JSON object required')
                if self.path == '/api/import':
                    return self.send(201, {'id': studio.import_pack(data)})
                if self.path == '/api/projects':
                    return self.send(201, {'id': studio.create_project(data)})
                if self.path == '/api/characters':
                    studio.character(data.get('name'), data.get('profile'))
                elif self.path == '/api/jobs':
                    studio.job(data.get('id'), data.get('action'), data)
                else:
                    return self.send(404, {'error': 'Not found'})
                return self.send(200, {'ok': True})
            except (ValueError, TypeError) as e:
                return self.send(400, {'error': str(e)})

    return Handler


if __name__ == '__main__':
    path = Path(os.environ.get('STUDIO_DB', str(ROOT / 'data/studio.sqlite3')))
    path.parent.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get('STUDIO_PORT', '8787'))
    server = ThreadingHTTPServer(('127.0.0.1', port), handler_for(Studio(path)))
    print(f'TAKATAKSTUDIO: http://127.0.0.1:{port} — local development only', flush=True)
    server.serve_forever()
