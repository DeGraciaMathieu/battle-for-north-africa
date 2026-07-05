// Fabriques d'états minimaux pour les tests de règles (sans carte complète).
import { createBus } from '../src/events.js';

// État de jeu réduit : terrain fourni explicitement (par défaut du désert).
export function makeState({ terrain = new Map(), units = [], objectives = [], rng = () => 0 } = {}) {
  return {
    terrain,
    hexes: [],
    objectives,
    objControl: new Map(),
    units,
    G: { turn: 1, player: 'blue', phase: 'move', over: false },
    bus: createBus(),
    rng,
  };
}

// Remplit un ensemble de coordonnées [q, r] avec un type de terrain donné.
export function fillTerrain(coords, type = 'plain') {
  const terrain = new Map();
  for (const [q, r] of coords) terrain.set(`${q},${r}`, type);
  return terrain;
}

// Pion de test : valeurs par défaut raisonnables, surchargées au besoin.
export function makeUnit(over = {}) {
  return {
    id: 0, side: 'blue', type: 'armor', name: 'T', ech: 'XX',
    q: 0, r: 0, atk: 6, def: 6, mov: 10, ratk: 4, rdef: 4, rmov: 8,
    mpLeft: 10, hasFought: false, reduced: false, supplied: true, ...over,
  };
}
