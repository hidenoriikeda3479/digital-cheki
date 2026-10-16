import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { toAppError } from '@/core/errors';
import { getAppServices } from './compose';
import type { AppServices } from './contracts/app-services';

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; services: AppServices } | { status: 'error'; code: string }
  >({ status: 'loading' });
  useEffect(() => {
    let active = true;
    getAppServices().then(
      (services) => { if (active) setState({ status: 'ready', services }); },
      (error: unknown) => { if (active) setState({ status: 'error', code: toAppError(error, 'Configuration').code }); },
    );
    return () => { active = false; };
  }, []);

  if (state.status === 'ready') {
    return <ServicesContext.Provider value={state.services}>{children}</ServicesContext.Provider>;
  }
  return (
    <View style={styles.status}>
      {state.status === 'loading' ? <><ActivityIndicator /><Text>保存領域を準備しています…</Text></> : <>
        <Text accessibilityRole="alert">起動できませんでした（{state.code}）。</Text>
        <Text>{state.code === 'NotImplemented'
          ? 'API接続はまだ実装されていません。'
          : '設定と保存状態を確認してから、アプリを再起動してください。'}</Text>
      </>}
    </View>
  );
}

export function useAppServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider is required');
  return services;
}

const styles = StyleSheet.create({ status: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 } });
