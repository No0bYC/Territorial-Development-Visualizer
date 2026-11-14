#!/usr/bin/env python3
"""
TDV — Mise à jour de la couche Population
==========================================
Construit data/population.json (polygones + indicateurs) à partir de :
  1. CityPopulation.de (Th. Brinkhoff) — chiffres du recensement Statistics Mauritius
     2000 / 2011 / 2022 par Village Council Area et Municipal Council Area,
     + structure par sexe et par âge (2022) depuis la fiche détaillée de chaque zone.
  2. OpenStreetMap (Overpass API) — contours administratifs (ODbL).
  3. data/sources/population-overrides.csv — corrections ou valeurs officielles
     saisies à la main (prioritaires sur tout le reste).

Usage :  python3 scripts/update_population.py [--skip-details] [--out data/population.json]
Dépendances : shapely (pip install shapely)

Lancé automatiquement chaque mois par .github/workflows/update-population.yml,
ou à la demande (GitHub → Actions → « Mise à jour Population » → Run workflow).
"""
import argparse, csv, datetime, html, json, math, os, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = 'TDV-Mapping/0.3 (territorial map of Mauritius; non-commercial; monthly refresh)'
CP_BASE = 'https://www.citypopulation.de'
CP_ADMIN = CP_BASE + '/en/mauritius/admin/'
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
# Correspondances de noms quand CityPopulation et OpenStreetMap divergent (à compléter si besoin)
ALIASES = {
    'Amitié': ['Amitié – Gokhoola', 'Amitié – Gokoohla'],
    'Bois Chéri': ['Bois Chérie'],
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def log(*a): print('[population]', *a, flush=True)


def http(url, data=None, tries=6, wait=5, timeout=180):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            log(f'  échec ({e}) — nouvel essai dans {wait}s')
            time.sleep(wait); wait = min(wait * 2, 120)
    raise RuntimeError('Impossible de joindre ' + url)


def norm(s):
    s = (s or '').replace("'", '').replace('\u2019', '').replace('`', '')
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'\b(village council area|municipal council area|town of|city of|vca|the)\b', ' ', s)
    s = s.replace('st.', 'saint ').replace('ste.', 'sainte ')
    s = re.sub(r'\bst\b', 'saint', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return ' '.join(s.split())


def num(s):
    m = re.search(r'\d[\d,]*(?:\.\d+)?', s or '')
    return float(m.group().replace(',', '')) if m else None


# ---------------------------------------------------------------- CityPopulation
def parse_admin(page):
    units = []
    for row in re.findall(r'<tr[^>]*itemtype="http://schema.org/AdministrativeArea"[^>]*>(.*?)</tr>', page, re.S):
        m_id = re.search(r'id="i(\w+)"', row)
        name = re.search(r'itemprop="name">(.*?)</span>', row, re.S)
        status = re.search(r'class="rstatus">(.*?)</td>', row, re.S)
        pops = re.findall(r'class="rpop[^"]*">(.*?)</td>', row, re.S)
        href = re.search(r'href="(/en/mauritius/admin/[^"]+)"', row)
        g = lambda k: (re.search(k + r'="([^"]*)"', row) or [None, None])[1]
        if not (m_id and name):
            continue
        p = [num(re.sub('<.*?>', '', x)) for x in pops]
        units.append({
            'cp_id': m_id.group(1), 'name': html.unescape(re.sub('<.*?>', '', name.group(1))).strip(),
            'status': html.unescape(re.sub('<.*?>', '', status.group(1))).strip() if status else '',
            'pop2000': p[0] if len(p) > 0 else None, 'pop2011': p[1] if len(p) > 1 else None, 'pop2022': p[2] if len(p) > 2 else None,
            'area_km2': num(g('data-area')), 'wikidata': g('data-wd'),
            'detail': CP_BASE + urllib.parse.quote(html.unescape(href.group(1))) if href else None,
        })
    return units


def parse_detail(page):
    """Extrait sexe, grands groupes d'âge, tranches décennales et urbanisation (recensement 2022)."""
    text = html.unescape(re.sub(r'<[^>]+>', '|', page))
    text = re.sub(r'\|+', '|', text)
    out = {}
    def grab(label):
        m = re.search(r'\|\s*' + re.escape(label) + r'\s*\|\s*([\d,\.]+)\s*\|', text)
        return num(m.group(1)) if m else None
    for key, label in [('males', 'Males'), ('females', 'Females'), ('a0_14', '0-14 years'), ('a15_64', '15-64 years'),
                       ('a65p', '65+ years'), ('urban', 'Urban'), ('rural', 'Rural')]:
        out[key] = grab(label)
    bands = {}
    for lo in range(0, 70, 10):
        v = grab(f'{lo}-{lo + 9} years')
        if v is not None: bands[lo] = v
    v = grab('70+ years')
    if v is not None: bands[70] = v
    out['bands'] = bands
    return out


# ---------------------------------------------------------------- OpenStreetMap
def fetch_boundaries():
    q = ('[out:json][timeout:180];area["ISO3166-1"="MU"][admin_level=2]->.a;'
         'rel(area.a)[boundary=administrative][admin_level~"^(6|7|8|9|10)$"];out geom;')
    last = None
    for url in OVERPASS:
        try:
            log('Overpass :', url)
            return json.loads(http(url, data=urllib.parse.urlencode({'data': q}).encode(), tries=4, wait=10))
        except Exception as e:
            last = e
    raise RuntimeError(f'Overpass indisponible : {last}')


def rel_to_geom(el):
    from shapely.geometry import LineString, Polygon, MultiPolygon
    from shapely.ops import polygonize, unary_union
    outers, inners = [], []
    for m in el.get('members', []):
        if m.get('type') != 'way' or not m.get('geometry'):
            continue
        line = LineString([(p['lon'], p['lat']) for p in m['geometry']])
        (inners if m.get('role') == 'inner' else outers).append(line)
    if not outers:
        return None
    polys = list(polygonize(unary_union(outers)))
    if not polys:
        return None
    geom = unary_union(polys)
    if inners:
        holes = list(polygonize(unary_union(inners)))
        if holes:
            geom = geom.difference(unary_union(holes))
    return geom if geom.is_valid else geom.buffer(0)


# ---------------------------------------------------------------- Indicateurs
def indicators(u):
    d = u.get('d', {})
    p22, p11 = u.get('pop2022'), u.get('pop2011')
    out = {'pop2022': p22, 'pop2011': p11, 'pop2000': u.get('pop2000')}
    out['dens'] = round(p22 / u['area_km2']) if p22 and u.get('area_km2') else None
    out['growth'] = round(((p22 / p11) ** (1 / 11) - 1) * 100, 2) if p22 and p11 else None       # %/an 2011→2022
    out['growth_pct'] = round((p22 / p11 - 1) * 100, 1) if p22 and p11 else None                  # % total 2011→2022
    tot = (d.get('a0_14') or 0) + (d.get('a15_64') or 0) + (d.get('a65p') or 0)
    out['p014'] = round(100 * d['a0_14'] / tot, 1) if tot and d.get('a0_14') is not None else None
    out['p65'] = round(100 * d['a65p'] / tot, 1) if tot and d.get('a65p') is not None else None
    out['sexr'] = round(100 * d['males'] / d['females'], 1) if d.get('males') and d.get('females') else None
    b = d.get('bands') or {}
    if len(b) >= 7 and sum(b.values()):
        mid = {lo: lo + 5 for lo in range(0, 70, 10)}; mid[70] = 78
        out['age'] = round(sum(mid[int(k)] * v for k, v in b.items()) / sum(b.values()), 1)
    else:
        out['age'] = None
    ur = (d.get('urban') or 0) + (d.get('rural') or 0)
    out['urban'] = round(100 * (d.get('urban') or 0) / ur) if ur else None
    return out


def apply_overrides(units):
    path = os.path.join(ROOT, 'data', 'sources', 'population-overrides.csv')
    if not os.path.exists(path):
        return 0
    n = 0
    by = {norm(u['name']): u for u in units}
    with open(path, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            u = by.get(norm(r.get('name', '')))
            if not u:
                log('  override ignoré (zone inconnue) :', r.get('name')); continue
            for k, v in r.items():
                if k in ('name', 'note') or v in (None, ''):
                    continue
                if k in ('males', 'females', 'a0_14', 'a15_64', 'a65p', 'urban', 'rural'):
                    u.setdefault('d', {})[k] = float(v)
                else:
                    u[k] = float(v) if re.match(r'^-?[\d.]+$', v) else v
            u['override'] = r.get('note') or 'saisie manuelle'; n += 1
    return n


# ---------------------------------------------------------------- Main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'data', 'population.json'))
    ap.add_argument('--skip-details', action='store_true')
    ap.add_argument('--cache', default=os.path.join(ROOT, '.cache'))
    ap.add_argument('--reuse', action='store_true', help='réutiliser les téléchargements en cache (.cache/)')
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)

    cu, co = os.path.join(a.cache, 'units.json'), os.path.join(a.cache, 'osm.json')
    if a.reuse and os.path.exists(cu):
        units = json.load(open(cu)); a.skip_details = True; log('1-2/4 zones et fiches lues depuis le cache')
    else:
        log('1/4 CityPopulation : liste des zones')
        units = parse_admin(http(CP_ADMIN).decode('utf-8', 'replace'))
    units = [u for u in units if u.get('pop2022') or u.get('pop2011')]
    log(f'  {len(units)} zones')
    if len(units) < 100:
        raise SystemExit('Moins de 100 zones lues : la page a probablement changé de format. Arrêt sans rien modifier.')

    if not a.skip_details:
        log('2/4 CityPopulation : fiches détaillées (1 requête/s)')
        for i, u in enumerate(units):
            if not u['detail']:
                continue
            try:
                u['d'] = parse_detail(http(u['detail'], tries=3).decode('utf-8', 'replace'))
            except Exception as e:
                log('  fiche indisponible :', u['name'], e)
            time.sleep(1.0)
            if i % 25 == 0: log(f'  {i}/{len(units)}')

    json.dump(units, open(cu, 'w'))
    n_ovr = apply_overrides(units)
    log(f'  {n_ovr} correction(s) manuelle(s) appliquée(s)')

    log('3/4 OpenStreetMap : contours administratifs')
    from shapely.geometry import mapping, shape
    if a.reuse and os.path.exists(co):
        osm = json.load(open(co))
    else:
        osm = fetch_boundaries(); json.dump(osm, open(co, 'w'))
    rels = []
    for el in osm['elements']:
        t = el.get('tags', {})
        g = rel_to_geom(el)
        if g is None or g.is_empty:
            continue
        rels.append({'osm_id': el['id'], 'name': t.get('name', ''), 'alt': [t.get(k, '') for k in ('alt_name', 'official_name', 'name:en', 'name:fr', 'short_name')],
                     'wd': t.get('wikidata'), 'lvl': int(t.get('admin_level', 0)), 'geom': g})
    log(f'  {len(rels)} contours OSM')
    # Certains villages sont découpés en plusieurs parties dans OSM (« Mapou VCA, South », « Moka VCA, East »…) :
    # on les réunit en une seule géométrie.
    from shapely.ops import unary_union
    groups = {}
    for r in rels:
        if r['lvl'] in (8, 9) and re.search(r'\bVCA\b', r['name'], re.I):
            groups.setdefault(norm(re.sub(r'(?i)\s*\bVCA\b.*$', '', r['name'])), []).append(r)
        m = re.match(r'(?i)^(?:town|city) of (.+?), ward', r['name'])      # villes = somme des quartiers (wards)
        if r['lvl'] == 9 and m:
            groups.setdefault('ward:' + norm(m.group(1)), []).append(r)
    merged = [{'osm_id': ps[0]['osm_id'], 'name': k, 'alt': [], 'wd': None, 'lvl': 8,
               'geom': unary_union([x['geom'] for x in ps]).buffer(0)} for k, ps in groups.items()]
    log(f'  {len(merged)} villages reconstitués à partir de plusieurs parties')

    log('4/4 Appariement & indicateurs')
    by_wd = {}
    for r in rels:
        if r['wd']: by_wd.setdefault(r['wd'], r)
    by_name = {m['name']: m for m in merged if not m['name'].startswith('ward:')}
    wards = {m['name'][5:]: m for m in merged if m['name'].startswith('ward:')}
    for k, m in wards.items():
        by_name.setdefault(k, m)
    for r in sorted(rels, key=lambda r: abs(r['lvl'] - 8)):   # priorité au niveau 8 (villages)
        for n in [r['name']] + r['alt']:
            if n: by_name.setdefault(norm(n), r)
    feats, missing = [], []
    for u in units:
        r = by_wd.get(u['wikidata']) if u['wikidata'] else None
        r = r or by_name.get(norm(u['name']))
        if not r and u['name'] in ALIASES:
            parts = [by_name[norm(x)] for x in ALIASES[u['name']] if norm(x) in by_name]
            if parts:
                r = dict(parts[0], geom=unary_union([x['geom'] for x in parts]).buffer(0))
        if not r:
            # nom composé « A/B » (ex. Vacoas/Phoenix) ou variantes
            for part in re.split(r'[/,-]', u['name']):
                r = by_name.get(norm(part))
                if r: break
        if not r:
            missing.append(u['name']); continue
        g = r['geom'].simplify(0.0002, preserve_topology=True)
        props = {'name': u['name'], 'status': u['status'], 'osm_id': r['osm_id'], 'area': u['area_km2']}
        props.update(indicators(u))
        if u.get('override'): props['override'] = u['override']
        c = g.representative_point()
        props['cx'], props['cy'] = round(c.x, 5), round(c.y, 5)
        gm = mapping(g)
        gm = json.loads(json.dumps(gm), parse_float=lambda x: round(float(x), 5))
        feats.append({'type': 'Feature', 'geometry': gm, 'properties': props})

    # une même géométrie ne doit pas être utilisée deux fois
    seen = {}
    for f in feats:
        seen.setdefault(f['properties']['osm_id'], []).append(f['properties']['name'])
    dup = {k: v for k, v in seen.items() if len(v) > 1}

    meta = {'census': '2022-07-03',
            'source': 'Statistics Mauritius (recensements 2000, 2011, 2022) via CityPopulation.de ; contours © OpenStreetMap (ODbL)',
            'units': len(units), 'mapped': len(feats), 'missing': missing, 'duplicates': dup, 'overrides': n_ovr}
    out = {'type': 'FeatureCollection', 'meta': meta, 'features': feats}
    if len(feats) < 0.7 * len(units):
        raise SystemExit(f'Seulement {len(feats)}/{len(units)} zones cartographiées : fichier non remplacé. Manquantes : {missing}')
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(ROOT, 'data', 'population-meta.json'), 'w', encoding='utf-8') as f:
        json.dump({'updated': datetime.date.today().isoformat(), 'mapped': len(feats), 'units': len(units)}, f)
    with open(os.path.join(ROOT, 'data', 'sources', 'population-table.csv'), 'w', newline='', encoding='utf-8') as f:
        cols = ['name', 'status', 'pop2000', 'pop2011', 'pop2022', 'area', 'dens', 'growth', 'growth_pct', 'p014', 'p65', 'age', 'sexr', 'urban']
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore'); w.writeheader()
        for ft in sorted(feats, key=lambda x: x['properties']['name']): w.writerow(ft['properties'])
    log(f'OK — {len(feats)}/{len(units)} zones. Manquantes : {missing or "aucune"}. Doublons : {dup or "aucun"}')


if __name__ == '__main__':
    main()
