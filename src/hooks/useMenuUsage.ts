import { useState } from 'react';
import Box from 'lucide-react/dist/esm/icons/box';
import Map from 'lucide-react/dist/esm/icons/map';
import Scan from 'lucide-react/dist/esm/icons/scan';
import Printer from 'lucide-react/dist/esm/icons/printer';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import Boxes from 'lucide-react/dist/esm/icons/boxes';
import Container from 'lucide-react/dist/esm/icons/container';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart';
import PackageOpen from 'lucide-react/dist/esm/icons/package-open';
import Kanban from 'lucide-react/dist/esm/icons/kanban';
import History from 'lucide-react/dist/esm/icons/history';
import FileSearch from 'lucide-react/dist/esm/icons/file-search';

export interface MenuItemSpec {
  id: string;
  label: string;
  path?: string;
  action?: 'picking';
  icon: any;
  colorBg: string;
  colorText: string;
  defaultRank: number;
}

export const ALL_MENU_ITEMS: MenuItemSpec[] = [
  {
    id: 'stock',
    label: 'Stock',
    path: '/',
    icon: Box,
    colorBg: 'bg-emerald-500/10',
    colorText: 'text-emerald-500',
    defaultRank: 1,
  },
  {
    id: 'map',
    label: 'Map',
    path: '/warehouse-map',
    icon: Map,
    colorBg: 'bg-blue-500/10',
    colorText: 'text-blue-500',
    defaultRank: 2,
  },
  {
    id: 'picking',
    label: 'Picking',
    action: 'picking',
    icon: Scan,
    colorBg: 'bg-sky-500/10',
    colorText: 'text-sky-500',
    defaultRank: 3,
  },
  {
    id: 'ship',
    label: 'Ship',
    path: '/ship',
    icon: Printer,
    colorBg: 'bg-indigo-500/10',
    colorText: 'text-indigo-500',
    defaultRank: 4,
  },
  {
    id: 'count',
    label: 'Count',
    path: '/stock-count',
    icon: ClipboardList,
    colorBg: 'bg-amber-500/10',
    colorText: 'text-amber-500',
    defaultRank: 5,
  },
  {
    id: 'slotting',
    label: 'Slotting',
    path: '/consolidation',
    icon: Boxes,
    colorBg: 'bg-orange-500/10',
    colorText: 'text-orange-500',
    defaultRank: 6,
  },
  {
    id: 'container',
    label: 'Container',
    path: '/registrar-container',
    icon: Container,
    colorBg: 'bg-purple-500/10',
    colorText: 'text-purple-500',
    defaultRank: 7,
  },
  {
    id: 'shopping',
    label: 'Shopping',
    path: '/shopping-list',
    icon: ShoppingCart,
    colorBg: 'bg-pink-500/10',
    colorText: 'text-pink-500',
    defaultRank: 8,
  },
  {
    id: 'returns',
    label: 'Returns',
    path: '/fedex-returns',
    icon: PackageOpen,
    colorBg: 'bg-rose-500/10',
    colorText: 'text-rose-500',
    defaultRank: 9,
  },
  {
    id: 'projects',
    label: 'Projects',
    path: '/projects',
    icon: Kanban,
    colorBg: 'bg-violet-500/10',
    colorText: 'text-violet-500',
    defaultRank: 10,
  },
  {
    id: 'history',
    label: 'History',
    path: '/history',
    icon: History,
    colorBg: 'bg-teal-500/10',
    colorText: 'text-teal-500',
    defaultRank: 11,
  },
  {
    id: 'reports',
    label: 'Reports',
    path: '/activity-reports',
    icon: FileSearch,
    colorBg: 'bg-cyan-500/10',
    colorText: 'text-cyan-500',
    defaultRank: 12,
  },
];

const STORAGE_KEY = 'pickd_menu_usage_counts_v1';

export function useMenuUsage() {
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const recordUsage = (id: string) => {
    setCounts((prev) => {
      const next = { ...prev, [id]: (prev[id] ?? 0) + 1 };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore quota errors
      }
      return next;
    });
  };

  const resetUsage = () => {
    setCounts({});
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  };

  // Sort items by count desc, then defaultRank asc
  const mostUsedItems = [...ALL_MENU_ITEMS]
    .sort((a, b) => {
      const countA = counts[a.id] ?? 0;
      const countB = counts[b.id] ?? 0;
      if (countA !== countB) return countB - countA;
      return a.defaultRank - b.defaultRank;
    })
    .slice(0, 6);

  return {
    mostUsedItems,
    recordUsage,
    resetUsage,
    counts,
  };
}
