// Values used by the contrast guard from RDY tb-6BCAQ.
export const accentPalettes = {
  Nebula: {page:'#120e1d', raised:'#251d3f', on:'#160f27', accent:'#b69cff'},
  Ember: {page:'#150c0a', raised:'#2f1b15', on:'#2a1006', accent:'#ff8a4c'},
  Tide: {page:'#061318', raised:'#112d37', on:'#03201b', accent:'#47dcc4'},
  Paper: {page:'#f4f1ec', raised:'#f7f4ef', on:'#ffffff', accent:'#5a3cf0'},
};

export const hexColor = /^#[0-9a-f]{6}$/i;

export const rgb = color => [1,3,5].map(start=>parseInt(color.slice(start,start+2),16)/255);
export function luminance(color) {
  const [r,g,b]=rgb(color).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
}

export function contrast(a,b) {
  const left=luminance(a), right=luminance(b);
  return (Math.max(left,right)+.05)/(Math.min(left,right)+.05);
}

export function accentPasses(accent,palette) {
  return typeof accent==='string'&&hexColor.test(accent)&&
    [palette.page,palette.raised,palette.on].every(color=>contrast(accent,color)>=4.5);
}

export function toHsl([r,g,b]) {
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  const lightness=(max+min)/2, chroma=max-min;
  if(!chroma) return [0,0,lightness];
  const sector=max===r?(g-b)/chroma:max===g?(b-r)/chroma+2:(r-g)/chroma+4;
  return [(sector+6)%6,chroma/(1-Math.abs(2*lightness-1)),lightness];
}

export function toHex(hue,saturation,lightness) {
  const chroma=(1-Math.abs(2*lightness-1))*saturation;
  const x=chroma*(1-Math.abs(hue%2-1));
  const offset=lightness-chroma/2;
  const channels=[[chroma,x,0],[x,chroma,0],[0,chroma,x],[0,x,chroma],[x,0,chroma],[chroma,0,x]][Math.floor(hue)];
  return '#'+channels.map(channel=>Math.round(255*(channel+offset)).toString(16).padStart(2,'0')).join('');
}

export function adjustAccent(accent,palette) {
  if(typeof accent==='string'&&hexColor.test(accent)) {
    if(accentPasses(accent,palette)) return accent.toLowerCase();
    const [hue,saturation,lightness]=toHsl(rgb(accent));
    const lightTheme=luminance(palette.page)>.5;
    const endpoint=lightTheme?0:1;
    for(let step=1;step<=100;step++) {
      const next=lightTheme?Math.max(0,lightness-step/100):Math.min(1,lightness+step/100);
      const adjusted=toHex(hue,saturation,next);
      if(accentPasses(adjusted,palette)) return adjusted;
      if(next===endpoint) break;
    }
  }
  return palette.accent;
}
