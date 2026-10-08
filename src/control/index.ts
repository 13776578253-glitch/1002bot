/** Public control exports reuse Runtime composition and the shared frontend capability contract. */
export type { RuntimeControl, InputChannel, UserInput, InputReceipt, CancelReceipt, InputSnapshot, OutputEvent, RunResult, TriggerKind } from '@1002bot/control-api';
export { composeRuntime } from '../runtime/compose.ts';
export type { ComposeOptions } from '../runtime/compose.ts';
