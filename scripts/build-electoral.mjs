// State results, electors and populations -> public/electoral.json. Usage: npm run data:electoral
// Sources, committed in data/ (see README):
//   state-results.csv     The American Presidency Project (UCSB), statistics/elections/<year>: votes and electors
//                         per state as listed there. Rows with a district are Maine/Nebraska congressional districts
//                         (their electors are also in the statewide row); Maine 2016's come from its certificate of
//                         ascertainment at the National Archives, as UCSB lists only the statewide result.
//   state-population.csv  Resident population per census: U.S. Census Bureau apportionment.csv (1910-2020);
//                         1860-1900 from Wikipedia's census table (modern state boundaries).
//   county-land.csv       Census 2020 Gazetteer, county land area (square miles).
import { readFileSync, writeFileSync } from 'node:fs';
import { csvParse } from 'd3';

const read = (name) => csvParse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const elections = JSON.parse(readFileSync(new URL('../public/elections.json', import.meta.url), 'utf8'));
const years = elections.years;

const states = {
  Alabama: ['AL', '01'], Alaska: ['AK', '02'], Arizona: ['AZ', '04'], Arkansas: ['AR', '05'], California: ['CA', '06'],
  Colorado: ['CO', '08'], Connecticut: ['CT', '09'], Delaware: ['DE', '10'], 'District of Columbia': ['DC', '11'],
  Florida: ['FL', '12'], Georgia: ['GA', '13'], Hawaii: ['HI', '15'], Idaho: ['ID', '16'], Illinois: ['IL', '17'],
  Indiana: ['IN', '18'], Iowa: ['IA', '19'], Kansas: ['KS', '20'], Kentucky: ['KY', '21'], Louisiana: ['LA', '22'],
  Maine: ['ME', '23'], Maryland: ['MD', '24'], Massachusetts: ['MA', '25'], Michigan: ['MI', '26'], Minnesota: ['MN', '27'],
  Mississippi: ['MS', '28'], Missouri: ['MO', '29'], Montana: ['MT', '30'], Nebraska: ['NE', '31'], Nevada: ['NV', '32'],
  'New Hampshire': ['NH', '33'], 'New Jersey': ['NJ', '34'], 'New Mexico': ['NM', '35'], 'New York': ['NY', '36'],
  'North Carolina': ['NC', '37'], 'North Dakota': ['ND', '38'], Ohio: ['OH', '39'], Oklahoma: ['OK', '40'], Oregon: ['OR', '41'],
  Pennsylvania: ['PA', '42'], 'Rhode Island': ['RI', '44'], 'South Carolina': ['SC', '45'], 'South Dakota': ['SD', '46'],
  Tennessee: ['TN', '47'], Texas: ['TX', '48'], Utah: ['UT', '49'], Vermont: ['VT', '50'], Virginia: ['VA', '51'],
  Washington: ['WA', '53'], 'West Virginia': ['WV', '54'], Wisconsin: ['WI', '55'], Wyoming: ['WY', '56'],
};

// Where the electors' votes differ from the state's result. `listed` is what the source row shows, checked
// so a re-scrape cannot silently disagree; `won` is who the state's result elected, `cast` what was counted.
const exceptions = [
  // Greeley died after the popular vote. His electors voted for others; Congress rejected Georgia's 3 votes
  // for him, and the returns of Arkansas and Louisiana (both Grant).
  ...[['Georgia', 11, { O: 8, none: 3 }], ['Kentucky', 12], ['Maryland', 8], ['Missouri', 15], ['Tennessee', 12], ['Texas', 8]]
    .map(([state, n, cast]) => [1872, state, {}, { D: n }, cast ?? { O: n }]),
  [1872, 'Arkansas', {}, { R: 6 }, { none: 6 }],
  [1872, 'Louisiana', {}, { R: 8 }, { none: 8 }],
  [1948, 'Tennessee', { D: 11, O: 1 }, { D: 12 }, { D: 11, O: 1 }],
  [1956, 'Alabama', { D: 10 }, { D: 11 }, { D: 10, O: 1 }],
  // Unpledged Democratic electors: 6 of Alabama's 11 and Mississippi's whole slate voted for Harry Byrd.
  [1960, 'Alabama', { D: 5 }, { D: 5, O: 6 }, { D: 5, O: 6 }],
  [1960, 'Mississippi', {}, { O: 8 }, { O: 8 }, 'unpledged'],
  [1960, 'Oklahoma', { R: 7 }, { R: 8 }, { R: 7, O: 1 }],
  [1968, 'North Carolina', { R: 12, O: 1 }, { R: 13 }, { R: 12, O: 1 }],
  [1972, 'Virginia', { R: 11 }, { R: 12 }, { R: 11, O: 1 }],
  [1976, 'Washington', { R: 8 }, { R: 9 }, { R: 8, O: 1 }],
  [1988, 'West Virginia', { D: 5 }, { D: 6 }, { D: 5, O: 1 }],
  [2000, 'District of Columbia', { D: 2 }, { D: 3 }, { D: 2, none: 1 }],
  [2004, 'Minnesota', { D: 9 }, { D: 10 }, { D: 9, O: 1 }],
  [2016, 'Texas', { R: 38 }, { R: 38 }, { R: 36, O: 2 }],
  [2016, 'Washington', { D: 12 }, { D: 12 }, { D: 8, O: 4 }],
  [2016, 'Hawaii', { D: 4 }, { D: 4 }, { D: 3, O: 1 }],
];

// Who the "other" electors went to, and the national result Congress counted, to check the table against.
const others = {
  1872: "others after Greeley's death", 1892: 'Weaver', 1912: 'T. Roosevelt', 1924: 'La Follette', 1948: 'Thurmond',
  1956: 'Walter B. Jones', 1960: 'Byrd', 1968: 'Wallace', 1972: 'Hospers', 1976: 'Reagan', 1988: 'Bentsen', 2004: 'Edwards',
  2016: 'Powell, Kasich, Sanders, Paul, Spotted Eagle',
};
const counted = `1868 R214 D80|1872 R286 O63 X17|1876 R185 D184|1880 R214 D155|1884 D219 R182|1888 R233 D168|1892 D277 R145 O22|
1896 R271 D176|1900 R292 D155|1904 R336 D140|1908 R321 D162|1912 D435 O88 R8|1916 D277 R254|1920 R404 D127|1924 R382 D136 O13|
1928 R444 D87|1932 D472 R59|1936 D523 R8|1940 D449 R82|1944 D432 R99|1948 D303 R189 O39|1952 R442 D89|1956 R457 D73 O1|
1960 D303 R219 O15|1964 D486 R52|1968 R301 D191 O46|1972 R520 D17 O1|1976 D297 R240 O1|1980 R489 D49|1984 R525 D13|
1988 R426 D111 O1|1992 D370 R168|1996 D379 R159|2000 R271 D266 X1|2004 R286 D251 O1|2008 D365 R173|2012 D332 R206|
2016 R304 D227 O7|2020 D306 R232|2024 R312 D226`;

const parties = ['D', 'R', 'O'];
const tally = (parts, keys = [...parties, 'none']) => Object.fromEntries(keys.map((key) => [key, parts.reduce((sum, part) => sum + (part[key] ?? 0), 0)]));
const same = (a, b) => [...parties, 'none'].every((key) => (a[key] ?? 0) === (b[key] ?? 0));
const fail = (message) => { throw new Error(message); };

// Electors are set by the latest census before the election, except that Congress never reapportioned after 1920.
const censusFor = (year) => year < 1872 ? 1860 : year >= 1912 && year < 1932 ? 1910 : Math.floor((year - 2) / 10) * 10;
const population = new Map(read('state-population.csv').map((row) => [`${row.state} ${row.census}`, Number(row.population)]));

const rows = read('state-results.csv');
const votesOf = (row) => row.chosen_by === 'legislature' ? null : [row.d_votes, row.r_votes, row.top_other_votes, row.total_votes].map(Number);
const electorsOf = (row) => Object.fromEntries(parties.map((key) => [key, Number(row[`${key === 'O' ? 'other' : key.toLowerCase()}_electors`])]).filter(([, n]) => n));
const output = years.map((year, index) => {
  const stateRows = rows.filter((row) => Number(row.year) === year && !row.district);
  if (!stateRows.length) fail(`No state results for ${year}`);
  const result = stateRows.map((row) => {
    if (!states[row.state]) fail(`Unknown state ${row.state}`);
    const listed = electorsOf(row);
    const exception = exceptions.find(([y, state]) => y === year && state === row.state);
    if (exception && !same(exception[2], listed)) fail(`${year} ${row.state}: source lists ${JSON.stringify(listed)}, expected ${JSON.stringify(exception[2])}`);
    const won = exception?.[3] ?? listed;
    const cast = exception?.[4] ?? listed;
    const size = (part) => Object.values(part).reduce((sum, n) => sum + n, 0);
    if (size(won) !== size(cast)) fail(`${year} ${row.state}: cast and won electors differ in number`);
    const votes = votesOf(row);
    // Mississippi 1960's winning unpledged slate has no column of its own: it is the rest of the vote.
    if (exception?.[5] === 'unpledged') votes[2] = votes[3] - votes[0] - votes[1];
    if (votes && (votes.some((value) => !Number.isInteger(value) || value < 0) || votes[0] + votes[1] + votes[2] > votes[3])) fail(`${year} ${row.state}: bad votes ${votes}`);
    const districts = rows.filter((other) => Number(other.year) === year && other.state === row.state && other.district)
      .map((district) => ({ name: district.district, won: electorsOf(district), votes: votesOf(district) }));
    const people = population.get(`${row.state} ${censusFor(year)}`);
    if (!people) fail(`${year} ${row.state}: no population for ${censusFor(year)}`);
    return {
      state: states[row.state][0],
      won,
      ...(same(won, cast) ? {} : { cast }),
      votes,
      population: people,
      ...(districts.length ? { districts } : {}),
    };
  });
  const cast = tally(result.map((state) => state.cast ?? state.won));
  const expected = Object.fromEntries(counted.split('|').find((line) => line.trim().startsWith(year)).trim().split(' ').slice(1)
    .map((part) => [part[0] === 'X' ? 'none' : part[0], Number(part.slice(1))]));
  if (!same(cast, expected)) fail(`${year}: counted ${JSON.stringify(cast)}, expected ${JSON.stringify(expected)}`);
  const nominees = elections.nominees[index];
  return { year, census: censusFor(year), nominees, other: others[year] ?? null, cast, states: result };
});

// Land area of the counties that can have returns on the map: the 48 contiguous states and DC (Alaska reports
// by district, and Hawaii is drawn at its true position but is not part of the "lower 48" area share).
const land = Object.fromEntries(read('county-land.csv')
  .filter(({ fips }) => elections.counties[fips] && !['02', '15'].includes(fips.slice(0, 2)))
  .map(({ fips, land_sq_mi: area }) => [fips, Number(area)]));
const unmatched = Object.keys(elections.counties).filter((fips) => !land[fips] && !['02', '15'].includes(fips.slice(0, 2)));
if (unmatched.length) fail(`No land area for ${unmatched.join(', ')}`);

writeFileSync(new URL('../public/electoral.json', import.meta.url), JSON.stringify({
  states: Object.fromEntries(Object.entries(states).map(([name, [code, fips]]) => [code, { name, fips }])),
  elections: output,
  countyLand: land,
}));
console.log(`${output.length} elections, ${rows.length} state results, ${Object.keys(land).length} county land areas -> public/electoral.json`);
