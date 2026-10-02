"""
Règles de TVA du CGI 2026, de bout en bout, sur une API démarrée et une
base de données dédiée aux tests.

    API_URL=http://localhost:3000/api python3 scripts/cgi-2026-test.py

Vérifie :
  - services : TVA exigible à l'encaissement (CGI art. 134) ;
  - achats : exclusions du droit à déduction (LPF L 101, CGI art. 143 et 144) ;
  - retenue à la source par le client (CGI art. 149-2) ;
  - base imposable arrondie au millier inférieur (CGI art. 141) ;
  - entreprise à l'IGS : pas de TVA ni de déclaration (CGI art. 132).
"""
import json, os, random, string, urllib.error, urllib.request
from datetime import date, datetime, timezone

BASE = os.environ.get('API_URL', 'http://localhost:3000/api')
RUN = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

_today = date.today()
PY, PM = (_today.year - 1, 12) if _today.month == 1 else (_today.year, _today.month - 1)
def day(d): return f'{PY}-{PM:02d}-{d:02d}T00:00:00.000Z'
NOW = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')

fails = []
def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        c = e.read()
        try: c = json.loads(c)
        except Exception: pass
        return e.code, c
def check(name, cond, info=''):
    print(('OK   ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

def register(kind, regime):
    s, r = call('POST', '/auth/register', {
        'email': f'{kind}-{RUN.lower()}@test.cm', 'password': 'motdepasse123',
        'firstName': 'Test', 'lastName': 'CGI', 'phone': '677000000',
        'organizationName': f'CGI {kind}', 'organizationType': 'ENTREPRISE',
        'entity': {'niu': f'{kind[0]}{RUN.lower()}02b', 'legalName': f'CGI {kind} SARL',
                   'legalForm': 'SARL', 'taxRegime': regime, 'isVatSubject': regime != 'IGS',
                   'address': 'Rue 1', 'city': 'Douala', 'phone': '677000000'}})
    check(f'inscription {kind}', s == 201, r)
    return r['accessToken'], r['entityId'], r['organization']['id']

def invoice(tok, ent, body):
    s, inv = call('POST', f'/entities/{ent}/invoices', body, tok)
    s2, v = call('POST', f'/entities/{ent}/invoices/{inv["id"]}/validate', None, tok)
    return s2, v

def line(label, ht_francs, service=False, rate='STANDARD'):
    return {'label': label, 'quantity': 1000, 'unitPrice': ht_francs * 100,
            'vatRate': rate, 'isService': service}

# ---------------------------------------------------------------- réel
tok, ent, org = register('reel', 'REEL_NORMAL')
_, cust = call('POST', f'/entities/{ent}/customers',
               {'name': 'Client privé', 'isVatSubject': True, 'niu': 'P111222333444C'}, tok)
_, state = call('POST', f'/entities/{ent}/customers',
                {'name': 'Ministère', 'niu': 'G999888777666D', 'withholdsVat': True}, tok)
check('client avec retenue à la source enregistré', state.get('withholdsVat') is True, state)
_, sup = call('POST', f'/entities/{ent}/suppliers', {'name': 'Fournisseur', 'niu': 'M555666777888E'}, tok)
_, nosup = call('POST', f'/entities/{ent}/suppliers', {'name': 'Sans NIU'}, tok)

# Service 100 000 HT (TVA 19 250), payé moitié ce mois, solde aujourd'hui.
s, svc = invoice(tok, ent, {'direction': 'SALE', 'issuedAt': day(5), 'customerId': cust['id'],
                           'lines': [line('Conseil', 100_000, service=True)]})
check('facture de service validée', s == 200 and svc['lines'][0]['isService'], svc)
s, r = call('POST', f'/entities/{ent}/invoices/{svc["id"]}/payments',
            {'amount': 5_962_500, 'method': 'BANK_TRANSFER', 'paidAt': day(10)}, tok)
check('acompte sur service', s == 201, r)

# Bien 50 000 HT (TVA 9 625), impayé : exigible à la facture.
invoice(tok, ent, {'direction': 'SALE', 'issuedAt': day(6), 'customerId': cust['id'],
                   'lines': [line('Marchandise', 50_000)]})

# Client qui retient la TVA : 20 000 HT (TVA 3 850).
s, w = invoice(tok, ent, {'direction': 'SALE', 'issuedAt': day(7), 'customerId': state['id'],
                         'lines': [line('Fournitures', 20_000)]})
s, r = call('POST', f'/entities/{ent}/invoices/{svc["id"]}/payments',
            {'amount': 100_000, 'vatWithheld': 100_000, 'method': 'BANK_TRANSFER', 'paidAt': day(11)}, tok)
check('retenue refusée pour un client qui ne retient pas', s == 400, r)
s, r = call('POST', f'/entities/{ent}/invoices/{w["id"]}/payments',
            {'amount': 2_000_000, 'vatWithheld': 385_000, 'method': 'BANK_TRANSFER', 'paidAt': day(12)}, tok)
check('règlement HT + TVA retenue solde la facture', s == 201 and r['status'] == 'PAID', r)

# Achats : un déductible, trois exclus.
invoice(tok, ent, {'direction': 'PURCHASE', 'issuedAt': day(8), 'supplierId': sup['id'],
                   'lines': [line('Papier', 10_000)]})
invoice(tok, ent, {'direction': 'PURCHASE', 'issuedAt': day(8), 'supplierId': nosup['id'],
                   'lines': [line('Sans NIU', 10_000)]})
s, cashp = invoice(tok, ent, {'direction': 'PURCHASE', 'issuedAt': day(9), 'supplierId': sup['id'],
                             'lines': [line('Ordinateur', 100_000)]})
call('POST', f'/entities/{ent}/invoices/{cashp["id"]}/payments',
     {'amount': cashp['totalInclVat'], 'method': 'CASH', 'paidAt': day(9)}, tok)
s, rest = invoice(tok, ent, {'direction': 'PURCHASE', 'issuedAt': day(9), 'supplierId': sup['id'],
                            'vatNonDeductible': True, 'lines': [line('Restaurant', 10_000)]})
check('achat marqué non déductible (art. 144)', rest.get('vatNonDeductible') is True, rest)

s, decl = call('POST', f'/entities/{ent}/declarations/{PY}/{PM}/compute', None, tok)
check('déclaration calculée', s in (200, 201), decl)
check('TVA collectée : biens à la facture + services à l’encaissement',
      decl.get('vatCollected') == 962_500 + 962_500 + 385_000, decl.get('vatCollected'))
check('TVA déductible : seul l’achat régulier', decl.get('vatDeductible') == 192_500, decl.get('vatDeductible'))
check('TVA exclue : sans NIU + espèces ≥ 100 000 + art. 144',
      decl.get('vatExcluded') == 192_500 + 1_925_000 + 192_500, decl.get('vatExcluded'))
check('TVA retenue à la source déduite', decl.get('vatWithheld') == 385_000, decl.get('vatWithheld'))
check('TVA nette', decl.get('vatDue') == 2_310_000 - 192_500 - 385_000, decl.get('vatDue'))

s, view = call('GET', f'/entities/{ent}/declarations/{PY}/{PM}', token=tok)
reasons = sorted(r for p in view.get('excludedPurchases', []) for r in p['reasons'])
check('raisons d’exclusion détaillées', reasons == ['CASH', 'EXCLUDED_EXPENSE', 'NO_NIU'], reasons)
check('base imposable arrondie au millier inférieur (art. 141)',
      view.get('taxableBase') == 12_000_000, view.get('taxableBase'))

# Solde du service encaissé aujourd'hui : TVA exigible ce mois-ci.
s, r = call('POST', f'/entities/{ent}/invoices/{svc["id"]}/payments',
            {'amount': 5_962_500, 'method': 'MOBILE_MONEY_MTN', 'paidAt': NOW}, tok)
check('solde du service encaissé', s == 201 and r['status'] == 'PAID', r)
s, cur = call('POST', f'/entities/{ent}/declarations/{_today.year}/{_today.month}/compute', None, tok)
check('TVA du solde déclarée le mois de l’encaissement', cur.get('vatCollected') == 962_500, cur)

# Facturation électronique DGI et prise en charge État
s, st = invoice(tok, ent, {'direction': 'SALE', 'issuedAt': day(14), 'customerId': cust['id'],
                          'lines': [{**line('Marché public', 10_000), 'stateBorne': True}]})
check('ligne « prise en charge État » enregistrée', s == 200 and st['lines'][0]['stateBorne'], st)
s, view = call('GET', f'/entities/{ent}/declarations/{PY}/{PM}', token=tok)
before = view.get('salesWithoutDgiReference')
check('factures sans référence DGI comptées', isinstance(before, int) and before >= 4, view.get('salesWithoutDgiReference'))
s, r = call('PUT', f'/entities/{ent}/invoices/{st["id"]}/dgi-reference', {'reference': 'DGI-2026-0001'}, tok)
check('référence DGI enregistrée', s == 200 and r.get('fiscalStamp') == 'DGI-2026-0001', r)
s, view = call('GET', f'/entities/{ent}/declarations/{PY}/{PM}', token=tok)
check('une facture de moins sans référence', view.get('salesWithoutDgiReference') == before - 1, view.get('salesWithoutDgiReference'))
s, dr = call('POST', f'/entities/{ent}/invoices', {'direction': 'SALE', 'issuedAt': day(14),
             'customerId': cust['id'], 'lines': [line('Brouillon', 1_000)]}, tok)
s, r = call('PUT', f'/entities/{ent}/invoices/{dr["id"]}/dgi-reference', {'reference': 'DGI-X'}, tok)
check('pas de référence DGI sur un brouillon', s == 400, r)

# ---------------------------------------------------------------- IGS
tok2, ent2, _ = register('igs', 'IGS')
_, c2 = call('POST', f'/entities/{ent2}/customers', {'name': 'Client'}, tok2)
s, r = invoice(tok2, ent2, {'direction': 'SALE', 'issuedAt': day(5), 'customerId': c2['id'],
                            'lines': [line('Vente', 10_000)]})
check('IGS : facture avec TVA refusée (art. 132)', s == 400, r)
s, r = invoice(tok2, ent2, {'direction': 'SALE', 'issuedAt': day(5), 'customerId': c2['id'],
                            'lines': [line('Vente', 10_000, rate='EXEMPT')]})
check('IGS : facture sans TVA acceptée', s == 200, r)
s, r = call('POST', f'/entities/{ent2}/declarations/{PY}/{PM}/compute', None, tok2)
check('IGS : pas de déclaration de TVA', s == 400, r)
s, r = call('GET', f'/entities/{ent2}/dashboard', token=tok2)
check('IGS : tableau de bord sans échéance TVA', s == 200 and r.get('vatApplicable') is False, r)

print()
print('Tout est conforme.' if not fails else f'{len(fails)} échec(s)')
raise SystemExit(1 if fails else 0)
