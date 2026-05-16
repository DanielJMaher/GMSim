/**
 * Hometown pools for college-prospect generation. Real US cities,
 * weighted heavily toward football-recruiting hotbeds (TX, FL, CA,
 * GA, AL, OH) since those states produce a disproportionate share
 * of NFL talent in real life. The pool is deliberately broad so
 * 1000+ generated prospects don't all hail from the same handful
 * of towns.
 *
 * Used by `engine/src/draft/recruiting.ts`.
 */

interface StatePool {
  state: string;
  /** Relative weight in the state-pick roll. Higher = more frequent. */
  weight: number;
  cities: readonly string[];
}

export const HOMETOWN_POOLS: readonly StatePool[] = [
  // Top-tier recruiting hotbeds
  {
    state: 'TX',
    weight: 18,
    cities: [
      'Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'Arlington',
      'Plano', 'Katy', 'Allen', 'Frisco', 'McKinney', 'Sugar Land', 'Tyler',
      'Lubbock', 'Beaumont', 'Galveston', 'Waco', 'College Station', 'Killeen',
      'El Paso', 'Corpus Christi', 'Midland',
    ],
  },
  {
    state: 'FL',
    weight: 16,
    cities: [
      'Miami', 'Tampa', 'Orlando', 'Jacksonville', 'Fort Lauderdale',
      'Hialeah', 'St. Petersburg', 'Tallahassee', 'Gainesville', 'Ocala',
      'Pensacola', 'Lakeland', 'Sarasota', 'West Palm Beach', 'Daytona Beach',
      'Coral Gables', 'Hollywood', 'Pompano Beach', 'Cape Coral', 'Naples',
    ],
  },
  {
    state: 'CA',
    weight: 14,
    cities: [
      'Los Angeles', 'Long Beach', 'Anaheim', 'Santa Ana', 'San Diego',
      'San Francisco', 'San Jose', 'Oakland', 'Fresno', 'Sacramento',
      'Bakersfield', 'Riverside', 'Stockton', 'Modesto', 'Pasadena',
      'Inglewood', 'Compton', 'Torrance', 'Carson', 'Pomona', 'Long Beach',
    ],
  },
  {
    state: 'GA',
    weight: 12,
    cities: [
      'Atlanta', 'Marietta', 'Sandy Springs', 'Roswell', 'Augusta',
      'Macon', 'Savannah', 'Athens', 'Columbus', 'Lawrenceville',
      'Alpharetta', 'Decatur', 'Albany', 'Valdosta', 'Warner Robins',
    ],
  },
  {
    state: 'AL',
    weight: 8,
    cities: [
      'Birmingham', 'Montgomery', 'Mobile', 'Tuscaloosa', 'Auburn',
      'Huntsville', 'Hoover', 'Decatur', 'Dothan', 'Florence',
    ],
  },
  {
    state: 'OH',
    weight: 9,
    cities: [
      'Cleveland', 'Columbus', 'Cincinnati', 'Toledo', 'Akron',
      'Dayton', 'Youngstown', 'Canton', 'Lima', 'Mentor',
    ],
  },
  // Mid-tier
  {
    state: 'LA',
    weight: 6,
    cities: [
      'New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles',
      'Monroe', 'Alexandria', 'Bossier City',
    ],
  },
  {
    state: 'NC',
    weight: 6,
    cities: [
      'Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem',
      'Fayetteville', 'Cary', 'Wilmington', 'High Point',
    ],
  },
  {
    state: 'SC',
    weight: 5,
    cities: [
      'Columbia', 'Charleston', 'Greenville', 'Spartanburg', 'Rock Hill',
      'Mount Pleasant', 'Florence',
    ],
  },
  {
    state: 'TN',
    weight: 6,
    cities: [
      'Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Murfreesboro',
      'Clarksville', 'Franklin',
    ],
  },
  {
    state: 'PA',
    weight: 6,
    cities: [
      'Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading',
      'Bethlehem', 'Lancaster', 'Harrisburg', 'Scranton',
    ],
  },
  {
    state: 'MI',
    weight: 5,
    cities: [
      'Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Lansing',
      'Ann Arbor', 'Flint', 'Dearborn',
    ],
  },
  {
    state: 'IL',
    weight: 5,
    cities: [
      'Chicago', 'Aurora', 'Joliet', 'Naperville', 'Rockford',
      'Springfield', 'Peoria', 'Elgin',
    ],
  },
  // Lower-tier — represented but rare. Pads geographic coverage.
  { state: 'MS', weight: 3, cities: ['Jackson', 'Gulfport', 'Hattiesburg', 'Biloxi', 'Tupelo'] },
  { state: 'AR', weight: 2, cities: ['Little Rock', 'Fayetteville', 'Fort Smith', 'Pine Bluff'] },
  { state: 'OK', weight: 3, cities: ['Oklahoma City', 'Tulsa', 'Norman', 'Edmond', 'Lawton'] },
  { state: 'KY', weight: 2, cities: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro'] },
  { state: 'VA', weight: 4, cities: ['Virginia Beach', 'Richmond', 'Norfolk', 'Chesapeake', 'Newport News'] },
  { state: 'MD', weight: 3, cities: ['Baltimore', 'Annapolis', 'Frederick', 'Rockville', 'Silver Spring'] },
  { state: 'NJ', weight: 4, cities: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton'] },
  { state: 'NY', weight: 4, cities: ['Brooklyn', 'Bronx', 'Queens', 'Buffalo', 'Rochester', 'Yonkers'] },
  { state: 'IN', weight: 3, cities: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel'] },
  { state: 'WI', weight: 2, cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha'] },
  { state: 'MO', weight: 3, cities: ['St. Louis', 'Kansas City', 'Springfield', 'Columbia'] },
  { state: 'WA', weight: 3, cities: ['Seattle', 'Tacoma', 'Spokane', 'Bellevue', 'Kent'] },
  { state: 'OR', weight: 2, cities: ['Portland', 'Eugene', 'Salem', 'Beaverton'] },
  { state: 'CO', weight: 2, cities: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins'] },
  { state: 'AZ', weight: 3, cities: ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Glendale'] },
  { state: 'NV', weight: 1, cities: ['Las Vegas', 'Henderson', 'Reno'] },
  { state: 'UT', weight: 1, cities: ['Salt Lake City', 'West Valley City', 'Provo'] },
  { state: 'MN', weight: 2, cities: ['Minneapolis', 'St. Paul', 'Rochester', 'Bloomington'] },
  { state: 'IA', weight: 2, cities: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City'] },
  { state: 'KS', weight: 1, cities: ['Wichita', 'Overland Park', 'Kansas City', 'Topeka'] },
  { state: 'NE', weight: 1, cities: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island'] },
  { state: 'NM', weight: 1, cities: ['Albuquerque', 'Las Cruces', 'Santa Fe'] },
  { state: 'WV', weight: 1, cities: ['Charleston', 'Huntington', 'Morgantown'] },
  { state: 'CT', weight: 1, cities: ['Bridgeport', 'New Haven', 'Hartford', 'Stamford'] },
  { state: 'MA', weight: 2, cities: ['Boston', 'Worcester', 'Springfield', 'Lowell'] },
  { state: 'HI', weight: 1, cities: ['Honolulu', 'Pearl City', 'Hilo'] },
];
