import { uuidPattern } from './domain.ts';

export type HomeAlias={homeId:string;twitchSubject:string};
const reserved=new Set(['account','api','assets','auth','demo','editor','h','healthz','logout','ops','sign-in','verify']);

export function homeAliases(input:string|undefined):ReadonlyMap<string,HomeAlias> {
  if(!input) return new Map();
  const entries:unknown=JSON.parse(input);
  if(!entries||typeof entries!=='object'||Array.isArray(entries)||Object.keys(entries).length>32) {
    throw new Error('LINB_HOME_ALIASES must map approved handles to homes.');
  }
  const aliases=new Map<string,HomeAlias>();
  for(const [slug,alias] of Object.entries(entries)) {
    if(!/^[a-z0-9_]{3,25}$/.test(slug)||reserved.has(slug)||
        typeof alias?.homeId!=='string'||!uuidPattern.test(alias.homeId)||
        typeof alias?.twitchSubject!=='string'||!/^[0-9]{1,30}$/.test(alias.twitchSubject)) {
      throw new Error('Invalid approved Home alias.');
    }
    aliases.set(slug,{homeId:alias.homeId.toLowerCase(),twitchSubject:alias.twitchSubject});
  }
  return aliases;
}
