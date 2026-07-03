import { test } from 'node:test';
import assert from 'node:assert/strict';
import { key, offsetToAxial, hexDistance, axialToPixel, pixelToAxial, clamp } from '../src/geometry.js';

test('key sérialise une coordonnée axiale', () => {
  assert.equal(key(2, -3), '2,-3');
});

test('offsetToAxial convertit offset → axial', () => {
  assert.deepEqual(offsetToAxial(0, 0), { q: 0, r: 0 });
  assert.deepEqual(offsetToAxial(2, 0), { q: 2, r: -1 });
});

test('hexDistance mesure la distance en hex', () => {
  assert.equal(hexDistance(0, 0, 0, 0), 0);
  assert.equal(hexDistance(0, 0, 1, 0), 1);
  assert.equal(hexDistance(0, 0, 2, -1), 2);
});

test('pixelToAxial inverse axialToPixel', () => {
  for (const [q, r] of [[0, 0], [3, -2], [-4, 5]]) {
    const { x, y } = axialToPixel(q, r);
    assert.deepEqual(pixelToAxial(x, y), { q, r });
  }
});

test('clamp borne une valeur', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});
