import { accentPalettes, adjustAccent } from './contrast.js';
import { readArtPixels } from './art-pixels.js';
import { matchColours, suggestSkin } from './art-match.js';
import { artPalette, guardSurfaces } from './palette.js';
import { applySkin, auraSummary, chooseTheme, guardUnsaved, restoreSkin } from './editor-support.js';

const root = document.querySelector('#workspace');
const by = (id) => document.getElementById(id);
const form = by('home-form');
const clone = (value) => JSON.parse(JSON.stringify(value));
const fields = ['displayName','intro','game','streamUrl'];
const capacities = {sessions:7,updates:3,links:5};
const labels = {sessions:'Session',updates:'Update',links:'Link'};
const optionsFrom = id => Array.from(document.getElementById(id).options, option=>[option.value,option.textContent]);
const spanOptions = optionsFrom('dock-span');
const heightOptions = optionsFrom('dock-minHeight');
const minimumHeight = Number(heightOptions[1][0]);
const heightStep = Number(heightOptions[2][0])-minimumHeight;
const maximumHeight = Number(heightOptions.at(-1)[0]);
const canvasInstructions = 'Click a card to edit it. Drag a movable card to reorder it, or drag an edge or corner to resize.';
const movableSurface = '[data-movable-card] > .canvas-select';
const fixedControls = {
  'identity-alignment':['identity','alignment'],
  'identity-span':['identity','span'], 'spotlight-span':['spotlight','span'], 'dock-span':['dock','span'],
  'identity-minHeight':['identity','minHeight'], 'spotlight-minHeight':['spotlight','minHeight'], 'dock-minHeight':['dock','minHeight'],
  'avatar-size':['identity','avatarSize'], 'avatar-position':['identity','avatarPosition'],
  'cover-x':['identity','focalX'], 'cover-y':['identity','focalY'],
};
const blockPicker=by('block-picker');
const blockSearch=by('block-search');
const blockOptions=Array.from(blockPicker.querySelectorAll('[data-block]'));
const promoCategories=blockOptions.filter(button=>button.dataset.block==='promo').map(button=>button.dataset.category);
const fieldNames = {layout:'Card layout and supporting cards',scheduleRemoval:'Schedule removal notice',displayName:'Display name',intro:'Intro',game:'Current game',streamUrl:'Stream destination',theme:'Theme',aura:'Aura',avatarId:'Avatar',coverId:'Cover image'};
const layouts = {
  sessions:[['title','Session title','text',80],['local','Local date and time','datetime-local'],['zone','IANA time zone','text',90],['offset','UTC offset if the local time repeats','text',6]],
  updates:[['text','Update text','textarea',280]],
  links:[['label','Link label','text',32],['url','HTTPS address','url',2048]],
};
let csrf = root.dataset.csrf;
let saved = JSON.parse(root.dataset.content);
saved.scheduleRemoval??='unknown';
let content = clone(saved);
let revision = Number(root.dataset.revision);
let publication = root.dataset.publication || null;
let publishedRevision = publication ? Number(root.dataset.publishedRevision) : null;
let held = root.dataset.held === 'true';
let busy = false;
let uploading = 0;
let dirty = false;
// The Account link and a closed tab would drop unsaved values. Preview opens in its own window.
guardUnsaved(window,()=>dirty);
let conflicted = false;
let retry = null;
let other = null;
let needsSignIn = false;
let canvasTimer;
let canvasSubmission;
let canvasRequest;
let renderedEditKey;
let previewDevice='fit';
let previewScale=1;
let previewActualSize=false;
let canvasMode='edit';
let selectedCard=revision?'spotlight':'identity';
const canvas=by('editor-canvas');
const viewport=canvas.parentElement;
const actualSizeButton=by('preview-actual-size');
const deviceWidths={phone:390,tablet:768,desktop:1024};
const dockOutline=by('card-outline-supporting').querySelector('[data-edit-card=dock]');
let drag;
let matchingArt=false;
// The art palette that this draft had last, so My art stays a choice after the creator tries a theme.
let artChoice=null;
let beforeMatch=null;
let offlineOptionsKey;
const auraControls=['font','shape','frame','field','intensity'];
const auraPresets={
  Cozy:{theme:'Ember',font:'grotesk',shape:'soft',frame:'clean',field:'drift',intensity:'calm'},
  Retro:{theme:'Nebula',font:'pixel',shape:'square',frame:'pixel',field:'grid',intensity:'bold'},
  'Night Ops':{theme:'Tide',font:'mono',shape:'square',frame:'hud',field:'stars',intensity:'calm'},
};
const artIds=()=>[content.avatarId,content.coverId].filter(Boolean);
const auraPreview=by('aura-preview-motion');

function auraNotice(message) {
  const note=by('aura-note');
  note.textContent=message;
  note.hidden=!message;
}

function matchNotice(message) {
  const note=by('aura-match-note');
  note.textContent=message;
  note.hidden=!message;
}

// The editor lists each change of a match with its reason (RDY r-GXT5V).
function showMatch(skin) {
  const list=by('aura-match-changes');
  list.replaceChildren(...(skin?.reasons??[]).map(({control,value,reason})=>{
    const item=document.createElement('li'), name=document.createElement('strong');
    name.textContent=control+': '+value+'.';
    item.append(name,' '+reason);
    return item;
  }));
  list.hidden=!skin;
}

function setAccent(requested,source) {
  const accent=requested===null?null:adjustAccent(requested,guardSurfaces(content.theme,content.aura.palette));
  content.aura.accent=accent;
  content.aura.accentSource=source;
  auraNotice(accent!==requested?'Adjusted for readability':'');
  syncAuraFields();
}

function syncAuraFields() {
  const {aura,theme}=content;
  if(aura.palette) artChoice={...aura.palette};
  by('theme-art').hidden=!artChoice;
  if(artChoice) by('theme-art').querySelector('.swatch').style.setProperty('--swatch',artChoice.base);
  for(const radio of form.querySelectorAll('[name=theme]')) radio.checked=aura.palette?radio.value==='art':radio.value===theme;
  for(const key of auraControls) by('aura-'+key).value=aura[key];
  by('aura-liveSurge').checked=aura.liveSurge;
  by('aura-accent').value=aura.accent??(aura.palette?artPalette({...aura.palette,accent:null}).accent:accentPalettes[theme].accent);
  by('aura-match-undo').hidden=!beforeMatch;
  for(const button of form.querySelectorAll('[data-aura-swatch]')) {
    const {auraSwatch:swatch}=button.dataset;
    const pressed=swatch?aura.accentSource==='swatch'&&aura.accent===adjustAccent(swatch,guardSurfaces(theme,aura.palette)):aura.accentSource==='theme';
    button.setAttribute('aria-pressed',String(pressed));
  }
  for(const button of form.querySelectorAll('[data-aura-preset]')) {
    const {theme:expected,...values}=auraPresets[button.dataset.auraPreset];
    const pressed=!aura.palette&&theme===expected&&aura.accentSource==='theme'&&aura.liveSurge&&
      Object.entries(values).every(([key,value])=>aura[key]===value);
    button.setAttribute('aria-pressed',String(pressed));
  }
}

function syncOfflineFields() {
  const spotlight=content.layout.spotlight;
  const select=by('offlineLink');
  const links=new Map();
  for(const link of content.links) {
    try {
      const url=new URL(link.url);
      if(url.protocol==='https:'&&!url.username&&!url.password) links.set(url.href,link.label.trim()||url.hostname);
    } catch {}
  }
  const key=JSON.stringify([...links]);
  if(key!==offlineOptionsKey) {
    offlineOptionsKey=key;
    select.replaceChildren(new Option('Choose a link from the Channel Dock',''),
      ...Array.from(links,([url,label])=>new Option(label,url)));
  }
  select.value=links.has(spotlight.offlineLink)?spotlight.offlineLink:'';
  const lead=by('offlineLead');
  lead.value=[...lead.options].some(option=>option.value===spotlight.offlineLead)?spotlight.offlineLead:'next';
  by('offline-link-field').hidden=spotlight.offlineLead!=='link';
}

function syncAuraPreview(article=canvasArticle()) {
  if(!article) return;
  article.toggleAttribute('data-preview-reduced',auraPreview.checked);
  article.dispatchEvent(new Event('aura-update'));
}

for(const radio of form.querySelectorAll('[name=theme]')) radio.addEventListener('input',()=>{
  auraNotice(chooseTheme(content,radio.value,artChoice)?'Adjusted for readability':'');
  syncAuraFields();
});
for(const key of auraControls) by('aura-'+key).addEventListener('input',event=>{
  content.aura[key]=event.target.value;
  syncAuraFields();
});
by('aura-liveSurge').addEventListener('input',event=>{
  content.aura.liveSurge=event.target.checked;
  syncAuraFields();
});
for(const button of form.querySelectorAll('[data-aura-preset]')) button.addEventListener('click',()=>{
  const {theme,...values}=auraPresets[button.dataset.auraPreset];
  content.theme=theme;
  Object.assign(content.aura,values,{liveSurge:true,palette:null});
  setAccent(null,'theme');
  changed();
});
for(const button of form.querySelectorAll('[data-aura-swatch]')) button.addEventListener('click',()=>{
  const swatch=button.dataset.auraSwatch;
  setAccent(swatch||null,swatch?'swatch':'theme');
  changed();
});
by('aura-accent').addEventListener('change',event=>{
  setAccent(event.target.value,'custom');
  changed();
});
by('aura-match').addEventListener('click',async()=>{
  if(!artIds().length||matchingArt) return;
  const state=()=>JSON.stringify([content.theme,content.aura,artIds()]);
  const started=state();
  matchingArt=true;
  matchNotice('Reading your art…');
  updateControls();
  try {
    const pixels=await readArtPixels({avatarId:content.avatarId,coverId:content.coverId});
    // The creator changed the skin or the art while the images loaded. Their values stay.
    if(started!==state()) {
      matchNotice('');
      return;
    }
    const skin=suggestSkin(matchColours(pixels),pixels.banner?'banner':'avatar');
    if(!skin) {
      matchNotice('Your art has no colour to read. Choose a theme instead.');
      return;
    }
    beforeMatch=applySkin(content,skin);
    showMatch(skin);
    matchNotice(skin.palette?'Your Home now matches your art.':'Your art gave no readable palette, so this is the nearest theme.');
    auraNotice('');
    syncAuraFields();
    changed();
  } catch {
    matchNotice('Could not read the images. Try again or choose a theme.');
  } finally {
    matchingArt=false;
    updateControls();
  }
});
by('aura-match-undo').addEventListener('click',()=>{
  if(!beforeMatch) return;
  restoreSkin(content,beforeMatch);
  beforeMatch=null;
  showMatch(null);
  matchNotice('The look from before the match is back.');
  syncAuraFields();
  changed();
});
auraPreview.addEventListener('input',()=>syncAuraPreview());
by('offlineLead').addEventListener('input',event=>{
  content.layout.spotlight.offlineLead=event.target.value;
});
by('offlineLink').addEventListener('input',event=>{
  content.layout.spotlight.offlineLink=event.target.value||null;
});

function updateControls() {
  const blocked=busy||uploading>0;
  const writesBlocked=blocked||needsSignIn;
  const unresolvedPublication=retry&&retry.action!=='save';
  const unresolvedSave=retry?.action==='save'&&JSON.stringify(content)===JSON.stringify(retry.value.content);
  by('reconnect').hidden=!needsSignIn;
  by('reconnect').querySelector('button').disabled=blocked;
  by('save').disabled=writesBlocked||conflicted||unresolvedPublication||unresolvedSave;
  for(const button of root.querySelectorAll('[data-device], [data-canvas-mode], #preview-open')) button.disabled=writesBlocked;
  by('publish').disabled=writesBlocked||conflicted||dirty||revision===0||Boolean(retry);
  for(const input of form.querySelectorAll('input, textarea, select, button[data-remove-image], .editor-entry button')) {
    input.disabled=blocked||input.dataset.boundary==='true';
  }
  by('unpublish').disabled=writesBlocked||conflicted||Boolean(retry);
  by('unpublish').hidden=!publication;
  by('public-link').hidden=!publication||held;
  by('share-link').hidden=!publication||held;
  by('copy-home').hidden=!publication||held;
  by('availability').textContent=held?'Home held':publication?(revision===publishedRevision?'Published':'Unpublished changes'):'Private draft';
  by('hold-note').hidden=!held;
  by('revision-label').textContent='Draft revision '+revision;
  by('publish-help').textContent=retry?'Resolve the previous attempt first.':conflicted?'Compare the current draft first.':dirty||!revision?'Save changes before you publish.':'The saved revision is ready to publish.';
  for(const input of form.querySelectorAll('input[type=file]')) input.disabled=writesBlocked;
  for(const button of form.querySelectorAll('[data-aura-preset], [data-aura-swatch]')) button.disabled=blocked;
  const hasArt=artIds().length>0;
  by('aura-match').disabled=writesBlocked||matchingArt||!hasArt;
  by('aura-match-help').textContent=hasArt?'Take the page colours, the accent and the style from your avatar and cover.':'Add an avatar or cover to match your art.';
  by('aura-match-undo').disabled=blocked;
  by('retry').disabled=writesBlocked;
  for(const button of form.querySelectorAll('[data-add]')) {
    button.disabled=blocked||!canAddBlock(button.dataset.add);
  }
  const linkCount=supportingLinkCount();
  by('add-block').disabled=blocked;
  if(blockPicker.open) filterBlockPicker();
  by('supporting-budget').textContent=linkCount+' of 5 supporting links';
  root.querySelector('[data-edit-card=skin] small').textContent=content.aura.palette?'My art':content.theme;
}

function updatePreview() {
  for (const key of fields) content[key]=by(key).value;
  content.scheduleRemoval=by('scheduleRemoval').value;
  for(const [control,[card,field]] of Object.entries(fixedControls)) {
    const value=by(control).value;
    content.layout[card][field]=typeof content.layout[card][field]==='number'?Number(value):value;
  }
  by('spotlight-empty').hidden=Boolean(content.streamUrl.trim());
  by('dock-empty').hidden=content.links.length>0;
  syncOfflineFields();

}

function fitCanvas() {
  const available=Math.max(1,viewport.clientWidth);
  const width=deviceWidths[previewDevice]??available;
  const needsScaling=width>available;
  previewScale=needsScaling&&!previewActualSize?available/width:1;
  actualSizeButton.hidden=!needsScaling;
  actualSizeButton.setAttribute('aria-pressed',String(previewActualSize));
  const widthValue=width+'px', scaleValue=String(previewScale);
  if(canvas.style.getPropertyValue('--preview-width')!==widthValue) canvas.style.setProperty('--preview-width',widthValue);
  if(canvas.style.getPropertyValue('--preview-scale')!==scaleValue) canvas.style.setProperty('--preview-scale',scaleValue);
  const dimensions=by('preview-dimensions');
  const label=width+' px'+(previewScale<1?' · '+Math.round(previewScale*100)+'%':'');
  if(dimensions.textContent!==label) dimensions.textContent=label;
}

new ResizeObserver(fitCanvas).observe(viewport);
actualSizeButton.addEventListener('click',()=>{
  previewActualSize=!previewActualSize;
  viewport.scrollLeft=0;
  fitCanvas();
});

function changed() {
  updatePreview();
  dirty=JSON.stringify(content)!==JSON.stringify(saved);
  updateControls();
  const article=canvasArticle();
  if(article&&!drag) {
    article.closest('main').classList.toggle('phone-preview',previewDevice==='phone');
    syncEditLayout(article);
  }
  clearTimeout(canvasTimer);
  canvasTimer=setTimeout(refreshCanvas,400);
}

function canvasArticle() {
  return canvas.contentDocument?.querySelector('[data-edit-canvas]');
}

// The canvas keeps its document. The skin stylesheet, the blurred banner and the colour scheme are copied into it.
function syncSkin(article,fresh,next) {
  const doc=article.ownerDocument, skin='link[href^="/assets/skin/"]';
  const link=fresh.querySelector(skin);
  let current=doc.querySelector(skin);
  if(link&&current?.getAttribute('href')!==link.getAttribute('href')) {
    current?.remove();
    current=doc.importNode(link);
    // The field effect reads its colours from the page, so it looks again when the new colours arrive.
    current.addEventListener('load',()=>article.dispatchEvent(new Event('aura-update')));
    doc.head.append(current);
  } else if(!link) current?.remove();
  article.toggleAttribute('data-art-palette',next.hasAttribute('data-art-palette'));
  doc.querySelector('.art-backdrop')?.remove();
  const backdrop=fresh.querySelector('.art-backdrop');
  if(backdrop) doc.querySelector('.aura-field').before(doc.importNode(backdrop,true));
  doc.querySelector('meta[name=color-scheme]').content=fresh.querySelector('meta[name=color-scheme]').content;
}

function syncCanvasMode(article) {
  const editing=canvasMode==='edit';
  article.dataset.canvasMode=canvasMode;
  for(const body of article.querySelectorAll('[data-canvas-body]')) body.inert=editing;
  article.ownerDocument.querySelector('.creator-credit').hidden=editing;
  syncAuraPreview(article);
}

function editContentKey(value) {
  // Order and dimensions can be applied to the existing DOM. Other fields need the shared Home renderer.
  const {identity,spotlight,dock,supporting}=value.layout;
  const withoutDimensions=({size,span,minHeight,column,...card})=>card;
  return JSON.stringify({...value,layout:{
    identity:withoutDimensions(identity),spotlight:withoutDimensions(spotlight),dock:withoutDimensions(dock),
    supporting:supporting.map(withoutDimensions).sort((a,b)=>a.id.localeCompare(b.id)),
  }});
}

async function refreshCanvas() {
  if(needsSignIn||drag||canvasSubmission) return;
  const payload=JSON.stringify(content);
  const article=canvasArticle();
  if(!article) {
    canvasSubmission={editKey:editContentKey(content)};
    submitPreview(canvas.name,previewDevice,payload,'edit');
    return;
  }
  const key=editContentKey(content);
  if(key===renderedEditKey||canvasRequest?.key===key) return;
  const request={key};
  canvasRequest=request;
  try {
    const response=await fetch('/editor/preview',{method:'POST',body:new URLSearchParams({
      csrf,width:previewDevice,content:payload,embedded:'1',mode:'edit',
    })});
    const html=await response.text();
    if(canvasRequest!==request||drag||article!==canvasArticle()||key!==editContentKey(content)) return;
    if(response.status===401) {
      requireSignIn();
      return;
    }
    if(!response.ok) return;
    const fresh=new DOMParser().parseFromString(html,'text/html');
    const next=fresh.querySelector('[data-edit-canvas]');
    if(!next) return;
    patchEditCanvas(article,next);
    article.toggleAttribute('data-live-surge',next.hasAttribute('data-live-surge'));
    for(const name of ['accent','font','shape','frame','field','intensity']) article.dataset[name]=next.dataset[name];
    article.ownerDocument.documentElement.dataset.theme=fresh.documentElement.dataset.theme;
    syncSkin(article,fresh,next);
    article.ownerDocument.title=fresh.title;
    renderedEditKey=key;
    syncCanvasMode(article);
    syncEditLayout(article);
    syncCanvasSelection();
  } catch {
    // A failed preview update leaves the last valid canvas and the draft intact.
  } finally {
    if(canvasRequest===request) canvasRequest=null;
  }
}

function inputFor(type,id,value,limit,label) {
  const container=document.createElement('div');
  const caption=document.createElement('label');
  caption.htmlFor=id;
  caption.textContent=label;
  const input=document.createElement(type==='textarea'?'textarea':'input');
  if(type!=='textarea') input.type=type;
  input.id=id;
  input.value=value;
  if(limit) input.maxLength=limit;
  container.append(caption,input);
  return {container,input};
}

function entries() {
  for(const key of Object.keys(layouts)) {
    const container=by(key);
    container.replaceChildren();
    content[key].forEach((entry,index)=>{
      const group=document.createElement('fieldset');
      group.className='editor-entry';
      group.id=key+'.'+index;
      group.tabIndex=-1;
      const legend=document.createElement('legend');
      legend.textContent=labels[key]+' '+(index+1);
      group.append(legend);
      for(const [field,label,type,limit] of layouts[key]) {
        const part=inputFor(type,group.id+'.'+field,entry[field]??'',limit,label);
        part.input.addEventListener('input',()=>{
          entry[field]=part.input.value;
          if(key==='sessions'&&(field==='zone'||field==='local')) {
            entry.offset='';
            const offset=by(group.id+'.offset');
            if(offset) offset.value='';
          }
          changed();
        });
        group.append(part.container);
      }
      if(key==='links') {
        addMoveButtons(group,content.links,index,labels[key],(next,delta)=>{
          entries();
          changed();
          focusAfterMove(by(key+'.'+next),delta);
          by('card-announcement').textContent='Link moved to position '+(next+1)+'.';
        });
      }
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='secondary';
      remove.textContent='Remove '+labels[key].toLowerCase()+' '+(index+1);
      remove.addEventListener('click',()=>{
        content[key].splice(index,1);
        entries();
        changed();
        const add=form.querySelector('[data-add='+key+']');
        (add.disabled?by(key+'.'+Math.max(0,index-1)):add)?.focus();
      });
      group.append(remove);
      container.append(group);
    });
  }
}

function supportingLinkCount() {
  return content.links.length+content.layout.supporting.filter(card=>card.family==='promo').length;
}

function canAddBlock(key) {
  return key==='links'||key==='promo'?supportingLinkCount()<capacities.links:content[key].length<capacities[key];
}

function actionButton(label,onClick) {
  const button=document.createElement('button');
  button.type='button';
  button.className='secondary';
  button.textContent=label;
  button.addEventListener('click',onClick);
  return button;
}

function addMoveButtons(group,items,index,name,afterMove) {
  for(const [delta,direction] of [[-1,'up'],[1,'down']]) {
    const next=index+delta;
    const button=actionButton('Move '+direction,()=>{
      [items[index],items[next]]=[items[next],items[index]];
      afterMove(next,delta);
    });
    button.dataset.move=String(delta);
    button.dataset.boundary=String(next<0||next>=items.length);
    button.setAttribute('aria-label','Move '+name+' '+direction);
    group.append(button);
  }
}

function focusAfterMove(group,delta) {
  const sameDirection=group.querySelector('[data-move="'+delta+'"]:not(:disabled)');
  (sameDirection??group.querySelector('[data-move]:not(:disabled)')??group).focus();
}

function movableOrder(layout=content.layout) {
  const order=layout.supporting.map(card=>card.id);
  order.splice(layout.dockPosition,0,'dock');
  return order;
}

function canvasCardSettings(key) {
  return content.layout[key]??content.layout.supporting.find(card=>card.id===key);
}

function placeCanvasNodes(article,nodes,anchor=null) {
  for(const node of nodes.slice().reverse()) {
    if(node.parentElement!==article||node.nextElementSibling!==anchor) article.insertBefore(node,anchor);
    anchor=node;
  }
}

function formatCanvasTimes(article) {
  const formatter=new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  if(!formatter.resolvedOptions().timeZone) return;
  for(const target of article.querySelectorAll('[data-fan-time]')) {
    target.textContent='Your time: '+formatter.format(new Date(target.dataset.fanTime));
    target.hidden=false;
  }
}

function syncEditLayout(article) {
  const cards=Array.from(article.querySelectorAll(':scope > [data-canvas-card]'));
  for(const card of cards) {
    const settings=canvasCardSettings(card.dataset.canvasCard);
    if(settings) {
      card.dataset.span=settings.span;
      card.dataset.height=settings.minHeight;
      if(settings.column===undefined) delete card.dataset.column;
      else card.dataset.column=settings.column;
    }
  }
  const movable=Array.from(article.children).filter(card=>card.matches('.schedule-notice,[data-movable-card]'));
  if(movable.length) {
    const byKey=new Map(movable.map(card=>[card.dataset.canvasCard,card]));
    const order=movableOrder().map(key=>byKey.get(key)).filter(Boolean);
    const notice=byKey.get(undefined);
    if(notice) order.splice(content.layout.dockPosition===0&&byKey.has('dock')?1:0,0,notice);
    const anchor=movable.at(-1).nextElementSibling;
    for(const card of movable) if(!order.includes(card)) card.remove();
    placeCanvasNodes(article,order,anchor);
  }
  article.dispatchEvent(new Event('pack-cards'));
}

function patchEditCanvas(article,fresh) {
  formatCanvasTimes(fresh);
  const key=node=>node.dataset.canvasCard??'notice';
  const current=new Map(Array.from(article.children,node=>[key(node),node]));
  const nodes=Array.from(fresh.children,next=>{
    const previous=current.get(key(next));
    current.delete(key(next));
    if(!next.dataset.canvasCard) return previous?.isEqualNode(next)?previous:next;
    if(!previous) return next;
    const nextBody=next.querySelector('[data-canvas-body]');
    const previousBody=previous.querySelector('[data-canvas-body]');
    if(!previousBody.isEqualNode(nextBody)) previousBody.replaceChildren(...nextBody.childNodes);
    for(const control of previous.querySelectorAll(':scope > button')) {
      control.setAttribute('aria-label',next.querySelector('.'+control.classList[0]).getAttribute('aria-label'));
    }
    return previous;
  });
  const focused=article.ownerDocument.activeElement;
  for(const remaining of current.values()) remaining.remove();
  placeCanvasNodes(article,nodes);
  if(focused?.isConnected&&article.contains(focused)) focused.focus({preventScroll:true});
}

function moveCard(order,key) {
  delete canvasCardSettings(key).column;
  const cards=new Map(content.layout.supporting.map(card=>[card.id,card]));
  content.layout.dockPosition=order.indexOf('dock');
  content.layout.supporting=order.filter(id=>id!=='dock').map(id=>cards.get(id));
  supportingCards();
  changed();
  const name=key==='dock'?'Channel Dock':supportingName(cards.get(key));
  by('card-announcement').textContent=name+' moved to position '+(order.indexOf(key)+1)+' below Spotlight.';
}

function cardMoveButtons(group,key,name) {
  const order=movableOrder();
  addMoveButtons(group,order,order.indexOf(key),name,(_,delta)=>{
    moveCard(order,key);
    focusAfterMove(by(group.id),delta);
  });
}

function selectFor(id,label,options,value,onChange) {
  const container=document.createElement('div');
  const caption=document.createElement('label');
  caption.htmlFor=id;
  caption.textContent=label;
  const select=document.createElement('select');
  select.id=id;
  for(const [key,name] of options) select.add(new Option(name,key));
  select.value=value;
  select.addEventListener('change',()=>{onChange(select.value);changed();});
  container.append(caption,select);
  return container;
}

function supportingName(card) {
  return card.family==='schedule'?'Schedule':card.title.trim()||'Promo card';
}

function syncCanvasSelection(reveal=false) {
  if(canvasMode!=='edit') return;
  const doc=canvas.contentDocument;
  for(const card of doc?.querySelectorAll('[data-canvas-card]')??[]) {
    const selected=card.dataset.canvasCard===selectedCard;
    card.querySelector('.canvas-select').setAttribute('aria-pressed',String(selected));
    if(selected&&reveal) {
      const top=card.getBoundingClientRect().top;
      if(top<0||top>doc.documentElement.clientHeight-44) doc.scrollingElement.scrollTop+=top-8;
    }
  }
}

function selectInspector(key,scroll=false) {
  const card=content.layout.supporting.find(item=>item.id===key);
  const panel=card?'supporting':key;
  const inspector=root.querySelector('[data-inspector="'+panel+'"]');
  if(!inspector) return;
  if(selectedCard!==key) inspector.closest('.editor-inspector').scrollTop=0;
  selectedCard=key;
  for(const section of root.querySelectorAll('[data-inspector]')) section.hidden=section!==inspector;
  for(const entry of by('supporting').children) entry.hidden=entry.dataset.supportingCard!==key;
  for(const button of root.querySelectorAll('[data-edit-card]')) {
    button.setAttribute('aria-pressed',String(button.dataset.editCard===key));
  }
  syncCanvasSelection();
  if(card) by('supporting-title').textContent=supportingName(card);
  if(scroll&&matchMedia('(max-width: 720px)').matches) {
    inspector.closest('.editor-inspector').scrollIntoView({block:'nearest'});
  }
}

function renderSupportingOutline() {
  const cards=new Map(content.layout.supporting.map(card=>[card.id,card]));
  const rows=movableOrder().map(key=>{
    if(key==='dock') return dockOutline;
    const card=cards.get(key);
    const button=document.createElement('button');
    button.type='button';
    button.className='editor-outline-row';
    button.dataset.editCard=card.id;
    button.id='outline-'+card.id;
    const copy=document.createElement('span');
    const title=document.createElement('strong');
    const detail=document.createElement('small');
    title.textContent=supportingName(card);
    detail.textContent=card.hidden?'Hidden':card.family==='schedule'?'Upcoming streams':card.category+' · Promo card';
    copy.append(title,detail);
    button.append(copy);
    return button;
  });
  by('card-outline-supporting').replaceChildren(...rows);
  const retained=Array.from(root.querySelectorAll('[data-edit-card]')).some(button=>button.dataset.editCard===selectedCard);
  selectInspector(retained?selectedCard:'spotlight');
}

root.querySelector('.editor-outline').addEventListener('click',event=>{
  const button=event.target.closest('[data-edit-card]');
  if(button) {
    selectInspector(button.dataset.editCard,true);
    syncCanvasSelection(true);
  }
});

function supportingCards() {
  const list=by('supporting');
  const schedule=by('schedule-fields');
  list.replaceChildren();
  const cards=content.layout.supporting;
  by('dock-move').replaceChildren();
  cardMoveButtons(by('dock-move'),'dock','Channel Dock');
  cards.forEach((card,index)=>{
    const group=document.createElement('fieldset');
    group.className='editor-entry';
    group.dataset.supportingCard=card.id;
    group.id=card.family==='schedule'?'schedule-card':'promo-'+card.id;
    group.tabIndex=-1;
    const title=document.createElement('legend');
    title.textContent=supportingName(card)+(card.hidden?' · Hidden':'');
    group.append(title);
    const name=card.family==='schedule'?'Schedule':'Promo card '+(index+1);
    cardMoveButtons(group,card.id,name);
    const toggle=actionButton(card.hidden?'Restore card':'Hide card',()=>{
      card.hidden=!card.hidden;
      supportingCards();
      changed();
      by(group.id).querySelector('[data-visibility]').focus();
      by('card-announcement').textContent=name+(card.hidden?' hidden.':' restored.');
    });
    toggle.dataset.visibility='';
    group.append(toggle);
    const prefix=card.family==='schedule'?'schedule':group.id;
    group.append(selectFor(prefix+'-span','Preferred width',spanOptions,String(card.span),value=>{card.span=Number(value);}));
    group.append(selectFor(prefix+'-minHeight','Minimum height',heightOptions,String(card.minHeight),value=>{card.minHeight=Number(value);}));
    if(card.family==='schedule') {
      schedule.hidden=false;
      group.append(schedule);
    } else {
      group.append(selectFor(group.id+'-category','Category',promoCategories.map(value=>[value,value]),card.category,value=>{card.category=value;
        by('outline-'+card.id).querySelector('small').textContent=card.hidden?'Hidden':card.category+' · Promo card';
      }));
      for(const [key,label,type,limit] of [['title','Headline','text',80],['url','HTTPS address','url',2048],['description','Description','textarea',160]]) {
        const part=inputFor(type,group.id+'-'+key,card[key],limit,label);
        part.input.addEventListener('input',()=>{
          card[key]=part.input.value;
          if(key==='title') {
            title.textContent=supportingName(card)+(card.hidden?' · Hidden':'');
            by('outline-'+card.id).querySelector('strong').textContent=supportingName(card);
            if(selectedCard===card.id) by('supporting-title').textContent=supportingName(card);
          }
          changed();
        });
        group.append(part.container);
      }
      group.append(actionButton('Remove Promo card',()=>{
        if(index<content.layout.dockPosition) content.layout.dockPosition--;
        cards.splice(index,1);
        supportingCards();
        changed();
        by('add-block').focus();
      }));
    }
    list.append(group);
  });
  renderSupportingOutline();
}

function addPromo(category,url='') {
  const card={id:crypto.randomUUID(),family:'promo',size:'compact',span:12,minHeight:0,hidden:false,category,title:'',url,description:''};
  content.layout.supporting.push(card);
  supportingCards();
  selectInspector(card.id,true);
  changed();
  by('promo-'+card.id+'-title').focus();
}

function filterBlockPicker() {
  const query=blockSearch.value.trim().toLowerCase();
  const linkInput=/^https?:/i.test(query);
  let url;
  if(linkInput) {
    try {
      const parsed=new URL(blockSearch.value.trim());
      if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password) url=parsed;
    } catch {}
  }
  const status=by('block-picker-status');
  let matching=0;
  let available=0;
  for(const button of blockOptions) {
    const key=button.dataset.block;
    const matches=linkInput?key==='links'||key==='promo':button.textContent.toLowerCase().includes(query);
    button.hidden=!matches;
    button.disabled=busy||uploading>0||!canAddBlock(key)||(linkInput&&!url);
    if(matches) {
      matching++;
      if(!button.disabled) available++;
    }
  }
  let message='';
  if(linkInput&&!url) message='Enter a complete HTTPS address.';
  else if(!matching) message='No blocks match that search.';
  else if(!available) message=linkInput?'Your Home has reached its supporting link limit.':'These blocks have reached their limits.';
  else if(linkInput) message='Choose where to use this link.';
  status.hidden=!message;
  status.textContent=message;
  return url;
}

by('add-block').addEventListener('click',()=>{
  blockSearch.value='';
  filterBlockPicker();
  blockPicker.showModal();
});
blockSearch.addEventListener('input',filterBlockPicker);
for(const button of blockOptions) button.addEventListener('click',()=>{
  const url=filterBlockPicker();
  if(button.disabled||button.hidden) return;
  const key=button.dataset.block;
  blockPicker.close();
  if(key==='promo') {
    addPromo(button.dataset.category,url?.href);
    return;
  }
  const schedule=key==='sessions'?content.layout.supporting.find(card=>card.family==='schedule'):null;
  if(schedule?.hidden) {
    schedule.hidden=false;
    supportingCards();
  }
  selectInspector(schedule?.id??(key==='links'?'dock':'updates'),true);
  appendEntry(key,url);
});

function loadValues(values) {
  content=clone({...values,scheduleRemoval:values.scheduleRemoval??'unknown'});
  by('scheduleRemoval').value=content.scheduleRemoval??'unknown';
  for (const key of fields) by(key).value=content[key];
  syncAuraFields();
  auraNotice('');
  for (const key of ['avatarId','coverId']) {
    const status=by(key+'-state');
    if(status) status.textContent=content[key]?'Image ready.':'No image selected.';
  }
  for(const [control,[card,field]] of Object.entries(fixedControls)) by(control).value=String(content.layout[card][field]);
  supportingCards();
  entries();
  changed();
}

function show(message,error=false) {
  const el=by('editor-status');
  el.hidden=!message;
  el.textContent=message;
  el.classList.toggle('error',error);
}

function requireSignIn() {
  needsSignIn=true;
  updateControls();
  show('Your session expired. Your changes are still here.',true);
}

function clearErrors() {
  const el=by('errors');
  el.hidden=true;
  el.querySelector('ul').replaceChildren();
  for(const field of form.querySelectorAll('[aria-invalid]')) {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  }
}

function errors(details) {
  const box=by('errors');
  const list=box.querySelector('ul');
  for (const [key,message] of Object.entries(details??{})) {
    const item=document.createElement('li'), field=by(key);
    item.id='error-'+key;
    if(field) {
      field.setAttribute('aria-invalid','true');
      field.setAttribute('aria-describedby',item.id);
      const link=document.createElement('a');
      link.href='#'+key;
      link.textContent=message;
      link.addEventListener('click',event=>{
        event.preventDefault();
        const card=field.closest('[data-supporting-card]');
        const panel=field.closest('[data-inspector]');
        if(panel) selectInspector(card?.dataset.supportingCard??panel.dataset.inspector,true);
        const disclosure=field.closest('details');
        if(disclosure) disclosure.open=true;
        field.focus();
      });
      item.append(link);
    } else item.textContent=message;
    list.append(item);
  }
  if(list.childElementCount) {
    box.hidden=false;
    box.focus();
  }
}

async function request(path,options={}) {
  const response=await fetch(path,{...options,signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({}));
  if (!response.ok) {
    const error=new Error(data.message||'LINB could not complete this request.');
    error.status=response.status;
    error.fields=data.fields;
    error.requestId=data.requestId;
    throw error;
  }
  return data;
}

function refreshBadge(fresh) {
  publication=fresh.publication_id;
  publishedRevision=fresh.published_revision;
  held=fresh.held;
}

async function mutate(action,value) {
  if (busy) return;
  clearErrors();
  busy=true;
  by('retry').hidden=true;
  updateControls();
  show(action==='save'?'Saving draft…':action==='publish'?'Publication in progress…':'Unpublish in progress…');
  try {
    const result=await request('/api/editor/'+action,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(value)});
    retry=null;
    try {
      const fresh=await request('/api/editor');
      refreshBadge(fresh);
      if(action==='save') {
        if(fresh.draft_revision!==result.revision) {
          conflicted=true;
          other=fresh;
          by('compare').hidden=false;
          show('The earlier save succeeded. A newer draft exists. Compare before continuing.',true);
          return;
        }
        const changedSinceSubmit=JSON.stringify(content)!==JSON.stringify(value.content);
        revision=result.revision;
        saved=clone(fresh.content);
        if(!changedSinceSubmit) loadValues(saved);
        else changed();
      }
      const resultText=action==='save'?'Draft saved. Public home unchanged.':
        action==='publish'?(held?'Revision published. The home remains held.':publication===result.publicationId?'Publication confirmed.':'Earlier publication confirmed. The current home has changed.'):
        publication?'Earlier unpublish confirmed. A later publication is current.':'Home unavailable.';
      show(resultText);
    } catch {
      // The mutation returned a receipt. Retrying the original attempt also rechecks the current state.
      retry={action,value};
      by('retry').hidden=false;
      show('LINB recorded the attempt but could not load the current state. Retry the original attempt to refresh.',true);
    }
  } catch (error) {
    if (error.status===401) {
      requireSignIn();
    } else if (error.status===409) {
      retry=null;
      conflicted=true;
      by('compare').hidden=false;
      show(error.message,true);
    } else if (error.status===422) {
      retry=null;
      errors(error.fields);
      show(error.message,true);
    } else {
      retry={action,value};
      by('retry').hidden=false;
      const explanation=action==='publish'?'Publication could not be confirmed.':'The attempt could not be confirmed.';
      show(explanation+' Your values remain here.'+(error.requestId?' Request ID: '+error.requestId:''),true);
    }
  } finally {
    busy=false;
    updateControls();
  }
}

function newMutation(action) {
  updatePreview();
  if(retry) {
    if(retry.action!=='save'||action!=='save') return;
    if(JSON.stringify(content)===JSON.stringify(retry.value.content)) return mutate('save',retry.value);
  }
  const value={operationId:crypto.randomUUID()};
  if(action!=='unpublish') value.revision=revision;
  if(action!=='save') value.publicationId=publication;
  if(action==='save') value.content=clone(content);
  return mutate(action,value);
}

form.addEventListener('input',changed);
form.addEventListener('submit',event=>{
  event.preventDefault();
  void newMutation('save');
});
by('publish').addEventListener('click',()=>{
  if(dirty||conflicted||retry) return;
  const dialog=by('publish-dialog');
  by('publish-confirmation').textContent='Publish saved revision '+revision+'? '+(held?'Your Home will remain held.':'Fans will see this version at your current Home link.');
  dialog.returnValue='';
  dialog.showModal();
});
by('publish-dialog').addEventListener('close',event=>{
  if(event.target.returnValue==='publish'&&!dirty&&!conflicted) void newMutation('publish');
});
by('copy-home').addEventListener('click',async()=>{
  try {
    await navigator.clipboard.writeText(by('public-link').href);
    show('Public link copied.');
  } catch {
    show('Copy from the Open home link.');
    by('public-link').focus();
  }
});
by('unpublish').addEventListener('click',()=>{
  const dialog=by('unpublish-dialog');
  dialog.returnValue='';
  dialog.showModal();
});
by('unpublish-dialog').addEventListener('close',event=>{
  if(event.target.returnValue==='unpublish') void newMutation('unpublish');
});
by('retry').addEventListener('click',()=>{if(retry) void mutate(retry.action,retry.value);});
by('reconnect').querySelector('button').addEventListener('click',async()=>{
  try {
    const fresh=await request('/api/editor');
    if(fresh.id!==root.dataset.home) {
      show('Sign in with the mailbox for this home. Your changes are still here.',true);
      return;
    }
    csrf=fresh.csrf;
    needsSignIn=false;
    refreshBadge(fresh);
    if(fresh.draft_revision!==revision) {
      conflicted=true;
      by('compare').hidden=false;
    }
    changed();
    show('Editor reconnected. Review your changes before continuing.');
  } catch {show('Sign in again, then reconnect this editor.',true);}
});
function summarize(key,value) {
  if(key==='layout') {
    const {identity,spotlight,dock,supporting}=value;
    const dimensions=card=>[card.span+' / 12 columns',card.column?'Starts at column '+card.column:'Automatic placement',
      card.minHeight?card.minHeight+' px minimum':'Fit content'];
    const movable=supporting.map(card=>[
      card.family==='schedule'?'Schedule':card.title||'Promo card',
      card.category,card.url,card.description,...dimensions(card),card.hidden?'Hidden':'Visible',
    ].filter(Boolean).join(' · '));
    movable.splice(value.dockPosition,0,['Channel Dock',...dimensions(dock)].join(' · '));
    return [
      'Identity: '+[...dimensions(identity),identity.alignment,identity.avatarSize,identity.avatarPosition,identity.focalX+' / '+identity.focalY].join(' · '),
      'Spotlight: '+dimensions(spotlight).join(' · '),
      ...movable.map((card,index)=>(index+1)+'. '+card),
    ].join('\n');
  }
  if(key==='avatarId'||key==='coverId') return value?'An image is selected':'No image selected';
  if(key==='aura') return auraSummary(value);
  if(!Array.isArray(value)) return value||'Not set';
  if(!value.length) return 'None';
  return value.map((entry,index)=>{
    const details=layouts[key].map(([field])=>entry[field]).filter(Boolean).join(' · ');
    return labels[key]+' '+(index+1)+': '+details;
  }).join('\n');
}

by('compare').addEventListener('click',async()=>{
  try {
    other=await request('/api/editor');
    const comparison=by('comparison');
    comparison.replaceChildren();
    for(const key of [...Object.keys(fieldNames),...Object.keys(layouts)]) {
      if(JSON.stringify(content[key])===JSON.stringify(other.content[key])) continue;
      const group=document.createElement('fieldset');
      const title=document.createElement('legend');
      title.textContent=fieldNames[key]??{sessions:'Schedule',updates:'Updates',links:'Key links'}[key];
      const pair=document.createElement('div');
      pair.className='comparison-pair';
      for(const [label,value] of [['Your values',content[key]],['Current saved values',other.content[key]]]) {
        const cell=document.createElement('div');
        const heading=document.createElement('strong');
        heading.textContent=label;
        const description=document.createElement('p');
        description.textContent=summarize(key,value);
        cell.append(heading,description);
        pair.append(cell);
      }
      const choice=document.createElement('label');
      choice.className='check';
      const keep=document.createElement('input');
      keep.type='checkbox';
      keep.name=key;
      keep.checked=JSON.stringify(content[key])!==JSON.stringify(saved[key]);
      choice.append(keep,' Keep my values for '+title.textContent.toLowerCase());
      group.append(title,pair,choice);
      comparison.append(group);
    }
    if(!comparison.childElementCount) comparison.textContent='Your values match the current saved draft.';
    const dialog=by('compare-dialog');
    dialog.returnValue='';
    dialog.showModal();
  } catch(error) {show(error.message,true);}
});
by('compare-dialog').addEventListener('close',event=>{
  if(event.target.returnValue!=='reapply'||!other) return;
  const merged=clone(other.content);
  for(const selection of by('comparison').querySelectorAll('input:checked')) {
    merged[selection.name]=content[selection.name];
  }
  revision=other.draft_revision;
  refreshBadge(other);
  saved=clone(other.content);
  conflicted=false;
  retry=null;
  by('compare').hidden=true;
  by('retry').hidden=true;
  loadValues(merged);
  show('Comparison applied to the editor. Save your changes against the current revision.');
});
function submitPreview(target,width,payload,mode) {
  const preview=document.createElement('form');
  preview.method='post';
  preview.action='/editor/preview'+(!mode&&auraPreview.checked?'#reduce-motion':'');
  preview.target=target;
  for(const [name,value] of Object.entries({csrf,width,content:payload,embedded:mode?'1':'0',mode:mode??'visitor'})) {
    const input=document.createElement('input');
    input.type='hidden';input.name=name;input.value=value;
    preview.append(input);
  }
  document.body.append(preview);
  preview.submit();
  preview.remove();
}

canvas.addEventListener('load',()=>{
  cancelAnimationFrame(drag?.frame);
  drag=null;
  const submission=canvasSubmission;
  canvasSubmission=null;
  const doc=canvas.contentDocument;
  if(!doc?.scrollingElement||!submission) return;
  const article=doc.querySelector('[data-edit-canvas]');
  if(!article) return;
  renderedEditKey=submission.editKey;
  formatCanvasTimes(article);
  installCanvasControls(article);
  syncCanvasMode(article);
  syncCanvasSelection();
  changed();
});

function installCanvasControls(article) {
  const doc=article.ownerDocument;
  let suppressPointerClick=false;
  let touchCandidate;

  function commitDimensions(card,span,minHeight,column) {
    const key=card.dataset.canvasCard;
    const settings=canvasCardSettings(key);
    Object.assign(settings,{span,minHeight});
    if(column===undefined) delete settings.column;
    else settings.column=column;
    const prefix=['identity','spotlight','dock'].includes(key)?key:
      settings.family==='schedule'?'schedule':'promo-'+key;
    by(prefix+'-span').value=span;
    by(prefix+'-minHeight').value=minHeight;
    changed();
    const label=card.querySelector('.canvas-select').getAttribute('aria-label').slice('Edit '.length);
    by('card-announcement').textContent=label+' set to '+span+' of 12 columns and '+
      (minHeight?minHeight+' pixels minimum height':'fit content height')+'.';
  }

  article.addEventListener('click',event=>{
    const control=event.target.closest('.canvas-select,[data-resize-edge]');
    if(!control) return;
    if(suppressPointerClick&&event.detail>0) return;
    const card=control.closest('[data-canvas-card]');
    const key=card.dataset.canvasCard;
    selectInspector(key,true);
  });

  function prepareGesture(handle,x,y,pointer) {
    if(canvasMode!=='edit'||busy||uploading||needsSignIn||drag) return false;
    const card=handle.closest('[data-canvas-card]');
    const settings=canvasCardSettings(card.dataset.canvasCard);
    if(!settings) return false;
    const resize=handle.dataset.resizeEdge;
    const cards=Array.from(article.querySelectorAll(':scope > [data-movable-card]'));
    if(!resize&&cards.length<2) return false;
    const rect=card.getBoundingClientRect();
    drag={
      handle,card,cards,resize,pointer,startY:y,startX:x,y,x,
      initialSpan:settings.span,initialHeight:settings.minHeight,initialColumn:settings.column,
      offsetY:y-rect.top,offsetX:x-rect.left,index:cards.indexOf(card),
      order:movableOrder(),
      active:false,
    };
    return true;
  }

  article.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0) return;
    suppressPointerClick=false;
    const handle=event.target.closest('[data-resize-edge],'+movableSurface);
    if(!handle||event.pointerType==='touch'&&!handle.dataset.resizeEdge) return;
    if(prepareGesture(handle,event.clientX,event.clientY,event.pointerId)) handle.setPointerCapture(event.pointerId);
  });

  function animatePositions(positions) {
    article.dispatchEvent(new Event('pack-cards'));
    const reduceMotion=doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(const [element,before] of positions) {
      element.getAnimations().forEach(animation=>animation.cancel());
      const after=element.getBoundingClientRect();
      const dx=before.left-after.left, dy=before.top-after.top;
      if(!reduceMotion&&(dx||dy)) {
        element.animate([{transform:'translate('+dx+'px,'+dy+'px)'},{transform:'none'}],{duration:160,easing:'ease-out'});
      }
    }
  }

  function positionsOf(elements) {
    return elements.map(element=>[element,element.getBoundingClientRect()]);
  }

  function startGesture(current) {
    current.active=true;
    const {card,cards,resize,index}=current;
    selectInspector(card.dataset.canvasCard);
    doc.documentElement.classList.add(resize?'canvas-sizing':'canvas-reordering');
    if(resize) {
      const bounds=card.getBoundingClientRect();
      const gap=parseFloat(doc.defaultView.getComputedStyle(article).columnGap);
      current.track=(article.clientWidth+gap)/12;
      current.startSpan=Math.round((bounds.width+gap)/current.track);
      current.startColumn=1+Math.round((bounds.left-article.getBoundingClientRect().left)/current.track);
      current.minimumSpan=Number(doc.defaultView.getComputedStyle(card).getPropertyValue('--minimum-span'));
      current.startHeight=bounds.height;
      card.dataset.height='0';
      current.naturalHeight=card.getBoundingClientRect().height;
      card.dataset.height=current.initialHeight;
      return;
    }
    for(const item of cards) item.getAnimations().forEach(animation=>animation.cancel());
    const rect=card.getBoundingClientRect();
    current.peers=cards.filter(item=>item!==card);
    const scroll=doc.scrollingElement.scrollTop;
    current.origin={left:rect.left,right:rect.right,top:rect.top+scroll,bottom:rect.bottom+scroll};
    current.targets=current.peers.map(item=>{
      const bounds=item.getBoundingClientRect();
      return {left:bounds.left,right:bounds.right,top:bounds.top+scroll,bottom:bounds.bottom+scroll};
    });
    current.packed=article.hasAttribute('data-packed');
    current.slot=index;
    const placeholder=doc.createElement('div');
    placeholder.className='canvas-placeholder';
    placeholder.dataset.span=card.dataset.span;
    if(card.dataset.column) placeholder.dataset.column=card.dataset.column;
    placeholder.setAttribute('aria-hidden','true');
    placeholder.style.height=rect.height+'px';
    article.insertBefore(placeholder,card);
    current.placeholder=placeholder;
    current.height=rect.height;
    card.style.width=rect.width+'px';
    card.classList.add('canvas-dragging');
    article.dispatchEvent(new Event('pack-cards'));
  }

  function dropSlot(current,centerY) {
    const {targets,packed,x,y,startX,startY,origin,index}=current;
    if(!packed) {
      const next=targets.findIndex(target=>centerY<(target.top+target.bottom)/2);
      return next<0?targets.length:next;
    }
    const pointerY=y+doc.scrollingElement.scrollTop;
    if(x>=origin.left&&x<=origin.right&&pointerY>=origin.top&&pointerY<=origin.bottom) return index;
    let nearest=0;
    let minimum=Infinity;
    targets.forEach((target,index)=>{
      const dx=Math.max(target.left-x,0,x-target.right);
      const dy=Math.max(target.top-pointerY,0,pointerY-target.bottom);
      const distance=dx*dx+dy*dy;
      if(distance<minimum) {
        minimum=distance;
        nearest=index;
      }
    });
    const target=targets[nearest];
    const sideways=target.right-target.left<article.clientWidth*.75&&Math.abs(x-startX)>Math.abs(y-startY);
    const after=sideways?x>=(target.left+target.right)/2:pointerY>=(target.top+target.bottom)/2;
    return nearest+Number(after);
  }

  function drawDrag(current) {
    const {card,peers,placeholder,offsetY,offsetX,height,x,y}=current;
    const origin=article.getBoundingClientRect();
    card.style.left=(x-offsetX-origin.left)+'px';
    card.style.top=(y-offsetY-origin.top)+'px';
    const centerY=y-offsetY+height/2+doc.scrollingElement.scrollTop;
    const slot=dropSlot(current,centerY);
    if(slot===current.slot) return;
    const before=positionsOf(peers);
    if(slot===current.index&&card.dataset.column) placeholder.dataset.column=card.dataset.column;
    else delete placeholder.dataset.column;
    article.insertBefore(placeholder,peers[slot]??peers.at(-1).nextElementSibling);
    current.slot=slot;
    animatePositions(before);
  }

  function scrollDrag() {
    const {y}=drag;
    const height=doc.documentElement.clientHeight;
    if(y>=0&&y<=height) {
      const step=y<45?-Math.ceil((45-y)/3):Math.ceil(Math.max(0,y-height+45)/3);
      if(step) {
        doc.scrollingElement.scrollTop+=step;
        drawDrag(drag);
      }
    }
    drag.frame=requestAnimationFrame(scrollDrag);
  }

  function resizeCard(current,deltaX,deltaY) {
    const {card,resize,startSpan,startColumn,minimumSpan,track,startHeight,naturalHeight,initialHeight,initialSpan,initialColumn}=current;
    let span=initialSpan;
    let minHeight=initialHeight;
    let column=initialColumn;
    if(resize==='left'||resize.includes('right')) {
      const fromLeft=resize==='left';
      const outward=fromLeft?-deltaX:deltaX;
      const maximumSpan=fromLeft?startColumn+startSpan-1:13-startColumn;
      const nextSpan=Math.max(minimumSpan,Math.min(maximumSpan,startSpan+Math.round(outward/track)));
      if(nextSpan!==startSpan) {
        span=nextSpan;
        column=span===12?undefined:startColumn+(fromLeft?startSpan-span:0);
      }
    }
    if(resize==='top'||resize.includes('bottom')) {
      const outward=resize==='top'?-deltaY:deltaY;
      const desired=startHeight+outward;
      if(Math.abs(outward)>=8) {
        const snapped=minimumHeight+Math.round((desired-minimumHeight)/heightStep)*heightStep;
        const candidate=Math.max(minimumHeight,Math.min(maximumHeight,snapped));
        minHeight=candidate>naturalHeight?candidate:0;
      }
    }
    const columnAttribute=column===undefined?undefined:String(column);
    if(span===Number(card.dataset.span)&&minHeight===Number(card.dataset.height)&&columnAttribute===card.dataset.column) return;
    const before=positionsOf(Array.from(article.children).filter(item=>item!==card));
    card.dataset.span=span;
    card.dataset.height=minHeight;
    if(column===undefined) delete card.dataset.column;
    else card.dataset.column=column;
    animatePositions(before);
  }

  function moveGesture(x,y) {
    drag.x=x;
    drag.y=y;
    const delta=drag.y-drag.startY;
    if(!drag.active) {
      if(Math.abs(delta)<6&&Math.abs(drag.x-drag.startX)<6) return;
      startGesture(drag);
      if(!drag.resize) drag.frame=requestAnimationFrame(scrollDrag);
    }
    if(drag.resize) resizeCard(drag,drag.x-drag.startX,delta);
    else drawDrag(drag);
  }

  article.addEventListener('pointermove',event=>{
    if(event.pointerId===drag?.pointer) moveGesture(event.clientX,event.clientY);
  });

  // A touch swipe scrolls normally. Holding before moving reserves the gesture for reorder.
  article.addEventListener('touchstart',event=>{
    if(event.touches.length!==1) {
      if(touchCandidate?.active) finishGesture(false);
      touchCandidate=undefined;
      return;
    }
    const handle=event.target.closest(movableSurface);
    if(!handle) return;
    const touch=event.touches[0];
    touchCandidate={handle,id:touch.identifier,x:touch.clientX,y:touch.clientY,at:event.timeStamp};
  },{passive:true});
  article.addEventListener('touchmove',event=>{
    if(!touchCandidate) return;
    const {handle,id,x,y,at,active}=touchCandidate;
    const touch=Array.from(event.touches).find(item=>item.identifier===id);
    if(!touch||!event.cancelable) return;
    if(!active) {
      if(Math.hypot(touch.clientX-x,touch.clientY-y)<6) return;
      if(event.timeStamp-at<300||!prepareGesture(handle,x,y)) {
        touchCandidate=undefined;
        return;
      }
      touchCandidate.active=true;
    }
    event.preventDefault();
    moveGesture(touch.clientX,touch.clientY);
  },{passive:false});
  for(const type of ['touchend','touchcancel']) article.addEventListener(type,event=>{
    if(!touchCandidate||!Array.from(event.changedTouches).some(touch=>touch.identifier===touchCandidate.id)) return;
    if(touchCandidate.active&&drag) {
      if(event.cancelable) event.preventDefault();
      finishGesture(type==='touchend');
    }
    touchCandidate=undefined;
  },{passive:false});

  function finishGesture(commit) {
    const current=drag;
    drag=null;
    const {card,cards,handle,pointer,slot,index,resize,active,x,y,initialSpan,initialHeight,initialColumn,placeholder}=current;
    if(pointer===undefined) touchCandidate=undefined;
    cancelAnimationFrame(current.frame);
    if(pointer!==undefined&&handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    if(!active) return;
    suppressPointerClick=true;
    doc.documentElement.classList.remove('canvas-reordering','canvas-sizing');
    const bounds=canvas.getBoundingClientRect();
    const inside=document.elementFromPoint(bounds.left+(canvas.clientLeft+x)*previewScale,
      bounds.top+(canvas.clientTop+y)*previewScale)===canvas;
    const key=card.dataset.canvasCard;
    const canCommit=commit&&(resize||inside)&&!busy&&!uploading&&!needsSignIn&&canvasCardSettings(key);
    if(resize) {
      const span=Number(card.dataset.span);
      const minHeight=Number(card.dataset.height);
      const column=card.dataset.column===undefined?undefined:Number(card.dataset.column);
      if(canCommit&&(span!==initialSpan||minHeight!==initialHeight||column!==initialColumn)) commitDimensions(card,span,minHeight,column);
      else changed();
    } else {
      const before=positionsOf(cards);
      placeholder.remove();
      card.classList.remove('canvas-dragging');
      for(const property of ['left','top','width']) card.style.removeProperty(property);
      const lead=article.querySelector('[data-canvas-card=spotlight]')??article.querySelector('[data-canvas-card=identity]');
      if(canCommit&&y>=lead.getBoundingClientRect().bottom&&slot!==index&&current.order.join()===movableOrder().join()) {
        const visibleOrder=cards.map(item=>item.dataset.canvasCard);
        const visibleKeys=new Set(visibleOrder);
        visibleOrder.splice(index,1);
        visibleOrder.splice(slot,0,key);
        moveCard(current.order.map(id=>visibleKeys.has(id)?visibleOrder.shift():id),key);
      } else changed();
      animatePositions(before);
    }
    card.querySelector('.canvas-select').focus({preventScroll:true});
  }

  article.addEventListener('pointerup',event=>{
    if(event.pointerId===drag?.pointer) finishGesture(true);
  });
  for(const type of ['pointercancel','lostpointercapture']) article.addEventListener(type,event=>{
    if(event.pointerId===drag?.pointer) finishGesture(false);
  });
  doc.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&drag) finishGesture(false);
  });
}

for(const button of root.querySelectorAll('[data-device]')) button.addEventListener('click',()=>{
  previewDevice=button.dataset.device;
  fitCanvas();
  for(const choice of root.querySelectorAll('[data-device]')) {
    choice.setAttribute('aria-pressed',String(choice===button));
  }
  changed();
});

for(const button of root.querySelectorAll('[data-canvas-mode]')) button.addEventListener('click',()=>{
  if(drag) return;
  canvasMode=button.dataset.canvasMode;
  const editing=canvasMode==='edit';
  by('canvas-heading').textContent=editing?'Edit canvas':'Visitor preview';
  by('canvas-note').textContent=editing?canvasInstructions:'Test links with your unsaved changes at either width.';
  for(const choice of root.querySelectorAll('[data-canvas-mode]')) {
    choice.setAttribute('aria-pressed',String(choice===button));
  }
  const article=canvasArticle();
  if(article) syncCanvasMode(article);
  syncCanvasSelection();
});

by('preview-open').addEventListener('click',()=>{
  updatePreview();
  const targetName='lobby-private-preview-'+previewDevice;
  const target=window.open('about:blank',targetName);
  if(!target) {
    show('Allow pop-ups for LINB to open the private preview.');
    return;
  }
  submitPreview(targetName,previewDevice,JSON.stringify(content));
});
function appendEntry(key,url) {
  if(!canAddBlock(key)) return;
  const entry=Object.fromEntries(layouts[key].map(([name])=>[name,name==='zone'?'UTC':'']));
  if(key!=='links') entry.id=crypto.randomUUID();
  if(key==='links'&&url) {
    entry.url=url.href;
    entry.label=url.hostname.replace(/^www\./,'').slice(0,32);
  }
  content[key].push(entry);
  entries();
  changed();
  by(key+'.'+(content[key].length-1)+'.'+layouts[key][0][0]).focus();
}
for(const button of form.querySelectorAll('[data-add]')) button.addEventListener('click',()=>appendEntry(button.dataset.add));
for(const key of ['avatarId','coverId']) {
  const input=by(key);
  if(!input) continue;
  const status=by(key+'-state');
  input.addEventListener('change',async()=>{
    const file=input.files?.[0];
    if(!file) return;
    uploading++;
    updateControls();
    status.textContent='Processing image…';
    try {
      const data=new FormData();
      data.set('image',file);
      const result=await request('/api/editor/assets',{method:'POST',headers:{'x-csrf-token':csrf},body:data});
      content[key]=result.id;
      status.textContent='Image ready.';
    } catch(error) {
      if(error.status===401) requireSignIn();
      status.textContent=error.message+' Choose the image again to retry.';
    } finally {
      input.value='';
      uploading--;
      changed();
    }
  });
  form.querySelector('[data-remove-image='+key+']').addEventListener('click',()=>{
    content[key]=null;
    status.textContent='Image removed from this draft.';
    changed();
  });
}
loadValues(saved);

for(const [button,target] of [['use-twitch-name','displayName'],['use-twitch-link','streamUrl']]) {
  by(button)?.addEventListener('click',()=>{
    by(target).value=by(button).dataset.value;
    changed();
    by(target).focus();
  });
}

by('scheduleRemoval').addEventListener('change',changed);
