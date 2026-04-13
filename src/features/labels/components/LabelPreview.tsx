import { parseBikeName } from '../../inventory/utils/parseBikeName';
import type { LabelEntry } from '../hooks/useGenerateLabels';

interface LabelPreviewProps {
  entry: Partial<LabelEntry>;
}

export function LabelPreview({ entry }: LabelPreviewProps) {
  const layout = entry.layout ?? 'standard';
  const parsed = parseBikeName(entry.itemName);

  const model = parsed.model || entry.sku || 'SKU';
  const detailParts: string[] = [];
  if (parsed.size) detailParts.push(`SIZE ${parsed.size}`);
  if (parsed.color) detailParts.push(`COLOR ${parsed.color}`);
  if (parsed.year) detailParts.push(`YEAR ${parsed.year}`);
  const detail = detailParts.join(' \u00B7 ');

  const sku = entry.sku || '---';
  const prefix = entry.prefix?.trim() || null;
  const extra = entry.extra?.trim() || null;

  if (layout === 'vertical') {
    return (
      <div
        className="mx-auto border border-gray-300 rounded-lg overflow-hidden bg-white"
        style={{
          width: 200,
          height: 300,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {/* Prefix */}
        {prefix && (
          <span
            style={{
              fontStyle: 'italic',
              fontWeight: 700,
              fontSize: 16,
              color: '#000',
            }}
          >
            {prefix}
          </span>
        )}

        {/* Model name highlighted */}
        <div
          style={{
            background: '#000',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
            padding: '2px 8px',
            borderRadius: 2,
            textAlign: 'center',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {model}
        </div>

        {/* Detail */}
        {detail && (
          <span
            style={{
              fontSize: 8,
              color: '#555',
              textAlign: 'center',
              lineHeight: 1.2,
            }}
          >
            {detail}
          </span>
        )}

        {/* Separator */}
        <div
          style={{
            width: '100%',
            height: 1,
            background: '#ccc',
            marginTop: 2,
            marginBottom: 2,
          }}
        />

        {/* SKU */}
        <div
          style={{
            background: '#000',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            padding: '2px 10px',
            borderRadius: 2,
            textAlign: 'center',
          }}
        >
          {sku}
        </div>

        {/* Extra */}
        {extra && <span style={{ fontSize: 8, fontWeight: 600, color: '#333' }}>{extra}</span>}

        {/* QR placeholder */}
        <div
          style={{
            marginTop: 'auto',
            width: 64,
            height: 64,
            background: '#e5e7eb',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: '#9ca3af',
            fontWeight: 600,
          }}
        >
          QR
        </div>
      </div>
    );
  }

  // Standard (landscape)
  return (
    <div
      className="mx-auto border border-gray-300 rounded-lg overflow-hidden bg-white"
      style={{
        width: 300,
        height: 200,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {prefix && (
          <span
            style={{
              fontStyle: 'italic',
              fontWeight: 700,
              fontSize: 14,
              color: '#000',
            }}
          >
            {prefix}
          </span>
        )}
        <span
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: '#000',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {model}
        </span>
      </div>

      {/* Detail */}
      {detail && <span style={{ fontSize: 8, color: '#555', lineHeight: 1.2 }}>{detail}</span>}

      {/* Separator */}
      <div
        style={{
          width: '100%',
          height: 1,
          background: '#ccc',
          marginTop: 2,
          marginBottom: 4,
        }}
      />

      {/* Main zone: SKU left, QR right */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            flex: 1,
          }}
        >
          {/* SKU with black bg */}
          <div
            style={{
              background: '#000',
              color: '#fff',
              fontWeight: 700,
              fontSize: 18,
              padding: '4px 10px',
              borderRadius: 2,
              display: 'inline-block',
              width: 'fit-content',
            }}
          >
            {sku}
          </div>

          {/* Extra */}
          {extra && <span style={{ fontSize: 9, fontWeight: 600, color: '#333' }}>{extra}</span>}
        </div>

        {/* QR placeholder */}
        <div
          style={{
            width: 72,
            height: 72,
            background: '#e5e7eb',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            color: '#9ca3af',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          QR
        </div>
      </div>
    </div>
  );
}
