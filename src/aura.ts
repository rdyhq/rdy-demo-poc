import { invalid, type Theme } from './domain.ts';
import { accentPalettes, accentPasses, hexColor } from './public/contrast.js';

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
};

export const defaultAura:Readonly<Aura> = {
  accent:null, accentSource:'theme', font:'grotesk', shape:'round',
  frame:'clean', field:'drift', intensity:'calm', liveSurge:true,
};

export function normalizeAura(input:unknown,theme:Theme,previous:Readonly<Aura>):Aura {
  if(input===undefined) {
    // An older editor can change the theme without supplying an accent for it.
    if(previous.accent!==null&&!accentPasses(previous.accent,accentPalettes[theme])) {
      return {...previous,accent:null,accentSource:'theme'};
    }
    return {...previous};
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
  if(aura.accent!==null) {
    if(!accentPasses(aura.accent,accentPalettes[theme])) throw invalid('aura-accent','Choose an accent with enough contrast.');
    aura.accent=aura.accent.toLowerCase();
  }
  return aura;
}
