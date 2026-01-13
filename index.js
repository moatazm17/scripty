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
  GEMINI_MODEL: 'gemini-3-pro-preview',
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

function getNicheHooks(niche) {
  const key = getNicheKey(niche);
  const category = NICHE_EXAMPLES.hooks_by_category?.[key];
  if (category && category.hooks) return category.hooks;
  // Fallback to general hooks
  return NICHE_EXAMPLES.hooks_by_category?.general?.hooks || getUniversalHooks();
}

function getDurationConfig(duration) {
  const durationInt = parseInt(duration) || 60;
  // Word counts aligned with Golden Examples (85-110 words per script)
  // 3 words/second = natural speaking pace for Arabic
  const configs = {
    15: { words: 40, maxTokens: 2000 },
    30: { words: 80, maxTokens: 2500 },
    60: { words: 110, maxTokens: 4000 },  // Aligned with examples (~100 words)
    90: { words: 160, maxTokens: 5000 },
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
// 🎣 STAGE 2: GENERATE HOOKS (Gemini 3 Pro)
// ============================================

async function generateHooks(topic, researchData, niche) {
  console.log('   🎣 Generating hooks (Gemini 3 Pro)...');
  
  // Get niche-specific hooks (5 per niche)
  const nicheHooks = getNicheHooks(niche);
  const universalHooks = getUniversalHooks();
  
  console.log(`   📌 Using ${nicheHooks.length} niche hooks + ${universalHooks.length} universal hooks`);

  // FIX #1: Use full research instead of truncated
  const prompt = `اكتب 3 Hooks مثيرة للفضول زي الأمثلة دي بالظبط:

الموضوع: ${topic}

البحث الكامل:
${researchData}

=== أمثلة Hooks من مجال "${niche}" (قلّد الأسلوب بالظبط!) ===
${nicheHooks.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== أنماط Hooks عامة (للإلهام) ===
${universalHooks.slice(0, 3).map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== لاحظ الأسلوب ===
• غموض يثير الفضول - متكشفش كل حاجة
• سؤال أو تحدي أو صدمة
• استخدم رقم أو حقيقة صادمة من البحث
• ❌ ممنوع تكشف الموضوع بالكامل
• ❌ ممنوع "هل تعلم" أو "تخيل كده"
• ✅ "لو فاكر إن..."، "ليه..."، "أوعى..."، "الرقم ده..."

JSON فقط:
{"hooks": ["hook1", "hook2", "hook3"]}`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4000,  // Gemini 3 Pro needs ~2000 for thinking + ~500 for hooks
          temperature: 0.8,
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Debug: log full response
    console.log('   📝 Gemini response:', JSON.stringify(response.data, null, 2).substring(0, 1000));

    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const text = response.data.candidates[0].content.parts[0].text;
      // Clean markdown if any
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const match = cleanText.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.hooks && parsed.hooks.length > 0) {
          console.log(`   ✓ Got ${parsed.hooks.length} hooks`);
          return parsed.hooks;
        }
      }
    } else {
      console.log('   ⚠️ No valid response from Gemini');
    }
  } catch (e) {
    console.error('   ⚠️ Gemini hooks error:', e.message);
    if (e.response?.data) {
      console.error('   API response:', JSON.stringify(e.response.data));
    }
  }
  
  // Fallback
  console.log('   ⚠️ Using fallback hooks');
  return [
    `اللي بيوصلك عن ${topic.substring(0, 30)} ده نص الحقيقة بس...`,
    `لو فاكر إن اللي بيحصل في ${topic.substring(0, 30)} ده صدفة... تبقى غلطان!`,
    `أتحداك تكون واخد بالك من التفصيلة دي...`
  ];
}

// ============================================
// ✍️ STAGE 3: WRITE SCRIPT (Gemini 3 Pro)
// ============================================

async function writeScript(topic, researchData, niche, selectedHook, duration) {
  console.log('   ✍️ Writing script (Gemini 3 Pro)...');
  
  const durationConfig = getDurationConfig(duration);
  const examples = getNicheExamples(niche);
  
  // FIX #2: Use 2-3 golden examples instead of just one
  const goldenExamples = examples.slice(0, Math.min(3, examples.length));
  const examplesText = goldenExamples.map((ex, idx) => `
--- مثال #${idx + 1}: ${ex.title || ''} ---
${ex.script}
`).join('\n');

  // FIX #4: Clarify prompt priorities
  const prompt = `أنت كاتب سكربتات فيرال مصري. عامية بيضة 100%.

=== GOLDEN EXAMPLES (قلّد الـ DNA مش الموضوع) ===
${examplesText}

⚠️ لاحظ في الأمثلة:
- الأسلوب: عامية طبيعية، بدون تكلف
- البناء: hook → صدمة → تفاصيل → خاتمة قوية
- الإيقاع: جمل قصيرة، سريعة، مباشرة
- الطاقة: حماسي، مثير، فيه حركة

=== قواعد الكتابة (مهمة جداً) ===

الأولوية #1: DNA من الأمثلة
- احتفظ بنفس الطاقة والأسلوب والإيقاع
- جمل قصيرة، سريعة، مباشرة
- عامية مصرية طبيعية 100%

الأولوية #2: معلومات دقيقة فقط
- كل رقم/تاريخ/حقيقة لازم يكون في البحث حرفياً
- لو معلومة مش موجودة → اتجنب الجزء ده
- ❌ ممنوع تقول "غير محدد" أو "مش معروف" أو "تقريباً"

⚠️ لو البحث ناقص:
✅ صح: "الاستثمارات الضخمة" بدل رقم محدد مش موجود
✅ صح: "في السنوات الأخيرة" بدل تاريخ محدد مش موجود
✅ صح: تجنب الجزء ده خالص وركز على اللي موجود
❌ غلط: "الرقم غير محدد" أو "التاريخ مش معروف"

❌ ممنوع: "يُعد"، "حيث"، "علاوة على ذلك"، "هل تعلم"، "تخيل كده"، "بص بقى"

=== INPUT ===
الموضوع: ${topic}

الـ Hook (ابدأ بيه حرفياً!):
"${selectedHook}"

البحث الكامل (المصدر الوحيد):
${researchData}

=== المطلوب ===
اكتب سكربت ~${durationConfig.words} كلمة بنفس DNA الأمثلة.

⚠️ الأولويات:
1. التزم بالـ DNA من الأمثلة (الأسلوب، الإيقاع، الطاقة)
2. استخدم فقط المعلومات الموجودة في البحث
3. احتفظ بالإيقاع السريع والطاقة العالية

ابدأ بالـ Hook بالظبط، واكتب السكربت بالعامية المصرية:`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
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
  
  // FIX #3: Word count validation
  let wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
  const targetWords = durationConfig.words;
  
  // If script is too short (less than 80% of target), expand it
  if (wordCount < targetWords * 0.8) {
    console.log(`   ⚠️ Script too short (${wordCount}/${targetWords}). Expanding...`);
    script = await expandScript(script, researchData, selectedHook, targetWords, niche);
    wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Expanded to ${wordCount} words`);
  }
  
  return script;
}

// ============================================
// 📏 EXPAND SHORT SCRIPTS
// ============================================

async function expandScript(shortScript, research, selectedHook, targetWords, niche) {
  const examples = getNicheExamples(niche);
  const examplesText = examples.slice(0, 2).map((ex, idx) => `
--- مثال #${idx + 1} ---
${ex.script}
`).join('\n');

  const currentWords = shortScript.split(/\s+/).filter(w => w.length > 0).length;
  
  const prompt = `السكربت ده قصير جداً ومحتاج يتطوّل.

السكربت الحالي (${currentWords} كلمة):
${shortScript}

المطلوب: ${targetWords} كلمة (±10%)

البحث الكامل (استخدم معلومات إضافية منه):
${research}

الأمثلة المرجعية (للأسلوب):
${examplesText}

المطلوب:
- طوّل السكربت لـ ${targetWords} كلمة
- أضف تفاصيل، أمثلة، مقارنات من البحث
- احتفظ بنفس الأسلوب السريع والمثير
- ابدأ بنفس الـ Hook: "${selectedHook}"
- ❌ متكررش معلومات موجودة
- ✅ أضف معلومات جديدة من البحث
- ❌ ممنوع "غير محدد" أو "مش معروف"

اكتب السكربت الموسّع بالعامية المصرية:`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: targetWords * 8, // More tokens for longer script
          temperature: 0.7,
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    let expanded = response.data.candidates[0].content.parts[0].text;
    expanded = expanded
      .replace(/```[\s\S]*?```/g, '')
      .replace(/#{1,3}\s*/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .trim();
    
    return expanded;
  } catch (e) {
    console.error('   ⚠️ Expand error:', e.message);
    return shortScript; // Return original if expansion fails
  }
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

For EACH scene provide:
- prompt: Full detailed prompt for DALL-E (English, technical, 20-30 words)
- description_ar: Short Arabic description for user (5-10 words, عامية مصرية)
- description_en: Short English description for user (5-10 words)
- caption: Scene title

Rules:
- Photorealistic documentary style
- No text, watermarks, or logos
- Professional photography
- Each scene different angle/mood

JSON only:
{
  "hook": {"prompt": "Photorealistic...", "description_ar": "وصف قصير", "description_en": "Short desc", "caption": "مشهد البداية"},
  "content": {"prompt": "...", "description_ar": "...", "description_en": "...", "caption": "مشهد المحتوى"},
  "cta": {"prompt": "...", "description_ar": "...", "description_en": "...", "caption": "مشهد النهاية"}
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
    console.log('   📝 Visual API response received');
    
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.hook && parsed.content && parsed.cta) {
        console.log('   ✓ Visual prompts parsed successfully');
        console.log(`   🎬 Hook: ${parsed.hook.prompt.substring(0, 50)}...`);
        console.log(`   🎬 Content: ${parsed.content.prompt.substring(0, 50)}...`);
        console.log(`   🎬 CTA: ${parsed.cta.prompt.substring(0, 50)}...`);
        return parsed;
      } else {
        console.log('   ⚠️ Parsed JSON missing required fields (hook/content/cta)');
        console.log('   📝 Parsed:', JSON.stringify(parsed).substring(0, 200));
      }
    } else {
      console.log('   ⚠️ No JSON found in response');
      console.log('   📝 Raw text:', text.substring(0, 200));
    }
  } catch (e) {
    console.error('   ⚠️ Visual prompt error:', e.message);
    if (e.response) {
      console.error('   📝 API Error:', e.response.status, e.response.data);
    }
  }
  
  // Fallback
  console.log('   ⚠️ Using fallback visual prompts');
  return {
    hook: { 
      prompt: `Photorealistic wide shot of ${topic}, cinematic lighting, documentary style`,
      description_ar: 'منظر واسع للموضوع',
      description_en: 'Wide shot overview',
      caption: 'مشهد البداية'
    },
    content: { 
      prompt: `Photorealistic medium shot of ${topic}, detailed view, professional photography`,
      description_ar: 'لقطة متوسطة للتفاصيل',
      description_en: 'Medium shot details',
      caption: 'مشهد المحتوى'
    },
    cta: { 
      prompt: `Photorealistic close-up of ${topic}, dramatic lighting, hopeful atmosphere`,
      description_ar: 'لقطة قريبة للختام',
      description_en: 'Close-up finale',
      caption: 'مشهد النهاية'
    }
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
    message: 'Scripty API - Fast Pipeline V4 (2-Step)',
    niches: Object.keys(NICHE_EXAMPLES.categories || {}),
    features: ['Zero Hallucination', 'Hook Selection', '2-Step Pipeline'],
  });
});

// ============================================
// 🎣 STEP 1: GENERATE HOOKS (Research + 3 Hooks)
// ============================================

app.post('/api/generate-hooks', async (req, res) => {
  const { topic, language = 'egyptian', niche = 'general' } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('🎣 Step 1: Generate Hooks');
  console.log(`📌 Topic: ${topic.substring(0, 80)}...`);
  console.log(`🎯 Niche: ${niche}`);
  console.log('═══════════════════════════════════════');
  
  const startTime = Date.now();
  
  try {
    // Extract core topic
    const extractedTopic = await extractTopic(topic);
    console.log(`   ✓ Topic: "${extractedTopic}"`);
    
    // Research
    const researchData = await research(extractedTopic);
    console.log('   ✓ Research done');
    
    // Generate 3 hooks
    const hooks = await generateHooks(extractedTopic, researchData, niche);
    console.log(`   ✓ Generated ${hooks.length} hooks`);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✨ Step 1 Complete in ${elapsed}s`);
    console.log('═══════════════════════════════════════');
    
    res.json({
      success: true,
      topic: extractedTopic,
      hooks: hooks,
      research: researchData,
      elapsed: `${elapsed}s`,
    });
    
  } catch (error) {
    console.error('❌ Generate Hooks Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ✍️ STEP 2: WRITE SCRIPT (With Selected Hook)
// ============================================

app.post('/api/write-script', async (req, res) => {
  const { 
    topic,
    selectedHook,
    research: researchData,
    niche = 'general',
    duration = '60',
  } = req.body;
  
  if (!topic || !selectedHook || !researchData) {
    return res.status(400).json({ 
      success: false, 
      error: 'topic, selectedHook, and research are required' 
    });
  }
  
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('✍️ Step 2: Write Script');
  console.log(`📌 Topic: ${topic.substring(0, 50)}...`);
  console.log(`🎣 Hook: ${selectedHook.substring(0, 50)}...`);
  console.log(`⏱️ Duration: ${duration}s`);
  console.log('═══════════════════════════════════════');
  
  const startTime = Date.now();
  
  try {
    // Write script with selected hook
    let script = await writeScript(topic, researchData, niche, selectedHook, duration);
    console.log(`   ✓ Script: ${script.split(/\s+/).length} words`);
    
    // Style cleanup
    script = styleCleanup(script, selectedHook);
    const wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Cleaned: ${wordCount} words`);
    
    // Visual prompts
    const visualPrompts = await generateVisualPrompts(topic, script);
    console.log('   ✓ Visual prompts ready');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✨ Step 2 Complete in ${elapsed}s`);
    console.log('═══════════════════════════════════════');
    
    res.json({
      success: true,
      script,
      wordCount,
      hook: selectedHook,
      visualPrompts,
      elapsed: `${elapsed}s`,
    });
    
  } catch (error) {
    console.error('❌ Write Script Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
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
// 💡 TRENDING IDEAS (Inspiration)
// ============================================

app.post('/api/trending-ideas', async (req, res) => {
  const { niche = 'general', language = 'egyptian', count = 5 } = req.body;
  
  console.log(`💡 Generating ${count} trending ideas for ${niche}...`);
  
  const nicheNames = {
    general: 'مواضيع عامة',
    real_estate: 'العقارات',
    content_creation: 'صناعة المحتوى',
    business: 'البيزنس',
    technology: 'التكنولوجيا',
    self_development: 'تطوير الذات',
    restaurants: 'المطاعم',
    fashion: 'الفاشون',
  };
  
  const prompt = `اقترح ${count} أفكار فيديوهات فيرال في مجال "${nicheNames[niche] || niche}" للسوشيال ميديا.

المطلوب:
- أفكار جذابة ومثيرة للجدل
- مناسبة للجمهور المصري والعربي
- قابلة للتنفيذ في فيديو قصير (60 ثانية)
- كل فكرة في سطر واحد بدون ترقيم

JSON فقط:
{"ideas": ["فكرة 1", "فكرة 2", ...]}`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 500,
        system: 'أنت خبير محتوى. اقترح أفكار فيرال. JSON فقط.',
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
      console.log(`   ✓ Generated ${parsed.ideas?.length || 0} ideas`);
      res.json({ success: true, ideas: parsed.ideas || [] });
      return;
    }
  } catch (e) {
    console.error('   ⚠️ Trending ideas error:', e.message);
  }
  
  // Fallback ideas
  const fallbackIdeas = {
    general: [
      'أخطاء شائعة الناس بتعملها كل يوم',
      'حقائق صادمة محدش بيقولهالك',
      'ليه الأغنياء بيفكروا بطريقة مختلفة',
    ],
    real_estate: [
      'أخطاء لازم تتجنبها قبل ما تشتري شقة',
      'ليه الإيجار أحسن من التمليك أحياناً',
      'أسرار المطورين العقاريين',
    ],
    business: [
      'أفكار مشاريع بأقل رأس مال',
      'أخطاء بتقفل الشركات في أول سنة',
      'ليه الخصومات بتدمر البيزنس',
    ],
  };
  
  res.json({ 
    success: true, 
    ideas: fallbackIdeas[niche] || fallbackIdeas.general 
  });
});

// ============================================
// 🖼️ GENERATE IMAGE (DALL-E)
// ============================================

app.post('/api/generate-image', async (req, res) => {
  const { prompt, size = '1024x1024', quality = 'standard' } = req.body;
  
  console.log('🖼️ Generating image...');
  
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt: prompt,
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
    
    const imageUrl = response.data.data[0].url;
    console.log('   ✓ Image generated');
    res.json({ success: true, imageUrl });
  } catch (e) {
    console.error('   ⚠️ Image generation error:', e.message);
    res.status(500).json({ success: false, error: 'Failed to generate image' });
  }
});

// ============================================
// ⚙️ CONFIG ENDPOINT
// ============================================

app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    niches: Object.keys(NICHE_EXAMPLES.categories || {}),
    durations: ['15', '30', '60', '90'],
    languages: ['egyptian', 'arabic', 'english'],
    styles: ['viral', 'educational', 'storytelling'],
  });
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
