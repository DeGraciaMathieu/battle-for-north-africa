# PRD — Renforts échelonnés

## Objectif

Donner du rythme et de la profondeur aux 6 tours : au lieu de tout déployer au tour 1, chaque camp peut **réserver** une partie de son budget (45 pts) à des pions de **renfort** qui arrivent au **camp de base** à partir du tour 2, à un tour d'arrivée choisi à l'achat. L'arrivée n'a lieu que si le camp de base reste ravitaillé.

## Existant technique

- **`src/config.js`** : `UNIT_CATALOG` (facteurs + `cost`), `CATALOG_ORDER`, `ARMY_POINTS = 45`, `BASES = { blue, red }` (hexe source), `MAX_TURNS = 6`.
- **`src/units.js`** : `createUnits(composition)` construit le roster. La `composition` provient de l'éditeur point-buy (homepage) encodée en URL via `CATALOG_ORDER`.
- **`src/game.js`** :
  - `createGame(rng, seed, composition, map, mapOptions)` crée l'état, `relocateOffWater`, `updateObjectives`, `startMove(state, 'blue')`.
  - `startMove(state, side)` (ligne ~87) : appelé au début de chaque phase de mouvement d'un camp — **point d'insertion naturel** pour faire apparaître les renforts du tour.
  - `endPhase(state)` incrémente `G.turn` et appelle `startMove` du camp suivant.
  - `state.G = { turn, player, phase, over }`.
- **`src/supply.js`** : `supplySources(state, side)` inclut le camp de base ; `suppliedHexes(state, side)` permet de tester si la base est ravitaillée.
- **`render/app.js`** : `rebuildCounters` / `layoutStacks` construisent les pions à partir de `state.units` ; `refresh()` redessine. L'éditeur d'armée vit côté homepage (encodage URL de la composition).
- **Déterminisme / online** : le roster et l'ordre sont fixés par la `composition` ; toute apparition doit être déterministe (même composition → même arrivée), sinon désync en lockstep (cf. mémoire `mode-en-ligne-lockstep`).

## Comportement

1. **À l'achat (éditeur d'armée)** : chaque pion acheté reçoit un **tour d'arrivée** `arriveTurn` ∈ [1..6].
   - `arriveTurn = 1` → déploiement initial (comportement actuel).
   - `arriveTurn` ∈ [2..6] → renfort : le pion **n'est pas déployé** au tour 1.
   - Le budget total reste `ARMY_POINTS = 45` (les renforts sont *réservés* dans ce budget, pas en plus).
   - L'`arriveTurn` est encodé dans la `composition` (sérialisation URL) au même titre que le type/position.
2. **Création de partie** : `createUnits` marque chaque unité de son `arriveTurn` ; seules les unités `arriveTurn === 1` sont posées sur la carte. Les autres sont conservées dans l'état comme **renforts en attente** (`state.pending` ou champ `deployed:false` sur l'unité — au choix d'implémentation, mais sérialisable).
3. **Arrivée** : au début de la phase de mouvement d'un camp (dans `startMove`, ou une fonction `spawnReinforcements(state, side)` appelée là), pour chaque renfort de ce camp dont `arriveTurn <= G.turn` et non encore déployé :
   - **Condition** : le camp de base du camp est **ravitaillé** (`suppliedHexes(state, side)` contient l'hexe base) **et** l'empilement à la base `< STACK_MAX`.
   - Si oui : poser le pion sur l'hexe base (ou un hexe libre adjacent ravitaillé si la base est pleine), `deployed = true`, PM pleins pour ce tour.
   - Si non (base coupée / pleine) : **différer** au tour suivant (le pion reste en attente, réessaie à chaque `startMove`). Un `arriveTurn` raté n'est pas perdu.
4. **Notification** : émettre un `bus.emit('log', …)` à chaque arrivée (« 2 renforts Bleus rejoignent le front »).
5. **Victoire par anéantissement** : un camp n'est éliminé (`checkElimination`) que s'il n'a **plus aucune unité ET plus aucun renfort en attente**. (Sinon un camp tout en renforts perdrait au tour 1.)

## Hors-scope

- Pas de choix de point d'entrée autre que le camp de base (ni ports, ni bord de carte).
- Pas de renforts « gratuits » hors budget (option écartée : tout est réservé dans les 45 pts).
- Pas d'annulation/replanification de l'`arriveTurn` en cours de partie.
- Pas de renforts pour l'IA au-delà du même mécanisme (l'IA joue les pions présents ; les renforts apparaissent automatiquement pour les deux camps).

## Impacts par couche

- **src/** :
  - `config.js` : éventuelle constante `MIN_ARRIVE_TURN`/`MAX_ARRIVE_TURN` (bornes de l'éditeur) si besoin.
  - `units.js` : `createUnits` lit et pose `arriveTurn` (défaut 1) ; ne déploie que les `arriveTurn === 1`, garde les autres marquées `deployed:false`.
  - `game.js` : nouvelle `spawnReinforcements(state, side)` appelée dans `startMove` ; ajuster `checkElimination` (compter aussi les renforts en attente).
- **render/** :
  - Éditeur d'armée (homepage) : sélecteur de tour d'arrivée par pion + encodage dans la `composition` URL.
  - `app.js` : afficher les renforts arrivés (déjà géré par `rebuildCounters` sur `state.units`) ; consommer le `log` d'arrivée ; éventuel indicateur HUD « renforts en attente : n ».
- **config** : bornes d'arrivée si extraites en constantes.
- **doc** : skill `sequence-jeu` (arrivée des renforts dans la séquence), skill `unites-facteurs` (champ `arriveTurn`/`deployed`), `CLAUDE.md` (mention renforts).

## Critères d'acceptation

- Un pion acheté avec `arriveTurn = 3` n'est **pas** sur la carte au tour 1 ; il apparaît à la base au début de la phase de mouvement du camp au tour 3.
- Le budget d'armée reste plafonné à 45 pts, renforts inclus.
- Base coupée du ravitaillement au tour d'arrivée → le renfort est **différé** et apparaît dès que la base redevient ravitaillée (pas perdu).
- Base pleine (STACK_MAX) → le renfort se pose sur un hexe libre adjacent ravitaillé, ou est différé si aucun.
- Un camp dont toutes les unités initiales sont détruites mais qui a encore des renforts en attente n'est **pas** déclaré anéanti.
- Déterminisme : même composition + même seed → mêmes arrivées (aucune désync en ligne).
- `npm test` vert.

## Tests

`test/reinforcements.test.js` (nouveau, macro) :
- **Apparition au bon tour** : composition avec un pion `arriveTurn = 3` → absent de la carte tours 1-2, présent à la base dès le début du mouvement du camp au tour 3.
- **Report si base coupée** : placer une ZOC ennemie coupant la base au tour d'arrivée → renfort différé, puis apparaît une fois la base redevenue ravitaillée.
- **Budget** : `createUnits` d'une composition renforts inclus respecte `ARMY_POINTS`.
- **Anéantissement** : camp sans unité déployée mais avec renfort en attente → `checkElimination` ne termine pas la partie.
- RNG fixé si un combat intervient dans un scénario (report via ZOC).

## Risques & questions ouvertes

- **Question ouverte (défaut proposé)** : faut-il **plafonner** la part de budget réservable aux renforts (ex. ≤ 50 % des 45 pts) pour éviter une armée « tout en tour 6 » ? Défaut retenu : **pas de plafond**, mais la condition « base ravitaillée » et le risque de perdre des objectifs tôt en sont le contre-poids naturel.
- **Sérialisation `composition`** : ajouter `arriveTurn` à l'encodage URL sans casser les liens d'armées existants (prévoir une valeur par défaut 1 si absente).
- **Placement quand la base est pleine** : le repli sur un hexe adjacent doit rester déterministe (ordre des `DIRS`).
- Interaction avec l'IA : vérifier que l'IA (postures/scoring) se comporte correctement quand son effectif grossit en cours de partie (aucune hypothèse d'effectif figé dans `ai.js`).
