import { describe, expect, it } from 'vitest';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { apply } from '../src/dsh/provider-probe-tools.mjs';

interface ProbeTool {
  readonly name: string;
  readonly parameters: Parameters<typeof validateJsonSchemaValue>[0];
  readonly execute: (args: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
}

function tools(): { readonly probe: ProbeTool; readonly submit: ProbeTool } {
  const registered: ProbeTool[] = [];
  apply({ tools: { register(tool: ProbeTool) { registered.push(tool); } } });
  const probe = registered.find((tool) => tool.name === 'product_scout_provider_probe');
  const submit = registered.find((tool) => tool.name === 'product_scout_submit_provider_probe');
  if (probe === undefined || submit === undefined) throw new Error('Probe tools were not registered');
  return { probe, submit };
}

describe('DSH provider probe tools', () => {
  it('validates fixed arguments and requires the actual tool result receipt before accepting submission', async () => {
    const { probe, submit } = tools();
    expect(validateJsonSchemaValue(probe.parameters, { a: 19, b: 23 })).toEqual([]);
    expect(validateJsonSchemaValue(probe.parameters, { a: 18, b: 23 })).not.toEqual([]);
    expect(validateJsonSchemaValue(probe.parameters, { a: '19', b: 23 })).not.toEqual([]);
    await expect(submit.execute({ sum: 42, receipt: 'guessed' })).rejects.toThrow('real probe result');
    const result = await probe.execute({ a: 19, b: 23 });
    expect(result.sum).toBe(42);
    expect(typeof result.receipt).toBe('string');
    await expect(submit.execute({ sum: 42, receipt: 'wrong' })).rejects.toThrow('real probe result');
    await expect(submit.execute(result)).resolves.toEqual({ accepted: true });
    await expect(probe.execute({ a: 19, b: 23 })).rejects.toThrow('only execute once');
  });

  it('isolates receipts between plugin instances', async () => {
    const first = tools();
    const second = tools();
    const result = await first.probe.execute({ a: 19, b: 23 });
    await expect(second.submit.execute(result)).rejects.toThrow('real probe result');
  });
});
