# TDV — Mapping territorial de Maurice

Web app (PWA) de carte interactive 3D de Maurice : démographie, équipements, commerces, transports, projets immobiliers, terres de l'État, tourisme, loisirs — en couches superposables.

> **Version 0.4** — + **couches Équipements réelles** (OpenStreetMap) et **indice de fiabilité**.
>
> Version 0.3 — fond de carte réel (OpenStreetMap) + **couche Population réelle** (recensement 2022). Les autres couches restent **factices**.

## Couche Population — mise à jour
- **Source** : Statistics Mauritius (recensements 2000, 2011, 2022) via CityPopulation.de ; contours des villages et villes © OpenStreetMap.
- **Indicateurs** : population, densité, croissance 2011→2022 (%/an), âge moyen (estimé à partir des tranches de 10 ans), part des 65 ans et +, des moins de 15 ans, ratio H/F.
- **Automatique (gratuit)** : `.github/workflows/update-population.yml` exécute `scripts/update_population.py` le 1er de chaque mois. Si les chiffres changent, le fichier `data/population.json` est commité et Vercel redéploie.
- **À la demande** : GitHub → onglet **Actions** → « Mise à jour Population » → **Run workflow** (≈ 5 min).
- **Manuel** : saisir une valeur officielle dans `data/sources/population-overrides.csv` (une ligne par zone, colonnes vides = inchangé), puis relancer le workflow. Ces valeurs sont prioritaires.
- **Contrôle** : `data/sources/population-table.csv` liste toutes les zones et leurs indicateurs (ouvrable dans Excel).
- **Garde-fous** : le script s'arrête sans rien modifier si la source change de format (< 100 zones lues) ou si moins de 70 % des zones trouvent leur contour.
- Si un village manque sur la carte : ajouter la correspondance de nom dans `ALIASES` en tête du script.

## Fond de carte
- **Rues, bâtiments, noms de lieux** : OpenStreetMap via [OpenFreeMap](https://openfreemap.org) (gratuit, sans clé ni limite ; style Positron recoloré noir & blanc dans `js/app.js` → `restyle`). Attribution OpenStreetMap obligatoire, affichée en bas à droite.
- **Relief 3D + ombrage** : tuiles d'élévation AWS Open Data (Mapzen Terrarium), gratuites, sans clé.
- **Secours** : si le fond réel ne charge pas, l'app bascule sur le fond de démonstration (`/?base=demo`).
- Réglages (URL du style, exagération du relief) : `js/config.js` → `basemap`.

## Structure

```
index.html              Écran d'accueil + interface
css/app.css             Styles (noir & blanc, une couleur par couche)
js/config.js            ← À MODIFIER : couches, couleurs, vues, fichiers de données
js/app.js               Logique de la carte (MapLibre GL)
data/*.json             Données (GeoJSON) — une couche = un fichier
vendor/                 MapLibre GL JS 4.7.1 (licence BSD-3)
icons/                  Logo TDV, icône iPhone (apple-touch-icon), icônes PWA
manifest.webmanifest    Installation sur l'écran d'accueil
sw.js                   Cache hors-ligne (incrémenter VERSION à chaque mise en ligne)
vercel.json             En-têtes d'hébergement
```

Aucune étape de compilation : le site est servi tel quel par Vercel.

## Installer sur iPhone
Ouvrir l'URL dans **Safari** → bouton Partager → **Sur l'écran d'accueil** → Ajouter. L'icône TDV apparaît et l'app s'ouvre en plein écran.

## Remplacer une couche par des données réelles
1. Préparer un fichier GeoJSON avec les mêmes propriétés que le fichier factice (ex. `data/projets.json` : `name, zone, type, status, units, year, h, ha, cx, cy`).
2. Remplacer le fichier dans `data/` (GitHub → Add file → Upload files).
3. Incrémenter `VERSION` dans `sw.js`. Vercel redéploie automatiquement.

## Sources de données prévues
| Couche | Source cible | Statut |
|---|---|---|
| Population (densité, âge, H/F, emploi) | Recensement 2022, Statistics Mauritius (Municipal Wards / VCA) | à intégrer |
| Criminalité | Statistics Mauritius — Crime, Justice & Security (par division de police) | à intégrer, granularité limitée |
| Équipements, écoles, banques, commerces, hôtels | OpenStreetMap + listes officielles | à intégrer |
| Projets des promoteurs | Liste fournie (REDM / membres) | à fournir |
| Terres de l'État | Ministère du Logement et des Terres (cadastre) — demande officielle | à obtenir |
| Fréquentation touristique | Statistics Mauritius / Tourism Authority | à vérifier |
| Prix & transactions foncières, zonage (OPS) | à identifier | manquant |


## Couches Équipements & services — mise à jour
- **Groupes** : Services essentiels · Social & vie de quartier · Écoles & éducation · Parcs, sport & plages · Administration & quotidien · Banques · Équipements projetés.
- **Source de base** : OpenStreetMap (fiabilité **C**), public et privé (statut déduit des balises et du nom).
- **Rapprochement officiel** : ajouter une ligne dans `data/sources/infra-verifiees.csv` (`nom,sous_type,lat,lon,statut,fiabilite,source,note`). Le point OSM le plus proche (< 400 m, même sous-type) passe en fiabilité **A** ; s'il n'existe pas, il est ajouté.
- **Équipements projetés** : `data/sources/equipements-projetes.csv` (annonces publiques, fiabilité **B**, position souvent approximative).
- **Automatique** : `.github/workflows/update-infrastructures.yml` — le 2 de chaque mois, à la demande, et dès qu'un des deux CSV est modifié.
- **Contrôle** : `data/sources/infrastructures-table.csv`.

## Indice de fiabilité (toutes les couches)
| Code | Signification |
|---|---|
| A | Vérifiée — source officielle, position contrôlée |
| B | Officielle — source officielle ou annonce, position approximative |
| C | OpenStreetMap — communautaire, non vérifiée |
| D | Estimée — calculée (ex. âge moyen) |
| F | Fictive — démonstration, à remplacer |

## Projets des promoteurs (v0.5)

- **Liste** : `data/sources/projets.csv` — une ligne par projet. Colonnes clés : `id`, `groupe`, `projet`, `type`, `statut`, `lat`, `lon`, `fiabilite_geo` (A à F).
  Modifier ou ajouter une ligne directement sur GitHub (crayon ✏️ → Commit) relance la mise à jour.
- **Périmètres** : un fichier par projet dans `data/sources/perimetres/<id>.geojson` (ex. `ER-02.geojson`, Telfair).
  Un projet qui a un périmètre est affiché en pointillés + volume translucide ; les autres restent des points.
- **Construction** : `scripts/build_projets.py` (Python standard) produit `data/projets.json`, `data/projets-perimetres.json` et `data/projets-meta.json`.
  Workflow GitHub « Mise à jour Projets » : automatique à chaque modification de la liste ou d'un périmètre, ou manuel via Run workflow.
- **Garde-fous** : arrêt si moins de 10 lignes, identifiant en double ou coordonnées hors de Maurice. Les projets sans coordonnées sont listés dans `projets-meta.json`.
- **Statuts** ramenés à 3 états (livré / en cours / à venir) ; **catégories** : Smart City & quartiers, résidentiel, commerces & bureaux, équipements & loisirs, foncier.
