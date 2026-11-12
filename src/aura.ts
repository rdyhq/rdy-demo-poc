import { invalid, type Theme } from './domain.ts';
import { accentPasses, hexColor } from './public/contrast.js';
import { artPalette, guardSurfaces, nearestTheme } from './public/palette.js';

export const auraOptions = {
  accentSource: ['theme','swatch','custom','art'],
  font: ['grotesk','wide','mono','pixel'],
  shape: ['soft','square','round'],
  frame: ['clean','hud','holo','pixel'],
  field: ['drift','embers','grid','stars','none'],
  intensity: ['off','calm','bold'],
} as const;

export type Aura = {[K in keyof typeof auraOptions]: typeof auraOptions[K][number]} & {
  accent:string|null;
  liveSurge:boolean;
  // The source colours of an art palette (RDY r-VRTS9). The theme of the Home is its nearest theme.
  palette:{base:string;second:string|null}|null;
};

export const defaultAura:Readonly<Aura> = {
  accent:null, accentSource:'theme', font:'grotesk', shape:'round',
  frame:'clean', field:'drift', intensity:'calm', liveSurge:true, palette:null,
};

export function normalizeAura(input:unknown,theme:Theme,previous:Readonly<Aura>):Aura {
  if(input===undefined) {
    // An older editor can change the theme without supplying an accent or a palette for it.
    const palette=previous.palette&&nearestTheme(previous.palette.base)===theme?previous.palette:null;
    if(previous.accent!==null&&!accentPasses(previous.accent,guardSurfaces(theme,palette))) {
      return {...previous,palette,accent:null,accentSource:'theme'};
    }
    return {...previous,palette};
  }
  if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).some(key=>!Object.hasOwn(defaultAura,key))) {
    throw invalid('aura','Use the supported Aura settings.');
  }
  const aura={...defaultAura,...input};
  for(const key of Object.keys(auraOptions) as (keyof typeof auraOptions)[]) {
    const options:readonly string[]=auraOptions[key];
    if(!options.includes(aura[key])) throw invalid('aura-'+key,'Choose a supported option.');
  }
  if(typeof aura.liveSurge!=='boolean') throw invalid('aura-liveSurge','Turn live surge on or off.');
  if(aura.accent!==null&&(typeof aura.accent!=='string'||!hexColor.test(aura.accent))) {
    throw invalid('aura-accent','Choose a six-digit hex color.');
  }
  if((aura.accent===null)!==(aura.accentSource==='theme')) {
    throw invalid('aura-accent','Choose the theme accent or set an accent color.');
  }
  aura.palette=normalizePalette(aura.palette,theme);
  if(aura.accent!==null) {
    if(!accentPasses(aura.accent,guardSurfaces(theme,aura.palette))) throw invalid('aura-accent','Choose an accent with enough contrast.');
    aura.accent=aura.accent.toLowerCase();
  }
  return aura;
}

function normalizePalette(input:unknown,theme:Theme):Aura['palette'] {
  if(input===null) return null;
  const refuse=(message:string)=>invalid('aura-palette',message);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='base,second') {
    throw refuse('Use the base colour and the second colour of an art palette.');
  }
  const {base,second}=input as {base:unknown;second:unknown};
  if(typeof base!=='string'||!hexColor.test(base)||(second!==null&&(typeof second!=='string'||!hexColor.test(second)))) {
    throw refuse('Choose six-digit hex colors.');
  }
  const palette={base:base.toLowerCase(),second:second===null?null:second.toLowerCase()};
  if(nearestTheme(palette.base)!==theme) throw refuse('Use the nearest theme of the art palette.');
  if(!artPalette({...palette,accent:null})) throw refuse('These colours do not pass the contrast check. Choose a theme.');
  return palette;
}
