// Howard County, Indiana: the bodies we track, who sits on them, and the background
// Claude gets so its explanations are right. Party is blank until Nolan fills it in on the admin page.

export const BODIES = {
  council: {
    name: "County Council",
    role: "Controls county money: the yearly budget, tax rates, salaries, and any spending beyond the budget.",
    packets: "council",
  },
  commissioners: {
    name: "Board of Commissioners",
    role: "Runs county government day to day and passes most county ordinances, contracts, purchases and final rezoning decisions.",
    packets: "commissioners",
  },
  plan: {
    name: "Plan Commission",
    role: "Holds hearings on rezoning and land-use requests and sends a recommendation to the Commissioners, who make the final call.",
    packets: null, // no current agendas/minutes posted online; video only
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
};

export const PRIMER = `
HOW HOWARD COUNTY, INDIANA GOVERNMENT WORKS (background for explanations; explain in plain words, don't cite statute numbers)
- Board of Commissioners (3 members): the county's executive and legislative body. Passes most county ordinances, approves contracts and purchases, approves claims (the county's bills, usually twice a month), runs roads, bridges and buildings, and makes the final decision on rezonings in the unincorporated county.
- County Council (7 members): the fiscal body. Adopts the yearly budget, sets tax rates and local income tax (LIT) rates, passes the salary ordinance, approves "additional appropriations" (spending more than the budget allowed) and transfers between budget lines, and handles tax abatements.
- Plan Commission: holds public hearings on rezonings, subdivisions and zoning rule changes, then sends a favorable, unfavorable or no recommendation to the Commissioners, who decide.
- Ordinance numbers: "2026-HCCO-##" is a Council ordinance, "2026-HCCR-##" a Council resolution, "2026-BCCO-##" a Commissioners ordinance, "2026-BCCR-##" a Commissioners resolution.
- Readings: an ordinance is "read" (presented) and then adopted. If every member present agrees, it can be read twice and adopted the same night; otherwise it waits for a later meeting.
- Budget calendar: departments present requests to the Council in late July/August, the Council holds budget hearings, and the budget for next year must be adopted by about November 1. The state (DLGF) then reviews it.
- Additional appropriations: needed when a fund needs more money than the budget gave it. They have to be advertised ahead of time; some need state review. Negative amounts reduce an appropriation.
- Transfers: moving money between lines inside the same fund (no new spending).
- Salary ordinance: the list of county jobs and the most each can be paid; amendments add, remove or change positions or pay.
- Tax abatements: a business asks to phase in property taxes on new investment. Steps: a declaratory resolution, a public hearing, a confirmatory resolution; the business promises jobs/investment on a Statement of Benefits (SB-1) and must report each year on a compliance form (CF-1). The Council can end an abatement if the business doesn't keep its promises.
- Rezoning: a property owner asks to change what land can be used for (e.g., agricultural to residential). Plan Commission hearing and recommendation, then the Commissioners' ordinance.
- Common funds: General Fund (main operating money), LIT funds (local income tax), MVH (Motor Vehicle Highway, gas-tax money for roads), ARP (federal American Rescue Plan pandemic money), opioid settlement funds, grant funds (e.g., CASA VOCA = victim-services grant for court-appointed special advocates).
- Common words: PERF (state retirement plan for public employees), FICA (Social Security/Medicare payroll tax), interlocal agreement (contract between two governments), moratorium (temporary pause), tabled (set aside without a final vote), remonstrance (formal objection by affected taxpayers or property owners), TIF (tax increment financing: new property taxes from an area are set aside to pay for improvements there), rainy day fund (county savings).
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
  "budget hearing": "A meeting where departments explain their budget requests and the public can comment.",
};
