"""
Test de bout en bout de l'API Numera, sur une API démarrée et une
base de données dédiée aux tests.

    API_URL=http://localhost:3000/api python3 scripts/smoke-test.py

Chaque exécution crée ses propres comptes (e-mails et NIU aléatoires).
Attention : l'inscription est limitée à 10 par heure et par IP ;
redémarrez l'API entre des exécutions rapprochées.
"""
import json, os, random, string, sys, urllib.error, urllib.request
from datetime import date

BASE = os.environ.get('API_URL', 'http://localhost:3000/api')
RUN = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

# Période déclarable = mois précédent (échéance le 15 du mois courant).
_today = date.today()
PY, PM = (_today.year - 1, 12) if _today.month == 1 else (_today.year, _today.month - 1)
def day(d): return f'{PY}-{PM:02d}-{d:02d}T00:00:00.000Z'

fails=[]
def call(method, path, body=None, token=None, raw=False):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(BASE+path, data=data, method=method)
    req.add_header('Content-Type','application/json')
    if token: req.add_header('Authorization','Bearer '+token)
    try:
        with urllib.request.urlopen(req) as r:
            content=r.read()
            return r.status, (content if raw else json.loads(content or b'null'))
    except urllib.error.HTTPError as e:
        c=e.read()
        try: c=json.loads(c)
        except Exception: pass
        return e.code, c
def check(name, cond, info=''):
    print(('OK   ' if cond else 'FAIL ')+name+('' if cond else f'  -> {info}'))
    if not cond: fails.append(name)

s,r=call('POST','/auth/register',{'email':f'pme-{RUN.lower()}@test.cm','password':'motdepasse123','firstName':'Awa','lastName':'Nkeng','phone':'677000000','organizationName':'Awa Services','organizationType':'ENTREPRISE','entity':{'niu':f'm{RUN.lower()}01a','legalName':'AWA SERVICES SARL','legalForm':'SARL','taxRegime':'REEL_NORMAL','isVatSubject':True,'address':'Rue 1.234 Akwa','city':'Douala','phone':'677000000'}})
check('inscription entreprise', s==201, r)
tok=r['accessToken']; refresh=r['refreshToken']
check('memberships renvoyés à l’inscription', len(r.get('memberships',[]))==1, r.get('memberships'))
org=r['organization']['id']; ent=r['entityId']
s,r=call('GET',f'/organizations/{org}/subscription',token=tok)
check('essai gratuit créé', s==200 and r and r['status']=='TRIALING' and r['canWrite'], r)
s,r=call('GET',f'/organizations/{org}/entities',token=tok)
check('NIU normalisé en majuscules', r[0]['niu']==f'M{RUN}01A', r)

s,cust=call('POST',f'/entities/{ent}/customers',{'name':'Brasseries du Littoral','isVatSubject':True,'niu':'p098765432109z','city':'Douala'},tok)
check('client créé', s==201, cust)
s,r=call('POST',f'/entities/{ent}/customers',{'name':'Sans NIU','isVatSubject':True},tok)
check('client assujetti sans NIU refusé', s==400, r)
s,sup=call('POST',f'/entities/{ent}/suppliers',{'name':'Fournitures Pro','niu':'M011122233344B'},tok)
check('fournisseur créé', s==201, sup)

AUG=day(10)
inv={'direction':'SALE','issuedAt':AUG,'customerId':cust['id'],'lines':[
  {'label':'Prestation conseil','quantity':1000,'unitPrice':150000,'vatRate':'STANDARD'},
  {'label':'Formation','quantity':2500,'unitPrice':333333,'discountPct':1000,'vatRate':'STANDARD'}]}
s,i1=call('POST',f'/entities/{ent}/invoices',inv,tok)
check('brouillon créé', s==201 and i1['status']=='DRAFT' and i1['number'] is None, i1)
# 1500 + 2.5*3333.33*0.9 = 1500+7499.99925 → exclVat line2 = 749999.925→750000 cents? 333333*2500*9000/1e7 = 749999.25 -> 749999
check('totaux recalculés serveur', i1['subtotalExclVat']==900000 and i1['vatAmount']==173300, (i1['subtotalExclVat'],i1['vatAmount']))
s,r=call('POST',f'/entities/{ent}/invoices',{**inv,'customerId':sup['id']},tok)
check('tiers d’un autre type refusé', s==404, r)
s,r=call('POST',f'/entities/{ent}/invoices',{**inv,'lines':[{'label':'x','quantity':1000,'unitPrice':100,'discountPct':20000,'vatRate':'STANDARD'}]},tok)
check('remise > 100 % refusée', s==400, r)
s,r=call('PUT',f'/entities/{ent}/invoices/{i1["id"]}',{**inv,'direction':'PURCHASE','supplierId':sup['id']},tok)
check('changement de sens refusé', s==400, r)
s,v1=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/validate',None,tok)
check('validation → FA-AAAA-00001', s==200 and v1['number']==f'FA-{PY}-00001' and v1['partyNiu']=='P098765432109Z', v1)
s,r=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/validate',None,tok)
check('double validation refusée', s==409, r)
s,r=call('PUT',f'/entities/{ent}/invoices/{i1["id"]}',inv,tok)
check('facture validée non modifiable', s==409, r)

s,p1=call('POST',f'/entities/{ent}/invoices',{'direction':'PURCHASE','issuedAt':AUG,'supplierId':sup['id'],'supplierReference':'F-778','lines':[{'label':'Papier','quantity':1000,'unitPrice':100000,'vatRate':'STANDARD'}]},tok)
s,pv=call('POST',f'/entities/{ent}/invoices/{p1["id"]}/validate',None,tok)
check('achat → séquence AC distincte', s==200 and pv['number']==f'AC-{PY}-00001', pv)

s,r=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/payments',{'amount':50000000,'method':'CASH','paidAt':AUG},tok)
check('règlement > solde refusé', s==400, r)
s,r=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/payments',{'amount':100000,'method':'MOBILE_MONEY_MTN','paidAt':AUG},tok)
check('règlement partiel', s==201 and r['status']=='PARTIALLY_PAID', r)
s,r=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/payments',{'amount':100,'method':'BITCOIN','paidAt':AUG},tok)
check('moyen de paiement inconnu refusé', s==400, r)

s,r=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/credit-note',{'issuedAt':day(20),'isFull':False,'lines':[{'label':'Trop','quantity':1000,'unitPrice':99900000,'vatRate':'STANDARD'}]},tok)
check('avoir supérieur à la facture refusé', s==400, r)
s,cn=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/credit-note',{'issuedAt':day(20),'isFull':False,'reason':'Geste commercial','lines':[{'label':'Remise','quantity':1000,'unitPrice':100000,'vatRate':'STANDARD'}]},tok)
check('avoir partiel → AV-AAAA-00001', s==201 and cn['number']==f'AV-{PY}-00001', cn)
s,r=call('POST',f'/entities/{ent}/invoices/{i1["id"]}/credit-note',{'issuedAt':day(20),'isFull':True},tok)
check('avoir total après partiel refusé', s==400, r)
s,d=call('GET',f'/entities/{ent}/invoices/{i1["id"]}',token=tok)
check('solde dû = TTC − avoir − règlement', d['balanceDue']==d['totalInclVat']-cn['totalInclVat']-100000, (d.get('balanceDue'),))

# facture annulée par avoir total : ne doit pas être retirée deux fois
s,i2=call('POST',f'/entities/{ent}/invoices',{**inv,'lines':[{'label':'Annulée','quantity':1000,'unitPrice':500000,'vatRate':'STANDARD'}]},tok)
call('POST',f'/entities/{ent}/invoices/{i2["id"]}/validate',None,tok)
s,cn2=call('POST',f'/entities/{ent}/invoices/{i2["id"]}/credit-note',{'issuedAt':day(21),'isFull':True},tok)
s,d2=call('GET',f'/entities/{ent}/invoices/{i2["id"]}',token=tok)
check('avoir total annule la facture', d2['status']=='CANCELLED', d2['status'])

s,decl=call('POST',f'/entities/{ent}/declarations/{PY}/{PM}/compute',None,tok)
expected_collected = v1['vatAmount'] - cn['vatAmount']   # i2 et cn2 s'annulent
check('TVA collectée correcte (annulation non comptée deux fois)', s==200 and decl['vatCollected']==expected_collected, (decl.get('vatCollected'), expected_collected))
check('TVA déductible correcte', decl['vatDeductible']==pv['vatAmount'], decl.get('vatDeductible'))
check('TVA nette', decl['vatDue']==expected_collected-pv['vatAmount'], decl.get('vatDue'))

# nouveau brouillon d'août → déclaration périmée
s,i3=call('POST',f'/entities/{ent}/invoices',{**inv,'lines':[{'label':'Tardive','quantity':1000,'unitPrice':100000,'vatRate':'STANDARD'}]},tok)
call('POST',f'/entities/{ent}/invoices/{i3["id"]}/validate',None,tok)
s,dd=call('GET',f'/entities/{ent}/declarations/{PY}/{PM}',token=tok)
check('déclaration signalée périmée', dd['isStale'] is True, dd.get('isStale'))
s,r=call('POST',f'/entities/{ent}/declarations/{decl["id"]}/submit',{'submittedAt':_today.isoformat()+'T00:00:00.000Z'},tok)
check('dépôt refusé si périmée', s==409, r)
call('POST',f'/entities/{ent}/declarations/{PY}/{PM}/compute',None,tok)
s,r=call('POST',f'/entities/{ent}/declarations/{decl["id"]}/submit',{'submittedAt':_today.isoformat()+'T00:00:00.000Z','receiptRef':'DGI-TEST-0001'},tok)
check('dépôt enregistré', s==201 and r['status']=='SUBMITTED', r)
s,i4=call('POST',f'/entities/{ent}/invoices',inv,tok)
s,r=call('POST',f'/entities/{ent}/invoices/{i4["id"]}/validate',None,tok)
check('validation dans une période déposée refusée', s==409, r)
s,r=call('POST',f'/entities/{ent}/declarations/{PY}/{PM}/compute',None,tok)
check('recalcul d’une déclaration déposée refusé', s==409, r)

s,pdf=call('GET',f'/entities/{ent}/invoices/{i1["id"]}/pdf',token=tok,raw=True)
check('PDF facture', s==200 and pdf[:4]==b'%PDF', s)
s,pdf=call('GET',f'/entities/{ent}/invoices/{i4["id"]}/pdf',token=tok,raw=True)
s,pdf=call('GET',f'/entities/{ent}/declarations/{decl["id"]}/pdf',token=tok,raw=True)
check('PDF déclaration', s==200 and pdf[:4]==b'%PDF', s)

s,db=call('GET',f'/entities/{ent}/dashboard',token=tok)
check('dashboard entreprise', s==200 and db['nextDeadline']['status']=='SUBMITTED', db.get('nextDeadline'))

# rotation du jeton de rafraîchissement
s,r=call('POST','/auth/refresh',{'refreshToken':refresh})
check('rafraîchissement', s==200 and r.get('refreshToken') and r['refreshToken']!=refresh, r)
s,r2=call('POST','/auth/refresh',{'refreshToken':refresh})
check('ancien jeton de rafraîchissement rejeté', s==401, r2)

# second compte : cabinet, isolation
s,c=call('POST','/auth/register',{'email':f'cabinet-{RUN.lower()}@test.cm','password':'motdepasse123','firstName':'Paul','lastName':'Ebong','organizationName':'Cabinet Ebong','organizationType':'CABINET'})
check('inscription cabinet', s==201, c)
ctok=c['accessToken']; corg=c['organization']['id']
s,r=call('GET',f'/entities/{ent}/invoices',token=ctok)
check('isolation : factures d’un autre compte → 404', s==404, r)
s,r=call('DELETE',f'/organizations/{corg}/entities/{ent}',token=ctok)
check('isolation : archivage inter-organisations → 404', s==404, r)
s,r=call('POST',f'/organizations/{corg}/entities/{ent}/restore',token=ctok)
check('isolation : restauration inter-organisations → 404', s==404, r)
s,r=call('POST',f'/organizations/{corg}/entities',{'niu':f'M{RUN}01A','legalName':'Doublon','legalForm':'SARL','taxRegime':'RSI','address':'x','city':'Yaoundé','phone':'699000000'},ctok)
check('NIU déjà enregistré refusé', s==409, r)
s,ce=call('POST',f'/organizations/{corg}/entities',{'niu':f'Q{RUN}44B','legalName':'Client Un SA','legalForm':'SA','taxRegime':'REEL_NORMAL','isVatSubject':True,'address':'Bastos','city':'Yaoundé','phone':'699000000'},ctok)
check('dossier ajouté au portefeuille', s==201, ce)
s,cd=call('GET',f'/organizations/{corg}/dashboard/cabinet',token=ctok)
check('dashboard cabinet', s==200 and cd['summary']['total']==1, cd)
s,r=call('GET',f'/organizations/{corg}/dashboard/cabinet?year=abc&month=13',token=ctok)
check('période invalide refusée', s==400, r)
s,r=call('POST',f'/organizations/{corg}/subscription/confirm',{'txRef':'SUB-x','transactionId':'123'},ctok)
check('confirmation d’un paiement inconnu → 404', s==404, r)
s,r=call('POST',f'/organizations/{corg}/subscription/trial',{'plan':'CABINET_L'},ctok)
check('second essai refusé', s==400, r)

s,r=call('POST','/auth/login',{'email':f'pme-{RUN.lower()}@test.cm','password':'mauvais-mot-de-passe'})
check('mauvais mot de passe → 401', s==401, r)
s,r=call('POST','/auth/login',{'email':f'PME-{RUN}@test.cm','password':'motdepasse123'})
check('connexion (e-mail insensible à la casse)', s==200 and r['memberships'][0]['organizationType']=='ENTREPRISE', r)
s,r=call('POST','/auth/logout',None,r['accessToken'])
check('déconnexion', s==200, r)

print('\n%d échec(s)' % len(fails))
sys.exit(1 if fails else 0)
