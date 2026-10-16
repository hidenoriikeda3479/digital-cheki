import catalog from './identification-fixtures.json';

export const demoGroupNames: Record<string, string> = {
  'group-a': 'ソラノシンフォニー',
  'group-b': 'ミルキーリズム',
};

/** Change known seed labels only; preserve user-edited names and stable IDs. */
export function renameSeedGroup(id: string, name: string) {
  return /^テストグループ[AB]$/.test(name) || name === 'サンプルグループ'
    ? demoGroupNames[id] ?? name : name;
}
export function renameSeedIdol(id: string, name: string) {
  return /^テストアイドル[AB]\d*$/.test(name) || name === 'サンプルアイドル'
    ? catalog.idols.find((idol) => idol.id === id)?.name ?? name : name;
}
