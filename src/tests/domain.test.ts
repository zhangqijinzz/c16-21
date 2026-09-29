import { describe, expect, it } from 'vitest';
import {
  cropForRatio,
  moveCrop,
  resizeCrop,
  snapCropMove,
  snapCropResize,
  snapPoint,
  type SnapContext,
} from '../domain';
import { DEFAULT_CROP } from '../model';

const snapContext = (locks: SnapContext['locks'] = {}): SnapContext => ({
  guides: { thirds: true, center: true, diagonal: false, golden: true },
  viewportWidth: 1000,
  viewportHeight: 1000,
  locks,
});

const noGuides: SnapContext = {
  guides: { thirds: false, center: false, diagonal: false, golden: false },
  viewportWidth: 1000,
  viewportHeight: 1000,
  locks: {},
};

describe('crop domain rules', () => {
  it('fits a 1:1 crop inside a wide image and centers it', () => {
    const crop = cropForRatio('1:1', 1.5, DEFAULT_CROP);
    expect(crop.width).toBeCloseTo(2 / 3);
    expect(crop.height).toBe(1);
    expect(crop.x).toBeCloseTo(1 / 6);
  });

  it('clamps movement to the image boundary', () => {
    const crop = moveCrop({ ...DEFAULT_CROP, width: 0.5, height: 0.5 }, 0.9, -0.9);
    expect(crop.x).toBe(0.5);
    expect(crop.y).toBe(0);
  });

  it('keeps a selected ratio while resizing', () => {
    const crop = resizeCrop({ ...DEFAULT_CROP, ratio: '16:9', width: 0.5, height: 0.28125 }, 0.8, 0.8);
    expect(crop.width).toBe(0.8);
    expect(crop.height).toBeCloseTo(0.45);
  });

  it('snaps a moving crop edge to an enabled thirds guide', () => {
    const result = snapCropMove({ ...DEFAULT_CROP, x: 0.326, y: 0, width: 0.4, height: 0.4 }, snapContext());
    expect(result.value.x).toBeCloseTo(1 / 3);
    expect(result.hints).toContainEqual({ axis: 'x', position: 1 / 3 });
  });

  it('snaps a subject point independently on each axis', () => {
    const result = snapPoint({ x: 0.498, y: 0.62 }, snapContext());
    expect(result.value.x).toBe(0.5);
    expect(result.value.y).toBeCloseTo(0.618, 2);
  });

  it('does not snap when all guide layers are closed', () => {
    const result = snapPoint({ x: 0.502, y: 0.334 }, noGuides);
    expect(result.value).toEqual({ x: 0.502, y: 0.334 });
    expect(result.hints).toEqual([]);
  });

  it('keeps an active snap until the pointer leaves the wider release range', () => {
    const first = snapPoint({ x: 0.334, y: 0.5 }, snapContext());
    expect(first.value.x).toBeCloseTo(1 / 3);
    const held = snapPoint({ x: 0.341, y: 0.5 }, snapContext(first.locks));
    expect(held.value.x).toBeCloseTo(1 / 3);
    const released = snapPoint({ x: 0.350, y: 0.55 }, snapContext(held.locks));
    expect(released.value.x).toBe(0.35);
    expect(released.hints).toEqual([]);
  });

  it('prefers the closest deterministic candidate when candidates compete', () => {
    const result = snapPoint({ x: 0.496, y: 0.5 }, snapContext());
    expect(result.value.x).toBe(0.5);
    expect(result.locks.x?.position).toBe(0.5);
  });

  it('rejects a move snap that would push the crop outside the image', () => {
    const result = snapCropMove(
      { ...DEFAULT_CROP, x: 0, y: 0, width: 0.9, height: 0.2 },
      snapContext(),
    );
    expect(result.value.x).toBe(0);
    expect(result.hints.find((hint) => hint.axis === 'x')).toBeUndefined();
  });

  it('rejects a resize snap smaller than the minimum operable size', () => {
    const result = snapCropResize(
      { ...DEFAULT_CROP, x: 0, y: 0, width: 0.2, height: 0.2 },
      0.119,
      0.119,
      snapContext(),
    );
    expect(result.value.width).toBe(0.12);
    expect(result.value.height).toBe(0.12);
    expect(result.hints).toEqual([]);
  });

  it('snaps the edge while preserving a locked ratio inside a wide image', () => {
    const result = snapCropResize(
      { ...DEFAULT_CROP, ratio: '16:9', x: 0, y: 0.1, width: 0.5, height: 0.28125 },
      2 / 3,
      0.28125,
      snapContext(),
    );
    expect(result.value.width).toBeCloseTo(2 / 3);
    expect(result.value.x + result.value.width).toBeLessThanOrEqual(1);
    expect(result.hints[0]).toEqual({ axis: 'x', position: 2 / 3 });
  });
});
