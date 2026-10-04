// Howard County, Indiana: the bodies we track, who sits on them, and the background
// Claude gets so its explanations are right. Party is blank until Nolan fills it in on the admin page.

export const CHANNELS = {
  UCJul5fc64Z7no6TtCoqJMDw: "county", // Howard County Government, Indiana
  UCghbpqymwe2w0btyh_FPi2Q: "city",   // KGOV2 (City of Kokomo)
};

// docs: where agendas/minutes come from. "county-packet" = in.gov packets (minutes ride in the NEXT packet);
// "city" = Kokomo document center (separate packet and minutes files); null = video only.
export const BODIES = {
  council: {
    gov: "county", name: "County Council", short: "County Council", docs: "county-packet",
    role: "Controls county money: the yearly budget, tax rates, salaries, and any spending beyond the budget.",
  },
  commissioners: {
    gov: "county", name: "Board of Commissioners", short: "Commissioners", docs: "county-packet",
    role: "Runs county government day to day and passes most county ordinances, contracts, purchases and final rezoning decisions outside city limits.",
  },
  plan: {
    gov: "county", name: "County Plan Commission", short: "County Plan Comm.", docs: null,
    role: "Holds hearings on rezoning and land-use requests outside city limits and sends a recommendation to the Commissioners, who make the final call.",
  },
  "city-council": {
    gov: "city", name: "Kokomo Common Council", short: "Kokomo Council", docs: "city",
    role: "The City of Kokomo's legislature: passes city ordinances, the city budget and tax rates, tax abatements, and makes final rezoning decisions inside the city.",
  },
  "city-plan": {
    gov: "city", name: "Kokomo Plan Commission", short: "Kokomo Plan Comm.", docs: "city",
    role: "Holds hearings on rezonings, subdivisions and development plans inside the city and sends recommendations on rezonings to the Common Council.",
  },
  "city-bza": {
    gov: "city", name: "Kokomo Board of Zoning Appeals", short: "Kokomo BZA", docs: "city",
    role: "Decides requests to bend the zoning rules for one property (variances and special exceptions). Its decisions are final unless appealed to court.",
  },
  "city-works": {
    gov: "city", name: "Kokomo Board of Public Works and Safety", short: "Kokomo Board of Works", docs: null,
    role: "Three members appointed by the mayor. The city's contracting agency: approves contracts, bids, purchases and the city's bills, and orders demolitions of unsafe buildings.",
  },
};
export const TRACKED = Object.keys(BODIES);

export const DEFAULT_ROSTER = {
  council: [
    { name: "Daryl Maple", title: "President" },
    { name: "Bryan Alexander", title: "Vice President" },
    { name: "John Roberts" },
    { name: "Martha Lake" },
    { name: "Frank Faulkner" },
    { name: "Tim Cuthbert" },
    { name: "Brett Sanders" },
  ],
  commissioners: [
    { name: "Jack Dodd", title: "President" },
    { name: "Brad Bray", title: "Vice President" },
    { name: "Jeff Lipinski" },
  ],
  plan: [],
  "city-council": [
    { name: "Dave Capshaw", title: "District 1" },
    { name: "Bob Stephenson", title: "District 2" },
    { name: "Ray Collins", title: "District 3" },
    { name: "Jeff Plough", title: "District 4" },
    { name: "Greg Davis", title: "District 5, President" },
    { name: "Crystal Sanburn", title: "District 6" },
    { name: "Tony Stewart", title: "At-large" },
    { name: "Matt Grecu", title: "At-large" },
    { name: "Tom Miklik", title: "At-large" },
  ],
  "city-plan": [],
  "city-bza": [],
  "city-works": [
    { name: "Weston Reed", title: "President" },
    { name: "Cornelia Campbell" },
    { name: "T.J. Rethlake" },
  ],
};

export const PRIMER = `
HOW HOWARD COUNTY, INDIANA GOVERNMENT WORKS (background for explanations; explain in plain words, don't cite statute numbers)
- Board of Commissioners (3 members): the county's executive and legislative body. Passes most county ordinances, approves contracts and purchases, approves claims (the county's bills, usually twice a month), runs roads, bridges and buildings, and makes the final decision on rezonings in the unincorporated county.
- County Council (7 members): the fiscal body. Adopts the yearly budget, sets tax rates and local income tax (LIT) rates, passes the salary ordinance, approves "additional appropriations" (spending more than the budget allowed) and transfers between budget lines, and handles tax abatements.
- County Plan Commission: holds public hearings on rezonings, subdivisions and zoning rule changes outside city limits, then sends a favorable, unfavorable or no recommendation to the Commissioners, who decide.
- County ordinance numbers: "2026-HCCO-##" is a Council ordinance, "2026-HCCR-##" a Council resolution, "2026-BCCO-##" a Commissioners ordinance, "2026-BCCR-##" a Commissioners resolution.
- Readings: an ordinance is "read" (presented) and then adopted. If every member present agrees, it can be read twice and adopted the same night; otherwise it waits for a later meeting.
- Budget calendar: departments present requests to the Council in late July/August, the Council holds budget hearings, and the budget for next year must be adopted by about November 1. The state (DLGF) then reviews it.
- Additional appropriations: needed when a fund needs more money than the budget gave it. They have to be advertised ahead of time; some need state review. Negative amounts reduce an appropriation.
- Transfers: moving money between lines inside the same fund (no new spending).
- Salary ordinance: the list of county jobs and the most each can be paid; amendments add, remove or change positions or pay.
- Tax abatements: a business asks to phase in property taxes on new investment. Steps: a declaratory resolution, a public hearing, a confirmatory resolution; the business promises jobs/investment on a Statement of Benefits (SB-1) and must report each year on a compliance form (CF-1). The Council can end an abatement if the business doesn't keep its promises.
- Rezoning: a property owner asks to change what land can be used for (e.g., agricultural to residential). Plan Commission hearing and recommendation, then the Commissioners' ordinance.
- Common funds: General Fund (main operating money), LIT funds (local income tax), MVH (Motor Vehicle Highway, gas-tax money for roads), ARP (federal American Rescue Plan pandemic money), opioid settlement funds, grant funds (e.g., CASA VOCA = victim-services grant for court-appointed special advocates).
- Common words: PERF (state retirement plan for public employees), FICA (Social Security/Medicare payroll tax), interlocal agreement (contract between two governments), moratorium (temporary pause), tabled (set aside without a final vote), remonstrance (formal objection by affected taxpayers or property owners), TIF (tax increment financing: new property taxes from an area are set aside to pay for improvements there), rainy day fund (county savings).

HOW THE CITY OF KOKOMO WORKS
- Mayor: the city's executive; runs departments and appoints the Board of Works. Can veto an ordinance; the Common Council can override with a two-thirds vote.
- Common Council (9 members: 6 districts, 3 at-large): the city's legislative and fiscal body. Passes ordinances (numbered in one running sequence, e.g. Ordinance 7243) and resolutions, the city budget, tax rates, additional appropriations, salary ordinances, tax abatements inside the city, and the final decision on rezonings inside the city. Ordinances usually get a first reading at one meeting and second/third readings and a vote at a later one; they can pass on one night only if every member present agrees. The Council usually takes roll-call votes, so record each member's vote when the clerk calls the roll.
- Board of Public Works and Safety ("Board of Works", 3 mayoral appointees, meets weekly): the city's contracting agency. Approves contracts, bids, change orders, purchases, the city's bills (claims), street closures, and demolition orders for unsafe or nuisance properties.
- Kokomo Plan Commission: public hearings on rezonings, subdivisions and development plans inside the city. On rezonings it sends a recommendation to the Common Council, which decides.
- Board of Zoning Appeals (BZA): decides variances (permission to break a zoning rule, like a setback or sign size, for one property) and special exceptions (a use the zoning allows only with approval). Its decisions are final unless appealed to court.
- The county and the city share local income tax money and sign interlocal agreements with each other, so the same issue can appear before both governments.
`;

export const GLOSSARY = {
  "additional appropriation": "Approval to spend more from a fund than this year's budget allowed. Has to be advertised first, and some need state review.",
  "transfer": "Moving money between lines inside the same fund. It doesn't add new spending.",
  "salary ordinance": "The official list of county jobs and the most each can be paid. Amendments add, remove or change positions or pay.",
  "LIT": "Local Income Tax. A county income tax set by the County Council; some of it is shared with cities and towns.",
  "MVH": "Motor Vehicle Highway fund. State gas-tax money that can only be spent on roads.",
  "ARP": "American Rescue Plan. Federal pandemic relief money the county received and has to spend by set deadlines.",
  "PERF": "The state retirement plan for public employees. The county pays part of each worker's contribution.",
  "FICA": "Social Security and Medicare payroll taxes the county pays on each employee.",
  "interlocal agreement": "A contract between two local governments, such as the county and the City of Kokomo.",
  "moratorium": "A temporary pause. For example, not accepting certain permits while rules are written.",
  "tabled": "Set aside without a final vote. It can come back later.",
  "first reading": "The first time an ordinance is formally presented. It can pass the same night only if every member present agrees.",
  "second reading": "The second presentation of an ordinance, usually when it is adopted.",
  "tax abatement": "A deal that phases in property taxes on a business's new investment, in exchange for promised jobs or investment.",
  "CF-1": "The yearly form a business with a tax abatement files to show whether it kept its promises on jobs and investment.",
  "SB-1": "Statement of Benefits. The form where a business lists the jobs, wages and investment it promises in exchange for an abatement.",
  "rezoning": "Changing what a piece of land can legally be used for, such as farmland to homes or industry.",
  "claims": "The county's bills. The Commissioners approve them, usually twice a month.",
  "remonstrance": "A formal objection filed by affected taxpayers or property owners, which can block or force a vote on some projects.",
  "TIF": "Tax increment financing. New property taxes from a set area are set aside to pay for projects in that area instead of going to the general budget.",
  "rainy day fund": "The county's savings account for emergencies and shortfalls.",
  "declaratory resolution": "The first step for a tax abatement. It names the area and sets up a public hearing.",
  "confirmatory resolution": "The final step for a tax abatement, approved after the public hearing.",
  "variance": "Permission from the Board of Zoning Appeals for one property to break a specific zoning rule, like a setback, height or sign limit.",
  "special exception": "A use the zoning code allows in an area only with Board of Zoning Appeals approval, such as a daycare in a residential zone.",
  "veto": "The mayor's power to reject an ordinance the Common Council passed. The Council can override it with a two-thirds vote.",
  "change order": "A change to a signed contract that adds or removes work, and usually changes the price.",
  "bid award": "Choosing which company gets a public contract after sealed bids are opened.",
  "budget hearing": "A meeting where departments explain their budget requests and the public can comment.",
};
