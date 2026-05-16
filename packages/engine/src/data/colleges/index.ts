import type { CollegeConference, CollegeSchool } from '../../types/college.js';

/**
 * Static catalog of college football programs and conferences. Real-ish
 * names + plausible 2026-era conference structure. The catalog is
 * deliberately broad — ~80 schools across all four tiers — so that
 * draft-class generation has a realistic distribution of POWER,
 * GROUP_OF_5, FCS, and small-school origins.
 *
 * IDs are stable strings. Display names are short ("Alabama" not
 * "University of Alabama"). State codes are USPS two-letter.
 *
 * Reorganizations welcome — what matters for draft scouting is the
 * tier distribution and that "small-school gem" hometowns map to
 * lower-tier programs. Real conference geography is approximated
 * to keep the data set legible at a glance.
 */

export const CONFERENCES: readonly CollegeConference[] = [
  // Power
  { id: 'SEC', name: 'Southeastern Conference', tier: 'POWER' },
  { id: 'BIG_TEN', name: 'Big Ten Conference', tier: 'POWER' },
  { id: 'BIG_12', name: 'Big 12 Conference', tier: 'POWER' },
  { id: 'ACC', name: 'Atlantic Coast Conference', tier: 'POWER' },
  // Group of 5
  { id: 'AAC', name: 'American Athletic Conference', tier: 'GROUP_OF_5' },
  { id: 'MWC', name: 'Mountain West Conference', tier: 'GROUP_OF_5' },
  { id: 'MAC', name: 'Mid-American Conference', tier: 'GROUP_OF_5' },
  { id: 'SUN_BELT', name: 'Sun Belt Conference', tier: 'GROUP_OF_5' },
  { id: 'CUSA', name: 'Conference USA', tier: 'GROUP_OF_5' },
  // FCS umbrella (treated as one bucket for slice 1)
  { id: 'FCS', name: 'FCS Independent', tier: 'FCS' },
  // Small school umbrella
  { id: 'SMALL', name: 'Division II / III / NAIA', tier: 'SMALL' },
];

const CONFERENCE_TIER_BY_ID = new Map(CONFERENCES.map((c) => [c.id, c.tier] as const));

interface SchoolSpec {
  id: string;
  name: string;
  conferenceId: string;
  state: string;
}

const SCHOOL_SPECS: readonly SchoolSpec[] = [
  // ── SEC (16) ───────────────────────────────────────────────────────
  { id: 'ALABAMA', name: 'Alabama', conferenceId: 'SEC', state: 'AL' },
  { id: 'AUBURN', name: 'Auburn', conferenceId: 'SEC', state: 'AL' },
  { id: 'ARKANSAS', name: 'Arkansas', conferenceId: 'SEC', state: 'AR' },
  { id: 'FLORIDA', name: 'Florida', conferenceId: 'SEC', state: 'FL' },
  { id: 'GEORGIA', name: 'Georgia', conferenceId: 'SEC', state: 'GA' },
  { id: 'KENTUCKY', name: 'Kentucky', conferenceId: 'SEC', state: 'KY' },
  { id: 'LSU', name: 'LSU', conferenceId: 'SEC', state: 'LA' },
  { id: 'MISSISSIPPI_STATE', name: 'Mississippi State', conferenceId: 'SEC', state: 'MS' },
  { id: 'MISSOURI', name: 'Missouri', conferenceId: 'SEC', state: 'MO' },
  { id: 'OLE_MISS', name: 'Ole Miss', conferenceId: 'SEC', state: 'MS' },
  { id: 'OKLAHOMA', name: 'Oklahoma', conferenceId: 'SEC', state: 'OK' },
  { id: 'SOUTH_CAROLINA', name: 'South Carolina', conferenceId: 'SEC', state: 'SC' },
  { id: 'TENNESSEE', name: 'Tennessee', conferenceId: 'SEC', state: 'TN' },
  { id: 'TEXAS', name: 'Texas', conferenceId: 'SEC', state: 'TX' },
  { id: 'TEXAS_AM', name: 'Texas A&M', conferenceId: 'SEC', state: 'TX' },
  { id: 'VANDERBILT', name: 'Vanderbilt', conferenceId: 'SEC', state: 'TN' },

  // ── Big Ten (18) ───────────────────────────────────────────────────
  { id: 'ILLINOIS', name: 'Illinois', conferenceId: 'BIG_TEN', state: 'IL' },
  { id: 'INDIANA', name: 'Indiana', conferenceId: 'BIG_TEN', state: 'IN' },
  { id: 'IOWA', name: 'Iowa', conferenceId: 'BIG_TEN', state: 'IA' },
  { id: 'MARYLAND', name: 'Maryland', conferenceId: 'BIG_TEN', state: 'MD' },
  { id: 'MICHIGAN', name: 'Michigan', conferenceId: 'BIG_TEN', state: 'MI' },
  { id: 'MICHIGAN_STATE', name: 'Michigan State', conferenceId: 'BIG_TEN', state: 'MI' },
  { id: 'MINNESOTA', name: 'Minnesota', conferenceId: 'BIG_TEN', state: 'MN' },
  { id: 'NEBRASKA', name: 'Nebraska', conferenceId: 'BIG_TEN', state: 'NE' },
  { id: 'NORTHWESTERN', name: 'Northwestern', conferenceId: 'BIG_TEN', state: 'IL' },
  { id: 'OHIO_STATE', name: 'Ohio State', conferenceId: 'BIG_TEN', state: 'OH' },
  { id: 'OREGON', name: 'Oregon', conferenceId: 'BIG_TEN', state: 'OR' },
  { id: 'PENN_STATE', name: 'Penn State', conferenceId: 'BIG_TEN', state: 'PA' },
  { id: 'PURDUE', name: 'Purdue', conferenceId: 'BIG_TEN', state: 'IN' },
  { id: 'RUTGERS', name: 'Rutgers', conferenceId: 'BIG_TEN', state: 'NJ' },
  { id: 'UCLA', name: 'UCLA', conferenceId: 'BIG_TEN', state: 'CA' },
  { id: 'USC', name: 'USC', conferenceId: 'BIG_TEN', state: 'CA' },
  { id: 'WASHINGTON', name: 'Washington', conferenceId: 'BIG_TEN', state: 'WA' },
  { id: 'WISCONSIN', name: 'Wisconsin', conferenceId: 'BIG_TEN', state: 'WI' },

  // ── Big 12 (16) ────────────────────────────────────────────────────
  { id: 'ARIZONA', name: 'Arizona', conferenceId: 'BIG_12', state: 'AZ' },
  { id: 'ARIZONA_STATE', name: 'Arizona State', conferenceId: 'BIG_12', state: 'AZ' },
  { id: 'BAYLOR', name: 'Baylor', conferenceId: 'BIG_12', state: 'TX' },
  { id: 'BYU', name: 'BYU', conferenceId: 'BIG_12', state: 'UT' },
  { id: 'CINCINNATI', name: 'Cincinnati', conferenceId: 'BIG_12', state: 'OH' },
  { id: 'COLORADO', name: 'Colorado', conferenceId: 'BIG_12', state: 'CO' },
  { id: 'HOUSTON', name: 'Houston', conferenceId: 'BIG_12', state: 'TX' },
  { id: 'IOWA_STATE', name: 'Iowa State', conferenceId: 'BIG_12', state: 'IA' },
  { id: 'KANSAS', name: 'Kansas', conferenceId: 'BIG_12', state: 'KS' },
  { id: 'KANSAS_STATE', name: 'Kansas State', conferenceId: 'BIG_12', state: 'KS' },
  { id: 'OKLAHOMA_STATE', name: 'Oklahoma State', conferenceId: 'BIG_12', state: 'OK' },
  { id: 'TCU', name: 'TCU', conferenceId: 'BIG_12', state: 'TX' },
  { id: 'TEXAS_TECH', name: 'Texas Tech', conferenceId: 'BIG_12', state: 'TX' },
  { id: 'UCF', name: 'UCF', conferenceId: 'BIG_12', state: 'FL' },
  { id: 'UTAH', name: 'Utah', conferenceId: 'BIG_12', state: 'UT' },
  { id: 'WEST_VIRGINIA', name: 'West Virginia', conferenceId: 'BIG_12', state: 'WV' },

  // ── ACC (17) ───────────────────────────────────────────────────────
  { id: 'BOSTON_COLLEGE', name: 'Boston College', conferenceId: 'ACC', state: 'MA' },
  { id: 'CAL', name: 'California', conferenceId: 'ACC', state: 'CA' },
  { id: 'CLEMSON', name: 'Clemson', conferenceId: 'ACC', state: 'SC' },
  { id: 'DUKE', name: 'Duke', conferenceId: 'ACC', state: 'NC' },
  { id: 'FLORIDA_STATE', name: 'Florida State', conferenceId: 'ACC', state: 'FL' },
  { id: 'GEORGIA_TECH', name: 'Georgia Tech', conferenceId: 'ACC', state: 'GA' },
  { id: 'LOUISVILLE', name: 'Louisville', conferenceId: 'ACC', state: 'KY' },
  { id: 'MIAMI_FL', name: 'Miami (FL)', conferenceId: 'ACC', state: 'FL' },
  { id: 'NC_STATE', name: 'NC State', conferenceId: 'ACC', state: 'NC' },
  { id: 'NORTH_CAROLINA', name: 'North Carolina', conferenceId: 'ACC', state: 'NC' },
  { id: 'NOTRE_DAME', name: 'Notre Dame', conferenceId: 'ACC', state: 'IN' },
  { id: 'PITTSBURGH', name: 'Pittsburgh', conferenceId: 'ACC', state: 'PA' },
  { id: 'STANFORD', name: 'Stanford', conferenceId: 'ACC', state: 'CA' },
  { id: 'SMU', name: 'SMU', conferenceId: 'ACC', state: 'TX' },
  { id: 'SYRACUSE', name: 'Syracuse', conferenceId: 'ACC', state: 'NY' },
  { id: 'VIRGINIA', name: 'Virginia', conferenceId: 'ACC', state: 'VA' },
  { id: 'VIRGINIA_TECH', name: 'Virginia Tech', conferenceId: 'ACC', state: 'VA' },
  { id: 'WAKE_FOREST', name: 'Wake Forest', conferenceId: 'ACC', state: 'NC' },

  // ── AAC (Group of 5, 14) ───────────────────────────────────────────
  { id: 'EAST_CAROLINA', name: 'East Carolina', conferenceId: 'AAC', state: 'NC' },
  { id: 'FLORIDA_ATLANTIC', name: 'Florida Atlantic', conferenceId: 'AAC', state: 'FL' },
  { id: 'MEMPHIS', name: 'Memphis', conferenceId: 'AAC', state: 'TN' },
  { id: 'NAVY', name: 'Navy', conferenceId: 'AAC', state: 'MD' },
  { id: 'NORTH_TEXAS', name: 'North Texas', conferenceId: 'AAC', state: 'TX' },
  { id: 'RICE', name: 'Rice', conferenceId: 'AAC', state: 'TX' },
  { id: 'SOUTH_FLORIDA', name: 'South Florida', conferenceId: 'AAC', state: 'FL' },
  { id: 'TEMPLE', name: 'Temple', conferenceId: 'AAC', state: 'PA' },
  { id: 'TULANE', name: 'Tulane', conferenceId: 'AAC', state: 'LA' },
  { id: 'TULSA', name: 'Tulsa', conferenceId: 'AAC', state: 'OK' },
  { id: 'UAB', name: 'UAB', conferenceId: 'AAC', state: 'AL' },
  { id: 'UTSA', name: 'UTSA', conferenceId: 'AAC', state: 'TX' },

  // ── MWC (Group of 5, 12) ───────────────────────────────────────────
  { id: 'AIR_FORCE', name: 'Air Force', conferenceId: 'MWC', state: 'CO' },
  { id: 'BOISE_STATE', name: 'Boise State', conferenceId: 'MWC', state: 'ID' },
  { id: 'COLORADO_STATE', name: 'Colorado State', conferenceId: 'MWC', state: 'CO' },
  { id: 'FRESNO_STATE', name: 'Fresno State', conferenceId: 'MWC', state: 'CA' },
  { id: 'HAWAII', name: 'Hawaii', conferenceId: 'MWC', state: 'HI' },
  { id: 'NEVADA', name: 'Nevada', conferenceId: 'MWC', state: 'NV' },
  { id: 'NEW_MEXICO', name: 'New Mexico', conferenceId: 'MWC', state: 'NM' },
  { id: 'SAN_DIEGO_STATE', name: 'San Diego State', conferenceId: 'MWC', state: 'CA' },
  { id: 'SAN_JOSE_STATE', name: 'San Jose State', conferenceId: 'MWC', state: 'CA' },
  { id: 'UNLV', name: 'UNLV', conferenceId: 'MWC', state: 'NV' },
  { id: 'UTAH_STATE', name: 'Utah State', conferenceId: 'MWC', state: 'UT' },
  { id: 'WYOMING', name: 'Wyoming', conferenceId: 'MWC', state: 'WY' },

  // ── MAC (Group of 5, 11) ───────────────────────────────────────────
  { id: 'AKRON', name: 'Akron', conferenceId: 'MAC', state: 'OH' },
  { id: 'BALL_STATE', name: 'Ball State', conferenceId: 'MAC', state: 'IN' },
  { id: 'BOWLING_GREEN', name: 'Bowling Green', conferenceId: 'MAC', state: 'OH' },
  { id: 'BUFFALO', name: 'Buffalo', conferenceId: 'MAC', state: 'NY' },
  { id: 'CENTRAL_MICHIGAN', name: 'Central Michigan', conferenceId: 'MAC', state: 'MI' },
  { id: 'EASTERN_MICHIGAN', name: 'Eastern Michigan', conferenceId: 'MAC', state: 'MI' },
  { id: 'KENT_STATE', name: 'Kent State', conferenceId: 'MAC', state: 'OH' },
  { id: 'NORTHERN_ILLINOIS', name: 'Northern Illinois', conferenceId: 'MAC', state: 'IL' },
  { id: 'OHIO', name: 'Ohio', conferenceId: 'MAC', state: 'OH' },
  { id: 'TOLEDO', name: 'Toledo', conferenceId: 'MAC', state: 'OH' },
  { id: 'WESTERN_MICHIGAN', name: 'Western Michigan', conferenceId: 'MAC', state: 'MI' },

  // ── Sun Belt (Group of 5, 8) ───────────────────────────────────────
  { id: 'APPALACHIAN_STATE', name: 'Appalachian State', conferenceId: 'SUN_BELT', state: 'NC' },
  { id: 'COASTAL_CAROLINA', name: 'Coastal Carolina', conferenceId: 'SUN_BELT', state: 'SC' },
  { id: 'GEORGIA_SOUTHERN', name: 'Georgia Southern', conferenceId: 'SUN_BELT', state: 'GA' },
  { id: 'JAMES_MADISON', name: 'James Madison', conferenceId: 'SUN_BELT', state: 'VA' },
  { id: 'LOUISIANA', name: 'Louisiana', conferenceId: 'SUN_BELT', state: 'LA' },
  { id: 'MARSHALL', name: 'Marshall', conferenceId: 'SUN_BELT', state: 'WV' },
  { id: 'SOUTH_ALABAMA', name: 'South Alabama', conferenceId: 'SUN_BELT', state: 'AL' },
  { id: 'TROY', name: 'Troy', conferenceId: 'SUN_BELT', state: 'AL' },

  // ── C-USA (Group of 5, 6) ──────────────────────────────────────────
  { id: 'JACKSONVILLE_STATE', name: 'Jacksonville State', conferenceId: 'CUSA', state: 'AL' },
  { id: 'LIBERTY', name: 'Liberty', conferenceId: 'CUSA', state: 'VA' },
  { id: 'MIDDLE_TENNESSEE', name: 'Middle Tennessee', conferenceId: 'CUSA', state: 'TN' },
  { id: 'NEW_MEXICO_STATE', name: 'New Mexico State', conferenceId: 'CUSA', state: 'NM' },
  { id: 'WESTERN_KENTUCKY', name: 'Western Kentucky', conferenceId: 'CUSA', state: 'KY' },
  { id: 'UTEP', name: 'UTEP', conferenceId: 'CUSA', state: 'TX' },

  // ── FCS umbrella (8 representative programs) ───────────────────────
  { id: 'NORTH_DAKOTA_STATE', name: 'North Dakota State', conferenceId: 'FCS', state: 'ND' },
  { id: 'SOUTH_DAKOTA_STATE', name: 'South Dakota State', conferenceId: 'FCS', state: 'SD' },
  { id: 'MONTANA', name: 'Montana', conferenceId: 'FCS', state: 'MT' },
  { id: 'MONTANA_STATE', name: 'Montana State', conferenceId: 'FCS', state: 'MT' },
  { id: 'JACKSON_STATE', name: 'Jackson State', conferenceId: 'FCS', state: 'MS' },
  { id: 'NORTHERN_IOWA', name: 'Northern Iowa', conferenceId: 'FCS', state: 'IA' },
  { id: 'CHATTANOOGA', name: 'Chattanooga', conferenceId: 'FCS', state: 'TN' },
  { id: 'GRAMBLING', name: 'Grambling State', conferenceId: 'FCS', state: 'LA' },

  // ── Small school umbrella (4 generic placeholders) ─────────────────
  { id: 'SMALL_NE', name: 'Northeast Small College', conferenceId: 'SMALL', state: 'PA' },
  { id: 'SMALL_SE', name: 'Southeast Small College', conferenceId: 'SMALL', state: 'AL' },
  { id: 'SMALL_MW', name: 'Midwest Small College', conferenceId: 'SMALL', state: 'OH' },
  { id: 'SMALL_W', name: 'West Small College', conferenceId: 'SMALL', state: 'CA' },
];

export const COLLEGE_SCHOOLS: readonly CollegeSchool[] = SCHOOL_SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  conferenceId: s.conferenceId,
  tier: CONFERENCE_TIER_BY_ID.get(s.conferenceId) ?? 'GROUP_OF_5',
  state: s.state,
}));

const SCHOOLS_BY_ID = new Map(COLLEGE_SCHOOLS.map((s) => [s.id, s] as const));
const SCHOOLS_BY_TIER = new Map<CollegeSchool['tier'], CollegeSchool[]>();
for (const school of COLLEGE_SCHOOLS) {
  const arr = SCHOOLS_BY_TIER.get(school.tier) ?? [];
  arr.push(school);
  SCHOOLS_BY_TIER.set(school.tier, arr);
}

export function getSchoolById(id: string): CollegeSchool | undefined {
  return SCHOOLS_BY_ID.get(id);
}

export function getSchoolsByTier(tier: CollegeSchool['tier']): readonly CollegeSchool[] {
  return SCHOOLS_BY_TIER.get(tier) ?? [];
}
