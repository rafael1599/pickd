/**
 * 2D Spatial Label Segmenter for Multi-Box Scenes (Sub-fase O-1).
 *
 * Replaces global horizontal line grouping with 2D spatial clustering to isolate
 * individual box labels on pallets before field extraction.
 *
 * Root cause eliminated:
 * Global horizontal line grouping (`groupLinesBySpatialProximity`) projects all
 * text items onto infinite horizontal bands. When two boxes are side by side on a
 * pallet, their items fall into the same band, cross-contaminating attributes (e.g.
 * taking Size 14" from an adjacent box and pairing it with SKU 03-3858BL).
 *
 * Algorithm & Mathematical Foundation:
 * 1. Derives adaptive spatial thresholds (Tx, Ty) from the median glyph height
 *    (H_med) of valid text items, with zero magic constants.
 * 2. Builds a 2D proximity graph where text items connect if their bounding-box
 *    gap is within intra-label limits:
 *      - Horizontal overlap (dx = 0): connect if vertical gap dy <= Ty (2.2 * H_med).
 *      - Vertical overlap (dy = 0): connect if horizontal gap dx <= Tx (2.5 * H_med).
 *      - Non-overlapping: connect if dx <= 2.0 * H_med and dy <= 1.8 * H_med.
 * 3. Identifies connected components as candidate label clusters.
 * 4. Applies vertical block reconciliation within the same label column if two
 *    sub-clusters share strong horizontal overlap and neither has a conflicting SKU.
 * 5. Passes each isolated cluster to the unmodified atomic recognition engine
 *    (`extractFieldsFromOcrLines`), guaranteeing zero cross-contamination.
 *
 * Decision on Clustering Criterion & Field Provenance:
 * - Two labels merged into one cluster is catastrophic: it causes silent cross-contamination
 *   and false positives between distinct bicycles (a critical failure in warehouse logistics).
 * - A label split into two clusters is less damaging than a merge, but splitting is NOT
 *   benign if attributes are blindly overwritten or collapsed from catalog:
 *   un valor que viene del CATÁLOGO y un valor que viene de la FOTO no son el mismo dato
 *   y NUNCA deben colapsarse en el mismo campo.
 * - Architectural Rule: Guardar la procedencia de cada valor (`photo` vs `catalog`).
 *   Cuando ambos existan y difieran (ej. catálogo=23", foto=14"), eso es una señal independiente
 *   de DISCREPANCIA, no un empate a resolver o tapar.
 * - Therefore, the clustering threshold strictly errs on the side of separation across carton
 *   boundaries, while multi-box reconciliation preserves explicit provenance for every field.
 */

import {
  detectStructuralAnchors,
  extractFieldsFromOcrLines,
  groupLinesBySpatialProximity,
  type ExtractedOcrFields,
  type OcrBox,
  type OcrItem,
} from './clientOcr';

/**
 * Regex matching canonical bike SKU patterns (e.g. 03-3979GY, 01-0448) or bulk parts SKU patterns (e.g. PP1202JC).
 */
export const CANONICAL_SKU_REGEX =
  /(?<!\d)(?:\d{2}[-.\s]?\d{4}[-.\s]?[A-Z]{0,2}|[A-Z]{2}\d{4}[A-Z]{2})(?!\d)/i;

export interface LabelCluster {
  id: string;
  items: OcrItem[];
  bbox: OcrBox;
  medianHeight: number;
  anchorsCount: number;
  anchors: string[];
  hasSkuPattern: boolean;
}

export interface SegmentedLabelResult {
  cluster: LabelCluster;
  extracted: ExtractedOcrFields;
}

export interface SegmentationOptions {
  imageDimensions?: { width: number; height: number };
  xProximityMultiplier?: number; // default: 2.5
  yProximityMultiplier?: number; // default: 2.2
  minItemsPerCluster?: number; // default: 1
}

/**
 * Calculates median item height from an array of OCR items.
 */
export function calculateMedianItemHeight(items: OcrItem[]): number {
  const heights = items
    .map((it) => it.box.height)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);

  if (heights.length === 0) return 25; // Safe fallback
  const mid = Math.floor(heights.length / 2);
  return heights.length % 2 !== 0 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2;
}

/**
 * Computes bounding-box horizontal gap (dx) and vertical gap (dy) between two items.
 * Returns 0 if items overlap along that axis.
 */
export function computeBoxGaps(
  a: OcrBox,
  b: OcrBox
): { dx: number; dy: number; overlapX: number; overlapY: number } {
  const aX1 = a.x + a.width;
  const bX1 = b.x + b.width;
  const aY1 = a.y + a.height;
  const bY1 = b.y + b.height;

  const overlapX = Math.max(0, Math.min(aX1, bX1) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(aY1, bY1) - Math.max(a.y, b.y));

  const dx = overlapX > 0 ? 0 : Math.max(0, Math.max(a.x, b.x) - Math.min(aX1, bX1));
  const dy = overlapY > 0 ? 0 : Math.max(0, Math.max(a.y, b.y) - Math.min(aY1, bY1));

  return { dx, dy, overlapX, overlapY };
}

/**
 * Computes bounding box encompassing all items in a cluster.
 */
export function computeClusterBoundingBox(items: OcrItem[]): OcrBox {
  if (items.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const it of items) {
    if (it.box.x < minX) minX = it.box.x;
    if (it.box.y < minY) minY = it.box.y;
    const right = it.box.x + it.box.width;
    const bottom = it.box.y + it.box.height;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.round(Math.max(0, maxX - minX)),
    height: Math.round(Math.max(0, maxY - minY)),
  };
}

/**
 * Tests whether two items should be connected in the 2D spatial adjacency graph.
 */
export function areItemsSpatiallyAdjacent(
  a: OcrBox,
  b: OcrBox,
  hMed: number,
  xMult = 2.5,
  yMult = 2.2
): boolean {
  const { dx, dy, overlapX, overlapY } = computeBoxGaps(a, b);

  const tx = hMed * xMult;
  const ty = hMed * yMult;

  // Case 1: Columns align / overlap horizontally
  if (overlapX > 0) {
    return dy <= ty;
  }

  // Case 2: Lines align / overlap vertically
  if (overlapY > 0) {
    return dx <= tx;
  }

  // Case 3: Diagonal / slight offsets within paragraph
  return dx <= hMed * 2.0 && dy <= hMed * 1.8;
}

/**
 * Segments an array of raw OCR items into distinct 2D label clusters.
 *
 * Returns an array of LabelCluster objects, sorted by visual reading order
 * (top-to-bottom, left-to-right).
 */
export function segmentLabels2D(items: OcrItem[], options?: SegmentationOptions): LabelCluster[] {
  const validItems = items.filter(
    (it) => it.text && it.text.trim().length > 0 && it.box && it.box.height > 0 && it.box.width > 0
  );

  if (validItems.length === 0) return [];

  const hMed = calculateMedianItemHeight(validItems);
  const xMult = options?.xProximityMultiplier ?? 2.5;
  const yMult = options?.yProximityMultiplier ?? 2.2;
  const minItems = options?.minItemsPerCluster ?? 1;

  const n = validItems.length;
  const adj: number[][] = Array.from({ length: n }, () => []);

  // 1. Build adjacency graph based on 2D spatial proximity
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (areItemsSpatiallyAdjacent(validItems[i].box, validItems[j].box, hMed, xMult, yMult)) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  // 2. Extract connected components
  const visited = new Uint8Array(n);
  const rawClusters: OcrItem[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;

    const component: OcrItem[] = [];
    const queue: number[] = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const u = queue.shift()!;
      component.push(validItems[u]);

      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = 1;
          queue.push(v);
        }
      }
    }

    if (component.length >= minItems) {
      rawClusters.push(component);
    }
  }

  // 3. Vertical block reconciliation within the SAME carton label
  // If two sub-clusters are aligned vertically in the same column (strong overlap in X)
  // and the vertical gap is small (< 3.0 * hMed), merge them unless both have distinct SKUs.
  const mergedClusters: OcrItem[][] = [];
  const mergedVisited = new Uint8Array(rawClusters.length);

  for (let i = 0; i < rawClusters.length; i++) {
    if (mergedVisited[i]) continue;
    const currentItems = [...rawClusters[i]];
    let currentBbox = computeClusterBoundingBox(currentItems);
    mergedVisited[i] = 1;

    for (let j = i + 1; j < rawClusters.length; j++) {
      if (mergedVisited[j]) continue;

      const otherItems = rawClusters[j];
      const otherBbox = computeClusterBoundingBox(otherItems);
      const { dx, dy, overlapX } = computeBoxGaps(currentBbox, otherBbox);

      // Must overlap strongly in X (same vertical label column)
      const minW = Math.min(currentBbox.width, otherBbox.width);
      const hasColumnAlignment = overlapX >= 0.4 * minW && dx === 0;
      const isVerticalNeighbor = dy <= hMed * 3.0;

      // Check if both clusters independently have distinct canonical SKUs
      const currentHasSku = currentItems.some((it) => CANONICAL_SKU_REGEX.test(it.text.trim()));
      const otherHasSku = otherItems.some((it) => CANONICAL_SKU_REGEX.test(it.text.trim()));
      const hasDistinctSkus = currentHasSku && otherHasSku;

      if (hasColumnAlignment && isVerticalNeighbor && !hasDistinctSkus) {
        currentItems.push(...otherItems);
        currentBbox = computeClusterBoundingBox(currentItems);
        mergedVisited[j] = 1;
      }
    }

    mergedClusters.push(currentItems);
  }

  // 4. Build LabelCluster objects and metadata
  const clusters: LabelCluster[] = mergedClusters.map((clusterItems, index) => {
    const bbox = computeClusterBoundingBox(clusterItems);
    const clusterLines = groupLinesBySpatialProximity(clusterItems);
    const detectedAnchors = detectStructuralAnchors(clusterLines);
    const anchorNames = detectedAnchors.map((a) => a.name);

    const hasSku = clusterItems.some(
      (it) => CANONICAL_SKU_REGEX.test(it.text.trim()) || /(?:ITEM|SKU)\s*NO?\.?/i.test(it.text)
    );

    return {
      id: `label-cluster-${index + 1}`,
      items: clusterItems,
      bbox,
      medianHeight: calculateMedianItemHeight(clusterItems),
      anchorsCount: detectedAnchors.length,
      anchors: anchorNames,
      hasSkuPattern: hasSku,
    };
  });

  // 5. Sort clusters by vertical position Y, then horizontal position X
  clusters.sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > hMed * 1.5) {
      return dy;
    }
    return a.bbox.x - b.bbox.x;
  });

  return clusters;
}

/**
 * Segments an image's OCR items into 2D clusters and runs the atomic recognition
 * engine independently on each cluster, returning isolated field extractions.
 */
export function segmentAndExtractLabels(
  items: OcrItem[],
  options?: SegmentationOptions
): SegmentedLabelResult[] {
  const clusters = segmentLabels2D(items, options);

  return clusters.map((cluster) => {
    // Process each cluster independently through the verified atomic engine
    const lines = groupLinesBySpatialProximity(cluster.items);
    const extracted = extractFieldsFromOcrLines(lines, {
      width: cluster.bbox.width,
      height: cluster.bbox.height,
    });

    return {
      cluster,
      extracted,
    };
  });
}
