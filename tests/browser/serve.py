"""Serve actual app files with a local fixture backend. Never contacts Supabase."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[2])
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/supabase-config.js':
            body = b"window.SUPABASE_CONFIG={url:location.origin,anonKey:'fixture-only'};"
        elif path.endswith('.html'):
            file = Path('.' + path)
            if not file.is_file(): return super().do_GET()
            body = file.read_text().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/tests/browser/backend.js').encode()
        else: return super().do_GET()
        self.send_response(200); self.send_header('Content-Type','text/html' if path.endswith('.html') else 'text/javascript'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
    def log_message(self,*args): pass
print('Fixture app: http://127.0.0.1:8092/user-admin.html',flush=True)
ThreadingHTTPServer(('127.0.0.1',8092),Handler).serve_forever()
