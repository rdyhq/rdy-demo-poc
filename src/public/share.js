for (const group of document.querySelectorAll('[data-share]')) {
  const field=group.querySelector('input[readonly]');
  const status=group.querySelector('[role=status]');
  const copy=group.querySelector('[data-copy]');
  const share=group.querySelector('[data-system-share]');
  copy.hidden=false;
  copy.addEventListener('click',async()=>{
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent='Link copied.';
    } catch {
      field.focus();
      field.select();
      status.textContent='Copy the selected address.';
    }
  });
  if(typeof navigator.share==='function') {
    share.hidden=false;
    share.addEventListener('click',async()=>{
      try { await navigator.share({url:field.value}); }
      catch(error) {
        if(error.name==='AbortError') return;
        field.focus();
        field.select();
        status.textContent='Sharing is unavailable. Copy the selected address.';
      }
    });
  }
}

for (const target of document.querySelectorAll('[data-fan-time]')) {
  try {
    const formatted=new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'});
    if (!formatted.resolvedOptions().timeZone) continue;
    target.textContent='Your time: '+formatted.format(new Date(target.dataset.fanTime));
    target.hidden=false;
  } catch { /* The server-rendered creator time stays visible. */ }
}
