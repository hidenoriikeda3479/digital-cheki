import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AuthController } from '@/features/auth/auth-controller';
import type { AuthSession } from '@/services/contracts/auth';
import type { UploadService, UploadSnapshot } from '@/services/contracts/upload';
import { UploadController } from './upload-controller';
import { UploadScreen } from './upload-screen';

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff', background: '#000' }) }));
const session: AuthSession = { credential: 'a', principal: { id: 'group-a', role: 'group', displayName: 'A' }, expiresAt: '2026-12-01T00:00:00.000Z' };
const initial: UploadSnapshot = { intakeId: 'i1', notificationCreated: false, photos: [
  { photoId: 'p1', status: 'uploaded', progressPercent: 100, failureCount: 0,
    uploadedAt: '2026-09-25T01:00:00.000Z', expiresAt: '2026-10-02T01:00:00.000Z', retention: 'stored' },
  { photoId: 'p2', status: 'failed', progressPercent: 0, failureCount: 2, uploadedAt: null, expiresAt: null, retention: null },
] };
async function signedIn() {
  const auth = new AuthController({ signIn: async () => session, restore: async () => session, signOut: async () => {} },
    { read: async () => null, write: async () => {}, remove: async () => {} });
  await auth.signIn({ email: 'group@example.test', password: 'DemoPass123' });
  return auth;
}
it('shows per-photo status and retries only after a button press', async () => {
  const auth = await signedIn();
  const start = jest.fn(async () => ({ ...initial, notificationCreated: true, photos: [initial.photos[0],
    { ...initial.photos[1], status: 'uploaded' as const, progressPercent: 100, uploadedAt: '2026-09-25T02:00:00.000Z',
      expiresAt: '2026-10-02T02:00:00.000Z', retention: 'stored' as const }] }));
  const service: UploadService = { observe: async () => initial, start, query: async () => initial };
  const controller = new UploadController(auth, service);
  await controller.open('i1');
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<UploadScreen controller={controller} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('upload-summary')).toHaveLength(1);
  expect(find('upload-retry-1').length).toBeGreaterThan(0);
  expect(start).not.toHaveBeenCalled();
  await act(async () => { find('upload-retry-1')[0].props.onPress(); });
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0].slice(0, 3)).toEqual(['a', 'i1', 'p2']);
  expect(find('upload-retry-1')).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it('drops a delayed transfer result after logout without applying it to another user', async () => {
  const auth = await signedIn();
  let complete!: (value: UploadSnapshot) => void;
  const controller = new UploadController(auth, { observe: async () => initial,
    start: () => new Promise((resolve) => { complete = resolve; }), query: async () => initial });
  await controller.open('i1');
  const pending = controller.start('p2');
  expect(controller.getSnapshot().busy).toBe(true);
  await auth.signOut();
  complete(initial);
  await pending;
  expect(controller.getSnapshot()).toMatchObject({ phase: 'closed', snapshot: null });
});
