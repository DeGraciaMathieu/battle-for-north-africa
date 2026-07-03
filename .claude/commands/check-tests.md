# /check-tests

Analyse la couverture de tests, **propose** les tests macro manquants, **attend validation** avant de les écrire, puis relance la suite.

## Procédure

1. **Lire `CLAUDE.md`** et le skill `testing` (philosophie macro, mapping fichier → périmètre).
2. **Récupérer le périmètre** : `git diff`, `git diff --cached`, `git status`, `git log --oneline -5`. **S'arrêter s'il n'y a rien.**
3. **Analyser la couverture** :
   - Pour chaque règle `src/` touchée, vérifier qu'un test macro existe dans `test/<module>.test.js`.
   - Repérer les comportements observables non couverts (cas limites : unité réduite, hors ravitaillement, empilement plein, arrêt en ZOC, avance après combat).
   - Lancer `npm test` pour l'état actuel.
4. **Proposer** (sans écrire) la liste des tests manquants : pour chacun, fichier cible, scénario fonctionnel, et RNG à fixer si combat.
5. **Attendre ma validation** sur la liste.
6. Après validation : écrire les tests validés, puis relancer `npm test` jusqu'au vert.

## Format de la proposition

```
## Couverture — <n> fichiers touchés
Existant : <tests couvrant le périmètre>
Manquant (proposé) :
- test/<module>.test.js — « <scénario fonctionnel> » (rng: () => <k> si combat)
- ...
Tests actuels : <sortie npm test>

> En attente de validation avant écriture.
```
