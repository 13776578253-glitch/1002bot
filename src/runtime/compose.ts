/** Composition binds injected collaborators to Runtime without selecting a production World or transport. */
import type { Agent, InputLimits, Provider, SessionStore, StateStore, World, HeartbeatOptions, WorldStream, DeliveryLimits, HistoryLimits, TaskLimits } from '../protocol/index.ts';
import { Runtime, type RuntimeOptions } from './runtime.ts';

export interface ComposeOptions {
  agent: Agent;
  provider: Provider;
  session: SessionStore;
  state: StateStore;
  world: World;
  cleanupDeadlineMs?: number;
  inputLimits?: Partial<InputLimits>;
  eventBytes?: number;
  heartbeat?: HeartbeatOptions;
  worldStreams?: readonly WorldStream[];
  deliveryLimits?: Partial<DeliveryLimits>;
  historyLimits?: Partial<HistoryLimits>;
  includeUnsuccessfulHistory?: boolean;
  taskLimits?: Partial<TaskLimits>;
  taskClock?: () => number;
}

export function composeRuntime(options: ComposeOptions): Runtime {
  const runtimeOptions: RuntimeOptions = options;
  return new Runtime(runtimeOptions);
}
