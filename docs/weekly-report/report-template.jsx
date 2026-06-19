/*
 * PickD weekly report — PDF template (PickD Activity-Report visual language).
 * ---------------------------------------------------------------------------
 * Rendered with @react-pdf/renderer (vector output, selectable text). Built and
 * previewed via ./build.cjs. This single file holds BOTH the reusable framework
 * (fonts, tokens, icons, figure library, page shell) AND the week's content.
 *
 * TO MAKE A NEW REPORT:
 *   1. Edit the two CONTENT blocks below, marked  ===== EDIT: ... =====
 *        • SECTIONS  — one entry per operator-facing win (title, body, gain, fig)
 *        • SCOREBOARD / HEADER / LEAD / CLOSING strings
 *   2. Reuse or compose the figure components (Fig1..Fig7 are examples). Add new
 *      ones from the atoms (Tag, Badge, Arrow, Check, QR, Barcode, Screen,
 *      MiniOrder, table cells...). For a REAL screenshot, use <ImageFig src=.../>.
 *   3. Run:  node build.cjs report-template.jsx /tmp/weekly-report.pdf
 *   4. Preview every page as PNG (see pdf-pipeline.md) before delivering.
 *
 * GOTCHAS (see pdf-pipeline.md): the woff subsets lack → ✓ 🔎 emoji — draw them
 * as SVG (Arrow/Check/Mag), never type the glyph. Inter/Mono italic is NOT
 * registered — never use fontStyle:'italic'. Watch JS string quotes around
 * apostrophes (use "double" quotes for any body text containing ' ).
 */
const NM = process.env.PICKD_NM || '/home/user/pickd/node_modules';
const React = require(NM + '/react');
const { Document, Page, View, Text, Image, Font, Svg, Path, Circle, renderToFile } = require(NM + '/@react-pdf/renderer');

const TONE = {
  paperWarm: '#FAF8F5', paperPure: '#FFFFFF',
  ink: '#111111', ink2: '#3A3A3A', muted: '#6B6B6B', mute2: '#8A8A8A',
  hair: '#E6E4DE', line2: '#D9D6CF',
  teal: '#0E8C6B', tealSoft: '#E8F3EE', tealDeep: '#0A6B52',
  amber: '#B8761F', amberSoft: '#FAEFD9',
  red: '#B42318', redSoft: '#FBEAE7',
};
const SANS = 'Inter', MONO = 'JetBrains Mono', A4_MARGIN = 34;
const fdir = NM + '/@fontsource';
Font.register({ family: SANS, fonts: [
  { src: `${fdir}/inter/files/inter-latin-400-normal.woff`, fontWeight: 400 },
  { src: `${fdir}/inter/files/inter-latin-500-normal.woff`, fontWeight: 500 },
  { src: `${fdir}/inter/files/inter-latin-600-normal.woff`, fontWeight: 600 },
  { src: `${fdir}/inter/files/inter-latin-700-normal.woff`, fontWeight: 700 },
]});
Font.register({ family: MONO, fonts: [
  { src: `${fdir}/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff`, fontWeight: 400 },
  { src: `${fdir}/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff`, fontWeight: 600 },
]});
Font.registerHyphenationCallback((w) => [w]);

// Inline markup: **bold** (ink, 600) and *soft* (muted). Keep emphasis sparing.
function Inline({ children, style }) {
  const text = String(children);
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const out = []; let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Text key={k++}>{text.slice(last, m.index)}</Text>);
    const t = m[0];
    if (t.startsWith('**')) out.push(<Text key={k++} style={{ fontWeight: 600, color: TONE.ink }}>{t.slice(2, -2)}</Text>);
    else out.push(<Text key={k++} style={{ color: TONE.muted }}>{t.slice(1, -1)}</Text>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(<Text key={k++}>{text.slice(last)}</Text>);
  return <Text style={style}>{out}</Text>;
}

// ── tiny UI atoms for figures ──────────────────────────────────────────
const Pill = ({ n }) => (
  <View style={{ width: 15, height: 15, borderRadius: 7.5, backgroundColor: TONE.teal, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontFamily: MONO, fontSize: 7.5, color: '#fff', fontWeight: 600, lineHeight: 1 }}>{n}</Text>
  </View>
);
const Badge = ({ text, bg, fg }) => (
  <View style={{ backgroundColor: bg, borderRadius: 2, paddingHorizontal: 4, paddingVertical: 1.5 }}>
    <Text style={{ fontSize: 5.6, fontWeight: 700, letterSpacing: 0.6, color: fg }}>{text}</Text>
  </View>
);
const Tag = ({ children, bg = TONE.paperWarm, fg = TONE.ink2, bd = TONE.line2, mono }) => (
  <View style={{ backgroundColor: bg, borderWidth: 0.7, borderColor: bd, borderRadius: 3, paddingHorizontal: 4.5, paddingVertical: 2.5 }}>
    <Text style={{ fontSize: 6.8, fontWeight: 600, color: fg, fontFamily: mono ? MONO : SANS }}>{children}</Text>
  </View>
);
// Drawn icons — the Inter/Mono woff subsets lack the arrow/check/magnifier glyphs.
const Arrow = ({ c = TONE.teal }) => (
  <View style={{ marginHorizontal: 3, justifyContent: 'center' }}>
    <Svg width={11} height={8} viewBox="0 0 11 8">
      <Path d="M1 4 H9" stroke={c} strokeWidth={1} />
      <Path d="M6 1.4 L9 4 L6 6.6" stroke={c} strokeWidth={1} fill="none" />
    </Svg>
  </View>
);
const Check = ({ c = TONE.teal, size = 8, ml = 2 }) => (
  <View style={{ marginLeft: ml, justifyContent: 'center' }}>
    <Svg width={size} height={size} viewBox="0 0 8 8">
      <Path d="M1.2 4.2 L3.1 6.1 L6.8 1.9" stroke={c} strokeWidth={1.4} fill="none" />
    </Svg>
  </View>
);
const Mag = ({ c = TONE.mute2 }) => (
  <View style={{ marginRight: 4, justifyContent: 'center' }}>
    <Svg width={9} height={9} viewBox="0 0 9 9">
      <Circle cx={3.4} cy={3.4} r={2.6} stroke={c} strokeWidth={0.9} fill="none" />
      <Path d="M5.4 5.4 L8.3 8.3" stroke={c} strokeWidth={0.9} />
    </Svg>
  </View>
);

// QR-ish module grid (deterministic). dense=true → noisier, no finder squares.
function QR({ n = 9, cell = 2.2, dense = false }) {
  const rows = [];
  for (let y = 0; y < n; y++) {
    const cells = [];
    for (let x = 0; x < n; x++) {
      const finder = !dense && ((x < 3 && y < 3) || (x > n - 4 && y < 3) || (x < 3 && y > n - 4))
        && (x === 0 || x === 2 || y === 0 || y === 2 || (x === 1 && y === 1) || (x === n - 1) || (x === n - 3) || (y === n - 1) || (y === n - 3));
      const on = finder || (((x * 7 + y * 13 + x * y * 3) % (dense ? 2 : 3)) === 0);
      cells.push(<View key={x} style={{ width: cell, height: cell, backgroundColor: on ? TONE.ink : 'transparent' }} />);
    }
    rows.push(<View key={y} style={{ flexDirection: 'row' }}>{cells}</View>);
  }
  return <View>{rows}</View>;
}
function Barcode({ h = 16 }) {
  const widths = [1.4, 0.8, 2.2, 0.8, 1.2, 2.0, 0.8, 1.6, 1.0, 2.4, 0.8, 1.2, 1.8, 0.8, 1.4, 1.0, 2.2, 0.8, 1.6, 1.2];
  return (
    <View style={{ flexDirection: 'row', height: h, alignItems: 'stretch' }}>
      {widths.map((bw, i) => <View key={i} style={{ width: bw, marginRight: 1.1, backgroundColor: i % 2 ? 'transparent' : TONE.ink }} />)}
    </View>
  );
}
const FFrame = ({ children, style }) => (
  <View style={{ backgroundColor: TONE.paperPure, borderWidth: 1, borderColor: TONE.hair, borderRadius: 3, padding: 7, ...style }}>{children}</View>
);
const Caption = ({ children }) => <Text style={{ fontSize: 6, color: TONE.mute2, marginTop: 4, textAlign: 'center' }}>{children}</Text>;
// Drop a REAL screenshot into a section: <ImageFig src="/abs/path/shot.png" />
const ImageFig = ({ src }) => (<FFrame><Image src={src} style={{ width: '100%', objectFit: 'contain' }} /></FFrame>);

// ═══════════════════════════════════════════════════════════════════════
// FIGURE LIBRARY — reusable mockups. Compose / clone these per report.
// ═══════════════════════════════════════════════════════════════════════
function MiniOrder({ badge, badgeBg, cust, custBg, custFg, dotted, check }) {
  return (
    <View style={{ borderWidth: 0.8, borderColor: TONE.line2, borderRadius: 3, padding: 5, marginBottom: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <Text style={{ fontFamily: MONO, fontSize: 6.5, color: TONE.ink2, fontWeight: 600 }}>Order #880214</Text>
        <Badge text={badge} bg={badgeBg} fg="#fff" />
      </View>
      <Text style={{ fontSize: 5.6, color: TONE.mute2, marginBottom: 1.5 }}>Customer</Text>
      <View style={{ backgroundColor: custBg, borderWidth: 0.8, borderColor: dotted ? TONE.red : TONE.teal, borderStyle: dotted ? 'dashed' : 'solid', borderRadius: 2, paddingHorizontal: 5, paddingVertical: 3, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontSize: 7.5, fontWeight: 600, color: custFg }}>{cust}</Text>
        {check && <Check c={custFg} size={7} />}
      </View>
    </View>
  );
}
const Fig1 = () => (
  <FFrame>
    <MiniOrder badge="BEFORE" badgeBg={TONE.red} cust="—  (blank / wrong customer)" custBg={TONE.redSoft} custFg={TONE.red} dotted />
    <MiniOrder badge="NOW" badgeBg={TONE.teal} cust="JAMIS BIKES" custBg={TONE.tealSoft} custFg={TONE.tealDeep} check />
  </FFrame>
);

const ResRow = ({ t, active }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: active ? TONE.tealSoft : 'transparent', borderRadius: 2, paddingHorizontal: 4, paddingVertical: 2.5, marginTop: 2 }}>
    <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: active ? TONE.teal : TONE.line2, marginRight: 4 }} />
    <Text style={{ fontFamily: MONO, fontSize: 6.5, color: active ? TONE.tealDeep : TONE.muted, fontWeight: active ? 600 : 400 }}>{t}</Text>
  </View>
);
const Fig2 = () => (
  <FFrame>
    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 0.8, borderColor: TONE.teal, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 3.5 }}>
      <Mag />
      <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.mute2 }}>8800</Text>
      <Text style={{ fontFamily: MONO, fontSize: 8, color: TONE.ink, fontWeight: 600, backgroundColor: TONE.amberSoft }}>14</Text>
      <View style={{ width: 0.8, height: 9, backgroundColor: TONE.teal, marginLeft: 1 }} />
      <View style={{ flex: 1 }} />
      <Badge text="2 DIGITS" bg={TONE.amber} fg="#fff" />
    </View>
    <ResRow t="880014 · JAMIS BIKES" active />
    <ResRow t="880214 · SUNRISE CYCLERY" />
    <Caption>filters instantly · pre-filled</Caption>
  </FFrame>
);

const Screen = ({ badge, badgeBg, blank }) => (
  <View style={{ flex: 1, marginHorizontal: 2 }}>
    <View style={{ borderWidth: 0.8, borderColor: TONE.line2, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ backgroundColor: TONE.paperWarm, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 2.5, borderBottomWidth: 0.6, borderColor: TONE.hair }}>
        <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: TONE.line2, marginRight: 2 }} />
        <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: TONE.line2, marginRight: 2 }} />
        <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: TONE.line2 }} />
      </View>
      <View style={{ height: 40, alignItems: 'center', justifyContent: 'center', padding: 5 }}>
        {blank ? (
          <Text style={{ fontSize: 6, color: TONE.red, textAlign: 'center', fontWeight: 600 }}>blank{'\n'}screen</Text>
        ) : (
          <View style={{ width: '100%' }}>
            <View style={{ height: 2.5, backgroundColor: TONE.line2, borderRadius: 1, marginBottom: 2.5 }} />
            <View style={{ height: 2.5, backgroundColor: TONE.line2, borderRadius: 1, width: '70%', marginBottom: 2.5 }} />
            <View style={{ height: 2.5, backgroundColor: TONE.line2, borderRadius: 1, width: '85%', marginBottom: 4 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 6, color: TONE.tealDeep, fontWeight: 600 }}>sent</Text>
              <Check c={TONE.tealDeep} size={6} ml={2} />
            </View>
          </View>
        )}
      </View>
    </View>
    <View style={{ alignItems: 'center', marginTop: 3 }}><Badge text={badge} bg={badgeBg} fg="#fff" /></View>
  </View>
);
const Fig3 = () => (
  <FFrame>
    <View style={{ flexDirection: 'row' }}>
      <Screen badge="BEFORE" badgeBg={TONE.red} blank />
      <Screen badge="NOW" badgeBg={TONE.teal} />
    </View>
  </FFrame>
);

const Fig4 = () => (
  <FFrame>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
      <Tag mono>06-4457BL</Tag><Arrow />
      <View style={{ backgroundColor: TONE.tealSoft, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 3 }}>
        <Text style={{ fontSize: 6, color: TONE.tealDeep, fontWeight: 600, textAlign: 'center' }}>PickD{'\n'}vs stock</Text>
      </View>
      <Arrow /><Tag mono bg={TONE.tealSoft} fg={TONE.tealDeep} bd={TONE.teal}>06-4457BK</Tag><Check c={TONE.tealDeep} size={8} />
    </View>
    <Text style={{ fontSize: 5.8, color: TONE.mute2, textAlign: 'center', marginTop: 4 }}>1 match: translate & log it · 2: leave it for a person</Text>
    <View style={{ height: 0.7, backgroundColor: TONE.hair, marginVertical: 5 }} />
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
      <Tag bg={TONE.redSoft} fg={TONE.red} bd={TONE.red}>7 / 13</Tag><Arrow />
      <Tag bg={TONE.tealSoft} fg={TONE.tealDeep} bd={TONE.teal}>13 / 13</Tag>
      <View style={{ width: 8 }} />
      <Tag bg={TONE.amberSoft} fg={TONE.amber} bd={TONE.amber}>Sub-Total</Tag><Check c={TONE.amber} size={7} />
    </View>
  </FFrame>
);

const LabelMock = ({ after }) => (
  <View style={{ flex: 1, marginHorizontal: 2 }}>
    <View style={{ borderWidth: 1, borderColor: TONE.ink, borderRadius: 2, padding: 4, height: 62, justifyContent: 'space-between' }}>
      {after ? (
        <>
          <View>
            <Text style={{ fontSize: 7, fontWeight: 700, color: TONE.ink }}>BRAKE LEVER</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: TONE.red, marginRight: 2 }} />
              <Text style={{ fontSize: 5.5, color: TONE.ink2 }}>RED · 06-4457</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Barcode h={14} />
            <QR n={7} cell={2} />
          </View>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 7, fontWeight: 700, color: TONE.ink }}>XENITH BIKE</Text>
          <View style={{ alignItems: 'center' }}><QR n={13} cell={1.7} dense /></View>
        </>
      )}
    </View>
    <View style={{ alignItems: 'center', marginTop: 3 }}><Badge text={after ? 'NOW' : 'BEFORE'} bg={after ? TONE.teal : TONE.red} fg="#fff" /></View>
  </View>
);
const Fig5 = () => (
  <FFrame><View style={{ flexDirection: 'row' }}><LabelMock /><LabelMock after /></View></FFrame>
);

const TCell = ({ children, w, bold, align = 'left', mono, fg = TONE.ink2 }) => (
  <View style={{ width: w, paddingVertical: 2, paddingHorizontal: 3 }}>
    <Text style={{ fontSize: 6.4, fontWeight: bold ? 700 : 400, color: fg, textAlign: align, fontFamily: mono ? MONO : SANS }}>{children}</Text>
  </View>
);
const Fig6 = () => (
  <FFrame style={{ padding: 5 }}>
    <View style={{ flexDirection: 'row', borderBottomWidth: 0.8, borderColor: TONE.ink }}>
      <TCell w={42} bold fg={TONE.muted}>MOVED FROM</TCell>
      <TCell w={70} bold fg={TONE.muted}>CURRENT STOCK</TCell>
      <TCell w={28} bold align="right" fg={TONE.muted}>TOTAL</TCell>
    </View>
    <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderColor: TONE.hair, alignItems: 'center' }}>
      <TCell w={42} mono>ROW 42</TCell>
      <View style={{ width: 70, paddingHorizontal: 3, paddingVertical: 2, flexDirection: 'row' }}>
        <Text style={{ fontSize: 6.4, fontFamily: MONO, fontWeight: 700, color: TONE.ink }}>ROW 8</Text>
        <Text style={{ fontSize: 6.4, fontFamily: MONO, color: TONE.ink2 }}>{' = 36'}</Text>
      </View>
      <TCell w={28} mono bold align="right" fg={TONE.ink}>82</TCell>
    </View>
    <View style={{ paddingHorizontal: 3, paddingVertical: 1.5 }}>
      <Text style={{ fontSize: 5.8, color: TONE.muted, fontFamily: MONO }}>Still at ROW 42 = 46</Text>
    </View>
    <Caption>movement · total · other locations</Caption>
  </FFrame>
);

const Fig7 = () => (
  <FFrame>
    <View style={{ borderWidth: 0.8, borderColor: TONE.line2, borderRadius: 3, padding: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: MONO, fontSize: 6.5, color: TONE.ink2, fontWeight: 600 }}>Order #880214</Text>
        <Badge text="PALLET 2 / 3" bg={TONE.teal} fg="#fff" />
      </View>
      <Text style={{ fontSize: 6.2, color: TONE.muted, marginTop: 2.5 }}>3 pallets · 47 units</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, backgroundColor: TONE.redSoft, borderRadius: 2, paddingHorizontal: 4, paddingVertical: 2.5 }}>
        <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: TONE.red, marginRight: 4 }} />
        <Text style={{ fontSize: 6, color: TONE.red, fontWeight: 600 }}>Note: check damaged box</Text>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 5, borderWidth: 0.8, borderColor: TONE.line2, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 3 }}><Text style={{ fontSize: 6.2, color: TONE.mute2, fontWeight: 600 }}>FedEx</Text></View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 3, backgroundColor: TONE.teal }}><Text style={{ fontSize: 6.2, color: '#fff', fontWeight: 600 }}>Truck</Text><Check c="#fff" size={6} ml={2} /></View>
      </View>
    </View>
  </FFrame>
);

// ── Section band (header + text + figure, side by side) ─────────────────
function Section({ n, title, body, gain, fig, last }) {
  return (
    <View style={{ marginBottom: last ? 6 : 21 }} wrap={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Pill n={n} />
        <Text style={{ marginLeft: 7, fontSize: 12, fontWeight: 600, color: TONE.ink }}>{title}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: TONE.hair, marginLeft: 9 }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          <Inline style={{ fontSize: 9.6, color: TONE.ink2, lineHeight: 1.52 }}>{body}</Inline>
          <Text style={{ marginTop: 6, fontSize: 8.8, lineHeight: 1.4 }}>
            <Text style={{ color: TONE.tealDeep, fontWeight: 600 }}>What you gain: </Text>
            <Text style={{ color: TONE.ink2 }}>{gain}</Text>
          </Text>
        </View>
        <View style={{ width: 196 }}>{fig}</View>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ===== EDIT: SECTIONS (one per operator-facing win) =====================
// title: short headline · body: 2–4 sentences (**bold** the key phrases) ·
// gain: the "What you gain" payoff · fig: a figure component.
// Voice rules live in voice-and-style.md — read it before writing copy.
// ═══════════════════════════════════════════════════════════════════════
const SECTIONS = [
  { n: '01', title: "The customer that 'changed by itself' — fixed", fig: <Fig1 />,
    body: "The customer name **changed by itself** (or went blank), and sometimes we printed labels with the wrong customer. The real cause: the system was saving another order's customer behind the scenes. **I tracked it down, fixed it, and reviewed the whole app.**",
    gain: "the customer shown on the order is the order's customer — and so is what you print." },
  { n: '02', title: 'Find & capture: from 6 digits to 2 taps', fig: <Fig2 />,
    body: 'Search **filters instantly**; the box comes **pre-filled** and you type just the **last 2 digits**. Behind the scenes, the system scans AS400 orders **ahead of time**, ready when you need them.',
    gain: 'seconds on every order, many times a day.' },
  { n: '03', title: 'Bay 2 no longer freezes (Thursday the 18th)', fig: <Fig3 />,
    body: "Bay 2 capture froze up: **blank screen**, and **not even plan B** worked. It was fighting a process on the Mac itself. I found the root cause, gave it **its own 'spot' that can't be taken away**, and fixed the sending. **It won't happen again.**",
    gain: 'automatic capture always starts and sends.' },
  { n: '04', title: 'Complete orders and the right bike', fig: <Fig4 />,
    body: "Before, only **7 of 13** items came in (it skipped the parts); now it **reads everything** and checks each order against its **Sub-Total**. And since the AS400 won't let you change the color suffix, **I made PickD smart**: it translates the SKU itself against real stock.",
    gain: 'complete orders, and the right bike on the first try.' },
  { n: '05', title: 'Labels that finally work', fig: <Fig5 />,
    body: 'Now they print for **parts** too (with their **color**), they carry a **barcode** (plus a code-free mode), the **QR is cleaner**, and I rebuilt the editor: **what you see is identical to what prints**.',
    gain: 'correct labels on the first try, for any item.' },
  { n: '06', title: 'The report for the AS400', fig: <Fig6 />,
    body: "For each moved SKU: **where it left from and where it went**, the **total** left there, any other movements of the same SKU and, below, which **other locations** hold it. Exactly what's needed — **no more, no less**.",
    gain: 'the AS400 gets updated cleanly, with no back-and-forth.' },
  { n: '07', title: 'Clearer verification', fig: <Fig7 />, last: true,
    body: "**Pallet X/Y** and 'pallets · units' at a glance; the **latest note in red** on the card; a unified **FedEx / Truck** button; and you upload the **PDF** straight into Register Container.",
    gain: 'the info that matters, in plain sight and with fewer steps.' },
];

// ── Before → After scoreboard ──────────────────────────────────────────
function ScoreCard({ topic, before, after, first }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 11, borderLeftWidth: first ? 0 : 1, borderColor: TONE.hair }}>
      <Text style={{ fontSize: 6.8, fontWeight: 700, letterSpacing: 0.8, color: TONE.mute2, marginBottom: 6 }}>{topic}</Text>
      <Text style={{ fontSize: 8, color: TONE.red, textDecoration: 'line-through', marginBottom: 4 }}>{before}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Arrow />
        <Text style={{ fontSize: 9.5, color: TONE.tealDeep, fontWeight: 700, marginLeft: 3 }}>{after}</Text>
      </View>
    </View>
  );
}
// ===== EDIT: SCOREBOARD (4 one-glance before→after wins) ================
const SCORE = [
  { topic: 'CUSTOMER ON ORDER', before: 'changed by itself', after: 'stable & correct' },
  { topic: 'CAPTURE AN ORDER', before: '6 digits + wait', after: '2 taps' },
  { topic: 'BAY 2 CAPTURE', before: 'froze up', after: 'always starts' },
  { topic: 'ITEMS PER ORDER', before: '7 of 13', after: '13 of 13' },
];
const RecapBand = () => (
  <View style={{ marginTop: 9, borderWidth: 1, borderColor: TONE.hair, borderRadius: 3, backgroundColor: TONE.paperPure, paddingVertical: 12, paddingHorizontal: 13 }} wrap={false}>
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 11 }}>
      <Text style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 1.2, color: TONE.tealDeep }}>BEFORE</Text>
      <Arrow />
      <Text style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 1.2, color: TONE.tealDeep }}>AFTER  ·  AT A GLANCE</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: TONE.hair, marginLeft: 11 }} />
    </View>
    <View style={{ flexDirection: 'row' }}>
      {SCORE.map((s, i) => <ScoreCard key={i} first={i === 0} {...s} />)}
    </View>
  </View>
);

// ===== EDIT: HEADER / LEAD / CLOSING / DATE ============================
const META = {
  docTitle: 'What changed in the warehouse — PickD',
  eyebrow: 'PICKD · WAREHOUSE OPERATIONS',
  title: 'What changed in the warehouse',
  dateRight: 'Jun 19, 2026 · for Roman',
  footerDate: 'JUN 19, 2026',
  lead: "Two weeks, one focus: **so you can trust the system and move faster**. Everything here **is already in production** — here's each improvement, with its before/after.",
  closing: "Several of these improvements **came from things we'd been noticing on the floor**, and **I solved them at the root**. Whenever you want, I'll walk you through it live, tool by tool.",
};

function Doc() {
  return (
    <Document title={META.docTitle} author="PickD">
      <Page size="A4" style={{ backgroundColor: TONE.paperWarm, paddingTop: A4_MARGIN, paddingBottom: 36, paddingHorizontal: A4_MARGIN, fontFamily: SANS, color: TONE.ink }}>
        <View fixed style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: TONE.teal }} />
        <View fixed style={{ position: 'absolute', top: 13, left: 13, width: 11, height: 11, borderTopWidth: 1.2, borderLeftWidth: 1.2, borderColor: TONE.teal }} />
        <View fixed style={{ position: 'absolute', top: 13, right: 13, width: 11, height: 11, borderTopWidth: 1.2, borderRightWidth: 1.2, borderColor: TONE.teal }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 8.5, fontWeight: 500, letterSpacing: 2, color: TONE.muted }}>{META.eyebrow}</Text>
            <Text style={{ marginTop: 5, fontSize: 21, fontWeight: 600, letterSpacing: -0.4, color: TONE.ink, lineHeight: 1.1 }}>{META.title}</Text>
          </View>
          <Text style={{ fontSize: 9.5, color: TONE.muted, marginBottom: 2 }}>{META.dateRight}</Text>
        </View>
        <View style={{ marginTop: 8, marginBottom: 12, paddingLeft: 9, borderLeftWidth: 2, borderColor: TONE.teal }}>
          <Inline style={{ fontSize: 9, color: TONE.ink2, lineHeight: 1.4 }}>{META.lead}</Inline>
        </View>

        {SECTIONS.map((s) => <Section key={s.n} {...s} />)}

        <RecapBand />

        <View style={{ marginTop: 9, flexDirection: 'row', backgroundColor: TONE.tealSoft, borderRadius: 2 }} wrap={false}>
          <View style={{ width: 3, backgroundColor: TONE.teal, borderTopLeftRadius: 2, borderBottomLeftRadius: 2 }} />
          <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 11 }}>
            <Inline style={{ fontSize: 9, color: TONE.ink2, lineHeight: 1.4 }}>{META.closing}</Inline>
          </View>
        </View>

        <View fixed style={{ position: 'absolute', left: A4_MARGIN, right: A4_MARGIN, bottom: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: MONO, fontSize: 7.5, color: TONE.mute2, letterSpacing: 0.5 }}>{`GENERATED BY PICKD · ${META.footerDate}`}</Text>
          <Text style={{ fontFamily: MONO, fontSize: 7.5, color: TONE.mute2, letterSpacing: 0.5 }}
            render={({ pageNumber, totalPages }) => `PAGE ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

module.exports = async function main(out) { await renderToFile(<Doc />, out); return out; };
