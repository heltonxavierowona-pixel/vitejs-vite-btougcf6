"""Faux serveur Stripe minimal pour tester l'intégration hors ligne."""
import json, time, secrets
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qsl

STATE = {'sessions': {}, 'subs': {}, 'calls': []}
now = lambda: int(time.time())

def form(body):
    out = {}
    for k, v in parse_qsl(body.decode(), keep_blank_values=True):
        out[k] = v
    return out

def meta(f, prefix):
    return {k[len(prefix)+1:-1]: v for k, v in f.items() if k.startswith(prefix + '[') and k.count('[') == 1}

def sub_json(s):
    return {'id': s['id'], 'object': 'subscription', 'status': s['status'], 'cancel_at_period_end': s['cancel_at_period_end'],
            'ended_at': s.get('ended_at'), 'metadata': s['metadata'], 'customer': s['customer'],
            'items': {'object': 'list', 'data': [{'id': 'si_' + s['id'][4:], 'object': 'subscription_item', 'current_period_end': s['period_end'], 'current_period_start': s['period_end'] - 30*86400}]}}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''
    def do_GET(self):
        p = self.path.split('?')[0]
        STATE['calls'].append(('GET', p))
        if p.startswith('/v1/checkout/sessions/'):
            s = STATE['sessions'].get(p.rsplit('/', 1)[1])
            return self.send(200, s) if s else self.send(404, {'error': {'type': 'invalid_request_error', 'message': 'No such session'}})
        if p.startswith('/v1/subscriptions/'):
            s = STATE['subs'].get(p.rsplit('/', 1)[1])
            return self.send(200, sub_json(s)) if s else self.send(404, {'error': {'type': 'invalid_request_error', 'message': 'No such subscription'}})
        if p == '/_test/state':
            return self.send(200, {'calls': STATE['calls'], 'subs': STATE['subs']})
        self.send(404, {'error': {'message': 'unknown ' + p}})
    def do_POST(self):
        p = self.path.split('?')[0]; f = form(self.body())
        STATE['calls'].append(('POST', p, f))
        if p == '/v1/checkout/sessions':
            sid = 'cs_test_' + secrets.token_hex(12)
            s = {'id': sid, 'object': 'checkout.session', 'mode': f['mode'], 'status': 'open', 'payment_status': 'unpaid',
                 'client_reference_id': f.get('client_reference_id'), 'customer': f.get('customer'), 'customer_email': f.get('customer_email'),
                 'metadata': meta(f, 'metadata'), 'subscription': None, 'amount_total': int(f['line_items[0][price_data][unit_amount]']),
                 'currency': f['line_items[0][price_data][currency]'], 'url': 'https://checkout.stripe.test/' + sid,
                 '_sub_metadata': {k[len('subscription_data[metadata]['):-1]: v for k, v in f.items() if k.startswith('subscription_data[metadata][')}}
            STATE['sessions'][sid] = s
            return self.send(200, s)
        if p.startswith('/_test/pay/'):
            s = STATE['sessions'][p.rsplit('/', 1)[1]]
            cus = s['customer'] or 'cus_' + secrets.token_hex(6)
            subid = 'sub_' + secrets.token_hex(8)
            STATE['subs'][subid] = {'id': subid, 'status': 'active', 'cancel_at_period_end': False, 'metadata': s['_sub_metadata'], 'customer': cus, 'period_end': now() + 30*86400}
            s.update(status='complete', payment_status='paid', customer=cus, subscription=subid)
            return self.send(200, s)
        if p.startswith('/_test/renew/'):
            sub = STATE['subs'][p.rsplit('/', 1)[1]]; sub['period_end'] += 30*86400
            return self.send(200, sub_json(sub))
        if p.startswith('/v1/subscriptions/'):
            sub = STATE['subs'][p.rsplit('/', 1)[1]]
            if 'cancel_at_period_end' in f: sub['cancel_at_period_end'] = f['cancel_at_period_end'] == 'true'
            return self.send(200, sub_json(sub))
        if p == '/v1/billing_portal/sessions':
            return self.send(200, {'id': 'bps_1', 'object': 'billing_portal.session', 'url': 'https://billing.stripe.test/p/' + f['customer']})
        self.send(404, {'error': {'message': 'unknown ' + p}})
    def do_DELETE(self):
        p, _, q = self.path.partition('?'); f = {**form(self.body()), **form(q.encode())}
        STATE['calls'].append(('DELETE', p, f))
        if p.startswith('/v1/subscriptions/'):
            sub = STATE['subs'][p.rsplit('/', 1)[1]]; sub['status'] = 'canceled'; sub['ended_at'] = now()
            return self.send(200, sub_json(sub))
        self.send(404, {})

HTTPServer(('127.0.0.1', 12111), H).serve_forever()
