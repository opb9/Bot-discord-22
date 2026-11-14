import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { BUILTIN_JOBS, GenderKey } from "../data/botData";

const AVATARS_DIR = path.resolve(process.cwd(), "avatars");

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Generates a clean 256x256 transparent-background RGBA PNG emblem for a job + gender.
 * Never overwrites existing files so user-uploaded PNGs (like programmer_male.png) remain untouched.
 */
function renderTransparentBadgePng(colorHex: string, gender: GenderKey, seedIndex: number): Buffer {
  const size = 256;
  const raw = Buffer.alloc((1 + size * 4) * size, 0); // RGBA alpha=0 transparent canvas
  const [r0, g0, b0] = hexToRgb(colorHex);
  const accent: [number, number, number] =
    gender === "female" ? [244, 114, 182] : [96, 165, 250];

  const cx = size / 2;
  const cy = size / 2;
  const outerR = 114;
  const ringInner = 100;
  const coreR = 92;

  // Deterministic geometric inner symbol motif based on seedIndex % 6
  const motif = seedIndex % 6;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // PNG filter type 0
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const px = rowStart + 1 + x * 4;

      if (dist > outerR + 1.5) {
        // Transparent outside circle
        continue;
      }

      // Anti-aliased outer ring
      if (dist >= ringInner) {
        const alphaEdge = dist > outerR ? Math.max(0, 1 - (dist - outerR) / 1.5) : 1;
        const mix = (Math.sin(Math.atan2(dy, dx) * 2 + seedIndex) + 1) * 0.5;
        raw[px] = Math.round(r0 * (1 - mix * 0.35) + accent[0] * (mix * 0.35));
        raw[px + 1] = Math.round(g0 * (1 - mix * 0.35) + accent[1] * (mix * 0.35));
        raw[px + 2] = Math.round(b0 * (1 - mix * 0.35) + accent[2] * (mix * 0.35));
        raw[px + 3] = Math.round(255 * alphaEdge);
        continue;
      }

      if (dist <= coreR) {
        // Dark studio radial gradient inside badge
        const grad = 1 - dist / coreR;
        let rr = Math.round(16 + r0 * 0.22 * grad);
        let gg = Math.round(20 + g0 * 0.22 * grad);
        let bb = Math.round(38 + b0 * 0.25 * grad);

        // Crisp vector-style emblem shape in white/gold center
        let inSymbol = false;
        if (motif === 0) {
          // Medical / Academic Cross
          inSymbol = (Math.abs(dx) < 12 && Math.abs(dy) < 40) || (Math.abs(dy) < 12 && Math.abs(dx) < 40);
        } else if (motif === 1) {
          // Diamond Star / Crest
          inSymbol = Math.abs(dx) + Math.abs(dy) < 46 && Math.abs(dx) + Math.abs(dy) > 22;
        } else if (motif === 2) {
          // Hex / Tech Ring
          inSymbol =
            Math.max(Math.abs(dx), Math.abs(dx) * 0.5 + Math.abs(dy) * 0.866) < 42 &&
            Math.max(Math.abs(dx), Math.abs(dx) * 0.5 + Math.abs(dy) * 0.866) > 26;
        } else if (motif === 3) {
          // Chevron / Rank Wings
          inSymbol = Math.abs(dy + Math.abs(dx) * 0.65 - 10) < 9 && Math.abs(dx) < 44;
        } else if (motif === 4) {
          // Orbital Atom Rings
          const e1 = Math.hypot(dx * 0.65 - dy * 0.75, (dx * 0.75 + dy * 0.65) * 2.1);
          const e2 = Math.hypot(dx * 0.65 + dy * 0.75, (-dx * 0.75 + dy * 0.65) * 2.1);
          inSymbol = Math.abs(e1 - 36) < 4 || Math.abs(e2 - 36) < 4 || dist < 10;
        } else {
          // Crown / Trophy Pillars
          inSymbol =
            (Math.abs(dy - 24) < 8 && Math.abs(dx) < 36) ||
            (dy > -26 && dy < 24 && (Math.abs(dx) < 6 || Math.abs(Math.abs(dx) - 24) < 6));
        }

        if (inSymbol) {
          rr = Math.min(255, Math.round(r0 * 0.45 + 160));
          gg = Math.min(255, Math.round(g0 * 0.45 + 160));
          bb = Math.min(255, Math.round(b0 * 0.45 + 165));
        }

        raw[px] = rr;
        raw[px + 1] = gg;
        raw[px + 2] = bb;
        raw[px + 3] = 238;
      } else {
        // Subtle transparent halo between coreR and ringInner
        raw[px] = r0;
        raw[px + 1] = g0;
        raw[px + 2] = b0;
        raw[px + 3] = 45;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA (truecolor + alpha transparency)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function ensureDefaultJobAvatars(): number {
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
  let created = 0;
  const entries = Object.entries(BUILTIN_JOBS);
  entries.forEach(([jobId, info], idx) => {
    for (const gender of ["male", "female"] as GenderKey[]) {
      const target = path.join(AVATARS_DIR, `${jobId}_${gender}.png`);
      // Never overwrite user-uploaded PNGs (like programmer_male.png)
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, renderTransparentBadgePng(info.color, gender, idx));
        created++;
      }
    }
  });
  return created;
}

export function resolveAvatarUrl(jobId: string | null, gender: GenderKey | null): string | null {
  if (!jobId) return null;
  const g = gender || "male";
  const candidates = [
    `${jobId}_${g}.png`,
    `${jobId}.png`,
    `${jobId}_male.png`,
    `${jobId}_female.png`,
  ];
  for (const filename of candidates) {
    if (fs.existsSync(path.join(AVATARS_DIR, filename))) {
      return `/avatars/${filename}`;
    }
  }
  return null;
}

export function resolveAvatarFsPath(jobId: string | null, gender: GenderKey | null): string | null {
  const url = resolveAvatarUrl(jobId, gender);
  if (!url) return null;
  return path.join(AVATARS_DIR, path.basename(url));
}
