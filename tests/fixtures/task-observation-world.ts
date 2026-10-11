/** A file-backed fixture shares entity/version observations between perception and explicit tools. */
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JsonObject, ToolCall, ToolExecutionContext, ToolOutcome, WorldStream } from '../../src/protocol/index.ts';
import { OrderedFixtureWorld } from './ordered-world.ts';

export class TaskObservationWorld extends OrderedFixtureWorld {
  private readonly observationsPath: string;
  constructor(directory: string, stream: WorldStream, sessionId: string) {
    super(join(directory, 'producer.jsonl'), stream, sessionId);
    this.observationsPath = join(directory, 'observations.jsonl');
  }
  override tools() { return [...super.tools(), { name: 'fixture.observe', description: 'Read the file-backed entity observation and its declared version domain.', inputSchema: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } } }]; }
  async observation(key: string): Promise<JsonObject> {
    let text: string;
    try { text = await readFile(this.observationsPath, 'utf8'); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { entity: key, versionDomain: 'fixture-file', version: 0, value: null }; throw error; }
    return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as JsonObject).filter(item => item.entity === key).at(-1)
      ?? { entity: key, versionDomain: 'fixture-file', version: 0, value: null };
  }
  override async executeTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
    const args = call.arguments as JsonObject;
    if (call.toolName === 'fixture.observe') {
      if (typeof args.key !== 'string') return { callId: call.callId, toolName: call.toolName, status: 'failed', error: { code: 'invalid_key', message: 'key is required' } };
      return { callId: call.callId, toolName: call.toolName, status: 'succeeded', output: await this.observation(args.key) };
    }
    const result = await super.executeTool(call, context);
    if (call.toolName !== 'fixture.set' || result.status !== 'succeeded') return result;
    const previous = await this.observation(args.key as string);
    const observation = { entity: args.key!, versionDomain: 'fixture-file', version: (previous.version as number) + 1, value: args.value!, cause: { callId: call.callId, generation: context.generation } };
    await appendFile(this.observationsPath, `${JSON.stringify(observation)}\n`);
    return { ...result, output: observation };
  }
}
