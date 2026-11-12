import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

// تحديد مسار المجلد الحالي لدعم ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// تهيئة خادم Express
const app = express();

// إعداد خوذة الحماية (Helmet) مع سياسة أمان للمحتوى (CSP) تسمح بخطوط جوجل والصور
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// تحديد حجم الطلب بحد أقصى 15 كيلوبايت لمنع هجمات الحرمان من الخدمة
app.use(express.json({ limit: '15kb' }));

// إعداد مشاركة الموارد عبر الأصول (CORS) بأمان
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('طلب غير مصرح به عبر سياسة CORS'));
      }
    },
    credentials: true,
  })
);

// تقديم الملفات الثابتة من مجلد public
app.use(express.static(path.join(__dirname, 'public')));
// كما يمكن الوصول لملفات الصور في المجلد الرئيسي
app.use('/assets', express.static(path.join(__dirname)));

// حماية من كثرة الطلبات (Rate Limiting) على مسار واجهة برمجة التطبيقات
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // نافذة دقيقة واحدة
  max: 20, // 20 طلباً كحد أقصى لكل عنوان IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'لقد تجاوزت الحد المسموح به من الطلبات مؤقتًا. يرجى الانتظار دقيقة واحدة ثم المحاولة مجددًا 🌱.',
  },
});

app.use('/api', apiLimiter);

// قراءة مفتاح الـ API بأمان من متغيرات البيئة
const rawApiKey = (
  process.env.AI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.GROQ_API_KEY ||
  ''
).trim();

if (!rawApiKey) {
  console.warn('⚠️  تحذير: لم يتم العثور على مفتاح API في ملف .env!');
}

// الكشف التلقائي الذكي عن مزود الذكاء الاصطناعي (OpenAI الرسمي أو Groq السريع المتوافق مع OpenAI API)
let baseURL = process.env.OPENAI_BASE_URL || undefined;
let defaultModel = process.env.AI_MODEL;

if (rawApiKey.startsWith('gsk_')) {
  // مفتاح Groq فائق السرعة متوافق بالكامل مع مواصفات OpenAI API
  if (!baseURL) baseURL = 'https://api.groq.com/openai/v1';
  if (!defaultModel) defaultModel = 'openai/gpt-oss-120b';
} else {
  // مفتاح OpenAI قياسي
  if (!defaultModel) defaultModel = 'gpt-4o-mini';
}

const aiClient = new OpenAI({
  apiKey: rawApiKey,
  baseURL: baseURL,
  timeout: 30000, // مهلة 30 ثانية
});

// النص التوجيهي الصارم لشخصية المساعد البيئي (System Prompt)
const SYSTEM_PROMPT = `أنت المساعد البيئي الذكي الرسمي لحملة بيئتنا لوحتنا في جامعة إربد الأهلية بالأردن.

مهمتك مساعدة الطلبة والزوار في فهم أهداف الحملة، وتعزيز السلوك البيئي الإيجابي، وتقديم معلومات ونصائح عملية حول النظافة والاستدامة وإعادة التدوير والتطوع البيئي.

تحدث باللغة العربية بأسلوب ودود وبسيط، وافهم اللهجة الأردنية جيدًا.

اجعل إجاباتك مختصرة ومفيدة، واستخدم الرموز التعبيرية باعتدال.

إذا سألك المستخدم عن طريقة الإبلاغ، وجّهه إلى نموذج الإبلاغ الموجود في الموقع.

لا تخترع معلومات رسمية عن الجامعة أو الحملة، ولا تدّعِ أن هناك مبادرات أو فعاليات أو مواعيد غير موثقة.

إذا كان السؤال بعيدًا عن البيئة أو الحملة، وضّح بلطف أنك المساعد البيئي المتخصص في هذه المواضيع.`;

/**
 * نقطة فحص جاهزية وصحة الخادم
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    name: 'المساعد البيئي 🌱',
    campaign: 'بيئتنا لوحتنا',
    university: 'جامعة إربد الأهلية',
    model: defaultModel,
    timestamp: new Date().toISOString(),
  });
});

/**
 * نقطة استقبال المحادثة ومعالجتها مع نموذج الذكاء الاصطناعي
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    // 1. التحقق من صحة حقل الرسائل
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'طلب غير صالح: حقل الرسائل (messages) مطلوب ويجب أن يحتوي على رسالة واحدة على الأقل.',
      });
    }

    // 2. التحقق من سلامة بنية كل رسالة وحجمها
    const sanitizedMessages = [];
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const role = String(msg.role || '').toLowerCase();
      const content = String(msg.content || '').trim();

      if ((role === 'user' || role === 'assistant') && content.length > 0) {
        // حماية من الرسائل الطويلة جدًا
        sanitizedMessages.push({
          role: role,
          content: content.slice(0, 1500),
        });
      }
    }

    if (sanitizedMessages.length === 0) {
      return res.status(400).json({
        error: 'طلب غير صالح: لم يتم العثور على رسائل صالحة للإرسال.',
      });
    }

    // 3. الاحتفاظ بسياق آخر 15 رسالة فقط لتوفير الرموز وسرعة الاستجابة
    const boundedMessages = sanitizedMessages.slice(-15);

    // 4. بناء مصفوفة الرسائل النهائية مع الـ System Prompt السري على الخادم
    const finalPayload = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...boundedMessages,
    ];

    // 5. استدعاء نموذج الذكاء الاصطناعي
    const completion = await aiClient.chat.completions.create({
      model: defaultModel,
      messages: finalPayload,
      max_tokens: 800,
      temperature: 0.7,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(500).json({
        error: 'تعذر الحصول على رد من النموذج، يرجى إعادة المحاولة.',
      });
    }

    // إرجاع الإجابة للواجهة الأمامية
    return res.status(200).json({
      reply: reply,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // تسجيل الخطأ دون الكشف عن أي بيانات حساسة
    const status = err?.status || 500;
    console.error('❌ حدث خطأ أثناء الاتصال بمزود الذكاء الاصطناعي:', err?.message || err);

    let friendlyMessage = 'عذرًا، حدث خطأ أثناء معالجة المحادثة. يرجى المحاولة بعد قليل 🌱.';

    if (status === 429) {
      friendlyMessage = 'الخدمة تشهد ضغطًا عاليًا من الطلبات حاليًا. يرجى الانتظار بضع لحظات والمحاولة مجددًا.';
    } else if (status === 401 || status === 403) {
      friendlyMessage = 'خطأ في التحقق من ترخيص المفتاح البرمجي. يرجى التأكد من إعداد ملف .env بشكل صحيح.';
    } else if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      friendlyMessage = 'استغرقت استجابة المساعد وقتًا أطول من المعتاد. يرجى المحاولة مرة أخرى.';
    }

    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: friendlyMessage,
    });
  }
});

// التعامل مع المسارات غير المعرفة
app.use((req, res) => {
  res.status(404).json({ error: 'المسار غير موجود.' });
});

// معالج الأخطاء العام
app.use((err, req, res, next) => {
  console.error('خطأ خادم داخلي:', err?.message || err);
  res.status(500).json({ error: 'حدث خطأ داخلي في الخادم.' });
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🌱 خادم المساعد البيئي الذكي يعمل بنجاح على المنفذ: ${PORT}`);
  console.log(`📍 حملة: بيئتنا لوحتنا | جامعة إربد الأهلية`);
  console.log(`🤖 النموذج المفعل: ${defaultModel}`);
  console.log(`🌐 رابط الموقع: http://localhost:${PORT}`);
  console.log(`===========================================================`);
});

