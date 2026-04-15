import { useState, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  pointerWithin,
} from '@dnd-kit/core';
import {
  useProjectTasks,
  useCreateTask,
  useUpdateTaskStatus,
  useDeleteTask,
  useUpdateTask,
  useReorderTasks,
  type TaskStatus,
  type ProjectTask,
} from './hooks/useProjectTasks';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Check from 'lucide-react/dist/esm/icons/check';
import X from 'lucide-react/dist/esm/icons/x';
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import { useNavigate } from 'react-router-dom';
import { PhotoGallery } from './components/PhotoGallery';
import { useTaskPhotoCounts, useAssignPhotosToTask } from './hooks/useTaskPhotos';
import { PhotoCountBadge } from './components/PhotoCountBadge';
import { TaskDetailModal } from './components/TaskDetailModal';
import type { GalleryPhoto } from '../../schemas/galleryPhoto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Column config ───────────────────────────────────────────────────────────

const COLUMNS: { key: TaskStatus; label: string; color: string; dotColor: string }[] = [
  { key: 'future', label: 'Coming Up Next', color: 'text-blue-400', dotColor: 'bg-blue-400' },
  {
    key: 'in_progress',
    label: 'In Progress',
    color: 'text-amber-400',
    dotColor: 'bg-amber-400',
  },
  { key: 'done', label: 'Done', color: 'text-emerald-400', dotColor: 'bg-emerald-400' },
];

// ─── Inline Add Form ─────────────────────────────────────────────────────────

const AddTaskForm: React.FC<{
  status: TaskStatus;
  onSubmit: (title: string, note: string, status: TaskStatus) => void;
  onCancel: () => void;
}> = ({ status, onSubmit, onCancel }) => {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit(title.trim(), note.trim(), status);
    setTitle('');
    setNote('');
  };

  return (
    <div className="p-3 bg-surface border border-subtle rounded-xl space-y-2 animate-in fade-in duration-150">
      <input
        autoFocus
        type="text"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        className="w-full bg-card border border-subtle rounded-lg px-3 py-2 text-sm text-content placeholder:text-muted focus:outline-none focus:border-accent/50"
      />
      <textarea
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        rows={2}
        className="w-full bg-card border border-subtle rounded-lg px-3 py-2 text-xs text-content placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
      />
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-40 transition-opacity"
        >
          <Plus size={14} />
          Add
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 bg-card border border-subtle text-muted rounded-lg text-xs font-bold uppercase tracking-wider"
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </div>
  );
};

// ─── Draggable + Droppable Task Card ────────────────────────────────────────

const TaskCard: React.FC<{
  task: ProjectTask;
  onDelete: (taskId: string, status: TaskStatus) => void;
  onComplete: (task: ProjectTask) => void;
  onEdit: (taskId: string, title: string, note: string | null) => void;
  isDragOverlay?: boolean;
  isDragActive?: boolean;
  dropIndicator?: 'above' | 'below' | null;
  justPlaced?: boolean;
  dragHeight?: number;
  photoCount?: number;
  photoDropTarget?: boolean;
  onOpenDetail?: (task: ProjectTask) => void;
}> = ({
  task,
  onDelete,
  onComplete,
  onEdit,
  isDragOverlay,
  isDragActive,
  dropIndicator,
  justPlaced,
  dragHeight = 0,
  photoCount,
  photoDropTarget,
  onOpenDetail,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNote, setEditNote] = useState(task.note ?? '');

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: task.id,
    data: { task },
    disabled: isEditing,
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: `card-${task.id}`,
    data: { task, type: 'card' },
  });

  const setRefs = useCallback(
    (el: HTMLElement | null) => {
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef]
  );

  const handleSave = () => {
    if (!editTitle.trim()) return;
    onEdit(task.id, editTitle.trim(), editNote.trim() || null);
    setIsEditing(false);
  };

  const timeAgo = formatTimeAgo(task.created_at);

  if (isEditing) {
    return (
      <div ref={setRefs} className="p-3 bg-surface border border-accent/30 rounded-xl space-y-2">
        <input
          autoFocus
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setIsEditing(false);
          }}
          className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-sm text-content focus:outline-none focus:border-accent/50"
        />
        <textarea
          value={editNote}
          onChange={(e) => setEditNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsEditing(false);
          }}
          rows={2}
          placeholder="Note (optional)"
          className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-content placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="px-2 py-1 bg-accent text-white rounded-md text-xs font-bold"
          >
            Save
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="px-2 py-1 bg-card border border-subtle text-muted rounded-md text-xs font-bold"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const spacerHeight = Math.round(dragHeight * 1.2);

  return (
    <div className="relative">
      {/* Spacer — above */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{ height: dropIndicator === 'above' ? spacerHeight : 0 }}
      >
        <div className="h-full rounded-xl border-2 border-dashed border-accent/40 bg-accent/5 mx-0.5" />
      </div>

      <div
        id={isDragOverlay ? undefined : `task-${task.id}`}
        ref={isDragOverlay ? undefined : setRefs}
        className={`group p-3 bg-surface border rounded-xl transition-all duration-300 ease-out ${
          isDragging ? 'opacity-0 h-0 p-0 m-0 overflow-hidden border-0' : ''
        } ${isDragOverlay ? 'shadow-2xl shadow-black/20 scale-[1.03] rotate-1 border-accent/40' : ''} ${
          isDragActive && !isDragging && !isDragOverlay ? 'pointer-events-none' : ''
        } ${justPlaced ? 'border-emerald-400/60 bg-emerald-500/10 ring-1 ring-emerald-400/30' : 'border-subtle'} ${photoDropTarget ? 'border-dashed border-accent/30' : ''}`}
        {...(isDragOverlay ? {} : attributes)}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          <div
            className="mt-0.5 text-muted/40 cursor-grab active:cursor-grabbing shrink-0 touch-none"
            {...(isDragOverlay ? {} : listeners)}
          >
            <GripVertical size={14} />
          </div>

          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenDetail?.(task)}>
            <p className="text-sm font-semibold text-content leading-tight">{task.title}</p>
            {task.note && (
              <p className="text-xs text-muted mt-1 line-clamp-2 leading-relaxed">{task.note}</p>
            )}
            <p className="text-[10px] text-muted/60 mt-1.5 font-medium">{timeAgo}</p>
            <PhotoCountBadge count={photoCount ?? 0} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {task.status === 'in_progress' && (
              <button
                onClick={() => onComplete(task)}
                className="p-1 hover:bg-emerald-500/10 rounded-md text-emerald-500 transition-colors"
                title="Mark as done"
              >
                <Check size={14} />
              </button>
            )}
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 hover:bg-accent/10 rounded-md text-muted hover:text-accent transition-colors"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => onDelete(task.id, task.status)}
              className="p-1 hover:bg-red-500/10 rounded-md text-muted hover:text-red-500 transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Spacer — below */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{ height: dropIndicator === 'below' ? spacerHeight : 0 }}
      >
        <div className="h-full rounded-xl border-2 border-dashed border-accent/40 bg-accent/5 mx-0.5" />
      </div>
    </div>
  );
};

// ─── Droppable Column ────────────────────────────────────────────────────────

const KanbanColumn: React.FC<{
  status: TaskStatus;
  label: string;
  color: string;
  dotColor: string;
  tasks: ProjectTask[];
  onDelete: (taskId: string, status: TaskStatus) => void;
  onComplete: (task: ProjectTask) => void;
  onEdit: (taskId: string, title: string, note: string | null) => void;
  onAdd: (title: string, note: string, status: TaskStatus) => void;
  isDragActive: boolean;
  draggedTaskId: string | null;
  justPlacedId: string | null;
  dropTarget: { taskId: string; half: 'above' | 'below' } | null;
  dragHeight: number;
  photoDragging?: boolean;
  photoCounts?: Map<string, number>;
  onOpenDetail?: (task: ProjectTask) => void;
}> = ({
  status,
  label,
  dotColor,
  tasks,
  onDelete,
  onComplete,
  onEdit,
  onAdd,
  isDragActive,
  draggedTaskId,
  justPlacedId,
  dropTarget,
  dragHeight,
  photoDragging,
  photoCounts,
  onOpenDetail,
}) => {
  const [showForm, setShowForm] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { status },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col bg-card rounded-2xl p-3 min-h-[200px] transition-all duration-300 ${
        isDragActive ? 'border border-transparent' : 'border border-subtle'
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
          <h3 className="text-xs font-black uppercase tracking-wider text-content">{label}</h3>
          <span className="text-[10px] text-muted font-bold bg-surface px-1.5 py-0.5 rounded-md">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="p-1 hover:bg-surface rounded-md text-muted hover:text-accent transition-colors"
          title="Add task"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="mb-2">
          <AddTaskForm
            status={status}
            onSubmit={(title, note, s) => {
              onAdd(title, note, s);
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Task Cards */}
      <div className="flex flex-col gap-2 flex-1">
        {/* Column empty drop zone — only when no cards to drop on */}
        {isDragActive && tasks.filter((t) => t.id !== draggedTaskId).length === 0 && (
          <div
            className="overflow-hidden transition-all duration-200 ease-out"
            style={{ height: isOver ? Math.round(dragHeight * 1.2) : 0 }}
          >
            <div className="h-full rounded-xl border-2 border-dashed border-accent/40 bg-accent/5 mx-0.5" />
          </div>
        )}
        {tasks.map((task) => (
          <div key={task.id}>
            {task.id === draggedTaskId ? null : (
              <TaskCard
                task={task}
                onDelete={onDelete}
                onComplete={onComplete}
                onEdit={onEdit}
                isDragActive={isDragActive}
                justPlaced={task.id === justPlacedId}
                dropIndicator={dropTarget?.taskId === task.id ? dropTarget.half : null}
                dragHeight={dragHeight}
                photoDropTarget={photoDragging}
                photoCount={photoCounts?.get(task.id)}
                onOpenDetail={onOpenDetail}
              />
            )}
          </div>
        ))}
        {tasks.length === 0 && !showForm && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-muted/40 font-bold uppercase tracking-wider">No tasks</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const ProjectsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { data: grouped, isLoading } = useProjectTasks();
  const createTask = useCreateTask();
  const updateStatus = useUpdateTaskStatus();
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const reorderTasks = useReorderTasks();

  const { data: photoCounts } = useTaskPhotoCounts();
  const assignPhotos = useAssignPhotosToTask();
  const [draggedPhoto, setDraggedPhoto] = useState<GalleryPhoto | null>(null);
  const [draggedPhotoCount, setDraggedPhotoCount] = useState(0);

  const [detailTask, setDetailTask] = useState<ProjectTask | null>(null);
  const [draggedTask, setDraggedTask] = useState<ProjectTask | null>(null);
  const [dragHeight, setDragHeight] = useState(0);
  const [justPlacedId, setJustPlacedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ taskId: string; half: 'above' | 'below' } | null>(
    null
  );
  const dropTargetRef = useRef<{ taskId: string; half: 'above' | 'below' } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleAdd = useCallback(
    (title: string, note: string, status: TaskStatus) => {
      createTask.mutate({ title, note: note || undefined, status });
    },
    [createTask]
  );

  const handleDelete = useCallback(
    (taskId: string, status: TaskStatus) => {
      deleteTask.mutate({ taskId, status });
    },
    [deleteTask]
  );

  const handleComplete = useCallback(
    (task: ProjectTask) => {
      const doneCount = grouped?.done.length ?? 0;
      updateStatus.mutate({
        taskId: task.id,
        fromStatus: task.status,
        toStatus: 'done',
        newPosition: doneCount,
      });
    },
    [updateStatus, grouped]
  );

  const handleEdit = useCallback(
    (taskId: string, title: string, note: string | null) => {
      updateTask.mutate({ taskId, title, note });
    },
    [updateTask]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === 'photo') {
      setDraggedPhoto(data.photo as GalleryPhoto);
      setDraggedPhotoCount((data.count as number) ?? 1);
      return;
    }
    const task = data?.task as ProjectTask | undefined;
    if (task) {
      setDraggedTask(task);
      const el = document.getElementById(`task-${task.id}`);
      setDragHeight(el?.offsetHeight ?? 60);
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      // Don't show spacers when dragging a photo
      if (draggedPhoto) {
        setDropTarget(null);
        return;
      }

      const { over, activatorEvent } = event;
      if (!over) {
        setDropTarget(null);
        return;
      }

      const overData = over.data.current;

      // Hovering over a card — determine top/bottom half
      if (overData?.type === 'card' && overData.task) {
        const overTask = overData.task as ProjectTask;
        const el = document.getElementById(`task-${overTask.id}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const pointerY = (activatorEvent as PointerEvent)?.clientY ?? 0;
          const deltaY = event.delta.y;
          const currentY = pointerY + deltaY;
          const midpoint = rect.top + rect.height / 2;
          const dt = {
            taskId: overTask.id,
            half: (currentY < midpoint ? 'above' : 'below') as 'above' | 'below',
          };
          setDropTarget(dt);
          dropTargetRef.current = dt;
        }
        return;
      }

      // Hovering over column (header or empty area) — determine top or bottom
      const targetStatus = overData?.status as TaskStatus | undefined;
      if (targetStatus && grouped) {
        const dragId = draggedTask?.id;
        const visibleTasks = grouped[targetStatus]?.filter((t) => t.id !== dragId) ?? [];
        if (visibleTasks.length > 0) {
          const pointerY = (activatorEvent as PointerEvent)?.clientY ?? 0;
          const currentY = pointerY + event.delta.y;

          const firstEl = document.getElementById(`task-${visibleTasks[0].id}`);
          if (firstEl) {
            const firstRect = firstEl.getBoundingClientRect();
            if (currentY < firstRect.top + firstRect.height / 2) {
              const dt = { taskId: visibleTasks[0].id, half: 'above' as const };
              setDropTarget(dt);
              dropTargetRef.current = dt;
              return;
            }
          }

          const lastTask = visibleTasks[visibleTasks.length - 1];
          const dt = { taskId: lastTask.id, half: 'below' as const };
          setDropTarget(dt);
          dropTargetRef.current = dt;
          return;
        }
      }

      setDropTarget(null);
    },
    [grouped, draggedTask, draggedPhoto]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const target = dropTargetRef.current;
      const task = draggedTask;

      // Handle photo drop on task card (single or batch)
      if (draggedPhoto) {
        const photoIds = (active.data.current?.photoIds as string[]) ?? [draggedPhoto.id];
        setDraggedPhoto(null);
        if (over?.data.current?.type === 'card' && over.data.current.task) {
          const targetTask = over.data.current.task as ProjectTask;
          assignPhotos.mutate({ photoIds, taskId: targetTask.id });
          setJustPlacedId(targetTask.id);
          setTimeout(() => setJustPlacedId(null), 600);
        }
        return;
      }

      setDraggedTask(null);
      setDropTarget(null);
      dropTargetRef.current = null;
      setJustPlacedId(active.id as string);
      setTimeout(() => setJustPlacedId(null), 600);

      if (!grouped || !task || !over) return;

      const overData = over.data.current;

      // Determine target column from the DragEnd event (always accurate)
      let targetStatus: TaskStatus | null = null;

      if (overData?.type === 'card' && overData.task) {
        // Dropped on a card — card knows its own status
        targetStatus = (overData.task as ProjectTask).status;
      } else if (overData?.status) {
        // Dropped on a column
        targetStatus = overData.status as TaskStatus;
      }

      if (!targetStatus) return;

      if (task.status === targetStatus) {
        // Within-column reorder — use ref for position
        if (!target) return;
        const columnTasks = [...(grouped[targetStatus] ?? [])];
        const oldIndex = columnTasks.findIndex((t) => t.id === task.id);
        const overIndex = columnTasks.findIndex((t) => t.id === target.taskId);
        if (oldIndex === -1 || overIndex === -1 || oldIndex === overIndex) return;

        columnTasks.splice(oldIndex, 1);
        const adjustedOverIndex = columnTasks.findIndex((t) => t.id === target.taskId);
        const insertAt = target.half === 'above' ? adjustedOverIndex : adjustedOverIndex + 1;
        columnTasks.splice(insertAt, 0, task);

        reorderTasks.mutate({
          status: targetStatus,
          orderedIds: columnTasks.map((t) => t.id),
        });
      } else {
        // Cross-column — determine position from ref or default to end
        const targetTasks = grouped[targetStatus] ?? [];
        let insertAt = targetTasks.length; // default: append at end

        if (target) {
          const overIndex = targetTasks.findIndex((t) => t.id === target.taskId);
          if (overIndex >= 0) {
            insertAt = target.half === 'above' ? overIndex : overIndex + 1;
          }
        }

        updateStatus.mutate({
          taskId: task.id,
          fromStatus: task.status,
          toStatus: targetStatus,
          newPosition: insertAt,
        });
      }
    },
    [updateStatus, reorderTasks, grouped, draggedTask, draggedPhoto, assignPhotos]
  );

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin text-accent w-8 h-8 opacity-20" />
      </div>
    );
  }

  const tasks = grouped ?? { future: [], in_progress: [], done: [] };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-card rounded-xl text-muted hover:text-content transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-lg font-black uppercase tracking-tight text-content">Projects</h1>
          <p className="text-[10px] text-muted font-bold uppercase tracking-widest">Task board</p>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              status={col.key}
              label={col.label}
              color={col.color}
              dotColor={col.dotColor}
              tasks={tasks[col.key]}
              onDelete={handleDelete}
              onComplete={handleComplete}
              onEdit={handleEdit}
              onAdd={handleAdd}
              isDragActive={!!draggedTask}
              draggedTaskId={draggedTask?.id ?? null}
              justPlacedId={justPlacedId}
              dropTarget={dropTarget}
              dragHeight={dragHeight}
              photoDragging={!!draggedPhoto}
              photoCounts={photoCounts}
              onOpenDetail={setDetailTask}
            />
          ))}
        </div>

        {/* Photo Gallery — inside DndContext for drag-to-assign */}
        <PhotoGallery />

        <DragOverlay dropAnimation={null}>
          {draggedTask ? (
            <TaskCard
              task={draggedTask}
              onDelete={() => {}}
              onComplete={() => {}}
              onEdit={() => {}}
              isDragOverlay
            />
          ) : draggedPhoto ? (
            <div className="relative">
              {draggedPhotoCount > 1 && (
                <>
                  <div className="absolute -top-1 -left-1 w-16 h-16 rounded-xl bg-surface border-2 border-accent/30 rotate-[-3deg]" />
                  <div className="absolute -top-0.5 -left-0.5 w-16 h-16 rounded-xl bg-surface border-2 border-accent/40 rotate-[-1deg]" />
                </>
              )}
              <div className="relative w-16 h-16 rounded-xl overflow-hidden shadow-2xl shadow-black/30 rotate-3 border-2 border-accent/50">
                <img
                  src={draggedPhoto.thumbnail_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
                {draggedPhotoCount > 1 && (
                  <div className="absolute bottom-0 right-0 bg-accent text-white text-[10px] font-black px-1.5 py-0.5 rounded-tl-lg">
                    {draggedPhotoCount}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Task Detail Modal */}
      {detailTask && <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} />}
    </div>
  );
};
