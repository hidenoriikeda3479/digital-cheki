import { installNetworkGuard } from './network-guard';

describe('business network guard', () => {
  it('blocks fetch, XMLHttpRequest, and WebSocket without calling the original transports', () => {
    const originalFetch = jest.fn();
    const originalXmlHttpRequest = jest.fn();
    const originalWebSocket = jest.fn();
    const target = {
      fetch: originalFetch,
      XMLHttpRequest: originalXmlHttpRequest,
      WebSocket: originalWebSocket,
    };
    const guard = installNetworkGuard(target);

    expect(() => target.fetch('https://example.test/private')).toThrow('fetch');
    expect(() => new target.XMLHttpRequest()).toThrow('XMLHttpRequest');
    expect(() => new target.WebSocket('wss://example.test/private')).toThrow('WebSocket');
    expect(guard.attempts()).toEqual(['fetch', 'XMLHttpRequest', 'WebSocket']);
    expect(originalFetch).not.toHaveBeenCalled();
    expect(originalXmlHttpRequest).not.toHaveBeenCalled();
    expect(originalWebSocket).not.toHaveBeenCalled();
    expect(() => guard.assertNoAttempts()).toThrow('fetch, XMLHttpRequest, WebSocket');
    guard.restore();
  });

  it('retains a caught attempt so the test teardown can still fail without leaking request data', () => {
    const target = { fetch: jest.fn() };
    const guard = installNetworkGuard(target);
    let caught: unknown;

    try {
      target.fetch('https://example.test/private?token=secret');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain('secret');
    expect(() => guard.assertNoAttempts()).toThrow('Forbidden business network attempts: fetch');
    expect(() => guard.assertNoAttempts()).not.toThrow('secret');
    guard.restore();
  });

  it('restores original descriptors and removes temporary transports', () => {
    const originalFetch = jest.fn();
    const target = {};
    Object.defineProperty(target, 'fetch', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: originalFetch,
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, 'fetch');
    const guard = installNetworkGuard(target);

    expect(Object.hasOwn(target, 'XMLHttpRequest')).toBe(true);
    expect(Object.hasOwn(target, 'WebSocket')).toBe(true);
    guard.restore();
    guard.restore();

    expect(Object.getOwnPropertyDescriptor(target, 'fetch')).toEqual(originalDescriptor);
    expect(Object.hasOwn(target, 'XMLHttpRequest')).toBe(false);
    expect(Object.hasOwn(target, 'WebSocket')).toBe(false);
  });

  it('uses a fresh attempt history for the next test installation', () => {
    const target = { fetch: jest.fn() };
    const first = installNetworkGuard(target);
    expect(() => target.fetch()).toThrow();
    first.restore();

    const second = installNetworkGuard(target);
    expect(second.attempts()).toEqual([]);
    expect(() => second.assertNoAttempts()).not.toThrow();
    expect(first.attempts()).toEqual(['fetch']);
    second.restore();
  });

  it('rolls back already installed guards when another transport cannot be replaced', () => {
    const originalFetch = jest.fn();
    const target = { fetch: originalFetch };
    Object.defineProperty(target, 'XMLHttpRequest', {
      configurable: false,
      writable: false,
      value: jest.fn(),
    });

    expect(() => installNetworkGuard(target)).toThrow();
    expect(target.fetch).toBe(originalFetch);
    expect(Object.hasOwn(target, 'WebSocket')).toBe(false);
  });
});
