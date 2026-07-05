---
name: architecture
description: Use when you need the project map — which module does what, the logic/rendering split, and where to place new code by type of change.
auto_invoke: true
---

# Architecture

Deux couches strictement séparées : `src/` (règles, testables) et `render/` (rendu). Aucune règle dans `render/`, aucun DOM/PIXI dans `src/`.

## Carte des modules

| Module | Rôle | Dépend de |
|---|---|---|
| `src/config.js` | Constantes : dimensions, `TERRAIN`, `TOWNS`, `ODDS`, `CRT`, `DIRS`, portées | — |
| `src/geometry.js` | Hex axial pur : `key`, `axialToPixel`, `pixelToAxial`, `hexDistance`, `hexCorners`, `clamp` | config |
| `src/events.js` | Bus d'événements (`createBus`) | — |
| `src/map.js` | `generateMap()` → terrain, hexes, objectifs | config, geometry |
| `src/units.js` | Roster `raw`, `createUnits`, facteurs `eAtk/eDef/eMov`, helpers d'occupation | geometry |
| `src/movement.js` | `zocOf`, `computeReachable` (Dijkstra), `moveUnit` | config, geometry, units |
| `src/supply.js` | `supplySources`, `suppliedHexes`, `updateSupply` (flood-fill) | config, geometry, units, movement |
| `src/combat.js` | `oddsIndex`, `resolveCombat`, `hitUnit`, `retreatOrDie` | config, geometry, units, movement |
| `src/game.js` | `createGame`, `endPhase`, objectifs, `checkElimination/TurnEnd`, `endGame` | tous les `src/` ci-dessus |
| `src/ai.js` | IA adverse : `aiMovePhase`/`aiAttackPhase` renvoient des INTENTIONS (`{id,to}` / `{atk,def}`). Planificateur PUR : lit l'état, consomme les règles, ne les modifie jamais | config, geometry, units, movement, supply, combat |
| `render/app.js` | PixiJS + HUD DOM + sélection/interaction ; s'abonne au bus ; orchestre le mode en ligne et le pilote de l'IA | tout `src/`, `render/net.js` |
| `render/net.js` | Transport P2P (PeerJS/WebRTC) + `mulberry32` pour le lockstep ; aucune règle, aucun état (voir skill `online`) | — |
| `index.html` | Bootstrap : charge PixiJS (CDN) puis `render/app.js` en module | — |

## L'objet `state`

Créé par `createGame(rng)` (`src/game.js`). Toutes les règles le reçoivent en argument :

```
{ terrain: Map, hexes: [], objectives: [key],
  objControl: Map<key, 'axis'|'ally'>, units: [], 
  G: { turn, player, phase, over }, bus, rng }
```

## Bus d'événements (`src/events.js`)

Les règles ne rendent rien : elles émettent, le rendu réagit.

| Événement | Émis par | Consommé par |
|---|---|---|
| `unitReduced` / `unitRemoved` | `combat.js` (`hitUnit`/`removeUnit`) | rendu (reconstruction des pions) |
| `combatResolved` | `combat.js` (`resolveCombat`), payload = résumé du combat | `game.js` → `checkElimination` ; rendu → modale explicative |
| `phaseChanged` | `game.js` (`endPhase`) | rendu (`clearSel` + `refresh`) |
| `gameOver` | `game.js` (`endGame`) | rendu (bannière) |
| `log` | `combat.js`, rendu | rendu (journal) |

## Où placer du nouveau code

| Type de changement | Fichier(s) à toucher |
|---|---|
| Nouveau type de terrain (coût/défense/couleur) | `src/config.js` (`TERRAIN`) ; génération dans `src/map.js` ; légende dans `index.html` |
| Nouvelle unité / ajuster un facteur | `src/units.js` (`raw`) |
| Nouveau type d'unité (symbole, catégorie) | `src/units.js` (`isArmor`/`isFoot`, `type`) ; symbole dans `render/app.js` (`drawSymbol`) |
| Règle de mouvement / ZOC | `src/movement.js` |
| Règle de combat / modificateur CRT | `src/combat.js` ; colonnes/table dans `src/config.js` |
| Règle de ravitaillement | `src/supply.js` |
| Séquence, phases, condition de victoire | `src/game.js` |
| Nouvel événement règle → rendu | émettre dans `src/*`, s'abonner dans `render/app.js` (`state.bus.on`) |
| Affichage / HUD / interaction | `render/app.js` uniquement |
| Nouveau test | `test/<module>.test.js` (voir skill `testing`) |

**Règle d'or** : si le changement décide « ce qui se passe dans le jeu », il va dans `src/` et se teste. S'il décide « comment ça s'affiche », il va dans `render/`.
