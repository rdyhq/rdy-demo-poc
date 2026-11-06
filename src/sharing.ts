import type pg from 'pg';
import { digest, type HomeContent } from './domain.ts';

export type Selection={name:boolean;intro:boolean;image:boolean};

export function previewFields(content:HomeContent,selection:Selection) {
  return {title:selection.name?content.displayName:'A creator on LINB',
    description:selection.intro?content.intro:'A link in bio for gaming and streaming creators.',
    coverId:selection.image?content.coverId:null};
}

export const previewFingerprint=(content:HomeContent,selection:Selection)=>digest(JSON.stringify(previewFields(content,selection)));

export async function approvedPreview(db:pg.Pool,home:{id:string;content:HomeContent}) {
  const {rows}=await db.query<{selection:Selection;fingerprint:string}>(
    'SELECT selection,fingerprint FROM share_preview_consents WHERE home_id=$1',[home.id]);
  const rule=rows[0];
  if(!rule||previewFingerprint(home.content,rule.selection)!==rule.fingerprint) return null;
  return previewFields(home.content,rule.selection);
}

export const discordSchedule=(title:string,instant:string,url:string)=>
  title.replace(/[<@\x00-\x1f]/g,c=>c==='<'?'‹':c==='@'?'＠':' ')+' — <t:'+Math.floor(Date.parse(instant)/1000)+':F>\n'+url;
