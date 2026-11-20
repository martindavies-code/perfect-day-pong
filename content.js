/**
 * BBC Continuity / Factory Records editorial layer.
 * Every interstitial card is tagged PERIOD STYLE (archive recollections of 1986-97 trails)
 * or ORIGINAL (new satire in the BBC institutional voice).
 */

export const INTERSTITIAL_CARDS = [
  { tag: 'PERIOD STYLE', text: 'Good value at 16p a day, or roughly two thirds of a regional bounce.' },
  { tag: 'PERIOD STYLE', text: 'A day of Room Ten costs less than a picture hook, or a prawn at 22p.' },
  { tag: 'PERIOD STYLE', text: 'Every rally preference is catered for, thanks to the unique way the BBC is funded. By you.' },
  { tag: 'ORIGINAL', text: 'Your pickup was made possible by the unique way this bat is funded. By you.' },
  { tag: 'ORIGINAL', text: 'Whatever your spin preference, it is catered for. Mostly cross-court.' },
  { tag: 'ORIGINAL', text: 'Detector van sighted near the centre line. Keep your television licence visible.' },
  { tag: 'ORIGINAL', text: 'This transmission originates from Room Ten, Broadcasting House, Sub-Basement B.' },
  { tag: 'ORIGINAL', text: 'Continuity reminds viewers that all bounces remain subject to Charter review.' },
  { tag: 'ORIGINAL', text: 'If you are watching in black and white, Lou Reed has not changed the colour balance.' },
  { tag: 'ORIGINAL', text: 'Please do not adjust your paddle. Low gravity is an editorial decision.' },
  { tag: 'ORIGINAL', text: 'BBC Engineering advises that deuce battles are now accelerating for public convenience.' },
  { tag: 'ORIGINAL', text: 'The following artist appears by arrangement with late-night public service television.' },
  { tag: 'ORIGINAL', text: 'Regional opt-outs are unavailable during Allegro and Vivace passages.' },
  { tag: 'ORIGINAL', text: 'A reminder: unspent Fee Points are held in a non-interest-bearing charter ledger.' },
  { tag: 'ORIGINAL', text: 'Viewers using Bluetooth controllers should pair them in Windows before approaching the baseline.' },
  { tag: 'ORIGINAL', text: 'Stereo separation verified by the Broadcasting Standards Council (North-West Division).' },
  { tag: 'ORIGINAL', text: 'This room has been calibrated for headphones, late-night tea, and austere geometry.' },
  { tag: 'ORIGINAL', text: 'Should a ball appear to curve, that is spin, not a fault on your aerial.' },
  { tag: 'ORIGINAL', text: 'Factory-style catalogue numbering does not imply Manchester warehouse availability.' },
  { tag: 'ORIGINAL', text: 'All backhand returns are archived on 16-millimetre tape in Acton.' },
  { tag: 'ORIGINAL', text: 'Public Service Announcement: two clear points are required to conclude any disagreement.' },
  { tag: 'ORIGINAL', text: 'Bono is appearing slightly more frequently than statistical fairness would suggest.' },
  { tag: 'ORIGINAL', text: 'Viewers in Scotland and Wales may experience identical wireframe geometry.' },
  { tag: 'ORIGINAL', text: 'Licence fee payers who reach Act III are entitled to a warm amber glow.' },

  // John Birt cards. SOURCED cards restate what the Wikipedia article on John Birt, Baron Birt says,
  // with quotation marks only around wording that article quotes. SATIRE cards are invented
  // jokes about his management style; they are not quotes and are labelled as such on screen.
  { tag: 'SOURCED', source: 'Wikipedia: John Birt, Baron Birt', text: 'As Director-General he said he wanted the BBC to be "the best managed public sector organisation".' },
  { tag: 'SOURCED', source: 'Wikipedia: John Birt, Baron Birt', text: 'Producer Choice, April 1993: programme makers could buy from BBC departments or from outside. Some found records cheaper in local shops than from BBC resources.' },
  { tag: 'SOURCED', source: 'Wikipedia: John Birt, Baron Birt', text: 'With Peter Jay, he argued television news had a "bias against understanding" and called for "a mission to explain".' },
  { tag: 'SOURCED', source: 'Wikipedia: John Birt, Baron Birt', text: 'Dennis Potter called him a "croak-voiced Dalek" in the 1993 MacTaggart Lecture. His management jargon became known as "Birtspeak".' },
  { tag: 'SOURCED', source: 'Wikipedia: John Birt, Baron Birt', text: 'On BBC drama he conceded: "The originality is not there as it was in the Sixties."' },
  { tag: 'SATIRE, INVENTED', text: 'Every rally will be internally invoiced. Spin may be sourced from a BBC department or externally.' },
  { tag: 'SATIRE, INVENTED', text: 'Objectives have been set for the ball. The ball will be reviewed against them.' },
  { tag: 'SATIRE, INVENTED', text: 'The bat is under-utilised between 02:00 and 02:15. A resources review will explain why.' },
  { tag: 'SATIRE, INVENTED', text: 'This bounce has been outsourced to a consultant, who will explain it at length.' },
  { tag: 'SATIRE, INVENTED', text: 'Deuce is now a performance-management event. Both parties will receive a framework.' },
  { tag: 'SATIRE, INVENTED', text: 'A mission to explain this point will follow, once the point has been unified with the centre line.' },
];

export function pickInterstitialCard(rng, indexOffset = 0) {
  const idx = Math.floor((rng ? rng() : Math.random()) * INTERSTITIAL_CARDS.length + indexOffset) % INTERSTITIAL_CARDS.length;
  return INTERSTITIAL_CARDS[idx];
}
