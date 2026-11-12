import { channelPlatform } from './home-cards.ts';

// The link format that the provider documents for its phone app.
// Twitch documents twitch://stream/<channel>. No other provider documents one for a channel.
export function appLink(streamUrl:string) {
  if(!streamUrl||channelPlatform(streamUrl)!=='twitch') return undefined;
  return 'twitch://stream/'+new URL(streamUrl).pathname.split('/')[1].toLowerCase();
}
