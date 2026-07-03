---
name: sequence-jeu
description: Use when working on the turn sequence (IGO-UGO phases), objectives control, or victory conditions.
auto_invoke: true
---

# Séquence de jeu & victoire

Machine à états de la partie dans `src/game.js`.

## Concepts → implémentation

| Concept | Implémentation |
|---|---|
| État de séquence | `state.G = { turn, player, phase, over }` |
| Création de partie | `createGame(rng)` |
| Séquence IGO-UGO | Axe mvt → Axe combat → Allié mvt → Allié combat → tour++ |
| Avancement | `endPhase(state)` (émet `phaseChanged`) |
| Début de phase de mouvement | `startMove(state, side)` — ravitaillement puis PM |
| Contrôle des objectifs | `updateObjectives(state)`, `objCount(state, side)` |
| Fin par anéantissement | `checkElimination(state)` (abonné à `combatResolved`) |
| Fin au dernier tour | `checkTurnEnd(state)` (tour > `MAX_TURNS`) |
| Fin de partie | `endGame(state, side, reason)` (émet `gameOver`) |

## Règles encodées

- **IGO-UGO** : chaque camp joue mouvement puis combat avant de passer la main. `endPhase` gère la transition et incrémente `turn` quand l'Allié finit son combat.
- **Victoire** : anéantissement d'un camp (immédiat, via `checkElimination` après chaque combat) OU, au tour `MAX_TURNS`, le camp contrôlant le plus d'objectifs (`checkTurnEnd`).
- **Objectifs** : `objControl` retient le *dernier occupant* d'une ville/port (`updateObjectives`).

## Points d'attention

- `createGame` câble `bus.on('combatResolved', () => checkElimination(state))` : un nouveau déclencheur de fin passe par le même schéma (émettre → s'abonner), pas par un appel direct depuis le rendu.
- `endPhase` n'appelle pas le rendu : il émet `phaseChanged`, auquel `render/app.js` réagit (`clearSel` + `refresh`).

## Modifier la séquence / la victoire

1. Nouvelle phase ou ordre : `endPhase` + `startMove`.
2. Nouvelle condition de victoire : une fonction `check…(state)` appelant `endGame`, déclenchée par un événement approprié.
3. Durée de partie : `MAX_TURNS` (`src/config.js`).
4. Test macro dans `test/game.test.js` (enchaînement des phases, victoire par anéantissement, victoire aux objectifs).
