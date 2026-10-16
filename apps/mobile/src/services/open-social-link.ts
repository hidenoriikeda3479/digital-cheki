import { Linking } from 'react-native';
import { AppError } from '@/core/errors';

/** Only a user press opens the OS browser/app. No fetch, token or background request. */
export async function openSocialLink(platform: 'x' | 'instagram', value: string): Promise<void> {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('Validation', 'リンク先が不正です。'); }
  const hosts = platform === 'x' ? ['x.com', 'www.x.com'] : ['instagram.com', 'www.instagram.com'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) {
    throw new AppError('Validation', 'リンク先が不正です。');
  }
  await Linking.openURL(url.href);
}
