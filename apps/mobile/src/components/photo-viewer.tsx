import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Animated, Easing, FlatList, Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export interface ViewerPhoto { id: string; uri: string; thumbnailUri: string; label?: string }
const filmGeometry = { width: 40, height: 44, gap: 5, padding: 16 } as const;

export function PhotoViewer({ visible, onClose, photo, photos, onSelect, date, details, placeholder, ids, actions, busy = false, message }: {
  visible: boolean; onClose(): void; photo: ViewerPhoto | null; photos: ViewerPhoto[];
  onSelect(id: string): void; date?: string; details?: string; placeholder?: string;
  actions?: { favorite: boolean; localActionsAvailable: boolean; onSave(): void; onFavorite(): void; onDelete(): void };
  busy?: boolean; message?: string | null;
  ids: { modal: string; safe: string; close: string; image: string; filmstrip: string; filmPrefix: string;
    date?: string; details?: string; unavailable?: string };
}) {
  const [optionsVisible, setOptionsVisible] = useState(true);
  const [optionsMounted, setOptionsMounted] = useState(true);
  const [optionsOpacity] = useState(() => new Animated.Value(1));
  const showOptions = optionsVisible || !photo;
  useEffect(() => {
    let active = true;
    const animation = Animated.timing(optionsOpacity, { toValue: showOptions ? 1 : 0,
      duration: 400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => { if (active && finished && !showOptions) setOptionsMounted(false); });
    return () => { active = false; animation.stop(); };
  }, [showOptions, optionsOpacity]);
  const toggleOptions = () => {
    if (!optionsVisible) setOptionsMounted(true);
    setOptionsVisible((value) => !value);
  };
  const { width, height } = useWindowDimensions();
  const [dismissDistance] = useState(() => new Animated.Value(0));
  useEffect(() => {
    dismissDistance.setValue(0);
    return () => dismissDistance.stopAnimation();
  }, [visible, dismissDistance]);
  const [pageWidth, setPageWidth] = useState(width);
  const pager = useRef<FlatList<ViewerPhoto>>(null);
  const filmstrip = useRef<FlatList<ViewerPhoto>>(null);
  const pagerReady = useRef(false);
  const userPaging = useRef(false);
  const selectedIndex = Math.max(0, photos.findIndex((item) => item.id === photo?.id));
  const dismissSwipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => visible && !busy && gesture.numberActiveTouches === 1 &&
      gesture.dy > 24 && gesture.dy > Math.abs(gesture.dx) * 1.8,
    onPanResponderGrant: () => dismissDistance.stopAnimation(),
    onPanResponderMove: (_event, gesture) => dismissDistance.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (visible && !busy && gesture.dy >= 80 && gesture.dy > Math.abs(gesture.dx) * 1.8) {
        Animated.timing(dismissDistance, { toValue: height, duration: 220,
          easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) onClose(); });
      } else Animated.spring(dismissDistance, { toValue: 0, bounciness: 4, speed: 20, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(dismissDistance, { toValue: 0, bounciness: 4, speed: 20, useNativeDriver: true }).start();
    },
  }), [visible, busy, height, onClose, dismissDistance]);
  useEffect(() => {
    userPaging.current = false;
    if (visible && pagerReady.current) pager.current?.scrollToOffset({ offset: selectedIndex * pageWidth, animated: true });
    if (!visible) pagerReady.current = false;
  }, [selectedIndex, pageWidth, visible]);
  useEffect(() => {
    if (visible && optionsMounted && optionsVisible && photos.length > 1) {
      filmstrip.current?.scrollToIndex({ index: selectedIndex, viewPosition: 0.5, animated: true });
    }
  }, [selectedIndex, pageWidth, visible, optionsMounted, optionsVisible, photos.length]);
  return <Modal testID={ids.modal} visible={visible} transparent animationType="none" onRequestClose={onClose}
    onShow={() => {
      userPaging.current = false;
      pager.current?.scrollToOffset({ offset: selectedIndex * pageWidth, animated: false });
      pagerReady.current = true;
    }}>
    <View style={styles.modalRoot}>
    <Animated.View testID={`${ids.modal}-backdrop`} pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop,
      { opacity: dismissDistance.interpolate({ inputRange: [0, height * 0.5], outputRange: [1, 0], extrapolate: 'clamp' }) }]} />
    <Animated.View testID={`${ids.modal}-surface`} style={[styles.surface, {
      borderRadius: dismissDistance.interpolate({ inputRange: [0, 100], outputRange: [0, 24], extrapolate: 'clamp' }),
      transform: [{ translateY: dismissDistance },
        { scale: dismissDistance.interpolate({ inputRange: [0, height], outputRange: [1, 0.65], extrapolate: 'clamp' }) }],
    }]}>
    <SafeAreaProvider><SafeAreaView testID={ids.safe} edges={['top', 'bottom']} style={styles.viewer}>
      <View testID={`${ids.image}-dismiss-area`} style={[styles.photoArea, actions && styles.photoAreaWithActions]} {...dismissSwipe.panHandlers} onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (nextWidth > 0 && nextWidth !== pageWidth) setPageWidth(nextWidth);
      }}>
      {photo ? <FlatList ref={pager} testID={`${ids.image}-pager`} horizontal pagingEnabled
        showsHorizontalScrollIndicator={false} bounces={false} data={photos} scrollEnabled={!busy}
        style={styles.pager} initialScrollIndex={selectedIndex}
        onLayout={() => {
          pager.current?.scrollToOffset({ offset: selectedIndex * pageWidth, animated: false });
          pagerReady.current = true;
        }}
        onScrollBeginDrag={() => { userPaging.current = true; }}
        keyExtractor={(item) => item.id} getItemLayout={(_data, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
        extraData={photo.id} initialNumToRender={3} maxToRenderPerBatch={2} windowSize={3}
        onMomentumScrollEnd={(event) => {
          // Initial positioning and thumbnail navigation must not overwrite the tapped photo.
          if (!userPaging.current) return;
          userPaging.current = false;
          const index = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
          const next = photos[index];
          if (!busy && next && next.id !== photo.id) onSelect(next.id);
        }}
        renderItem={({ item }) => <Pressable testID={`${ids.image}-toggle-${item.id}`} accessibilityRole="button"
          accessibilityLabel={optionsVisible ? '写真のオプションを隠す' : '写真のオプションを表示'}
          onPress={toggleOptions} style={[styles.photoPage, { width: pageWidth }]}>
          <Image testID={item.id === photo.id ? ids.image : `${ids.image}-${item.id}`} source={{ uri: item.uri }}
            contentFit="contain" style={styles.fullImage} accessibilityLabel="写真" />
        </Pressable>} />
        : <View style={styles.fullImage}><Text testID={ids.unavailable} style={styles.viewerText}>{placeholder ?? '写真を表示できません。'}</Text></View>}
      </View>
      {(optionsMounted || !photo) && <Animated.View pointerEvents={showOptions ? 'auto' : 'none'}
        accessibilityElementsHidden={!showOptions} importantForAccessibility={showOptions ? 'auto' : 'no-hide-descendants'}
        style={[styles.headerOverlay, { opacity: optionsOpacity }]}><SafeAreaView edges={['top']}><View style={styles.header}>
        <Pressable testID={ids.close} accessibilityRole="button" accessibilityLabel="写真を閉じる"
          hitSlop={8} style={styles.close} disabled={busy} onPress={onClose}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor="#3185e5" />
        </Pressable>
        <View style={styles.heading}>
          {date && <Text testID={ids.date} style={styles.date}>{date}</Text>}
          {details && <Text testID={ids.details} style={styles.details}>{details}</Text>}
        </View>
        <View style={styles.balance} />
      </View></SafeAreaView></Animated.View>}
      {optionsMounted && (photos.length > 1 || actions) && <Animated.View pointerEvents={showOptions ? 'auto' : 'none'}
        accessibilityElementsHidden={!showOptions} importantForAccessibility={showOptions ? 'auto' : 'no-hide-descendants'}
        style={[styles.filmOverlay, { opacity: optionsOpacity }]}><SafeAreaView edges={['bottom']}>
        {photos.length > 1 && <FlatList ref={filmstrip} testID={ids.filmstrip} horizontal data={photos} style={styles.filmList}
        extraData={photo?.id} showsHorizontalScrollIndicator={false}
        getItemLayout={(_data, index) => ({ length: filmGeometry.width,
          offset: filmGeometry.padding + index * (filmGeometry.width + filmGeometry.gap), index })}
        onLayout={() => filmstrip.current?.scrollToIndex({ index: selectedIndex, viewPosition: 0.5, animated: false })}
        onContentSizeChange={() => filmstrip.current?.scrollToIndex({ index: selectedIndex, viewPosition: 0.5, animated: false })}
        keyExtractor={(item) => item.id} contentContainerStyle={styles.filmstrip}
        renderItem={({ item }) => <Pressable testID={`${ids.filmPrefix}${item.id}`} accessibilityRole="button"
          accessibilityLabel={`${item.id === photo?.id ? '表示中の写真' : '写真を表示'}${item.label ? ` ${item.label}` : ''}`}
          accessibilityState={{ selected: item.id === photo?.id }}
          style={[styles.filmTile, item.id === photo?.id && styles.filmSelected]}
          disabled={busy} onPress={() => onSelect(item.id)}>
          <Image source={{ uri: item.thumbnailUri }} recyclingKey={item.id} contentFit="cover" style={styles.filmImage} />
        </Pressable>} />}
        {actions && <View testID={`${ids.image}-actions`} style={styles.actions}>
          <Pressable testID={`${ids.image}-save`} accessibilityRole="button" accessibilityLabel="写真アプリに保存"
            disabled={busy || !actions.localActionsAvailable} onPress={actions.onSave} style={styles.actionButton}>
            <SymbolView name={{ ios: 'square.and.arrow.down', android: 'download', web: 'download' }} size={27} tintColor="#3185e5" />
          </Pressable>
          <Pressable testID={`${ids.image}-favorite`} accessibilityRole="button" accessibilityLabel={actions.favorite ? 'いいねを解除' : 'いいねする'}
            accessibilityState={{ selected: actions.favorite, disabled: busy }} disabled={busy} onPress={actions.onFavorite} style={[styles.actionButton, styles.favoriteButton]}>
            <SymbolView name={{ ios: actions.favorite ? 'heart.fill' : 'heart', android: actions.favorite ? 'favorite' : 'favorite_border',
              web: actions.favorite ? 'favorite' : 'favorite_border' }} size={28} tintColor="#3185e5" />
          </Pressable>
          <Pressable testID={`${ids.image}-delete`} accessibilityRole="button" accessibilityLabel="写真を削除"
            disabled={busy || !actions.localActionsAvailable} onPress={actions.onDelete} style={styles.actionButton}>
            <SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={27} tintColor="#3185e5" />
          </Pressable>
        </View>}
        {message && <Text testID={`${ids.image}-message`} accessibilityRole="alert" style={styles.message}>{message}</Text>}
        </SafeAreaView></Animated.View>}
    </SafeAreaView></SafeAreaProvider>
    </Animated.View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 }, backdrop: { backgroundColor: '#050505' }, surface: { flex: 1, overflow: 'hidden' },
  viewer: { flex: 1, backgroundColor: '#050505' },
  photoArea: { flex: 1, marginTop: 64, marginBottom: 40 }, photoAreaWithActions: { marginBottom: 72 },
  pager: { flex: 1 }, photoPage: { height: '100%' },
  headerOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { minHeight: 76, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10,
    flexDirection: 'row', alignItems: 'center' },
  close: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#242424', alignItems: 'center', justifyContent: 'center' },
  balance: { width: 48 }, heading: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  date: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  details: { color: '#c7c7c7', fontSize: 14, textAlign: 'center', marginTop: 2 },
  viewerText: { color: '#fff', fontSize: 16 }, fullImage: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' },
  filmstrip: { paddingHorizontal: filmGeometry.padding, paddingVertical: 4, gap: filmGeometry.gap, alignItems: 'center' },
  filmOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0 }, filmList: { flexGrow: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingTop: 4, paddingBottom: 4 },
  actionButton: { width: 46, height: 46, borderRadius: 24, backgroundColor: '#242424dd', alignItems: 'center', justifyContent: 'center' },
  favoriteButton: { width: 110 }, message: { color: '#fff', textAlign: 'center', fontSize: 12, paddingHorizontal: 20, paddingBottom: 4 },
  filmTile: { width: filmGeometry.width, height: filmGeometry.height, padding: 2, borderRadius: 5 },
  filmSelected: { borderColor: '#fff', borderWidth: 2 }, filmImage: { width: '100%', height: '100%', borderRadius: 3 },
});
