/** Official maps. Locations are generated per provider by `locations.ts`. */

/** Countries with reasonably good street-level coverage on both providers. */
export const COVERAGE = (
  'AD AE AL AR AT AU BD BE BG BO BR BT BW CA CH CL CO CR CZ DE DK DO EC EE ES FI FO FR GB GH GR GT HR HU ID IE IL IN IS IT ' +
  'JO JP KE KG KH KR LA LB LI LK LS LT LU LV ME MG MK MN MT MX MY NG NL NO NZ PA PE PH PL PR PT QA RO RS RU RW SE SG SI SK SN SZ ' +
  'TH TN TR TW UA UG US UY VN ZA'
).split(' ');

export interface MapDef {
  slug: string;
  name: string;
  description: string;
  countries: string[];
  /** Only cities at least this big; points stay within `radiusKm` of them. */
  minPopulation?: number;
  radiusKm?: number;
  sort: number;
  /** How many locations to generate by default. */
  target: number;
}

const EUROPE = 'AD AL AT BE BG CH CZ DE DK EE ES FI FO FR GB GR HR HU IE IS IT LI LT LU LV ME MK MT NL NO PL PT RO RS SE SI SK UA'.split(' ');
const AMERICAS = 'AR BO BR CA CL CO CR DO EC GT MX PA PE PR US UY'.split(' ');
const ASIA = 'AE BD BT ID IL IN JO JP KG KH KR LA LB LK MN MY PH QA SG TH TR TW VN'.split(' ');
const AFRICA = 'BW GH KE LS MG NG RW SN SZ TN UG ZA'.split(' ');

export const OFFICIAL_MAPS: MapDef[] = [
  { slug: 'world', name: 'World', description: 'Anywhere with street-level coverage. Roads, villages, deserts and coastlines.', countries: COVERAGE, sort: 1, target: 2000 },
  { slug: 'urban-world', name: 'Urban World', description: 'Inside big cities only. Read the signs, the cars and the architecture.', countries: COVERAGE, minPopulation: 300_000, radiusKm: 3, sort: 2, target: 1000 },
  { slug: 'europe', name: 'Europe', description: 'From Lapland to Lisbon. Bollards, plates and road lines matter here.', countries: EUROPE, sort: 3, target: 1200 },
  { slug: 'americas', name: 'The Americas', description: 'Alaska to Patagonia.', countries: AMERICAS, sort: 4, target: 1000 },
  { slug: 'asia', name: 'Asia', description: 'From Istanbul to Tokyo, with Southeast Asia in between.', countries: ASIA, sort: 5, target: 1000 },
  { slug: 'africa', name: 'Africa', description: 'Every African country with coverage.', countries: AFRICA, sort: 6, target: 600 },
  { slug: 'nordics', name: 'Nordics', description: 'Sweden, Norway, Finland, Denmark, Iceland and the Faroes.', countries: ['SE', 'NO', 'FI', 'DK', 'IS', 'FO'], sort: 7, target: 600 },
  { slug: 'sweden', name: 'Sweden', description: 'Skåne to Kiruna.', countries: ['SE'], sort: 8, target: 500 },
  { slug: 'united-states', name: 'United States', description: 'All 50 states.', countries: ['US'], sort: 9, target: 800 },
  { slug: 'japan', name: 'Japan', description: 'Hokkaido to Okinawa.', countries: ['JP'], sort: 10, target: 500 },
  { slug: 'brazil', name: 'Brazil', description: 'All 26 states and the federal district.', countries: ['BR'], sort: 11, target: 500 },
];
