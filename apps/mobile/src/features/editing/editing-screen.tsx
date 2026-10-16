import { Canvas, Circle, Image as SkiaImage, Path, Rect as SkiaRect, useImage } from '@shopify/react-native-skia';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CapturePhoto } from '@/services/contracts/capture';
import type { EditElement, FrameId, Point, StampId } from '@/services/contracts/editing';
import type { EditingController } from './editing-controller';
import { EDITING_PREVIEW } from './editing-config';
import { CHEKI_MINI } from './cheki-format';
import { containRect, toNormalized, type Rect } from './geometry';
import { elementGeometry, imagePlacement } from './composition-geometry';

function Element({ element, rect }: { element: EditElement; rect: Rect }) {
  const shape = elementGeometry(element, rect);
  if (shape.kind === 'stroke') {
    return <Path path={shape.path} color={shape.color} style="stroke" strokeWidth={shape.width} strokeCap="round" strokeJoin="round" />;
  }
  if (shape.kind === 'circle') {
    return <Circle cx={shape.cx} cy={shape.cy} r={shape.radius} color={shape.color} />;
  }
  return <Path path={shape.path} color={shape.color} />;
}

export function EditingScreen({ controller, photos, onComplete }: {
  controller: EditingController; photos: CapturePhoto[]; onComplete: () => Promise<boolean>;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const photo = state.photo;
  const image = useImage(photo?.originalUri ?? null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<'pen' | StampId>('pen');
  const [color, setColor] = useState<string>(EDITING_PREVIEW.penColors[0]);
  const [width, setWidth] = useState<number>(EDITING_PREVIEW.penWidths[1]);
  const [panel, setPanel] = useState<'pen' | 'stamp' | 'frame' | 'quality' | 'photos' | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [confirmFrame, setConfirmFrame] = useState<FrameId | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(false);
  if (!photo) return null;
  const rect = size.width && size.height ? containRect(CHEKI_MINI.outer.width, CHEKI_MINI.outer.height, size.width, size.height) : null;
  const edit = state.edit;
  const currentIndex = photos.findIndex((item) => item.id === photo.id);
  function point(event: GestureResponderEvent) {
    return rect ? toNormalized(event.nativeEvent.locationX, event.nativeEvent.locationY, rect) : null;
  }
  function start(event: GestureResponderEvent) {
    if (state.busy || completing || !edit || confirmFrame) return;
    const p = point(event);
    if (p && tool === 'pen') setDraft([p]);
  }
  function move(event: GestureResponderEvent) {
    if (tool !== 'pen' || !draft.length || state.busy) return;
    const p = point(event);
    if (p) setDraft((prior) => [...prior, p]);
  }
  async function finish(event: GestureResponderEvent) {
    if (state.busy || completing || !edit || confirmFrame) return;
    const p = point(event);
    if (tool === 'pen' && draft.length) {
      const points = p ? [...draft, p] : draft;
      await controller.addStroke(points, color, width);
      setDraft([]);
    } else if (tool !== 'pen' && p) {
      await controller.addStamp(p, tool, color, EDITING_PREVIEW.stampSize);
    }
  }
  function switchPhoto(next: CapturePhoto) {
    if (state.busy || completing || confirmFrame) return;
    setDraft([]); setPanel(null); void controller.open(next);
  }
  async function complete() {
    if (state.busy || completing || !edit || draft.length || confirmFrame) return;
    setCompleting(true); setCompleteError(false);
    try {
      if (!(await controller.saveDrafts())) { setCompleteError(true); return; }
      if (await onComplete()) controller.close();
      else setCompleteError(true);
    } catch { setCompleteError(true); }
    finally { setCompleting(false); }
  }
  const inner = rect && edit ? imagePlacement(edit, rect) : rect;
  const selectColor = <View style={styles.colorRow}>{EDITING_PREVIEW.penColors.map((item, index) =>
    <Pressable key={item} testID={`color-${index}`} accessibilityLabel={`色 ${index + 1}`} accessibilityRole="button"
      style={[styles.color, { backgroundColor: item, borderWidth: color === item ? 3 : 1 }]} onPress={() => setColor(item)} />)}</View>;
  const icon = (id: string, label: string, ios: SFSymbol, android: AndroidSymbol, active: boolean, onPress: () => void, disabled = false) =>
    <Pressable testID={id} accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      style={[styles.toolButton, active && styles.toolActive, disabled && styles.disabled]} onPress={onPress}>
      <SymbolView name={{ ios, android, web: android }} size={26} tintColor="#fff" />
      <Text style={styles.toolLabel}>{label}</Text>
    </Pressable>;
  return <SafeAreaView style={styles.safe}>
    <View testID="editing-stage" style={styles.stage}>
      <View testID="edit-canvas" style={styles.canvasBox} onLayout={(event) => setSize(event.nativeEvent.layout)}
        onStartShouldSetResponder={() => !!edit && !state.busy && !completing && !confirmFrame}
        onMoveShouldSetResponder={() => !!edit && !state.busy && !completing && !confirmFrame}
        onResponderGrant={start} onResponderMove={move} onResponderRelease={(event) => { void finish(event); }}
        onResponderTerminate={() => setDraft([])}>
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          {rect && <SkiaRect x={rect.x} y={rect.y} width={rect.width} height={rect.height} color="white" />}
          {image && inner && <SkiaImage image={image} x={inner.x} y={inner.y} width={inner.width} height={inner.height} fit="cover" />}
          {rect && edit?.elements.map((element) => <Element key={element.id} element={element} rect={rect} />)}
          {rect && draft.length > 0 && <Element element={{ kind: 'stroke', id: 'draft', color, width, points: draft }} rect={rect} />}
        </Canvas>
        {!image && <Text style={styles.loadingImage}>写真を読み込み中</Text>}
      </View>
      <View style={styles.topBar} pointerEvents="box-none">
        <Text style={styles.photoCount}>{currentIndex + 1} / {photos.length}枚目</Text>
        <Pressable testID="complete-editing" accessibilityRole="button" disabled={state.busy || completing || !edit || !!draft.length || !!confirmFrame}
          style={[styles.completeButton, (state.busy || completing || !edit || !!draft.length || !!confirmFrame) && styles.disabled]}
          onPress={() => { void complete(); }}><Text style={styles.completeText}>完了</Text></Pressable>
      </View>
      {(state.busy || completing || state.error || completeError) && <View style={styles.statusBox}>
        {state.busy && <ActivityIndicator testID="edit-saving" accessibilityLabel="編集状態を読み込み・保存中" color="#fff" />}
        {completing && <ActivityIndicator testID="edit-completing" accessibilityLabel="完成画像を端末に保存中" color="#fff" />}
        {state.error && <Text testID="edit-error" accessibilityRole="alert" style={styles.statusText}>編集状態を読み込み・保存できませんでした。{state.error}</Text>}
        {completeError && <Text testID="edit-complete-error" accessibilityRole="alert" style={styles.statusText}>完成画像を保存できませんでした。空き容量を確認して、もう一度「完了」を押してください。</Text>}
      </View>}
      {panel && <View testID={`edit-panel-${panel}`} style={styles.optionPanel}>
        {panel === 'pen' && <>
          <Text style={styles.panelTitle}>ペン</Text>
          <Pressable testID="tool-pen" accessibilityRole="button" style={[styles.chip, tool === 'pen' && styles.active]}
            onPress={() => { setTool('pen'); setPanel(null); }}><Text style={styles.chipText}>ペンで描く</Text></Pressable>
          {selectColor}
          <View style={styles.row}>{EDITING_PREVIEW.penWidths.map((item, index) => <Pressable key={item} testID={`width-${index}`} accessibilityRole="button"
            style={[styles.chip, width === item && styles.active]} onPress={() => setWidth(item)}><Text style={styles.chipText}>太さ {index + 1}</Text></Pressable>)}</View>
        </>}
        {panel === 'stamp' && <>
          <Text style={styles.panelTitle}>スタンプ</Text>
          <View style={styles.row}>{(['heart', 'star', 'circle'] as const).map((item) => <Pressable key={item} accessibilityRole="button" testID={`tool-${item}`}
            style={[styles.chip, tool === item && styles.active]} onPress={() => { setTool(item); setPanel(null); }}><Text style={styles.chipText}>{({ heart: 'ハート', star: '星', circle: '丸' })[item]}</Text></Pressable>)}</View>
          {selectColor}
        </>}
        {panel === 'frame' && <>
          <Text style={styles.panelTitle}>フレーム</Text>
          <View style={styles.row}>{(['none', 'white'] as const).map((frame) => <Pressable key={frame} testID={`frame-${frame}`} accessibilityRole="button" disabled={state.busy || !edit}
            style={[styles.chip, edit?.frame === frame && styles.active]} onPress={() => {
              if (edit?.frame === frame) return;
              if (edit?.elements.length) setConfirmFrame(frame); else void controller.setFrame(frame);
            }}><Text style={styles.chipText}>{frame === 'none' ? 'なし' : '白'}</Text></Pressable>)}</View>
        </>}
        {panel === 'quality' && <>
          <Text style={styles.panelTitle}>画質</Text>
          <View style={styles.row}>{(['cheki', 'high'] as const).map((quality) => <Pressable key={quality} testID={`quality-${quality}`} accessibilityRole="button" disabled={state.busy || !edit}
            style={[styles.chip, edit?.quality === quality && styles.active]} onPress={() => { void controller.setQuality(quality); }}><Text style={styles.chipText}>{quality === 'cheki' ? 'チェキ相当' : '高画質'}</Text></Pressable>)}</View>
        </>}
        {panel === 'photos' && <>
          <Text style={styles.panelTitle}>写真を切り替える</Text>
          <View style={styles.row}>
            <Pressable testID="edit-previous-photo" accessibilityRole="button" disabled={currentIndex <= 0 || state.busy}
              style={[styles.chip, currentIndex <= 0 && styles.disabled]} onPress={() => switchPhoto(photos[currentIndex - 1])}><Text style={styles.chipText}>前の写真</Text></Pressable>
            <Text style={styles.panelTitle}>{currentIndex + 1} / {photos.length}</Text>
            <Pressable testID="edit-next-photo" accessibilityRole="button" disabled={currentIndex >= photos.length - 1 || state.busy}
              style={[styles.chip, currentIndex >= photos.length - 1 && styles.disabled]} onPress={() => switchPhoto(photos[currentIndex + 1])}><Text style={styles.chipText}>次の写真</Text></Pressable>
          </View>
        </>}
      </View>}
      <View style={styles.toolbar}>
        {icon('open-pen-options', 'ペン', 'pencil', 'edit', panel === 'pen', () => { setTool('pen'); setPanel(panel === 'pen' ? null : 'pen'); })}
        {icon('open-stamp-options', 'スタンプ', 'heart', 'favorite', panel === 'stamp', () => setPanel(panel === 'stamp' ? null : 'stamp'))}
        {icon('open-frame-options', 'フレーム', 'square', 'crop_square', panel === 'frame', () => setPanel(panel === 'frame' ? null : 'frame'))}
        {icon('open-quality-options', '画質', 'slider.horizontal.3', 'tune', panel === 'quality', () => setPanel(panel === 'quality' ? null : 'quality'))}
        {icon('open-photo-options', '写真', 'photo.on.rectangle', 'photo_library', panel === 'photos', () => setPanel(panel === 'photos' ? null : 'photos'), photos.length < 2)}
        {icon('undo-edit', '取り消す', 'arrow.uturn.backward', 'undo', false, () => { void controller.undo(); }, !edit?.elements.length || state.busy)}
      </View>
      {confirmFrame && <View testID="frame-confirm" style={styles.confirmOverlay}>
        <View style={styles.confirm}>
          <Text style={styles.statusText}>フレームを変更すると、この写真の落書きと取り消し履歴を消去します。</Text>
          <View style={styles.row}>
            <Pressable testID="cancel-frame" accessibilityRole="button" style={styles.chip} onPress={() => setConfirmFrame(null)}><Text style={styles.chipText}>キャンセル</Text></Pressable>
            <Pressable testID="confirm-frame" accessibilityRole="button" style={[styles.chip, styles.active]} onPress={() => { const next = confirmFrame; setConfirmFrame(null); void controller.setFrame(next); }}><Text style={styles.chipText}>変更する</Text></Pressable>
          </View>
        </View>
      </View>}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111' }, stage: { flex: 1, position: 'relative' },
  canvasBox: { flex: 1, width: '100%', backgroundColor: '#222', position: 'relative' },
  loadingImage: { position: 'absolute', alignSelf: 'center', top: '45%', color: '#fff' },
  topBar: { position: 'absolute', top: 8, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  photoCount: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 18, fontWeight: '600' },
  completeButton: { minWidth: 64, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 22, backgroundColor: '#174c8f' },
  completeText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  statusBox: { position: 'absolute', top: 64, left: 12, right: 12, borderRadius: 10, padding: 10, gap: 8, backgroundColor: 'rgba(0,0,0,0.8)' },
  statusText: { color: '#fff', fontSize: 14 },
  toolbar: { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: 'rgba(0,0,0,0.82)' },
  toolButton: { minWidth: 48, minHeight: 62, justifyContent: 'center', alignItems: 'center', gap: 2, borderRadius: 8 },
  toolActive: { backgroundColor: 'rgba(34,113,210,0.75)' }, toolLabel: { color: '#fff', fontSize: 10 },
  optionPanel: { position: 'absolute', bottom: 76, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 12, gap: 10, backgroundColor: 'rgba(0,0,0,0.82)' },
  panelTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  colorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3 },
  chip: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderRadius: 8, backgroundColor: '#555', justifyContent: 'center' },
  active: { backgroundColor: '#174c8f' }, chipText: { color: '#fff' }, disabled: { opacity: 0.4 },
  color: { flex: 1, maxWidth: 40, height: 34, borderColor: '#ddd', borderRadius: 6 },
  confirmOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.62)' },
  confirm: { padding: 18, borderRadius: 12, gap: 16, backgroundColor: '#262626' },
});
