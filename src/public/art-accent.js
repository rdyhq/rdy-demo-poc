import { toHsl } from './contrast.js';

const sampleSize=48;
async function readArt(id) {
  const image=new Image();
  image.src='/editor/assets/'+encodeURIComponent(id);
  await image.decode();
  return image;
}

export async function matchArtAccent(ids) {
  const results=await Promise.allSettled(ids.map(readArt));
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=sampleSize;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx) return null;
  const bins=Array.from({length:24},()=>({count:0,channels:[0,0,0]}));
  for(const image of results) {
    if(image.status!=='fulfilled') continue;
    ctx.clearRect(0,0,sampleSize,sampleSize);
    ctx.drawImage(image.value,0,0,sampleSize,sampleSize);
    const pixels=ctx.getImageData(0,0,sampleSize,sampleSize).data;
    for(let i=0;i<pixels.length;i+=4) {
      if(pixels[i+3]<192) continue;
      const channels=[pixels[i],pixels[i+1],pixels[i+2]];
      const [hue,saturation,lightness]=toHsl(channels.map(channel=>channel/255));
      if(saturation<.3||lightness<.12||lightness>.88) continue;
      const bin=bins[Math.round(hue*4)%24];
      bin.count++;
      for(const [index,value] of channels.entries()) bin.channels[index]+=value;
    }
  }
  const winner=bins.reduce((left,right)=>left.count>=right.count?left:right);
  if(!winner.count) return null;
  return '#'+winner.channels.map(channel=>Math.round(channel/winner.count).toString(16).padStart(2,'0')).join('');
}
