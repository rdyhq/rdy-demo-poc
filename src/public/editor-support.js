// The compare dialog shows each Aura setting by name.
export function auraSummary(aura) {
  return [
    'Accent: '+aura.accentSource+(aura.accent?' '+aura.accent:''),
    'Font: '+aura.font,'Shape: '+aura.shape,'Frame: '+aura.frame,'Field: '+aura.field,'Intensity: '+aura.intensity,
    'Live surge: '+(aura.liveSurge?'on':'off'),
  ].join(' · ');
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
