import { adjustAccent } from './contrast.js';
import { guardSurfaces, nearestTheme } from './palette.js';

// The compare dialog shows each Aura setting by name.
export function auraSummary(aura) {
  return [
    ...(aura.palette?['Page colours: My art '+aura.palette.base]:[]),
    'Accent: '+aura.accentSource+(aura.accent?' '+aura.accent:''),
    'Font: '+aura.font,'Shape: '+aura.shape,'Frame: '+aura.frame,'Field: '+aura.field,'Intensity: '+aura.intensity,
    'Live surge: '+(aura.liveSurge?'on':'off'),
  ].join(' · ');
}

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

// The browser asks before a page with unsaved values unloads.
export function guardUnsaved(page,hasUnsaved) {
  page.addEventListener('beforeunload',event=>{
    if(!hasUnsaved()) return;
    event.preventDefault();
    // Some browsers ask only when the event also carries a return value.
    event.returnValue='';
  });
}
