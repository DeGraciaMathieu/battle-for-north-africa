// ===========================================================================
//  Helpers graphiques partagés entre modules de rendu : couleurs de camp,
//  interpolation, arêtes d'hexagone. Aucune dépendance au DOM ni à PixiJS :
//  module importable en test.
// ===========================================================================

export const FILL = { blue: 0x3b6fd4, red: 0xd64b46 }; // couleurs des camps (pions, camp de base)
export const SUP = { blue: 0x8fb0d8, red: 0xe0968f }; // teinte de ravitaillement par camp

// voisin axial d → arête correspondante de l'hexe flat-top.
export const DIR_TO_EDGE = [0, 5, 4, 3, 2, 1];

// Interpolation de couleur RGB (ex. jaune → rouge selon une progression 0→1).
export const lerpColor = (a, b, t) => {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (r << 16) | (g << 8) | bl;
};
// Assombrit une couleur de camp (face verso des pions).
export const mixDark = (col) => {
  const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255;
  return (((r * 0.62) | 0) << 16) | (((g * 0.62) | 0) << 8) | ((b * 0.62) | 0);
};
