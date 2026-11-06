import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';

export class AppError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const invalid = (field: string, message: string) => new AppError(422,'invalid_fields',message,{[field]:message});
export const conflict = (message: string) => new AppError(409,'conflict',message);
export const unavailable = () => new AppError(404,'unavailable','This home is not available.');
export const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
export const secret = () => randomBytes(32).toString('hex');
export const tokenPattern = /^[a-f0-9]{64}$/;
export const uuidPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export const themeNames = ['Hearth','Grove','Midnight'] as const;

export type SessionSlot = { id: string; title: string; local: string; zone: string; offset: string; instant: string };
export type Update = { id: string; text: string; firstPublishedAt?: string };
export type HomeContent = {
  schemaVersion: 1; displayName: string; intro: string; game: string; streamUrl: string;
  theme: typeof themeNames[number]; avatarId: string | null; coverId: string | null;
  links: { label: string; url: string }[]; sessions: SessionSlot[]; updates: Update[];
};
export const emptyHome: HomeContent = {
  schemaVersion:1,displayName:'',intro:'',game:'',streamUrl:'',theme:'Midnight',avatarId:null,coverId:null,links:[],sessions:[],updates:[],
};

export function equalSecret(a: string, b: string) {
  const left=Buffer.from(a), right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
}

export function mailbox(value: unknown) {
  if (typeof value !== 'string') return null;
  const email=value.trim();
  if (email.length>254 || !/^[^\s,@<>]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return null;
  const at=email.lastIndexOf('@');
  return email.slice(0,at+1)+email.slice(at+1).toLowerCase();
}

function text(value: unknown, field: string, limit: number, required=false) {
  if (typeof value !== 'string') throw invalid(field,'Enter text.');
  const result=value.trim();
  if (result.length>limit || (required && !result)) {
    throw invalid(field, required ? 'Enter 1 to '+limit+' characters.' : 'Use at most '+limit+' characters.');
  }
  return result;
}

function https(value: unknown, field: string, required=false) {
  const raw=text(value,field,2048,required);
  if (!raw) return raw;
  try {
    const url=new URL(raw);
    if (url.protocol==='https:' && !url.username && !url.password) return url.href;
  } catch {}
  throw invalid(field,'Enter a complete HTTPS address.');
}

function list(value: unknown, field: string, count: number) {
  if (!Array.isArray(value) || value.length>count) throw invalid(field,'Use at most '+count+' entries.');
  return value;
}

function id(value: unknown, field: string) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw invalid(field,'The identifier is invalid.');
  return value.toLowerCase();
}

function slot(value: any, i: number, old: HomeContent, now: number, preview: boolean) {
  const field='sessions.'+i;
  const sessionId=id(value?.id,field);
  const title=text(value?.title,field,80,true);
  const local=text(value?.local,field,16,true);
  const zone=text(value?.zone,field,90,true);
  const offset=text(value?.offset??'',field,6);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || !/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(zone)) {
    throw invalid(field,'Enter a date, time, and named time zone.');
  }
  const base=local+'['+zone+']';
  let earlier, later;
  try {
    earlier=Temporal.ZonedDateTime.from(base,{disambiguation:'earlier'});
    later=Temporal.ZonedDateTime.from(base,{disambiguation:'later'});
  } catch { throw invalid(field,'Enter a valid date and IANA time zone.'); }
  if (earlier.toPlainDateTime().toString({smallestUnit:'minute'})!==local
      || later.toPlainDateTime().toString({smallestUnit:'minute'})!==local) throw invalid(field,'This local time does not exist. Choose another time.');
  const overlaps=earlier.epochMilliseconds!==later.epochMilliseconds;
  if (overlaps && ![earlier.offset,later.offset].includes(offset)) {
    throw invalid(field,'Choose an offset for this repeated local time: '+earlier.offset+' or '+later.offset+'.');
  }
  if (!overlaps && offset && offset!==earlier.offset) throw invalid(field,'The offset does not match this local time.');
  const selected=overlaps && offset===later.offset?later:earlier;
  const instant=new Date(selected.epochMilliseconds).toISOString();
  const unchanged=old.sessions.some(s=>s.id===sessionId && s.title===title && s.instant===instant && s.zone===zone && s.local===local);
  if (!preview && !unchanged && selected.epochMilliseconds<=now) throw invalid(field,'A new or changed session must start in the future.');
  return {id:sessionId,title,local,zone,offset:selected.offset,instant};
}

export function normalize(value: any, old=emptyHome, now=Date.now(), preview=false): HomeContent {
  if (!value || typeof value!=='object') throw invalid('content','Enter home content.');
  if (value.schemaVersion!==undefined&&value.schemaVersion!==1) throw invalid('content','This home content version is not supported.');
  if (!themeNames.includes(value.theme)) throw invalid('theme','Choose a LINB theme.');
  const sessions=list(value.sessions,'sessions',7).map((entry,i)=>slot(entry,i,old,now,preview));
  const updates=list(value.updates,'updates',3).map((entry,i)=>({
    id:id(entry?.id,'updates.'+i),text:text(entry?.text,'updates.'+i,280,true),
  }));
  for (const [field,entries] of [['sessions',sessions],['updates',updates]] as const) {
    if (new Set(entries.map(e=>e.id)).size!==entries.length) throw invalid(field,'Use a different identifier for each entry.');
  }
  return {
    schemaVersion:1,displayName:text(value.displayName,'displayName',40,!preview),intro:text(value.intro,'intro',160,!preview),
    game:text(value.game,'game',80),streamUrl:https(value.streamUrl,'streamUrl'),theme:value.theme,
    avatarId:value.avatarId==null?null:id(value.avatarId,'avatarId'),coverId:value.coverId==null?null:id(value.coverId,'coverId'),
    links:list(value.links,'links',5).map((entry,i)=>({
      label:text(entry?.label,'links.'+i,32,true),url:https(entry?.url,'links.'+i,true),
    })),sessions,updates,
  };
}

export function nextSession(content: HomeContent, now: number) {
  return content.sessions.filter(s=>Date.parse(s.instant)>now)
    .sort((a,b)=>Date.parse(a.instant)-Date.parse(b.instant)||a.id.localeCompare(b.id))[0];
}
