import type pg from 'pg';
import { transaction } from './db.ts';
import { conflict, uuidPattern } from './domain.ts';

type Db=pg.Pool|pg.PoolClient;
const pattern=/^[a-z0-9_]{3,25}$/;
// Names that an application route needs now, or is likely to need. A handle never takes one.
const reserved=new Set(['about','account','admin','api','app','assets','auth','billing','blog','contact','dashboard','demo','docs',
  'editor','explore','faq','healthz','help','home','legal','login','logout','ops','pricing','privacy','pro','settings','signin',
  'signup','sign_in','sign_up','static','status','support','terms','verify','www']);
// A handle from a streaming account is public only while that account stays linked to the Home's owner.
const served=(row:string)=>`(${row}.source='operator' OR EXISTS (SELECT 1 FROM twitch_identities t
  WHERE t.creator_id=h.owner_id AND t.subject=${row}.twitch_subject))`;

export function handleFrom(login:unknown) {
  if(typeof login!=='string') return null;
  const handle=login.toLowerCase();
  return pattern.test(handle)&&!reserved.has(handle)?handle:null;
}

// The verified login becomes the handle of the creator's Home when the Home has none and no Home holds the name.
export async function assignHandle(client:Db,creator:string,identity:{subject:string;login:string|null}) {
  const handle=handleFrom(identity.login);
  if(!handle) return;
  await client.query(`INSERT INTO home_handles(handle,home_id,source,twitch_subject,current)
    SELECT $1,h.id,'twitch',$3,true FROM homes h WHERE h.owner_id=$2
      AND NOT EXISTS (SELECT 1 FROM home_handles c WHERE c.home_id=h.id AND c.current)
    ON CONFLICT (handle) DO NOTHING`,[handle,creator,identity.subject]);
}

// The Home that a handle address leads to, and that Home's current handle. An earlier handle forwards.
export async function resolveHandle(db:Db,raw:string) {
  const handle=raw.toLowerCase();
  if(!pattern.test(handle)) return null;
  const {rows}=await db.query<{home_id:string;canonical:string}>(`SELECT c.home_id,c.handle AS canonical FROM home_handles a
    JOIN homes h ON h.id=a.home_id JOIN home_handles c ON c.home_id=a.home_id AND c.current
    WHERE a.handle=$1 AND ${served('a')} AND ${served('c')}`,[handle]);
  return rows[0]?{homeId:rows[0].home_id,canonical:rows[0].canonical}:null;
}

export async function homeHandle(db:Db,homeId:string) {
  const {rows}=await db.query<{handle:string}>(`SELECT c.handle FROM home_handles c JOIN homes h ON h.id=c.home_id
    WHERE c.home_id=$1 AND c.current AND ${served('c')}`,[homeId]);
  return rows[0]?.handle??null;
}

// After a rename, the new login is offered when no other Home holds it.
export async function handleOffer(db:Db,creator:string) {
  const {rows}=await db.query(`SELECT t.login,t.subject,h.id AS home_id,c.handle AS current,c.twitch_subject AS current_subject
    FROM twitch_identities t JOIN homes h ON h.owner_id=t.creator_id LEFT JOIN home_handles c ON c.home_id=h.id AND c.current
    WHERE t.creator_id=$1`,[creator]);
  const row=rows[0],handle=handleFrom(row?.login);
  if(!row||!handle||(handle===row.current&&row.current_subject===row.subject)) return null;
  const held=await db.query('SELECT home_id FROM home_handles WHERE handle=$1',[handle]);
  if(held.rows[0]&&held.rows[0].home_id!==row.home_id) return null;
  return {handle,homeId:row.home_id as string,subject:row.subject as string};
}

export function acceptHandle(pool:pg.Pool,creator:string) {
  return transaction(pool,async client=>{
    await client.query('SELECT 1 FROM homes WHERE owner_id=$1 FOR UPDATE',[creator]);
    const offer=await handleOffer(client,creator);
    if(!offer) return null;
    await makeCurrent(client,offer.homeId,offer.handle,'twitch',offer.subject);
    return offer.handle;
  });
}

// An operator approves a handle when the creator has no verified account, or the login is reserved or taken.
export async function approveHandle(pool:pg.Pool,homeId:string,raw:unknown) {
  const handle=handleFrom(raw);
  if(!uuidPattern.test(homeId)||!handle) {
    throw new Error('Enter a Home ID, and a handle of 3 to 25 lowercase letters, digits or underscores that no application route needs.');
  }
  return transaction(pool,async client=>{
    if(!(await client.query('SELECT 1 FROM homes WHERE id=$1 FOR UPDATE',[homeId])).rowCount) throw new Error('No Home has this ID.');
    await makeCurrent(client,homeId,handle,'operator',null);
  });
}

async function makeCurrent(client:pg.PoolClient,homeId:string,handle:string,source:'twitch'|'operator',subject:string|null) {
  await client.query('UPDATE home_handles SET current=false WHERE home_id=$1 AND current',[homeId]);
  const {rowCount}=await client.query(`INSERT INTO home_handles(handle,home_id,source,twitch_subject,current) VALUES ($1,$2,$3,$4,true)
    ON CONFLICT (handle) DO UPDATE SET current=true,source=$3,twitch_subject=$4 WHERE home_handles.home_id=$2`,[handle,homeId,source,subject]);
  if(!rowCount) throw conflict('This handle belongs to another Home.');
}

// Handles that an operator approved in LINB_HOME_ALIASES before handles were stored.
export async function importAliases(pool:pg.Pool,aliases:ReadonlyMap<string,{homeId:string;twitchSubject:string}>) {
  for(const [handle,alias] of aliases) {
    await pool.query(`INSERT INTO home_handles(handle,home_id,source,twitch_subject,current)
      SELECT $1,h.id,'twitch',$3,NOT EXISTS (SELECT 1 FROM home_handles c WHERE c.home_id=h.id AND c.current)
      FROM homes h WHERE h.id=$2 ON CONFLICT (handle) DO NOTHING`,[handle,alias.homeId,alias.twitchSubject]);
  }
}
