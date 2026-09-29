import type { CropVariant, FrameDocument, GuideKey, Ratio } from './model';

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export function normalizeCrop(crop: CropVariant): CropVariant {
  const width = clamp(crop.width, 0.12, 1);
  const height = clamp(crop.height, 0.12, 1);
  return {
    ...crop,
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
    width,
    height,
  };
}

export function cropForRatio(ratio: Ratio, imageRatio: number, current: CropVariant): CropVariant {
  if (ratio === 'free') return { ...current, ratio };
  const [w, h] = ratio.split(':').map(Number);
  const target = w / h;
  let width = 1;
  let height = 1;
  if (target > imageRatio) height = Math.min(1, imageRatio / target);
  else width = Math.min(1, target / imageRatio);
  return normalizeCrop({
    ...current,
    ratio,
    width,
    height,
    x: (1 - width) / 2,
    y: (1 - height) / 2,
  });
}

export function moveCrop(crop: CropVariant, dx: number, dy: number): CropVariant {
  return normalizeCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

export function resizeCrop(crop: CropVariant, width: number, height: number): CropVariant {
  const nextWidth = width;
  let nextHeight = height;
  if (crop.ratio !== 'free') {
    const [w, h] = crop.ratio.split(':').map(Number);
    nextHeight = nextWidth / (w / h);
  }
  return normalizeCrop({ ...crop, width: nextWidth, height: nextHeight });
}

export function makeVariant(crop: CropVariant, id: string): CropVariant {
  return { ...normalizeCrop(crop), id };
}

export function isFrameDocument(value: unknown): value is FrameDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FrameDocument>;
  return candidate.version === 1 && typeof candidate.guides === 'object' && candidate.crop !== undefined && Array.isArray(candidate.variants);
}

export type SnapAxis = 'x' | 'y';
export type SnapAnchor = 'start' | 'center' | 'end' | 'point';

export interface SnapHint {
  axis: SnapAxis;
  position: number;
}

export interface SnapLock {
  axis: SnapAxis;
  position: number;
  anchor: SnapAnchor;
}

export interface SnapContext {
  guides: Record<GuideKey, boolean>;
  viewportWidth: number;
  viewportHeight: number;
  imageRatio?: number;
  locks: Partial<Record<SnapAxis, SnapLock>>;
  enterInPixels?: number;
  exitInPixels?: number;
}

export interface SnapResult<T> {
  value: T;
  hints: SnapHint[];
  locks: Partial<Record<SnapAxis, SnapLock>>;
}

const SNAP_ENTER_PIXELS = 9;
const SNAP_EXIT_PIXELS = 14;
const SNAP_TOLERANCE = 0.00001;
const GOLDEN_RATIO_POSITION = 0.3819660112501051;

interface GuideTarget {
  position: number;
  guideRank: number;
}

interface SnapProposal {
  axis: SnapAxis;
  position: number;
  anchor: SnapAnchor;
  guideRank: number;
  anchorRank: number;
  distance: number;
}

function guideTargets(guides: Record<GuideKey, boolean>): GuideTarget[] {
  const targets: GuideTarget[] = [];
  if (guides.center) targets.push({ position: 0.5, guideRank: 0 });
  if (guides.thirds) targets.push({ position: 1 / 3, guideRank: 1 }, { position: 2 / 3, guideRank: 1 });
  if (guides.golden) {
    targets.push(
      { position: GOLDEN_RATIO_POSITION, guideRank: 2 },
      { position: 1 - GOLDEN_RATIO_POSITION, guideRank: 2 },
    );
  }
  return targets;
}

function proposalDistance(delta: number, pixels: number): number {
  return Math.abs(delta) * pixels;
}

function isSameLock(proposal: SnapProposal, lock: SnapLock): boolean {
  return proposal.axis === lock.axis
    && proposal.anchor === lock.anchor
    && Math.abs(proposal.position - lock.position) < SNAP_TOLERANCE;
}

function compareProposals(a: SnapProposal, b: SnapProposal): number {
  return a.distance - b.distance
    || a.guideRank - b.guideRank
    || a.anchorRank - b.anchorRank
    || a.axis.localeCompare(b.axis)
    || a.position - b.position;
}

function selectSnap(
  proposals: SnapProposal[],
  context: SnapContext,
  axis?: SnapAxis,
): SnapLock | null {
  const enter = context.enterInPixels ?? SNAP_ENTER_PIXELS;
  const exit = context.exitInPixels ?? SNAP_EXIT_PIXELS;
  const scoped = axis ? proposals.filter((proposal) => proposal.axis === axis) : proposals;
  if (scoped.length === 0) return null;

  const activeLock = axis ? context.locks[axis] : Object.values(context.locks)[0];
  if (activeLock) {
    const held = scoped.find((proposal) => isSameLock(proposal, activeLock));
    if (held && held.distance <= exit) {
      return { axis: held.axis, position: held.position, anchor: held.anchor };
    }
  }

  const best = [...scoped].sort(compareProposals)[0];
  if (best.distance <= enter) {
    return { axis: best.axis, position: best.position, anchor: best.anchor };
  }
  return null;
}

function cropAnchorPosition(crop: CropVariant, axis: SnapAxis, anchor: SnapAnchor): number {
  const position = axis === 'x' ? crop.x : crop.y;
  const length = axis === 'x' ? crop.width : crop.height;
  if (anchor === 'center') return position + length / 2;
  if (anchor === 'end') return position + length;
  return position;
}

function normalizeResizeCrop(crop: CropVariant, imageRatio?: number): CropVariant {
  const maxWidth = clamp(1 - crop.x, 0.12, 1);
  const maxHeight = clamp(1 - crop.y, 0.12, 1);
  let width = clamp(crop.width, 0.12, maxWidth);
  let height = clamp(crop.height, 0.12, maxHeight);

  if (crop.ratio !== 'free') {
    const [ratioWidth, ratioHeight] = crop.ratio.split(':').map(Number);
    const targetAspect = ratioWidth / ratioHeight / (imageRatio ?? 1);
    const scale = Math.min(1, maxWidth / width, maxHeight / height, targetAspect / (width / height));
    width *= scale;
    height *= scale;
  }

  return { ...crop, width, height, x: crop.x, y: crop.y };
}

function anchorIsAligned(crop: CropVariant, axis: SnapAxis, anchor: SnapAnchor, target: number): boolean {
  return Math.abs(cropAnchorPosition(crop, axis, anchor) - target) < SNAP_TOLERANCE;
}

export function snapCropMove(rawCrop: CropVariant, context: SnapContext): SnapResult<CropVariant> {
  const freeCrop = normalizeCrop(rawCrop);
  const result = { ...freeCrop };
  const locks: Partial<Record<SnapAxis, SnapLock>> = {};

  (['x', 'y'] as const).forEach((axis) => {
    const positionKey = axis;
    const lengthKey = axis === 'x' ? 'width' : 'height';
    const rawPosition = rawCrop[positionKey];
    const rawLength = rawCrop[lengthKey];
    const pixels = axis === 'x' ? context.viewportWidth : context.viewportHeight;
    const proposals: SnapProposal[] = [];

    guideTargets(context.guides).forEach(({ position, guideRank }) => {
      const anchors: Array<[SnapAnchor, number, number]> = [
        ['center', rawPosition + rawLength / 2, 0],
        ['start', rawPosition, 1],
        ['end', rawPosition + rawLength, 2],
      ];
      anchors.forEach(([anchor, value, anchorRank]) => {
        proposals.push({
          axis,
          position,
          anchor,
          guideRank,
          anchorRank,
          distance: proposalDistance(value - position, pixels),
        });
      });
    });

    const lock = selectSnap(proposals, context, axis);
    if (!lock) return;

    const snappedLength = result[lengthKey];
    const snappedPosition = lock.anchor === 'center'
      ? lock.position - snappedLength / 2
      : lock.anchor === 'end'
        ? lock.position - snappedLength
        : lock.position;
    const candidate = normalizeCrop({ ...result, [positionKey]: snappedPosition });
    if (!anchorIsAligned(candidate, axis, lock.anchor, lock.position)) return;

    result[positionKey] = candidate[positionKey];
    locks[axis] = lock;
  });

  return {
    value: result,
    hints: Object.values(locks).map(({ axis, position }) => ({ axis, position })),
    locks,
  };
}

export function snapCropResize(
  startCrop: CropVariant,
  pointerWidth: number,
  pointerHeight: number,
  context: SnapContext,
): SnapResult<CropVariant> {
  const ratioLocked = startCrop.ratio !== 'free';
  const rawWidth = pointerWidth;
  let rawHeight = pointerHeight;

  if (ratioLocked) {
    const [ratioWidth, ratioHeight] = startCrop.ratio.split(':').map(Number);
    const targetAspect = ratioWidth / ratioHeight / (context.imageRatio ?? 1);
    rawHeight = rawWidth / targetAspect;
  }

  const freeCrop = normalizeResizeCrop({ ...startCrop, width: rawWidth, height: rawHeight }, context.imageRatio);

  if (!ratioLocked) {
    const result = { ...freeCrop };
    const locks: Partial<Record<SnapAxis, SnapLock>> = {};

    (['x', 'y'] as const).forEach((axis) => {
      const lengthKey = axis === 'x' ? 'width' : 'height';
      const fixedPosition = axis === 'x' ? startCrop.x : startCrop.y;
      const rawLength = axis === 'x' ? rawWidth : rawHeight;
      const pixels = axis === 'x' ? context.viewportWidth : context.viewportHeight;
      const proposals: SnapProposal[] = [];

      guideTargets(context.guides).forEach(({ position, guideRank }) => {
        proposals.push({
          axis,
          position,
          anchor: 'end',
          guideRank,
          anchorRank: 0,
          distance: proposalDistance(fixedPosition + rawLength - position, pixels),
        });
        proposals.push({
          axis,
          position,
          anchor: 'center',
          guideRank,
          anchorRank: 1,
          distance: proposalDistance(fixedPosition + rawLength / 2 - position, pixels),
        });
      });

      const lock = selectSnap(proposals, context, axis);
      if (!lock) return;

      const snappedLength = lock.anchor === 'center'
        ? 2 * (lock.position - fixedPosition)
        : lock.position - fixedPosition;
      const candidate = normalizeResizeCrop({ ...result, [lengthKey]: snappedLength });
      if (!anchorIsAligned(candidate, axis, lock.anchor, lock.position)) return;

      result[lengthKey] = candidate[lengthKey];
      locks[axis] = lock;
    });

    return {
      value: result,
      hints: Object.values(locks).map(({ axis, position }) => ({ axis, position })),
      locks,
    };
  }

  const [ratioWidth, ratioHeight] = startCrop.ratio.split(':').map(Number);
  const targetAspect = ratioWidth / ratioHeight / (context.imageRatio ?? 1);
  const proposals: SnapProposal[] = [];

  guideTargets(context.guides).forEach(({ position, guideRank }) => {
    proposals.push({
      axis: 'x',
      position,
      anchor: 'end',
      guideRank,
      anchorRank: 0,
      distance: proposalDistance(startCrop.x + rawWidth - position, context.viewportWidth),
    });
    proposals.push({
      axis: 'x',
      position,
      anchor: 'center',
      guideRank,
      anchorRank: 1,
      distance: proposalDistance(startCrop.x + rawWidth / 2 - position, context.viewportWidth),
    });
  });

  guideTargets(context.guides).forEach(({ position, guideRank }) => {
    proposals.push({
      axis: 'y',
      position,
      anchor: 'end',
      guideRank,
      anchorRank: 0,
      distance: proposalDistance(startCrop.y + rawHeight - position, context.viewportHeight),
    });
    proposals.push({
      axis: 'y',
      position,
      anchor: 'center',
      guideRank,
      anchorRank: 1,
      distance: proposalDistance(startCrop.y + rawHeight / 2 - position, context.viewportHeight),
    });
  });

  const lock = selectSnap(proposals, context);
  if (!lock) {
    return { value: freeCrop, hints: [], locks: {} };
  }

  const ratioDimensions = lock.axis === 'x'
    ? (() => {
        const width = lock.anchor === 'center'
          ? 2 * (lock.position - startCrop.x)
          : lock.position - startCrop.x;
        return { width, height: width / targetAspect };
      })()
    : (() => {
        const height = lock.anchor === 'center'
          ? 2 * (lock.position - startCrop.y)
          : lock.position - startCrop.y;
        return { width: height * targetAspect, height };
      })();
  const candidate = normalizeResizeCrop({ ...startCrop, ...ratioDimensions }, context.imageRatio);
  if (!anchorIsAligned(candidate, lock.axis, lock.anchor, lock.position)) {
    return { value: freeCrop, hints: [], locks: {} };
  }

  return {
    value: candidate,
    hints: [{ axis: lock.axis, position: lock.position }],
    locks: { [lock.axis]: lock },
  };
}

export function snapPoint(
  point: { x: number; y: number },
  context: SnapContext,
): SnapResult<{ x: number; y: number }> {
  const result = { x: clamp(point.x), y: clamp(point.y) };
  const locks: Partial<Record<SnapAxis, SnapLock>> = {};

  (['x', 'y'] as const).forEach((axis) => {
    const rawValue = point[axis];
    const pixels = axis === 'x' ? context.viewportWidth : context.viewportHeight;
    const proposals: SnapProposal[] = guideTargets(context.guides).map(({ position, guideRank }) => ({
      axis,
      position,
      anchor: 'point',
      guideRank,
      anchorRank: 0,
      distance: proposalDistance(rawValue - position, pixels),
    }));
    const lock = selectSnap(proposals, context, axis);
    if (!lock) return;
    result[axis] = clamp(lock.position);
    locks[axis] = lock;
  });

  return {
    value: result,
    hints: Object.values(locks).map(({ axis, position }) => ({ axis, position })),
    locks,
  };
}
