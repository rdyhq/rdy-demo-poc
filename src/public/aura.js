(() => {
  const home=document.querySelector('[data-aura-home]');
  if(!home) return;
  const canvas=document.querySelector('.aura-field');
  const toggle=document.querySelector('[data-reduce-motion]');
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const pointer=matchMedia('(hover: hover) and (pointer: fine)');
  const storageKey='linbio-reduce-motion';
  let ctx, observer, width, height, ratio, palette, particles=[];
  let frame=0, previous=0, elapsed=0, visible=false, reduced=false;
  let appearance, stillDirty=true;
  const animated=()=>!reduced&&home.dataset.intensity!=='off';
  const fieldEnabled=()=>home.dataset.intensity!=='off'&&home.dataset.field!=='none';

  if(toggle) {
    try { toggle.checked=localStorage.getItem(storageKey)==='1'; } catch {}
    toggle.closest('label').hidden=false;
    toggle.addEventListener('change',()=>{
      try { localStorage.setItem(storageKey,toggle.checked?'1':'0'); } catch {}
      update();
    });
  }

  function stop() {
    if(frame) cancelAnimationFrame(frame);
    frame=0;
    previous=0;
  }

  function update() {
    const accent=home.dataset.accent;
    if(accent) document.documentElement.style.setProperty('--accent',accent);
    else document.documentElement.style.removeProperty('--accent');
    reduced=preference.matches||Boolean(toggle?.checked)||home.hasAttribute('data-preview-reduced')||
      location.hash==='#reduce-motion';
    home.toggleAttribute('data-aura-motion',animated());
    if(!animated()||home.dataset.canvasMode==='edit') {
      for(const card of home.querySelectorAll('[data-aura-tilt]')) resetTilt(card);
      for(const spark of home.querySelectorAll('.aura-spark')) spark.remove();
    }
    const next=[document.documentElement.dataset.theme,accent,home.dataset.field,home.dataset.intensity].join(':');
    if(appearance!==next) {
      appearance=next;
      const style=getComputedStyle(home);
      palette=[style.getPropertyValue('--accent').trim(),style.getPropertyValue('--glow').trim()];
      const bold=home.dataset.intensity==='bold';
      const drift=home.dataset.field==='drift';
      particles=Array.from({length:drift?(bold?14:8):bold?60:30},()=>({
        x:Math.random(), y:Math.random(), z:Math.random(), phase:Math.random()*Math.PI*2,
      }));
      stillDirty=true;
    }
    canvas.hidden=!fieldEnabled();
    if(!canvas.hidden&&!observer) {
      ctx=canvas.getContext('2d');
      if(ctx) {
        observer=new IntersectionObserver(([entry])=>{
          visible=entry.isIntersecting;
          sync();
        });
        observer.observe(canvas);
      }
    }
    sync();
  }

  function sync() {
    if(!ctx||!fieldEnabled()||!visible||document.hidden) {
      stop();
      return;
    }
    if(reduced) {
      if(frame) stillDirty=true;
      stop();
      if(stillDirty) {
        paint(0);
        stillDirty=false;
      }
    } else if(!frame) {
      frame=requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    if(!previous||now-previous>=1000/30-.01) {
      if(previous) elapsed+=Math.min(now-previous,50);
      previous=now;
      paint(elapsed);
    }
    frame=requestAnimationFrame(tick);
  }

  function paint(time) {
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    const w=canvas.clientWidth, h=canvas.clientHeight;
    if(!w||!h) return;
    if(width!==w||height!==h||ratio!==dpr) {
      width=w; height=h; ratio=dpr;
      canvas.width=Math.round(w*dpr);
      canvas.height=Math.round(h*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    ctx.clearRect(0,0,w,h);
    const bold=home.dataset.intensity==='bold';
    const t=time*(bold ? .0008 : .00036);
    const [accent,glow]=palette;
    if(home.dataset.field==='grid') {
      const horizon=h*.49, center=w*.5;
      ctx.globalAlpha=bold ? .35 : .2;
      ctx.strokeStyle=glow;
      ctx.beginPath();
      for(let i=-12;i<=12;i++) {
        ctx.moveTo(center+i*w*.017,horizon);
        ctx.lineTo(center+i*w*.18,h);
      }
      for(let i=0;i<14;i++) {
        const depth=((i+t)%14)/14;
        const y=horizon+(h-horizon)*depth**2;
        ctx.moveTo(0,y); ctx.lineTo(w,y);
      }
      ctx.stroke();
    } else {
      for(const [i,p] of particles.entries()) {
        const color=i%3?accent:glow;
        if(home.dataset.field==='drift') {
          const x=w*(p.x+.16*Math.cos(t*.25+p.phase));
          const y=h*(p.y+.16*Math.sin(t*.22+p.phase));
          const radius=Math.min(w,h)*(.14+p.z*.29);
          const gradient=ctx.createRadialGradient(x,y,0,x,y,radius);
          gradient.addColorStop(0,color);
          gradient.addColorStop(1,'transparent');
          ctx.globalAlpha=bold ? .24 : .11;
          ctx.fillStyle=gradient;
          ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
        } else {
          const embers=home.dataset.field==='embers';
          const x=embers?w*(p.x+.025*Math.sin(t+p.phase)):w*((p.x+t*(.014+p.z*.022))%1);
          const y=embers?h*(1-((p.y+t*(.045+p.z*.11))%1)):h*p.y;
          const r=.65+p.z*(bold?2:1.3);
          ctx.globalAlpha=(bold ? .78 : .49)*(.62+.38*Math.sin(t+p.phase));
          ctx.fillStyle=color;
          ctx.beginPath();
          ctx.arc(x,y,r,0,Math.PI*2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha=1;
  }

  const resetTilt=card=>{
    card.style.removeProperty('--aura-x');
    card.style.removeProperty('--aura-y');
    card.style.removeProperty('--aura-angle');
    card.removeAttribute('data-aura-tilt');
  };
  home.addEventListener('pointermove',event=>{
    if(!animated()||!pointer.matches||event.pointerType!=='mouse'||home.dataset.canvasMode==='edit') return;
    const card=event.target.closest('.home-card');
    if(!card) return;
    // Measure the layout box, so a transformed corner does not chase the pointer.
    const box=card.parentElement.matches('[data-canvas-body]')?card.parentElement:card;
    const rect=box.getBoundingClientRect();
    const x=Math.max(-1,Math.min(1,(event.clientX-rect.left)/rect.width*2-1));
    const y=Math.max(-1,Math.min(1,(event.clientY-rect.top)/rect.height*2-1));
    card.style.setProperty('--aura-x',(-y*4.2).toFixed(1)+'deg');
    card.style.setProperty('--aura-y',(x*4.2).toFixed(1)+'deg');
    card.style.setProperty('--aura-angle',Math.atan2(y,x)*180/Math.PI+90+'deg');
    card.toggleAttribute('data-aura-tilt',true);
  },{passive:true});
  home.addEventListener('pointerout',event=>{
    const card=event.target.closest('.home-card');
    if(card&&!card.contains(event.relatedTarget)) resetTilt(card);
  },{passive:true});
  home.addEventListener('aura-copy',event=>{
    if(!animated()) return;
    const button=event.target.closest('[data-copy]');
    if(!button) return;
    for(let i=0;i<8;i++) {
      const spark=document.createElement('span');
      spark.className='aura-spark';
      spark.setAttribute('aria-hidden','true');
      const angle=i*Math.PI/4;
      spark.style.setProperty('--spark-x',Math.cos(angle)*44+'px');
      spark.style.setProperty('--spark-y',Math.sin(angle)*30+'px');
      button.append(spark);
      spark.addEventListener('animationend',()=>spark.remove(),{once:true});
    }
  });

  const observedCounts=new WeakSet();
  const formatter=new Intl.NumberFormat('en-US');
  function observeViewers() {
    const count=home.querySelector('[data-viewer-count]');
    if(!count||observedCounts.has(count)) return;
    observedCounts.add(count);
    let prior=count.textContent;
    new MutationObserver(()=>{
      const number=Number(count.dataset.viewerCount);
      if(!Number.isSafeInteger(number)||number<0) return;
      const next=formatter.format(number);
      if(next===prior) return;
      const spoken=document.createElement('span');
      spoken.className='sr-only';
      spoken.textContent=next;
      const digits=document.createElement('span');
      digits.setAttribute('aria-hidden','true');
      for(const [i,digit] of [...next].entries()) {
        const cell=document.createElement('span');
        cell.textContent=digit;
        if(/\d/.test(digit)&&digit!==prior[prior.length-next.length+i]) cell.setAttribute('data-roll','');
        digits.append(cell);
      }
      count.replaceChildren(spoken,digits);
      prior=next;
    }).observe(count,{attributes:true,attributeFilter:['data-viewer-count']});
    if(count.hasAttribute('data-fixture-viewers')) {
      setTimeout(()=>{ count.dataset.viewerCount=count.dataset.fixtureViewers; },2600);
    }
  }

  if(home.hasAttribute('data-refresh-activity')) {
    const spotlight=home.querySelector('.spotlight-card');
    const copy=spotlight.querySelector('.spotlight-copy');
    const action=spotlight.querySelector('.card-action-layout > a');
    const fallback=spotlight.querySelector('[data-activity-fallback]');
    let lastChecked=Date.now(), pending=false;

    function replaceLead(source,actionLabel,surge,sweep) {
      home.toggleAttribute('data-live-surge',surge);
      const oldSweep=spotlight.querySelector('.aura-sweep');
      if(oldSweep&&!sweep) oldSweep.remove();
      if(sweep&&!oldSweep) spotlight.prepend(sweep.cloneNode(true));
      if(action.firstChild.nodeValue!==actionLabel) action.firstChild.nodeValue=actionLabel;
      const oldCount=copy.querySelector('[data-viewer-count]');
      const newCount=source.querySelector('[data-viewer-count]');
      if(oldCount&&newCount&&copy.querySelector('h2').textContent===source.querySelector('h2').textContent) {
        if(oldCount.dataset.viewerCount!==newCount.dataset.viewerCount) oldCount.dataset.viewerCount=newCount.dataset.viewerCount;
      } else if(![...copy.childNodes].every((node,index)=>node.isEqualNode(source.childNodes[index]))||
          copy.childNodes.length!==source.childNodes.length) {
        copy.replaceChildren(...Array.from(source.childNodes,node=>node.cloneNode(true)));
        observeViewers();
      }
      home.dispatchEvent(new Event('pack-cards'));
    }

    const showFallback=()=>replaceLead(fallback.content,fallback.dataset.action+' ',false,null);
    async function refreshActivity() {
      if(document.hidden||pending) return;
      if(Date.now()-lastChecked>65_000) showFallback();
      pending=true;
      try {
        const response=await fetch(location.pathname,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(7000)});
        if(response.status===404) {
          location.reload();
          return;
        }
        if(!response.ok) throw new Error();
        const fresh=new DOMParser().parseFromString(await response.text(),'text/html');
        const freshHome=fresh.querySelector('[data-refresh-activity]');
        const next=freshHome?.querySelector('.spotlight-card');
        const freshAction=next?.querySelector('.card-action-layout > a');
        if(!freshAction||freshAction.getAttribute('href')!==action.getAttribute('href')) {
          showFallback();
          return;
        }
        replaceLead(next.querySelector('.spotlight-copy'),freshAction.firstChild.nodeValue,
          freshHome.hasAttribute('data-live-surge'),next.querySelector('.aura-sweep'));
        lastChecked=Date.now();
      } catch {
        showFallback();
      } finally {
        pending=false;
      }
    }
    window.setInterval(refreshActivity,60_000);
    document.addEventListener('visibilitychange',()=>{
      if(Date.now()-lastChecked>=60_000) void refreshActivity();
    });
  }

  home.addEventListener('aura-update',update);
  preference.addEventListener('change',update);
  window.addEventListener('hashchange',update);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('resize',()=>{
    stillDirty=true;
    sync();
  },{passive:true});
  update();
  observeViewers();
  if(animated()&&!home.hasAttribute('data-edit-canvas')) {
    for(const [index,card] of [...home.querySelectorAll('.home-card')].entries()) {
      card.style.setProperty('--aura-delay',Math.min(index,8)*60+'ms');
      card.toggleAttribute('data-aura-enter',true);
      card.addEventListener('animationend',event=>{
        if(event.animationName==='aura-enter') card.removeAttribute('data-aura-enter');
      });
    }
  }
})();
