const guardedTransports = ['fetch', 'XMLHttpRequest', 'WebSocket'] as const;

export type GuardedTransport = (typeof guardedTransports)[number];

export interface NetworkGuard {
  attempts(): readonly GuardedTransport[];
  assertNoAttempts(): void;
  restore(): void;
}

/** Guards JavaScript transports only; native image loaders and notification SDKs need separate checks. */
export function installNetworkGuard(target: object): NetworkGuard {
  const attempts: GuardedTransport[] = [];
  const originals = new Map<GuardedTransport, PropertyDescriptor | undefined>();
  let restored = false;

  const restore = () => {
    if (restored) return;

    for (const [transport, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(target, transport, descriptor);
      } else {
        Reflect.deleteProperty(target, transport);
      }
    }
    restored = true;
  };

  try {
    for (const transport of guardedTransports) {
      const original = Object.getOwnPropertyDescriptor(target, transport);
      const blocked = function (): never {
        attempts.push(transport);
        // Keep request URLs, headers, and payloads out of failure messages.
        throw new Error(`Business network access is forbidden in tests: ${transport}`);
      };

      Object.defineProperty(
        target,
        transport,
        original && !original.configurable
          ? { value: blocked }
          : {
              configurable: true,
              enumerable: original?.enumerable ?? true,
              writable: true,
              value: blocked,
            },
      );
      originals.set(transport, original);
    }
  } catch (error) {
    restore();
    throw error;
  }

  return {
    attempts: () => [...attempts],
    assertNoAttempts: () => {
      if (attempts.length > 0) {
        throw new Error(`Forbidden business network attempts: ${attempts.join(', ')}`);
      }
    },
    restore,
  };
}
