import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
export const root=process.cwd();
export const cfg={basePath:(process.env.APP_BASE_PATH||'').replace(/\/$/,''),host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||4312),db:{host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3397),user:process.env.DB_USER||'price_agent',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'price_agent',charset:'utf8mb4',connectionLimit:8,decimalNumbers:true,timezone:'Z'},vertexUrl:(process.env.VERTEX_BASE_URL||'').replace(/\/$/,''),vertexKey:process.env.VERTEX_API_KEY,model:process.env.VERTEX_MODEL||'gemini-3.8-flash',uploads:path.join(root,'.local/uploads')};
fs.mkdirSync(cfg.uploads,{recursive:true});
export class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const parse=(v,fallback={})=>{try{return typeof v==='string'?JSON.parse(v):v??fallback;}catch{return fallback;}};
export const cleanError=e=>String(e?.message||e).replace(/sk-[\w-]+/g,'[redacted]').slice(0,500);

if(cfg.basePath&&!/^\/[a-zA-Z0-9/_-]+$/.test(cfg.basePath))throw new Error('APP_BASE_PATH 格式不正确');
