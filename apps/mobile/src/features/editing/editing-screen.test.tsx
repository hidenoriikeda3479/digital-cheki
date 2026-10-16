import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView } from 'react-native';
import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { CapturePhoto } from '@/services/contracts/capture';
import type { EditingService, PhotoEdit } from '@/services/contracts/editing';
import { EditingController } from './editing-controller';
import { EditingScreen } from './editing-screen';

jest.mock('@shopify/react-native-skia', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factory is hoisted.
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factory is hoisted.
  const { View } = require('react-native');
  const component = (props: object) => React.createElement(View, props);
  return { Canvas: component, Image: component, Path: component, Rect: component, Circle: component, useImage: () => ({}) };
});
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ background: '#000', text: '#fff' }) }));

const session: AuthSession = { credential: 'a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const photo = (id: string): CapturePhoto => ({ id, intakeId: 'i1', capturedAt: '2026-09-25T00:00:00.000Z', width: 800, height: 1200,
  format: 'jpg', originalRef: `photos/${id}.jpg`, thumbnailRef: `photos/thumb-${id}.jpg`, originalUri: `file:///${id}.jpg`, thumbnailUri: `file:///thumb-${id}.jpg` });
const photos = [photo('p1'), photo('p2')];

it('draws on separate photos and confirms that changing a frame clears only its edits', async () => {
  const auth = new AuthController({ signIn: async () => session, restore: async () => session, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const edits = new Map<string, PhotoEdit>();
  function initial(id: string): PhotoEdit { return { schemaVersion: 1, photoId: id, intakeId: 'i1', groupId: 'group-a', originalRef: `photos/${id}.jpg`,
    baseWidth: 800, baseHeight: 1200, frame: 'none', quality: 'cheki', elements: [], revision: 0, updatedAt: '2026-09-25T00:00:00.000Z' }; }
  const service: EditingService = {
    load: async (_, __, id) => edits.get(id) ?? initial(id),
    saveDraft: async (_, __, id, revision, draft) => { const saved = { ...initial(id), ...draft, revision: revision + 1 }; edits.set(id, saved); return saved; },
    append: async () => { throw Error('unused'); }, undo: async () => { throw Error('unused'); },
    setFrame: async () => { throw Error('unused'); }, setQuality: async () => { throw Error('unused'); },
  };
  let sequence = 0;
  const controller = new EditingController(auth, service, { next: () => `op-${++sequence}` });
  await controller.open(photos[0]);
  let canFinish = false;
  const onComplete = jest.fn(async () => {
    expect(edits.get('p1')).toMatchObject({ frame: 'white', elements: [] });
    expect(edits.get('p2')?.elements).toHaveLength(1);
    return canFinish;
  });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<EditingScreen controller={controller} photos={photos} onComplete={onComplete} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  const press = async (id: string) => { await act(async () => { await find(id)[0].props.onPress(); }); };
  const drawAcross = async () => {
    await act(async () => { find('edit-canvas')[0].props.onResponderGrant({ nativeEvent: { locationX: 300, locationY: 150 } }); });
    await act(async () => { find('edit-canvas')[0].props.onResponderMove({ nativeEvent: { locationX: 100, locationY: 151 } }); });
    await act(async () => { await find('edit-canvas')[0].props.onResponderRelease({ nativeEvent: { locationX: 100, locationY: 151 } }); });
  };
  expect(find('editing-stage')).toHaveLength(1);
  expect(find('edit-canvas')[0].props.style.flex).toBe(1);
  expect(find('edit-panel-pen')).toHaveLength(0);
  expect(renderer.root.findAllByType(ScrollView)).toHaveLength(0);
  await press('open-pen-options');
  expect(find('edit-panel-pen')).toHaveLength(1);
  await press('color-1');
  await press('width-0');
  await press('tool-pen');
  expect(find('edit-panel-pen')).toHaveLength(0);
  await act(async () => { find('edit-canvas')[0].props.onLayout({ nativeEvent: { layout: { width: 400, height: 380 } } }); });
  await act(async () => {
    find('edit-canvas')[0].props.onResponderGrant({ nativeEvent: { locationX: 200, locationY: 100 } });
  });
  await act(async () => { await find('edit-canvas')[0].props.onResponderRelease({ nativeEvent: { locationX: 210, locationY: 110 } }); });
  expect(controller.getSnapshot().edit?.elements).toHaveLength(1);
  expect(edits.size).toBe(0);
  await drawAcross();
  expect(controller.getSnapshot().photo?.id).toBe('p1');
  expect(controller.getSnapshot().edit?.elements).toHaveLength(2);
  await press('open-photo-options');
  await press('edit-next-photo');
  expect(controller.getSnapshot().photo?.id).toBe('p2');
  expect(controller.getSnapshot().edit?.elements).toHaveLength(0);
  await press('open-stamp-options');
  await press('tool-heart');
  await act(async () => { await find('edit-canvas')[0].props.onResponderRelease({ nativeEvent: { locationX: 200, locationY: 100 } }); });
  expect(controller.getSnapshot().edit?.elements).toHaveLength(1);
  expect(edits.size).toBe(0);
  await press('open-photo-options');
  await press('edit-previous-photo');
  expect(controller.getSnapshot().photo?.id).toBe('p1');
  expect(controller.getSnapshot().edit?.elements).toHaveLength(2);
  await press('open-frame-options');
  await press('frame-white');
  expect(find('frame-confirm')).toHaveLength(1);
  await press('cancel-frame');
  expect(controller.getSnapshot().edit?.elements).toHaveLength(2);
  await press('frame-white');
  await press('confirm-frame');
  expect(controller.getSnapshot().edit).toMatchObject({ frame: 'white', elements: [] });
  expect(find('undo-edit')[0].props.disabled).toBe(true);
  expect(edits.size).toBe(0);
  await press('complete-editing');
  expect(edits.get('p1')).toMatchObject({ frame: 'white', elements: [] });
  expect(edits.get('p2')?.elements).toHaveLength(1);
  expect(find('edit-complete-error')).toHaveLength(1);
  expect(controller.getSnapshot().photo?.id).toBe('p1');
  canFinish = true;
  await press('complete-editing');
  expect(onComplete).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().photo).toBeNull();
  await act(async () => { renderer.unmount(); });
});
