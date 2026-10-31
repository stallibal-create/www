import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotion, smoothstep, INTRO_DURATION_MS, PART_DURATION_MS } from '../../src/assets/js/assembly/motion.js';
import { solveAssembly, explodeOffsets, poseAt } from '../../src/assets/js/assembly/assembly.js';
import { readFileSync } from 'node:fs';

const site = JSON.parse(readFileSync(new URL('../../content/site.json', import.meta.url), 'utf8'));
const assembly = site.ductAssembly;

function advance(m, ms, frame = 16) {
  for (let t = 0; t < ms;) { const d = Math.min(frame, ms - t); m.tick(d); t += d; }
  return m.state();
}

test('motion easing is bounded and has exact endpoints', () => {
  assert.equal(smoothstep(-10), 0);
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(.5), .5);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(10), 1);
});

test('intro starts assembled, shows exploded joints, reassembles, and finishes idle', () => {
  const states = [], m = createMotion(s => states.push(s.mode));
  assert.equal(m.state().mode, 'idle');
  m.playIntro();
  assert.equal(m.state().factor, 0);
  advance(m, 1700); assert.equal(m.state().factor, 0);
  advance(m, 850); assert.ok(Math.abs(m.state().factor - .5) < 1e-12);
  advance(m, 850); assert.equal(m.state().factor, 1);
  advance(m, 450); assert.equal(m.state().factor, 1);
  advance(m, INTRO_DURATION_MS - 3850);
  assert.equal(m.state().factor, 0);
  assert.equal(m.state().mode, 'idle');
  assert.deepEqual(states, ['intro', 'idle']);
});

test('visible-frame scheduling: no implicit clock, stable across variable frame sizes', () => {
  const a = createMotion(), b = createMotion();
  a.playIntro(); b.playIntro();
  advance(a, 2233, 16); advance(b, 2233, 113);
  assert.ok(Math.abs(a.state().factor - b.state().factor) < 1e-12);
  assert.ok(Math.abs(a.state().orbitRad - b.state().orbitRad) < 1e-12);
  assert.equal(a.state().mode, 'intro');
});

test('Skip and physical interaction interrupt the intro to a fully installed state', () => {
  const m = createMotion(); m.playIntro(); advance(m, 2750);
  assert.ok(m.state().factor > 0 && m.state().factor < 1);
  assert.deepEqual(m.skip(), { mode: 'idle', factor: 0, orbitRad: 0, running: false });
  m.playIntro(); advance(m, 3400);
  assert.deepEqual(m.interrupt(), { mode: 'idle', factor: 0, orbitRad: 0, running: false });
  assert.equal(m.tick(10000).factor, 0);
});

test('explode and reassemble animate without cumulative errors', () => {
  const m = createMotion();
  for (let i = 0; i < 100; i++) {
    m.explode(); advance(m, PART_DURATION_MS);
    assert.deepEqual(m.state(), { mode: 'idle', factor: 1, orbitRad: 0, running: false });
    m.reassemble(); advance(m, PART_DURATION_MS);
    assert.deepEqual(m.state(), { mode: 'idle', factor: 0, orbitRad: 0, running: false });
  }
});

test('transition to reassembly mid-explosion interpolates from the current factor', () => {
  const m = createMotion(); m.explode(); advance(m, PART_DURATION_MS / 2);
  const halfway = m.state().factor;
  m.reassemble(); assert.equal(m.state().factor, halfway);
  advance(m, PART_DURATION_MS / 2); assert.ok(Math.abs(m.state().factor - halfway / 2) < 1e-12);
  advance(m, PART_DURATION_MS / 2); assert.equal(m.state().factor, 0);
});

test('reduced-motion commands jump to exact final states', () => {
  const m = createMotion();
  assert.equal(m.explode(true).factor, 1);
  assert.equal(m.reassemble(true).factor, 0);
});

test('all fifteen part positions return to the solved installed transform after interruption', () => {
  const solved = solveAssembly(assembly), offsets = explodeOffsets(assembly, solved), m = createMotion();
  for (let i = 0; i < 50; i++) {
    m.playIntro(); advance(m, 2300 + (i % 4) * 250);
    const partiallySeparated = [...solved.order].map(id => poseAt(solved.parts.get(id).installed, offsets.get(id), m.state().factor));
    assert.ok(partiallySeparated.length === 19);
    m.interrupt();
    for (const id of solved.order) assert.deepEqual(poseAt(solved.parts.get(id).installed, offsets.get(id), m.state().factor), solved.parts.get(id).installed);
  }
});

test('invalid elapsed time does not corrupt the motion state', () => {
  const m = createMotion(); m.playIntro(); m.tick(NaN); m.tick(-500); m.tick(Infinity);
  assert.equal(m.state().factor, 0);
  assert.equal(m.state().orbitRad, 0);
});

test('v13: interrupting an Explode finishes it (exploded); interrupting a Reassemble finishes it (installed)', () => {
  const m = createMotion();
  m.explode(); advance(m, PART_DURATION_MS / 3);
  assert.deepEqual(m.interrupt(), { mode: 'idle', factor: 1, orbitRad: 0, running: false });
  m.reassemble(); advance(m, PART_DURATION_MS / 3);
  assert.deepEqual(m.interrupt(), { mode: 'idle', factor: 0, orbitRad: 0, running: false });
  m.playIntro(); advance(m, 2600);
  assert.equal(m.interrupt().factor, 0, 'the intro still returns to the installed assembly');
});
