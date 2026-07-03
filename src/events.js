// ===========================================================================
//  Bus d'événements minimal.
//  Les règles (combat, mouvement, séquence) émettent des événements au lieu de
//  toucher au rendu. Le rendu s'y abonne. C'est ce qui rend la logique testable
//  sans navigateur ni PixiJS.
//
//  Événements émis par les règles :
//    'unitReduced'    (unit)              — un pion passe recto → verso
//    'unitRemoved'    (unit)              — un pion est éliminé
//    'combatResolved' ({ col, die, res }) — un combat vient d'être résolu
//    'phaseChanged'   ()                  — la séquence a avancé
//    'gameOver'       ({ side, reason })  — la partie est terminée
//    'log'            (message: string)   — ligne de journal (HTML autorisé)
// ===========================================================================

export function createBus() {
  const listeners = new Map();
  return {
    on(type, fn) {
      const set = listeners.get(type) ?? listeners.set(type, new Set()).get(type);
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, payload) {
      listeners.get(type)?.forEach((fn) => fn(payload));
    },
  };
}
