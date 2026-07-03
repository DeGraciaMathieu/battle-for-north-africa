# /check-conventions

Vérification allégée : conventions + cohérence tests/doc + tests. Version rapide de `/review`.

## Procédure

1. **Lire `CLAUDE.md`**.
2. **Récupérer le périmètre** : `git diff`, `git diff --cached`, `git status`, `git log --oneline -5`. **S'arrêter s'il n'y a rien.**
3. **Vérifier point par point** (grille ci-dessous).
4. **Lancer les tests** : `npm test`.
5. **Rapport** : statut `OK` / `VIOLATION` / `N/A` par item + verdict global.

## Grille

### Conventions
- Séparation des couches : aucune règle dans `render/`, aucun `document`/`PIXI` dans `src/`.
- Effet de rendu déclenché par une règle → via événement (`state.bus.emit`).
- État explicite en argument ; aléa via `state.rng`.
- Coordonnées axiales + `key(q,r)` ; nommage (`eAtk`/`eDef`/`eMov`, préfixe `r*`).
- Français ; pas d'imports/constantes/CSS inutilisés ni de lignes vides superflues.

### Cohérence tests / doc
- Nouvelle règle `src/` → test macro présent dans `test/<module>.test.js`.
- Changement de périmètre → `CLAUDE.md` / skill de domaine / légende `index.html` mis à jour.
- `npm test` au vert.

## Format du rapport

```
## Check conventions — <n> fichiers
- [OK|VIOLATION|N/A] <item> — <fichier:ligne>
...
Tests : <sortie npm test>
Verdict global : <CONFORME | À CORRIGER — n violation(s)>
```
