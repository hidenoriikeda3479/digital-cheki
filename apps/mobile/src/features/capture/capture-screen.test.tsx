import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { CapturePhoto } from '@/services/contracts/capture';

import { CaptureController } from './capture-controller';
import { CaptureScreen } from './capture-screen';
import { EditingController } from '@/features/editing/editing-controller';
import { FinishedImageController } from '@/features/finished-image/finished-image-controller';
import { BatchUploadController } from '@/features/upload/batch-upload-controller';
import type { SendPreview } from '@/services/contracts/finished-image';

jest.mock('@/features/editing/editing-screen', () => ({ EditingScreen: ({ controller, onComplete }: {
  controller: { close(): void }; onComplete(): Promise<boolean>;
}) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
  const { Pressable, View } = require('react-native');
  return React.createElement(View, null,
    React.createElement(Pressable, { testID: 'editing-screen', onPress: () => controller.close() }),
    React.createElement(Pressable, { testID: 'mock-finish-edit', onPress: async () => {
      if (await onComplete()) controller.close();
    } }));
} }));

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff', background: '#000' }) }));
jest.mock('expo-image', () => ({ Image: (props: object) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory runs before imports
  const { View } = require('react-native');
  return React.createElement(View, props);
} }));

const group: AuthSession = { credential: 'token-a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const photo: CapturePhoto = { id: 'photo-a', intakeId: 'intake-a', capturedAt: '2026-09-25T00:00:00.000Z', width: 800, height: 1200, format: 'jpg',
  originalRef: 'photos/photo-a.jpg', thumbnailRef: 'photos/thumb-a.jpg', originalUri: 'file:///original.jpg', thumbnailUri: 'file:///thumb.jpg' };

it('opens editing directly and deletes a draft photo from the top-left icon without confirmation', async () => {
  const auth = new AuthController({ signIn: async () => group, restore: async () => group, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const discardPhoto = jest.fn(async (_credential: string, _intakeId: string, _photoId: string) => {});
  let photos = [photo];
  const loadEdit = jest.fn(async () => ({ schemaVersion: 1 as const, photoId: photo.id, intakeId: photo.intakeId,
    groupId: 'group-a', originalRef: photo.originalRef, baseWidth: photo.width, baseHeight: photo.height,
    frame: 'none' as const, quality: 'cheki' as const, elements: [], revision: 0, updatedAt: photo.capturedAt }));
  const controller = new CaptureController(auth, {
    listSessions: async () => [{ intake: { id: 'intake-a', groupId: 'group-a', recipientRef: 'person-a', idolIds: ['idol-a'], acceptedAt: '2026-09-25T00:00:00.000Z' }, photoCount: photos.length, needsAttention: false }],
    listPhotos: async () => photos, savePhoto: async () => { throw new Error('unused'); },
    discardPhoto: async (...args) => { await discardPhoto(...args); photos = []; },
  });
  const editing = new EditingController(auth, {
    load: loadEdit, append: async () => { throw new Error('unused'); },
    undo: async () => { throw new Error('unused'); }, setFrame: async () => { throw new Error('unused'); },
    setQuality: async () => { throw new Error('unused'); },
    saveDraft: async () => { throw new Error('unused'); },
  }, { next: () => 'unused' });
  const prepare = jest.fn(async (): Promise<SendPreview> => ({
    intake: { id: 'intake-a', groupId: 'group-a', recipientRef: 'person-a', idolIds: ['idol-a'], acceptedAt: photo.capturedAt },
    recipientLabel: '確認済みの受取人 1人', idolNames: ['アイドルA'], confirmedAt: null,
    images: [{ photoId: photo.id, editRevision: 0, quality: 'cheki', width: 1005, height: 1600,
      byteSize: 1000, relativeRef: 'finished/a.jpg', uri: 'file:///finished-a.jpg', generatedAt: photo.capturedAt }],
  }));
  const finishedImage = new FinishedImageController(auth, {
    prepare, confirm: async () => { throw new Error('unused'); },
    getSaved: async () => [], isConfirmed: async () => false,
  });
  await auth.signIn({ email: 'group@example.test', password: 'x' });
  await controller.initialize();
  await controller.openIntake('intake-a');
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<CaptureScreen controller={controller} editing={editing} finishedImage={finishedImage}
    onSent={() => controller.goHome()} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('photo-count')[0].props.children).toEqual(['採用写真：', 1, '枚']);
  expect(find('photo-photo-a').length).toBeGreaterThan(0);
  expect(StyleSheet.flatten(find('photo-photo-a')[0].props.style)).toMatchObject({ borderColor: '#3d4450', borderWidth: StyleSheet.hairlineWidth });
  await act(async () => { find('photo-photo-a')[0].props.onPress(); });
  expect(loadEdit).toHaveBeenCalledWith(group.credential, photo.intakeId, photo.id);
  expect(find('editing-screen').length).toBeGreaterThan(0);
  expect(find('photo-detail')).toHaveLength(0);
  await act(async () => { await find('mock-finish-edit')[0].props.onPress(); });
  expect(prepare).toHaveBeenCalledWith('token-a', 'intake-a');
  expect(find('editing-screen')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.source?.uri === 'file:///finished-a.jpg').length).toBeGreaterThan(0);
  await act(async () => { find('discard-photo-photo-a')[0].props.onPress(); });
  expect(find('confirm-discard')).toHaveLength(0);
  expect(discardPhoto).toHaveBeenCalledTimes(1);
  expect(find('photo-count')[0].props.children).toEqual(['採用写真：', 0, '枚']);
  await act(async () => { renderer.unmount(); });
});

it('sends the intake from captured photos, while a failed confirmation never transfers', async () => {
  const auth = new AuthController({ signIn: async () => group, restore: async () => group, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const controller = new CaptureController(auth, {
    listSessions: async () => [{ intake: { id: 'intake-a', groupId: 'group-a', recipientRef: 'person-a', idolIds: ['idol-a'],
      acceptedAt: '2026-09-25T00:00:00.000Z' }, photoCount: 1, needsAttention: false }],
    listPhotos: async () => [photo], savePhoto: async () => { throw new Error('unused'); }, discardPhoto: async () => {},
  });
  const editing = new EditingController(auth, {
    load: async () => { throw new Error('unused'); }, append: async () => { throw new Error('unused'); },
    undo: async () => { throw new Error('unused'); }, setFrame: async () => { throw new Error('unused'); },
    setQuality: async () => { throw new Error('unused'); },
    saveDraft: async () => { throw new Error('unused'); },
  }, { next: () => 'unused' });
  const preview: SendPreview = { intake: { id: 'intake-a', groupId: 'group-a', recipientRef: 'person-a', idolIds: ['idol-a'],
    acceptedAt: '2026-09-25T00:00:00.000Z' }, recipientLabel: 'テストファンA', idolNames: ['アイドルA'],
    confirmedAt: null, images: [{ photoId: 'photo-a', editRevision: 1, quality: 'cheki', width: 800, height: 1200,
      byteSize: 1234, relativeRef: 'finished/photo-a.jpg', uri: 'file:///finished.jpg', generatedAt: '2026-09-25T01:00:00.000Z' }] };
  let failConfirm = true;
  let failTransfer = true;
  const order: string[] = [];
  const finishedImage = new FinishedImageController(auth, { prepare: async () => preview,
    confirm: async () => { order.push('confirm'); if (failConfirm) throw Error('save failed');
      return { ...preview, confirmedAt: '2026-09-25T01:10:00.000Z' }; }, getSaved: async () => [], isConfirmed: async () => false });
  const uploaded = { intakeId: 'intake-a', status: 'uploaded' as const, photoCount: 1, failureCount: 0 };
  const send = jest.fn(async () => { order.push('send'); return failTransfer ? { ...uploaded, status: 'failed' as const } : uploaded; });
  const upload = new BatchUploadController(auth, { observe: async () => ({ ...uploaded, status: 'unsent' }),
    send, query: async () => uploaded });
  await auth.signIn({ email: 'group@example.test', password: 'x' });
  await controller.initialize();
  await controller.openIntake('intake-a');
  const onSent = jest.fn(() => controller.goHome());
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<CaptureScreen controller={controller} editing={editing}
    finishedImage={finishedImage} upload={upload} onSent={onSent} />); });
  const press = async (id: string) => { const node = renderer.root.findAll((item) => item.props.testID === id &&
    typeof item.props.onPress === 'function')[0]; await act(async () => { node.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0)); }); };
  expect(renderer.root.findAll((item) => item.props.testID === 'open-send-preview')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.source?.uri === 'file:///finished.jpg').length).toBeGreaterThan(0);
  const headingActions = renderer.root.findAll((item) => item.props.testID === 'capture-heading-actions')[0];
  expect(headingActions.findAll((item) => item.props.testID === 'add-photo' || item.props.testID === 'send-batch')
    .filter((item) => typeof item.props.onPress === 'function').map((item) => item.props.testID))
    .toEqual(['add-photo', 'send-batch']);
  expect(renderer.root.findAll((item) => item.props.testID === 'send-batch')[0].props.accessibilityLabel).toBe('写真を送信');
  await press('send-batch');
  expect(renderer.root.findAll((item) => item.props.testID === 'batch-send-confirmation').length).toBeGreaterThan(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'confirm-recipient')[0].props.children)
    .toEqual(['送信先：', 'テストファンA']);
  expect(renderer.root.findAll((item) => item.props.testID === 'confirm-idols')[0].props.children)
    .toEqual(['アイドル：', 'アイドルA']);
  expect(renderer.root.findAll((item) => item.props.testID === 'confirm-photo-0' &&
    item.props.source?.uri === 'file:///finished.jpg').length).toBeGreaterThan(0);
  expect(order).toEqual([]);
  await press('cancel-batch-send');
  expect(order).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  await press('send-batch');
  await press('confirm-batch-send');
  expect(order).toEqual(['confirm']);
  expect(send).not.toHaveBeenCalled();
  expect(upload.getSnapshot().intakeId).toBeNull();
  failConfirm = false;
  await press('retry-local-preview');
  await press('send-batch');
  await press('confirm-batch-send');
  expect(order).toEqual(['confirm', 'confirm', 'send']);
  expect(send).toHaveBeenCalledWith('token-a', 'intake-a');
  expect(onSent).not.toHaveBeenCalled();
  expect(controller.getSnapshot().phase).toBe('review');
  expect(renderer.root.findAll((item) => item.props.testID === 'send-batch')[0].props.accessibilityLabel).toBe('写真を再送');
  failTransfer = false;
  await press('send-batch');
  await press('confirm-batch-send');
  expect(upload.getSnapshot().snapshot?.status).toBe('uploaded');
  expect(onSent).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().phase).toBe('home');
  expect(renderer.root.findAll((item) => item.props.testID === 'batch-upload-success')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'send-batch')).toHaveLength(0);
  expect(renderer.root.findAll((item) => item.props.testID === 'upload-badge-photo-a')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('does not carry the uploaded badge or send result into the next intake', async () => {
  const auth = new AuthController({ signIn: async () => group, restore: async () => group, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  const nextPhoto = { ...photo, id: 'photo-b', intakeId: 'intake-b' };
  const sessions = ['intake-a', 'intake-b'].map((id) => ({ intake: { id, groupId: 'group-a', recipientRef: 'person-a',
    idolIds: ['idol-a'], acceptedAt: photo.capturedAt }, photoCount: 1, needsAttention: false, confirmed: id === 'intake-a' }));
  const controller = new CaptureController(auth, {
    listSessions: async () => sessions,
    listPhotos: async (_credential, intakeId) => [intakeId === 'intake-a' ? photo : nextPhoto],
    savePhoto: async () => { throw new Error('unused'); }, discardPhoto: async () => {},
  });
  const editing = new EditingController(auth, {
    load: async () => { throw new Error('unused'); }, append: async () => { throw new Error('unused'); },
    undo: async () => { throw new Error('unused'); }, setFrame: async () => { throw new Error('unused'); },
    setQuality: async () => { throw new Error('unused'); },
    saveDraft: async () => { throw new Error('unused'); },
  }, { next: () => 'unused' });
  const finishedImage = new FinishedImageController(auth, {
    prepare: async () => { throw new Error('unused'); }, confirm: async () => { throw new Error('unused'); },
    getSaved: async () => [], isConfirmed: async () => false,
  });
  const send = jest.fn(async () => ({ intakeId: 'intake-a', status: 'uploaded' as const, photoCount: 1, failureCount: 0 }));
  const upload = new BatchUploadController(auth, {
    observe: async (_credential, intakeId) => ({ intakeId, status: 'unsent', photoCount: 1, failureCount: 0 }),
    send, query: async () => { throw new Error('unused'); },
  });
  await auth.signIn({ email: 'group@example.test', password: 'x' });
  await controller.initialize();
  await controller.openIntake('intake-a');
  await upload.open('intake-a');
  await upload.send();
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<CaptureScreen controller={controller} editing={editing}
    finishedImage={finishedImage} upload={upload} onSent={() => controller.goHome()} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('batch-upload-success')).toHaveLength(0);
  await act(async () => { controller.goHome(); await controller.openIntake('intake-b'); });
  expect(upload.getSnapshot().intakeId).toBe('intake-a');
  expect(find('photo-photo-b')).not.toHaveLength(0);
  expect(find('batch-upload-success')).toHaveLength(0);
  expect(find('intake-send-confirmed')).toHaveLength(0);
  expect(find('send-batch')).not.toHaveLength(0);
  expect(find('upload-badge-photo-b')).toHaveLength(0);
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});
