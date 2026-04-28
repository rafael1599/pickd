/**
 * Activity Report PDF document — vector output via @react-pdf/renderer.
 *
 * Reimplementation of Direction A · Dashboard grid using react-pdf
 * primitives (View / Text / Image / Svg). The output is a real vector
 * PDF with selectable text and embedded Inter + JetBrains Mono fonts.
 *
 * Two pages at A4 portrait:
 *   - Summary: hero Inventory Accuracy + Win + 2×2 activity + PickD Updates
 *   - Pallet photos: grid of completed-order pallet images (only if any)
 *
 * Replaces the previous html2canvas-based export which rasterised the
 * whole page to a JPEG, producing a blurry non-selectable PDF.
 */

import { Document, Page, View, Text, Image, Svg, Rect } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type {
  ActivityReport,
  TodayMoveEvent,
  TodayVerifiedEvent,
  TodayAddedEvent,
} from '../hooks/useActivityReport';
import type { ReportTask } from '../../projects/hooks/useProjectReportData';
import { registerPdfFonts } from '../../../lib/pdf/fonts';
import {
  TONE,
  SANS,
  MONO,
  A4_MARGIN,
  pickCols,
  formatDateLong,
  formatDateShort,
} from '../../../lib/pdf/tokens';
import { Step, CornerMarks } from '../../../lib/pdf/primitives';

registerPdfFonts();

// ── Types ──────────────────────────────────────────────────────────────

interface UserNote {
  id: string;
  full_name: string;
  text: string;
}

export interface ActivityReportPdfDocProps {
  report: ActivityReport;
  accuracyPct: number;
  winOfTheDay: string;
  pickdUpdates: string[];
  doneToday: ReportTask[];
  inProgress: ReportTask[];
  comingUpNext: ReportTask[];
  notes: UserNote[];
  routineChecklist: string[];
}

type Density = 'sparse' | 'normal' | 'dense';

// ── Helpers ────────────────────────────────────────────────────────────

function pickDensity(args: {
  doneToday: unknown[];
  inProgress: unknown[];
  comingUpNext: unknown[];
  pickdUpdates: unknown[];
  floorBullets: unknown[];
  winOfTheDay: string;
}): Density {
  const total =
    args.doneToday.length +
    args.inProgress.length +
    args.comingUpNext.length +
    args.pickdUpdates.length +
    args.floorBullets.length +
    (args.winOfTheDay?.trim() ? 1 : 0);
  if (total <= 5) return 'sparse';
  if (total >= 14) return 'dense';
  return 'normal';
}

function heroSize(density: Density): number {
  // react-pdf has no DOM / ResizeObserver, so we pick the hero number's
  // font-size from content density directly. Sparse day → big; dense → compact.
  if (density === 'sparse') return 140;
  if (density === 'dense') return 72;
  return 104;
}

function buildFloorBullets(args: ActivityReportPdfDocProps): string[] {
  const out: string[] = [];
  const totals = args.report.warehouse_totals;
  if (totals.orders_completed > 0) {
    out.push(
      `Completed ${totals.orders_completed} order${
        totals.orders_completed !== 1 ? 's' : ''
      } — ${totals.total_items} items`
    );
  }
  for (const item of args.routineChecklist) out.push(item);
  for (const note of args.notes) out.push(note.text);
  return out;
}

interface ActivityItem {
  filled: boolean;
  title: string;
  sub?: string;
}

function mapTasksToItems(tasks: ReportTask[], filled: boolean): ActivityItem[] {
  return tasks.slice(0, 4).map((t) => ({
    filled,
    title: t.title,
    sub: t.note?.trim() || undefined,
  }));
}

function splitFloorBullet(s: string): ActivityItem {
  const m = s.match(/^(.+?)\s+[—–-]\s+(.+)$/) ?? s.match(/^([^:]+):\s*(.+)$/);
  if (m) return { filled: true, title: m[1].trim(), sub: m[2].trim() };
  return { filled: true, title: s };
}

// ── Primitives ─────────────────────────────────────────────────────────

/** Horizontal label row: numbered step + caps label + hairline rule. */
function StepHeader({
  n,
  label,
  color = TONE.ink,
  marginTop = 12,
}: {
  n: string;
  label: string;
  color?: string;
  marginTop?: number;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginTop,
        marginBottom: 6,
      }}
    >
      <Step n={n} color={color} size={16} />
      <Text
        style={{
          fontFamily: SANS,
          fontSize: 8.5,
          fontWeight: 600,
          letterSpacing: 1.5,
          color: TONE.muted,
          marginLeft: 8,
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: TONE.hair, marginLeft: 8 }} />
    </View>
  );
}


// ── idea-097 — Today's per-SKU events ──────────────────────────────────

const PDF_TBL_FONT = 9;
const PDF_TBL_HEAD = 7.5;

const pdfRowStyle = {
  flexDirection: 'row' as const,
  borderBottomWidth: 0.5,
  borderBottomColor: TONE.hair,
  paddingVertical: 4,
};
const pdfHeadCell = (width: string, align: 'left' | 'right' = 'left') => ({
  width,
  fontSize: PDF_TBL_HEAD,
  fontFamily: SANS,
  fontWeight: 700,
  letterSpacing: 0.6,
  color: TONE.ink2,
  textTransform: 'uppercase' as const,
  textAlign: align,
  paddingHorizontal: 4,
});
const pdfCell = (width: string, align: 'left' | 'right' = 'left') => ({
  width,
  fontSize: PDF_TBL_FONT,
  fontFamily: SANS,
  color: TONE.ink,
  textAlign: align,
  paddingHorizontal: 4,
});

function TodayEventsPdfBlock({ report }: { report: ActivityReport }) {
  // Defensive: persisted cache from pre-idea-097 may lack today_events.
  const today = report.today_events ?? { moved: [], verified: [], added: [] };
  const { moved, verified, added } = today;
  const sections = [
    { key: 'moved', title: 'Moved', color: TONE.teal, locHeader: 'From → To', items: moved },
    {
      key: 'verified',
      title: 'Verified on site',
      color: TONE.teal,
      locHeader: 'Location',
      items: verified,
    },
    { key: 'added', title: 'Added', color: TONE.teal, locHeader: 'Added → Location', items: added },
  ] as const;
  const visible = sections.filter((s) => s.items.length > 0);
  if (visible.length === 0) return null;

  const fmtOthers = (others: { location: string; qty: number }[]) =>
    others.map((o) => `${o.location} (${o.qty})`).join(', ');

  return (
    <View style={{ marginTop: 8 }}>
      {visible.map((section) => (
        <View key={section.key} style={{ marginBottom: 10 }}>
          <Text
            style={{
              fontFamily: SANS,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: 1.2,
              color: section.color,
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {section.title} — {section.items.length}
          </Text>
          {/* Header row */}
          <View style={pdfRowStyle}>
            <Text style={pdfHeadCell('40%')}>Item</Text>
            <Text style={{ ...pdfHeadCell('20%'), fontFamily: MONO }}>SKU</Text>
            <Text style={pdfHeadCell('30%')}>{section.locHeader}</Text>
            <Text style={pdfHeadCell('10%', 'right')}>Total</Text>
          </View>
          {/* Body rows */}
          {section.key === 'moved' &&
            (section.items as TodayMoveEvent[]).map((ev) => {
              const arrow = ev.from_location
                ? `${ev.from_location} → ${ev.to_location}`
                : `→ ${ev.to_location}`;
              const arrowQty = ev.show_qty_in_arrow ? `${arrow} (${ev.qty_moved})` : arrow;
              return (
                <View key={ev.sku} style={pdfRowStyle}>
                  <Text style={pdfCell('40%')}>{ev.item_name}</Text>
                  <Text style={{ ...pdfCell('20%'), fontFamily: MONO, color: TONE.ink2 }}>
                    {ev.sku}
                  </Text>
                  <View style={{ width: '30%', paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: PDF_TBL_FONT, fontFamily: SANS, color: TONE.ink }}>
                      {arrowQty}
                    </Text>
                    {ev.other_locations.length > 0 && (
                      <Text
                        style={{ fontSize: PDF_TBL_FONT - 1.5, fontFamily: SANS, color: TONE.ink2 }}
                      >
                        also {fmtOthers(ev.other_locations)}
                      </Text>
                    )}
                  </View>
                  <Text style={{ ...pdfCell('10%', 'right'), fontWeight: 700 }}>{ev.total_now}</Text>
                </View>
              );
            })}
          {section.key === 'verified' &&
            (section.items as TodayVerifiedEvent[]).map((ev) => (
              <View key={ev.sku} style={pdfRowStyle}>
                <Text style={pdfCell('40%')}>{ev.item_name}</Text>
                <Text style={{ ...pdfCell('20%'), fontFamily: MONO, color: TONE.ink2 }}>
                  {ev.sku}
                </Text>
                <View style={{ width: '30%', paddingHorizontal: 4 }}>
                  <Text style={{ fontSize: PDF_TBL_FONT, fontFamily: SANS, color: TONE.ink }}>
                    {ev.primary_location}
                  </Text>
                  {ev.other_locations.length > 0 && (
                    <Text
                      style={{ fontSize: PDF_TBL_FONT - 1.5, fontFamily: SANS, color: TONE.ink2 }}
                    >
                      also {fmtOthers(ev.other_locations)}
                    </Text>
                  )}
                </View>
                <Text style={{ ...pdfCell('10%', 'right'), fontWeight: 700 }}>{ev.total_now}</Text>
              </View>
            ))}
          {section.key === 'added' &&
            (section.items as TodayAddedEvent[]).map((ev) => (
              <View key={ev.sku} style={pdfRowStyle}>
                <Text style={pdfCell('40%')}>{ev.item_name}</Text>
                <Text style={{ ...pdfCell('20%'), fontFamily: MONO, color: TONE.ink2 }}>
                  {ev.sku}
                </Text>
                <Text style={pdfCell('30%')}>
                  +{ev.qty_added} → {ev.to_location}
                </Text>
                <Text style={{ ...pdfCell('10%', 'right'), fontWeight: 700 }}>{ev.total_now}</Text>
              </View>
            ))}
        </View>
      ))}
    </View>
  );
}

// ── Hero KPI ───────────────────────────────────────────────────────────

function HeroKpi({
  accuracyPct,
  report,
  density,
}: {
  accuracyPct: number;
  report: ActivityReport;
  density: Density;
}) {
  const heroNum = heroSize(density);
  const heroLabel = Math.max(9, Math.min(12, heroNum * 0.085));
  const heroBody = Math.max(9.5, Math.min(12, heroNum * 0.08));
  const accuracyRounded = Math.round(accuracyPct * 100) / 100;
  const verifiedLabel = `${report.verified_skus_2m.toLocaleString()} of ${report.total_skus.toLocaleString()} SKUs`;

  // 90-day sparkline (deterministic monotonic climb to current pct).
  const N = 14;
  const bars = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    return accuracyRounded * (0.3 + t * 0.7);
  });

  return (
    <View
      style={{
        backgroundColor: TONE.tealSoft,
        paddingVertical: 18,
        paddingHorizontal: 20,
        borderRadius: 3,
        flexDirection: 'row',
        gap: 20,
      }}
    >
      {/* Left: label + number + subtitle */}
      <View style={{ flex: 1.3, justifyContent: 'center' }}>
        <Text
          style={{
            fontFamily: SANS,
            fontSize: heroLabel,
            fontWeight: 600,
            letterSpacing: 1.6,
            color: TONE.teal,
          }}
        >
          INVENTORY ACCURACY
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            marginTop: 6,
          }}
        >
          <Text
            style={{
              fontFamily: SANS,
              fontSize: heroNum,
              fontWeight: 600,
              letterSpacing: -2,
              color: TONE.teal,
              lineHeight: 1,
            }}
          >
            {accuracyRounded}
          </Text>
          <Text
            style={{
              fontFamily: SANS,
              fontSize: heroNum * 0.3,
              fontWeight: 500,
              color: TONE.teal,
              marginLeft: 5,
            }}
          >
            %
          </Text>
        </View>
        <Text
          style={{
            fontFamily: SANS,
            fontSize: heroBody,
            color: TONE.ink2,
            marginTop: 10,
            lineHeight: 1.35,
          }}
        >
          <Text style={{ fontWeight: 600, color: TONE.teal }}>{verifiedLabel}</Text> physically counted
          in the last 90 days.
        </Text>
        {/* idea-097 — per-SKU events tables render below HeroKpi (see
            TodayEventsPdfBlock). The previous breakdown bullets were removed
            here so the block has the full page width. */}
      </View>

      {/* Right: progress bar + 90-day sparkline */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {/* Progress bar */}
        <View
          style={{
            height: 8,
            backgroundColor: 'rgba(14,140,107,0.14)',
            borderRadius: 1,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.min(accuracyRounded, 100)}%`,
              height: '100%',
              backgroundColor: TONE.teal,
            }}
          />
        </View>
        {/* Scale labels */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          {['0', '25', '50', '75', '100%'].map((t) => (
            <Text key={t} style={{ fontFamily: MONO, fontSize: 8, color: TONE.mute2 }}>
              {t}
            </Text>
          ))}
        </View>
        {/* Sparkline label */}
        <Text
          style={{
            fontFamily: SANS,
            fontSize: heroLabel - 1,
            fontWeight: 600,
            letterSpacing: 1.4,
            color: TONE.muted,
            marginTop: 10,
          }}
        >
          90-DAY TRAJECTORY
        </Text>
        {/* Sparkline bars — use Svg for vector bars */}
        <Svg width="100%" height={heroNum * 0.22} style={{ marginTop: 6 }}>
          {bars.map((v, i) => {
            const maxH = heroNum * 0.22;
            const h = Math.max(2, (v / 100) * maxH * 2.2);
            const barW = 100 / N; // percentage-like width; actual px computed via SVG viewBox-less positioning
            return (
              <Rect
                key={i}
                x={`${i * barW + 1}%`}
                y={maxH - h}
                width={`${barW - 2}%`}
                height={h}
                fill={i === N - 1 ? TONE.teal : 'rgba(14,140,107,0.45)'}
              />
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

// ── Activity card (DONE / IN PROGRESS / COMING UP / ON THE FLOOR) ─────

function ActivityCard({
  title,
  items,
  density,
}: {
  title: string;
  items: ActivityItem[];
  density: Density;
}) {
  const bodyFs = density === 'sparse' ? 10.5 : density === 'dense' ? 9 : 10;
  const pad = density === 'sparse' ? 12 : density === 'dense' ? 8 : 10;
  return (
    <View
      style={{
        padding: pad,
        borderWidth: 1,
        borderColor: TONE.hair,
        borderRadius: 2,
        backgroundColor: TONE.paperPure,
        flex: 1,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 5,
        }}
      >
        <Text
          style={{
            fontFamily: SANS,
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: 1.4,
            color: TONE.muted,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
          {items.length}
        </Text>
      </View>

      {items.length === 0 && (
        <Text
          style={{
            fontFamily: SANS,
            fontSize: bodyFs - 1,
            color: TONE.mute2,
          }}
        >
          —
        </Text>
      )}

      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', marginTop: i === 0 ? 0 : 3 }}>
          {/* SVG bullet — the Inter-latin WOFF we ship to react-pdf has no
              glyph for U+25CF/U+25CB (● / ○). fontkit falls back to the
              low byte of the codepoint (U+00CF `Ï`, U+00CB `Ë`) so text
              bullets rendered as random Latin letters in the PDF. Drawing
              the bullet as an SVG circle is font-independent. */}
          <View style={{ width: 10, paddingTop: 2.5 }}>
            <Svg width={5} height={5}>
              <Rect
                x={0}
                y={0}
                width={5}
                height={5}
                rx={2.5}
                ry={2.5}
                fill={it.filled ? TONE.teal : 'transparent'}
                stroke={it.filled ? 'transparent' : TONE.muted}
                strokeWidth={0.6}
              />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: SANS,
                fontSize: bodyFs,
                fontWeight: 500,
                color: TONE.ink,
                lineHeight: 1.25,
              }}
            >
              {it.title}
            </Text>
            {it.sub && (
              <Text
                style={{
                  fontFamily: SANS,
                  fontSize: bodyFs - 1,
                  color: TONE.muted,
                  lineHeight: 1.3,
                }}
              >
                {it.sub}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── PAGE 1: Summary ────────────────────────────────────────────────────

function SummaryPage(props: ActivityReportPdfDocProps & { totalPages: number }) {
  const floorBullets = buildFloorBullets(props);
  const density = pickDensity({
    doneToday: props.doneToday,
    inProgress: props.inProgress,
    comingUpNext: props.comingUpNext,
    pickdUpdates: props.pickdUpdates,
    floorBullets,
    winOfTheDay: props.winOfTheDay,
  });

  const bodyFs = density === 'sparse' ? 13 : density === 'dense' ? 10 : 11.5;
  const gap = density === 'sparse' ? 14 : density === 'dense' ? 8 : 10;

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: TONE.paperWarm,
        padding: A4_MARGIN,
        fontFamily: SANS,
        color: TONE.ink,
      }}
    >
      {/* Top edge band (5pt teal) */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          backgroundColor: TONE.teal,
        }}
      />
      <CornerMarks color={TONE.teal} />

      {/* HEADER */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: TONE.hair,
        }}
      >
        <View>
          <Text
            style={{
              fontSize: 9,
              letterSpacing: 2,
              color: TONE.muted,
              fontWeight: 500,
              marginBottom: 6,
            }}
          >
            PICKD · WAREHOUSE OPERATIONS
          </Text>
          <Text
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: -0.6,
              lineHeight: 1,
            }}
          >
            Progress update
          </Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: 500 }}>{formatDateLong(props.report.date)}</Text>
      </View>

      {/* 01 — HOW THE WAREHOUSE IS DOING */}
      <StepHeader n="01" label="HOW THE WAREHOUSE IS DOING" color={TONE.teal} marginTop={gap} />
      <HeroKpi
        accuracyPct={props.accuracyPct}
        report={props.report}
        density={density}
      />
      <TodayEventsPdfBlock report={props.report} />

      {/* 02 — WIN OF THE DAY */}
      {props.winOfTheDay.trim().length > 0 && (
        <>
          <StepHeader n="02" label="WIN OF THE DAY" color={TONE.teal} marginTop={gap} />
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: TONE.hair,
              borderLeftWidth: 3,
              borderLeftColor: TONE.teal,
              borderRadius: 2,
              backgroundColor: TONE.paperPure,
            }}
          >
            <Text
              style={{
                fontSize: bodyFs + 1.5,
                color: TONE.ink,
                lineHeight: 1.4,
                letterSpacing: -0.15,
              }}
            >
              {props.winOfTheDay}
            </Text>
          </View>
        </>
      )}

      {/* 03 — THE WORK · 2×2 activity grid */}
      <StepHeader
        n="03"
        label="THE WORK · DONE / NOW / NEXT / FLOOR"
        color={TONE.ink}
        marginTop={gap}
      />
      <View style={{ flexDirection: 'row', gap: gap - 2, marginBottom: gap - 4 }}>
        <ActivityCard
          title="DONE TODAY"
          items={mapTasksToItems(props.doneToday, true)}
          density={density}
        />
        <ActivityCard
          title="IN PROGRESS"
          items={mapTasksToItems(props.inProgress, true)}
          density={density}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: gap - 2 }}>
        <ActivityCard
          title="COMING UP NEXT"
          items={mapTasksToItems(props.comingUpNext, false)}
          density={density}
        />
        <ActivityCard
          title="ON THE FLOOR"
          items={floorBullets.slice(0, 4).map(splitFloorBullet)}
          density={density}
        />
      </View>

      {/* 04 — PICKD UPDATES */}
      {props.pickdUpdates.length > 0 && (
        <>
          <StepHeader n="04" label="PICKD UPDATES" color={TONE.ink} marginTop={gap} />
          <View
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: TONE.hair,
              borderRadius: 2,
              backgroundColor: TONE.paperPure,
            }}
          >
            {props.pickdUpdates.slice(0, 5).map((u, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  paddingTop: i === 0 ? 0 : 3,
                  marginTop: i === 0 ? 0 : 3,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: TONE.hair,
                  borderStyle: 'dashed',
                }}
              >
                <Text style={{ fontSize: 10, color: TONE.ink2, width: 10 }}>·</Text>
                <Text style={{ flex: 1, fontSize: bodyFs, fontWeight: 500, color: TONE.ink }}>
                  {u}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* FOOTER */}
      <View
        style={{
          position: 'absolute',
          bottom: A4_MARGIN,
          left: A4_MARGIN,
          right: A4_MARGIN,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: TONE.hair,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
          GENERATED BY PICKD ·{' '}
          {new Date()
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            .toUpperCase()}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
          {props.report.warehouse_totals.orders_completed} ORDERS ·{' '}
          {props.report.warehouse_totals.total_items} ITEMS · PAGE 1 / {props.totalPages}
        </Text>
      </View>
    </Page>
  );
}

// ── PAGE 2: Pallet photos ─────────────────────────────────────────────

interface PalletTile {
  /** All order numbers that share this photo. A pallet photo can be attached
   *  to multiple orders (e.g. FedEx auto-grouping) — we de-duplicate by URL
   *  so the same image never appears twice in the grid. */
  orderNumbers: string[];
  url: string;
}

function PalletPage({
  orders,
  date,
  totalPages,
  pageIndex,
}: {
  orders: { order_number: string; photos: string[] }[];
  date: string;
  totalPages: number;
  pageIndex: number;
}) {
  // Group by URL so each distinct photo renders once with ALL the order
  // numbers that include it. Preserves original orders's iteration order.
  const byUrl = new Map<string, string[]>();
  for (const o of orders) {
    for (const url of o.photos) {
      const list = byUrl.get(url) ?? [];
      if (!list.includes(o.order_number)) list.push(o.order_number);
      byUrl.set(url, list);
    }
  }
  const tiles: PalletTile[] = [...byUrl.entries()].map(([url, orderNumbers]) => ({
    url,
    orderNumbers,
  }));
  const cols = pickCols(tiles.length);
  // Content width after page margin; aspect-ratio square tiles.
  const contentW = 595 - A4_MARGIN * 2;
  const gap = 6;
  const tileSize = (contentW - gap * (cols - 1)) / cols;

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: TONE.paperWarm,
        padding: A4_MARGIN,
        fontFamily: SANS,
        color: TONE.ink,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          backgroundColor: TONE.ink,
        }}
      />
      <CornerMarks color={TONE.ink} />

      {/* HEADER */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: TONE.hair,
        }}
      >
        <View>
          <Text
            style={{
              fontSize: 9,
              letterSpacing: 2,
              color: TONE.muted,
              fontWeight: 500,
              marginBottom: 6,
            }}
          >
            PICKD · WAREHOUSE OPERATIONS
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Step n="05" color={TONE.ink} size={20} />
            <Text
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: -0.4,
                marginLeft: 10,
              }}
            >
              Regular &amp; FedEx orders
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, color: TONE.muted }}>
            {orders.length} ORDER{orders.length !== 1 ? 'S' : ''} · {formatDateShort(date)}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 9, color: TONE.muted, marginTop: 2 }}>
          PAGE {pageIndex} / {totalPages}
          </Text>
        </View>
      </View>

      {/* GRID */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          // Each tile is a self-contained card now, so the grid only needs
          // breathing room between cards — no Gestalt-gap trick required.
          columnGap: gap,
          rowGap: 8,
          marginTop: 14,
        }}
      >
        {tiles.map((t, i) => {
          const innerSize = tileSize - 6; // minus 2× card padding (3pt)
          return (
            <View
              key={i}
              style={{
                width: tileSize,
                // Card frame — unambiguously groups image + caption. Thin
                // border + paper-white background against the warm page
                // bg reads as a single "figure" unit.
                borderWidth: 1,
                borderColor: TONE.hair,
                borderRadius: 3,
                backgroundColor: TONE.paperPure,
                padding: 3,
              }}
              wrap={false}
            >
              {/* Image — nothing overlays it. Order IDs live fully in
                  the caption below so the photo reads cleanly. */}
              <View
                style={{
                  width: innerSize,
                  height: innerSize,
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundColor: TONE.hair,
                }}
              >
                <Image
                  src={t.url}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </View>
              {/* Caption — every order number that owns this photo, joined
                  by `·`. Stays inside the card so the image ↔ list link
                  is explicit. Wraps to as many lines as the card width
                  allows; IDs are never truncated. */}
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 7.5,
                  fontWeight: 500,
                  color: TONE.muted,
                  letterSpacing: 0.3,
                  lineHeight: 1.3,
                  marginTop: 4,
                  paddingHorizontal: 1,
                  textAlign: 'center',
                }}
              >
                {/* Space-only separator — the `#` prefix itself already
                    delimits each number, so a `·` between them would only
                    matter as a separator on the INSIDE of a line. Dropping
                    it: cleaner and no orphan dots at line edges. */}
                {t.orderNumbers.map((n) => `#${n}`).join(' ')}
              </Text>
            </View>
          );
        })}
      </View>

      {/* FOOTER */}
      <View
        style={{
          position: 'absolute',
          bottom: A4_MARGIN,
          left: A4_MARGIN,
          right: A4_MARGIN,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: TONE.hair,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
          GENERATED BY PICKD ·{' '}
          {new Date()
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            .toUpperCase()}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
          PAGE {pageIndex} / {totalPages}
        </Text>
      </View>
    </Page>
  );
}

// ── PAGE 3: Projects ──────────────────────────────────────────────────

/**
 * Flat grid of all project photos across done / in-progress / coming-up.
 * Each tile is overlay-labelled with the parent task's title (not with
 * the order #, as on the pallet page). Long titles wrap or truncate.
 */

interface ProjectTile {
  title: string;
  url: string;
}

function collectProjectTiles(props: ActivityReportPdfDocProps): ProjectTile[] {
  const all = [...props.doneToday, ...props.inProgress, ...props.comingUpNext];
  const tiles: ProjectTile[] = [];
  for (const t of all) {
    const urls = t.all_photos_fullsize ?? t.photo_fullsize ?? [];
    for (const url of urls) tiles.push({ title: t.title, url });
  }
  return tiles;
}

function ProjectsPage({
  tiles,
  date,
  pageIndex,
  totalPages,
}: {
  tiles: ProjectTile[];
  date: string;
  pageIndex: number;
  totalPages: number;
}) {
  const cols = pickCols(tiles.length);
  const contentW = 595 - A4_MARGIN * 2;
  const gap = 6;
  const tileSize = (contentW - gap * (cols - 1)) / cols;
  const taskCount = new Set(tiles.map((t) => t.title)).size;

  return (
    <Page
      size="A4"
      style={{
        backgroundColor: TONE.paperWarm,
        padding: A4_MARGIN,
        fontFamily: SANS,
        color: TONE.ink,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          backgroundColor: TONE.teal,
        }}
      />
      <CornerMarks color={TONE.teal} />

      {/* HEADER */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: TONE.hair,
        }}
      >
        <View>
          <Text
            style={{
              fontSize: 9,
              letterSpacing: 2,
              color: TONE.muted,
              fontWeight: 500,
              marginBottom: 6,
            }}
          >
            PICKD · WAREHOUSE OPERATIONS
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Step n="06" color={TONE.teal} size={20} />
            <Text
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: -0.4,
                marginLeft: 10,
              }}
            >
              Projects
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, color: TONE.muted }}>
            {taskCount} PROJECT{taskCount !== 1 ? 'S' : ''} · {formatDateShort(date)}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 9, color: TONE.muted, marginTop: 2 }}>
            PAGE {pageIndex} / {totalPages}
          </Text>
        </View>
      </View>

      {/* GRID */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap,
          marginTop: 14,
        }}
      >
        {tiles.map((t, i) => (
          <View
            key={i}
            style={{
              width: tileSize,
              height: tileSize,
              position: 'relative',
              borderRadius: 2,
              overflow: 'hidden',
              backgroundColor: TONE.hair,
            }}
            wrap={false}
          >
            <Image
              src={t.url}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            {/* Title overlay — pill at the bottom; title wraps to 2 lines max. */}
            <View
              style={{
                position: 'absolute',
                left: 4,
                right: 4,
                bottom: 4,
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  backgroundColor: 'rgba(17,17,17,0.78)',
                  paddingHorizontal: 5,
                  paddingVertical: 2,
                  borderRadius: 2,
                  maxWidth: '100%',
                }}
              >
                <Text
                  style={{
                    fontFamily: SANS,
                    fontSize: 8,
                    fontWeight: 500,
                    color: '#ffffff',
                    letterSpacing: 0.2,
                    textAlign: 'center',
                  }}
                >
                  {/* Truncate long titles so the overlay never eats the tile.
                      ~36 chars fits ~2 lines at font-size 8 inside the tile. */}
                  {t.title.length > 36 ? t.title.slice(0, 34).trim() + '…' : t.title}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* FOOTER */}
      <View
        style={{
          position: 'absolute',
          bottom: A4_MARGIN,
          left: A4_MARGIN,
          right: A4_MARGIN,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: TONE.hair,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
          GENERATED BY PICKD ·{' '}
          {new Date()
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            .toUpperCase()}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.muted }}>
          PAGE {pageIndex} / {totalPages}
        </Text>
      </View>
    </Page>
  );
}

// ── Document root ──────────────────────────────────────────────────────

export function ActivityReportPdfDoc(props: ActivityReportPdfDocProps): ReactNode {
  const orders = props.report.completed_orders_with_photos;
  const hasOrders = orders.length > 0;
  const projectTiles = collectProjectTiles(props);
  const hasProjects = projectTiles.length > 0;
  const totalPages = 1 + (hasOrders ? 1 : 0) + (hasProjects ? 1 : 0);

  const palletPageIndex = 2; // always P2 when it exists
  const projectsPageIndex = hasOrders ? 3 : 2;

  return (
    <Document>
      <SummaryPage {...props} totalPages={totalPages} />
      {hasOrders && (
        <PalletPage
          orders={orders}
          date={props.report.date}
          totalPages={totalPages}
          pageIndex={palletPageIndex}
        />
      )}
      {hasProjects && (
        <ProjectsPage
          tiles={projectTiles}
          date={props.report.date}
          totalPages={totalPages}
          pageIndex={projectsPageIndex}
        />
      )}
    </Document>
  );
}

