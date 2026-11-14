/* =========================================================
   TDV — Configuration
   Ce fichier est le seul à modifier pour : changer une couleur,
   renommer une couche, changer son état par défaut, ajouter une vue,
   ou pointer vers un nouveau fichier de données.
   ========================================================= */
window.TDV = {
  version: '0.1.0',

  /* Fichiers de données (dossier /data). Remplacer un fichier factice
     par un fichier réel au même format suffit à mettre la carte à jour. */
  dataFiles: {
    coast: 'coast.json', relief: 'relief.json', roads: 'roads.json', blocks: 'blocks.json',
    hex: 'population.json', infra: 'infrastructures.json', schools: 'ecoles.json', banks: 'banques.json',
    shops: 'commerces.json', malls: 'centres-commerciaux.json', transport: 'transports.json',
    projects: 'projets.json', state: 'terres-etat.json', tourism: 'tourisme.json', hotels: 'hotels.json',
    leisure: 'loisirs.json', labels: 'localites.json'
  },

  /* Une couleur par couche — le reste de l'interface reste noir & blanc */
  colors: {
    pop: '#5B5BF7', infra: '#00A3A3', edu: '#F2B705', mall: '#E83E8C', shop: '#FF7A1A', bank: '#1DB954',
    trans: '#2F80ED', proj: '#FF2D2D', state: '#8E44FF', tour: '#00B8D9', leis: '#7AC943', pot: '#0B0B0C', base: '#9A9AA0'
  },

  /* Indicateurs de la couche Population (propriété du fichier population.json) */
  metrics: {
    dens:  { label: 'Densité',        unit: 'hab/km²',         min: 0,  max: 8000, h: 3600 },
    age:   { label: 'Âge moyen',      unit: 'ans',             min: 28, max: 46,   h: 2600 },
    emp:   { label: "Taux d'emploi",  unit: '%',               min: 40, max: 78,   h: 2600 },
    sexr:  { label: 'Ratio H/F',      unit: 'H pour 100 F',    min: 93, max: 103,  h: 2200 },
    crime: { label: 'Criminalité',    unit: 'faits /1000 hab', min: 4,  max: 65,   h: 2800 }
  },
  popRamp: ['#E4E4FD', '#9C9CFA', '#5B5BF7', '#2B2BB0', '#14145E'],

  /* Couches affichées dans le panneau, dans l'ordre */
  layers: [
    { id: 'pop',   grp: 'Population', name: 'Population', color: 'pop', on: false, map: ['pop-ext'], meta: 'Recensement · par zone', ui: 'metric' },
    { id: 'pot',   grp: 'Population', name: 'Indice de potentiel immobilier', color: 'pot', on: false, map: ['pot-fill'], meta: 'Analyse · démo',
      ui: 'ramp', ramp: ['#F2F2F2', '#BDBDBD', '#6E6E6E', '#0B0B0C'], rampLabels: ['Faible', 'Fort'],
      note: 'Score composite fictif (croissance, foncier, accessibilité, demande touristique). Méthodologie à définir.' },
    { id: 'infra', grp: 'Équipements & services', name: 'Infrastructures publiques', color: 'infra', on: false, map: ['infra-pt'], meta: 'Poste, santé, social, parcs',
      ui: 'chips', field: 'type', options: [['poste', 'Poste'], ['hopital', 'Santé'], ['social', 'Centres sociaux'], ['parc', 'Parcs']] },
    { id: 'edu',   grp: 'Équipements & services', name: 'Écoles & éducation', color: 'edu', on: false, map: ['edu-pt'], meta: 'Primaire → supérieur',
      ui: 'chips', field: 'type', options: [['primaire', 'Primaire'], ['secondaire', 'Secondaire'], ['superieur', 'Supérieur']] },
    { id: 'bank',  grp: 'Équipements & services', name: 'Banques', color: 'bank', on: false, map: ['bank-pt'], meta: 'Agences & DAB' },
    { id: 'trans', grp: 'Équipements & services', name: 'Transports', color: 'trans', on: true, map: ['metro-line', 'metro-st', 'bus-st'], meta: 'Metro Express, gares routières',
      ui: 'keys', keys: [['fill', 'Metro & stations'], ['ring', 'Gares routières']] },
    { id: 'mall',  grp: 'Commerce', name: 'Centres commerciaux', color: 'mall', on: false, map: ['mall-ext', 'mall-pt'], meta: 'Volumes 3D' },
    { id: 'shop',  grp: 'Commerce', name: 'Concentration de commerces', color: 'shop', on: false, map: ['shop-heat'], meta: 'Carte de chaleur',
      ui: 'ramp', ramp: ['rgba(255,122,26,.1)', '#FFB27A', '#FF7A1A', '#C2410C'], rampLabels: ['Diffus', 'Dense'] },
    { id: 'proj',  grp: 'Foncier & projets', name: 'Projets des promoteurs', color: 'proj', on: true, map: ['proj-ext', 'proj-pt'], meta: 'Projets fictifs',
      ui: 'chips', field: 'status', targets: ['proj-ext', 'proj-pt'], options: [['Livré', 'Livrés'], ['En cours', 'En cours'], ['Projet', 'À venir']],
      note: 'La liste réelle des projets remplacera ces données.' },
    { id: 'state', grp: 'Foncier & projets', name: "Terres de l'État", color: 'state', on: false, map: ['state-fill', 'state-line'], meta: 'Dont pas géométriques' },
    { id: 'tour',  grp: 'Tourisme & loisirs', name: 'Zones touristiques', color: 'tour', on: false, map: ['tour-heat', 'hotel-pt'], meta: 'Fréquentation + hôtels',
      ui: 'ramp', ramp: ['rgba(0,184,217,.1)', '#7FDCEC', '#00B8D9', '#006E82'], rampLabels: ['Faible fréquentation', 'Forte'],
      note: 'Points foncés : hôtels & resorts (taille = étoiles).' },
    { id: 'leis',  grp: 'Tourisme & loisirs', name: 'Zones de loisirs', color: 'leis', on: false, map: ['leis-fill', 'leis-line'], meta: 'Parcs, plages, golfs' },
    { id: 'base3d', grp: 'Fond de carte', name: 'Bâti (aperçu 3D)', color: 'base', on: true, map: ['blocks'], meta: 'Visible en zoom rapproché' },
    { id: 'labels', grp: 'Fond de carte', name: 'Noms des localités', color: 'base', on: true, map: [], meta: '' }
  ],

  /* Vues rapides : [nom, [lon, lat], zoom, orientation] */
  views: [
    ['Île entière', [57.555, -20.24], 9.15, -18], ['Nord', [57.59, -20.06], 10.6, 20], ['Port-Louis', [57.50, -20.17], 11.6, -30],
    ['Plateau central', [57.49, -20.27], 11, -40], ['Ouest', [57.38, -20.32], 10.8, 60], ['Est', [57.72, -20.20], 10.8, -70],
    ['Sud-Est', [57.68, -20.42], 10.9, 160], ['Sud', [57.45, -20.48], 10.7, 180]
  ]
};
