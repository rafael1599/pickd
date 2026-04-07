export interface SlottingConfig {
  MIN_PICKS_FOR_VELOCITY: number;
  SHIPPING_AREAS: {
    LUDLOW: string;
    ATS: string;
  };
  PRIORITY_WEIGHTS: {
    velocity: number;
    proximity: number;
    consolidation: number;
  };
  ZONE_THRESHOLDS: {
    HOT: number;
    WARM: number;
    COLD: number;
  };
  VELOCITY_CLASSIFICATIONS: {
    A: number;
    B: number;
    C: number;
  };
  OPTIMIZATION_SCHEDULE: {
    enabled: boolean;
    dayOfWeek: number;
    minSuggestionsToReport: number;
  };
  FEATURES: {
    VELOCITY_BASED_SLOTTING: boolean;
    AUTO_ZONE_INFERENCE: boolean;
    GRADUATION_SUGGESTIONS: boolean;
    SPLIT_SUGGESTIONS: boolean;
    WEEKLY_REPORTS: boolean;
  };
}

export const SLOTTING_CONFIG: SlottingConfig = {
  // Thresholds
  // Minimum picks in window to consider a product "Velocity-Based"
  MIN_PICKS_FOR_VELOCITY: 100,

  // Shipping areas per warehouse (for proximity calculation)
  SHIPPING_AREAS: {
    LUDLOW: 'Row 1',
    ATS: 'A1',
  },

  // Weights for Hybrid Scoring (Must sum to 1.0)
  PRIORITY_WEIGHTS: {
    velocity: 0.5, // 50%
    proximity: 0.3, // 30%
    consolidation: 0.2, // 20%
  },

  // Zone Capacity Thresholds
  ZONE_THRESHOLDS: {
    HOT: 0.9,
    WARM: 0.95,
    COLD: 1.0,
  },

  // Classification Percentiles (ABC Analysis)
  VELOCITY_CLASSIFICATIONS: {
    A: 0.2,
    B: 0.5,
    C: 1.0,
  },

  // Optimization Report Schedule
  OPTIMIZATION_SCHEDULE: {
    enabled: true,
    dayOfWeek: 1, // Monday
    minSuggestionsToReport: 3,
  },

  // Feature Flags
  FEATURES: {
    VELOCITY_BASED_SLOTTING: true,
    AUTO_ZONE_INFERENCE: true,
    GRADUATION_SUGGESTIONS: true,
    SPLIT_SUGGESTIONS: true,
    WEEKLY_REPORTS: true,
  },
};

/**
 * Fallback: Infer zone by location name/order when not explicitly set
 */
export const inferZoneByAlphabetical = (_allLocations: string[], _targetLocation: string): string => {
  // Temporarily disabled: Route all to UNASSIGNED until full logic is complete
  return 'UNASSIGNED';
};
