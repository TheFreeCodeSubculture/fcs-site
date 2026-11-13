/*
 * js/lib/lanyard.js
 * ------------------------------------------------------------------
 * The physics for the hanging member pass. A small Verlet rope gives the
 * strap its curve and swing without pulling in three.js or a physics
 * engine. The pass itself stays a normal DOM element, so the name,
 * avatar and details remain real text and real images.
 * ------------------------------------------------------------------
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * A rope made of equally spaced points. The first point is the fixed
 * anchor. With `tail` set, one more point hangs `tail` px below the rope
 * end: the rope end is the card's clip and the tail is the card's centre
 * of mass, so the card swings as a rigid body instead of copying the rope.
 */
export function createRope({ anchor, length, segments = 7, tail = 0 }) {
  const count = Math.max(2, Math.round(segments));
  const segment = Math.max(1, length) / (count - 1);
  const points = Array.from({ length: count }, (_, index) => {
    const y = anchor.y + segment * index;
    return { x: anchor.x, y, px: anchor.x, py: y };
  });
  if (tail > 0) {
    const y = anchor.y + segment * (count - 1) + tail;
    points.push({ x: anchor.x, y, px: anchor.x, py: y });
  }
  return {
    anchor: { x: anchor.x, y: anchor.y },
    length: segment * (count - 1),
    segment,
    tail: tail > 0 ? tail : 0,
    // Extra strap length while it is pulled; 0 when it hangs freely.
    stretch: 0,
    top: count - 1,
    points,
  };
}

// The card is heavier than the strap, so the strap gives way first.
const CARD_INVERSE_MASS = 0.25;

function inverseMass(rope, index) {
  if (index === 0) return 0;
  return index >= rope.top && rope.tail ? CARD_INVERSE_MASS : 1;
}

/**
 * One fixed physics step (Verlet). `drag` is air resistance per second, so
 * the feel does not change with the display's refresh rate. `pin` holds a
 * point on the card to the pointer: `at` is how far down the card that
 * point is, as a fraction of `tail` (0 = the clip).
 */
export function stepRope(
  rope,
  dt,
  { gravity = 2400, drag = 2, pin = null, passes = 8 } = {},
) {
  const seconds = clamp(dt, 0, 1 / 30);
  const points = rope.points;
  const damping = Math.exp(-drag * seconds);
  const gravityStep = gravity * seconds * seconds;

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    const velocityX = (point.x - point.px) * damping;
    const velocityY = (point.y - point.py) * damping;
    point.px = point.x;
    point.py = point.y;
    point.x += velocityX;
    point.y += velocityY + gravityStep;
  }

  const anchor = rope.anchor;
  const top = rope.top;
  const tailIndex = rope.tail ? top + 1 : -1;
  const strapSegment = rope.segment + (rope.stretch || 0) / top;

  for (let pass = 0; pass < passes; pass++) {
    points[0].x = anchor.x;
    points[0].y = anchor.y;

    for (let index = 0; index < points.length - 1; index++) {
      const first = points[index];
      const second = points[index + 1];
      const rest = index + 1 === tailIndex ? rope.tail : strapSegment;
      const firstWeight = inverseMass(rope, index);
      const secondWeight = inverseMass(rope, index + 1);
      const total = firstWeight + secondWeight;
      if (!total) continue;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy) || 0.0001;
      const correction = (distance - rest) / distance / total;
      first.x += dx * correction * firstWeight;
      first.y += dy * correction * firstWeight;
      second.x -= dx * correction * secondWeight;
      second.y -= dy * correction * secondWeight;
    }

    if (pin) applyPin(rope, pin);
  }

  points[0].x = anchor.x;
  points[0].y = anchor.y;
  if (pin) applyPin(rope, pin);
}

/** Move the card rigidly so the grabbed point sits under the pointer. */
function applyPin(rope, pin) {
  const top = rope.points[rope.top];
  const tail = rope.tail ? rope.points[rope.top + 1] : null;
  const at = tail ? pin.at || 0 : 0;
  const x = tail ? top.x + (tail.x - top.x) * at : top.x;
  const y = tail ? top.y + (tail.y - top.y) * at : top.y;
  const dx = pin.x - x;
  const dy = pin.y - y;
  top.x += dx;
  top.y += dy;
  if (tail) {
    tail.x += dx;
    tail.y += dy;
  }
}

/** Points along the same Catmull-Rom curve smoothPath draws. */
export function sampleCurve(points, steps = 4) {
  if (!points || points.length === 0) return [];
  const samples = [{ x: points[0].x, y: points[0].y }];
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] || points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] || p2;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a, b, c, d) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      samples.push({ x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return samples;
}

/**
 * A filled ribbon around a centre line. `halfWidth(t)` gets 0 at the
 * start and 1 at the end, which is how the strap shows its twist.
 */
export function ribbonPath(samples, halfWidth) {
  const count = samples.length;
  if (count < 2) return "";
  const round = (value) => Number(value.toFixed(2));
  const left = [];
  const right = [];
  for (let index = 0; index < count; index++) {
    const before = samples[Math.max(0, index - 1)];
    const after = samples[Math.min(count - 1, index + 1)];
    const tx = after.x - before.x;
    const ty = after.y - before.y;
    const length = Math.hypot(tx, ty) || 1;
    const width = halfWidth(index / (count - 1));
    const nx = (-ty / length) * width;
    const ny = (tx / length) * width;
    const point = samples[index];
    left.push(`${round(point.x + nx)} ${round(point.y + ny)}`);
    right.push(`${round(point.x - nx)} ${round(point.y - ny)}`);
  }
  return `M ${left.join(" L ")} L ${right.reverse().join(" L ")} Z`;
}

/** A Catmull-Rom curve expressed as cubic Bézier segments for SVG. */
export function smoothPath(points, tension = 1) {
  if (!points || points.length === 0) return "";
  const round = (value) => Number(value.toFixed(2));
  let path = `M ${round(points[0].x)} ${round(points[0].y)}`;

  for (let index = 0; index < points.length - 1; index++) {
    const before = points[index - 1] || points[index];
    const start = points[index];
    const end = points[index + 1];
    const after = points[index + 2] || end;
    const controlOneX = start.x + ((end.x - before.x) / 6) * tension;
    const controlOneY = start.y + ((end.y - before.y) / 6) * tension;
    const controlTwoX = end.x - ((after.x - start.x) / 6) * tension;
    const controlTwoY = end.y - ((after.y - start.y) / 6) * tension;
    path += ` C ${round(controlOneX)} ${round(controlOneY)} ${round(controlTwoX)} ${round(controlTwoY)} ${round(end.x)} ${round(end.y)}`;
  }

  return path;
}

// Physics runs at a fixed rate so a 60 Hz and a 144 Hz screen swing the
// card the same way. Tuned by eye; raise GRAVITY for a snappier swing.
const STEP = 1 / 120;
const GRAVITY = 8000;
const AIR_DRAG = 1.4;
// Torsion of the strap during a flip: about a 0.6 s turn with a small
// overshoot, like a card on a twisted lanyard.
const SPIN_STIFFNESS = 110;
const SPIN_DAMPING = 11;
const STRAP_HALF = 7;
const STRAP_FACE_HALF = 4.5;
// How far the strap gives when pulled, as a share of its length, and how
// fast it springs back (per second) once let go.
const STRAP_STRETCH = 0.3;
const STRAP_RECOIL = 14;

/**
 * Wire the pass to the stage. Returns null when the markup is not there,
 * so profile.js can mount before the panel exists without guarding every
 * call site.
 */
export function mountLanyard(stage, { reducedMotion = false } = {}) {
  if (!stage) return null;
  const card = stage.querySelector(".member-pass");
  if (!card) return null;

  const strapEdge = stage.querySelector(".pass-strap-edge");
  const strapFace = stage.querySelector(".pass-strap-face");
  const strapStitch = stage.querySelector(".pass-strap-stitch");
  const strapPrint = stage.querySelector(".pass-strap-print");
  const anchorElement = stage.querySelector(".pass-anchor");
  const shadow = stage.querySelector(".pass-cast-shadow");
  const hint = stage.querySelector(".pass-hint");
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const forcedReduced = Boolean(reducedMotion);
  let reduce = forcedReduced || reduceQuery.matches;

  let rope = null;
  let restX = 0;
  let restY = 0;
  let cardWidth = 0;
  let cardHeight = 0;
  let spin = 0;
  let spinVelocity = 0;
  let spinTarget = 0;
  let dragging = false;
  let dragPin = null;
  let dragOffset = { x: 0, y: 0 };
  let activePointer = null;
  let visible = true;
  let frameRequest = 0;
  let lastTime = 0;
  let pending = 0;
  let dropped = false;
  let destroyed = false;
  let resizeRequest = 0;
  let moved = false;
  let startPoint = null;
  let justDraggedTimer = 0;

  function measure() {
    const previousTransform = card.style.transform;
    card.style.transform = "none";
    const stageRect = stage.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const anchorRect = anchorElement?.getBoundingClientRect();
    card.style.transform = previousTransform;

    cardWidth = cardRect.width;
    cardHeight = cardRect.height;
    restX = cardRect.left - stageRect.left + cardWidth / 2;
    restY = cardRect.top - stageRect.top;
    const anchorX = anchorRect
      ? anchorRect.left - stageRect.left + anchorRect.width / 2
      : stage.clientWidth / 2;
    const anchorY = anchorRect
      ? anchorRect.top - stageRect.top + anchorRect.height / 2
      : 36;

    return { anchorX, anchorY };
  }

  const clipPoint = () => rope.points[rope.top];
  const tailPoint = () => rope.points[rope.top + 1];
  const restTransform = () => (spinTarget ? "rotateY(180deg)" : "");

  function render() {
    if (!rope) return;
    const top = clipPoint();
    const tail = tailPoint();
    const dx = top.x - restX;
    const dy = top.y - restY;
    const angle = Math.atan2(-(tail.x - top.x), tail.y - top.y);

    card.style.transform = [
      `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`,
      `rotateZ(${((angle * 180) / Math.PI).toFixed(3)}deg)`,
      `rotateY(${((spin * 180) / Math.PI).toFixed(2)}deg)`,
    ].join(" ");
    card.classList.toggle(
      "is-turning",
      Math.abs(spin - spinTarget) > 0.01 || Math.abs(spinVelocity) > 0.05,
    );

    // The strap is fixed at the peg and turns with the clip, so the twist
    // grows down its length. Edge-on, only the black edge shows.
    const strapPoints = rope.points.slice(0, rope.top + 1);
    const strap = sampleCurve(strapPoints, 4);
    const twist = (t) => Math.abs(Math.cos(spin * t));
    strapEdge?.setAttribute("d", ribbonPath(strap, (t) => Math.max(1.4, STRAP_HALF * twist(t))));
    strapFace?.setAttribute("d", ribbonPath(strap, (t) => STRAP_FACE_HALF * twist(t)));
    strapStitch?.setAttribute("d", smoothPath(strapPoints));
    // The printed side turns away as the strap twists.
    if (strapPrint) strapPrint.style.opacity = ((1 + Math.cos(spin)) / 2).toFixed(3);

    if (shadow) {
      const drift = clamp(Math.abs(dx) / Math.max(1, cardWidth), 0, 1);
      const width = cardWidth * 0.72;
      const scale = (1 - drift * 0.22) * Math.max(0.2, Math.abs(Math.cos(spin)));
      shadow.style.transform = [
        `translate3d(${(restX + dx * 0.46 - width / 2).toFixed(1)}px, ${(restY + cardHeight + 14 + dy * 0.12).toFixed(1)}px, 0)`,
        `scaleX(${scale.toFixed(3)})`,
      ].join(" ");
      shadow.style.opacity = `${(0.48 - drift * 0.2).toFixed(2)}`;
    }
  }

  function reset({ drop = false } = {}) {
    const { anchorX, anchorY } = measure();
    const length = Math.max(60, restY - anchorY);
    if (shadow) {
      shadow.style.width = `${Math.max(120, cardWidth * 0.72)}px`;
    }
    // A uniform card hung from its top edge swings like a pendulum two
    // thirds of its height long; that is where the tail point sits.
    rope = createRope({
      anchor: { x: anchorX, y: anchorY },
      length,
      segments: 7,
      tail: Math.max(40, cardHeight * (2 / 3)),
    });
    spin = spinTarget;
    spinVelocity = 0;
    dragPin = null;
    dragging = false;
    activePointer = null;
    pending = 0;
    stage.classList.remove("is-dragging");

    if (drop && !reduce) {
      // Start the whole pass swung out to one side and let it fall in.
      const swing = 0.32;
      const cos = Math.cos(swing);
      const sin = Math.sin(swing);
      for (const point of rope.points) {
        const rx = point.x - anchorX;
        const ry = point.y - anchorY;
        point.x = anchorX + rx * cos - ry * sin;
        point.y = anchorY + rx * sin + ry * cos;
        point.px = point.x;
        point.py = point.y;
      }
    }

    render();
    start();
  }

  function simulate(seconds) {
    pending = Math.min(pending + seconds, STEP * 8);
    while (pending >= STEP) {
      pending -= STEP;
      stepRope(rope, STEP, {
        gravity: GRAVITY,
        drag: AIR_DRAG,
        pin: dragging ? dragPin : null,
        passes: 12,
      });
      spinVelocity +=
        ((spinTarget - spin) * SPIN_STIFFNESS - spinVelocity * SPIN_DAMPING) * STEP;
      spin += spinVelocity * STEP;
      if (!dragging) rope.stretch *= Math.exp(-STRAP_RECOIL * STEP);
    }
  }

  function isSettled() {
    if (dragging) return false;
    if (Math.abs(spin - spinTarget) > 0.002 || Math.abs(spinVelocity) > 0.01) return false;
    if (rope.stretch > 0.05) return false;
    const top = clipPoint();
    const tail = tailPoint();
    for (const point of [top, tail]) {
      if (Math.abs(point.x - point.px) > 0.02 || Math.abs(point.y - point.py) > 0.02) {
        return false;
      }
    }
    // Only the sideways position: under gravity the strap sags a pixel or
    // two below the measured rest, and that is where it should stay.
    return Math.abs(top.x - restX) < 0.3 && Math.abs(tail.x - restX) < 0.3;
  }

  function frame(time) {
    frameRequest = 0;
    if (destroyed || reduce || !visible || document.hidden || !rope) return;

    const seconds = lastTime ? (time - lastTime) / 1000 : STEP;
    lastTime = time;
    simulate(seconds);

    if (isSettled()) {
      // Stop where the physics left it; snapping would make a small jump.
      spin = spinTarget;
      spinVelocity = 0;
      lastTime = 0;
      pending = 0;
      render();
      card.style.willChange = "auto";
      return;
    }

    render();
    frameRequest = requestAnimationFrame(frame);
  }

  function start() {
    if (frameRequest || reduce || !visible || document.hidden || !rope) return;
    card.style.willChange = "transform";
    lastTime = 0;
    frameRequest = requestAnimationFrame(frame);
  }

  function stop() {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    lastTime = 0;
  }

  function localPoint(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function isInteractive(target) {
    return Boolean(
      target.closest("a, button, input, textarea, select, label, [data-no-drag]"),
    );
  }

  function canStartDrag(event) {
    if (event.button !== undefined && event.button !== 0) return false;
    if (isInteractive(event.target)) return false;
    if (event.pointerType === "mouse") return true;
    // On touch, only the clip is a drag handle so a swipe still scrolls.
    return Boolean(event.target.closest(".pass-grip"));
  }

  function onPointerDown(event) {
    if (reduce || !rope || !canStartDrag(event)) return;
    event.preventDefault();
    const point = localPoint(event);
    const top = clipPoint();
    const tail = tailPoint();
    // Hold the card where it was grabbed: project the pointer onto the
    // card's long axis, so the card turns around that point while dragged.
    const ax = tail.x - top.x;
    const ay = tail.y - top.y;
    const along = ((point.x - top.x) * ax + (point.y - top.y) * ay) / (rope.tail * rope.tail);
    const at = clamp(along, 0, cardHeight / rope.tail);
    const held = { x: top.x + ax * at, y: top.y + ay * at };
    dragOffset = { x: point.x - held.x, y: point.y - held.y };
    dragPin = { ...held, at };
    dragging = true;
    moved = false;
    startPoint = point;
    activePointer = event.pointerId;
    stage.classList.add("is-dragging");
    card.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== activePointer || !rope) return;
    const point = localPoint(event);
    if (!moved) {
      const distance = startPoint
        ? Math.hypot(point.x - startPoint.x, point.y - startPoint.y)
        : 0;
      if (distance <= 4) return;
      moved = true;
    }
    event.preventDefault();
    const minX = Math.min(stage.clientWidth / 2, cardWidth / 2 + 8);
    const maxX = stage.clientWidth - minX;
    let x = clamp(point.x - dragOffset.x, minX, maxX);
    let y = Math.max(point.y - dragOffset.y, rope.anchor.y + 8);
      const reach = rope.length + rope.tail * dragPin.at;
    const fromX = x - rope.anchor.x;
    const fromY = y - rope.anchor.y;
    const distance = Math.hypot(fromX, fromY);
    // Past its length the strap stretches, harder the further it goes.
    const give = rope.length * STRAP_STRETCH;
    const stretch = distance > reach ? give * (1 - Math.exp(-(distance - reach) / give)) : 0;
    rope.stretch = stretch;
    if (distance > reach) {
      x = rope.anchor.x + (fromX * (reach + stretch)) / distance;
      y = rope.anchor.y + (fromY * (reach + stretch)) / distance;
    }
    dragPin = { x, y, at: dragPin.at };
    start();
  }

  function finishDrag(event) {
    if (!dragging || (event && event.pointerId !== activePointer)) return;
    const wasMoved = moved;
    dragging = false;
    activePointer = null;
    dragPin = null;
    moved = false;
    startPoint = null;
    stage.classList.remove("is-dragging");
    if (event && card.hasPointerCapture?.(event.pointerId)) {
      card.releasePointerCapture(event.pointerId);
    }
    if (wasMoved) {
      card.dataset.justDragged = "true";
      if (justDraggedTimer) clearTimeout(justDraggedTimer);
      justDraggedTimer = setTimeout(() => {
        delete card.dataset.justDragged;
        justDraggedTimer = 0;
      }, 250);
    }
  }

  function nudge(direction) {
    if (reduce || !rope) return;
    // A push on the lower half of the card: it swings and turns a little.
    tailPoint().px -= direction * 5;
    clipPoint().px -= direction * 1.5;
    spinVelocity += direction * 1.2;
    start();
  }

  /** Turn the pass to show its back (true) or its front (false). */
  function setFlipped(value) {
    const target = value ? Math.PI : 0;
    if (target === spinTarget) return;
    const direction = target > spinTarget ? 1 : -1;
    spinTarget = target;
    if (reduce || !rope || !visible || document.hidden) {
      spin = spinTarget;
      spinVelocity = 0;
      card.style.transform = restTransform();
      if (rope && !reduce) render();
      return;
    }
    // Flicking the card over also pushes it a little along its swing.
    tailPoint().px -= direction * 2.5;
    start();
  }

  function onKeyDown(event) {
    if (reduce) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      nudge(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      reset({ drop: false });
    }
  }

  function onVisibilityChange() {
    if (document.hidden) stop();
    else start();
  }

  function onResize() {
    if (resizeRequest) return;
    resizeRequest = requestAnimationFrame(() => {
      resizeRequest = 0;
      if (!destroyed) reset({ drop: false });
    });
  }

  function setReduced(value) {
    reduce = value;
    card.tabIndex = reduce ? -1 : 0;
    if (reduce) {
      stop();
      dragging = false;
      dragPin = null;
      stage.classList.remove("is-dragging");
      stage.dataset.motion = "static";
      reset({ drop: false });
      card.style.transform = restTransform();
      card.style.willChange = "auto";
    } else {
      delete stage.dataset.motion;
      reset({ drop: !dropped });
      dropped = true;
    }
    if (hint) hint.hidden = reduce;
  }

  const onMotionPreference = () => {
    if (!forcedReduced) setReduced(reduceQuery.matches);
  };

  let observer = null;
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible) start();
        else stop();
      },
      { threshold: 0.05 },
    );
    observer.observe(stage);
  }

  let resizeObserver = null;
  if ("ResizeObserver" in window) {
    // The observer fires once as soon as it starts observing. Skipping
    // that first callback keeps the opening drop from being reset.
    let observedOnce = false;
    resizeObserver = new ResizeObserver(() => {
      if (!observedOnce) {
        observedOnce = true;
        return;
      }
      onResize();
    });
    resizeObserver.observe(card);
    resizeObserver.observe(stage);
  }

  card.addEventListener("pointerdown", onPointerDown);
  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", finishDrag);
  card.addEventListener("pointercancel", finishDrag);
  card.addEventListener("lostpointercapture", finishDrag);
  card.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener("change", onMotionPreference);
  } else {
    reduceQuery.addListener?.(onMotionPreference);
  }

  setReduced(reduce);
  dropped = true;

  return {
    destroy() {
      destroyed = true;
      stop();
      if (resizeRequest) cancelAnimationFrame(resizeRequest);
      if (justDraggedTimer) clearTimeout(justDraggedTimer);
      observer?.disconnect();
      resizeObserver?.disconnect();
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", finishDrag);
      card.removeEventListener("pointercancel", finishDrag);
      card.removeEventListener("lostpointercapture", finishDrag);
      card.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (reduceQuery.removeEventListener) {
        reduceQuery.removeEventListener("change", onMotionPreference);
      } else {
        reduceQuery.removeListener?.(onMotionPreference);
      }
      delete stage.dataset.motion;
    },
    nudge,
    setFlipped,
  };
}
