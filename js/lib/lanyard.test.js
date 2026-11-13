import test from "node:test";
import assert from "node:assert/strict";

import { clamp, createRope, ribbonPath, sampleCurve, smoothPath, stepRope } from "./lanyard.js";

test("clamp keeps a value inside its bounds", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("createRope puts every point on the anchor line", () => {
  const rope = createRope({ anchor: { x: 10, y: 20 }, length: 120, segments: 7 });
  assert.equal(rope.points.length, 7);
  assert.equal(rope.segment, 20);
  assert.equal(rope.points[0].x, 10);
  assert.equal(rope.points[0].y, 20);
  assert.equal(rope.points[6].x, 10);
  assert.equal(rope.points[6].y, 140);
});

test("stepRope holds the anchor and keeps the segments taut", () => {
  const rope = createRope({ anchor: { x: 10, y: 20 }, length: 120, segments: 7 });
  for (let index = 0; index < 90; index++) {
    stepRope(rope, 1 / 60, { gravity: 2400 });
  }

  assert.equal(rope.points[0].x, 10);
  assert.equal(rope.points[0].y, 20);

  for (let index = 0; index < rope.points.length - 1; index++) {
    const first = rope.points[index];
    const second = rope.points[index + 1];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    assert.ok(Math.abs(distance - rope.segment) < 1.5, `segment ${index} is ${distance}`);
  }
});

test("stepRope pins the free end while dragging", () => {
  const rope = createRope({ anchor: { x: 0, y: 0 }, length: 90, segments: 7 });
  const pin = { x: 35, y: 70 };

  for (let index = 0; index < 20; index++) {
    stepRope(rope, 1 / 60, { gravity: 2400, pin });
  }

  const end = rope.points[rope.points.length - 1];
  assert.equal(end.x, pin.x);
  assert.equal(end.y, pin.y);
  assert.equal(rope.points[0].x, 0);
  assert.equal(rope.points[0].y, 0);
});

test("smoothPath emits one cubic curve per gap", () => {
  const rope = createRope({ anchor: { x: 0, y: 0 }, length: 100, segments: 6 });
  const path = smoothPath(rope.points);
  assert.ok(path.startsWith("M "));
  assert.equal(path.match(/ C /g)?.length, rope.points.length - 1);
});

test("smoothPath handles an empty or single point", () => {
  assert.equal(smoothPath([]), "");
  assert.equal(smoothPath([{ x: 1, y: 2 }]), "M 1 2");
});

test("a swung card settles straight under the anchor at its own length", () => {
  const rope = createRope({ anchor: { x: 0, y: 0 }, length: 120, segments: 7, tail: 400 });
  for (const point of rope.points) {
    point.x += point.y * 0.4;
    point.px = point.x;
  }
  for (let index = 0; index < 120 * 15; index++) {
    stepRope(rope, 1 / 120, { gravity: 4200, drag: 2 });
  }
  const top = rope.points[rope.top];
  const tail = rope.points[rope.top + 1];
  assert.ok(Number.isFinite(tail.x) && Number.isFinite(tail.y));
  assert.ok(Math.abs(top.x) < 0.5, `clip drifted to ${top.x}`);
  assert.ok(Math.abs(tail.x) < 0.5, `card hangs at ${tail.x}`);
  assert.ok(Math.abs(Math.hypot(tail.x - top.x, tail.y - top.y) - 400) < 2);
});

test("a held card keeps the grabbed point under the pointer", () => {
  const rope = createRope({ anchor: { x: 0, y: 0 }, length: 120, segments: 7, tail: 300 });
  const pin = { x: 80, y: 380, at: 1 };
  for (let index = 0; index < 120; index++) {
    stepRope(rope, 1 / 120, { gravity: 4200, pin });
  }
  const top = rope.points[rope.top];
  const tail = rope.points[rope.top + 1];
  assert.ok(Math.abs(tail.x - pin.x) < 0.01 && Math.abs(tail.y - pin.y) < 0.01);
  assert.ok(Math.abs(Math.hypot(tail.x - top.x, tail.y - top.y) - 300) < 3);
});

test("sampleCurve passes through every rope point", () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 40 }];
  const samples = sampleCurve(points, 4);
  assert.equal(samples.length, 9);
  assert.deepEqual(samples[4], { x: 10, y: 20 });
  assert.deepEqual(samples[8], { x: 0, y: 40 });
});

test("ribbonPath draws a closed band of the given width", () => {
  const path = ribbonPath([{ x: 0, y: 0 }, { x: 0, y: 10 }], () => 3);
  assert.equal(path, "M -3 0 L -3 10 L 3 10 L 3 0 Z");
  assert.equal(ribbonPath([{ x: 0, y: 0 }], () => 3), "");
});

test("a stretched strap hangs longer, and returns once stretch is gone", () => {
  const rope = createRope({ anchor: { x: 0, y: 0 }, length: 120, segments: 7, tail: 300 });
  const settle = () => {
    for (let index = 0; index < 600; index++) stepRope(rope, 1 / 120, { gravity: 4200 });
    return rope.points[rope.top].y;
  };
  const rest = settle();
  rope.stretch = 30;
  assert.ok(settle() > rest + 25);
  rope.stretch = 0;
  assert.ok(Math.abs(settle() - rest) < 0.5);
});
