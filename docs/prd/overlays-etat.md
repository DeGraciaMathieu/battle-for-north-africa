# PRD — Overlays d'état (ravitaillement / ZOC / menace)

## Objectif

Rendre lisibles trois informations aujourd'hui calculées mais peu (ou pas) visibles : la **zone ravitaillée** du camp actif et ses **unités hors-ravito**, les **ZOC ennemies**, et la **carte de menace** (force d'attaque adverse atteignant chaque hex au prochain tour). Trois toggles indépendants dans la barre d'outils, réutilisant les calculs de règles existants.

## Existant technique

- **`src/supply.js`** : `supplyRoutes(state, side)` → `{ supplied, parent, reach }` ; `suppliedHexes` ; `updateSupply` pose `u.supplied`. Déjà tout ce qu'il faut pour la zone ravitaillée.
- **`src/movement.js`** : `zocOf(units, side, terrain)` → `Set` des hexes sous ZOC d'un camp.
- **`src/ai.js`** : `buildThreatMap(sim, side)` (fonction **non exportée**) → `Map<hexKey, force>` de la menace adverse. C'est le calcul à partager.
- **`render/app.js`** :
  - `drawOverlay()` (ligne ~648) trace déjà, en phase de mouvement, le contour des ZOC ennemies (`zocOf` + `drawZoneOutline`) et, avec `showSupply`, les **lignes** de ravito (`drawSupplyLines`, ligne ~568).
  - Toggles existants comme modèle : `btnSupply` / `showSupply` (ligne ~951), `btnLegend` / `showLegend`. Helpers de tracé : `fillHex`, `drawHexOutline`, `drawZoneOutline`.
  - `refresh()` (ligne ~985) appelle `updateObjectives` + `updateSupply` puis `drawOverlay()`.
- Aucun test sur le rendu (couche non testée). `buildThreatMap` sera testable une fois extrait dans `src/`.

## Comportement

Trois cases/boutons de toggle indépendants, persistants tant que la partie tourne. Chaque overlay se redessine à chaque `refresh()` (l'état évolue à chaque mouvement/combat).

1. **Ravitaillement** (`showSupplyZone`) — distinct du toggle « lignes de ravito » déjà présent :
   - Remplir en teinte douce (vert, alpha ~0.15) tous les hexes de `suppliedHexes(state, camp actif)`.
   - Marquer d'un liseré d'alerte (rouge/orange) chaque **unité amie dont `u.supplied === false`**.
2. **ZOC** (`showZOC`) — rendre le contour des ZOC ennemies (déjà tracé en phase move) **togglable et visible aussi en phase de combat**. Contour rouge (`zocOf(units, adverse, terrain)`), inchangé visuellement.
3. **Menace** (`showThreat`) :
   - Extraire `buildThreatMap` de `src/ai.js` vers un nouveau module partagé **`src/threat.js`** (ou l'exporter depuis un module de règles existant), et l'y importer côté IA **et** côté rendu.
   - Colorer chaque hex `k` de la map par intensité de `threat.get(k)` (gradient d'alpha proportionnel à la force, normalisé sur le max). La menace affichée est celle **subie par le camp actif** (attaquants adverses).

Les trois overlays sont cumulables. Ordre de tracé : ravito (fond) → menace (fond) → ZOC (contour) → éléments existants (objectifs, portée, etc.).

## Hors-scope

- Pas de brouillard de guerre (la menace/ZOC reste calculée sur l'état complet, déjà visible).
- Pas de nouvel overlay de portée de mouvement (déjà présent via `sel.reachable`).
- Pas de changement des règles de ravito/ZOC/menace : purement de l'affichage + une extraction.
- Pas de persistance des préférences de toggle entre parties.

## Impacts par couche

- **src/** :
  - Nouveau `src/threat.js` exportant `buildThreatMap(state, side)` (déplacé depuis `ai.js`, dépendances : `computeReachable`, `eAtk`, `DIRS`, `key`).
  - `src/ai.js` : importer `buildThreatMap` depuis `./threat.js`, retirer la définition locale.
- **render/** :
  - `app.js` : 3 états `showSupplyZone` / `showZOC` / `showThreat`, 3 boutons dans la barre d'outils (calqués sur `btnSupply`), branchés dans `drawOverlay()`. Import de `buildThreatMap` depuis `../src/threat.js`. Fonctions de tracé : réutiliser `fillHex` / `drawZoneOutline`.
  - `index.html` : 3 boutons de toggle + entrées de légende associées.
- **config** : aucune constante nouvelle attendue (couleurs d'overlay = littéraux dans le rendu, comme l'existant).
- **doc** : mettre à jour la légende UI ; noter dans le skill `ravitaillement` que `buildThreatMap` vit désormais dans `src/threat.js` ; référencer `src/threat.js` dans le skill `architecture`.

## Critères d'acceptation

- Trois toggles indépendants et cumulables, sans régression du toggle « lignes de ravito ».
- Ravito ON : la zone ravitaillée du camp actif est teintée ; toute unité amie hors-ravito porte un liseré d'alerte visible.
- ZOC ON : le contour des ZOC ennemies s'affiche **aussi** en phase de combat (pas seulement en mouvement).
- Menace ON : les hexes menacés sont colorés par intensité croissante avec la force adverse ; un hex hors de portée adverse n'est pas coloré.
- `npm test` reste vert ; `buildThreatMap` importé depuis `src/threat.js` par l'IA sans changement de comportement de l'IA.

## Tests

- `test/threat.test.js` (nouveau, macro) : sur une carte plate, une unité ennemie de force d'attaque connue à portée donnée → `buildThreatMap` marque les hexes attendus (couronne autour de ses cases atteignables) avec la force cumulée. Vérifie surtout que l'extraction ne change rien.
- `test/ai.test.js` : la suite existante doit rester verte (l'IA consomme désormais l'import), preuve de non-régression.
- Le rendu n'est pas testé (couche non testée) : validation visuelle manuelle.

## Risques & questions ouvertes

- **Extraction de `buildThreatMap`** : bien vérifier que la signature attendue par l'IA (`sim` avec `units`/`terrain`) reste compatible. Risque faible, contenu à un module.
- **Lisibilité du cumul** : trois overlays simultanés peuvent surcharger la carte. Choix d'alphas doux ; possibilité (non spécifiée) de rendre certains mutuellement exclusifs si illisible.
- Question ouverte : la menace doit-elle ignorer les pièces adverses **non ravitaillées** (mvt ÷2) ? Par défaut on garde le calcul actuel de `buildThreatMap` tel quel pour ne pas diverger de l'IA.
