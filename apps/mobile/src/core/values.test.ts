import { currentInstant, parseId, parseInstant } from './values';

it('uses an injected clock so expiry tests do not change the OS clock', () => {
  let time = new Date('2026-09-25T00:00:00.000Z');
  const clock = { now: () => time };
  expect(currentInstant(clock)).toBe('2026-09-25T00:00:00.000Z');
  time = new Date(time.getTime() + 7 * 24 * 60 * 60 * 1000);
  expect(currentInstant(clock)).toBe('2026-10-02T00:00:00.000Z');
});

it('rejects ambiguous time and empty identifiers at boundaries', () => {
  expect(() => parseInstant('2026-09-25')).toThrow();
  expect(() => parseInstant('invalid')).toThrow();
  expect(() => parseId(' ')).toThrow();
});
