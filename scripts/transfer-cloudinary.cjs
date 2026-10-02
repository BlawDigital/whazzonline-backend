require('dotenv/config');
const { readFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const { PrismaService } = require('../dist/prisma/prisma.service');
const {
  uploadCloudinary,
  cloudinaryClient,
} = require('../dist/src/storage/cloudinary-storage');
const apply = process.argv.includes('--apply');
const root = resolve(process.env.UPLOAD_DIR || 'uploads');
const db = new PrismaService();
const cache = new Map();
const mime = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
let references = 0,
  missing = 0,
  updated = 0;
async function replace(value, sensitive = false) {
  if (typeof value === 'string') {
    let path = value;
    if (/^https?:/.test(path)) {
      try {
        path = new URL(path).pathname;
      } catch {
        return value;
      }
    }
    if (!path.startsWith('/uploads/')) return value;
    const local = resolve(
      root,
      decodeURIComponent(path.slice('/uploads/'.length)),
    );
    if (!local.startsWith(root + sep))
      throw Error('Invalid legacy upload path.');
    const folder = path.split('/')[2];
    const privateAsset = sensitive || ['chat', 'disputes'].includes(folder);
    const cacheKey = `${privateAsset ? 'private' : 'public'}:${local}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    references++;
    let buffer;
    try {
      buffer = await readFile(local);
    } catch {
      missing++;
      return value;
    }
    if (!apply) return value;
    const result = await uploadCloudinary(
      buffer,
      mime[extname(local).toLowerCase()],
      folder,
      privateAsset,
    );
    const next = privateAsset
      ? cloudinaryClient().url(result.public_id, {
          type: 'authenticated',
          sign_url: true,
          secure: true,
          version: result.version,
          format: result.format,
        })
      : result.secure_url;
    cache.set(cacheKey, next);
    return next;
  }
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) next.push(await replace(item, sensitive));
    return next;
  }
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, item] of Object.entries(value))
      next[key] = await replace(item, sensitive);
    return next;
  }
  return value;
}
async function main() {
  const models = {
    user: ['avatarUrl'],
    vendorProfile: ['logoUrl', 'bannerUrl', 'cacUrl'],
    product: ['imageUrls', 'variants'],
    chatMessage: ['imageUri', 'productContext'],
    commerceCartItem: ['imageUri'],
    commerceOrderItem: ['imageUri'],
    orderIssueReply: ['evidenceUrls'],
  };
  for (const [model, fields] of Object.entries(models)) {
    let cursor;
    while (true) {
      const rows = await db[model].findMany({
        take: 100,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          ...Object.fromEntries(fields.map((k) => [k, true])),
        },
      });
      if (!rows.length) break;
      for (const row of rows) {
        const data = {};
        for (const field of fields) {
          const next = await replace(row[field], field === 'cacUrl');
          if (JSON.stringify(next) !== JSON.stringify(row[field]))
            data[field] = next;
        }
        if (Object.keys(data).length) {
          await db[model].update({ where: { id: row.id }, data });
          updated++;
        }
      }
      cursor = rows.at(-1).id;
    }
  }
  const messages = await db.supportMessage.findMany({
    select: { id: true, attachments: true },
  });
  for (const message of messages) {
    let changed = false;
    const attachments = Array.isArray(message.attachments)
      ? message.attachments
      : [];
    for (const item of attachments) {
      if (item.cloudinary || !/^[0-9a-f-]{36}$/i.test(item.id)) continue;
      references++;
      let buffer;
      try {
        buffer = await readFile(resolve(`${root}-support-private`, item.id));
      } catch {
        missing++;
        continue;
      }
      if (!apply) continue;
      const result = await uploadCloudinary(
        buffer,
        item.mimeType,
        'support',
        true,
        item.id,
      );
      item.cloudinary = {
        publicId: result.public_id,
        resourceType: result.resource_type,
        format: result.format || '',
      };
      changed = true;
    }
    if (changed) {
      await db.supportMessage.update({
        where: { id: message.id },
        data: { attachments },
      });
      updated++;
    }
  }
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      references,
      missingFiles: missing,
      updatedRecords: updated,
    }),
  );
  if (missing) process.exitCode = 2;
}
main()
  .catch(() => {
    console.error(
      'Transfer failed; existing files were retained. Check storage configuration and database access.',
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
