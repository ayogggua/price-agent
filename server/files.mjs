import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import {PDFParse} from 'pdf-parse';
import {query,id,audit,tx,projectRow} from './db.mjs';
import {cfg,AppError} from './config.mjs';
const allowed=new Set(['.pdf','.docx','.xlsx','.csv','.txt','.md','.png','.jpg','.jpeg','.webp']);
const mimeFor={'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.csv':'text/csv','.txt':'text/plain','.md':'text/markdown','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
export const upload=multer({storage:multer.diskStorage({destination:cfg.uploads,filename:(_req,file,cb)=>cb(null,id()+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:20*1024*1024,files:10},fileFilter:(_req,file,cb)=>cb(allowed.has(path.extname(file.originalname).toLowerCase())?null:new AppError('支持 PDF、DOCX、XLSX、CSV、文本和常见图片'),true)}).array('files',10);
export async function persistFiles(req){
 const files=req.files||[];let committed=false;
 try{
  if(!files.length)throw new AppError('请选择需要上传的文件');
  const p=(await query('SELECT id FROM projects WHERE id=?',[req.body.projectId||'']))[0];
  if(!p)throw new AppError('请先保存项目');
  const n=(await query('SELECT COUNT(*) AS n FROM attachments WHERE project_id=?',[p.id]))[0].n;
  if(n+files.length>10)throw new AppError('每个项目最多 10 个附件');
  const records=[];
  for(const f of files){
   const ext=path.extname(f.filename),buffer=await fs.readFile(f.path);let text='',status='ready';
   try{
    if(ext==='.pdf'){
     if(buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('格式无效');
     const parser=new PDFParse({data:buffer});try{text=(await parser.getText({first:30})).text;}finally{await parser.destroy();}
    }else if(ext==='.docx')text=(await mammoth.extractRawText({buffer})).value;
    else if(ext==='.xlsx'){
     const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
     for(const sheet of book.worksheets.slice(0,5)){
      text+='\n'+sheet.name+'\n';
      sheet.eachRow((row,n)=>{if(n<=300)text+=row.values.slice(1).map(v=>typeof v==='object'?JSON.stringify(v):v).join('\t')+'\n';});
     }
    }else if(['.png','.jpg','.jpeg','.webp'].includes(ext))status='image';
    else text=buffer.toString('utf8');
   }catch{status='failed';}
   const name=Buffer.from(f.originalname,'latin1').toString('utf8');
   records.push([id(),p.id,name.includes('\uFFFD')?f.originalname:name,f.filename,mimeFor[ext],f.size,text.slice(0,120000),status,req.user.id]);
  }
  const project=await tx(async conn=>{
   const currentProject=(await query('SELECT * FROM projects WHERE id=? FOR UPDATE',[p.id],conn))[0];
   if(currentProject.revision!==Number(req.body.revision))throw new AppError('需求已更新，请刷新后重新上传附件',409);
   const current=(await query('SELECT COUNT(*) AS n FROM attachments WHERE project_id=?',[p.id],conn))[0].n;
   if(current+records.length>10)throw new AppError('每个项目最多 10 个附件');
   for(const record of records)await query('INSERT INTO attachments(id,project_id,display_name,stored_name,mime,size_bytes,text_content,parse_status,created_by) VALUES(?,?,?,?,?,?,?,?,?)',record,conn);
   await reviseProject(p.id,req.user,conn);
   await audit(req.user,'project',p.id,'upload',{files:records.length,revision:currentProject.revision+1},conn);
   return projectRow((await query('SELECT * FROM projects WHERE id=?',[p.id],conn))[0]);
  });
  committed=true;return {files:await listFiles(p.id),project};
 }catch(e){if(!committed)await Promise.all(files.map(f=>fs.unlink(f.path).catch(()=>{})));throw e;}
}
export async function listFiles(projectId){return query('SELECT id,project_id AS projectId,display_name AS name,mime,size_bytes AS size,parse_status AS parseStatus,created_at AS createdAt FROM attachments WHERE project_id=? ORDER BY created_at',[projectId]);}
async function reviseProject(projectId,user,conn){
 await query("UPDATE projects SET revision=revision+1,status=CASE WHEN status='analyzing' THEN status ELSE 'draft' END,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?",[user.id,projectId],conn);
}
export async function removeFile(fileId,user,revision){
 const f=(await query('SELECT * FROM attachments WHERE id=?',[fileId]))[0];
 if(!f)throw new AppError('附件不存在',404);
 const project=await tx(async conn=>{
  const p=(await query('SELECT * FROM projects WHERE id=? FOR UPDATE',[f.project_id],conn))[0];
  if(p.revision!==Number(revision))throw new AppError('需求已更新，请刷新后重新删除附件',409);
  await query('DELETE FROM attachments WHERE id=?',[fileId],conn);
  await reviseProject(f.project_id,user,conn);
  await audit(user,'project',f.project_id,'delete-file',{name:f.display_name,revision:p.revision+1},conn);
  return projectRow((await query('SELECT * FROM projects WHERE id=?',[f.project_id],conn))[0]);
 });
 await fs.unlink(path.join(cfg.uploads,f.stored_name)).catch(()=>{});
 return {project,files:await listFiles(f.project_id)};
}
