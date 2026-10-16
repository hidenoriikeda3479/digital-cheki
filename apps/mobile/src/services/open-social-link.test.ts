import { Linking } from 'react-native';
import { openSocialLink } from './open-social-link';

afterEach(() => jest.restoreAllMocks());
it.each(['javascript:alert(1)', 'http://x.com/', 'https://x.com.evil.test/', 'https://user:pass@x.com/', 'https://x.com:8443/', 'https://instagram.com/'])
  ('rejects an invalid X destination: %s', async (url) => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await expect(openSocialLink('x', url)).rejects.toMatchObject({ code: 'Validation' });
    expect(open).not.toHaveBeenCalled();
  });
