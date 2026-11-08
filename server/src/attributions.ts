import type { Attribution, RoundType } from '@earthnow/shared';

export const ATTRIBUTIONS = {
  flyitalyadsb: { text: 'Flight data © FlyItalyADSB contributors', url: 'https://flyitalyadsb.com', license: 'CC BY-SA 4.0' },
  usgs: { text: 'Earthquake data: U.S. Geological Survey', url: 'https://earthquake.usgs.gov', license: 'Public domain' },
  firms: {
    text: 'Fire data: NASA FIRMS (LANCE/EOSDIS), NOAA-20 VIIRS',
    url: 'https://firms.modaps.eosdis.nasa.gov',
    license: 'Open data, citation requested',
  },
  celestrak: { text: 'Orbital elements: CelesTrak; positions computed with satellite.js (SGP4)', url: 'https://celestrak.org' },
  imagery: { text: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community', url: 'https://www.esri.com' },
  terrain: { text: 'Terrain: Re:Earth / Mapterhorn', url: 'https://reearth.io', license: 'CC BY 4.0' },
  naturalEarth: { text: 'Map data: Natural Earth', url: 'https://www.naturalearthdata.com', license: 'Public domain' },
  gev: {
    text: "Built on God's Eye View by Bilawal Sidhu",
    url: 'https://github.com/bilawalsidhu/gods-eye-view',
    license: 'MIT',
  },
} satisfies Record<string, Attribution>;

const BY_TYPE: Record<RoundType, Attribution> = {
  flight: ATTRIBUTIONS.flyitalyadsb,
  quake: ATTRIBUTIONS.usgs,
  fire: ATTRIBUTIONS.firms,
  satellite: ATTRIBUTIONS.celestrak,
};

/** Attribution lines shown with every reveal: the round's source plus the map stack. */
export function revealAttribution(type: RoundType): Attribution[] {
  return [BY_TYPE[type], ATTRIBUTIONS.imagery, ATTRIBUTIONS.terrain];
}

export const ALL_ATTRIBUTIONS: Attribution[] = Object.values(ATTRIBUTIONS);
