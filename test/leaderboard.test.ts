import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { completedWeek, syntheticRank, SyntheticViews } from '../src/leaderboard.ts';

test('synthetic discovery suppresses low volume and removes ineligible creators',()=>{
  const now=Date.parse('2027-07-13T09:00:00Z');
  const {start}=completedWeek(now);
  const entries=Array.from({length:10},(_,i)=>({id:String(i),name:'Fixture '+i,url:'/demo',eligibleFrom:start,active:true}));
  const totals=new Map(entries.map(({id})=>[id,new Map([[start,113]])]));
  const ranked=syntheticRank(entries,totals,now).rows;
  assert.equal(ranked.length,10);
  assert.ok(ranked.every(row=>row.rank===1&&row.estimated===110));
  entries[0].active=false;
  assert.equal(syntheticRank(entries,totals,now).rows.length,0);
  const views=new SyntheticViews(),key=Buffer.alloc(32),next=Buffer.alloc(32,1);
  views.record(entries[1],'fixture-address',start,key);
  views.record(entries[1],'fixture-address',start+100,next,key);
  assert.equal(views.counts.get('1')?.get(start),1);
  views.withdraw('1');
  assert.equal(views.counts.has('1'),false);
});
