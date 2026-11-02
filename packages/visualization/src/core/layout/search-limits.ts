/** Deterministic search bounds for A* expansion and stitch repair loops. */
export interface SearchLimits {
  maxExpansions?: number;
  maxStitchIterations?: number;
  deadlineMs?: number;
}

export interface SearchBudget {
  readonly expired: boolean;
  readonly expansions: number;
  readonly remainingMs: number;
  consume(count?: number): boolean;
}

export const DEFAULT_SEARCH_LIMITS = {
  maxExpansions: 4000,
  maxStitchIterations: 3,
  deadlineMs: 32,
} as const;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export interface SolveBudgetLimits {
  aStarMs?: number;
  aStarExpansions?: number;
  edgeMs?: number;
  groupMs?: number;
}

export const DEFAULT_SOLVE_LIMITS = {
  aStarMs: 12,
  aStarExpansions: 4000,
  edgeMs: 24,
  groupMs: 80,
} as const;

export interface EdgeBudget {
  readonly expired: boolean;
  readonly remainingMs: number;
  astarLimits(): SearchLimits;
}

export interface SolveBudget {
  readonly expired: boolean;
  readonly remainingMs: number;
  forEdge(): EdgeBudget;
}

export function createSolveBudget(limits: SolveBudgetLimits = {}): SolveBudget {
  const aStarMs = limits.aStarMs ?? DEFAULT_SOLVE_LIMITS.aStarMs;
  const aStarExpansions = limits.aStarExpansions ?? DEFAULT_SOLVE_LIMITS.aStarExpansions;
  const edgeMs = limits.edgeMs ?? DEFAULT_SOLVE_LIMITS.edgeMs;
  const groupMs = limits.groupMs ?? DEFAULT_SOLVE_LIMITS.groupMs;
  const started = now();
  const groupEnd = started + groupMs;
  const remaining = (end: number): number => Math.max(0, end - now());
  return {
    get expired() { return remaining(groupEnd) <= 0; },
    get remainingMs() { return remaining(groupEnd); },
    forEdge() {
      const end = Math.min(groupEnd, now() + edgeMs);
      return {
        get expired() { return remaining(end) <= 0 || remaining(groupEnd) <= 0; },
        get remainingMs() { return Math.min(remaining(end), remaining(groupEnd)); },
        astarLimits() {
          if (remaining(end) <= 0 || remaining(groupEnd) <= 0) return { maxExpansions: 0, deadlineMs: 0 };
          return { maxExpansions: aStarExpansions, deadlineMs: Math.max(1, Math.min(aStarMs, remaining(end))) };
        },
      };
    },
  };
}

export function createSearchBudget(limits: SearchLimits = {}): SearchBudget {
  const maxExpansions = limits.maxExpansions ?? DEFAULT_SEARCH_LIMITS.maxExpansions;
  const deadlineMs = limits.deadlineMs ?? DEFAULT_SEARCH_LIMITS.deadlineMs;
  const started = now();
  let expansions = 0;
  const expired = (): boolean => expansions >= maxExpansions || (deadlineMs > 0 && now() - started >= deadlineMs);
  return {
    get expired() { return expired(); },
    get expansions() { return expansions; },
    get remainingMs() { return deadlineMs <= 0 ? Infinity : Math.max(0, deadlineMs - (now() - started)); },
    consume(count = 1) {
      expansions += count;
      return !expired();
    },
  };
}
