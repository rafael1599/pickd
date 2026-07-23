// Deterministic per-SKU color for the Overstock put-away grid.
//
// The SKU count here is open-ended (as many as qualify for the plan), so this
// isn't a bounded categorical palette — hue is hashed per SKU instead of
// picked from a fixed order. To keep it readable regardless of which hue
// lands, saturation/lightness are fixed and only hue varies: text/border use
// a dark, saturated tone (safe contrast on white), backgrounds use a light
// tint of the same hue. Identity is never color-alone — every colored cell
// or row is also directly labeled with the SKU code.

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface SkuColor {
  text: string;
  bg: string;
  border: string;
}

export function skuColor(sku: string): SkuColor {
  const hue = hashString(sku) % 360;
  return {
    text: `hsl(${hue} 65% 32%)`,
    bg: `hsl(${hue} 60% 94%)`,
    border: `hsl(${hue} 55% 62%)`,
  };
}
