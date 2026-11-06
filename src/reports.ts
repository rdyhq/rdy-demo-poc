import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './db.ts';
import { AppError, digest, invalid } from './domain.ts';

export const reportReasons=['Impersonation','Private information','Safety concern','Other'];

export async function acceptReport(db:pg.Pool,home:{id:string;publication_id:string},source:string,fields:Record<string,unknown>) {
  const reason=typeof fields.reason==='string'?fields.reason:'';
  const detail=typeof fields.detail==='string'?fields.detail.trim():'';
  if(!reportReasons.includes(reason)||!detail||detail.length>700) throw invalid('report','Choose a reason and enter 1 to 700 characters.');
  const accepted=await transaction(db,async client=>{
    const {rowCount}=await client.query(`INSERT INTO rate_limits VALUES($1,date_trunc('hour',now()),1)
      ON CONFLICT(bucket,hour) DO UPDATE SET attempts=rate_limits.attempts+1 WHERE rate_limits.attempts<5 RETURNING attempts`,
      [digest('fan-report:'+source)]);
    if(!rowCount) return false;
    await client.query('INSERT INTO fan_reports(id,home_id,publication_id,reason,detail) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(),home.id,home.publication_id,reason,detail]);
    return true;
  });
  if(!accepted) throw new AppError(429,'report_limited','Please wait before sending another report.');
}

export async function reportInbox(db:pg.Pool) {
  const {rows}=await db.query(`SELECT id,home_id,reason,detail,created_at FROM fan_reports
    WHERE resolved_at IS NULL AND detail IS NOT NULL AND created_at>now()-interval '30 days'
    ORDER BY created_at LIMIT 100`);
  return rows;
}
