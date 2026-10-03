"""
Faux serveur Telegram pour les tests locaux (port 12113).

- POST /bot<jeton>/sendMessage : enregistre le message
- GET  /bot<jeton>/getUpdates  : renvoie une conversation « /start »
- GET  /__messages              : messages reçus (pour le test)

L'API est démarrée avec TELEGRAM_API_URL=http://localhost:12113 et
TELEGRAM_BOT_TOKEN=test-token (refusé en production).
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

MESSAGES = []


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/__messages':
            return self._send(200, MESSAGES)
        if self.path.endswith('/getUpdates'):
            return self._send(200, {'ok': True, 'result': [
                {'update_id': 1, 'message': {'text': '/start', 'chat': {'id': 424242, 'first_name': 'Helton'}}},
            ]})
        self._send(404, {'ok': False})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length) or b'{}')
        if self.path.endswith('/sendMessage'):
            MESSAGES.append(body)
            return self._send(200, {'ok': True, 'result': {'message_id': len(MESSAGES)}})
        self._send(404, {'ok': False})

    def log_message(self, *args):
        pass


HTTPServer(('127.0.0.1', 12113), Handler).serve_forever()
