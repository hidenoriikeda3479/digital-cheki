import { selectBusinessService } from './select-business-service';

describe('business service selection', () => {
  it('propagates API failure without constructing a mock', async () => {
    const failure = new Error('API unavailable');
    const mock = jest.fn(async () => ({ source: 'mock' }));
    await expect(selectBusinessService(
      { appEnvironment: 'development', dataSource: 'api' },
      { mock, api: async () => { throw failure; } },
    )).rejects.toBe(failure);
    expect(mock).not.toHaveBeenCalled();
  });
  it('does not create or call an API service in mock mode', () => {
    const api = jest.fn(() => ({ source: 'api' }));
    const mock = jest.fn(() => ({ source: 'mock' }));
    expect(selectBusinessService(
      { appEnvironment: 'development', dataSource: 'mock' },
      { api, mock },
    )).toEqual({ source: 'mock' });
    expect(api).not.toHaveBeenCalled();
  });

  it('fails explicitly when API implementation is absent', () => {
    const mock = jest.fn(() => ({ source: 'mock' }));
    expect(() => selectBusinessService(
      { appEnvironment: 'development', dataSource: 'api' },
      { mock },
    )).toThrow('not implemented');
    expect(mock).not.toHaveBeenCalled();
  });

  it('rejects production mock even if given an invalid typed configuration', () => {
    expect(() => selectBusinessService(
      { appEnvironment: 'production', dataSource: 'mock' },
      { mock: () => ({}) },
    )).toThrow('Production cannot use mock');
  });
});
