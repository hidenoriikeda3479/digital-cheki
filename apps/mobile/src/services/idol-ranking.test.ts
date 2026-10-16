import { rankWeeklyIdols } from './idol-ranking';
import type { PickupIdol } from './contracts/identification';

const now = new Date('2026-10-14T12:00:00Z');
const candidates: PickupIdol[] = ['D', 'C', 'B', 'A'].map((id) => ({ id, name: id, groupName: id, portraitSource: 1 }));
const photo = (id: string, idolIds: string[], capturedAt = now.toISOString()) => ({ photoId: id,
  groupId: 'group', intakeId: 'intake', idolIds, capturedAt });

it('counts each participant once per unique completed photo and shows the top three with name ties', () => {
  const first = photo('one', ['D', 'D', 'C', 'A', 'B']);
  const result = rankWeeklyIdols(candidates, [first, first, photo('two', ['D', 'C']), photo('three', ['D'])], now);
  expect(result.map((idol) => idol.id)).toEqual(['D', 'C', 'A']);
});

it('uses the exact rolling seven-day capture boundary, excluding future, missing and old dates and zero counts', () => {
  const start = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const result = rankWeeklyIdols(candidates, [photo('boundary', ['B'], new Date(start).toISOString()),
    photo('old', ['A'], new Date(start - 1).toISOString()),
    photo('future', ['A'], new Date(now.getTime() + 1).toISOString()),
    photo('missing', ['A'], ''), photo('now', ['D'])], now);
  expect(result.map((idol) => idol.id)).toEqual(['B', 'D']);
  expect(rankWeeklyIdols(candidates, [], now)).toEqual([]);
});
