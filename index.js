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
  PERPLEXITY_MODEL: 'sonar-pro',
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
};

// Log missing envs early for easier debugging (no values are printed)
const missingEnv = [];
if (!CONFIG.PERPLEXITY_API_KEY) missingEnv.push('PERPLEXITY_API_KEY');
if (!CONFIG.CLAUDE_API_KEY) missingEnv.push('CLAUDE_API_KEY');
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
  },
  gulf: {
    name: 'Gulf Arabic',
    prompt: 'اكتب باللهجة الخليجية. استخدم: "وايد"، "زين"، "حيل".',
  },
  levantine: {
    name: 'Levantine Arabic',
    prompt: 'اكتب باللهجة الشامية. استخدم: "كتير"، "هيك"، "منيح".',
  },
  english: {
    name: 'English',
    prompt: 'Write in casual, engaging English. Use conversational tone.',
  },
  french: {
    name: 'French',
    prompt: 'Écris en français conversationnel et engageant.',
  },
};

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
  
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: `اكتب 3 Hooks قوية لفيديو Short عن "${topic}".

الحقائق المتاحة:
${datasheet}

الأسلوب: ${styleTemplate.name}
${styleTemplate.tone}

قواعد الـ Hook:
1. استخدم أقوى رقم أو حقيقة من الـ datasheet
2. اخلق فجوة فضول - المشاهد لازم يعرف "ليه؟"
3. ممنوع: "خبر عاجل"، "لو قلتلك"، "محدش هيصدق"
4. اربط بتأثير حقيقي على المشاهد
5. أقل من 12 كلمة - مباشر وقوي

${langConfig.prompt}

أمثلة على Hooks قوية:
- "السعودية عملت حاجة غيرت قواعد اللعبة في التكنولوجيا"
- "مصر قفزت 12 مركز عالمياً في سنتين بس"
- "480 ميجاواط - ده رقم يساوي كهرباء نص مليون بيت"

المطلوب (اكتب 3 hooks مختلفة):
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

async function generateScript(topic, datasheet, hook, style, language, duration) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  
  const durationConfig = {
    '15': { words: 60 },   // More words for depth
    '30': { words: 120 },  // More words for depth
    '60': { words: 250 },  // More words for depth
  };
  
  const config = durationConfig[duration] || durationConfig['60'];
  
  const prompt = `أنت كاتب سكربتات محترف. اكتب سكربت عميق ومتعمق (${duration} ثانية) عن "${topic}".

═══════════════════════════════════════
📊 الحقائق المتاحة:
═══════════════════════════════════════
${datasheet}

═══════════════════════════════════════
🎣 البداية (استخدمها بالظبط):
═══════════════════════════════════════
${hook}

═══════════════════════════════════════
🎭 الأسلوب: ${styleTemplate.name}
═══════════════════════════════════════
${styleTemplate.tone}

═══════════════════════════════════════
📐 هيكل السكربت:
═══════════════════════════════════════
1. HOOK (3s): ابدأ بالـ hook اللي فوق - استخدمه بالظبط
2. CONTEXT (12s): اشرح الموضوع والسياق - ليه مهم دلوقتي؟
3. DEEP DIVE (35s): ادخل في التفاصيل المهمة:
   • كل رقم: اشرح يعني إيه (مثال: 480 ميجاواط = كهرباء 500 ألف بيت)
   • التأثير: إيه اللي هيتغير بسبب ده؟
   • السياق: ده جزء من إيه أكبر؟
   • المقارنات: قارن بحاجات معروفة
4. CTA (10s): ختام قوي + اطلب التفاعل

═══════════════════════════════════════
⚡ قواعد الكتابة الأساسية:
═══════════════════════════════════════
${RULES.general.join('\n')}

═══════════════════════════════════════
🎯 قواعد العمق (مهمة جداً):
═══════════════════════════════════════
${RULES.depth.join('\n')}

═══════════════════════════════════════
🚫 ممنوع تماماً:
═══════════════════════════════════════
${RULES.forbidden.join('\n')}

═══════════════════════════════════════
🌍 اللغة والأسلوب:
═══════════════════════════════════════
${langConfig.prompt}

═══════════════════════════════════════
📝 مثال على العمق:
═══════════════════════════════════════
❌ سطحي: "المركز مساحته 30 مليون قدم"
✅ عميق: "المركز مساحته 30 مليون قدم - يعني ده بحجم 500 ملعب كورة! المساحة الضخمة دي محتاجاها عشان..."

❌ سطحي: "هيضيف 10 مليار للاقتصاد"
✅ عميق: "هيضيف 10 مليار للاقتصاد - ده معناه 30 ألف وظيفة جديدة للشباب، ويعني إن الناتج المحلي هيزيد بنسبة..."

═══════════════════════════════════════

المهم: 
• احكي قصة كاملة - مش مجرد سرد أرقام
• كل معلومة لازم يكون واضح ليه مهمة
• اربط كل حاجة بحياة المشاهد
• خلي السكربت متدفق ومترابط من أوله لآخره

السكربت (~${config.words} كلمة):`;

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

async function polishScript(script, factCheckResult, style, language) {
  const styleTemplate = STYLES[style] || STYLES.mrbeast;
  const langConfig = LANGUAGES[language] || LANGUAGES.egyptian;
  
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: `أنت محرر محتوى محترف. راجع السكربت ده وحسّنه بشكل شامل:

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

1. **صحح الأخطاء:**
   - صحّح أي أرقام غلط (حسب نتيجة التحقق)
   - صحّح أي أخطاء إملائية أو نحوية

2. **بسّط اللهجة:**
   - لو فيه كلمات دسمة أو صعبة، استبدلها بكلمات أبسط
   - لو فيه تعبيرات معقدة، وضّحها
   - خلي الكلام سهل ومباشر

3. **وضّح الشروحات:**
   - لو أي رقم مش واضح تأثيره، وضّحه أكتر
   - لو أي مقارنة ضعيفة، حسّنها
   - تأكد إن كل فكرة موصلة بوضوح

4. **حسّن التدفق:**
   - خلي الانتقالات بين الأفكار سلسة
   - تأكد إن الجمل مترابطة
   - اشيل أي تكرار غير ضروري للمعنى

5. **احتفظ بالعمق:**
   - ما تشيلش معلومات مهمة
   - ما تختصرش التفاصيل
   - حافظ على نفس الطول تقريباً

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
    modelPerplexity: CONFIG.PERPLEXITY_MODEL,
    modelClaude: CONFIG.CLAUDE_MODEL,
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
    console.log('Step 1: Researching...');
    const researchData = await researchTopic(topic, language);
    
    console.log('Step 2: Extracting datasheet...');
    const datasheet = await extractDatasheet(researchData, topic);
    
    let hook = selectedHook;
    let hooks = [];
    if (!hook) {
      console.log('Step 3: Generating hooks...');
      hooks = await generateHooks(topic, datasheet, style, language);
      hook = hooks[0];
    }
    
    console.log('Step 4: Generating script...');
    const script = await generateScript(topic, datasheet, hook, style, language, duration);
    
    console.log('Step 5: Fact checking...');
    const factCheckResult = await factCheck(script, datasheet);
    
    // Always polish the script for better quality
    console.log('Step 6: Polishing & refining...');
    const finalScript = await polishScript(script, factCheckResult, style, language);
    
    res.json({
      success: true,
      hooks: hooks.length > 0 ? hooks : [hook],
      script: finalScript,
      datasheet,
      factCheck: factCheckResult,
      wordCount: finalScript.split(/\s+/).length,
    });
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
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
