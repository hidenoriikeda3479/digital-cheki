import { buildMockPrefix, buildNamespacePrefix, validateFileName, type StorageNamespace } from './namespace';

const group: StorageNamespace = {
  environment: 'development', source: 'mock', owner: { kind: 'group', id: 'same-id' },
};

describe('storage namespace', () => {
  it('separates owner kinds, IDs, environments and sources', () => {
    const namespaces: StorageNamespace[] = [
      group,
      { ...group, owner: { kind: 'group', id: 'other-id' } },
      { ...group, owner: { kind: 'fan', id: 'same-id' } },
      { ...group, owner: { kind: 'guest', id: 'same-id' } },
      { ...group, owner: { kind: 'mock-server', id: 'same-id' } },
      { ...group, environment: 'staging' },
      { ...group, source: 'api' },
      { ...group, environment: 'production', source: 'api' },
    ];
    expect(new Set(namespaces.map(buildNamespacePrefix)).size).toBe(namespaces.length);
    expect(buildNamespacePrefix(group).startsWith(buildMockPrefix('development'))).toBe(true);
  });

  it.each(['', '.', '..', '../fan-a', 'a/b', 'a\\b', 'a\0b'])(
    'rejects invalid owner ID %j', (id) => {
      expect(() => buildNamespacePrefix({ ...group, owner: { kind: 'group', id } })).toThrow();
    },
  );

  it('encodes percent syntax and Unicode without collisions or path interpretation', () => {
    const prefixes = ['%2f', '_2f', '😀', '😁', 'グループA'].map((id) =>
      buildNamespacePrefix({ ...group, owner: { kind: 'group', id } }));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    prefixes.forEach((prefix) => expect(prefix).toMatch(/^digital-cheki\/development\/mock\/group\/id-[a-f0-9]+\/$/));
  });

  it('rejects production mock and an api namespace pretending to be a mock server', () => {
    expect(() => buildNamespacePrefix({ ...group, environment: 'production' })).toThrow();
    expect(() => buildNamespacePrefix({
      ...group, source: 'api', owner: { kind: 'mock-server', id: 'server' },
    })).toThrow();
  });

  it.each(['', '../photo', '/photo', 'file:///photo', 'a\\b', '.pending-a', '%2e%2e'])
  ('rejects file path or reserved file name %j', (name) => {
    expect(() => validateFileName(name)).toThrow();
  });
});
