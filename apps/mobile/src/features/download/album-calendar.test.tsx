import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AlbumEntry } from './album-filter';
import { AlbumCalendar, monthCells } from './album-calendar';

it('aligns days to Sunday and includes leap days and complete weeks', () => {
  const leap = monthCells(2024, 1);
  expect(leap.slice(0, 5)).toEqual([null, null, null, null, 1]);
  expect(leap.filter((day) => day !== null)).toHaveLength(29);
  expect(leap.length % 7).toBe(0);
  expect(monthCells(2026, 1)[0]).toBe(1);
  expect(monthCells(2026, 1).filter((day) => day !== null)).toHaveLength(28);
});

it('groups by capture day, opens that day and navigates between years without altering photos', async () => {
  const entries: AlbumEntry[] = ['p1', 'p2'].map((photoId) => ({
    intake: { intakeId: 'i1', createdAt: '2026-12-20T00:00:00Z', groupId: 'g1', groupName: 'A', idolIds: [], idolNames: [], photos: [] },
    photo: { photoId, intakeId: 'i1', capturedAt: '2026-12-14T12:00:00Z', expiresAt: '2026-12-27T00:00:00Z',
      status: 'received', localUri: `file:///${photoId}.jpg`, favorite: false, progressPercent: 100 },
  }));
  const onDate = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AlbumCalendar entries={entries} onDate={onDate} />); });
  const find = (id: string) => renderer.root.findAllByProps({ testID: id })[0];
  expect(find('album-calendar-day-2026-12-14').props.accessibilityLabel).toContain('2枚');
  expect(find('album-calendar-day-2026-12-15').props.disabled).toBe(true);
  await act(async () => { find('album-calendar-day-2026-12-14').props.onPress(); });
  expect(onDate).toHaveBeenCalledWith('2026-12-14');
  await act(async () => { find('album-calendar-next').props.onPress(); });
  expect(find('album-calendar-month').props.children).toBe('January 2027');
  await act(async () => { find('album-calendar-previous').props.onPress(); });
  expect(find('album-calendar-preview-2026-12-14').props.source.uri).toBe('file:///p1.jpg');
  await act(async () => { renderer.unmount(); });
});
