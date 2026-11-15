#!/usr/bin/env python3
"""
TDV — Couche « Usage agricole observé » (fiabilité C)

Fusionne deux sources d'occupation RÉELLE du sol (pas le zonage légal) :
  1. ESA WorldCover 10 m v200 (2021), tuile S21E057, classe 40 « Cropland » — licence CC BY 4.0
  2. OpenStreetMap : landuse = farmland (dont crop=sugarcane), orchard, plantation, farmyard,
     greenhouse_horticulture — licence ODbL
puis retire les surfaces bâties (WorldCover classe 50 ; OSM landuse = residential / industrial / commercial).

Méthode (tout se fait sur la grille de 10 m de WorldCover, ce qui évite les calculs vectoriels lourds) :
  - découpe sur l'île Maurice seule (cadre -20.56/-19.95, 57.28/57.82 : Rodrigues, Agaléga et Cargados
    sont hors de la tuile et hors du cadre) ;
  - rasterisation des polygones OSM sur la même grille ;
  - code par pixel : 1 = ESA seul, 2 = OSM seul, 3 = les deux ; 0 = non agricole ou bâti ;
  - suppression des îlots de moins de MIN_HA (et comblement des trous de même taille) ;
  - vectorisation, simplification à SIMPLIFY_M mètres dans une projection métrique (UTM 40S).

Sorties :
  data/terres-agricoles.json       GeoJSON (chargé à la demande par l'application)
  data/terres-agricoles-meta.json  surfaces, poids, comptages, dates des sources

Rejouable : python3 scripts/build_terres_agricoles.py   (≈ 2 à 6 min)
Options   : --tif CHEMIN  (tuile déjà téléchargée)  --osm CHEMIN (export Overpass JSON déjà téléchargé)
Dépendances : rasterio, shapely, pyproj, numpy (installées par le workflow).
"""
import argparse, json, math, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

import numpy as np
import rasterio
from rasterio import features
from rasterio.windows import from_bounds
from shapely.geometry import Polygon, MultiPolygon, shape, mapping
import shapely
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
TILE_URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_S21E057_Map.tif'
BOUNDS = (57.28, -20.56, 57.82, -19.95)          # lon min, lat min, lon max, lat max — île Maurice seule
MIN_HA = 1                                        # parcelles et trous plus petits : supprimés
SIMPLIFY_M = 20                                   # tolérance de simplification (mètres) — cohérente avec des pixels de 10 m
MAX_MB = 5                                        # au-delà : passer à PMTiles (arrêt avec message)
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
BB = f'{BOUNDS[1]},{BOUNDS[0]},{BOUNDS[3]},{BOUNDS[2]}'
QUERY = f"""[out:json][timeout:240];
(
  nwr[landuse~"^(farmland|orchard|plantation|farmyard|greenhouse_horticulture)$"]({BB});
  nwr[landuse~"^(residential|industrial|commercial)$"]({BB});
);
out geom;"""
AGRI = {'farmland', 'orchard', 'plantation', 'farmyard', 'greenhouse_horticulture'}
BUILT = {'residential', 'industrial', 'commercial'}
SRC_LABEL = {1: 'ESA', 2: 'OSM', 3: 'ESA+OSM'}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def download(url, dest):
    log('Téléchargement', url)
    req = urllib.request.Request(url, headers={'User-Agent': 'TDV-Mauritius/0.7'})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, 'wb') as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    if os.path.getsize(dest) < 1_000_000:
        sys.exit('Tuile WorldCover anormalement petite : téléchargement incomplet.')


def overpass():
    last = None
    for attempt in range(3):
        for u in OVERPASS:
            try:
                req = urllib.request.Request(u, data=urllib.parse.urlencode({'data': QUERY}).encode(),
                                             headers={'User-Agent': 'TDV-Mauritius/0.7 (github.com/No0bYC)'})
                r = json.loads(urllib.request.urlopen(req, timeout=300).read())
                if r.get('elements'):
                    return r
            except Exception as e:
                last = e; log('Overpass', u, '→', e)
        time.sleep(30)
    sys.exit(f'Overpass indisponible : {last}')


def rings_of(e):
    """Anneaux extérieurs et intérieurs d'un way fermé ou d'une relation multipolygone (morceaux recousus)."""
    if e['type'] == 'way':
        g = [(q['lon'], q['lat']) for q in e.get('geometry', [])]
        return ([g], []) if len(g) > 3 and g[0] == g[-1] else ([], [])
    out, inn = [], []
    for role, acc in (('outer', out), ('inner', inn)):
        segs = [[(q['lon'], q['lat']) for q in m['geometry']] for m in e.get('members', [])
                if m.get('type') == 'way' and m.get('geometry') and (m.get('role') or 'outer') == role]
        while segs:
            ring = segs.pop(0); grown = True
            while ring[0] != ring[-1] and grown:
                grown = False
                for i, sg in enumerate(segs):
                    if sg[0] == ring[-1]: ring = ring + sg[1:]
                    elif sg[-1] == ring[-1]: ring = ring + sg[::-1][1:]
                    elif sg[-1] == ring[0]: ring = sg[:-1] + ring
                    elif sg[0] == ring[0]: ring = sg[::-1][:-1] + ring
                    else: continue
                    segs.pop(i); grown = True; break
            if len(ring) > 3 and ring[0] == ring[-1]:
                acc.append(ring)
    return out, inn


def burn(elements, keys, shape_hw, tr):
    """Rasterise les polygones OSM retenus (extérieurs à 1, puis trous à 0)."""
    outers, inners = [], []
    for e in elements:
        if e.get('tags', {}).get('landuse') in keys:
            o, i = rings_of(e)
            outers += [Polygon(r) for r in o]; inners += [Polygon(r) for r in i]
    m = np.zeros(shape_hw, dtype=np.uint8)
    if outers:
        features.rasterize([(p, 1) for p in outers], out=m, transform=tr, all_touched=False)
    if inners:
        features.rasterize([(p, 0) for p in inners], out=m, transform=tr, all_touched=False)
    return m.astype(bool), len(outers)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tif'); ap.add_argument('--osm')
    a = ap.parse_args()
    t0 = time.time()

    tif = a.tif or '/tmp/worldcover_S21E057.tif'
    if not a.tif and not os.path.exists(tif):
        download(TILE_URL, tif)
    osm = json.load(open(a.osm)) if a.osm else overpass()
    osm_date = (osm.get('osm3s', {}).get('timestamp_osm_base') or datetime.now(timezone.utc).isoformat())[:10]
    E = osm['elements']

    with rasterio.open(tif) as src:
        win = from_bounds(*BOUNDS, transform=src.transform).round_offsets().round_lengths()
        wc = src.read(1, window=win)
        tr = src.window_transform(win)
    px_m2 = abs(tr.a) * 111320 * math.cos(math.radians(-20.25)) * abs(tr.e) * 110600
    log(f'Grille : {wc.shape[1]} × {wc.shape[0]} pixels, {px_m2:.0f} m² par pixel')

    esa = wc == 40
    built_esa = wc == 50
    osm_agri, n_agri = burn(E, AGRI, wc.shape, tr)
    osm_built, n_built = burn(E, BUILT, wc.shape, tr)
    built = built_esa | osm_built
    code = (esa.astype(np.uint8) | (osm_agri.astype(np.uint8) << 1))
    code[built] = 0
    del esa, osm_agri, osm_built, built_esa

    # Nettoyage : îlots et trous < MIN_HA (le tamis fusionne les petites zones dans leur voisine)
    min_px = int(round(MIN_HA * 10000 / px_m2))
    code = features.sieve(code, size=min_px, connectivity=8)
    log(f'Tamis {MIN_HA} ha = {min_px} pixels ; {time.time() - t0:.0f} s')

    # Vectorisation puis simplification en mètres (UTM 40S)
    t_m = Transformer.from_crs('EPSG:4326', 'EPSG:32740', always_xy=True)
    t_ll = Transformer.from_crs('EPSG:32740', 'EPSG:4326', always_xy=True)
    to_m = lambda xy: np.column_stack(t_m.transform(xy[:, 0], xy[:, 1]))
    to_ll = lambda xy: np.column_stack(t_ll.transform(xy[:, 0], xy[:, 1]))
    feats, tot = [], {1: 0.0, 2: 0.0, 3: 0.0}
    for geom, val in features.shapes(code, mask=code > 0, transform=tr, connectivity=8):
        v = int(val)
        g = shapely.transform(shape(geom), to_m)
        g = g.simplify(SIMPLIFY_M, preserve_topology=True)
        if g.is_empty or g.area < MIN_HA * 10000:
            continue
        ha = g.area / 10000; tot[v] += ha
        g = shapely.transform(g, to_ll)
        gj = mapping(g)

        def rnd(c):
            return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]   # 4 décimales ≈ 11 m
        gj = {'type': gj['type'], 'coordinates': rnd(gj['coordinates'])}
        date = {1: '2021', 2: osm_date, 3: '2021+' + osm_date}[v]          # satellite 2021 / date d'extraction OSM
        feats.append({'type': 'Feature', 'geometry': gj,
                      'properties': {'source': SRC_LABEL[v], 'surface_ha': round(ha, 1), 'fiabilite': 'C', 'date_source': date}})

    out = os.path.join(DATA, 'terres-agricoles.json')
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    mb = os.path.getsize(out) / 1e6

    # Surface OSM agricole non vue par le satellite (indicateur de l'écart canne / prairie)
    meta = {
        'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'sources': {'esa_worldcover': 'v200, 2021, tuile S21E057, classe 40 (CC BY 4.0)', 'osm': f'extraction du {osm_date} (ODbL)'},
        'parametres': {'surface_min_ha': MIN_HA, 'simplification_m': SIMPLIFY_M, 'cadre': BOUNDS},
        'polygones': len(feats), 'poids_mo': round(mb, 2),
        'surface_ha': {SRC_LABEL[k]: round(v) for k, v in tot.items()}, 'surface_totale_ha': round(sum(tot.values())),
        'osm_polygones_agricoles': n_agri, 'osm_polygones_batis': n_built,
        'osm_seul_part': round(tot[2] / max(1, sum(tot.values())) * 100, 1),
        'duree_s': round(time.time() - t0),
    }
    json.dump(meta, open(os.path.join(DATA, 'terres-agricoles-meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False, indent=1))
    if mb > MAX_MB:
        sys.exit(f'Fichier de {mb:.1f} Mo > {MAX_MB} Mo : augmenter SIMPLIFY_M ou passer au format PMTiles.')


if __name__ == '__main__':
    main()
