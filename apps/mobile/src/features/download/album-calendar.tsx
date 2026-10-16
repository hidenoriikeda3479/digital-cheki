import { useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { localCaptureDate, type AlbumEntry } from './album-filter';

const calendarFont = Platform.select({ ios: 'Hiragino Maru Gothic ProN', default: undefined });

export function monthCells(year: number, month: number): (number | null)[] {
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) =>
    index < offset || index >= offset + count ? null : index - offset + 1);
}

export function AlbumCalendar({ entries, onDate }: { entries: AlbumEntry[]; onDate(date: string): void }) {
  const [month, setMonth] = useState(() => {
    const latest = entries[0] ? new Date(entries[0].photo.capturedAt) : new Date();
    return new Date(latest.getFullYear(), latest.getMonth(), 1);
  });
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
  const photosByDay = new Map<string, AlbumEntry[]>();
  for (const entry of entries) {
    const date = localCaptureDate(entry.photo.capturedAt);
    if (date.startsWith(prefix)) photosByDay.set(date, [...(photosByDay.get(date) ?? []), entry]);
  }
  const cells = monthCells(year, monthIndex);
  const today = localCaptureDate(new Date().toISOString());
  return <View testID="album-calendar" style={styles.screen}>
    <View style={styles.header}>
      <Text testID="album-calendar-month" style={styles.month}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
      <Pressable testID="album-calendar-previous" accessibilityRole="button" accessibilityLabel="前の月"
        style={styles.arrow} onPress={() => setMonth(new Date(year, monthIndex - 1, 1))}>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={22} tintColor="#174d94" />
      </Pressable>
      <Pressable testID="album-calendar-next" accessibilityRole="button" accessibilityLabel="次の月"
        style={styles.arrow} onPress={() => setMonth(new Date(year, monthIndex + 1, 1))}>
        <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={22} tintColor="#174d94" />
      </Pressable>
    </View>
    <View style={styles.weekdays}>{['日', '月', '火', '水', '木', '金', '土'].map((label) =>
      <Text key={label} style={styles.weekday}>{label}</Text>)}</View>
    <ScrollView contentContainerStyle={styles.calendar}>
      {Array.from({ length: cells.length / 7 }, (_, row) => <View key={row} style={styles.week}>
        {cells.slice(row * 7, row * 7 + 7).map((day, column) => {
          const date = day ? `${prefix}${String(day).padStart(2, '0')}` : '';
          const photos = photosByDay.get(date) ?? [];
          return <Pressable key={column} testID={day ? `album-calendar-day-${date}` : undefined}
            accessibilityRole={photos.length ? 'button' : undefined}
            accessibilityLabel={day ? `${year}年${monthIndex + 1}月${day}日、${photos.length}枚` : undefined}
            disabled={!photos.length} onPress={() => onDate(date)} style={styles.day}>
            <Text style={[styles.dayNumber, date === today && styles.today]}>{day ?? ''}</Text>
            {!!photos.length && <View style={styles.preview}>
              {photos.length > 1 && <View style={styles.backPhoto} />}
              <Image testID={`album-calendar-preview-${date}`} source={{ uri: photos[0].photo.localUri! }}
                contentFit="contain" style={styles.photo} accessibilityLabel="撮影した写真" />
              <View style={styles.badge}><Text style={styles.badgeLabel}>{photos.length}</Text></View>
            </View>}
          </Pressable>;
        })}
      </View>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent', paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 18 },
  month: { flex: 1, fontSize: 23, fontFamily: calendarFont, fontWeight: '400', color: '#174d94', letterSpacing: 0.6 },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f4f9ff', alignItems: 'center', justifyContent: 'center' },
  weekdays: { flexDirection: 'row', paddingBottom: 12 }, weekday: { width: '14.285714%', textAlign: 'center', color: '#929ca8', fontFamily: calendarFont, fontWeight: '400' },
  calendar: { paddingBottom: 16 }, week: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#e8edf3' },
  day: { width: '14.285714%', minHeight: 96, paddingTop: 6, alignItems: 'center' },
  dayNumber: { fontSize: 14, fontFamily: calendarFont, color: '#929ca8', textAlign: 'center', minWidth: 27, paddingVertical: 3 },
  today: { backgroundColor: '#eaf4ff', color: '#174d94', fontWeight: '400', borderRadius: 10 },
  preview: { width: '86%', height: 62, alignItems: 'center', justifyContent: 'center' },
  photo: { width: '85%', height: '88%', transform: [{ rotate: '-6deg' }] },
  backPhoto: { position: 'absolute', width: '68%', height: '78%', backgroundColor: '#edf6ff', borderWidth: 1, borderColor: '#cfdfef', transform: [{ rotate: '9deg' }] },
  badge: { position: 'absolute', right: 0, bottom: 0, backgroundColor: '#174d94', minWidth: 20, minHeight: 20, borderRadius: 12, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeLabel: { color: '#fff', fontSize: 11, fontFamily: calendarFont, fontWeight: '400' },
});
