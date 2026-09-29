import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { CropVariant, GuideKey, ImageAsset } from '../model';
import { GUIDE_LABELS, SNAP_THRESHOLD_PX, guideSnapLines, snapMoveCrop, snapResizeCrop, snapSubject, type SnapLine, type SnapState } from '../snap';

interface CanvasStageProps {
  image: ImageAsset;
  guides: Record<GuideKey, boolean>;
  crop: CropVariant;
  subject: { x: number; y: number } | null;
  onSubject: (x: number, y: number) => void;
  onMoveCrop: (dx: number, dy: number) => void;
  onResizeCrop: (width: number, height: number) => void;
}

interface DragState {
  mode: 'move' | 'resize' | 'subject';
  startX: number;
  startY: number;
  startCrop: CropVariant;
  startSubject: { x: number; y: number } | null;
  moved: boolean;
  snap: { x: SnapState | null; y: SnapState | null };
}

interface Preview {
  crop: CropVariant | null;
  subject: { x: number; y: number } | null;
  activeX: SnapLine[];
  activeY: SnapLine[];
}

const EMPTY_PREVIEW: Preview = { crop: null, subject: null, activeX: [], activeY: [] };

export function CanvasStage({ image, guides, crop, subject, onSubject, onMoveCrop, onResizeCrop }: CanvasStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Preview>(EMPTY_PREVIEW);

  const snapLines = useMemo(() => guideSnapLines(guides), [guides]);
  const snapping = dragging && (preview.activeX.length > 0 || preview.activeY.length > 0);

  const pointFromEvent = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const thresholds = (): { x: number; y: number } => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.02, y: 0.02 };
    return { x: SNAP_THRESHOLD_PX / rect.width, y: SNAP_THRESHOLD_PX / rect.height };
  };

  const startDrag = (event: PointerEvent, mode: 'move' | 'resize' | 'subject') => {
    event.stopPropagation();
    const point = pointFromEvent(event);
    if (!point) return;
    dragRef.current = { mode, startX: point.x, startY: point.y, startCrop: crop, startSubject: subject, moved: false, snap: { x: null, y: null } };
    setDragging(true);
    setPreview(EMPTY_PREVIEW);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (!drag.moved && Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    drag.moved = true;

    const { x: thresholdX, y: thresholdY } = thresholds();

    if (drag.mode === 'move') {
      const free = { ...drag.startCrop, x: drag.startCrop.x + dx, y: drag.startCrop.y + dy };
      const result = snapMoveCrop(free, snapLines, thresholdX, thresholdY, drag.snap);
      drag.snap = { x: result.stateX, y: result.stateY };
      setPreview({ crop: result.crop, subject: null, activeX: result.activeX, activeY: result.activeY });
    } else if (drag.mode === 'resize') {
      const free = { ...drag.startCrop, width: drag.startCrop.width + dx, height: drag.startCrop.height + dy };
      const result = snapResizeCrop(free, snapLines, thresholdX, thresholdY, drag.snap, drag.startCrop.ratio);
      drag.snap = { x: result.stateX, y: result.stateY };
      setPreview({ crop: result.crop, subject: null, activeX: result.activeX, activeY: result.activeY });
    } else {
      const start = drag.startSubject ?? { x: 0.5, y: 0.5 };
      const free = { x: start.x + dx, y: start.y + dy };
      const result = snapSubject(free, snapLines, thresholdX, thresholdY, drag.snap);
      drag.snap = { x: result.stateX, y: result.stateY };
      setPreview({ crop: null, subject: { x: result.x, y: result.y }, activeX: result.activeX, activeY: result.activeY });
    }
  };

  const stopDrag = () => {
    const drag = dragRef.current;
    if (drag && drag.moved) {
      if (drag.mode === 'move' && preview.crop) {
        onMoveCrop(preview.crop.x - drag.startCrop.x, preview.crop.y - drag.startCrop.y);
      } else if (drag.mode === 'resize' && preview.crop) {
        onResizeCrop(preview.crop.width, preview.crop.height);
      } else if (drag.mode === 'subject' && preview.subject) {
        onSubject(preview.subject.x, preview.subject.y);
      }
    }
    dragRef.current = null;
    setDragging(false);
    setPreview(EMPTY_PREVIEW);
  };

  const clickStage = (event: PointerEvent) => {
    if (dragging || (event.target as HTMLElement).closest('.crop-frame, .subject-pin')) return;
    const point = pointFromEvent(event);
    if (point) onSubject(point.x, point.y);
  };

  const shownCrop = dragging && preview.crop ? preview.crop : crop;
  const shownSubject = dragging && preview.subject ? preview.subject : subject;

  return (
    <div className="stage-shell">
      <div
        className="canvas-stage"
        ref={stageRef}
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
        onPointerDown={clickStage}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <img src={image.src} alt={image.name} draggable={false} />
        <div className="image-wash" />
        {guides.thirds && <div className="guide thirds-guide"><i /><i /><b /><b /></div>}
        {guides.center && <div className="guide center-guide"><i /><i /></div>}
        {guides.diagonal && <div className="guide diagonal-guide"><i /><i /></div>}
        {guides.golden && <div className="guide golden-guide"><i /><i /></div>}
        {dragging && <SnapOverlay activeX={preview.activeX} activeY={preview.activeY} />}
        {shownSubject && (
          <div
            className="subject-pin draggable"
            style={{ left: `${shownSubject.x * 100}%`, top: `${shownSubject.y * 100}%` }}
            onPointerDown={(event) => startDrag(event, 'subject')}
          >
            <span>主体</span>
          </div>
        )}
        <div
          className={`crop-frame ${dragging ? 'dragging' : ''} ${snapping ? 'snapping' : ''}`}
          style={{ left: `${shownCrop.x * 100}%`, top: `${shownCrop.y * 100}%`, width: `${shownCrop.width * 100}%`, height: `${shownCrop.height * 100}%` }}
          onPointerDown={(event) => startDrag(event, 'move')}
        >
          <div className="crop-label">{shownCrop.ratio === 'free' ? '自由裁切' : shownCrop.ratio}</div>
          <button className="resize-handle" aria-label="调整裁切大小" onPointerDown={(event) => startDrag(event, 'resize')} onClick={(event) => event.stopPropagation()} />
        </div>
      </div>
      <div className="stage-caption"><span>点击画面标记主体 · 拖动画框/主体可吸附辅助线</span><span>{image.width} × {image.height}px</span></div>
    </div>
  );
}

function SnapOverlay({ activeX, activeY }: { activeX: SnapLine[]; activeY: SnapLine[] }) {
  return (
    <div className="snap-overlay">
      {activeX.map((line) => (
        <div key={`${line.guide}-x-${line.position}`} className="snap-line snap-line-v" style={{ left: `${line.position * 100}%` }}>
          <span className="snap-label">{GUIDE_LABELS[line.guide]}</span>
        </div>
      ))}
      {activeY.map((line) => (
        <div key={`${line.guide}-y-${line.position}`} className="snap-line snap-line-h" style={{ top: `${line.position * 100}%` }}>
          <span className="snap-label">{GUIDE_LABELS[line.guide]}</span>
        </div>
      ))}
    </div>
  );
}
