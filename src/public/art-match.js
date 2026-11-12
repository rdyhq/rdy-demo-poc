// The art match of RDY s-NZ5MA. It reads three colours from the creator's art and suggests a skin.
// The pixel data is RGBA, 4 values a pixel, from a canvas in the browser or from sharp on the server.
import { accentPalettes, adjustAccent, rgb, toHsl } from './contrast.js';
import { artPalette, nearestTheme } from './palette.js';

// These limits are first values from three mock streamers. Test them with real channels (RDY n-3VT1D).
const vividChroma=.3;       // A pixel is vivid when its channels differ by this share of the range.
const colouredBase=.1;      // A base colour below this has almost no colour and excludes no hue.
const apartFromBase=30;     // Degrees of hue between the page colour and an accent or second colour.
const apartFromAccent=45;   // Degrees of hue between the accent and the second colour.
const noise=.005;           // A hue on less than this share of the art is not a brand colour.
const strongShare=.15;      // Dark art with this share of vivid colour gets the neon look.

const hex=channels=>'#'+channels.map(value=>Math.round(value).toString(16).padStart(2,'0')).join('');
const chromaOf=(red,green,blue)=>(Math.max(red,green,blue)-Math.min(red,green,blue))/255;
const apart=(left,right)=>{
  const distance=Math.abs(left-right)%360;
  return Math.min(distance,360-distance);
};

function commonColour(pixels) {
  const buckets=new Map();
  let top;
  for(let at=0;at<pixels.length;at+=4) {
    if(pixels[at+3]<192) continue;
    const key=(pixels[at]>>4)<<8|(pixels[at+1]>>4)<<4|(pixels[at+2]>>4);
    const bucket=buckets.get(key)??{count:0,sum:[0,0,0]};
    bucket.count++;
    for(let channel=0;channel<3;channel++) bucket.sum[channel]+=pixels[at+channel];
    buckets.set(key,bucket);
    if(!top||bucket.count>top.count) top=bucket;
  }
  return top?hex(top.sum.map(value=>value/top.count)):null;
}

// The base colour comes from the banner, or from the avatar when there is no banner (RDY r-FYEAK).
export function matchColours({banner=null,avatar=null}) {
  const base=(banner&&commonColour(banner))??(avatar&&commonColour(avatar));
  if(!base) return null;
  const bins=Array.from({length:24},(_,index)=>({angle:index*15,count:0,strength:0,sum:[0,0,0]}));
  let opaque=0, vivid=0;
  for(const pixels of [banner,avatar]) {
    if(!pixels) continue;
    for(let at=0;at<pixels.length;at+=4) {
      if(pixels[at+3]<192) continue;
      opaque++;
      const channels=[pixels[at],pixels[at+1],pixels[at+2]];
      const chroma=chromaOf(...channels);
      if(chroma<vividChroma) continue;
      vivid++;
      // A more saturated pixel counts more, so a small bright mark can beat a large dull area.
      const weight=chroma*chroma;
      const bin=bins[Math.round(toHsl(channels.map(value=>value/255))[0]*4)%24];
      bin.count++;
      bin.strength+=weight;
      for(let channel=0;channel<3;channel++) bin.sum[channel]+=channels[channel]*weight;
    }
  }
  // The page already carries the hue of a coloured base, so the accent and the second colour stand apart from it.
  const baseChannels=rgb(base).map(value=>value*255);
  const baseHue=chromaOf(...baseChannels)<colouredBase?null:toHsl(rgb(base))[0]*60;
  const strongest=bins.filter(bin=>bin.count>=noise*opaque&&bin.count>0&&(baseHue===null||apart(bin.angle,baseHue)>=apartFromBase))
    .sort((left,right)=>right.strength-left.strength);
  const colour=bin=>bin?hex(bin.sum.map(value=>value/bin.strength)):null;
  const accent=strongest[0];
  const second=accent&&strongest.find(bin=>apart(bin.angle,accent.angle)>=apartFromAccent);
  return {base,accent:colour(accent),second:colour(second),vividShare:opaque?vivid/opaque:0};
}

// The style rule of RDY tb-P6T6V.
const looks={
  light:{font:'grotesk',shape:'round',frame:'clean',field:'drift',reason:'Your art is light.'},
  neon:{font:'wide',shape:'round',frame:'holo',field:'stars',reason:'Your art is dark with a lot of bright colour.'},
  signal:{font:'mono',shape:'square',frame:'hud',field:'grid',reason:'Your art is dark with a little bright colour.'},
  plain:{font:'grotesk',shape:'round',frame:'clean',field:'drift',reason:'Your art has no bright colour.'},
};
const named=value=>value==='hud'?'HUD':value[0].toUpperCase()+value.slice(1);

// A skin for the colours of the art: the art palette, or the nearest theme when the palette cannot be used.
export function suggestSkin(colours,source) {
  if(!colours) return null;
  const art=artPalette(colours);
  const theme=art?.theme??nearestTheme(colours.base);
  const accent=colours.accent&&(art?art.accent:adjustAccent(colours.accent,accentPalettes[theme]));
  const look=looks[!colours.accent?'plain':theme==='Paper'?'light':colours.vividShare>=strongShare?'neon':'signal'];
  const reasons=[{control:'Page colours',value:art?'My art':theme,
    reason:art?'Built from the most common colour of your '+source+'.':'The nearest theme to the most common colour of your '+source+'.'}];
  if(accent) {
    reasons.push({control:'Accent',value:accent,
      reason:'The strongest colour in your art.'+(accent===colours.accent?'':' Adjusted for readability.')});
  }
  if(art&&colours.second) reasons.push({control:'Second colour',value:art.second,reason:'The next strongest colour in your art.'});
  reasons.push({control:'Style',reason:look.reason,
    value:[['font','font'],['shape','shape'],['frame','frame'],['field','field']].map(([key,noun])=>named(look[key])+' '+noun).join(', ')});
  return {theme,palette:art?{base:colours.base,second:colours.second}:null,accent:accent||null,accentSource:accent?'art':'theme',
    font:look.font,shape:look.shape,frame:look.frame,field:look.field,reasons};
}
