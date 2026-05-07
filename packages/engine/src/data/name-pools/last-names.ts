/**
 * Last-name pool for procedurally generated NFL personnel.
 *
 * See `first-names.ts` for pool design notes.
 */
export const LAST_NAMES: readonly string[] = [
  // Anglo
  'Adams', 'Allen', 'Anderson', 'Bailey', 'Baker', 'Barnes', 'Beck', 'Bell',
  'Bennett', 'Brooks', 'Brown', 'Bryant', 'Burns', 'Butler', 'Campbell',
  'Carter', 'Clark', 'Cole', 'Collins', 'Cook', 'Cooper', 'Cox', 'Davis',
  'Edwards', 'Evans', 'Fisher', 'Foster', 'Garrett', 'Gibson', 'Gray',
  'Green', 'Hall', 'Harris', 'Hayes', 'Hill', 'Howard', 'Hughes', 'Hunter',
  'Jackson', 'James', 'Johnson', 'Jones', 'Kelly', 'King', 'Lewis', 'Long',
  'Marshall', 'Martin', 'Mitchell', 'Moore', 'Morgan', 'Morris', 'Murphy',
  'Nelson', 'Owens', 'Parker', 'Patterson', 'Phillips', 'Powell', 'Price',
  'Reed', 'Richardson', 'Roberts', 'Robinson', 'Rogers', 'Russell', 'Ross',
  'Sanders', 'Scott', 'Sharp', 'Simmons', 'Smith', 'Stewart', 'Sullivan',
  'Taylor', 'Thomas', 'Thompson', 'Turner', 'Walker', 'Ward', 'Washington',
  'Watson', 'Webb', 'Wells', 'White', 'Williams', 'Wilson', 'Wood', 'Wright',
  'Young',
  // Irish
  'Donnelly', 'Doyle', 'Flynn', "O'Brien", "O'Connor", "O'Reilly", 'Quinn',
  'Reilly', 'Walsh',
  // Italian
  'Belichick', 'Caldwell', 'Capers', 'Costanzo', 'D\'Amato', 'DeMarco',
  'Esposito', 'Genovese', 'Greco', 'Lombardi', 'Maraschino', 'Marino',
  'Marrone', 'McDermott', 'Pagano', 'Payton', 'Romano', 'Rossi', 'Salerno',
  'Vermeil',
  // Polish / Eastern European
  'Belichek', 'Brzezinski', 'Czerwinski', 'Kaminski', 'Kowalski', 'Lewandowski',
  'Nowak', 'Romanowski', 'Walinski', 'Zielinski',
  // German
  'Becker', 'Berger', 'Faulk', 'Fischer', 'Gruden', 'Hoffman', 'Klein',
  'Mueller', 'Schmidt', 'Schwartz', 'Wagner', 'Weber', 'Zimmer',
  // Jewish-American
  'Adler', 'Bloom', 'Cohen', 'Friedman', 'Goldberg', 'Greenberg', 'Katz',
  'Levin', 'Mandelbaum', 'Roth', 'Rubin', 'Schwartz',
  // Hispanic / Latino
  'Cordero', 'Cortez', 'Cruz', 'Diaz', 'Espinoza', 'Estrada', 'Flores',
  'Fuentes', 'Garcia', 'Gonzalez', 'Guerrero', 'Hernandez', 'Lopez',
  'Martinez', 'Mendoza', 'Molina', 'Munoz', 'Ortiz', 'Perez', 'Ramirez',
  'Reyes', 'Rivera', 'Rodriguez', 'Romero', 'Ruiz', 'Sanchez', 'Soto',
  'Suarez', 'Torres', 'Vargas', 'Vasquez',
  // Black / African-American (common surnames not above)
  'Beasley', 'Brown', 'Coleman', 'Crawford', 'Dawson', 'Dixon', 'Ellis',
  'Freeman', 'Gibson', 'Harper', 'Hayes', 'Henry', 'Hill', 'Hudson',
  'Jefferson', 'Jenkins', 'Lawson', 'Lewis', 'Lincoln', 'Mason', 'McCoy',
  'McKinney', 'Pierce', 'Porter', 'Reeves', 'Riley', 'Sims', 'Singletary',
  'Sutton', 'Wallace', 'Watkins', 'Weaver', 'Wilkins', 'Woodson',
] as const;
