import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STRIDE,
  createClipRecorder,
  eventPriority,
  sampleClip,
  sampleClipInto,
} from './clipStore.js';

const DT = 1 / 60;

function makePlayers(count = 22) {
  return Array.from({ length: count }, (_, i) => ({
    x: 0,
    y: (i % 11) - 5,
    heading: 0,
    team: i < 11 ? 0 : 1,
    shirt: i + 1,
  }));
}

function run(recorder, players, ball, fromT, toT, onFrame = null) {
  for (let t = fromT; t <= toT + 1e-9; t += DT) {
    // Linear drift makes interpolation easy to assert.
    for (let i = 0; i < players.length; i++) {
      players[i].x = t + i * 0.1;
      players[i].y = (i % 11) - 5;
      players[i].heading = t * 0.1;
    }
    ball.x = t;
    ball.y = 0;
    ball.z = Math.max(0, Math.sin(t) * 2);
    recorder.observe(t, players, ball);
    if (onFrame) onFrame(t);
  }
}

function collectAll(recorder, fromT, toT, players, ball) {
  const ready = [];
  run(recorder, players, ball, fromT, toT, () => {
    ready.push(...recorder.collect(undefined));
  });
  return ready;
}

test('a 15 s pre / 15 s post window captures a goal at 05:00', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder({ preSecs: 15, postSecs: 15 });

  // Warm the ring for 30 s, then fire the event at t = 30.
  run(recorder, players, ball, 0, 30);
  const id = recorder.notifyEvent({ t: 30, type: 16, label: 'Goal', team: 0 });
  assert.ok(id, 'event opened a clip');

  const ready = collectAll(recorder, 30 + DT, 46, players, ball);
  assert.equal(ready.length, 1, 'one clip became ready');
  const clip = ready[0];
  assert.equal(clip.startT, 15);
  assert.equal(clip.endT, 45);
  assert.equal(clip.event.type, 16);
  assert.equal(clip.partial, false);
  assert.ok(clip.frames.length >= 290 && clip.frames.length <= 310,
    `expected ~300 frames, got ${clip.frames.length}`);
  assert.ok(clip.frames[0].t <= 15.11, 'window starts at 04:45');
  assert.ok(clip.frames[clip.frames.length - 1].t >= 44.9, 'window ends at 05:15');
});

test('sampling interpolates positions and clamps outside the clip', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder();
  run(recorder, players, ball, 0, 30);
  recorder.notifyEvent({ t: 30, type: 13, label: 'Shot', team: 1 });
  const ready = collectAll(recorder, 30 + DT, 46, players, ball);
  const clip = ready[0];

  const exact = sampleClip(clip, 30);
  assert.ok(exact, 'sample returned data');
  assert.equal(exact.count, 23);
  assert.ok(Math.abs(exact.data[0] - 30) < 0.2, 'player 0 x tracks the clock');

  const before = sampleClip(clip, -100);
  const after = sampleClip(clip, 1000);
  assert.ok(Math.abs(before.data[0] - clip.frames[0].t) < 0.2, 'clamps to the first frame');
  assert.ok(after.data[0] >= clip.frames[clip.frames.length - 1].t, 'clamps to the last frame');

  const out = new Float32Array(23 * STRIDE);
  const reused = sampleClipInto(clip, 30, out);
  assert.equal(reused, out, 'sampleClipInto reuses the caller buffer');
});

test('nearby events merge into one upgraded clip', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder({ preSecs: 15, postSecs: 15 });

  run(recorder, players, ball, 0, 30);
  recorder.notifyEvent({ t: 30, type: 4, label: 'Corner', team: 0 });
  run(recorder, players, ball, 30 + DT, 36);
  recorder.notifyEvent({ t: 36, type: 16, label: 'Goal', team: 0 });

  const ready = collectAll(recorder, 36 + DT, 52, players, ball);
  assert.equal(ready.length, 1, 'corner + goal are one highlight');
  const clip = ready[0];
  assert.equal(clip.event.type, 16, 'goal owns the headline');
  assert.equal(clip.startT, 15, 'window still opens 15 s before the corner');
  assert.equal(clip.endT, 51, 'window closes 15 s after the goal');
  assert.ok(recorder.getClips().length === 1);
});

test('distant events become separate clips and keep priority ordering', () => {
  assert.ok(eventPriority({ type: 16 }) > eventPriority({ type: 4 }));
  assert.equal(eventPriority({ type: 13, notable: true }), 70);

  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder({ preSecs: 15, postSecs: 15 });

  run(recorder, players, ball, 0, 30);
  recorder.notifyEvent({ t: 30, type: 13, label: 'Shot', team: 1 });
  run(recorder, players, ball, 30 + DT, 62);
  recorder.notifyEvent({ t: 62, type: 16, label: 'Goal', team: 1 });

  const ready = collectAll(recorder, 62 + DT, 78, players, ball);
  assert.equal(ready.length, 2, 'both windows were delivered');
  assert.equal(ready[0].event.type, 13);
  assert.equal(ready[0].partial, false, 'the first window reached its natural end');
  assert.ok(Math.abs(ready[0].endT - 45) < 1e-6);
  assert.equal(ready[1].startT, 47);
  assert.ok(Math.abs(ready[1].endT - 77) < 1e-6);
});

test('a backwards seek drops the pending window instead of splicing timelines', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder();

  run(recorder, players, ball, 0, 20);
  recorder.notifyEvent({ t: 20, type: 16, label: 'Goal', team: 0 });
  assert.ok(recorder.getPending());

  // Seek back to 05:00 — the pending window must not survive.
  recorder.observe(5, players, ball);
  assert.equal(recorder.getPending(), null);
  assert.deepEqual(recorder.collect(40), []);
});

test('reset clears pending, history and (optionally) ready clips', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder();

  run(recorder, players, ball, 0, 30);
  recorder.notifyEvent({ t: 30, type: 16, label: 'Goal', team: 0 });
  collectAll(recorder, 30 + DT, 46, players, ball);
  assert.equal(recorder.getClips().length, 1);

  recorder.reset();
  assert.equal(recorder.getPending(), null);
  assert.equal(recorder.getClips().length, 1, 'seek keeps completed clips');

  recorder.reset({ clearClips: true });
  assert.equal(recorder.getClips().length, 0, 'a new match clears clips');
});

test('ready clips are capped at maxClips', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder({ preSecs: 5, postSecs: 5, maxClips: 2 });

  run(recorder, players, ball, 0, 10);
  recorder.notifyEvent({ t: 10, type: 16, label: 'Goal', team: 0 });
  collectAll(recorder, 10 + DT, 16, players, ball);
  run(recorder, players, ball, 16 + DT, 30);
  recorder.notifyEvent({ t: 30, type: 16, label: 'Goal', team: 1 });
  collectAll(recorder, 30 + DT, 36, players, ball);
  run(recorder, players, ball, 36 + DT, 50);
  recorder.notifyEvent({ t: 50, type: 16, label: 'Goal', team: 0 });
  collectAll(recorder, 50 + DT, 56, players, ball);

  assert.equal(recorder.getClips().length, 2, 'old clips fall off');
  assert.deepEqual(recorder.getClips().map((c) => c.event.t), [30, 50]);
});

test('a seek that lands after the event still captures the post-roll', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder({ preSecs: 15, postSecs: 15 });

  run(recorder, players, ball, 0, 40);
  // The event happened at 00:20; by the time the row is announced the ring
  // already contains the whole 05:05–05:35 window.
  recorder.notifyEvent({ t: 20, type: 16, label: 'Goal', team: 0 });
  const ready = recorder.collect(40);
  assert.equal(ready.length, 1, 'the completed window finalizes immediately');
  assert.equal(ready[0].startT, 5);
  assert.ok(Math.abs(ready[0].endT - 35) < 1e-6);
  assert.ok(ready[0].frames.length > 290, 'pre and post frames were both captured');
});

test('flush closes a pending window when the sim stalls', () => {
  const players = makePlayers();
  const ball = { x: 0, y: 0, z: 0 };
  const recorder = createClipRecorder({ preSecs: 10, postSecs: 10 });

  run(recorder, players, ball, 0, 20);
  recorder.notifyEvent({ t: 20, type: 16, label: 'Goal', team: 0 });
  const ready = recorder.flush();
  assert.equal(ready.length, 1, 'the pending window is delivered');
  assert.equal(ready[0].partial, true, 'it is marked partial');
  assert.ok(ready[0].endT <= 20.11, 'it ends at the last recorded frame');
  assert.equal(recorder.getPending(), null);
  assert.deepEqual(recorder.flush(), [], 'flush is idempotent');
});

test('heading interpolation takes the shortest arc across the pi seam', () => {
  const frames = [
    { t: 0, count: 1, data: new Float32Array([0, 0, 0, 3.0, 0, 7]) },
    { t: 1, count: 1, data: new Float32Array([0, 0, 0, -3.0, 0, 7]) },
  ];
  const clip = { startT: 0, endT: 1, frames };
  const mid = sampleClip(clip, 0.5);
  assert.ok(Math.abs(mid.data[3] - Math.PI) < 0.01, `expected ~pi, got ${mid.data[3]}`);
});
