import { parseRuntimeConfig } from './runtime';

describe('runtime configuration', () => {
  it('accepts an explicit development mock configuration', () => {
    expect(parseRuntimeConfig('development', 'mock')).toEqual({
      appEnvironment: 'development',
      dataSource: 'mock',
    });
  });

  it.each([
    [undefined, 'mock'],
    ['development', undefined],
    ['production', 'mock'],
    ['other', 'api'],
  ])('rejects unsafe or incomplete settings', (environment, source) => {
    expect(() => parseRuntimeConfig(environment, source)).toThrow();
  });
});
