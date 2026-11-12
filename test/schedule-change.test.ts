import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyHome, scheduleChange, type ScheduleChange, type SessionSlot } from '../src/domain.ts';
import { renderHome } from '../src/views.ts';

const now=Date.parse('2027-07-12T00:00:00Z');
const slot=(id:string,title:string,instant:string):SessionSlot=>({id,title,local:instant.slice(0,16),zone:'UTC',offset:'+00:00',instant});
const wednesday=slot('00000000-0000-4000-8000-000000000001','Wednesday run','2027-07-14T19:00:00.000Z');
const friday=slot('00000000-0000-4000-8000-000000000002','Friday run','2027-07-16T19:00:00.000Z');
const fridayMoved:SessionSlot={...friday,local:'2027-07-17T19:00',instant:'2027-07-17T19:00:00.000Z'};
const home=(sessions:SessionSlot[],scheduleRemoval:'unknown'|'cancelled'='unknown')=>({...emptyHome,sessions,scheduleRemoval});

test('an added earlier session leaves the kept next session without a notice',()=>{
  assert.equal(scheduleChange(home([friday]),home([wednesday,friday]),now,null),null);
});

test('a removed next session is reported as removed, not as moved to a later session',()=>{
  assert.deepEqual(scheduleChange(home([wednesday,friday]),home([friday]),now,null),
    {prior:wednesday,next:null,status:'New time unknown'});
  assert.deepEqual(scheduleChange(home([wednesday,friday]),home([friday],'cancelled'),now,null),
    {prior:wednesday,next:null,status:'Cancelled'});
});

test('a session that keeps its ID and moves is reported as changed',()=>{
  assert.deepEqual(scheduleChange(home([friday]),home([fridayMoved]),now,null),
    {prior:friday,next:fridayMoved,status:'Changed'});
});

test('a rescheduled session is reported even when another session now comes first',()=>{
  assert.deepEqual(scheduleChange(home([friday]),home([wednesday,fridayMoved]),now,null),
    {prior:friday,next:fridayMoved,status:'Changed'});
});

test('an active removal notice does not adopt an unrelated new session',()=>{
  const removed:ScheduleChange={prior:friday,next:null,status:'New time unknown'};
  assert.deepEqual(scheduleChange(home([]),home([wednesday]),now,removed),removed);
});

test('the fan notice names the affected session',async()=>{
  const notice:ScheduleChange={prior:friday,next:null,status:'Cancelled'};
  const page=String(await renderHome({...emptyHome,displayName:'Mira Vale',intro:'Cozy strategy.'},{now,asset:()=>'',notice}));
  assert.match(page,/SCHEDULE CHANGE<\/p>\s*<p>Friday run: Cancelled\. Previous time: 2027-07-16 19:00 UTC \(\+00:00\)\.<\/p>/);
});
