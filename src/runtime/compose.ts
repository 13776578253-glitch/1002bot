/** Composition binds injected collaborators to Runtime without selecting a production World or transport. */
import type { Agent, InputLimits, Provider, SessionStore, StateStore, World } from '../protocol/index.ts';
import { Runtime, type RuntimeOptions } from './runtime.ts';

export interface ComposeOptions {
  agent: Agent;
  provider: Provider;
  session: SessionStore;
  state: StateStore;
  world: World;
  cleanupDeadlineMs?: number;
  inputLimits?: Partial<InputLimits>;
}

/** 统一透传装配配置；具体实现和凭据由调用方提供。 */
export function composeRuntime(options: ComposeOptions): Runtime {
  const runtimeOptions: RuntimeOptions = options;
  return new Runtime(runtimeOptions);
}
