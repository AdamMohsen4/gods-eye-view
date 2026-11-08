const NAMES: Record<string, string> = {
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo', A319: 'Airbus A319', A320: 'Airbus A320',
  A321: 'Airbus A321', A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330-900', A346: 'Airbus A340-600',
  A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9',
  B738: 'Boeing 737-800', B739: 'Boeing 737-900', B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200',
  B763: 'Boeing 767-300', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B77W: 'Boeing 777-300ER', B788: 'Boeing 787-8',
  B789: 'Boeing 787-9', B78X: 'Boeing 787-10', BCS3: 'Airbus A220-300', E190: 'Embraer E190', E195: 'Embraer E195',
};

export function aircraftTypeName(code: string | undefined): string | null {
  if (!code) return null;
  return NAMES[code.toUpperCase()] ?? code.toUpperCase();
}
