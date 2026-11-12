import { adjustAccent } from './contrast.js';
import { guardSurfaces, nearestTheme } from './palette.js';

// Match my art sets the whole look (RDY r-GXT5V). The return value restores the look from before the match.
export function applySkin(content,skin) {
  const before={theme:content.theme,aura:{...content.aura}};
  content.theme=skin.theme;
  for(const key of ['palette','accent','accentSource','font','shape','frame','field']) content.aura[key]=skin[key];
  return before;
}

export function restoreSkin(content,before) {
  content.theme=before.theme;
  content.aura={...before.aura};
}

// The theme control (RDY r-YAN6N). A theme leaves the art palette, and My art returns to it.
// The accent stays and moves only as far as the new surfaces need. The answer says whether it moved.
export function chooseTheme(content,value,palette) {
  if(value==='art') {
    if(!palette) return false;
    content.aura.palette={...palette};
    content.theme=nearestTheme(palette.base);
  } else {
    content.theme=value;
    content.aura.palette=null;
  }
  const requested=content.aura.accent;
  if(requested!==null) content.aura.accent=adjustAccent(requested,guardSurfaces(content.theme,content.aura.palette));
  return content.aura.accent!==requested;
}
