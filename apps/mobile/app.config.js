// Expo CLIでも公開設定を検証する。クライアント側はruntime.tsが再検証する。
// exportの初回config評価はCLIのenv読込みより先に行われる場合がある。
require('@expo/env').load(__dirname);

module.exports = ({ config }) => {
  const environment = process.env.EXPO_PUBLIC_APP_ENV;
  const source = process.env.EXPO_PUBLIC_DATA_SOURCE;
  if (!['development', 'staging', 'production'].includes(environment) || !['mock', 'api'].includes(source)) {
    throw new Error('EXPO_PUBLIC_APP_ENV / EXPO_PUBLIC_DATA_SOURCE を明示的に設定してください。');
  }
  if (environment === 'production' && source === 'mock') {
    throw new Error('production + mock は利用できません。');
  }
  return config;
};
