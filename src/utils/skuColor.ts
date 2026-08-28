// Deterministic per-SKU colour. Born in the Overstock put-away grid; now also
// the warehouse map's stock layer (idea-170), which is why it lives in utils.
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

/** The hue a SKU always gets, 0–359. */
export function skuHue(sku: string): number {
  return hashString(sku) % 360;
}

/** The same hue on a dark floor: a saturated fill that white text reads on. */
export function skuColorDark(sku: string): SkuColor {
  const hue = skuHue(sku);
  return {
    text: '#ffffff',
    bg: `hsl(${hue} 58% 42%)`,
    border: `hsl(${hue} 70% 68%)`,
  };
}

export function skuColor(sku: string): SkuColor {
  const hue = skuHue(sku);
  return {
    text: `hsl(${hue} 65% 32%)`,
    bg: `hsl(${hue} 60% 94%)`,
    border: `hsl(${hue} 55% 62%)`,
  };
}
