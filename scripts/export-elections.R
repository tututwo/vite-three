# County presidential returns 1868-2020 -> public/elections.json
# Source: Amlani & Algara, Harvard Dataverse (the .Rdata in data/). Usage: npm run data:elections
load("data/dataverse_shareable_presidential_county_returns_1868_2020.Rdata")
d <- pres_elections_release

# Counties that were renamed, merged or absorbed. Their votes belong to the shape that covers
# them on today's map, so they are summed into the successor instead of being dropped.
successor <- c(
  "12025" = "12086", # Dade -> Miami-Dade, FL (1997)
  "13041" = "13121", # Campbell -> Fulton, GA (1932)
  "13203" = "13121", # Milton -> Fulton, GA (1932)
  "32025" = "32510", # Ormsby -> Carson City, NV (1969)
  "46001" = "46041", # Armstrong -> Dewey, SD (1952)
  "46113" = "46102", # Shannon -> Oglala Lakota, SD (2015)
  "46133" = "46102", # Washington -> Shannon, SD (1943)
  "46131" = "46071", # Washabaugh -> Jackson, SD (1983)
  "51055" = "51650", # Elizabeth City County -> Hampton, VA (1952)
  "51123" = "51800", # Nansemond -> Suffolk, VA (1974)
  "51129" = "51550", # Norfolk County -> Chesapeake, VA (1963)
  "51785" = "51550", # South Norfolk -> Chesapeake, VA (1963)
  "51151" = "51810", # Princess Anne -> Virginia Beach, VA (1963)
  "51189" = "51700", # Warwick -> Newport News, VA (1958)
  "51515" = "51019", # Bedford city -> Bedford County, VA (2013)
  "51560" = "51005", # Clifton Forge -> Alleghany, VA (2001)
  "51780" = "51083", # South Boston -> Halifax, VA (1995)
  # Enclaves that collapse to nothing in us-atlas' quantized geometry: counted with the county around them
  "51610" = "51059", # Falls Church -> Fairfax, VA
  "51678" = "51163", # Lexington -> Rockbridge, VA
  "51685" = "51153"  # Manassas Park -> Prince William, VA
)
# Misspellings in the source
nominee_fixes <- c(
  "Charles Evan Hughes" = "Charles Evans Hughes",
  "Calvin Cooldige" = "Calvin Coolidge",
  "Thomes E. Dewey" = "Thomas E. Dewey",
  "Herbert H. Humphrey" = "Hubert H. Humphrey"
)
fix <- function(x, table) ifelse(x %in% names(table), unname(table[x]), x)

years <- sort(unique(d$election_year))
stopifnot(identical(years, seq(1868, 2020, 4)))
nominees <- unique(d[, c("election_year", "dem_nominee", "rep_nominee")])
nominees <- nominees[order(nominees$election_year), ]
stopifnot(nrow(nominees) == length(years))

# 50 rows of long-gone counties have no fips, 88 have no votes, Jones TX 1884 is listed twice
d <- d[!is.na(d$fips) & grepl("^[0-9]{5}$", d$fips) & d$complete_county_cases == 1, ]
d <- d[!duplicated(d[, c("fips", "election_year")]), ]
d$fips <- fix(d$fips, successor)
# 55 totals are smaller than the two parties combined (Idaho 1912, Colorado 1924): trust the parties
d$total <- pmax(d$raw_county_vote_totals, d$democratic_raw_votes + d$republican_raw_votes)
votes <- aggregate(
  cbind(dem = democratic_raw_votes, rep = republican_raw_votes, total) ~ fips + election_year,
  d, sum
)
votes <- votes[votes$total > 0, ]

# Per county: Democratic minus Republican votes and all votes cast, null where it did not vote
counties <- lapply(split(votes, votes$fips), function(county) {
  diff <- total <- rep(NA_real_, length(years))
  at <- match(county$election_year, years)
  diff[at] <- county$dem - county$rep
  total[at] <- county$total
  list(diff = diff, total = total)
})

jsonlite::write_json(
  list(
    years = years,
    nominees = lapply(seq_along(years), function(i) {
      c(fix(nominees$dem_nominee[i], nominee_fixes), fix(nominees$rep_nominee[i], nominee_fixes))
    }),
    counties = counties
  ),
  "public/elections.json", na = "null", digits = NA
)
cat(length(counties), "counties,", nrow(votes), "county-elections -> public/elections.json\n")
