const homeGrid=document.querySelector('.card-home');

if(homeGrid&&typeof ResizeObserver==='function') {
  const trackHeight=4;
  const observed=new Set();
  let frame;

  function packCards() {
    // Sparse grid placement preserves source order while using space under shorter cards.
    if(homeGrid.clientWidth<580) {
      delete homeGrid.dataset.packed;
      return;
    }
    const gutter=parseFloat(getComputedStyle(homeGrid).columnGap);
    const cards=Array.from(homeGrid.children).filter(card=>!card.classList.contains('canvas-dragging'));
    const rows=cards.map(card=>Math.ceil((card.offsetHeight+gutter)/trackHeight));
    cards.forEach((card,index)=>{
      const span=String(Math.max(1,rows[index]));
      if(card.style.getPropertyValue('--card-rows')!==span) card.style.setProperty('--card-rows',span);
    });
    homeGrid.dataset.packed='';
  }

  function schedulePacking() {
    if(frame!==undefined) return;
    frame=requestAnimationFrame(()=>{
      frame=undefined;
      packCards();
    });
  }

  const observer=new ResizeObserver(schedulePacking);
  observer.observe(homeGrid);
  function watchCards() {
    const children=new Set(homeGrid.children);
    for(const card of observed) if(!children.has(card)) {
      observer.unobserve(card);
      observed.delete(card);
    }
    for(const card of children) if(!observed.has(card)) {
      observer.observe(card);
      observed.add(card);
    }
    schedulePacking();
  }

  new MutationObserver(watchCards).observe(homeGrid,{childList:true});
  homeGrid.addEventListener('pack-cards',packCards);
  watchCards();
  packCards();
}
