// Fragments HTML purs de la couche rendu (render/html.js) : aucune dépendance
// DOM/PIXI — on vérifie le contenu FONCTIONNEL des panneaux (facteurs, ravito,
// colonne CRT, pertes), pas leur mise en forme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeState, fillTerrain, makeUnit } from './helpers.js';
import {
  sideLabel, hexRecapHtml, inspectorHtml, objbarHtml, phaseBtnLabel,
  combatCalcHtml, crtTableHtml, recapHtml,
} from '../render/html.js';

test('le récap d’hexe donne le terrain, le ravitaillement et le total de la pile', () => {
  const st = makeState({
    terrain: fillTerrain([[0, 0], [1, 0]]),
    units: [
      makeUnit({ id: 1, atk: 4, def: 4, mov: 6, fullName: 'A' }),
      makeUnit({ id: 2, atk: 3, def: 2, mov: 6, fullName: 'B' }),
    ],
  });
  const html = hexRecapHtml(st, '0,0');
  assert.match(html, /Plaine/); // nom du terrain
  assert.match(html, /1 PM/); // coût de mouvement
  assert.match(html, /hors portée/); // aucune source de ravito sur cette mini-carte
  assert.match(html, /Total \(2 pions\)/);
  assert.match(html, /7 atk · 6 déf/); // sommes des facteurs effectifs
});

test('le récap d’hexe signale un terrain infranchissable', () => {
  const st = makeState({ terrain: fillTerrain([[0, 0]], 'river') });
  const html = hexRecapHtml(st, '0,0');
  assert.match(html, /Rivière/);
  assert.match(html, /Infranchissable/);
});

test('l’inspecteur détaille l’unité sélectionnée en phase de mouvement', () => {
  const u = makeUnit({ id: 1, name: '21 Pz', fullName: '21e Panzer', mpLeft: 3, supplied: false });
  const st = makeState({ units: [u] });
  const html = inspectorHtml(st, { unit: u }, new Set());
  assert.match(html, /21 Pz/);
  assert.match(html, /HORS ravito/);
  assert.match(html, /PM restants/);
  assert.match(html, /<b>3<\/b>/);
});

test('l’inspecteur annonce le bonus d’armes combinées (blindé + infanterie)', () => {
  const st = makeState({
    units: [
      makeUnit({ id: 1, type: 'armor', atk: 5 }),
      makeUnit({ id: 2, type: 'inf', atk: 2 }),
    ],
  });
  st.G.phase = 'combat';
  const html = inspectorHtml(st, null, new Set([1, 2]));
  assert.match(html, /Force totale/);
  assert.match(html, /<b>7<\/b>/);
  assert.match(html, /\+1 colonne/);
});

test('l’inspecteur affiche un vide explicite sans sélection', () => {
  const st = makeState();
  assert.match(inspectorHtml(st, null, new Set()), /Aucune sélection/);
});

test('la table CRT surligne la colonne active, la case du dé et pointille la base', () => {
  const html = crtTableHtml('3:1', 2, '2:1'); // dé 3 (index 2), base avant décalages
  assert.match(html, /<th class="colon">3:1<\/th>/); // seule colonne active
  assert.equal(html.match(/th class="colon"/g).length, 1);
  assert.match(html, /colon hit/); // case (colonne × dé) mise en évidence
  assert.match(html, /<th class="basecol">2:1<\/th>/); // colonne de base pointillée
  // base = colonne finale → pas de double marquage
  assert.doesNotMatch(crtTableHtml('3:1', -1, '3:1'), /basecol/);
});

test('l’aperçu du combat trace chaque nombre : réductions, ravito, décalages nommés', () => {
  const p = {
    atk: 5, def: 2, defender: 'Div. X',
    breakdown: [{ name: '21 Pz', atk: 5, raw: 8, reduced: true }],
    defFull: 7, defBase: 4, defReduced: true, defSupplied: false,
    combined: 1, arty: 2, artyCount: 3, terr: 2, terrName: 'Coteau',
    baseCol: '2:1', idx: 4, col: '3:1',
  };
  const html = combatCalcHtml(p);
  assert.match(html, /5 ÷ 2 ≈ 2,5/); // rapport, décimale à la française
  assert.match(html, /<s>8<\/s> <b>5<\/b>/); // recto barré de l'attaquant réduit
  assert.match(html, /réduite : <s>7<\/s> → 4/); // défense : palier explicité
  assert.match(html, /hors ravito : 4 ÷ 2 → 2/); // défense : malus de ravito calculé
  assert.match(html, /blindé \+ infanterie/); // cause des armes combinées
  assert.match(html, /3 pièces à portée \(plafond \+2\)/); // artillerie détaillée
  assert.match(html, /terrain du défenseur — Coteau/); // terrain nommé
  assert.match(html, /−2 colonnes/); // décalage terrain en colonnes
  assert.match(html, /décalée de <b>\+1<\/b>/); // net lisible
  assert.match(html, /<b class="finalcol">3:1<\/b>/);
});

test('l’aperçu signale la butée de table et l’absence de décalage', () => {
  const base = {
    atk: 3, def: 4, defender: 'Div. X', breakdown: [{ name: 'Inf', atk: 3, raw: 3, reduced: false }],
    defFull: 4, defBase: 4, defReduced: false, defSupplied: true,
    combined: 0, arty: 0, artyCount: 0,
  };
  // terrain −3 depuis 1:2 : la table s'arrête à 1:3 → décalage tronqué signalé
  const clamped = combatCalcHtml({ ...base, terr: 3, terrName: 'Montagne', baseCol: '1:2', idx: 0, col: '1:3' });
  assert.match(clamped, /terrain du défenseur — Montagne/);
  assert.match(clamped, /butée de table/);
  // aucun modificateur → pas de fausse ligne de décalage
  const flat = combatCalcHtml({ ...base, terr: 0, terrName: 'Plaine', baseCol: '1:2', idx: 1, col: '1:2' });
  assert.match(flat, /aucun décalage/);
  assert.doesNotMatch(flat, /class="shift (up|down)"/);
});

test('le récap de fin compte éliminés et réduits par camp et marque le vainqueur', () => {
  const st = makeState({
    units: [
      makeUnit({ id: 1, side: 'blue' }),
      makeUnit({ id: 2, side: 'blue', reduced: true }),
      makeUnit({ id: 3, side: 'red' }),
    ],
  });
  st.initialCount = { blue: 2, red: 3 }; // rouge a perdu 2 unités
  const html = recapHtml(st, 'blue');
  const [, blueRow, redRow] = html.split('<tbody>')[1].split('<tr');
  assert.match(blueRow, /class="winner"/);
  assert.match(blueRow, /<td>0<\/td><td>1<\/td><\/tr>/); // 0 éliminé, 1 réduit
  assert.match(redRow, /<td>2<\/td><td>0<\/td><\/tr>/); // 2 éliminés, 0 réduit
});

test('libellés de phase et de camp', () => {
  assert.equal(sideLabel('blue'), 'BLEU');
  assert.equal(sideLabel('red'), 'ROUGE');
  assert.equal(phaseBtnLabel({ phase: 'move' }), 'Passer au combat ▸');
  assert.equal(phaseBtnLabel({ phase: 'combat', player: 'blue' }), 'Fin de tour Bleu → Rouge ▸');
  assert.equal(phaseBtnLabel({ phase: 'combat', player: 'red', turn: 4 }), 'Fin du tour 4 ▸');
  const st = makeState({ objectives: ['0,0', '1,0'] });
  st.objControl.set('0,0', 'red');
  assert.match(objbarHtml(st), /<b>0<\/b> BLEU<\/span> · <span class="red"><b>1<\/b> ROUGE<\/span> · 2 au total/);
});
