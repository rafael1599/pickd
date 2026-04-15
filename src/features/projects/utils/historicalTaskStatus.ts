/**
 * Historical task status reconstruction.
 *
 * Pure functions for determining what status a project_task had on a given
 * day in the past. Used by the activity report so it shows the *real*
 * historical state, not the current one.
 *
 * Why this matters:
 *   - Activity reports are an audit trail. They must reflect what was true
 *     on the day in question, not what's true today.
 *   - Tasks can be created in any column (future / in_progress / done) and
 *     created tasks do NOT log to task_state_changes (only moves do).
 *   - A task's initial status must therefore be derived from either the
 *     earliest state change's from_status, or the current row if no changes
 *     ever happened.
 *
 * The algorithm is fully deterministic and tested in __tests__.
 *
 * IMPORTANT — timezone:
 *   This function takes day bounds as UTC ISO strings. The caller is
 *   responsible for converting "the NY day Apr 10" into the correct UTC
 *   bounds via `getNYDayBounds()` from `src/lib/nyDate.ts`. Do NOT construct
 *   bounds by hand from a YYYY-MM-DD string — that would assume UTC = NY,
 *   which is wrong by 4-5 hours and shifts seasonally with DST.
 */

export type TaskStatus = 'future' | 'in_progress' | 'done';

export interface TaskRow {
  id: string;
  title: string;
  note: string | null;
  status: TaskStatus; // current status (used as initial if there are zero state changes)
  created_at: string;
  position?: number;
}

export interface StateChangeRow {
  task_id: string;
  from_status: TaskStatus;
  to_status: TaskStatus;
  changed_at: string;
}

export interface BucketTask {
  task_id: string;
  title: string;
  note: string | null;
  photo_count?: number;
  photo_thumbnails?: string[];
}

export interface TaskStatusBuckets {
  done: BucketTask[]; // moved into 'done' on the report day (and still done at end of day)
  inProgress: BucketTask[]; // status at end of day = 'in_progress'
  future: BucketTask[]; // status at end of day = 'future'
}

function ms(iso: string): number {
  return new Date(iso).getTime();
}

/**
 * Compute the status of a task at a specific timestamp.
 * Returns null if the task did not yet exist at that point.
 */
export function statusAt(
  task: TaskRow,
  changesForTask: StateChangeRow[],
  atIso: string
): TaskStatus | null {
  const atMs = ms(atIso);
  if (ms(task.created_at) > atMs) return null;

  // Caller is responsible for sorting; sort defensively here too.
  const sorted = [...changesForTask].sort((a, b) => ms(a.changed_at) - ms(b.changed_at));
  const before = sorted.filter((c) => ms(c.changed_at) <= atMs);

  if (before.length > 0) {
    return before[before.length - 1].to_status;
  }

  // No changes yet at `at`. Derive the initial status:
  //   - if there are later changes, the first one's from_status is canonical
  //   - if there are zero changes ever, the current row IS the initial status
  if (sorted.length > 0) return sorted[0].from_status;
  return task.status;
}

/**
 * Bucket every task into done / inProgress / future based on their state on
 * the given report day. Tasks created after the day's end are excluded
 * (they didn't exist yet).
 *
 * @param dayStartUtc  UTC ISO of the start of the NY report day (from getNYDayBounds)
 * @param dayEndUtc    UTC ISO of the end of the NY report day   (from getNYDayBounds)
 *
 * Done bucket rule: status at end of day == 'done' AND status just before
 * the day started != 'done'. This means tasks that were already done
 * (carried over) are NOT counted as "done today", and a task that was
 * created today directly in 'done' IS counted as "done today".
 */
export function computeTaskStatusBuckets(
  dayStartUtc: string,
  dayEndUtc: string,
  tasks: TaskRow[],
  changes: StateChangeRow[]
): TaskStatusBuckets {
  // 1ms before the day starts — used to know what the status was "going into" the day
  const justBeforeDayIso = new Date(ms(dayStartUtc) - 1).toISOString();

  // Group state changes by task_id, sorted ASC, for fast lookup
  const changesByTask = new Map<string, StateChangeRow[]>();
  for (const c of changes) {
    const arr = changesByTask.get(c.task_id);
    if (arr) arr.push(c);
    else changesByTask.set(c.task_id, [c]);
  }
  for (const arr of changesByTask.values()) {
    arr.sort((a, b) => ms(a.changed_at) - ms(b.changed_at));
  }

  const done: BucketTask[] = [];
  const inProgress: BucketTask[] = [];
  const future: BucketTask[] = [];

  for (const task of tasks) {
    if (ms(task.created_at) > ms(dayEndUtc)) continue; // didn't exist yet

    const taskChanges = changesByTask.get(task.id) ?? [];
    const statusEnd = statusAt(task, taskChanges, dayEndUtc);
    const statusStart = statusAt(task, taskChanges, justBeforeDayIso);

    if (statusEnd === null) continue;

    const bucket: BucketTask = {
      task_id: task.id,
      title: task.title,
      note: task.note ?? null,
    };

    if (statusEnd === 'done') {
      // Only count as "done today" if it wasn't already done before today
      if (statusStart !== 'done') done.push(bucket);
      // else: carried-over done task → don't show in any bucket
    } else if (statusEnd === 'in_progress') {
      inProgress.push(bucket);
    } else if (statusEnd === 'future') {
      future.push(bucket);
    }
  }

  return { done, inProgress, future };
}
