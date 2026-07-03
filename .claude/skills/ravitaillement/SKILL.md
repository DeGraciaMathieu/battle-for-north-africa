---
name: ravitaillement
description: Use when working on supply — sources, the flood-fill propagation, or how out-of-supply affects units.
auto_invoke: true
---

# Ravitaillement

Propagation du ravitaillement par flood-fill dans `src/supply.js`.

## Concepts → implémentation

| Concept | Implémentation |
|---|---|
| Sources d'un camp | `supplySources(state, side)` — camp de base (hexe `base`, position dans `BASES`) + ports tenus (`objControl`) |
| Portée de route | `SUPPLY_RANGE` (`config.js`) — au-delà de N hexes de route depuis une source, l'hex n'est plus ravitaillé |
| Hexes ravitaillés | `suppliedHexes(state, side)` → `Set` (flood-fill depuis les sources) |
| Routes de ravitaillement | `supplyRoutes(state, side)` → `{ supplied, parent, depth }` (BFS ; `parent` trace la route, `depth` = longueur de route depuis la source) |
| Mise à jour des unités | `updateSupply(state)` → positionne `u.supplied` pour tous |
| Effet hors ravito | défense et mouvement ÷2 (via `eDef`/`eMov`, voir `unites-facteurs`) |
| Visualisation (overlay) | `render/app.js` → `drawSupplyLines` (bouton `RAV`) : teinte les hexes ravitaillés + numéro de portée restante (`SUPPLY_RANGE − depth`) + ligne de chaque unité vers sa source + halo des sources |

## Règles encodées

Le flood-fill (BFS) part des sources et se propage d'hex en hex tant qu'il **ne traverse pas** :
- la **mer** (`cost === Infinity`) ;
- un **hex ennemi** (`enemyAt`) ;
- une **ZOC ennemie** (`zocOf(other(side))`) — c'est elle qui « coupe » l'artère.

De plus, la propagation s'arrête au-delà de **`SUPPLY_RANGE`** hexes de route : un détour forcé (par une ZOC) allonge la route et peut faire dépasser la portée → coupure. Une source elle-même est ignorée si elle est occupée par l'ennemi ou en ZOC ennemie.

Sources volontairement étroites (camp de base + ports tenus) : le centre de la carte n'est ravitaillé que si l'on tient un port relais. Le camp de base est posé à la génération (`src/map.js`, terrain `base`) aux positions de `BASES`.

## Dépendances & ordre d'appel

- `updateSupply` est appelé par `startMove` (`src/game.js`) **avant** de fixer les PM, car le ravitaillement conditionne `eMov`. Le respecter si tu ajoutes une phase.
- Le rendu rappelle `updateSupply(state)` dans son `refresh()` pour l'affichage (liseré orange).

## Modifier le ravitaillement

1. Nouvelle source (ex. dépôt) : `supplySources`.
2. Nouvel obstacle de propagation : la boucle de `suppliedHexes`.
3. Nouvel effet du hors-ravito : `eDef`/`eMov` dans `src/units.js`.
4. Test macro dans `test/supply.test.js` (une ZOC coupe la ligne).
