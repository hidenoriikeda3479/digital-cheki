import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PickupIdol } from '@/services/contracts/identification';
import { openSocialLink } from '@/services/open-social-link';

export function IdolDetailModal({ idol, onClose }: { idol: PickupIdol; onClose(): void }) {
  const { height } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const opening = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function open(platform: 'x' | 'instagram') {
    const url = idol.socialLinks?.[platform];
    if (!url || opening.current) return;
    opening.current = true; setBusy(true); setError(false);
    try { await openSocialLink(platform, url); }
    catch { if (mounted.current) setError(true); }
    finally { opening.current = false; if (mounted.current) setBusy(false); }
  }
  return <Modal testID="idol-detail-modal" visible transparent animationType="fade" onRequestClose={onClose}>
    <SafeAreaView style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="アイドル詳細を閉じる" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View accessibilityViewIsModal style={styles.panel}>
        <ScrollView contentContainerStyle={styles.content} bounces={false}>
          <Image testID="idol-detail-image" source={idol.portraitSource} contentFit="contain" cachePolicy="memory-disk" transition={0}
            accessibilityLabel={idol.name} style={[styles.image, { height: height * 0.54 }]} />
          <Text testID="idol-detail-name" style={styles.name}>{idol.name}</Text>
          <Text style={styles.group}>{idol.groupName}</Text>
          <View style={styles.links}>
            {(['x', 'instagram'] as const).map((platform) => <Pressable key={platform} testID={`idol-social-${platform}`}
              accessibilityRole="link" accessibilityLabel={`${platform === 'x' ? 'X' : 'Instagram'}を開く`}
              accessibilityState={{ disabled: busy || !idol.socialLinks?.[platform] }}
              disabled={busy || !idol.socialLinks?.[platform]} onPress={() => { void open(platform); }}
              style={[styles.link, platform === 'x' ? styles.x : styles.instagram,
                (busy || !idol.socialLinks?.[platform]) && styles.disabled]}>
              <Text style={styles.linkText}>{platform === 'x' ? 'X' : 'Instagram'}</Text>
            </Pressable>)}
          </View>
          {error && <Text testID="idol-link-error" accessibilityRole="alert" style={styles.error}>リンクを開けませんでした。もう一度お試しください。</Text>}
        </ScrollView>
        <Pressable testID="close-idol-detail" accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: '#0009' },
  panel: { width: '100%', maxWidth: 440, maxHeight: '100%', borderRadius: 24, backgroundColor: '#fff', overflow: 'hidden' },
  content: { paddingHorizontal: 24, paddingTop: 36, paddingBottom: 24, alignItems: 'center', gap: 12 },
  image: { width: '100%', backgroundColor: '#f4f9ff', borderRadius: 12 },
  name: { fontSize: 21, fontWeight: '700', color: '#213b60', textAlign: 'center' },
  group: { fontSize: 14, color: '#5789bc', textAlign: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, paddingTop: 4 },
  link: { minHeight: 44, minWidth: 96, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  x: { backgroundColor: '#191919' }, instagram: { backgroundColor: '#b62980' },
  linkText: { fontSize: 15, fontWeight: '700', color: '#fff' }, disabled: { opacity: 0.45 },
  close: { position: 'absolute', right: 2, top: 2, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 28, color: '#788595' }, error: { fontSize: 13, color: '#a63c51', textAlign: 'center' },
});
