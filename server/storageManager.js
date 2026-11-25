import fs from 'node:fs';
import path from 'node:path';

// Keep total server cache strictly below 2 GB (1.85 GB safe ceiling leaves headroom for OS & DB)
export const MAX_STORAGE_BYTES = Math.floor(1.85 * 1024 * 1024 * 1024);
export const HARD_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

function walkFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(full);
        results.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs, name: entry.name });
      } catch {
        // ignore vanished file
      }
    }
  }
  return results;
}

export function getStorageStats(paths) {
  const images = walkFiles(paths.IMAGES_DIR);
  const transfers = walkFiles(paths.TRANSFERS_DIR);
  const sounds = walkFiles(paths.SOUNDS_DIR);
  const music = walkFiles(paths.MUSIC_DIR);
  const avatars = walkFiles(paths.AVATARS_DIR);
  const models = paths.MODELS_CACHE_DIR ? walkFiles(paths.MODELS_CACHE_DIR) : [];

  const sum = (arr) => arr.reduce((acc, f) => acc + f.size, 0);
  const vaultBytes = fs.existsSync(paths.MESSAGES_VAULT_FILE)
    ? fs.statSync(paths.MESSAGES_VAULT_FILE).size
    : 0;
  const dbBytes = fs.existsSync(paths.DB_FILE) ? fs.statSync(paths.DB_FILE).size : 0;

  const breakdown = {
    imagesBytes: sum(images) + sum(models),
    transfersBytes: sum(transfers),
    soundsBytes: sum(sounds),
    musicBytes: sum(music),
    avatarsBytes: sum(avatars),
    messagesVaultBytes: vaultBytes + dbBytes,
  };

  const totalBytes =
    breakdown.imagesBytes +
    breakdown.transfersBytes +
    breakdown.soundsBytes +
    breakdown.musicBytes +
    breakdown.avatarsBytes +
    breakdown.messagesVaultBytes;

  return {
    totalBytes,
    maxBytes: HARD_LIMIT_BYTES,
    softCapBytes: MAX_STORAGE_BYTES,
    percentUsed: Math.min(100, Number(((totalBytes / HARD_LIMIT_BYTES) * 100).toFixed(1))),
    fileCount: images.length + transfers.length + sounds.length + music.length + avatars.length,
    breakdown,
  };
}

/**
 * Automatically prunes oldest cached heavy files (transfers first, then chat images, then music)
 * so the app NEVER exceeds the 2 GB cap while preserving ALL encrypted text messages & profiles!
 */
export function enforceStorageLimit(paths, incomingBytes = 0, onPruned = null) {
  const stats = getStorageStats(paths);
  let projected = stats.totalBytes + Math.max(0, incomingBytes);
  if (projected <= MAX_STORAGE_BYTES) {
    return { prunedCount: 0, freedBytes: 0, totalBytes: stats.totalBytes };
  }

  // Prunable pool ordered by priority: expired/old transfers -> old chat media -> old uploaded music
  // NEVER touches avatars, starter sounds, or encrypted text message vault!
  const candidates = [
    ...walkFiles(paths.TRANSFERS_DIR).map((f) => ({ ...f, bucket: 'transfers', priority: 1 })),
    ...(paths.MODELS_CACHE_DIR
      ? walkFiles(paths.MODELS_CACHE_DIR).map((f) => ({ ...f, bucket: 'models', priority: 2 }))
      : []),
    ...walkFiles(paths.IMAGES_DIR).map((f) => ({ ...f, bucket: 'images', priority: 3 })),
    ...walkFiles(paths.MUSIC_DIR).map((f) => ({ ...f, bucket: 'music', priority: 4 })),
  ].sort((a, b) => a.priority - b.priority || a.mtimeMs - b.mtimeMs);

  let prunedCount = 0;
  let freedBytes = 0;

  for (const file of candidates) {
    if (projected <= MAX_STORAGE_BYTES) break;
    try {
      fs.unlinkSync(file.path);
      projected -= file.size;
      freedBytes += file.size;
      prunedCount += 1;
      onPruned?.({
        bucket: file.bucket,
        filename: file.name,
        relUrl: `/uploads/${file.bucket}/${file.name}`,
      });
    } catch {
      // ignore if locked
    }
  }

  return { prunedCount, freedBytes, totalBytes: Math.max(0, projected) };
}

export function clearMediaCache(paths, onPruned = null) {
  const candidates = [
    ...walkFiles(paths.TRANSFERS_DIR).map((f) => ({ ...f, bucket: 'transfers' })),
    ...walkFiles(paths.IMAGES_DIR).map((f) => ({ ...f, bucket: 'images' })),
    ...(paths.MODELS_CACHE_DIR ? walkFiles(paths.MODELS_CACHE_DIR).map((f) => ({ ...f, bucket: 'models' })) : []),
  ];
  let prunedCount = 0;
  let freedBytes = 0;
  for (const file of candidates) {
    try {
      fs.unlinkSync(file.path);
      freedBytes += file.size;
      prunedCount += 1;
      onPruned?.({
        bucket: file.bucket,
        filename: file.name,
        relUrl: `/uploads/${file.bucket}/${file.name}`,
      });
    } catch {
      // ignore
    }
  }
  return { prunedCount, freedBytes, stats: getStorageStats(paths) };
}
