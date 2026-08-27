export class PalletEngine {
    constructor(id, config, state = {}) {
        this.id = id;
        this.config = config;
        this.state = state;

        this.PALLET_W = state.pd || 60; // Default width of a pallet spot (depth of rack)
        this.PALLET_H = state.pw || 62; // Default height of a pallet spot (width along the hall)
        this.HALL_MIN = 54;
        this.BIKES_PALLET = 30;
        this.BIKES_LINE = 6;
    }

    getLabelSequence(c) {
        if (!c.rowRange) return [];
        const { start, end } = c.rowRange;
        const seq = [];
        const step = start <= end ? 1 : -1;
        
        let curr = start;
        for (let i = 0; i < 150; i++) {
            seq.push(curr.toString());
            curr += step;
        }
        return seq;
    }

    calculate() {
        const c = this.config;
        const s = this.state;
        
        let margins = { ...c.margins };
        const dynamicObstacles = [];
        
        // Apply toggles (like freed west hall in North)
        if (c.obstacles) {
            c.obstacles.forEach(obs => {
                if (obs.toggleable && s.toggles[obs.toggleable] === false) {
                    if (obs.x === 0 && obs.w === margins.left) margins.left = 0;
                    if (obs.x > 0 && obs.x + obs.w === c.width && obs.w === margins.right) margins.right = 0;
                } else {
                    dynamicObstacles.push(obs);
                }
            });
        }

        // Anti-trap logic: Ensure internal halls can reach the main hall.
        const isMainHorizontal = (c.mainAccess === 'south' || c.mainAccess === 'north');
        const isMainVertical = (c.mainAccess === 'east' || c.mainAccess === 'west');
        
        if (isMainHorizontal && s.isEW) {
            // Rows are E-W (parallel to Main Hall). Need a N-S cross-hall.
            if (margins.left < this.HALL_MIN && margins.right < this.HALL_MIN) {
                margins.left = 120;
                dynamicObstacles.push({
                    id: "dynamic_cross_hall", x: 0, y: 0, w: 120, h: c.height, type: "hall", label: "CROSS HALL (120\")"
                });
            }
        }
        
        if (isMainVertical && !s.isEW) {
            // Rows are N-S (parallel to Main Hall). Need an E-W cross-hall.
            if (margins.top < this.HALL_MIN && margins.bottom < this.HALL_MIN) {
                margins.top = 120;
                dynamicObstacles.push({
                    id: "dynamic_cross_hall", x: 0, y: 0, w: c.width, h: 120, type: "hall", label: "CROSS HALL (120\")"
                });
            }
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
        const isReverse = c.mainAccess === 'south' || c.mainAccess === 'east';
        
        for (let i = 0; i < deep; i++) {
            if (isReverse) {
                // Slot A (i=0) is at the far end, going backwards
                offs.push(dSpan - gapW - (i + 1) * sD);
            } else {
                // Slot A (i=0) is at the near end, going forwards
                offs.push(gapW + i * sD);
            }
        }

        const build = () => {
            let blocks, nRows, extra, wallHallLeft, wallHallRight, extraSpaces, hallWidths;

            if (s.solidBlock || s.layoutPreset === 'solid') {
                // SOLID MONOLITHIC MASS BLOCK: 1 continuous block filling the entire usable span with 0 internal halls!
                nRows = Math.floor(rSpan / rW);
                if (nRows < 1) return null;
                blocks = [nRows];
                extra = rSpan - nRows * rW;
                wallHallLeft = false;
                wallHallRight = false;
                extraSpaces = [];
                hallWidths = [];
            } else if (s.centerHall || s.layoutPreset === 'center_hall') {
                // 1 CENTER HALL: 2 large continuous blocks separated by 1 wide hallway in the middle!
                const minHall = s.centerHallWidth || this.HALL_MIN;
                nRows = Math.floor((rSpan - minHall) / rW);
                if (nRows < 2) return null;
                const b1 = Math.ceil(nRows / 2);
                const b2 = Math.floor(nRows / 2);
                blocks = [b1, b2];
                const centerHallW = rSpan - nRows * rW;
                extra = 0;
                wallHallLeft = false;
                wallHallRight = false;
                extraSpaces = [];
                hallWidths = [centerHallW];
            } else {
                const minW = rW * (Math.min(...(c.allowedBlocks || [2, 3]))) + this.HALL_MIN;
                if (rSpan < minW) return null;

                let startIsHall = false;
                let endIsHall = false;
                
                if (c.openBoundaries) {
                    if (s.isEW) {
                        if (c.openBoundaries.top) startIsHall = true;
                        if (c.openBoundaries.bottom) endIsHall = true;
                    } else {
                        if (c.openBoundaries.left) startIsHall = true;
                        if (c.openBoundaries.right) endIsHall = true;
                    }
                }

                if (c.obstacles) {
                    for (const o of c.obstacles) {
                        if (o.toggleable && s.toggles[o.toggleable] === false) continue;
                        if (o.type === 'hall') {
                            if (s.isEW) {
                                if (o.w >= (c.width - margins.left - margins.right) * 0.5) {
                                    if (o.y <= margins.top && o.y + o.h >= margins.top) startIsHall = true;
                                    if (o.y <= c.height - margins.bottom && o.y + o.h >= c.height - margins.bottom) endIsHall = true;
                                }
                            } else {
                                if (o.h >= (c.height - margins.top - margins.bottom) * 0.5) {
                                    if (o.x <= margins.left && o.x + o.w >= margins.left) startIsHall = true;
                                    if (o.x <= c.width - margins.right && o.x + o.w >= c.width - margins.right) endIsHall = true;
                                }
                            }
                        }
                    }
                }

                const res = this.autoBlocks(rSpan, rW, startIsHall, endIsHall);
                if (!res) return null;

                blocks = res.blocks;
                nRows = res.nRows;
                extra = res.extra;
                wallHallLeft = res.wallHallLeft;
                wallHallRight = res.wallHallRight;
                extraSpaces = res.extraSpaces;
                hallWidths = res.hallWidths || [];
            }
            const nHalls = blocks.length - 1;
            const hall = nHalls > 0 ? this.HALL_MIN + extra / nHalls : 0;
            
            const strip = [];
            let cx = 0;
            const seq = this.getLabelSequence(c);
            const origin = c.rowRange ? (c.rowRange.origin || 'west') : 'west';
            let rowIndex = 0;
            let hallIndex = 0;

            if (wallHallLeft) {
                strip.push({ type: 'hall', w: this.HALL_MIN, x: cx });
                cx += this.HALL_MIN;
            }

            // Apply initial shift for Block 0 if it exists
            const initialExtra = extraSpaces ? extraSpaces.find(e => e.hallIndex === -1) : null;
            if (initialExtra && initialExtra.shiftAmt > 0) {
                strip.push({ type: 'hall', w: initialExtra.shiftAmt, x: cx, isExtraOnly: true, extra: initialExtra.shiftAmt });
                cx += initialExtra.shiftAmt;
            }

            for (let i = 0; i < blocks.length; i++) {
                const bSize = blocks[i];
                const start = cx;
                const rows = [];
                for (let k = 0; k < bSize; k++) {
                    let seqIdx;
                    if (origin === 'east') {
                        seqIdx = nRows - 1 - rowIndex;
                    } else {
                        seqIdx = rowIndex;
                    }
                    const numStr = seq.length > seqIdx ? seq[seqIdx] : '?';
                    
                    rows.push({ idx: k, of: bSize, x: cx, num: numStr });
                    rowIndex++;
                    cx += rW;
                }
                strip.push({ type: 'block', size: bSize, x0: start, x1: cx, rows });
                
                if (i < blocks.length - 1) {
                    const hw = hallWidths[hallIndex] || this.HALL_MIN;
                    const extraSpc = extraSpaces ? extraSpaces.find(e => e.hallIndex === hallIndex) : null;
                    strip.push({ type: 'hall', w: hw, x: cx, idx: hallIndex, extra: extraSpc ? extraSpc.shiftAmt : 0 });
                    cx += hw;
                    hallIndex++;
                }
            }

            if (wallHallRight) {
                strip.push({ type: 'hall', w: this.HALL_MIN, x: cx, isWall: true });
                cx += this.HALL_MIN;
            }

            // Collision detection with posts
            const cells = [];
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
                        
                        // Calculate Manhattan distance to Shipping (West Wall)
                        // 1. Distance to Main Hall (Y axis)
                        let distY = 0;
                        const mainHall = (c.obstacles || []).find(o => o.id === 'main_hall');
                        if (mainHall) {
                            distY = Math.min(Math.abs(cySlot - mainHall.y), Math.abs(cySlot - (mainHall.y + mainHall.h)));
                        } else {
                            // Fallback if no main_hall defined
                            distY = c.mainAccess === 'south' ? (c.height - cySlot) : cySlot;
                        }
                        
                        // 2. Distance to West Wall (X axis) is simply cxSlot since West is x=0
                        const distance = distY + cxSlot;

                        cells.push({ row: r, d, letter: String.fromCharCode(65 + d), cx: cxSlot, cy: cySlot, cw: cwSlot, ch: chSlot, isFast, distance });
                    }
                }
            }

            // Collision detection with posts
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

            // Custom Obstacles / Non-Bike Racks collision
            const allCustomObstacles = s.customObstacles || [];
            for (const obs of allCustomObstacles) {
                const ox = obs.x;
                const oy = obs.y;
                const ow = obs.w;
                const oh = obs.h;
                const hitCells = cells.filter(cl => {
                    const c_r = cl.cx + cl.cw;
                    const c_b = cl.cy + cl.ch;
                    return !(ox + ow <= cl.cx || ox >= c_r || oy + oh <= cl.cy || oy >= c_b);
                });
                if (hitCells.length > 0) {
                    hits.push({ post: { note: obs.label || 'Non-Bike Area', id: obs.id }, cells: hitCells, clear: false });
                    lost.push(...hitCells);
                }
            }

            const validCells = cells.filter(c => !lost.includes(c));
            accessible = validCells.filter(c => c.isFast).length;

            return {
                strip, blocks, nRows, nHalls: blocks.length - 1, hall, extra,
                pallets: validCells.length, validCells, bikesPerPallet: this.BIKES_PALLET,

                gross: cells.length,
                accessible,
                palletBikes: validCells.length * this.BIKES_PALLET,
                bikes: blockBikes,
                lines: nLines,
                deep, rW, sD, offs, gapW, front,
                hits, lost, activePosts, validCells,
                margins, obstacles: [...dynamicObstacles, ...allCustomObstacles]
            };
        };

        return build();
    }

    autoBlocks(span, rW, startIsHall, endIsHall) {
        const c = this.config;
        const s = this.state || {};
        let best = null;
        let maxRows = 0;
        let minExtra = Infinity;
        let bestWallHallsCount = Infinity;
        const sizes = c.allowedBlocks || [2, 3];
        const minSize = Math.min(...sizes);

        const search = (bList, used) => {
            let wallHallLeft = false;
            let wallHallRight = false;

            if (!startIsHall && bList[0] > 2) {
                wallHallLeft = true;
            }
            if (!endIsHall && bList[bList.length - 1] > 2) {
                wallHallRight = true;
            }

            const hCount = bList.length > 0 ? bList.length - 1 : 0;
            const req = used + hCount * this.HALL_MIN 
                        + (wallHallLeft ? this.HALL_MIN : 0) 
                        + (wallHallRight ? this.HALL_MIN : 0);
            if (req > span) return;
            
            // Check pruning for start block at wall
            const maxW = (s.maxAtWall !== undefined) ? s.maxAtWall : (c.blockConstraints && c.blockConstraints.maxAtWall);
            if (maxW !== undefined && !startIsHall && bList[0] > maxW) {
                return;
            }

            // Check pruning for internal 1-row blocks that already have halls on both sides
            for (let i = 0; i < bList.length - 1; i++) {
                if (bList[i] === 1) {
                    const hasHallBefore = (i > 0) || startIsHall || wallHallLeft;
                    const hasHallAfter  = true;
                    if (hasHallBefore && hasHallAfter) {
                        return;
                    }
                }
            }

            const extra = span - req;

            // Candidate Validation for complete bList
            let valid = true;
            if (bList[bList.length - 1] === 1) {
                const hasHallBefore = (bList.length > 1) || startIsHall || wallHallLeft;
                const hasHallAfter  = endIsHall || wallHallRight;
                if (hasHallBefore && hasHallAfter) {
                    valid = false;
                }
            }

            if (maxW !== undefined && !endIsHall && bList[bList.length - 1] > maxW) {
                valid = false;
            }

            if (valid && c.blockConstraints) {
                if (c.blockConstraints.maxCount) {
                    for (const [sizeStr, max] of Object.entries(c.blockConstraints.maxCount)) {
                        const size = parseInt(sizeStr);
                        let count = 0;
                        for (const b of bList) {
                            if (b === size) count++;
                        }
                        if (count > max) {
                            valid = false;
                            break;
                        }
                    }
                }
                if (valid && c.blockConstraints.requireAtEast) {
                    for (const sizeStr of c.blockConstraints.requireAtEast) {
                        const size = parseInt(sizeStr);
                        let found = false;
                        for (const b of bList) {
                            if (b === size) {
                                found = true;
                            } else if (found) {
                                valid = false;
                                break;
                            }
                        }
                        if (!valid) break;
                    }
                }
            }

            let finalHallWidths = [];

            if (valid) {
                // Validate: Posts in halls (Forklift clearance rule)
                if (c.posts && c.posts.length > 0) {
                    const checkHalls = (extraDist) => {
                        const halls = [];
                        let currX = 0;
                        if (wallHallLeft) {
                            halls.push({ x: currX, w: this.HALL_MIN });
                            currX += this.HALL_MIN;
                        }
                        for (let i = 0; i < bList.length; i++) {
                            currX += bList[i] * rW;
                            if (i < bList.length - 1) {
                                const w = this.HALL_MIN + extraDist[i];
                                halls.push({ x: currX, w });
                                currX += w;
                            }
                        }
                        if (wallHallRight) {
                            halls.push({ x: currX, w: this.HALL_MIN });
                            currX += this.HALL_MIN;
                        }
                        
                        for (const post of c.posts) {
                            const px = this.state.isEW ? (post.y - c.margins.top) : (post.x - c.margins.left);
                            const pSize = post.size || 8;
                            for (const h of halls) {
                                if (px + pSize > h.x && px < h.x + h.w) {
                                    const leftSpace = px - h.x;
                                    const rightSpace = (h.x + h.w) - (px + pSize);
                                    if (leftSpace < this.HALL_MIN && rightSpace < this.HALL_MIN) {
                                        return false;
                                    }
                                }
                            }
                        }
                        return true;
                    };

                    let foundDist = null;
                    const hCount = bList.length > 0 ? bList.length - 1 : 0;
                    
                    if (hCount === 0) {
                        foundDist = checkHalls([]) ? [] : null;
                    } else {
                        const uniform = Array(hCount).fill(extra / hCount);
                        if (checkHalls(uniform)) {
                            foundDist = uniform;
                        } else {
                            for (let i = 0; i < hCount; i++) {
                                const dist = Array(hCount).fill(0);
                                dist[i] = extra;
                                if (checkHalls(dist)) { foundDist = dist; break; }
                            }
                            if (!foundDist && hCount > 1) {
                                for (let tries = 0; tries < 20; tries++) {
                                    const dist = Array(hCount).fill(0);
                                    let remaining = extra;
                                    for (let i = 0; i < hCount - 1; i++) {
                                        const alloc = Math.random() * remaining;
                                        dist[i] = alloc;
                                        remaining -= alloc;
                                    }
                                    dist[hCount - 1] = remaining;
                                    if (checkHalls(dist)) { foundDist = dist; break; }
                                }
                            }
                        }
                    }
                    
                    if (foundDist) {
                        finalHallWidths = foundDist.map(d => this.HALL_MIN + d);
                    } else {
                        valid = false;
                    }
                } else {
                    const hCount = bList.length > 0 ? bList.length - 1 : 0;
                    if (hCount > 0) {
                        finalHallWidths = Array(hCount).fill(this.HALL_MIN + extra / hCount);
                    }
                }
            }

            if (valid && this.state.hallOverrides) {
                let totalOverride = 0;
                let overrideCount = 0;
                for (const [idx, val] of Object.entries(this.state.hallOverrides)) {
                    const i = parseInt(idx);
                    if (i < finalHallWidths.length) {
                        totalOverride += val;
                        overrideCount++;
                        finalHallWidths[i] = val;
                    }
                }
                
                const remainingExtra = extra - (totalOverride - overrideCount * this.HALL_MIN);
                if (remainingExtra < 0) {
                    valid = false;
                } else {
                    const nonOverrideCount = finalHallWidths.length - overrideCount;
                    if (nonOverrideCount > 0) {
                        for (let i = 0; i < finalHallWidths.length; i++) {
                            if (this.state.hallOverrides[i] === undefined) {
                                finalHallWidths[i] = this.HALL_MIN + remainingExtra / nonOverrideCount;
                            }
                        }
                    }
                }
            }

            if (valid) {
                let extraSpaces = [];
                if (c.pushBlocksEastToPosts) {
                    let currX = wallHallLeft ? this.HALL_MIN : 0;
                    for (let i = 0; i < bList.length - 1; i++) {
                        const blockW = bList[i] * rW;
                        currX += blockW;
                        const hw = finalHallWidths[i];
                        
                        let minLeftSpace = null;
                        let pSizeForMin = 8;
                        for (const post of (c.posts || [])) {
                            const px = this.state.isEW ? (post.y - c.margins.top) : (post.x - c.margins.left);
                            if (px > currX && px < currX + hw) {
                                const leftSpace = px - currX;
                                if (minLeftSpace === null || leftSpace < minLeftSpace) {
                                    minLeftSpace = leftSpace;
                                    pSizeForMin = post.size || 8;
                                }
                            }
                        }
                        
                        if (minLeftSpace !== null && minLeftSpace > 1) {
                            const shift = minLeftSpace - (pSizeForMin / 2) - 1;
                            const hasOverride = this.state.hallOverrides && 
                                (this.state.hallOverrides[i] !== undefined || (i > 0 && this.state.hallOverrides[i-1] !== undefined));
                            
                            if (!hasOverride && shift > 0) {
                                finalHallWidths[i] -= shift;
                                if (i > 0) {
                                    finalHallWidths[i - 1] += shift;
                                }
                                extraSpaces.push({ hallIndex: i - 1, shiftAmt: shift });
                            }
                        }
                        currX += hw;
                    }
                }

                const totalRows = bList.reduce((a, b) => a + b, 0);
                const wallHallsCount = (wallHallLeft ? 1 : 0) + (wallHallRight ? 1 : 0);

                let meetsMin = true;
                if (c.blockConstraints && c.blockConstraints.minCount) {
                    for (const [sizeStr, min] of Object.entries(c.blockConstraints.minCount)) {
                        const size = parseInt(sizeStr);
                        let count = 0;
                        for (const b of bList) {
                            if (b === size) count++;
                        }
                        if (count < min) {
                            meetsMin = false;
                            break;
                        }
                    }
                }

                let isBetter = false;
                if (meetsMin) {
                    if (totalRows > maxRows) {
                        isBetter = true;
                    } else if (totalRows === maxRows) {
                        if (wallHallsCount < bestWallHallsCount) {
                            isBetter = true;
                        } else if (wallHallsCount === bestWallHallsCount && extra < minExtra) {
                            isBetter = true;
                        }
                    }
                }

                if (isBetter) {
                    maxRows = totalRows;
                    minExtra = extra;
                    bestWallHallsCount = wallHallsCount;
                    best = { blocks: [...bList], nRows: totalRows, extra, wallHallLeft, wallHallRight, hallWidths: finalHallWidths, extraSpaces };
                }
            }
            
            const minBlockSpan = minSize * rW + this.HALL_MIN;
            if (extra >= minBlockSpan) {
                for (const b of sizes) {
                    bList.push(b);
                    search(bList, used + b * rW);
                    bList.pop();
                }
            }
        };

        for (const b of sizes) {
            search([b], b * rW);
        }
        return best;
    }

    renderSVG(m) {
        if (!m) return '';
        const c = this.config;
        const s = this.state;
        const M = 96;
        let h = `<defs>
            <pattern id="hazardPattern" width="24" height="24" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <rect width="24" height="24" fill="#450a0a" />
                <line x1="0" y1="0" x2="0" y2="24" stroke="#ef4444" stroke-width="9" />
                <line x1="12" y1="0" x2="12" y2="24" stroke="#f59e0b" stroke-width="9" />
            </pattern>
            <pattern id="nonBikeShelfPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <rect width="20" height="20" fill="#1e1b4b" />
                <rect x="2" y="2" width="16" height="16" fill="#312e81" rx="2" />
                <line x1="0" y1="10" x2="20" y2="10" stroke="#6366f1" stroke-width="1.5" />
            </pattern>
            <pattern id="stagingPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <rect width="20" height="20" fill="#082f49" fill-opacity="0.4" />
                <path d="M 0 0 L 20 20 M 20 0 L 0 20" stroke="#0284c7" stroke-width="1" stroke-opacity="0.5"/>
            </pattern>
        </defs>
        <style>
            svg rect[data-hover], svg circle[data-hover] { cursor:crosshair; transition:all 0.1s ease; }
            svg rect[data-hover]:hover { fill: rgba(0, 238, 255, 0.4) !important; stroke: #00eeff !important; stroke-width: 2.5 !important; stroke-dasharray: none !important; }
            svg circle[data-hover]:hover { fill: #00eeff !important; stroke: #fff !important; stroke-width: 2 !important; }
        </style>`;
        
        // Universal Compass (Top-Left)
        h += `<g transform="translate(45, 45) scale(0.6)" pointer-events="none">
                <circle cx="0" cy="0" r="25" fill="none" stroke="#334155" stroke-width="2"/>
                <path d="M 0 -30 L 7 -7 L 30 0 L 7 7 L 0 30 L -7 7 L -30 0 L -7 -7 Z" fill="#1e293b"/>
                <path d="M 0 -30 L 7 -7 L 0 0 L -7 -7 Z" fill="#f59e0b"/>
                <text x="0" y="-38" fill="#94a3b8" font-size="14" text-anchor="middle" font-weight="bold" font-family="ui-monospace,monospace">N</text>
              </g>`;

        h += `<rect x="${M}" y="${M}" width="${c.width}" height="${c.height}" fill="#0d1524" stroke="#334155" stroke-width="3"/>`;

        // Obstacles (Base & Custom)
        if (m.obstacles) {
            m.obstacles.forEach(obs => {
                let fill = '#0a1120';
                let stroke = '#1e293b';
                let strokeWidth = '1';
                let strokeDash = '8 8';
                let fillOpacity = '1';

                if (obs.type === 'non_bike_rack') {
                    fill = 'url(#nonBikeShelfPattern)';
                    stroke = '#6366f1';
                    strokeWidth = '2';
                    strokeDash = 'none';
                } else if (obs.type === 'restricted') {
                    fill = 'url(#hazardPattern)';
                    stroke = '#ef4444';
                    strokeWidth = '2';
                    strokeDash = 'none';
                } else if (obs.type === 'staging') {
                    fill = 'url(#stagingPattern)';
                    stroke = '#0284c7';
                    strokeWidth = '2';
                    strokeDash = '6 4';
                } else if (obs.type === 'rack') {
                    fill = '#ef4444';
                    fillOpacity = '.08';
                    stroke = '#ef4444';
                    strokeWidth = '2';
                    strokeDash = 'none';
                }

                h += `<rect x="${M + obs.x}" y="${M + obs.y}" width="${obs.w}" height="${obs.h}" 
                        fill="${fill}" 
                        fill-opacity="${fillOpacity}"
                        stroke="${stroke}" 
                        stroke-width="${strokeWidth}"
                        stroke-dasharray="${strokeDash}"
                        data-hover="${(obs.label || 'Obstacle').replace(/"/g, '&quot;')} (${Math.round(obs.w)}&quot; &times; ${Math.round(obs.h)}&quot;)"/>`;

                // Add text label for custom obstacles
                if (obs.type === 'non_bike_rack' || obs.type === 'restricted' || obs.type === 'staging') {
                    const cx = M + obs.x + obs.w / 2;
                    const cy = M + obs.y + obs.h / 2;
                    const icon = obs.type === 'non_bike_rack' ? '🗄️' : (obs.type === 'restricted' ? '⚠️' : '📦');
                    const fontSize = Math.min(18, Math.max(10, Math.min(obs.w, obs.h) * 0.25));
                    h += `<text x="${cx}" y="${cy + fontSize * 0.35}" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" font-weight="900" font-family="ui-monospace,monospace" pointer-events="none" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.8))">${icon} ${obs.label || 'RESTRICTED'}</text>`;
                }

                // Opt-in name + live measurement for perimeter halls/racks.
                // Opt-in because the west band already carries the A-F slot letters
                // and the main hall carries a zone label; both would collide.
                if (obs.showLabel && (obs.type === 'hall' || obs.type === 'rack')) {
                    const horiz = obs.w >= obs.h;
                    const thick = Math.round(horiz ? obs.h : obs.w);
                    const name = obs.name || (obs.label || '').replace(/\s*\(.*\)\s*$/, '') || 'HALL';
                    const lx = M + obs.x + obs.w / 2;
                    const ly = M + obs.y + obs.h / 2 + (obs.labelDy || 0);
                    const fs = Math.max(11, Math.min(17, Math.min(obs.w, obs.h) * 0.22));
                    const col = obs.type === 'rack' ? '#fca5a5' : '#64748b';
                    const rot = horiz ? '' : ` transform="rotate(-90, ${lx}, ${ly})"`;
                    h += `<text x="${lx}" y="${ly + fs * 0.35}"${rot} font-size="${fs}" fill="${col}" text-anchor="middle" font-weight="800" letter-spacing="2" font-family="ui-monospace,monospace" pointer-events="none">${name} &middot; ${thick}&quot;</text>`;
                }
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
                if (seg.isExtraOnly) {
                    const sx = USABLE_X0 + seg.x;
                    h += `<rect x="${sx}" y="${NORTH_Y}" width="${seg.extra}" height="${SOUTH_Y - NORTH_Y}" fill="rgba(52,211,153,0.15)" stroke="none" data-hover="EXTRA WEST SPACE: ${Math.round(seg.extra)}&quot;" pointer-events="all"/>`;
                    continue;
                }
                const clickable = seg.idx !== undefined ? ` data-hall-idx="${seg.idx}" style="cursor:pointer;" onclick="window.openHallSlider(event, ${seg.idx}, ${Math.round(seg.w)})"` : '';
                if (s.isEW) {
                    const ay = NORTH_Y + seg.x;
                    h += `<rect x="${USABLE_X0}" y="${ay}" width="${usableEW}" height="${seg.w}" fill="#0a1120" stroke="#1e293b" stroke-width="1.2" data-hover="HALL &middot; ${Math.round(usableEW)}&quot; &times; ${Math.round(seg.w)}&quot; (Click to resize)"${clickable}/>`;
                    if (seg.extra > 0) {
                        const extraY = ay + seg.w - seg.extra;
                        h += `<rect x="${USABLE_X0}" y="${extraY}" width="${usableEW}" height="${seg.extra}" fill="rgba(52,211,153,0.15)" stroke="none" data-hover="EXTRA SPACE ADDED: ${Math.round(seg.extra)}&quot;" pointer-events="all"/>`;
                    }
                    h += `<line x1="${USABLE_X0 + 10}" y1="${ay + seg.w / 2}" x2="${USABLE_X0 + usableEW - 10}" y2="${ay + seg.w / 2}" stroke="#334155" stroke-width="2" stroke-dasharray="14 12" pointer-events="none"/>`;
                    h += `<text x="${USABLE_X0 + usableEW / 2}" y="${ay + seg.w / 2 + 6}" font-size="24" fill="#475569" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace" pointer-events="none">${Math.round(seg.w)}"</text>`;
                } else {
                    const sx = USABLE_X0 + seg.x;
                    h += `<rect x="${sx}" y="${NORTH_Y}" width="${seg.w}" height="${SOUTH_Y - NORTH_Y}" fill="#0a1120" stroke="#1e293b" stroke-width="1.2" data-hover="HALL &middot; ${Math.round(seg.w)}&quot; &times; ${Math.round(SOUTH_Y - NORTH_Y)}&quot; (Click to resize)"${clickable}/>`;
                    if (seg.extra > 0) {
                        const extraX = sx + seg.w - seg.extra;
                        h += `<rect x="${extraX}" y="${NORTH_Y}" width="${seg.extra}" height="${SOUTH_Y - NORTH_Y}" fill="rgba(52,211,153,0.15)" stroke="none" data-hover="EXTRA SPACE ADDED: ${Math.round(seg.extra)}&quot;" pointer-events="all"/>`;
                    }
                    h += `<line x1="${sx + seg.w / 2}" y1="${NORTH_Y + 10}" x2="${sx + seg.w / 2}" y2="${SOUTH_Y - 10}" stroke="#334155" stroke-width="2" stroke-dasharray="14 12" pointer-events="none"/>`;
                    h += `<text x="${sx + seg.w / 2 + 7}" y="${NORTH_Y + (SOUTH_Y - NORTH_Y) / 2}" font-size="24" fill="#475569" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace" pointer-events="none" transform="rotate(-90 ${sx + seg.w / 2} ${NORTH_Y + (SOUTH_Y - NORTH_Y) / 2})">${Math.round(seg.w)}"</text>`;
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
                        h += `<text x="${USABLE_X0 - 45}" y="${NORTH_Y + r.x + m.rW / 2 + 9}" font-size="26" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                        h += `<text x="${USABLE_X0 + usableEW + 45}" y="${NORTH_Y + r.x + m.rW / 2 + 9}" font-size="26" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                    } else {
                        h += `<text x="${USABLE_X0 + r.x + m.rW / 2}" y="${NORTH_Y - 20}" font-size="26" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                        h += `<text x="${USABLE_X0 + r.x + m.rW / 2}" y="${SOUTH_Y + 40}" font-size="26" fill="#a78bfa" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${r.num}</text>`;
                    }
                });
            }
        }

        // Sublocation (slot depth) labels on the sides
        if (m.deep > 0) {
            for (let d = 0; d < m.deep; d++) {
                const isLast = (d === m.deep - 1);
                const isFirst = (d === 0);
                // Highlight the first and last numbers to be more prominent
                const letter = `${d + 1}-${String.fromCharCode(65 + d)}`;
                const fSize = (isLast || isFirst) ? 22 : 18;
                const fColor = (isLast || isFirst) ? '#94a3b8' : '#64748b';
                
                if (s.isEW) {
                    const cx = USABLE_X0 + m.offs[d] + m.sD / 2;
                    h += `<text x="${cx}" y="${NORTH_Y - 45}" font-size="${fSize}" fill="${fColor}" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${letter}</text>`;
                    h += `<text x="${cx}" y="${SOUTH_Y + 60}" font-size="${fSize}" fill="${fColor}" text-anchor="middle" font-weight="800" font-family="ui-monospace,monospace">${letter}</text>`;
                } else {
                    const cy = NORTH_Y + m.offs[d] + m.sD / 2;
                    h += `<text x="${USABLE_X0 - 45}" y="${cy + 8}" font-size="${fSize}" fill="${fColor}" text-anchor="end" font-weight="800" font-family="ui-monospace,monospace">${letter}</text>`;
                    h += `<text x="${USABLE_X0 + usableEW + 45}" y="${cy + 8}" font-size="${fSize}" fill="${fColor}" text-anchor="start" font-weight="800" font-family="ui-monospace,monospace">${letter}</text>`;
                }
            }
        }

        // Pallets
        const validCells = m.validCells || this.cells || [];
        validCells.forEach(cl => {
            const col = cl.isFast ? '#f59e0b' : '#a78bfa';
            h += `<rect x="${M + cl.cx}" y="${M + cl.cy}" width="${cl.cw}" height="${cl.ch}" rx="3" fill="${col}" fill-opacity="${cl.isFast ? .4 : .2}" stroke="${col}" stroke-opacity=".75" stroke-width="1.5" data-slot="${cl.row.num}-${cl.letter}" data-hover="Row ${cl.row.num} &middot; Slot ${cl.letter} &middot; ${cl.cw}&quot;&times;${cl.ch}&quot;${cl.isFast ? ' &middot; Fast Picking' : ' &middot; Buried'}"/>`;
            const fontSize = Math.min(cl.cw, cl.ch) * 0.35;
            h += `<text x="${M + cl.cx + cl.cw / 2}" y="${M + cl.cy + cl.ch / 2 + fontSize * 0.35}" font-size="${fontSize}" fill="${col}" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="bold" pointer-events="none" data-slot-text="${cl.row.num}-${cl.letter}"></text>`;
        });

        // Bike blocks
        if (m.front > 0) {
            const isReverse = c.mainAccess === 'south' || c.mainAccess === 'east';
            for (const seg of m.strip) {
                if (seg.type !== 'block') continue;
                for (const row of seg.rows) {
                    let bx = s.isEW ? USABLE_X0 : USABLE_X0 + row.x;
                    let by = s.isEW ? NORTH_Y + row.x : NORTH_Y;
                    let bw = s.isEW ? m.front : m.rW;
                    let bh = s.isEW ? m.rW : m.front;
                    
                    if (isReverse) {
                        if (s.isEW) bx += usableEW - m.front;
                        else by += (SOUTH_Y - NORTH_Y) - m.front;
                    }
                    
                    const bikesInBlock = m.lines * this.BIKES_LINE;
                    h += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="#39ff14" fill-opacity=".28" stroke="#39ff14" stroke-opacity=".9" stroke-width="1.5" data-hover="Bike Block &middot; ${Math.round(bw)}&quot;&times;${Math.round(bh)}&quot; &middot; ${bikesInBlock} bikes"/>`;
                    
                    const fontSize = Math.min(bw, bh) * 0.3;
                    const rotate = (bh > bw) ? `transform="rotate(-90 ${bx + bw / 2} ${by + bh / 2})"` : '';
                    h += `<text x="${bx + bw / 2}" y="${by + bh / 2 + fontSize * 0.35}" font-size="${fontSize}" fill="#39ff14" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="bold" pointer-events="none" ${rotate}>${bikesInBlock}u</text>`;
                }
            }
        }

        // Posts (Hall rendering: red dot)
        m.activePosts.forEach(p => {
            const isHit = m.hits.some(h => h.post.id === p.id);
            if (!isHit) {
                const px = M + p.x;
                const py = M + p.y;
                h += `<circle cx="${px}" cy="${py}" r="${p.size > 0 ? Math.max(3, p.size / 2) : 4}" fill="#ef4444" data-hover="${p.note} (IN HALL)"/>`;
            }
        });

        // Hit slots rendering: draw an X on the square
        m.lost.forEach(cl => {
            const cx = M + cl.cx;
            const cy = M + cl.cy;
            // Background for the obstructed slot
            h += `<rect x="${cx}" y="${cy}" width="${cl.cw}" height="${cl.ch}" rx="3" fill="#ef4444" fill-opacity="0.1" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 4" data-hover="Row ${cl.row.num} &middot; Slot ${cl.letter} (OBSTRUCTED)"/>`;
            // The X
            h += `<line x1="${cx}" y1="${cy}" x2="${cx + cl.cw}" y2="${cy + cl.ch}" stroke="#ef4444" stroke-width="2.5" pointer-events="none"/>`;
            h += `<line x1="${cx + cl.cw}" y1="${cy}" x2="${cx}" y2="${cy + cl.ch}" stroke="#ef4444" stroke-width="2.5" pointer-events="none"/>`;
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

    renderEditorSVG(m, customObstacles = [], selectedId = null) {
        const c = this.config;
        const M = 96;
        let h = `<defs>
            <pattern id="editorHazardPattern" width="24" height="24" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <rect width="24" height="24" fill="#450a0a" />
                <line x1="0" y1="0" x2="0" y2="24" stroke="#ef4444" stroke-width="9" />
                <line x1="12" y1="0" x2="12" y2="24" stroke="#f59e0b" stroke-width="9" />
            </pattern>
            <pattern id="editorNonBikeShelfPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <rect width="20" height="20" fill="#1e1b4b" />
                <rect x="2" y="2" width="16" height="16" fill="#312e81" rx="2" />
                <line x1="0" y1="10" x2="20" y2="10" stroke="#6366f1" stroke-width="1.5" />
            </pattern>
            <pattern id="editorStagingPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <rect width="20" height="20" fill="#082f49" fill-opacity="0.4" />
                <path d="M 0 0 L 20 20 M 20 0 L 0 20" stroke="#0284c7" stroke-width="1" stroke-opacity="0.5"/>
            </pattern>
            <pattern id="editorFloorGrid" width="60" height="60" patternUnits="userSpaceOnUse">
                <rect width="60" height="60" fill="#090e17" />
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#172338" stroke-width="1"/>
            </pattern>
        </defs>
        <style>
            .editor-obs-rect { cursor: grab; }
            .editor-obs-rect:active { cursor: grabbing; }
            .resize-handle { fill: #00eeff; stroke: #04070d; stroke-width: 2px; }
            .resize-handle:hover { fill: #ffffff; transform: scale(1.2); }
        </style>`;

        // Universal Compass (Top-Left)
        h += `<g transform="translate(45, 45) scale(0.6)" pointer-events="none">
                <circle cx="0" cy="0" r="25" fill="none" stroke="#334155" stroke-width="2"/>
                <path d="M 0 -30 L 7 -7 L 30 0 L 7 7 L 0 30 L -7 7 L -30 0 L -7 -7 Z" fill="#1e293b"/>
                <path d="M 0 -30 L 7 -7 L 0 0 L -7 -7 Z" fill="#f59e0b"/>
                <text x="0" y="-38" fill="#94a3b8" font-size="14" text-anchor="middle" font-weight="bold" font-family="ui-monospace,monospace">N</text>
              </g>`;

        // Floor Boundary with Subtle Grid
        h += `<rect x="${M}" y="${M}" width="${c.width}" height="${c.height}" fill="url(#editorFloorGrid)" stroke="#38bdf8" stroke-width="3"/>`;

        // Architectural Base Obstacles
        if (c.obstacles) {
            c.obstacles.forEach(obs => {
                const isRack = obs.type === 'rack';
                h += `<rect x="${M + obs.x}" y="${M + obs.y}" width="${obs.w}" height="${obs.h}" 
                        fill="${isRack ? '#334155' : '#0f172a'}" 
                        fill-opacity="0.5"
                        stroke="#475569" 
                        stroke-width="1.5"
                        stroke-dasharray="6 4"
                        pointer-events="none"/>`;
                
                const cx = M + obs.x + obs.w / 2;
                const cy = M + obs.y + obs.h / 2;
                h += `<text x="${cx}" y="${cy + 5}" font-size="14" fill="#64748b" text-anchor="middle" font-weight="bold" font-family="ui-monospace,monospace" pointer-events="none">${obs.label || 'BASE OBSTACLE'}</text>`;
            });
        }

        // Structural Posts
        (c.posts || []).forEach(p => {
            const px = M + p.x;
            const py = M + p.y;
            const sz = Math.max(6, (p.size || 8));
            h += `<rect x="${px - sz/2}" y="${py - sz/2}" width="${sz}" height="${sz}" fill="#ef4444" stroke="#fff" stroke-width="1.5"/>`;
            h += `<text x="${px}" y="${py - sz - 4}" font-size="12" fill="#ef4444" text-anchor="middle" font-weight="bold" font-family="ui-monospace,monospace">${p.note || 'POST'}</text>`;
        });

        // Custom Obstacles / Non-Bike Racks (Interactive Elements)
        customObstacles.forEach(obs => {
            const isSelected = (obs.id === selectedId);
            const x = M + obs.x;
            const y = M + obs.y;
            const w = Math.max(10, obs.w);
            const h_val = Math.max(10, obs.h);

            let fill = 'url(#editorNonBikeShelfPattern)';
            let stroke = '#6366f1';
            let icon = '🗄️';

            if (obs.type === 'restricted') {
                fill = 'url(#editorHazardPattern)';
                stroke = '#ef4444';
                icon = '⚠️';
            } else if (obs.type === 'staging') {
                fill = 'url(#editorStagingPattern)';
                stroke = '#0284c7';
                icon = '📦';
            }

            h += `<g class="editor-obstacle-group" data-obs-id="${obs.id}">`;
            
            // Main Obstacle Rect
            h += `<rect class="editor-obs-rect" x="${x}" y="${y}" width="${w}" height="${h_val}" 
                    rx="4"
                    fill="${fill}" 
                    stroke="${stroke}" 
                    stroke-width="${isSelected ? '3' : '2'}"
                    data-obs-id="${obs.id}"/>`;

            // Center Label Badge
            const cx = x + w / 2;
            const cy = y + h_val / 2;
            const fontSize = Math.min(18, Math.max(11, Math.min(w, h_val) * 0.22));
            h += `<rect x="${cx - 80}" y="${cy - fontSize * 0.8}" width="160" height="${fontSize * 1.6}" rx="4" fill="rgba(15, 23, 42, 0.85)" stroke="${stroke}" stroke-width="1" pointer-events="none"/>`;
            h += `<text x="${cx}" y="${cy + fontSize * 0.35}" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" font-weight="900" font-family="ui-monospace,monospace" pointer-events="none">${icon} ${obs.label || 'NON-BIKE RACK'}</text>`;

            // Top Dimension Badge
            h += `<rect x="${cx - 45}" y="${y - 20}" width="90" height="16" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1" pointer-events="none"/>`;
            h += `<text x="${cx}" y="${y - 8}" font-size="10.5" fill="#38bdf8" text-anchor="middle" font-weight="bold" font-family="ui-monospace,monospace" pointer-events="none">${Math.round(obs.w)}" &times; ${Math.round(obs.h)}"</text>`;

            // Selection Handles
            if (isSelected) {
                // Highlight box
                h += `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h_val + 6}" fill="none" stroke="#00eeff" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>`;

                const handleSz = 10;
                const hszHalf = handleSz / 2;
                
                // 8 Resize Handles
                const handles = [
                    { dir: 'nw', hx: x, hy: y, cur: 'nwse-resize' },
                    { dir: 'n',  hx: x + w/2, hy: y, cur: 'ns-resize' },
                    { dir: 'ne', hx: x + w, hy: y, cur: 'nesw-resize' },
                    { dir: 'e',  hx: x + w, hy: y + h_val/2, cur: 'ew-resize' },
                    { dir: 'se', hx: x + w, hy: y + h_val, cur: 'nwse-resize' },
                    { dir: 's',  hx: x + w/2, hy: y + h_val, cur: 'ns-resize' },
                    { dir: 'sw', hx: x, hy: y + h_val, cur: 'nesw-resize' },
                    { dir: 'w',  hx: x, hy: y + h_val/2, cur: 'ew-resize' }
                ];

                handles.forEach(hd => {
                    h += `<rect class="resize-handle" x="${hd.hx - hszHalf}" y="${hd.hy - hszHalf}" width="${handleSz}" height="${handleSz}" rx="2" style="cursor:${hd.cur};" data-handle="${hd.dir}" data-obs-id="${obs.id}"/>`;
                });
            }

            h += `</g>`;
        });

        // Wall Labels
        if (c.labels) {
            c.labels.forEach(l => {
                const tr = l.rotate ? `transform="rotate(${l.rotate} ${M + l.x} ${M + l.y})"` : '';
                h += `<text x="${M + l.x}" y="${M + l.y}" font-size="18" fill="#64748b" text-anchor="${l.anchor}" font-weight="900" font-family="ui-monospace,monospace" ${tr} letter-spacing="2">${l.text}</text>`;
            });
        }

        return h;
    }

    // Universal Tooltip Installer with Smart Non-Obstructive Positioning
    static attachTooltip(svgElement) {
        if (!svgElement) return;
        let tooltip = document.getElementById('pe-universal-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'pe-universal-tooltip';
            tooltip.style.cssText = "position:absolute; background:#ffffff; color:#0f172a; font-family:ui-monospace,monospace; font-size:12px; line-height:1.45; padding:12px 14px; border-radius:8px; pointer-events:none; opacity:0; transition:opacity .12s ease-out; z-index:9999; box-shadow:0 12px 28px rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.25); border:1px solid #cbd5e1; max-width:360px; min-width:240px;";
            document.body.appendChild(tooltip);
        }

        svgElement.addEventListener('mousemove', e => {
            const target = e.target.closest('[data-hover]');
            if (target) {
                tooltip.innerHTML = target.getAttribute('data-hover');
                tooltip.style.opacity = 1;

                const sku = target.getAttribute('data-sku');
                let highlighted = sku ? Array.from(document.querySelectorAll(`rect[data-sku="${sku}"]`)) : [target];
                if (highlighted.length === 0) highlighted = [target];

                // Compute bounding box of all highlighted slots for this SKU
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                highlighted.forEach(el => {
                    const r = el.getBoundingClientRect();
                    if (r.left < minX) minX = r.left;
                    if (r.right > maxX) maxX = r.right;
                    if (r.top < minY) minY = r.top;
                    if (r.bottom > maxY) maxY = r.bottom;
                });

                const tw = tooltip.offsetWidth || 300;
                const th = tooltip.offsetHeight || 150;
                const margin = 18;
                let posX, posY;

                // Smart positioning: avoid covering any highlighted sublocations
                // 1. Try placing to the Right of the cluster
                if (maxX + margin + tw <= window.innerWidth - 10) {
                    posX = maxX + margin;
                    posY = Math.max(10, Math.min(window.innerHeight - th - 10, minY));
                }
                // 2. Try placing to the Left of the cluster
                else if (minX - margin - tw >= 10) {
                    posX = minX - margin - tw;
                    posY = Math.max(10, Math.min(window.innerHeight - th - 10, minY));
                }
                // 3. Try placing Above the cluster
                else if (minY - margin - th >= 10) {
                    posX = Math.max(10, Math.min(window.innerWidth - tw - 10, minX));
                    posY = minY - margin - th;
                }
                // 4. Fallback Below the cluster
                else {
                    posX = Math.max(10, Math.min(window.innerWidth - tw - 10, minX));
                    posY = maxY + margin;
                }

                tooltip.style.left = (posX + window.scrollX) + 'px';
                tooltip.style.top = (posY + window.scrollY) + 'px';
            } else {
                tooltip.style.opacity = 0;
            }
        });

        svgElement.addEventListener('mouseleave', () => {
            tooltip.style.opacity = 0;
        });
    }
}
