const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// 🔧 CONFIGURATION
// ============================================

const CONFIG = {
  PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PERPLEXITY_MODEL: 'sonar-pro',
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  GEMINI_MODEL: 'gemini-2.5-flash',  // Has thinking mode built-in
  DALLE_MODEL: 'dall-e-3',
};

// Log missing envs early for easier debugging (no values are printed)
const missingEnv = [];
if (!CONFIG.PERPLEXITY_API_KEY) missingEnv.push('PERPLEXITY_API_KEY');
if (!CONFIG.CLAUDE_API_KEY) missingEnv.push('CLAUDE_API_KEY');
if (!CONFIG.GEMINI_API_KEY) missingEnv.push('GEMINI_API_KEY');
if (missingEnv.length) {
  console.error('⚠️ Missing env vars:', missingEnv.join(', '));
}

// ============================================
// 📐 SCRIPT STRUCTURE
// ============================================

const SCRIPT_STRUCTURE = {
  hook: { duration: '3s', words: 10, purpose: 'جذب الانتباه فوراً' },
  context: { duration: '12s', words: 40, purpose: 'شرح السياق والمشكلة' },
  content: { duration: '30s', words: 100, purpose: 'المعلومات الأساسية والحقائق' },
  cta: { duration: '15s', words: 50, purpose: 'طلب التفاعل والاشتراك' },
};

// ============================================
// 📏 RULES
// ============================================

const RULES = {
  general: [
    'اكتب بطريقة سلسة وطبيعية - احكي قصة، مش مجرد أرقام',
    'ممنوع تكرار أي معلومة أو جملة',
    'استخدم أرقام من الـ Datasheet فقط - ممنوع تخترع',
    'خاطب المشاهد مباشرة بشكل طبيعي',
    'اربط المعلومات ببعض بشكل منطقي',
    'خلي الكلام يتدفق بدون توقف مفاجئ',
    'استخدم أسماء أماكن أو شوارع أو أشخاص لو موجودة في البحث عشان تحسس المشاهد إنك عارفه',
  ],
  depth: [
    'لكل رقم، اشرح "يعني إيه للمشاهد" - So What?',
    'قارن الأرقام بحاجات معروفة عشان المشاهد يستوعب (مثال: "ده بحجم 500 ملعب كورة")',
    'اشرح التأثير الحقيقي على الناس - مش مجرد إحصائيات',
    'احكي القصة ورا الرقم - مين عمل ده وليه؟',
    'اربط بالسياق الأكبر - المشروع/الخبر ده جزء من إيه؟',
    'خلي كل رقم له وزن - اشرح ليه مهم',
  ],
  forbidden: [
    'ممنوع تماماً: "تخيل معايا"، "بص كده"، "يا جماعة"، "هل كنت تعلم"، "ركز معايا"، "شوف بقى"',
    'ممنوع: "يعد هذا"، "مما لا شك فيه"، "في الختام"، "باختصار"، "نستنتج أن"',
    'ممنوع: رائع، مذهل، لا يصدق، صدمة، عجيب، مدهش (إلا لو في سياق بشري حقيقي)',
    'ممنوع تكرار نفس البداية لأي جملتين متتاليتين',
    'ممنوع أرقام غير موجودة في الـ Datasheet',
    'ممنوع الكلام المبالغ فيه أو الدرامي الزائد',
    'ممنوع تسرد الأرقام بدون شرح تأثيرها',
    'ممنوع "خبر عاجل" أو "لو قلتلك" - دي hooks ضعيفة ومستهلكة',
  ],
};

// ============================================
// 🎭 STYLES
// ============================================

const STYLES = {
  mrbeast: {
    name: 'MrBeast Style',
    tone: 'حماسي وسريع، بيقدم الأرقام بطريقة مثيرة، بيخلي المشاهد يحس إن المعلومة كبيرة وقيمة',
    hooks: ['تخيل إن...', 'لو قلتلك إن...', 'الرقم ده ضخم...'],
    examples: ['ده يعني إن كل يوم...', 'لو حسبتها هتلاقي إن...'],
  },
  educational: {
    name: 'Educational Style',
    tone: 'تعليمي وواضح، بيشرح المعلومة بطريقة بسيطة ومفهومة، بيستخدم أمثلة عملية',
    hooks: ['الحقيقة إن...', 'السبب الأساسي هو...', 'علمياً، اللي بيحصل هو...'],
    examples: ['ببساطة، ده معناه...', 'يعني لو عندك... هتلاقي إن...'],
  },
  shocking: {
    name: 'News Style',
    tone: 'خبري ومباشر، بيقدم المعلومة بشكل صريح ومؤثر، بدون مبالغة',
    hooks: ['الخبر اللي طلع النهاردة...', 'حصل تطور مهم في...', 'آخر الإحصائيات بتقول...'],
    examples: ['وده معناه إن...', 'التأثير هيكون على...'],
  },
  viral: {
    name: 'Story Style',
    tone: 'قصصي وشيق، بيحكي المعلومة كأنها قصة مثيرة، بيخلي المشاهد عايز يعرف أكتر',
    hooks: ['القصة بدأت لما...', 'اللي حصل كان غريب...', 'في حاجة مهمة لازم تعرفها...'],
    examples: ['واللي خلى الموضوع ينتشر هو...', 'والنتيجة كانت...'],
  },
};

// ============================================
// 🌍 LANGUAGES
// ============================================

const LANGUAGES = {
  egyptian: {
    name: 'Egyptian Arabic',
    prompt: 'اكتب باللهجة المصرية العامية "الصايعة" والذكية. استخدم: "يعني"، "كده"، "خالص"، "أوي". ممنوع الفصحى نهائياً.',
    isArabic: true,
  },
  gulf: {
    name: 'Gulf Arabic',
    prompt: 'اكتب باللهجة الخليجية (سعودي، إماراتي). استخدم: "وايد"، "زين"، "حيل"، "طال عمرك". ممنوع الفصحى.',
    isArabic: true,
  },
  levantine: {
    name: 'Levantine Arabic',
    prompt: 'اكتب باللهجة الشامية (سوري، لبناني). استخدم: "كتير"، "هيك"، "منيح"، "شو في". ممنوع الفصحى.',
    isArabic: true,
  },
  english: {
    name: 'English',
    prompt: 'Write in casual, engaging English. Use conversational tone.',
    isArabic: false,
  },
  french: {
    name: 'French',
    prompt: 'Écris en français conversationnel et engageant.',
    isArabic: false,
  },
};

// ============================================
// 🎯 NICHE PROFILES (Expert Brains)
// ============================================

const NICHES = {
  general: {
    id: 'general',
    name: 'General',
    nameAr: 'عام',
    icon: '✨',
    persona: {
      ar: 'حكواتي محترف بيحول أي خبر لقصة مشوقة',
      en: 'Professional storyteller who turns any news into an engaging story',
    },
    focus: {
      ar: 'الفضول العام، القصة المثيرة، المعلومات الجديدة',
      en: 'General curiosity, engaging stories, new information',
    },
    keywords: {
      ar: [],
      en: [],
    },
    forbidden: {
      ar: [],
      en: [],
    },
    hookStyle: {
      ar: 'ابدأ بأقوى معلومة أو مفارقة في البحث',
      en: 'Start with the strongest fact or paradox from research',
    },
    depthRule: {
      ar: 'اشرح تأثير كل معلومة على حياة المشاهد',
      en: 'Explain the impact of every fact on the viewer\'s life',
    },
  },

  content_creation: {
    id: 'content_creation',
    name: 'Content Creation',
    nameAr: 'صناعة المحتوى',
    icon: '🎥',
    persona: {
      ar: 'صانع محتوى Viral فاهم الخوارزميات وسيكولوجية المشاهد',
      en: 'Viral content creator who understands algorithms and viewer psychology',
    },
    focus: {
      ar: 'الريتنشن، الهوكات البصرية، بناء المجتمع، أسرار النجاح',
      en: 'Retention, visual hooks, community building, success secrets',
    },
    keywords: {
      ar: ['خوارزميات', 'تفاعل', 'ريتش', 'مونتاج', 'تريند', 'نيتش', 'ريتنشن', 'فيرال', 'كريتور'],
      en: ['algorithm', 'engagement', 'reach', 'editing', 'trend', 'niche', 'retention', 'viral', 'creator'],
    },
    forbidden: {
      ar: ['أهلاً بكم في قناتي', 'لا تنسوا اللايك والاشتراك', 'مرحباً متابعينا'],
      en: ['Welcome to my channel', 'Don\'t forget to like and subscribe', 'Hello followers'],
    },
    hookStyle: {
      ar: 'ابدأ بكشف سر أو خطأ شائع يقع فيه صناع المحتوى',
      en: 'Start by revealing a secret or common mistake creators make',
    },
    depthRule: {
      ar: 'كل نصيحة لازم يكون معاها مثال عملي أو رقم (زي: زودت التفاعل 300%)',
      en: 'Every tip must have a practical example or number (e.g., increased engagement by 300%)',
    },
  },

  real_estate: {
    id: 'real_estate',
    name: 'Real Estate',
    nameAr: 'العقارات',
    icon: '🏠',
    persona: {
      ar: 'استشاري عقاري خبير ومستثمر ذكي بيفهم السوق',
      en: 'Expert real estate consultant and smart investor who understands the market',
    },
    focus: {
      ar: 'العائد على الاستثمار، الموقع الاستراتيجي، الرفاهية، الأمان المالي',
      en: 'ROI, strategic location, luxury, financial security',
    },
    keywords: {
      ar: ['تسهيلات سداد', 'لوكيشن', 'عائد استثماري', 'وحدات محدودة', 'كومباوند', 'تشطيب', 'استلام فوري', 'مقدم'],
      en: ['payment plans', 'location', 'ROI', 'limited units', 'compound', 'finishing', 'immediate delivery', 'down payment'],
    },
    forbidden: {
      ar: ['فرصة العمر', 'ما تفوتش الفرصة', 'أسعار خيالية'],
      en: ['opportunity of a lifetime', 'don\'t miss out', 'unbelievable prices'],
    },
    hookStyle: {
      ar: 'حول السعر لقسط شهري أو قارنه بقيمة الإيجار الضائعة',
      en: 'Convert price to monthly payment or compare to wasted rent value',
    },
    depthRule: {
      ar: 'كل سعر يتحول لـ "قسط" أو "توفير". كل مساحة تتقارن بحاجة معروفة',
      en: 'Every price converts to "installment" or "savings". Every area compared to something known',
    },
  },

  tech: {
    id: 'tech',
    name: 'Tech & AI',
    nameAr: 'التكنولوجيا',
    icon: '📱',
    persona: {
      ar: 'تقني مهووس بالأداء وبيجرب كل جديد',
      en: 'Performance-obsessed techie who tests everything new',
    },
    focus: {
      ar: 'المواصفات الحقيقية، الأداء العملي، القيمة مقابل السعر',
      en: 'Real specs, practical performance, value for money',
    },
    keywords: {
      ar: ['معالج', 'بنشمارك', 'فريمات', 'هرتز', 'سلاسة', 'تجربة المستخدم', 'بطارية', 'شحن سريع'],
      en: ['processor', 'benchmark', 'frames', 'hertz', 'smooth', 'user experience', 'battery', 'fast charging'],
    },
    forbidden: {
      ar: ['أفضل جهاز في العالم', 'لا يوجد له منافس', 'خارق'],
      en: ['best device ever', 'no competition', 'superhuman'],
    },
    hookStyle: {
      ar: 'ابدأ برقم أداء صادم أو مقارنة مع المنافس الأشهر',
      en: 'Start with a shocking performance number or comparison with the most famous competitor',
    },
    depthRule: {
      ar: 'ممنوع تقول "سريع" بدون رقم. قول "بيفتح اللعبة في 3 ثواني"',
      en: 'Never say "fast" without a number. Say "opens the game in 3 seconds"',
    },
  },

  business: {
    id: 'business',
    name: 'Business & Finance',
    nameAr: 'البيزنس والمال',
    icon: '💰',
    persona: {
      ar: 'محلل اقتصادي ذكي بيكشف خبايا السوق وفرص الاستثمار',
      en: 'Smart economic analyst who reveals market secrets and investment opportunities',
    },
    focus: {
      ar: 'الأرقام الكبيرة، قصص النجاح، خبايا السوق، الفرص',
      en: 'Big numbers, success stories, market secrets, opportunities',
    },
    keywords: {
      ar: ['إيرادات', 'استحواذ', 'حصة سوقية', 'منافسة', 'أسهم', 'ريادة أعمال', 'تمويل', 'نمو'],
      en: ['revenue', 'acquisition', 'market share', 'competition', 'stocks', 'entrepreneurship', 'funding', 'growth'],
    },
    forbidden: {
      ar: ['هتبقى مليونير', 'ثراء سريع', 'بدون مجهود'],
      en: ['become a millionaire', 'get rich quick', 'no effort'],
    },
    hookStyle: {
      ar: 'ابدأ برقم صادم (إيرادات، خسارة، استحواذ) أو سر لم يُكشف',
      en: 'Start with a shocking number (revenue, loss, acquisition) or an unrevealed secret',
    },
    depthRule: {
      ar: 'اربط كل خبر بتأثيره على جيب المشاهد أو مستقبل السوق',
      en: 'Connect every news to its impact on the viewer\'s pocket or market future',
    },
  },

  food: {
    id: 'food',
    name: 'Food & Dining',
    nameAr: 'المطاعم والأكل',
    icon: '🍔',
    persona: {
      ar: 'فودي بيستمتع بكل قطمة وخبير في اكتشاف الأماكن المخفية',
      en: 'Foodie who enjoys every bite and expert at discovering hidden gems',
    },
    focus: {
      ar: 'التجربة الحسية، السعر مقابل الجودة، الأماكن الجديدة',
      en: 'Sensory experience, price vs quality, new places',
    },
    keywords: {
      ar: ['جوسي', 'كريسبي', 'خلطة سرية', 'هيدن جيم', 'تجربة', 'طعم', 'قوام', 'ريحة'],
      en: ['juicy', 'crispy', 'secret recipe', 'hidden gem', 'experience', 'taste', 'texture', 'aroma'],
    },
    forbidden: {
      ar: ['لذيذ', 'حلو', 'جميل', 'روعة'],
      en: ['delicious', 'nice', 'beautiful', 'amazing'],
    },
    hookStyle: {
      ar: 'ابدأ بوصف حسي يخلي المشاهد يجوع أو بمفاجأة عن المكان',
      en: 'Start with a sensory description that makes the viewer hungry or a surprise about the place',
    },
    depthRule: {
      ar: 'استبدل "لذيذ" بوصف الشعور (مثلاً: بتدوب في البق، الجبنة بتشد معاك)',
      en: 'Replace "delicious" with feeling description (e.g., melts in your mouth, cheese pulls)',
    },
  },

  self_improvement: {
    id: 'self_improvement',
    name: 'Self-Improvement',
    nameAr: 'تطوير الذات',
    icon: '🧠',
    persona: {
      ar: 'مينتور بيحفز بعقلانية ويدي خطوات عملية',
      en: 'Mentor who motivates rationally and gives practical steps',
    },
    focus: {
      ar: 'خطوات عملية، تغيير العادات، السيكولوجية البسيطة',
      en: 'Practical steps, habit change, simple psychology',
    },
    keywords: {
      ar: ['انضباط', 'دوبامين', 'تركيز', 'عادات', 'عقلية', 'إنتاجية', 'طاقة', 'روتين'],
      en: ['discipline', 'dopamine', 'focus', 'habits', 'mindset', 'productivity', 'energy', 'routine'],
    },
    forbidden: {
      ar: ['تستطيع فعل المستحيل', 'أنت الأفضل', 'لا شيء يوقفك', 'آمن بنفسك'],
      en: ['you can do the impossible', 'you are the best', 'nothing can stop you', 'believe in yourself'],
    },
    hookStyle: {
      ar: 'ابدأ بتحدي معتقد شائع أو عادة سيئة يفعلها أغلب الناس',
      en: 'Start by challenging a common belief or bad habit most people do',
    },
    depthRule: {
      ar: 'كل نصيحة لازم تنتهي بـ "نصر صغير" (Small Win) يقدر يعمله النهاردة',
      en: 'Every tip must end with a "Small Win" they can do today',
    },
  },

  fashion: {
    id: 'fashion',
    name: 'Fashion & Beauty',
    nameAr: 'الفاشون والجمال',
    icon: '👗',
    persona: {
      ar: 'ستايلست محترف بيعرف أحدث التريندات وأسرار الأناقة',
      en: 'Professional stylist who knows the latest trends and elegance secrets',
    },
    focus: {
      ar: 'التريندات، تنسيق الملابس، الثقة بالنفس، الأناقة العملية',
      en: 'Trends, outfit coordination, confidence, practical elegance',
    },
    keywords: {
      ar: ['تريند', 'ستايل', 'لوك', 'ماتريال', 'قصة', 'ألوان', 'موسم', 'كلاسيك'],
      en: ['trend', 'style', 'look', 'material', 'cut', 'colors', 'season', 'classic'],
    },
    forbidden: {
      ar: ['شكلك هيبقى حلو', 'هتبقى أجمل واحدة', 'موضة بنت الموضة'],
      en: ['you will look pretty', 'you\'ll be the prettiest', 'super fashionable'],
    },
    hookStyle: {
      ar: 'ابدأ بخطأ ستايل شائع أو تريند جديد محدش بيتكلم عنه',
      en: 'Start with a common style mistake or a new trend no one is talking about',
    },
    depthRule: {
      ar: 'كل نصيحة لازم تكون قابلة للتطبيق (مثلاً: البنطلون ده مع أي تيشيرت أبيض)',
      en: 'Every tip must be actionable (e.g., this pant with any white t-shirt)',
    },
  },
};

// ============================================
// 📝 PROMPTS (Bilingual)
// ============================================

const PROMPTS = {
  hookGeneration: {
    ar: `أنت خبير في كتابة Hooks قوية لفيديوهات Short. اكتب 3 hooks مختلفة عن "{{TOPIC}}".`,
    en: `You're an expert at writing powerful hooks for Short videos. Write 3 different hooks about "{{TOPIC}}".`,
  },
  hookPrinciples: {
    ar: `🧠 مبادئ الـ Hook القوي:
═══════════════════════════════════════
الـ Hook المثالي بيحتوي على عناصر من دول:

1. **صدمة رقمية:** رقم كبير أو إحصائية مفاجئة من الـ datasheet
2. **سؤال يخلق فضول:** "إزاي؟" "ليه؟" "إيه اللي حصل؟"
3. **وعد ضمني:** المشاهد يحس إن هيعرف حاجة مهمة
4. **قصة غير مكتملة:** اترك جزء من المعلومة يخلي المشاهد عايز يكمل`,
    en: `🧠 Principles of a Powerful Hook:
═══════════════════════════════════════
The perfect hook contains elements from these:

1. **Numeric Shock:** A big number or surprising statistic from the datasheet
2. **Curiosity Question:** "How?" "Why?" "What happened?"
3. **Implicit Promise:** The viewer feels they'll learn something important
4. **Incomplete Story:** Leave part of the info to make them want to continue`,
  },
  hookForbidden: {
    ar: `⚠️ ممنوع: "خبر عاجل"، "لو قلتلك"، "محدش هيصدق"، "هتتصدم"`,
    en: `⚠️ Forbidden: "Breaking news", "You won't believe", "This will shock you", clichés`,
  },
  scriptIntro: {
    ar: `أنت كاتب سكربتات محترف. اكتب سكربت عميق ومتعمق ({{DURATION}} ثانية) عن "{{TOPIC}}".`,
    en: `You're a professional script writer. Write a deep, detailed script ({{DURATION}} seconds) about "{{TOPIC}}".`,
  },
  hookMandatory: {
    ar: `⚠️ مهم جداً: السكربت لازم يبدأ بالـ HOOK ده بالظبط - حرف بحرف!
ممنوع تغير فيه أو تعيد صياغته. ابدأ السكربت بيه مباشرة.`,
    en: `⚠️ CRITICAL: The script MUST start with this HOOK exactly - word for word!
Do not modify or rephrase it. Start the script with it directly.`,
  },
  scriptImportant: {
    ar: `⚡ تعليمات مهمة جداً:
1. ابدأ السكربت بالـ HOOK اللي فوق - أول جملة في السكربت لازم تكون الـ HOOK بالحرف
2. احكي قصة كاملة - مش مجرد سرد أرقام
3. كل رقم اشرح يعني إيه للمشاهد - وضّح التأثير
4. اربط كل حاجة بحياة المشاهد - خليه يحس إنها تهمه
5. خلي السكربت متدفق ومترابط من أوله لآخره`,
    en: `⚡ Critical Instructions:
1. Start the script with the HOOK above - first sentence must be the HOOK exactly
2. Tell a complete story - not just listing numbers
3. For every number, explain "so what?" - clarify the impact
4. Connect everything to the viewer's life - make them feel it matters
5. Keep the script flowing and connected from start to finish`,
  },
};

// ============================================
// 🛠️ HELPERS
// ============================================

function isArabicLang(lang) {
  return ['egyptian', 'gulf', 'levantine'].includes(lang);
}

function getPrompt(key, lang, replacements = {}) {
  let prompt = isArabicLang(lang) ? PROMPTS[key].ar : PROMPTS[key].en;
  
  // Replace placeholders
  Object.keys(replacements).forEach(placeholder => {
    prompt = prompt.replace(`{{${placeholder}}}`, replacements[placeholder]);
  });
  
  return prompt;
}

// ============================================
// 🔍 PERPLEXITY - Research
// ============================================

async function researchTopic(topic, language) {
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const systemPrompt = isAr
    ? `أنت مساعد بحث. ابحث عن أحدث المعلومات الدقيقة. ${langConfig.prompt}`
    : `You are a research assistant. Find the latest and most accurate information. ${langConfig.prompt}`;
  
  const userPrompt = isAr
    ? `ابحث بدقة شديدة عن: ${topic}

اريد معلومات محددة وحديثة عن:
- ${topic} بالظبط (مش مواضيع عامة)
- أرقام وإحصائيات دقيقة
- تواريخ وأحداث مهمة
- مصادر موثوقة

⚠️ مهم: ركز على الموضوع المحدد بالظبط، مش موضوع عام!`
    : `Research specifically about: ${topic}

I need specific and recent information about:
- ${topic} exactly (not general topics)
- Specific numbers and statistics
- Important dates and events
- Reliable sources

⚠️ Important: Focus on the specific topic exactly, not general topics!`;
  
  const response = await axios.post(
    'https://api.perplexity.ai/chat/completions',
    {
      model: CONFIG.PERPLEXITY_MODEL,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      max_tokens: 2500,
    },
    {
      headers: {
        'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.choices[0].message.content;
}

// ============================================
// 🏗️ CLAUDE - Architect Story (Angle & Facts)
// ============================================

async function architectStory(researchData, topic, style, language, niche = 'general') {
  const isAr = isArabicLang(language);
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const nicheProfile = NICHES[niche] || NICHES.general;

  // Build niche-specific injection
  const nicheInjection = isAr ? `
🎭 شخصيتك في هذا المجال:
${nicheProfile.persona.ar}

🎯 التركيز الأساسي:
${nicheProfile.focus.ar}

📝 كلمات مفتاحية يجب استخدامها:
${nicheProfile.keywords.ar.length > 0 ? nicheProfile.keywords.ar.join('، ') : 'لا يوجد كلمات محددة'}

🚫 كلمات ممنوعة في هذا المجال:
${nicheProfile.forbidden.ar.length > 0 ? nicheProfile.forbidden.ar.join('، ') : 'لا يوجد'}

💡 قاعدة العمق الخاصة:
${nicheProfile.depthRule.ar}` : `
🎭 Your Persona in this Niche:
${nicheProfile.persona.en}

🎯 Core Focus:
${nicheProfile.focus.en}

📝 Keywords to Use:
${nicheProfile.keywords.en.length > 0 ? nicheProfile.keywords.en.join(', ') : 'None specific'}

🚫 Forbidden Words in this Niche:
${nicheProfile.forbidden.en.length > 0 ? nicheProfile.forbidden.en.join(', ') : 'None'}

💡 Special Depth Rule:
${nicheProfile.depthRule.en}`;

  const prompt = isAr ? 
`أنت "مهندس محتوى" محترف متخصص في مجال "${nicheProfile.nameAr}". وظيفتك هي تحليل البحث واكتشاف "عنصر الدهشة الأكبر" (The Core Surprise) الذي سيبنى عليه السكربت.

${nicheInjection}

الموضوع: ${topic}
الأسلوب: ${styleTemplate.name}

البحث الخام:
${researchData}

🎯 مهمتك (بالتفكير العميق):
1. **اكتشف عنصر الدهشة (The Core Surprise):** ما هي الحقيقة أو المفارقة الأكثر إثارة للاهتمام في هذا البحث بناءً على تخصصك في "${nicheProfile.nameAr}"؟
2. **حدد الزاوية (The Angle):** كيف سنحكي هذه القصة بأسلوب خبير في "${nicheProfile.nameAr}"؟
3. **فلترة الحقائق:** استخرج فقط الحقائق التي تخدم هذه الزاوية وتجعل القصة ملموسة.
4. **بناء منطق القصة:** حدد تسلسل الأفكار من الجذب الأولي للوصول للنتيجة النهائية.

⚠️ قواعد صارمة:
- ممنوع أي مقدمات عامة.
- ركز على "لماذا هذا الخبر يغير حياة الناس أو يثير فضولهم الآن؟".
- استخرج أي أسماء شوارع أو مناطق محددة لزيادة الواقعية.
- استخدم الكلمات المفتاحية الخاصة بمجال "${nicheProfile.nameAr}".

المطلوب رد بصيغة JSON فقط:
{
  "coreSurprise": "وصف عنصر الدهشة الأساسي",
  "angle": "وصف الزاوية المختارة",
  "chosenFacts": "[F1] حقيقة 1, [F2] حقيقة 2...",
  "localContext": "أسماء أماكن أو شوارع أو تفاصيل محلية لزيادة الواقعية",
  "storyLogic": "كيف سنبني القصة من البداية للنهاية"
}` : 
`You are a professional "Content Architect" specialized in "${nicheProfile.name}". Your job is to analyze research and discover "The Core Surprise" that the script will be built upon.

${nicheInjection}

Topic: ${topic}
Style: ${styleTemplate.name}

Raw Research:
${researchData}

🎯 Your Task (Deep Thinking):
1. **Discover The Core Surprise:** What is the most interesting fact or paradox in this research based on your expertise in "${nicheProfile.name}"?
2. **Define The Angle:** How will we tell this story as an expert in "${nicheProfile.name}"?
3. **Filter Facts:** Extract only facts that serve this angle and make the story tangible.
4. **Story Logic:** Define the sequence of ideas from the initial hook to the final result.

⚠️ Strict Rules:
- No general introductions.
- Focus on "Why does this matter or trigger curiosity now?".
- Extract specific street names or local areas to increase realism.
- Use keywords specific to "${nicheProfile.name}".

Required: Return ONLY a JSON object:
{
  "coreSurprise": "Description of the core surprise",
  "angle": "Description of the chosen angle",
  "chosenFacts": "[F1] fact 1, [F2] fact 2...",
  "localContext": "Specific names, locations, or local details for realism",
  "storyLogic": "How we will build the story from start to finish"
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  try {
    const text = response.data.content[0].text;
    return JSON.parse(text);
  } catch (e) {
    // Fallback if AI doesn't return clean JSON
    return {
      angle: "General informative",
      chosenFacts: response.data.content[0].text.substring(0, 500),
      storyLogic: "Standard flow"
    };
  }
}

// ============================================
// 📊 CLAUDE - Extract Datasheet (Legacy - kept for safety)
// ============================================

async function extractDatasheet(researchData, topic) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `من البحث التالي، استخرج الحقائق والأرقام المتعلقة بـ "${topic}" فقط.

⚠️ مهم جداً: الموضوع المحدد هو "${topic}" - مش موضوع عام!

البحث:
${researchData}

المطلوب:
[F1] الحقيقة الأولى
[F2] الحقيقة الثانية
... وهكذا

قواعد صارمة:
- استخرج فقط الحقائق المتعلقة **مباشرة** بـ "${topic}"
- لو البحث عن شخص معين (مثل: أبو هشيمة)، ركز على هذا الشخص بالظبط
- لو البحث عن مشروع محدد، ركز على المشروع ده بالظبط
- تجاهل تماماً أي معلومات عامة أو مواضيع أخرى
- لو المعلومات المتاحة قليلة، اكتب اللي متاح بس - ما تضيفش معلومات عامة

مثال:
❌ غلط: لو الموضوع "أبو هشيمة مصنع BESS"، ما تستخرجش حقائق عن الطاقة الشمسية في مصر عموماً
✅ صح: استخرج حقائق عن أبو هشيمة والمصنع بالظبط`,
        },
      ],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.content[0].text;
}

// ============================================
// 🎣 CLAUDE - Hook Architect (Based on Angle)
// ============================================

async function generateArchitectHook(topic, architectData, style, language, niche = 'general') {
  const isAr = isArabicLang(language);
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const nicheProfile = NICHES[niche] || NICHES.general;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  
  const prompt = isAr ? 
`أنت "مهندس هوكات" محترف متخصص في مجال "${nicheProfile.nameAr}". وظيفتك كتابة أقوى هوك (جملة افتتاحية) يخلق "ثغرة فضول" (Curiosity Gap) لا يمكن تجاهلها.

⚠️ تعليمات اللهجة:
${langConfig.prompt}

🎭 شخصيتك: ${nicheProfile.persona.ar}
💡 أسلوب الهوك الخاص بهذا المجال: ${nicheProfile.hookStyle.ar}

الموضوع: ${topic}
عنصر الدهشة (The Core Surprise): ${architectData.coreSurprise}
الزاوية: ${architectData.angle}
التفاصيل المحلية: ${architectData.localContext}

🎯 أنواع الهوكات المتاحة (اختار الأنسب للموضوع):
1. **هوك "الفائدة/الألم":** ابدأ مباشرة بالنتيجة اللي تهم حياة الناس.
2. **هوك "المفارقة/التناقض":** معلومة تخالف المنطق.
3. **هوك "السؤال المعلق":** سؤال يخلي المشاهد لازم يعرف الإجابة.
4. **هوك "الرقم الصادم":** إذا كان الرقم هو بطل الحكاية.

⚠️ قواعد صارمة:
- استخدم اللهجة المحددة أعلاه تماماً (ممنوع الفصحى).
- ابدأ فوراً بـ "عنصر الجذب" (The Hook Factor).
- ممنوع: "تخيل معايا"، "بص كده"، "خبر عاجل"، "يا جماعة".
- ممنوع في هذا المجال: ${nicheProfile.forbidden.ar.length > 0 ? nicheProfile.forbidden.ar.join('، ') : 'لا يوجد'}
- الطول: أقل من 15 كلمة.
- اجعل الهوك يبدو بشرياً جداً وليس آلياً.

المطلوب: اكتب الهوك النهائي مباشرة:` :
`You are a professional "Hook Architect" specialized in "${nicheProfile.name}". Your job is to write the strongest possible opening line (Hook) that creates an irresistible "Curiosity Gap".

⚠️ Language Instructions:
${langConfig.prompt}

🎭 Your Persona: ${nicheProfile.persona.en}
💡 Hook Style for this Niche: ${nicheProfile.hookStyle.en}

Topic: ${topic}
The Core Surprise: ${architectData.coreSurprise}
Angle: ${architectData.angle}
Local Context: ${architectData.localContext}

🎯 Hook Types (Choose the best fit):
1. **Benefit/Pain Hook:** Start with the direct result affecting people's lives.
2. **Paradox/Contradiction Hook:** Info that defies logic.
3. **Unanswered Question Hook:** Triggers a need for an answer.
4. **Shocking Number Hook:** Use if the number is the main hero.

⚠️ Strict Rules:
- Use the specified dialect/language.
- Start IMMEDIATELY with the Hook Factor.
- No clichés: "Imagine with me", "Look at this", "Breaking news".
- Forbidden in this niche: ${nicheProfile.forbidden.en.length > 0 ? nicheProfile.forbidden.en.join(', ') : 'None'}
- Length: Less than 15 words.
- Make it sound human and authentic.

Required: Write the final hook directly:`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.content[0].text.trim();
}

// ============================================
// 🧠 HOOK MASTER BRAIN - Generate 3 Diverse Hooks
// Based on creator rules from MrBeast, Hormozi, Ali Abdaal
// ============================================

async function hookMasterBrain(topic, researchData, niche = 'general', language = 'egyptian') {
  const isAr = isArabicLang(language);
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const nicheProfile = NICHES[niche] || NICHES.general;
  
  const prompt = isAr ?
`أنت "Hook Master" - أذكى عقل في العالم لكتابة الهوكات التي تكسر الـ Algorithm.

🎯 مهمتك: كتابة 3 هوكات (بدايات) تجعل المشاهد يتوقف عن التمرير (Scroll Stopping) فوراً.

📚 أنماط الهوكات العالمية (Few-Shot Patterns):
1. **نمط MrBeast (الرقم الصادم + التحدي):** "صرفنا 3 مليون دولار في ساعة واحدة بس!"
2. **نمط Hormozi (الفائدة الضخمة + السهولة):** "إزاي تعمل أول 1000 دولار من بيتك بـ 0 جنيه استثمار."
3. **نمط Curiosity Gap (المفارقة):** "الشركة اللي كلنا بنحبها.. طلعت هي أكبر عدو للبيئة."
4. **نمط The Negative Hook (التحذير):** "بطّل تعمل X لو مش عايز تخسر فلوسك."

📖 الموضوع: ${topic}
📊 أهم المعلومات المستخرجة: ${researchData}
🎯 المجال: ${nicheProfile.nameAr}

⚠️ تعليمات اللهجة (ممنوع الفصحى):
${langConfig.prompt}

🧠 سيكولوجية الهوك (السر في الكواليتي):
- **Curiosity Gap:** لازم المشاهد يحس إنه "ناقصه معلومة" لو كمل هيعرفها.
- **Show, Don't Tell:** بدل ما تقول "حاجة كبيرة"، قول "حاجة بحجم ملعب كورة".
- **Informed Ignorance:** اجعل المشاهد يشعر أن ما يعرفه عن الموضوع "خاطئ" أو "ناقص".

🎣 المطلوب: 3 هوكات مختلفة تماماً:

**Hook A - صادم (Shock/Paradox):** يركز على رقم أو حقيقة تكسر المنطق.
**Hook B - سؤال/غموض (Curiosity Loop):** يفتح سؤال لا يمكن تجاهله.
**Hook C - فائدة مباشرة (Outcome-Driven):** يركز على المكسب الشخصي للمشاهد فوراً.

أجب بـ JSON فقط (مع ذكر السبب السيكولوجي لكل هوك لضمان الجودة):
{
  "shock": "نص الهوك الصادم هنا",
  "shockReason": "ليه الهوك ده هيخلي الناس تقف؟",
  "question": "نص هوك السؤال هنا", 
  "questionReason": "إيه الفضول اللي بيفتحه؟",
  "benefit": "نص هوك الفائدة هنا",
  "benefitReason": "إيه المكسب اللي بيوعد بيه؟"
}` :
`You are the "Hook Master" - the world's sharpest brain for creating Algorithm-breaking hooks.

🎯 Your Mission: Write 3 "Scroll-Stopping" hooks that force viewers to watch.

📚 Global Hook Patterns (Few-Shot):
1. **MrBeast Style (Shocking Number + Challenge):** "We spent $3 Million in exactly 1 hour!"
2. **Hormozi Style (Massive Benefit + Low Effort):** "How to make your first $1,000 from home with $0 investment."
3. **Curiosity Gap (The Paradox):** "The company we all love.. is actually the environment's biggest enemy."
4. **The Negative Hook (Warning):** "Stop doing X if you don't want to lose your money."

📖 Topic: ${topic}
📊 Key Research: ${researchData}
🎯 Niche: ${nicheProfile.name}

⚠️ Language Instructions:
${langConfig.prompt}

🧠 Hook Psychology (The Quality Secret):
- **Curiosity Gap:** Make the viewer feel "missing information" that only the video can fill.
- **Show, Don't Tell:** Instead of "something big", say "something the size of a football stadium".
- **Informed Ignorance:** Make the viewer feel that what they know about the topic is "wrong" or "incomplete".

🎣 Required: 3 completely different hooks:

**Hook A - Shock/Paradox:** Focuses on a logic-breaking number or fact.
**Hook B - Curiosity Loop:** Opens an unignorable question.
**Hook C - Outcome-Driven:** Focuses on immediate personal gain for the viewer.

Reply with JSON only (include psychological reasoning for quality assurance):
{
  "shock": "Shock hook text here",
  "shockReason": "Why will people stop scrolling?",
  "question": "Question hook text here", 
  "questionReason": "What curiosity loop does it open?",
  "benefit": "Benefit hook text here",
  "benefitReason": "What promise/gain does it offer?"
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  const text = response.data.content[0].text;
  
  // Extract JSON from response
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Hook Master JSON parse error:', e.message);
  }
  
  // Fallback
  return {
    shock: text.split('\n')[0] || 'Hook generation failed',
    question: '',
    benefit: ''
  };
}

// ============================================
// 📐 OUTLINE ARCHITECT - Build Script Structure
// Creates a clear outline based on selected hook
// ============================================

async function outlineArchitect(topic, selectedHook, researchData, niche = 'general', language = 'egyptian') {
  const isAr = isArabicLang(language);
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const nicheProfile = NICHES[niche] || NICHES.general;
  
  const prompt = isAr ?
`أنت "Content Architect" خبير في هندسة انتباه المشاهدين.

🎯 مهمتك: بناء هيكل (Outline) لسكربت فيديو قصير يضمن أقصى معدل احتفاظ بالمشاهدين (Retention Rate).

📚 استخدام نظام V-A-S (Value-Authority-Action):
1. **Value (القيمة الفورية):** بعد الهوك مباشرة، لازم المشاهد يحس إنه خد معلومة "غالية" أو صادمة.
2. **Authority (الإثبات):** ليه الكلام ده حقيقي؟ (أرقام، إحصائيات، تشبيهات بشرية).
3. **Action/So-What (التأثير):** إزاي ده هيغير حياة المشاهد أو رأيه؟

📖 الموضوع: ${topic}
🎣 الهوك المختار: ${selectedHook}
📊 المعلومات المتاحة: ${researchData}
🎯 المجال: ${nicheProfile.nameAr}

⚠️ تعليمات اللهجة:
${langConfig.prompt}

📐 المطلوب: بناء هيكل (Outline) احترافي يتجنب الممل.

أجب بـ JSON فقط:
{
  "angle": "الزاوية السينمائية للموضوع (مثلاً: التحول من الفشل للنجاح)",
  "emotionalArc": "الرحلة الشعورية (مثال: دهشة → قلق → تفاؤل)",
  "v_section": "المعلومة الصادمة اللي هتيجي بعد الهوك فوراً (Value)",
  "a_section": "كيف سنثبت صحة الكلام بأسلوب ممتع (Authority)",
  "s_section": "التأثير الشخصي على المشاهد (Action/Impact)",
  "keyFacts": ["حقيقة 1 مع تشبيه بشري", "حقيقة 2 مع تشبيه بشري"],
  "ctaStrategy": "سؤال ذكي يفتح نقاش في التعليقات"
}` :
`You are a "Content Architect" expert in retention-rate engineering.

🎯 Your Mission: Build a script Outline for a short video that ensures maximum viewer retention.

📚 Using V-A-S System (Value-Authority-Action):
1. **Value (Immediate Value):** Right after the hook, the viewer must get a "valuable" or shocking insight.
2. **Authority (The Proof):** Why is this true? (Numbers, stats, human analogies).
3. **Action/So-What (The Impact):** How does this change the viewer's life or perspective?

📖 Topic: ${topic}
🎣 Selected Hook: ${selectedHook}
📊 Available Research: ${researchData}
🎯 Niche: ${nicheProfile.name}

⚠️ Language:
${langConfig.prompt}

📐 Required: Build a professional Outline that avoids boredom.

Reply with JSON only:
{
  "angle": "The cinematic angle (e.g. Failure to Success transformation)",
  "emotionalArc": "The emotional journey (e.g. Shock → Anxiety → Optimism)",
  "v_section": "The shocking value insight right after the hook (Value)",
  "a_section": "How we prove it using an engaging style (Authority)",
  "s_section": "The personal impact on the viewer (Action/Impact)",
  "keyFacts": ["Fact 1 with human analogy", "Fact 2 with human analogy"],
  "ctaStrategy": "A smart question to spark comments"
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  const text = response.data.content[0].text;
  
  // Extract JSON from response
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Outline Architect JSON parse error:', e.message);
  }
  
  // Fallback
  return {
    hookConnection: 'Continue naturally from the hook',
    angle: topic,
    emotionalArc: 'curiosity → understanding → satisfaction',
    keyFacts: [],
    ctaStrategy: 'Ask engaging question'
  };
}

// ============================================
// 🎣 CLAUDE - Generate Hooks (Legacy - kept for compatibility)
// ============================================

async function generateHooks(topic, datasheet, style, language) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const intro = isAr
    ? `أنت خبير في كتابة Hooks قوية لفيديوهات Short. اكتب 3 hooks مختلفة عن "${topic}".`
    : `You're an expert at writing powerful hooks for Short videos. Write 3 different hooks about "${topic}".`;
  
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: intro + `

═══════════════════════════════════════
📊 ${isAr ? 'الحقائق المتاحة' : 'Available Facts'}:
═══════════════════════════════════════
${datasheet}

═══════════════════════════════════════
🎭 ${isAr ? 'الأسلوب المطلوب' : 'Required Style'}:
═══════════════════════════════════════
${styleTemplate.name}: ${styleTemplate.tone}

═══════════════════════════════════════
🧠 ${isAr ? 'مبادئ الـ Hook القوي' : 'Principles of a Powerful Hook'}:
═══════════════════════════════════════
${isAr ? 
`الـ Hook المثالي بيحتوي على عناصر من دول:

1. **صدمة رقمية:** رقم كبير أو إحصائية مفاجئة من الـ datasheet
2. **سؤال يخلق فضول:** "إزاي؟" "ليه؟" "إيه اللي حصل؟"
3. **وعد ضمني:** المشاهد يحس إن هيعرف حاجة مهمة
4. **قصة غير مكتملة:** اترك جزء من المعلومة يخلي المشاهد عايز يكمل` :
`The perfect hook contains elements from these:

1. **Numeric Shock:** A big number or surprising statistic from the datasheet
2. **Curiosity Question:** "How?" "Why?" "What happened?"
3. **Implicit Promise:** Viewer feels they'll learn something important
4. **Incomplete Story:** Leave part of the info to make them want to continue`}

${langConfig.prompt}

═══════════════════════════════════════
${isAr ? '📝 أمثلة للإلهام فقط (لا تنسخها)' : '📝 Examples for inspiration only (don\'t copy)'}:
═══════════════════════════════════════
${isAr ?
`• "17 مليار دولار في الصعيد... إزاي الصين لقت الفرصة اللي مصر كانت مستنياها؟"
• "480 ميجاواط - ده يكفي نص مليون بيت... ليه السعودية عملت ده دلوقتي بالظبط؟"
• "المركز 25 عالمياً بعد ما كنا 37... والأغرب إن ده حصل في سنتين بس!"` :
`• "17 billion in Upper Egypt... How did China spot the opportunity Egypt was waiting for?"
• "480 megawatts - enough for half a million homes... Why did Saudi Arabia do this now?"
• "Ranked 25th globally after being 37th... The craziest part? It happened in just 2 years!"`}

═══════════════════════════════════════
⚠️ ${isAr ? 'ممنوع' : 'Forbidden'}:
═══════════════════════════════════════
${isAr ? 
`"خبر عاجل"، "لو قلتلك"، "محدش هيصدق"، "هتتصدم"` :
`"Breaking news", "You won't believe", "This will shock you", clichés`}

⚠️ ${isAr ? 'الطول' : 'Length'}: ${isAr ? 'أقل من 15 كلمة' : 'Less than 15 words'}

═══════════════════════════════════════

${isAr ? 'اكتب 3 hooks (استخدم المبادئ، مش الأمثلة)' : 'Write 3 hooks (use principles, not examples)'}:
Hook 1:
Hook 2:
Hook 3:`,
        },
      ],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  const text = response.data.content[0].text;
  const hooks = text.match(/Hook \d: (.+)/g)?.map(h => h.replace(/Hook \d: /, '')) || [text];
  
  return hooks;
}

// ============================================
// 📝 CLAUDE - Writer Phase (Story-Driven)
// ============================================

async function writerPhase(topic, architectData, hook, style, language, duration, niche = 'general', outline = null) {
  const isAr = isArabicLang(language);
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const nicheProfile = NICHES[niche] || NICHES.general;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  
  const durationConfig = {
    '15': { words: 80, maxTokens: 600 },
    '30': { words: 150, maxTokens: 1200 },
    '60': { words: 300, maxTokens: 2500 }, // ~5 words/second for natural pacing
  };
  const config = durationConfig[duration] || durationConfig['60'];

  // Build outline section if available with cinematic focus
  const outlineSection = outline ? (isAr ?
`📐 الخطة السينمائية (اتبعها بدقة):
- الزاوية: ${outline.angle || ''}
- الرحلة الشعورية: ${outline.emotionalArc || ''}
- فقرة القيمة (Value): ${outline.v_section || ''}
- فقرة الإثبات (Authority): ${outline.a_section || ''}
- فقرة التأثير (Action): ${outline.s_section || ''}
- الحقائق بالترتيب: ${Array.isArray(outline.keyFacts) ? outline.keyFacts.join(' ← ') : ''}
- الـ CTA: ${outline.ctaStrategy || ''}
` :
`📐 Cinematic Plan (Follow Strictly):
- Angle: ${outline.angle || ''}
- Emotional Journey: ${outline.emotionalArc || ''}
- Value Section: ${outline.v_section || ''}
- Authority Section: ${outline.a_section || ''}
- Action Section: ${outline.s_section || ''}
- Facts in Order: ${Array.isArray(outline.keyFacts) ? outline.keyFacts.join(' → ') : ''}
- CTA Strategy: ${outline.ctaStrategy || ''}
`) : '';

  const prompt = isAr ? 
`أنت "حكواتي سينمائي" عبقري، مش مجرد كاتب محتوى. تخصصك هو تحويل المعلومات الجافة لقصص تشد المشاهدين في مجال "${nicheProfile.nameAr}".

🎯 مهمتك: كتابة سكربت فيديو Short احترافي جداً يبدو وكأنه مكتوب بواسطة صانع محتوى بشري خبير.

${outlineSection}

⚠️ تعليمات اللهجة (ممنوع الفصحى تماماً):
${langConfig.prompt}

🎭 شخصيتك: ${nicheProfile.persona.ar}
🎯 التركيز: ${nicheProfile.focus.ar}

📝 قواعد "الخلاصة" (لأعلى كواليتي):
1. **Show, Don't Tell:** بدل ما تقول "المشروع ناجح"، قول "المشروع ده خلى الناس تقف طوابير من الساعة 6 الصبح".
2. **التشيبهات البشرية:** أي رقم لازم يتقارن بحاجة ملموسة (مثلاً: مساحة بحجم 10 ملاعب كورة، أو تكلفة تشتري لك 100 عربية فيراري).
3. **أنسنة الأرقام:** لا تذكر الأرقام كبيانات، اذكرها كـ "تأثير".
4. **ممنوع كليشيهات الـ AI نهائياً:** ممنوع تماماً: "في هذا الفيديو"، "تخيل معايا"، "يا جماعة"، "هل كنت تعلم"، "بص كده"، "ركز معايا"، "دعونا نستكشف".
5. **اللغة البسيطة (Street Smart):** اكتب بلغة "ذكية بس بسيطة"، كأنك بتحكي لصاحبك في قعدة خاصة.
6. **الـ So What:** كل جملة لازم تجاوب على سؤال المشاهد "وأنا مالي؟".

الـ HOOK المختار (ابدأ به فوراً): ${hook}

الطول المطلوب: ~${config.words} كلمة.

السكربت:` : 
`You are a genius "Cinematic Storyteller", not just a content writer. Your specialty is turning dry facts into unignorable stories in the "${nicheProfile.name}" niche.

🎯 Your Mission: Write a professional Short video script that sounds 100% human.

${outlineSection}

⚠️ Language Instructions (No formal language):
${langConfig.prompt}

🎭 Your Persona: ${nicheProfile.persona.en}
🎯 Focus: ${nicheProfile.focus.en}

📝 The "Elite Quality" Rules:
1. **Show, Don't Tell:** Instead of "Successful project", say "People started lining up at 6 AM just to get a glimpse".
2. **Human Analogies:** Compare every number to something tangible (e.g., "Size of 10 football fields", "Cost of 100 Ferraris").
3. **Humanize Numbers:** Don't state numbers as data; state them as "Impact".
4. **BAN AI CLICHÉS:** Strictly NO: "In this video", "Imagine with me", "Ya jama'a", "Did you know", "Let's explore", "Look at this".
5. **Street Smart Language:** Write in a "smart but simple" way, like telling a story to a friend.
6. **The So What:** Every sentence must answer the viewer's question: "Why should I care?".

The SELECTED HOOK (Start with it immediately): ${hook}

Length: ~${config.words} words.

Script:`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: config.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.content[0].text;
}

// ============================================
// 📝 CLAUDE - Generate Script (Legacy)
// ============================================

// NOTE: This function now generates script WITHOUT a hook
// Hook will be added later after seeing the full content
async function generateScriptWithoutHook(topic, datasheet, style, language, duration) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const durationConfig = {
    '15': { words: 45, maxTokens: 400 },
    '30': { words: 90, maxTokens: 800 },
    '60': { words: 180, maxTokens: 1500 },  // ~3 words per second
  };
  
  const config = durationConfig[duration] || durationConfig['60'];
  
  const intro = isAr
    ? `أنت كاتب سكربتات محترف. اكتب محتوى سكربت قصير (${duration} ثانية) عن "${topic}".\n\n⚠️ مهم جداً:\n- الموضوع المحدد: "${topic}" (مش موضوع عام!)\n- بدون Hook في البداية - الـ Hook هيتضاف لاحقاً\n- الطول: ~${config.words} كلمة MAXIMUM (ملتزم بالعدد ده!)`
    : `You're a professional script writer. Write a short script content (${duration} seconds) about "${topic}".\n\n⚠️ CRITICAL:\n- Specific topic: "${topic}" (not general topic!)\n- NO Hook at the beginning - hook will be added later\n- Length: ~${config.words} words MAXIMUM (stick to this number!)`;
  
  const structure = isAr ? 
`📐 الهيكل (بدون Hook):
1. 📍 CONTEXT (10-12s): ابدأ مباشرة بشرح الموضوع - إيه الحكاية؟
2. 📚 DEEP DIVE (38-42s): ادخل في التفاصيل:
   • كل رقم اشرح تأثيره (مثال: 480 ميجاواط = كهرباء 500 ألف بيت)
   • قارن بحاجات معروفة
   • وضّح السياق الأكبر
3. ✅ CTA (8-10s): ختام قوي + اطلب التفاعل` :
`📐 Structure (without Hook):
1. 📍 CONTEXT (10-12s): Start directly explaining the topic - what's the story?
2. 📚 DEEP DIVE (38-42s): Get into details:
   • Explain impact for each number (e.g., 480 MW = electricity for 500K homes)
   • Compare to known things
   • Clarify the bigger context
3. ✅ CTA (8-10s): Strong ending + ask for engagement`;

  const depthExample = isAr ?
`❌ سطحي: "المركز مساحته 30 مليون قدم"
✅ عميق: "المركز مساحته 30 مليون قدم - بحجم 500 ملعب كورة!"` :
`❌ Shallow: "The center is 30 million sq ft"
✅ Deep: "The center is 30 million sq ft - the size of 500 football fields!"`;

  const finalInstructions = isAr ?
`⚡ تعليمات مهمة:
1. ابدأ مباشرة بالسياق - بدون hook
2. احكي قصة كاملة ومترابطة
3. كل رقم اشرح تأثيره بوضوح
4. اربط بحياة المشاهد
5. خلي التدفق سلس من أول لآخر` :
`⚡ Critical Instructions:
1. Start directly with context - no hook
2. Tell a complete, connected story
3. Explain impact for every number clearly
4. Connect to viewer's life
5. Keep flow smooth from start to finish`;

  const prompt = `${intro}

═══════════════════════════════════════
📊 ${isAr ? 'الحقائق المتاحة' : 'Available Facts'}:
═══════════════════════════════════════
${datasheet}

═══════════════════════════════════════
🎭 ${isAr ? 'الأسلوب' : 'Style'}: ${styleTemplate.name}
═══════════════════════════════════════
${styleTemplate.tone}

═══════════════════════════════════════
${structure}
═══════════════════════════════════════

═══════════════════════════════════════
✅ ${isAr ? 'القواعد الأساسية' : 'Basic Rules'}:
═══════════════════════════════════════
${RULES.general.join('\n')}

═══════════════════════════════════════
🎯 ${isAr ? 'قواعد العمق (مهمة جداً)' : 'Depth Rules (Very Important)'}:
═══════════════════════════════════════
${RULES.depth.join('\n')}

═══════════════════════════════════════
🚫 ${isAr ? 'ممنوع' : 'Forbidden'}:
═══════════════════════════════════════
${RULES.forbidden.join('\n')}

═══════════════════════════════════════
🌍 ${isAr ? 'اللغة' : 'Language'}:
═══════════════════════════════════════
${langConfig.prompt}

═══════════════════════════════════════
📝 ${isAr ? 'مثال على العمق' : 'Example of Depth'}:
═══════════════════════════════════════
${depthExample}

═══════════════════════════════════════
${finalInstructions}
═══════════════════════════════════════

${isAr ? `المحتوى (~${config.words} كلمة - MAXIMUM):` : `The content (~${config.words} words - MAXIMUM):`}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: config.maxTokens,  // Strict limit
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.content[0].text;
}

// ============================================
// ✨ GEMINI - Polish & Critique
// ============================================

async function geminiPolish(script, datasheet, style, language) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const isAr = isArabicLang(language);
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  
  // Count words in input script
  const inputWordCount = script.split(/\s+/).filter(w => w.length > 0).length;
  
  // Calculate minimum output words (at least 90% of input)
  const minOutputWords = Math.floor(inputWordCount * 0.9);
  
  const prompt = isAr ? `أنت "ناقد ومحرر محتوى بشري" قاسي جداً. وظيفتك هي مراجعة السكربت وتحويله من "كلام مكتوب بواسطة AI" إلى "كلام حقيقي يقوله إنسان".

📝 السكربت (${inputWordCount} كلمة):
${script}

📊 الحقائق المرجعية:
${datasheet}

⚠️ تعليمات اللهجة:
${langConfig.prompt}

🚨 اختبار "قعدة القهوة" (Strictest Rules):
1. **اختبار النطق:** هل الكلام ده ينفع يتقال بصوت عالي في قعدة صحاب؟ لو في أي جملة "كتابية" أو "رسمية"، حولها لعامية "صايعة" وذكية.
2. **ممنوع الـ AI Breath:** احذف أي كلمات حشو زي "في هذا السياق"، "مما يؤدي إلى"، "بفضل هذا".
3. **الهوك ثابت:** الجملة الأولى ممنوع تتغير حرفياً!
4. **الطول مقدس:** السكربت لازم يكون ${minOutputWords}+ كلمة. ممنوع الاختصار المخل.
5. **تبسيط المعقد:** لو في معلومة تقنية، اشرحها كأنك بتشرحها لطفل عنده 10 سنين.
6. **ممنوع "قمت" أو "بصفتي":** رد بالسكربت فوراً.
7. **شيل أي ملاحظات:** ممنوع أي [زووم] أو [B-roll] أو تعليمات مونتاج.

⚠️ تحذير: لو السكربت فقد روحه البصرية أو أصبح قصيراً، الإجابة مرفوضة.

المطلوب: السكربت النهائي الصافي فقط.` : 
  `You are a "Strict Human Content Critic & Editor". Your job is to transform this script from "AI-generated text" into "Authentic Human Speech".

📝 Script (${inputWordCount} words):
${script}

📊 Reference Facts:
${datasheet}

⚠️ Language:
${langConfig.prompt}

🚨 The "Coffee Shop Test" (Strictest Rules):
1. **Pronunciation Test:** Can this be said out loud to a friend naturally? If any sentence sounds "written" or "formal", convert it to smart conversational tone.
2. **No AI Breath:** Remove filler words like "In this context", "Leading to", "Thanks to this".
3. **Hook UNTOUCHABLE:** The first sentence must not be changed.
4. **Length is Sacred:** Output MUST be ${minOutputWords}+ words. Do not shorten content.
5. **Simplify Complexity:** Explain technical info like you're explaining it to a 10-year-old.
6. **NO "I have polished" or "As an AI":** Reply with script immediately.
7. **Clean output:** Remove any [Zoom], [B-roll], or editing instructions in brackets.

⚠️ WARNING: If the script loses its visual soul or becomes too short, the response is rejected.

Required: Final raw script only.`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 3000,
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
  
  const result = response.data.candidates[0].content.parts[0].text;
  return result;
}

// ============================================
// 🎣 CLAUDE - Generate Final Hook (After seeing script)
// ============================================

async function generateFinalHook(script, datasheet, style, language) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const intro = isAr
    ? `أنت خبير hooks. اقرأ السكربت الكامل ده واكتب أقوى hook ممكن له:`
    : `You're a hooks expert. Read this complete script and write the strongest possible hook for it:`;
  
  const principles = isAr ?
`🧠 مبادئ الـ Hook القوي:
• رقم ضخم + سؤال فضول + وعد + قصة ناقصة
• استخدم أقوى رقم/فكرة من السكربت
• أثر الفضول - المشاهد لازم يكمل
• أقل من 15 كلمة` :
`🧠 Powerful Hook Principles:
• Big number + curiosity question + promise + incomplete story
• Use the strongest number/idea from the script
• Create curiosity - viewer must continue
• Less than 15 words`;

  const examples = isAr ?
`📝 أمثلة (للإلهام فقط):
• "17 مليار دولار... إزاي الصين لقت الفرصة دي؟"
• "480 ميجاواط - نص مليون بيت... ليه دلوقتي؟"
• "من 37 لـ 25 عالمياً في سنتين... إيه السر؟"` :
`📝 Examples (inspiration only):
• "17 billion dollars... How did China spot this opportunity?"
• "480 megawatts - half a million homes... Why now?"
• "From 37th to 25th globally in 2 years... What's the secret?"`;

  const prompt = `${intro}

═══════════════════════════════════════
📝 ${isAr ? 'السكربت الكامل' : 'Complete Script'}:
═══════════════════════════════════════
${script}

═══════════════════════════════════════
📊 ${isAr ? 'الحقائق المتاحة' : 'Available Facts'}:
═══════════════════════════════════════
${datasheet}

═══════════════════════════════════════
🎭 ${isAr ? 'الأسلوب' : 'Style'}: ${styleTemplate.name}
═══════════════════════════════════════
${styleTemplate.tone}

═══════════════════════════════════════
${principles}
═══════════════════════════════════════

═══════════════════════════════════════
${examples}
═══════════════════════════════════════

${langConfig.prompt}

⚠️ ${isAr ? 'ممنوع' : 'Forbidden'}: ${isAr ? '"خبر عاجل"، "لو قلتلك"، "محدش هيصدق"' : '"Breaking news", "You won\'t believe", clichés'}

═══════════════════════════════════════

${isAr ? 'اكتب الـ Hook المثالي للسكربت ده (استخدم المبادئ، مش الأمثلة):' : 'Write the perfect hook for this script (use principles, not examples):'}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.content[0].text.trim();
}

// ============================================
// 🔗 CLAUDE - Integrate Hook into Script
// ============================================

async function integrateHook(script, hook, style, language) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const prompt = isAr ?
`أضف الـ Hook ده في بداية السكربت واربطه بشكل سلس:

🎣 الـ Hook:
${hook}

📝 السكربت:
${script}

المطلوب:
1. ضع الـ Hook في أول سطر
2. اربطه بشكل طبيعي مع باقي المحتوى
3. تأكد إن الانتقال من الـ Hook للـ Context سلس
4. حافظ على كل المحتوى الموجود

الأسلوب: ${styleTemplate.name}
${langConfig.prompt}

السكربت الكامل:` :
`Add this Hook at the beginning of the script and connect it smoothly:

🎣 The Hook:
${hook}

📝 The Script:
${script}

Required:
1. Place the Hook as the first line
2. Connect it naturally with the rest of the content
3. Ensure smooth transition from Hook to Context
4. Keep all existing content

Style: ${styleTemplate.name}
${langConfig.prompt}

The complete script:`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.content[0].text;
}

// ============================================
// 🎣 CLAUDE - Generate 3 Alternative Hooks
// ============================================

async function generate3AlternativeHooks(topic, architectData, style, language, niche = 'general') {
  const isAr = isArabicLang(language);
  const nicheProfile = NICHES[niche] || NICHES.general;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  
  const prompt = isAr ? 
`أنت خبير في كتابة Hooks. اكتب 3 أنواع مختلفة من الـ Hooks لنفس الموضوع.

⚠️ تعليمات اللهجة:
${langConfig.prompt}

الموضوع: ${topic}
عنصر الدهشة: ${architectData.coreSurprise}
الزاوية: ${architectData.angle}
المجال: ${nicheProfile.nameAr}

المطلوب 3 أنواع مختلفة تماماً:

1. **Hook صادم (Shock):** ابدأ برقم مرعب أو حقيقة غريبة
2. **Hook سؤال (Question):** سؤال يلمس مشكلة عند المشاهد ويثير فضوله
3. **Hook سر (Secret):** جملة توحي بأنك هتكشف معلومة مخفية أو سر

⚠️ قواعد صارمة:
- استخدم اللهجة المحددة أعلاه تماماً (ممنوع الفصحى).
- كل hook أقل من 15 كلمة
- ممنوع: "تخيل معايا"، "بص كده"، "خبر عاجل"، "لو قلتلك"
- اجعلها بشرية وطبيعية

المطلوب: رد بـ JSON فقط:
{"shock": "الهوك الصادم", "question": "هوك السؤال", "secret": "هوك السر"}` :
`You are a hooks expert. Write 3 different types of hooks for the same topic.

⚠️ Language Instructions:
${langConfig.prompt}

Topic: ${topic}
Core Surprise: ${architectData.coreSurprise}
Angle: ${architectData.angle}
Niche: ${nicheProfile.name}

Required - 3 completely different types:

1. **Shock Hook:** Start with a scary number or strange fact
2. **Question Hook:** A question that touches a viewer's problem and triggers curiosity
3. **Secret Hook:** A sentence implying you'll reveal hidden info or a secret

⚠️ Strict Rules:
- Each hook less than 15 words
- No clichés: "Imagine with me", "Look at this", "Breaking news"
- Make them human and natural

Required: Reply with JSON only:
{"shock": "The shock hook", "question": "The question hook", "secret": "The secret hook"}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  try {
    const text = response.data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Hook parsing error:', e);
  }
  
  // Fallback
  return {
    shock: response.data.content[0].text.substring(0, 100),
    question: '',
    secret: '',
  };
}

// ============================================
// 🖼️ CLAUDE - Generate 3 Visual Prompts
// ============================================

async function generate3VisualPrompts(script, topic, language) {
  const isAr = isArabicLang(language);
  
  const prompt = isAr ?
`أنت مخرج بصري محترف. اقرأ السكربت ده واكتب 3 أوصاف للصور (Visual Prompts) لاستخدامها في المونتاج.

السكربت:
${script}

المطلوب 3 صور لـ 3 أجزاء مختلفة:
1. **صورة البداية (Hook):** صورة تجذب الانتباه وتمثل بداية الفيديو
2. **صورة المنتصف (Content):** صورة تمثل المحتوى الأساسي أو الفكرة الرئيسية
3. **صورة النهاية (CTA):** صورة تمثل النتيجة أو الخلاصة

⚠️ قواعد صارمة للصور:
- ممنوع أي نصوص أو حروف أو أرقام في الصورة
- ممنوع لافتات أو علامات مكتوب عليها
- ركز على المشاعر والأجواء البصرية
- اجعل الوصف سينمائي واحترافي (Cinematic, 4K, photorealistic)
- الوصف بالإنجليزي عشان DALL-E يفهمه أفضل

المطلوب: رد بـ JSON فقط:
{
  "hook": {"prompt": "English visual description for hook scene", "caption": "وصف عربي قصير"},
  "content": {"prompt": "English visual description for content scene", "caption": "وصف عربي قصير"},
  "cta": {"prompt": "English visual description for ending scene", "caption": "وصف عربي قصير"}
}` :
`You are a professional visual director. Read this script and write 3 image descriptions (Visual Prompts) for video editing.

Script:
${script}

Required - 3 images for 3 different parts:
1. **Hook Image:** An attention-grabbing image representing the video start
2. **Content Image:** An image representing the main content or idea
3. **CTA Image:** An image representing the result or conclusion

⚠️ Strict Rules for Images:
- Absolutely NO text, letters, or numbers in the image
- NO signs or labels with writing
- Focus on emotions and visual atmosphere
- Make descriptions cinematic and professional (Cinematic, 4K, photorealistic)

Required: Reply with JSON only:
{
  "hook": {"prompt": "Visual description for hook scene", "caption": "Short caption"},
  "content": {"prompt": "Visual description for content scene", "caption": "Short caption"},
  "cta": {"prompt": "Visual description for ending scene", "caption": "Short caption"}
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  try {
    const text = response.data.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Visual prompts parsing error:', e);
  }
  
  // Fallback
  return {
    hook: { prompt: 'Cinematic wide shot, dramatic lighting, no text', caption: 'مشهد افتتاحي' },
    content: { prompt: 'Professional documentary style shot, no text', caption: 'المحتوى الرئيسي' },
    cta: { prompt: 'Inspiring conclusion scene, golden hour, no text', caption: 'الخلاصة' },
  };
}

// ============================================
// ✅ PERPLEXITY - Fact Check
// ============================================

async function factCheck(script, datasheet) {
  const response = await axios.post(
    'https://api.perplexity.ai/chat/completions',
    {
      model: CONFIG.PERPLEXITY_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a fact-checker. Verify all numbers and facts.',
        },
        {
          role: 'user',
          content: `تحقق من صحة الأرقام في السكربت:

السكربت:
${script}

الـ Datasheet:
${datasheet}

Format:
✅ صحيح: [الحقيقة]
❌ خطأ: [الحقيقة] - الصحيح: [التصحيح]
⚠️ غير متأكد: [الحقيقة]

الدقة الإجمالية: X%`,
        },
      ],
      max_tokens: 1000,
    },
    {
      headers: {
        'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.choices[0].message.content;
}

// ============================================
// 🔄 CLAUDE - Polish Script
// ============================================

async function polishScript(script, factCheckResult, style, language, originalHook) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const intro = isAr
    ? `أنت محرر محتوى محترف. راجع السكربت ده وحسّنه بشكل شامل:`
    : `You're a professional content editor. Review this script and improve it comprehensively:`;
  
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: `${intro}

═══════════════════════════════════════
🎣 ${isAr ? 'الـ HOOK الأصلي (لازم يكون موجود)' : 'Original HOOK (must be present)'}:
═══════════════════════════════════════
${originalHook}

${isAr ? 
'⚠️ تحذير: تأكد إن السكربت يبدأ بالـ HOOK ده. لو مش موجود، أضفه في البداية!' : 
'⚠️ Warning: Ensure the script starts with this HOOK. If missing, add it at the beginning!'}

═══════════════════════════════════════
📝 السكربت الحالي:
═══════════════════════════════════════
${script}

═══════════════════════════════════════
✅ نتيجة التحقق من الحقائق:
═══════════════════════════════════════
${factCheckResult}

═══════════════════════════════════════
🎯 مهمتك:
═══════════════════════════════════════

1. **تحقق من الـ Hook:**
   - لو السكربت مش بادئ بالـ HOOK اللي فوق → أضفه في أول سطر
   - لو الـ HOOK موجود بس ضعيف → قويه (أثر فضول، جذب انتباه)
   - لو الـ HOOK مكتوب بطريقة غلط → صححه بس حافظ على المعنى

2. **صحح الأخطاء:**
   - صحّح أي أرقام غلط (حسب نتيجة التحقق)
   - صحّح أي أخطاء إملائية أو نحوية
   - صحّح أي تعبيرات ركيكة أو غير واضحة

3. **بسّط اللهجة:**
   - لو فيه كلمات دسمة أو صعبة، استبدلها بكلمات أبسط
   - لو فيه تعبيرات معقدة، وضّحها
   - خلي الكلام سهل ومباشر وطبيعي

4. **وضّح الشروحات:**
   - لو أي رقم مش واضح تأثيره، وضّحه أكتر بمقارنات حقيقية
   - لو أي مقارنة ضعيفة، حسّنها أو غيرها بمقارنة أقوى
   - تأكد إن كل فكرة موصلة بوضوح تام للمشاهد العادي

5. **حسّن التدفق:**
   - خلي الانتقالات بين الأفكار سلسة ومنطقية
   - تأكد إن الجمل مترابطة وما فيش قفزات مفاجئة
   - اشيل أي تكرار غير ضروري للمعنى

6. **احتفظ بالعمق:**
   - ما تشيلش معلومات مهمة
   - ما تختصرش التفاصيل أو السياق
   - حافظ على نفس الطول تقريباً (أو أطول لو محتاج توضيح)

7. **قوّي الـ Hook (إن احتاج):**
   - لو الـ HOOK في البداية بس ضعيف، طبّق المبادئ دي:
     • أضف رقم ضخم أو إحصائية مفاجئة
     • حوّله لسؤال يثير الفضول ("إزاي؟" "ليه؟")
     • أضف وعد ضمني بمعلومة مهمة
     • اترك جزء من القصة غير مكتمل
   - ما تغيرش معناه الأساسي، بس حسّن تأثيره وقوته

═══════════════════════════════════════
🎭 الأسلوب المطلوب:
═══════════════════════════════════════
${styleTemplate.name}: ${styleTemplate.tone}
${langConfig.prompt}

═══════════════════════════════════════

اكتب السكربت المحسّن (احتفظ بنفس الطول والعمق، بس حسّن الجودة):`,
        },
      ],
    },
    {
      headers: {
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    }
  );
  
  return response.data.content[0].text;
}

// ============================================
// 🚀 API ROUTES
// ============================================

// Health Check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scripty API v1.0' });
});

// Get Config
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    styles: Object.keys(STYLES).map(key => ({ id: key, ...STYLES[key] })),
    languages: Object.keys(LANGUAGES).map(key => ({ id: key, ...LANGUAGES[key] })),
    niches: Object.keys(NICHES).map(key => ({ 
      id: key, 
      name: NICHES[key].name,
      nameAr: NICHES[key].nameAr,
      icon: NICHES[key].icon,
    })),
    durations: ['15', '30', '60'],
    structure: SCRIPT_STRUCTURE,
  });
});

// Debug env presence (does not return secrets)
app.get('/api/debug/env', (req, res) => {
  // Find all env vars that contain CLAUDE or API
  const allEnvKeys = Object.keys(process.env).filter(k => 
    k.toUpperCase().includes('CLAUDE') || 
    k.toUpperCase().includes('ANTHROPIC') ||
    k.toUpperCase().includes('API')
  );
  
  // Get raw value directly
  const rawClaude = process.env.CLAUDE_API_KEY;
  const rawPerplexity = process.env.PERPLEXITY_API_KEY;
  
  res.json({
    success: true,
    hasPerplexity: !!CONFIG.PERPLEXITY_API_KEY,
    hasClaude: !!CONFIG.CLAUDE_API_KEY,
    hasGemini: !!CONFIG.GEMINI_API_KEY,
    modelPerplexity: CONFIG.PERPLEXITY_MODEL,
    modelClaude: CONFIG.CLAUDE_MODEL,
    modelGemini: CONFIG.GEMINI_MODEL,
    envKeysFound: allEnvKeys,
    // Show more details
    claudeKeyLength: rawClaude ? rawClaude.length : 0,
    claudeKeyPreview: rawClaude ? rawClaude.substring(0, 20) + '...' : null,
    claudeKeyEnd: rawClaude ? '...' + rawClaude.substring(rawClaude.length - 10) : null,
    perplexityKeyPreview: rawPerplexity ? rawPerplexity.substring(0, 15) + '...' : null,
    // Check for common issues
    claudeHasQuotes: rawClaude ? (rawClaude.startsWith('"') || rawClaude.startsWith("'")) : false,
    claudeHasSpaces: rawClaude ? (rawClaude.startsWith(' ') || rawClaude.endsWith(' ')) : false,
  });
});

// ============================================
// 🎣 PHASE 1: Generate Hooks (User selects before script)
// ============================================

app.post('/api/generate-hooks', async (req, res) => {
  const { topic, language = 'egyptian', niche = 'general' } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  const validNiche = NICHES[niche] ? niche : 'general';
  const nicheProfile = NICHES[validNiche];
  
  try {
    console.log(`🎣 Hook Master: Starting for "${topic}"`);
    console.log(`🎯 Niche: ${nicheProfile.name}`);
    
    // Step 1: Quick research
    let researchData = '';
    try {
      console.log('🔍 Quick Research (Perplexity)...');
      researchData = await researchTopic(topic, language);
      console.log('✅ Research complete');
    } catch (e) {
      console.error('⚠️ Research failed, continuing without:', e.message);
      researchData = `Topic: ${topic}`;
    }
    
    // Step 2: Generate 3 hooks with Hook Master Brain
    console.log('🧠 Generating 3 hooks with Hook Master...');
    const hooks = await hookMasterBrain(topic, researchData, validNiche, language);
    console.log('✅ Hooks generated:', hooks);
    
    res.json({
      success: true,
      hooks: {
        shock: hooks.shock || '',
        question: hooks.question || '',
        benefit: hooks.benefit || '',
      },
      research: researchData, // Pass research to avoid re-fetching
      niche: validNiche,
      nicheName: nicheProfile.name,
    });
    
  } catch (error) {
    console.error('❌ Hook Generation Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 📝 PHASE 2: Generate Full Script (with selected hook)
// ============================================

app.post('/api/generate', async (req, res) => {
  const { topic, language = 'egyptian', duration = '60', style = 'mrbeast', niche = 'general', selectedHook, research } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  // Validate niche
  const validNiche = NICHES[niche] ? niche : 'general';
  const nicheProfile = NICHES[validNiche];
  
  try {
    let researchData, architectData, finalHook, draftScript, humanizedScript, factCheckResult;
    
    console.log(`🎯 Using Niche: ${nicheProfile.name} (${nicheProfile.nameAr})`);
    console.log(`🎣 Selected Hook: ${selectedHook ? 'Yes' : 'No'}`);
    
    // Use pre-fetched research if available (from /api/generate-hooks)
    if (research && typeof research === 'string' && research.length > 50) {
      console.log('📚 Using pre-fetched research data');
      researchData = research;
    } else {
      try {
        console.log('🔍 Phase 1: Researching (Perplexity)...');
        researchData = await researchTopic(topic, language);
        console.log('✅ Phase 1 Complete');
      } catch (e) {
        console.error('❌ PERPLEXITY ERROR:', e.response?.status, e.response?.data || e.message);
        throw new Error(`Perplexity API failed: ${e.response?.status || e.message}`);
      }
    }
    
    try {
      console.log('🏗️ Phase 2: Architecting Story (Claude)...');
      architectData = await architectStory(researchData, topic, style, language, validNiche);
      console.log('✅ Phase 2 Complete');
    } catch (e) {
      console.error('❌ CLAUDE ARCHITECT ERROR:', e.response?.status, e.response?.data || e.message);
      throw new Error(`Claude Architect failed: ${e.response?.status || e.message}`);
    }
    
    try {
      console.log('🎣 Phase 3: Creating Hook (Claude)...');
      finalHook = selectedHook || await generateArchitectHook(topic, architectData, style, language, validNiche);
      console.log('✅ Phase 3 Complete');
    } catch (e) {
      console.error('❌ CLAUDE HOOK ERROR:', e.response?.status, e.response?.data || e.message);
      throw new Error(`Claude Hook failed: ${e.response?.status || e.message}`);
    }
    
    // Generate outline if selectedHook was provided (new flow)
    let outline = null;
    if (selectedHook) {
      try {
        console.log('📐 Phase 3.5: Building Outline (Claude)...');
        outline = await outlineArchitect(topic, finalHook, researchData, validNiche, language);
        console.log('✅ Outline Complete:', outline.angle || 'OK');
      } catch (e) {
        console.log('⚠️ Outline generation skipped:', e.message);
        outline = null; // Continue without outline
      }
    }
    
    try {
      console.log('📝 Phase 4: Writing Script (Claude)...');
      draftScript = await writerPhase(topic, architectData, finalHook, style, language, duration, validNiche, outline);
      console.log('✅ Phase 4 Complete');
    } catch (e) {
      console.error('❌ CLAUDE WRITER ERROR:', e.response?.status, e.response?.data || e.message);
      throw new Error(`Claude Writer failed: ${e.response?.status || e.message}`);
    }
    
    try {
      console.log('✨ Phase 5: Humanizing (Gemini)...');
      humanizedScript = await geminiPolish(draftScript, architectData.chosenFacts, style, language);
      console.log('✅ Phase 5 Complete');
    } catch (e) {
      console.error('❌ GEMINI ERROR:', e.response?.status, e.response?.data || e.message);
      // Fallback to draft if Gemini fails
      console.log('⚠️ Gemini failed, using draft script');
      humanizedScript = draftScript;
    }
    
    try {
      console.log('✅ Phase 6: Fact Check (Perplexity)...');
      factCheckResult = await factCheck(humanizedScript, architectData.chosenFacts);
      console.log('✅ Phase 6 Complete');
    } catch (e) {
      console.error('❌ FACT CHECK ERROR:', e.response?.status, e.response?.data || e.message);
      factCheckResult = '⚠️ Fact check skipped';
    }
    
    // Generate alternative hooks and visual prompts in parallel
    let alternativeHooks = { shock: '', question: '', secret: '' };
    let visualPrompts = null;
    
    try {
      console.log('🎣 Phase 7: Generating Alternative Hooks...');
      console.log('🖼️ Phase 8: Generating Visual Prompts...');
      
      const [hooksResult, visualsResult] = await Promise.all([
        generate3AlternativeHooks(topic, architectData, style, language, validNiche),
        generate3VisualPrompts(humanizedScript, topic, language),
      ]);
      
      alternativeHooks = hooksResult;
      visualPrompts = visualsResult;
      console.log('✅ Phase 7 & 8 Complete');
    } catch (e) {
      console.error('❌ Hooks/Visuals Error:', e.message);
    }
    
    res.json({
      success: true,
      hook: finalHook,
      alternativeHooks: alternativeHooks,
      body: humanizedScript.startsWith(finalHook) ? humanizedScript.substring(finalHook.length).trim() : humanizedScript,
      script: humanizedScript,
      visualPrompts: visualPrompts,
      niche: validNiche,
      nicheName: nicheProfile.name,
      angle: architectData.angle,
      coreSurprise: architectData.coreSurprise,
      localContext: architectData.localContext,
      datasheet: architectData.chosenFacts,
      factCheck: factCheckResult,
      wordCount: humanizedScript.split(/\s+/).length,
      pipeline: 'Architect → Hook → Writer → Humanize → FactCheck → AltHooks → Visuals',
    });
    
  } catch (error) {
    console.error('❌ Pipeline Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate Hooks Only
app.post('/api/hooks', async (req, res) => {
  const { topic, style = 'mrbeast', language = 'egyptian' } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  try {
    const researchData = await researchTopic(topic, language);
    const datasheet = await extractDatasheet(researchData, topic);
    const hooks = await generateHooks(topic, datasheet, style, language);
    
    res.json({ success: true, hooks, datasheet });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 💡 TRENDING IDEAS - Get viral ideas for a niche
// ============================================

app.post('/api/trending-ideas', async (req, res) => {
  const { niche = 'general', language = 'egyptian', count = 5 } = req.body;
  
  const nicheProfile = NICHES[niche] || NICHES.general;
  const isAr = isArabicLang(language);
  
  try {
    console.log(`💡 Fetching trending ideas for niche: ${nicheProfile.name}`);
    
    const query = isAr ? 
      `ابحث عن أهم ${count} مواضيع ساخنة أو أخبار حصرية في مجال "${nicheProfile.nameAr}" تصلح لعمل فيديو قصير (Short/Reels).
      
      المطلوب لكل موضوع:
      - عنوان جذاب (أقل من 15 كلمة)
      - سبب أهميته الآن (جملة واحدة)
      
      ركز على:
      - أخبار اليوم أو الأسبوع الحالي
      - مواضيع مثيرة للجدل أو الفضول
      - أرقام صادمة أو إحصائيات جديدة
      
      Format: JSON array
      [{"title": "العنوان", "reason": "سبب الأهمية"}]` :
      `Find the top ${count} trending or exclusive topics in "${nicheProfile.name}" suitable for short videos (Short/Reels).
      
      For each topic provide:
      - Catchy title (less than 15 words)
      - Why it matters now (one sentence)
      
      Focus on:
      - Today's or this week's news
      - Controversial or curiosity-triggering topics
      - Shocking numbers or new statistics
      
      Format: JSON array
      [{"title": "Title", "reason": "Why it matters"}]`;
    
    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: CONFIG.PERPLEXITY_MODEL,
        messages: [
          {
            role: 'system',
            content: isAr ? 
              'أنت باحث محتوى متخصص. قدم مواضيع ساخنة وحصرية فقط. رد بـ JSON فقط.' :
              'You are a content researcher. Provide only trending and exclusive topics. Reply with JSON only.',
          },
          { role: 'user', content: query },
        ],
        max_tokens: 1500,
      },
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    const content = response.data.choices[0].message.content;
    
    // Parse JSON from response
    let ideas = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        ideas = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('JSON parse error:', e);
      // Fallback: create ideas from text
      ideas = [{ title: content.substring(0, 100), reason: 'Trending now' }];
    }
    
    res.json({
      success: true,
      niche: niche,
      nicheName: isAr ? nicheProfile.nameAr : nicheProfile.name,
      nicheIcon: nicheProfile.icon,
      ideas: ideas.slice(0, count),
    });
    
  } catch (error) {
    console.error('❌ Trending Ideas Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 🖼️ GENERATE IMAGE - DALL-E 3
// ============================================

app.post('/api/generate-image', async (req, res) => {
  const { prompt, size = '1024x1024', quality = 'standard' } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Prompt is required' });
  }
  
  try {
    console.log('🖼️ Generating image with DALL-E 3...');
    
    // Add "no text" rule to every prompt
    const safePrompt = `${prompt}. CRITICAL: Absolutely NO text, NO words, NO letters, NO numbers, NO signs, NO labels in the image. Pure visual only.`;
    
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: CONFIG.DALLE_MODEL,
        prompt: safePrompt,
        n: 1,
        size: size,
        quality: quality,
      },
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    const imageData = response.data.data[0];
    
    res.json({
      success: true,
      imageUrl: imageData.url,
      revisedPrompt: imageData.revised_prompt,
    });
    
  } catch (error) {
    console.error('❌ DALL-E Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 🚀 START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Scripty API running on port ${PORT}`);
});
