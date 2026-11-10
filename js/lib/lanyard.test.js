import test from "node:test";
import assert from "node:assert/strict";

import { clamp, createRope, smoothPath, stepRope } from "./lanyard.js";

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
