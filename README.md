# TDV — Mapping territorial de Maurice

Web app (PWA) de carte interactive 3D de Maurice : démographie, équipements, commerces, transports, projets immobiliers, terres de l'État, tourisme, loisirs — en couches superposables.

> **Version 0.2** — fond de carte réel (OpenStreetMap), **couches de données encore factices**. Ne pas utiliser pour une analyse.

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
