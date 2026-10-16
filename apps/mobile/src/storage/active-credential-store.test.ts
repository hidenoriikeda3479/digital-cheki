import { createActiveCredentialStore } from './active-credential-store';

const mockValues = new Map<string, string>();
const mockSave = jest.fn(async (key: string, value: string) => { mockValues.set(key, value); });
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => mockValues.get(key) ?? null,
  setItemAsync: (...args: [string, string]) => mockSave(...args),
  deleteItemAsync: async (key: string) => { mockValues.delete(key); },
}));

beforeEach(() => { mockValues.clear(); mockSave.mockClear(); });

it('keeps the active credential only in SecureStore and separates environments', async () => {
  const development = createActiveCredentialStore({ appEnvironment: 'development', dataSource: 'mock' });
  const staging = createActiveCredentialStore({ appEnvironment: 'staging', dataSource: 'mock' });
  await development.write('opaque-test-credential');
  expect(await createActiveCredentialStore({ appEnvironment: 'development', dataSource: 'mock' }).read()).toBe('opaque-test-credential');
  expect(await staging.read()).toBeNull();
  await development.remove();
  expect(await development.read()).toBeNull();
});

it('reports a native save failure and rejects production mock', async () => {
  const store = createActiveCredentialStore({ appEnvironment: 'development', dataSource: 'mock' });
  mockSave.mockRejectedValueOnce(new Error('secure store unavailable'));
  await expect(store.write('opaque-test-credential')).rejects.toMatchObject({ code: 'Storage' });
  expect(await store.read()).toBeNull();
  expect(() => createActiveCredentialStore({ appEnvironment: 'production', dataSource: 'mock' })).toThrow();
});
