import test from "node:test";
import assert from "node:assert/strict";

import {
  barcodeBars,
  barcodeSVG,
  passSerial,
  shortHost,
} from "./member-pass.js";

test("passSerial is stable and uses the join year", () => {
  const serial = passSerial("0f0e0d0c-1234-5678-9abc-def012345678", "2025-03-14T10:00:00.000Z");
  assert.match(serial, /^FCS-25-[0-9A-Z]{4}$/);
  assert.equal(serial, passSerial("0f0e0d0c-1234-5678-9abc-def012345678", "2025-03-14T10:00:00.000Z"));
});

test("different members get different serials", () => {
  assert.notEqual(
    passSerial("member-one", "2025-01-01T00:00:00.000Z"),
    passSerial("member-two", "2025-01-01T00:00:00.000Z"),
  );
});

test("passSerial falls back to the current year for a bad date", () => {
  assert.match(passSerial("member-one", "not-a-date"), /^FCS-\d{2}-[0-9A-Z]{4}$/);
});

test("barcodeBars is deterministic and stays in range", () => {
  const first = barcodeBars("FCS-25-4F2A");
  const second = barcodeBars("FCS-25-4F2A");
  assert.deepEqual(first, second);
  assert.equal(first.length, 34);

  for (const bar of first) {
    assert.ok(bar.width >= 1 && bar.width <= 3);
    assert.ok(bar.gap >= 1 && bar.gap <= 3);
  }
});

test("barcodeSVG draws one rect per bar", () => {
  const svg = barcodeSVG("FCS-25-4F2A");
  assert.match(svg, /^<svg /);
  assert.equal(svg.match(/<rect /g)?.length, 34);
  assert.match(svg, /viewBox="0 0 \d+ 20"/);
});

test("shortHost strips the scheme and www", () => {
  assert.equal(shortHost("https://www.example.com/about"), "example.com");
  assert.equal(shortHost("http://ada.example.com"), "ada.example.com");
  assert.equal(shortHost("not a url"), "");
  assert.equal(shortHost("javascript:alert(1)"), "");
});
