"""Turning what a researcher wrote in a column into a place on a map.

A dataset says `IND` or `India` or `IN`. A map is drawn from a topology whose
features are keyed by ISO 3166-1 *numeric* codes. Something has to join the
two, and the join is where a choropleth quietly lies: an unmatched country is
simply absent from the picture, and absent reads as *no data* rather than as
*we did not recognise the name you used*.

So `resolve` never silently drops anything. It returns what matched and what
did not, and the caller is expected to say the second part out loud.

**Numeric codes rather than names.** Names are ambiguous, translated, and
change; the numeric code is the stable key the topology already uses. Alpha-2
and alpha-3 are accepted because that is what datasets actually contain.
"""

from __future__ import annotations

import re
import unicodedata

#: ISO 3166-1: alpha-3, alpha-2 and the numeric code the map is keyed by.
#:
#: Reference data, not a heuristic. A wrong row here shades the wrong country,
#: which is worse than not shading it at all — so `test_places.py` checks the
#: shape of every row and pins a sample against the standard.
_ISO: tuple[tuple[str, str, str, str], ...] = (
    ("AFG", "AF", "004", "Afghanistan"), ("ALB", "AL", "008", "Albania"),
    ("DZA", "DZ", "012", "Algeria"), ("AND", "AD", "020", "Andorra"),
    ("AGO", "AO", "024", "Angola"), ("ARG", "AR", "032", "Argentina"),
    ("ARM", "AM", "051", "Armenia"), ("AUS", "AU", "036", "Australia"),
    ("AUT", "AT", "040", "Austria"), ("AZE", "AZ", "031", "Azerbaijan"),
    ("BHR", "BH", "048", "Bahrain"), ("BGD", "BD", "050", "Bangladesh"),
    ("BLR", "BY", "112", "Belarus"), ("BEL", "BE", "056", "Belgium"),
    ("BEN", "BJ", "204", "Benin"), ("BTN", "BT", "064", "Bhutan"),
    ("BOL", "BO", "068", "Bolivia"), ("BIH", "BA", "070", "Bosnia and Herzegovina"),
    ("BWA", "BW", "072", "Botswana"), ("BRA", "BR", "076", "Brazil"),
    ("BGR", "BG", "100", "Bulgaria"), ("BFA", "BF", "854", "Burkina Faso"),
    ("BDI", "BI", "108", "Burundi"), ("KHM", "KH", "116", "Cambodia"),
    ("CMR", "CM", "120", "Cameroon"), ("CAN", "CA", "124", "Canada"),
    ("TCD", "TD", "148", "Chad"), ("CHL", "CL", "152", "Chile"),
    ("CHN", "CN", "156", "China"), ("COL", "CO", "170", "Colombia"),
    ("COG", "CG", "178", "Congo"), ("COD", "CD", "180", "Democratic Republic of the Congo"),
    ("CRI", "CR", "188", "Costa Rica"), ("CIV", "CI", "384", "Côte d'Ivoire"),
    ("HRV", "HR", "191", "Croatia"), ("CUB", "CU", "192", "Cuba"),
    ("CYP", "CY", "196", "Cyprus"), ("CZE", "CZ", "203", "Czechia"),
    ("DNK", "DK", "208", "Denmark"), ("DOM", "DO", "214", "Dominican Republic"),
    ("ECU", "EC", "218", "Ecuador"), ("EGY", "EG", "818", "Egypt"),
    ("SLV", "SV", "222", "El Salvador"), ("ERI", "ER", "232", "Eritrea"),
    ("EST", "EE", "233", "Estonia"), ("ETH", "ET", "231", "Ethiopia"),
    ("SWZ", "SZ", "748", "Eswatini"),
    ("FIN", "FI", "246", "Finland"), ("FRA", "FR", "250", "France"),
    ("GAB", "GA", "266", "Gabon"), ("GEO", "GE", "268", "Georgia"),
    ("DEU", "DE", "276", "Germany"), ("GHA", "GH", "288", "Ghana"),
    ("GRC", "GR", "300", "Greece"), ("GTM", "GT", "320", "Guatemala"),
    ("GIN", "GN", "324", "Guinea"), ("HTI", "HT", "332", "Haiti"),
    ("HND", "HN", "340", "Honduras"), ("HUN", "HU", "348", "Hungary"),
    ("ISL", "IS", "352", "Iceland"), ("IND", "IN", "356", "India"),
    ("IDN", "ID", "360", "Indonesia"), ("IRN", "IR", "364", "Iran"),
    ("IRQ", "IQ", "368", "Iraq"), ("IRL", "IE", "372", "Ireland"),
    ("ISR", "IL", "376", "Israel"), ("ITA", "IT", "380", "Italy"),
    ("JAM", "JM", "388", "Jamaica"), ("JPN", "JP", "392", "Japan"),
    ("JOR", "JO", "400", "Jordan"), ("KAZ", "KZ", "398", "Kazakhstan"),
    ("KEN", "KE", "404", "Kenya"), ("KWT", "KW", "414", "Kuwait"),
    ("KGZ", "KG", "417", "Kyrgyzstan"), ("LAO", "LA", "418", "Laos"),
    ("LVA", "LV", "428", "Latvia"), ("LBN", "LB", "422", "Lebanon"),
    ("LBR", "LR", "430", "Liberia"), ("LBY", "LY", "434", "Libya"),
    ("LTU", "LT", "440", "Lithuania"), ("LUX", "LU", "442", "Luxembourg"),
    ("MDG", "MG", "450", "Madagascar"), ("MWI", "MW", "454", "Malawi"),
    ("MYS", "MY", "458", "Malaysia"), ("MLI", "ML", "466", "Mali"),
    ("MRT", "MR", "478", "Mauritania"), ("MEX", "MX", "484", "Mexico"),
    ("MDA", "MD", "498", "Moldova"), ("MNG", "MN", "496", "Mongolia"),
    ("MAR", "MA", "504", "Morocco"), ("MOZ", "MZ", "508", "Mozambique"),
    ("MMR", "MM", "104", "Myanmar"), ("NAM", "NA", "516", "Namibia"),
    ("NPL", "NP", "524", "Nepal"), ("NLD", "NL", "528", "Netherlands"),
    ("NZL", "NZ", "554", "New Zealand"), ("NIC", "NI", "558", "Nicaragua"),
    ("NER", "NE", "562", "Niger"), ("NGA", "NG", "566", "Nigeria"),
    ("PRK", "KP", "408", "North Korea"), ("MKD", "MK", "807", "North Macedonia"),
    ("NOR", "NO", "578", "Norway"), ("OMN", "OM", "512", "Oman"),
    ("PAK", "PK", "586", "Pakistan"), ("PAN", "PA", "591", "Panama"),
    ("PNG", "PG", "598", "Papua New Guinea"), ("PRY", "PY", "600", "Paraguay"),
    ("PER", "PE", "604", "Peru"), ("PHL", "PH", "608", "Philippines"),
    ("POL", "PL", "616", "Poland"), ("PRT", "PT", "620", "Portugal"),
    ("QAT", "QA", "634", "Qatar"), ("ROU", "RO", "642", "Romania"),
    ("RUS", "RU", "643", "Russia"), ("RWA", "RW", "646", "Rwanda"),
    ("SAU", "SA", "682", "Saudi Arabia"), ("SEN", "SN", "686", "Senegal"),
    ("SRB", "RS", "688", "Serbia"), ("SLE", "SL", "694", "Sierra Leone"),
    ("SGP", "SG", "702", "Singapore"), ("SVK", "SK", "703", "Slovakia"),
    ("SVN", "SI", "705", "Slovenia"), ("SOM", "SO", "706", "Somalia"),
    ("ZAF", "ZA", "710", "South Africa"), ("KOR", "KR", "410", "South Korea"),
    ("SSD", "SS", "728", "South Sudan"), ("ESP", "ES", "724", "Spain"),
    ("LKA", "LK", "144", "Sri Lanka"), ("SDN", "SD", "729", "Sudan"),
    ("SWE", "SE", "752", "Sweden"), ("CHE", "CH", "756", "Switzerland"),
    ("SYR", "SY", "760", "Syria"), ("TWN", "TW", "158", "Taiwan"),
    ("TJK", "TJ", "762", "Tajikistan"), ("TZA", "TZ", "834", "Tanzania"),
    ("THA", "TH", "764", "Thailand"), ("TGO", "TG", "768", "Togo"),
    ("TTO", "TT", "780", "Trinidad and Tobago"), ("TUN", "TN", "788", "Tunisia"),
    ("TUR", "TR", "792", "Türkiye"), ("TKM", "TM", "795", "Turkmenistan"),
    ("UGA", "UG", "800", "Uganda"), ("UKR", "UA", "804", "Ukraine"),
    ("ARE", "AE", "784", "United Arab Emirates"),
    ("GBR", "GB", "826", "United Kingdom"), ("USA", "US", "840", "United States"),
    ("URY", "UY", "858", "Uruguay"), ("UZB", "UZ", "860", "Uzbekistan"),
    ("VEN", "VE", "862", "Venezuela"), ("VNM", "VN", "704", "Vietnam"),
    ("YEM", "YE", "887", "Yemen"), ("ZMB", "ZM", "894", "Zambia"),
    ("ZWE", "ZW", "716", "Zimbabwe"),
)

#: Names a dataset is likely to use that are not the ISO name.
_ALIASES: dict[str, str] = {
    "uk": "826", "great britain": "826", "britain": "826", "england": "826",
    "usa": "840", "us": "840", "united states of america": "840",
    "south korea": "410", "republic of korea": "410", "korea, rep.": "410",
    "north korea": "408", "russian federation": "643", "viet nam": "704",
    "iran, islamic rep.": "364", "egypt, arab rep.": "818",
    "turkey": "792", "czech republic": "203", "ivory coast": "384",
    "drc": "180", "dr congo": "180", "burma": "104", "swaziland": "748",
    "macedonia": "807", "holland": "528", "uae": "784",
}


def _fold(text: str) -> str:
    """Lowercase, unaccented, punctuation-free — for comparing names only."""
    stripped = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in stripped if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]+", "", stripped.lower()).strip()


_BY_KEY: dict[str, tuple[str, str]] = {}
for _a3, _a2, _num, _name in _ISO:
    for _key in (_a3.lower(), _a2.lower(), _fold(_name)):
        _BY_KEY[_key] = (_num, _name)
for _alias, _num in _ALIASES.items():
    _match = next((row for row in _ISO if row[2] == _num), None)
    if _match:
        _BY_KEY[_fold(_alias)] = (_num, _match[3])


def resolve(raw: str) -> tuple[str, str] | None:
    """The numeric code and canonical name for one place, or None.

    None rather than a guess. A fuzzy match here would put a country on the map
    that the researcher did not write down, and a map is believed.
    """
    key = _fold(str(raw))
    if not key:
        return None
    return _BY_KEY.get(key)


def resolve_all(values: list[str]) -> dict[str, object]:
    """Resolve many, and say plainly which ones did not resolve.

    The unmatched list is the point. A choropleth drops what it cannot place
    and the gap reads as "no data here", so the count of places that could not
    be recognised has to travel with the map rather than being swallowed.
    """
    matched: dict[str, tuple[str, str]] = {}
    unmatched: list[str] = []
    for value in values:
        found = resolve(value)
        if found is None:
            if value not in unmatched:
                unmatched.append(str(value))
        else:
            matched[str(value)] = found
    return {"matched": matched, "unmatched": unmatched}
