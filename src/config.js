// ===========================================================================
//  Constantes de jeu — agnostiques du rendu.
//  Ces valeurs pilotent la géométrie, le terrain, les unités et la table de
//  combat (CRT). Elles sont importées par les modules de règles ET par le rendu.
// ===========================================================================

export const SIZE = 46;          // rayon d'un hex en pixels (rendu + géométrie)
export const COLS = 34;          // largeur de la carte en colonnes offset
export const ROWS = 22;          // hauteur de la carte en lignes offset
export const SQRT3 = Math.sqrt(3);
export const STACK_MAX = 3;      // limite d'empilement par hex et par camp
export const MAX_TURNS = 6;      // durée de la partie (objectifs comptés à la fin)
export const ARTY_RANGE = 3;     // portée d'appui de l'artillerie (en hex)
export const SUPPLY_RANGE = 14;  // longueur max d'une route de ravitaillement (hexes)

// Camp de base : hexe source du ravitaillement de chaque camp (col, row offset),
// posé en retrait de son bord de carte.
export const BASES = { axis: [1, 8], ally: [COLS - 2, 8] };

// Voisinage axial (6 directions).
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Terrain : couleur (fill/stroke), coût de mouvement (PM) et décalage défensif
// (nombre de colonnes retirées à l'attaquant sur la CRT).
export const TERRAIN = {
  sea:   { name: 'Méditerranée', fill: 0x35597f, stroke: 0x243f5c, cost: Infinity, def: 0 },
  coast: { name: 'Littoral',     fill: 0x6a97ab, stroke: 0x3f6f86, cost: 1, def: 0 },
  sand:  { name: 'Désert',       fill: 0x8faa5c, stroke: 0x67813f, cost: 1, def: 0 },
  sand2: { name: 'Désert',       fill: 0x9cb768, stroke: 0x67813f, cost: 1, def: 0 },
  rock:  { name: 'Rocaille',     fill: 0x8f8b7a, stroke: 0x605d4d, cost: 2, def: 2 },
  town:  { name: 'Ville/port',   fill: 0xa89a72, stroke: 0x726643, cost: 1, def: 2 },
  oasis: { name: 'Oasis',        fill: 0x4d7a3c, stroke: 0x335627, cost: 1, def: 1 },
  base:  { name: 'Camp de base', fill: 0x556a44, stroke: 0x2f3d24, cost: 1, def: 0 },
};

// Positions (colonne, ligne offset) des villes/ports — objectifs de la partie.
export const TOWNS = [[3, 2], [10, 2], [17, 3], [24, 2], [30, 3], [14, 9], [22, 13]];

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
