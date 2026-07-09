---
name: geometrie-carte
description: Use when working on the hex grid, coordinate conversions, terrain generation, or objectives, supply depots.
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
| Offset (col, row) → axial | `offsetToAxial(c, rw)` — le roster et `BASES` sont en offset |
| Distance en hex | `hexDistance(aq, ar, bq, br)` |
| Coins d'un hex (rendu) | `hexCorners(cx, cy)` |
| 6 voisins | `DIRS` (`src/config.js`) |
| Terrain d'un hex | `terrain.get(key(q, r))` → clé de `TERRAIN` |
| Coût de mouvement | `TERRAIN[t].cost` (`Infinity` = mer) |
| Décalage défensif | `TERRAIN[t].def` |
| Objectifs | `state.objectives` (clés indépendantes du terrain), contrôle dans `state.objControl` |

## Terrain (`src/config.js` → `TERRAIN`)

`river` (infranchissable, « Rivière »/lac/étang), `bank` (berge, coût 2), `plain`/`plain2` (plaine, coût 1), `hill` (coteau, coût 3, +2 déf), `depot` (grand dépôt de ravitaillement, ravito 6), `dump` (petit dépôt, relais de ravito 4), `forest` (bois, coût 2, +1 déf), `road` (route, coût 0,5, −1 déf), `base` (camp de base, source de ravitaillement — posé via `BASES`, voir skill `ravitaillement`).

## Génération (`src/map.js` → `generateMap(seed)`)

Reproductible via une **graine** : `generateMap(seed)` seede un PRNG déterministe (`mulberry32`) → même seed, même carte. Étapes :

1. **Fond de plaine** — toute la carte en `plain`/`plain2` (bruit sinus seedé).
2. **Hydrographie** — selon la seed, deux régimes :
   - *transversale* : un ruban qui serpente d'un bord à l'autre (styles vertical / horizontal / diagonal / fourchu) → ligne de front + ponts goulots ;
   - *fragmenté* : quelques **lacs** (`growBlob`), des **rivières courtes** qui en naissent + une ou deux rivières indépendantes (`growRiver`).
   Dans les deux cas, `path` (clés axiales) porte les ponts.
3. **Relief & étangs** en amas (`stamp`) : `forest` (bois), `hill` (coteaux), `river` (étangs).
4. **Berges** — toute plaine bordant l'eau → `bank`.
5. **Ponts** — routes réparties le long de `path`.
6. **Bases** (`BASES`) puis **dépôts de ravitaillement** : grands (ravito 6) ou petits (ravito 4), jamais îlots.
7. **Jouabilité** — tant que les deux bases ne sont pas reliées par voie terrestre, un hex d'eau frontalier devient pont.
8. **Réseau routier** — arbre couvrant minimal reliant dépôts/bases, chaque arête tracée par Dijkstra pondéré.

Les objectifs (`state.objectives`) sont posés indépendamment du terrain.

## Ajouter un nouveau terrain

1. Ajouter l'entrée dans `TERRAIN` (`src/config.js`) : `fill`, `stroke`, `cost`, `def`.
2. L'attribuer lors de la génération dans `generateMap` (`src/map.js`).
3. Ajouter une entrée de légende dans `index.html` (`#legend`).
4. Décoration optionnelle dans `render/app.js` (boucle `decoLayer`).
5. Test macro dans `test/` si le coût/déf modifie mouvement ou combat.
