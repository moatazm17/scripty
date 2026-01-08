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
    'Pattern interrupt كل 10 ثواني عشان تحافظ على انتباه المشاهد',
    'ممنوع تكرار أي معلومة أو جملة',
    'استخدم أرقام من الـ Datasheet فقط - ممنوع تخترع',
    'خاطب المشاهد مباشرة (انتَ، تخيل، شوف)',
    'استخدم أسئلة بلاغية لجذب الانتباه',
  ],
  pattern_interrupts: [
    'بس استنى...',
    'وده مش كل حاجة...',
    'ركّز معايا هنا...',
    'تخيل كده...',
  ],
  forbidden: [
    'لا تستخدم: رائع، مذهل، لا يصدق',
    'لا تكرر نفس البداية لأي جملتين',
    'لا تستخدم أرقام غير موجودة في الـ Datasheet',
  ],
};

// ============================================
// 🎭 STYLES
// ============================================

const STYLES = {
  mrbeast: {
    name: 'MrBeast',
    tone: 'حماسي، مثير، سريع',
    hooks: ['تخيل كده إن...', 'لو قلتلك إن...', 'محدش هيصدق إن...'],
    examples: ['الرقم ده لو حولته لـ... يعني...', 'ده معناه إن كل... بيحصل...'],
  },
  educational: {
    name: 'Educational',
    tone: 'تعليمي، واضح، منظم',
    hooks: ['الحقيقة اللي محدش بيقولها...', 'السبب العلمي وراء...', 'إزاي بالظبط...'],
    examples: ['ببساطة، ده معناه...', 'لو عايز تفهم، تخيل إن...'],
  },
  shocking: {
    name: 'Shocking',
    tone: 'صادم، مفاجئ، درامي',
    hooks: ['الخبر ده هيغير كل حاجة...', 'اللي حصل ده مش طبيعي...', 'محدش كان متوقع...'],
    examples: ['والمفاجأة إن...', 'بس الصدمة الحقيقية...'],
  },
  viral: {
    name: 'Viral',
    tone: 'جذاب، قابل للمشاركة، عاطفي',
    hooks: ['القصة دي لازم تعرفها...', 'ده اللي مش هتلاقيه في أي مكان تاني...'],
    examples: ['وده اللي خلى الموضوع ينتشر...', 'الناس مش مصدقة إن...'],
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
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `اكتب 3 Hooks مختلفة لفيديو Short عن "${topic}".

الـ Datasheet:
${datasheet}

الـ Style: ${styleTemplate.name} (${styleTemplate.tone})

أمثلة:
${styleTemplate.hooks.join('\n')}

${langConfig.prompt}

المطلوب:
Hook 1: [hook مثير]
Hook 2: [hook مختلف]
Hook 3: [hook ثالث]

كل Hook أقل من 10 كلمات ويثير الفضول فوراً`,
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
    '15': { words: 50 },
    '30': { words: 100 },
    '60': { words: 200 },
  };
  
  const config = durationConfig[duration] || durationConfig['60'];
  
  const prompt = `اكتب سكربت Short (${duration} ثانية) عن "${topic}".

═══════════════════════════════════════
📊 الـ DATASHEET:
═══════════════════════════════════════
${datasheet}

═══════════════════════════════════════
🎣 الـ HOOK (استخدمه بالظبط):
═══════════════════════════════════════
${hook}

═══════════════════════════════════════
🎭 الـ STYLE: ${styleTemplate.name}
═══════════════════════════════════════
Tone: ${styleTemplate.tone}

═══════════════════════════════════════
📐 الـ STRUCTURE:
═══════════════════════════════════════
1. 🎣 HOOK (3s): ${SCRIPT_STRUCTURE.hook.purpose}
2. 📍 CONTEXT (12s): ${SCRIPT_STRUCTURE.context.purpose}
3. 📚 CONTENT (30s): ${SCRIPT_STRUCTURE.content.purpose}
4. ✅ CTA (15s): ${SCRIPT_STRUCTURE.cta.purpose}

═══════════════════════════════════════
📏 القواعد:
═══════════════════════════════════════
${RULES.general.join('\n')}

═══════════════════════════════════════
🔄 Pattern Interrupts:
═══════════════════════════════════════
${RULES.pattern_interrupts.join(' | ')}

═══════════════════════════════════════
🚫 ممنوع:
═══════════════════════════════════════
${RULES.forbidden.join('\n')}

═══════════════════════════════════════
🌍 اللغة:
═══════════════════════════════════════
${langConfig.prompt}

═══════════════════════════════════════

اكتب السكربت الآن (~${config.words} كلمة):`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 2000,
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
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `راجع وحسّن السكربت:

السكربت:
${script}

نتيجة الـ Fact Check:
${factCheckResult}

المطلوب:
1. صحّح أي أخطاء
2. حسّن الصياغة
3. Style: ${styleTemplate.name}
4. ${langConfig.prompt}

السكربت المحسّن:`,
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
    
    let finalScript = script;
    if (factCheckResult.includes('❌')) {
      console.log('Step 6: Polishing...');
      finalScript = await polishScript(script, factCheckResult, style, language);
    }
    
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
