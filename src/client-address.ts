// Each trusted proxy appends the address of the peer that connected to it.
// The client is the entry that the outermost trusted proxy appended.
export function clientAddress(remote:string|undefined,forwardedFor:string|undefined,trustedHops:number) {
  const address=remote??'unknown';
  if(trustedHops<1) return address;
  const chain=(forwardedFor??'').split(',').map(entry=>entry.trim()).filter(Boolean);
  // A shorter chain did not pass through every trusted proxy. Do not trust it.
  return chain.length<trustedHops?address:chain[chain.length-trustedHops];
}

export function trustedProxyHops(value:string|undefined) {
  if(value===undefined) return 0;
  if(!/^[0-5]$/.test(value)) throw new Error('LOBBY_TRUST_PROXY must be the number of trusted proxies, 0 to 5.');
  return Number(value);
}
