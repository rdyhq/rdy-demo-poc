import sharp from 'sharp';
import { matchColours, suggestSkin } from './public/art-match.js';
import { applySkin } from './public/editor-support.js';
import type { EditableHome } from './home-cards.ts';
import type { TwitchProfile } from './twitch-activity.ts';

// The import adapter for Twitch art (RDY k-TVMM0, r-GVBR2). It fetches images only from the Twitch image host.
const imageHost='static-cdn.jtvnw.net';
const maxArt=5*1024*1024;

export function artUrl(value:unknown) {
  if(typeof value!=='string'||!value) return null;
  let url:URL;
  try { url=new URL(value); } catch { return null; }
  return url.protocol==='https:'&&url.hostname===imageHost&&!url.port&&!url.username&&!url.password?url.href:null;
}

// A failed fetch gives no image. The caller leaves that item out and keeps the rest of the draft.
export async function fetchArt(address:string,http:typeof fetch=fetch):Promise<Buffer|null> {
  const url=artUrl(address);
  if(!url) return null;
  try {
    const response=await http(url,{redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!response.ok||!response.body||!/^image\/(png|jpeg|webp)\b/.test(response.headers.get('Content-Type')??'')) return null;
    if(Number(response.headers.get('Content-Length')??0)>maxArt) return null;
    const chunks:Uint8Array[]=[];
    let size=0;
    for await(const chunk of response.body) {
      size+=chunk.length;
      if(size>maxArt) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch { return null; }
}

// Imported art passes the same checks as an upload: a static JPEG, PNG or WebP of at most 20 megapixels.
async function checked(bytes:Buffer|null) {
  if(!bytes) return null;
  try {
    const input=sharp(bytes,{limitInputPixels:20_000_000,failOn:'error'});
    const info=await input.metadata();
    if(!['jpeg','png','webp'].includes(info.format??'')||(info.pages??1)>1||!info.width||!info.height) return null;
    const display=await input.clone().rotate().resize({width:1440,height:960,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer();
    const pixels=await input.clone().resize(48,48,{fit:'fill'}).ensureAlpha().raw().toBuffer();
    return {display,pixels};
  } catch { return null; }
}

// The pixels of a stored image for the art match, or nothing when the image cannot be read.
export async function artPixels(bytes:Uint8Array|null) {
  return bytes?(await checked(Buffer.from(bytes)))?.pixels??null:null;
}

export type ChannelMatch={profile:TwitchProfile;art:{avatar:Buffer|null;banner:Buffer|null};skin:ReturnType<typeof suggestSkin>};

// The first draft of a creator: the fields of the Twitch channel on top of a Home (RDY r-KQGNH).
// The art names are asset IDs after a claim, and the names of the waiting art in a preview.
export function channelDraft(base:EditableHome,match:ChannelMatch,art:{avatar:string|null;banner:string|null}):EditableHome {
  const {profile,skin}=match;
  const url='https://www.twitch.tv/'+profile.login;
  const content=structuredClone(base);
  Object.assign(content,{displayName:profile.displayName,intro:profile.bio,game:profile.game,streamUrl:url,avatarId:art.avatar,coverId:art.banner});
  if(!content.links.some(link=>link.url===url)) content.links.unshift({label:'Twitch',url});
  if(skin) applySkin(content,skin);
  return content;
}

// The matched draft of RDY D-HCXW2: the profile, its art and a skin from the art. Nothing here is saved.
export async function matchChannel(profile:TwitchProfile,http:typeof fetch=fetch):Promise<ChannelMatch> {
  const [avatar,banner]=await Promise.all([profile.avatarUrl,profile.bannerUrl].map(async url=>url?checked(await fetchArt(url,http)):null));
  const colours=matchColours({banner:banner?.pixels??null,avatar:avatar?.pixels??null});
  return {profile,art:{avatar:avatar?.display??null,banner:banner?.display??null},skin:suggestSkin(colours,banner?'banner':'avatar')};
}
