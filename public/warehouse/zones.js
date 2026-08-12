export const ZONES = {
    bay3_se: {
        id: "bay3_se",
        name: "BAY 3 SOUTH/EAST",
        width: 628,
        height: 530,
        margins: { top: 0, right: 124, bottom: 109, left: 107 }, // top=north, right=east, bottom=south, left=west
        startRowNumber: 34,
        obstacles: [
            { id: "east_rack", x: 0, y: 0, w: 52, h: 530, type: "rack", label: "EAST RACK (52\")" },
            { id: "east_aisle", x: 52, y: 0, w: 72, h: 530, type: "aisle", label: "EAST AISLE (72\")" },
            { id: "west_aisle", x: 521, y: 0, w: 48, h: 530, type: "aisle", label: "WEST AISLE (48\")" },
            { id: "west_rack", x: 569, y: 0, w: 59, h: 530, type: "rack", label: "WEST RACK (59\")" },
            { id: "south_rack", x: 213, y: 475, w: 202, h: 55, type: "rack", label: "SOUTH WALL RACK (55\" × 202\")" },
            { id: "south_aisle", x: 0, y: 421, w: 628, h: 54, type: "aisle", label: "SOUTH AISLE (54\")" }
        ],
        posts: [],
        labels: [
            { text: "MAIN AISLE · NORTH", x: 314, y: -20, anchor: "middle", rotate: 0 },
            { text: "SOUTH WALL", x: 314, y: 570, anchor: "middle", rotate: 0 },
            { text: "OFFICES (WEST)", x: -22, y: 265, anchor: "end", rotate: -90 },
            { text: "EAST WALL", x: 650, y: 265, anchor: "start", rotate: 90 }
        ]
    },
    bay3_north: {
        id: "bay3_north",
        name: "BAY 3 NORTH",
        width: 706,
        height: 887,
        margins: { top: 75, right: 45, bottom: 0, left: 104 }, // west is 104 if kept, 0 if freed (handled by UI state)
        startRowNumber: 33,
        rowNumberingDir: -1, // decreases going west
        obstacles: [
            { id: "west_aisle", x: 0, y: 0, w: 104, h: 887, type: "aisle", label: "WEST AISLE (104\")", toggleable: "west" },
            { id: "east_rack", x: 661, y: 0, w: 45, h: 887, type: "rack", label: "EAST RACK (45\")" },
            { id: "main_aisle", x: 0, y: 0, w: 706, h: 75, type: "aisle", label: "MAIN AISLE ENTRY (75\")" }
        ],
        posts: [
            { id: 1, x: 247, y: 231.5, size: 8, note: "P1" },
            { id: 2, x: 247, y: 692.5, size: 8, note: "P2" },
            { id: 3, x: 708.5, y: 231.5, size: 8, note: "P3 (hits East Rack)" },
            { id: 4, x: 708.5, y: 692.5, size: 8, note: "P4 (hits East Rack)" }
        ],
        labels: [
            { text: "MAIN AISLE · ENTRY", x: 353, y: -20, anchor: "middle", rotate: 0 },
            { text: "N", x: -22, y: 26, anchor: "end", rotate: 0 }
        ]
    }
};
