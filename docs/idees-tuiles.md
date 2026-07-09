# Idées de tuiles / terrains — backlog de conception

Pistes pour enrichir la variété et l'intérêt tactique des cartes. Classées par
**coût d'implémentation**, du plus simple au plus structurant.

Rappel du modèle actuel : le terrain est stocké **par hexe** (`terrain: {"q,r": type}`),
et chaque type porte `{ cost (PM), def (décalage de colonne), supply? }`. Les règles
(`movement.js`, `combat.js`, `supply.js`) consomment ces champs génériquement — donc
toute tuile qui n'a besoin que d'un couple `cost`/`def`/`supply` s'ajoute sans toucher
au cœur (comme l'ont été **montagne**, **marais**, **plateau**).

Terrains existants : `river` (∞), `bank` (2), `marsh` (3, −1), `plain`/`plain2` (1),
`plateau` (1, +1), `hill` (3, +2), `mountain` (4, +3), `forest` (2, +1), `road` (½, −1),
`depot`/`dump` (1), `urban` (1, +2), `base`.

---

## 1. Tuiles « gratuites » (aucune mécanique nouvelle)

Il suffit d'ajouter l'entrée dans `TERRAIN` (config.js), un rendu (aplat/teinte + décor
dans `render/app.js`), une entrée de légende (`game.html`, `regles.html`) et éventuellement
une génération thématique (`tools/gen-maps.js`).

**✅ Livrées** (config + rendu + légende + règles + éditeur + tests) : désert, dunes,
oasis, rocaille (`rough`), ruines, neige (`snow`), oued (`wadi`). L'oasis est branchée
comme relais de ravitaillement (tenue → source, portée 4), donc a nécessité un petit
ajout dans `game.js`/`supply.js` au-delà du simple `def`.

| Tuile | Coût PM | Déf | Rôle / intérêt | État |
|---|---|---|---|---|
| **Désert / sable** | 1 | 0 | Biome North Africa (le repo s'appelle `north-africa` et n'avait **aucune** tuile désertique) — plaine aride. | ✅ |
| **Dunes** | 2 | 0 | Relief mou du désert : ralentit sans protéger. | ✅ |
| **Oasis / point d'eau** | 1 | +1 | Source de ravito au désert (`supply` 4, tenue), objectif naturel. | ✅ |
| **Rocaille / terrain accidenté** (`rough`) | 2 | +1 | Comble le trou entre bois (2, +1) et coteau (3, +2) sans être un vrai relief. | ✅ |
| **Ruines** | 1 | +2 | Comme l'urbain mais isolé (villages rasés) — thème Forteresse / après-bataille. | ✅ |
| **Neige / boue** (`snow`) | 2 | 0 | Variantes saisonnières d'une même carte (ralentissement général). | ✅ |
| **Oued / lit asséché** (`wadi`) | 2 | +1 | Ravin praticable qui canalise le mouvement. | ✅ |
| **Falaise terrestre infranchissable** | ∞ | — | Mur de canyon **sans eau** : canalise comme une rivière, en plein désert/montagne. Trivial côté data (cost ∞), juste un rendu dédié. | ⬜ à faire |

> Reste dans ce lot : **falaise terrestre**. Ensuite, cartes thématiques exploitant le
> désert (Le Désert, Le Canyon, La Ligne fortifiée).

---

## 2. Tuiles à mécanique légère

Un petit ajout de règle, mais localisé.

- **Retranchement / redoute** — `def` élevé, *man-made*. Indispensable pour le
  Débarquement (mur de l'Atlantique) et les lignes défensives. Simple si c'est juste
  un gros `def` posé à la génération ; plus riche si le joueur peut **se retrancher**
  (poser du `def` sur son hexe en dépensant une action).
- **Champ de mines / obstacle** — inflige un palier (recto→verso) ou stoppe net à
  l'entrée. Nouvelle règle d'entrée d'hexe dans `movement.js`.
- **Pont destructible** — chokepoint dynamique : un camp peut le faire sauter
  (route → rivière). Demande un état mutable + une action de jeu.

---

## 3. Le grand levier : features de *bord d'hexe* (hexside)

Aujourd'hui une rivière est un **hexe entier** infranchissable → barrière binaire. Les
wargames hexagonaux « intéressants » portent des features sur les **arêtes** :

- **rivière de bord** : terre des deux côtés, mais franchir l'arête coûte +PM et/ou
  décale la défense (au lieu de noyer un hexe) → vraie ligne à défendre ;
- **falaise / escarpement d'arête** : infranchissable sur *un seul* côté → canalise
  sans eau ;
- **route de bord** : la route suit les arêtes plutôt que le centre.

**Impact** : transforme la nature même des cartes (lignes de front fluviales, crêtes,
défilés). **Coût** : structurant — nouveau champ `edges` dans le format de carte +
gestion dans `movement.js`/`combat.js` + rendu des arêtes. C'est le chantier n°1 pour
passer d'un « bon » jeu de terrain à un vrai jeu opérationnel.

---

## 4. Objectifs fonctionnels (règles de scénario)

Au-delà du terrain « passif » :

- **Port** — objectif qui, tenu, fournit un ravitaillement maritime / des renforts.
- **Aérodrome** — objectif qui débloque un appui aérien ou des renforts.
- **Blocage de ligne de vue (LOS)** pour l'artillerie — bois et relief coupent l'appui
  d'artillerie (nouvelle règle dans `combat.js`), rendant le relief tactiquement décisif
  au-delà du simple `def`.

---

## Cartes que ces tuiles débloqueraient

- **Le Désert** / **L'Erg** — sable, dunes, oasis-objectifs, quelques wadis.
- **Le Canyon** — falaises terrestres infranchissables canalisant vers 2-3 goulots.
- **La Ligne fortifiée** — bande de retranchements + champs de mines à percer.
- **La Rivière contestée** — vraie ligne de front fluviale (features d'arête).
- **L'Hiver** — variante neige/boue d'une carte existante.
