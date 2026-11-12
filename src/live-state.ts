export type LiveState = {live:boolean; verified:boolean; viewers?:number; fixtureViewers?:number};

export async function liveState(_homeId:string,fixture?:string,env=process.env):Promise<LiveState> {
  if(env.LOBBY_DEV_DIR&&env.LOBBY_DEMO==='1'&&fixture==='1') {
    return {live:true,verified:true,viewers:1284,fixtureViewers:1296};
  }
  return {live:false,verified:false};
}
