# PRD — C · Écran de fin de partie avec récap

## Objectif

Remplacer le bandeau de fin minimal (titre + raison) par un **récapitulatif** de la partie : **objectifs tenus par camp** et **pertes par camp** (éliminés + réduits). Clôt la partie sur une lecture claire du résultat, pour un coût quasi nul et aucun risque (pur rendu).

## Existant technique

- **`src/game.js`** : `endGame(state, side, reason)` → `bus.emit('gameOver', { side, reason })`. `objCount(state, side)` = nombre de villes (`state.objectives`) tenues par un camp. Fin déclenchée par `checkElimination` (anéantissement) ou `checkTurnEnd` (fin du tour `MAX_TURNS`, objectifs comptés).
- **`src/units.js`** : chaque pion porte `side`, `reduced` ; `createUnits(composition)` fabrique le roster initial. Pas de compteur de pertes conservé.
- **`render/app.js`** :
  - `state.bus.on('gameOver', ({ side, reason }) => …)` remplit `#bannerTitle` / `#bannerSub` et affiche `#banner`.
  - `sideLabel(side)`, `objCount` importé, accès complet à `state.units`.
- **`game.html`** : `#banner .box` avec `#bannerTitle`, `#bannerSub`, boutons Rejouer/Accueil.

## Comportement

Au `gameOver`, la boîte de fin affiche, sous le titre de victoire et la raison :

1. **Objectifs tenus** : `objCount(state,'blue')` — `objCount(state,'red')`, avec libellés de camp et mise en avant du vainqueur.
2. **Pertes par camp**, calculées par comparaison au **roster initial** (capturé à l'init côté rendu) :
   - **Éliminés** = `effectif initial du camp − pions encore en vie du camp`.
   - **Réduits** = pions vivants du camp avec `reduced === true`.
   - Affiché par camp : « Bleu : 3 éliminés, 2 réduits · Rouge : 5 éliminés, 1 réduit ».

Le tout dans un petit tableau lisible dans `#banner .box`, au-dessus des boutons Rejouer/Accueil existants.

## Hors-scope

- Pas de « meilleur pion » ni de statistiques de coups portés (non retenu).
- Pas de durée/nombre de tours dans le récap (non retenu).
- Pas d'export/partage du récap.
- Pas de graphe/animation de données (le flourish visuel de victoire est traité dans le PRD D, et n'a pas été retenu).
- Aucune modification des règles ni des événements (`gameOver` suffit).

## Impacts par couche

- **src/** : aucun (les données sont déjà dans `state` ; `objCount` existe).
- **render/** : `app.js` — capturer à l'init l'**effectif initial par camp** (`initialCount = { blue, red }`) ; dans le handler `gameOver`, construire le récap (objectifs + pertes) et l'injecter dans la boîte. `game.html` — un conteneur `#bannerRecap` dans `#banner .box` + styles.
- **config** : aucune.
- **doc** : skill `sequence-jeu` (l'écran de fin expose objectifs + pertes) ; légende/HUD si nécessaire.

## Critères d'acceptation

- À la fin (anéantissement **ou** fin de tour), la boîte affiche le décompte d'objectifs par camp et les pertes (éliminés + réduits) par camp.
- Les pertes correspondent à l'écart avec le roster initial (éliminés) et aux pions `reduced` vivants (réduits).
- Le récap est cohérent avec la raison de fin (ex. anéantissement → un camp a perdu tous ses pions).
- Les boutons Rejouer/Accueil restent fonctionnels.
- `npm test` vert (aucun test cassé ; couche rendu non testée).

## Tests

- Couche rendu (non testée) : vérification manuelle sur les deux fins (anéantissement et fin de tour).
- Le socle règle est déjà couvert : `objCount` et les conditions de victoire (`checkElimination`/`checkTurnEnd`) sont testés dans `test/game.test.js`. Ajouter au besoin une assertion que `objCount` reflète le contrôle final.

## Risques & questions ouvertes

- **Capture de l'effectif initial** : le faire une seule fois à l'init, avant tout combat, sinon les « éliminés » sont faussés. En ligne, chaque client calcule le sien sur son état identique — cohérent.
- **Lisibilité mobile** : la boîte de fin doit rester lisible sur petit écran (tableau compact).
- Aucune dépendance risquée : effet purement additif au bandeau existant.
