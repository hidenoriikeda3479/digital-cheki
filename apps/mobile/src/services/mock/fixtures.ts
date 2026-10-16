import { AppError } from '@/core/errors';
import catalog from './identification-fixtures.json';
import { demoGroupNames } from './display-names';

export interface FixtureAccount { id: string; label: string }
export interface FixtureIdol extends FixtureAccount { groupId: string }
export interface MockFixtures {
  groups: FixtureAccount[];
  fans: FixtureAccount[];
  idols: FixtureIdol[];
}

export const SEED_VERSION = 3;
export function createFixtures(): MockFixtures {
  return {
    groups: Object.entries(demoGroupNames).map(([id, label]) => ({ id, label })),
    fans: [{ id: 'fan-a', label: 'テストファンA' }, { id: 'fan-b', label: 'テストファンB' }],
    idols: catalog.idols.filter((idol) => idol.approved && idol.selectable)
      .map((idol) => ({ id: idol.id, groupId: idol.groupId, label: idol.name })),
  };
}

function isAccount(value: unknown): value is FixtureAccount {
  return typeof value === 'object' && value !== null && 'id' in value && 'label' in value &&
    typeof value.id === 'string' && value.id.length > 0 && typeof value.label === 'string';
}

export function decodeFixtures(value: unknown): MockFixtures {
  if (typeof value !== 'object' || value === null ||
      !('groups' in value) || !Array.isArray(value.groups) || !value.groups.every(isAccount) ||
      !('fans' in value) || !Array.isArray(value.fans) || !value.fans.every(isAccount) ||
      !('idols' in value) || !Array.isArray(value.idols)) {
    throw new AppError('Storage', 'モック初期データを読み取れません。');
  }
  const groups = value.groups;
  const idols = value.idols.map((idol: unknown): FixtureIdol => {
    if (!isAccount(idol) || !('groupId' in idol) || typeof idol.groupId !== 'string' ||
        !groups.some((group: FixtureAccount) => group.id === idol.groupId)) {
      throw new AppError('Storage', 'モックの所属データが不正です。');
    }
    return { id: idol.id, label: idol.label, groupId: idol.groupId };
  });
  return { groups: value.groups, fans: value.fans, idols };
}
