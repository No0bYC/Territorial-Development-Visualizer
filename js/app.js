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
    add('trans', D.transport); add('proj', D.projects); add('state', D.state); add('tour', D.tourism); add('hotel', D.hotels);
    add('projpt', { type: 'FeatureCollection', features: D.projects.features.map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.properties.cx, f.properties.cy] }, properties: f.properties })) });
    add('mallpt', { type: 'FeatureCollection', features: D.malls.features.map((f) => { const r = f.geometry.coordinates[0]; return { type: 'Feature', geometry: { type: 'Point', coordinates: [(r[0][0] + r[2][0]) / 2, (r[0][1] + r[2][1]) / 2] }, properties: f.properties }; }) });

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
    A({ id: 'state-fill', type: 'fill', source: 'state', layout: hidden, paint: { 'fill-pattern': 'hatch' } });
    A({ id: 'state-line', type: 'line', source: 'state', layout: hidden, paint: { 'line-color': C.state, 'line-width': 1.4, 'line-dasharray': [2, 1.5] } });
    const zw = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 14, b];
    // cartes de chaleur
    const heat = (id, src, stops) => A({ id, type: 'heatmap', source: src, layout: hidden, paint: {
      'heatmap-radius': zw(15, 42), 'heatmap-intensity': zw(.65, 1.45), 'heatmap-opacity': .85,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, stops[0], .2, stops[1], .52, stops[2], 1, stops[3]] } });
    heat('shop-heat', 'shop', ['rgba(255,122,26,0)', 'rgba(255,178,122,.45)', 'rgba(255,122,26,.75)', '#C2410C']);
    heat('tour-heat', 'tour', ['rgba(0,184,217,0)', 'rgba(127,220,236,.45)', 'rgba(0,184,217,.75)', '#006E82']);
    // transport
    A({ id: 'metro-line', type: 'line', source: 'trans', filter: ['==', ['get', 'kind'], 'metro'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.trans, 'line-width': zw(2.5, 6) } });
    // volumes 3D
    A({ id: 'pop-ext', type: 'fill-extrusion', source: 'pop', layout: hidden, paint: { 'fill-extrusion-color': rampExpr(metric), 'fill-extrusion-height': heightExpr(metric), 'fill-extrusion-opacity': .8, 'fill-extrusion-vertical-gradient': true } });
    A({ id: 'pop-line', type: 'line', source: 'pop', layout: hidden, paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, .4, 13, 1.2], 'line-opacity': .9 } });
    A({ id: 'mall-ext', type: 'fill-extrusion', source: 'mall', layout: hidden, paint: { 'fill-extrusion-color': C.mall, 'fill-extrusion-height': ['*', ['get', 'h'], 9], 'fill-extrusion-opacity': .95 } });
    const projColor = ['match', ['get', 'status'], 'Livré', '#FF2D2D', 'En cours', '#FF6B57', '#FFB0A3'];
    A({ id: 'proj-ext', type: 'fill-extrusion', source: 'proj', paint: { 'fill-extrusion-color': projColor, 'fill-extrusion-height': ['*', ['get', 'h'], 9], 'fill-extrusion-opacity': .95 } });
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
    circ('mall-pt', 'mallpt', C.mall, 5, { maxzoom: 11 });
    A({ id: 'hotel-pt', type: 'circle', source: 'hotel', layout: hidden, paint: { 'circle-color': '#006E82', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['-', ['get', 'etoiles'], 1], 14, ['*', ['get', 'etoiles'], 2]], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    A({ id: 'bus-st', type: 'circle', source: 'trans', filter: ['==', ['get', 'kind'], 'bus'], paint: { 'circle-color': '#fff', 'circle-radius': zw(3, 7), 'circle-stroke-color': C.trans, 'circle-stroke-width': 2 } });
    A({ id: 'metro-st', type: 'circle', source: 'trans', filter: ['==', ['get', 'kind'], 'station'], paint: { 'circle-color': C.trans, 'circle-radius': zw(3.5, 8), 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    const fadeOut = ['interpolate', ['linear'], ['zoom'], 10.5, 1, 11.5, 0];
    A({ id: 'proj-pt', type: 'circle', source: 'projpt', maxzoom: 11.5, paint: { 'circle-color': projColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 5, 11.5, 9], 'circle-stroke-color': '#0B0B0C', 'circle-stroke-width': 1.5, 'circle-opacity': fadeOut, 'circle-stroke-opacity': fadeOut } });


    buildPanel(); applyAll(); bindClicks();
    ready = true; if (entered) intro();
  });
  let terrainOn = null;
  function setTerrain(on) { if (on === terrainOn) return; terrainOn = on; try { map.setTerrain(on ? { source: 'dem', exaggeration: CFG.basemap.exaggeration } : null); } catch (e) {} }
  function updZoomClass() { const z = map.getZoom(), m = $('#map'); m.classList.toggle('z-low', z < 9.6); m.classList.toggle('z-mid', z >= 9.6 && z < 10.6); }

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
    document.querySelectorAll('.gseg').forEach((s) => s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (s.dataset.g === 'status') gStatus = b.dataset.v; else gFiab = b.dataset.v;
      CFG.layers.filter((l) => l.infra).forEach((l) => map.setFilter(l.map[0], infraFilter(l)));
    }));
    updRamp();
  }
  function toggle(id) { const l = CFG.layers.find((x) => x.id === id); l.on = !l.on; $('#ly-' + id).classList.toggle('on', l.on); applyAll(); }
  function applyAll() {
    CFG.layers.forEach((l) => l.map.forEach((x) => map.getLayer(x) && map.setLayoutProperty(x, 'visibility', l.on ? 'visible' : 'none')));
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
  $('#ix').onclick = () => $('#info').classList.remove('show');
  function nearestTown(ll) { let b = null, d = 1e9; D.labels.forEach((l) => { const dd = (l.c[0] - ll.lng) ** 2 + (l.c[1] - ll.lat) ** 2; if (dd < d) { d = dd; b = l.name; } }); return 'Secteur ' + b; }
  function bindClicks() {
    const INFRA = CFG.layers.filter((l) => l.infra), INFRA_IDS = INFRA.map((l) => l.map[0]);
    const order = ['proj-ext', 'proj-pt', 'eqp-pt', ...INFRA_IDS.filter((x) => x !== 'eqp-pt'), 'mall-ext', 'mall-pt', 'hotel-pt', 'metro-st', 'bus-st', 'state-fill', 'pop-ext', 'pot-fill'];
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
      else if (id.startsWith('proj')) showInfo(C.proj, 'Projet promoteur · ' + p.type, p.name, [[p.status, 'Statut'], [p.year, 'Livraison'], [p.units ? fmt(p.units) : '—', 'Unités'], [p.ha + ' ha', 'Emprise']], 'Zone : ' + p.zone + ' · donnée fictive', 'F');
      else if (id.startsWith('mall')) showInfo(C.mall, 'Centre commercial', p.name, [[p.boutiques, 'Boutiques'], [p.zone, 'Zone']], '', 'F');
      else if (id === 'hotel-pt') showInfo('#006E82', 'Hôtel & resort', p.name, [[p.etoiles + '★', 'Catégorie'], [p.chambres, 'Chambres'], [p.occ + ' %', "Taux d'occupation"], [p.zone, 'Zone']], '', 'F');
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
