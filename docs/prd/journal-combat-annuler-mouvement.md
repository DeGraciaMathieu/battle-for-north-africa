# PRD — Journal de combat + Annuler le dernier mouvement

Deux conforts de jeu regroupés : un **journal de combat** persistant et détaillé, et l'**annulation** du dernier mouvement dans la phase en cours (y compris en ligne).

---

## Partie A — Journal de combat

### Objectif

Remplacer le mini-log éphémère (8 lignes, one-liner) par un **journal consultable** listant chaque combat avec son détail (forces, colonne, décalages, dé, résultat, pertes), pour comprendre *pourquoi* un combat a tourné ainsi.

### Existant technique

- **`src/combat.js`** : `resolveCombat` construit un `summary = { ...plan, die, res, result, effects }` très riche (`effects` = lignes narrées des pertes/reculs/avances) et émet `bus.emit('combatResolved', summary)` **et** `bus.emit('log', '<b>col</b>(mods), dé N → résultat')`.
- **`src/events.js`** : événements `combatResolved` et `log` documentés.
- **`render/app.js`** :
  - `log(s)` (ligne ~979) : garde `logLines` (max 8, unshift), rend dans `#logBody`.
  - `state.bus.on('log', log)` (ligne ~1192) ; `state.bus.on('combatResolved', runRoll)` (ligne ~1197) déclenche déjà l'animation du dé — le `summary` complet est donc **déjà disponible** côté rendu mais non archivé.

### Comportement

1. Un panneau **Journal** (repliable) archive une entrée par combat, du plus récent au plus ancien, **sans limite de 8** (historique complet de la partie, scrollable).
2. Chaque entrée est bâtie depuis le `summary` de `combatResolved` :
   - En-tête : `col` finale (+ décalages : combiné/artillerie/terrain), `die`, `result` (libellé FR).
   - Détail attaquants (`breakdown` : nom, atk, réduit) et défenseur (`defender`, `def`, réduit, ravitaillé).
   - **Pertes** : les lignes de `effects` (« X est réduit », « Y recule d'un hexe », « Z avance sur la position conquise »).
3. Séparateurs de **tour/phase** dans le journal (consommer `phaseChanged` pour insérer un marqueur « Tour N — camp »).
4. Le mini-log actuel peut rester comme fil condensé, ou être fusionné dans le journal (au choix d'implémentation ; garder au moins un fil visible sans ouvrir le panneau).

### Hors-scope

- Pas d'export du journal (fichier/presse-papier).
- Pas de rejeu/scrub temporel d'un combat passé.
- Pas de modification des règles ni des événements émis (le `summary` existant suffit).

### Impacts par couche

- **src/** : aucun (les données nécessaires sont déjà émises). Au plus, documenter que `combatResolved.effects` est la source du détail.
- **render/** : `app.js` — archiver les `summary` dans un tableau non borné, rendre le panneau Journal (entrée détaillée + marqueurs de phase via `phaseChanged`). `index.html` + CSS : panneau repliable + styles d'entrée.
- **config** : aucune.
- **doc** : skill `combat-crt` (mentionner que le journal expose `summary`/`effects`) ; légende UI.

### Critères d'acceptation

- Après plusieurs combats, le journal liste **toutes** les entrées (pas de troncature à 8), scrollables.
- Chaque entrée montre colonne + décalages, dé, résultat **et** les pertes réelles.
- Des marqueurs de tour/phase segmentent le journal.
- Aucun changement de comportement des règles ; `npm test` reste vert.

### Tests

- Couche non testée (rendu). Vérification manuelle. Le contrat testé côté règles (`combatResolved` porte `effects`) est déjà couvert par les tests de combat existants ; ajouter au besoin une assertion dans `test/combat.test.js` que `summary.effects` est non vide après une perte.

---

## Partie B — Annuler le dernier mouvement (solo, hotseat **et** en ligne)

### Objectif

Permettre au joueur actif d'**annuler le dernier déplacement** effectué pendant sa phase de mouvement, tant que la phase n'est pas terminée. Fonctionne aussi en ligne via un message d'annulation ajouté au protocole lockstep.

### Existant technique

- **`src/movement.js`** : `moveUnit(unit, targetKey, dist, eZOC)` mute `unit.q/r/mpLeft` et met `mpLeft = 0` si arrivée en ZOC ennemie. **Aucune trace du point de départ** n'est conservée aujourd'hui.
- **`render/app.js`** :
  - `confirmMove()` (ligne ~713) : `moveUnit(...)` puis `netSend({ t: 'move', id, to })`, recalcule `sel`, `refresh()`.
  - Boucle IA (ligne ~1248) et **rejeu distant** (`onGameMsg`, ligne ~1279) appliquent les mouvements par `computeReachable` + `moveUnit` — donc **les deux pairs appliquent la même séquence de mouvements dans le même ordre** (lockstep).
  - `clearSel` / `pending` gèrent la sélection ; `endPhase` clôt la phase.
- **`render/net.js`** : transport pur, messages actuels `{t:'move'|'combat'|'phase'}`. Le rejeu distant recalcule tout (aucun état transmis).

### Comportement

1. **Pile d'annulation par phase** : maintenir, côté rendu, une pile `moveHistory` d'entrées `{ id, q, r, mpLeft }` capturées **avant** chaque `moveUnit` (au moment de `confirmMove`, de la boucle IA **non** — voir plus bas, et du rejeu distant). Vidée à chaque `phaseChanged`.
2. **Annuler** (bouton « Annuler », actif seulement en phase de mouvement du camp local et si la pile n'est pas vide) : dépile la dernière entrée et **restaure** `unit.q/r/mpLeft` à l'identique (y compris le `mpLeft` d'avant l'éventuelle mise à 0 par ZOC). Recalcule `sel`, `refresh()`.
3. **En ligne** : un `Annuler` local envoie `netSend({ t: 'undo' })`. À réception, le pair **dépile sa propre pile identique** et restaure de la même façon. Comme les deux pairs ont appliqué la même séquence de mouvements, leurs piles sont identiques → l'annulation est déterministe sans transmettre d'état.
4. **Bornes** :
   - On ne peut annuler que **ses propres** mouvements, **pendant sa phase de mouvement**, avant `endPhase`.
   - Une fois la phase terminée (bouton phase / combat engagé), la pile est vidée : plus d'annulation rétroactive.
   - Les mouvements de l'**IA** ne sont pas empilés côté annulation (l'humain n'annule pas les coups de l'IA) — l'IA joue toute sa phase d'un bloc.
5. **Sélection** : après annulation, l'unité restaurée redevient sélectionnable avec sa portée recalculée.

### Hors-scope

- Pas de « refaire » (redo).
- Pas d'annulation d'un combat déjà résolu (irréversible : dé tiré, pertes appliquées).
- Pas d'annulation après changement de phase.
- Pas d'annulation des mouvements de l'IA.

### Impacts par couche

- **src/** : aucun changement de règle nécessaire. L'annulation restaure des champs simples (`q/r/mpLeft`) déjà publics sur l'unité — logique portée par le rendu. (Option : un helper pur `restoreUnit(unit, snapshot)` dans `movement.js` si on veut le tester ; sinon inline côté rendu.)
- **render/** :
  - `app.js` : pile `moveHistory` (snapshot avant chaque `moveUnit` de `confirmMove` **et** du rejeu distant), bouton « Annuler », gestion `{t:'undo'}` dans `onGameMsg`, vidage sur `phaseChanged`.
  - `index.html` : bouton « Annuler » dans la barre d'action (près du bouton de phase).
- **net** : nouveau message `{ t: 'undo' }` (transport inchangé, `net.js` reste agnostique).
- **doc** : skill `online` (ajouter `undo` au protocole lockstep et expliquer le déterminisme des piles) ; skill `mouvement-zoc` (mention de l'annulation locale) ; mémoire `mode-en-ligne-lockstep` si le protocole y est listé.

### Critères d'acceptation

- En solo/hotseat : après un déplacement, « Annuler » ramène l'unité à sa case et ses PM d'origine (y compris si elle s'était arrêtée en ZOC).
- Annulations multiples : dépile dans l'ordre inverse jusqu'à vider la pile.
- « Annuler » est **inactif** hors phase de mouvement du camp local et quand la pile est vide.
- Après `endPhase`, l'annulation n'est plus possible (pile vidée).
- En ligne : un `Annuler` chez un joueur restaure **le même état** chez l'autre (piles identiques) — aucune désync ; une passe de partie complète move→undo→move→combat reste synchronisée des deux côtés.
- `npm test` vert.

### Tests

- Si un helper `restoreUnit`/snapshot est extrait dans `src/movement.js` : `test/movement.test.js` — déplacer une unité (dont un cas d'arrêt en ZOC qui met `mpLeft=0`), capturer le snapshot avant, restaurer, vérifier `q/r/mpLeft` identiques à l'origine.
- Le rejeu distant et le message `{t:'undo'}` relèvent du rendu (non testé) : vérification manuelle en ouvrant deux fenêtres (déplacer, annuler des deux côtés, confirmer la synchro).

## Risques & questions ouvertes

- **Déterminisme des piles en ligne** : l'égalité des piles repose sur l'application identique et ordonnée des mouvements par les deux pairs (déjà le cas). Bien vérifier que **tout** mouvement (local *et* distant) pousse un snapshot au même endroit, sinon les piles divergent.
- **Question ouverte (défaut proposé)** : le journal remplace-t-il le mini-log ou coexiste-t-il ? Défaut : **coexistence** (fil condensé toujours visible + panneau Journal détaillé repliable).
- Timing du vidage de pile : s'assurer que `phaseChanged` vide bien la pile avant que l'adversaire/IA ne joue.
