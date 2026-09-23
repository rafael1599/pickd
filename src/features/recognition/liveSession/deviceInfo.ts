/**
 * deviceInfo.ts
 *
 * Lectura básica del User-Agent para el historial de `/live-check`
 * (`live_check_test_runs`): de qué dispositivo salió cada sesión de test, sin
 * depender de que el operador lo escriba a mano. Pura, sin red ni DOM.
 */

export interface DeviceInfo {
  userAgent: string;
  label: string | null;
  os: string | null;
  isMobile: boolean;
}

const UNKNOWN_LABEL = null;

/**
 * El modelo de un Android viene como el último segmento entre paréntesis
 * ("Linux; Android 14; SM-S928B) AppleWebKit..." -> "SM-S928B"). Se filtran
 * "wv" (WebView) y "Build/..." sueltos, que no son un modelo.
 */
function androidModel(parenContent: string): string | null {
  const segments = parenContent.split(';').map((s) => s.trim());
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (!seg || /^wv$/i.test(seg) || /^Android\b/i.test(seg) || /^Linux$/i.test(seg)) continue;
    return seg.split('Build/')[0].trim() || null;
  }
  return null;
}

/**
 * Parseo determinista del User-Agent: qué dispositivo y sistema operativo,
 * y si es un teléfono/tablet. No intenta cubrir todos los navegadores del
 * mundo — solo lo que realmente aparece en el piso (Android/Chrome, iOS/Safari,
 * escritorio) y se niega en silencio (null) ante lo que no reconoce.
 */
export function parseDeviceInfo(userAgent: string | null | undefined): DeviceInfo {
  const ua = (userAgent ?? '').trim();
  if (!ua) {
    return { userAgent: '', label: UNKNOWN_LABEL, os: null, isMobile: false };
  }

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

  const iOsMatch = ua.match(/(iPhone|iPad|iPod).*?OS (\d+)[_.](\d+)/);
  if (iOsMatch) {
    return {
      userAgent: ua,
      label: iOsMatch[1] === 'iPhone' ? 'iPhone' : 'iPad',
      os: `iOS ${iOsMatch[2]}.${iOsMatch[3]}`,
      isMobile: true,
    };
  }

  const androidMatch = ua.match(/Android ([\d.]+);([^)]*)\)/);
  if (androidMatch) {
    return {
      userAgent: ua,
      label: androidModel(androidMatch[2]),
      os: `Android ${androidMatch[1]}`,
      isMobile: true,
    };
  }

  const desktopOs = ua.includes('Windows')
    ? 'Windows'
    : ua.includes('Mac OS X')
      ? 'macOS'
      : ua.includes('Linux')
        ? 'Linux'
        : null;

  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Firefox/')
      ? 'Firefox'
      : ua.includes('Chrome/')
        ? 'Chrome'
        : ua.includes('Safari/') && !ua.includes('Chrome/')
          ? 'Safari'
          : null;

  return {
    userAgent: ua,
    label: browser ? `Escritorio · ${browser}` : null,
    os: desktopOs,
    isMobile,
  };
}
