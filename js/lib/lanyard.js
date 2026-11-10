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
 * anchor; the last point is where the pass hangs.
 */
export function createRope({ anchor, length, segments = 7 }) {
  const count = Math.max(2, Math.round(segments));
  const segment = Math.max(1, length) / (count - 1);
  const points = Array.from({ length: count }, (_, index) => {
    const y = anchor.y + segment * index;
    return { x: anchor.x, y, px: anchor.x, py: y };
  });
  return {
    anchor: { x: anchor.x, y: anchor.y },
    length: segment * (count - 1),
    segment,
    points,
  };
}

/**
 * One physics step. `pin` locks the free end to a pointer position while
 * dragging, but keeps the previous point so the card has velocity when
 * the pointer is released.
 */
export function stepRope(
  rope,
  dt,
  { gravity = 2400, damping = 0.996, windX = 0, pin = null, passes = 6 } = {},
) {
  const seconds = clamp(dt, 0, 0.033);
  const points = rope.points;
  const gravityStep = gravity * seconds * seconds;
  const windStep = windX * seconds * seconds;

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    const velocityX = (point.x - point.px) * damping;
    const velocityY = (point.y - point.py) * damping;
    point.px = point.x;
    point.py = point.y;
    point.x += velocityX + windStep;
    point.y += velocityY + gravityStep;
  }

  const anchor = rope.anchor;
  points[0].x = anchor.x;
  points[0].y = anchor.y;
  points[0].px = anchor.x;
  points[0].py = anchor.y;

  const last = points.length - 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let index = 0; index < last; index++) {
      const first = points[index];
      const second = points[index + 1];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy) || 0.0001;
      const correction = (distance - rope.segment) / distance;
      const firstWeight = index === 0 ? 0 : 0.5;
      const secondWeight = index === 0 ? 1 : 0.5;
      first.x += dx * correction * firstWeight;
      first.y += dy * correction * firstWeight;
      second.x -= dx * correction * secondWeight;
      second.y -= dy * correction * secondWeight;
    }

    points[0].x = anchor.x;
    points[0].y = anchor.y;
    if (pin) {
      points[last].x = pin.x;
      points[last].y = pin.y;
    }
  }

  if (pin) {
    points[last].x = pin.x;
    points[last].y = pin.y;
  }
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

/**
 * Wire the pass to the stage. Returns null when the markup is not there,
 * so profile.js can mount before the panel exists without guarding every
 * call site.
 */
export function mountLanyard(stage, { reducedMotion = false } = {}) {
  if (!stage) return null;
  const card = stage.querySelector(".member-pass");
  if (!card) return null;

  const paths = [...stage.querySelectorAll(".pass-strap-edge, .pass-strap-face, .pass-strap-stitch")];
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
  let angle = 0;
  let angleVelocity = 0;
  let tiltX = 0;
  let tiltY = 0;
  let dragging = false;
  let dragPin = null;
  let dragOffset = { x: 0, y: 0 };
  let activePointer = null;
  let visible = true;
  let frameRequest = 0;
  let lastTime = 0;
  let dropped = false;
  let destroyed = false;
  let resizeRequest = 0;
  let moved = false;
  let startPoint = null;
  let settleFrames = 0;
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

  function render() {
    if (!rope) return;
    const end = rope.points[rope.points.length - 1];
    const dx = end.x - restX;
    const dy = end.y - restY;

    card.style.transform = [
      `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`,
      `rotateZ(${((angle * 180) / Math.PI).toFixed(3)}deg)`,
      `rotateY(${tiltY.toFixed(2)}deg)`,
      `rotateX(${tiltX.toFixed(2)}deg)`,
    ].join(" ");

    const path = smoothPath(rope.points);
    for (const element of paths) element.setAttribute("d", path);

    if (shadow) {
      const drift = clamp(Math.abs(dx) / Math.max(1, cardWidth), 0, 1);
      const width = cardWidth * 0.72;
      const scale = 1 - drift * 0.22;
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
    rope = createRope({
      anchor: { x: anchorX, y: anchorY },
      length,
      segments: 7,
    });
    angle = 0;
    angleVelocity = 0;
    tiltX = 0;
    tiltY = 0;
    dragPin = null;
    dragging = false;
    activePointer = null;
    stage.classList.remove("is-dragging");

    if (drop && !reduce) {
      const last = rope.points.length - 1;
      rope.points.forEach((point, index) => {
        const t = index / last;
        point.x = anchorX + 54 * t;
        point.y = anchorY + 10 + index * 5;
        point.px = point.x - 2;
        point.py = point.y - 3;
      });
      rope.points[0].x = anchorX;
      rope.points[0].y = anchorY;
      angle = 0.22;
    }

    render();
    start();
  }

  function frame(time) {
    frameRequest = 0;
    if (destroyed || reduce || !visible || document.hidden || !rope) return;

    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.033) : 1 / 60;
    lastTime = time;
    const last = rope.points[rope.points.length - 1];
    const previous = rope.points[rope.points.length - 2];

    stepRope(rope, dt, {
      gravity: 2400,
      damping: 0.97,
      pin: dragging ? dragPin : null,
      passes: 6,
    });

    const anchorX = rope.anchor.x;
    const targetAngle = clamp(
      Math.atan2(last.x - previous.x, Math.max(26, last.y - previous.y)) * 0.75,
      -0.7,
      0.7,
    );
    angleVelocity += (targetAngle - angle) * 150 * dt;
    angleVelocity *= Math.exp(-9 * dt);
    angle += angleVelocity * dt;
    angle = clamp(angle, -0.8, 0.8);

    const velocityX = last.x - last.px;
    const velocityY = last.y - last.py;
    const targetTiltY = clamp(
      velocityX * 1.7 + (last.x - anchorX) * 0.1,
      -18,
      18,
    );
    const targetTiltX = clamp(
      -velocityY * 1.2 - (last.y - restY) * 0.02,
      -14,
      14,
    );
    const ease = 1 - Math.exp(-10 * dt);
    tiltY += (targetTiltY - tiltY) * ease;
    tiltX += (targetTiltX - tiltX) * ease;

    const speed = Math.hypot(velocityX, velocityY);
    const still =
      !dragging &&
      Math.abs(last.x - restX) < 6 &&
      Math.abs(last.y - restY) < 6 &&
      speed < 0.8 &&
      Math.abs(angle) < 0.04 &&
      Math.abs(tiltX) < 1.2 &&
      Math.abs(tiltY) < 1.2;
    settleFrames = still ? settleFrames + 1 : 0;
    if (settleFrames > 18) {
      snapToRest();
      return;
    }

    render();
    frameRequest = requestAnimationFrame(frame);
  }

  function snapToRest() {
    const anchor = rope.anchor;
    rope.points.forEach((point, index) => {
      point.x = anchor.x;
      point.y = anchor.y + rope.segment * index;
      point.px = point.x;
      point.py = point.y;
    });
    angle = 0;
    angleVelocity = 0;
    tiltX = 0;
    tiltY = 0;
    settleFrames = 0;
    lastTime = 0;
    render();
    card.style.transform = "";
    card.style.willChange = "auto";
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
    const end = rope.points[rope.points.length - 1];
    dragOffset = { x: point.x - end.x, y: point.y - end.y };
    dragPin = { x: end.x, y: end.y };
    dragging = true;
    moved = false;
    startPoint = point;
    activePointer = event.pointerId;
    stage.classList.add("is-dragging");
    card.setPointerCapture?.(event.pointerId);
    lastTime = 0;
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
      start();
    }
    event.preventDefault();
    const halfCard = cardWidth / 2;
    const minX = Math.min(stage.clientWidth / 2, halfCard + 8);
    const maxX = stage.clientWidth - minX;
    const maxY = restY + Math.min(160, cardHeight * 0.28);
    dragPin = {
      x: clamp(point.x - dragOffset.x, minX, maxX),
      y: clamp(
        point.y - dragOffset.y,
        rope.anchor.y + 8,
        maxY,
      ),
    };
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
    settleFrames = 0;
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
    const last = rope.points[rope.points.length - 1];
    last.px -= direction * 12;
    last.py += 2;
    angleVelocity += direction * 1.9;
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
      card.style.transform = "";
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
  };
}
