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
        width: 1366,
        height: 745.5,
        margins: { top: 145.5, right: 107, bottom: 0, left: 156 }, // west is 156 if kept, 0 if freed
        startRowNumber: 33,
        rowNumberingDir: -1, // decreases going west
        mainAccess: "south",
        obstacles: [
            { id: "west_aisle", x: 0, y: 0, w: 156, h: 745.5, type: "aisle", label: "WEST AISLE (156\")", toggleable: "west" },
            { id: "east_rack", x: 1259, y: 0, w: 107, h: 745.5, type: "rack", label: "EAST CLEARANCE (107\")" },
            { id: "north_clearance", x: 0, y: 0, w: 1366, h: 145.5, type: "rack", label: "NORTH CLEARANCE (145.5\")" }
        ],
        posts: [
            { id: 4, x: 18, y: 470, size: 8, note: "P4" },
            { id: 3, x: 353, y: 470.5, size: 8, note: "P3" },
            { id: 2, x: 687, y: 467, size: 8, note: "P2" },
            { id: 1, x: 1025, y: 469.5, size: 8, note: "P1" }
        ],
        labels: [
            { text: "MAIN AISLE · SOUTH", x: 683, y: 770, anchor: "middle", rotate: 0 },
            { text: "NORTH WALL", x: 683, y: -20, anchor: "middle", rotate: 0 },
            { text: "EAST WALL", x: 1400, y: 372, anchor: "middle", rotate: 90 },
            { text: "WEST WALL", x: -22, y: 372, anchor: "middle", rotate: -90 }
        ]
    }
};
