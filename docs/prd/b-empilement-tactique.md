# PRD — B · Empilement tactique

## Objectif

Donner un effet mécanique à l'empilement (aujourd'hui neutre) : une **pile dense** (≥2 pions amis sur l'hexe) est plus difficile à déloger (`+1` colonne en faveur du défenseur), mais devient **vulnérable à l'artillerie** (`+1` colonne pour l'attaquant quand une artillerie appuie une cible empilée). Le choix « concentrer vs disperser » devient réel, et l'artillerie gagne un rôle de contre-concentration.

## Existant technique

- **`src/config.js`** : `STACK_MAX = 3` (empilement max par camp et par hexe) ; `ODDS`, `CRT`.
- **`src/units.js`** : `stackCount(units, q, r, side)` → nombre de pions amis sur l'hexe.
- **`src/combat.js`** : `combatPlan(state, attackers, defender)` calcule la colonne finale :
  `idx = clamp(oddsIndex(atk, def) + combined + arty − terr, 0, 7)`
  où `combined` (armes combinées +1), `arty` (appui artillerie, +1 à +2, `arty>0` si au moins une pièce appuie), `terr` (décalage défensif du terrain, **soustrait**). `resolveCombat` réutilise `combatPlan`.
- **`render/app.js`** : `handleCombat` cible le **pion du dessus** d'une pile (`top = stack[stack.length-1]`) — les pions d'une pile sont défaits **un par un**. L'aperçu (`combatCalcHtml`) affiche les décalages.

## Comportement

Deux décalages de colonne ajoutés dans `combatPlan`, calculés sur la densité de la pile **du défenseur** (`stackCount(units, defender.q, defender.r, defender.side)`), notée `dStack` :

1. **Bonus défensif de concentration** : si `dStack ≥ 2`, la colonne est décalée d'`1` **en faveur du défenseur** (soustraite, comme le terrain). Modèle inchangé : c'est toujours le pion du dessus qui défend, mais la concentration le rend plus dur à déloger. À mesure que la pile est réduite à 1, le bonus disparaît.
2. **Vulnérabilité à l'artillerie** : si **une artillerie appuie** (`arty > 0`) **et** `dStack ≥ 2`, la colonne est décalée d'`1` **en faveur de l'attaquant** (ajoutée).

Interaction (tension voulue) : contre une pile dense,
- **sans artillerie** → net `−1` (le défenseur est avantagé) ;
- **avec artillerie** → `−1 (concentration) + 1 (artillerie) = 0` : l'artillerie **neutralise** le bonus de pile.

Formule cible :
`idx = clamp(oddsIndex + combined + arty − terr − stackDef + stackArty, 0, 7)`
avec `stackDef = dStack ≥ 2 ? 1 : 0` et `stackArty = (arty > 0 && dStack ≥ 2) ? 1 : 0`.

L'aperçu de combat expose ces décalages comme les autres (combiné/artillerie/terrain).

## Hors-scope

- Pas de **défense combinée** : on ne cumule pas la défense des pions empilés ; le pion du dessus reste le défenseur (option écartée pour ne pas réécrire la résolution).
- Pas de changement de `STACK_MAX` ni du déploiement.
- Pas d'effet d'empilement **côté attaquant** (empiler des attaquants ne change rien de nouveau ; les armes combinées existent déjà).
- Pas de dégâts de zone (l'artillerie ne touche pas plusieurs pions de la pile d'un coup).

## Impacts par couche

- **src/** : `combat.js` — calcul de `dStack` dans `combatPlan`, ajout de `stackDef`/`stackArty` à `idx`, et exposition dans le résumé (`summary.stackDef`, `summary.stackArty`) pour l'aperçu et le journal.
- **render/** : `app.js` — afficher les nouveaux décalages dans l'aperçu de combat (`combatCalcHtml`) au même titre que combiné/artillerie/terrain.
- **config** : aucune constante nouvelle (seuil `≥2` en dur, cohérent avec `STACK_MAX`).
- **doc** : skill `combat-crt` (nouveaux décalages), skill `unites-facteurs`/`mouvement-zoc` (empiler a désormais un effet), légende UI si l'aperçu liste les décalages.

## Critères d'acceptation

- Attaque **sans artillerie** d'un pion sur une pile ≥2 → colonne décalée d'`1` en faveur du défenseur vs le même combat sur un pion seul.
- Attaque **avec artillerie** d'une pile ≥2 → le bonus défensif est annulé (net `0` de ces deux décalages) ; sur un pion seul, l'artillerie garde son `+1` habituel.
- Réduire la pile à 1 pion fait **disparaître** le bonus défensif au combat suivant.
- L'aperçu de combat montre les décalages d'empilement.
- `npm test` vert.

## Tests

`test/combat.test.js` (RNG fixé au besoin) :
- **Bonus défensif** : `combatPlan` sur un défenseur en pile ≥2 (sans artillerie) donne un `idx` inférieur d'`1` au même cas sans pile.
- **Neutralisation par l'artillerie** : même combat avec une artillerie amie à portée → `idx` identique au cas « pile seule sans le bonus » (les deux décalages s'annulent).
- **Seuil** : pile de 1 → aucun décalage d'empilement.
- **Plafond** : les décalages restent bornés par `clamp(…, 0, 7)`.

## Risques & questions ouvertes

- **Lecture de la densité** : `stackCount` compte les pions **amis** du défenseur sur son hexe — vérifier qu'on prend bien le camp du défenseur, pas de l'attaquant.
- **Question ouverte (défaut proposé)** : l'artillerie doit-elle seulement **neutraliser** (défaut, `+1` conditionné à `arty>0`) ou **punir** l'empilement (`+1` inconditionnel, net `0`/`−1`… au désavantage du défenseur même sans concentration) ? Défaut retenu : neutralisation.
- **Équilibrage** : combiné avec l'artillerie (+1) et les armes combinées (+1), une pile peut être rapidement débordée — surveiller que défendre en pile reste un choix viable.
