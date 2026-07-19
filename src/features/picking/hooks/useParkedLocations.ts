import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

const DEFAULT_LOCATIONS = ['BAY 1', 'BAY 2', 'SHIPPING AREA', 'ROW 43', 'ROW 42'];

/**
 * Hook that analyzes picking_list_notes to find the most frequently used
 * parked locations. Returns top 6 locations, combining defaults with
 * user-added locations used 3+ times.
 */
export const useParkedLocations = () => {
  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchParkedStats = async () => {
      setIsLoading(true);
      try {
        // Query all notes that start with [Parked]:
        const { data: notes, error } = await supabase
          .from('picking_list_notes')
          .select('message')
          .ilike('message', '[Parked]:%');

        if (error) throw error;

        // Parse locations and count frequency
        const locationCounts = new Map<string, number>();
        const customLocations = new Set<string>();

        notes?.forEach((note) => {
          const match = note.message.match(/\[Parked\]:\s*(.+?)$/);
          if (match) {
            const location = match[1].trim().toUpperCase();
            const count = (locationCounts.get(location) || 0) + 1;
            locationCounts.set(location, count);

            // Track custom locations (not in defaults)
            if (!DEFAULT_LOCATIONS.includes(location)) {
              customLocations.add(location);
            }
          }
        });

        // Filter custom locations that meet 3+ uses threshold
        const qualifiedCustom = Array.from(customLocations).filter(
          (loc) => (locationCounts.get(loc) || 0) >= 3
        );

        // Combine: defaults + custom (sorted by count)
        const allLocations = [
          ...DEFAULT_LOCATIONS,
          ...qualifiedCustom.sort(
            (a, b) => (locationCounts.get(b) || 0) - (locationCounts.get(a) || 0)
          ),
        ];

        // Sort by frequency (defaults maintain order, then custom by count)
        const sorted = allLocations.sort((a, b) => {
          const aCount = locationCounts.get(a) || 0;
          const bCount = locationCounts.get(b) || 0;
          return bCount - aCount;
        });

        // Top 6 locations
        setLocations(sorted.slice(0, 6));
      } catch (err) {
        console.error('Failed to fetch parked locations:', err);
        setLocations(DEFAULT_LOCATIONS);
      } finally {
        setIsLoading(false);
      }
    };

    fetchParkedStats();
  }, []);

  return { locations, isLoading };
};
