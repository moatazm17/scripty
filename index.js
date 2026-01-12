const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
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
  GEMINI_MODEL: 'gemini-2.5-flash',
  DALLE_MODEL: 'dall-e-3',
};

// ============================================
// 📚 LOAD NICHE EXAMPLES
// ============================================

let NICHE_EXAMPLES = {};
try {
  const examplesPath = path.join(__dirname, 'examples', 'niche-examples.json');
  NICHE_EXAMPLES = JSON.parse(fs.readFileSync(examplesPath, 'utf8'));
  console.log('✅ Loaded niche examples:', Object.keys(NICHE_EXAMPLES.categories).join(', '));
} catch (e) {
  console.error('⚠️ Could not load niche-examples.json:', e.message);
}

// ============================================
// 🌍 DIALECTS
// ============================================

const DIALECTS = {
  egyptian: {
    name: 'Egyptian Arabic',
    style: 'مصري عامي - زي ما بتكلم صاحبك',
  },
  gulf: {
    name: 'Gulf Arabic',
    style: 'خليجي - سعودي/إماراتي',
  },
  levantine: {
    name: 'Levantine Arabic',
    style: 'شامي - سوري/لبناني',
  },
  english: {
    name: 'English',
    style: 'Casual conversational English',
  },
};

// ============================================
// 🎯 NICHE MAPPING
// ============================================

const NICHE_MAP = {
  'real_estate': 'real_estate',
  'realestate': 'real_estate',
  'عقارات': 'real_estate',
  'content': 'content_creation',
  'content_creation': 'content_creation',
  'محتوى': 'content_creation',
  'business': 'business',
  'بيزنس': 'business',
  'technology': 'technology',
  'tech': 'technology',
  'تكنولوجيا': 'technology',
  'general': 'general',
  'عام': 'general',
  'self_development': 'self_development',
  'self': 'self_development',
  'تطوير': 'self_development',
  'restaurants': 'restaurants',
  'food': 'restaurants',
  'مطاعم': 'restaurants',
  'fashion': 'fashion',
  'فاشون': 'fashion',
};

function getNicheKey(niche) {
  const normalized = (niche || 'general').toLowerCase().trim();
  return NICHE_MAP[normalized] || 'general';
}

function getNicheExamples(niche) {
  const key = getNicheKey(niche);
  const category = NICHE_EXAMPLES.categories?.[key];
  if (category && category.examples) {
    return category.examples;
  }
  return NICHE_EXAMPLES.categories?.general?.examples || [];
}

function getUniversalHooks() {
  return NICHE_EXAMPLES.universal_hooks || [];
}

// ============================================
// 🔧 HELPER FUNCTIONS
// ============================================

function getDurationConfig(duration) {
  const durationInt = parseInt(duration) || 60;
  const configs = {
    15: { words: 80, maxTokens: 600 },
    30: { words: 150, maxTokens: 1200 },
    60: { words: 280, maxTokens: 2500 },
    90: { words: 400, maxTokens: 3000 },
  };
  return configs[durationInt] || configs[60];
}

function cleanScript(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[━═─]{3,}/g, '')
    .replace(/^Caption:.*$/gim, '')
    .replace(/^#.*$/gim, '')
    .replace(/^(إليك|السكربت|هذا)[:\s]*/im, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================
// 🔍 STAGE 1: RESEARCH (Perplexity)
// ============================================

async function research(topic) {
  console.log('   📚 Researching...');
  
  const response = await axios.post(
    'https://api.perplexity.ai/chat/completions',
    {
      model: CONFIG.PERPLEXITY_MODEL,
      messages: [
        {
          role: 'system',
          content: 'باحث محترف. هات أرقام محددة، تواريخ، تفاصيل دقيقة، ومقارنات.'
        },
        {
          role: 'user',
          content: `ابحث بعمق عن: ${topic}

أريد:
1. أرقام محددة (مبالغ، نسب، أحجام)
2. تواريخ ومواعيد
3. مقارنات (أكبر من X، يساوي Y)
4. تفاصيل مفاجئة أو غير معروفة
5. تأثير على الناس العاديين`
        }
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
// ✍️ STAGE 2: WRITE SCRIPT (Claude - One Shot)
// ============================================

async function writeScript(topic, researchData, niche, dialect, duration) {
  console.log('   ✍️ Writing script...');
  
  const dialectConfig = DIALECTS[dialect] || DIALECTS.egyptian;
  const durationConfig = getDurationConfig(duration);
  const examples = getNicheExamples(niche);
  const hooks = getUniversalHooks();
  
  // Build examples section
  let examplesText = '';
  if (examples.length > 0) {
    examplesText = examples.map((ex, i) => 
      `═══ مثال ${i + 1}: ${ex.title} ═══\n${ex.script}`
    ).join('\n\n');
  }
  
  // Build hooks section
  let hooksText = '';
  if (hooks.length > 0) {
    hooksText = hooks.map((h, i) => `${i + 1}. "${h}"`).join('\n');
  }

  const prompt = `اكتب سكربت فيديو قصير (~${durationConfig.words} كلمة) عن:
${topic}

═══════════════════════════════════════
📚 المعلومات من البحث:
═══════════════════════════════════════
${researchData.substring(0, 2500)}

═══════════════════════════════════════
🗣️ اللهجة: ${dialectConfig.name}
${dialectConfig.style}
═══════════════════════════════════════

═══════════════════════════════════════
🎣 أمثلة Hooks (استخدم كإلهام - لا تنسخ):
═══════════════════════════════════════
${hooksText}

(استبدل {topic} بجزء غامض من الموضوع)

═══════════════════════════════════════
📝 أمثلة سكربتات ممتازة (تعلم الأسلوب - لا تنسخ):
═══════════════════════════════════════

${examplesText}

═══════════════════════════════════════
🎯 لاحظ في الأمثلة:
═══════════════════════════════════════

1️⃣ HOOK قوي في البداية:
   - سؤال أو تحدي أو صدمة
   - "لو فاكر إن..."، "ليه..."، "أوعى..."

2️⃣ "إحنا مش بنتكلم عن X.. إحنا بنتكلم عن Y":
   - توضيح الفرق بين السطحي والعميق

3️⃣ أرقام + تشبيهات:
   - "5 مليون جنيه"، "20% سنوياً"
   - "تخيل إن..."

4️⃣ معلومة مفاجئة أو سر

5️⃣ "وعشان كدة.. [situation].. لازم تسأل نفسك السؤال الأهم:":
   - الختام دايماً بالصيغة دي
   - سؤال مفتوح يخلي المشاهد يفكر

═══════════════════════════════════════
❌ ممنوع تماماً:
═══════════════════════════════════════
• "هل تعلم"، "تخيل كده"، "بص كده"
• "يُعد"، "حيث"، "علاوة على ذلك"، "في إطار"
• فواصل (━━━) أو Caption أو هاشتاجات
• أي كلام بعد الختام

═══════════════════════════════════════
اكتب السكربت مباشرة عن: ${topic}
═══════════════════════════════════════`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: durationConfig.maxTokens,
      system: 'أنت كاتب سكربتات viral. اكتب بالعامية كما تتكلم. Output: نص السكربت فقط بدون مقدمات.',
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
  
  return cleanScript(response.data.content[0].text);
}

// ============================================
// 🔧 STAGE 3: QUICK POLISH (Gemini)
// ============================================

async function quickPolish(script, dialect) {
  console.log('   🔧 Quick polish...');
  
  const dialectConfig = DIALECTS[dialect] || DIALECTS.egyptian;
  
  const prompt = `راجع السكربت ده وأصلح فقط:

${script}

═══════════════════════════════════════
إصلاحات سريعة:
═══════════════════════════════════════
1. شيل "يُعد"، "حيث"، "علاوة" ← حولها لعامي
2. شيل أي "━━━" أو "Caption:" أو "#"
3. أي جملة > 20 كلمة ← قسمها لجملتين
4. تأكد الختام بـ "وعشان كدة.. [situation].. لازم تسأل نفسك السؤال الأهم:"

اللهجة: ${dialectConfig.name}

أعطني السكربت المحسّن فقط (بدون مقدمات):`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2000,
      },
    },
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  return cleanScript(response.data.candidates[0].content.parts[0].text);
}

// ============================================
// 🎣 GENERATE HOOKS (Separate)
// ============================================

async function generateHooks(topic, researchData, niche, dialect) {
  console.log('   🎣 Generating hooks...');
  
  const dialectConfig = DIALECTS[dialect] || DIALECTS.egyptian;
  const hooks = getUniversalHooks();
  const examples = getNicheExamples(niche);
  
  // Get hook examples from scripts
  const hookExamples = examples.map(ex => {
    const firstLine = ex.script.split('\n')[0];
    return firstLine;
  }).join('\n');

  const prompt = `اكتب 3 Hooks مختلفة للموضوع ده:

الموضوع: ${topic}

البحث (للإلهام):
${researchData.substring(0, 800)}

═══════════════════════════════════════
🎣 أنماط Hooks (استخدم كإلهام):
═══════════════════════════════════════
${hooks.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

═══════════════════════════════════════
📝 أمثلة Hooks من سكربتات ناجحة:
═══════════════════════════════════════
${hookExamples}

═══════════════════════════════════════
🎯 القواعد:
═══════════════════════════════════════
• كل Hook مختلف عن الثاني في الأسلوب
• غموض يثير الفضول (مش تكشف كل الموضوع)
• ممكن تستخدم: سؤال، تحدي، صدمة، رقم
• اللهجة: ${dialectConfig.name}

❌ ممنوع:
• "هل تعلم"، "تخيل كده"
• كشف كل التفاصيل

JSON فقط:
{"hooks": ["hook1", "hook2", "hook3"]}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 1000,
      system: 'أنت كاتب Hooks viral. Output: JSON فقط.',
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
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.hooks || [];
    }
  } catch (e) {
    console.error('   ⚠️ Hook parsing error:', e.message);
  }
  
  return [
    `اللي بيوصلك عن ${topic.substring(0, 30)} ده نص الحقيقة بس...`,
    `لو فاكر إن اللي بيحصل في ${topic.substring(0, 30)} ده صدفة... تبقى غلطان!`,
    `أتحداك تكون واخد بالك من التفصيلة دي في ${topic.substring(0, 30)}...`
  ];
}

// ============================================
// 🖼️ GENERATE VISUAL PROMPTS (DALL-E Ready)
// ============================================

async function generateVisualPrompts(topic, script) {
  console.log('   🖼️ Generating visual prompts...');
  
  const prompt = `Based on this script, create 3 image descriptions for a video storyboard.

Topic: ${topic}

Script:
${script.substring(0, 1000)}

Create 3 different scenes that would work well as video backgrounds or B-roll.
Each description should be a detailed prompt for image generation.

Rules:
- Photorealistic style
- No text, watermarks, or logos in the image
- Professional documentary/news photography style
- Each scene should be different (wide shot, medium shot, close-up)

JSON only:
{"prompts": ["prompt1", "prompt2", "prompt3"]}`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 1000,
        system: 'You create image generation prompts. Output: JSON only.',
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
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.prompts || [];
    }
  } catch (e) {
    console.error('   ⚠️ Visual prompt error:', e.message);
  }
  
  return [
    `Photorealistic wide shot of ${topic}, professional documentary style`,
    `Photorealistic medium shot showing details of ${topic}`,
    `Photorealistic close-up dramatic shot of ${topic}`
  ];
}

// ============================================
// 🚀 MAIN PIPELINE (n8n Style - Simple)
// ============================================

async function generateScript(topic, language, niche, duration) {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('🚀 n8n-Style Pipeline Started');
  console.log(`📌 Topic: ${topic}`);
  console.log(`🌍 Dialect: ${language}`);
  console.log(`🎯 Niche: ${niche} → ${getNicheKey(niche)}`);
  console.log(`⏱️ Duration: ${duration}s`);
  console.log('═══════════════════════════════════════');
  
  const startTime = Date.now();
  
  try {
    // Stage 1: Research
    const researchData = await research(topic);
    console.log('   ✓ Research done');
    
    // Stage 2: Generate Hooks (parallel with script)
    const hooksPromise = generateHooks(topic, researchData, niche, language);
    
    // Stage 3: Write Script (One Shot with inline examples)
    const draft = await writeScript(topic, researchData, niche, language, duration);
    console.log(`   ✓ Draft: ${draft.split(/\s+/).length} words`);
    
    // Stage 4: Quick Polish
    const polished = await quickPolish(draft, language);
    const wordCount = polished.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Polished: ${wordCount} words`);
    
    // Wait for hooks
    const hooks = await hooksPromise;
    console.log(`   ✓ Hooks: ${hooks.length}`);
    
    // Stage 5: Visual Prompts
    const visualPrompts = await generateVisualPrompts(topic, polished);
    console.log(`   ✓ Visual prompts: ${visualPrompts.length}`);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('═══════════════════════════════════════');
    console.log(`✨ Pipeline Complete in ${elapsed}s`);
    console.log('═══════════════════════════════════════');
    console.log('');
    
    return {
      success: true,
      script: polished,
      wordCount,
      hooks,
      mainHook: hooks[0] || '',
      alternativeHooks: hooks.slice(1),
      visualPrompts,
      research: researchData.substring(0, 500),
      pipeline: 'n8n-style',
      elapsed: `${elapsed}s`,
    };
    
  } catch (error) {
    console.error('❌ Pipeline Error:', error.message);
    throw error;
  }
}

// ============================================
// 🚀 API ROUTES
// ============================================

app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Scripty API - n8n Style Pipeline',
    niches: Object.keys(NICHE_EXAMPLES.categories || {}),
  });
});

app.post('/api/generate', async (req, res) => {
  const { 
    topic, 
    language = 'egyptian', 
    niche = 'general',
    duration = '60' 
  } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  try {
    const result = await generateScript(
      topic, 
      language, 
      niche,
      parseInt(duration) || 60
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================
// 🚀 START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Scripty API running on port ${PORT}`);
  console.log(`📚 Loaded niches: ${Object.keys(NICHE_EXAMPLES.categories || {}).join(', ')}`);
});
