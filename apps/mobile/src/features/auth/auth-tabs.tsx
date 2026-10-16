import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

const activeColor = '#174c8f';

export function AuthTabs({ active, showRegister = true, disabled = false, onLogin, onRegister }: {
  active: 'login' | 'register'; showRegister?: boolean; disabled?: boolean;
  onLogin?(): void; onRegister?(): void;
}) {
  const theme = useTheme();
  return <View testID="login-tabs" style={[styles.tabs, { borderBottomColor: theme.textSecondary }]}>
    {active === 'login' ? <View style={styles.activeTab}><Text style={styles.activeText}>ログイン</Text></View>
      : <Pressable testID="choose-login" accessibilityRole="button" disabled={disabled}
        style={styles.inactiveTab} onPress={onLogin}><Text style={{ color: theme.textSecondary }}>ログイン</Text></Pressable>}
    {showRegister && (active === 'register' ? <View style={styles.activeTab}><Text style={styles.activeText}>新規作成</Text></View>
      : <Pressable testID="choose-register" accessibilityRole="button" disabled={disabled}
        style={styles.inactiveTab} onPress={onRegister}><Text style={{ color: theme.textSecondary }}>新規作成</Text></Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  activeTab: { flex: 1, alignItems: 'center', paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: activeColor },
  activeText: { color: activeColor, fontWeight: '700' },
  inactiveTab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
});
