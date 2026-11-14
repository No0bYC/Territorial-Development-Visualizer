/* =========================================================
   TDV — Configuration
   Ce fichier est le seul à modifier pour : changer une couleur,
   renommer une couche, changer son état par défaut, ajouter une vue,
   ou pointer vers un nouveau fichier de données.
   ========================================================= */
window.TDV = {
  version: '0.5.0',

  /* Fond de carte réel : OpenStreetMap via OpenFreeMap (gratuit, sans clé, attribution obligatoire)
     Relief : tuiles d'élévation AWS Open Data (Mapzen Terrarium), gratuites, sans clé */
  basemap: {
    style: 'https://tiles.openfreemap.org/styles/positron',
    terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    terrainAttribution: 'Relief : Mapzen / AWS Terrain Tiles',
    exaggeration: 1.5
  },
  /* Fond de démonstration utilisé seulement si le fond réel ne charge pas */
  demoBaseFiles: { coast: 'coast.json', relief: 'relief.json', roads: 'roads.json', blocks: 'blocks.json' },


  /* Fichiers de données (dossier /data). Remplacer un fichier factice
     par un fichier réel au même format suffit à mettre la carte à jour. */
  dataFiles: {
    pop: 'population.json', popMeta: 'population-meta.json', hex: 'potentiel-demo.json', infra: 'infrastructures.json', infraMeta: 'infrastructures-meta.json',
    shops: 'commerces.json', malls: 'centres-commerciaux.json', transport: 'transports.json',
    projects: 'projets.json', projPerim: 'projets-perimetres.json', projMeta: 'projets-meta.json', state: 'terres-etat.json', tourism: 'tourisme.json', hotels: 'hotels.json',
    labels: 'localites.json'
  },

  /* Une couleur par couche — le reste de l'interface reste noir & blanc */
  colors: {
    pop: '#5B5BF7', infra: '#00A3A3', edu: '#F2B705', mall: '#E83E8C', shop: '#FF7A1A', bank: '#1DB954',
    trans: '#2F80ED', proj: '#FF2D2D', state: '#8E44FF', tour: '#00B8D9', leis: '#7AC943', pot: '#0B0B0C', base: '#9A9AA0',
    svc: '#00A3A3', soc: '#A0522D', adm: '#64748B', eqp: '#0B0B0C'
  },

  /* Indice de fiabilité — appliqué à chaque élément de la carte (propriété « f » ou valeur par défaut de la couche) */
  fiab: {
    A: { label: 'Vérifiée',           desc: 'Source officielle, position contrôlée' },
    B: { label: 'Officielle',         desc: 'Source officielle ou annonce publique, position approximative' },
    C: { label: 'OpenStreetMap',      desc: 'Donnée communautaire, non vérifiée' },
    D: { label: 'Estimée',            desc: 'Calculée ou déduite à partir d\'autres données' },
    F: { label: 'Fictive',            desc: 'Donnée de démonstration, à remplacer' }
  },

  /* Indicateurs de la couche Population (propriétés du fichier population.json,
     produit par scripts/update_population.py — recensement 2022, Statistics Mauritius) */
  metrics: {
    dens:    { label: 'Densité',            unit: 'hab/km²',       min: 0,    max: 5000,  h: 3200 },
    pop2022: { label: 'Population',         unit: 'habitants',     min: 0,    max: 40000, h: 3200 },
    growth:  { label: 'Croissance 2011→22', unit: '% par an',      min: -1.5, max: 3,     h: 3200, ramp: ['#C2410C', '#F2B28C', '#EDEDF2', '#9C9CFA', '#2B2BB0'] },
    age:     { label: 'Âge moyen',          unit: 'ans (estimé)',  min: 34,   max: 44,    h: 2600 },
    p65:     { label: '65 ans et +',        unit: '% des hab.',    min: 8,    max: 20,    h: 2600 },
    p014:    { label: 'Moins de 15 ans',    unit: '% des hab.',    min: 10,   max: 25,    h: 2600 },
    sexr:    { label: 'Ratio H/F',          unit: 'H pour 100 F',  min: 92,   max: 104,   h: 2200 }
  },
  popRamp: ['#E4E4FD', '#9C9CFA', '#5B5BF7', '#2B2BB0', '#14145E'],

  /* Couches affichées dans le panneau, dans l'ordre */
  layers: [
    { id: 'pop',   grp: 'Population', name: 'Population', color: 'pop', on: true, fiab: 'B', map: ['pop-ext', 'pop-line'], meta: 'Recensement 2022 · données réelles', ui: 'metric',
      note: "Par village (Village Council Area) et par ville. Emploi et criminalité : pas encore de données publiques à cette échelle." },
    { id: 'pot',   grp: 'Population', name: 'Indice de potentiel immobilier', color: 'pot', on: false, fiab: 'F', map: ['pot-fill'], meta: 'Analyse · démo',
      ui: 'ramp', ramp: ['#F2F2F2', '#BDBDBD', '#6E6E6E', '#0B0B0C'], rampLabels: ['Faible', 'Fort'],
      note: 'Score composite FICTIF (démo). Méthodologie à définir avant tout calcul.' },
    /* Équipements : une couche par groupe, tirée de data/infrastructures.json (champ g), sous-types en filtres (champ s).
       Un 3e élément « false » dans une option = décochée par défaut. */
    { id: 'svc',  grp: 'Équipements & services', infra: 'svc', name: 'Services essentiels', color: 'svc', on: true, map: ['svc-pt'], meta: 'Poste, sécurité, santé', fiab: 'C',
      ui: 'chips', field: 's', options: [['poste', 'Poste'], ['police', 'Police'], ['pompiers', 'Pompiers'], ['hopital', 'Hôpitaux'], ['sante', 'Santé de proximité & cliniques'], ['pharmacie', 'Pharmacies']] },
    { id: 'soc',  grp: 'Équipements & services', infra: 'soc', name: 'Social & vie de quartier', color: 'soc', on: false, map: ['soc-pt'], meta: 'Centres communautaires, social, bibliothèques', fiab: 'C',
      ui: 'chips', field: 's', options: [['communautaire', 'Centres communautaires'], ['social', 'Structures sociales'], ['bibliotheque', 'Bibliothèques']] },
    { id: 'edu',  grp: 'Équipements & services', infra: 'edu', name: 'Écoles & éducation', color: 'edu', on: false, map: ['edu-pt'], meta: 'Public et privé', fiab: 'C',
      ui: 'chips', field: 's', options: [['prescolaire', 'Préscolaire & crèches'], ['ecole', 'Écoles & collèges'], ['superieur', 'Supérieur']] },
    { id: 'parc', grp: 'Équipements & services', infra: 'parc', name: 'Parcs, sport & plages', color: 'leis', on: false, map: ['parc-pt'], meta: 'Espaces publics de loisirs', fiab: 'C',
      ui: 'chips', field: 's', options: [['parc', 'Parcs & jardins'], ['jeux', 'Aires de jeux'], ['sport', 'Complexes & stades'], ['terrain', 'Terrains', false], ['plage', 'Plages']] },
    { id: 'adm',  grp: 'Équipements & services', infra: 'adm', name: 'Administration & quotidien', color: 'adm', on: false, map: ['adm-pt'], meta: 'Mairies, tribunaux, marchés…', fiab: 'C',
      ui: 'chips', field: 's', options: [['mairie', 'Mairies & conseils'], ['administration', 'Administrations'], ['tribunal', 'Tribunaux'], ['marche', 'Marchés'], ['cimetiere', 'Cimetières'], ['toilettes', 'Toilettes', false], ['carburant', 'Stations-service', false]] },
    { id: 'bank', grp: 'Équipements & services', infra: 'bank', name: 'Banques', color: 'bank', on: false, map: ['bank-pt'], meta: 'Agences & distributeurs', fiab: 'C',
      ui: 'chips', field: 's', options: [['agence', 'Agences'], ['dab', 'Distributeurs']] },
    { id: 'eqp',  grp: 'Équipements & services', infra: 'projet', name: 'Équipements projetés', color: 'eqp', on: false, map: ['eqp-pt'], meta: 'Annoncés ou en construction', fiab: 'B',
      ui: 'chips', field: 's', options: [['pompiers', 'Casernes'], ['sante', 'Santé'], ['police', 'Police'], ['poste', 'Poste'], ['communautaire', 'Social']],
      note: 'Signal avancé pour l\'immobilier. Liste tenue dans data/sources/equipements-projetes.csv.' },
    { id: 'trans', grp: 'Équipements & services', name: 'Transports', color: 'trans', on: true, fiab: 'F', map: ['metro-line', 'metro-st', 'bus-st'], meta: 'Metro Express, gares routières',
      ui: 'keys', keys: [['fill', 'Metro & stations'], ['ring', 'Gares routières']] },
    { id: 'mall',  grp: 'Commerce', name: 'Centres commerciaux', color: 'mall', on: false, fiab: 'F', map: ['mall-ext', 'mall-pt'], meta: 'Volumes 3D' },
    { id: 'shop',  grp: 'Commerce', name: 'Concentration de commerces', color: 'shop', on: false, fiab: 'F', map: ['shop-heat'], meta: 'Carte de chaleur',
      ui: 'ramp', ramp: ['rgba(255,122,26,.1)', '#FFB27A', '#FF7A1A', '#C2410C'], rampLabels: ['Diffus', 'Dense'] },
    { id: 'proj',  grp: 'Foncier & projets', name: 'Projets des promoteurs', color: 'proj', on: true, map: ['proj-fill', 'proj-vol', 'proj-line', 'proj-pt'], meta: 'Membres et grands groupes',
      ui: 'proj',
      status: [['livre', 'Livrés', '#FF2D2D'], ['encours', 'En cours', '#FF8A7A'], ['projete', 'À venir', '#FFFFFF']],
      cats: [['smart', 'Smart City & quartiers'], ['resid', 'Résidentiel'], ['eco', 'Commerces & bureaux'], ['equip', 'Équipements & loisirs'], ['foncier', 'Foncier']],
      note: 'Liste : data/sources/projets.csv · périmètres : data/sources/perimetres/. Pointillés = périmètre tracé ; point seul = position approximative.' },
    { id: 'state', grp: 'Foncier & projets', name: "Terres de l'État", color: 'state', on: false, fiab: 'F', map: ['state-fill', 'state-line'], meta: 'Dont pas géométriques' },
    { id: 'tour',  grp: 'Tourisme & loisirs', name: 'Zones touristiques', color: 'tour', on: false, fiab: 'F', map: ['tour-heat', 'hotel-pt'], meta: 'Fréquentation + hôtels',
      ui: 'ramp', ramp: ['rgba(0,184,217,.1)', '#7FDCEC', '#00B8D9', '#006E82'], rampLabels: ['Faible fréquentation', 'Forte'],
      note: 'Points foncés : hôtels & resorts (taille = étoiles).' },
    { id: 'terrain', grp: 'Fond de carte', name: 'Relief 3D', color: 'base', on: true, map: [], meta: 'Élévation réelle, exagérée ×1,5' },
    { id: 'base3d', grp: 'Fond de carte', name: 'Bâtiments 3D', color: 'base', on: true, map: ['osm-buildings', 'blocks'], meta: 'OpenStreetMap · zoom rapproché' },
    { id: 'labels', grp: 'Fond de carte', name: 'Noms des localités', color: 'base', on: true, map: [], meta: '' }
  ],

  /* Vues rapides : [nom, [lon, lat], zoom, orientation] */
  views: [
    ['Île entière', [57.555, -20.24], 9.15, -18], ['Moka · Telfair', [57.5095, -20.2305], 14.1, -12], ['Nord', [57.59, -20.06], 10.6, 20], ['Port-Louis', [57.50, -20.17], 11.6, -30],
    ['Plateau central', [57.49, -20.27], 11, -40], ['Ouest', [57.38, -20.32], 10.8, 60], ['Est', [57.72, -20.20], 10.8, -70],
    ['Sud-Est', [57.68, -20.42], 10.9, 160], ['Sud', [57.45, -20.48], 10.7, 180]
  ]
};
