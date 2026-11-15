#!/usr/bin/env python3
"""
TDV — Construction de la couche « Projets des promoteurs »

Entrées (modifiables depuis GitHub, sans terminal) :
  data/sources/projets.csv              une ligne par projet (id, groupe, projet, statut, lat, lon, fiabilite_geo…)
  data/sources/perimetres/<ID>.geojson  périmètre d'un projet (polygone), nommé d'après son id (ex. ER-02.geojson)

Sorties :
  data/projets.json             points (un par projet localisé)
  data/projets-perimetres.json  polygones des projets dont le périmètre est tracé
  data/projets-meta.json        date, comptages, projets non localisés

Aucune dépendance externe : Python 3 standard.
"""
import csv, json, math, os, re, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'sources', 'projets.csv')
PER = os.path.join(ROOT, 'data', 'sources', 'perimetres')
OUT = os.path.join(ROOT, 'data')
BBOX = (57.28, -20.56, 57.82, -19.95)  # lon min, lat min, lon max, lat max


def statut(s):
    """Ramène le statut libre à 3 états : livre / encours / projete."""
    t = (s or '').lower()
    if 'projet' in t:
        return 'projete'
    if '/' in t or '+' in t:  # plusieurs phases à des stades différents
        return 'encours'
    if re.search(r'en cours|en vente|construction|chantier|lancé|livraison|rénovation|master plan|réservée|attendu', t):
        return 'encours'
    if re.search(r'livr|vendu|détenu|acquis|existant', t):
        return 'livre'
    return 'encours'


def categorie(ty):
    t = (ty or '').lower()
    if re.search(r'smart city|quartier|territoire|agrihood', t):
        return 'smart'
    if re.search(r'réserve|agricole|naturel|infrastructure', t):
        return 'foncier'
    if re.search(r'équipement|loisirs|hôtellerie', t) and 'commercial' not in t:
        return 'equip'
    if re.search(r'commercial|bureaux|activités|industrielle|mixte', t):
        return 'eco'
    return 'resid'  # résidentiel, lotissements, PDS, IRS, RES


def num(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


AGRI = os.path.join(OUT, 'terres-agricoles.json')
RAYON_M = 500


def croiser_terres_agricoles(pts, polys):
    """Drapeau sur_terre_agricole : oui (le point est sur une terre agricole observée), proche (à moins de 500 m), non.
    Projets à périmètre tracé (ex. Telfair) : le périmètre lui-même n'est pas qualifié ; on mesure les terres agricoles
    observées dans un anneau de 500 m autour (« proche » si au moins 1 ha). Positions D ou F : non concluant.
    Nécessite shapely et data/terres-agricoles.json ; sinon, le drapeau est simplement absent."""
    if not os.path.exists(AGRI):
        return None
    try:
        import shapely
        from shapely.geometry import shape, Point
        from shapely.strtree import STRtree
    except ImportError:
        print('shapely absent : croisement avec les terres agricoles ignoré', file=sys.stderr); return None
    K = math.cos(math.radians(-20.25))
    to_m = lambda xy: xy * [111320 * K, 110600]          # équirectangulaire local : < 1 % d'erreur sur 500 m
    geoms = [shapely.transform(shape(f['geometry']), to_m) for f in json.load(open(AGRI, encoding='utf-8'))['features']]
    tree = STRtree(geoms)
    per = {f['properties']['id']: shapely.transform(shape(f['geometry']), to_m) for f in polys}
    stats = {}
    for f in pts:
        p = f['properties']
        if p['id'] in per:
            zone = per[p['id']]; ring = zone.buffer(RAYON_M).difference(zone)
            ha = sum(geoms[i].intersection(ring).area for i in tree.query(ring)) / 1e4
            flag, extra = ('proche' if ha >= 1 else 'non'), {'agri_ha_500m': round(ha)}
        else:
            pt = Point(to_m(shapely.get_coordinates(Point(f['geometry']['coordinates'])))[0])
            if any(geoms[i].covers(pt) for i in tree.query(pt)):
                flag, extra = 'oui', {'agri_dist_m': 0}
            else:
                near = tree.query(pt.buffer(RAYON_M))
                d = min((geoms[i].distance(pt) for i in near), default=None)
                flag, extra = ('proche', {'agri_dist_m': round(d)}) if d is not None and d <= RAYON_M else ('non', {})
        p['sur_terre_agricole'] = flag; p.update(extra)
        p['agri_conclusif'] = p['f'] not in ('D', 'F')
        k = flag if p['agri_conclusif'] else 'non concluant'
        stats[k] = stats.get(k, 0) + 1
    for f in polys:  # le polygone reprend le drapeau de son point
        q = next(x['properties'] for x in pts if x['properties']['id'] == f['properties']['id'])
        f['properties'].update({k: q[k] for k in ('sur_terre_agricole', 'agri_conclusif', 'agri_ha_500m') if k in q})
    return stats


def area_ha(ring):
    k = math.cos(math.radians(sum(p[1] for p in ring) / len(ring)))
    xs = [p[0] * 111320 * k for p in ring]; ys = [p[1] * 110600 for p in ring]
    return abs(sum(xs[i] * ys[i + 1] - xs[i + 1] * ys[i] for i in range(len(ring) - 1))) / 2 / 1e4


def main():
    rows = list(csv.DictReader(open(SRC, encoding='utf-8')))
    if len(rows) < 10:
        sys.exit(f'Seulement {len(rows)} lignes dans projets.csv : arrêt par sécurité.')
    ids = [r['id'] for r in rows]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        sys.exit(f'Identifiants en double : {sorted(dup)}')

    # périmètres
    perims = {}
    if os.path.isdir(PER):
        for fn in sorted(os.listdir(PER)):
            if fn.endswith('.geojson'):
                g = json.load(open(os.path.join(PER, fn), encoding='utf-8'))
                f = g['features'][0] if g.get('type') == 'FeatureCollection' else g
                pid = f.get('properties', {}).get('id') or fn[:-8]
                perims[pid] = f

    pts, polys, sans = [], [], []
    seen = {}
    for r in rows:
        p = {
            'id': r['id'], 'n': r['projet'], 'grp': r['groupe'], 'taille': r['taille'], 'fil': r['filiale'],
            'type': r['type'], 'cat': categorie(r['type']), 'reg': r['regime'], 'statut': r['statut'], 'st': statut(r['statut']),
            'an': r['annee'], 'loc': r['localite'], 'dist': r['district'], 'surf': r['surface'],
            'bud': num(r['budget_mur']), 'bud_info': r['info_budget'], 'url': r['source_url'], 'note': r['notes'],
            'f': (r['fiabilite_geo'] or 'F').strip().upper()[:1],
        }
        per = perims.get(r['id'])
        if per:
            pp = dict(p); pp.update({'f': per['properties'].get('f', 'B'), 'methode': per['properties'].get('methode', ''),
                                     'per_src': per['properties'].get('source', ''), 'ha_trace': round(area_ha(per['geometry']['coordinates'][0]))})
            polys.append({'type': 'Feature', 'geometry': per['geometry'], 'properties': pp})
            p['per'] = 1
            ring = per['geometry']['coordinates'][0]
            # le point d'un projet tracé passe au centre de son périmètre
            lon = sum(q[0] for q in ring[:-1]) / (len(ring) - 1); lat = sum(q[1] for q in ring[:-1]) / (len(ring) - 1)
            p['f'] = pp['f']
        else:
            try:
                lat, lon = float(r['lat']), float(r['lon'])
            except ValueError:
                sans.append(r['id']); continue
        if not (BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]):
            sys.exit(f"{r['id']} hors de Maurice ({lat}, {lon}) : vérifier lat/lon.")
        # projets aux coordonnées identiques : léger décalage d'affichage (≈40 m) pour qu'ils restent cliquables
        key = (round(lat, 4), round(lon, 4)); n = seen.get(key, 0); seen[key] = n + 1
        if n:
            a = n * 2.4
            lon += 0.0004 * math.cos(a); lat += 0.0004 * math.sin(a); p['decale'] = 1
        pts.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]}, 'properties': p})

    agri = croiser_terres_agricoles(pts, polys)

    w = lambda name, obj: json.dump(obj, open(os.path.join(OUT, name), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    w('projets.json', {'type': 'FeatureCollection', 'features': pts})
    w('projets-perimetres.json', {'type': 'FeatureCollection', 'features': polys})
    cnt = lambda k: {v: sum(1 for f in pts if f['properties'][k] == v) for v in sorted({f['properties'][k] for f in pts})}
    meta = {'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'projets': len(rows), 'localises': len(pts),
            'perimetres': len(polys), 'sans_coordonnees': sans, 'statuts': cnt('st'), 'categories': cnt('cat'), 'fiabilite': cnt('f')}
    if agri is not None:
        meta['terres_agricoles'] = agri
    json.dump(meta, open(os.path.join(OUT, 'projets-meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
