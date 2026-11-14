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
  try {
    await Promise.all(Object.entries(CFG.dataFiles).map(async ([k, f]) => {
      const r = await fetch('/data/' + f); if (!r.ok) throw new Error(f); D[k] = await r.json();
    }));
  } catch (e) {
    $('#loading').textContent = 'Erreur de chargement : ' + e.message; return;
  }
  $('#loading').textContent = '';
  $('#enter').disabled = false;

  /* ---------- Indicateurs population ---------- */
  let metric = 'dens';
  const rampExpr = (m) => { const M = CFG.metrics[m], s = (M.max - M.min) / 4; return ['interpolate', ['linear'], ['get', m], ...CFG.popRamp.flatMap((c, i) => [M.min + s * i, c])]; };
  const heightExpr = (m) => { const M = CFG.metrics[m]; return ['interpolate', ['linear'], ['get', m], M.min, 40, M.max, M.h]; };
  const subFilters = {};
  CFG.layers.forEach((l) => { if (l.ui === 'chips') subFilters[l.id] = new Set(l.options.map((o) => o[0])); });

  /* ---------- Carte ---------- */
  const PAD = () => isMobile() ? { top: 90, bottom: 150, left: 0, right: 0 } : { top: 100, bottom: 20, left: 340, right: 70 };
  const map = new maplibregl.Map({
    container: 'map', attributionControl: false, maxPitch: 75, minZoom: 7.8, maxZoom: 15.5,
    center: [57.555, -20.24], zoom: isMobile() ? 7.9 : 9.2, pitch: 0, bearing: 0,
    maxBounds: [[56.9, -20.9], [58.2, -19.6]],
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': SEA } }] }
  });
  map.setPadding(PAD());
  window.addEventListener('resize', () => map.setPadding(PAD()));

  map.on('load', () => {
    const add = (id, data) => map.addSource(id, { type: 'geojson', data });
    add('island', { type: 'Feature', geometry: { type: 'Polygon', coordinates: [D.coast] }, properties: {} });
    add('relief', D.relief); add('roads', D.roads); add('blocks', D.blocks); add('hex', D.hex);
    add('infra', D.infra); add('edu', D.schools); add('bank', D.banks); add('shop', D.shops); add('mall', D.malls);
    add('trans', D.transport); add('proj', D.projects); add('state', D.state); add('tour', D.tourism); add('hotel', D.hotels); add('leis', D.leisure);
    add('projpt', { type: 'FeatureCollection', features: D.projects.features.map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.properties.cx, f.properties.cy] }, properties: f.properties })) });
    add('mallpt', { type: 'FeatureCollection', features: D.malls.features.map((f) => { const r = f.geometry.coordinates[0]; return { type: 'Feature', geometry: { type: 'Point', coordinates: [(r[0][0] + r[2][0]) / 2, (r[0][1] + r[2][1]) / 2] }, properties: f.properties }; }) });

    // motif hachuré pour les terres de l'État
    const cv = document.createElement('canvas'); cv.width = cv.height = 16; const g = cv.getContext('2d');
    g.strokeStyle = 'rgba(142,68,255,.55)'; g.lineWidth = 2; g.beginPath();
    g.moveTo(0, 16); g.lineTo(16, 0); g.moveTo(-4, 4); g.lineTo(4, -4); g.moveTo(12, 20); g.lineTo(20, 12); g.stroke();
    map.addImage('hatch', g.getImageData(0, 0, 16, 16));

    const A = (l) => map.addLayer(l);
    const hidden = { visibility: 'none' };
    // fond
    A({ id: 'island-shadow', type: 'line', source: 'island', paint: { 'line-color': '#000', 'line-opacity': .06, 'line-width': 10, 'line-blur': 8 } });
    A({ id: 'island', type: 'fill', source: 'island', paint: { 'fill-color': '#FFFFFF' } });
    A({ id: 'relief', type: 'fill', source: 'relief', paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'lvl'], 1, '#F7F7F7', 3, '#EFEFEF', 5, '#E6E6E6'], 'fill-opacity': .9 } });
    A({ id: 'relief-line', type: 'line', source: 'relief', paint: { 'line-color': '#D9D9DC', 'line-width': .6 } });
    A({ id: 'coast', type: 'line', source: 'island', paint: { 'line-color': '#0B0B0C', 'line-width': 1.3 } });
    // aplats d'analyse
    A({ id: 'pot-fill', type: 'fill', source: 'hex', layout: hidden, paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'pot'], 5, '#F2F2F2', 40, '#BDBDBD', 70, '#6E6E6E', 100, '#0B0B0C'], 'fill-opacity': .72 } });
    A({ id: 'state-fill', type: 'fill', source: 'state', layout: hidden, paint: { 'fill-pattern': 'hatch' } });
    A({ id: 'state-line', type: 'line', source: 'state', layout: hidden, paint: { 'line-color': C.state, 'line-width': 1.4, 'line-dasharray': [2, 1.5] } });
    A({ id: 'leis-fill', type: 'fill', source: 'leis', layout: hidden, paint: { 'fill-color': C.leis, 'fill-opacity': .28 } });
    A({ id: 'leis-line', type: 'line', source: 'leis', layout: hidden, paint: { 'line-color': C.leis, 'line-width': 1.4 } });
    // routes
    const zw = (a, b) => ['interpolate', ['linear'], ['zoom'], 9, a, 14, b];
    A({ id: 'road-r', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 'r'], minzoom: 10.2, paint: { 'line-color': '#C9C9CC', 'line-width': ['interpolate', ['linear'], ['zoom'], 10.2, .3, 14, 1.4] } });
    A({ id: 'road-t', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 't'], paint: { 'line-color': '#A9A9AE', 'line-width': zw(.4, 1.6) } });
    A({ id: 'road-s', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 's'], paint: { 'line-color': '#4A4A4F', 'line-width': zw(.8, 3) } });
    A({ id: 'road-m', type: 'line', source: 'roads', filter: ['==', ['get', 'c'], 'm'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0B0B0C', 'line-width': zw(1.6, 5) } });
    // cartes de chaleur
    const heat = (id, src, stops) => A({ id, type: 'heatmap', source: src, layout: hidden, paint: {
      'heatmap-radius': zw(15, 42), 'heatmap-intensity': zw(.65, 1.45), 'heatmap-opacity': .85,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, stops[0], .2, stops[1], .52, stops[2], 1, stops[3]] } });
    heat('shop-heat', 'shop', ['rgba(255,122,26,0)', 'rgba(255,178,122,.45)', 'rgba(255,122,26,.75)', '#C2410C']);
    heat('tour-heat', 'tour', ['rgba(0,184,217,0)', 'rgba(127,220,236,.45)', 'rgba(0,184,217,.75)', '#006E82']);
    // transport
    A({ id: 'metro-line', type: 'line', source: 'trans', filter: ['==', ['get', 'kind'], 'metro'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.trans, 'line-width': zw(2.5, 6) } });
    // volumes 3D
    A({ id: 'blocks', type: 'fill-extrusion', source: 'blocks', minzoom: 11, paint: { 'fill-extrusion-color': '#E4E4E7', 'fill-extrusion-height': ['*', ['get', 'h'], 1.6], 'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 11.8, .9] } });
    A({ id: 'pop-ext', type: 'fill-extrusion', source: 'hex', layout: hidden, paint: { 'fill-extrusion-color': rampExpr(metric), 'fill-extrusion-height': heightExpr(metric), 'fill-extrusion-opacity': .82, 'fill-extrusion-vertical-gradient': true } });
    A({ id: 'mall-ext', type: 'fill-extrusion', source: 'mall', layout: hidden, paint: { 'fill-extrusion-color': C.mall, 'fill-extrusion-height': ['*', ['get', 'h'], 9], 'fill-extrusion-opacity': .95 } });
    const projColor = ['match', ['get', 'status'], 'Livré', '#FF2D2D', 'En cours', '#FF6B57', '#FFB0A3'];
    A({ id: 'proj-ext', type: 'fill-extrusion', source: 'proj', paint: { 'fill-extrusion-color': projColor, 'fill-extrusion-height': ['*', ['get', 'h'], 9], 'fill-extrusion-opacity': .95 } });
    // points
    const circ = (id, src, color, r, extra = {}) => A(Object.assign({ id, type: 'circle', source: src, layout: hidden,
      paint: { 'circle-color': color, 'circle-radius': zw(r * .7, r * 1.6), 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } }, extra));
    circ('infra-pt', 'infra', C.infra, 4.5);
    circ('edu-pt', 'edu', C.edu, 4.5);
    circ('bank-pt', 'bank', C.bank, 4);
    circ('mall-pt', 'mallpt', C.mall, 5, { maxzoom: 11 });
    A({ id: 'hotel-pt', type: 'circle', source: 'hotel', layout: hidden, paint: { 'circle-color': '#006E82', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['-', ['get', 'etoiles'], 1], 14, ['*', ['get', 'etoiles'], 2]], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    A({ id: 'bus-st', type: 'circle', source: 'trans', filter: ['==', ['get', 'kind'], 'bus'], paint: { 'circle-color': '#fff', 'circle-radius': zw(3, 7), 'circle-stroke-color': C.trans, 'circle-stroke-width': 2 } });
    A({ id: 'metro-st', type: 'circle', source: 'trans', filter: ['==', ['get', 'kind'], 'station'], paint: { 'circle-color': C.trans, 'circle-radius': zw(3.5, 8), 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    const fadeOut = ['interpolate', ['linear'], ['zoom'], 10.5, 1, 11.5, 0];
    A({ id: 'proj-pt', type: 'circle', source: 'projpt', maxzoom: 11.5, paint: { 'circle-color': projColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 5, 11.5, 9], 'circle-stroke-color': '#0B0B0C', 'circle-stroke-width': 1.5, 'circle-opacity': fadeOut, 'circle-stroke-opacity': fadeOut } });

    // noms des localités (HTML)
    D.labels.forEach((l) => { const el = document.createElement('div'); el.className = 'tl ' + l.kind; el.textContent = l.name; new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -4] }).setLngLat(l.c).addTo(map); });
    updZoomClass(); map.on('zoom', updZoomClass);

    buildPanel(); applyAll(); bindClicks();
    ready = true; if (entered) intro();
  });
  function updZoomClass() { const z = map.getZoom(), m = $('#map'); m.classList.toggle('z-low', z < 9.6); m.classList.toggle('z-mid', z >= 9.6 && z < 10.6); }

  /* ---------- Panneau des couches ---------- */
  function subHTML(l) {
    let h = '';
    if (l.ui === 'metric') {
      h += `<div class="seg" data-seg="metric">${Object.entries(CFG.metrics).map(([k, v]) => `<button data-v="${k}" class="${k === metric ? 'on' : ''}">${v.label}</button>`).join('')}</div>
        <div class="ramp" id="pramp"></div><div class="rl"><span id="pmin"></span><span id="punit"></span><span id="pmax"></span></div>
        <div class="note">Hauteur et couleur des colonnes = indicateur sélectionné.</div>`;
    }
    if (l.ui === 'chips') h += `<div class="seg" data-seg="${l.id}">${l.options.map(([v, t]) => `<button data-v="${v}" class="on">${t}</button>`).join('')}</div>`;
    if (l.ui === 'ramp') h += `<div class="ramp" style="background:linear-gradient(90deg,${l.ramp.join(',')})"></div><div class="rl"><span>${l.rampLabels[0]}</span><span>${l.rampLabels[1]}</span></div>`;
    if (l.ui === 'keys') h += `<div class="keys">${l.keys.map(([s, t]) => `<span><i style="${s === 'fill' ? `background:${C[l.color]}` : `background:#fff;border:2px solid ${C[l.color]}`}"></i>${t}</span>`).join('')}</div>`;
    if (l.note) h += `<div class="note">${l.note}</div>`;
    return h;
  }
  function buildPanel() {
    let h = '', g = '';
    CFG.layers.forEach((l) => {
      if (l.grp !== g) { g = l.grp; h += `<div class="grp">${g}</div>`; }
      const sub = subHTML(l);
      h += `<div class="lyr ${l.on ? 'on' : ''}" id="ly-${l.id}" style="--c:${C[l.color]}">
        <button class="lrow" data-l="${l.id}"><span class="dot"></span><span class="lname">${l.name}${l.meta ? `<br><span class="lmeta">${l.meta}</span>` : ''}</span><span class="sw"></span></button>
        ${sub ? `<div class="lsub">${sub}</div>` : ''}</div>`;
    });
    $('#layers').innerHTML = h;
    document.querySelectorAll('.lrow').forEach((b) => (b.onclick = () => toggle(b.dataset.l)));
    document.querySelectorAll('.seg').forEach((s) => s.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) segClick(s.dataset.seg, b.dataset.v, s); }));
    updRamp();
  }
  function toggle(id) { const l = CFG.layers.find((x) => x.id === id); l.on = !l.on; $('#ly-' + id).classList.toggle('on', l.on); applyAll(); }
  function applyAll() {
    CFG.layers.forEach((l) => l.map.forEach((x) => map.getLayer(x) && map.setLayoutProperty(x, 'visibility', l.on ? 'visible' : 'none')));
    $('#map').classList.toggle('hide-labels', !CFG.layers.find((x) => x.id === 'labels').on);
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
    (l.targets || l.map).forEach((t) => map.setFilter(t, ['in', ['get', l.field], ['literal', [...S]]]));
  }
  function updRamp() {
    const M = CFG.metrics[metric], r = $('#pramp'); if (!r) return;
    r.style.background = `linear-gradient(90deg,${CFG.popRamp.join(',')})`;
    $('#pmin').textContent = M.min; $('#pmax').textContent = M.max; $('#punit').textContent = M.unit;
  }
  $('#reset').onclick = (e) => { e.stopPropagation(); CFG.layers.forEach((l) => { if (l.grp !== 'Fond de carte') { l.on = false; $('#ly-' + l.id).classList.remove('on'); } }); applyAll(); };
  $('#ph').onclick = () => { if (isMobile()) $('#panel').classList.toggle('open'); };
  $('#actives').onclick = () => $('#panel').classList.add('open');
  $('.handle').onclick = () => $('#panel').classList.toggle('open');

  /* ---------- Fiche d'information ---------- */
  function showInfo(color, kind, title, metrics, foot) {
    $('#ib').innerHTML = `<div class="k"><i style="background:${color}"></i>${kind}</div><h3>${title}</h3><div class="grid">${metrics.map(([v, l]) => `<div class="m"><b>${v}</b><span>${l}</span></div>`).join('')}</div>${foot ? `<div class="foot">${foot}</div>` : ''}`;
    const i = $('#info'); i.classList.remove('show'); void i.offsetWidth; i.classList.add('show');
    if (isMobile()) $('#panel').classList.remove('open');
  }
  $('#ix').onclick = () => $('#info').classList.remove('show');
  function nearestTown(ll) { let b = null, d = 1e9; D.labels.forEach((l) => { const dd = (l.c[0] - ll.lng) ** 2 + (l.c[1] - ll.lat) ** 2; if (dd < d) { d = dd; b = l.name; } }); return 'Secteur ' + b; }
  function bindClicks() {
    const order = ['proj-ext', 'proj-pt', 'mall-ext', 'mall-pt', 'hotel-pt', 'metro-st', 'bus-st', 'infra-pt', 'edu-pt', 'bank-pt', 'state-fill', 'leis-fill', 'pop-ext', 'pot-fill'];
    map.on('click', (e) => {
      const fs = map.queryRenderedFeatures(e.point, { layers: order.filter((x) => map.getLayer(x) && map.getLayoutProperty(x, 'visibility') !== 'none') });
      if (!fs.length) { $('#info').classList.remove('show'); return; }
      const f = fs.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id))[0], p = f.properties, id = f.layer.id;
      if (id.startsWith('proj')) showInfo(C.proj, 'Projet promoteur · ' + p.type, p.name, [[p.status, 'Statut'], [p.year, 'Livraison'], [p.units ? fmt(p.units) : '—', 'Unités'], [p.ha + ' ha', 'Emprise']], 'Zone : ' + p.zone + ' · donnée fictive');
      else if (id.startsWith('mall')) showInfo(C.mall, 'Centre commercial', p.name, [[p.boutiques, 'Boutiques'], [p.zone, 'Zone']], 'Donnée fictive');
      else if (id === 'hotel-pt') showInfo('#006E82', 'Hôtel & resort', p.name, [[p.etoiles + '★', 'Catégorie'], [p.chambres, 'Chambres'], [p.occ + ' %', "Taux d'occupation"], [p.zone, 'Zone']], 'Donnée fictive');
      else if (id === 'metro-st' || id === 'bus-st') showInfo(C.trans, 'Transport', p.name, [[id === 'metro-st' ? 'Metro' : 'Bus', 'Mode']], 'Donnée indicative');
      else if (id === 'infra-pt') showInfo(C.infra, 'Infrastructure publique', p.name, [[p.label, 'Type'], [p.zone, 'Zone']], 'Donnée fictive');
      else if (id === 'edu-pt') showInfo('#B38600', 'Éducation', p.name, [[fmt(p.eleves), 'Élèves'], [p.zone, 'Zone']], 'Donnée fictive');
      else if (id === 'bank-pt') showInfo(C.bank, 'Banque', p.name, [[p.type, 'Type'], [p.zone, 'Zone']], 'Donnée fictive');
      else if (id === 'state-fill') showInfo(C.state, "Terres de l'État", p.name, [[fmt(p.ha) + ' ha', 'Surface'], [p.statut, 'Statut']], 'Donnée fictive — source réelle : cadastre (demande officielle)');
      else if (id === 'leis-fill') showInfo('#4E8F1E', 'Zone de loisirs', p.name, [[p.type, 'Type']], 'Donnée fictive');
      else showInfo(C.pop, 'Zone de recensement', nearestTown(e.lngLat), [[fmt(p.dens), 'hab/km²'], [p.age + ' ans', 'Âge moyen'], [p.emp + ' %', "Taux d'emploi"], [p.sexr, 'H pour 100 F'], [p.crime, 'Faits /1000 hab'], [p.pot + '/100', 'Potentiel (démo)']], 'Cellule ~1,5 km² · données fictives');
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
