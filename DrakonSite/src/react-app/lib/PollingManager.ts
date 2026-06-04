/**
 * Global PollingManager - Centralizes all periodic HTTP requests with:
 * - Request deduplication (only one in-flight request per resource)
 * - Exponential backoff on 429 errors
 * - Tab visibility awareness (pause when hidden)
 * - Automatic interval management
 */

type PollingConfig = {
  url: string;
  interval: number; // milliseconds
  onData: (data: any) => void;
  onError?: (error: Error) => void;
  fetchOptions?: RequestInit;
  jitterMaxMs?: number;
  pauseWhenHidden?: boolean;
};

type PollerState = {
  config: PollingConfig;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  currentInterval: number; // current interval with backoff applied
  backoffLevel: number; // 0 = normal, increases on 429
  lastRequestTime: number;
  etag: string | null;
};

class PollingManager {
  private pollers: Map<string, PollerState> = new Map();
  private isPaused: boolean = false;
  private readonly MAX_BACKOFF_LEVEL = 4; // Max: 15s -> 30s -> 60s -> 120s -> 240s
  private readonly JITTER_MAX = 5000; // Max 5s random jitter

  constructor() {
    // Listen for visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private handleVisibilityChange = () => {
    const isHidden = document.hidden;
    
    if (isHidden && !this.isPaused) {
      console.log('[PollingManager] Tab hidden - pausing all pollers');
      this.pauseAll();
    } else if (!isHidden && this.isPaused) {
      console.log('[PollingManager] Tab visible - resuming all pollers');
      this.resumeAll();
    }
  };

  /**
   * Register a new poller or update existing one
   */
  register(key: string, config: PollingConfig): void {
    // Stop existing poller if any
    this.unregister(key);

    const state: PollerState = {
      config,
      timer: null,
      inFlight: false,
      currentInterval: config.interval,
      backoffLevel: 0,
      lastRequestTime: 0,
      etag: null,
    };

    this.pollers.set(key, state);

    // Start polling immediately if tab is visible or this poller is allowed
    // to keep critical app state fresh while WebKit reports the page hidden.
    if (!this.isPaused || config.pauseWhenHidden === false) {
      this.scheduleNext(key, 0); // Start immediately
    }
  }

  /**
   * Unregister a poller
   */
  unregister(key: string): void {
    const state = this.pollers.get(key);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.pollers.delete(key);
  }

  /**
   * Schedule the next poll for a specific poller
   */
  private scheduleNext(key: string, delay: number): void {
    const state = this.pollers.get(key);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      this.executePoll(key);
    }, delay);
  }

  /**
   * Execute a single poll
   */
  private async executePoll(key: string): Promise<void> {
    const state = this.pollers.get(key);
    if (!state || state.inFlight) {
      // Skip if already in flight (deduplication)
      return;
    }

    state.inFlight = true;
    state.lastRequestTime = Date.now();

    try {
      const headers = new Headers(state.config.fetchOptions?.headers);
      if (state.etag) {
        headers.set("If-None-Match", state.etag);
      }

      const response = await fetch(state.config.url, {
        credentials: 'include',
        ...state.config.fetchOptions,
        headers,
      });

      const responseEtag = response.headers.get("etag");
      if (responseEtag || response.status === 304) {
        state.etag = responseEtag || state.etag;
      } else if (response.ok) {
        state.etag = null;
      }

      if (response.status === 429) {
        // Rate limited - apply backoff
        this.applyBackoff(key);
        console.warn(`[PollingManager] 429 on ${key}, backing off to ${state.currentInterval}ms`);
      } else if (response.status === 304) {
        // Not modified - success, reduce backoff
        this.reduceBackoff(key);
        // Don't call onData for 304 - no new data
      } else if (response.ok) {
        // Success - reduce backoff
        this.reduceBackoff(key);
        
        const data = await response.json();
        state.config.onData(data);
      } else {
        // Other error
        const error = new Error(`HTTP ${response.status}`);
        if (state.config.onError) {
          state.config.onError(error);
        }
      }
    } catch (error) {
      // Network error
      if (state.config.onError) {
        state.config.onError(error as Error);
      }
    } finally {
      state.inFlight = false;

      // Schedule next poll with current interval + jitter
      const jitterMaxMs = Math.max(0, state.config.jitterMaxMs ?? this.JITTER_MAX);
      const jitter = Math.random() * jitterMaxMs;
      const nextDelay = state.currentInterval + jitter;
      
      this.scheduleNext(key, nextDelay);
    }
  }

  /**
   * Apply exponential backoff on 429
   */
  private applyBackoff(key: string): void {
    const state = this.pollers.get(key);
    if (!state) return;

    if (state.backoffLevel < this.MAX_BACKOFF_LEVEL) {
      state.backoffLevel++;
    }

    // Exponential: base * 2^level
    state.currentInterval = state.config.interval * Math.pow(2, state.backoffLevel);
  }

  /**
   * Gradually reduce backoff on success
   */
  private reduceBackoff(key: string): void {
    const state = this.pollers.get(key);
    if (!state) return;

    if (state.backoffLevel > 0) {
      state.backoffLevel = Math.max(0, state.backoffLevel - 1);
      state.currentInterval = state.config.interval * Math.pow(2, state.backoffLevel);
      
      if (state.backoffLevel === 0) {
        console.log(`[PollingManager] ${key} recovered from backoff`);
      }
    }
  }

  /**
   * Pause all pollers (when tab hidden)
   */
  private pauseAll(): void {
    this.isPaused = true;
    
    this.pollers.forEach((state) => {
      if (state.config.pauseWhenHidden === false) {
        return;
      }
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    });
  }

  /**
   * Resume all pollers (when tab visible)
   */
  private resumeAll(): void {
    this.isPaused = false;
    
    this.pollers.forEach((state, key) => {
      if (state.config.pauseWhenHidden === false) {
        return;
      }
      // Resume with current backoff state (don't burst)
      const timeSinceLastRequest = Date.now() - state.lastRequestTime;
      const delay = Math.max(0, state.currentInterval - timeSinceLastRequest);
      
      this.scheduleNext(key, delay);
    });
  }

  /**
   * Cleanup - remove all pollers and listeners
   */
  destroy(): void {
    this.pollers.forEach((state) => {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    });
    this.pollers.clear();

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }
}

// Global singleton instance
export const pollingManager = new PollingManager();
