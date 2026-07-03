---
name: testing
description: Use when writing, running, or reasoning about tests — the runner, the macro-test philosophy, and where each test belongs.
auto_invoke: true
---

# Tests

## Commande

```
npm test          # node --test test/*.test.js
```

Runner intégré à Node (`node:test` + `node:assert/strict`), zéro dépendance. Les tests importent uniquement `src/` (règles pures) — jamais `render/` (qui exige un navigateur et `window.PIXI`).

## Philosophie : tests macro

Tester le **comportement fonctionnel** du jeu, pas les détails d'implémentation. Un bon test décrit une règle observable : « entrer en ZOC ennemie stoppe l'unité », « un échange réduit les deux camps », « une ZOC coupe le ravitaillement ». Éviter d'assert sur des structures internes (ordre d'un tableau, forme d'un objet intermédiaire).

Deux leviers rendent les règles testables sans navigateur :
- **RNG injectable** : `createGame(rng)` et `state.rng` — passer `rng: () => k` fixe le dé (`die = 1 + floor(k*6)`).
- **Bus d'événements** : s'abonner (`state.bus.on('unitRemoved', …)`) pour vérifier les effets sans rendu.

Helpers de test dans `test/helpers.js` : `makeState`, `fillTerrain`, `makeUnit` construisent des états minimaux (pas besoin de la carte complète).

## Mapping fichier de test → périmètre

| Fichier | Périmètre couvert | Module testé |
|---|---|---|
| `test/geometry.test.js` | conversions de coordonnées, distance, clamp | `src/geometry.js` |
| `test/movement.test.js` | portée (PM), mer infranchissable, arrêt en ZOC | `src/movement.js` |
| `test/combat.test.js` | odds, échange, armes combinées, élimination + avance | `src/combat.js` |
| `test/supply.test.js` | coupure de ravitaillement par ZOC | `src/supply.js` |
| `test/game.test.js` | séquence IGO-UGO, victoire (anéantissement, objectifs) | `src/game.js` |

## Où placer un nouveau test

- Une règle par module → un fichier `test/<module>.test.js`. Ajouter un `test('description fonctionnelle', …)` au fichier correspondant.
- Nouvelle règle transverse (ex. ravitaillement + combat) : la placer dans le fichier du module qui *décide* le résultat, en construisant l'état via les helpers.
- Toujours fixer l'aléa avec un `rng` déterministe si le combat est impliqué.

**Ne jamais déclarer une tâche terminée sans avoir lancé `npm test` et vérifié le vert.**
