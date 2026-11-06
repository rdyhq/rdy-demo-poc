for(const button of document.querySelectorAll('[data-youtube]')) {
  const host=button.closest('.feature-video');
  const slot=host.querySelector('[data-player]');
  if(slot.clientWidth<200) continue;
  button.hidden=false;
  button.addEventListener('click',()=>{
    const id=button.dataset.youtube;
    if(!/^[\w-]{11}$/.test(id)||slot.clientWidth<200) return;
    const frame=document.createElement('iframe');
    frame.title=host.querySelector('h2').textContent;
    frame.referrerPolicy='origin';
    frame.allowFullscreen=true;
    frame.src='https://www.youtube-nocookie.com/embed/'+id+'?autoplay=0';
    slot.replaceChildren(frame);
    slot.classList.add('player-loaded');
    frame.tabIndex=0;
    frame.focus();
    button.hidden=true;
    host.querySelector('[data-player-status]').textContent='Player opened. Use the direct YouTube link if it does not play here.';
  },{once:true});
}
