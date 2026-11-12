import { issuer } from './twitch.ts';
import type { LiveState } from './live-state.ts';

export type TwitchActivityConfig = {clientId:string;clientSecret:string;http?:typeof fetch};
export type TwitchChannel = {subject:string;login:string};
type CacheEntry<T> = {until:number;value:Promise<T>};
const unavailable:LiveState={live:false,verified:false};
const validCount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const title=(value:unknown)=>typeof value==='string'?value.trim().slice(0,160):'';

export class TwitchActivity {
  private token?:{value:string;until:number};
  private pendingToken?:Promise<string>;
  private streams=new Map<string,CacheEntry<LiveState>>();
  private clips=new Map<string,CacheEntry<LiveState['clip']>>();

  private config:TwitchActivityConfig;
  private clock:()=>number;

  constructor(config:TwitchActivityConfig,clock=Date.now) {
    this.config=config;
    this.clock=clock;
  }

  private async json(url:string,init:RequestInit) {
    const result=await (this.config.http??fetch)(url,{...init,redirect:'error',signal:AbortSignal.timeout(1800)});
    return result;
  }

  private async requestToken() {
    const result=await this.json(issuer+'/token',{method:'POST',body:new URLSearchParams({
      client_id:this.config.clientId,client_secret:this.config.clientSecret,grant_type:'client_credentials',
    })});
    if(!result.ok) throw new Error('Twitch app token unavailable.');
    const payload=await result.json();
    if(typeof payload.access_token!=='string'||!payload.access_token||!validCount(payload.expires_in)||!payload.expires_in) {
      throw new Error('Invalid Twitch app token response.');
    }
    this.token={value:payload.access_token,until:this.clock()+Math.max(0,payload.expires_in-30)*1000};
    return this.token.value;
  }

  private async accessToken() {
    if(this.token&&this.token.until>this.clock()) return this.token.value;
    this.pendingToken??=this.requestToken().finally(()=>{this.pendingToken=undefined;});
    return this.pendingToken;
  }

  private async read(path:'streams'|'clips'|'users',query:URLSearchParams) {
    const token=await this.accessToken();
    const response=await this.json('https://api.twitch.tv/helix/'+path+'?'+query,{
      headers:{'Client-Id':this.config.clientId,Authorization:'Bearer '+token},
    });
    if(response.status===401&&this.token?.value===token) this.token=undefined;
    if(!response.ok) throw new Error('Twitch activity unavailable.');
    const payload=await response.json();
    if(!Array.isArray(payload.data)) throw new Error('Invalid Twitch activity response.');
    return payload.data;
  }

  private cached<T>(cache:Map<string,CacheEntry<T>>,key:string,ttl:number,read:()=>Promise<T>) {
    const now=this.clock(), existing=cache.get(key);
    if(existing&&existing.until>now) return existing.value;
    if(cache.size>=256&&!existing) cache.delete(cache.keys().next().value!);
    const entry={until:now+ttl,value:read()};
    cache.set(key,entry);
    return entry.value;
  }

  async get(channel:TwitchChannel,includeClip=false):Promise<LiveState> {
    const key=channel.subject+':'+channel.login;
    const stream=await this.cached(this.streams,key,25_000,async()=>{
      try {
        const rows=await this.read('streams',new URLSearchParams({user_id:channel.subject,first:'1'}));
        if(!rows.length) {
          const [profile]=await this.read('users',new URLSearchParams({id:channel.subject}));
          return {live:false,verified:profile?.id===channel.subject&&profile.login===channel.login};
        }
        const [stream]=rows;
        if(stream?.type!=='live'||stream.user_id!==channel.subject||stream.user_login!==channel.login) return unavailable;
        return {live:true,verified:true,title:title(stream.title),viewers:validCount(stream.viewer_count)?stream.viewer_count:undefined};
      } catch { return unavailable; }
    });
    if(stream.live||!stream.verified||!includeClip) return stream;
    const clip=await this.cached(this.clips,key,120_000,async()=>{
      try {
        const start=this.clock()-7*86400_000;
        const rows=await this.read('clips',new URLSearchParams({broadcaster_id:channel.subject,
          started_at:new Date(start).toISOString(),first:'20'}));
        return rows.filter(clip=>clip?.broadcaster_id===channel.subject&&title(clip.title)&&
          typeof clip.id==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(clip.id)&&
          typeof clip.created_at==='string'&&Date.parse(clip.created_at)>=start&&Date.parse(clip.created_at)<=this.clock())
          .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))
          .map(clip=>({title:title(clip.title),url:'https://clips.twitch.tv/'+clip.id,
            views:validCount(clip.view_count)?clip.view_count:undefined}))[0];
      } catch { return undefined; }
    });
    return {...stream,clip};
  }
}
