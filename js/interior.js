// Interiors: each world's layers, from the centre out, with their outer radius (fraction of the whole), and the
// temperature and pressure at the centre. Measured or modelled for the planets and big moons; elsewhere built
// from the world's composition by mass (iron, rock, water, ice, gas), each layer at a typical density, heaviest
// innermost. Central pressure from hydrostatic balance scales as M²/R⁴ (Earth: 364 GPa).
const ME = 3.003e-6, RE = 6371 / 1.495978707e8;

// name, colour (for the cutaway), and a line about what it is
const KIND = {
  icore: ['Inner core', [255, 244, 190], 'solid iron and nickel, crushed solid by pressure though hotter than the Sun\'s surface'],
  ocore: ['Outer core', [255, 170, 60], 'liquid iron and nickel; its churning makes the magnetic field'],
  core: ['Core', [255, 190, 90], 'iron and nickel'],
  lmantle: ['Lower mantle', [235, 90, 40], 'hot rock under such pressure it flows only over millions of years'],
  umantle: ['Upper mantle', [190, 60, 35], 'hot rock creeping in slow convection; it drags the plates of the crust'],
  mantle: ['Mantle', [205, 72, 38], 'silicate rock'],
  crust: ['Crust', [120, 92, 70], 'the cool, rigid outer rock'],
  ocean: ['Ocean', [40, 110, 200], 'liquid water'],
  ice: ['Ice shell', [215, 232, 245], 'frozen water'],
  hpice: ['High-pressure ice', [150, 190, 230], 'ice so compressed it is denser than rock-free water ice'],
  icemantle: ['Water-ammonia mantle', [90, 170, 210], 'a hot, dense fluid of water, ammonia and methane (the "ices")'],
  rockcore: ['Rocky core', [170, 120, 80], 'rock and iron'],
  dilute: ['Dilute core', [210, 160, 110], 'heavy elements dissolved into hydrogen, not a sharp ball (Juno, Cassini)'],
  metal: ['Metallic hydrogen', [150, 160, 190], 'hydrogen squeezed into a liquid metal; its currents make the field'],
  molecular: ['Molecular hydrogen', [225, 215, 190], 'hydrogen and helium gas thickening into a fluid with depth'],
  envelope: ['Hydrogen-helium envelope', [200, 215, 230], 'gas'],
};
const L = (k, r) => ({ key: k, name: KIND[k][0], col: KIND[k][1], what: KIND[k][2], r });

// Measured or modelled: outer radius of each layer as a fraction of the world's radius; centre T (K), P (GPa).
const KNOWN = {
  // PREM (Dziewonski & Anderson 1981): inner core 1221 km, outer core 3480, 660 km boundary, crust ~35.
  Earth: { layers: [['icore', 1221], ['ocore', 3480], ['lmantle', 5711], ['umantle', 6336], ['crust', 6371]], R: 6371, T: 5400, P: 364 },
  // InSight: core 1830 km (Stähler et al. 2021); crust 24-72 km.
  Mars: { layers: [['core', 1830], ['mantle', 3340], ['crust', 3390]], R: 3390, T: 2000, P: 40 },
  // Apollo seismometers: inner core ~240 km, outer ~330 (Weber et al. 2011); crust ~40.
  Moon: { layers: [['icore', 240], ['ocore', 330], ['mantle', 1697], ['crust', 1737]], R: 1737, T: 1700, P: 5 },
  // MESSENGER: core ~2020 km of 2440 (Hauck et al. 2013).
  Mercury: { layers: [['icore', 1000], ['ocore', 2020], ['mantle', 2405], ['crust', 2440]], R: 2440, T: 2000, P: 40 },
  Venus: { layers: [['core', 3000], ['mantle', 6022], ['crust', 6052]], R: 6052, T: 5000, P: 290 },
  // Juno: a dilute core to ~half the radius (Wahl et al. 2017); metallic hydrogen below ~0.83.
  Jupiter: { layers: [['dilute', 0.5], ['metal', 0.83], ['molecular', 1]], R: 1, T: 20000, P: 4000 },
  // Cassini ring seismology: a diffuse core to ~0.6 (Mankovich & Fuller 2021).
  Saturn: { layers: [['dilute', 0.6], ['metal', 0.7], ['molecular', 1]], R: 1, T: 12000, P: 1500 },
  Uranus: { layers: [['rockcore', 0.2], ['icemantle', 0.75], ['envelope', 1]], R: 1, T: 5000, P: 800 },
  Neptune: { layers: [['rockcore', 0.25], ['icemantle', 0.8], ['envelope', 1]], R: 1, T: 5400, P: 800 },
  // Galileo gravity: Europa's iron core ~600 km, rock to ~1400, ocean ~100 km under ~20 km of ice.
  Europa: { layers: [['core', 600], ['mantle', 1440], ['ocean', 1541], ['ice', 1561]], R: 1561, T: 1600, P: 4 },
  Ganymede: { layers: [['core', 700], ['mantle', 1600], ['hpice', 2300], ['ocean', 2470], ['ice', 2634]], R: 2634, T: 1800, P: 10 },
  Titan: { layers: [['rockcore', 2000], ['hpice', 2300], ['ocean', 2475], ['ice', 2575]], R: 2575, T: 1500, P: 6 },
  Enceladus: { layers: [['rockcore', 185], ['ocean', 230], ['ice', 252]], R: 252, T: 400, P: 0.1 },
  Io: { layers: [['core', 950], ['mantle', 1771], ['crust', 1821]], R: 1821, T: 1900, P: 6 },
};

export function interiorOf(b) {
  if (!b || !(b.r > 0) || b.kind === 'nebula' || b.kind === 'bh') return null;
  const name = b.name.replace(/ \d+$/, '');
  const mE = b.m / ME, rE = b.r / RE;
  const Pc = 364 * (mE * mE) / Math.pow(rE, 4);
  if (b.kind === 'star' && b.bhStar) {
    // A black hole star: the hole and its disk at the centre (a millionth of the radius), wrapped in gas so
    // thick it hides them, glowing at its surface like a cool giant star.
    return {
      layers: [
        { key: 'hole', name: 'Black hole', col: [20, 16, 14], what: 'the engine: a black hole of most of the mass, feeding on the gas around it', r: 0.004 },
        { key: 'bdisk', name: 'Accretion disk', col: [255, 240, 210], what: 'gas swirling in at a good fraction of light speed, heated to millions of kelvin', r: 0.03 },
        { key: 'cocoon', name: 'Dense gas cocoon', col: [255, 140, 70], what: 'hydrogen thick enough to swallow the disk\'s light and glow at ~5,000 K, like a giant star\'s surface', r: 1 },
      ],
      T: 1e7, P: 1e-4,
    };
  }
  if (b.kind === 'star') {
    // Stars: the core where hydrogen fuses (~a quarter of the radius), then energy carried out by radiation,
    // then convection (in the Sun's outer 30%; a red giant is convective almost throughout).
    const conv = b.giant ? 0.15 : b.m < 0.35 ? 0 : 0.7;
    const ls = [{ key: 'score', name: 'Core (fusion)', col: [255, 250, 220], what: 'hydrogen fusing into helium at ~15 million K (the Sun)', r: 0.25 }];
    if (conv > 0.25) ls.push({ key: 'rad', name: 'Radiative zone', col: [255, 210, 120], what: 'light diffusing outward, taking ~100,000 years', r: conv });
    ls.push({ key: 'conv', name: 'Convective zone', col: [255, 150, 60], what: 'hot gas rising and sinking: the granules on the surface', r: 1 });
    return { layers: ls, T: 1.57e7 * Math.pow(b.m, 0.5), P: 2.5e7 * Math.pow(b.m, -0.5) };
  }
  if (b.kind === 'ns') return { layers: [{ key: 'nc', name: 'Neutron core', col: [200, 220, 255], what: 'neutrons (and perhaps quarks) at several times the density of an atomic nucleus', r: 0.9 }, { key: 'ncr', name: 'Crust', col: [150, 170, 210], what: 'a lattice of neutron-rich nuclei, a kilometre thick', r: 1 }], T: 1e9, P: 1e23 };
  if (b.kind === 'wd') return { layers: [{ key: 'wd', name: 'Carbon-oxygen core', col: [230, 240, 255], what: 'degenerate matter: a teaspoon weighs tonnes, held up by electron pressure', r: 0.99 }, { key: 'wde', name: 'Helium/hydrogen skin', col: [180, 200, 240], what: 'a thin envelope', r: 1 }], T: 1e7, P: 1e13 };
  const k = KNOWN[name];
  if (k) return { layers: k.layers.map(([key, r]) => L(key, r / k.R)), T: k.T, P: k.P, known: true };
  // Built from the composition by mass: densities iron 10, rock 4, water/ice 1.3, gas 0.5 g/cm³ (compressed).
  const c = b.comp || { iron: 0.3, rock: 0.7 };
  const parts = [['iron', c.iron || 0, 10], ['rock', c.rock || 0, 4], ['water', (c.water || 0) + (c.ice || 0), 1.3], ['gas', c.gas || 0, 0.5]];
  const vol = parts.map(([, f, d]) => f / d), vt = vol.reduce((s, v) => s + v, 0) || 1;
  let acc = 0;
  const ls = [];
  const T = b.kind === 'gas' ? 5000 + 15000 * Math.min(1, mE / 318) : 1500 + 4000 * Math.min(1.5, Math.sqrt(mE));
  const liquidOcean = b.th && b.th.liquid > 0.02;
  parts.forEach(([n, f], i) => {
    if (f <= 0) return;
    acc += vol[i] / vt;
    const r = Math.cbrt(acc);
    if (b.kind === 'gas' && (n === 'iron' || n === 'rock')) {
      // (a giant's heavy elements: one rocky core, not a planet's layered core and mantle)
      if (ls.length && ls[ls.length - 1].key === 'rockcore') ls[ls.length - 1].r = r; else ls.push(L('rockcore', r));
    } else if (n === 'iron') {
      if (mE > 0.2) { ls.push(L('icore', r * 0.35)); ls.push(L('ocore', r)); } else ls.push(L('core', r));
    } else if (n === 'rock') {
      const outer = r;
      if (mE > 0.5) { ls.push(L('lmantle', outer - (outer - (ls.length ? ls[ls.length - 1].r : 0)) * 0.25)); ls.push(L('umantle', outer - 0.006)); }
      else ls.push(L('mantle', outer - 0.01));
      ls.push(L('crust', outer));
    } else if (n === 'water') {
      if (b.kind === 'gas') ls.push(L('icemantle', r));
      else if (liquidOcean) { ls.push(L('ocean', r)); }
      else ls.push(L('ice', r));
    } else if (n === 'gas') {
      // (metallic hydrogen below ~0.8 of the radius, in Jupiter-like giants: pressures over ~1.5 million atm)
      if (mE > 50) { ls.push(L('metal', Math.max((ls.length ? ls[ls.length - 1].r : 0) + 0.1, 0.8))); ls.push(L('molecular', 1)); }
      else ls.push(L('envelope', 1));
    }
  });
  if (ls.length) ls[ls.length - 1].r = 1;
  return { layers: ls, T, P: Pc };
}

export function formatPressure(gpa) {
  if (gpa >= 1e6) return `${(gpa / 1e6).toPrecision(2)} million GPa`;
  if (gpa >= 1000) return `${(gpa / 1000).toPrecision(2)} TPa (${Math.round(gpa / 0.101325e-3 / 1e6).toLocaleString('en-US')} million atm)`;
  if (gpa >= 1) return `${gpa.toPrecision(3)} GPa (${Math.round(gpa / 0.101325e-3).toLocaleString('en-US')} atm)`;
  return `${(gpa * 1e3).toPrecision(2)} MPa`;
}
