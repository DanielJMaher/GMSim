/**
 * First-name pool for procedurally generated NFL personnel (owners, GMs,
 * head coaches). Mix is intended to roughly reflect demographic variation
 * present in modern NFL front offices and coaching staffs.
 *
 * This pool feeds the Personnel Generation System. Pool size is modest
 * (~140 names); combined with the last-name pool the combinatorial space
 * is large enough to avoid duplicate names across multiple playthroughs
 * and the league's coaching/GM carousel turnover.
 *
 * Expand or rebalance as needed; the pool isn't load-bearing for any
 * mechanic — it only affects the surface texture of generated names.
 */
export const FIRST_NAMES: readonly string[] = [
  // Common Anglo
  'Aaron', 'Adam', 'Alan', 'Andrew', 'Anthony', 'Brad', 'Brandon', 'Brian',
  'Bruce', 'Bryan', 'Carl', 'Charles', 'Chris', 'Christian', 'Cole', 'Connor',
  'Craig', 'Daniel', 'Dave', 'David', 'Dean', 'Don', 'Doug', 'Drew', 'Edward',
  'Eric', 'Frank', 'Gary', 'George', 'Glenn', 'Greg', 'Henry', 'Howard',
  'Jack', 'James', 'Jason', 'Jeff', 'Jim', 'John', 'Jonathan', 'Joseph',
  'Josh', 'Justin', 'Keith', 'Ken', 'Kenny', 'Kevin', 'Kyle', 'Larry',
  'Lawrence', 'Lee', 'Mark', 'Matt', 'Michael', 'Mike', 'Nathan', 'Nick',
  'Patrick', 'Paul', 'Peter', 'Phil', 'Randy', 'Ray', 'Richard', 'Rick',
  'Robert', 'Ron', 'Ryan', 'Scott', 'Sean', 'Stephen', 'Steven', 'Ted',
  'Thomas', 'Tim', 'Todd', 'Tom', 'Tony', 'Walter', 'Wayne', 'William', 'Zach',
  // Italian / Mediterranean
  'Angelo', 'Carmine', 'Dominic', 'Enzo', 'Frankie', 'Gino', 'Marco', 'Mario',
  'Nico', 'Sal', 'Vito', 'Vince',
  // Irish
  'Brendan', 'Colin', 'Connor', 'Declan', 'Liam', 'Quinn', 'Rory', 'Shane',
  // Black / African-American
  'Andre', 'Antoine', 'Antonio', 'Calvin', 'Cameron', 'Dante', 'Darius',
  'DeMarcus', 'DeMeco', 'Derek', 'Dwayne', 'Hue', 'Jamal', 'Jamarcus',
  'Jermaine', 'Jerome', 'Jerry', 'Lamar', 'Lovie', 'Malcolm', 'Marcus',
  'Marvin', 'Maurice', 'Maurkice', 'Reggie', 'Romeo', 'Stefon', 'Tyrone',
  'Xavier',
  // Hispanic / Latino
  'Carlos', 'Diego', 'Eduardo', 'Hector', 'Javier', 'Jorge', 'Jose',
  'Manuel', 'Miguel', 'Rafael', 'Raul', 'Ricardo', 'Roberto', 'Sergio',
  // Eastern European / Polish
  'Andrzej', 'Boris', 'Pavel', 'Stefan', 'Viktor',
  // Jewish-American (often German/Yiddish origin)
  'Aaron', 'Daniel', 'Ezra', 'Isaac', 'Jacob', 'Jonah', 'Levi', 'Noah',
  'Saul', 'Simon',
] as const;
