import { describe, it, expect } from 'vitest';

describe('Package Entry Point', () => {
  it('should export Engine as default', async () => {
    // Test CommonJS-style default export
    const Engine = (await import('../src/index')).default;
    expect(Engine).toBeDefined();
    expect(typeof Engine).toBe('function');
    expect(Engine.name).toBe('Engine');
  });

  it('should have create static method', async () => {
    const Engine = (await import('../src/index')).default;
    expect(Engine.create).toBeDefined();
    expect(typeof Engine.create).toBe('function');
  });

  it('should be constructable', async () => {
    const Engine = (await import('../src/index')).default;

    const mockServer = {
      timeout: 45,
      generateId: () => 'test-id',
      debug: () => {},
      trigger: () => {},
      hasConnection: () => false,
      deliver: () => {}
    };

    // Should be able to construct without errors
    const instance = new Engine(mockServer, {});
    expect(instance).toBeDefined();

    // Cleanup
    await instance.disconnect().catch(() => {});
  });
});
