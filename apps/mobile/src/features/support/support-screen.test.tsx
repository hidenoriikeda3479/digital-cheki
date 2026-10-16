import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SupportScreen } from './support-screen';

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#fff', background: '#000', textSecondary: '#aaa' }) }));

it('requires both fields, blocks a second submit, and displays acceptance only after persistence', async () => {
  let resolve!: (value: { id: string; acceptedAt: string }) => void;
  const submit = jest.fn(() => new Promise<{ id: string; acceptedAt: string }>((done) => { resolve = done; }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<SupportScreen credential="credential" service={{ submit }} onBack={() => {}} />); });
  const find = (id: string) => renderer.root.findAll((item) => item.props.testID === id && typeof item.type !== 'string');
  await act(async () => { find('support-submit')[0].props.onPress(); });
  expect(find('support-error')).toHaveLength(1);
  await act(async () => { find('support-subject')[0].props.onChangeText('件名'); find('support-content')[0].props.onChangeText('内容'); });
  await act(async () => { find('support-submit')[0].props.onPress(); });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(find('support-submit')[0].props.disabled).toBe(true);
  expect(find('support-complete')).toHaveLength(0);
  await act(async () => { resolve({ id: 'ticket-1', acceptedAt: '2026-09-25T00:00:00.000Z' }); });
  expect(find('support-complete')).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});
