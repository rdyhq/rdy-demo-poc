// On a phone, the watch action opens the provider's app. The web link is the fallback.
export const isPhone=agent=>/Android|iPhone|iPad|iPod/.test(agent);

// Tries the app link. A page that is still in front after the wait means the app did not open.
export function handOff(link,page) {
  page.later(()=>{ if(!page.left()) page.go(link.web); },1500);
  page.go(link.app);
}

if(typeof document!=='undefined'&&isPhone(navigator.userAgent)) {
  let left=false;
  const leave=()=>{ left=true; };
  document.addEventListener('visibilitychange',()=>{ if(document.hidden) leave(); });
  addEventListener('pagehide',leave);
  addEventListener('blur',leave);
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[data-app-link]');
    if(!link||event.defaultPrevented||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return;
    event.preventDefault();
    left=false;
    handOff({web:link.href,app:link.dataset.appLink},
      {left:()=>left||document.hidden,go:url=>{ location.href=url; },later:(run,wait)=>setTimeout(run,wait)});
  });
}
