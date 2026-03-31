/**
 * DashboardSummaryStore - Centralized state for dashboard data
 * 
 * Polls /api/dashboard-summary endpoint once and shares the result with:
 * - Layout (for unreadCount, token balance and monthly token usage)
 * - Dashboard (for cameras list)
 * 
 * Only polls when authenticated user is present.
 */

import { pollingManager } from './PollingManager';

export interface Camera {
  id: number;
  name: string;
  ip_address?: string;
  thumbnail_url?: string | null;
  last_thumbnail_update?: string | null;
  is_service_running?: number;
  is_online?: number;
  [key: string]: any; // Allow other camera properties
}

export interface TokenBalance {
  user_id: string;
  balance: number;
  input_balance: number;
  output_balance: number;
  total_spent: number;
  created_at?: string;
  updated_at?: string;
}

export interface MonthlyTokenUsageSummary {
  timezone_iana: string;
  local_month: string;
  local_month_start: string;
  next_local_month_start: string;
  start_utc: string;
  end_utc: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  breakdown?: {
    chat: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    agents: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    jobs: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  };
}

export interface DashboardPayload {
  stats?: {
    cameras_total: number;
    cameras_running: number;
    cameras_online: number;
    agents_enabled_total: number;
    detections_24h_total: number;
    unread_alerts: number;
    pending_commands: number;
    last_event_id: number;
    last_detection_at: string | null;
    last_job_fire_at: string | null;
    jobs_total: number;
    jobs_running: number;
    steps_running: number;
  };
  perCamera?: Record<number, {
    enabled_agents_count: number;
    enabled_agents_types: string[];
    last_started_at: string | null;
    last_error_at: string | null;
    detections_24h: number;
    last_detected_at: string | null;
  }>;
  jobs?: {
    recentFires: any[];
    recentCommands: any[];
    runningJobs: Array<{
      job_id: number;
      job_name: string;
      status: string;
      started_at_utc?: string;
      updated_at?: string;
    }>;
    stepLogs?: Record<number, Array<{
      id: number;
      event_type: string;
      message: string;
      created_at: string;
      details?: any;
    }>>;
    runningJobSteps?: Record<number, Array<{
      id: number;
      step_order: number;
      name: string;
      status: "completed" | "running" | "pending" | "skipped";
    }>>;
    scheduledJobs?: Array<{
      job_id: number;
      job_name: string;
      next_run_local_date: string;
      next_run_local_time: string;
      step_count: number;
      camera_count: number;
    }>;
  };
  activity?: {
    recentEvents: any[];
    recentDetections: any[];
    recentAlerts?: any[];
  };
  captureThreads?: Array<{
    client_id: string;
    exe_id: string;
    camera_id: number;
    camera_name: string | null;
    thread_name: string;
    cpu_percent: number;
    capture_mem_estimated_bytes: number;
    process_working_set_bytes: number;
    process_private_bytes: number;
    queue_depth: number;
    sampled_at: string;
    updated_at: string;
  }>;
  runningJobTargets?: Record<number, Array<{
    step_id: number;
    step_order: number;
    step_name: string;
    cameras: Array<{
      camera_id: number;
      camera_name: string | null;
    }>;
  }>>;
  etagHints?: {
    camerasUpdatedAtMax: number;
    camerasCount: number;
    camerasDigest: string;
    lastEventId: number;
    lastDetectionId: number;
    lastJobFireId: number;
    pendingCommandsCount: number;
    unreadCount: number;
    inputBalance: number;
    outputBalance: number;
    monthlyUsageLocalMonth: string;
    monthlyUsageInputTokens: number;
    monthlyUsageOutputTokens: number;
    jobsUpdatedAtMax: number;
    captureMetricsUpdatedAtMax: number;
  };
}

export interface DashboardSummary {
  cameras: Camera[];
  unreadCount: number;
  tokenBalance: TokenBalance | null;
  tokenUsageMonth: MonthlyTokenUsageSummary | null;
  lastUpdatedAt: string | null;
  dashboard?: DashboardPayload;
}

type Listener = (summary: DashboardSummary) => void;

class DashboardSummaryStore {
  private summary: DashboardSummary = {
    cameras: [],
    unreadCount: 0,
    tokenBalance: null,
    tokenUsageMonth: null,
    lastUpdatedAt: null,
  };

  private listeners: Set<Listener> = new Set();
  private isPolling: boolean = false;

  /**
   * Subscribe to dashboard summary updates
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);

    // Immediately invoke with current state
    listener(this.summary);

    // Start polling if not already started
    if (!this.isPolling) {
      this.startPolling();
    }

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);

      // Stop polling if no more listeners
      if (this.listeners.size === 0) {
        this.stopPolling();
      }
    };
  }

  /**
   * Get current summary (synchronous)
   */
  getCurrent(): DashboardSummary {
    return this.summary;
  }

  /**
   * Force refresh (trigger a poll immediately)
   */
  refresh(): void {
    if (this.isPolling) {
      // Re-register with 0 delay to trigger immediate poll
      this.startPolling();
    }
  }

  /**
   * Patch a single camera locally so UI updates immediately (no wait for polling)
   */
  patchCameraLocal(cameraId: number, patch: Partial<Camera>): void {
    const idx = this.summary.cameras.findIndex(c => c.id === cameraId);
    if (idx === -1) return;

    const next = [...this.summary.cameras];
    next[idx] = { ...next[idx], ...patch };

    this.summary = {
      ...this.summary,
      cameras: next,
      lastUpdatedAt: new Date().toISOString(),
    };

    this.listeners.forEach(listener => listener(this.summary));
  }

  /**
   * Remove a single camera locally so all dashboard consumers stay in sync.
   */
  removeCameraLocal(cameraId: number): void {
    const next = this.summary.cameras.filter((camera) => camera.id !== cameraId);
    if (next.length === this.summary.cameras.length) return;

    this.summary = {
      ...this.summary,
      cameras: next,
      lastUpdatedAt: new Date().toISOString(),
      dashboard: this.summary.dashboard
        ? {
            ...this.summary.dashboard,
            stats: this.summary.dashboard.stats
              ? {
                  ...this.summary.dashboard.stats,
                  cameras_total: Math.max(0, next.length),
                  cameras_running: next.filter((camera) => camera.is_service_running === 1).length,
                  cameras_online: next.filter((camera) => camera.is_service_running === 1).length,
                }
              : this.summary.dashboard.stats,
            perCamera: Object.fromEntries(
              Object.entries(this.summary.dashboard.perCamera || {}).filter(
                ([candidateCameraId]) => Number(candidateCameraId) !== cameraId
              )
            ),
          }
        : this.summary.dashboard,
    };

    this.listeners.forEach(listener => listener(this.summary));
  }

  /**
   * Start polling /api/dashboard-summary
   */
  private startPolling(): void {
    this.isPolling = true;

    pollingManager.register('dashboard-summary', {
      url: '/api/dashboard',
      interval: 30000, // 30 seconds
      onData: (data) => {
        // Handle both old /api/dashboard format and new /api/dashboard-summary format
        const cameras = data.cameras || [];
        const unreadCount = data.unreadCount ?? 0;
        const tokenBalance = data.tokenBalance || null;
        const tokenUsageMonth = data.tokenUsageMonth || null;
        const dashboard = data.dashboard || null;

        // Use etagHints for efficient change detection if available
        const hasChanges = (() => {
          if (dashboard?.etagHints && this.summary.dashboard?.etagHints) {
            const oldHints = this.summary.dashboard.etagHints;
            const newHints = dashboard.etagHints;
            return (
              oldHints.camerasCount !== newHints.camerasCount ||
              oldHints.camerasDigest !== newHints.camerasDigest ||
              oldHints.lastEventId !== newHints.lastEventId ||
              oldHints.lastDetectionId !== newHints.lastDetectionId ||
              oldHints.lastJobFireId !== newHints.lastJobFireId ||
              oldHints.pendingCommandsCount !== newHints.pendingCommandsCount ||
              oldHints.camerasUpdatedAtMax !== newHints.camerasUpdatedAtMax ||
              oldHints.unreadCount !== newHints.unreadCount ||
              oldHints.inputBalance !== newHints.inputBalance ||
              oldHints.outputBalance !== newHints.outputBalance ||
              oldHints.monthlyUsageLocalMonth !== newHints.monthlyUsageLocalMonth ||
              oldHints.monthlyUsageInputTokens !== newHints.monthlyUsageInputTokens ||
              oldHints.monthlyUsageOutputTokens !== newHints.monthlyUsageOutputTokens ||
              oldHints.jobsUpdatedAtMax !== newHints.jobsUpdatedAtMax ||
              oldHints.captureMetricsUpdatedAtMax !== newHints.captureMetricsUpdatedAtMax
            );
          }
          
          // Fallback to shallow comparison
          return (
            JSON.stringify(cameras) !== JSON.stringify(this.summary.cameras) ||
            unreadCount !== this.summary.unreadCount ||
            JSON.stringify(tokenBalance) !== JSON.stringify(this.summary.tokenBalance) ||
            JSON.stringify(tokenUsageMonth) !== JSON.stringify(this.summary.tokenUsageMonth) ||
            JSON.stringify(dashboard) !== JSON.stringify(this.summary.dashboard)
          );
        })();

        if (hasChanges) {
          this.summary = {
            cameras,
            unreadCount,
            tokenBalance,
            tokenUsageMonth,
            dashboard,
            lastUpdatedAt: new Date().toISOString(),
          };

          // Notify all listeners
          this.listeners.forEach(listener => listener(this.summary));
        }
      },
      onError: (error) => {
        console.error('[DashboardSummaryStore] Polling error:', error);
        // Don't update state on error - keep showing last known good state
      },
    });
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    this.isPolling = false;
    pollingManager.unregister('dashboard-summary');
  }
}

// Global singleton
export const dashboardSummaryStore = new DashboardSummaryStore();

/**
 * React hook to use dashboard summary
 */
import { useState, useEffect } from 'react';

export function useDashboardSummary(): DashboardSummary & { refresh: () => void } {
  const [summary, setSummary] = useState<DashboardSummary>(
    dashboardSummaryStore.getCurrent()
  );

  useEffect(() => {
    const unsubscribe = dashboardSummaryStore.subscribe(setSummary);
    return unsubscribe;
  }, []);

  return {
    ...summary,
    refresh: () => dashboardSummaryStore.refresh(),
  };
}
