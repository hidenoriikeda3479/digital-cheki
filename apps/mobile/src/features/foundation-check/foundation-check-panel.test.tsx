import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import { AppError } from '@/core/errors';
import type { CheckSnapshot, FoundationCheckService } from '@/services/contracts/foundation-check';

import { FoundationCheckPanel } from './foundation-check-panel';

const targets = [
  { id: 'group-a', label: 'グループA' },
  { id: 'group-b', label: 'グループB' },
];

function snapshot(targetId: string, saved = false): CheckSnapshot {
  const target = targets.find((item) => item.id === targetId);
  if (!target) throw new Error('Invalid test target');
  return {
    target,
    record: saved ? { id: `record-${targetId}`, savedAt: '2026-09-25T00:00:00.000Z', fileName: 'check.txt' } : null,
    fileContents: saved ? `test file for ${targetId}` : null,
    seed: { version: 1, groupCount: 2, fanCount: 2, idolCount: 2 },
  };
}

function createService(): jest.Mocked<FoundationCheckService> {
  return {
    targets,
    read: jest.fn(async (targetId: string) => snapshot(targetId)),
    save: jest.fn(async (targetId: string) => snapshot(targetId, true)),
    reset: jest.fn<Promise<void>, ['RESET_MOCK_DATA']>(async () => {}),
  };
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return {
    promise,
    resolve: (value: T) => {
      if (!resolve) throw new Error('Deferred test operation was not initialized');
      resolve(value);
    },
  };
}

describe('段階01 モック専用保存確認画面', () => {
  let renderer: ReactTestRenderer | undefined;
  const onClose = jest.fn();

  async function mount(service: FoundationCheckService) {
    await act(async () => {
      renderer = create(<FoundationCheckPanel service={service} onClose={onClose} />);
    });
  }

  function button(testID: string) {
    if (!renderer) throw new Error('Test screen has not mounted');
    return renderer.root.findAll((item) => item.props.testID === testID && typeof item.type !== 'string')[0];
  }

  async function press(testID: string) {
    await act(async () => { button(testID).props.onPress(); });
  }

  function renderedText() {
    return JSON.stringify(renderer?.toJSON());
  }

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
    jest.restoreAllMocks();
    onClose.mockClear();
  });

  test('初回に読み取り、保存結果のIDとファイル内容を表示し、読み戻しと閉じるを実行する', async () => {
    const service = createService();
    await mount(service);
    expect(service.read).toHaveBeenCalledWith('group-a');
    expect(renderedText()).toContain('まだ確認用データはありません。');

    await press('save-check');
    expect(service.save).toHaveBeenCalledWith('group-a');
    expect(renderedText()).toContain('record-group-a');
    expect(renderedText()).toContain('test file for group-a');

    service.read.mockResolvedValueOnce(snapshot('group-a', true));
    await press('read-check');
    expect(service.read).toHaveBeenCalledTimes(2);
    expect(renderedText()).toContain('record-group-a');
    await press('close-check');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('対象切替で前の対象を隠し、読み取り中は操作を無効にする', async () => {
    const service = createService();
    service.read.mockResolvedValueOnce(snapshot('group-a', true));
    await mount(service);
    const pending = deferred<CheckSnapshot>();
    service.read.mockReturnValueOnce(pending.promise);

    await press('target-group-b');
    expect(service.read).toHaveBeenLastCalledWith('group-b');
    expect(renderedText()).not.toContain('record-group-a');
    expect(button('save-check').props.disabled).toBe(true);
    expect(button('close-check').props.disabled).toBe(true);

    await act(async () => { pending.resolve(snapshot('group-b', true)); });
    expect(renderedText()).toContain('record-group-b');
    expect(button('save-check').props.disabled).toBe(false);
    await press('target-group-b');
    expect(renderedText()).toContain('record-group-b');
  });

  test('古いサービスの遅延応答を現在の表示に適用しない', async () => {
    const stale = deferred<CheckSnapshot>();
    const firstService = createService();
    firstService.read.mockReturnValueOnce(stale.promise);
    await mount(firstService);
    const nextService = createService();
    await act(async () => {
      renderer?.update(<FoundationCheckPanel service={nextService} onClose={onClose} />);
    });
    await act(async () => { stale.resolve(snapshot('group-a', true)); });
    expect(renderedText()).toContain('まだ確認用データはありません。');
    expect(renderedText()).not.toContain('record-group-a');
  });

  test('モック初期化は確認キャンセル時に実行せず、明示確認後だけ実行して読み直す', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const service = createService();
    await mount(service);

    await press('reset-check');
    expect(service.reset).not.toHaveBeenCalled();
    const cancel = alert.mock.calls[0][2]?.find((item) => item.style === 'cancel');
    expect(cancel).toBeDefined();
    await act(async () => { cancel?.onPress?.(); });
    expect(service.reset).not.toHaveBeenCalled();

    await press('reset-check');
    const confirm = alert.mock.calls[1][2]?.find((item) => item.style === 'destructive');
    expect(confirm).toBeDefined();
    await act(async () => { confirm?.onPress?.(); });
    expect(service.reset).toHaveBeenCalledTimes(1);
    expect(service.reset).toHaveBeenCalledWith('RESET_MOCK_DATA');
    expect(service.read).toHaveBeenCalledTimes(2);
  });

  test('保存失敗は共通コードだけを表示し、内部のメッセージを漏らさない', async () => {
    const service = createService();
    service.save.mockRejectedValueOnce(new AppError('Storage', 'private file path / secret'));
    await mount(service);
    await press('save-check');
    expect(renderedText()).toContain('確認できませんでした。');
    expect(renderedText()).toContain('Storage');
    expect(renderedText()).not.toContain('private file path');
    expect(button('save-check').props.disabled).toBe(false);
  });
});
