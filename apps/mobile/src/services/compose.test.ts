import type { AppServices } from './contracts/app-services';

const originalEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
const originalSource = process.env.EXPO_PUBLIC_DATA_SOURCE;
afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
  else process.env.EXPO_PUBLIC_APP_ENV = originalEnvironment;
  if (originalSource === undefined) delete process.env.EXPO_PUBLIC_DATA_SOURCE;
  else process.env.EXPO_PUBLIC_DATA_SOURCE = originalSource;
});

it.each([
  ['production', 'mock', 'Configuration'],
  ['development', 'api', 'NotImplemented'],
  ['invalid', 'mock', 'Configuration'],
])('rejects unsupported configuration during actual app composition', async (environment, source, code) => {
  process.env.EXPO_PUBLIC_APP_ENV = environment;
  process.env.EXPO_PUBLIC_DATA_SOURCE = source;
  let pending: Promise<AppServices> | undefined;
  jest.isolateModules(() => {
    const { getAppServices } = jest.requireActual<typeof import('./compose')>('./compose');
    pending = getAppServices();
  });
  await expect(pending).rejects.toMatchObject({ code });
});
