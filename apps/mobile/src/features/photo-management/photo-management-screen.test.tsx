import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import type { ManagedIntake, ManagedPhoto, LocalPhotoManagementService } from '@/services/contracts/photo-management';
import { PhotoManagementScreen } from './photo-management-screen';

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#111', background: '#fff', backgroundElement: '#eee' }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: (props: object) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const React = require('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
    const { View } = require('react-native');
    return React.createElement(View, props);
  },
}));
jest.mock('expo-image', () => ({ Image: (props: object) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
  const { View } = require('react-native');
  return React.createElement(View, props);
} }));

function photo(id: string, intakeId: string, capturedAt: string, deleted = false): ManagedPhoto {
  return { photo: { id, intakeId, capturedAt, width: 800, height: 1200, format: 'jpg',
    originalRef: `photos/${id}.jpg`, thumbnailRef: `photos/thumb-${id}.jpg`,
    originalUri: `file:///original-${id}.jpg`, thumbnailUri: `file:///thumb-${id}.jpg` },
  displayUri: id === 'a2' ? 'file:///finished-a2.jpg' : undefined,
  localDeleted: deleted, deletionPending: false };
}
function intake(id: string, idolId: string, status: ManagedIntake['uploadStatus'], photos: ManagedPhoto[]): ManagedIntake {
  return { intake: { id, groupId: 'group-a', recipientRef: 'recipient-a', idolIds: [idolId], acceptedAt: photos[0].photo.capturedAt },
    recipientName: 'テストファンA', idolNames: [idolId === 'idol-a' ? 'アイドルA' : 'アイドルB'], uploadStatus: status, photos };
}
const findIn = (renderer: ReactTestRenderer, id: string) => renderer.root.findAll((item) =>
  item.props.testID === id && typeof item.type !== 'string');

it('shows live intake covers, omits deleted photos, and opens individual photos without per-photo status icons', async () => {
  let rows = [intake('intake-a', 'idol-a', 'uploaded', [photo('a1', 'intake-a', '2026-09-25T00:00:00.000Z'),
    photo('a2', 'intake-a', '2026-09-25T01:00:00.000Z'), photo('a3', 'intake-a', '2026-09-25T02:00:00.000Z', true)]),
  intake('intake-b', 'idol-b', 'unsent', [photo('b1', 'intake-b', '2026-09-24T00:00:00.000Z')])];
  const deleteUploaded = jest.fn(async (_credential: string, _intakeId: string, id: string) => {
    rows = rows.map((entry) => ({ ...entry, photos: entry.photos.map((item) => item.photo.id === id ? { ...item, localDeleted: true } : item) }));
  });
  const service: LocalPhotoManagementService = { list: async () => ({ intakes: rows, lowSpace: false }),
    retryUpload: async () => { throw Error('unused'); }, deleteUploaded };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoManagementScreen credential="group-token" service={service} onBack={() => {}} />); });
  const find = (id: string) => findIn(renderer, id);
  expect(renderer.root.findAllByType(Text).some((item) => item.props.children === '写真')).toBe(false);
  expect(find('management-select-mode').length).toBeGreaterThan(0);
  expect(find('management-intake-grid')[0].props.numColumns).toBe(3);
  expect(find('management-count-intake-a').length).toBeGreaterThan(0);
  expect(find('management-status-intake-a')[0].props.accessibilityLabel).toBe('送信済み');
  await act(async () => { find('management-intake-intake-a')[0].props.onPress(); });
  expect(find('management-photo-grid')[0].props.numColumns).toBe(3);
  expect(find('management-photo-a1').length).toBeGreaterThan(0);
  expect(find('management-photo-a2').length).toBeGreaterThan(0);
  expect(find('management-photo-a3')).toHaveLength(0);
  expect(find('management-status-intake-a')).toHaveLength(0);
  await act(async () => { find('management-photo-a1')[0].props.onPress(); });
  expect(find('management-full-image')[0].props.source.uri).toBe('file:///original-a1.jpg');
  expect(find('management-photo-close')[0].props.accessibilityLabel).toBe('写真を閉じる');
  expect(find('management-photo-close')[0].props.style).toMatchObject({ width: 48, height: 48 });
  expect(find('management-viewer-safe')[0].props.edges).toEqual(['top', 'bottom']);
  expect(find('management-photo-date')).toHaveLength(1);
  expect(JSON.stringify(find('management-photo-details')[0].props.children)).toContain('テストファンA');
  expect(find('management-filmstrip')[0].props.data).toHaveLength(2);
  await act(async () => { find('management-film-a2')[0].props.onPress(); });
  expect(find('management-full-image')[0].props.source.uri).toBe('file:///finished-a2.jpg');
  await act(async () => { find('management-film-a1')[0].props.onPress(); });
  expect(find('local-delete-a1')).toHaveLength(0);
  await act(async () => { find('management-photo-close')[0].props.onPress(); });
  await act(async () => { find('management-select-mode')[0].props.onPress(); });
  await act(async () => { find('management-photo-a1')[0].props.onPress(); });
  await act(async () => { find('management-delete-selected')[0].props.onPress(); });
  await act(async () => { find('management-batch-run')[0].props.onPress(); });
  expect(deleteUploaded).toHaveBeenCalledWith('group-token', 'intake-a', 'a1');
  expect(find('management-photo-a1')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('does not flash an empty result while the photo list is still loading', async () => {
  let resolveList!: (value: { intakes: ManagedIntake[]; lowSpace: boolean }) => void;
  const service: LocalPhotoManagementService = {
    list: () => new Promise((resolve) => { resolveList = resolve; }),
    retryUpload: async () => { throw Error('unused'); },
    deleteUploaded: async () => { throw Error('unused'); },
  };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoManagementScreen credential="group-token" service={service} onBack={() => {}} />); });
  const overlay = renderer.root.findAll((item) => item.props.testID === 'management-busy-overlay')[0];
  expect(overlay.props.style).toMatchObject({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center' });
  expect(renderer.root.findAll((item) => item.props.testID === 'management-busy').length).toBeGreaterThan(0);
  expect(renderer.root.findAllByType(Text).some((item) => item.props.children === '0件の撮影受付')).toBe(false);
  const grid = renderer.root.findAll((item) => item.props.testID === 'management-intake-grid')[0];
  expect(grid.props.ListEmptyComponent).toBeNull();
  await act(async () => { resolveList({ intakes: [], lowSpace: false }); });
  expect(renderer.root.findAll((item) => item.props.testID === 'management-intake-grid')[0].props.ListEmptyComponent).not.toBeNull();
  await act(async () => { renderer.unmount(); });
});

it('filters by idol and capture date, sorts by date, and retries only the chosen intake', async () => {
  let status: ManagedIntake['uploadStatus'] = 'failed';
  const first = intake('intake-a', 'idol-a', 'uploaded', [photo('a1', 'intake-a', '2026-09-25T12:00:00.000Z')]);
  const second = intake('intake-b', 'idol-b', status, [photo('b1', 'intake-b', '2026-09-24T12:00:00.000Z')]);
  const retryUpload = jest.fn(async (_credential: string, id: string) => { status = 'uploaded';
    return { intakeId: id, status, photoCount: 1, failureCount: 0 }; });
  const service: LocalPhotoManagementService = { list: async () => ({ intakes: [first, { ...second, uploadStatus: status }], lowSpace: false }),
    retryUpload, deleteUploaded: async () => { throw Error('unused'); } };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoManagementScreen credential="group-token" service={service} onBack={() => {}} />); });
  const find = (id: string) => findIn(renderer, id);
  expect(find('management-intake-grid')[0].props.data.map((item: ManagedIntake) => item.intake.id)).toEqual(['intake-a', 'intake-b']);
  await act(async () => { find('management-sort')[0].props.onPress(); });
  expect(find('management-intake-grid')[0].props.data.map((item: ManagedIntake) => item.intake.id)).toEqual(['intake-b', 'intake-a']);
  await act(async () => { find('management-search')[0].props.onPress(); });
  await act(async () => { find('management-idol-idol-b')[0].props.onPress();
    find('management-date-2026-09-24')[0].props.onPress(); find('management-search-apply')[0].props.onPress(); });
  expect(find('management-intake-grid')[0].props.data.map((item: ManagedIntake) => item.intake.id)).toEqual(['intake-b']);
  const event = { stopPropagation: jest.fn() };
  await act(async () => { find('management-status-intake-b')[0].props.onPress(event); });
  expect(event.stopPropagation).toHaveBeenCalled();
  expect(retryUpload).toHaveBeenCalledWith('group-token', 'intake-b');
  expect(find('management-status-intake-b')[0].props.accessibilityLabel).toBe('送信済み');
  await act(async () => { find('management-search')[0].props.onPress(); });
  await act(async () => { find('management-search-clear')[0].props.onPress(); });
  await act(async () => { find('management-search-apply')[0].props.onPress(); });
  expect(find('management-intake-grid')[0].props.data).toHaveLength(2);
  await act(async () => { renderer.unmount(); });
});

it('keeps a deletion-recovery tile when a file removal fails', async () => {
  let row = photo('a1', 'intake-a', '2026-09-25T00:00:00.000Z');
  const service: LocalPhotoManagementService = {
    list: async () => ({ intakes: [intake('intake-a', 'idol-a', 'uploaded', [row])], lowSpace: false }),
    retryUpload: async () => { throw Error('unused'); },
    deleteUploaded: async () => { row = { ...row, deletionPending: true }; throw Error('disk unavailable'); },
  };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoManagementScreen credential="group-token" service={service} onBack={() => {}} />); });
  const find = (id: string) => findIn(renderer, id);
  await act(async () => { find('management-intake-intake-a')[0].props.onPress(); });
  await act(async () => { find('management-select-mode')[0].props.onPress(); });
  await act(async () => { find('management-photo-a1')[0].props.onPress(); });
  await act(async () => { find('management-delete-selected')[0].props.onPress(); });
  await act(async () => { find('management-batch-run')[0].props.onPress(); });
  expect(find('management-error').length).toBeGreaterThan(0);
  expect(find('management-full-image')).toHaveLength(0);
  expect(find('management-photo-a1').length).toBeGreaterThan(0);
  await act(async () => { renderer.unmount(); });
});

it('returns a single cover photo directly to the intake grid, while a stacked photo returns to its photo grid', async () => {
  const rows = [intake('single', 'idol-a', 'uploaded', [photo('s1', 'single', '2026-09-25T00:00:00.000Z')]),
    intake('stack', 'idol-a', 'uploaded', [photo('m1', 'stack', '2026-09-24T00:00:00.000Z'),
      photo('m2', 'stack', '2026-09-24T01:00:00.000Z')])];
  const service: LocalPhotoManagementService = { list: async () => ({ intakes: rows, lowSpace: false }),
    retryUpload: async () => { throw Error('unused'); }, deleteUploaded: async () => { throw Error('unused'); } };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoManagementScreen credential="group-token" service={service} onBack={() => {}} />); });
  const find = (id: string) => findIn(renderer, id);
  await act(async () => { find('management-intake-single')[0].props.onPress(); });
  expect(find('management-full-image').length).toBeGreaterThan(0);
  await act(async () => { find('management-photo-close')[0].props.onPress(); });
  expect(find('management-intake-grid').length).toBeGreaterThan(0);
  expect(find('management-photo-grid')).toHaveLength(0);
  await act(async () => { find('management-intake-stack')[0].props.onPress(); });
  await act(async () => { find('management-photo-m1')[0].props.onPress(); });
  await act(async () => { find('management-photo-close')[0].props.onPress(); });
  expect(find('management-photo-grid').length).toBeGreaterThan(0);
  await act(async () => { renderer.unmount(); });
});

it('selects multiple intakes for confirmed batch send and uploaded photos for confirmed local deletion', async () => {
  let rows = [intake('sent', 'idol-a', 'uploaded', [photo('a1', 'sent', '2026-09-25T00:00:00.000Z'),
    photo('a2', 'sent', '2026-09-25T01:00:00.000Z')]),
  intake('pending-a', 'idol-a', 'failed', [photo('b1', 'pending-a', '2026-09-24T00:00:00.000Z')]),
  intake('pending-b', 'idol-b', 'unsent', [photo('c1', 'pending-b', '2026-09-23T00:00:00.000Z')])];
  const retryUpload = jest.fn(async (_credential: string, id: string) => {
    rows = rows.map((item) => item.intake.id === id ? { ...item, uploadStatus: 'uploaded' as const } : item);
    return { intakeId: id, status: 'uploaded' as const, photoCount: 1, failureCount: 0 };
  });
  const deleteUploaded = jest.fn(async (_credential: string, _intakeId: string, id: string) => {
    rows = rows.map((item) => ({ ...item, photos: item.photos.map((entry) => entry.photo.id === id
      ? { ...entry, localDeleted: true } : entry) }));
  });
  const deleteUploadedBatch = jest.fn(async (credential: string, photos: { intakeId: string; photoId: string }[]) => {
    for (const item of photos) await deleteUploaded(credential, item.intakeId, item.photoId);
  });
  const service: LocalPhotoManagementService = { list: async () => ({ intakes: rows, lowSpace: false }), retryUpload, deleteUploaded,
    deleteUploadedBatch };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoManagementScreen credential="group-token" service={service} onBack={() => {}} />); });
  const find = (id: string) => findIn(renderer, id);
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  await press('management-select-mode');
  await press('management-intake-pending-a'); await press('management-intake-pending-b');
  expect(find('management-selected-count')[0].props.children).toEqual([2, '件', '選択']);
  expect(StyleSheet.flatten(find('management-selected-count')[0].props.style)).toMatchObject({ flex: 1, textAlign: 'center' });
  expect(StyleSheet.flatten(find('management-send-selected')[0].props.style).flex).toBe(1);
  expect(StyleSheet.flatten(find('management-delete-selected')[0].props.style).flex).toBe(1);
  expect(find('management-send-selected')[0].findByType(Text).props.children).toBe('送信');
  expect(find('management-delete-selected')[0].findByType(Text).props.children).toBe('削除');
  expect(find('management-delete-selected')[0].props.disabled).toBe(true);
  await press('management-send-selected');
  expect(find('management-batch-confirm')[0].props.visible).toBe(true);
  await press('management-batch-cancel');
  expect(retryUpload).not.toHaveBeenCalled();
  await press('management-send-selected');
  await press('management-batch-run');
  expect(retryUpload.mock.calls.map((call) => call[1])).toEqual(['pending-a', 'pending-b']);
  expect(find('management-intake-pending-a').length).toBeGreaterThan(0);
  await press('management-select-mode');
  await press('management-intake-sent');
  expect(find('management-send-selected')[0].props.disabled).toBe(true);
  await press('management-delete-selected');
  await press('management-batch-run');
  expect(deleteUploaded.mock.calls.map((call) => call[2])).toEqual(['a1', 'a2']);
  expect(deleteUploadedBatch).toHaveBeenCalledTimes(1);
  expect(find('management-intake-sent')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('selects individual photos within a stacked intake and keeps unsent photos protected from deletion', async () => {
  let rows = [intake('sent', 'idol-a', 'uploaded', [photo('a1', 'sent', '2026-09-25T00:00:00.000Z'),
    photo('a2', 'sent', '2026-09-25T01:00:00.000Z'), photo('a3', 'sent', '2026-09-25T02:00:00.000Z')]),
  intake('pending', 'idol-b', 'failed', [photo('b1', 'pending', '2026-09-24T00:00:00.000Z')])];
  const deleteUploaded = jest.fn(async (_credential: string, _intakeId: string, id: string) => {
    rows = rows.map((item) => ({ ...item, photos: item.photos.map((entry) => entry.photo.id === id
      ? { ...entry, localDeleted: true } : entry) }));
  });
  const retryUpload = jest.fn(async () => { throw Error('unused'); });
  const service: LocalPhotoManagementService = { list: async () => ({ intakes: rows, lowSpace: false }), retryUpload, deleteUploaded };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<PhotoManagementScreen credential="group-token" service={service} onBack={() => {}} />); });
  const find = (id: string) => findIn(renderer, id);
  const press = async (id: string) => { await act(async () => { find(id)[0].props.onPress(); }); };
  await press('management-select-mode');
  await press('management-intake-sent'); await press('management-intake-pending');
  expect(find('management-send-selected')[0].props.disabled).toBe(true);
  expect(find('management-delete-selected')[0].props.disabled).toBe(true);
  await press('management-select-mode');
  await press('management-intake-sent');
  await press('management-select-mode');
  await press('management-photo-a1'); await press('management-photo-a3');
  expect(find('management-selected-count')[0].props.children).toEqual([2, '枚', '選択']);
  await press('management-delete-selected'); await press('management-batch-run');
  expect(deleteUploaded.mock.calls.map((call) => call[2])).toEqual(['a3', 'a1']);
  expect(find('management-photo-a2').length).toBeGreaterThan(0);
  expect(find('management-photo-a1')).toHaveLength(0);
  expect(find('management-photo-a3')).toHaveLength(0);
  expect(retryUpload).not.toHaveBeenCalled();
  await act(async () => { renderer.unmount(); });
});
