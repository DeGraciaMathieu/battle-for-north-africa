// ===========================================================================
//  Constantes de jeu — agnostiques du rendu.
//  Ces valeurs pilotent la géométrie, le terrain, les unités et la table de
//  combat (CRT). Elles sont importées par les modules de règles ET par le rendu.
// ===========================================================================

export const SIZE = 46;          // rayon d'un hex en pixels (rendu + géométrie)
export const COLS = 30;          // largeur de la carte en colonnes offset
export const ROWS = 20;          // hauteur de la carte en lignes offset
export const SQRT3 = Math.sqrt(3);
export const STACK_MAX = 3;      // limite d'empilement par hex et par camp
export const MAX_TURNS = 10;     // durée de la partie (objectifs comptés à la fin)
export const ARTY_RANGE = 5;     // portée d'appui de l'artillerie (en hex)
export const SUPPLY_RANGE = 8;   // longueur max d'une route de ravitaillement (hexes)

// Camp de base : hexe source du ravitaillement de chaque camp (col, row offset).
// Bleu (blue, joueur 1) démarre en bas-gauche, Rouge (red) en haut-droite.
export const BASES = { blue: [1, ROWS - 3], red: [COLS - 2, 2] };

// Voisinage axial (6 directions).
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Terrain : couleur (fill/stroke), coût de mouvement (PM) et décalage défensif
// (nombre de colonnes retirées à l'attaquant sur la CRT).
export const TERRAIN = {
  river:   { name: 'Rivière',      fill: 0x336d94, stroke: 0x1f4c6e, cost: Infinity, def: 0 },
  bank:    { name: 'Berge',        fill: 0x77aec2, stroke: 0x437a92, cost: 2, def: 0 },
  beach:   { name: 'Plage',        fill: 0xe8d7a0, stroke: 0xc0a86e, cost: 2, def: -1 },
  marsh:   { name: 'Marais',       fill: 0x4b5540, stroke: 0x333c2a, cost: 3, def: -1 },
  wadi:    { name: 'Oued',         fill: 0xac9866, stroke: 0x6f5f38, cost: 2, def: 1 },
  plain:   { name: 'Plaine',       fill: 0x93b957, stroke: 0x67863a, cost: 1, def: 0 },
  plain2:  { name: 'Plaine',       fill: 0xaacb69, stroke: 0x67863a, cost: 1, def: 0 },
  desert:  { name: 'Désert',       fill: 0xd9c48f, stroke: 0xa8935f, cost: 1, def: 0 },
  dunes:   { name: 'Dunes',        fill: 0xc9b06f, stroke: 0x93783f, cost: 2, def: 0 },
  oasis:   { name: 'Oasis',        fill: 0x3f8f5a, stroke: 0x27633b, cost: 1, def: 1, supply: 4 },
  snow:    { name: 'Neige',        fill: 0xdfe4ea, stroke: 0xa8b0b8, cost: 2, def: 0 },
  plateau: { name: 'Plateau',      fill: 0x676c5b, stroke: 0x454a3a, cost: 1, def: 1 },
  rough:   { name: 'Rocaille',     fill: 0x8a8274, stroke: 0x5c554a, cost: 2, def: 1 },
  hill:    { name: 'Coteau',       fill: 0x7c7a6c, stroke: 0x4f4d42, cost: 3, def: 2 },
  mountain:{ name: 'Montagne',     fill: 0x888890, stroke: 0x56565e, cost: 4, def: 3 },
  depot:   { name: 'Grand dépôt',  fill: 0xbaa971, stroke: 0x7a6a3f, cost: 1, def: 0, supply: 6 },
  dump:    { name: 'Petit dépôt',  fill: 0xa8977a, stroke: 0x6e6042, cost: 1, def: 0, supply: 4 },
  urban:   { name: 'Zone urbaine', fill: 0xc4c3bd, stroke: 0x94938e, cost: 1, def: 2 },
  ruins:   { name: 'Ruines',       fill: 0x8f8a86, stroke: 0x585450, cost: 1, def: 2 },
  forest:  { name: 'Bois',         fill: 0x468236, stroke: 0x2c5622, cost: 2, def: 1 },
  road:    { name: 'Route',        fill: 0xc2ab7a, stroke: 0x8a7550, cost: 0.5, def: -1 },
  base:    { name: 'Camp de base', fill: 0x5c7649, stroke: 0x33422a, cost: 1, def: 0, supply: SUPPLY_RANGE },
};

// Table de résolution des combats (CRT) indexée par rapport de force (ODDS).
export const ODDS = ['1:3', '1:2', '1:1', '2:1', '3:1', '4:1', '5:1', '6:1'];
export const CRT = { //  dé:  1     2     3     4     5     6
  '1:3': ['AE', 'AE', 'AR', 'AR', 'EX', 'DR'],
  '1:2': ['AE', 'AR', 'AR', 'EX', 'DR', 'DR'],
  '1:1': ['AR', 'AR', 'EX', 'DR', 'DR', 'DE'],
  '2:1': ['AR', 'EX', 'DR', 'DR', 'DE', 'DE'],
  '3:1': ['EX', 'DR', 'DR', 'DE', 'DE', 'DE'],
  '4:1': ['DR', 'DR', 'DE', 'DE', 'DE', 'DE'],
  '5:1': ['DR', 'DE', 'DE', 'DE', 'DE', 'DE'],
  '6:1': ['DE', 'DE', 'DE', 'DE', 'DE', 'DE'],
};
export const RESULT_FR = {
  AE: 'Attaquant éliminé', AR: 'Attaquant repoussé', EX: 'Échange',
  DR: 'Défenseur repoussé', DE: 'Défenseur éliminé',
};

// Catalogue d'unités pour l'éditeur d'armée (point-buy) : facteurs recto/verso
// et coût en points. Partagé par la homepage et la construction des pions.
export const UNIT_CATALOG = {
  armor: { type: 'armor', label: 'Blindé',     abbr: 'BLD', cost: 5, atk: 8, def: 7, mov: 6, ratk: 5, rdef: 4, rmov: 5 },
  mech:  { type: 'mech',  label: 'Mécanisée',  abbr: 'MEC', cost: 4, atk: 6, def: 6, mov: 5, ratk: 4, rdef: 4, rmov: 4 },
  arty:  { type: 'arty',  label: 'Artillerie', abbr: 'ART', cost: 4, atk: 2, def: 3, mov: 3, ratk: 1, rdef: 2, rmov: 3 },
  inf:   { type: 'inf',   label: 'Infanterie', abbr: 'INF', cost: 3, atk: 6, def: 6, mov: 4, ratk: 4, rdef: 4, rmov: 3 },
};
export const CATALOG_ORDER = ['armor', 'mech', 'arty', 'inf']; // ordre d'encodage URL
export const ARMY_POINTS = 45;                                          // budget par camp
