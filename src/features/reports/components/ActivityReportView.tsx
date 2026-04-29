import { useState, useEffect, useRef } from 'react';
import type {
  ActivityReport,
  TodayEvents,
  TodayMoveEvent,
  TodayConsolidationEvent,
} from '../hooks/useActivityReport';
import type { ReportTask } from '../../projects/hooks/useProjectReportData';
import type { LowStockAlerts } from '../hooks/useLowStockAlerts';
import { PhotoLightbox } from '../../../components/ui/PhotoLightbox';

/**
 * Hook that returns a CSS class name that flashes briefly when `value` changes.
 * Used to highlight report sections when the editor updates them.
 */
function useHighlight(value: unknown): string {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 800);
      return () => clearTimeout(t);
    }
  }, [value]);
  return flash ? 'highlight-flash' : '';
}

const BG = '#f5f7fa';
const CARD_SHADOW = '0 1px 4px rgba(0,0,0,0.06)';
const CARD_BORDER = '1px solid #e8ecf1';
const TEXT = '#374151';
const TEXT_BOLD = '#1a202c';
const TEXT_MUTED = '#8b95a5';
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

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
  routineChecklist: string[];
  pickdUpdates: string[];
  doneToday: ReportTask[];
  inProgress: ReportTask[];
  comingUpNext: ReportTask[];
  waitingOrdersCount?: number;
  /**
   * Low-stock alerts (idea-070 / idea-071). Rendered inside the "On the
   * Floor" block. If both sub-lists are empty the block renders nothing
   * extra — we never show "no alerts".
   */
  lowStockAlerts?: LowStockAlerts;
  greeting?: string;
  /**
   * When true, renders a layout optimized for PDF export:
   * - Uses full-resolution gallery URLs instead of thumbnails
   * - Expands "Team Detail" inline (hides the collapse button)
   * - Disables interactive handlers (clicks / hovers)
   */
  printMode?: boolean;
  /**
   * When true, omits the PALLET PHOTOS section entirely. Used by the PDF
   * exporter — pallet photos get their own dedicated per-order pages.
   */
  skipPalletPhotos?: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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

/** Convert a thumbnail URL to its full-size counterpart. */
const thumbToFull = (url: string) => url.replace('/thumbs/', '/');

function renderTaskList(
  tasks: ReportTask[],
  color: string,
  bulletChar: '\u25CF' | '\u25CB',
  onPhotoClick?: (photos: string[], index: number) => void,
  printMode = false
) {
  return tasks.map((task, i) => {
    // In PDF export, use full-res URLs for display. Fall back to thumbnails if
    // photo_fullsize isn't populated (e.g. older cached data).
    const displayUrls =
      printMode && task.photo_fullsize && task.photo_fullsize.length > 0
        ? task.photo_fullsize
        : task.photo_thumbnails;
    const fullUrls =
      task.photo_fullsize && task.photo_fullsize.length > 0
        ? task.photo_fullsize
        : task.photo_thumbnails?.map(thumbToFull);

    return (
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
        {displayUrls && displayUrls.length > 0 && (
          <div
            style={{
              margin: '6px 0 0 18px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 6,
            }}
          >
            {displayUrls.map((url, j) => (
              <img
                key={j}
                src={url}
                alt=""
                onClick={
                  printMode || !onPhotoClick
                    ? undefined
                    : () => onPhotoClick(fullUrls ?? [], j)
                }
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  borderRadius: 8,
                  objectFit: 'cover',
                  border: `1px solid ${TEXT_MUTED}22`,
                  cursor: !printMode && onPhotoClick ? 'pointer' : undefined,
                }}
              />
            ))}
            {(task.photo_count ?? 0) > 3 && (
              <span
                style={{
                  fontSize: 11,
                  color: TEXT_MUTED,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                +{(task.photo_count ?? 0) - 3}
              </span>
            )}
          </div>
        )}
      </div>
    );
  });
}

const RED = '#dc2626';
const AMBER_ALERT = '#d97706';

// ─── idea-097 — Today's per-SKU events tables ──────────────────────────────
const cellHeadStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: TEXT_MUTED,
  borderBottom: `1px solid ${TEXT_MUTED}33`,
};
const cellStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  color: TEXT,
  verticalAlign: 'top',
  borderBottom: `1px solid ${TEXT_MUTED}1a`,
};
const skuStyle: React.CSSProperties = { fontSize: 11, color: TEXT_MUTED, fontFamily: 'monospace' };
const totalStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: 'right',
  fontWeight: 700,
  color: TEXT_BOLD,
  fontVariantNumeric: 'tabular-nums',
};
const subLineStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  fontSize: 11,
  color: TEXT_MUTED,
};
const sectionTitleStyle = (color: string): React.CSSProperties => ({
  margin: '0 0 6px 0',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color,
});

const fmtOthers = (others: { location: string; qty: number }[]): string =>
  others.map((o) => `${o.location} (${o.qty})`).join(', ');

const MovedRow: React.FC<{ ev: TodayMoveEvent }> = ({ ev }) => {
  const arrow = ev.from_location
    ? `${ev.from_location} → ${ev.to_location}`
    : `→ ${ev.to_location}`;
  const arrowWithQty = ev.show_qty_in_arrow ? `${arrow} (${ev.qty_moved})` : arrow;
  return (
    <tr>
      <td style={cellStyle}>{ev.item_name}</td>
      <td style={{ ...cellStyle, ...skuStyle }}>{ev.sku}</td>
      <td style={cellStyle}>
        {arrowWithQty}
        {ev.other_locations.length > 0 && (
          <span style={subLineStyle}>also {fmtOthers(ev.other_locations)}</span>
        )}
      </td>
      <td style={totalStyle}>{ev.total_now}</td>
    </tr>
  );
};

const ConsolidatedRow: React.FC<{ ev: TodayConsolidationEvent }> = ({ ev }) => (
  <tr>
    <td style={cellStyle}>
      {ev.item_name} <span style={skuStyle}>({ev.sku})</span>, consolidated on {ev.location}
    </td>
  </tr>
);

const TodayInventoryEventsBlock: React.FC<{ events?: TodayEvents | null }> = ({
  events,
}) => {
  // Defensive: persisted IndexedDB cache from pre-idea-097 deploys lacks
  // `today_events`. Treat missing as "no events today" instead of crashing.
  const moved = events?.moved ?? [];
  const consolidated = events?.consolidated ?? [];
  type Section = {
    key: 'moved' | 'consolidated';
    title: string;
    color: string;
    headers: string[]; // empty array → no header row
    rows: React.ReactNode;
    count: number;
  };
  const sections: Section[] = [
    {
      key: 'moved',
      title: 'Moved',
      color: BLUE,
      headers: ['Item', 'SKU', 'From → To', 'Total'],
      count: moved.length,
      rows: moved.map((ev) => <MovedRow key={ev.sku} ev={ev} />),
    },
    {
      key: 'consolidated',
      title: 'Consolidation',
      color: EMERALD,
      headers: [],
      count: consolidated.length,
      rows: consolidated.map((ev) => <ConsolidatedRow key={ev.sku} ev={ev} />),
    },
  ];

  const visible = sections.filter((s) => s.count > 0);
  if (visible.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      {visible.map((section) => (
        <div key={section.key} style={{ marginBottom: 14 }}>
          <p style={sectionTitleStyle(section.color)}>
            {section.title} — {section.count}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: FONT,
                tableLayout: 'auto',
              }}
            >
              {section.headers.length > 0 && (
                <thead>
                  <tr>
                    {section.headers.map((h, i) => (
                      <th
                        key={h}
                        style={
                          i === section.headers.length - 1 && h === 'Total'
                            ? { ...cellHeadStyle, textAlign: 'right' }
                            : cellHeadStyle
                        }
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>{section.rows}</tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Sub-block rendered inside the "ON THE FLOOR" card (idea-071). Shows SKUs
 * that went to 0 units (red) or 1 unit (amber) as a result of today's
 * completions (or Mon–Fri of the current week on Fridays). Each SKU is
 * displayed as "SKU — item name" with a remaining-qty badge.
 */
const LowStockAlertsBlock: React.FC<{
  alerts: LowStockAlerts;
  hasPrecedingBullets: boolean;
}> = ({ alerts, hasPrecedingBullets }) => {
  const renderRow = (row: LowStockAlerts['outOfStock'][number], color: string) => (
    <div key={`${color}-${row.sku}`} style={{ padding: '4px 0' }}>
      <p
        style={{
          ...bulletTextStyle,
          margin: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            minWidth: 22,
            textAlign: 'center',
            fontSize: 10,
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: 6,
            backgroundColor: `${color}1a`,
            color,
            letterSpacing: '0.05em',
          }}
        >
          {row.remaining_qty}
        </span>
        {row.item_name ? (
          <>
            <span style={{ fontSize: 14, color: TEXT }}>{row.item_name}</span>
            <span style={{ fontSize: 12, color: TEXT_MUTED }}>({row.sku})</span>
          </>
        ) : (
          <span style={{ fontWeight: 700, color: TEXT_BOLD }}>{row.sku}</span>
        )}
      </p>
    </div>
  );

  const subHeaderStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  };

  return (
    <div
      style={{
        marginTop: hasPrecedingBullets ? 14 : 0,
        paddingTop: hasPrecedingBullets ? 12 : 0,
        borderTop: hasPrecedingBullets ? `1px dashed ${TEXT_MUTED}33` : 'none',
      }}
    >
      <p
        style={{
          margin: '0 0 8px 0',
          fontSize: 10,
          fontWeight: 700,
          color: TEXT_MUTED,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        Low Stock · {alerts.windowLabel}
      </p>
      {(alerts.outOfStock ?? []).length > 0 && (
        <div style={{ marginBottom: (alerts.lastUnit ?? []).length > 0 ? 10 : 0 }}>
          <p style={{ ...subHeaderStyle, color: RED, marginBottom: 4 }}>
            Out of stock ({(alerts.outOfStock ?? []).length})
          </p>
          {(alerts.outOfStock ?? []).map((r) => renderRow(r, RED))}
        </div>
      )}
      {(alerts.lastUnit ?? []).length > 0 && (
        <div>
          <p style={{ ...subHeaderStyle, color: AMBER_ALERT, marginBottom: 4 }}>
            Last unit ({(alerts.lastUnit ?? []).length})
          </p>
          {(alerts.lastUnit ?? []).map((r) => renderRow(r, AMBER_ALERT))}
        </div>
      )}
    </div>
  );
};

export const ActivityReportView: React.FC<Props> = ({
  report,
  accuracyPct,
  notes,
  routineChecklist,
  pickdUpdates,
  doneToday,
  inProgress,
  comingUpNext,
  waitingOrdersCount = 0,
  lowStockAlerts,
  greeting,
  printMode = false,
  skipPalletPhotos = false,
}) => {
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const openLightbox = (photos: string[], index: number) => {
    setLightboxPhotos(photos);
    setLightboxIndex(index);
  };
  const closeLightbox = () => setLightboxPhotos([]);

  // Highlight flashes for editable sections
  const updatesFlash = useHighlight(pickdUpdates.join('\n'));
  const checklistFlash = useHighlight(routineChecklist.join(','));
  const notesFlash = useHighlight(notes.map(n => n.text).join(','));
  // Project section flashes (idea-096) — key on the filtered task IDs so
  // the card flashes green each time the user ticks a checkbox in the editor.
  const doneFlash = useHighlight(doneToday.map((t) => t.task_id).join(','));
  const inProgressFlash = useHighlight(inProgress.map((t) => t.task_id).join(','));
  const comingUpFlash = useHighlight(comingUpNext.map((t) => t.task_id).join(','));
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
  // Checked routine items
  for (const item of routineChecklist) {
    floorBullets.push(item);
  }

  // Free text notes
  for (const n of notes) {
    floorBullets.push(n.text);
  }

  const hasPickdUpdates = pickdUpdates.length > 0;
  const hasDoneToday = doneToday.length > 0;
  const hasInProgress = inProgress.length > 0;
  const hasLowStockAlerts =
    !!lowStockAlerts &&
    ((lowStockAlerts.outOfStock ?? []).length > 0 ||
      (lowStockAlerts.lastUnit ?? []).length > 0);
  const hasFloorContent = floorBullets.length > 0 || hasLowStockAlerts;
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
      className="report-preview"
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
            {formatDate(report.date)}
          </p>
        </div>

        {/* Greeting — optional */}
        {greeting && (
          <p
            style={{
              margin: '0 0 20px 0',
              fontSize: 15,
              fontWeight: 500,
              color: TEXT,
              lineHeight: 1.5,
            }}
          >
            {greeting}
          </p>
        )}

        {/* ON THE FLOOR — first block so readers see today's floor activity
            before anything else. Preview + clipboard copy use this order;
            the PDF doc (ActivityReportPdfDoc) keeps its own ordering. */}
        {hasFloorContent && (
          <>
            <div style={cardStyle} className={`${checklistFlash} ${notesFlash}`.trim()}>
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
              {hasLowStockAlerts && (
                <LowStockAlertsBlock
                  alerts={lowStockAlerts!}
                  hasPrecedingBullets={floorBullets.length > 0}
                />
              )}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* Inventory Accuracy KPI — top position */}
        {hasAccuracy && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(TEAL)}>INVENTORY ACCURACY</p>
              <p
                style={{
                  margin: '0 0 14px 0',
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: TEXT,
                }}
              >
                <strong style={{ color: TEXT_BOLD }}>Why this matters.</strong> Every SKU we
                physically touch today — moving it, consolidating it, recounting it — counts toward
                this number for the next 90 days. Goal:{' '}
                <strong style={{ color: TEXT_BOLD }}>100%</strong>, meaning every bike in the
                catalog has been seen with our own eyes in the last 3 months. The faster we hit
                that, the less we'll be guessing when an order comes in.
              </p>
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
              {/* Progress bar */}
              <div
                style={{
                  marginTop: 12,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: '#e8ecf1',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(accuracyPct, 100)}%`,
                    borderRadius: 5,
                    backgroundColor: TEAL,
                    transition: 'width 0.6s ease',
                  }}
                />
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
                in the last 90 days.
              </p>
              {/* Today's per-SKU events — idea-097. Replaces the per-source
                  bullet list (idea-094). Sections with N=0 hide themselves. */}
              <TodayInventoryEventsBlock events={report.today_events} />
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* PICKD UPDATES — conditional */}
        {hasPickdUpdates && (
          <>
            <div style={cardStyle} className={updatesFlash}>
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
            <div style={cardStyle} className={doneFlash}>
              <p style={sectionHeaderStyle(EMERALD)}>DONE TODAY</p>
              {renderTaskList(doneToday, EMERALD, '\u25CF', openLightbox, printMode)}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* PALLET PHOTOS — orders completed today with photos */}
        {!skipPalletPhotos && report.completed_orders_with_photos.length > 0 && (
          <>
            <div style={cardStyle} data-section="pallet-photos">
              <p style={sectionHeaderStyle(EMERALD)}>PALLET PHOTOS</p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: 10,
                }}
              >
                {report.completed_orders_with_photos.map((order) =>
                  order.photos.map((url, i) => (
                    <div
                      key={`${order.order_number}-${i}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <img
                        src={url}
                        alt=""
                        onClick={printMode ? undefined : () => openLightbox(order.photos, i)}
                        style={{
                          width: '100%',
                          aspectRatio: '1',
                          borderRadius: 8,
                          objectFit: 'cover',
                          border: `1px solid ${TEXT_MUTED}22`,
                          cursor: printMode ? undefined : 'pointer',
                        }}
                      />
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: TEXT_MUTED,
                          letterSpacing: '0.04em',
                        }}
                      >
                        #{order.order_number}
                        {order.photos.length > 1 ? ` (${i + 1}/${order.photos.length})` : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div style={spacerStyle} />
          </>
        )}


        {/* IN PROGRESS — conditional */}
        {hasInProgress && (
          <>
            <div style={cardStyle} className={inProgressFlash}>
              <p style={sectionHeaderStyle(AMBER)}>IN PROGRESS</p>
              {renderTaskList(inProgress, AMBER, '\u25CF', openLightbox, printMode)}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* COMING UP NEXT — conditional */}
        {hasComingUp && (
          <>
            <div style={cardStyle} className={comingUpFlash}>
              <p style={sectionHeaderStyle(BLUE)}>COMING UP NEXT</p>
              {renderTaskList(comingUpNext, BLUE, '\u25CB', openLightbox, printMode)}
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* Inventory Accuracy KPI — moved to top, after greeting */}

        {/* Waiting Orders Count (idea-053) — live value, not snapshotted */}
        {waitingOrdersCount > 0 && (
          <>
            <div style={cardStyle}>
              <p style={sectionHeaderStyle(AMBER)}>WAITING FOR INVENTORY</p>
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
                  {waitingOrdersCount}
                </span>
                <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                  {waitingOrdersCount === 1 ? 'order' : 'orders'} waiting
                </span>
              </div>
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 12,
                  color: TEXT_MUTED,
                  lineHeight: 1.5,
                }}
              >
                These orders are on hold until missing inventory arrives. Check the Verification Queue
                for details.
              </p>
            </div>
            <div style={spacerStyle} />
          </>
        )}

        {/* Warehouse Team aggregate — anonymized, always visible, copy-able.
            Replaces the per-user "Team Detail" collapsible. Per the team's
            preference, the report attributes all activity to the warehouse
            team as a unit. */}
        {users.length > 0 &&
          (() => {
            const agg = users.reduce(
              (acc, u) => {
                acc.orders_picked += u.orders_picked;
                acc.items_picked += u.items_picked;
                acc.orders_checked += u.orders_checked;
                acc.items_checked += u.items_checked;
                acc.inventory_adds += u.inventory_adds;
                acc.inventory_moves += u.inventory_moves;
                acc.inventory_deducts += u.inventory_deducts;
                acc.cycle_count_items += u.cycle_count_items;
                acc.cycle_count_discrepancies += u.cycle_count_discrepancies;
                return acc;
              },
              {
                orders_picked: 0,
                items_picked: 0,
                orders_checked: 0,
                items_checked: 0,
                inventory_adds: 0,
                inventory_moves: 0,
                inventory_deducts: 0,
                cycle_count_items: 0,
                cycle_count_discrepancies: 0,
              }
            );
            const lines: string[] = [];
            if (agg.orders_picked > 0)
              lines.push(
                `Picked ${agg.orders_picked} order${agg.orders_picked !== 1 ? 's' : ''} (${agg.items_picked} items)`
              );
            if (agg.orders_checked > 0)
              lines.push(
                `Verified ${agg.orders_checked} order${agg.orders_checked !== 1 ? 's' : ''} (${agg.items_checked} items)`
              );
            const inv: string[] = [];
            if (agg.inventory_adds > 0) inv.push(`${agg.inventory_adds} units received`);
            if (agg.inventory_moves > 0) inv.push(`${agg.inventory_moves} units moved`);
            if (agg.inventory_deducts > 0)
              inv.push(`${agg.inventory_deducts} units manually deducted`);
            if (inv.length > 0) lines.push(`Inventory: ${inv.join(', ')}`);
            if (agg.cycle_count_items > 0) {
              let cc = `Cycle counted ${agg.cycle_count_items} item${agg.cycle_count_items !== 1 ? 's' : ''}`;
              if (agg.cycle_count_discrepancies > 0)
                cc += ` (${agg.cycle_count_discrepancies} discrepanc${agg.cycle_count_discrepancies !== 1 ? 'ies' : 'y'})`;
              lines.push(cc);
            }
            if (lines.length === 0) return null;
            return (
              <div style={{ ...cardStyle, marginBottom: 10 }}>
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
                  Warehouse Team
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
          })()}

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
            {new Date().toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {lightboxPhotos.length > 0 && (
        <PhotoLightbox
          photos={lightboxPhotos}
          index={lightboxIndex}
          onClose={closeLightbox}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
};
