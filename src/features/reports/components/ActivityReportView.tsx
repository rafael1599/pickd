import { useState } from 'react';
import type { ActivityReport } from '../hooks/useActivityReport';

const TEAL = '#1898b2';
const BG = '#f5f7fa';
const CARD_BG = '#ffffff';
const TEXT = '#2d3748';
const TEXT_BOLD = '#1a202c';
const TEXT_MUTED = '#718096';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

interface UserNote {
  id: string;
  full_name: string;
  text: string;
}

interface Props {
  report: ActivityReport;
  accuracyPct: number;
  notes: UserNote[];
}

function getAccuracyMessage(pct: number): string {
  if (pct < 10) return 'More cycle counts are needed to ensure system accuracy.';
  if (pct < 25) return 'Coverage is still low — prioritize counting high-value SKUs.';
  if (pct < 50) return 'Good progress. Keep counting to strengthen inventory confidence.';
  if (pct < 75) return 'Solid coverage. The system data is becoming reliable.';
  if (pct < 90) return 'Strong accuracy. Most of the inventory has been physically verified.';
  return 'Excellent. Nearly all inventory has been verified — high confidence in system data.';
}

const Card: React.FC<{ accent?: string; children: React.ReactNode }> = ({ accent = TEAL, children }) => (
  <div style={{ backgroundColor: CARD_BG, marginBottom: 10, display: 'flex', overflow: 'hidden' }}>
    <div style={{ width: 3, backgroundColor: accent, flexShrink: 0 }} />
    <div style={{ padding: '18px 20px', flex: 1 }}>{children}</div>
  </div>
);

const SectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: TEAL }}>
    {icon} {children}
  </p>
);

export const ActivityReportView: React.FC<Props> = ({ report, accuracyPct, notes }) => {
  const [detailOpen, setDetailOpen] = useState(false);
  const totals = report.warehouse_totals;
  const users = report.users;

  return (
    <div style={{ backgroundColor: BG, fontFamily: FONT, WebkitFontSmoothing: 'antialiased', padding: '32px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', paddingBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: TEXT_BOLD, letterSpacing: -0.5, lineHeight: 1.3 }}>
            Daily Warehouse Activity
          </h1>
          <p style={{ margin: 0, fontSize: 15, color: TEXT_MUTED, paddingTop: 6 }}>
            {formatDate(report.date)}
          </p>
          <div style={{ width: 60, height: 3, backgroundColor: TEAL, margin: '16px auto 0' }} />
        </div>

        {/* Supervisor notes — top of report */}
        {notes.length > 0 && (
          <>
            <SectionTitle icon="&#128221;">NOTES</SectionTitle>
            {notes.map((n, i) => (
              <Card key={i} accent="#ed8936">
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#c05621', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {n.full_name}
                </p>
                <p style={{ margin: 0, fontSize: 14, color: TEXT, lineHeight: 1.6 }}>
                  {n.text}
                </p>
              </Card>
            ))}
            <div style={{ height: 14 }} />
          </>
        )}

        {/* Summary Banner — compact */}
        <div style={{ backgroundColor: TEAL, padding: '24px 28px', marginBottom: 24 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: 'rgba(255,255,255,0.85)' }}>
            &#128230; DAY SUMMARY
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#fff', lineHeight: 1.5 }}>
              {totals.orders_completed} order{totals.orders_completed !== 1 ? 's' : ''} completed
            </p>
            {report.correction_count > 0 && (
              <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                {report.correction_count} correction{report.correction_count !== 1 ? 's' : ''} made
              </p>
            )}
          </div>
        </div>

        {/* Inventory Accuracy KPI */}
        {report.total_skus > 0 && report.verified_skus_2m > 0 && (
          <Card accent="#38b2ac">
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#38b2ac' }}>
              &#128202; Inventory Accuracy
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 42, fontWeight: 800, color: TEXT_BOLD, lineHeight: 1 }}>
                {accuracyPct}%
              </span>
              <span style={{ fontSize: 13, color: TEXT_MUTED }}>of SKUs verified</span>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: TEXT_MUTED, lineHeight: 1.5 }}>
              {report.verified_skus_2m} of {report.total_skus} SKUs have been physically counted in the last 60 days.
              {' '}{getAccuracyMessage(accuracyPct)}
            </p>
          </Card>
        )}

        {/* Collapsible detail section */}
        <div style={{ height: 14 }} />

        {/* Toggle button — hidden on print */}
        {users.length > 0 && (
          <button
            onClick={() => setDetailOpen((v) => !v)}
            className="print:hidden"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 0', marginBottom: 10,
              fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: 1.2, color: TEAL,
            }}
          >
            <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: detailOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              &#9654;
            </span>
            Team Detail ({users.length} member{users.length !== 1 ? 's' : ''} &middot; {totals.total_items} items)
          </button>
        )}

        {/* Detail content — always visible on print */}
        <div className="print:!block" style={{ display: detailOpen ? 'block' : 'none' }}>
          {users.length > 0 && (
            <>
              <SectionTitle icon="&#128100;">TEAM ACTIVITY</SectionTitle>
              {users.map((u) => {
                const lines: string[] = [];
                if (u.orders_picked > 0)
                  lines.push(`Picked ${u.orders_picked} order${u.orders_picked !== 1 ? 's' : ''} (${u.items_picked} items)`);
                if (u.orders_checked > 0)
                  lines.push(`Verified ${u.orders_checked} order${u.orders_checked !== 1 ? 's' : ''} (${u.items_checked} items)`);
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
                  <Card key={u.user_id}>
                    <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: TEXT_BOLD, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {u.full_name}
                    </p>
                    {lines.map((line, i) => (
                      <p key={i} style={{ margin: '0 0 4px', fontSize: 14, color: TEXT, lineHeight: 1.6 }}>
                        {line}
                      </p>
                    ))}
                  </Card>
                );
              })}
            </>
          )}

          {users.length === 0 && (
            <Card>
              <p style={{ margin: 0, fontSize: 14, color: TEXT_MUTED, textAlign: 'center' }}>
                No individual activity recorded for this date.
              </p>
            </Card>
          )}
        </div>

        {/* No activity fallback — only when detail is collapsed */}
        {users.length === 0 && !detailOpen && (
          <Card>
            <p style={{ margin: 0, fontSize: 14, color: TEXT_MUTED, textAlign: 'center' }}>
              No activity recorded for this date.
            </p>
          </Card>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', paddingTop: 24 }}>
          <p style={{ margin: 0, fontSize: 11, color: TEXT_MUTED }}>
            Generated by PickD &middot; {new Date().toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit',
            })}
          </p>
        </div>
      </div>
    </div>
  );
};
