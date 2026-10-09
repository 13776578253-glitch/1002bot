/** Trigger contracts preserve source facts while sharing one Session admission and execution boundary. */
import type { Event, ProviderRequest, AgentContext } from './index.ts';
import type { UserInput, RunResult, OutputEvent, InputSnapshot } from './input.ts';
import { legacyWorldTriggerId, worldTriggerId, type WorldDeliveryIdentity } from './delivery.ts';

import type { TriggerKind } from '@1002bot/control-api';
export type { TriggerKind } from '@1002bot/control-api';
/** World 原始事实保持 Event 形状；未声明 expiresAt 时不按 occurredAt 年龄过期。 */
export type ExternalTrigger =
  | { kind: 'user_input'; input: UserInput }
  | { kind: 'world_event'; event: Event; expiresAt?: string };
/** 身份由 Runtime 代次与序号生成；外部提交入口不接受心跳身份。 */
export interface HeartbeatTrigger { kind: 'heartbeat'; id: string; source: string; occurredAt: string; expiresAt: string }
/** 只有已绑定 World 的投递口能构造带长期身份的内部触发。 */
export type OrderedWorldTrigger = { kind: 'world_event'; event: Event; expiresAt?: string; delivery: WorldDeliveryIdentity };
export type RuntimeTrigger = ExternalTrigger | OrderedWorldTrigger | HeartbeatTrigger;
/** accepted 只确认内存受理；执行等待接收记录追加确认。 */
export type TriggerReceipt =
  | { status: 'accepted'; triggerKind: TriggerKind; triggerId: string; queueSequence: number }
  | { status: 'rejected'; triggerKind: TriggerKind; triggerId: string; code: string; message: string };
export interface TriggerSnapshot {
  delivery?: WorldDeliveryIdentity;
  triggerKind: TriggerKind;
  triggerId: string;
  source: string;
  /** 出队时分配；非 null 不表示模型已调用，执行仍需等待接收追加。 */
  runId: string | null;
  /** FIFO 受理顺序；取消、过期与写入时延可改变终态通知顺序。 */
  queueSequence: number;
  status: InputSnapshot['status'];
  result?: RunResult;
  round?: number;
}
/** The Session channel owns admission and finalization; sources retain upstream buffering. */
export interface TriggerChannel {
  /** 拒绝不占身份或序号；accepted 后保存副本，提交方修改原对象不影响排队事实。 */
  submit(trigger: ExternalTrigger): Promise<TriggerReceipt>;
  /** 排队项尝试提交终态，活动项请求取消；实际结果通过 run_finished 观察。 */
  cancel(kind: TriggerKind, id: string): Promise<{ triggerKind: TriggerKind; triggerId: string; status: 'cancelled' | 'already_finished' | 'not_found' }>;
  /** 快照按共享条数和字节预算淘汰；缺失不表示外部去重身份已释放。 */
  inspect(kind: TriggerKind, id: string): TriggerSnapshot | undefined;
  /** 所有来源共享诊断序号；监听器收到副本，其异常与执行隔离。 */
  subscribe(listener: (event: OutputEvent) => void): () => void;
  /** 读取 seq 之后仍保留的诊断；gap 表示此前位置已超出保留窗口。 */
  eventsSince(seq: number): { gap: boolean; events: readonly OutputEvent[] };
  /** 等待活动处理及排队终态写入，不停止来源或等待 World 清理。 */
  idle(): Promise<void>;
}
/** World 保留订阅前事实；拒绝回执表示 Runtime 未受理，缓冲由 World 管理。 */
export type WorldEventSink = (event: Event, options?: { expiresAt?: string }) => Promise<TriggerReceipt>;
/** tick 源由 Runtime 订阅与退订；迟到回调仍由代次检查拒绝，source 不拥有执行。 */
export interface HeartbeatSource { subscribe(tick: () => void): () => void }
/** 时间单位毫秒；仅提供 RuntimeOptions.heartbeat 才启用心跳。 */
export interface HeartbeatOptions { intervalMs?: number; validityMs?: number; source?: HeartbeatSource }
/**
 * Agent owns the semantic decision to request model work for a heartbeat.
 * 返回 undefined 是 Agent 的无动作决定，不停止 Runtime。
 */
export type HeartbeatRequest = (tick: HeartbeatTrigger, context: AgentContext) => Promise<ProviderRequest | undefined>;
/** eventBytes 按 UTF-8 JSON 计量；默认计时器周期与受理心跳有效期分别定义。 */
export const STANDARD_TRIGGER_LIMITS = Object.freeze({ eventBytes: 64 * 1024, heartbeatIntervalMs: 30_000, heartbeatValidityMs: 5_000 });

export function triggerId(trigger: RuntimeTrigger): string {
  return trigger.kind === 'user_input' ? trigger.input.inputId : trigger.kind === 'world_event'
    ? 'delivery' in trigger ? worldTriggerId(trigger.delivery) : legacyWorldTriggerId(trigger.event.id) : trigger.id;
}
export function triggerSource(trigger: RuntimeTrigger): string {
  return trigger.kind === 'user_input' ? trigger.input.source : trigger.kind === 'world_event' ? trigger.event.source : trigger.source;
}
