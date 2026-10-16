import type { PickupIdol } from './contracts/identification';

export interface CompletedCheki {
  photoId: string; groupId: string; intakeId: string; capturedAt?: string; idolIds?: string[];
}

export function rankWeeklyIdols(candidates: PickupIdol[], photos: (CompletedCheki & { idolIds: string[] })[], now: Date): PickupIdol[] {
  const end = now.getTime();
  const start = end - 7 * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const photo of photos) {
    const captured = photo.capturedAt ? Date.parse(photo.capturedAt) : NaN;
    if (!Number.isFinite(captured) || captured < start || captured > end || seen.has(photo.photoId)) continue;
    seen.add(photo.photoId);
    for (const idolId of new Set(photo.idolIds)) counts.set(idolId, (counts.get(idolId) ?? 0) + 1);
  }
  return candidates.filter((idol) => (counts.get(idol.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)
      || a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id)).slice(0, 3);
}
