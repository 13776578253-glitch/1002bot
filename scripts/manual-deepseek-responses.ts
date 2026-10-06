import { OpenAIResponsesProvider } from '../src/providers/openai-responses-provider.ts';

const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';

if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');

const provider = new OpenAIResponsesProvider({
  apiKey,
  model,
  baseUrl,
});

const result = await provider.complete(
  {
    sessionId: 'manual-deepseek-acceptance',
    messages: [
      {
        role: 'user',
        content: 'Reply with exactly DEEPSEEK_RESPONSES_MANUAL_OK',
      },
    ],
    tools: [],
  },
  AbortSignal.timeout(30_000),
);

console.log(JSON.stringify({
  endpoint: `${baseUrl}/responses`,
  model,
  finishReason: result.finishReason,
  message: result.message,
  toolCalls: result.toolCalls,
  error: result.error,
}, null, 2));