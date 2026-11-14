import { DatabaseSync } from "node:sqlite";
import { withTransaction } from "../database/db";
import { AppError, requireAdmin, requireRegisteredUser } from "../security/auth";
import { debitBankInTx } from "./bankService";
import { BACKGROUNDS, BUILTIN_JOBS, SHOP_QUOTES, THEMES } from "../data/botData";

export const ONE_PIECE_CHARACTERS = [
  {
    id: "joyboy",
    kind: "character" as const,
    name: "Joy Boy",
    title: "جوي بوي (One Piece)",
    emoji: "👒",
    maleLabel: "Joy Boy",
    femaleLabel: "Joy Boy",
    color: "#F59E0B",
    price: 100000,
    repeatable: 0,
  },
  {
    id: "luffy",
    kind: "character" as const,
    name: "Luffy",
    title: "مونكي دي لوفي (One Piece)",
    emoji: "🏴‍☠️",
    maleLabel: "Monkey D. Luffy",
    femaleLabel: "Monkey D. Luffy",
    color: "#EF4444",
    price: 50000,
    repeatable: 0,
  },
  {
    id: "charlotte_linlin",
    kind: "character" as const,
    name: "Charlotte Linlin",
    title: "شارلوت لينلين (One Piece)",
    emoji: "👑",
    maleLabel: "Charlotte Linlin",
    femaleLabel: "Charlotte Linlin",
    color: "#EC4899",
    price: 75000,
    repeatable: 0,
  },
];

import { resolveAvatarUrl } from "../database/avatarGenerator";
import { levelInfo } from "../data/botData";

export function seedDefaultProducts(db: DatabaseSync): void {
  const upsertJob = db.prepare(
    `INSERT INTO shop_products (
      id, kind, name, title, emoji, male_label, female_label, color, price, repeatable, is_active, image_path,
      min_level, salary, required_week_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      title = excluded.title,
      emoji = excluded.emoji,
      male_label = excluded.male_label,
      female_label = excluded.female_label,
      color = excluded.color,
      price = excluded.price,
      image_path = excluded.image_path,
      min_level = excluded.min_level,
      salary = excluded.salary,
      required_week_minutes = excluded.required_week_minutes`
  );

  const insert = db.prepare(
    `INSERT OR IGNORE INTO shop_products (
      id, kind, name, title, emoji, male_label, female_label, color, price, repeatable, is_active, image_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );

  for (const [key, info] of Object.entries(BUILTIN_JOBS)) {
    const avatarUrl = resolveAvatarUrl(key, "male") || `/avatars/${key}_male.png`;
    upsertJob.run(
      key,
      "job",
      info.title,
      info.title,
      info.emoji,
      info.male,
      info.female,
      info.color,
      info.price,
      avatarUrl,
      info.minLevel,
      info.salary,
      info.requiredWeekMinutes
    );
  }

  for (const ch of ONE_PIECE_CHARACTERS) {
    insert.run(
      ch.id,
      ch.kind,
      ch.name,
      ch.title,
      ch.emoji,
      ch.maleLabel,
      ch.femaleLabel,
      ch.color,
      ch.price,
      ch.repeatable,
      null
    );
  }

  for (const [key, item] of Object.entries(BACKGROUNDS)) {
    insert.run(`bg:${key}`, "bg", item.name, item.name, "🖼️", null, null, "#4169E1", item.price, 0, null);
  }
  for (const [key, item] of Object.entries(THEMES)) {
    insert.run(`theme:${key}`, "theme", item.name, item.name, "🎨", null, null, item.color, item.price, 0, null);
  }
  for (const [key, item] of Object.entries(SHOP_QUOTES)) {
    insert.run(`quote:${key}`, "quote", item.name, item.name, "💬", null, null, "#FFD166", item.price, 0, null);
  }
}

export function listProducts(db: DatabaseSync) {
  return db
    .prepare("SELECT * FROM shop_products WHERE is_active = 1 ORDER BY kind, min_level ASC, price ASC")
    .all() as Array<{
    id: string;
    kind: "job" | "character" | "bg" | "theme" | "quote";
    name: string;
    title: string;
    emoji: string;
    male_label: string | null;
    female_label: string | null;
    color: string;
    price: number;
    repeatable: number;
    image_path: string | null;
    min_level: number;
    salary: number;
    required_week_minutes: number;
  }>;
}

export function getUserInventory(db: DatabaseSync, userId: string) {
  return db
    .prepare(
      `SELECT ui.product_id, ui.variant, ui.purchased_at, sp.kind, sp.name, sp.title, sp.emoji, sp.color
       FROM user_inventory ui
       JOIN shop_products sp ON sp.id = ui.product_id
       WHERE ui.user_id = ?
       ORDER BY ui.id DESC`
    )
    .all(userId);
}

export function getPurchaseHistory(db: DatabaseSync, userId: string) {
  return db
    .prepare(
      `SELECT ph.*, sp.name, sp.emoji, sp.kind
       FROM purchase_history ph
       JOIN shop_products sp ON sp.id = ph.product_id
       WHERE ph.user_id = ?
       ORDER BY ph.id DESC LIMIT 30`
    )
    .all(userId);
}

export function buyProduct(
  db: DatabaseSync,
  params: {
    userId: string;
    productId: string;
    variant?: string;
    idempotencyKey?: string;
  }
) {
  const variant = params.variant || "default";
  return withTransaction(db, () => {
    if (params.idempotencyKey) {
      const seen = db
        .prepare("SELECT response_json FROM idempotency_keys WHERE key = ?")
        .get(params.idempotencyKey) as { response_json: string } | undefined;
      if (seen) return JSON.parse(seen.response_json);
    }

    const userRow = requireRegisteredUser(db, params.userId) as { xp: number; minutes: number };
    const product = db
      .prepare("SELECT * FROM shop_products WHERE id = ? AND is_active = 1")
      .get(params.productId) as
      | {
          id: string;
          kind: "job" | "character" | "bg" | "theme" | "quote";
          name: string;
          title: string;
          emoji: string;
          male_label: string | null;
          female_label: string | null;
          price: number;
          repeatable: number;
          min_level: number;
        }
      | undefined;

    if (!product) {
      throw new AppError("المنتج غير موجود في المتجر.", 404);
    }

    if (product.id === "student") {
      throw new AppError("شخصية الطالب تُفتح مجانًا بالدراسة وليس بالشراء.", 400);
    }

    const userLevel = levelInfo(Number(userRow.xp || 0)).level;
    if (product.min_level > 1 && userLevel < product.min_level) {
      throw new AppError(
        `🔒 هذه المهنة تتطلب الوصول إلى المستوى ${product.min_level} أولاً (مستواك الحالي: ${userLevel}).`,
        400
      );
    }

    const alreadyOwned = db
      .prepare("SELECT 1 FROM user_inventory WHERE user_id = ? AND product_id = ? AND variant = ?")
      .get(params.userId, product.id, variant);

    if (alreadyOwned) {
      if (product.repeatable === 0) {
        // Equip if already owned, no duplicate charge
        equipProductInTx(db, params.userId, product, variant);
        return {
          ok: true,
          equippedOnly: true,
          message: `✅ تم تفعيل ${product.emoji} ${product.name} (تملكه مسبقاً بدون خصم).`,
        };
      }
    }

    const userStats = db
      .prepare("SELECT minutes FROM users WHERE user_id = ?")
      .get(params.userId) as { minutes: number } | undefined;
    const { shopDiscountPct } = (() => {
      const m = userStats?.minutes ?? 0;
      if (m >= 3600) return { shopDiscountPct: 10 };
      if (m >= 300) return { shopDiscountPct: 5 };
      return { shopDiscountPct: 0 };
    })();

    const finalPrice =
      product.price > 0
        ? Math.max(1, Math.round(product.price * (1 - shopDiscountPct / 100)))
        : 0;

    if (finalPrice > 0) {
      debitBankInTx(db, {
        userId: params.userId,
        amount: finalPrice,
        txType: "shop_purchase",
        referenceId: `${product.id}:${variant}`,
        description: `شراء ${product.emoji} ${product.name} من المتجر${
          shopDiscountPct > 0 ? ` (خصم دراسة ${shopDiscountPct}%)` : ""
        }`,
      });
    }

    const now = new Date().toISOString();
    if (!alreadyOwned) {
      db.prepare(
        "INSERT INTO user_inventory (user_id, product_id, variant, purchased_at) VALUES (?, ?, ?, ?)"
      ).run(params.userId, product.id, variant, now);
    }
    db.prepare(
      "INSERT INTO purchase_history (user_id, product_id, variant, price_paid, idempotency_key, purchased_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(params.userId, product.id, variant, finalPrice, params.idempotencyKey ?? null, now);

    equipProductInTx(db, params.userId, product, variant);

    const result = {
      ok: true,
      equippedOnly: false,
      pricePaid: finalPrice,
      discountPct: shopDiscountPct,
      message: `🛒 تم شراء وتفعيل ${product.emoji} ${product.name} بـ ${finalPrice.toLocaleString()} عملة${
        shopDiscountPct > 0 ? ` (بعد خصم الدراسة ${shopDiscountPct}%)` : ""
      }!`,
    };

    if (params.idempotencyKey) {
      db.prepare(
        "INSERT INTO idempotency_keys (key, operation, response_json, created_at) VALUES (?, 'shop_buy', ?, ?)"
      ).run(params.idempotencyKey, JSON.stringify(result), now);
    }

    return result;
  });
}

function equipProductInTx(
  db: DatabaseSync,
  userId: string,
  product: { id: string; kind: string },
  variant: string
) {
  if (product.kind === "job" || product.kind === "character") {
    if (variant === "male" || variant === "female") {
      db.prepare("UPDATE users SET job = ?, gender = ? WHERE user_id = ?").run(
        product.id,
        variant,
        userId
      );
    } else {
      db.prepare("UPDATE users SET job = ? WHERE user_id = ?").run(product.id, userId);
    }
  } else if (product.kind === "bg") {
    const key = product.id.replace(/^bg:/, "");
    db.prepare("UPDATE users SET bg = ? WHERE user_id = ?").run(key, userId);
  } else if (product.kind === "theme") {
    const key = product.id.replace(/^theme:/, "");
    db.prepare("UPDATE users SET theme = ? WHERE user_id = ?").run(key, userId);
  } else if (product.kind === "quote") {
    const key = product.id.replace(/^quote:/, "");
    db.prepare("UPDATE users SET quote = ? WHERE user_id = ?").run(key, userId);
  }
}

export function addCustomProductAdmin(
  db: DatabaseSync,
  actorId: string,
  input: {
    id: string;
    kind: "job" | "character" | "bg" | "theme" | "quote";
    name: string;
    title: string;
    emoji: string;
    maleLabel?: string;
    femaleLabel?: string;
    color?: string;
    price: number;
  }
) {
  requireAdmin(db, actorId);
  const key = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_:]+$/.test(key)) {
    throw new AppError("معرف المنتج يجب أن يحتوي أحرفاً إنجليزية صغيرة وأرقاماً فقط.", 400);
  }
  if (!input.name.trim() || input.price < 0) {
    throw new AppError("اسم المنتج والسعر مطلوبان.", 400);
  }
  db.prepare(
    `INSERT INTO shop_products (
      id, kind, name, title, emoji, male_label, female_label, color, price, repeatable, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`
  ).run(
    key,
    input.kind,
    input.name.trim(),
    input.title.trim() || input.name.trim(),
    input.emoji.trim() || "⭐",
    input.maleLabel?.trim() || input.name.trim(),
    input.femaleLabel?.trim() || input.name.trim(),
    input.color || "#5865F2",
    input.price
  );
  return { ok: true, id: key };
}
