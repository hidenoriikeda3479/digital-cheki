import { AppError } from '@/core/errors';

export type AppEnvironment = 'development' | 'staging' | 'production';
export type DataSource = 'mock' | 'api';

export interface RuntimeConfig {
  appEnvironment: AppEnvironment;
  dataSource: DataSource;
}

export function parseRuntimeConfig(
  appEnvironment: string | undefined,
  dataSource: string | undefined,
): RuntimeConfig {
  if (appEnvironment !== 'development' && appEnvironment !== 'staging' && appEnvironment !== 'production') {
    throw new AppError('Configuration', 'EXPO_PUBLIC_APP_ENV must be development, staging, or production');
  }
  if (dataSource !== 'mock' && dataSource !== 'api') {
    throw new AppError('Configuration', 'EXPO_PUBLIC_DATA_SOURCE must be mock or api');
  }
  if (appEnvironment === 'production' && dataSource === 'mock') {
    throw new AppError('Configuration', 'Production cannot use mock business services');
  }
  return { appEnvironment, dataSource };
}

export function readRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig(
    process.env.EXPO_PUBLIC_APP_ENV,
    process.env.EXPO_PUBLIC_DATA_SOURCE,
  );
}
