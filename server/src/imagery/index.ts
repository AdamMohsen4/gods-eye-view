import type { Provider } from '@earthnow/shared';
import type { Config } from '../config.ts';
import { fixtureProvider } from './fixture.ts';
import { googleProvider } from './google.ts';
import { mapillaryProvider } from './mapillary.ts';
import { ProviderUnavailable, type ImageryProvider } from './types.ts';

export * from './types.ts';

export function imageryProvider(id: Provider, config: Config): ImageryProvider {
  if (id === 'mapillary') {
    if (!config.mapillaryToken) throw new ProviderUnavailable('MAPILLARY_TOKEN is not set');
    return mapillaryProvider(config.mapillaryToken);
  }
  if (id === 'google') {
    if (!config.googleServerKey) throw new ProviderUnavailable('GOOGLE_MAPS_SERVER_KEY is not set');
    return googleProvider(config.googleServerKey);
  }
  return fixtureProvider;
}
