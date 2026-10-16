import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MockUploadScenario } from '@/services/contracts/upload';
import type { UploadController } from './upload-controller';

const options: { value: MockUploadScenario; label: string }[] = [
  { value: 'normal', label: '正常' }, { value: 'delayed', label: '遅延' },
  { value: 'always-fail', label: '毎回失敗' }, { value: 'fail-three', label: '3回失敗→次回成功' },
  { value: 'save-fail', label: '保存失敗' }, { value: 'lost-response', label: '完了応答喪失' },
];
export function MockUploadControlsPanel({ controller, photoId, selected, disabled }: { controller: UploadController; photoId: string; selected?: MockUploadScenario; disabled: boolean }) {
  return <View style={styles.panel}>
    <Text>仮転送の試験設定（開発用・この写真のみ）</Text>
    <Text>{selected ? `選択：${options.find((item) => item.value === selected)?.label}` : '未選択：通常設定または保存済み設定'}</Text>
    <View style={styles.options}>{options.map(({ value, label }) => <Pressable key={value} testID={`mock-upload-${value}-${photoId}`}
      accessibilityRole="button" disabled={disabled} style={styles.option}
      onPress={() => { void controller.setScenario(photoId, value); }}><Text>{label}</Text></Pressable>)}</View>
  </View>;
}
const styles = StyleSheet.create({ panel: { gap: 6 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { padding: 8, borderWidth: 1, borderColor: '#888', borderRadius: 6 } });
