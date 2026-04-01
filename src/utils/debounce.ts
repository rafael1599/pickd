/**
 * Debounce utility to throttle rapid-fire function calls
 * Useful for optimizing real-time subscriptions and user input handlers
 */

export type DebouncedFunction<T extends (...args: any[]) => any> = ((
  ...args: Parameters<T>
) => void) & { cancel: () => void };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic constraint requires `any` for proper type inference with Parameters<T>
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): DebouncedFunction<T> {
  let timeout: NodeJS.Timeout | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}

/**
 * Throttle utility - ensures function is called at most once per interval
 * First call executes immediately, subsequent calls are delayed
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic constraint requires `any` for proper type inference with Parameters<T>
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
