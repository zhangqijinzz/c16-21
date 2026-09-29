import { describe, expect, it } from 'vitest';
import { guideSnapLines, snapMoveCrop, snapResizeCrop, snapSubject } from '../snap';
import type { CropVariant } from '../model';

const THRESHOLD = 0.02;

const crop = (over: Partial<CropVariant>): CropVariant => ({ id: 'current', x: 0, y: 0, width: 0.5, height: 0.5, ratio: 'free', ...over });

describe('guideSnapLines', () => {
  it('returns no lines when every guide is off', () => {
    const lines = guideSnapLines({ thirds: false, center: false, diagonal: false, golden: false });
    expect(lines.x).toHaveLength(0);
    expect(lines.y).toHaveLength(0);
  });

  it('builds thirds, center and golden reference positions', () => {
    const thirds = guideSnapLines({ thirds: true, center: false, diagonal: false, golden: false });
    expect(thirds.x.map((l) => l.position)).toEqual([1 / 3, 2 / 3]);
    expect(thirds.y.map((l) => l.position)).toEqual([1 / 3, 2 / 3]);

    const center = guideSnapLines({ thirds: false, center: true, diagonal: false, golden: false });
    expect(center.x.map((l) => l.position)).toEqual([0.5]);

    const golden = guideSnapLines({ thirds: false, center: false, diagonal: false, golden: true });
    expect(golden.x.map((l) => l.position)).toHaveLength(2);
    expect(golden.x[0].position).toBeCloseTo(0.381966, 4);
    expect(golden.x[1].position).toBeCloseTo(0.618034, 4);
  });
});

describe('snapMoveCrop', () => {
  it('snaps the left edge to a thirds line when close', () => {
    const lines = guideSnapLines({ thirds: true, center: false, diagonal: false, golden: false });
    const result = snapMoveCrop(crop({ x: 0.32, y: 0.2 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    expect(result.crop.x).toBeCloseTo(1 / 3);
    expect(result.activeX).toHaveLength(1);
    expect(result.activeX[0].guide).toBe('thirds');
  });

  it('snaps the right edge to the center line', () => {
    const lines = guideSnapLines({ thirds: false, center: true, diagonal: false, golden: false });
    const result = snapMoveCrop(crop({ x: 0.1, width: 0.4 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    // right edge at 0.5 -> x = 0.1
    expect(result.crop.x).toBeCloseTo(0.1);
    expect(result.activeX[0].guide).toBe('center');
  });

  it('snaps the horizontal center to a golden line', () => {
    const lines = guideSnapLines({ thirds: false, center: false, diagonal: false, golden: true });
    const result = snapMoveCrop(crop({ y: 0.36, height: 0.3 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    // vertical center at 0.51 ~ golden 0.5? no: center y = y + h/2 = 0.51, golden lines 0.382/0.618 -> no
    expect(result.activeY).toHaveLength(0);
    const near = snapMoveCrop(crop({ y: 0.468, height: 0.3 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    // center at 0.618 -> y = 0.468
    expect(near.crop.y).toBeCloseTo(0.468);
    expect(near.activeY[0].guide).toBe('golden');
  });

  it('stays free when no guide is within range', () => {
    const lines = guideSnapLines({ thirds: true, center: true, diagonal: false, golden: true });
    const result = snapMoveCrop(crop({ x: 0.05, y: 0.05, width: 0.2, height: 0.2 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    expect(result.crop.x).toBe(0.05);
    expect(result.crop.y).toBe(0.05);
    expect(result.activeX).toHaveLength(0);
    expect(result.activeY).toHaveLength(0);
  });

  it('clamps to the image bounds instead of pushing the frame outside', () => {
    const lines = guideSnapLines({ thirds: true, center: false, diagonal: false, golden: false });
    const result = snapMoveCrop(crop({ x: 0.9, width: 0.5 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.crop.x).toBeGreaterThanOrEqual(0);
  });

  it('keeps snapping stable and does not jump between two equally close candidates', () => {
    const lines = guideSnapLines({ thirds: true, center: true, diagonal: false, golden: false });
    const free = { x: (1 / 3 + 0.5) / 2, y: 0.2 };
    const first = snapSubject(free, lines, 0.1, 0.1, { x: null, y: null });
    // two lines are equidistant; the smaller reference position wins deterministically
    expect(first.x).toBeCloseTo(1 / 3);
    // repeated calls with the same input keep the same choice
    const second = snapSubject(free, lines, 0.1, 0.1, { x: null, y: null });
    expect(second.x).toBeCloseTo(1 / 3);
  });

  it('keeps a frame edge aligned when both edges land on guides at once', () => {
    const lines = guideSnapLines({ thirds: true, center: false, diagonal: false, golden: false });
    // frame spans exactly one third: left at 1/3 -> right at 2/3, both align
    const result = snapMoveCrop(crop({ x: 1 / 3, width: 1 / 3 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    expect(result.crop.x).toBeCloseTo(1 / 3);
    expect(result.activeX.map((l) => l.position).sort()).toEqual([1 / 3, 2 / 3]);
  });

  it('holds a snap while still in range and releases once the pointer leaves it', () => {
    const lines = guideSnapLines({ thirds: true, center: false, diagonal: false, golden: false });
    const first = snapMoveCrop(crop({ x: 0.32 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    expect(first.crop.x).toBeCloseTo(1 / 3);
    expect(first.stateX).not.toBeNull();
    // still within snap range: stays on the guide
    const held = snapMoveCrop(crop({ x: 0.325 }), lines, THRESHOLD, THRESHOLD, { x: first.stateX, y: null });
    expect(held.crop.x).toBeCloseTo(1 / 3);
    // moved away: released and free
    const released = snapMoveCrop(crop({ x: 0.45 }), lines, THRESHOLD, THRESHOLD, { x: first.stateX, y: null });
    expect(released.crop.x).toBe(0.45);
    expect(released.activeX).toHaveLength(0);
  });
});

describe('snapResizeCrop', () => {
  it('snaps the right edge to the center line', () => {
    const lines = guideSnapLines({ thirds: false, center: true, diagonal: false, golden: false });
    const result = snapResizeCrop(crop({ x: 0.1, width: 0.39 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null }, 'free');
    expect(result.crop.width).toBeCloseTo(0.4);
    expect(result.activeX[0].guide).toBe('center');
  });

  it('keeps the crop at an operable size and inside the image', () => {
    const lines = guideSnapLines({ thirds: true, center: true, diagonal: false, golden: true });
    const result = snapResizeCrop(crop({ x: 0.85, width: 0.05 }), lines, THRESHOLD, THRESHOLD, { x: null, y: null }, 'free');
    expect(result.crop.width).toBeGreaterThanOrEqual(0.12);
    expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('snapSubject', () => {
  it('snaps the subject point to center lines', () => {
    const lines = guideSnapLines({ thirds: false, center: true, diagonal: false, golden: false });
    const result = snapSubject({ x: 0.49, y: 0.51 }, lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(0.5);
    expect(result.activeX[0].guide).toBe('center');
    expect(result.activeY[0].guide).toBe('center');
  });

  it('does not snap when all guides are off', () => {
    const lines = guideSnapLines({ thirds: false, center: false, diagonal: false, golden: false });
    const result = snapSubject({ x: 0.49, y: 0.51 }, lines, THRESHOLD, THRESHOLD, { x: null, y: null });
    expect(result.x).toBe(0.49);
    expect(result.y).toBe(0.51);
    expect(result.activeX).toHaveLength(0);
    expect(result.activeY).toHaveLength(0);
  });
});
