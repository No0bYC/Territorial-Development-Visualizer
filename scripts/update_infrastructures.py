#!/usr/bin/env python3
"""
TDV — Mise à jour des couches Équipements & services
=====================================================
Construit data/infrastructures.json : un point par équipement, avec
  g   groupe      (svc, soc, edu, parc, adm, bank, projet)
  s   sous-type   (poste, police, pompiers, hopital, sante, pharmacie, …)
  n   nom
  st  statut      (public | prive | inconnu)
  f   fiabilité   (A vérifiée · B officielle approx. · C OpenStreetMap · D estimée · F fictive)
  src source

Sources, par ordre de priorité :
  1. data/sources/infra-verifiees.csv     — équipements contrôlés sur une liste officielle (fiabilité A ou B)
  2. OpenStreetMap via Overpass API        — base complète, communautaire (fiabilité C)
  3. data/sources/equipements-projetes.csv — équipements annoncés / en construction (couche séparée)

Usage : python3 scripts/update_infrastructures.py [--no-osm]
Aucune dépendance externe.
Lancé chaque mois par .github/workflows/update-infrastructures.yml, ou à la demande.
"""
import argparse, csv, datetime, json, math, os, re, time, unicodedata, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = 'TDV-Mapping/0.4 (territorial map of Mauritius; non-commercial; monthly refresh)'
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
BBOX = (-20.56, 57.28, -19.95, 57.82)            # île Maurice (sud, ouest, nord, est)

# ------------------------------------------------------------------ Classification
# (clé OSM, valeur OSM) -> (groupe, sous-type, statut par défaut)
RULES = [
    (('amenity', 'post_office'),      ('svc', 'poste', 'public')),
    (('amenity', 'police'),           ('svc', 'police', 'public')),
    (('amenity', 'fire_station'),     ('svc', 'pompiers', 'public')),
    (('amenity', 'hospital'),         ('svc', 'hopital', None)),
    (('amenity', 'clinic'),           ('svc', 'sante', None)),
    (('healthcare', 'centre'),        ('svc', 'sante', None)),
    (('healthcare', 'clinic'),        ('svc', 'sante', None)),
    (('amenity', 'doctors'),          ('svc', 'sante', 'prive')),
    (('amenity', 'pharmacy'),         ('svc', 'pharmacie', 'prive')),
    (('amenity', 'community_centre'), ('soc', 'communautaire', 'public')),
    (('amenity', 'social_facility'),  ('soc', 'social', None)),
    (('amenity', 'library'),          ('soc', 'bibliotheque', 'public')),
    (('amenity', 'kindergarten'),     ('edu', 'prescolaire', None)),
    (('amenity', 'childcare'),        ('edu', 'prescolaire', None)),
    (('amenity', 'school'),           ('edu', 'ecole', None)),
    (('amenity', 'college'),          ('edu', 'superieur', None)),
    (('amenity', 'university'),       ('edu', 'superieur', None)),
    (('leisure', 'park'),             ('parc', 'parc', 'public')),
    (('leisure', 'garden'),           ('parc', 'parc', None)),
    (('leisure', 'playground'),       ('parc', 'jeux', 'public')),
    (('leisure', 'sports_centre'),    ('parc', 'sport', None)),
    (('leisure', 'stadium'),          ('parc', 'sport', 'public')),
    (('leisure', 'pitch'),            ('parc', 'terrain', None)),
    (('natural', 'beach'),            ('parc', 'plage', 'public')),
    (('amenity', 'townhall'),         ('adm', 'mairie', 'public')),
    (('office', 'government'),        ('adm', 'administration', 'public')),
    (('amenity', 'courthouse'),       ('adm', 'tribunal', 'public')),
    (('amenity', 'marketplace'),      ('adm', 'marche', 'public')),
    (('landuse', 'cemetery'),         ('adm', 'cimetiere', 'public')),
    (('amenity', 'grave_yard'),       ('adm', 'cimetiere', 'public')),
    (('amenity', 'toilets'),          ('adm', 'toilettes', 'public')),
    (('amenity', 'fuel'),             ('adm', 'carburant', 'prive')),
    (('amenity', 'bank'),             ('bank', 'agence', 'prive')),
    (('amenity', 'atm'),              ('bank', 'dab', 'prive')),
]
LABELS = {
    'poste': 'Bureau de poste', 'police': 'Police', 'pompiers': 'Caserne de pompiers', 'hopital': 'Hôpital',
    'sante': 'Centre de santé / clinique', 'pharmacie': 'Pharmacie', 'communautaire': 'Centre communautaire',
    'social': 'Structure sociale', 'bibliotheque': 'Bibliothèque', 'prescolaire': 'Préscolaire / crèche',
    'ecole': 'École / collège', 'superieur': 'Enseignement supérieur', 'parc': 'Parc / jardin', 'jeux': 'Aire de jeux',
    'sport': 'Complexe sportif / stade', 'terrain': 'Terrain de sport', 'plage': 'Plage', 'mairie': 'Mairie / conseil',
    'administration': 'Bureau administratif', 'tribunal': 'Tribunal', 'marche': 'Marché', 'cimetiere': 'Cimetière',
    'toilettes': 'Toilettes publiques', 'carburant': 'Station-service', 'agence': 'Agence bancaire', 'dab': 'Distributeur (DAB)',
}

# Indices pour distinguer public / privé quand OSM ne le précise pas
PUBLIC_HINTS = re.compile(r"(ministry|minist[eè]re|government|gouvernement|municipal|district council|village council|"
                          r"area health|community health|\bahc\b|\bchc\b|mediclinic|m[ée]di.?clinique|regional hospital|district hospital|"
                          r"jeetoo|ssrn|seewoosagur|jawaharlal|nehru|\bsaj\b|anerood|victoria hospital|brown.?s[ée]quard|subramania|"
                          r"royal college|queen elizabeth college|john kennedy college|long mountain|poudre d.or|souillac hospital|mahebourg hospital|cardiac centre|ent hospital|moka eye|"
                          r"state college|\bsss\b|state secondary|government school|\bgs\b|\brca\b|\bmes\b|university of mauritius|"
                          r"utm|open university|mie\b|polytechnic|mitd|police|youth centre|social welfare|women.?s centre|"
                          r"\bnef\b|citizens? advice|cab\b)", re.I)
PRIVATE_HINTS = re.compile(r"(clinic|clinique|welkin|wellkin|c-care|apollo|fortis|darn[ée]|medical (centre|center)|"
                           r"private|priv[ée]|international school|lyc[ée]e (labourdonnais|des mascareignes)|"
                           r"\bltd\b|limited|fitness|gym|golf|padel|tennis club|country club|hotel|h[ôo]tel|resort|"
                           r"\bspa\b|academy|acad[ée]mie)", re.I)


def log(*a): print('[infra]', *a, flush=True)


def norm(s):
    s = unicodedata.normalize('NFKD', (s or '').replace("'", '').replace('’', '')).encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', s).split())


def dist_m(a, b):
    dy = (a[1] - b[1]) * 110600; dx = (a[0] - b[0]) * 104200
    return math.hypot(dx, dy)


def http_post(url, data, tries=4, wait=10):
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=200) as r:
                return r.read()
        except Exception as e:
            log(f'  échec ({e}) — nouvel essai dans {wait}s'); time.sleep(wait); wait = min(wait * 2, 120)
    raise RuntimeError('Impossible de joindre ' + url)


def fetch_osm():
    s, w, n, e = BBOX
    sel = ''.join(f'nwr["{k}"="{v}"]({s},{w},{n},{e});' for (k, v), _ in RULES)
    q = f'[out:json][timeout:180];({sel});out center tags;'
    last = None
    for url in OVERPASS:
        try:
            log('Overpass :', url)
            return json.loads(http_post(url, urllib.parse.urlencode({'data': q}).encode()))['elements']
        except Exception as ex:
            last = ex
    raise RuntimeError(f'Overpass indisponible : {last}')


def classify(tags):
    for (k, v), res in RULES:
        if tags.get(k) == v:
            return res
    return None


def statut(tags, default, name):
    ot = (tags.get('operator:type') or '').lower()
    if ot in ('public', 'government', 'governmental', 'municipal'): return 'public'
    if ot in ('private', 'business', 'commercial', 'religious', 'ngo', 'community'): return 'prive'
    if tags.get('access') == 'private': return 'prive'
    txt = ' '.join([name or '', tags.get('operator', ''), tags.get('official_name', '')])
    pub, pri = bool(PUBLIC_HINTS.search(txt)), bool(PRIVATE_HINTS.search(txt))
    if pub and not pri: return 'public'
    if pri and not pub: return 'prive'
    return default or 'inconnu'


def read_csv(path):
    if not os.path.exists(path): return []
    with open(path, encoding='utf-8') as f:
        return [r for r in csv.DictReader(f) if (r.get('nom') or '').strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-osm', action='store_true', help='ne pas interroger OSM (produit seulement les listes manuelles)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'data', 'infrastructures.json'))
    a = ap.parse_args()
    feats = []

    # 1. OpenStreetMap
    if not a.no_osm:
        els = fetch_osm()
        log(f'  {len(els)} objets OSM')
        if len(els) < 1000:
            raise SystemExit('Moins de 1000 objets reçus : réponse incomplète probable. Arrêt sans rien modifier.')
        seen = set()
        for el in els:
            t = el.get('tags', {})
            c = classify(t)
            if not c: continue
            lat = el.get('lat') or (el.get('center') or {}).get('lat')
            lon = el.get('lon') or (el.get('center') or {}).get('lon')
            if lat is None: continue
            g, sub, dflt = c
            name = t.get('name:fr') or t.get('name') or t.get('name:en') or t.get('operator') or ''
            key = (sub, round(lat, 4), round(lon, 4))
            if key in seen: continue
            seen.add(key)
            p = {'g': g, 's': sub, 'n': name or LABELS[sub], 'st': statut(t, dflt, name), 'f': 'C', 'src': 'OpenStreetMap',
                 'osm': f"{el['type'][0]}{el['id']}"}
            if t.get('operator'): p['op'] = t['operator']
            if t.get('addr:city') or t.get('addr:street'):
                p['adr'] = ', '.join(x for x in [t.get('addr:street'), t.get('addr:city')] if x)
            if sub == 'sante':      # précise le type de centre de santé public
                m = re.search(r'(area health|community health|mediclinic|ahc|chc)', name, re.I)
                if m: p['type'] = {'area health': 'AHC', 'ahc': 'AHC', 'community health': 'CHC', 'chc': 'CHC'}.get(m.group(1).lower(), 'Médi-clinique')
            feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]}, 'properties': p})

    # 2. Rapprochement avec les listes officielles (prioritaires)
    ver = read_csv(os.path.join(ROOT, 'data', 'sources', 'infra-verifiees.csv'))
    n_up, n_add = 0, 0
    for r in ver:
        try:
            lon, lat = float(r['lon']), float(r['lat'])
        except (TypeError, ValueError):
            log('  ligne ignorée (coordonnées manquantes) :', r.get('nom')); continue
        sub = r['sous_type'].strip()
        best, bd = None, 400
        for f in feats:
            if f['properties']['s'] != sub: continue
            d = dist_m((lon, lat), f['geometry']['coordinates'])
            if d < bd: best, bd = f, d
        fiab = (r.get('fiabilite') or 'A').strip().upper()
        upd = {'n': r['nom'].strip(), 'f': fiab, 'src': r.get('source', '').strip() or 'Liste officielle'}
        if r.get('statut'): upd['st'] = r['statut'].strip()
        if best:
            best['properties'].update(upd); best['geometry']['coordinates'] = [round(lon, 5), round(lat, 5)]; n_up += 1
        else:
            g = next((res[0] for _, res in RULES if res[1] == sub), 'svc')
            feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]},
                          'properties': dict({'g': g, 's': sub, 'st': 'public'}, **upd)}); n_add += 1
    log(f'  listes officielles : {n_up} confirmés, {n_add} ajoutés (absents d\'OSM)')

    # 3. Équipements projetés (couche séparée)
    proj = read_csv(os.path.join(ROOT, 'data', 'sources', 'equipements-projetes.csv'))
    for r in proj:
        try:
            lon, lat = float(r['lon']), float(r['lat'])
        except (TypeError, ValueError):
            continue
        feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]},
                      'properties': {'g': 'projet', 's': r['sous_type'].strip(), 'n': r['nom'].strip(), 'st': 'public',
                                     'f': (r.get('fiabilite') or 'B').strip().upper(), 'etat': r.get('etat', '').strip(),
                                     'annonce': r.get('date_annonce', '').strip(), 'src': r.get('source', '').strip(),
                                     'url': r.get('url', '').strip(), 'note': r.get('note', '').strip()}})
    log(f'  {len(proj)} équipements projetés')

    counts = {}
    for f in feats:
        k = f"{f['properties']['g']}/{f['properties']['s']}"; counts[k] = counts.get(k, 0) + 1
    meta = {'source': 'OpenStreetMap (ODbL) + listes officielles + annonces publiques', 'osm': not a.no_osm,
            'counts': dict(sorted(counts.items())), 'verified': n_up + n_add}
    feats.sort(key=lambda f: (f['properties']['g'], f['properties']['s'], f['properties']['n']))
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump({'type': 'FeatureCollection', 'meta': meta, 'features': feats}, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(ROOT, 'data', 'infrastructures-meta.json'), 'w', encoding='utf-8') as fh:
        json.dump({'updated': datetime.date.today().isoformat(), 'total': len(feats), 'osm': not a.no_osm}, fh)
    with open(os.path.join(ROOT, 'data', 'sources', 'infrastructures-table.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh); w.writerow(['groupe', 'sous_type', 'nom', 'statut', 'fiabilite', 'source', 'lon', 'lat', 'osm'])
        for f in feats:
            p = f['properties']; w.writerow([p['g'], p['s'], p['n'], p['st'], p['f'], p.get('src', ''), *f['geometry']['coordinates'], p.get('osm', '')])
    log(f'OK — {len(feats)} équipements : ' + ', '.join(f'{k} {v}' for k, v in sorted(counts.items())))


if __name__ == '__main__':
    main()
