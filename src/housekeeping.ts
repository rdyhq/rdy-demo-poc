import type pg from 'pg';

// Removes what the privacy notice says that linb.io does not keep (RDY r-1WF1W): the text of a fan report
// after 30 days, the evidence of a case after its date, and a limit count after one day.
// A limit count holds a coded network address, and only the count of the current hour is in use.
export async function housekeep(pool:pg.Pool) {
  const cases=await pool.query(`UPDATE report_cases SET evidence=NULL,evidence_deleted_at=now()
    WHERE evidence_until<=now() AND evidence IS NOT NULL`);
  const reports=await pool.query(`UPDATE fan_reports SET detail=NULL WHERE created_at<=now()-interval '30 days' AND detail IS NOT NULL`);
  const limits=await pool.query(`DELETE FROM rate_limits WHERE hour<now()-interval '24 hours'`);
  return {evidence:(cases.rowCount??0)+(reports.rowCount??0),limits:limits.rowCount??0};
}
