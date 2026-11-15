/* =========================================================
   TDV — Application
   Carte : MapLibre GL (open source). Données : /data/*.json
   ========================================================= */
(async function () {
  const CFG = window.TDV;
  const C = CFG.colors;
  const $ = (s) => document.querySelector(s);
  const isMobile = () => window.innerWidth <= 820;
  const fmt = (n) => Number(n).toLocaleString('fr-FR');
  const SEA = '#F1F1EF';

  /* ---------- Service worker (mode hors-ligne + installation iPhone) ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  /* ---------- Splash ---------- */
  $('#stripes').innerHTML = Object.entries(C).filter(([k]) => !['pot', 'base'].includes(k))
    .map(([, c]) => `<span style="background:${c}"></span>`).join('');
  let entered = false, ready = false;
  $('#enter').onclick = () => { $('#splash').classList.add('out'); entered = true; if (ready) intro(); };

  /* ---------- Données ---------- */
  const D = {};
  const loadFiles = (files) => Promise.all(Object.entries(files).map(async ([k, f]) => {
    const r = await fetch('/data/' + f); if (!r.ok) throw new Error(f); D[k] = await r.json();
  }));

  /* ---------- Fond de carte : OpenStreetMap (OpenFreeMap) restylé noir & blanc ----------
     En cas d'échec (hors-ligne, service indisponible), repli sur le fond de démonstration. */
  let style = null, BASE = 'osm';
  try {
    const [st] = await Promise.all([fetchStyle(), loadFiles(CFG.dataFiles)]);
    style = st;
  } catch (e) {
    try {
      if (!D.hex) await loadFiles(CFG.dataFiles);
      await loadFiles(CFG.demoBaseFiles); BASE = 'demo';
      style = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': SEA } }] };
    } catch (e2) { $('#loading').textContent = 'Erreur de chargement : ' + e2.message; return; }
  }
  $('#loading').textContent = '';
  $('#enter').disabled = false;

  async function fetchStyle() {
    if (location.search.includes('base=demo')) throw new Error('demo');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(CFG.basemap.style, { signal: ctrl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error('style');
    return restyle(await r.json());
  }
  /* Recoloration du style Positron : terre blanche, mer grise, routes noires */
  function restyle(st) {
    const P = {
      background: { 'background-color': '#FAFAF8' },
      water: { 'fill-color': '#E3E4E6' }, waterway: { 'line-color': '#D3D6DA' },
      park: { 'fill-color': '#EEF1EC' }, landcover_wood: { 'fill-color': '#ECEFE9' }, landuse_residential: { 'fill-color': '#F2F2F0' },
      building: { 'fill-color': '#E8E8E9', 'fill-outline-color': '#DADADC' },
      highway_path: { 'line-color': '#D6D6DA' }, highway_minor: { 'line-color': '#C9C9CE' },
      highway_major_casing: { 'line-color': '#FFFFFF' }, highway_major_inner: { 'line-color': '#4A4A4F' }, highway_major_subtle: { 'line-color': '#8A8A8F' },
      highway_motorway_casing: { 'line-color': '#FFFFFF' }, highway_motorway_inner: { 'line-color': '#0B0B0C' }, highway_motorway_subtle: { 'line-color': '#3A3A3D' },
      highway_motorway_bridge_casing: { 'line-color': '#FFFFFF' }, highway_motorway_bridge_inner: { 'line-color': '#0B0B0C' },
      tunnel_motorway_inner: { 'line-color': '#55555A' }, railway: { 'line-color': '#9A9AA0' }
    };
    st.layers.forEach((l) => {
      if (P[l.id]) l.paint = Object.assign(l.paint || {}, P[l.id]);
      if (l.type === 'symbol' && l.paint && 'text-color' in l.paint) {
        const strong = /label_(city|town)/.test(l.id);
        Object.assign(l.paint, { 'text-color': strong ? '#0B0B0C' : '#4A4A4F', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.4 });
      }
    });
    st.layers = st.layers.filter((l) => !/shield|road_shield/.test(l.id));
    return st;
  }

  /* ---------- Indicateurs population ---------- */
  let metric = 'dens';
  const rampOf = (m) => CFG.metrics[m].ramp || CFG.popRamp;
  const rampExpr = (m) => { const M = CFG.metrics[m], s = (M.max - M.min) / 4;
    return ['case', ['==', ['typeof', ['get', m]], 'number'], ['interpolate', ['linear'], ['get', m], ...rampOf(m).flatMap((c, i) => [M.min + s * i, c])], '#D9D9DD']; };
  const heightExpr = (m) => { const M = CFG.metrics[m];
    return ['case', ['==', ['typeof', ['get', m]], 'number'], ['interpolate', ['linear'], ['get', m], M.min, 30, M.max, M.h], 20]; };
  const subFilters = {};
  CFG.layers.forEach((l) => { if (l.ui === 'chips') subFilters[l.id] = new Set(l.options.filter((o) => o[2] !== false).map((o) => o[0])); });
  /* Filtres globaux : statut public/privé et fiabilité minimale (s'appliquent à toutes les couches d'équipements) */
  const FIAB_ORDER = ['A', 'B', 'C', 'D', 'F'];
  let gStatus = 'all', gFiab = 'F';
  const infraFilter = (l) => {
    const f = ['all', ['==', ['get', 'g'], l.infra], ['in', ['get', 's'], ['literal', [...subFilters[l.id]]]]];
    if (gStatus !== 'all') f.push(['==', ['get', 'st'], gStatus]);
    f.push(['in', ['get', 'f'], ['literal', FIAB_ORDER.slice(0, FIAB_ORDER.indexOf(gFiab) + 1)]]);
    return f;
  };

  /* Filtres des projets promoteurs : statut, catégorie, promoteur */
  const PJ = CFG.layers.find((l) => l.id === 'proj');
  const pjSt = new Set(PJ.status.map((o) => o[0])), pjCat = new Set(PJ.cats.map((o) => o[0]));
  let pjGrp = 'all';
  const projFilter = () => {
    const f = ['all', ['in', ['get', 'st'], ['literal', [...pjSt]]], ['in', ['get', 'cat'], ['literal', [...pjCat]]]];
    if (pjGrp !== 'all') f.push(['in', pjGrp, ['get', 'grp']]);
    return f;
  };
  const projMatch = (p) => pjSt.has(p.st) && pjCat.has(p.cat) && (pjGrp === 'all' || p.grp.includes(pjGrp));
  const PJ_COL = ['match', ['get', 'st'], 'livre', PJ.status[0][2], 'encours', PJ.status[1][2], PJ.status[2][2]];

  /* Filtres centres commerciaux (taille) et hébergements (type, groupe) */
  const mallFilter = () => ['in', ['get', 'taille'], ['literal', [...subFilters.mall]]];
  const HL = CFG.layers.find((l) => l.id === 'hotel');
  const hKind = new Set(HL.kinds.filter((o) => o[2] !== false).map((o) => o[0]));
  let hGrp = 'all';
  const hotelFilter = () => { const f = ['all', ['in', ['get', 'k'], ['literal', [...hKind]]]]; if (hGrp !== 'all') f.push(['==', ['get', 'grp'], hGrp]); return f; };

  /* ---------- Carte ---------- */
  const PAD = () => isMobile() ? { top: 90, bottom: 150, left: 0, right: 0 } : { top: 100, bottom: 20, left: 340, right: 70 };
  const map = new maplibregl.Map({
    container: 'map', attributionControl: false, maxPitch: 75, minZoom: 7.8, maxZoom: 17,
    center: [57.555, -20.24], zoom: isMobile() ? 7.9 : 9.2, pitch: 0, bearing: 0,
    maxBounds: [[56.9, -20.9], [58.2, -19.6]], style
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: BASE === 'osm' ? CFG.basemap.terrainAttribution : 'Fond de démonstration' }), 'bottom-right');
  // filet de sécurité : si le fond réel ne se charge pas en 15 s, relance sur le fond de démonstration
  if (BASE === 'osm') setTimeout(() => { if (!ready) location.replace('/?base=demo'); }, 15000);
  let BEFORE; // les couches de données passent sous les libellés du fond de carte
  let baseLabels = [];
  map.setPadding(PAD()); window.__tdvMap = map;
  window.addEventListener('resize', () => map.setPadding(PAD()));

  map.on('load', () => {
    const add = (id, data) => map.addSource(id, { type: 'geojson', data });
    add('hex', D.hex); add('pop', D.pop);
    add('infra', D.infra); add('shop', D.shops); add('mall', D.malls);
    add('trans', D.transport); add('proj', D.projPerim); add('state', D.state); add('hotel', D.hotels);
    // Usage agricole : source vide, remplie au premier affichage (n'alourdit pas le chargement initial)
    map.addSource('agri', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Usage agricole : ESA WorldCover 2021 (CC BY 4.0) · © OpenStreetMap (ODbL)' });
    add('projpt', D.projects);
    add('mallpt', { type: 'FeatureCollection', features: D.malls.features.map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: f.properties.cx !== undefined ? [f.properties.cx, f.properties.cy] : f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0][0] }, properties: f.properties })) });

    // motif hachuré pour les terres de l'État
    const cv = document.createElement('canvas'); cv.width = cv.height = 16; const g = cv.getContext('2d');
    g.strokeStyle = 'rgba(142,68,255,.55)'; g.lineWidth = 2; g.beginPath();
    g.moveTo(0, 16); g.lineTo(16, 0); g.moveTo(-4, 4); g.lineTo(4, -4); g.moveTo(12, 20); g.lineTo(20, 12); g.stroke();
    map.addImage('hatch', g.getImageData(0, 0, 16, 16));

    BEFORE = BASE === 'osm' ? (map.getStyle().layers.find((l) => l.type === 'symbol') || {}).id : undefined;
    baseLabels = BASE === 'osm' ? map.getStyle().layers.filter((l) => l.type === 'symbol').map((l) => l.id) : [];
    const A = (l) => map.addLayer(l, BEFORE);
    const hidden = { visibility: 'none' };
    if (BASE === 'osm') addOsmExtras(); else addDemoBase();
    function addOsmExtras() {
      // relief : ombrage + 3D (tuiles d'élévation AWS / Mapzen, libres)
      map.addSource('dem', { type: 'raster-dem', tiles: [CFG.basemap.terrain], encoding: 'terrarium', tileSize: 256, maxzoom: 14 });
      map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': .35, 'hillshade-shadow-color': '#8A8A8F', 'hillshade-highlight-color': '#FFFFFF', 'hillshade-accent-color': '#BDBDC2' } }, map.getLayer('waterway') ? 'waterway' : BEFORE);
      // bâtiments OSM en 3D
      A({ id: 'osm-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13.5,
        paint: { 'fill-extrusion-color': '#E4E4E7', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, .9] } });
      setTerrain(true);
      try { map.setSky({ 'sky-color': '#FFFFFF', 'horizon-color': '#F1F1EF', 'fog-color': '#FFFFFF', 'sky-horizon-blend': .6, 'horizon-fog-blend': .7, 'fog-ground-blend': .25 }); } catch (e) {}
    }
    function addDemoBase() {
    add('island', { type: 'Feature', geometry: { type: 'Polygon', coordinates: [D.coast] }, properties: {} });
    add('relief', D.relief); add('roads', D.roads); add('blocks', D.blocks);
    // fond
    A({ id: 'island-shadow', type: 'line', source: 'island', paint: { 'line-color': '#000', 'line-opacity': .06, 'line-width': 10, 'line-blur': 8 } });
    A({ id: 'island', type: 'fill', source: 'island', paint: { 'fill-color': '#FFFFFF' } });
    A({ id: 'relief', type: 'fill', source: 'relief', paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'lvl'], 1, '#F7F7F7', 3, '#EFEFEF', 5, '#E6E6E6'], 'fill-opacity': .9 } });
    A({ id: 'relief-line', type: 'line', source: 'relief', paint: { 'line-color': '#D9D9DC', 'line-width': .6 } });
    A({ id: 'coast', type: 'line', source: 'island', paint: { 'line-color': '#0B0B0C', 'line-width': 1.3 } });
    const zw0 = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 14, b];
    A({ id: 'road-r', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 'r'], minzoom: 10.2, paint: { 'line-color': '#C9C9CC', 'line-width': ['interpolate', ['linear'], ['zoom'], 10.2, .3, 14, 1.4] } });
    A({ id: 'road-t', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 't'], paint: { 'line-color': '#A9A9AE', 'line-width': zw0(.4, 1.6) } });
    A({ id: 'road-s', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 's'], paint: { 'line-color': '#4A4A4F', 'line-width': zw0(.8, 3) } });
    A({ id: 'road-m', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 'm'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0B0B0C', 'line-width': zw0(1.6, 5) } });
    A({ id: 'blocks', type: 'fill-extrusion', source: 'blocks', minzoom: 11, paint: { 'fill-extrusion-color': '#E4E4E7', 'fill-extrusion-height': ['*', ['get', 'h'], 1.6], 'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 11.8, .9] } });
    D.labels.forEach((l) => { const el = document.createElement('div'); el.className = 'tl ' + l.kind; el.textContent = l.name; new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -4] }).setLngLat(l.c).addTo(map); });
    updZoomClass(); map.on('zoom', updZoomClass);
    }
    // aplats d'analyse
    A({ id: 'pot-fill', type: 'fill', source: 'hex', layout: hidden, paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'pot'], 5, '#F2F2F2', 40, '#BDBDBD', 70, '#6E6E6E', 100, '#0B0B0C'], 'fill-opacity': .72 } });
    A({ id: 'agri-fill', type: 'fill', source: 'agri', layout: hidden, paint: { 'fill-color': C.agri, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, .45, 15, .3] } });
    A({ id: 'agri-line', type: 'line', source: 'agri', layout: hidden, minzoom: 12, paint: { 'line-color': C.agri, 'line-width': .8, 'line-opacity': .7 } });
    A({ id: 'state-fill', type: 'fill', source: 'state', layout: hidden, paint: { 'fill-pattern': 'hatch' } });
    A({ id: 'state-line', type: 'line', source: 'state', layout: hidden, paint: { 'line-color': C.state, 'line-width': 1.4, 'line-dasharray': [2, 1.5] } });
    const zw = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 14, b];
    // cartes de chaleur
    const heat = (id, src, stops, weight) => A({ id, type: 'heatmap', source: src, layout: hidden, paint: { ...(weight ? { 'heatmap-weight': weight } : {}),
      'heatmap-radius': zw(15, 42), 'heatmap-intensity': zw(.65, 1.45), 'heatmap-opacity': .85,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, stops[0], .2, stops[1], .52, stops[2], 1, stops[3]] } });
    heat('shop-heat', 'shop', ['rgba(255,122,26,0)', 'rgba(255,178,122,.45)', 'rgba(255,122,26,.75)', '#C2410C']);
    // densité d'hébergement : un hôtel pèse selon ses chambres (sinon 3), une résidence 1, une maison d'hôtes 0,6
    heat('tour-heat', 'hotel', ['rgba(0,184,217,0)', 'rgba(127,220,236,.45)', 'rgba(0,184,217,.75)', '#006E82'],
      ['case', ['==', ['get', 'k'], 'hotel'], ['case', ['has', 'chambres'], ['min', 8, ['/', ['to-number', ['get', 'chambres'], 0], 40]], 3], ['==', ['get', 'k'], 'residence'], 1, .6]);
    // transport
    A({ id: 'metro-line', type: 'line', source: 'trans', filter: ['==', ['get', 'kind'], 'metro'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.trans, 'line-width': zw(2.5, 6) } });
    // volumes 3D
    A({ id: 'pop-ext', type: 'fill-extrusion', source: 'pop', layout: hidden, paint: { 'fill-extrusion-color': rampExpr(metric), 'fill-extrusion-height': heightExpr(metric), 'fill-extrusion-opacity': .8, 'fill-extrusion-vertical-gradient': true } });
    A({ id: 'pop-line', type: 'line', source: 'pop', layout: hidden, paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, .4, 13, 1.2], 'line-opacity': .9 } });
    A({ id: 'mall-ext', type: 'fill-extrusion', source: 'mall', layout: hidden, filter: mallFilter(), paint: { 'fill-extrusion-color': C.mall, 'fill-extrusion-height': ['*', ['get', 'h'], 4], 'fill-extrusion-opacity': .9 } });
    // Projets : périmètre tracé = aplat + volume translucide + pointillés
    A({ id: 'proj-fill', type: 'fill', source: 'proj', filter: projFilter(), paint: { 'fill-color': C.proj, 'fill-opacity': .1 } });
    A({ id: 'proj-vol', type: 'fill-extrusion', source: 'proj', filter: projFilter(), paint: { 'fill-extrusion-color': C.proj, 'fill-extrusion-height': 60, 'fill-extrusion-opacity': .18 } });
    A({ id: 'proj-line', type: 'line', source: 'proj', filter: projFilter(), layout: { 'line-join': 'round' }, paint: { 'line-color': C.proj, 'line-width': zw(1.5, 4), 'line-dasharray': [2, 1.2] } });
    // points
    const circ = (id, src, color, r, extra = {}) => A(Object.assign({ id, type: 'circle', source: src, layout: hidden,
      paint: { 'circle-color': color, 'circle-radius': zw(r * .7, r * 1.6), 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } }, extra));
    // Équipements : public = point plein, privé = cercle blanc cerclé, projeté = point noir à halo
    CFG.layers.filter((l) => l.infra).forEach((l) => {
      const col = C[l.color], proj = l.infra === 'projet';
      A({ id: l.map[0], type: 'circle', source: 'infra', layout: hidden, filter: infraFilter(l), paint: {
        'circle-color': proj ? '#0B0B0C' : ['case', ['==', ['get', 'st'], 'prive'], '#FFFFFF', col],
        'circle-radius': zw(proj ? 4.5 : 3.2, proj ? 10 : 7.5),
        'circle-stroke-color': proj ? '#FFFFFF' : ['case', ['==', ['get', 'st'], 'prive'], col, '#FFFFFF'],
        'circle-stroke-width': proj ? 2.5 : ['case', ['==', ['get', 'st'], 'prive'], 2, 1.2],
        'circle-pitch-alignment': 'map' } });
    });
    // centres : taille du point selon la catégorie ; projet/extension = blanc cerclé
    const mallR = (a, b, c) => ['match', ['get', 'taille'], 'regional', a, 'quartier', b, c];
    A({ id: 'mall-pt', type: 'circle', source: 'mallpt', layout: hidden, filter: mallFilter(), paint: {
      'circle-color': ['case', ['==', ['get', 'statut'], 'existant'], C.mall, '#FFFFFF'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, mallR(6, 4, 2.5), 14, mallR(12, 8, 5)],
      'circle-stroke-color': ['case', ['==', ['get', 'statut'], 'existant'], '#FFFFFF', C.mall], 'circle-stroke-width': ['case', ['==', ['get', 'statut'], 'existant'], 1.5, 2.5],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 1, 15, ['case', ['==', ['get', 'statut'], 'existant'], .25, 1]] } });
    // hôtels : point plein ; résidences : cercle ; maisons d'hôtes : petit point
    A({ id: 'hotel-pt', type: 'circle', source: 'hotel', layout: hidden, filter: hotelFilter(), paint: {
      'circle-color': ['match', ['get', 'k'], 'residence', '#FFFFFF', '#006E82'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'k'], 'hotel', 3.5, 'residence', 2.5, 1.8],
        14, ['match', ['get', 'k'], 'hotel', ['case', ['has', 'chambres'], ['min', 14, ['+', 6, ['/', ['to-number', ['get', 'chambres'], 0], 40]]], 8], 'residence', 6, 4.5]],
      'circle-stroke-color': ['match', ['get', 'k'], 'residence', '#006E82', '#FFFFFF'], 'circle-stroke-width': ['match', ['get', 'k'], 'residence', 1.8, 'hotel', 1.5, .8], 'circle-pitch-alignment': 'map' } });
    A({ id: 'bus-st', type: 'circle', source: 'trans', filter: ['==', ['get', 'kind'], 'bus'], paint: { 'circle-color': '#fff', 'circle-radius': zw(3, 7), 'circle-stroke-color': C.trans, 'circle-stroke-width': 2 } });
    A({ id: 'metro-st', type: 'circle', source: 'trans', filter: ['==', ['get', 'kind'], 'station'], paint: { 'circle-color': C.trans, 'circle-radius': zw(3.5, 8), 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    // Projets : point (plein = livré, clair = en cours, blanc = à venir) ; position approximative (F) = plus transparent
    A({ id: 'proj-pt', type: 'circle', source: 'projpt', filter: projFilter(), paint: { 'circle-color': PJ_COL, 'circle-radius': zw(4.5, 10),
      'circle-stroke-color': C.proj, 'circle-stroke-width': ['case', ['==', ['get', 'st'], 'projete'], 2.2, 1.2],
      'circle-opacity': ['case', ['==', ['get', 'f'], 'F'], .6, 1], 'circle-pitch-alignment': 'map' } });
    // libellés des projets (zoom rapproché)
    window.__pjMarkers = D.projects.features.map((f) => { const el = document.createElement('div'); el.className = 'tl pj' + (f.properties.per ? ' per' : ''); el.textContent = f.properties.n.replace(/\s*\(.*\)$/, '');
      return { p: f.properties, el, m: new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, f.properties.decale ? -24 : -10] }).setLngLat(f.geometry.coordinates).addTo(map) }; });


    buildPanel(); applyAll(); bindClicks();
    ready = true; if (entered) intro();
  });
  let terrainOn = null;
  function setTerrain(on) { if (on === terrainOn) return; terrainOn = on; try { map.setTerrain(on ? { source: 'dem', exaggeration: CFG.basemap.exaggeration } : null); } catch (e) {} }
  function updZoomClass() { const z = map.getZoom(), m = $('#map'); m.classList.toggle('z-low', z < 9.6); m.classList.toggle('z-mid', z >= 9.6 && z < 10.6); m.classList.toggle('z-hi', z >= 13); }

  /* ---------- Panneau des couches ---------- */
  function subHTML(l) {
    let h = '';
    if (l.ui === 'metric') {
      if (!D.pop.features.length) h += `<div class="note" style="color:#C2410C;margin-bottom:8px">Données en attente : lancez la mise à jour (GitHub → Actions → « Mise à jour Population » → Run workflow).</div>`;
      else h += `<div class="note" style="margin:0 0 8px">${D.pop.features.length} zones · recensement 2022${D.popMeta && D.popMeta.updated ? ' · màj ' + new Date(D.popMeta.updated).toLocaleDateString('fr-FR') : ''}</div>`;
      h += `<div class="seg" data-seg="metric">${Object.entries(CFG.metrics).map(([k, v]) => `<button data-v="${k}" class="${k === metric ? 'on' : ''}">${v.label}</button>`).join('')}</div>
        <div class="ramp" id="pramp"></div><div class="rl"><span id="pmin"></span><span id="punit"></span><span id="pmax"></span></div>
        <div class="note">Hauteur et couleur des colonnes = indicateur sélectionné.</div>`;
    }
    if (l.ui === 'chips') {
      const cnt = (v) => l.infra ? D.infra.features.filter((f) => f.properties.g === l.infra && f.properties.s === v).length : null;
      h += `<div class="seg" data-seg="${l.id}">${l.options.map(([v, t, d]) => { const n = cnt(v); return `<button data-v="${v}" class="${d === false ? '' : 'on'}">${t}${n !== null ? ` <small>${n}</small>` : ''}</button>`; }).join('')}</div>`;
      if (l.infra && l.infra !== 'projet') h += `<div class="keys"><span><i style="background:${C[l.color]}"></i>Public</span><span><i style="background:#fff;border:2px solid ${C[l.color]}"></i>Privé</span></div>`;
    }
    if (l.ui === 'hotel') {
      const M = D.hcMeta || {}, F = D.hotels.features, n = (v) => F.filter((f) => f.properties.k === v).length;
      if (!F.some((f) => f.properties.k)) h += `<div class="note" style="color:#C2410C;margin-bottom:8px">Données en attente : lancez la mise à jour (GitHub → Actions → « Mise à jour Hôtels & Commerces » → Run workflow).</div>`;
      h += `<div class="note" style="margin:0 0 8px">${F.length} hébergements · ${M.hotels_avec_chambres || 0} avec nombre de chambres${M.updated ? ' · màj ' + new Date(M.updated).toLocaleDateString('fr-FR') : ''} · officiel : 109 hôtels, 14 112 chambres (fin 2025)</div>`;
      h += `<div class="seg hseg">${l.kinds.map(([v, t, d]) => `<button data-v="${v}" class="${d === false ? '' : 'on'}">${t} <small>${n(v)}</small></button>`).join('')}</div>`;
      const grps = [...new Set(F.map((f) => f.properties.grp).filter(Boolean))].sort();
      if (grps.length) h += `<select class="psel" id="hgrp"><option value="all">Tous les groupes hôteliers</option>${grps.map((g) => `<option>${g}</option>`).join('')}</select>`;
    }
    if (l.ui === 'proj') {
      const M = D.projMeta || {}, n = (k, v) => D.projects.features.filter((f) => f.properties[k] === v).length;
      h += `<div class="note" style="margin:0 0 8px">${M.localises || D.projects.features.length} projets placés · ${M.perimetres || 0} périmètre${M.perimetres > 1 ? 's' : ''} tracé${M.perimetres > 1 ? 's' : ''}${M.sans_coordonnees && M.sans_coordonnees.length ? ` · ${M.sans_coordonnees.length} sans coordonnées` : ''}${M.updated ? ' · màj ' + new Date(M.updated).toLocaleDateString('fr-FR') : ''}</div>`;
      h += `<div class="seg pseg" data-p="st">${l.status.map(([v, t, c]) => `<button data-v="${v}" class="on"><i class="sw2" style="background:${c}"></i>${t} <small>${n('st', v)}</small></button>`).join('')}</div>`;
      h += `<div class="seg pseg" data-p="cat">${l.cats.map(([v, t]) => `<button data-v="${v}" class="on">${t} <small>${n('cat', v)}</small></button>`).join('')}</div>`;
      const grps = [...new Set(D.projects.features.flatMap((f) => f.properties.grp.split(/\s*[\/+]\s*/)))].sort();
      h += `<select class="psel" id="pjgrp"><option value="all">Tous les promoteurs</option>${grps.map((g) => `<option>${g}</option>`).join('')}</select>`;
    }
    if (l.ui === 'ramp') h += `<div class="ramp" style="background:linear-gradient(90deg,${l.ramp.join(',')})"></div><div class="rl"><span>${l.rampLabels[0]}</span><span>${l.rampLabels[1]}</span></div>`;
    if (l.ui === 'keys') h += `<div class="keys">${l.keys.map(([s, t]) => `<span><i style="${s === 'fill' ? `background:${C[l.color]}` : `background:#fff;border:2px solid ${C[l.color]}`}"></i>${t}</span>`).join('')}</div>`;
    if (l.note) h += `<div class="note">${l.note}</div>`;
    if (l.fiab) h += `<div class="fb"><b class="fbadge f${l.fiab}">${l.fiab}</b>${CFG.fiab[l.fiab].label}${l.infra && l.infra !== 'projet' ? ' par défaut — vérifiée (A) quand rapprochée d\'une liste officielle' : ''}</div>`;
    return h;
  }
  function buildPanel() {
    let h = `<div class="gfil"><div class="grp" style="padding-top:6px">Filtres des équipements</div>
      <div class="seg gseg" data-g="status">${[['all', 'Tous'], ['public', 'Public'], ['prive', 'Privé']].map(([v, t]) => `<button data-v="${v}" class="${v === gStatus ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="seg gseg" data-g="fiab">${[['F', 'Toute fiabilité'], ['C', 'OSM et +'], ['B', 'Officielles'], ['A', 'Vérifiées']].map(([v, t]) => `<button data-v="${v}" class="${v === gFiab ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="note"><b class="fbadge fA">A</b> vérifiée · <b class="fbadge fB">B</b> officielle · <b class="fbadge fC">C</b> OSM · <b class="fbadge fD">D</b> estimée · <b class="fbadge fF">F</b> fictive</div></div>`, g = '';
    CFG.layers.forEach((l) => {
      if (l.grp !== g) { g = l.grp; h += `<div class="grp">${g}</div>`; }
      const sub = subHTML(l);
      h += `<div class="lyr ${l.on ? 'on' : ''}" id="ly-${l.id}" style="--c:${C[l.color]}">
        <button class="lrow" data-l="${l.id}"><span class="dot"></span><span class="lname">${l.name}${l.meta ? `<br><span class="lmeta">${l.meta}</span>` : ''}</span><span class="sw"></span></button>
        ${sub ? `<div class="lsub">${sub}</div>` : ''}</div>`;
    });
    $('#layers').innerHTML = h;
    document.querySelectorAll('.lrow').forEach((b) => (b.onclick = () => toggle(b.dataset.l)));
    document.querySelectorAll('.seg[data-seg]').forEach((s) => s.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) segClick(s.dataset.seg, b.dataset.v, s); }));
    document.querySelectorAll('.pseg').forEach((s) => s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const S = s.dataset.p === 'st' ? pjSt : pjCat, v = b.dataset.v;
      S.has(v) ? S.delete(v) : S.add(v); b.classList.toggle('on', S.has(v)); applyProj();
    }));
    const sel = $('#pjgrp'); if (sel) sel.onchange = () => { pjGrp = sel.value; applyProj(); };
    document.querySelectorAll('.hseg').forEach((s) => s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v;
      hKind.has(v) ? hKind.delete(v) : hKind.add(v); b.classList.toggle('on', hKind.has(v)); map.setFilter('hotel-pt', hotelFilter());
    }));
    const hs = $('#hgrp'); if (hs) hs.onchange = () => { hGrp = hs.value; map.setFilter('hotel-pt', hotelFilter()); };
    document.querySelectorAll('.gseg').forEach((s) => s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (s.dataset.g === 'status') gStatus = b.dataset.v; else gFiab = b.dataset.v;
      CFG.layers.filter((l) => l.infra).forEach((l) => map.setFilter(l.map[0], infraFilter(l)));
    }));
    updRamp();
  }
  function applyProj() {
    PJ.map.forEach((x) => map.getLayer(x) && map.setFilter(x, projFilter()));
    (window.__pjMarkers || []).forEach((k) => (k.el.style.display = PJ.on && projMatch(k.p) ? '' : 'none'));
  }
  function toggle(id) {
    const l = CFG.layers.find((x) => x.id === id); l.on = !l.on; $('#ly-' + id).classList.toggle('on', l.on);
    if (l.on && l.lazy && !l._loaded) loadLazy(l);
    applyAll();
  }
  async function loadLazy(l) {
    const row = $('#ly-' + l.id), m = row && row.querySelector('.lmeta'), old = m ? m.textContent : '';
    if (m) m.textContent = 'Chargement…';
    try {
      const r = await fetch('/data/' + l.lazy); if (!r.ok) throw new Error(r.status);
      const d = await r.json(); map.getSource(l.id).setData(d); l._loaded = true;
      if (m) m.textContent = `${old} · ${d.features.length} zones`;
    } catch (e) { if (m) m.textContent = 'Données indisponibles (lancer la mise à jour « Terres agricoles »)'; }
  }
  function applyAll() {
    CFG.layers.forEach((l) => l.map.forEach((x) => map.getLayer(x) && map.setLayoutProperty(x, 'visibility', l.on ? 'visible' : 'none')));
    applyProj();
    const lab = CFG.layers.find((x) => x.id === 'labels').on;
    $('#map').classList.toggle('hide-labels', !lab);
    baseLabels.forEach((x) => map.getLayer(x) && map.setLayoutProperty(x, 'visibility', lab ? 'visible' : 'none'));
    const terr = CFG.layers.find((x) => x.id === 'terrain');
    if (terr && BASE === 'osm') { setTerrain(terr.on); map.getLayer('hillshade') && map.setLayoutProperty('hillshade', 'visibility', terr.on ? 'visible' : 'none'); }
    const act = CFG.layers.filter((l) => l.on && l.grp !== 'Fond de carte');
    $('#count').textContent = `${act.length} couche${act.length > 1 ? 's' : ''} active${act.length > 1 ? 's' : ''} · superposables`;
    $('#actives').innerHTML = act.length ? act.map((l) => `<span class="apill"><i style="background:${C[l.color]}"></i>${l.name}</span>`).join('') : '<span class="apill">Aucune couche — touchez pour choisir</span>';
  }
  function segClick(seg, v, el) {
    if (seg === 'metric') {
      metric = v; el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      map.setPaintProperty('pop-ext', 'fill-extrusion-color', rampExpr(v)); map.setPaintProperty('pop-ext', 'fill-extrusion-height', heightExpr(v)); updRamp(); return;
    }
    const l = CFG.layers.find((x) => x.id === seg), S = subFilters[seg];
    S.has(v) ? S.delete(v) : S.add(v); el.querySelector(`[data-v="${v}"]`).classList.toggle('on', S.has(v));
    if (l.infra) { map.setFilter(l.map[0], infraFilter(l)); return; }
    (l.targets || l.map).forEach((t) => map.setFilter(t, ['in', ['get', l.field], ['literal', [...S]]]));
  }
  function updRamp() {
    const M = CFG.metrics[metric], r = $('#pramp'); if (!r) return;
    r.style.background = `linear-gradient(90deg,${rampOf(metric).join(',')})`;
    $('#pmin').textContent = M.min; $('#pmax').textContent = M.max; $('#punit').textContent = M.unit;
  }
  $('#reset').onclick = (e) => { e.stopPropagation(); CFG.layers.forEach((l) => { if (l.grp !== 'Fond de carte') { l.on = false; $('#ly-' + l.id).classList.remove('on'); } }); applyAll(); };
  $('#ph').onclick = () => { if (isMobile()) $('#panel').classList.toggle('open'); };
  $('#actives').onclick = () => $('#panel').classList.add('open');
  $('.handle').onclick = () => $('#panel').classList.toggle('open');

  /* ---------- Fiche d'information ---------- */
  function showInfo(color, kind, title, metrics, foot, fiab) {
    const fb = fiab && CFG.fiab[fiab] ? `<div class="fb"><b class="fbadge f${fiab}">${fiab}</b><span><b>${CFG.fiab[fiab].label}</b> — ${CFG.fiab[fiab].desc}</span></div>` : '';
    $('#ib').innerHTML = `<div class="k"><i style="background:${color}"></i>${kind}</div><h3>${title}</h3><div class="grid">${metrics.map(([v, l]) => `<div class="m"><b>${v}</b><span>${l}</span></div>`).join('')}</div>${fb}${foot ? `<div class="foot">${foot}</div>` : ''}`;
    const i = $('#info'); i.classList.remove('show'); void i.offsetWidth; i.classList.add('show');
    if (isMobile()) $('#panel').classList.remove('open');
  }
  const ST_LBL = { livre: 'Livré', encours: 'En cours', projete: 'À venir' };
  const rs = (n) => n >= 1e9 ? 'Rs ' + (n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' Md' : 'Rs ' + Math.round(n / 1e6).toLocaleString('fr-FR') + ' M';
  function showProj(p, perim) {
    if (!perim && p.per) { const pf = D.projPerim.features.find((f) => f.properties.id === p.id); if (pf) p = pf.properties, perim = true; }
    const m = [[p.statut, 'Statut'], [p.an || '—', 'Calendrier'], [p.surf || '—', 'Surface annoncée'], [p.bud ? rs(p.bud) : '—', 'Montant publié']];
    if (perim) m.splice(3, 0, [p.ha_trace + ' ha', 'Surface du périmètre tracé']);
    if (p.reg) m.push([p.reg, 'Régime']);
    m.push([p.loc, 'Localité']);
    if (p.sur_terre_agricole) {
      const s = p.sur_terre_agricole, lbl = s === 'oui' ? 'Oui' : s === 'proche' ? (p.agri_ha_500m !== undefined ? `Proche (${p.agri_ha_500m} ha à < 500 m)` : `Proche (${p.agri_dist_m} m)`) : 'Non';
      m.push([p.agri_conclusif === false ? lbl + ' · non concluant' : lbl, 'Terre agricole (usage observé)']);
    }
    let foot = `${p.grp} · ${p.fil} · réf. ${p.id}`;
    if (p.sur_terre_agricole && p.agri_conclusif === false) foot += '<br>Croisement agricole non concluant : position du projet approximative (fiabilité ' + p.f + ').';
    if (p.agri_ha_500m !== undefined) foot += '<br>Terres agricoles observées dans un rayon de 500 m autour du périmètre (le périmètre lui-même n\'est pas qualifié).';
    if (p.note) foot += `<br>${p.note}`;
    if (p.bud_info && p.bud) foot += `<br>Montant : ${p.bud_info}`;
    if (perim) foot += `<br><b>Périmètre :</b> ${p.methode}${p.per_src ? ' — ' + p.per_src : ''}`;
    const ann = parseFloat(String(p.surf).replace(',', '.'));
    if (perim && /ha/.test(p.surf) && ann && Math.abs(p.ha_trace - ann) / ann > .25) foot += `<br><span style="color:#9A3412">⚠︎ Surface tracée (${p.ha_trace} ha) ≠ annoncée (${p.surf}) : périmètre à confirmer avec le promoteur.</span>`;
    if (p.decale) foot += '<br>Point légèrement décalé pour rester cliquable (même adresse qu\'un autre projet).';
    if (/^https?:/.test(p.url)) foot += `<br><a href="${p.url}" target="_blank" rel="noopener">Voir la source</a>`; else if (p.url) foot += `<br>Source : ${p.url}`;
    showInfo(C.proj, 'Projet promoteur · ' + p.type, p.n, m, foot, p.f);
  }
  function showAgri(p) {
    showInfo(C.agri, 'Usage agricole observé', 'Terre cultivée (usage observé)',
      [[p.source === 'ESA+OSM' ? 'Satellite + OSM' : p.source === 'ESA' ? 'Satellite' : 'OSM', 'Source'], [fmt(p.surface_ha) + ' ha', 'Surface de la zone'], [p.date_source, 'Date des données']],
      'Usage agricole observé (satellite 2021 / OSM). N\'indique pas le statut juridique. Aucun permis de conversion délivré depuis juin 2025 selon le ministre de l\'Agro-industrie (Parlement, déc. 2025).<br>ESA WorldCover 2021 (CC BY 4.0) · © OpenStreetMap (ODbL)', p.fiabilite || 'C');
  }
  const TAILLE = { regional: 'Régional', quartier: 'De quartier', proximite: 'De proximité' };
  const STAT = { existant: 'Ouvert', projete: 'Projet annoncé', extension: 'Extension annoncée' };
  const val = (x) => (x === null || x === undefined || x === '' || x === 'null') ? '—' : x;
  function showMall(p) {
    const m = [[STAT[p.statut] || p.statut, 'Statut'], [TAILLE[p.taille], 'Catégorie'], [p.gla ? fmt(p.gla) + ' m²' : '—', 'Surface locative (GLA)'],
      [p.emprise ? fmt(p.emprise) + ' m²' : '—', 'Emprise au sol (OSM)'], [val(p.op), 'Opérateur'], [val(p.boutiques), 'Boutiques'], [val(p.annee), 'Ouverture']];
    let foot = p.note ? p.note + '<br>' : '';
    foot += `Source : ${p.src || 'OpenStreetMap'}${p.osm ? ' · réf. OSM ' + p.osm : ''}`;
    if (/^https?:/.test(p.url || '')) foot += ` · <a href="${p.url}" target="_blank" rel="noopener">voir</a>`;
    foot += '<br>Catégorie estimée d\'après la surface locative, sinon l\'emprise au sol.';
    showInfo(C.mall, 'Centre commercial · ' + (TAILLE[p.taille] || ''), p.n, m, foot, p.f);
  }
  const KIND_L = { hotel: 'Hôtel', residence: 'Résidence touristique', pension: "Maison d'hôtes" };
  function showHotel(p) {
    const m = [[KIND_L[p.k] || '—', 'Type'], [p.etoiles ? '★'.repeat(p.etoiles) : '—', 'Étoiles'], [val(p.chambres), 'Chambres'], [val(p.grp), 'Groupe']];
    let foot = `Source : ${p.src || 'OpenStreetMap'}${p.osm ? ' · réf. OSM ' + p.osm : ''}${D.hcMeta && D.hcMeta.updated ? ' · màj ' + new Date(D.hcMeta.updated).toLocaleDateString('fr-FR') : ''}`;
    if (p.grp && p.f === 'C') foot += '<br>Groupe détecté d\'après le nom : à confirmer.';
    const w = p.web || p.url; if (/^https?:/.test(w || '')) foot += `<br><a href="${w}" target="_blank" rel="noopener">Site / source</a>`;
    showInfo('#006E82', 'Tourisme · ' + (KIND_L[p.k] || 'Hébergement'), p.n || p.name, m, foot, p.f || 'F');
  }
  $('#ix').onclick = () => $('#info').classList.remove('show');
  function nearestTown(ll) { let b = null, d = 1e9; D.labels.forEach((l) => { const dd = (l.c[0] - ll.lng) ** 2 + (l.c[1] - ll.lat) ** 2; if (dd < d) { d = dd; b = l.name; } }); return 'Secteur ' + b; }
  function bindClicks() {
    const INFRA = CFG.layers.filter((l) => l.infra), INFRA_IDS = INFRA.map((l) => l.map[0]);
    const order = ['proj-pt', 'proj-fill', 'eqp-pt', ...INFRA_IDS.filter((x) => x !== 'eqp-pt'), 'mall-ext', 'mall-pt', 'hotel-pt', 'metro-st', 'bus-st', 'state-fill', 'agri-fill', 'pop-ext', 'pot-fill'];
    const LBL = { poste: 'Bureau de poste', police: 'Police', pompiers: 'Caserne de pompiers', hopital: 'Hôpital', sante: 'Santé de proximité / clinique', pharmacie: 'Pharmacie',
      communautaire: 'Centre communautaire', social: 'Structure sociale', bibliotheque: 'Bibliothèque', prescolaire: 'Préscolaire / crèche', ecole: 'École / collège', superieur: 'Enseignement supérieur',
      parc: 'Parc / jardin', jeux: 'Aire de jeux', sport: 'Complexe sportif / stade', terrain: 'Terrain de sport', plage: 'Plage', mairie: 'Mairie / conseil', administration: 'Administration',
      tribunal: 'Tribunal', marche: 'Marché', cimetiere: 'Cimetière', toilettes: 'Toilettes publiques', carburant: 'Station-service', agence: 'Agence bancaire', dab: 'Distributeur (DAB)' };
    const STL = { public: 'Public', prive: 'Privé', inconnu: 'Non précisé' };
    // (la couche pop-line n'est pas cliquable : c'est le contour)
    map.on('click', (e) => {
      const fs = map.queryRenderedFeatures(e.point, { layers: order.filter((x) => map.getLayer(x) && map.getLayoutProperty(x, 'visibility') !== 'none') });
      if (!fs.length) { $('#info').classList.remove('show'); return; }
      const f = fs.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id))[0], p = f.properties, id = f.layer.id;
      const lyr = INFRA.find((l) => l.map[0] === id);
      if (lyr) {
        const proj = lyr.infra === 'projet';
        const m = proj ? [[p.etat || 'annoncé', 'État'], [p.annonce || '—', 'Annonce'], [LBL[p.s] || p.s, 'Type']] : [[LBL[p.s] || p.s, 'Type'], [STL[p.st] || '—', 'Statut']];
        if (p.type) m.push([p.type, 'Catégorie']);
        if (p.op) m.push([p.op, 'Opérateur']);
        if (p.adr) m.push([p.adr, 'Adresse']);
        const foot = proj ? `Source : ${p.src}${p.note ? ' · ' + p.note : ''}${p.url ? `<br><a href="${p.url}" target="_blank" rel="noopener">Voir l'annonce</a>` : ''}`
          : `Source : ${p.src || 'OpenStreetMap'}${p.osm ? ' · réf. OSM ' + p.osm : ''}${D.infraMeta && D.infraMeta.updated ? ' · màj ' + new Date(D.infraMeta.updated).toLocaleDateString('fr-FR') : ''}`;
        showInfo(proj ? '#0B0B0C' : C[lyr.color], (proj ? 'Équipement projeté · ' : lyr.name + ' · ') + (LBL[p.s] || p.s), p.n, m, foot, p.f);
      }
      else if (id.startsWith('proj')) showProj(p, id === 'proj-fill');
      else if (id === 'agri-fill') showAgri(p);
      else if (id.startsWith('mall')) showMall(p);
      else if (id === 'hotel-pt') showHotel(p);
      else if (id === 'metro-st' || id === 'bus-st') showInfo(C.trans, 'Transport', p.name, [[id === 'metro-st' ? 'Metro' : 'Bus', 'Mode']], 'Tracé indicatif, à remplacer par les données officielles', 'F');
      else if (id === 'state-fill') showInfo(C.state, "Terres de l'État", p.name, [[fmt(p.ha) + ' ha', 'Surface'], [p.statut, 'Statut']], 'Source réelle : cadastre (demande officielle)', 'F');
      else if (id === 'pop-ext') {
        const v = (x, suf = '') => (x === null || x === undefined || x === 'null') ? '—' : fmt(x) + suf;
        const sign = (x) => (x === null || x === undefined) ? '—' : (x > 0 ? '+' : '') + String(x).replace('.', ',') + ' %';
        showInfo(C.pop, p.status || 'Zone', p.name, [[v(p.pop2022), 'Habitants (2022)'], [sign(p.growth_pct), 'Évolution 2011→2022'], [v(p.dens), 'hab/km²'], [v(p.age, ' ans'), 'Âge moyen (estimé)'],
          [v(p.p65, ' %'), '65 ans et +'], [v(p.p014, ' %'), 'Moins de 15 ans'], [v(p.sexr), 'Hommes pour 100 F'], [v(p.pop2011), 'Habitants (2011)']],
          `Recensement 2022 · Statistics Mauritius via CityPopulation.de · contours © OpenStreetMap${D.popMeta ? ' · mis à jour le ' + new Date(D.popMeta.updated).toLocaleDateString('fr-FR') : ''}${p.override ? ' · correction : ' + p.override : ''} · âge moyen : estimation (D)`, p.override ? 'A' : 'B');
      }
      else showInfo('#0B0B0C', 'Indice de potentiel (démo)', nearestTown(e.lngLat), [[p.pot + '/100', 'Score fictif']], 'Méthodologie à définir', 'F');
    });
    order.forEach((x) => { map.on('mouseenter', x, () => (map.getCanvas().style.cursor = 'pointer')); map.on('mouseleave', x, () => (map.getCanvas().style.cursor = '')); });
  }

  /* ---------- Vues rapides ---------- */
  $('#views').innerHTML = CFG.views.map((v, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-i="${i}">${v[0]}</button>`).join('');
  $('#views').onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return; stopSpin();
    document.querySelectorAll('#views .chip').forEach((c) => c.classList.remove('on')); b.classList.add('on');
    const v = CFG.views[+b.dataset.i];
    map.flyTo({ center: v[1], zoom: isMobile() ? v[2] - .9 : v[2], bearing: v[3], pitch: tilted ? 58 : 0, duration: 2200, essential: true });
  };

  /* ---------- Contrôles ---------- */
  let tilted = true, spinning = false, raf = null;
  $('#zin').onclick = () => map.zoomIn({ duration: 350 });
  $('#zout').onclick = () => map.zoomOut({ duration: 350 });
  $('#rl').onclick = () => { stopSpin(); map.easeTo({ bearing: map.getBearing() - 45, duration: 600 }); };
  $('#rr').onclick = () => { stopSpin(); map.easeTo({ bearing: map.getBearing() + 45, duration: 600 }); };
  $('#compass').onclick = () => { stopSpin(); map.easeTo({ bearing: 0, duration: 700 }); };
  const setTiltBtn = () => { $('#tilt').classList.toggle('on', tilted); $('#tilt span').textContent = tilted ? '3D' : '2D'; };
  $('#tilt').onclick = () => { tilted = !tilted; setTiltBtn(); map.easeTo({ pitch: tilted ? 58 : 0, duration: 800 }); };
  $('#spin').onclick = () => (spinning ? stopSpin() : startSpin());
  function startSpin() { spinning = true; $('#spin').classList.add('on'); const step = () => { if (!spinning) return; map.setBearing(map.getBearing() + .12); raf = requestAnimationFrame(step); }; step(); }
  function stopSpin() { spinning = false; $('#spin').classList.remove('on'); cancelAnimationFrame(raf); }
  map.on('rotate', () => { $('#compass svg').style.transform = `rotate(${-map.getBearing()}deg)`; });
  map.on('pitchend', () => { tilted = map.getPitch() > 5; setTiltBtn(); });
  ['mousedown', 'touchstart', 'wheel'].forEach((ev) => map.getCanvas().addEventListener(ev, stopSpin, { passive: true }));

  function intro() { setTimeout(() => map.flyTo({ center: [57.555, -20.25], zoom: isMobile() ? 8.05 : 9.75, pitch: 58, bearing: -18, duration: 3200, essential: true }), 250); }
})();
