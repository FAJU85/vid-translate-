import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AdminAction, AdminJob, JobStatus } from '../../../shared/api';
import { JobCard } from './JobCard';
import { COLUMNS, STATUS_STYLE, dropAction, jobTitle } from './model';

export interface CardProps {
  selected: Set<string>;
  focusedId: string | null;
  pending: Map<string, AdminJob | null>;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
}

// Keyboard dragging moves a card a whole column at a time (Space to lift, ← → to move, Space to drop).
const columnHop: KeyboardCoordinateGetter = (event, { context: { droppableRects, droppableContainers, collisionRect } }) => {
  const dir = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (!dir || !collisionRect) return undefined;
  event.preventDefault();
  const rects = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  const centre = collisionRect.left + collisionRect.width / 2;
  const target = dir > 0 ? rects.find((r) => r.left > centre) : [...rects].reverse().find((r) => r.right < centre);
  if (!target) return undefined;
  return { x: target.left + target.width / 2 - collisionRect.width / 2, y: Math.max(target.top + 48, collisionRect.top) };
};

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

const columnLabel = (id: unknown) => COLUMNS.find((c) => c.status === id)?.label ?? 'nowhere';

function DraggableCard({ job, props }: { job: AdminJob; props: CardProps }) {
  const busy = props.pending.has(job.id);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: job.id, data: { job }, disabled: busy });
  return (
    <JobCard
      ref={setNodeRef}
      job={job}
      selected={props.selected.has(job.id)}
      selecting={props.selected.size > 0}
      focused={props.focusedId === job.id}
      busy={busy}
      dragging={isDragging}
      onToggle={() => props.onToggle(job.id)}
      onClick={() => props.onOpen(job.id)}
      onFocus={() => props.onFocus(job.id)}
      {...attributes}
      {...listeners}
      aria-roledescription="job card"
      aria-label={`${jobTitle(job)}, ${STATUS_STYLE[job.status].label}`}
    />
  );
}

/** One column: only the cards in view are rendered, so hundreds of jobs stay smooth. */
function Column({ status, label, hint, jobs, props, dropHint }: {
  status: JobStatus;
  label: string;
  hint: string;
  jobs: AdminJob[];
  props: CardProps;
  dropHint: 'yes' | 'no' | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 86,
    gap: 8,
    overscan: 6,
    getItemKey: (i) => jobs[i].id,
  });

  // Keep the keyboard-focused card in view.
  useEffect(() => {
    const index = props.focusedId ? jobs.findIndex((j) => j.id === props.focusedId) : -1;
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [props.focusedId, jobs, virtual]);

  const tone = STATUS_STYLE[status];
  const ring = isOver ? (dropHint === 'yes' ? 'ring-2 ring-amber-400' : 'ring-2 ring-status-failed/60') : dropHint === 'yes' ? 'ring-1 ring-amber-400/40' : '';

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} column, ${jobs.length} jobs`}
      className={`flex flex-col min-h-0 min-w-[78vw] sm:min-w-0 snap-start rounded-xl bg-slate-950/70 border border-slate-800/80 transition-shadow ${ring}`}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2" title={hint}>
        <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{label}</h3>
        <span className="ml-auto text-xs tabular-nums text-slate-500">{jobs.length}</span>
      </header>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {jobs.length === 0 ? (
          <p className="mt-2 px-2 py-6 text-center text-xs text-slate-600 border border-dashed border-slate-800 rounded-lg">{hint}</p>
        ) : (
          <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtual.measureElement}
                className="absolute left-0 right-0"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <DraggableCard job={jobs[item.index]} props={props} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Board({ columns, props, run, onRefused, onDragging }: {
  columns: Record<JobStatus, AdminJob[]>;
  props: CardProps;
  run: (action: AdminAction, ids: string[]) => void;
  onRefused: (text: string) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const [dragged, setDraggedState] = useState<AdminJob | null>(null);
  const setDragged = (job: AdminJob | null) => {
    setDraggedState(job);
    onDragging(!!job);
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnHop,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${jobTitle(active.data.current?.job)}. Use left and right arrows to choose a column, space to drop.`,
    onDragOver: ({ active, over }) => {
      const job = active.data.current?.job as AdminJob;
      if (!over) return 'Not over a column.';
      const action = dropAction(job, over.id as JobStatus);
      return `Over ${columnLabel(over.id)}. ${action === 'cancel' ? 'Dropping cancels the job.' : action === 'retry' ? 'Dropping runs it again.' : 'The job cannot move here.'}`;
    },
    onDragEnd: ({ active, over }) => {
      const action = over && dropAction(active.data.current?.job, over.id as JobStatus);
      return action ? `Dropped in ${columnLabel(over?.id)}.` : 'Dropped. Nothing changed.';
    },
    onDragCancel: () => 'Move cancelled.',
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragged(null);
    const job = active.data.current?.job as AdminJob | undefined;
    if (!job || !over || over.id === job.status) return;
    const action = dropAction(job, over.id as JobStatus);
    // Moving a selected card moves the whole selection.
    const ids = props.selected.has(job.id) ? [...props.selected] : [job.id];
    if (action) run(action, ids);
    else onRefused(`${columnLabel(over.id)} is set by the translation server. Drag to Cancelled to stop a job, or to Queued to run it again.`);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'To move a job, press space, use the left and right arrows to choose a column, then press space again. Escape cancels.',
        },
      }}
      onDragStart={({ active }) => setDragged(active.data.current?.job ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragged(null)}
    >
      <div className="h-full grid grid-flow-col grid-rows-[minmax(0,1fr)] auto-cols-[minmax(78vw,1fr)] sm:auto-cols-fr gap-3 overflow-x-auto snap-x snap-mandatory sm:snap-none pb-1">
        {COLUMNS.map((c) => (
          <Column
            key={c.status}
            {...c}
            jobs={columns[c.status]}
            props={props}
            dropHint={dragged ? (dropAction(dragged, c.status) ? 'yes' : c.status === dragged.status ? null : 'no') : null}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {dragged && (
          <JobCard
            job={dragged}
            selected={props.selected.has(dragged.id)}
            selecting={false}
            focused={false}
            busy={false}
            onToggle={() => {}}
            className="shadow-2xl shadow-black/60 rotate-1 cursor-grabbing"
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
