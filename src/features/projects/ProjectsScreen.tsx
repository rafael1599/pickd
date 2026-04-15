import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

// ─── Draggable Task Card ─────────────────────────────────────────────────────

const TaskCard: React.FC<{
  task: ProjectTask;
  onDelete: (taskId: string, status: TaskStatus) => void;
  onComplete: (task: ProjectTask) => void;
  onEdit: (taskId: string, title: string, note: string | null) => void;
  isDragOverlay?: boolean;
}> = ({ task, onDelete, onComplete, onEdit, isDragOverlay }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNote, setEditNote] = useState(task.note ?? '');

  const { attributes, listeners, setNodeRef, isDragging, transform, transition } = useSortable({
    id: task.id,
    data: { task },
    disabled: isEditing,
  });

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleSave = () => {
    if (!editTitle.trim()) return;
    onEdit(task.id, editTitle.trim(), editNote.trim() || null);
    setIsEditing(false);
  };

  const timeAgo = formatTimeAgo(task.created_at);

  if (isEditing) {
    return (
      <div ref={setNodeRef} className="p-3 bg-surface border border-accent/30 rounded-xl space-y-2">
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

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={isDragOverlay ? undefined : sortableStyle}
      className={`group p-3 bg-surface border border-subtle rounded-xl transition-all duration-150 ${
        isDragging && !isDragOverlay ? 'opacity-30 scale-95' : ''
      } ${isDragOverlay ? 'shadow-xl rotate-2 scale-105' : ''}`}
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

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-content leading-tight">{task.title}</p>
          {task.note && (
            <p className="text-xs text-muted mt-1 line-clamp-2 leading-relaxed">{task.note}</p>
          )}
          <p className="text-[10px] text-muted/60 mt-1.5 font-medium">{timeAgo}</p>
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
}> = ({ status, label, dotColor, tasks, onDelete, onComplete, onEdit, onAdd }) => {
  const [showForm, setShowForm] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${status}`,
    data: { status },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col bg-card border rounded-2xl p-3 min-h-[200px] transition-all duration-200 ${
        isOver ? 'border-accent/50 bg-accent/5 ring-1 ring-accent/20' : 'border-subtle'
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
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onDelete={onDelete}
              onComplete={onComplete}
              onEdit={onEdit}
            />
          ))}
          {tasks.length === 0 && !showForm && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-muted/40 font-bold uppercase tracking-wider">No tasks</p>
            </div>
          )}
        </div>
      </SortableContext>
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

  const [draggedTask, setDraggedTask] = useState<ProjectTask | null>(null);

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
    const task = event.active.data.current?.task as ProjectTask | undefined;
    if (task) setDraggedTask(task);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedTask(null);

      const { active, over } = event;
      if (!over) return;

      const task = active.data.current?.task as ProjectTask | undefined;
      if (!task) return;

      // Determine target: could be a column droppable or a sortable item
      const overTask = over.data.current?.task as ProjectTask | undefined;
      const targetStatus = over.data.current?.status as TaskStatus | undefined;

      // Case 1: Dropped on a column header (cross-column)
      if (targetStatus && targetStatus !== task.status) {
        const targetCount = grouped?.[targetStatus]?.length ?? 0;
        updateStatus.mutate({
          taskId: task.id,
          fromStatus: task.status,
          toStatus: targetStatus,
          newPosition: targetCount,
        });
        return;
      }

      // Case 2: Dropped on another task
      if (overTask) {
        const sourceStatus = task.status;
        const destStatus = overTask.status;
        const columnTasks = grouped?.[sourceStatus] ?? [];

        if (sourceStatus === destStatus) {
          // Within-column reorder
          const oldIndex = columnTasks.findIndex((t) => t.id === active.id);
          const newIndex = columnTasks.findIndex((t) => t.id === over.id);
          if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

          const reordered = arrayMove(columnTasks, oldIndex, newIndex);
          reorderTasks.mutate({
            status: sourceStatus,
            orderedIds: reordered.map((t) => t.id),
          });
        } else {
          // Cross-column: move to the position of the target task
          const destTasks = grouped?.[destStatus] ?? [];
          const insertIndex = destTasks.findIndex((t) => t.id === over.id);
          updateStatus.mutate({
            taskId: task.id,
            fromStatus: sourceStatus,
            toStatus: destStatus,
            newPosition: insertIndex >= 0 ? insertIndex : destTasks.length,
          });
        }
      }
    },
    [updateStatus, reorderTasks, grouped]
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
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
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
            />
          ))}
        </div>

        <DragOverlay>
          {draggedTask ? (
            <TaskCard
              task={draggedTask}
              onDelete={() => {}}
              onComplete={() => {}}
              onEdit={() => {}}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};
