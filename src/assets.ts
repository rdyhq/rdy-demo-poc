import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type pg from 'pg';
import { AppError, invalid, unavailable, uuidPattern } from './domain.ts';

export const maxUpload=10*1024*1024;

export interface Objects {
  write(key:string,bytes:Buffer):Promise<void>;
  read(key:string):Promise<Uint8Array>;
}

export function localObjects(directory:string):Objects {
  const path=(key:string)=>{
    if (!/^[a-f0-9-]{36}\.webp$/.test(key)) throw new Error('Invalid object key');
    return join(directory,key);
  };
  return {
    async write(key,bytes) {
      await mkdir(directory,{recursive:true,mode:0o700});
      await writeFile(path(key),bytes,{mode:0o600,flag:'wx'});
    },
    async read(key) { return readFile(path(key)); },
  };
}

export function r2Objects(endpoint:string,bucket:string,accessKeyId:string,secretAccessKey:string):Objects {
  const client=new S3Client({region:'auto',endpoint,credentials:{accessKeyId,secretAccessKey},maxAttempts:2});
  return {
    async write(key,bytes) {
      await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'image/webp'}),{abortSignal:AbortSignal.timeout(8000)});
    },
    async read(key) {
      const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(8000)});
      if (!result.Body) throw new Error('Object unavailable');
      return result.Body.transformToByteArray();
    },
  };
}

export async function upload(pool:pg.Pool,objects:Objects,owner:string,file:File) {
  if (!(file instanceof File) || !file.size || file.size>maxUpload) throw invalid('image','Choose a JPEG, PNG or WebP under 10 MiB.');
  const id=randomUUID(), key=id+'.webp';
  await pool.query("INSERT INTO assets(id,owner_id,object_key,state) VALUES ($1,$2,$3,'pending')",[id,owner,key]);
  try {
    const input=sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:20_000_000,failOn:'error'});
    const info=await input.metadata().catch(()=>null);
    if (!info || !['jpeg','png','webp'].includes(info.format??'') || (info.pages??1)>1 ||
        !info.width || !info.height || info.width*info.height>20_000_000) {
      throw invalid('image','Choose a static JPEG, PNG or WebP under 20 megapixels.');
    }
    const output=await input.rotate().resize({width:1440,height:960,fit:'inside',withoutEnlargement:true})
      .webp({quality:84}).toBuffer({resolveWithObject:true}).catch(()=>{throw invalid('image','This image could not be processed.');});
    await objects.write(key,output.data);
    await pool.query("UPDATE assets SET state='ready',width=$2,height=$3 WHERE id=$1",[id,output.info.width,output.info.height]);
    return {id,state:'ready'};
  } catch(error) {
    await pool.query("UPDATE assets SET state='rejected' WHERE id=$1",[id]).catch(()=>{});
    throw error;
  }
}

export async function assetBytes(pool:pg.Pool,objects:Objects|null,owner:string,id:string) {
  if (!uuidPattern.test(id)) throw unavailable();
  const {rows}=await pool.query("SELECT object_key FROM assets WHERE owner_id=$1 AND id=$2 AND state='ready'",[owner,id]);
  if (!rows[0]) throw unavailable();
  if (!objects) throw new AppError(503,'storage_unavailable','Image storage is unavailable.');
  return objects.read(rows[0].object_key);
}
