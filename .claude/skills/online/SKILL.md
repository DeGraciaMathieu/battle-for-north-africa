---
name: online
description: Use when working on the two-player online mode — lockstep determinism, the P2P transport (net.js), the lobby, or turn locking.
auto_invoke: true
---

# Mode en ligne (lockstep P2P)

Partie 2 joueurs par navigateurs interposés. Transport dans `render/net.js` (PeerJS/WebRTC), orchestration dans `render/app.js`. **Aucune règle** dans `net.js`, **aucun état** transmis : seul le principe lockstep synchronise les deux écrans.

## Principe lockstep

Les deux clients construisent un état **strictement identique** (même `seed`, même `mapParam`, même composition, même `rngSeed`) puis ne s'échangent que l'**intention** des actions. Chaque client rejoue le même code de règle → mêmes conséquences. La seule source d'aléa du moteur est le dé de combat, tiré via `state.rng` : semé à l'identique (`mulberry32(rngSeed)`), il donne le même résultat des deux côtés **sans transmettre l'issue**.

> Invariant non négociable : tout aléa de règle passe par `state.rng`. Un seul `Math.random` en dur dans une règle, ou un tirage `state.rng` fait d'un côté et pas de l'autre, **désynchronise définitivement** la partie.

## Concepts → implémentation

| Concept | Implémentation |
|---|---|
| PRNG déterministe | `mulberry32(seed)` (`render/net.js`) — reproductible d'un client à l'autre |
| Code d'invitation | `makeCode()` — 6 caractères non ambigus ; `Math.random` OK ici (hors règles) |
| Transport hôte | `createHost(code, handlers)` — réserve l'ID `bfna-<code>` sur le broker, une seule connexion |
| Transport invité | `joinHost(code, handlers)` — rejoint l'hôte |
| Rôles | `?net=host` (joue **Bleu**/`axis`) / `?net=guest&code=…` (joue **Rouge**/`ally`) / absent = solo |
| Descriptif de partie | hôte → guest : `{ t:'desc', seed, fair, mapParam, b, r, rngSeed }` (le guest en dérive un état identique) |
| Verrou de tour | `myTurn()` (`app.js`) — en ligne, on n'agit que si `state.G.player === localSide` et liaison intacte |
| Émission d'intention | `netSend({ … })` après chaque action locale (move / combat / phase) |
| Rejeu d'intention | `onGameMsg(m)` — applique l'action distante en rejouant le même code de règle |
| Lobby / statuts | `showLobby` / `setLobbyStatus` / `lobbyError` (DOM, dans `app.js`) |
| Perte de liaison | `onPeerLost` → `netLost`, `lobbyError` |

## Protocole de messages

Canal WebRTC **fiable et ordonné** (`reliable: true`) — condition du lockstep (les intentions arrivent dans l'ordre).

| Message | Émis quand | Rejeu côté distant |
|---|---|---|
| `{ t:'hello' }` | guest connecté | hôte répond `desc` |
| `{ t:'desc', … }` | hôte, à la réception de `hello` | guest construit son état |
| `{ t:'move', id, to }` | après `moveUnit` local | recalcule `computeReachable(state, u)` **localement** puis `moveUnit` — on ne transmet pas le chemin |
| `{ t:'combat', atk:[ids], def }` | après `resolveCombat` local | `remoteCombat` (preview spectateur + `resolveCombat`, même dé via RNG semé) |
| `{ t:'phase' }` | après `endPhase` local | `endPhase(state)` |

Les messages de jeu reçus avant la fin de l'init sont différés (`netQueue`) puis rejoués une fois `onGameMsg` prêt.

## Pièges (déjà rencontrés)

- **`Math.random` cosmétique du dé** (`app.js`, `runRoll`) : l'animation de la colonne qui « tourne » utilise `Math.random`, mais elle ne touche ni `state.rng` ni l'état → **pas** une source de désync. Le résultat affiché reste `p.die` (issu du RNG semé). Ne pas confondre avec un aléa de règle.
- **Carte nommée non chargée côté guest** : si l'hôte a chargé `maps/<mapParam>.json` mais que le fetch du guest échoue, `loadMapData` retombe en silence sur la génération par seed → carte différente → **désync silencieuse**. Toute divergence dans les entrées de `createGame` casse le lockstep.
- **Mouvement distant non validé** : le rejeu applique `moveUnit(u, m.to, …)` sans vérifier l'atteignabilité ; sûr uniquement tant que les états sont identiques.

## Déterminisme testé

`test/online.test.js` (n'importe que `mulberry32` et les règles publiques, jamais le DOM) :
- `mulberry32` : même graine → même suite, graines différentes → suites différentes, valeurs dans `[0,1)` ;
- deux parties jumelles (`twinGame(seed)`) pilotées par la même séquence de combats restent synchronisées (comparaison d'instantanés positions/faces).

En ajoutant une action réseau, garde le rejeu **symétrique** : l'auteur et le distant doivent consommer exactement les mêmes tirages `state.rng`, dans le même ordre.
