# البنية المعمارية للمشروع — `study-bot`

## 1. نظرة عامة وتكييف بيئة التشغيل

انطلق المشروع من مستودع `opb9/study-bot` (تطبيق بوت Discord مكتوب بـ Python / `discord.py` / `sqlite3` / `Pillow`).
بسبب بيئة التشغيل المعتمدة في AI Studio (حاوية Node.js 22 بدون مدير الحزم `pip3` أو حزمة `discord.py`)، تم تنفيذ تكييف معماري كامل إلى بيئة **Web Full-Stack TypeScript** مع الحفاظ الصارم على:
- هوية المشروع (`study-bot`) والأصول البصرية (`/avatars/programmer_male.png`).
- التوقيت المحلي المعتمد: **توقيت العراق `UTC+3`** في حساب الأيام والأسابيع وسلاسل الأيام والطوابع الزمنية.
- اللغة العربية كلغة أساسية لجميع الواجهات والرسائل والتنبيهات.
- قاعدة بيانات علائقية حقيقية في **SQLite** عبر وحدة `node:sqlite` (`DatabaseSync`) مع وضع `WAL` ومعاملات `BEGIN IMMEDIATE`.

> **ملاحظة شفافة حول Discord Gateway**: هذا المستودع يشغّل الواجهة التفاعلية الكاملة وخادم REST API وقاعدة البيانات SQLite على المنفذ `3000`. ربط البوت فعلياً بخادم Discord Gateway الحيّ (`discord.py` / `discord.js`) يتطلب تشغيل محوّل Gateway خارجي على مضيف يدعم `DISCORD_TOKEN` ويربط أوامر Slash/Buttons بهذه الخدمات أو بنفس قاعدة SQLite.

---

## 2. فصل المسؤوليات (Layered Architecture)

```text
/
├── server.ts                       # خادم Express 5 + بوابة API + حماية الصلاحيات + استعادة الجلسات
├── src/
│   ├── config/
│   │   └── settings.ts             # الثوابت المالية والدراسية والزمنية (UTC+3، القروض، التحديات، النقابات)
│   ├── database/
│   │   ├── db.ts                   # فتح SQLite (WAL + FK) + نظام Migrations مرقمة (v1..v4) + withTransaction
│   │   └── seed.ts                 # بيانات التأسيس (غرف معتمدة، منتجات ون بيس، مهن، رتب، مناصب، لاعبين)
│   ├── security/
│   │   └── auth.ts                 # AppError، requireRegisteredUser، requireAdmin، idempotency، audit_logs
│   ├── services/
│   │   ├── registrationService.ts  # التسجيل الإلزامي + فتح الحساب البنكي + مكافأة التسجيل
│   │   ├── bankService.ts          # الحساب البنكي المستقل + السجل الدائم bank_ledger + التحويل + الإيداع/الحجز
│   │   ├── loanService.ts          # القروض (3,000-10,000) + رسوم 50% + الاستقطاع التلقائي 50% + حفظ الديون القديمة
│   │   ├── studyService.ts         # الدراسة العادية والموثقة بالشاشة + منع التداخل + استعادة الانقطاع
│   │   ├── challengeService.ts     # التحديات (1v1..8v8) + الحجز الذري Escrow + السرية + التسوية + تدخل الإدارة
│   │   ├── shopService.ts          # المتجر + شخصيات ون بيس + منع التكرار + سجل المشتريات
│   │   ├── guildService.ts         # النقابات (الإنشاء Lv>=25، الانضمام قبل Lv25، الدعوات، السجل، المتصدرون)
│   │   ├── economyService.ts       # الرواتب والمناصب (salary_claims) + الرتب + لوحات المتصدرين والإحصاءات
│   │   └── backupService.ts        # النسخ الاحتياطي الموثق (VACUUM INTO + PRAGMA integrity_check + سياسة الاحتفاظ)
│   ├── components/                 # مكونات واجهة React التفاعلية RTL (البطاقة، الدراسة، التحديات، البنك، المتجر، النقابات، الإدارة...)
│   ├── data/botData.ts             # ثوابت واجهة المستخدم ودليل الأوامر والفعاليات
│   ├── types.ts                    # عقود TypeScript المشتركة بين الواجهة والخادم
│   └── App.tsx                     # الحاوية الرئيسية والتنقل وتبديل الحساب النشط وبوابة التسجيل
└── tests/                          # اختبارات Node Test Runner (node:test) على قواعد SQLite معزولة
    ├── bank_loans.test.ts
    ├── challenges.test.ts
    ├── study.test.ts
    └── shop_guilds_backup.test.ts
```

---

## 3. تصميم قاعدة البيانات والترحيلات (SQLite Schema & Migrations)

تُدار الجداول عبر مصفوفة `MIGRATIONS` في `src/database/db.ts` وتُوثّق في `schema_migrations` بحيث تكون آمنة عند إعادة التشغيل (`Idempotent`):

1. **Migration v1 — المستخدمون والدراسة**:
   - `users`: بيانات اللاعب، الخبرة `xp`، دقائق الدراسة الكلية `minutes` والموثقة `verified_minutes`، `rules_accepted`، `registered`، `is_admin`.
   - `approved_study_rooms`: الغرف الصوتية المعتمدة.
   - `study_sessions` و `study_screen_segments`: تتبع الجلسات النشطة والمغلقة وفترات مشاركة الشاشة بدقة.
   - `study_daily_log`: سجل يومي بتوقيت العراق (`YYYY-MM-DD`) لفصل الدقائق العادية والموثقة ومنع التضاعف.
2. **Migration v2 — البنك، السجل الدائم، ومنع التكرار، والقروض**:
   - `bank_accounts`: رقم حساب فريد `SB-XXXXXXXX`، رصيد متاح `available_balance` (`>= 0`)، ورصيد محجوز `reserved_balance` (`>= 0`).
   - `bank_ledger`: دفتر أستاذ غير قابل للتعديل يوثق كل عملية مالية مع الرصيد بعد العملية و`idempotency_key` فريد.
   - `idempotency_keys`: لمنع تكرار العمليات المالية عند النقر المتكرر أو إعادة الإرسال.
   - `loans` و `loan_repayments`: القروض النشطة والقديمة `legacy` وتوثيق كل استقطاع تلقائي بنسبة 50%.
3. **Migration v3 — المتجر والمخزون، الرواتب، الرتب، التحديات، النقابات، التدقيق**:
   - `shop_products`, `user_inventory`, `purchase_history`
   - `positions`, `position_members`, `salary_claims` (`UNIQUE(user_id, claim_type, reference_key, period_key)`)
   - `ranks`, `user_ranks`
   - `challenges`, `challenge_participants`
   - `guilds`, `guild_members`, `guild_invites`, `guild_activity_logs`
   - `custom_bg_requests`, `audit_logs`
4. **Migration v4 — تتبع رواتب المهن وسجلات دقائق التحديات**:
   - إضافة `last_job_salary_at` في `users`.
   - `challenge_minute_logs` مع مفتاح أساسي `(user_id, minute_bucket)` يمنع احتساب الدقيقة نفسها مرتين أو في أكثر من جلسة/تحدٍ.

---

## 4. الضوابط الهندسية والأمنية الحرجة

- **الذرية المالية ومنع التكرار**: كل عملية مالية تجري داخل `withTransaction` (`BEGIN IMMEDIATE` ... `COMMIT`/`ROLLBACK`) مع `idempotency_keys` وقيود `CHECK(available_balance >= 0)`.
- **الدراسة الموثقة بدون ازدواجية**:
  - الدقائق الموثقة **مجموعة جزئية** من الدقائق العادية (`verified_minutes <= regular_minutes`).
  - الكاميرا وحدها لا ترفع `screen_sharing` ولا تضيف دقائق موثقة.
  - عند إعادة تشغيل الخادم، تستعيد `recoverInterruptedSessions` الجلسات النشطة المتوقفة وتقتصر التسوية على زمن آمن دون تضخيم وقت الانقطاع.
- **عدالة التحديات الدراسية**:
  - لا يُخصم الرهان عند إنشاء التحدي، بل عند اكتمال موافقة جميع اللاعبين داخل معاملة ذرية واحدة (`assertBalance` للجميع أو فشل كامل دون خصم جزئي).
  - أثناء التحدي (`active`) تُحجب دقائق الخصوم والزملاء عن أي متصفح ويظهر للمشاهد **دقائقه الموثقة الشخصية فقط** (`null` للبقية).
  - عند التعادل يُعاد كامل الرهان من `reserved_balance` إلى `available_balance`، وعند الفوز يُوزع كامل الوعاء بالتساوي بعمولة `0%`.
- **حماية الخادم**: جميع مسارات `/api/admin/*` تتحقق من `requireAdmin` في الخادم، ومفاتيح التحديات والقروض والمشتريات تتحقق من `requireRegisteredUser` عبر `x-user-id` و`audit_logs`.
