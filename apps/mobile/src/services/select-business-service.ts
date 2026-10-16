import { parseRuntimeConfig, type RuntimeConfig } from '@/config/runtime';
import { AppError } from '@/core/errors';

export interface BusinessServiceFactories<T> {
  mock: () => T;
  api?: () => T;
}

export function selectBusinessService<T>(
  config: RuntimeConfig,
  factories: BusinessServiceFactories<T>,
): T {
  parseRuntimeConfig(config.appEnvironment, config.dataSource);
  if (config.dataSource === 'mock') return factories.mock();
  if (!factories.api) throw new AppError('NotImplemented', 'API business service is not implemented');
  return factories.api();
}
