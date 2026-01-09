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
  PERPLEXITY_MODEL: 'sonar-pro',
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  GEMINI_MODEL: 'gemini-2.0-flash-thinking-exp-01-21',
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
    'ممنوع تماماً: "بس استنى"، "ركز معايا"، "تخيل كده"، "شوف بقى"',
    'ممنوع: رائع، مذهل، لا يصدق، صدمة، عجيب',
    'ممنوع تكرار نفس البداية لأي جملتين',
    'ممنوع أرقام غير موجودة في الـ Datasheet',
    'ممنوع الكلام المبالغ فيه أو الدرامي الزائد',
    'ممنوع تسرد الأرقام بدون شرح تأثيرها',
    'ممنوع "خبر عاجل" - دي hook ضعيف',
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
    prompt: 'اكتب باللهجة المصرية العامية. استخدم: "يعني"، "كده"، "خالص"، "أوي".',
    isArabic: true,
  },
  gulf: {
    name: 'Gulf Arabic',
    prompt: 'اكتب باللهجة الخليجية. استخدم: "وايد"، "زين"، "حيل".',
    isArabic: true,
  },
  levantine: {
    name: 'Levantine Arabic',
    prompt: 'اكتب باللهجة الشامية. استخدم: "كتير"، "هيك"، "منيح".',
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
  const langPrompt = LANGUAGES[language]?.prompt || LANGUAGES.egyptian.prompt;
  
  const response = await axios.post(
    'https://api.perplexity.ai/chat/completions',
    {
      model: CONFIG.PERPLEXITY_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a research assistant. Find the latest and most accurate information. ${langPrompt}`,
        },
        {
          role: 'user',
          content: `ابحث عن أحدث المعلومات والحقائق عن: ${topic}
          
اريد:
- أرقام وإحصائيات محددة
- تواريخ مهمة
- حقائق مثيرة للاهتمام
- مصادر موثوقة`,
        },
      ],
      max_tokens: 2000,
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
// 📊 CLAUDE - Extract Datasheet
// ============================================

async function extractDatasheet(researchData, topic) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `من البحث التالي، استخرج الحقائق والأرقام المتعلقة بـ "${topic}" فقط.

البحث:
${researchData}

المطلوب:
[F1] الحقيقة الأولى
[F2] الحقيقة الثانية
... وهكذا

قواعد:
- استخرج فقط الحقائق المتعلقة مباشرة بـ "${topic}"
- تجاهل أي معلومات عن مواضيع أخرى`,
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
// 🎣 CLAUDE - Generate Hooks
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
// 📝 CLAUDE - Generate Script
// ============================================

// NOTE: This function now generates script WITHOUT a hook
// Hook will be added later after seeing the full content
async function generateScriptWithoutHook(topic, datasheet, style, language, duration) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const durationConfig = {
    '15': { words: 55 },   // Less words (saving space for hook)
    '30': { words: 110 },
    '60': { words: 240 },
  };
  
  const config = durationConfig[duration] || durationConfig['60'];
  
  const intro = isAr
    ? `أنت كاتب سكربتات محترف. اكتب محتوى السكربت (${duration} ثانية) عن "${topic}".\n\n⚠️ مهم: اكتب المحتوى بدون Hook - الـ Hook هيتضاف لاحقاً في البداية.`
    : `You're a professional script writer. Write the script content (${duration} seconds) about "${topic}".\n\n⚠️ Important: Write content WITHOUT a hook - the hook will be added later at the beginning.`;
  
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

${isAr ? `المحتوى (~${config.words} كلمة):` : `The content (~${config.words} words):`}`;

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
// ✨ GEMINI - Polish & Critique
// ============================================

async function geminiPolish(script, datasheet, style, language) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  const isAr = isArabicLang(language);
  
  const prompt = isAr ? `أنت محرر محتوى محترف. راجع السكربت ده وحسّنه:

📝 السكربت الحالي:
${script}

📊 الحقائق المتاحة (للمرجعية):
${datasheet}

🎯 مهمتك:
1. **راجع الجودة:** قيّم السكربت من 1-10
2. **صحّح الأخطاء:** إملاء، نحو، أرقام
3. **بسّط اللهجة:** كلمات معقدة → أبسط
4. **وضّح الشروحات:** كل رقم له تأثير واضح
5. **حسّن التدفق:** انتقالات سلسة
6. **احتفظ بالعمق:** نفس الطول والتفاصيل

الأسلوب: ${styleTemplate.name}
${langConfig.prompt}

فكّر بصوت عالٍ، ثم اكتب السكربت المحسّن.` : 
`You're a professional content editor. Review and improve this script:

📝 Current Script:
${script}

📊 Available Facts (for reference):
${datasheet}

🎯 Your Task:
1. **Review quality:** Rate the script 1-10
2. **Fix errors:** Spelling, grammar, numbers
3. **Simplify language:** Complex words → simpler
4. **Clarify explanations:** Every number has clear impact
5. **Improve flow:** Smooth transitions
6. **Keep depth:** Same length and details

Style: ${styleTemplate.name}
${langConfig.prompt}

Think out loud, then write the improved script.`;

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

// Generate Full Script
app.post('/api/generate', async (req, res) => {
  const { topic, language = 'egyptian', duration = '60', style = 'mrbeast', selectedHook } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  try {
    console.log('🔍 Step 1: Researching...');
    const researchData = await researchTopic(topic, language);
    
    console.log('📊 Step 2: Extracting datasheet...');
    const datasheet = await extractDatasheet(researchData, topic);
    
    console.log('📝 Step 3: Writing script (without hook)...');
    const scriptWithoutHook = await generateScriptWithoutHook(topic, datasheet, style, language, duration);
    
    console.log('✨ Step 4: Polishing with Gemini Thinking...');
    const polishedScript = await geminiPolish(scriptWithoutHook, datasheet, style, language);
    
    console.log('🎣 Step 5: Generating final hook...');
    const finalHook = selectedHook || await generateFinalHook(polishedScript, datasheet, style, language);
    
    console.log('🔗 Step 6: Integrating hook...');
    const scriptWithHook = await integrateHook(polishedScript, finalHook, style, language);
    
    console.log('✅ Step 7: Final fact check...');
    const factCheckResult = await factCheck(scriptWithHook, datasheet);
    
    res.json({
      success: true,
      hook: finalHook,
      script: scriptWithHook,
      datasheet,
      factCheck: factCheckResult,
      wordCount: scriptWithHook.split(/\s+/).length,
      pipeline: 'Claude → Gemini Polish → Hook → Integration',
    });
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
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
// 🚀 START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Scripty API running on port ${PORT}`);
});
