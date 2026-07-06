# PRD — D · Retours visuels (juice, sans son)

## Objectif

Renforcer le ressenti sans toucher aux règles ni au son, via trois retours visuels : **animation de déplacement** (le pion glisse au lieu de téléporter), **feedback de capture d'objectif** (pulsation quand une ville/objectif change de camp), et **impact de combat sur la carte** (légère secousse d'écran + flash sur l'hexe visé au résultat). Purement rendu, aucune incidence sur le déterminisme.

## Existant technique

- **`render/app.js`** :
  - Système d'animation par ticker déjà en place : `fx` (foyers d'explosion, `spawnFx`/`drawFx`), `flips` (retournement recto→verso, `flipUnit`/`updateFlips`), boucle `animTick` (avance `fx`/`flips`, `draw()`), `startAnim()`. `lerpColor` disponible.
  - Pions : `counters` (Map id→sprite), `layoutStacks()` **repositionne instantanément** les pions à chaque `refresh()` ; `axialToPixel(q,r)`.
  - Combat : `combatResolved` porte le résumé, dont `target: { q, r }` (hexe du défenseur) ; `revealAfterRoll(p)` révèle le résultat ; `closeCombat` joue `spawnFx`/`flipUnit` depuis `fxQueue`.
  - Objectifs/peuplements : `drawObjective`/`drawFlag` dessinent étoile/fanion à la couleur de `state.objControl.get(k)` (rejoué à chaque `drawOverlay`). Le contrôle évolue via `updateObjectives(state)` (appelé dans `refresh`).
  - `world` (conteneur PixiJS) : position ajustée par `fitView`/pan/zoom — support d'une secousse d'écran.
  - Chemins de déplacement : `confirmMove`, glisser-déposer (`pointerup`), pilote IA (`runAiTurn`), rejeu distant (`onGameMsg`).
- **`src/`** : inchangé. Les retours se branchent sur des événements/états déjà exposés.

## Comportement

### D1 — Animation de déplacement
- Quand un pion change d'hexe (tous chemins : joueur, glisser, IA, distant), sa tuile **glisse** de la position d'origine à la destination sur ~200–280 ms (interpolation, ease-out), au lieu du saut instantané.
- L'animation est **cosmétique** : l'état (`q/r/mpLeft`) est déjà à jour ; seul l'affichage du sprite est différé le temps du glissement. `layoutStacks` ne « claque » pas la position du pion en cours d'animation.
- Compatible avec le pilote IA (les pauses `AI_MOVE_MS` couvrent le glissement) et le rejeu distant.

### D2 — Feedback de capture d'objectif
- À chaque `refresh`, comparer `state.objControl` à un **instantané précédent** (côté rendu). Pour toute **ville/objectif** dont le contrôle **change** (y compris neutre→camp), déclencher une **pulsation** (halo/éclat bref, ~500 ms) sur l'étoile (objectif) ou le fanion (peuplement) concerné, dans la couleur du nouveau camp.
- Réutilise la boucle d'animation (nouveau type d'effet léger dans `fx`, ou anim dédiée).

### D3 — Impact de combat sur la carte
- Au moment du **résultat** (`revealAfterRoll` / `combatResolved`), sur l'hexe `target` :
  - **Flash** bref (fondu blanc→transparent, ~250 ms) sur l'hexe visé, en complément de l'explosion existante.
  - **Secousse d'écran** courte et discrète (décalage amorti de `world` sur ~250 ms), d'intensité modérée (plus marquée pour `DE`/`AE`, plus légère pour un recul).
- La secousse ne doit pas dérégler le pan/zoom : décalage temporaire restauré à l'état exact d'avant.

## Hors-scope

- **Aucun son** (traité plus tard).
- Pas de flourish de victoire (non retenu dans les choix).
- Pas d'animation des reculs/avances de pions au combat au-delà de l'impact (les pions se replacent via `layoutStacks`).
- Pas de particules persistantes ni de traînée de mouvement décorative.
- Aucune modification des règles, événements ou état.

## Impacts par couche

- **src/** : aucun.
- **render/** : `app.js` uniquement —
  - D1 : file d'animations de déplacement `{ id, from:{x,y}, to:{x,y}, t }` alimentée par les chemins de move ; intégration dans `animTick` ; `layoutStacks` respecte une anim en cours.
  - D2 : instantané `prevObjControl` (Map) comparé dans `refresh` ; pulsation via `fx`/anim dédiée sur l'hexe changé.
  - D3 : flash d'hexe (nouveau type `fx` ou tracé bref) + secousse de `world` amortie, déclenchés sur `combatResolved`/`revealAfterRoll` à `summary.target`.
- **config** : aucune (durées/intensités en littéraux locaux, comme l'existant `spawnFx`).
- **doc** : aucune règle changée ; éventuel mot dans le skill `architecture` (les retours visuels vivent dans la couche rendu, pilotés par le bus).

## Critères d'acceptation

- Un déplacement (joueur, IA, distant) fait **glisser** le pion ; aucun saut instantané perceptible en jeu normal.
- Quand une ville/objectif change de camp, une **pulsation** apparaît sur son symbole à la couleur du nouveau contrôleur.
- À la résolution d'un combat, l'hexe visé subit un **flash** et une **secousse d'écran** brève ; le pan/zoom revient exactement à son état antérieur.
- Aucun changement de comportement des règles ; `npm test` reste vert.
- Les effets restent fluides et n'entravent pas l'enchaînement des tours (notamment le pilote IA).

## Tests

- Couche rendu (non testée) : vérification manuelle. Aucune assertion règle à ajouter (état/événements inchangés).
- Contrôle de non-régression : `npm test` vert (les modules `src/` ne sont pas touchés).

## Risques & questions ouvertes

- **D1 vs `layoutStacks`** : le repositionnement instantané doit céder le pas à l'animation en cours sans laisser un pion « fantôme » sur l'ancienne case ; bien gérer les `refresh` multiples pendant une anim (déplacements successifs, IA).
- **D1 en ligne** : purement visuel — ne jamais faire dépendre l'état de l'animation (risque de désync nul si on respecte « état d'abord, anim ensuite »).
- **D3 secousse** : restaurer la position exacte de `world` (mémoriser la base avant secousse) pour ne pas dériver au fil des combats.
- **Lisibilité** : intensités volontairement modérées (secousse discrète, flash court) pour ne pas fatiguer sur une partie longue.
