const buildConfig = jest.requireActual<(input: { config: object }) => object>('../../app.config.js');
const originalEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
const originalSource = process.env.EXPO_PUBLIC_DATA_SOURCE;

afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
  else process.env.EXPO_PUBLIC_APP_ENV = originalEnvironment;
  if (originalSource === undefined) delete process.env.EXPO_PUBLIC_DATA_SOURCE;
  else process.env.EXPO_PUBLIC_DATA_SOURCE = originalSource;
});

it('rejects production mock before bundling', () => {
  process.env.EXPO_PUBLIC_APP_ENV = 'production';
  process.env.EXPO_PUBLIC_DATA_SOURCE = 'mock';
  expect(() => buildConfig({ config: {} })).toThrow('production + mock');
});

it('rejects missing configuration and preserves explicit safe configuration', () => {
  delete process.env.EXPO_PUBLIC_APP_ENV;
  process.env.EXPO_PUBLIC_DATA_SOURCE = 'api';
  expect(() => buildConfig({ config: {} })).toThrow();
  process.env.EXPO_PUBLIC_APP_ENV = 'production';
  const config = { name: 'mobile' };
  expect(buildConfig({ config })).toBe(config);
});
