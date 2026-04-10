import { describe, it, expect } from 'vitest';
import {
  computeTaskStatusBuckets,
  statusAt,
  type TaskRow,
  type StateChangeRow,
} from '../historicalTaskStatus';

const REPORT_DATE = '2026-04-10';

function task(overrides: Partial<TaskRow> & Pick<TaskRow, 'id'>): TaskRow {
  return {
    id: overrides.id,
    title: overrides.title ?? `Task ${overrides.id}`,
    note: overrides.note ?? null,
    status: overrides.status ?? 'future',
    created_at: overrides.created_at ?? '2026-04-10T08:00:00.000Z',
    position: 0,
  };
}

function change(
  task_id: string,
  from: StateChangeRow['from_status'],
  to: StateChangeRow['to_status'],
  changed_at: string
): StateChangeRow {
  return { task_id, from_status: from, to_status: to, changed_at };
}

// ─── statusAt — pure status reconstruction ───────────────────────────────────

describe('statusAt', () => {
  it('returns null if task did not exist yet', () => {
    const t = task({ id: '1', created_at: '2026-04-11T00:00:00.000Z' });
    expect(statusAt(t, [], '2026-04-10T23:59:59.999Z')).toBe(null);
  });

  it('returns current status when there are zero state changes (created in future)', () => {
    const t = task({ id: '1', status: 'future' });
    expect(statusAt(t, [], '2026-04-10T23:59:59.999Z')).toBe('future');
  });

  it('returns current status when there are zero state changes (created directly in in_progress)', () => {
    const t = task({ id: '1', status: 'in_progress' });
    expect(statusAt(t, [], '2026-04-10T23:59:59.999Z')).toBe('in_progress');
  });

  it('returns current status when there are zero state changes (created directly in done)', () => {
    const t = task({ id: '1', status: 'done' });
    expect(statusAt(t, [], '2026-04-10T23:59:59.999Z')).toBe('done');
  });

  it('returns from_status of earliest change when querying BEFORE first change', () => {
    const t = task({
      id: '1',
      status: 'in_progress', // current
      created_at: '2026-04-08T00:00:00.000Z',
    });
    const changes = [change('1', 'future', 'in_progress', '2026-04-10T15:00:00.000Z')];
    // querying at end of 2026-04-09 — before the change happened
    expect(statusAt(t, changes, '2026-04-09T23:59:59.999Z')).toBe('future');
  });

  it('returns to_status of latest change when there are changes ≤ at', () => {
    const t = task({ id: '1', status: 'done', created_at: '2026-04-08T00:00:00.000Z' });
    const changes = [
      change('1', 'future', 'in_progress', '2026-04-09T10:00:00.000Z'),
      change('1', 'in_progress', 'done', '2026-04-10T15:00:00.000Z'),
    ];
    expect(statusAt(t, changes, '2026-04-09T23:59:59.999Z')).toBe('in_progress');
    expect(statusAt(t, changes, '2026-04-10T23:59:59.999Z')).toBe('done');
  });

  it('handles unsorted changes input (sorts defensively)', () => {
    const t = task({ id: '1', status: 'done', created_at: '2026-04-08T00:00:00.000Z' });
    const changes = [
      change('1', 'in_progress', 'done', '2026-04-10T15:00:00.000Z'),
      change('1', 'future', 'in_progress', '2026-04-09T10:00:00.000Z'),
    ];
    expect(statusAt(t, changes, '2026-04-09T23:59:59.999Z')).toBe('in_progress');
  });
});

// ─── computeTaskStatusBuckets — full bucket logic ────────────────────────────

describe('computeTaskStatusBuckets', () => {
  it('excludes tasks created after the report date', () => {
    const tasks = [
      task({ id: '1', status: 'future', created_at: '2026-04-11T08:00:00.000Z' }),
      task({ id: '2', status: 'in_progress', created_at: '2026-04-11T08:00:00.000Z' }),
    ];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, []);
    expect(buckets.done).toHaveLength(0);
    expect(buckets.inProgress).toHaveLength(0);
    expect(buckets.future).toHaveLength(0);
  });

  it('puts a task created today in future into the future bucket', () => {
    const tasks = [task({ id: '1', status: 'future', created_at: '2026-04-10T08:00:00.000Z' })];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, []);
    expect(buckets.future.map((t) => t.task_id)).toEqual(['1']);
  });

  it('puts a task created today directly in done into the done bucket', () => {
    const tasks = [task({ id: '1', status: 'done', created_at: '2026-04-10T08:00:00.000Z' })];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, []);
    expect(buckets.done.map((t) => t.task_id)).toEqual(['1']);
  });

  it('puts a task moved to done today in the done bucket', () => {
    const tasks = [task({ id: '1', status: 'done', created_at: '2026-04-08T08:00:00.000Z' })];
    const changes = [change('1', 'in_progress', 'done', '2026-04-10T15:00:00.000Z')];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, changes);
    expect(buckets.done.map((t) => t.task_id)).toEqual(['1']);
    expect(buckets.inProgress).toHaveLength(0);
  });

  it('does NOT count carry-over done tasks (already done before today)', () => {
    const tasks = [task({ id: '1', status: 'done', created_at: '2026-04-08T08:00:00.000Z' })];
    const changes = [change('1', 'in_progress', 'done', '2026-04-09T15:00:00.000Z')];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, changes);
    expect(buckets.done).toHaveLength(0);
    expect(buckets.inProgress).toHaveLength(0);
    expect(buckets.future).toHaveLength(0);
  });

  it('shows past in_progress correctly even if task was later moved to done', () => {
    // Task created in future on Apr 8, moved to in_progress Apr 9, moved to done Apr 11
    const tasks = [task({ id: '1', status: 'done', created_at: '2026-04-08T08:00:00.000Z' })];
    const changes = [
      change('1', 'future', 'in_progress', '2026-04-09T10:00:00.000Z'),
      change('1', 'in_progress', 'done', '2026-04-11T10:00:00.000Z'),
    ];
    // On Apr 10, status was in_progress
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, changes);
    expect(buckets.inProgress.map((t) => t.task_id)).toEqual(['1']);
    expect(buckets.done).toHaveLength(0);
    expect(buckets.future).toHaveLength(0);
  });

  it('dedupes a task moved to done multiple times in the same day', () => {
    // Task moved to done at 10am, moved out to in_progress at 11am, moved back to done at 3pm
    const tasks = [task({ id: '1', status: 'done', created_at: '2026-04-08T08:00:00.000Z' })];
    const changes = [
      change('1', 'in_progress', 'done', '2026-04-10T10:00:00.000Z'),
      change('1', 'done', 'in_progress', '2026-04-10T11:00:00.000Z'),
      change('1', 'in_progress', 'done', '2026-04-10T15:00:00.000Z'),
    ];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, changes);
    expect(buckets.done.map((t) => t.task_id)).toEqual(['1']);
    expect(buckets.inProgress).toHaveLength(0);
  });

  it('a task marked done then moved back to in_progress on the same day shows as in_progress (not done)', () => {
    const tasks = [task({ id: '1', status: 'in_progress', created_at: '2026-04-08T08:00:00.000Z' })];
    const changes = [
      change('1', 'in_progress', 'done', '2026-04-10T10:00:00.000Z'),
      change('1', 'done', 'in_progress', '2026-04-10T15:00:00.000Z'),
    ];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, changes);
    expect(buckets.done).toHaveLength(0);
    expect(buckets.inProgress.map((t) => t.task_id)).toEqual(['1']);
  });

  it('a task carried over as in_progress that becomes done today appears in done', () => {
    const tasks = [task({ id: '1', status: 'done', created_at: '2026-04-05T08:00:00.000Z' })];
    const changes = [
      change('1', 'future', 'in_progress', '2026-04-08T10:00:00.000Z'),
      change('1', 'in_progress', 'done', '2026-04-10T15:00:00.000Z'),
    ];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, changes);
    expect(buckets.done.map((t) => t.task_id)).toEqual(['1']);
    expect(buckets.inProgress).toHaveLength(0);
  });

  it('a task created today in in_progress appears in inProgress for today', () => {
    const tasks = [task({ id: '1', status: 'in_progress', created_at: '2026-04-10T08:00:00.000Z' })];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, []);
    expect(buckets.inProgress.map((t) => t.task_id)).toEqual(['1']);
  });

  it('a future task created yesterday and not moved appears in future', () => {
    const tasks = [task({ id: '1', status: 'future', created_at: '2026-04-09T08:00:00.000Z' })];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, []);
    expect(buckets.future.map((t) => t.task_id)).toEqual(['1']);
  });

  it('handles mixed scenarios across multiple tasks', () => {
    const tasks = [
      // T1: done today (was in_progress yesterday)
      task({ id: '1', status: 'done', created_at: '2026-04-08T08:00:00.000Z' }),
      // T2: still in progress from earlier
      task({ id: '2', status: 'in_progress', created_at: '2026-04-05T08:00:00.000Z' }),
      // T3: future, untouched
      task({ id: '3', status: 'future', created_at: '2026-04-09T08:00:00.000Z' }),
      // T4: created today in future
      task({ id: '4', status: 'future', created_at: '2026-04-10T11:00:00.000Z' }),
      // T5: created tomorrow — should be excluded
      task({ id: '5', status: 'in_progress', created_at: '2026-04-11T08:00:00.000Z' }),
      // T6: completed last week (carry-over)
      task({ id: '6', status: 'done', created_at: '2026-04-01T08:00:00.000Z' }),
    ];
    const changes = [
      change('1', 'future', 'in_progress', '2026-04-09T10:00:00.000Z'),
      change('1', 'in_progress', 'done', '2026-04-10T16:00:00.000Z'),
      change('2', 'future', 'in_progress', '2026-04-06T10:00:00.000Z'),
      change('6', 'in_progress', 'done', '2026-04-03T10:00:00.000Z'),
    ];
    const buckets = computeTaskStatusBuckets(REPORT_DATE, tasks, changes);
    expect(buckets.done.map((t) => t.task_id).sort()).toEqual(['1']);
    expect(buckets.inProgress.map((t) => t.task_id).sort()).toEqual(['2']);
    expect(buckets.future.map((t) => t.task_id).sort()).toEqual(['3', '4']);
  });
});
