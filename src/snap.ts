import type { CropVariant, GuideKey } from './model';

/**
 * 拖动吸附模块。
 *
 * 只根据「当前拖动中的几何形状」和「已开启的辅助线」计算落点，
 * 不触碰任何已保存的方案数据；辅助线全部关闭时没有任何候选，自然不吸附。
 * 吸附结果始终落在图片范围内，不会把裁切框推出画面或缩到无法操作。
 */

export interface SnapLine {
  axis: 'x' | 'y';
  /** 归一化坐标 0..1：x 轴为竖直线的 x，y 轴为水平线的 y */
  position: number;
  guide: GuideKey;
}

/** 吸附状态，用于在连续拖动中保持稳定、避免来回跳 */
export interface SnapState {
  key: string;
}

export interface SnapResult {
  crop: CropVariant;
  activeX: SnapLine[];
  activeY: SnapLine[];
  stateX: SnapState | null;
  stateY: SnapState | null;
}

/** 屏幕像素吸附半径，拖动时按舞台尺寸换算成归一化坐标 */
export const SNAP_THRESHOLD_PX = 12;

const MIN_CROP = 0.12;

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const GOLDEN_SHORT = 1 / (GOLDEN_RATIO * GOLDEN_RATIO); // ≈ 0.381966
const GOLDEN_LONG = 1 / GOLDEN_RATIO; // ≈ 0.618034

export const GUIDE_LABELS: Record<GuideKey, string> = {
  thirds: '三分线',
  center: '中心线',
  diagonal: '对角线',
  golden: '黄金分割',
};

/** 当前已开启辅助线产生的全部参考线（对角线不产生轴对齐吸附线） */
export function guideSnapLines(guides: Record<GuideKey, boolean>): { x: SnapLine[]; y: SnapLine[] } {
  const x: SnapLine[] = [];
  const y: SnapLine[] = [];
  const push = (axis: 'x' | 'y', position: number, guide: GuideKey) => {
    const line: SnapLine = { axis, position, guide };
    if (axis === 'x') x.push(line);
    else y.push(line);
  };
  if (guides.thirds) {
    push('x', 1 / 3, 'thirds');
    push('x', 2 / 3, 'thirds');
    push('y', 1 / 3, 'thirds');
    push('y', 2 / 3, 'thirds');
  }
  if (guides.center) {
    push('x', 0.5, 'center');
    push('y', 0.5, 'center');
  }
  if (guides.golden) {
    push('x', GOLDEN_SHORT, 'golden');
    push('x', GOLDEN_LONG, 'golden');
    push('y', GOLDEN_SHORT, 'golden');
    push('y', GOLDEN_LONG, 'golden');
  }
  x.sort((a, b) => a.position - b.position);
  y.sort((a, b) => a.position - b.position);
  return { x, y };
}

interface Edge {
  key: string;
  order: number;
  offset: number;
}

interface Candidate {
  key: string;
  edgeKey: string;
  edgeOrder: number;
  line: SnapLine;
  primary: number;
  distance: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function snap1D(
  freePrimary: number,
  edges: Edge[],
  lines: SnapLine[],
  threshold: number,
  bounds: { min: number; max: number },
  prev: SnapState | null,
): { primary: number; hits: SnapLine[]; state: SnapState | null } {
  const candidates: Candidate[] = [];
  for (const edge of edges) {
    for (const line of lines) {
      const primary = line.position - edge.offset;
      if (primary < bounds.min - 1e-9 || primary > bounds.max + 1e-9) continue;
      candidates.push({
        key: `${edge.key}|${line.guide}|${line.position}`,
        edgeKey: edge.key,
        edgeOrder: edge.order,
        line,
        primary,
        distance: Math.abs(primary - freePrimary),
      });
    }
  }

  const hitsFor = (primary: number): SnapLine[] =>
    candidates.filter((c) => c.distance <= threshold && Math.abs(c.primary - primary) <= 1e-6).map((c) => c.line);

  // 迟滞：只要当前吸附的参考边仍在吸附范围内，就保持住，
  // 避免多条候选同时接近时来回跳。
  if (prev) {
    const kept = candidates.find((c) => c.key === prev.key);
    if (kept && kept.distance <= threshold) {
      return { primary: clamp(kept.primary, bounds.min, bounds.max), hits: hitsFor(kept.primary), state: prev };
    }
  }

  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate.distance > threshold) continue;
    if (
      !best ||
      candidate.distance < best.distance ||
      (candidate.distance === best.distance &&
        (candidate.edgeOrder < best.edgeOrder ||
          (candidate.edgeOrder === best.edgeOrder && candidate.line.position < best.line.position)))
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return { primary: clamp(freePrimary, bounds.min, bounds.max), hits: [], state: null };
  }
  return {
    primary: clamp(best.primary, bounds.min, bounds.max),
    hits: hitsFor(best.primary),
    state: { key: best.key },
  };
}

/** 拖动裁切框整体移动：框的左/右/中线都可以吸附到参考线 */
export function snapMoveCrop(
  free: CropVariant,
  lines: { x: SnapLine[]; y: SnapLine[] },
  thresholdX: number,
  thresholdY: number,
  prev: { x: SnapState | null; y: SnapState | null },
): SnapResult {
  const w = free.width;
  const h = free.height;
  const xEdges: Edge[] = [
    { key: 'left', order: 0, offset: 0 },
    { key: 'center', order: 1, offset: w / 2 },
    { key: 'right', order: 2, offset: w },
  ];
  const yEdges: Edge[] = [
    { key: 'top', order: 0, offset: 0 },
    { key: 'center', order: 1, offset: h / 2 },
    { key: 'bottom', order: 2, offset: h },
  ];
  const sx = snap1D(free.x, xEdges, lines.x, thresholdX, { min: 0, max: 1 - w }, prev.x);
  const sy = snap1D(free.y, yEdges, lines.y, thresholdY, { min: 0, max: 1 - h }, prev.y);
  return {
    crop: { ...free, x: sx.primary, y: sy.primary },
    activeX: sx.hits,
    activeY: sy.hits,
    stateX: sx.state,
    stateY: sy.state,
  };
}

/** 拖动缩放手柄：右边缘吸附竖线、下边缘吸附横线；锁定比例时协调两边 */
export function snapResizeCrop(
  free: CropVariant,
  lines: { x: SnapLine[]; y: SnapLine[] },
  thresholdX: number,
  thresholdY: number,
  prev: { x: SnapState | null; y: SnapState | null },
  ratio: string,
): SnapResult {
  const left = free.x;
  const top = free.y;
  const freeRight = left + free.width;
  const freeBottom = top + free.height;

  const sx = snap1D(freeRight, [{ key: 'right', order: 0, offset: 0 }], lines.x, thresholdX, { min: left + MIN_CROP, max: 1 }, prev.x);
  const sy = snap1D(freeBottom, [{ key: 'bottom', order: 0, offset: 0 }], lines.y, thresholdY, { min: top + MIN_CROP, max: 1 }, prev.y);

  let width = sx.primary - left;
  let height = sy.primary - top;
  let activeX = sx.hits;
  let activeY = sy.hits;

  if (ratio !== 'free') {
    const [rw, rh] = ratio.split(':').map(Number);
    const ratioValue = rw / rh;
    const widthFromRight = sx.primary - left;
    const heightFromBottom = sy.primary - top;
    const aWidth = widthFromRight;
    const aHeight = aWidth / ratioValue;
    const bHeight = heightFromBottom;
    const bWidth = bHeight * ratioValue;
    const aBottomDistance = sy.hits.length ? Math.abs(top + aHeight - sy.primary) : Infinity;
    const bRightDistance = sx.hits.length ? Math.abs(left + bWidth - sx.primary) : Infinity;

    if (sx.hits.length && sy.hits.length) {
      const aConsistent = aBottomDistance <= thresholdY;
      const bConsistent = bRightDistance <= thresholdX;
      if (aConsistent && bConsistent) {
        const aError = Math.abs(aWidth - free.width) + Math.abs(aHeight - free.height);
        const bError = Math.abs(bWidth - free.width) + Math.abs(bHeight - free.height);
        if (aError <= bError) {
          width = aWidth;
          height = aHeight;
          activeY = sy.hits;
        } else {
          width = bWidth;
          height = bHeight;
          activeX = sx.hits;
        }
      } else if (aConsistent) {
        width = aWidth;
        height = aHeight;
        activeY = sy.hits;
      } else if (bConsistent) {
        width = bWidth;
        height = bHeight;
        activeX = sx.hits;
      } else {
        const dx = Math.abs(sx.primary - freeRight);
        const dy = Math.abs(sy.primary - freeBottom);
        if (dx <= dy) {
          width = aWidth;
          height = aHeight;
          activeY = [];
        } else {
          width = bWidth;
          height = bHeight;
          activeX = [];
        }
      }
    } else if (sx.hits.length) {
      width = aWidth;
      height = aHeight;
      activeY = [];
    } else if (sy.hits.length) {
      height = bHeight;
      width = bWidth;
      activeX = [];
    }

    width = clamp(width, MIN_CROP, 1 - left);
    height = clamp(height, MIN_CROP, 1 - top);
  }

  width = clamp(width, MIN_CROP, 1 - left);
  height = clamp(height, MIN_CROP, 1 - top);

  return {
    crop: { ...free, x: left, y: top, width, height },
    activeX,
    activeY,
    stateX: sx.state,
    stateY: sy.state,
  };
}

/** 拖动主体点：x 吸附竖线、y 吸附横线 */
export function snapSubject(
  free: { x: number; y: number },
  lines: { x: SnapLine[]; y: SnapLine[] },
  thresholdX: number,
  thresholdY: number,
  prev: { x: SnapState | null; y: SnapState | null },
): { x: number; y: number; activeX: SnapLine[]; activeY: SnapLine[]; stateX: SnapState | null; stateY: SnapState | null } {
  const sx = snap1D(free.x, [{ key: 'point', order: 0, offset: 0 }], lines.x, thresholdX, { min: 0, max: 1 }, prev.x);
  const sy = snap1D(free.y, [{ key: 'point', order: 0, offset: 0 }], lines.y, thresholdY, { min: 0, max: 1 }, prev.y);
  return { x: sx.primary, y: sy.primary, activeX: sx.hits, activeY: sy.hits, stateX: sx.state, stateY: sy.state };
}
