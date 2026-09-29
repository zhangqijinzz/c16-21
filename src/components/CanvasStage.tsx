import { useRef, useState, type PointerEvent } from 'react';
import { snapCropMove, snapCropResize, snapPoint, type SnapHint, type SnapLock } from '../domain';
import type { CropVariant, GuideKey, ImageAsset } from '../model';

interface CanvasStageProps {
  image: ImageAsset;
  guides: Record<GuideKey, boolean>;
  crop: CropVariant;
  subject: { x: number; y: number } | null;
  onSubject: (x: number, y: number) => void;
  onCropChange: (crop: CropVariant) => void;
}

type DragMode = 'move' | 'resize' | 'subject';

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startCrop: CropVariant;
  startSubject: { x: number; y: number };
  snapLocks: Partial<Record<'x' | 'y', SnapLock>>;
}

export function CanvasStage({ image, guides, crop, subject, onSubject, onCropChange }: CanvasStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [snapHints, setSnapHints] = useState<SnapHint[]>([]);

  const pointFromEvent = (event: PointerEvent): { x: number; y: number; width: number; height: number } | null => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      width: rect.width,
      height: rect.height,
    };
  };

  const startDrag = (event: PointerEvent, mode: DragMode) => {
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    dragRef.current = {
      mode,
      startX: point.x,
      startY: point.y,
      startCrop: crop,
      startSubject: subject ?? { x: point.x, y: point.y },
      snapLocks: {},
    };
    setDragging(true);
    setSnapHints([]);
    stageRef.current?.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent) => {
    const drag = dragRef.current;
    const point = pointFromEvent(event);
    if (!drag || !point) return;

    const context = {
      guides,
      viewportWidth: point.width,
      viewportHeight: point.height,
      imageRatio: image.width / image.height,
      locks: drag.snapLocks,
    };
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    let hints: SnapHint[] = [];
    let locks = drag.snapLocks;

    if (drag.mode === 'move') {
      const result = snapCropMove({
        ...drag.startCrop,
        x: drag.startCrop.x + dx,
        y: drag.startCrop.y + dy,
      }, context);
      onCropChange(result.value);
      hints = result.hints;
      locks = result.locks;
    } else if (drag.mode === 'resize') {
      const result = snapCropResize(
        drag.startCrop,
        drag.startCrop.width + dx,
        drag.startCrop.height + dy,
        context,
      );
      onCropChange(result.value);
      hints = result.hints;
      locks = result.locks;
    } else {
      const result = snapPoint({
        x: drag.startSubject.x + dx,
        y: drag.startSubject.y + dy,
      }, context);
      onSubject(result.value.x, result.value.y);
      hints = result.hints;
      locks = result.locks;
    }

    dragRef.current = { ...drag, snapLocks: locks };
    setSnapHints(hints);
  };

  const stopDrag = () => {
    dragRef.current = null;
    setDragging(false);
    setSnapHints([]);
  };

  const pointerDownStage = (event: PointerEvent) => {
    if (dragRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('.subject-pin')) {
      startDrag(event, 'subject');
      return;
    }
    if (target.closest('.resize-handle')) {
      startDrag(event, 'resize');
      return;
    }
    if (target.closest('.crop-frame')) {
      startDrag(event, 'move');
      return;
    }

    const point = pointFromEvent(event);
    if (point) onSubject(point.x, point.y);
  };

  return (
    <div className="stage-shell">
      <div
        className="canvas-stage"
        ref={stageRef}
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
        onPointerDown={pointerDownStage}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <img src={image.src} alt={image.name} draggable={false} />
        <div className="image-wash" />
        {guides.thirds && <div className="guide thirds-guide"><i /><i /><b /><b /></div>}
        {guides.center && <div className="guide center-guide"><i /><i /></div>}
        {guides.diagonal && <div className="guide diagonal-guide"><i /><i /></div>}
        {guides.golden && <div className="guide golden-guide"><b /><b /><b /><b /><i /><i /></div>}
        {subject && <div className="subject-pin" style={{ left: `${subject.x * 100}%`, top: `${subject.y * 100}%` }}><span>主体</span></div>}
        <div className={`crop-frame ${dragging ? 'dragging' : ''} ${snapHints.length > 0 ? 'snapped' : ''}`} style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
          <div className="crop-label">{crop.ratio === 'free' ? '自由裁切' : crop.ratio}</div>
          <button type="button" className="resize-handle" aria-label="调整裁切大小" />
        </div>
        {snapHints.map((hint) => (
          hint.axis === 'x'
            ? <div key={`x-${hint.position}`} className="snap-guide snap-x" style={{ left: `${hint.position * 100}%` }}><span>{Math.round(hint.position * 100)}%</span></div>
            : <div key={`y-${hint.position}`} className="snap-guide snap-y" style={{ top: `${hint.position * 100}%` }}><span>{Math.round(hint.position * 100)}%</span></div>
        ))}
      </div>
      <div className="stage-caption"><span>点击画面标记主体 · 拖动画框或主体可吸附到辅助线</span><span>{image.width} × {image.height}px</span></div>
    </div>
  );
}
