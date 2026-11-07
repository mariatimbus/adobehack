import type { StudioVersion, StudioImage } from '../shared/studio';
import { blobDataUrl } from './conceptAssets';
export async function prepareVersionImages(version:StudioVersion):Promise<Record<string,Blob>> {
  const result:Record<string,Blob>={};
  for(const node of version.spec.nodes.filter(n=>n.type==='image'&&!version.nativeSources[n.id])){
    const url=version.assets[node.asset_id??node.id];
    if(!url)throw new Error('This image is unavailable. Upload the original artwork before creating a page.');
    const response=await fetch(url);if(!response.ok)throw new Error('Could not read a design image.');
    const bitmap=await createImageBitmap(await response.blob());
    try{
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(node.bbox[2]));canvas.height=Math.max(1,Math.round(node.bbox[3]));
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image preparation unavailable.');
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      result[node.id]=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not prepare image.')),'image/png'));
    }finally{bitmap.close();}
  }
  return result;
}
export async function readImageFiles(files:File[]):Promise<StudioImage[]> {
  return Promise.all(files.map(async(file,index)=>{
    if(!file.type.startsWith('image/'))throw new Error(`${file.name} is not an image.`);
    const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();
    return {id:`upload-${Date.now()}-${index}`,name:file.name,width,height,url:await blobDataUrl(file)};
  }));
}
