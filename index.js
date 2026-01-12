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
};

// ============================================
// 📚 LOAD NICHE EXAMPLES
// ============================================

let NICHE_EXAMPLES = {};
try {
  const examplesPath = path.join(__dirname, 'examples', 'niche-examples.json');
  NICHE_EXAMPLES = JSON.parse(fs.readFileSync(examplesPath, 'utf8'));
  console.log('✅ Loaded niche examples:', Object.keys(NICHE_EXAMPLES.categories || {}).join(', '));
} catch (e) {
  console.error('⚠️ Could not load niche-examples.json:', e.message);
}

// ============================================
// 🌍 DIALECTS
// ============================================

const DIALECTS = {
  egyptian: { name: 'Egyptian Arabic', style: 'مصري عامي - زي ما بتكلم صاحبك' },
  gulf: { name: 'Gulf Arabic', style: 'خليجي - سعودي/إماراتي' },
  levantine: { name: 'Levantine Arabic', style: 'شامي - سوري/لبناني' },
  english: { name: 'English', style: 'Casual conversational English' },
};

// ============================================
// 🎯 NICHE HELPERS
// ============================================

const NICHE_MAP = {
  'real_estate': 'real_estate', 'realestate': 'real_estate', 'عقارات': 'real_estate',
  'content': 'content_creation', 'content_creation': 'content_creation', 'محتوى': 'content_creation',
  'business': 'business', 'بيزنس': 'business',
  'technology': 'technology', 'tech': 'technology', 'تكنولوجيا': 'technology',
  'general': 'general', 'عام': 'general',
  'self_development': 'self_development', 'self': 'self_development', 'تطوير': 'self_development',
  'restaurants': 'restaurants', 'food': 'restaurants', 'مطاعم': 'restaurants',
  'fashion': 'fashion', 'فاشون': 'fashion',
};

function getNicheKey(niche) {
  const normalized = (niche || 'general').toLowerCase().trim();
  return NICHE_MAP[normalized] || 'general';
}

function getNicheExamples(niche) {
  const key = getNicheKey(niche);
  const category = NICHE_EXAMPLES.categories?.[key];
  if (category && category.examples) return category.examples;
  return NICHE_EXAMPLES.categories?.general?.examples || [];
}

function getUniversalHooks() {
  return NICHE_EXAMPLES.universal_hooks || [];
}

function getDurationConfig(duration) {
  const durationInt = parseInt(duration) || 60;
  const configs = {
    15: { words: 80, maxTokens: 600 },
    30: { words: 150, maxTokens: 1200 },
    60: { words: 200, maxTokens: 2000 },
    90: { words: 300, maxTokens: 2500 },
  };
  return configs[durationInt] || configs[60];
}

// ============================================
// 🔧 STYLE GUIDE (n8n Style)
// ============================================

const STYLE_GUIDE = `
=== أسلوب الكتابة ===
• لهجة مصرية 100%: "بص بقى"، "من الآخر"، "الخلاصة"
• أرقام بالأرقام: "500 مليون"، "128 طن"
• تشبيهات: "أكبر من 10 ملاعب!"، "يكفي لتشغيل مدينة كاملة!"

=== ممنوعات ===
❌ "يُعد"، "حيث"، "علاوة على ذلك"، "في إطار"، "بالإضافة إلى"
❌ "هل تعلم"، "تخيل كده" (كبداية)
❌ أعلام أو إيموجي وطنية (🇪🇬) إلا لو الموضوع وطني فعلاً
❌ فواصل (━━━) أو Caption أو هاشتاجات
`;

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
          content: 'باحث محترف. أرقام، تواريخ، تفاصيل دقيقة. في النهاية اذكر كل المصادر بالروابط.'
        },
        {
          role: 'user',
          content: `ابحث بعمق عن: ${topic}

أريد:
1. أرقام محددة (مبالغ، نسب، أحجام)
2. تواريخ ومواعيد
3. مقارنات (أكبر من X، يساوي Y)
4. تفاصيل مفاجئة أو غير معروفة
5. تأثير على الناس العاديين

في النهاية اذكر المصادر بالروابط الكاملة.`
        }
      ],
      max_tokens: 3000,
      temperature: 0.2,
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
// 🎣 STAGE 2: GENERATE HOOKS (n8n Style)
// ============================================

async function generateHooks(topic, researchData, niche) {
  console.log('   🎣 Generating hooks...');
  
  const examples = getNicheExamples(niche);
  const universalHooks = getUniversalHooks();
  
  // Extract hooks from examples
  const exampleHooks = examples.map(ex => {
    const firstLine = ex.script.split('\n')[0];
    return firstLine;
  }).slice(0, 3);

  const prompt = `اكتب 3 Hooks مثيرة للفضول زي الأمثلة دي بالظبط:

الموضوع: ${topic}
البحث: ${researchData.substring(0, 800)}

=== أمثلة Hooks من نفس المجال ===
${exampleHooks.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== أنماط Hooks عامة (للإلهام) ===
${universalHooks.slice(0, 3).map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== لاحظ الأسلوب ===
• غموض يثير الفضول
• سؤال أو تحدي أو صدمة
• ❌ ممنوع تكشف الموضوع بالكامل
• ❌ ممنوع "هل تعلم" أو "تخيل كده"
• ✅ "لو فاكر إن..."، "ليه..."، "أوعى..."

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
  
  // Fallback
  return [
    `اللي بيوصلك عن ${topic.substring(0, 30)} ده نص الحقيقة بس...`,
    `لو فاكر إن اللي بيحصل في ${topic.substring(0, 30)} ده صدفة... تبقى غلطان!`,
    `أتحداك تكون واخد بالك من التفصيلة دي...`
  ];
}

// ============================================
// ✍️ STAGE 3: WRITE SCRIPT (n8n Style - Dense)
// ============================================

async function writeScript(topic, researchData, niche, selectedHook, duration) {
  console.log('   ✍️ Writing dense script...');
  
  const durationConfig = getDurationConfig(duration);
  const examples = getNicheExamples(niche);
  
  // Get the BEST example (first one) as the golden template
  const goldenExample = examples[0]?.script || '';

  const prompt = `اكتب سكربت يوتيوب قصير (${durationConfig.words} كلمة تقريباً) دسم ومليان معلومات.

الموضوع: ${topic}

=== الـ HOOK - مهم جداً! ===
⚠️ استخدم الـ Hook ده بالظبط حرف بحرف من غير أي تغيير:
"${selectedHook}"

❌ ممنوع تغيّر ولا كلمة في الـ Hook!
✅ ابدأ السكربت بالـ Hook ده بالظبط!

=== البحث (المصدر الوحيد للمعلومات!) ===
${researchData.substring(0, 2500)}

=== هيكل السكربت الدسم ===

1. HOOK (السطر الأول - الـ Hook بالظبط!):
"${selectedHook}"

2. "إحنا مش بنتكلم عن [السطحي].. إحنا بنتكلم عن [العميق]":
- وضّح الفرق بين الفهم السطحي والحقيقة

3. الكشف + شرح ببساطة (ده معناه إيه؟):
- اكشف الموضوع بأرقام محددة من البحث
- اشرح للمشاهد العادي: "يعني إيه؟"
- وضّح الفايدة: "ده معناه إن..."

4. تفاصيل وأرقام أكتر:
- أرقام محددة من البحث: "500 مليون"، "12 ألف"
- مقارنات: "أكبر من 10 ملاعب!"، "يكفي لتشغيل مدينة!"

5. "لكن الحاجة الخطيرة؟" + مفاجأة:
- معلومة مفاجئة من البحث

6. الخلاصة + "وعشان كدة.. لازم تسأل نفسك السؤال الأهم:":
- سؤال ذكي يخلي المشاهد يفكر

=== مثال سكربت دسم (اتعلم منه الـ Density والـ Flow!) ===
${goldenExample}

=== قواعد مهمة ===
⚠️ الـ Hook بالظبط من غير تغيير!
⚠️ كل رقم لازم يكون من البحث - ممنوع تألف!
⚠️ اشرح للمشاهد العادي - إيه الفايدة؟
${STYLE_GUIDE}

اكتب السكربت فقط:`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: durationConfig.maxTokens,
      system: 'أنت كاتب سكربتات viral. اكتب بالعامية المصرية. Output: نص السكربت فقط بدون مقدمات.',
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
  
  let script = response.data.content[0].text;
  
  // Clean markdown artifacts
  script = script
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,3}\s*/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
  
  return script;
}

// ============================================
// 🔍 STAGE 4: FACT-CHECK (Compare with Research)
// ============================================

async function factCheck(script, researchData, selectedHook) {
  console.log('   🔍 Fact-checking...');
  
  const prompt = `راجع السكربت وقارنه بالبحث.

السكربت:
${script}

البحث (المصدر الوحيد للحقيقة!):
${researchData}

الـ Hook المطلوب:
"${selectedHook}"

ابحث عن:
1. أرقام غلط أو مألفة (مش موجودة في البحث)
2. تواريخ غلط
3. معلومات اتألفت من دماغ الـ AI
4. هل الـ Hook في أول السكربت هو بالظبط: "${selectedHook}"؟

JSON فقط:
{
  "hasErrors": true/false,
  "hookCorrect": true/false,
  "errors": [{"wrong": "...", "correct": "...", "reason": "..."}]
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 1500,
      system: 'أنت مدقق حقائق. Output: JSON فقط.',
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
      return JSON.parse(match[0]);
    }
  } catch (e) {
    console.error('   ⚠️ Fact-check parsing error:', e.message);
  }
  
  return { hasErrors: false, hookCorrect: true, errors: [] };
}

// ============================================
// 🔧 STAGE 5: FIX SCRIPT (If Errors Found)
// ============================================

async function fixScript(script, errors, selectedHook, researchData) {
  console.log('   🔧 Fixing errors...');
  
  const prompt = `صحّح الأخطاء دي في السكربت مع الحفاظ على الـ Hook في الأول بالظبط:

السكربت:
${script}

الـ Hook اللي لازم يفضل في الأول بالظبط (حرف بحرف!):
"${selectedHook}"

الأخطاء المطلوب تصحيحها:
${JSON.stringify(errors, null, 2)}

البحث (للتأكد من الأرقام الصحيحة):
${researchData.substring(0, 1500)}

${STYLE_GUIDE}

⚠️ لازم السكربت يبدأ بالـ Hook بالظبط!
⚠️ صحّح الأخطاء بس - ماتغيرش الباقي!

ارجع السكربت المصحح فقط:`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 2000,
      system: 'أنت مصحح سكربتات. Output: السكربت المصحح فقط.',
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
  
  return response.data.content[0].text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,3}\s*/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
}

// ============================================
// 🧹 STAGE 6: STYLE CHECK & CLEANUP
// ============================================

function styleCleanup(script, selectedHook) {
  let cleaned = script;
  
  // Ensure hook is at the start
  if (!cleaned.startsWith(selectedHook)) {
    // Try to find and replace wrong hook
    const firstLine = cleaned.split('\n')[0];
    if (firstLine.length < 200) {
      cleaned = cleaned.replace(firstLine, selectedHook);
    } else {
      cleaned = selectedHook + '\n\n' + cleaned;
    }
  }
  
  // Remove forbidden words/patterns
  cleaned = cleaned
    .replace(/يُعد/g, 'بيعتبر')
    .replace(/حيث/g, 'لأن')
    .replace(/علاوة على ذلك/g, 'وكمان')
    .replace(/بالإضافة إلى/g, 'وكمان')
    .replace(/في إطار/g, 'ضمن')
    .replace(/[━═─—–_]{3,}/g, '')
    .replace(/^Caption:.*$/gim, '')
    .replace(/^#.*$/gim, '')
    .replace(/🇪🇬/g, '') // Remove flag unless topic is national
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return cleaned;
}

// ============================================
// 🖼️ GENERATE VISUAL PROMPTS
// ============================================

async function generateVisualPrompts(topic, script) {
  console.log('   🖼️ Generating visual prompts...');
  
  const prompt = `Based on this script, create 3 image descriptions for a video storyboard.

Topic: ${topic}
Script: ${script.substring(0, 1000)}

Create 3 different scenes:
1. Hook scene (opening - grab attention)
2. Content scene (main information)
3. CTA scene (closing - call to action)

Rules:
- Photorealistic documentary style
- No text, watermarks, or logos
- Professional photography
- Each scene different angle/mood

JSON only:
{
  "hook": {"prompt": "...", "caption": "مشهد البداية"},
  "content": {"prompt": "...", "caption": "مشهد المحتوى"},
  "cta": {"prompt": "...", "caption": "مشهد النهاية"}
}`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 1000,
        system: 'Create image prompts. Output: JSON only.',
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
      if (parsed.hook && parsed.content && parsed.cta) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('   ⚠️ Visual prompt error:', e.message);
  }
  
  // Fallback
  return {
    hook: { prompt: `Photorealistic wide shot of ${topic}`, caption: 'مشهد البداية' },
    content: { prompt: `Photorealistic medium shot of ${topic}`, caption: 'مشهد المحتوى' },
    cta: { prompt: `Photorealistic close-up of ${topic}`, caption: 'مشهد النهاية' }
  };
}

// ============================================
// 🚀 MAIN PIPELINE (n8n Style)
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
    
    // Stage 2: Generate Hooks
    const hooks = await generateHooks(topic, researchData, niche);
    console.log(`   ✓ Hooks: ${hooks.length}`);
    
    // Select first hook as main
    const selectedHook = hooks[0] || topic;
    
    // Stage 3: Write Script (with golden example from niche)
    let script = await writeScript(topic, researchData, niche, selectedHook, duration);
    console.log(`   ✓ Draft: ${script.split(/\s+/).length} words`);
    
    // Stage 4: Fact-Check
    const factCheckResult = await factCheck(script, researchData, selectedHook);
    console.log(`   ✓ Fact-check: ${factCheckResult.hasErrors ? '❌ Errors found' : '✅ Clean'}`);
    
    // Stage 5: Fix if errors
    if (factCheckResult.hasErrors && factCheckResult.errors?.length > 0) {
      script = await fixScript(script, factCheckResult.errors, selectedHook, researchData);
      console.log('   ✓ Errors fixed');
    }
    
    // Fix hook if wrong
    if (!factCheckResult.hookCorrect) {
      console.log('   ⚠️ Hook was changed, enforcing...');
      if (!script.startsWith(selectedHook)) {
        const firstLine = script.split('\n')[0];
        script = script.replace(firstLine, selectedHook);
      }
    }
    
    // Stage 6: Style Cleanup
    script = styleCleanup(script, selectedHook);
    const wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Final: ${wordCount} words`);
    
    // Stage 7: Visual Prompts
    const visualPrompts = await generateVisualPrompts(topic, script);
    console.log('   ✓ Visual prompts ready');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('═══════════════════════════════════════');
    console.log(`✨ Pipeline Complete in ${elapsed}s`);
    console.log('═══════════════════════════════════════');
    console.log('');
    
    return {
      success: true,
      script,
      wordCount,
      hook: selectedHook,
      alternativeHooks: {
        shock: hooks[1] || '',
        question: hooks[2] || '',
        secret: hooks[0] || '',
      },
      visualPrompts,
      research: researchData.substring(0, 500),
      factCheck: {
        passed: !factCheckResult.hasErrors,
        errors: factCheckResult.errors || [],
      },
      pipeline: 'n8n-style-v2',
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
    message: 'Scripty API - n8n Style Pipeline V2',
    niches: Object.keys(NICHE_EXAMPLES.categories || {}),
    features: ['Fact-Check', 'Hook Enforcement', 'Dense Scripts', 'Niche Examples'],
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
  console.log(`🔥 Features: Fact-Check, Hook Enforcement, Dense Scripts`);
});
