---
name: geometrie-carte
description: Use when working on the hex grid, coordinate conversions, terrain generation, or objectives (towns/ports).
auto_invoke: true
---

# Géométrie & carte

Grille hexagonale en coordonnées **axiales** `(q, r)`. Fonctions de géométrie pures dans `src/geometry.js` ; génération de la carte dans `src/map.js` ; constantes dans `src/config.js`.

## Concepts → implémentation

| Concept | Implémentation |
|---|---|
| Coordonnée axiale sérialisée | `key(q, r)` → `"q,r"` (`src/geometry.js`) |
| Axial → pixel (rendu) | `axialToPixel(q, r)` |
| Pixel → axial (clic) | `pixelToAxial(x, y)` via `axialRound` |
| Offset (col, row) → axial | `offsetToAxial(c, rw)` — le roster et `TOWNS` sont en offset |
| Distance en hex | `hexDistance(aq, ar, bq, br)` |
| Coins d'un hex (rendu) | `hexCorners(cx, cy)` |
| 6 voisins | `DIRS` (`src/config.js`) |
| Terrain d'un hex | `terrain.get(key(q, r))` → clé de `TERRAIN` |
| Coût de mouvement | `TERRAIN[t].cost` (`Infinity` = mer) |
| Décalage défensif | `TERRAIN[t].def` |
| Objectifs | `state.objectives` (clés des hexes `town`), contrôle dans `state.objControl` |

## Terrain (`src/config.js` → `TERRAIN`)

`sea` (infranchissable), `coast`, `sand`/`sand2` (désert, coût 1), `rock` (coût 2, +2 déf), `town` (objectif, +2 déf), `oasis` (+1 déf).

## Génération (`src/map.js` → `generateMap`)

Déterministe (bruit sinus `rand`), donc reproductible sans graine. Lignes offset `rw<=1` → mer, `rw===2` → littoral, sinon désert avec rocaille/oasis aléatoires. Puis `TOWNS` posées comme villes/ports → deviennent les objectifs.

## Ajouter un nouveau terrain

1. Ajouter l'entrée dans `TERRAIN` (`src/config.js`) : `fill`, `stroke`, `cost`, `def`.
2. L'attribuer lors de la génération dans `generateMap` (`src/map.js`).
3. Ajouter une entrée de légende dans `index.html` (`#legend`).
4. Décoration optionnelle dans `render/app.js` (boucle `decoLayer`).
5. Test macro dans `test/` si le coût/déf modifie mouvement ou combat.
