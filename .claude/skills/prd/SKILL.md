---
name: prd
description: Use when writing a specification (PRD) for a game feature before implementing — explore the code, ask only product decisions, produce a fixed-format doc. Does NOT implement.
auto_invoke: false
user_invocable: true
---

# Workflow : rédiger un PRD (spécification)

**N'implémente rien.** Ce workflow produit un document de spécification.

## 1. Explorer l'existant technique

Lire le code réel pour remplir la section « Existant technique » : modules `src/` concernés, fonctions et constantes touchées, événements du bus impliqués, tests existants. S'appuyer sur le skill `architecture`.

## 2. Poser uniquement les décisions produit

Poser des questions **cliquables** portant sur les choix de conception (pas sur la technique) : équilibrage/valeurs, comportement attendu au combat/mouvement, cas limites à couvrir ou à exclure, condition de victoire impactée. Ne pas demander de valider l'implémentation.

## 3. Rédiger le PRD (format fixe)

```
# PRD — <titre>

## Objectif
<une à trois phrases>

## Existant technique
<modules, fonctions, constantes, événements et tests concernés — issus de l'exploration>

## Comportement
<règle(s) attendue(s), pas à pas, avec les valeurs numériques décidées>

## Hors-scope
<ce qui n'est explicitement pas traité>

## Impacts par couche
- src/ : <modules et fonctions à créer/modifier>
- render/ : <affichage, HUD, événements à consommer>
- config : <constantes>
- doc : <CLAUDE.md / skills / légende à mettre à jour>

## Critères d'acceptation
<liste vérifiable de comportements observables>

## Tests
<tests macro à ajouter : fichier, scénario, RNG fixé si combat>

## Risques & questions ouvertes
<points non tranchés, dépendances risquées>
```

Le PRD est prêt à être exécuté ensuite via le skill `feature`.
