// Reads the avatar and the cover of the draft as pixels for the art match. It never changes the art (RDY r-VQ3D2).
const size=48;

async function read(id) {
  const image=new Image();
  image.src='/editor/assets/'+encodeURIComponent(id);
  await image.decode();
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context) throw new Error('The canvas is unavailable.');
  context.drawImage(image,0,0,size,size);
  return context.getImageData(0,0,size,size).data;
}

// An image that cannot be read is left out. The match fails only when no image can be read.
export async function readArtPixels({avatarId,coverId}) {
  const [avatar,banner]=await Promise.all([avatarId,coverId].map(id=>id?read(id).catch(()=>null):null));
  if(!avatar&&!banner) throw new Error('No art could be read.');
  return {avatar,banner};
}
