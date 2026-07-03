---
name: unites-facteurs
description: Use when working on units — the roster, unit types, reduction (recto/verso), or effective combat/movement factors (supply, reduction).
auto_invoke: true
---

# Unités & facteurs

Modèle de pion et calcul des facteurs effectifs dans `src/units.js`. Roster initial dans la constante `raw`.

## Concepts → implémentation

| Concept | Implémentation |
|---|---|
| Roster de départ | `raw` (`src/units.js`) — `name` (libellé pion), `fullName` (nom complet inspecteur), facteurs, position offset `col`/`row` |
| Instanciation | `createUnits()` → `{ id, ...facteurs, q, r, mpLeft, hasFought, reduced, supplied }` |
| Face recto (pleine force) | `atk`, `def`, `mov` |
| Face verso (réduite) | `ratk`, `rdef`, `rmov` |
| Palier de perte | `reduced` (bool) ; passe recto → verso, puis élimination |
| Attaque effective | `eAtk(u)` = face courante |
| Défense effective | `eDef(u)` = face courante, ÷2 si hors ravito (min 1) |
| Mouvement effectif | `eMov(u)` = face courante, ÷2 si hors ravito (min 1) |
| Ravitaillement | `u.supplied` (calculé par `updateSupply`, voir `ravitaillement`) |
| Catégories | `isArmor(u)` (armor) ; `isFoot(u)` (inf/mech/moto) |
| Occupation d'un hex | `unitsAt(units,q,r)`, `enemyAt(units,q,r,side)`, `stackCount(units,q,r,side)` |
| Camp opposé | `other(side)` |

## Types d'unités

`armor`, `mech`, `moto`, `inf`, `arty`. `isArmor`/`isFoot` conditionnent les **armes combinées** (voir `combat-crt`) ; `arty` fournit l'**appui d'artillerie**.

## Distinction importante

Le pion **imprime** les facteurs de sa face courante (`render/app.js` → `makeCounter`), mais le **combat** utilise les facteurs *effectifs* (`eAtk`/`eDef`) qui intègrent le ravitaillement. Ne pas confondre valeur imprimée et valeur effective.

## Ajouter / modifier une unité

1. Ajouter ou éditer une ligne de `raw` (`src/units.js`) : `side`, `type`, `ech`, `name`, `fullName`, facteurs recto + verso (`r*`), position `col`/`row`.
2. Si `type` est nouveau : l'intégrer à `isArmor`/`isFoot` selon sa catégorie, et dessiner son symbole dans `render/app.js` (`drawSymbol`).
3. Vérifier l'empilement (`STACK_MAX`) si plusieurs unités partagent un hex de départ.
4. Test macro si la modification change un résultat de combat/mouvement.
