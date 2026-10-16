import { useState, type ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { DownloadScreenState } from '@/features/download/download-controller';
import { emptyAlbumFilter, filterAlbum, localCaptureDate } from '@/features/download/album-filter';
import type { PickupIdol } from '@/services/contracts/identification';
import { PickupIdols } from './pickup-idols';

const blue = '#3185e5';
const ink = '#174d94';
const homeTopOffset = 12;
type SymbolName = ComponentProps<typeof SymbolView>['name'];
const symbols = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  receive: { ios: 'envelope', android: 'mail', web: 'mail' },
  album: { ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  profile: { ios: 'person.fill', android: 'person', web: 'person' },
  qr: { ios: 'qrcode', android: 'qr_code', web: 'qr_code' },
  right: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
} satisfies Record<string, SymbolName>;

interface FanHomeProps {
  loadPickupIdols(): Promise<PickupIdol[]>;
  loadTrendingIdols(): Promise<PickupIdol[]>;
  role: 'fan' | 'guest';
  state: DownloadScreenState | null;
  qrBusy: boolean;
  authBusy: boolean;
  error?: string | null;
  onReception(): void;
  onReceive(): void;
  onRefreshReceive(): void;
  onAlbum(): void;
  onPhoto(photoId: string): void;
  onSettings?: () => void;
  onSupport?: () => void;
  onLogout(): void;
}

function Icon({ name, size = 24, color = blue }: { name: SymbolName; size?: number; color?: string }) {
  return <SymbolView name={name} size={size} tintColor={color} />;
}

export function FanHomeScreen({ role, state, qrBusy, authBusy, error, onReception, onReceive, onRefreshReceive, onAlbum,
  onPhoto, onSettings, onSupport, onLogout, loadPickupIdols, loadTrendingIdols }: FanHomeProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contentHeight = height - insets.top - insets.bottom - 57 - homeTopOffset;
  const room = Math.max(0, Math.min(1, (contentHeight - 540) / 140));
  const cardPadding = 10 + 4 * room;
  const rowGap = 6 + 2 * room;
  const pageWidth = Math.min(width - insets.left - insets.right, 480) - 40;
  const receiveImageSize = Math.min(52 + 32 * room, (pageWidth - 2 * cardPadding - 20) / 3);
  const albumImageSize = Math.min(56 + 36 * room, (pageWidth - 26) / 3);
  const pending = (state?.intakes ?? []).flatMap((intake) => intake.photos)
    .filter((photo) => photo.status === 'unreceived' || photo.status === 'failed');
  const receiveGroups = (state?.intakes ?? []).map((intake) => ({ intake,
    photos: intake.photos.filter((photo) => ['unreceived', 'failed', 'expired'].includes(photo.status)) }))
    .filter(({ photos }) => photos.length > 0);
  const expiredCount = receiveGroups.flatMap(({ photos }) => photos).filter((photo) => photo.status === 'expired').length;
  const recent = filterAlbum(state?.intakes ?? [], emptyAlbumFilter()).slice(0, 3);
  const loading = state?.receiveStatus === 'loading';
  const loadError = state?.receiveStatus === 'error';
  const downloadBusy = !state || state.busy;
  const openProfile = () => setProfileOpen(true);

  return <View testID={role === 'fan' ? 'fan-home' : 'guest-home'} style={styles.screen}>
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.page, { gap: 8 + 4 * room }]}
      bounces={false} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Text style={[styles.title, { fontSize: 26 + 2 * room }]}>Poyo Photo</Text>
          <Text style={styles.tagline}>デジタルチェキで、もっと近くに。</Text>
        </View>
        <Pressable testID="open-profile" accessibilityRole="button" accessibilityLabel="プロフィールメニューを開く"
          disabled={authBusy} onPress={openProfile} style={({ pressed }) => [styles.profile, pressed && styles.pressed]}>
          <Icon name={symbols.profile} size={23} color="#5999df" />
        </Pressable>
      </View>

      <View testID="fan-home-reception-card" style={[styles.reception, { padding: 12 + 4 * room, gap: 4 + 2 * room }]}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Image testID="fan-home-reception-background"
            source={require('../../../assets/images/backgrounds/fan-reception-live.png')}
            resizeMode="cover" style={styles.receptionBackground} />
        </View>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
            <Defs><LinearGradient id="reception-readability" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#e7f5ff" stopOpacity={0.66} />
              <Stop offset="55%" stopColor="#e7f5ff" stopOpacity={0.3} />
              <Stop offset="100%" stopColor="#e7f5ff" stopOpacity={0} />
            </LinearGradient></Defs>
            <Rect width="100" height="100" fill="url(#reception-readability)" />
          </Svg>
        </View>
        <Text style={[styles.receptionTitle, { fontSize: 22 + 2 * room, lineHeight: 26 + 3 * room }]}>受付</Text>
        <Text style={[styles.receptionDescription, { fontSize: 12 + room, lineHeight: 16 + 2 * room }]}>このQRコードをスタッフに{ '\n' }見せてください</Text>
        <Pressable testID="show-fan-code" accessibilityRole="button" accessibilityLabel="QRコードを表示"
          accessibilityState={{ disabled: qrBusy }} disabled={qrBusy} onPress={onReception}
          style={({ pressed }) => [styles.qrButton, qrBusy && styles.disabled, pressed && styles.pressed]}>
          <Icon name={symbols.qr} size={23} />
          <Text style={styles.qrLabel}>{qrBusy ? 'QRコードを準備中…' : 'QRコードを表示'}</Text>
          <Icon name={symbols.right} size={15} />
        </Pressable>
      </View>

      {state && <View testID="fan-home-receive-card" style={[styles.receiveCard, { padding: cardPadding, gap: rowGap }]}>
        <View style={styles.sectionHeading}>
          <Icon name={symbols.receive} size={25} />
          <Text style={styles.sectionTitle}>受信</Text>
          <Pressable testID="home-receive-refresh" accessibilityRole="button" accessibilityLabel="受信状況を更新"
            disabled={downloadBusy || loading} onPress={onRefreshReceive} hitSlop={6} style={styles.refreshLink}>
            <Icon name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={19} />
          </Pressable>
        </View>
        <Text testID="fan-home-receive-summary" style={styles.receiveDescription}>
          {loadError ? '新しいチェキを確認できませんでした。'
            : loading && !pending.length ? '新しいチェキを確認中…'
              : pending.length ? <>新しいチェキが <Text style={styles.count}>
                <Text testID="fan-home-receive-count">{String(pending.length)}</Text>枚</Text> 届いています</>
                : expiredCount ? `${expiredCount}枚は受信期限を過ぎています` : '新しいチェキはありません'}
        </Text>
        {pending.length > 0 && <View style={styles.photosRow}>
          {pending.slice(0, 3).map((photo) => <View key={photo.photoId} testID={`home-pending-photo-${photo.photoId}`} style={styles.thumbnailSlot}>
            {photo.previewUri ? <Image testID={`home-pending-image-${photo.photoId}`} source={{ uri: photo.previewUri }}
              resizeMode="cover" style={[styles.thumbnail, { width: receiveImageSize, height: receiveImageSize }]} />
              : <View style={[styles.thumbnail, styles.missingPreview, { width: receiveImageSize, height: receiveImageSize }]}><Icon name={symbols.album} color="#91aac7" /></View>}
          </View>)}
          {Array.from({ length: Math.max(0, 3 - pending.length) }, (_, index) =>
            <View key={`pending-space-${index}`} style={styles.thumbnailSlot} />)}
        </View>}
        <Pressable testID="receive-inbox-button" accessibilityRole="button"
          accessibilityLabel={`写真を受け取る、未受信${pending.length}枚`} accessibilityState={{ disabled: downloadBusy || !pending.length }}
          disabled={downloadBusy || !pending.length} onPress={onReceive}
          style={({ pressed }) => [styles.receiveButton, (downloadBusy || !pending.length) && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.receiveButtonText}>写真を受け取る</Text>
        </Pressable>
      </View>}

      {state && <View testID="fan-home-recent-album" style={[styles.albumSection, { gap: rowGap }]}>
        <View style={styles.sectionHeading}>
          <Icon name={symbols.album} size={25} />
          <Text style={styles.sectionTitle}>最近のアルバム</Text>
          <Pressable testID="view-all-album" accessibilityRole="button" disabled={downloadBusy} onPress={onAlbum}
            hitSlop={6} style={styles.allAlbums}>
            <Text style={styles.allAlbumsText}>すべて見る</Text><Icon name={symbols.right} size={12} />
          </Pressable>
        </View>
        <View style={styles.photosRow}>
          {recent.map(({ intake, photo }) => <Pressable key={photo.photoId} testID={`home-album-photo-${photo.photoId}`}
            accessibilityRole="button" accessibilityLabel={`${intake.idolNames.join('・')}の写真を開く`}
            disabled={downloadBusy} onPress={() => onPhoto(photo.photoId)} style={styles.thumbnailSlot}>
            {photo.localUri && <Image testID={`home-album-image-${photo.photoId}`} source={{ uri: photo.localUri }}
              resizeMode="cover" style={[styles.thumbnail, { width: albumImageSize, height: albumImageSize }]} />}
            <Text style={styles.photoDate}>{localCaptureDate(photo.capturedAt).replaceAll('-', '.')}</Text>
            <Text style={styles.photoName} numberOfLines={2}>{intake.idolNames.join('・') || intake.groupName}</Text>
          </Pressable>)}
          {recent.length > 0 && Array.from({ length: 3 - recent.length }, (_, index) =>
            <View key={`album-space-${index}`} style={styles.thumbnailSlot} />)}
        </View>
        {!recent.length && <Text style={styles.emptyAlbum}>まだ写真がありません</Text>}
      </View>}
      <PickupIdols load={loadPickupIdols} width={pageWidth} paused={profileOpen || !!state?.receiveBatch} />
      <PickupIdols load={loadTrendingIdols} width={pageWidth} paused={profileOpen || !!state?.receiveBatch}
        title="人気急上昇中のアイドル" testID="trending" />
      {state?.error && <Text testID="download-open-error" accessibilityRole="alert" style={styles.error}>
        写真を開けませんでした。もう一度お試しください。</Text>}
      {error && <Text testID="auth-error" accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </ScrollView>

    {profileOpen && <Modal transparent visible animationType="fade" onRequestClose={() => setProfileOpen(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.profileSheet}>
          <Text style={styles.profileTitle}>アカウント</Text>
          {role === 'fan' && onSettings && <Pressable testID="profile-settings" accessibilityRole="button" style={styles.profileAction}
            onPress={() => { setProfileOpen(false); onSettings(); }}><Text style={styles.profileActionText}>設定</Text></Pressable>}
          {role === 'guest' && onSupport && <Pressable testID="open-support" accessibilityRole="button" style={styles.profileAction}
            onPress={() => { setProfileOpen(false); onSupport(); }}><Text style={styles.profileActionText}>問い合わせ</Text></Pressable>}
          <Pressable testID="logout" accessibilityRole="button" disabled={authBusy} style={styles.profileAction}
            onPress={() => { setProfileOpen(false); onLogout(); }}><Text style={styles.profileActionText}>ログアウト</Text></Pressable>
          <Pressable testID="close-profile" accessibilityRole="button" style={styles.profileAction}
            onPress={() => setProfileOpen(false)}><Text style={styles.closeText}>閉じる</Text></Pressable>
        </View>
      </View>
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f9ff' },
  scroll: { flex: 1 },
  page: { paddingHorizontal: 20, paddingTop: 4 + homeTopOffset, paddingBottom: 4, maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingBottom: 2 },
  brand: { flex: 1 }, title: { color: blue, fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  tagline: { color: '#6794c6', fontSize: 11, lineHeight: 17, marginTop: 1, letterSpacing: 0.2 },
  profile: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e0efff', alignItems: 'center', justifyContent: 'center' },
  reception: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#d5edff' },
  receptionBackground: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  receptionTitle: { color: '#2167b5', fontSize: 25, fontWeight: '700' },
  receptionDescription: { color: ink, fontSize: 14, fontWeight: '500', lineHeight: 21 },
  qrButton: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44,
    backgroundColor: '#ffffff', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 16, marginTop: 2 },
  qrLabel: { color: blue, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  receiveCard: { backgroundColor: '#fff', borderRadius: 22,
    shadowColor: '#3a7fbc', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 32 },
  sectionTitle: { color: ink, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  refreshLink: { marginLeft: 'auto', minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  receiveDescription: { color: ink, fontSize: 13, lineHeight: 22, paddingLeft: 4 },
  count: { color: blue, fontSize: 19, fontWeight: '700' },
  photosRow: { flexDirection: 'row', gap: 10 }, thumbnailSlot: { flex: 1, minWidth: 0 },
  thumbnail: { alignSelf: 'center', aspectRatio: 1, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d7e4f2' },
  missingPreview: { backgroundColor: '#eef5fc', alignItems: 'center', justifyContent: 'center' },
  receiveButton: { minHeight: 44, borderRadius: 16, backgroundColor: blue, padding: 10, alignItems: 'center', justifyContent: 'center' },
  receiveButtonText: { fontSize: 16, color: '#fff', fontWeight: '700' },
  albumSection: { paddingHorizontal: 3 }, allAlbums: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 32 },
  allAlbumsText: { color: blue, fontSize: 12, fontWeight: '600' },
  photoDate: { color: '#6082ac', fontSize: 11, lineHeight: 14, marginTop: 4 }, photoName: { color: '#6082ac', fontSize: 11, lineHeight: 14, marginTop: 1 },
  emptyAlbum: { color: '#7f97b6', fontSize: 14, paddingVertical: 20 },
  pressed: { opacity: 0.75 }, disabled: { opacity: 0.55 }, error: { color: '#a63c51', fontSize: 14, lineHeight: 21 },
  modalBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(20,48,80,0.3)', padding: 28 },
  profileSheet: { borderRadius: 24, backgroundColor: '#fff', padding: 20, gap: 6, maxWidth: 400, width: '100%', alignSelf: 'center' },
  profileTitle: { color: ink, fontSize: 20, fontWeight: '700', paddingBottom: 8 },
  profileAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  profileActionText: { color: ink, fontSize: 17, fontWeight: '500' }, closeText: { color: '#7188a4', fontSize: 16 },
});
