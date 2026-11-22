import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'product-scout-provider-probe-tools';
export const inject = ['tools'];

// Developer-only smoke profile, never loaded by the production workflow patches.
export function apply(ctx) {
  let receipt;
  ctx.tools.register(defineTool({
    name: 'product_scout_provider_probe',
    timeoutMs: 1000,
    description: 'Compute 19 + 23 and return a random receipt for a connectivity test. Call once.',
    parameters: {
      a: { type: 'integer', enum: [19], required: true },
      b: { type: 'integer', enum: [23], required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          sum: { type: 'integer', required: true },
          receipt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if (receipt !== undefined) throw new Error('Probe tool may only execute once');
      if (args.a !== 19 || args.b !== 23) throw new Error('Invalid probe arguments');
      receipt = randomUUID();
      return { sum: args.a + args.b, receipt };
    },
  }));
  ctx.tools.register(defineTool({
    name: 'product_scout_submit_provider_probe',
    timeoutMs: 1000,
    description: 'Submit the sum and exact receipt returned by product_scout_provider_probe. Call once, then finish.',
    parameters: {
      sum: { type: 'integer', enum: [42], required: true },
      receipt: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { accepted: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if (receipt === undefined || args.receipt !== receipt || args.sum !== 42) {
        throw new Error('Submission must match the real probe result');
      }
      return { accepted: true };
    },
  }));
}
