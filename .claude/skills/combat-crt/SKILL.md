---
name: combat-crt
description: Use when working on combat — the CRT (combat results table), odds, column shifts (terrain, combined arms, artillery), retreats, or post-combat advance.
auto_invoke: true
---

# Combat & CRT

Résolution des combats dans `src/combat.js` ; table (`CRT`, `ODDS`) dans `src/config.js`.

## Concepts → implémentation

| Concept | Implémentation |
|---|---|
| Colonne d'odds (rapport de force) | `oddsIndex(atk, def)` → index dans `ODDS` |
| Table de résultats | `CRT[col][die-1]` (`src/config.js`) |
| Plan (avant le dé) | `combatPlan(state, attackers, defender)` → forces, décalages, `baseCol`, `col` — **aucune mutation, aucun jet** ; sert à l'aperçu « Lancer les dés / Refuser le combat » |
| Résolution complète | `resolveCombat(state, attackers, defender)` → `{ col, die, res }` (appelle `combatPlan`, tire le dé, applique) |
| Flux UI (rendu) | clic sur l'ennemi → `showCombatPreview` (stats + colonne + issues possibles, décision **Lancer / Refuser**) ; « Lancer » → `resolveCombat` → événement `combatResolved` (payload : forces, `baseCol`, `col`, modificateurs, `die`, `res`, `effects`) → `showCombatModal` animée (dé, CRT surlignée, conséquences) |
| Jet de dé | `1 + Math.floor(state.rng() * 6)` — **toujours via `state.rng`** |
| Réduction / élimination | `hitUnit(state, u)` (émet `unitReduced`/`unitRemoved`) |
| Recul | `retreatOrDie(state, unit, awayQ, awayR)` via `retreatOptions` |
| Résultats CRT | `AE` att. éliminé, `AR` att. repoussé, `EX` échange, `DR` déf. repoussé, `DE` déf. éliminé |

## Décalages de colonne (appliqués dans `resolveCombat`)

`idx = clamp(oddsIndex(atk, eDef) + combined + arty − terr, 0, 7)`

- **Terrain** (`−terr`) : `TERRAIN[hex].def` retiré à l'attaquant.
- **Armes combinées** (`+1`) : au moins un `isArmor` **et** un `isFoot` dans la pile.
- **Artillerie** (`+1` chacune, max `+2`) : pièces `arty` amies, ravitaillées, hors pile, à `≤ ARTY_RANGE` (3) du défenseur.

## Effets des résultats

- `DE` → `hitUnit(defender)` (1 palier). `DR` → recul. `EX` → défenseur réduit + attaquants réduits jusqu'à couvrir `eDef(defender)`. `AR` → attaquants reculent. `AE` → attaquants réduits.
- **Avance après combat** : si `DE`/`DR` libère l'hex du défenseur, l'attaquant adjacent le plus fort y entre (si l'empilement le permet).

## Points d'attention

- Les pertes **mutent l'état et émettent des événements** — elles n'appellent jamais le rendu. `removeUnit` réaffecte `state.units` : toujours lire `state.units` (frais) après une perte, pas une copie capturée.
- L'aléa passe par `state.rng` → tests déterministes en injectant un RNG.

## Ajouter un modificateur de combat

1. Nouvelle colonne / résultat : `ODDS` / `CRT` dans `src/config.js`.
2. Nouveau décalage : l'intégrer au calcul de `idx` dans `resolveCombat`, l'ajouter au tableau `mods` (message de journal) et lui donner sa ligne explicative dans `combatCalcHtml` (`render/html.js`).
3. Test macro dans `test/combat.test.js` avec `rng: () => k` pour fixer le dé.
