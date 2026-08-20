export const ZONES = {
    bay3_se: {
        id: "bay3_se",
        name: "BAY 3 SOUTH/EAST",
        width: 628,
        height: 650, // 605 + 45
        margins: { top: 120, right: 100, bottom: 169, left: 131 }, // top=north(120), right=east(100), bottom=south(169 = 114" hall + 55" rack), left=west(131)
        rowRange: { start: 34, end: 40, origin: 'east' },
        obstacles: [
            { id: "main_aisle", x: 0, y: 0, w: 628, h: 120, type: "aisle", label: "MAIN HALL (120\")" },
            { id: "west_rack", x: 0, y: 120, w: 59, h: 530, type: "rack", label: "WEST RACK (59\")" },
            { id: "west_aisle", x: 59, y: 120, w: 72, h: 530, type: "aisle", label: "WEST HALL (72\")" },
            { id: "east_aisle", x: 528, y: 120, w: 48, h: 530, type: "aisle", label: "EAST HALL (48\")" },
            { id: "east_rack", x: 576, y: 120, w: 52, h: 530, type: "rack", label: "EAST RACK (52\")" },
            { id: "south_rack", x: 213, y: 595, w: 202, h: 55, type: "rack", label: "SOUTH WALL RACK (55\" × 202\")" },
            { id: "south_aisle", x: 59, y: 481, w: 469, h: 114, type: "aisle", label: "SOUTH HALL", showLabel: true, labelDy: 24 } // spans west hall to east hall; the side racks run past it to the wall
        ],
        posts: [
            { id: "se_1", x: 287, y: 185, size: 8, note: "Poste Sureste (Bay 3)" } // 65" south of main aisle (120)
        ],
        labels: [
            { text: "MAIN HALL · NORTH", x: 314, y: 60, anchor: "middle", rotate: 0 },
            { text: "SOUTH WALL", x: 314, y: 690, anchor: "middle", rotate: 0 },
            { text: "OFFICES (WEST)", x: -22, y: 385, anchor: "end", rotate: -90 },
            { text: "EAST WALL", x: 650, y: 385, anchor: "start", rotate: 90 }
        ]
    },
    bay3_north: {
        id: "bay3_north",
        name: "BAY 3 NORTH",
        width: 1366,
        height: 865.5, // 745.5 + 120
        margins: { top: 145.5, right: 107, bottom: 120, left: 156 },
        rowRange: { start: 33, end: 18, origin: 'east' },
        mainAccess: "south",
        allowedBlocks: [4, 3, 2],
        blockConstraints: {
            minCount: { 4: 2 },
            maxCount: { 4: 2 },
            requireAtEast: [4]
        },
        openBoundaries: { right: true },
        pushBlocksEastToPosts: true,
        obstacles: [
            { id: "west_aisle", x: 0, y: 0, w: 156, h: 745.5, type: "aisle", label: "WEST HALL (156\")", toggleable: "west" },
            { id: "east_rack", x: 1259, y: 0, w: 107, h: 745.5, type: "rack", label: "EAST CLEARANCE (107\")" },
            { id: "north_clearance", x: 0, y: 0, w: 1366, h: 145.5, type: "rack", label: "NORTH CLEARANCE (145.5\")" },
            { id: "main_aisle", x: 0, y: 745.5, w: 1366, h: 120, type: "aisle", label: "MAIN HALL (120\")" }
        ],
        posts: [
            { id: 4, x: 18, y: 470, size: 8, note: "P4" },
            { id: 3, x: 353, y: 470.5, size: 8, note: "P3" },
            { id: 2, x: 687, y: 467, size: 8, note: "P2" },
            { id: 1, x: 1025, y: 469.5, size: 8, note: "P1" }
        ],
        labels: [
            { text: "MAIN HALL · SOUTH", x: 683, y: 805.5, anchor: "middle", rotate: 0 },
            { text: "NORTH WALL", x: 683, y: -20, anchor: "middle", rotate: 0 },
            { text: "EAST WALL", x: 1400, y: 372, anchor: "middle", rotate: 90 },
            { text: "WEST WALL", x: -22, y: 372, anchor: "middle", rotate: -90 }
        ]
    },
    bay2_north: {
        id: "bay2_north",
        name: "BAY 2 NORTH",
        width: 1018, // 84' 10"
        height: 645, // 525 + 120
        margins: { top: 0, right: 0, bottom: 120, left: 0 },
        rowRange: { start: 10, end: -5, origin: 'east' },
        mainAccess: "south",
        allowedBlocks: [2, 1],
        obstacles: [
            { id: "main_aisle", x: 0, y: 525, w: 1018, h: 120, type: "aisle", label: "MAIN HALL (120\")" }
        ],
        posts: [
            { id: 5, x: 643, y: 394, size: 8, note: "P5 (Bay 2 North)" },
            { id: 6, x: 272, y: 395, size: 8, note: "P6 (Bay 2 North)" }
        ],
        labels: []
    },
    bay2_south: {
        id: "bay2_south",
        name: "BAY 2 SOUTH",
        width: 603, // 50' 3" (Open floor between Restroom #1/Credit Dept and Bay 3 divider wall)
        height: 651, // 531" storage depth + 120" Main Hall
        margins: { top: 120, right: 60, bottom: 0, left: 60 },
        rowRange: { start: 11, end: 17, origin: 'west' },
        mainAccess: "north",
        allowedBlocks: [3, 2],
        obstacles: [
            { id: "main_aisle", x: 0, y: 0, w: 603, h: 120, type: "aisle", label: "MAIN HALL (120\")" },
            { id: "west_hall", x: 0, y: 120, w: 60, h: 531, type: "aisle", label: "WEST HALL (60\")", toggleable: "west" },
            { id: "east_hall", x: 543, y: 120, w: 60, h: 531, type: "aisle", label: "EAST HALL (60\")", toggleable: "east" }
        ],
        posts: [
            { id: 7, x: 240, y: 385, size: 8, note: "Poste Sur (Bay 2)" } // 265 + 120
        ],
        labels: [
            { text: "RESTROOMS / CREDIT DEPT (WEST)", x: -20, y: 385, anchor: "middle", rotate: -90 },
            { text: "BAY 3 DIVIDER WALL (EAST)", x: 625, y: 385, anchor: "middle", rotate: 90 },
            { text: "SOUTH EXTERIOR WALL", x: 301, y: 665, anchor: "middle" }
        ]
    },
    bay1_north: {
        id: "bay1_north",
        name: "BAY 1 NORTH",
        width: 1948,
        height: 629, // 507 storage + 122 aisle
        margins: { top: 0, right: 0, bottom: 122, left: 0 },
        rowRange: { start: 41, end: 100, origin: 'east' },
        mainAccess: "south",
        allowedBlocks: [2, 1],
        obstacles: [
            { id: "main_aisle", x: 0, y: 507, w: 1948, h: 122, type: "aisle", label: "MAIN HALL (122\")" }
        ],
        posts: [
            { id: 1, x: 92, y: 137, size: 8, note: "P1 Norte (Bay 1)" },
            { id: 2, x: 464, y: 137, size: 8, note: "P2 Norte (Bay 1)" },
            { id: 3, x: 836, y: 137, size: 8, note: "P3 Norte (Bay 1)" },
            { id: 4, x: 1208, y: 137, size: 8, note: "P4 Norte (Bay 1)" },
            { id: 5, x: 1580, y: 137, size: 8, note: "P5 Norte (Bay 1)" }
        ],
        labels: [
            { text: "MAIN HALL · SOUTH", x: 974, y: 568, anchor: "middle", rotate: 0 },
            { text: "NORTH WALL", x: 974, y: -20, anchor: "middle", rotate: 0 },
            { text: "EAST WALL", x: 1980, y: 253, anchor: "start", rotate: 90 },
            { text: "WEST WALL", x: -20, y: 253, anchor: "end", rotate: -90 }
        ]
    },
    bay1_office_gap: {
        id: "bay1_office_gap",
        name: "BAY 1 OFFICE GAP",
        width: 757.5, // 63' 1.5"
        height: 299.5, // 120 aisle + 179.5 storage
        margins: { top: 120, right: 0, bottom: 0, left: 0 },
        rowRange: { start: 41, end: 100, origin: 'east' },
        mainAccess: "north",
        allowedBlocks: [2, 1],
        obstacles: [
            { id: "main_aisle", x: 0, y: 0, w: 757.5, h: 120, type: "aisle", label: "MAIN HALL (120\")" }
        ],
        posts: [
            // P4 and P5 Sur extrapolated from 28' centers starting at x=92, y=23" south of aisle
            { id: "p4_sur", x: 17.6, y: 143, size: 8, note: "P4 Sur (Bay 1)" },
            { id: "p5_sur", x: 389.6, y: 143, size: 8, note: "P5 Sur (Bay 1)" }
        ],
        labels: [
            { text: "MAIN HALL · NORTH", x: 378, y: 60, anchor: "middle", rotate: 0 },
            { text: "OFFICE WALL · SOUTH", x: 378, y: 325, anchor: "middle", rotate: 0 },
            { text: "SHOWROOM · WEST", x: -20, y: 210, anchor: "end", rotate: -90 },
            { text: "EAST WALL", x: 780, y: 210, anchor: "start", rotate: 90 }
        ]
    }
};
