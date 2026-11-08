const root = document.querySelector('#workspace');
const by = (id) => document.getElementById(id);
const form = by('home-form');
const clone = (value) => JSON.parse(JSON.stringify(value));
const fields = ['displayName','intro','game','streamUrl'];
const capacities = {sessions:7,updates:3,links:5};
const labels = {sessions:'Session',updates:'Update',links:'Link'};
const fixedControls = {
  'identity-size':['identity','size'], 'identity-alignment':['identity','alignment'],
  'avatar-size':['identity','avatarSize'], 'avatar-position':['identity','avatarPosition'],
  'cover-x':['identity','focalX'], 'cover-y':['identity','focalY'],
  'spotlight-size':['spotlight','size'], 'dock-size':['dock','size'],
};
const promoCategories = ['Giveaway','Support','Merch','Sponsor','Community'];
const fieldNames = {layout:'Card layout and supporting cards',scheduleRemoval:'Schedule removal notice',displayName:'Display name',intro:'Intro',game:'Current game',streamUrl:'Stream destination',theme:'Theme',avatarId:'Avatar',coverId:'Cover image'};
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
let conflicted = false;
let retry = null;
let other = null;
let needsSignIn = false;
let canvasTimer;
let canvasPayload;

function updateControls() {
  const blocked=busy||uploading>0;
  const writesBlocked=blocked||needsSignIn;
  const unresolvedPublication=retry&&retry.action!=='save';
  const unresolvedSave=retry?.action==='save'&&JSON.stringify(content)===JSON.stringify(retry.value.content);
  by('reconnect').hidden=!needsSignIn;
  by('reconnect').querySelector('button').disabled=blocked;
  by('save').disabled=writesBlocked||conflicted||unresolvedPublication||unresolvedSave;
  for(const button of form.querySelectorAll('[data-preview]')) button.disabled=writesBlocked;
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
  by('retry').disabled=writesBlocked;
  for(const button of form.querySelectorAll('[data-add]')) {
    const key=button.dataset.add;
    button.disabled=blocked||(key==='links'?supportingLinkCount()>=5:content[key].length>=capacities[key]);
  }
  by('add-promo').disabled=blocked||supportingLinkCount()>=5;
}

function updatePreview() {
  for (const key of fields) content[key]=by(key).value;
  content.scheduleRemoval=by('scheduleRemoval').value;
  for(const [control,[card,field]] of Object.entries(fixedControls)) {
    const value=by(control).value;
    content.layout[card][field]=field.startsWith('focal')?Number(value):value;
  }
  by('spotlight-empty').hidden=Boolean(content.streamUrl.trim());
  by('dock-empty').hidden=content.links.length>0;

}

function changed() {
  updatePreview();
  dirty=JSON.stringify(content)!==JSON.stringify(saved);
  updateControls();
  clearTimeout(canvasTimer);
  canvasTimer=setTimeout(()=>{
    const payload=JSON.stringify(content);
    if(needsSignIn||payload===canvasPayload) return;
    canvasPayload=payload;
    submitPreview(by('editor-canvas').name,'phone',payload,true);
  },400);
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

function supportingCards() {
  const list=by('supporting');
  const schedule=by('schedule-fields');
  list.replaceChildren();
  const cards=content.layout.supporting;
  cards.forEach((card,index)=>{
    const group=document.createElement('fieldset');
    group.className='editor-entry';
    group.id=card.family==='schedule'?'schedule-card':'promo-'+card.id;
    group.tabIndex=-1;
    const title=document.createElement('legend');
    title.textContent=(card.family==='schedule'?'Schedule':card.title.trim()||'Promo card')+(card.hidden?' · Hidden':'');
    group.append(title);
    const name=card.family==='schedule'?'Schedule':'Promo card '+(index+1);
    addMoveButtons(group,cards,index,name,(next,delta)=>{
      supportingCards();
      changed();
      focusAfterMove(by(group.id),delta);
      by('card-announcement').textContent=name+' moved to supporting position '+(next+1)+'.';
    });
    const toggle=actionButton(card.hidden?'Restore card':'Hide card',()=>{
      card.hidden=!card.hidden;
      supportingCards();
      changed();
      by(group.id).querySelector('[data-visibility]').focus();
      by('card-announcement').textContent=name+(card.hidden?' hidden.':' restored.');
    });
    toggle.dataset.visibility='';
    group.append(toggle);
    const sizeId=card.family==='schedule'?'schedule-size':group.id+'-size';
    group.append(selectFor(sizeId,'Card size',[['compact','Compact'],['expanded','Expanded']],card.size,value=>{card.size=value;}));
    if(card.family==='schedule') {
      schedule.hidden=false;
      group.append(schedule);
    } else {
      group.append(selectFor(group.id+'-category','Category',promoCategories.map(value=>[value,value]),card.category,value=>{card.category=value;}));
      for(const [key,label,type,limit] of [['title','Headline','text',80],['url','HTTPS address','url',2048],['description','Expanded description','textarea',160]]) {
        const part=inputFor(type,group.id+'-'+key,card[key],limit,label);
        part.input.addEventListener('input',()=>{
          card[key]=part.input.value;
          if(key==='title') title.textContent=(card.title.trim()||'Promo card')+(card.hidden?' · Hidden':'');
          changed();
        });
        group.append(part.container);
      }
      group.append(actionButton('Remove Promo card',()=>{
        cards.splice(index,1);
        supportingCards();
        changed();
        by('add-promo').focus();
      }));
    }
    list.append(group);
  });
}

by('add-promo').addEventListener('click',()=>{
  if(supportingLinkCount()>=5) return;
  const card={id:crypto.randomUUID(),family:'promo',size:'compact',hidden:false,category:'Giveaway',title:'',url:'',description:''};
  content.layout.supporting.push(card);
  supportingCards();
  changed();
  by('promo-'+card.id+'-title').focus();
});

function loadValues(values) {
  content=clone({...values,scheduleRemoval:values.scheduleRemoval??'unknown'});
  by('scheduleRemoval').value=content.scheduleRemoval??'unknown';
  for (const key of fields) by(key).value=content[key];
  for (const radio of form.querySelectorAll('[name=theme]')) radio.checked=radio.value===content.theme;
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
  canvasPayload=undefined;
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
      link.addEventListener('click',()=>field.focus());
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
    return [
      'Identity: '+[identity.size,identity.alignment,identity.avatarSize,identity.avatarPosition,identity.focalX+' / '+identity.focalY].join(' · '),
      'Spotlight: '+spotlight.size,
      'Channel Dock: '+dock.size,
      ...supporting.map((card,index)=>[
        (index+1)+'. '+(card.family==='schedule'?'Schedule':card.title||'Promo card'),
        card.category,card.url,card.description,card.size,card.hidden?'Hidden':'Visible',
      ].filter(Boolean).join(' · ')),
    ].join('\n');
  }
  if(key==='avatarId'||key==='coverId') return value?'An image is selected':'No image selected';
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
function submitPreview(target,width,payload,embedded=false) {
  const preview=document.createElement('form');
  preview.method='post';
  preview.action='/editor/preview';
  preview.target=target;
  for(const [name,value] of Object.entries({csrf,width,content:payload,embedded:embedded?'1':'0'})) {
    const input=document.createElement('input');
    input.type='hidden';input.name=name;input.value=value;
    preview.append(input);
  }
  document.body.append(preview);
  preview.submit();
  preview.remove();
}

for(const button of form.querySelectorAll('[data-preview]')) button.addEventListener('click',()=>{
  updatePreview();
  const targetName='lobby-private-preview-'+button.dataset.preview;
  const target=window.open('about:blank',targetName);
  if(!target) {
    show('Allow pop-ups for LINB to open the private preview.');
    return;
  }
  submitPreview(targetName,button.dataset.preview,JSON.stringify(content));
});
for(const button of form.querySelectorAll('[data-add]')) button.addEventListener('click',()=>{
  const key=button.dataset.add;
  if(key==='links'?supportingLinkCount()>=5:content[key].length>=capacities[key]) return;
  const entry=Object.fromEntries(layouts[key].map(([name])=>[name,name==='zone'?'UTC':'']));
  if(key!=='links') entry.id=crypto.randomUUID();
  content[key].push(entry);
  entries();
  changed();
  by(key+'.'+(content[key].length-1)+'.'+layouts[key][0][0]).focus();
});
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
