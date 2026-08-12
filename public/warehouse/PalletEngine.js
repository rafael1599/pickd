export class PalletEngine {
    constructor(zoneId, config, state) {
        this.zoneId = zoneId;
        this.config = config;
        this.state = Object.assign({
            pw: 62,
            pd: 60,
            isEW: false,
            toggles: {} // e.g. { west: true }
        }, state);

        this.HALL_MIN = 54;
        this.BIKES_PALLET = 30;
        this.BIKES_LINE = 6;
    }

    calculate() {
        const c = this.config;
        const s = this.state;
        
        let margins = { ...c.margins };
        // Apply toggles (like freed west aisle in North)
        if (c.obstacles) {
            c.obstacles.forEach(obs => {
                if (obs.toggleable && s.toggles[obs.toggleable] === false) {
                    if (obs.x === 0 && obs.w === margins.left) margins.left = 0;
                    if (obs.x > 0 && obs.x + obs.w === c.width && obs.w === margins.right) margins.right = 0;
                }
            });
        }

        const usableEW = c.width - margins.left - margins.right;
        const usableNS = c.height - margins.top - margins.bottom;

        // Which dimension maps to what
        const rW = s.isEW ? s.pd : s.pw; // row width
        const sD = s.isEW ? s.pw : s.pd; // slot depth
        const rSpan = s.isEW ? usableNS : usableEW; // span for row arrangement
        const dSpan = s.isEW ? usableEW : usableNS; // span for depth

        // Check if fits
        if (usableEW < rW || usableNS < sD) {
            return null;
        }

        const deep = Math.floor(dSpan / sD + 1e-9);
        if (deep < 1) return null;
        const front = dSpan - deep * sD;
        const nLines = Math.floor(front / 10 + 1e-9); // 10" per bike line
        const gapW = nLines * 10;
        const offs = [];
        for (let i = 0; i < deep; i++) offs.push(gapW + i * sD);

        const build = () => {
            const minW = rW * 2 + this.HALL_MIN;
            if (rSpan < minW) return null;

            const res = this.autoBlocks(rSpan, rW);
            if (!res) return null;

            const { blocks, nRows, extra } = res;
            const nHalls = blocks.length - 1;
            const hall = nHalls > 0 ? this.HALL_MIN + extra / nHalls : 0;

            const strip = [];
            let cx = 0;
            let currentNum = c.startRowNumber;
            const dir = c.rowNumberingDir || 1; // 1 = increases, -1 = decreases

            for (let i = 0; i < blocks.length; i++) {
                const bSize = blocks[i];
                const start = cx;
                const rows = [];
                for (let k = 0; k < bSize; k++) {
                    rows.push({ idx: k, of: bSize, x: cx, num: currentNum });
                    currentNum += dir;
                    cx += rW;
                }
                strip.push({ type: 'block', size: bSize, x0: start, x1: cx, rows });
                
                if (i < blocks.length - 1) {
                    strip.push({ type: 'hall', w: hall, x: cx });
                    cx += hall;
                }
            }

            let numEnd = currentNum - dir;

            // Collision detection with posts
            const cells = [];
            let totalBikes = 0;
            const palletBikes = nRows * deep * this.BIKES_PALLET;
            const blockBikes = nRows * nLines * this.BIKES_LINE;

            for (const seg of strip) {
                if (seg.type !== 'block') continue;
                for (const r of seg.rows) {
                    for (let d = 0; d < deep; d++) {
                        const cxSlot = s.isEW ? margins.left + offs[d] : margins.left + r.x;
                        const cySlot = s.isEW ? margins.top + r.x     : margins.top + offs[d];
                        const cwSlot = s.isEW ? sD : rW;
                        const chSlot = s.isEW ? rW : sD;
                        const edgeRow = r.idx === 0 || r.idx === r.of - 1;
                        const isFast = edgeRow || d === 0 || d === deep - 1;
                        cells.push({ row: r, d, letter: String.fromCharCode(65 + d), cx: cxSlot, cy: cySlot, cw: cwSlot, ch: chSlot, isFast });
                    }
                }
            }

            const activePosts = (c.posts || []).filter(p => p.size > 0);
            const hits = [];
            const lost = [];
            let accessible = 0;

            for (const p of activePosts) {
                const px = p.x - p.size / 2;
                const py = p.y - p.size / 2;
                const p_r = px + p.size;
                const p_b = py + p.size;
                const hitCells = cells.filter(cl => {
                    const c_r = cl.cx + cl.cw;
                    const c_b = cl.cy + cl.ch;
                    return !(p_r <= cl.cx || px >= c_r || p_b <= cl.cy || py >= c_b);
                });
                if (hitCells.length > 0) {
                    hits.push({ post: p, cells: hitCells, clear: false });
                    lost.push(...hitCells);
                }
            }

            const validCells = cells.filter(c => !lost.includes(c));
            accessible = validCells.filter(c => c.isFast).length;

            return {
                strip, blocks, nRows, hall, nHalls, numEnd,
                pallets: validCells.length,
                gross: cells.length,
                accessible,
                palletBikes: validCells.length * this.BIKES_PALLET,
                bikes: blockBikes,
                lines: nLines,
                deep, rW, sD, offs, gapW, front,
                hits, lost, activePosts, validCells,
                margins
            };
        };

        return build();
    }

    autoBlocks(span, rW) {
        let best = null;
        let maxRows = 0;
        let minExtra = Infinity;

        const search = (bList, used) => {
            const hCount = bList.length > 0 ? bList.length - 1 : 0;
            const req = used + hCount * this.HALL_MIN;
            if (req > span) return;
            
            const extra = span - req;
            const totalRows = bList.reduce((a, b) => a + b, 0);

            if (totalRows > maxRows || (totalRows === maxRows && extra < minExtra)) {
                maxRows = totalRows;
                minExtra = extra;
                best = { blocks: [...bList], nRows: totalRows, extra };
            }
            
            const minBlockSpan = 2 * rW + this.HALL_MIN;
            if (extra >= minBlockSpan) {
                for (const b of [2, 3]) {
                    bList.push(b);
                    search(bList, used + b * rW);
                    bList.pop();
                }
            }
        };

        for (const b of [2, 3]) {
            search([b], b * rW);
        }
        return best;
    }

    renderSVG(m) {
        if (!m) return '';
        const c = this.config;
        const s = this.state;
        const M = 96;
        let h = `<rect x="${M}" y="${M}" width="${c.width}" height="${c.height}" fill="#0d1524" stroke="#334155" stroke-width="3"/>`;

        // Obstacles
        if (c.obstacles) {
            c.obstacles.forEach(obs => {
                if (obs.toggleable && s.toggles[obs.toggleable] === false) return;
                const isRack = obs.type === 'rack';
                h += `<rect x="${M + obs.x}" y="${M + obs.y}" width="${obs.w}" height="${obs.h}" 
                        fill="${isRack ? '#ef4444' : '#0a1120'}" 
                        fill-opacity="${isRack ? '.08' : '1'}"
                        stroke="${isRack ? '#ef4444' : '#1e293b'}" 
                        stroke-width="${isRack ? '2' : '1'}"
                        stroke-dasharray="${isRack ? 'none' : '8 8'}"
                        data-hover="${obs.label.replace(/"/g, '&quot;')}"/>`;
            });
        }

        const USABLE_X0 = M + m.margins.left;
        const NORTH_Y   = M + m.margins.top;
        const SOUTH_Y   = M + c.height - m.margins.bottom;
        const usableEW  = c.width - m.margins.left - m.margins.right;
        const fontCell  = Math.max(9, Math.min(18, Math.min(m.rW, m.sD) * 0.3));

        // Halls & Outlines
        for (const seg of m.strip) {
            if (seg.type === 'hall') {
                if (s.isEW) {
                    const ay = NORTH_Y + seg.x;
                    h += `<rect x="${USABLE_X0}" y="${ay}" width="${usableEW}" height="${seg.w}" fill="#0a1120" stroke="#1e293b" stroke-width="1.2" data-hover="AISLE (${(Math.round(seg.w*100)/100)}&quot;)"/>`;
                    h += `<line x1="${USABLE_X0 + 10}" y1="${ay + seg.w / 2}" x2="${USABLE_X0 + usableEW - 10}" y2="${ay + seg.w / 2}" stroke="#334155" stroke-width="2" stroke-dasharray="14 12" pointer-events="none"/>`;
                } else {
                    const sx = USABLE_X0 + seg.x;
                    h += `<rect x="${sx}" y="${NORTH_Y}" width="${seg.w}" height="${SOUTH_Y - NORTH_Y}" fill="#0a1120" stroke="#1e293b" stroke-width="1.2" data-hover="AISLE (${(Math.round(seg.w*100)/100)}&quot;)"/>`;
                    h += `<line x1="${sx + seg.w / 2}" y1="${NORTH_Y + 10}" x2="${sx + seg.w / 2}" y2="${SOUTH_Y - 10}" stroke="#334155" stroke-width="2" stroke-dasharray="14 12" pointer-events="none"/>`;
                }
            } else if (seg.type === 'block') {
                if (s.isEW) {
                    h += `<rect x="${USABLE_X0 - 5}" y="${NORTH_Y + seg.x0 - 5}" width="${usableEW + 10}" height="${seg.x1 - seg.x0 + 10}" fill="none" rx="4" stroke="#a78bfa" stroke-width="${seg.size >= 4 ? 3 : 2}" stroke-opacity="${seg.size >= 4 ? .9 : .5}"/>`;
                } else {
                    h += `<rect x="${USABLE_X0 + seg.x0 - 5}" y="${NORTH_Y - 5}" width="${seg.x1 - seg.x0 + 10}" height="${SOUTH_Y - NORTH_Y + 10}" fill="none" rx="4" stroke="#a78bfa" stroke-width="${seg.size >= 4 ? 3 : 2}" stroke-opacity="${seg.size >= 4 ? .9 : .5}"/>`;
                }
                
                // Rows text
                seg.rows.forEach(r => {
                    if (s.isEW) {
                        const rx = USABLE_X0 + m.gapW + (m.deep > 0 ? (m.deep - 1) * m.sD / 2 : 0); // Approx middle
                        h += `<text x="${USABLE_X0 - 30}" y="${NORTH_Y + r.x + m.rW / 2 + 7}" font-size="21" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                        h += `<text x="${USABLE_X0 + usableEW + 30}" y="${NORTH_Y + r.x + m.rW / 2 + 7}" font-size="21" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                    } else {
                        h += `<text x="${USABLE_X0 + r.x + m.rW / 2}" y="${NORTH_Y - 14}" font-size="21" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                        h += `<text x="${USABLE_X0 + r.x + m.rW / 2}" y="${SOUTH_Y + 32}" font-size="21" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                    }
                });
            }
        }

        // Pallets
        m.validCells.forEach(cl => {
            const col = cl.isFast ? '#f59e0b' : '#a78bfa';
            h += `<rect x="${cl.cx}" y="${cl.cy}" width="${cl.cw}" height="${cl.ch}" rx="3" fill="${col}" fill-opacity="${cl.isFast ? .4 : .2}" stroke="${col}" stroke-opacity=".75" stroke-width="1.5" data-hover="Row ${cl.row.num} &middot; Slot ${cl.letter}${cl.isFast ? ' (Fast Picking)' : ' (Buried)'}"/>`;
        });

        // Bike blocks
        if (m.front > 0) {
            for (const seg of m.strip) {
                if (seg.type !== 'block') continue;
                for (const row of seg.rows) {
                    const bx = s.isEW ? USABLE_X0        : USABLE_X0 + row.x;
                    const by = s.isEW ? NORTH_Y + row.x  : NORTH_Y;
                    const bw = s.isEW ? m.front : m.rW;
                    const bh = s.isEW ? m.rW    : m.front;
                    h += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="#39ff14" fill-opacity=".28" stroke="#39ff14" stroke-opacity=".9" stroke-width="1.5" data-hover="Bike Block (${m.lines * this.BIKES_LINE} bikes)"/>`;
                }
            }
        }

        // Posts
        m.activePosts.forEach(p => {
            const isHit = m.hits.some(h => h.post.id === p.id);
            const px = M + p.x - p.size / 2;
            const py = M + p.y - p.size / 2;
            h += `<rect x="${px}" y="${py}" width="${p.size}" height="${p.size}" rx="2" fill="${isHit ? '#ef4444' : '#34d399'}" data-hover="${p.note} (${isHit ? 'OBSTRUCTS SLOT' : 'IN AISLE'})"/>`;
        });

        // Labels
        if (c.labels) {
            c.labels.forEach(l => {
                const tr = l.rotate ? `transform="rotate(${l.rotate} ${M + l.x} ${M + l.y})"` : '';
                h += `<text x="${M + l.x}" y="${M + l.y}" font-size="17" fill="#475569" text-anchor="${l.anchor}" font-family="ui-monospace,monospace" ${tr} letter-spacing="2">${l.text}</text>`;
            });
        }

        return h;
    }
}
