/** UserInput facade delegates all admission, cancellation and execution to the shared trigger channel. */
import type { InputChannel, InputLimits, InputReceipt, InputSnapshot, OutputEvent, UserInput } from '../protocol/index.ts';
import type { RuntimeTriggerChannel } from './trigger-channel.ts';

export class RuntimeInputChannel implements InputChannel {
  private readonly channel: RuntimeTriggerChannel;
  constructor(channel: RuntimeTriggerChannel) { this.channel = channel; }
  get limits(): InputLimits { return this.channel.limits; }
  async submit(input: UserInput): Promise<InputReceipt> {
    const receipt = await this.channel.submit({ kind: 'user_input', input });
    return receipt.status === 'accepted' ? { status: 'accepted', inputId: receipt.triggerId, queueSequence: receipt.queueSequence }
      : { status: 'rejected', inputId: receipt.triggerId, code: receipt.code, message: receipt.message };
  }
  async cancel(inputId: string) { const receipt = await this.channel.cancel('user_input', inputId); return { inputId, status: receipt.status }; }
  inspect(inputId: string): InputSnapshot | undefined {
    const snapshot = this.channel.inspect('user_input', inputId);
    if (!snapshot) return undefined;
    const { triggerId, triggerKind: _kind, source: _source, ...value } = snapshot;
    return { inputId: triggerId, ...value };
  }
  /** 诊断序号和保留窗口属于共享通道，此门面不另建只含用户输入的事件流。 */
  subscribe(listener: (event: OutputEvent) => void): () => void { return this.channel.subscribe(listener); }
  eventsSince(seq: number) { return this.channel.eventsSince(seq); }
  idle(): Promise<void> { return this.channel.idle(); }
}
