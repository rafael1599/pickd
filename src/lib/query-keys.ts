export const inventoryKeys = {
  all: ['inventory'] as const,
  lists: () => [...inventoryKeys.all, 'list'] as const,
  list: (filters: Record<string, string | number | boolean>) =>
    [...inventoryKeys.lists(), { filters }] as const,
  details: () => [...inventoryKeys.all, 'detail'] as const,
  detail: (id: string | number) => [...inventoryKeys.details(), id] as const,
  metadata: (sku: string) => [...inventoryKeys.all, 'metadata', sku] as const,
  locations: () => ['locations'] as const,
};
