---
name: mouvement-zoc
description: Use when working on movement range, pathfinding (Dijkstra by movement points), or zones of control (ZOC).
auto_invoke: true
---

# Mouvement & ZOC

Portée et zones de contrôle dans `src/movement.js`.

## Concepts → implémentation

| Concept | Implémentation |
|---|---|
| Zone de contrôle d'un camp | `zocOf(units, side, terrain)` → `Set` des hexes autour de ses unités |
| Portée d'une unité | `computeReachable(state, unit)` → `{ reachable, dist, eZOC }` |
| Application d'un déplacement | `moveUnit(unit, targetKey, dist, eZOC)` |
| Points de mouvement restants | `unit.mpLeft` (initialisés à `eMov(u)` par `startMove`) |
| Coût d'entrée d'un hex | `TERRAIN[type].cost` |

## Règles encodées

- **Dijkstra à PM** : `computeReachable` explore par coût croissant tant que `cost <= unit.mpLeft`.
- **Mer infranchissable** : `cost === Infinity` → hex écarté.
- **Pas d'entrée en hex ennemi** (`enemyAt`) ni en pile pleine (`stackCount >= STACK_MAX`).
- **Arrêt en ZOC ennemie** : entrer dans un hex de la ZOC ennemie est *terminal* — l'hex est atteignable mais on n'étend pas au-delà. `moveUnit` remet alors `mpLeft` à 0.

## Où placer du nouveau code

- Nouvelle contrainte de déplacement (ex. terrain interdit à un type) : dans la boucle de `computeReachable`.
- Modifier la portée de la ZOC ou ses exceptions : `zocOf`.
- Effet à l'entrée d'un hex : `moveUnit`.

Toute modification ici a un impact large (le ravitaillement et le recul au combat réutilisent `zocOf`). Couvrir par un test macro dans `test/movement.test.js` (portée, mer, arrêt en ZOC).
