import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AuthController } from './auth-controller';
import { AccountSettingsScreen } from './account-settings-screen';

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff', background: '#000' }) }));

it('keeps withdrawal behind confirmation and reports persistence failure', async () => {
  const deleteAccount = jest.fn().mockRejectedValueOnce(Error('storage unavailable')).mockResolvedValueOnce(undefined);
  const onDeleted = jest.fn();
  let renderer!: ReactTestRenderer;
  const onLogout = jest.fn();
  await act(async () => { renderer = create(<AccountSettingsScreen auth={{ deleteAccount, getSnapshot: () => ({ busy: false }) } as unknown as AuthController} role="fan"
    onLogout={onLogout} onPassword={() => {}} onSupport={() => {}} onBack={() => {}} onDeleted={onDeleted} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  expect(find('settings-logout').length).toBeGreaterThan(0);
  await act(async () => { find('settings-logout')[0].props.onPress(); });
  expect(onLogout).toHaveBeenCalledTimes(1);
  expect(deleteAccount).not.toHaveBeenCalled();
  await act(async () => { find('open-account-delete')[0].props.onPress(); });
  await act(async () => { find('cancel-account-delete')[0].props.onPress(); });
  expect(deleteAccount).not.toHaveBeenCalled();
  await act(async () => { find('open-account-delete')[0].props.onPress(); });
  await act(async () => { find('confirm-account-delete')[0].props.onPress(); });
  expect(find('account-delete-error')).toHaveLength(1);
  expect(onDeleted).not.toHaveBeenCalled();
  await act(async () => { find('confirm-account-delete')[0].props.onPress(); });
  expect(deleteAccount).toHaveBeenCalledTimes(2);
  expect(onDeleted).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});
