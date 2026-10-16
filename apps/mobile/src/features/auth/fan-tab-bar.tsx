import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type FanTab = 'home' | 'album' | 'settings';

export function FanTabBar({ selected, role, disabled, downloadsAvailable, pendingPhotos, onChange }: {
  selected: FanTab; role: 'fan' | 'guest'; disabled: boolean; downloadsAvailable: boolean; pendingPhotos: number; onChange(tab: FanTab): void;
}) {
  const insets = useSafeAreaInsets();
  const items = [
    { id: 'home', testID: 'fan-home-tab', label: 'ホーム', symbol: { ios: 'house.fill', android: 'home', web: 'home' } },
    { id: 'album', testID: 'show-downloads', label: 'アルバム', symbol: { ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' } },
    { id: 'settings', testID: role === 'fan' ? 'open-settings' : 'guest-profile-settings', label: '設定',
      symbol: { ios: 'gearshape', android: 'settings', web: 'settings' } },
  ] as const;
  return <View testID="fan-home-tabs" style={[styles.bar, { paddingBottom: 2 + insets.bottom }]}>
    {items.map((item) => <Pressable key={item.id} testID={item.testID} accessibilityRole="tab"
      accessibilityLabel={item.id === 'home' && pendingPhotos > 0 ? `ホーム、未受信${pendingPhotos}枚` : item.label}
      accessibilityState={{ selected: selected === item.id,
        disabled: disabled || !downloadsAvailable && item.id === 'album' }}
      disabled={disabled || !downloadsAvailable && item.id === 'album'}
      onPress={() => onChange(item.id)} style={[styles.tab, disabled && styles.disabled]}>
      <View style={styles.icon}>
        <SymbolView name={item.symbol} size={26} tintColor={selected === item.id ? '#3185e5' : '#8ba7c9'} />
        {item.id === 'home' && pendingPhotos > 0 && <View pointerEvents="none" style={styles.badge}>
          <Text testID="fan-home-pending-badge" style={styles.badgeText}>{pendingPhotos}</Text>
        </View>}
      </View>
      <Text style={[styles.label, selected === item.id && styles.selectedLabel]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#dde9f5', paddingTop: 11, paddingBottom: 2 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { color: '#8ba2c2', fontSize: 11, fontWeight: '500' }, selectedLabel: { color: '#3185e5', fontWeight: '700' },
  icon: { width: 26, height: 26 },
  badge: { position: 'absolute', top: -6, left: 18, minWidth: 18, minHeight: 18, paddingHorizontal: 4,
    borderRadius: 12, backgroundColor: '#ed526b', borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 13 },
  disabled: { opacity: 0.6 },
});
