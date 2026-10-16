import { Directory, File, Paths } from 'expo-file-system';
import { AppError, toAppError } from '@/core/errors';
import { buildNamespacePrefix, type StorageNamespace } from '@/storage/namespace';

export interface SampleArrivalPhoto { uri: string; byteSize: number; remove(): void }

// Fixed, synthetic 64 × 64 JPEG fixture. It contains no user photo or network URL.
const jpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2CiiikdwUUVmaj4i0jSWKXt/DHICFMYO9xkZGVXJAx3x6UFRjKTtFXNOisex8U6HqUvl22pQmTIULJmMsT0ChgMn6VsUBKEou0lYKKKKCQooooA4Dx34tuLG4GlaZO0Uygm5kC8jI+VVJ6HBzke2D1rzSpry6e9vri7kCiSeRpGC9AWOTj25qGqPpsPRjRgorfqFd14H8W3EN9BpOoTs9rIBFbkrkxvn5RnrtOcc5xx0Ga4WigqtSjVi4yPoqiqml3T3ukWV3IFEk8CSMF6AsoJx7c1bqT5hqzswooooEeF+JNKbRtfurTy9kW8vDjJBjPK4J646H3BrJr3DxF4atPEdtGlw8kUsO4xSIfukjuO44B7HjqK8p1vwtqmgp5t5HGYC4RZo5AVZiM4A+92PUdqZ9BhcXCrFRb94xas2FjNqV/BZW65lmcIvBwPc47DqfYVa0bw/qOvSulhErrGVEjs4UJuzgnPJHB6A9K9S8LeELfw6v2hpWmvpI9kjg/IvOSFHpwOT6ds4oKxOKhRTV/e7HQ28EVrbRW8K7YokCIuScKBgDmpKKKR89uFFFFAgrn/GGhXXiDSIrS0khSRJxITKSBgKw7A88iugooLhNwkpR3Ryngvwxe+HPt32yW3fz/L2+SxONu7Ocgeorq6KKB1KkqknOW7CiiigzP//Z';

function decodeBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const result = new Uint8Array(value.length * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0));
  let accumulator = 0; let bits = 0; let position = 0;
  for (const character of value) {
    if (character === '=') break;
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new AppError('Storage', 'サンプル画像が不正です。');
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) { bits -= 8; result[position++] = (accumulator >>> bits) & 255; }
  }
  if (position !== result.length) throw new AppError('Storage', 'サンプル画像が不正です。');
  return result;
}

export function createSampleArrivalPhoto(namespace: StorageNamespace): SampleArrivalPhoto {
  if (namespace.source !== 'mock' || namespace.owner.kind !== 'mock-server') throw new AppError('Configuration', 'サンプル画像の保存先が不正です。');
  try {
    const directory = new Directory(Paths.document, ...buildNamespacePrefix(namespace).split('/').filter(Boolean), 'samples');
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, 'arrival-v1.jpg');
    const bytes = decodeBase64(jpegBase64);
    if (!file.exists) file.write(bytes);
    if (file.size !== bytes.length) throw new AppError('Storage', 'サンプル画像を確認できません。');
    return { uri: file.uri, byteSize: bytes.length, remove: () => { if (file.exists) file.delete(); } };
  } catch (cause) { throw toAppError(cause); }
}
