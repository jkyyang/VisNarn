"""Which kind of railroad each NARN owner / trackage-rights code is. The one list the pipeline uses.

class_of(code) -> "class1" | "regional" | "short line" | "passenger".
Every freight code that is neither Class I nor in REGIONAL is a short line, including codes we could not
identify: nothing is guessed into a bigger class.
"""

CLASS1 = ["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"]

# US Class II (regional) railroads, the AAR's current list as given by Wikipedia "Regional railroad"
# (https://en.wikipedia.org/wiki/Regional_railroad, read 2026-11-17), mapped to their NARN codes.
# Canada has no Class II category, so Canadian non-Class-I freight railroads are short lines.
REGIONAL = {
    "AGR",   # Alabama & Gulf Coast
    "ARR",   # Alaska Railroad
    "BPRR",  # Buffalo & Pittsburgh
    "CORP",  # Central Oregon & Pacific
    "DMVW",  # Dakota, Missouri Valley & Western
    "EVWR",  # Evansville Western
    "FEC",   # Florida East Coast
    "INRD",  # Indiana Rail Road
    "IAIS",  # Iowa Interstate
    "NECR",  # New England Central
    "NYSW",  # New York, Susquehanna & Western
    "PAL",   # Paducah & Louisville
    "PNWR",  # Portland & Western
    "PW",    # Providence & Worcester
    "RCPE",  # Rapid City, Pierre & Eastern
    "RRVW",  # Red River Valley & Western
    "WE",    # Wheeling & Lake Erie
    "WSOR",  # Wisconsin & Southern
}

# Passenger, commuter and transit agencies (and the public bodies that own track for them). Freight may
# run on their lines under trackage rights, but a freight car should use them only when asked to.
PASSENGER = {
    "AMTK",  # Amtrak: Northeast Corridor, Michigan and Keystone lines
    "VIA",   # VIA Rail Canada
    "GO",    # Metrolinx GO Transit, Toronto
    "NJT",   # New Jersey Transit
    "MNCW",  # Metro-North Commuter Railroad, New York / Connecticut
    "LI",    # Long Island Rail Road
    "PATH",  # Port Authority Trans-Hudson
    "SLE",   # Shore Line East (Connecticut DOT commuter service)
    "SEPA",  # SEPTA, Philadelphia
    "MARC",  # Maryland Transit Administration (MARC)
    "VREX",  # Virginia Railway Express
    "VPRA",  # Virginia Passenger Rail Authority
    "MBTA",  # Massachusetts Bay Transportation Authority
    "XMDT",  # Massachusetts DOT, commuter corridors run by the MBTA (Framingham)
    "NIRC",  # Metra (Northeast Illinois Regional Commuter Railroad), Chicago
    "NICD",  # Northern Indiana Commuter Transportation District (South Shore Line)
    "SCAX",  # Metrolink (Southern California Regional Rail Authority), Los Angeles
    "SDNR",  # San Diego Northern Railway (North County Transit District)
    "JPBX",  # Caltrain (Peninsula Corridor Joint Powers Board)
    "ACEX",  # Altamont Corridor Express
    "SMRT",  # Sonoma-Marin Area Rail Transit
    "SFRC",  # South Florida Rail Corridor (Tri-Rail, Florida DOT)
    "CFCR",  # Central Florida Rail Corridor (SunRail, Florida DOT)
    "TRE",   # Trinity Railway Express, Dallas / Fort Worth
    "DART",  # Dallas Area Rapid Transit
    "CMRX",  # Capital Metro, Austin
    "NMRX",  # New Mexico Rail Runner Express
    "RTDC",  # Denver Regional Transportation District
    "UTF",   # Utah Transit Authority FrontRunner
}


def class_of(code: str) -> str:
    if code in CLASS1:
        return "class1"
    if code in PASSENGER:
        return "passenger"
    if code in REGIONAL:
        return "regional"
    return "short line"
