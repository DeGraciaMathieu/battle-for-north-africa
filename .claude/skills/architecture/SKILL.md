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
| `render/app.js` | Point d'entrée : assemble session + scène + modules, câble le bus règles → rendu, lance la partie | tout `render/`, `src/game.js` |
| `render/session.js` | Paramètres d'URL, lobby réseau, handshake P2P, RNG — renvoie l'objet `session` (rôle, seed, armées, `send`, `netLost`) | config, map, net |
| `render/stage.js` | Scène PixiJS : `app`, couches (`layers`), rendu à la demande (`draw`), caméra (`zoomAt`, `fitView`, `panToHex`, `onViewChanged`) | geometry |
| `render/board.js` | Plateau statique : tuiles/décors/bases + couche stats, rasterisé une fois (`buildBoard`) | config, geometry, gfx |
| `render/counters.js` | Pions : sprites recto/verso (`buildCounterSprite`, `drawSymbol`), `rebuild`, empilement (`layout`) | geometry, gfx |
| `render/fx.js` | Effets : explosions (`spawnFx`), retournements (`flipUnit`), file `fxQueue`, ticker à la demande | config, geometry, gfx, counters |
| `render/overlay.js` | Surbrillances dynamiques : portée, ZOC, ravito, cibles, fanions/médailles, projecteur IA (`drawOverlay`) | movement, supply, gfx |
| `render/uiState.js` | État d'interaction partagé : `sel`, `pending`, `attackers`, bascules d'affichage, `clearSel` | — |
| `render/hud.js` | HUD DOM : `log`, `refresh`, bulle de déplacement, info-bulle d'hexe, écran de fin | supply, game, html |
| `render/combatModal.js` | Modale de combat : aperçu, animation du dé (`runRoll`), `closeCombat`, rejeu spectateur (`remoteCombat`) | combat, html |
| `render/stackFan.js` | Éventail de pile : survol prolongé d'un hexe empilé → cartes cliquables (jouer une unité) et glissables (réordonner la pile via `reorderStack`) | geometry, units, movement, counters |
| `render/input.js` | Entrées joueur : clics, drag & drop, survol, molette/clavier, bascules, fin de phase | movement, combat, game |
| `render/drivers.js` | Pilotes d'adversaire : tour de l'IA (`maybeRunAI`), rejeu des actions distantes (`attachNet`) | movement, game, ai |
| `render/html.js` | Fragments HTML PURS (inspecteur, info-bulle, table CRT, récap de fin) — testable sans navigateur | config, units, supply, game |
| `render/gfx.js` | Helpers graphiques PURS : couleurs de camp, `lerpColor`, arêtes d'hexe — testable sans navigateur | — |
| `render/net.js` | Transport P2P (PeerJS/WebRTC) + `mulberry32` pour le lockstep ; aucune règle, aucun état (voir skill `online`) | — |
| `index.html` | Bootstrap : charge PixiJS (CDN) puis `render/app.js` en module | — |

## L'objet `state`

Créé par `createGame(rng)` (`src/game.js`). Toutes les règles le reçoivent en argument :

```
{ terrain: Map, hexes: [], objectives: [key],
  objControl: Map<key, 'blue'|'red'>, units: [], 
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
| Nouveau type d'unité (symbole, catégorie) | `src/units.js` (`isArmor`/`isFoot`, `type`) ; symbole dans `render/counters.js` (`drawSymbol`) |
| Règle de mouvement / ZOC | `src/movement.js` |
| Règle de combat / modificateur CRT | `src/combat.js` ; colonnes/table dans `src/config.js` |
| Règle de ravitaillement | `src/supply.js` |
| Séquence, phases, condition de victoire | `src/game.js` |
| Nouvel événement règle → rendu | émettre dans `src/*`, s'abonner dans `render/app.js` (`state.bus.on`) |
| Surbrillance / marqueur sur la carte | `render/overlay.js` (`drawOverlay`) |
| Panneau / texte du HUD | HTML dans `render/html.js` (pur, testé), affichage dans `render/hud.js` |
| Geste, raccourci, bouton | `render/input.js` |
| Effet visuel animé | `render/fx.js` |
| Comportement du tour de l'IA (rythme, caméra) | `render/drivers.js` (la décision reste dans `src/ai.js`) |
| Nouveau test | `test/<module>.test.js` (voir skill `testing`) |

**Règle d'or** : si le changement décide « ce qui se passe dans le jeu », il va dans `src/` et se teste. S'il décide « comment ça s'affiche », il va dans `render/`.
