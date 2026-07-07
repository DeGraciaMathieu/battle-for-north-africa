// ===========================================================================
//  Éditeur de carte — page autonome, à côté du jeu.
//  Permet de dessiner sa propre carte hex par hex, puis de l'exporter en JSON.
//  N'importe QUE des constantes/fonctions pures du jeu (config + géométrie),
//  en lecture seule : ne modifie aucun fichier ni aucun état de jeu.
//  Rendu maison en Canvas 2D (aucune dépendance à la couche render/ du jeu).
// ===========================================================================

import { TERRAIN, COLS, ROWS, SIZE } from '../src/config.js';
import { key, axialToPixel, offsetToAxial, pixelToAxial, hexCorners } from '../src/geometry.js';
import { generateMap } from '../src/map.js';

// ---- Palette : ordre d'affichage des terrains peignables. -----------------
const PALETTE = ['plain', 'plain2', 'plateau', 'road', 'bank', 'marsh', 'river', 'forest', 'hill', 'mountain', 'village', 'town', 'urban', 'base'];
const hex6 = (n) => '#' + n.toString(16).padStart(6, '0');

// ---- État de l'éditeur. ----------------------------------------------------
const terrain = new Map();          // "q,r" -> type de terrain
const hexes = [];                   // { q, r } de tous les hexes de la grille
const plain = () => (Math.random() < 0.5 ? 'plain' : 'plain2'); // nuance de plaine au hasard
for (let c = 0; c < COLS; c++) {
  for (let rw = 0; rw < ROWS; rw++) {
    const { q, r } = offsetToAxial(c, rw);
    terrain.set(key(q, r), plain());
    hexes.push({ q, r });
  }
}

let brush = 'hill';                 // terrain actif du pinceau
let scale = 1, panX = 0, panY = 0;  // transformation vue
let hover = null;                   // clé de l'hex survolé
let painting = false;               // clic gauche maintenu
let panning = false;                // pan en cours
let panStart = null;

// ---- Bornes du monde (pour le cadrage initial). ---------------------------
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const { q, r } of hexes) {
  const { x, y } = axialToPixel(q, r);
  minX = Math.min(minX, x - SIZE); maxX = Math.max(maxX, x + SIZE);
  minY = Math.min(minY, y - SIZE); maxY = Math.max(maxY, y + SIZE);
}
const worldW = maxX - minX, worldH = maxY - minY;

// ---- Canvas. ---------------------------------------------------------------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function fit() {
  const vw = canvas.clientWidth, vh = canvas.clientHeight;
  scale = Math.min(vw / worldW, vh / worldH) * 0.94;
  panX = (vw - worldW * scale) / 2 - minX * scale;
  panY = (vh - worldH * scale) / 2 - minY * scale;
  draw();
}

// Écran -> hex axial (inverse la transformation vue).
function hexAt(sx, sy) {
  const wx = (sx - panX) / scale, wy = (sy - panY) / scale;
  const { q, r } = pixelToAxial(wx, wy);
  const k = key(q, r);
  return terrain.has(k) ? k : null;
}

// ---- Rendu. ----------------------------------------------------------------
function draw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#14110c';
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, panX * dpr, panY * dpr);

  for (const { q, r } of hexes) {
    const t = TERRAIN[terrain.get(key(q, r))];
    const { x, y } = axialToPixel(q, r);
    const c = hexCorners(x, y);
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    for (let i = 2; i < c.length; i += 2) ctx.lineTo(c[i], c[i + 1]);
    ctx.closePath();
    ctx.fillStyle = hex6(t.fill);
    ctx.fill();
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = hex6(t.stroke);
    ctx.globalAlpha = 0.45;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (hover) {
    const [q, r] = hover.split(',').map(Number);
    const { x, y } = axialToPixel(q, r);
    const c = hexCorners(x, y);
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]);
    for (let i = 2; i < c.length; i += 2) ctx.lineTo(c[i], c[i + 1]);
    ctx.closePath();
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = '#e8b95a';
    ctx.stroke();
  }
}

// ---- Peinture. -------------------------------------------------------------
function paintAt(k) {
  if (!k || terrain.get(k) === brush) return;
  terrain.set(k, brush);
  draw();
}

// ---- Interaction souris. ---------------------------------------------------
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2 || e.shiftKey) {   // pan : molette / clic droit / shift
    panning = true; panStart = { x: e.clientX - panX, y: e.clientY - panY };
    return;
  }
  painting = true;
  paintAt(hexAt(e.offsetX, e.offsetY));
});
canvas.addEventListener('mousemove', (e) => {
  if (panning) { panX = e.clientX - panStart.x; panY = e.clientY - panStart.y; draw(); return; }
  const k = hexAt(e.offsetX, e.offsetY);
  if (painting) paintAt(k);
  if (k !== hover) {
    hover = k;
    tip.textContent = k ? TERRAIN[terrain.get(k)].name + '  (' + k + ')' : '';
    draw();
  }
});
window.addEventListener('mouseup', () => { painting = false; panning = false; });
canvas.addEventListener('mouseleave', () => { hover = null; tip.textContent = ''; draw(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const ns = Math.max(0.2, Math.min(4, scale * f));
  const wx = (e.offsetX - panX) / scale, wy = (e.offsetY - panY) / scale;
  panX = e.offsetX - wx * ns; panY = e.offsetY - wy * ns;
  scale = ns; draw();
}, { passive: false });

// ---- Palette (UI). ---------------------------------------------------------
const palEl = document.getElementById('palette');
const swatches = new Map();
for (const t of PALETTE) {
  const def = TERRAIN[t];
  const b = document.createElement('button');
  b.className = 'swatch-btn';
  b.innerHTML = '<span class="sw" style="background:' + hex6(def.fill) + '"></span>' + def.name;
  b.addEventListener('click', () => { brush = t; select(t); });
  palEl.appendChild(b);
  swatches.set(t, b);
}
function select(t) { for (const [k, b] of swatches) b.classList.toggle('on', k === t); }
select(brush);

// ---- Barre d'outils. -------------------------------------------------------
const tip = document.getElementById('tip');

document.getElementById('btnFit').addEventListener('click', fit);

document.getElementById('btnClear').addEventListener('click', () => {
  if (!confirm('Tout effacer et repartir d’une plaine vierge ?')) return;
  for (const k of terrain.keys()) terrain.set(k, plain());
  draw();
});

document.getElementById('btnSeed').addEventListener('click', () => {
  const s = prompt('Seed de départ (nombre) :', '1');
  if (s === null) return;
  const gen = generateMap(Number(s) || 1);
  for (const k of terrain.keys()) terrain.set(k, gen.terrain.get(k) || 'plain');
  draw();
});

document.getElementById('btnExport').addEventListener('click', () => {
  const data = { cols: COLS, rows: ROWS, terrain: Object.fromEntries(terrain) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'carte.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

const fileInput = document.getElementById('fileInput');
document.getElementById('btnImport').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const src = data.terrain || {};
    for (const k of terrain.keys()) terrain.set(k, TERRAIN[src[k]] ? src[k] : 'plain');
    draw();
  } catch {
    alert('Fichier illisible : JSON invalide.');
  }
  fileInput.value = '';
});

// ---- Amorçage. -------------------------------------------------------------
window.addEventListener('resize', resize);
resize();
fit();
