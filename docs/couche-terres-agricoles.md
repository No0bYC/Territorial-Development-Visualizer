# Couche « Usage agricole observé » (v0.7) — fiabilité C

## Ce que montre la couche
Les surfaces **effectivement cultivées** sur l'île Maurice : canne, vergers, maraîchage, serres, cours de ferme.
Elle **n'indique pas le statut juridique** des terres (zonage, permis de conversion).

Fait de contexte affiché dans la popup : aucun permis de conversion n'a été délivré depuis juin 2025, selon le
ministre de l'Agro-industrie, de la Sécurité alimentaire, de l'Économie bleue et de la Pêche (Assemblée nationale,
décembre 2025 ; rapporté par L'Express / AllAfrica le 11/12/2025). Il n'existe pas de carte officielle de cette situation.

## Sources
| Source | Contenu retenu | Date | Licence |
|---|---|---|---|
| ESA WorldCover 10 m v200, tuile S21E057 | classe 40 « Cropland » ; classe 50 « Built-up » retirée | 2021 | CC BY 4.0 |
| OpenStreetMap (Overpass) | landuse = farmland (dont crop=sugarcane), orchard, plantation, farmyard, greenhouse_horticulture ; landuse = residential / industrial / commercial retirés | date d'extraction | ODbL |

## Méthode (scripts/build_terres_agricoles.py)
1. Découpe sur l'île Maurice seule (cadre 57,28–57,82 E / 20,56–19,95 S). Rodrigues, Agaléga et Cargados sont hors tuile et hors cadre.
2. Rasterisation des polygones OSM sur la grille de 10 m de WorldCover.
3. Code par pixel : ESA seul / OSM seul / les deux ; bâti (ESA 50 ou OSM résidentiel, industriel, commercial) = exclu.
4. Suppression des îlots et trous de moins de **1 ha**.
5. Vectorisation, simplification à **20 m** (projection UTM 40S), coordonnées à 4 décimales (≈ 11 m).
6. Propriétés : `source` (ESA / OSM / ESA+OSM), `surface_ha`, `fiabilite` = C, `date_source`.

Paramètres choisis pour tenir l'objectif de poids : à 0,5 ha et 10 m, le fichier pesait 7,9 Mo ; à 1 ha et 20 m, 3,8 Mo
(≈ 0,6 Mo transférés après compression), pour 1 % de surface en moins.

## Format : GeoJSON chargé à la demande
Le fichier n'est téléchargé qu'à la première activation de la couche : le démarrage de l'application n'est pas ralenti.
Le script s'arrête si le fichier dépasse 5 Mo (signal pour passer au format PMTiles).

## Résultats de validation (15/11/2026)
- 73 979 ha d'usage agricole observé, 3 419 polygones.
- Satellite seul : 3 656 ha ; OSM seul : 37 715 ha ; les deux : 32 608 ha.
- **La moitié de la surface n'est vue que par OSM.** Probable confusion du satellite entre canne et prairie (classe 30),
  à vérifier sur le terrain ou par une source nationale.

## Croisement avec les projets (scripts/build_projets.py)
Champ `sur_terre_agricole` sur les 89 projets localisés :
- `oui` : le point du projet est sur une terre agricole observée ;
- `proche` : terre agricole observée à moins de 500 m (`agri_dist_m`) ;
- `non` : rien à moins de 500 m.
- Projets à périmètre tracé (Telfair) : le périmètre lui-même n'est pas qualifié ; on mesure les terres agricoles observées
  dans un anneau de 500 m autour (`agri_ha_500m`, « proche » si au moins 1 ha).
- Projets en fiabilité D ou F : `agri_conclusif = false`, affiché « non concluant » (position approximative).

Validation : 10 projets concluants (7 proches, 3 non) ; 79 non concluants.

## Limites
- **Usage observé ≠ zonage légal** (Policy A1 des Outline Planning Schemes). Une parcelle cultivée peut être constructible,
  et une parcelle en friche peut être zonée agricole.
- **WorldCover date de 2021** : une friche ou un défrichement récent peut ne pas apparaître ; une culture abandonnée depuis peut y figurer.
- OSM est contributif : couverture inégale selon les régions.
- Résolution de 10 m, simplification à 20 m : ne pas utiliser à l'échelle de la parcelle.
- Le croisement porte sur la position (point) déclarée des projets, souvent approximative.
- Contexte réglementaire mouvant : exemption de permis de conversion annoncée au budget 2025-26 pour certaines petites parcelles ;
  amendement de la Policy A1 envisagé (mai 2026) pour certaines constructions sur terres agricoles.

## Remplacement prévu (étape 7)
Zones agricoles officielles géoréférencées (Outline Planning Schemes) et registre des permis de conversion
(ministère de l'Agro-industrie / ministère du Logement et des Terres), à obtenir par demande officielle.

## Rejouer
GitHub → Actions → « Mise à jour Terres agricoles » → Run workflow. Le workflow reconstruit la couche puis recalcule le
drapeau des projets. La liste des projets (« Mise à jour Projets ») recalcule aussi le drapeau dès que la couche existe.
