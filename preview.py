"""Serve the public site locally, including a project subpath for Pages testing."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

SITE = Path(__file__).resolve().parent / 'site'


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parts = urlsplit(path)
        if parts.path.startswith('/preview/'):
            path = parts.path[len('/preview'):] + ('?' + parts.query if parts.query else '')
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Permissions-Policy', 'microphone=(self), camera=()')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(SITE)))
    print(f'Public backup preview: http://localhost:{args.port}/preview/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
