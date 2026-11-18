import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { load as loadHtml } from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { query, id, audit, tx, projectRow } from './db.mjs';
import { cfg, AppError } from './config.mjs';

const allowed = new Set(['.pdf', '.docx', '.xlsx', '.csv', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp']);

const mimeFor = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: cfg.uploads,
    filename: (_req, file, cb) => cb(null, id() + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(allowed.has(ext) ? null : new AppError('仅支持 PDF、DOCX、XLSX、CSV、TXT、MD 和常见图片格式'), allowed.has(ext));
  }
}).array('files', 10);

function normalizeFileName(rawName, fallbackExt) {
  let decoded = String(rawName || '');
  const isLatin1Bytes = decoded.length > 0 && [...decoded].every(ch => ch.charCodeAt(0) <= 0xff);
  const hasHighBytes = isLatin1Bytes && [...decoded].some(ch => ch.charCodeAt(0) >= 0x80);
  if (hasHighBytes) {
    const candidate = Buffer.from(decoded, 'latin1').toString('utf8');
    if (!candidate.includes('\uFFFD')) decoded = candidate;
  }
  let base = decoded
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/^\.+/, '');
  if (!base) base = 'attachment' + fallbackExt;
  if (base.length > 200) {
    const ext = path.extname(base) || fallbackExt;
    const stem = base.slice(0, Math.max(1, 200 - ext.length));
    base = stem + ext;
  }
  return base;
}

function verifyMagicBytes(ext, buffer, displayName) {
  if (!buffer || buffer.length === 0) {
    throw new AppError(`文件内容为空：${displayName}`);
  }
  let valid = true;
  if (ext === '.pdf') {
    valid = buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'));
  } else if (ext === '.png') {
    valid =
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } else if (ext === '.jpg' || ext === '.jpeg') {
    valid = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  } else if (ext === '.webp') {
    valid =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  } else if (ext === '.docx' || ext === '.xlsx') {
    valid =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  } else if (['.txt', '.md', '.csv'].includes(ext)) {
    const hasUtf16Bom =
      buffer.length >= 2 &&
      ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));
    if (!hasUtf16Bom && buffer.subarray(0, 4096).includes(0)) valid = false;
  }
  if (!valid) {
    throw new AppError(`文件内容与扩展名不匹配，请检查文件格式：${displayName}`);
  }
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buffer);
    } catch {
      return buffer.toString('utf8');
    }
  }
}

function cellToText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map(part => part?.text || '').join('');
    }
    if ('result' in value) {
      if (value.result && typeof value.result === 'object' && 'error' in value.result) return '';
      return cellToText(value.result);
    }
    if ('text' in value) {
      return String(value.text || value.hyperlink || '');
    }
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

async function extractDocxText(buffer) {
  try {
    const { value: html } = await mammoth.convertToHtml({ buffer });
    if (html && html.includes('<table')) {
      const $ = loadHtml(html);
      $('table').each((_, tbl) => {
        const rows = [];
        $(tbl)
          .find('tr')
          .each((__, tr) => {
            const cells = [];
            $(tr)
              .children('th,td')
              .each((___, cell) => {
                cells.push($(cell).text().replace(/\s+/g, ' ').trim());
              });
            if (cells.some(Boolean)) rows.push(cells.join('\t'));
          });
        $(tbl).replaceWith('\n' + rows.join('\n') + '\n');
      });
      $('p,h1,h2,h3,h4,h5,h6,li,br').each((_, el) => {
        $(el).append('\n');
      });
      const structured = $.root()
        .text()
        .replace(/[ \f\v]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (structured) return structured;
    }
  } catch {}
  return (await mammoth.extractRawText({ buffer })).value;
}

export async function persistFiles(req) {
  const files = req.files || [];
  let committed = false;
  try {
    if (!files.length) throw new AppError('请选择需要上传的文件');
    const p = (await query('SELECT id FROM projects WHERE id=?', [String(req.body.projectId || '')]))[0];
    if (!p) throw new AppError('请先保存项目', 404);
    const n = (await query('SELECT COUNT(*) AS n FROM attachments WHERE project_id=?', [p.id]))[0].n;
    if (n + files.length > 10) throw new AppError('每个项目最多上传 10 个附件');
    const records = [];
    for (const f of files) {
      const ext = path.extname(f.filename).toLowerCase();
      const displayName = normalizeFileName(f.originalname, ext);
      const buffer = await fs.readFile(f.path);
      verifyMagicBytes(ext, buffer, displayName);
      let text = '';
      let status = 'ready';
      try {
        if (ext === '.pdf') {
          const parser = new PDFParse({ data: buffer });
          try {
            text = (await parser.getText({ first: 60 })).text || '';
          } finally {
            await parser.destroy();
          }
        } else if (ext === '.docx') {
          text = await extractDocxText(buffer);
        } else if (ext === '.xlsx') {
          const book = new ExcelJS.Workbook();
          await book.xlsx.load(buffer);
          for (const sheet of book.worksheets.slice(0, 10)) {
            const lines = [];
            let count = 0;
            sheet.eachRow((row) => {
              if (count >= 500) return;
              const vals = row.values
                .slice(1)
                .map(v => cellToText(v).replace(/[\r\n\t]+/g, ' ').trim());
              if (vals.some(Boolean)) {
                lines.push(vals.join('\t'));
                count++;
              }
            });
            if (lines.length) {
              text += `\n[${sheet.name}]\n` + lines.join('\n') + '\n';
            }
          }
        } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          status = 'image';
        } else {
          text = decodeTextBuffer(buffer);
        }
      } catch {
        status = 'failed';
      }
      records.push([
        id(),
        p.id,
        displayName,
        f.filename,
        mimeFor[ext] || 'application/octet-stream',
        f.size,
        text.slice(0, 180000),
        status,
        req.user.id
      ]);
    }
    const project = await tx(async conn => {
      const currentProject = (await query('SELECT * FROM projects WHERE id=? FOR UPDATE', [p.id], conn))[0];
      if (!currentProject) throw new AppError('项目不存在', 404);
      if (currentProject.revision !== Number(req.body.revision)) {
        throw new AppError('需求已更新，请刷新后重新上传附件', 409);
      }
      const current = (await query('SELECT COUNT(*) AS n FROM attachments WHERE project_id=?', [p.id], conn))[0].n;
      if (current + records.length > 10) throw new AppError('每个项目最多上传 10 个附件');
      for (const record of records) {
        await query(
          'INSERT INTO attachments(id, project_id, display_name, stored_name, mime, size_bytes, text_content, parse_status, created_by) VALUES(?,?,?,?,?,?,?,?,?)',
          record,
          conn
        );
      }
      await reviseProject(p.id, req.user, conn);
      await audit(req.user, 'project', p.id, 'upload', { files: records.length, revision: currentProject.revision + 1 }, conn);
      return projectRow((await query('SELECT * FROM projects WHERE id=?', [p.id], conn))[0]);
    });
    committed = true;
    return { files: await listFiles(p.id), project };
  } catch (e) {
    if (!committed) {
      await Promise.all(files.map(f => fs.unlink(f.path).catch(() => {})));
    }
    throw e;
  }
}

export async function listFiles(projectId) {
  return query(
    'SELECT id, project_id AS projectId, display_name AS name, mime, size_bytes AS size, parse_status AS parseStatus, created_at AS createdAt FROM attachments WHERE project_id=? ORDER BY created_at',
    [projectId]
  );
}

async function reviseProject(projectId, user, conn) {
  await query(
    "UPDATE projects SET revision=revision+1, status=CASE WHEN status='analyzing' THEN status ELSE 'draft' END, updated_by=?, updated_at=UTC_TIMESTAMP(3) WHERE id=?",
    [user.id, projectId],
    conn
  );
}

export async function removeFile(fileId, user, revision) {
  const f = (await query('SELECT * FROM attachments WHERE id=?', [String(fileId || '')]))[0];
  if (!f) throw new AppError('附件不存在', 404);
  const project = await tx(async conn => {
    const p = (await query('SELECT * FROM projects WHERE id=? FOR UPDATE', [f.project_id], conn))[0];
    if (!p) throw new AppError('项目不存在', 404);
    if (p.revision !== Number(revision)) {
      throw new AppError('需求已更新，请刷新后重新删除附件', 409);
    }
    await query('DELETE FROM attachments WHERE id=?', [f.id], conn);
    await reviseProject(f.project_id, user, conn);
    await audit(user, 'project', f.project_id, 'delete-file', { name: f.display_name, revision: p.revision + 1 }, conn);
    return projectRow((await query('SELECT * FROM projects WHERE id=?', [f.project_id], conn))[0]);
  });
  await fs.unlink(path.join(cfg.uploads, f.stored_name)).catch(() => {});
  return { project, files: await listFiles(f.project_id) };
}
