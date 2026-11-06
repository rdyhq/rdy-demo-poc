import type pg from 'pg';
import { invalid } from './domain.ts';

export type Link={label:string;url:string;note:string};
export type ProContent={appearance:'original'|'arcade'|'afterglow';video:{id:string;title:string}|null;links:Link[];
  highlights:{id:string;title:string}|null;recommendations:{id:string;title:string}|null};
export type ProDraft={revision:number;highlights_id:string;recommendations_id:string;content:ProContent};

function value(raw:unknown,max:number,field:string) {
  const clean=typeof raw==='string'?raw.trim():'';
  if(clean.length>max) throw invalid(field,'Use no more than '+max+' characters.');
  return clean;
}

function https(raw:string) {
  try {
    const url=new URL(raw);
    if(url.protocol==='https:'&&!url.username&&!url.password) return url;
  } catch {}
  throw invalid('url','Enter a complete HTTPS link.');
}

function youtube(url:string) {
  const parsed=https(url);
  const id=parsed.hostname==='youtu.be'?parsed.pathname.slice(1):
    ['www.youtube.com','youtube.com','m.youtube.com'].includes(parsed.hostname)?
      parsed.pathname==='/watch'?parsed.searchParams.get('v'):parsed.pathname.match(/^\/(?:shorts|live)\/([\w-]+)$/)?.[1]:null;
  if(!id||! /^[a-zA-Z0-9_-]{11}$/.test(id)) throw invalid('video','Use a YouTube video link.');
  return id;
}

export function normalizePro(fields:Record<string,unknown>,draft:ProDraft,multipage:boolean):ProContent {
  const appearance=fields.appearance;
  if(appearance!=='original'&&appearance!=='arcade'&&appearance!=='afterglow') throw invalid('appearance','Choose a visual preset.');
  const title=value(fields.videoTitle,80,'videoTitle'),url=value(fields.videoUrl,2048,'videoUrl');
  if(Boolean(title)!==Boolean(url)) throw invalid('video','Add a title and a YouTube URL together.');
  const video=title?{id:youtube(url),title}:null;
  const links:Link[]=[];
  for(let i=1;i<=6;i++) {
    const label=value(fields['label'+i],45,'label'+i);
    const destination=value(fields['url'+i],2048,'url'+i);
    const note=value(fields['note'+i],110,'note'+i);
    if(label||destination||note) {
      if(!label||!destination) throw invalid('collection','Every recommendation needs a label and link.');
      links.push({label,url:https(destination).href,note});
    }
  }
  const h=value(fields.highlightsTitle,45,'highlightsTitle');
  const r=value(fields.recommendationsTitle,45,'recommendationsTitle');
  if((h&&!video)||(r&&!links.length)) throw invalid('pages','Add content before naming an extra page.');
  return {appearance,video,links,
    highlights:multipage&&h?{id:draft.highlights_id,title:h}:null,
    recommendations:multipage&&r?{id:draft.recommendations_id,title:r}:null};
}

export async function proDraft(db:pg.Pool,homeId:string):Promise<ProDraft> {
  await db.query('INSERT INTO pro_drafts(home_id) VALUES($1) ON CONFLICT DO NOTHING',[homeId]);
  const result=await db.query<ProDraft>('SELECT * FROM pro_drafts WHERE home_id=$1',[homeId]);
  return result.rows[0];
}

export async function publicPro(db:pg.Pool,id:string,pub:string):Promise<ProContent|null> {
  const {rows}=await db.query(`SELECT p.pro_content FROM homes h JOIN publications p ON p.home_id=h.id AND p.id=h.publication_id
    JOIN stripe_subscriptions s ON s.creator_id=h.owner_id AND s.grant_id=p.pro_grant
    WHERE h.id=$1 AND p.id=$2 AND s.status IN('active','trialing') AND s.access_until>now()
    AND NOT EXISTS(SELECT 1 FROM visibility_holds v WHERE v.home_id=h.id AND v.released_at IS NULL)`,[id,pub]);
  return rows[0]?.pro_content??null;
}
