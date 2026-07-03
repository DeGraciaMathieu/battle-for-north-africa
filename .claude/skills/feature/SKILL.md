---
name: feature
description: Use when implementing a new game feature or rule change end-to-end, from understanding the request to green tests.
auto_invoke: false
user_invocable: true
---

# Workflow : implémenter une fonctionnalité

Suivre ces étapes dans l'ordre. Ne pas sauter la clarification ni les tests.

## 1. Comprendre la demande

- Reformuler la fonctionnalité en une phrase.
- Invoquer le skill `architecture` pour situer le changement (couche `src/` vs `render/`, module concerné).
- Poser les **questions de clarification** avant de coder, notamment :
  - **valeurs numériques** (coûts de PM, décalages de colonne, portées, seuils) ;
  - **interactions avec l'existant** (impact sur ravitaillement, ZOC, séquence, victoire) ;
  - **cas limites** (unité réduite, hors ravitaillement, empilement plein, hex de bord/mer).

## 2. Implémenter

- Respecter la séparation des couches : la règle va dans `src/`, l'affichage dans `render/app.js`. Un effet visuel déclenché par une règle passe par un **événement** (`state.bus.emit`).
- Tout aléa via `state.rng`. État explicite passé en argument, pas de global de module.
- Suivre le skill de domaine correspondant (`combat-crt`, `mouvement-zoc`, `ravitaillement`, `unites-facteurs`, `sequence-jeu`, `geometrie-carte`).
- Implémenter uniquement ce qui est demandé.

## 3. Tester (macro)

- Ajouter/mettre à jour un test macro dans `test/<module>.test.js` (comportement fonctionnel, RNG fixé si combat).
- `npm test` jusqu'au vert. **Si l'approche échoue après 2 tentatives, reprendre le plan** (revenir à l'étape 1).

## 4. Mettre à jour la doc

Si le périmètre change : mettre à jour `CLAUDE.md`, le(s) skill(s) de domaine concerné(s), la légende `index.html` et les indices du HUD (`refresh` dans `render/app.js`).

## 5. Résumer

Lister : fichiers modifiés, tests ajoutés/mis à jour, résultat de `npm test`.
