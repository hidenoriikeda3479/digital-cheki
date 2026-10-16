import { createTokenStore } from './token-store';
import type { StorageNamespace } from './namespace';

const mockValues = new Map<string, string>();
const mockSet = jest.fn(async (key: string, token: string) => { mockValues.set(key, token); });
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => mockValues.get(key) ?? null,
  setItemAsync: (...args: [string, string]) => mockSet(...args),
  deleteItemAsync: async (key: string) => { mockValues.delete(key); },
}));

const group: StorageNamespace = {
  environment: 'development', source: 'mock', owner: { kind: 'group', id: 'A' },
};
beforeEach(() => { mockValues.clear(); mockSet.mockClear(); });

describe('token storage adapter', () => {
  it('keeps roles, sources and owners separate across new adapter instances', async () => {
    const store = createTokenStore();
    const fan: StorageNamespace = { ...group, owner: { kind: 'fan', id: 'A' } };
    const production: StorageNamespace = { ...group, environment: 'production', source: 'api' };
    await store.write(group, 'fake-group-token');
    await store.write(fan, 'fake-fan-token');
    await store.write(production, 'test-only-production-namespace-token');
    const restarted = createTokenStore();
    expect(await restarted.read(group)).toBe('fake-group-token');
    expect(await restarted.read(fan)).toBe('fake-fan-token');
    expect(await restarted.read({ ...group, owner: { kind: 'group', id: 'B' } })).toBeNull();
    await restarted.remove(group);
    expect(await restarted.read(group)).toBeNull();
    expect(await restarted.read(fan)).toBe('fake-fan-token');
    expect(await restarted.read(production)).toBe('test-only-production-namespace-token');
    mockValues.forEach((_value, key) => expect(key).toMatch(/^[A-Za-z0-9._-]+$/));
  });

  it('does not report success when native secure storage fails', async () => {
    mockSet.mockRejectedValueOnce(new Error('native save failed'));
    await expect(createTokenStore().write(group, 'fake-token')).rejects.toMatchObject({ code: 'Storage' });
    expect(await createTokenStore().read(group)).toBeNull();
  });

  it('refuses empty tokens and virtual-server credentials', async () => {
    await expect(createTokenStore().write(group, '')).rejects.toMatchObject({ code: 'Validation' });
    await expect(createTokenStore().write({ ...group, owner: { kind: 'mock-server', id: 'test' } }, 'x'))
      .rejects.toMatchObject({ code: 'Validation' });
    expect(mockSet).not.toHaveBeenCalled();
  });
});
