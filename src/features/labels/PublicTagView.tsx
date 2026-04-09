import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { parseBikeName } from '../inventory/utils/parseBikeName';

// Use anon client for public access (no auth required)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const publicSupabase = createClient(supabaseUrl, supabaseAnonKey);

interface TagData {
  short_code: string;
  sku: string;
  item_name: string | null;
  image_url: string | null;
  is_bike: boolean | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  weight_lbs: number | null;
  upc: string | null;
  po_number: string | null;
  c_number: string | null;
  serial_number: string | null;
  made_in: string | null;
  other_notes: string | null;
  label_photo_url: string | null;
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-baseline py-2 border-b border-gray-100">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-bold text-gray-900">{value}</span>
    </div>
  );
}

export const PublicTagView = () => {
  const { shortCode, token } = useParams<{ shortCode: string; token: string }>();
  const [searchParams] = useSearchParams();
  const fallbackSku = searchParams.get('sku');

  const [data, setData] = useState<TagData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!shortCode || !token) {
      setError(true);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { data: result, error: rpcError } = await publicSupabase.rpc(
          'get_public_tag' as never,
          { p_short_code: shortCode, p_token: token } as never,
        );
        if (rpcError || !result) {
          setError(true);
        } else {
          setData(result as unknown as TagData);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [shortCode, token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-gray-400 w-8 h-8" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">?</span>
        </div>
        <h1 className="text-xl font-black text-gray-900 mb-2">Tag Not Found</h1>
        <p className="text-sm text-gray-500 max-w-xs">
          {fallbackSku
            ? `SKU: ${fallbackSku} — This tag may have been removed or the link is invalid.`
            : 'This tag does not exist or the link is invalid.'}
        </p>
      </div>
    );
  }

  const parsed = parseBikeName(data.item_name);
  const nameDisplay = parsed.model || data.item_name || data.sku;

  const dims = [
    data.length_in && `${data.length_in}"L`,
    data.width_in && `${data.width_in}"W`,
    data.height_in && `${data.height_in}"H`,
  ].filter(Boolean).join(' × ');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Photo */}
      {data.image_url ? (
        <div className="w-full aspect-square bg-white flex items-center justify-center overflow-hidden">
          <img
            src={data.image_url}
            alt={data.sku}
            className="w-full h-full object-contain p-6"
          />
        </div>
      ) : (
        <div className="w-full aspect-[3/2] bg-gray-100 flex items-center justify-center">
          <span className="text-6xl font-black text-gray-200">{data.sku}</span>
        </div>
      )}

      {/* Content */}
      <div className="p-5 -mt-4 relative">
        <div className="bg-white rounded-2xl shadow-lg p-5">
          {/* Name + Details */}
          <h1 className="text-2xl font-black text-gray-900 leading-tight mb-1">
            {nameDisplay}
          </h1>
          {(parsed.size || parsed.color || parsed.year) && (
            <p className="text-sm text-gray-500 mb-4">
              {[
                parsed.size && `Size ${parsed.size}`,
                parsed.color && parsed.color,
                parsed.year && parsed.year,
              ].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* SKU badge */}
          <div className="inline-block bg-black text-white font-black text-lg px-3 py-1.5 rounded-lg mb-4">
            {data.sku}
          </div>

          {/* Info rows */}
          <div className="mt-2">
            <InfoRow label="UPC" value={data.upc} />
            <InfoRow label="Serial No" value={data.serial_number} />
            <InfoRow label="P/O No" value={data.po_number} />
            <InfoRow label="C/No" value={data.c_number} />
            <InfoRow label="Made In" value={data.made_in} />
            {dims && <InfoRow label="Dimensions" value={dims} />}
            {data.weight_lbs && <InfoRow label="Weight" value={`${data.weight_lbs} lbs`} />}
            <InfoRow label="Notes" value={data.other_notes} />
          </div>

          {/* Label photo */}
          {data.label_photo_url && (
            <div className="mt-4">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Label Photo</p>
              <img
                src={data.label_photo_url}
                alt="Original label"
                className="w-full rounded-xl border border-gray-100"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6 pb-8">
          <p className="text-xs text-gray-300 font-bold uppercase tracking-widest">
            PickD · {data.short_code}
          </p>
        </div>
      </div>
    </div>
  );
};
