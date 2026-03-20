/**
 * useDashboardSummary - React hook for accessing dashboard data
 * 
 * Subscribes to the DashboardSummaryStore and re-renders on updates.
 * Automatically starts/stops polling based on component mount/unmount.
 */

import { useState, useEffect } from 'react';
import { dashboardSummaryStore, DashboardSummary } from '@/react-app/lib/DashboardSummaryStore';

export function useDashboardSummary() {
  const [summary, setSummary] = useState<DashboardSummary>(
    dashboardSummaryStore.getCurrent()
  );

  useEffect(() => {
    // Subscribe to store updates
    const unsubscribe = dashboardSummaryStore.subscribe((newSummary) => {
      setSummary(newSummary);
    });

    return unsubscribe;
  }, []);

  return {
    cameras: summary.cameras,
    dashboard: summary.dashboard,
    unreadCount: summary.unreadCount,
    tokenBalance: summary.tokenBalance,
    lastUpdatedAt: summary.lastUpdatedAt,
    refresh: () => dashboardSummaryStore.refresh(),
  };
}
