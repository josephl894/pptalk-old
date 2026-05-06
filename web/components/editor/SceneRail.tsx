'use client';

/**
 * Left filmstrip — Hi-Fi pattern.
 *   - 168px column, paper bg, hairline right border.
 *   - Each row: mono 2-digit index + 16:9 thumbnail (PNG when ready, paper-2 placeholder otherwise).
 *   - Selected slide: 1.5px coral border + accent-tint ring shadow.
 *   - Drag to reorder via dnd-kit; activation distance 6px so a click still selects.
 */

import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PlusIcon } from '@/components/shell/icons';
import type { EditorSlide } from './types';

export function SceneRail({
  slides,
  selectedId,
  onSelect,
  onReorder,
  onPlay,
  playingSlideId,
}: {
  slides: EditorSlide[];
  selectedId: string | null;
  onSelect: (slideId: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onPlay?: (slide: EditorSlide) => void;
  playingSlideId?: string | null;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = React.useMemo(() => slides.map((s) => s.id), [slides]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <aside
      className="flex h-full w-[168px] shrink-0 flex-col border-r border-[color:var(--hairline)] bg-[color:var(--paper)]"
      aria-label="Slide rail"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink-4)]">
          Slides · {slides.length}
        </span>
        <button
          type="button"
          aria-label="Add slide"
          disabled
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-[color:var(--ink-4)] opacity-50"
          title="Add slide (coming soon)"
        >
          <PlusIcon size={12} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-4 pt-2.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {slides.map((s, i) => (
              <SortableThumb
                key={s.id}
                slide={s}
                displayIndex={i + 1}
                selected={selectedId === s.id}
                playing={playingSlideId === s.id}
                onSelect={onSelect}
                onPlay={onPlay}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </aside>
  );
}

function SortableThumb({
  slide,
  displayIndex,
  selected,
  playing,
  onSelect,
  onPlay,
}: {
  slide: EditorSlide;
  displayIndex: number;
  selected: boolean;
  playing?: boolean;
  onSelect: (slideId: string) => void;
  onPlay?: (slide: EditorSlide) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slide.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const thumbStyle: React.CSSProperties = selected
    ? {
        borderColor: 'var(--accent)',
        borderWidth: 1.5,
        boxShadow: '0 0 0 2px var(--accent-tint)',
      }
    : { borderColor: 'var(--hairline)', borderWidth: 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <span className="w-[18px] shrink-0 text-center font-mono text-[12px] text-[color:var(--ink-4)]">
        {String(displayIndex).padStart(2, '0')}
      </span>
      <button
        type="button"
        onClick={() => onSelect(slide.id)}
        className={cn(
          'group relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-md text-left transition-shadow duration-150 ease-out hover:shadow-chrome focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/50',
        )}
        style={thumbStyle}
        aria-pressed={selected}
        aria-label={`Slide ${displayIndex}${slide.title ? `: ${slide.title}` : ''}`}
      >
        {slide.png_signed_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={slide.png_signed_url}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="size-full bg-[color:var(--paper-2)]" />
        )}
        <span
          className="absolute right-1 top-1/2 inline-flex h-6 w-4 -translate-y-1/2 cursor-grab items-center justify-center rounded text-[color:var(--ink-5)] opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          role="button"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-3.5" />
        </span>
        {slide.audio_signed_url && onPlay && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={playing ? 'Pause' : 'Play slide audio'}
            onClick={(e) => {
              e.stopPropagation();
              onPlay(slide);
            }}
            className="absolute bottom-1 left-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--ink)]/85 text-white opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
            style={{ opacity: playing ? 1 : undefined }}
          >
            {playing ? (
              <svg viewBox="0 0 16 16" fill="currentColor" width="9" height="9" aria-hidden>
                <rect x="4" y="3" width="3" height="10" rx="1" />
                <rect x="9" y="3" width="3" height="10" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" width="9" height="9" aria-hidden>
                <path d="M5 3.5v9l7-4.5-7-4.5Z" />
              </svg>
            )}
          </span>
        )}
      </button>
    </div>
  );
}
