/**
 * Utility to generate a consistent HSL color based on a string (username)
 * This ensures the same user always gets the same color.
 */
export const getUserColor = (username: string | null) => {
  if (!username) return 'hsl(0, 0%, 50%)'; // Default gray for unknown users

  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }

  // We use HSL to ensure colors are vibrant but readable
  // Hue: 0-360
  // Saturation: 60-80% for richness
  // Lightness: 50-70% for readability on dark or light backgrounds
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 75%, 65%)`;
};

/**
 * Returns a variant for background (semi-transparent)
 */
export const getUserBgColor = (username: string | null) => {
  if (!username) return 'hsla(0, 0%, 50%, 0.1)';

  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsla(${hue}, 75%, 65%, 0.1)`;
};
