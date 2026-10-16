import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { createDevicePhotoLibrary } from './device-photo-library';

jest.mock('expo-media-library', () => ({
  Asset: { create: jest.fn() },
  requestPermissionsAsync: jest.fn(),
}));

it('requests add-only photo permission and saves only a local file', async () => {
  const request = jest.mocked(requestPermissionsAsync);
  const create = jest.mocked(Asset.create);
  request.mockResolvedValue({ granted: true } as Awaited<ReturnType<typeof requestPermissionsAsync>>);
  create.mockResolvedValue({ id: 'saved' } as Awaited<ReturnType<typeof Asset.create>>);
  const library = createDevicePhotoLibrary();
  expect(await library.requestSavePermission()).toBe(true);
  expect(request).toHaveBeenCalledWith(true, ['photo']);
  await library.save('file:///fan/photo.jpg');
  expect(create).toHaveBeenCalledWith('file:///fan/photo.jpg');
  await expect(library.save('https://example.test/photo.jpg')).rejects.toMatchObject({ code: 'Validation' });
  expect(create).toHaveBeenCalledTimes(1);
});
