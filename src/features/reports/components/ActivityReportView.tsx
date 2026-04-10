import { useState } from 'react';
import type { ActivityReport } from '../hooks/useActivityReport';
import type { ReportTask } from '../../projects/hooks/useProjectReportData';

const BG = '#f5f7fa';
const CARD_SHADOW = '0 1px 4px rgba(0,0,0,0.06)';
const CARD_BORDER = '1px solid #e8ecf1';
const TEXT = '#374151';
const TEXT_BOLD = '#1a202c';
const TEXT_MUTED = '#8b95a5';
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const GREEN = '#10b981';
const EMERALD = '#059669';
const INDIGO = '#6366f1';
const BLUE = '#3b82f6';
const AMBER = '#f59e0b';
const TEAL = '#38b2ac';

interface UserNote {
  id: string;
  full_name: string;
  text: string;
}

interface Props {
  report: ActivityReport;
  accuracyPct: number;
  notes: UserNote[];
  winOfTheDay: string;
  routineChecklist: string[];
  pickdUpdates: string[];
  doneToday: ReportTask[];
  inProgress: ReportTask[];
  comingUpNext: ReportTask[];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(): string {
  return new Date().toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getAccuracyMessage(pct: number): string {
  if (pct < 10) return 'More cycle counts are needed to ensure system accuracy.';
  if (pct < 25) return 'Coverage is still low — prioritize counting high-value SKUs.';
  if (pct < 50) return 'Good progress. Keep counting to strengthen inventory confidence.';
  if (pct < 75) return 'Solid coverage. The system data is becoming reliable.';
  if (pct < 90) return 'Strong accuracy. Most of the inventory has been physically verified.';
  return 'Excellent. Nearly all inventory has been verified — high confidence in system data.';
}

const sectionHeaderStyle = (color: string): React.CSSProperties => ({
  margin: '0 0 12px 0',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color,
});

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: 16,
  boxShadow: CARD_SHADOW,
  padding: '28px 32px',
  border: CARD_BORDER,
};

const spacerStyle: React.CSSProperties = { height: 16 };

const bulletStyle = (color: string): React.CSSProperties => ({
  color,
  fontWeight: 700,
});

const bulletTextStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.55,
  color: TEXT,
};

const taskNoteStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: TEXT_MUTED,
  margin: '2px 0 0 18px',
  whiteSpace: 'pre-wrap',
};

function renderTaskList(
  tasks: ReportTask[],
  color: string,
  bulletChar: '\u25CF' | '\u25CB'
) {
  return tasks.map((task, i) => (
    <div
      key={task.task_id}
      style={{
        padding: i < tasks.length - 1 ? '0 0 10px 0' : 0,
      }}
    >
      <p style={{ ...bulletTextStyle, margin: 0 }}>
        <span style={bulletStyle(color)}>{bulletChar}</span>
        &nbsp;&nbsp;{task.title}
      </p>
      {task.note && task.note.trim().length > 0 && (
        <p style={taskNoteStyle}>{task.note}</p>
      )}
    </div>
  ));
}

export const ActivityReportView: React.FC<Props> = ({
  report,
  accuracyPct,
  notes,
  winOfTheDay,
  routineChecklist,
  pickdUpdates,
  doneToday,
  inProgress,
  comingUpNext,
}) => {
  const [detailOpen, setDetailOpen] = useState(false);
  const totals = report.warehouse_totals;
  const users = report.users;

  // Build "On the Floor" bullets
  const floorBullets: string[] = [];

  // Auto-generated warehouse summary
  if (totals.orders_completed > 0) {
    floorBullets.push(
      `Completed ${totals.orders_completed} order${totals.orders_completed !== 1 ? 's' : ''} (${totals.total_items} items)`
    );
  }
  if (report.correction_count > 0) {
    floorBullets.push(
      `${report.correction_count} correction${report.correction_count !== 1 ? 's' : ''} made during picking`
    );
  }

  // Checked routine items
  for (const item of routineChecklist) {
    floorBullets.push(item);
  }

  // Free text notes
  for (const n of notes) {
    floorBullets.push(`${n.full_name}: ${n.text}`);
  }

  const hasWin = winOfTheDay.trim().length > 0;
  const hasPickdUpdates = pickdUpdates.length > 0;
  const hasDoneToday = doneToday.length > 0;
  const hasInProgress = inProgress.length > 0;
  const hasFloorContent = floorBullets.length > 0;
  const hasComingUp = comingUpNext.length > 0;
  const hasAccuracy = report.total_skus > 0 && report.verified_skus_2m > 0;

  return (
    <div
      style={{
        backgroundColor: BG,
        fontFamily: FONT,
        WebkitFontSmoothing: 'antialiased',
        padding: '32px 16px',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', paddingBottom: 28 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: TEXT_MUTED,
            }}
          >
            Progress Update
          </p>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: 15,
              fontWeight: 600,
              color: '#5a6577',
            }}
          >
            {formatDate(report.date)} at {formatTime()}
          </p>
        </div>

        {/* WIN OF THE DAY — conditional */}
        {hasWin && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(GREEN)}>WIN OF THE DAY</p>
              <p
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 700,
                  lineHeight: 1.45,
                  color: TEXT_BOLD,
                }}
              >
                {winOfTheDay}
              </p>
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* PICKD UPDATES — conditional */}
        {hasPickdUpdates && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(INDIGO)}>PICKD UPDATES</p>
              {pickdUpdates.map((item, i) => (
                <p
                  key={i}
                  style={{
                    ...bulletTextStyle,
                    padding: i < pickdUpdates.length - 1 ? '0 0 10px 0' : 0,
                    margin: 0,
                  }}
                >
                  <span style={bulletStyle(INDIGO)}>&#9679;</span>
                  &nbsp;&nbsp;{item}
                </p>
              ))}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* DONE TODAY — auto from kanban "Hecho" */}
        {hasDoneToday && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(EMERALD)}>DONE TODAY</p>
              {renderTaskList(doneToday, EMERALD, '\u25CF')}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* IN PROGRESS — conditional */}
        {hasInProgress && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(AMBER)}>IN PROGRESS</p>
              {renderTaskList(inProgress, AMBER, '\u25CF')}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* ON THE FLOOR — always visible if there's content */}
        {hasFloorContent && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(BLUE)}>ON THE FLOOR</p>
              {floorBullets.map((item, i) => (
                <p
                  key={i}
                  style={{
                    ...bulletTextStyle,
                    padding: i < floorBullets.length - 1 ? '0 0 10px 0' : 0,
                    margin: 0,
                  }}
                >
                  <span style={bulletStyle(BLUE)}>&#9679;</span>
                  &nbsp;&nbsp;{item}
                </p>
              ))}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* COMING UP NEXT — conditional */}
        {hasComingUp && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(BLUE)}>COMING UP NEXT</p>
              {renderTaskList(comingUpNext, BLUE, '\u25CB')}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* Inventory Accuracy KPI */}
        {hasAccuracy && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(TEAL)}>INVENTORY ACCURACY</p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 42,
                    fontWeight: 800,
                    color: TEXT_BOLD,
                    lineHeight: 1,
                  }}
                >
                  {accuracyPct}%
                </span>
                <span style={{ fontSize: 13, color: TEXT_MUTED }}>of SKUs verified</span>
              </div>
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 12,
                  color: TEXT_MUTED,
                  lineHeight: 1.5,
                }}
              >
                {report.verified_skus_2m} of {report.total_skus} SKUs have been physically counted
                in the last 60 days. {getAccuracyMessage(accuracyPct)}
              </p>
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* Collapsible Team Detail */}
        {users.length > 0 && (
          <button
            onClick={() => setDetailOpen((v) => !v)}
            className="print:hidden"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '8px 0',
              marginBottom: 10,
              fontSize: 11,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              color: BLUE,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transition: 'transform 0.2s',
                transform: detailOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            >
              &#9654;
            </span>
            Team Detail ({users.length} member{users.length !== 1 ? 's' : ''} &middot;{' '}
            {totals.total_items} items)
          </button>
        )}

        {/* Detail content — always visible on print */}
        <div className="print:!block" style={{ display: detailOpen ? 'block' : 'none' }}>
          {users.map((u) => {
            const lines: string[] = [];
            if (u.orders_picked > 0)
              lines.push(
                `Picked ${u.orders_picked} order${u.orders_picked !== 1 ? 's' : ''} (${u.items_picked} items)`
              );
            if (u.orders_checked > 0)
              lines.push(
                `Verified ${u.orders_checked} order${u.orders_checked !== 1 ? 's' : ''} (${u.items_checked} items)`
              );
            const inv: string[] = [];
            if (u.inventory_adds > 0) inv.push(`${u.inventory_adds} units received`);
            if (u.inventory_moves > 0) inv.push(`${u.inventory_moves} units moved`);
            if (u.inventory_deducts > 0) inv.push(`${u.inventory_deducts} units manually deducted`);
            if (inv.length > 0) lines.push(`Inventory: ${inv.join(', ')}`);
            if (u.cycle_count_items > 0) {
              let cc = `Cycle counted ${u.cycle_count_items} item${u.cycle_count_items !== 1 ? 's' : ''}`;
              if (u.cycle_count_discrepancies > 0)
                cc += ` (${u.cycle_count_discrepancies} discrepanc${u.cycle_count_discrepancies !== 1 ? 'ies' : 'y'})`;
              lines.push(cc);
            }

            return (
              <div key={u.user_id} style={{ ...cardStyle, marginBottom: 10 }}>
                <p
                  style={{
                    margin: '0 0 8px',
                    fontSize: 12,
                    fontWeight: 800,
                    color: BLUE,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                  }}
                >
                  {u.full_name}
                </p>
                {lines.map((line, i) => (
                  <p
                    key={i}
                    style={{
                      ...bulletTextStyle,
                      padding: i < lines.length - 1 ? '0 0 6px 0' : 0,
                      margin: 0,
                    }}
                  >
                    <span style={bulletStyle(BLUE)}>&#9679;</span>
                    &nbsp;&nbsp;{line}
                  </p>
                ))}
              </div>
            );
          })}
        </div>

        {/* No activity fallback */}
        {users.length === 0 && !hasFloorContent && (
          <div style={{ ...cardStyle, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: TEXT_MUTED }}>
              No activity recorded for this date.
            </p>
          </div>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '8px 0 0 0' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TEXT_MUTED }}>
            {totals.orders_completed} order{totals.orders_completed !== 1 ? 's' : ''} today
            {report.correction_count > 0 &&
              ` / ${report.correction_count} correction${report.correction_count !== 1 ? 's' : ''}`}
          </p>
          <p style={{ margin: '6px 0 0 0', fontSize: 12, color: '#a0aab8' }}>
            Generated by PickD &middot;{' '}
            {new Date().toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
      </div>
    </div>
  );
};
