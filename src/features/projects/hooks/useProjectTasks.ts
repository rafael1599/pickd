import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaskStatus = 'future' | 'in_progress' | 'done';

export interface ProjectTask {
  id: string;
  title: string;
  note: string | null;
  status: TaskStatus;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupedTasks {
  future: ProjectTask[];
  in_progress: ProjectTask[];
  done: ProjectTask[];
}

const QUERY_KEY = ['project-tasks'] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function groupByStatus(tasks: ProjectTask[]): GroupedTasks {
  const grouped: GroupedTasks = { future: [], in_progress: [], done: [] };
  for (const task of tasks) {
    grouped[task.status].push(task);
  }
  return grouped;
}

// ─── Query: fetch all tasks ──────────────────────────────────────────────────

export function useProjectTasks() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<GroupedTasks> => {
      const { data, error } = await supabase
        .from('project_tasks')
        .select('*')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return groupByStatus((data as ProjectTask[]) ?? []);
    },
  });
}

// ─── Mutation: create task ───────────────────────────────────────────────────

interface CreateTaskVars {
  title: string;
  note?: string;
  status: TaskStatus;
}

export function useCreateTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: CreateTaskVars) => {
      const userId = await getCurrentUserId();

      // Get max position for the target column
      const { data: existing } = await supabase
        .from('project_tasks')
        .select('position')
        .eq('status', vars.status)
        .order('position', { ascending: false })
        .limit(1);

      const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;

      const { data, error } = await supabase
        .from('project_tasks')
        .insert({
          title: vars.title,
          note: vars.note ?? null,
          status: vars.status,
          position: nextPosition,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;
      return data as ProjectTask;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<GroupedTasks>(QUERY_KEY);

      const optimistic: ProjectTask = {
        id: crypto.randomUUID(),
        title: vars.title,
        note: vars.note ?? null,
        status: vars.status,
        position: 9999,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      qc.setQueryData<GroupedTasks>(QUERY_KEY, (old) => {
        if (!old) return { future: [], in_progress: [], done: [optimistic] };
        return { ...old, [vars.status]: [...old[vars.status], optimistic] };
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// ─── Mutation: update task status (+ log state change) ───────────────────────

interface UpdateStatusVars {
  taskId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  newPosition: number;
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: UpdateStatusVars) => {
      const userId = await getCurrentUserId();

      // Update task status + position
      const { error: updateErr } = await supabase
        .from('project_tasks')
        .update({
          status: vars.toStatus,
          position: vars.newPosition,
          updated_at: new Date().toISOString(),
        })
        .eq('id', vars.taskId);

      if (updateErr) throw updateErr;

      // Log the state change
      const { error: logErr } = await supabase.from('task_state_changes').insert({
        task_id: vars.taskId,
        from_status: vars.fromStatus,
        to_status: vars.toStatus,
        changed_by: userId,
      });

      if (logErr) throw logErr;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<GroupedTasks>(QUERY_KEY);

      qc.setQueryData<GroupedTasks>(QUERY_KEY, (old) => {
        if (!old) return { future: [], in_progress: [], done: [] };

        const task = old[vars.fromStatus].find((t) => t.id === vars.taskId);
        if (!task) return old;

        const moved = { ...task, status: vars.toStatus, position: vars.newPosition };

        return {
          ...old,
          [vars.fromStatus]: old[vars.fromStatus].filter((t) => t.id !== vars.taskId),
          [vars.toStatus]: [...old[vars.toStatus], moved].sort((a, b) => a.position - b.position),
        };
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// ─── Mutation: update task title/note ────────────────────────────────────────

interface UpdateTaskVars {
  taskId: string;
  title?: string;
  note?: string | null;
}

export function useUpdateTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: UpdateTaskVars) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (vars.title !== undefined) updates.title = vars.title;
      if (vars.note !== undefined) updates.note = vars.note;

      const { error } = await supabase.from('project_tasks').update(updates).eq('id', vars.taskId);

      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<GroupedTasks>(QUERY_KEY);

      qc.setQueryData<GroupedTasks>(QUERY_KEY, (old) => {
        if (!old) return { future: [], in_progress: [], done: [] };

        const newGrouped = { ...old };
        for (const status of ['future', 'in_progress', 'done'] as TaskStatus[]) {
          newGrouped[status] = old[status].map((t) => {
            if (t.id !== vars.taskId) return t;
            return {
              ...t,
              ...(vars.title !== undefined ? { title: vars.title } : {}),
              ...(vars.note !== undefined ? { note: vars.note } : {}),
            };
          });
        }
        return newGrouped;
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// ─── Mutation: reorder tasks within a column ────────────────────────────────

interface ReorderTasksVars {
  status: TaskStatus;
  orderedIds: string[];
}

export function useReorderTasks() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: ReorderTasksVars) => {
      // Batch update positions
      const updates = vars.orderedIds.map((id, index) =>
        supabase
          .from('project_tasks')
          .update({ position: index, updated_at: new Date().toISOString() })
          .eq('id', id)
      );

      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<GroupedTasks>(QUERY_KEY);

      qc.setQueryData<GroupedTasks>(QUERY_KEY, (old) => {
        if (!old) return { future: [], in_progress: [], done: [] };

        const reordered = vars.orderedIds
          .map((id, index) => {
            const task = old[vars.status].find((t) => t.id === id);
            return task ? { ...task, position: index } : null;
          })
          .filter(Boolean) as ProjectTask[];

        return { ...old, [vars.status]: reordered };
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// ─── Mutation: delete task ───────────────────────────────────────────────────

interface DeleteTaskVars {
  taskId: string;
  status: TaskStatus;
}

export function useDeleteTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: DeleteTaskVars) => {
      const { error } = await supabase.from('project_tasks').delete().eq('id', vars.taskId);
      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const previous = qc.getQueryData<GroupedTasks>(QUERY_KEY);

      qc.setQueryData<GroupedTasks>(QUERY_KEY, (old) => {
        if (!old) return { future: [], in_progress: [], done: [] };
        return {
          ...old,
          [vars.status]: old[vars.status].filter((t) => t.id !== vars.taskId),
        };
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QUERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
