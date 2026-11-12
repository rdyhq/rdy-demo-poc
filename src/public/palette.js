// The art palette of RDY s-NZ5MA. Every page colour is built from one base colour of the creator's art.
import { accentPalettes, contrast, hexColor, luminance, rgb, toHex, toHsl } from './contrast.js';

// The version is part of the stylesheet address. Raise it when the colours of a saved palette would change.
export const paletteVersion=1;
export const statusColors={
  Nebula:{error:'#ff8fa3',success:'#7ee2a8'}, Ember:{error:'#ff8f8f',success:'#a6e3a1'},
  Tide:{error:'#ff9b9b',success:'#8af0b0'}, Paper:{error:'#b42318',success:'#157f3d'},
};
// The page keeps the lightness of the base colour inside this range, so a near-black banner colour is the page colour itself.
const pageRange={dark:[.035,.09],light:[.93,.965]};
// Each tone is [saturation cap, lightness]. A third value of true makes the lightness an offset from the page.
const levels={
  dark:{page:[.6,0,true],raisedPage:[.6,.03,true],surface:[.6,.055,true],raised:[.6,.105,true],cardEdge:[.55,.185,true],
    border:[.3,.56],text:[.6,.96],muted:[.28,.76]},
  light:{page:[.85,0,true],raisedPage:[.8,-.04,true],surface:[.9,.985],raised:[.85,.955],cardEdge:[.6,.85],
    border:[.25,.44],text:[.4,.16],muted:[.22,.36]},
};
// Status text of the nearest theme stays readable while the raised surface keeps this luminance.
const raisedLimit={dark:luminance=>luminance<=.045,light:luminance=>luminance>=.885};
const isHex=color=>typeof color==='string'&&hexColor.test(color);

export function nearestTheme(base) {
  if(luminance(base)>=.5) return 'Paper';
  const [hue,saturation]=toHsl(rgb(base));
  const angle=hue*60;
  if(saturation<.12) return 'Nebula';
  if(angle>=345||angle<75) return 'Ember';
  return angle<255?'Tide':'Nebula';
}

// Move the lightness of a colour until it reaches the minimum on every surface. The hue stays.
function settle(color,surfaces,minimum,lighter) {
  const passes=candidate=>surfaces.every(surface=>contrast(candidate,surface)>=minimum);
  if(passes(color)) return color;
  const [hue,saturation,lightness]=toHsl(rgb(color));
  for(let step=1;step<=100;step++) {
    const next=lighter?Math.min(1,lightness+step/100):Math.max(0,lightness-step/100);
    const moved=toHex(hue,saturation,next);
    if(passes(moved)) return moved;
    if(next===0||next===1) break;
  }
  return null;
}

export function paletteReadable(palette) {
  const reaches=(color,surface,minimum)=>isHex(color)&&contrast(color,surface)>=minimum;
  const status=statusColors[palette.theme];
  return [palette.page,palette.raised].every(surface=>
    ['text','muted','accent','second'].every(token=>reaches(palette[token],surface,4.5))&&reaches(palette.border,surface,3))&&
    reaches(palette.on,palette.accent,4.5)&&reaches(status.error,palette.raised,4.5)&&reaches(status.success,palette.raised,4.5);
}

export function artPalette({base,second=null,accent=null}) {
  if(!isHex(base)||(second!==null&&!isHex(second))||(accent!==null&&!isHex(accent))) return null;
  const theme=nearestTheme(base);
  const scheme=theme==='Paper'?'light':'dark';
  const dark=scheme==='dark';
  const [hue,saturation,lightness]=toHsl(rgb(base));
  const [low,high]=pageRange[scheme];
  const pageLightness=Math.min(high,Math.max(low,lightness));
  const tone=(name,cap=levels[scheme][name][0])=>{
    const [,level,relative]=levels[scheme][name];
    return toHex(hue,Math.min(saturation,cap),relative?pageLightness+level:level);
  };
  let cap=levels[scheme].raised[0], raised=tone('raised');
  // A strong tint of a bright hue moves the raised surface too far. Take saturation away until it fits.
  while(!raisedLimit[scheme](luminance(raised))&&cap>0) {
    cap=Math.max(0,cap-.05);
    raised=tone('raised',cap);
  }
  const page=tone('page');
  const surfaces=[page,raised];
  const on=dark?toHex(hue,Math.min(saturation,.6),.09):'#ffffff';
  const settledAccent=settle((accent??accentPalettes[theme].accent).toLowerCase(),[...surfaces,on],4.5,dark);
  const settledSecond=second===null?null:settle(second.toLowerCase(),surfaces,4.5,dark);
  const muted=settle(tone('muted'),surfaces,4.5,dark);
  const palette={
    scheme,theme,page,raisedPage:tone('raisedPage'),surface:tone('surface'),raised,
    text:settle(tone('text'),surfaces,4.5,dark),muted,accent:settledAccent,on,
    cardEdge:tone('cardEdge'),border:settle(tone('border'),surfaces,3,dark),
    glow:settledSecond??settledAccent,second:settledSecond??muted,
  };
  return paletteReadable(palette)?palette:null;
}

// The contrast guard checks an accent on the art palette when the skin has one, and on the theme when it has none.
export function guardSurfaces(theme,palette) {
  const art=palette&&artPalette({...palette,accent:null});
  return art?{page:art.page,raised:art.raised,on:art.on,accent:accentPalettes[theme].accent}:accentPalettes[theme];
}

export function paletteCss(palette) {
  const tokens=[['page','page'],['raised-page','raisedPage'],['surface','surface'],['raised-surface','raised'],['text','text'],
    ['muted','muted'],['accent','accent'],['on','on'],['card-edge','cardEdge'],['border','border'],['glow','glow'],['second','second']];
  return ':root{color-scheme:'+palette.scheme+';'+tokens.map(([name,token])=>'--'+name+':'+palette[token]+';').join('')+'}';
}

const part=color=>color?color.slice(1).toLowerCase():'0';
export function skinPath(palette,accent) {
  return '/assets/skin/'+paletteVersion+'/'+part(palette.base)+'-'+part(palette.second)+'-'+part(accent)+'.css';
}

// Read the three source colours back from the file name of a skin stylesheet.
export function skinColours(file) {
  const match=/^([0-9a-f]{6})-([0-9a-f]{6}|0)-([0-9a-f]{6}|0)\.css$/.exec(file);
  if(!match) return null;
  const colour=value=>value==='0'?null:'#'+value;
  return {base:'#'+match[1],second:colour(match[2]),accent:colour(match[3])};
}
