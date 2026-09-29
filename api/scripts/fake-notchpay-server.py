"""Faux serveur Notch Pay minimal pour tester l'intégration hors ligne.

    python3 scripts/fake-notchpay-server.py   # écoute sur le port 12112

Contrôles de test : POST /_test/complete/<ref>[?amount=N], POST /_test/fail/<ref>
"""
import json, secrets, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

KEY = 'pk_test_fake'
TRX = {}

def find(ref):
    for t in TRX.values():
        if ref in (t['reference'], t['merchant_reference']):
            return t
    return None

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def authorized(self):
        return self.headers.get('Authorization') == KEY
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/payments/'):
            if not self.authorized(): return self.send(401, {'message': 'Unauthorized'})
            t = find(path.rsplit('/', 1)[1])
            return self.send(200, {'status': 'OK', 'code': 200, 'transaction': t}) if t else self.send(404, {'message': 'Not found'})
        self.send(404, {})
    def do_POST(self):
        u = urlparse(self.path); path = u.path
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n) or b'{}') if n else {}
        if path == '/payments':
            if not self.authorized(): return self.send(401, {'message': 'Unauthorized'})
            ref = 'trx.' + secrets.token_hex(8)
            t = {'reference': ref, 'merchant_reference': body.get('reference'), 'amount': body['amount'],
                 'amounts': {'total': body['amount'], 'currency': body['currency']}, 'currency': body['currency'],
                 'status': 'pending', 'callback': body.get('callback'), 'description': body.get('description'),
                 'customer': body.get('customer'), 'sandbox': True, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ')}
            TRX[ref] = t
            return self.send(201, {'status': 'Accepted', 'code': 201, 'transaction': t,
                                   'authorization_url': 'https://pay.notchpay.test/' + ref})
        if path.startswith('/_test/complete/') or path.startswith('/_test/fail/'):
            t = find(path.rsplit('/', 1)[1])
            q = parse_qs(u.query)
            t['status'] = 'complete' if 'complete' in path else 'failed'
            t['payment_method'] = 'cm.mtn'
            if 'amount' in q:
                t['amount'] = int(q['amount'][0]); t['amounts']['total'] = t['amount']
            return self.send(200, t)
        self.send(404, {})

HTTPServer(('127.0.0.1', 12112), H).serve_forever()
