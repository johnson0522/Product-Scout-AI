import { describe, expect, it } from 'vitest';
import { FakeRuntime } from '@product-scout/agent-sdk/testing';

import { DeepSeekHarnessRuntimeFactory } from '../src/runtime/DeepSeekHarnessRuntimeFactory';

describe('DeepSeekHarnessRuntimeFactory', () => {
  it('keeps DSH construction behind the runtime factory', async () => {
    const fake = new FakeRuntime();
    const options = {
      processCwd: 'D:/product-scout',
      patchFile: 'D:/product-scout/cordis.patch.yml',
    };
    const factory = new DeepSeekHarnessRuntimeFactory(options, (received) => {
      expect(received).toEqual(options);
      return fake;
    });

    await expect(factory.create()).resolves.toBe(fake);
  });
});
