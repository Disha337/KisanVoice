// Rule-based sample crop suitability. General knowledge only, NOT a scientific guarantee.
export const CROPS = [
  { id: 'jowar', seasons: ['kharif', 'rabi'], soils: ['black', 'red', 'loamy'], water: ['low', 'medium'] },
  { id: 'bajra', seasons: ['kharif'], soils: ['sandy', 'red'], water: ['low'] },
  { id: 'soybean', seasons: ['kharif'], soils: ['black', 'loamy'], water: ['medium'] },
  { id: 'cotton', seasons: ['kharif'], soils: ['black'], water: ['medium', 'high'] },
  { id: 'tur', seasons: ['kharif'], soils: ['black', 'red'], water: ['low', 'medium'] },
  { id: 'wheat', seasons: ['rabi'], soils: ['loamy', 'black'], water: ['medium', 'high'] },
  { id: 'gram', seasons: ['rabi'], soils: ['black', 'loamy'], water: ['low', 'medium'] },
  { id: 'sugarcane', seasons: ['kharif', 'rabi', 'summer'], soils: ['black', 'loamy'], water: ['high'] },
  { id: 'onion', seasons: ['rabi', 'kharif'], soils: ['loamy', 'sandy'], water: ['medium'] },
  { id: 'tomato', seasons: ['rabi', 'summer', 'kharif'], soils: ['loamy', 'red'], water: ['medium', 'high'] },
  { id: 'maize', seasons: ['kharif', 'summer'], soils: ['loamy', 'red'], water: ['medium'] },
  { id: 'groundnut', seasons: ['kharif', 'summer'], soils: ['sandy', 'red'], water: ['low', 'medium'] },
];
const ORDER = ['low', 'medium', 'high'];

export function recommend({ season, soil, water } = {}) {
  const out = [];
  for (const c of CROPS) {
    let score = 0, max = 0;
    const matches = {};
    if (season) { max += 3; if (c.seasons.includes(season)) { score += 3; matches.season = true; } }
    if (soil) { max += 2; if (c.soils.includes(soil)) { score += 2; matches.soil = true; } }
    if (water) {
      max += 2;
      if (c.water.includes(water)) { score += 2; matches.water = 'exact'; }
      else if (c.water.some((w) => Math.abs(ORDER.indexOf(w) - ORDER.indexOf(water)) === 1)) { score += 1; matches.water = 'near'; }
    }
    if (max && score / max >= 0.5) out.push({ id: c.id, score: Math.round((score / max) * 100), matches });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
