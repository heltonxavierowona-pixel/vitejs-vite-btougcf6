"""
Faux serveur Neero pour les tests locaux (port 12114).

Reproduit les appels utilisés par NeeroProvider, avec la clé
« Bearer sk_test_fake » :
- POST /api/v1/transaction-intents/cash-in   -> intent PENDING
- POST /api/v1/sessions                      -> { id, url }
- GET  /api/v1/transaction-intents/<id>      -> intent
- POST /api/v1/transaction-intents/<id>/cancel
Pilotage du test :
- POST /__set/<id>/<STATUT>[?amount=N]       -> change le statut (et le montant)
- GET  /__intent/<id>                        -> état brut (annulations comprises)

API démarrée avec NEERO_BASE_URL=http://localhost:12114 NEERO_SECRET_KEY=sk_test_fake
"""
import json
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

INTENTS = {}
KEY = 'Bearer sk_test_fake'


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length) or b'{}')

    def _authorized(self):
        if self.headers.get('Authorization') != KEY:
            self._send(401, {'message': 'Unauthorized'})
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/__intent/'):
            return self._send(200, INTENTS.get(path.split('/')[-1], {}))
        if not self._authorized():
            return
        if path.startswith('/api/v1/transaction-intents/'):
            intent = INTENTS.get(path.split('/')[-1])
            return self._send(200, intent) if intent else self._send(404, {'message': 'Not found'})
        self._send(404, {'message': 'Not found'})

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        if path.startswith('/__set/'):
            _, _, intent_id, status = path.split('/')
            intent = INTENTS[intent_id]
            intent['status'] = status
            amount = parse_qs(url.query).get('amount')
            if amount:
                intent['amount'] = int(amount[0])
            return self._send(200, intent)
        if not self._authorized():
            return
        body = self._body()
        if path == '/api/v1/transaction-intents/cash-in':
            missing = [k for k in ('amount', 'currencyCode', 'destinationPaymentMethodId') if not body.get(k)]
            if missing:
                return self._send(422, {'message': [f'{k} is required' for k in missing]})
            intent_id = f'ti_{uuid.uuid4().hex[:16]}'
            INTENTS[intent_id] = {
                'id': intent_id, 'status': 'PENDING', 'amount': body['amount'],
                'currencyCode': body['currencyCode'], 'metadata': body.get('metadata', {}),
                'customer': body.get('customer'), 'canceled': False,
            }
            return self._send(201, INTENTS[intent_id])
        if path == '/api/v1/sessions':
            intent_id = body.get('transactionIntentId')
            if intent_id not in INTENTS:
                return self._send(404, {'message': 'Unknown intent'})
            return self._send(201, {'id': f'ses_{intent_id}', 'url': f'http://localhost:12114/pay/{intent_id}'})
        if path.startswith('/api/v1/transaction-intents/') and path.endswith('/cancel'):
            intent = INTENTS.get(path.split('/')[-2])
            if not intent:
                return self._send(404, {'message': 'Not found'})
            intent['canceled'] = True
            if intent['status'] == 'PENDING':
                intent['status'] = 'CANCELED'
            return self._send(200, intent)
        self._send(404, {'message': 'Not found'})

    def log_message(self, *args):
        pass


HTTPServer(('127.0.0.1', 12114), Handler).serve_forever()
