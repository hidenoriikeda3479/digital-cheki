import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import type { DownloadController, DownloadScreenState, ReceiveBatchItem } from './download-controller';
import { localCaptureDate } from './album-filter';

// Presentation starting values, independent of transfer timeouts or storage policy.
export const receivePresentation = { enterMs: 200, stackMs: 400, stackOffset: 12, sway: 2,
  progressMs: 5000, completeCloseMs: 1000, waitReleaseMs: 30000 } as const;

function usePresentationAccess() {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(true);
  const [screenReader, setScreenReader] = useState(true);
  useEffect(() => {
    let mounted = true;
    const app = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => { if (mounted) setScreenReader(value); });
    return () => { mounted = false; app.remove(); motion.remove(); reader.remove(); };
  }, []);
  return { foreground, reduceMotion, screenReader };
}

export function ReceiveCheki({ uri, depth, animate }: { uri: string | null; depth: number; animate: boolean }) {
  const entered = useRef(false);
  const [entrance] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (animate && !entered.current) {
      entered.current = true;
      entrance.setValue(0);
      Animated.timing(entrance, { toValue: 1, duration: receivePresentation.stackMs,
        easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false }).start();
    } else entrance.setValue(1);
    return () => entrance.stopAnimation();
  }, [animate, entrance]);
  return <Animated.View testID="receive-cheki" style={[styles.cheki, { opacity: entrance,
    transform: [{ translateX: depth === 0 ? 0 : depth % 2 ? -16 : 18 },
      { translateY: Animated.add(depth * 8, entrance.interpolate({ inputRange: [0, 1], outputRange: [-receivePresentation.stackOffset, 0] })) },
      { rotate: depth === 0 ? '0deg' : depth % 2 ? '-7deg' : '7deg' }] }]}>
    {uri ? <Image testID="receive-cheki-image" source={{ uri }} resizeMode="contain" style={styles.chekiImage} />
      : <View style={[styles.chekiImage, styles.emptyCheki]}><SymbolView name={{ ios: 'photo', android: 'image', web: 'image' }}
        size={28} tintColor="#a5c4e8" /></View>}
  </Animated.View>;
}

function failureReason(item: ReceiveBatchItem) {
  if (item.status === 'expired') return '受信期限を過ぎています';
  if (item.error === 'Conflict') return '受信済みのため再受信できません';
  if (item.error === 'Forbidden') return 'この写真を受け取る権限がありません';
  if (item.error === 'NotFound') return '対象の写真を確認できません';
  if (item.status === 'unknown') return '保存結果の確認が必要です';
  if (item.error === 'Storage') return '端末に保存できませんでした。空き容量をご確認ください';
  return '受信に失敗しました';
}

export function ReceiveModal({ controller, state }: { controller: DownloadController; state: DownloadScreenState }) {
  const batch = state.receiveBatch;
  const { foreground, reduceMotion, screenReader } = usePresentationAccess();
  const [releasedAttempt, setReleasedAttempt] = useState<number | null>(null);
  const [entrance] = useState(() => new Animated.Value(1));
  const [sway] = useState(() => new Animated.Value(0));
  const [saveProgress] = useState(() => new Animated.Value(0));
  const [presentedAttempt, setPresentedAttempt] = useState<number | null>(null);
  const totalCount = batch?.items.length ?? 0;
  const savedCount = batch?.items.filter((item) => item.status === 'saved').length ?? 0;
  const visible = !!batch;
  const animate = visible && foreground && !reduceMotion;
  const processing = batch?.status === 'preparing' || batch?.status === 'receiving';
  const presentationComplete = batch?.status === 'complete' && presentedAttempt === batch.attempt;
  const canReleaseWait = foreground && releasedAttempt === batch?.attempt;
  useEffect(() => {
    saveProgress.setValue(0);
    return () => saveProgress.stopAnimation();
  }, [batch?.attempt, saveProgress]);
  useEffect(() => {
    if (!foreground || !visible || !totalCount || !savedCount) return;
    let active = true;
    let sequence: Animated.CompositeAnimation | undefined;
    saveProgress.stopAnimation((value) => {
      if (!active) return;
      const steps: Animated.CompositeAnimation[] = [];
      let previous = value;
      // Each confirmed photo gets an equal share of the five-second presentation.
      for (let index = Math.floor(value * totalCount + 0.000001) + 1; index <= savedCount; index++) {
        const next = index / totalCount;
        steps.push(Animated.timing(saveProgress, { toValue: next,
          duration: (next - previous) * receivePresentation.progressMs,
          easing: Easing.linear, useNativeDriver: false, isInteraction: false }));
        previous = next;
      }
      const attempt = batch?.attempt ?? null;
      if (!steps.length) {
        if (savedCount === totalCount) setPresentedAttempt(attempt);
        return;
      }
      sequence = Animated.sequence(steps);
      sequence.start(({ finished }) => {
        if (active && finished && savedCount === totalCount) setPresentedAttempt(attempt);
      });
    });
    return () => { active = false; sequence?.stop(); };
  }, [batch?.attempt, savedCount, totalCount, foreground, saveProgress, visible]);
  useEffect(() => {
    entrance.setValue(animate ? 0 : 1);
    if (animate) Animated.timing(entrance, { toValue: 1, duration: receivePresentation.enterMs,
      useNativeDriver: true, isInteraction: false }).start();
    return () => entrance.stopAnimation();
  }, [visible, animate, entrance]);
  useEffect(() => {
    sway.setValue(0);
    if (!animate || !processing) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: receivePresentation.sway, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }),
      Animated.timing(sway, { toValue: -receivePresentation.sway, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }),
      Animated.timing(sway, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }),
    ]));
    loop.start(); return () => { loop.stop(); sway.setValue(0); };
  }, [animate, processing, sway]);
  useEffect(() => {
    if (!processing || !foreground) return;
    const attempt = batch?.attempt ?? null;
    const timer = setTimeout(() => setReleasedAttempt(attempt), receivePresentation.waitReleaseMs);
    return () => clearTimeout(timer);
  }, [processing, foreground, batch?.attempt]);
  useEffect(() => {
    if (batch?.status !== 'complete' || !foreground || presentedAttempt !== batch.attempt) return;
    if (screenReader) { AccessibilityInfo.announceForAccessibility(`${batch.items.length}枚の写真を受け取りました`); return; }
    const timer = setTimeout(() => controller.dismissReceive(), receivePresentation.completeCloseMs);
    return () => clearTimeout(timer);
  }, [batch?.status, batch?.items.length, batch?.attempt, presentedAttempt, foreground, screenReader, controller]);
  if (!batch) return null;
  const saved = batch.items.filter((item) => item.status === 'saved');
  const unresolved = batch.items.filter((item) => item.status !== 'saved');
  const canRetry = unresolved.some((item) => item.status !== 'expired' && !['Conflict', 'Forbidden', 'NotFound'].includes(item.error ?? ''));
  const visual = (saved.length ? saved.slice(-3).reverse() : batch.items.slice(0, 3));
  const heading = presentationComplete ? `${saved.length}枚の写真を受け取りました`
    : batch.status === 'preparing' ? '受信を準備しています…' : processing || batch.status === 'complete' ? '写真を受け取っています…'
      : batch.status === 'interrupted' ? '保存結果を確認してください' : '一部の写真を受け取れませんでした';
  return <Modal testID="receive-modal" transparent visible animationType="none"
    onRequestClose={() => { if (!processing) controller.dismissReceive(); }}>
    <SafeAreaView style={styles.backdrop}>
      <Animated.View accessibilityViewIsModal style={[styles.panel, { opacity: entrance,
        transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] }]}>
        <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent} bounces={false}>
          <View style={styles.visual} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
            <Image testID="receive-heart-soft" source={require('../../../assets/images/receive/heart-soft.png')} style={styles.softHeart} />
            <Image testID="receive-heart-outline" source={require('../../../assets/images/receive/heart-outline.png')} style={styles.outlineHeart} />
            <Image testID="receive-sparkle-small" source={require('../../../assets/images/receive/sparkle-small.png')} style={styles.smallSparkle} />
            <Image testID="receive-sparkle-soft" source={require('../../../assets/images/receive/sparkle-soft.png')} style={styles.softSparkle} />
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: sway }] }]}>
              {[...visual].reverse().map((item, index) => <ReceiveCheki key={`${item.status === 'saved' ? 'saved' : 'preview'}-${item.photoId}`}
                uri={item.uri} depth={visual.length - index - 1} animate={animate} />)}
            </Animated.View>
          </View>
          {presentationComplete && <View testID="receive-complete-check" style={styles.check}>
            <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={30} tintColor="#3185e5" /></View>}
          <Text testID="receive-modal-heading" accessibilityLiveRegion="polite" style={styles.heading}>{heading}</Text>
          <Text testID="receive-modal-count" accessibilityLiveRegion="polite" style={styles.description}>
            {batch.items.length}枚中{saved.length}枚を保存しました{!processing && unresolved.length ? `。${unresolved.length}枚は未保存です` : ''}
          </Text>
          <View accessibilityRole="progressbar" accessibilityLabel="端末に保存した写真"
            accessibilityValue={{ min: 0, max: batch.items.length, now: saved.length }} style={styles.track}>
            <Animated.View testID="receive-save-progress" style={[styles.fill,
              { width: saveProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          </View>
          {!processing && unresolved.length > 0 && <View style={styles.results}>
            {unresolved.map((item) => {
              const intake = state.intakes.find((intake) => intake.intakeId === item.intakeId);
              const photo = intake?.photos.find((photo) => photo.photoId === item.photoId);
              return <View key={item.photoId} testID={`receive-result-${item.photoId}`} style={styles.result}>
                <Text style={styles.resultName}>{intake?.groupName ?? '写真'}・{intake?.idolNames.join('、')}</Text>
                <Text style={styles.reason}>{failureReason(item)}{photo ? `（期限 ${localCaptureDate(photo.expiresAt)}）` : ''}</Text>
              </View>;
            })}
          </View>}
          {!processing && canRetry && <Pressable testID="receive-retry" accessibilityRole="button" style={styles.button}
            onPress={() => { void controller.retryReceive(); }}><Text style={styles.buttonText}>失敗した写真を再試行</Text></Pressable>}
          {processing && canReleaseWait && <Pressable testID="receive-stop-wait" accessibilityRole="button" style={styles.secondary}
            onPress={() => controller.stopReceiveWait()}><Text style={styles.link}>応答待ちを終了する</Text></Pressable>}
          {!processing && <Pressable testID="receive-modal-close" accessibilityRole="button" style={styles.secondary}
            onPress={() => controller.dismissReceive()}><Text style={styles.link}>閉じる</Text></Pressable>}
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', paddingVertical: 24 },
  panel: { width: '88%', maxWidth: 360, maxHeight: '100%', flexShrink: 1, backgroundColor: '#fff', borderRadius: 24, overflow: 'hidden',
    shadowColor: '#194577', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  panelScroll: { flexGrow: 0 }, panelContent: { padding: 22, gap: 12 }, visual: { height: 195 },
  cheki: { position: 'absolute', left: '50%', marginLeft: -55, top: 14, width: 110, height: 170,
    padding: 3, paddingBottom: 9, borderWidth: 1, borderColor: '#d1e5ff', borderRadius: 5, backgroundColor: '#fff',
    shadowColor: '#5b8abc', shadowOpacity: 0.12, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  chekiImage: { flex: 1, width: '100%', borderRadius: 2 }, emptyCheki: { backgroundColor: '#f1f7ff', alignItems: 'center', justifyContent: 'center' },
  softHeart: { position: 'absolute', width: 32, height: 32, left: 0, top: 0 },
  outlineHeart: { position: 'absolute', width: 46, height: 46, right: -3, top: -4 },
  smallSparkle: { position: 'absolute', width: 24, height: 24, left: '40%', top: -9 },
  softSparkle: { position: 'absolute', width: 28, height: 28, right: '36%', top: -12 },
  heading: { color: '#22599b', fontSize: 16, fontWeight: '700', textAlign: 'center', lineHeight: 23 },
  description: { color: '#6e91bd', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  check: { alignItems: 'center' }, track: { height: 7, borderRadius: 4, backgroundColor: '#dceaff', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: '#4a98f6' },
  results: { gap: 10 }, result: { gap: 3 }, resultName: { color: '#22599b', fontSize: 13, fontWeight: '600' },
  reason: { color: '#6e91bd', fontSize: 12, lineHeight: 18 },
  button: { backgroundColor: '#3185e5', borderRadius: 12, minHeight: 44, padding: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, link: { color: '#3185e5', fontSize: 14, fontWeight: '600' },
});
