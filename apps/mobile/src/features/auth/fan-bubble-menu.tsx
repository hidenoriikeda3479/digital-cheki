import { useEffect, useState, type ComponentProps } from 'react';
import { SymbolView } from 'expo-symbols';
import { AccessibilityInfo, AppState, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { BubbleSheen } from '@/components/bubble-sheen';

export type FanMenuItem = {
  testID: string;
  label: string;
  symbol: ComponentProps<typeof SymbolView>['name'];
  disabled?: boolean;
  onPress: () => void;
};

// Temporary presentation values. Leave a visible gap even at the closest point of the float.
export const fanBubbleMotion = {
  vertical: [6, 7, 6, 7],
  horizontal: [3, 2, 4, 3],
  periodMs: [6000, 7400, 6800, 7900],
  phase: [0, 1.15, 2.4, 3.55],
  visibleGap: 10,
  horizontalMotionBuffer: 8,
  verticalMotionBuffer: 14,
} as const;

const bubbleSizeRatios = [1, 0.88, 0.95, 0.96] as const;

export function fanBubbleSize(maxSize: number, index: number) {
  return maxSize * bubbleSizeRatios[index % bubbleSizeRatios.length];
}

export function fanBubbleLayout(width: number, height: number, fontScale: number, count: number, safeVertical = 0) {
  const widthLimit = Math.max(100, width - 80);
  const accessibleSize = Math.min(widthLimit, 230 * Math.min(fontScale, 1.4));
  const contentWidth = Math.max(0, Math.min(width, 480) - 72);
  const minimumStep = (size: number) => {
    let step = 0;
    for (let first = 0; first < count; first++) {
      for (let next = first + 1; next < count; next++) {
        const firstRadius = fanBubbleSize(size, first) / 2;
        const nextRadius = fanBubbleSize(size, next) / 2;
        const horizontalDistance = (next - first) % 2 === 0
          ? Math.abs(firstRadius - nextRadius) : contentWidth - firstRadius - nextRadius;
        const safeHorizontal = Math.max(0, horizontalDistance - fanBubbleMotion.horizontalMotionBuffer);
        const requiredDistance = firstRadius + nextRadius + fanBubbleMotion.visibleGap;
        const pairStep = (fanBubbleMotion.verticalMotionBuffer +
          Math.sqrt(Math.max(0, requiredDistance ** 2 - safeHorizontal ** 2))) / (next - first);
        step = Math.max(step, pairStep);
      }
    }
    return step;
  };
  if (fontScale > 1.1) return { size: accessibleSize, rowStep: minimumStep(accessibleSize) };
  // Header and page spacing occupy 88 pt. Small screens keep scrolling when circles cannot fit.
  const availableHeight = Math.max(0, height - safeVertical - 88);
  let lower = 100;
  let upper = accessibleSize;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = (lower + upper) / 2;
    if (candidate + Math.max(0, count - 1) * minimumStep(candidate) <= availableHeight) lower = candidate;
    else upper = candidate;
  }
  const size = count <= 1 ? accessibleSize : lower;
  const rowStep = count > 1 ? Math.max(minimumStep(size), (availableHeight - size) / (count - 1)) : size;
  return { size, rowStep };
}

function Bubble({ item, index, size, rowStep, active }: { item: FanMenuItem; index: number; size: number; rowStep: number; active: boolean }) {
  const bubbleSize = fanBubbleSize(size, index);
  const progress = useSharedValue(0);
  const phase = fanBubbleMotion.phase[index % fanBubbleMotion.phase.length];
  const vertical = fanBubbleMotion.vertical[index % fanBubbleMotion.vertical.length];
  const horizontal = fanBubbleMotion.horizontal[index % fanBubbleMotion.horizontal.length];
  const periodMs = fanBubbleMotion.periodMs[index % fanBubbleMotion.periodMs.length];

  useEffect(() => {
    if (active) {
      progress.value = withRepeat(withTiming(1, { duration: periodMs / 2, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
    return () => cancelAnimation(progress);
  }, [active, periodMs, progress]);

  const floatingStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: active ? Math.sin(progress.value * Math.PI + phase) * horizontal : 0 },
      { translateY: active ? Math.cos(progress.value * Math.PI + phase) * vertical : 0 }],
  }));

  return <View testID={`fan-menu-row-${index}`} style={[styles.row, { alignItems: index % 2 === 0 ? 'flex-start' : 'flex-end',
    height: size, marginTop: index === 0 ? 0 : rowStep - size }]}>
    <Animated.View style={floatingStyle} shouldRasterizeIOS>
      <Pressable testID={item.testID} accessibilityRole="button" accessibilityLabel={item.label}
        accessibilityState={{ disabled: !!item.disabled }} disabled={item.disabled}
        onPress={item.onPress} style={({ pressed }) => [styles.bubble,
          { width: bubbleSize, height: bubbleSize, borderRadius: bubbleSize / 2 },
          item.disabled && styles.disabled, pressed && styles.pressed]}>
        <BubbleSheen id={`menu-${index}`} />
        <View pointerEvents="none" style={styles.content}>
          <SymbolView name={item.symbol} size={bubbleSize < 118 ? 28 : bubbleSize > 190 ? 42 : 34} tintColor="#123d6e" />
          <Text style={[styles.label, bubbleSize < 118 && styles.compactLabel,
            bubbleSize > 190 && styles.largeLabel]}>{item.label}</Text>
        </View>
      </Pressable>
    </Animated.View>
  </View>;
}

export function FanBubbleMenu({ items }: { items: FanMenuItem[] }) {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    const appSubscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReduceMotion(enabled); });
    return () => { mounted = false; appSubscription.remove(); motionSubscription.remove(); };
  }, []);

  const { size, rowStep } = fanBubbleLayout(width, height, fontScale, items.length, insets.top + insets.bottom);
  return <View testID="fan-bubble-menu" style={styles.menu}>
    {items.map((item, index) => <Bubble key={item.testID} item={item} index={index} size={size} rowStep={rowStep}
      active={foreground && !reduceMotion} />)}
  </View>;
}

const styles = StyleSheet.create({
  menu: { gap: 0, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  row: { width: '100%', justifyContent: 'center' },
  bubble: { backgroundColor: 'rgba(244, 252, 255, 0.26)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: '#42688a', shadowOpacity: 0.18,
    shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  content: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  label: { color: '#123d6e', fontSize: 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  compactLabel: { fontSize: 14 },
  largeLabel: { fontSize: 18 },
  disabled: { backgroundColor: 'rgba(230,238,244,0.75)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.82)' },
});
