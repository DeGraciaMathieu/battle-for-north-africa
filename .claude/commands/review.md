# /review

Revue complète des changements en cours. Rapport structuré, statut par item, verdict global.

## Procédure

1. **Lire `CLAUDE.md`** (conventions, séparation des couches, comportement attendu).
2. **Récupérer le périmètre** :
   - `git diff` (non indexé), `git diff --cached` (indexé), `git status`, `git log --oneline -5`.
   - **S'arrêter s'il n'y a rien à revoir** (aucun changement).
3. **Vérifier point par point** (voir grille).
4. **Lancer les tests** : `npm test`.
5. **Produire le rapport** : chaque item noté `OK` / `VIOLATION` / `N/A`, avec la référence `fichier:ligne`, puis un **verdict global**.

## Grille de revue

### Conventions
- Séparation des couches : aucune règle dans `render/` ; aucun `document`/`PIXI` dans `src/`.
- Effets de rendu déclenchés par une règle → via **événement** (`state.bus.emit`), pas d'appel direct au rendu.
- État explicite passé en argument (pas de global de module).
- Aléa via `state.rng` (jamais `Math.random` en dur dans une règle).
- Coordonnées axiales + `key(q,r)` ; nommage (`eAtk`/`eDef`/`eMov`, préfixe `r*`).
- Français (UI, commentaires). Pas d'imports/constantes/CSS inutilisés ni de lignes vides superflues.

### Couverture de tests
- Toute nouvelle règle `src/` a un test macro dans `test/<module>.test.js`.
- Combat testé avec RNG fixé.
- `npm test` au vert.

### Maintenabilité
- Couplage : la règle ne connaît pas le rendu ; dépendances de module cohérentes avec la carte du skill `architecture`.
- Responsabilité unique par fonction ; pas de duplication (réutiliser `zocOf`, `hexDistance`, helpers d'`units.js`).
- Complexité/longueur de fonction raisonnable ; nommage parlant ; **pas de magic values** (les seuils vont dans `src/config.js`).

### Cohérence système
- Intégration avec l'existant : impact vérifié sur ravitaillement, ZOC, séquence, victoire.
- Forme de l'état/données respectée (`state`, `units`, `objControl`, `G`).
- Respect des patterns (émission/abonnement au bus ; `startMove` appelle `updateSupply` avant les PM).

## Format du rapport

```
## Revue — <n> fichiers

### Conventions
- [OK|VIOLATION|N/A] <item> — <fichier:ligne / justification>
### Tests
- ...
### Maintenabilité
- ...
### Cohérence système
- ...

Tests : <sortie npm test>
Verdict global : <PRÊT | À CORRIGER — n violation(s)>
```
