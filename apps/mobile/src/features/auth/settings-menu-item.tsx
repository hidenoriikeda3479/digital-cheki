import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SymbolView } from 'expo-symbols';

export function SettingsMenuItem({ testID, label, symbol, disabled = false, onPress }: {
  testID: string; label: string; symbol: ComponentProps<typeof SymbolView>['name']; disabled?: boolean; onPress(): void;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}>
    <SymbolView name={symbol} size={28} tintColor="#174d94" style={styles.icon} />
    <Text style={styles.label}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 72, paddingVertical: 16, paddingHorizontal: 6 },
  icon: { width: 30, height: 30, flexShrink: 0 },
  label: { color: '#174d94', fontSize: 18, lineHeight: 27, flex: 1 },
  pressed: { opacity: 0.6 }, disabled: { opacity: 0.4 },
});
