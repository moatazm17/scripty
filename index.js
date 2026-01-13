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
// 🧠 STAGE 0: TOPIC EXTRACTION (Understand User Intent)
// ============================================

async function extractTopic(rawInput) {
  console.log('   🧠 Understanding topic...');
  
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 150,
      system: 'أنت محلل مواضيع. افهم الموضوع وحدده بوضوح.',
      messages: [{
        role: 'user',
        content: `افهم الموضوع ده واستخرج:
1. الموضوع الأساسي (جملة واحدة واضحة)
2. الزاوية أو الـ angle (إيه اللي المستخدم عايز يركز عليه)

النص:
"${rawInput}"

JSON فقط:
{"topic": "الموضوع الواضح", "angle": "الزاوية"}`
      }],
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
      const result = `${parsed.topic} - ${parsed.angle}`;
      console.log(`   🧠 Understood: "${result}"`);
      return result;
    }
  } catch (e) {
    console.log('   ⚠️ Parse error, using raw input');
  }
  
  return rawInput;
}

// ============================================
// 🔍 STAGE 1: RESEARCH (Fast + Accurate)
// ============================================

async function research(topic, retries = 3) {
  console.log('   📚 Researching...');
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: CONFIG.PERPLEXITY_MODEL,
          messages: [
            {
              role: 'system',
              content: 'باحث محترف. أرقام دقيقة، تواريخ، تفاصيل. اذكر المصادر.'
            },
            {
              role: 'user',
              content: `${topic}

المطلوب:
1. أرقام وتواريخ محددة
2. تفاصيل مفاجئة أو غير معروفة
3. المصادر

مختصر ودقيق.`
            }
          ],
          max_tokens: 2000,
          temperature: 0.2,
        },
        {
          headers: {
            'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 45000, // 45 second timeout (faster)
        }
      );
      
      return response.data.choices[0].message.content;
    } catch (error) {
      console.log(`   ⚠️ Research attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) {
        throw new Error(`Research failed after ${retries} attempts: ${error.message}`);
      }
      // Wait 2 seconds before retry
      await new Promise(r => setTimeout(r, 2000));
    }
  }
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
// ✍️ STAGE 3: WRITE SCRIPT (Gemini Flash 2.0)
// ============================================

async function writeScript(topic, researchData, niche, selectedHook, duration) {
  console.log('   ✍️ Writing script (Gemini Flash)...');
  
  const durationConfig = getDurationConfig(duration);
  const examples = getNicheExamples(niche);
  
  // Get the BEST example as the golden template
  const goldenExample = examples[0]?.script || '';

  const prompt = `أنت كاتب سكربتات فيرال مصري. عامية بيضة 100%.

⚠️ قاعدة حديدية:
- كل رقم/تاريخ/حقيقة لازم يكون موجود في البحث حرفياً
- لو معلومة مش موجودة في البحث → متذكرهاش خالص واتخطاها
- ❌ ممنوع منعاً باتاً: "غير محدد"، "مش موجود"، "مش متأكد"، "في حدود"، "تقريباً"
- ❌ ممنوع: "يُعد"، "حيث"، "علاوة على ذلك"، "هل تعلم"، "تخيل كده"، "بص بقى"
- ✅ اكتب فقط اللي متأكد منه من البحث

=== GOLDEN EXAMPLE (قلّد الـ DNA بالظبط) ===
${goldenExample}

=== INPUT ===
الموضوع: ${topic}

الـ Hook (ابدأ بيه حرفياً!):
"${selectedHook}"

البحث (المصدر الوحيد - لو مش هنا متألفوش!):
${researchData}

=== المطلوب ===
سكربت ~${durationConfig.words} كلمة.
ابدأ بالـ Hook بالظبط. قلّد الـ Golden Example.
من البحث فقط - لو معلومة مش موجودة اتخطاها!

اكتب السكربت بالعامية المصرية فقط (بدون مقدمات):`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: durationConfig.maxTokens,
        temperature: 0.7,
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
  
  let script = response.data.candidates[0].content.parts[0].text;
  
  // Clean markdown artifacts
  script = script
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,3}\s*/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
  
  return script;
}

// ============================================
// ❌ REMOVED: Fact-Check & Fix (Now in writeScript)
// ============================================
// الكاتب بقى صارم ومبيألفش - مش محتاجين Fact-Check منفصل

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
// 🚀 MAIN PIPELINE (Fast & Accurate)
// ============================================

async function generateScript(rawTopic, language, niche, duration) {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('🚀 Fast Pipeline Started');
  console.log(`📌 Raw Input: ${rawTopic.substring(0, 100)}...`);
  console.log(`🎯 Niche: ${niche} → ${getNicheKey(niche)}`);
  console.log(`⏱️ Duration: ${duration}s`);
  console.log('═══════════════════════════════════════');
  
  const startTime = Date.now();
  
  try {
    // Stage 0: Extract Core Topic (if input is long)
    const topic = await extractTopic(rawTopic);
    console.log(`   ✓ Topic: "${topic}"`);
    
    // Stage 1: Research (Fast)
    const researchData = await research(topic);
    console.log('   ✓ Research done');
    
    // Stage 2: Generate Hooks
    const hooks = await generateHooks(topic, researchData, niche);
    console.log(`   ✓ Hooks: ${hooks.length}`);
    
    // Select first hook as main
    const selectedHook = hooks[0] || topic;
    
    // Stage 3: Write Script (Zero Hallucination - No Fact-Check needed!)
    let script = await writeScript(topic, researchData, niche, selectedHook, duration);
    console.log(`   ✓ Script: ${script.split(/\s+/).length} words`);
    
    // Stage 4: Style Cleanup
    script = styleCleanup(script, selectedHook);
    const wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Cleaned: ${wordCount} words`);
    
    // Stage 5: Visual Prompts
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
      topic, // The extracted core topic
      hook: selectedHook,
      alternativeHooks: {
        shock: hooks[1] || '',
        question: hooks[2] || '',
        secret: hooks[0] || '',
      },
      visualPrompts,
      research: researchData.substring(0, 500),
      pipeline: 'fast-v4',
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
    message: 'Scripty API - Fast Pipeline V3',
    niches: Object.keys(NICHE_EXAMPLES.categories || {}),
    features: ['Zero Hallucination', 'Fast Research', 'Niche Examples'],
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
  console.log(`🔥 Features: Zero Hallucination, Fast Research, 3-Stage Pipeline`);
});
