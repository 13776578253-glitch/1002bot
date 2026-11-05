/** Group-routing fallback reasons and user-facing notices; drag and preview fallbacks stay silent. */
import type { GroupFailure } from './route-groups.ts';
import type { GroupRouteCacheStats } from './group-route-cache.ts';

export type RoutingFallbackReason = 'dragging' | 'preview' | 'protected-routes' | 'frozen-groups' | 'aggregated-edges' | 'incomplete' | 'error';

export interface RoutingFallback {
  reason: RoutingFallbackReason;
  message: string;
  silent: boolean;
  failures: readonly GroupFailure[];
}

export interface RoutingStatus {
  requested: boolean;
  engine: 'legacy' | 'group';
  cache?: GroupRouteCacheStats | undefined;
  fallback?: RoutingFallback | undefined;
}

const MESSAGES: Record<RoutingFallbackReason, string> = {
  dragging: '拖动中沿用旧路由，释放后重新组解。',
  preview: '预览中沿用旧路由。',
  'protected-routes': '存在固定/锁定路径，组求解暂不接管。',
  'frozen-groups': '存在冻结组，组求解暂不接管。',
  'aggregated-edges': '存在折叠聚合连线，组求解暂不接管。',
  incomplete: '组求解未完成，已保留旧路由。',
  error: '组求解失败，已保留旧路由。',
};

export function routingFallback(reason: RoutingFallbackReason, failures: readonly GroupFailure[] = []): RoutingFallback {
  const detail = reason === 'incomplete' && failures.length ? `（${failures.length} 条未完成）` : '';
  return {
    reason,
    message: MESSAGES[reason].replace('。', `${detail}。`),
    silent: reason === 'dragging' || reason === 'preview',
    failures,
  };
}
