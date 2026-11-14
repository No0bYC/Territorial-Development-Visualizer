#!/usr/bin/env python3
"""
TDV — Hôtels, hébergements touristiques et centres commerciaux

Sources :
  - OpenStreetMap (Overpass) : positions, contours des centres commerciaux, quelques attributs (étoiles, chambres)
  - data/sources/hotels-reference.csv              : hôtels vérifiés / enrichis (étoiles, chambres, groupe) → fiabilité A ou B
  - data/sources/centres-commerciaux-reference.csv : grands centres (opérateur, surface locative, ouverture) + projets annoncés

Sorties :
  data/hotels.json                 points : hôtels, résidences touristiques, maisons d'hôtes
  data/centres-commerciaux.json    contours (Polygon) quand OSM les a, sinon points ; projets annoncés en points
  data/hotels-commerces-meta.json  date, comptages
  data/sources/hotels-table.csv    table de contrôle (à ouvrir dans un tableur)

Options : --no-osm (reconstruit seulement à partir des listes de référence et du dernier cache OSM)
Python 3 standard, aucune dépendance.
"""
import csv, json, math, os, re, sys, time, unicodedata, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data'); SRC = os.path.join(DATA, 'sources')
CACHE = os.path.join(SRC, 'osm-hotels-commerces-cache.json')
BBOX = '-20.56,57.28,-19.95,57.82'
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
             'https://maps.mail.ru/osm/tools/overpass/api/interpreter']

QUERY = f"""[out:json][timeout:180];
(
  nwr[tourism~"^(hotel|resort|motel|guest_house|apartment|hostel|chalet)$"]({BBOX});
);
out center tags;
(
  nwr[shop=mall]({BBOX});
);
out geom;"""

# Type d'hébergement
KIND = {'hotel': 'hotel', 'resort': 'hotel', 'motel': 'hotel', 'apartment': 'residence', 'guest_house': 'pension', 'hostel': 'pension', 'chalet': 'residence'}

# Groupes hôteliers reconnus d'après le nom ou l'opérateur (indicatif, à confirmer via la liste de référence)
GROUPS = [
    ('Beachcomber', r'beachcomber|royal palm|dinarobin|paradis hotel|^paradis|trou aux biches resort|victoria (beachcomber|for 2)|canonnier|mauricia|shandrani'),
    ('Constance', r'constance|prince maurice|belle mare plage'),
    ('LUX Collective', r'\blux\b|lux\*|tamassa|salt of palmar|merville'),
    ('Sunlife', r'sunlife|long beach|sugar beach|la pirogue|\bambre\b|touessrok'),
    ('Heritage / Veranda (Rogers)', r'heritage|veranda|kaz.?alala|c mauritius'),
    ('Attitude', r'attitude|zilwa|ravenala|friday|paradise cove|coin de mire|lagoon attitude|recif'),
    ('Marriott', r'marriott|westin|st\.? regis|le m[ée]ridien|courtyard|sheraton|ritz'),
    ('Accor', r'sofitel|novotel|\bibis\b|mercure|movenpick|mövenpick|fairmont|pullman|so/'),
    ('Hilton', r'hilton|doubletree'),
    ('IHG', r'holiday inn|intercontinental'),
    ('Indigo Hotels', r'indigo|labourdonnais|suffren|hennessy park|the address'),
    ('Club Med', r'club med'),
    ('Four Seasons', r'four seasons'),
    ('One&Only', r'one ?& ?only|saint g[ée]ran'),
    ('Anantara', r'anantara'),
    ('Shangri-La', r'shangri'),
    ('Oberoi', r'oberoi'),
    ('Radisson', r'radisson'),
    ('Beau Vallon', r'preskil|solana'),
]


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"\b(hotel|resort|spa|the|le|la|les|by|and|&|mauritius|ile maurice|beach)\b", ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def dist_m(a, b):
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * 111320 * k, (a[1] - b[1]) * 110600)


def ring_area_m2(ring):
    k = math.cos(math.radians(ring[0][1]))
    xs = [p[0] * 111320 * k for p in ring]; ys = [p[1] * 110600 for p in ring]
    return abs(sum(xs[i] * ys[i + 1] - xs[i + 1] * ys[i] for i in range(len(ring) - 1))) / 2


def overpass():
    last = None
    for attempt in range(2):
        for u in ENDPOINTS:
            try:
                req = urllib.request.Request(u, data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'TDV-Mauritius/0.6 (github.com/No0bYC)'})
                r = json.loads(urllib.request.urlopen(req, timeout=240).read())
                if r.get('elements'):
                    return r['elements']
            except Exception as e:
                last = e; print('Overpass', u, '→', e, file=sys.stderr)
        time.sleep(20)
    raise SystemExit(f'Overpass indisponible : {last}')


def num(x):
    try:
        return int(float(str(x).replace(' ', '').replace(',', '.')))
    except (TypeError, ValueError):
        return None


def read_csv(name):
    p = os.path.join(SRC, name)
    return list(csv.DictReader(open(p, encoding='utf-8'))) if os.path.exists(p) else []


def main():
    no_osm = '--no-osm' in sys.argv
    if no_osm:
        E = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else []
    else:
        E = overpass()
        json.dump(E, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    acc = [e for e in E if e.get('tags', {}).get('tourism') in KIND]
    malls = [e for e in E if e.get('tags', {}).get('shop') == 'mall']
    if not no_osm and (len(acc) < 300 or len(malls) < 30):
        sys.exit(f'Résultat OSM anormalement faible ({len(acc)} hébergements, {len(malls)} centres) : arrêt par sécurité.')

    # ---------------- Hébergements ----------------
    hotels = []
    for e in acc:
        t = e['tags']; c = e.get('center') or e
        if 'lat' not in c:
            continue
        name = t.get('name') or t.get('name:fr') or t.get('name:en') or ''
        kind = KIND[t['tourism']]
        hay = (name + ' ' + t.get('operator', '') + ' ' + t.get('brand', '')).lower()
        grp = next((g for g, rx in GROUPS if re.search(rx, hay)), '')
        stars = num(re.sub(r'[^0-9.]', '', t.get('stars', ''))) if t.get('stars') else None
        p = {'n': name or {'hotel': 'Hôtel', 'residence': 'Résidence touristique', 'pension': "Maison d'hôtes"}[kind] + ' (sans nom)',
             'k': kind, 'etoiles': stars if stars and 1 <= stars <= 5 else None, 'chambres': num(t.get('rooms')),
             'grp': grp, 'op': t.get('operator') or t.get('brand') or '', 'web': t.get('website') or t.get('contact:website') or '',
             'osm': f"{e['type']}/{e['id']}", 'src': 'OpenStreetMap', 'f': 'C'}
        hotels.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(c['lon'], 6), round(c['lat'], 6)]}, 'properties': p})

    # rapprochement avec la liste de référence (nom proche à moins de 1,5 km, ou même lieu à moins de 150 m)
    ref_h = read_csv('hotels-reference.csv'); added_h = 0; matched_h = 0
    for r in ref_h:
        try:
            ll = (float(r['lon']), float(r['lat']))
        except (ValueError, KeyError):
            ll = None
        nr = norm(r['nom']); best = None
        for f in hotels:
            d = dist_m(ll, f['geometry']['coordinates']) if ll else 0
            nf = norm(f['properties']['n'])
            same = nr and nf and (nr in nf or nf in nr)
            if (same and d < 1500) or (ll and d < 150 and f['properties']['k'] == 'hotel'):
                if best is None or d < best[0]:
                    best = (d, f)
        upd = {'n': r['nom'], 'k': 'hotel', 'etoiles': num(r.get('etoiles')), 'chambres': num(r.get('chambres')), 'grp': r.get('groupe', ''),
               'src': r.get('source', '') or 'Liste de référence', 'url': r.get('source_url', ''), 'f': (r.get('fiabilite') or 'B').strip()[:1]}
        upd = {k: v for k, v in upd.items() if v not in (None, '')}
        if best:
            best[1]['properties'].update(upd); matched_h += 1
            if ll and (r.get('fiabilite') or '') == 'A':
                best[1]['geometry']['coordinates'] = [round(ll[0], 6), round(ll[1], 6)]
        elif ll:
            hotels.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(ll[0], 6), round(ll[1], 6)]}, 'properties': dict(upd, osm='')}); added_h += 1

    # ---------------- Centres commerciaux ----------------
    centres = []
    for e in malls:
        t = e['tags']; name = t.get('name') or ''
        geom = None
        if e['type'] == 'way' and e.get('geometry'):
            ring = [[round(q['lon'], 6), round(q['lat'], 6)] for q in e['geometry']]
            if len(ring) > 3 and ring[0] == ring[-1]:
                geom = {'type': 'Polygon', 'coordinates': [ring]}
        elif e['type'] == 'relation' and e.get('members'):
            # les contours de relations arrivent en morceaux : on les recoud en anneaux fermés
            segs = [[[round(q['lon'], 6), round(q['lat'], 6)] for q in m['geometry']] for m in e['members']
                    if m.get('role') in ('outer', '') and m.get('type') == 'way' and m.get('geometry')]
            rings = []
            while segs:
                ring = segs.pop(0)
                grown = True
                while ring[0] != ring[-1] and grown:
                    grown = False
                    for i, sg in enumerate(segs):
                        if sg[0] == ring[-1]: ring += sg[1:]
                        elif sg[-1] == ring[-1]: ring += sg[::-1][1:]
                        elif sg[-1] == ring[0]: ring = sg[:-1] + ring
                        elif sg[0] == ring[0]: ring = sg[::-1][:-1] + ring
                        else: continue
                        segs.pop(i); grown = True; break
                if len(ring) > 3 and ring[0] == ring[-1]:
                    rings.append([ring])
            if rings:
                geom = {'type': 'MultiPolygon', 'coordinates': rings} if len(rings) > 1 else {'type': 'Polygon', 'coordinates': rings[0]}
            elif e.get('bounds'):
                b = e['bounds']; e['center'] = {'lat': (b['minlat'] + b['maxlat']) / 2, 'lon': (b['minlon'] + b['maxlon']) / 2}
        if geom:
            rings = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            emp = round(sum(ring_area_m2(rg[0]) for rg in rings))
            pts = [p for rg in rings for p in rg[0][:-1]]
            cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        else:
            if e.get('bounds') and not e.get('center'):
                b = e['bounds']; e['center'] = {'lat': (b['minlat'] + b['maxlat']) / 2, 'lon': (b['minlon'] + b['maxlon']) / 2}
            c = e.get('center') or e
            if 'lat' not in c:
                continue
            emp = None; cx, cy = c['lon'], c['lat']; geom = {'type': 'Point', 'coordinates': [cx, cy]}
        p = {'n': name or 'Centre commercial (sans nom)', 'statut': 'existant', 'op': t.get('operator') or '', 'emprise': emp,
             'cx': round(cx, 6), 'cy': round(cy, 6), 'osm': f"{e['type']}/{e['id']}", 'src': 'OpenStreetMap', 'f': 'C'}
        centres.append({'type': 'Feature', 'geometry': geom, 'properties': p})

    ref_c = read_csv('centres-commerciaux-reference.csv'); added_c = 0; matched_c = 0
    for r in ref_c:
        try:
            ll = (float(r['lon']), float(r['lat']))
        except (ValueError, KeyError):
            ll = None
        keys = [norm(x) for x in (r.get('osm_nom') or r['nom']).split('|') if x.strip()]
        best = None
        if r.get('statut', 'existant') == 'existant':
            for f in centres:
                nf = norm(f['properties']['n']); d = dist_m(ll, (f['properties']['cx'], f['properties']['cy'])) if ll else 0
                if nf and any(k and (k == nf or k in nf or nf in k) for k in keys) and d < 2000:
                    if best is None or d < best[0]:
                        best = (d, f)
        upd = {'n': r['nom'], 'statut': r.get('statut') or 'existant', 'op': r.get('operateur', ''), 'gla': num(r.get('gla_m2')), 'boutiques': num(r.get('boutiques')),
               'annee': r.get('annee', ''), 'note': r.get('notes', ''), 'src': r.get('source', '') or 'Liste de référence', 'url': r.get('source_url', ''),
               'f': (r.get('fiabilite') or 'B').strip()[:1], 'ref': r['id']}
        upd = {k: v for k, v in upd.items() if v not in (None, '')}
        if best:
            best[1]['properties'].update(upd); matched_c += 1
        elif ll:
            centres.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(ll[0], 6), round(ll[1], 6)]},
                            'properties': dict(upd, cx=round(ll[0], 6), cy=round(ll[1], 6), emprise=None, osm='')}); added_c += 1

    # Taille : régional (≥ 15 000 m² GLA ou emprise ≥ 12 000 m²), quartier, proximité
    for f in centres:
        p = f['properties']; size = p.get('gla') or (p.get('emprise') or 0) * 1.25
        p['taille'] = 'regional' if size >= 15000 else ('quartier' if size >= 4000 else 'proximite')
        p['h'] = 12 if p['taille'] == 'regional' else (8 if p['taille'] == 'quartier' else 5)
    # les centres sans nom ni attribut sont souvent des doublons de bâtiments : on les garde mais en « proximité »

    w = lambda name, obj: json.dump(obj, open(os.path.join(DATA, name), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    w('hotels.json', {'type': 'FeatureCollection', 'features': hotels})
    w('centres-commerciaux.json', {'type': 'FeatureCollection', 'features': centres})
    from collections import Counter
    meta = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'hebergements': dict(Counter(f['properties']['k'] for f in hotels)), 'hotels_ref_rapproches': matched_h, 'hotels_ref_ajoutes': added_h,
            'hotels_avec_chambres': sum(1 for f in hotels if f['properties'].get('chambres')), 'hotels_avec_etoiles': sum(1 for f in hotels if f['properties'].get('etoiles')),
            'hotels_par_groupe': dict(Counter(f['properties']['grp'] for f in hotels if f['properties'].get('grp'))),
            'centres': dict(Counter(f['properties']['taille'] for f in centres)), 'centres_projetes': sum(1 for f in centres if f['properties']['statut'] != 'existant'),
            'centres_ref_rapproches': matched_c, 'centres_ref_ajoutes': added_c, 'fiabilite': dict(Counter(f['properties']['f'] for f in hotels + centres))}
    json.dump(meta, open(os.path.join(DATA, 'hotels-commerces-meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(os.path.join(SRC, 'hotels-table.csv'), 'w', encoding='utf-8', newline='') as fh:
        cw = csv.writer(fh); cw.writerow(['type', 'nom', 'groupe', 'etoiles', 'chambres', 'lat', 'lon', 'fiabilite', 'osm'])
        for f in sorted(hotels, key=lambda f: (f['properties']['k'], f['properties']['n'])):
            p = f['properties']; cw.writerow([p['k'], p['n'], p.get('grp', ''), p.get('etoiles') or '', p.get('chambres') or '', f['geometry']['coordinates'][1], f['geometry']['coordinates'][0], p['f'], p.get('osm', '')])
    print(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
