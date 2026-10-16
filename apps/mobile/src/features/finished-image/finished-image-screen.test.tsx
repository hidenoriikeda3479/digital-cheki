import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { FinishedImageService, SendPreview } from '@/services/contracts/finished-image';
import { FinishedImageController } from './finished-image-controller';
import { FinishedImageScreen } from './finished-image-screen';

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff', background: '#000' }) }));
jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory is hoisted.
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mock factory is hoisted.
  const { View } = require('react-native');
  return { Image: (props: object) => React.createElement(View, props) };
});

const session: AuthSession = { credential: 'a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const preview: SendPreview = { intake: { id: 'i1', groupId: 'group-a', recipientRef: 'private-recipient', idolIds: ['idol-a'], acceptedAt: '2026-09-25T00:00:00.000Z' },
  idolNames: ['アイドルA'], recipientLabel: '確認済みの受取人 1人', confirmedAt: null,
  images: [{ photoId: 'p1', editRevision: 3, quality: 'cheki', width: 1067, height: 1600, byteSize: 123456,
    relativeRef: 'finished/final-p1-r3-cheki.jpg', uri: 'file:///finished.jpg', generatedAt: '2026-09-25T01:00:00.000Z' }] };

it('shows completed images and minimal recipient information, then uses one send action', async () => {
  const auth = new AuthController({ signIn: async () => session, restore: async () => session, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  const confirm = jest.fn(async () => ({ ...preview, confirmedAt: '2026-09-25T02:00:00.000Z' }));
  const service: FinishedImageService = { prepare: async () => preview, confirm, getSaved: async () => [], isConfirmed: async () => false };
  const controller = new FinishedImageController(auth, service);
  await controller.open('i1');
  const onSend = jest.fn(async () => { await controller.confirm(); });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FinishedImageScreen controller={controller} onSend={onSend} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('send-photo-count')).toHaveLength(1);
  expect(find('finished-0')).toHaveLength(1);
  expect(find('send-idols')[0].props.children).toContain('アイドルA');
  expect(find('send-recipient')[0].props.children).not.toContain('private-recipient');
  expect(find('confirm-and-send')[0].findByType(Text).props.children).toBe('確定して送信する');
  await act(async () => { find('confirm-and-send')[0].props.onPress(); });
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith('a', 'i1');
  expect(find('send-confirmed')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it('does not reveal a late generation result after logout', async () => {
  const auth = new AuthController({ signIn: async () => session, restore: async () => session, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  let finish!: (value: SendPreview) => void;
  const controller = new FinishedImageController(auth, { prepare: () => new Promise((resolve) => { finish = resolve; }),
    confirm: async () => preview, getSaved: async () => [], isConfirmed: async () => false });
  const pending = controller.open('i1');
  expect(controller.getSnapshot()).toMatchObject({ phase: 'preview', busy: true, preview: null });
  await auth.signOut();
  finish(preview);
  await pending;
  expect(controller.getSnapshot()).toMatchObject({ phase: 'closed', preview: null });
});
