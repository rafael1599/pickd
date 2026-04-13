import { useMemo } from 'react';

interface ZoneCounts {
  priority: number;
  fedex: number;
  regular: number;
  projects: number;
  completed: number;
  waiting: number;
}

/**
 * Computes responsive grid classes/styles for the Verification Board.
 * Empty zones collapse (0fr) so neighbors expand to fill space.
 * Uses CSS Grid fr units with transitions for smooth animation.
 */
export function useBoardLayout(counts: ZoneCounts) {
  return useMemo(() => {
    const { fedex, regular, projects, completed } = counts;

    // Desktop: 4-column grid fractions
    const desktopCols = [
      fedex > 0 || regular === 0 ? '1fr' : '0fr', // fedex
      regular > 0 || fedex === 0 ? '1fr' : '0fr', // regular
      projects > 0 || completed === 0 ? '1fr' : '0fr', // projects
      completed > 0 || projects === 0 ? '1fr' : '0fr', // completed
    ].join(' ');

    // Mobile: conditional col-span-2 when neighbor is empty
    const mobileFedex = regular === 0 && fedex > 0 ? 'col-span-2' : 'col-span-1';
    const mobileRegular = fedex === 0 && regular > 0 ? 'col-span-2' : 'col-span-1';
    const mobileProjects = completed === 0 && projects > 0 ? 'col-span-2' : 'col-span-1';
    const mobileCompleted = projects === 0 && completed > 0 ? 'col-span-2' : 'col-span-1';

    return {
      desktopGridCols: desktopCols,
      mobileFedex,
      mobileRegular,
      mobileProjects,
      mobileCompleted,
    };
  }, [counts]);
}
