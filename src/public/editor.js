const root = document.querySelector('#workspace');
const by = (id) => document.getElementById(id);
const form = by('home-form');
const clone = (value) => JSON.parse(JSON.stringify(value));
const fields = ['displayName','intro','game','streamUrl'];
const capacities = {sessions:7,updates:3,links:5};
const labels = {sessions:'Session',updates:'Update',links:'Link'};
const fieldNames = {displayName:'Display name',intro:'Intro',game:'Current game',streamUrl:'Stream destination',theme:'Theme',avatarId:'Avatar',coverId:'Cover image'};
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
let held = root.dataset.held === 'true';
let busy = false;
let uploading = 0;
let dirty = false;
let conflicted = false;
let retry = null;
let other = null;
let needsSignIn = false;

function updateControls() {
  const blocked=busy||uploading>0;
  const writesBlocked=blocked||needsSignIn;
  by('reconnect').hidden=!needsSignIn;
  by('reconnect').querySelector('button').disabled=blocked;
  by('save').disabled=writesBlocked||conflicted;
  by('preview').disabled=writesBlocked;
  by('publish').disabled=writesBlocked||conflicted||dirty||revision===0||retry?.action==='save';
  for(const input of form.querySelectorAll('input, textarea, button[data-remove-image], .editor-entry button')) input.disabled=blocked;
  by('unpublish').disabled=writesBlocked||conflicted;
  by('unpublish').hidden=!publication;
  by('public-link').hidden=!publication||held;
  by('share-link').hidden=!publication||held;
  by('availability').textContent=held?'Home held':publication?'Home available':'Private draft';
  by('hold-note').hidden=!held;
  by('revision-label').textContent='Draft revision '+revision;
  by('publish-help').textContent=conflicted?'Compare the current draft first.':dirty||!revision?'Save changes before you publish.':'The saved revision is ready to publish.';
  for(const input of form.querySelectorAll('input[type=file]')) input.disabled=writesBlocked;
  by('retry').disabled=writesBlocked;
  for(const button of form.querySelectorAll('[data-add]')) button.disabled=blocked||content[button.dataset.add].length>=capacities[button.dataset.add];
}

function updatePreview() {
  for (const key of fields) content[key]=by(key).value;
  content.scheduleRemoval=by('scheduleRemoval').value;
  content.theme=form.querySelector('[name=theme]:checked')?.value||'Midnight';
  by('mini-name').closest('section').dataset.theme=content.theme;
  by('mini-name').textContent=content.displayName||'Your creator name';
  by('mini-intro').textContent=content.intro||'Your intro appears here.';
}

function changed() {
  updatePreview();
  dirty=JSON.stringify(content)!==JSON.stringify(saved);
  updateControls();
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
      const remove=document.createElement('button');
      remove.type='button';
      remove.className='secondary';
      remove.textContent='Remove '+labels[key].toLowerCase()+' '+(index+1);
      remove.addEventListener('click',()=>{
        content[key].splice(index,1);
        entries();
        changed();
        form.querySelector('[data-add='+key+']').focus();
      });
      group.append(remove);
      container.append(group);
    });
  }
}

function loadValues(values) {
  content=clone({...values,scheduleRemoval:values.scheduleRemoval??'unknown'});
  by('scheduleRemoval').value=content.scheduleRemoval??'unknown';
  for (const key of fields) by(key).value=content[key];
  for (const radio of form.querySelectorAll('[name=theme]')) radio.checked=radio.value===content.theme;
  for (const key of ['avatarId','coverId']) {
    const status=by(key+'-state');
    if(status) status.textContent=content[key]?'Image ready.':'No image selected.';
  }
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
      conflicted=true;
      by('compare').hidden=false;
      show(error.message,true);
    } else if (error.status===422) {
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
by('publish').addEventListener('click',()=>{if(!dirty&&!conflicted) void newMutation('publish');});
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
    updateControls();
    show('Editor reconnected. Review your changes before continuing.');
  } catch {show('Sign in again, then reconnect this editor.',true);}
});
function summarize(key,value) {
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
by('preview').addEventListener('click',()=>{
  updatePreview();
  const preview=document.createElement('form');
  preview.method='post';
  preview.action='/editor/preview';
  const target=window.open('about:blank','lobby-private-preview');
  if(!target) {
    show('Allow pop-ups for LINB to open the private preview.');
    return;
  }
  preview.target='lobby-private-preview';
  for(const [name,value] of Object.entries({csrf,content:JSON.stringify(content)})) {
    const input=document.createElement('input');
    input.type='hidden';input.name=name;input.value=value;
    preview.append(input);
  }
  document.body.append(preview);
  preview.submit();
  preview.remove();
});
for(const button of form.querySelectorAll('[data-add]')) button.addEventListener('click',()=>{
  const key=button.dataset.add;
  if(content[key].length>=capacities[key]) return;
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
