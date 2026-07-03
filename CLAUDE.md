# Battle for North Africa

Wargame hexagonal opérationnel (« Desert War ») : combat au tour par tour sur une carte hexagonale du désert nord-africain, opposant l'Axe (Afrikakorps) aux Alliés (8th Army).

## Stack

- **JavaScript ES modules** (ES2022), sans build ni bundler.
- **PixiJS v8.13.2** pour le rendu, chargé par CDN (`window.PIXI`) — uniquement dans la couche de rendu.
- **node --test** pour les tests (runner intégré à Node, zéro dépendance).
- **ESLint 9** (flat config) + **Prettier** pour le lint/format.

Commandes :
- `npm run dev` — sert le projet en local (`npx serve .`) ; ouvrir `index.html`. Un serveur HTTP est nécessaire : les ES modules ne se chargent pas en `file://`.
- `npm test` — lance la suite de tests (`node --test test/*.test.js`).
- `npm run lint` — ESLint. `npm run format` — Prettier.

## Architecture

Deux couches, strictement séparées :

- **`src/` = règles de jeu, agnostiques du rendu.** Ne touchent JAMAIS au DOM ni à PixiJS. Opèrent sur un objet d'état (`state`) et publient des événements sur `state.bus`. C'est la seule couche testée.
- **`render/app.js` = rendu & interaction.** Importe les règles depuis `src/`, lit l'état, s'abonne au bus. Ne contient AUCUNE règle de jeu.

L'état de partie est créé par `createGame()` (`src/game.js`) : `{ terrain, hexes, objectives, objControl, units, G, bus, rng }`.

Voir le skill `architecture` pour la carte module → rôle et « où placer du nouveau code ».

## Conventions de code

- **Séparation des couches, non négociable** : aucune règle dans `render/`, aucun `document`/`PIXI` dans `src/`. Une règle qui doit provoquer un effet visuel **émet un événement** (`state.bus.emit(...)`), elle n'appelle pas le rendu.
- **État explicite** : les fonctions de règle prennent `state` (ou `units`, `terrain`) en argument. Pas d'état global de module — tout vit dans l'objet `state`.
- **Fonctions pures pour la géométrie** (`src/geometry.js`) : aucune dépendance à l'état.
- **Déterminisme testable** : tout aléa passe par `state.rng` (jamais `Math.random` en dur dans une règle), pour permettre l'injection d'un RNG dans les tests.
- **Coordonnées axiales** `(q, r)` partout ; sérialisées par `key(q, r)` → `"q,r"`.
- **Nommage** : `eAtk`/`eDef`/`eMov` = facteurs *effectifs* ; préfixe `r*` = face réduite (verso). `zocOf`, `computeReachable`, `resolveCombat`, `suppliedHexes` — verbes explicites du domaine.
- **Français** pour l'UI, les commentaires et la terminologie (PM, ZOC, CRT, recto/verso, ravitaillement, palier, décalage de colonne, armes combinées).
- Après édition, nettoyer imports/constantes/CSS inutilisés et lignes vides superflues.

## Conventions de domaine (wargame)

- **PM** = points de mouvement ; le terrain a un coût (`TERRAIN[t].cost`) et un décalage défensif (`.def`).
- **ZOC** = zone de contrôle : les 6 hexes autour de chaque unité ; entrer dans une ZOC ennemie stoppe le mouvement.
- **Recto/verso** : un pion encaisse un palier (`reduced = true`) avant d'être éliminé.
- **Ravitaillement** : flood-fill depuis les sources (ports tenus + bord ami) ; hors ravito, défense et mouvement ÷2.
- **CRT** : la colonne finale = odds ± décalages (terrain, armes combinées, artillerie), le dé (1-6) donne le résultat (AE/AR/EX/DR/DE).

## Comportement (process)

- **Ne jamais déclarer une tâche terminée sans avoir lancé `npm test` et vérifié que la suite passe.**
- Privilégier des **tests macro** (comportement fonctionnel : « une ZOC coupe le ravitaillement », « un échange réduit les deux camps ») plutôt que des tests de détails d'implémentation.
- **Si une approche échoue après 2 tentatives, reprendre le plan** (invoquer `architecture`) avant de continuer.
- Implémenter uniquement ce qui est demandé ; ne pas ajouter de features/métriques/visualisations non requises.

## Skills disponibles

- `architecture` — carte du projet et où placer du nouveau code.
- `geometrie-carte` — grille hexagonale, terrain, objectifs.
- `unites-facteurs` — modèle de pion, paliers recto/verso, facteurs effectifs.
- `mouvement-zoc` — portée (Dijkstra), zones de contrôle.
- `combat-crt` — table de combat, résolution, recul/avance.
- `ravitaillement` — propagation du ravitaillement (flood-fill).
- `sequence-jeu` — séquence IGO-UGO, objectifs, victoire.
- `testing` — commande de test, philosophie, mapping fichier → périmètre.
- `feature` — workflow d'implémentation d'une fonctionnalité.
- `prd` — rédaction d'un document de spécification (sans implémentation).
