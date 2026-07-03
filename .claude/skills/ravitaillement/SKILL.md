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
| Sources d'un camp | `supplySources(state, side)` — ports tenus (`objControl`) + bord ami (Axe = colonne 0, Allié = `COLS-1`) |
| Hexes ravitaillés | `suppliedHexes(state, side)` → `Set` (flood-fill depuis les sources) |
| Mise à jour des unités | `updateSupply(state)` → positionne `u.supplied` pour tous |
| Effet hors ravito | défense et mouvement ÷2 (via `eDef`/`eMov`, voir `unites-facteurs`) |

## Règles encodées

Le flood-fill part des sources et se propage d'hex en hex tant qu'il **ne traverse pas** :
- la **mer** (`cost === Infinity`) ;
- un **hex ennemi** (`enemyAt`) ;
- une **ZOC ennemie** (`zocOf(other(side))`) — c'est elle qui « coupe » l'artère.

Une source elle-même est ignorée si elle est occupée par l'ennemi ou en ZOC ennemie.

## Dépendances & ordre d'appel

- `updateSupply` est appelé par `startMove` (`src/game.js`) **avant** de fixer les PM, car le ravitaillement conditionne `eMov`. Le respecter si tu ajoutes une phase.
- Le rendu rappelle `updateSupply(state)` dans son `refresh()` pour l'affichage (liseré orange).

## Modifier le ravitaillement

1. Nouvelle source (ex. dépôt) : `supplySources`.
2. Nouvel obstacle de propagation : la boucle de `suppliedHexes`.
3. Nouvel effet du hors-ravito : `eDef`/`eMov` dans `src/units.js`.
4. Test macro dans `test/supply.test.js` (une ZOC coupe la ligne).
