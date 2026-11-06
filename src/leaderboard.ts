/** Synthetic experiment only. No production request path calls this collector. */
import { createHmac } from 'node:crypto';
const day=86400000;
const minute=60000;
type Entry={id:string;name:string;url:string;eligibleFrom:number;active:boolean;quarantined?:boolean};

export function completedWeek(now:number) {
  const t=new Date(now);
  const utc=Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate());
  const monday=utc-((t.getUTCDay()+6)%7)*day;
  return {start:monday-7*day,end:monday};
}

export class SyntheticViews {
  markers=new Map<string,number>();
  counts=new Map<string,Map<number,number>>();
  record(home:Entry,address:string,now:number,key:Buffer,previousKey?:Buffer) {
    if(!home.active||home.quarantined||now<home.eligibleFrom||!address) return;
    for(const [marker,expires] of this.markers) if(expires<=now) this.markers.delete(marker);
    const keyed=(k:Buffer)=>createHmac('sha256',k).update(home.id+'\0'+address).digest('hex');
    const current=keyed(key);
    if(this.markers.has(current)||(previousKey&&this.markers.has(keyed(previousKey)))) return;
    this.markers.set(current,now+30*minute);
    const daily=this.counts.get(home.id)??new Map<number,number>();
    const utc=Math.floor(now/day)*day;
    daily.set(utc,(daily.get(utc)??0)+1);
    for(const date of daily.keys()) if(date<utc-34*day) daily.delete(date);
    this.counts.set(home.id,daily);
  }

  withdraw(id:string) {this.counts.delete(id);}
}

export function syntheticRank(entries:Entry[],counts:Map<string,Map<number,number>>,now:number) {
  const week=completedWeek(now);
  const eligible=entries.filter(e=>e.active&&!e.quarantined&&e.eligibleFrom<=week.start).map(e=>{
    const total=[...(counts.get(e.id)??new Map<number,number>())].reduce((n,[d,v])=>d>=week.start&&d<week.end?n+v:n,0);
    return {id:e.id,name:e.name,url:e.url,total};
  }).filter(e=>e.total>=100).sort((a,b)=>b.total-a.total||a.id.localeCompare(b.id));
  if(eligible.length<10) return {week,rows:[]};
  let previous=-1, rank=0;
  const rows=eligible.map(({id,name,url,total},i)=>{
    if(total!==previous) rank=i+1;
    previous=total;
    return {name,url,rank,estimated:Math.round(total/10)*10};
  });
  return {week,rows};
}

export function demoRanking(now=Date.now(),low=false) {
  const {start}=completedWeek(now);
  const names=['Mira Vale','Pixel Finch','Orbit Jun','Rook Static','Arc Mallow','Nova Koi','Tess Turbo','Rune Sable','Kai Quartz','Echo Maple','Sol Prism'];
  const entries=names.map((name,i)=>({id:'fixture-'+i,name,url:'/demo',eligibleFrom:start-day,active:!low||i<3}));
  const counts=new Map(entries.map(({id},i)=>[id,new Map([[start,220-i*10]])]));
  return syntheticRank(entries,counts,now);
}
