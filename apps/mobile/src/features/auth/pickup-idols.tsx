import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { runOnJS, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { PickupIdol } from '@/services/contracts/identification';
import { IdolDetailModal } from './idol-detail-modal';

export const pickupMotion = { pixelsPerSecond: 12, resumeDelayMs: 1800, gap: 12 } as const;

export function pickupLoopOffset(offset: number, period: number) {
  'worklet';
  if (period <= 0) return 0;
  return period + ((offset % period) + period) % period;
}

export function PickupIdols({ load, width, paused = false, title = 'Pick Up', testID = 'pickup' }: {
  load(): Promise<PickupIdol[]>; width: number; paused?: boolean; title?: string; testID?: string;
}) {
  const [idols, setIdols] = useState<PickupIdol[]>([]);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<PickupIdol | null>(null);
  const cardWidth = Math.max(80, width * 0.29) * 1.3;
  const stride = cardWidth + pickupMotion.gap;
  const period = idols.length * stride;
  const carousel = useAnimatedRef<ScrollView>();
  const offset = useSharedValue(0);
  const touching = useSharedValue(false);
  const resumeAt = useSharedValue(0);
  const activeIndex = useSharedValue(0);
  const ready = useSharedValue(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(true);
  const [screenReader, setScreenReader] = useState(true);
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    if (!ready.get() || touching.get() || Date.now() < resumeAt.get() || !timeSincePreviousFrame || period <= 0) return;
    let next = offset.get() + Math.min(timeSincePreviousFrame, 64) * pickupMotion.pixelsPerSecond / 1000;
    if (next >= period * 2) next = pickupLoopOffset(next, period);
    offset.set(next);
    scrollTo(carousel, next, 0, false);
  }, false);
  const scroll = useAnimatedScrollHandler({
    onScroll(event) {
      if (period <= 0) return;
      let next = event.contentOffset.x;
      if (idols.length > 1 && (next < period || next >= period * 2)) {
        next = pickupLoopOffset(next, period);
        scrollTo(carousel, next, 0, false);
      }
      offset.set(next);
      const index = ((Math.round(next / stride) % idols.length) + idols.length) % idols.length;
      if (activeIndex.get() !== index) { activeIndex.set(index); runOnJS(setActive)(index); }
    },
    onBeginDrag() { touching.set(true); },
    onEndDrag() { touching.set(false); resumeAt.set(Date.now() + pickupMotion.resumeDelayMs); },
    onMomentumBegin() { touching.set(true); },
    onMomentumEnd() { touching.set(false); resumeAt.set(Date.now() + pickupMotion.resumeDelayMs); },
  });
  useEffect(() => {
    let mounted = true;
    const app = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => { if (mounted) setScreenReader(value); });
    return () => { mounted = false; app.remove(); motion.remove(); reader.remove(); };
  }, []);
  useEffect(() => {
    frame.setActive(foreground && !paused && !selected && !reduceMotion && !screenReader && idols.length > 1);
    return () => frame.setActive(false);
  }, [frame, foreground, paused, selected, reduceMotion, screenReader, idols.length]);
  useEffect(() => {
    let mounted = true;
    void load().then((items) => { if (mounted) { setIdols(items); setActive(0); } },
      () => { if (mounted) setFailed(true); });
    return () => { mounted = false; };
  }, [load]);
  return <View testID={`${testID}-idols`} style={styles.section}>
    <View style={styles.heading}>
      <Text style={styles.title}>{title}</Text>
    </View>
    {failed && <Text accessibilityRole="alert" style={styles.error}>アイドル情報を取得できませんでした。</Text>}
    <Animated.ScrollView ref={carousel} testID={`${testID}-carousel`} horizontal showsHorizontalScrollIndicator={false}
      decelerationRate="fast" contentContainerStyle={styles.cards} onScroll={scroll} scrollEventThrottle={16}
      onTouchStart={() => touching.set(true)}
      onTouchEnd={() => { touching.set(false); resumeAt.set(Date.now() + pickupMotion.resumeDelayMs); }}
      onTouchCancel={() => { touching.set(false); resumeAt.set(Date.now() + pickupMotion.resumeDelayMs); }}
      onContentSizeChange={() => {
        const start = idols.length > 1 ? period : 0;
        offset.set(start); ready.set(true);
        carousel.current?.scrollTo({ x: start, animated: false });
      }}>
      {Array.from({ length: idols.length > 1 ? (period >= width ? 3 : 4) : 1 }, (_, copy) => idols.map((idol) => <Pressable key={`${copy}-${idol.id}`}
        testID={copy === (idols.length > 1 ? 1 : 0) ? `${testID}-idol-${idol.id}` : undefined}
        accessible={copy === (idols.length > 1 ? 1 : 0)} accessibilityElementsHidden={idols.length > 1 && copy !== 1}
        importantForAccessibility={idols.length > 1 && copy !== 1 ? 'no-hide-descendants' : 'auto'}
        accessibilityLabel={`${idol.name}、${idol.groupName}`} accessibilityRole="button" onPress={() => setSelected(idol)}
        style={[styles.card, { width: cardWidth, minHeight: cardWidth * 1.32 }]}>
        <Image source={idol.portraitSource} contentFit="contain" cachePolicy="memory-disk"
          allowDownscaling transition={0} style={styles.portrait} accessible={false} />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs><LinearGradient id="pickup-shade" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="40%" stopColor="#10223c" stopOpacity={0} />
              <Stop offset="100%" stopColor="#10223c" stopOpacity={0.85} />
            </LinearGradient></Defs>
            <Rect width="100" height="100" fill="url(#pickup-shade)" />
          </Svg>
        </View>
        <View style={styles.caption}>
          <Text style={styles.name}>{idol.name}</Text>
        </View>
      </Pressable>))}
    </Animated.ScrollView>
    {idols.length > 1 && <View testID={`${testID}-pagination`} style={styles.dots} accessible
      accessibilityLabel={`${idols.length}名中${active + 1}人目`}>
      {idols.map((idol, index) => <View key={idol.id} style={[styles.dot, index === active && styles.activeDot]} />)}
    </View>}
    {selected && <IdolDetailModal key={selected.id} idol={selected} onClose={() => setSelected(null)} />}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingTop: 8, paddingBottom: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 19, fontWeight: '700', color: '#174d94' },
  cards: { gap: pickupMotion.gap, paddingRight: pickupMotion.gap },
  card: { borderRadius: 14, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#e0efff' },
  // Bundled images supply intrinsic dimensions; explicitly override them to fit the card.
  portrait: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  caption: { padding: 8, paddingTop: 32, gap: 3 },
  name: { fontSize: 13, fontWeight: '700', color: '#fff' },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#c3d6eb' },
  activeDot: { width: 18, backgroundColor: '#3185e5' },
  error: { fontSize: 13, color: '#a63c51' },
});
