import { useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Principal } from '@/services/contracts/auth';
import type { OwnIdentity } from '@/services/contracts/identification';
import { QrCode } from './qr-code';

const ink = '#4d6b93';

export function FanReceptionScreen({ identity, principal, busy, error, embedded, onBack, onRefresh }: {
  identity: OwnIdentity; principal?: Principal; busy: boolean; error: string | null;
  embedded: boolean; onBack(): void; onRefresh(): void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const availableHeight = pageHeight ?? height - 180;
  const compact = availableHeight < 620;
  const qrSize = Math.max(100, Math.min(236, width - 112, availableHeight - (compact ? 350 : 450))); 
  const guest = principal?.role === 'guest';
  const Container = embedded ? View : SafeAreaView;
  return <Container testID="fan-code-screen" style={styles.screen}>
    <View pointerEvents="none" style={styles.background}>
      <View style={styles.beam} />
      <Image source={require('../../../assets/images/backgrounds/fan-reception-live.png')}
        contentFit="cover" style={styles.liveBackground} />
    </View>
    <View style={styles.header}>
      <Pressable testID="intake-back" accessibilityRole="button" accessibilityLabel="ホームへ戻る" onPress={onBack} style={styles.iconButton}>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={26} tintColor={ink} />
      </Pressable>
      <Text style={styles.title}>受付</Text>
      <Pressable testID="qr-help" accessibilityRole="button" accessibilityLabel="受付の案内" onPress={() => setHelpOpen(true)} style={styles.iconButton}>
        <SymbolView name={{ ios: 'questionmark.circle', android: 'help_outline', web: 'help_outline' }} size={26} tintColor={ink} />
      </Pressable>
    </View>
    <View testID="qr-reception-content" style={styles.page}
      onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}>
      <View style={styles.ticket}>
        <View style={styles.ticketHeading}>
          {!compact && <SymbolView name={{ ios: 'sparkle', android: 'auto_awesome', web: 'auto_awesome' }} size={24} tintColor="#9fbee5" />}
          {!compact && <Text style={styles.eyebrow}>LIVE EVENT</Text>}
          <Text style={styles.brand}>CHEKI TICKET</Text>
          {!compact && <Text style={styles.tagline}>A SPECIAL MOMENT FOR YOU</Text>}
        </View>
        <View style={styles.perforation}>
          <View pointerEvents="none" style={[styles.notch, styles.leftNotch]} />
          <View style={styles.dashed} />
          <View pointerEvents="none" style={[styles.notch, styles.rightNotch]} />
        </View>
        <View style={styles.body}>
          <Text style={styles.qrTitle}>QRコードを表示</Text>
          <Text style={styles.instructions}>スタッフにこのQRコードを提示してください</Text>
          <View style={styles.qrCard}><QrCode payload={identity.qrPayload} size={qrSize} /></View>
          <View style={styles.details}>
            <View style={[styles.detailRow, styles.rowDivider]}>
              <SymbolView name={{ ios: 'person', android: 'person_outline', web: 'person_outline' }} size={21} tintColor={ink} />
              <Text style={styles.detailLabel}>お名前</Text>
              <Text testID="own-name" style={styles.detailValue}>{guest ? 'ゲスト' : principal?.displayName ?? '―'}{!guest && principal ? ' 様' : ''}</Text>
            </View>
            <View style={styles.detailRow}>
              <SymbolView name={{ ios: 'person.text.rectangle', android: 'badge', web: 'badge' }} size={21} tintColor={ink} />
              <Text style={styles.detailLabel}>{guest ? '一時番号' : '会員番号'}</Text>
              <Text testID="own-number" style={styles.detailValue}>{identity.number}</Text>
            </View>
          </View>
          {!compact && <View style={styles.thanksDivider}><View style={styles.dashed} /><Text style={styles.star}>✦</Text><View style={styles.dashed} /></View>}
          {!compact && <Text style={styles.thanks}>THANK YOU FOR ALWAYS SUPPORTING</Text>}
        </View>
      </View>
      <Pressable testID="refresh-own-qr" accessibilityRole="button" accessibilityLabel="QRコードを更新する"
        accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onRefresh}
        style={({ pressed }) => [styles.refresh, (busy || pressed) && styles.dim]}>
        {busy ? <ActivityIndicator testID="identification-progress" color="#fff" />
          : <SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={25} tintColor="#fff" />}
        <Text style={styles.refreshLabel}>{busy ? '更新中…' : '更新する'}</Text>
      </Pressable>
      {error && <Text testID="identification-error" accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>
    <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={() => setHelpOpen(false)}>
      <View style={styles.helpBackdrop}><View style={styles.helpCard}>
        <Text style={styles.qrTitle}>受付</Text>
        <Text style={styles.instructions}>スタッフにQRコードを見せてください。読み取れない場合は、表示されている番号をお伝えください。</Text>
        <Pressable testID="close-qr-help" accessibilityRole="button" onPress={() => setHelpOpen(false)} style={styles.refresh}><Text style={styles.refreshLabel}>閉じる</Text></Pressable>
      </View></View>
    </Modal>
  </Container>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#edf6ff' }, background: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden' },
  beam: { position: 'absolute', width: '180%', height: '25%', top: '30%', left: '-40%', backgroundColor: '#deedff', transform: [{ rotate: '-38deg' }] },
  liveBackground: { position: 'absolute', width: '100%', height: '46%', bottom: 0, opacity: 0.12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 4 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, title: { color: ink, fontSize: 22, fontWeight: '500' },
  page: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 12, gap: 12, width: '100%', maxWidth: 520, alignSelf: 'center' },
  ticket: { backgroundColor: '#fff', borderRadius: 24, shadowColor: '#6d98cb', shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  ticketHeading: { alignItems: 'center', gap: 4, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 12 },
  eyebrow: { color: '#8eadd3', fontSize: 10, letterSpacing: 5 }, brand: { color: ink, fontFamily: 'Georgia', fontSize: 21, letterSpacing: 3 },
  tagline: { color: '#9bb6d9', fontSize: 8, letterSpacing: 2 },
  perforation: { height: 24, justifyContent: 'center', paddingHorizontal: 20 }, dashed: { flex: 1, borderTopWidth: 1, borderColor: '#bdd5f3', borderStyle: 'dashed' },
  notch: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#edf6ff', position: 'absolute', top: 0 }, leftNotch: { left: -12 }, rightNotch: { right: -12 },
  body: { padding: 12, paddingTop: 4, alignItems: 'center', gap: 8 },
  qrTitle: { color: ink, fontSize: 21, fontWeight: '600', letterSpacing: 2, textAlign: 'center' },
  instructions: { color: ink, fontSize: 12, lineHeight: 20, textAlign: 'center' },
  qrCard: { backgroundColor: '#fff', padding: 10, borderRadius: 12, shadowColor: '#7397c6', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  details: { width: '100%', backgroundColor: '#eef5fd', borderRadius: 12, paddingHorizontal: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 }, rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#cadcf0' },
  detailLabel: { color: ink, fontSize: 12 }, detailValue: { flex: 1, color: ink, fontSize: 16, textAlign: 'right' },
  thanksDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }, star: { color: '#a0bde2', fontSize: 22 },
  thanks: { color: '#90acd2', fontSize: 7, letterSpacing: 1.5, textAlign: 'center' },
  refresh: { backgroundColor: '#7c9ecb', borderRadius: 30, minHeight: 48, paddingVertical: 12, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, alignSelf: 'center', width: '80%' },
  refreshLabel: { color: '#fff', fontSize: 17, fontWeight: '500' }, dim: { opacity: 0.65 }, error: { color: '#a33c3c', textAlign: 'center' },
  helpBackdrop: { flex: 1, backgroundColor: '#12304f66', alignItems: 'center', justifyContent: 'center', padding: 28 },
  helpCard: { width: '100%', maxWidth: 400, borderRadius: 22, padding: 24, backgroundColor: '#fff', gap: 24 },
});

