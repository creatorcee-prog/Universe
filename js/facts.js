// Reference text for the in-game book.
// Named entries describe real objects; type entries explain each class of object the sim can make.
// Figures are from the NASA Planetary Fact Sheet unless an entry's sources say otherwise.

const FS = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/';
const nasaFS = (p) => ['NASA Planetary Fact Sheet', FS + p + 'fact.html'];
const nasa = (path, label) => [label || 'NASA Science', 'https://science.nasa.gov/' + path];
const wiki = (page) => ['Wikipedia: ' + page.replace(/_/g, ' '), 'https://en.wikipedia.org/wiki/' + page];

export const ENTRIES = {
  Sun: {
    kicker: 'Star · G2V',
    summary: 'The Sun is an ordinary middle-aged star, a 4.6-billion-year-old ball of hydrogen and helium that holds 99.86% of the Solar System\'s mass. Every second its core fuses about 600 million tonnes of hydrogen into helium.',
    stats: [['Diameter', '1.39 million km (109 Earths)'], ['Mass', '1.989 × 10³⁰ kg (333,000 Earths)'], ['Surface temperature', '5,772 K'], ['Core temperature', '≈ 15.7 million K'], ['Surface gravity', '274 m/s²'], ['Escape velocity', '617.6 km/s'], ['Rotation at equator', '≈ 25 days'], ['Age', '≈ 4.6 billion years']],
    facts: [
      'Sunlight takes about 8 minutes 20 seconds to reach Earth, but the energy in it took tens of thousands of years to work its way out from the core.',
      'The Sun spins faster at its equator (about 25 days) than near its poles (about 35 days), because it is not solid.',
      'It is about halfway through its roughly 10-billion-year life on the main sequence. In about 5 billion years it will swell into a red giant, then shrink to a white dwarf.',
      'The Sun circles the centre of the Milky Way about 26,000 light-years away, taking roughly 230 million years per lap.',
    ],
    sources: [nasaFS('sun'), nasa('sun/', 'NASA: The Sun')],
  },
  Mercury: {
    kicker: 'Planet · 1st from the Sun',
    summary: 'The smallest planet and the closest to the Sun. Mercury has almost no atmosphere to hold heat, so its surface swings from scorching days to frigid nights.',
    stats: [['Diameter', '4,879 km'], ['Mass', '0.330 × 10²⁴ kg (0.055 Earths)'], ['Distance from Sun', '57.9 million km'], ['Year', '88.0 Earth days'], ['Solar day', '176 Earth days'], ['Surface gravity', '3.7 m/s²'], ['Mean temperature', '167 °C'], ['Moons', '0']],
    facts: [
      'One Mercury solar day (sunrise to sunrise) lasts two Mercury years.',
      'Despite the heat, NASA\'s MESSENGER probe confirmed water ice in craters at the poles that never see sunlight.',
      'Mercury has a huge iron core that takes up about 85% of its radius.',
      'Only two spacecraft had visited before BepiColombo (ESA/JAXA, launched 2018): Mariner 10 and MESSENGER.',
    ],
    sources: [nasaFS('mercury'), nasa('mercury/', 'NASA: Mercury')],
  },
  Venus: {
    kicker: 'Planet · 2nd from the Sun',
    summary: 'Earth\'s near-twin in size, but a hellish world: a crushing carbon-dioxide atmosphere traps heat in a runaway greenhouse, making Venus the hottest planet even though Mercury is closer to the Sun.',
    stats: [['Diameter', '12,104 km'], ['Mass', '4.87 × 10²⁴ kg (0.815 Earths)'], ['Distance from Sun', '108.2 million km'], ['Year', '224.7 Earth days'], ['Rotation', '243 Earth days, backwards'], ['Surface pressure', '92 bar'], ['Mean temperature', '464 °C'], ['Moons', '0']],
    facts: [
      'Venus spins backwards compared with most planets, and so slowly that its day is longer than its year.',
      'The surface pressure equals being about 900 m under Earth\'s ocean.',
      'Its clouds are made of sulfuric acid droplets, and reflect so much sunlight that Venus is the brightest object in our night sky after the Moon.',
      'The Soviet Venera 7 probe made the first soft landing on another planet in 1970, and transmitted for about 20 minutes.',
    ],
    sources: [nasaFS('venus'), nasa('venus/', 'NASA: Venus')],
  },
  Earth: {
    kicker: 'Planet · 3rd from the Sun',
    summary: 'Our home, and the only world known to host life. Earth is the densest planet in the Solar System and the only one with liquid water on its surface.',
    stats: [['Diameter', '12,756 km'], ['Mass', '5.97 × 10²⁴ kg'], ['Distance from Sun', '149.6 million km (1 AU)'], ['Year', '365.25 days'], ['Day', '24 hours'], ['Axial tilt', '23.4°'], ['Mean temperature', '15 °C'], ['Moons', '1']],
    facts: [
      'About 71% of the surface is covered by water, and the oceans hold about 97% of Earth\'s water.',
      'Earth formed about 4.54 billion years ago from the same disk of gas and dust as the Sun.',
      'Its molten iron outer core generates a magnetic field that deflects much of the solar wind.',
      'Earth\'s 23.4° tilt, not its distance from the Sun, is what causes the seasons.',
    ],
    sources: [nasaFS('earth'), nasa('earth/', 'NASA: Earth')],
  },
  Moon: {
    kicker: 'Earth\'s moon',
    summary: 'The fifth-largest moon in the Solar System, and the only place beyond Earth where humans have walked. It probably formed from debris thrown out when a Mars-sized body struck the young Earth.',
    stats: [['Diameter', '3,475 km'], ['Mass', '0.073 × 10²⁴ kg (1.2% of Earth)'], ['Distance from Earth', '384,400 km'], ['Orbit', '27.3 days'], ['Phase cycle', '29.5 days'], ['Surface gravity', '1.6 m/s²'], ['Mean temperature', '−20 °C']],
    facts: [
      'The Moon is tidally locked, so the same side always faces Earth.',
      'It is drifting away from Earth by about 3.8 cm per year, measured by bouncing lasers off mirrors left by the Apollo astronauts.',
      'Twelve people walked on the Moon between 1969 and 1972.',
      'The Moon\'s tides gradually lengthen Earth\'s day.',
    ],
    sources: [nasaFS('moon'), nasa('moon/', 'NASA: Earth\'s Moon')],
  },
  Mars: {
    kicker: 'Planet · 4th from the Sun',
    summary: 'A cold desert world with a thin carbon-dioxide atmosphere. Dry riverbeds and minerals show that liquid water once flowed across its surface.',
    stats: [['Diameter', '6,792 km'], ['Mass', '0.642 × 10²⁴ kg (0.107 Earths)'], ['Distance from Sun', '228.0 million km'], ['Year', '687 Earth days'], ['Day', '24.7 hours'], ['Surface gravity', '3.7 m/s²'], ['Mean temperature', '−65 °C'], ['Moons', '2 (Phobos and Deimos)']],
    facts: [
      'Olympus Mons is the tallest volcano known in the Solar System, about 22 km high, roughly 2.5 times the height of Everest.',
      'The canyon system Valles Marineris is about 4,000 km long and up to 7 km deep.',
      'Mars is red because its dust is rich in iron oxide (rust).',
      'NASA\'s Perseverance rover landed in Jezero Crater in February 2021 to look for signs of ancient life.',
    ],
    sources: [nasaFS('mars'), nasa('mars/', 'NASA: Mars')],
  },
  Ceres: {
    kicker: 'Dwarf planet · Asteroid belt',
    summary: 'The largest object in the asteroid belt and the only dwarf planet in the inner Solar System. It holds about a quarter of the belt\'s entire mass.',
    stats: [['Diameter', '≈ 939 km'], ['Distance from Sun', '2.77 AU'], ['Year', '4.6 Earth years'], ['Day', '9 hours'], ['Discovered', '1 January 1801']],
    facts: [
      'Giuseppe Piazzi discovered Ceres in 1801. It was called a planet for about 50 years.',
      'NASA\'s Dawn spacecraft orbited Ceres from 2015 to 2018.',
      'The bright spots in Occator Crater are deposits of salt (sodium carbonate) left by briny water that reached the surface.',
    ],
    sources: [nasa('dwarf-planets/ceres/', 'NASA: Ceres')],
  },
  Jupiter: {
    kicker: 'Planet · 5th from the Sun',
    summary: 'The largest planet, more than twice as massive as all the other planets combined. Jupiter is a gas giant of hydrogen and helium with no solid surface.',
    stats: [['Diameter', '142,984 km (11 Earths)'], ['Mass', '1,898 × 10²⁴ kg (318 Earths)'], ['Distance from Sun', '778.5 million km'], ['Year', '11.9 Earth years'], ['Day', '9.9 hours'], ['Gravity at cloud tops', '23.1 m/s²'], ['Mean temperature', '−110 °C'], ['Moons', 'More than 90 known']],
    facts: [
      'Jupiter has the shortest day of any planet, under 10 hours.',
      'The Great Red Spot is a storm wider than Earth that has raged for at least 150 years, though it has been shrinking.',
      'Its magnetic field is the strongest of any planet, about 20,000 times Earth\'s.',
      'NASA\'s Juno spacecraft has been orbiting Jupiter since 2016.',
    ],
    sources: [nasaFS('jupiter'), nasa('jupiter/', 'NASA: Jupiter')],
  },
  Io: {
    kicker: 'Moon of Jupiter',
    summary: 'The most volcanically active world known. Tides from Jupiter, pumped by Io\'s orbital resonance with Europa and Ganymede, knead its interior and keep it molten.',
    stats: [['Diameter', '3,643 km'], ['Orbit', '1.77 days'], ['Distance from Jupiter', '421,700 km'], ['Discovered', 'January 1610, by Galileo']],
    facts: [
      'Io has around 400 active volcanoes; some shoot plumes hundreds of kilometres high.',
      'For every orbit of Ganymede, Europa makes two and Io makes four. This 1:2:4 Laplace resonance is reproduced in this game\'s "Jupiter\'s Moons" scenario.',
      'Sulfur compounds give Io its yellow, orange and red colours.',
    ],
    sources: [['JPL Planetary Satellite Physical Parameters', 'https://ssd.jpl.nasa.gov/sats/phys_par/'], wiki('Io_(moon)')],
  },
  Europa: {
    kicker: 'Moon of Jupiter',
    summary: 'An ice-covered moon with a global saltwater ocean underneath, one of the most promising places to search for life beyond Earth.',
    stats: [['Diameter', '3,122 km'], ['Orbit', '3.55 days'], ['Distance from Jupiter', '671,034 km']],
    facts: [
      'Europa\'s ocean may hold about twice as much water as all of Earth\'s oceans.',
      'Its surface is one of the smoothest in the Solar System, criss-crossed by cracks and ridges.',
      'NASA\'s Europa Clipper launched in October 2024 and is due to reach Jupiter in 2030.',
    ],
    sources: [['NASA Europa Clipper', 'https://europa.nasa.gov/'], ['JPL Planetary Satellite Physical Parameters', 'https://ssd.jpl.nasa.gov/sats/phys_par/']],
  },
  Ganymede: {
    kicker: 'Moon of Jupiter',
    summary: 'The largest moon in the Solar System, bigger than the planet Mercury, and the only moon known to make its own magnetic field.',
    stats: [['Diameter', '5,268 km'], ['Orbit', '7.15 days'], ['Distance from Jupiter', '1,070,412 km']],
    facts: [
      'Ganymede probably has a saltwater ocean buried under about 150 km of ice.',
      'Its magnetic field produces auroras, which the Hubble Space Telescope has observed.',
      'ESA\'s JUICE mission launched in April 2023 and is due to orbit Ganymede in the 2030s.',
    ],
    sources: [['ESA: Juice', 'https://www.esa.int/Science_Exploration/Space_Science/Juice'], ['JPL Planetary Satellite Physical Parameters', 'https://ssd.jpl.nasa.gov/sats/phys_par/']],
  },
  Callisto: {
    kicker: 'Moon of Jupiter',
    summary: 'The most heavily cratered object in the Solar System. Its ancient surface has barely changed in four billion years.',
    stats: [['Diameter', '4,821 km'], ['Orbit', '16.7 days'], ['Distance from Jupiter', '1,882,709 km']],
    facts: [
      'Unlike the other three large moons, Callisto is outside the orbital resonance, so it is not heated much by tides.',
      'It is almost the size of Mercury but only about a third as massive.',
    ],
    sources: [['JPL Planetary Satellite Physical Parameters', 'https://ssd.jpl.nasa.gov/sats/phys_par/'], wiki('Callisto_(moon)')],
  },
  Saturn: {
    kicker: 'Planet · 6th from the Sun',
    summary: 'The ringed gas giant. Saturn is so light for its size that it is less dense than water.',
    stats: [['Diameter', '120,536 km (9.4 Earths)'], ['Mass', '568 × 10²⁴ kg (95 Earths)'], ['Density', '687 kg/m³'], ['Distance from Sun', '1.43 billion km'], ['Year', '29.4 Earth years'], ['Day', '10.7 hours'], ['Mean temperature', '−140 °C'], ['Moons', '274 known, the most of any planet']],
    facts: [
      'The main rings span about 280,000 km but are typically only about 10 m thick. They are mostly chunks of water ice.',
      'Its largest moon, Titan, is bigger than Mercury and has a thick atmosphere and lakes of liquid methane.',
      'NASA\'s Cassini orbited Saturn from 2004 to 2017, then dived into the planet on purpose.',
      'In this game the rings are 9,000 debris chunks on true circular orbits, tilted 26.7° like the real ones. Fly something through them and the chunks break loose and scatter.',
    ],
    sources: [nasaFS('saturn'), nasa('saturn/', 'NASA: Saturn')],
  },
  Uranus: {
    kicker: 'Planet · 7th from the Sun',
    summary: 'An ice giant that rolls around the Sun on its side, probably knocked over by a giant collision long ago.',
    stats: [['Diameter', '51,118 km'], ['Mass', '86.8 × 10²⁴ kg (14.5 Earths)'], ['Axial tilt', '97.8°'], ['Distance from Sun', '2.87 billion km'], ['Year', '84 Earth years'], ['Day', '17.2 hours, backwards'], ['Mean temperature', '−195 °C'], ['Moons', '29 known']],
    facts: [
      'Each pole gets about 42 years of continuous sunlight, then 42 years of darkness.',
      'William Herschel discovered Uranus in 1781, the first planet found with a telescope.',
      'Only one spacecraft has visited: Voyager 2, in January 1986.',
    ],
    sources: [nasaFS('uranus'), nasa('uranus/', 'NASA: Uranus')],
  },
  Neptune: {
    kicker: 'Planet · 8th from the Sun',
    summary: 'The windiest planet, a dark, cold ice giant whose existence was predicted by mathematics before anyone saw it.',
    stats: [['Diameter', '49,528 km'], ['Mass', '102 × 10²⁴ kg (17 Earths)'], ['Distance from Sun', '4.5 billion km'], ['Year', '165 Earth years'], ['Day', '16.1 hours'], ['Mean temperature', '−200 °C'], ['Moons', '16 known']],
    facts: [
      'Urbain Le Verrier calculated where an unseen planet must be pulling on Uranus; Johann Galle found Neptune there on 23 September 1846.',
      'Winds reach about 2,000 km/h, the fastest measured on any planet.',
      'Its largest moon, Triton, orbits backwards and is probably a captured Kuiper belt object.',
      'Neptune completed its first full orbit since its discovery in 2011.',
    ],
    sources: [nasaFS('neptune'), nasa('neptune/', 'NASA: Neptune')],
  },
  Pluto: {
    kicker: 'Dwarf planet · Kuiper belt',
    summary: 'Once the ninth planet, Pluto was reclassified as a dwarf planet in 2006. It is a world of nitrogen ice, mountains of water ice and a hazy blue sky.',
    stats: [['Diameter', '2,376 km'], ['Mass', '0.0130 × 10²⁴ kg (0.2% of Earth)'], ['Distance from Sun', '5.9 billion km (average)'], ['Year', '248 Earth years'], ['Day', '6.4 Earth days'], ['Mean temperature', '−225 °C'], ['Moons', '5']],
    facts: [
      'Clyde Tombaugh discovered Pluto on 18 February 1930.',
      'NASA\'s New Horizons flew past on 14 July 2015 and revealed a heart-shaped plain of nitrogen ice, Sputnik Planitia.',
      'Its largest moon, Charon, is about half Pluto\'s diameter.',
      'Pluto\'s tilted, eccentric orbit sometimes brings it closer to the Sun than Neptune.',
    ],
    sources: [nasaFS('pluto'), nasa('dwarf-planets/pluto/', 'NASA: Pluto')],
  },
  Bennu: {
    kicker: 'Near-Earth asteroid · 101955 Bennu',
    summary: 'A loose pile of rubble about 490 m across, dark as charcoal. NASA\'s OSIRIS-REx collected a sample from its surface and brought it to Earth.',
    stats: [['Diameter', '490 m'], ['Mass', '7.3 × 10¹⁰ kg'], ['Density', '1.19 g/cm³ (half empty space)'], ['Year', '1.2 Earth years'], ['Day', '4.3 hours']],
    facts: [
      'OSIRIS-REx touched its surface on 20 October 2020; the sample capsule landed in Utah on 24 September 2023 with 121.6 g of rock and dust.',
      'The sample holds amino acids and all five nucleobases used in DNA and RNA (Glavin et al. 2025).',
      'Its surface turned out so loose that the spacecraft\'s sampling arm sank in, as into a ball pit.',
      'It has about a 1-in-2,700 chance of hitting Earth in the year 2182.',
    ],
    sources: [wiki('101955_Bennu'), nasa('osiris-rex/', 'NASA: OSIRIS-REx')],
  },
  Ryugu: {
    kicker: 'Near-Earth asteroid · 162173 Ryugu',
    summary: 'A dark, spinning-top-shaped rubble pile about 900 m across, sampled by Japan\'s Hayabusa2.',
    stats: [['Diameter', '900 m'], ['Mass', '4.5 × 10¹¹ kg'], ['Density', '1.19 g/cm³'], ['Year', '1.3 Earth years'], ['Day', '7.6 hours']],
    facts: [
      'Hayabusa2 reached it in June 2018, fired a copper projectile to dig a fresh crater in April 2019, and sampled it twice.',
      'Its 5.4 g of samples landed in Australia on 6 December 2020; they match the most primitive meteorites, the CI chondrites.',
      'The ridge around its equator gives it the spinning-top shape of a body once spun up fast enough to reshape itself.',
    ],
    sources: [wiki('162173_Ryugu'), ['JAXA Hayabusa2 data archive', 'https://data.darts.isas.jaxa.jp/pub/hayabusa2/']],
  },
  Arrokoth: {
    kicker: 'Kuiper belt object · 486958 Arrokoth',
    summary: 'The most distant and most primitive world ever explored up close: two flattened lobes, 36 km end to end, that came together gently soon after the Solar System formed.',
    stats: [['Length', '36 km'], ['Distance from Sun', '6.6 billion km (44 AU)'], ['Year', '293 Earth years'], ['Day', '15.9 hours']],
    facts: [
      'New Horizons flew past it on 1 January 2019, 3,500 km away, three and a half years after Pluto.',
      'Its lobes touch at a narrow neck with no sign of a violent collision: they orbited each other and slowly merged.',
      'Its deep red colour comes from organic molecules (tholins) made by sunlight and cosmic rays on its ices.',
      'Its name means "sky" in the Powhatan language.',
    ],
    sources: [wiki('486958_Arrokoth'), nasa('new-horizons/', 'NASA: New Horizons')],
  },
  'Orion Nebula': {
    kicker: 'Emission nebula · M42',
    where: 'This object is not in the current scenario. The Stellar Nursery scenario has a nebula like it.',
    summary: 'The nearest large region where massive stars are being born, about 1,350 light-years away. It is visible to the naked eye as the fuzzy middle "star" of Orion\'s sword.',
    stats: [['Distance', 'about 1,350 light-years'], ['Size', 'about 24 light-years across'], ['Mass', 'about 2,000 Suns'], ['Age of its stars', 'under a million years (many)']],
    facts: [
      'Four bright young stars at its heart, the Trapezium, give off the ultraviolet light that makes the gas glow.',
      'Hubble found over 150 protoplanetary disks ("proplyds") around its young stars: planetary systems in the making.',
      'Webb found free-floating objects of a few Jupiter masses drifting through it, some in pairs.',
    ],
    sources: [wiki('Orion_Nebula'), wiki('Trapezium_Cluster')],
  },
  "Halley's Comet": {
    kicker: 'Comet · 1P/Halley',
    summary: 'The most famous comet. Halley returns to the inner Solar System about every 76 years, and has been recorded at every return since at least 240 BC.',
    stats: [['Nucleus', 'about 15 × 8 km'], ['Orbital period', '≈ 76 years'], ['Closest to Sun', '0.59 AU'], ['Farthest from Sun', '≈ 35 AU'], ['Inclination', '162° (orbits backwards)'], ['Last perihelion', 'February 1986'], ['Next perihelion', '28 July 2061']],
    facts: [
      'Edmond Halley worked out in 1705 that comets seen in 1531, 1607 and 1682 were one object, and predicted its return in 1758. It came back on schedule, after his death.',
      'ESA\'s Giotto probe flew within about 600 km of the nucleus in March 1986 and found it darker than coal.',
      'Dust shed by Halley causes two meteor showers each year: the Eta Aquariids in May and the Orionids in October.',
      'In this game its tail points away from the Sun and grows as it nears perihelion, as real comet tails do.',
    ],
    sources: [nasa('solar-system/comets/1p-halley/', 'NASA: Comet 1P/Halley'), ['JPL Small-Body Database: 1P', 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=1P']],
  },
  Theia: {
    kicker: 'Hypothetical protoplanet',
    summary: 'Theia is the name given to the Mars-sized body thought to have struck the young Earth about 4.5 billion years ago. The debris from that impact is thought to have formed the Moon.',
    stats: [['Estimated size', 'about Mars-sized'], ['Impact', '≈ 4.5 billion years ago']],
    facts: [
      'Moon rocks brought back by Apollo have almost the same isotope mix as Earth\'s mantle, a key clue for the giant-impact idea.',
      'A 2023 study proposed that two huge dense regions deep in Earth\'s mantle could be buried remnants of Theia.',
      'Theia is named after the Titaness in Greek myth who was the mother of Selene, goddess of the Moon.',
    ],
    sources: [wiki('Giant-impact_hypothesis'), wiki('Theia_(planet)')],
  },
  'Proto-Earth': {
    kicker: 'The young Earth',
    summary: 'Earth during its first hundred million years, before the impact that made the Moon. It was still hot from its formation, and most of its rock was probably molten.',
    stats: [['Age at impact', 'tens of millions of years'], ['Time', '≈ 4.5 billion years ago']],
    facts: [
      'The giant impact would have melted much of Earth, creating a global magma ocean.',
      'Afterwards Earth may have spun once every few hours; tides from the Moon have slowed it to 24 hours.',
    ],
    sources: [wiki('Giant-impact_hypothesis'), wiki('Early_Earth')],
  },
};

export const TYPES = {
  comet: {
    title: 'Comets',
    text: 'Comets are city-sized lumps of ice, dust and rock left over from the Solar System\'s formation. Far from the Sun they are frozen and dark. Near it, sunlight turns their ice to gas, which streams off with dust to form a glowing coma and tails up to millions of kilometres long.',
    facts: [
      'A comet usually has two tails: a straight blue ion tail pushed by the solar wind, and a curved white dust tail. Both point away from the Sun, not behind the comet.',
      'Short-period comets come from the Kuiper belt beyond Neptune; long-period comets fall in from the distant Oort cloud.',
      'ESA\'s Rosetta orbited comet 67P from 2014 to 2016, and its Philae lander touched down on the surface in November 2014.',
      'Comet Shoemaker–Levy 9 strayed inside Jupiter\'s Roche limit in 1992 and was torn into fragments, which struck Jupiter in July 1994. You can reproduce this in the game.',
    ],
    sources: [wiki('Comet'), wiki('Comet_Shoemaker–Levy_9')],
  },
  asteroid: {
    title: 'Asteroids',
    text: 'Asteroids are rocky and metallic bodies left over from planet formation, too small to be called planets. Most orbit in the main belt between Mars and Jupiter, where Jupiter\'s gravity stopped them from gathering into a planet.',
    facts: [
      'More than 1.3 million asteroids are known.',
      'All the asteroids in the main belt together have only about 3% of the Moon\'s mass.',
      'A roughly 10 km asteroid struck what is now Mexico 66 million years ago, contributing to the extinction of the non-avian dinosaurs.',
      'In 2022 NASA\'s DART spacecraft hit the small asteroid Dimorphos and shortened its orbit by about 33 minutes, the first test of planetary defence.',
    ],
    sources: [wiki('Asteroid'), wiki('Double_Asteroid_Redirection_Test')],
  },
  planetesimal: {
    title: 'Planetesimals',
    text: 'Planetesimals are the building blocks of planets: bodies from about a kilometre to hundreds of kilometres across that formed in the disk of gas and dust around a young star. Their collisions build protoplanets, and those collide to make planets.',
    facts: [
      'The Kuiper belt object Arrokoth, visited by New Horizons on 1 January 2019, is thought to be an untouched planetesimal: two lobes that merged gently.',
      'Building an Earth-sized planet is thought to take tens of millions of years of collisions.',
      'In this game planetesimals have inflated sizes so the collisions happen within minutes rather than millions of years.',
    ],
    sources: [wiki('Planetesimal'), wiki('486958_Arrokoth')],
  },
  moonsize: {
    title: 'Moon-sized bodies',
    text: 'Worlds a few thousand kilometres across, like Earth\'s Moon, the large moons of Jupiter and Saturn, and the biggest dwarf planets. They are large enough for gravity to pull them round, but too small to keep a thick atmosphere for long.',
    facts: [
      'Titan is the only moon with a thick atmosphere.',
      'Several icy moons, including Europa and Enceladus, have liquid water oceans under their crusts.',
    ],
    sources: [wiki('Planetary-mass_moon'), wiki('Dwarf_planet')],
  },
  smallrocky: {
    title: 'Small rocky planets',
    text: 'Rocky planets smaller than Earth, like Mercury and Mars. Their weaker gravity and faster-cooling interiors mean they tend to lose atmosphere and geological activity sooner than larger worlds.',
    facts: [
      'Mars probably lost most of its atmosphere to the solar wind after its magnetic field died out.',
      'Mercury\'s iron core makes up most of its volume.',
    ],
    sources: [wiki('Terrestrial_planet')],
  },
  terrestrial: {
    title: 'Terrestrial planets',
    text: 'Planets made mostly of rock and metal, with solid surfaces: Mercury, Venus, Earth and Mars. They formed close to the Sun, where it was too warm for ices to condense.',
    facts: [
      'All four have a layered structure: an iron core, a rocky mantle and a crust.',
      'Earth is the largest and densest of the terrestrial planets.',
      'Thousands of rocky planets have now been found around other stars, including seven Earth-sized worlds around the red dwarf TRAPPIST-1.',
    ],
    sources: [wiki('Terrestrial_planet'), wiki('TRAPPIST-1')],
  },
  superearth: {
    title: 'Super-Earths',
    text: 'Planets heavier than Earth but well below the ice giants, roughly 2 to 10 Earth masses. The Solar System has none, yet surveys such as NASA\'s Kepler mission found that they are among the most common planets in the galaxy.',
    facts: [
      'Some super-Earths are probably rocky; others may be "water worlds" or have thick hydrogen envelopes.',
      'In this game, a rocky body that grows past 10 Earth masses is reclassified as a gas giant.',
    ],
    sources: [wiki('Super-Earth')],
  },
  icegiant: {
    title: 'Ice giants',
    text: 'Planets like Uranus and Neptune, made mostly of "ices" (water, ammonia and methane) in a hot, dense fluid state, under a hydrogen-helium atmosphere. Methane in the atmosphere absorbs red light, giving them their blue colour.',
    facts: [
      'Each is about 15 to 17 times Earth\'s mass and about four times its width.',
      'Both have strange magnetic fields, tilted far from their spin axes and offset from their centres.',
    ],
    sources: [wiki('Ice_giant')],
  },
  gasgiant: {
    title: 'Gas giants',
    text: 'Giant planets made mostly of hydrogen and helium, like Jupiter and Saturn. They have no solid surface; their atmospheres get hotter and denser with depth until the hydrogen becomes a liquid metal.',
    facts: [
      'The first planet found around a Sun-like star, 51 Pegasi b (1995), is a "hot Jupiter" orbiting its star in just over four days. Its discoverers won the 2019 Nobel Prize in Physics.',
      'Gas giants probably formed first, quickly sweeping up gas before the young Sun blew the disk away.',
    ],
    sources: [wiki('Gas_giant'), wiki('51_Pegasi_b')],
  },
  browndwarf: {
    title: 'Brown dwarfs',
    text: 'Objects between about 13 and 80 Jupiter masses: too heavy to be planets, too light to sustain hydrogen fusion like a star. They glow faintly from the heat of their formation and slowly cool for ever.',
    facts: [
      'The first brown dwarfs were confirmed in 1995, Teide 1 and Gliese 229B.',
      'They can briefly fuse deuterium, a heavy form of hydrogen.',
      'In this game, an object that grows past 0.08 solar masses (about 80 Jupiters) ignites as a star.',
    ],
    sources: [wiki('Brown_dwarf')],
  },
  M: {
    title: 'Red dwarfs (M-type stars)',
    text: 'Small, cool stars, from about 8% to 60% of the Sun\'s mass. They are the most common kind of star in the Milky Way, but so dim that not one is visible to the naked eye.',
    facts: [
      'Roughly three in four stars are red dwarfs.',
      'The nearest star to the Sun, Proxima Centauri (4.24 light-years away), is a red dwarf with at least one planet in its habitable zone.',
      'Red dwarfs burn their fuel so slowly that they can live for trillions of years, far longer than the universe has existed.',
    ],
    sources: [wiki('Red_dwarf'), wiki('Proxima_Centauri')],
  },
  K: {
    title: 'Orange dwarfs (K-type stars)',
    text: 'Stars a little smaller and cooler than the Sun. They are long-lived and steady, which makes them good places to look for habitable planets.',
    facts: ['Alpha Centauri B, one of our nearest stellar neighbours, is a K-type star.', 'They live roughly 15 to 30 billion years or more.'],
    sources: [wiki('K-type_main-sequence_star')],
  },
  G: {
    title: 'Yellow dwarfs (G-type stars)',
    text: 'Sun-like stars, with surface temperatures of about 5,300 to 6,000 K. They spend roughly 10 billion years fusing hydrogen before becoming red giants.',
    facts: ['About 7% of main-sequence stars are G-type.', 'Alpha Centauri A is a G-type star, very similar to the Sun.', 'Despite the name, the Sun\'s light is nearly white; it looks yellow only through the atmosphere.'],
    sources: [wiki('G-type_main-sequence_star')],
  },
  F: {
    title: 'F-type stars',
    text: 'Stars somewhat hotter and heavier than the Sun, shining white. They live a few billion years.',
    facts: ['Procyon A, one of the brightest stars in the sky, is F-type.'],
    sources: [wiki('F-type_main-sequence_star')],
  },
  A: {
    title: 'A-type stars',
    text: 'Hot white stars about 1.5 to 2.5 times the Sun\'s mass, with strong hydrogen lines in their spectra.',
    facts: ['Sirius A, the brightest star in the night sky, and Vega are A-type stars.'],
    sources: [wiki('A-type_main-sequence_star')],
  },
  B: {
    title: 'Blue B-type stars',
    text: 'Massive, very luminous blue stars, from about 2 to 16 times the Sun\'s mass. The heavier ones end as supernovae.',
    facts: ['Rigel in Orion is a blue supergiant of spectral type B.', 'Spica, in Virgo, is a pair of B-type stars.'],
    sources: [wiki('B-type_main-sequence_star')],
  },
  O: {
    title: 'O-type stars',
    text: 'The hottest, most massive and rarest stars, with surfaces above 30,000 K. They burn out in a few million years and explode as supernovae, often leaving neutron stars or black holes.',
    facts: ['Perhaps only 1 in 3 million main-sequence stars is O-type.', 'Their ultraviolet light lights up the nebulae around them.'],
    sources: [wiki('O-type_main-sequence_star'), wiki('Stellar_classification')],
  },
  wd: {
    title: 'White dwarfs',
    text: 'The dense, glowing cores left behind when Sun-like stars die. A white dwarf packs roughly the Sun\'s mass into a ball the size of Earth. It no longer fuses anything; it just cools over billions of years.',
    facts: [
      'A teaspoon of white-dwarf matter would weigh about 5 tonnes.',
      'About 97% of the stars in the Milky Way, including the Sun, will end as white dwarfs.',
      'A white dwarf cannot be heavier than about 1.44 solar masses, the Chandrasekhar limit. Push it past that and it collapses or explodes. This game turns it into a neutron star.',
      'Sirius B, companion to the brightest star in the sky, is a white dwarf.',
    ],
    sources: [wiki('White_dwarf'), wiki('Chandrasekhar_limit')],
  },
  ns: {
    title: 'Neutron stars',
    text: 'The collapsed cores of massive stars that exploded as supernovae. About 1.4 times the Sun\'s mass is crushed into a sphere roughly 20 km across, so dense that atoms are squeezed into neutrons.',
    facts: [
      'A sugar cube of neutron-star material would weigh around a billion tonnes.',
      'Jocelyn Bell Burnell discovered the first pulsar, a spinning neutron star sweeping beams across space, in 1967.',
      'The fastest known pulsar spins 716 times per second.',
      'In 2017 detectors saw gravitational waves from two neutron stars merging; the explosion forged heavy elements such as gold.',
    ],
    sources: [wiki('Neutron_star'), wiki('GW170817')],
  },
  bh: {
    title: 'Black holes',
    text: 'Regions where gravity is so strong that nothing, not even light, can escape from inside the event horizon. Stellar black holes form when the cores of very massive stars collapse.',
    facts: [
      'The event horizon of a non-spinning black hole is about 3 km in radius for every solar mass.',
      'Far from the horizon a black hole pulls just like any other object of the same mass. Swap the Sun for a 1 M☉ black hole and Earth\'s orbit would not change.',
      'LIGO first detected gravitational waves from two merging black holes on 14 September 2015.',
      'Matter falling in heats up in an accretion disk and can outshine whole galaxies. Here, the disk glows brighter when the hole has been feeding.',
    ],
    sources: [wiki('Black_hole'), wiki('First_observation_of_gravitational_waves')],
  },
  smbh: {
    title: 'Supermassive black holes',
    text: 'Black holes of millions to billions of solar masses found at the centres of most large galaxies. How they grew so big so early in cosmic history is still an open question.',
    facts: [
      'The Milky Way\'s central black hole, Sagittarius A*, has about 4 million solar masses and lies about 26,000 light-years away.',
      'The Event Horizon Telescope released the first image of a black hole, M87*, in 2019, and of Sagittarius A* in May 2022.',
      'When a star strays too close, tides shred it in a "tidal disruption event". About half the debris escapes and the rest falls back, as in this game\'s scenario.',
    ],
    sources: [['Event Horizon Telescope: Sagittarius A*', 'https://eventhorizontelescope.org/blog/astronomers-reveal-first-image-black-hole-heart-our-galaxy'], wiki('Tidal_disruption_event')],
  },
  nebula: {
    title: 'Nebulae',
    text: 'Clouds of gas and dust where new stars are born. In an emission nebula, young hot stars light up the gas around them: hydrogen glows red and oxygen blue-green, while lanes of cold dust block the light behind.',
    facts: [
      'The red is hydrogen\'s H-alpha line at 656 nm, given off when electrons knocked loose by ultraviolet starlight recombine with protons; the blue-green is doubly ionised oxygen at 501 nm.',
      'Even a bright nebula holds only a few hundred to a few thousand atoms per cubic centimetre: emptier than the best vacuum made on Earth. Air has 25 billion billion.',
      'Dust that hides a nebula in visible light glows in the infrared, which is how the Spitzer and Webb telescopes see stars forming inside it.',
      'Hubble\'s 1995 "Pillars of Creation" in the Eagle Nebula are columns of gas and dust light-years tall, slowly being evaporated by nearby stars.',
      'In this game a nebula is a softly gravitating cloud that everything passes through; its glow comes from the starlight inside it, which is not modelled star by star.',
    ],
    sources: [wiki('Emission_nebula'), wiki('Pillars_of_Creation'), wiki('H-alpha')],
  },
  galaxy: {
    title: 'Galaxies',
    text: 'Vast systems of stars, gas, dust and dark matter bound by gravity. Spiral galaxies like the Milky Way have a central bulge, often with a supermassive black hole, surrounded by a rotating disk with spiral arms.',
    facts: [
      'The Milky Way holds an estimated 100 to 400 billion stars in a disk about 100,000 light-years across.',
      'Galaxies collide often. The stars almost never hit each other, but gravity throws out long tidal tails like those you can see in this game.',
      'The Andromeda galaxy is approaching at about 110 km/s. A 2025 study put the chance of it merging with the Milky Way in the next 10 billion years at about 50%.',
      'In this game each galaxy is a softened point mass with test-particle stars, so its spiral arms wind up over time.',
    ],
    sources: [wiki('Galaxy'), wiki('Andromeda–Milky_Way_collision')],
  },
};

export function typeKey(b) {
  const me = b.m / 3.0035e-6;
  switch (b.kind) {
    case 'rocky':
      if (b.comet && me < 1e-4) return 'comet';
      if (b.name.startsWith('Planetesimal')) return 'planetesimal';
      if (me < 1e-4) return 'asteroid';
      if (me < 0.03) return 'moonsize';
      if (me < 0.3) return 'smallrocky';
      if (me < 2) return 'terrestrial';
      return 'superearth';
    case 'gas':
      if (b.m > 13 * 9.5458e-4) return 'browndwarf';
      return me < 50 ? 'icegiant' : 'gasgiant';
    case 'star': {
      const t = b.temp;
      return t < 3700 ? 'M' : t < 5200 ? 'K' : t < 6000 ? 'G' : t < 7500 ? 'F' : t < 10000 ? 'A' : t < 30000 ? 'B' : 'O';
    }
    case 'wd': return 'wd';
    case 'ns': return 'ns';
    case 'bh': return b.m > 1e5 ? 'smbh' : 'bh';
    case 'nebula': return 'nebula';
    default: return 'galaxy';
  }
}

// Groups for the book's contents page.
export const CONTENTS = [
  ['Our star', ['Sun']],
  ['Planets', ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']],
  ['Moons', ['Moon', 'Io', 'Europa', 'Ganymede', 'Callisto']],
  ['Dwarf planets and small bodies', ['Ceres', 'Pluto', 'Bennu', 'Ryugu', 'Arrokoth', "Halley's Comet"]],
  ['Beyond the Solar System', ['Orion Nebula']],
  ['Deep history', ['Theia', 'Proto-Earth']],
  ['Kinds of object', ['comet', 'asteroid', 'planetesimal', 'terrestrial', 'superearth', 'icegiant', 'gasgiant', 'browndwarf', 'M', 'K', 'G', 'F', 'A', 'B', 'O', 'wd', 'ns', 'bh', 'smbh', 'nebula', 'galaxy']],
];
