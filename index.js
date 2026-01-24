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
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
  PERPLEXITY_MODEL: 'sonar-pro',
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  GEMINI_MODEL: 'gemini-3-pro-preview',
};

// ============================================
// 📚 LOAD HOOKS & SCRIPTS (Per Language & Duration)
// ============================================

let HOOKS = {};           // Hooks for all languages
let SCRIPTS = {};         // Scripts for all languages and durations
let PROMPTS = {};         // Writing prompts for all languages

const SUPPORTED_LANGUAGES = ['egyptian', 'gulf', 'english', 'frensh'];
const SUPPORTED_DURATIONS = ['30', '60'];

try {
  // Load hooks from hooks.json (all languages in one file)
  const hooksPath = path.join(__dirname, 'examples', 'hooks.json');
  HOOKS = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  console.log('✅ Loaded hooks for:', Object.keys(HOOKS).filter(k => k !== 'metadata').join(', '));
  
  // Load writing prompts for all languages
  const promptsPath = path.join(__dirname, 'examples', 'prompts.json');
  PROMPTS = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
  console.log('✅ Loaded prompts for:', Object.keys(PROMPTS).join(', '));
  
  // Load scripts for each language and duration
  for (const lang of SUPPORTED_LANGUAGES) {
    SCRIPTS[lang] = {};
    for (const dur of SUPPORTED_DURATIONS) {
      const scriptPath = path.join(__dirname, 'examples', `scripts-${dur}s-${lang}.json`);
      try {
        SCRIPTS[lang][dur] = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
        console.log(`✅ Loaded scripts: ${lang} ${dur}s`);
      } catch (e) {
        console.log(`⚠️ No scripts file for ${lang} ${dur}s`);
        SCRIPTS[lang][dur] = { categories: {} };
      }
    }
  }
} catch (e) {
  console.error('⚠️ Could not load examples:', e.message);
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

function getNicheExamples(niche, duration = '30', language = 'egyptian') {
  const key = getNicheKey(niche);
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'egyptian';
  const dur = SUPPORTED_DURATIONS.includes(duration) ? duration : '30';
  
  // Get scripts for this language and duration
  const scriptsData = SCRIPTS[lang]?.[dur] || SCRIPTS['egyptian']?.['30'] || {};
  
  const category = scriptsData.categories?.[key];
  if (category && category.examples) return category.examples;
  
  // Fallback to general
  return scriptsData.categories?.general?.examples || [];
}

function getUniversalHooks(language = 'egyptian') {
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'egyptian';
  return HOOKS[lang]?.universal_hooks || HOOKS['egyptian']?.universal_hooks || [];
}

function getNicheHooks(niche, language = 'egyptian') {
  const key = getNicheKey(niche);
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'egyptian';
  
  const langHooks = HOOKS[lang] || HOOKS['egyptian'];
  const category = langHooks?.hooks_by_category?.[key];
  if (category && category.hooks) return category.hooks;
  
  // Fallback to general hooks for this language
  return langHooks?.hooks_by_category?.general?.hooks || getUniversalHooks(language);
}

function getDurationConfig(duration) {
  const durationInt = parseInt(duration) || 30;  // Default to 30s
  // Word counts aligned with Golden Examples per duration
  const configs = {
    30: { words: 100, maxTokens: 3000, displayRange: '30-40 ثانية' },   // ~100 words
    60: { words: 170, maxTokens: 5000, displayRange: '45-60 ثانية' },   // ~150-170 words
  };
  return configs[durationInt] || configs[30];  // Default to 30s
}

// ============================================
// 💰 COST TRACKING
// ============================================

const PRICING = {
  claude: { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },      // Claude Sonnet 4
  perplexity: { input: 1.00 / 1_000_000, output: 5.00 / 1_000_000 },   // sonar-pro
  gemini: { input: 1.25 / 1_000_000, output: 10.00 / 1_000_000 },      // Gemini 3 Pro
  gemini_chat: { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 }, // Gemini 2.5 Flash Lite (chat)
  flux: { perImage: 0.003 },                                            // Flux Schnell $3/1000 images
};

function createCostTracker() {
  return {
    claude: { input: 0, output: 0, cost: 0 },
    perplexity: { input: 0, output: 0, cost: 0 },
    gemini: { input: 0, output: 0, cost: 0 },
    gemini_chat: { input: 0, output: 0, cost: 0 },
    flux: { images: 0, cost: 0 },
    total: 0,
  };
}

function trackCost(tracker, provider, inputTokens, outputTokens) {
  const pricing = PRICING[provider];
  if (!pricing) return;
  
  const cost = (inputTokens * pricing.input) + (outputTokens * pricing.output);
  tracker[provider].input += inputTokens;
  tracker[provider].output += outputTokens;
  tracker[provider].cost += cost;
  tracker.total += cost;
  
  console.log(`   💰 ${provider}: ${inputTokens} in + ${outputTokens} out = $${cost.toFixed(4)}`);
}

function trackFluxCost(tracker) {
  tracker.flux.images += 1;
  tracker.flux.cost += PRICING.flux.perImage;
  tracker.total += PRICING.flux.perImage;
  console.log(`   💰 Flux: 1 image = $${PRICING.flux.perImage.toFixed(4)}`);
}

function logTotalCost(tracker) {
  console.log('═══════════════════════════════════════');
  console.log('💰 COST BREAKDOWN:');
  console.log(`   Claude:     ${tracker.claude.input} in + ${tracker.claude.output} out = $${tracker.claude.cost.toFixed(4)}`);
  console.log(`   Perplexity: ${tracker.perplexity.input} in + ${tracker.perplexity.output} out = $${tracker.perplexity.cost.toFixed(4)}`);
  console.log(`   Gemini:     ${tracker.gemini.input} in + ${tracker.gemini.output} out = $${tracker.gemini.cost.toFixed(4)}`);
  if (tracker.gemini_chat && tracker.gemini_chat.cost > 0) {
    console.log(`   Gemini Chat:${tracker.gemini_chat.input} in + ${tracker.gemini_chat.output} out = $${tracker.gemini_chat.cost.toFixed(4)}`);
  }
  if (tracker.flux.images > 0) {
    console.log(`   Flux:       ${tracker.flux.images} images = $${tracker.flux.cost.toFixed(4)}`);
  }
  console.log(`   ────────────────────────────────────`);
  console.log(`   💵 TOTAL: $${tracker.total.toFixed(4)}`);
  console.log('═══════════════════════════════════════');
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
// 🎯 STAGE 0A: MODE DETECTION (Simple Code-Based)
// ============================================

function detectMode(rawInput) {
  const text = rawInput.trim();
  const wordCount = text.split(/\s+/).length;
  
  // Check for bullet points or numbered lists
  const hasBullets = /[-•●★]\s/.test(text);
  const hasNumberedList = /^\d+[.)]\s/m.test(text);
  
  // Check for explicit refine keywords
  const refineKeywords = [
    'حول ده', 'اكتبلي', 'عدل على', 'حوله', 'اعمله سكريبت',
    'turn this', 'rewrite', 'convert this', 'make this a script',
    'transforme', 'réécris', 'converti'
  ];
  const hasRefineKeyword = refineKeywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
  
  // Decision logic
  if (wordCount > 60) {
    console.log(`   🎯 Mode: REFINE (${wordCount} words > 60)`);
    return 'refine';
  }
  
  if (hasBullets || hasNumberedList) {
    console.log(`   🎯 Mode: REFINE (has bullets/numbered list)`);
    return 'refine';
  }
  
  if (hasRefineKeyword) {
    console.log(`   🎯 Mode: REFINE (found refine keyword)`);
    return 'refine';
  }
  
  console.log(`   🎯 Mode: RESEARCH (${wordCount} words, no refine indicators)`);
  return 'research';
}

// ============================================
// 🧠 STAGE 0B: TOPIC EXTRACTION (Simple - Just Topic & Angle)
// ============================================

async function extractTopic(rawInput, language = 'egyptian', costTracker = null) {
  console.log('   🧠 Understanding topic...');
  
  // Language-specific prompts for topic extraction (SIMPLE - no mode detection)
  const langPrompts = {
    egyptian: {
      system: 'أنت محلل مواضيع. افهم الموضوع وحدده بوضوح بالعامية المصرية.',
      prompt: `افهم الموضوع ده واستخرج:
1. الموضوع الأساسي (جملة واحدة واضحة بالعربي)
2. الزاوية أو الـ angle (إيه اللي المستخدم عايز يركز عليه)

النص:
"${rawInput}"

JSON فقط:
{"topic": "الموضوع الواضح", "angle": "الزاوية"}`
    },
    gulf: {
      system: 'أنت محلل مواضيع. افهم الموضوع وحدده بوضوح باللهجة الخليجية.',
      prompt: `افهم الموضوع هذا واستخرج:
1. الموضوع الأساسي (جملة واحدة واضحة بالعربي)
2. الزاوية أو الـ angle (وش اللي المستخدم يبي يركز عليه)

النص:
"${rawInput}"

JSON فقط:
{"topic": "الموضوع الواضح", "angle": "الزاوية"}`
    },
    french: {
      system: 'Tu es un analyste de sujets. Comprends le sujet et définis-le clairement en Français.',
      prompt: `Analyse ce sujet et extrais:
1. Le sujet principal (une phrase claire en Français)
2. L'angle (sur quoi l'utilisateur veut se concentrer)

Texte:
"${rawInput}"

JSON uniquement:
{"topic": "Le sujet clair", "angle": "L'angle"}`
    },
    frensh: {
      system: 'Tu es un analyste de sujets. Comprends le sujet et définis-le clairement en Français.',
      prompt: `Analyse ce sujet et extrais:
1. Le sujet principal (une phrase claire en Français)
2. L'angle (sur quoi l'utilisateur veut se concentrer)

Texte:
"${rawInput}"

JSON uniquement:
{"topic": "Le sujet clair", "angle": "L'angle"}`
    },
    english: {
      system: 'You are a topic analyst. Understand the topic and define it clearly in English.',
      prompt: `Understand this topic and extract:
1. The main topic (one clear sentence in English)
2. The angle (what the user wants to focus on)

Text:
"${rawInput}"

JSON only:
{"topic": "The clear topic", "angle": "The angle"}`
    }
  };
  
  const langConfig = langPrompts[language] || langPrompts['egyptian'];
  
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 150,
      system: langConfig.system,
      messages: [{
        role: 'user',
        content: langConfig.prompt
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
  
  // Track cost
  if (costTracker && response.data.usage) {
    trackCost(costTracker, 'claude', response.data.usage.input_tokens, response.data.usage.output_tokens);
  }
  
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

async function research(rawInput, extractedTopic, costTracker = null, retries = 3) {
  console.log('   📚 Researching...');
  
  // Check if user provided specific angles/points
  const hasUserAngles = rawInput.length > extractedTopic.length + 20;
  
  // Build smart research prompt
  let researchPrompt;
  if (hasUserAngles) {
    // User provided specific angles - prioritize them
    researchPrompt = `الموضوع: ${extractedTopic}

طلب المستخدم بالتفصيل:
"${rawInput}"

=== المطلوب ===
🥇 أولوية قصوى: ابحث عن كل النقاط اللي المستخدم ذكرها بالتحديد
🥈 ثانياً: لو لقيت معلومات مفاجئة أو مثيرة إضافية، ضيفها

لكل نقطة جيب:
- أرقام وتواريخ محددة
- تفاصيل مفاجئة أو غير معروفة
- المصادر

مختصر ودقيق.`;
  } else {
    // Short topic - do general research
    researchPrompt = `${extractedTopic}

المطلوب:
1. أرقام وتواريخ محددة
2. تفاصيل مفاجئة أو غير معروفة
3. المصادر

مختصر ودقيق.`;
  }
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: CONFIG.PERPLEXITY_MODEL,
          messages: [
            {
              role: 'system',
              content: 'باحث محترف. أرقام دقيقة، تواريخ، تفاصيل. اذكر المصادر. ركّز على النقاط اللي المستخدم طلبها.'
            },
            {
              role: 'user',
              content: researchPrompt
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
      
      // Track cost
      if (costTracker && response.data.usage) {
        trackCost(costTracker, 'perplexity', response.data.usage.prompt_tokens, response.data.usage.completion_tokens);
      }
      
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

async function generateHooks(topic, researchData, niche, language = 'egyptian', costTracker = null, actionType = 'research', userInstructions = '') {
  console.log('   🎣 Generating hooks (Gemini 3 Pro)...');
  
  // Get niche-specific hooks for this language (used as style reference for both modes)
  const nicheHooks = getNicheHooks(niche, language);
  const universalHooks = getUniversalHooks(language);
  
  console.log(`   📌 Using ${nicheHooks.length} niche hooks + ${universalHooks.length} universal hooks (${language})`);
  console.log(`   🎯 Mode: ${actionType.toUpperCase()}`);

  // Language-specific hook generation prompts
  const langHookPrompts = {
    egyptian: {
      instruction: 'اكتب 3 Hooks مثيرة للفضول بالعامية المصرية زي الأمثلة دي بالظبط',
      tips: `• غموض يثير الفضول - متكشفش كل حاجة
• سؤال أو تحدي أو صدمة
• استخدم رقم أو حقيقة صادمة من البحث
• ❌ ممنوع تكشف الموضوع بالكامل
• ❌ ممنوع "هل تعلم" أو "تخيل كده"
• ✅ "لو فاكر إن..."، "ليه..."، "أوعى..."، "الرقم ده..."`
    },
    gulf: {
      instruction: 'اكتب 3 Hooks مثيرة للفضول باللهجة الخليجية زي الأمثلة هذي بالضبط',
      tips: `• غموض يثير الفضول - لا تكشف كل شي
• سؤال أو تحدي أو صدمة
• استخدم رقم أو حقيقة صادمة من البحث
• ❌ ممنوع تكشف الموضوع كله
• ❌ ممنوع "هل تعلم" أو "تخيل معي"
• ✅ "لو تحسب إن..."، "ليش..."، "انتبه..."، "الرقم هذا..."`
    },
    french: {
      instruction: 'Écris 3 Hooks intrigants en Français exactement comme ces exemples',
      tips: `• Mystère qui attire la curiosité - ne révèle pas tout
• Question, défi ou choc
• Utilise un chiffre ou fait choquant de la recherche
• ❌ Ne révèle pas tout le sujet
• ❌ Pas de "Saviez-vous" ou "Imaginez"
• ✅ "Si tu penses que...", "Pourquoi...", "Attention...", "Ce chiffre..."`
    },
    frensh: {
      instruction: 'Écris 3 Hooks intrigants en Français exactement comme ces exemples',
      tips: `• Mystère qui attire la curiosité - ne révèle pas tout
• Question, défi ou choc
• Utilise un chiffre ou fait choquant de la recherche
• ❌ Ne révèle pas tout le sujet
• ❌ Pas de "Saviez-vous" ou "Imaginez"
• ✅ "Si tu penses que...", "Pourquoi...", "Attention...", "Ce chiffre..."`
    },
    english: {
      instruction: 'Write 3 curiosity-inducing Hooks in English exactly like these examples',
      tips: `• Mystery that sparks curiosity - don't reveal everything
• Question, challenge, or shock
• Use a shocking number or fact from the research
• ❌ Don't reveal the whole topic
• ❌ No "Did you know" or "Imagine this"
• ✅ "If you think...", "Why...", "Watch out...", "This number..."`
    }
  };
  
  const hookConfig = langHookPrompts[language] || langHookPrompts['egyptian'];
  
  // Build prompt based on action type
  let contentSource;
  if (actionType === 'refine') {
    // For refine mode: use user instructions as the content source
    contentSource = `User's Draft/Instructions (extract key points for hooks):
${userInstructions}`;
  } else {
    // For research mode: use research data
    contentSource = `Full Research:
${researchData}`;
  }
  
  const prompt = `${hookConfig.instruction}:

Topic: ${topic}

${contentSource}

=== Example Hooks from "${niche}" (copy the STYLE exactly!) ===
${nicheHooks.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== Universal Hook Patterns (for inspiration) ===
${universalHooks.slice(0, 3).map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== Style Tips ===
${hookConfig.tips}

${actionType === 'refine' ? '⚠️ IMPORTANT: The hooks must relate to the USER\'S CONTENT above, not external information.' : ''}

JSON only:
{"hooks": ["hook1", "hook2", "hook3"]}`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.8,
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Track cost
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini', usage.promptTokenCount || 0, usage.candidatesTokenCount || usage.totalTokenCount - usage.promptTokenCount || 0);
    }

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

async function writeScript(topic, researchData, niche, selectedHook, duration, language = 'egyptian', costTracker = null, actionType = 'research', userInstructions = '') {
  console.log(`   ✍️ Writing script (Gemini 3 Pro) - Mode: ${actionType.toUpperCase()}...`);
  
  const durationConfig = getDurationConfig(duration);
  const examples = getNicheExamples(niche, duration, language);
  
  // Get 2-3 golden examples
  const goldenExamples = examples.slice(0, Math.min(3, examples.length));
  const examplesText = goldenExamples.map((ex, idx) => `
--- Example #${idx + 1}: ${ex.title || ''} ---
${ex.script}
`).join('\n');

  let prompt;
  
  if (actionType === 'refine') {
    // ============================================
    // 🔄 REFINE MODE: Strict Viral Editor
    // ============================================
    console.log('   🔄 Using REFINE mode (Strict Viral Editor)');
    
    const refinePrompts = {
      egyptian: `أنت محرر سكريبتات فيروسية صارم. مهمتك تحويل مسودة المستخدم لسكريبت فيروسي مع الحفاظ على كل المعلومات.

=== قواعد صارمة ===
1. ✅ استخدم فقط المعلومات الموجودة في مسودة المستخدم
2. ✅ حافظ على نفس الترتيب والهيكل (النقاط بنفس الترتيب)
3. ✅ أعد صياغة كل جملة بأسلوب فيروسي زي الأمثلة
4. ❌ ممنوع إضافة معلومات جديدة أو أرقام من عندك
5. ❌ ممنوع حذف أي نقطة من نقاط المستخدم
6. ❌ ممنوع التأليف أو الاختراع

=== أمثلة الأسلوب المطلوب (قلد الـ tone بالظبط) ===
${examplesText}

=== مسودة المستخدم (المصدر الوحيد للمعلومات) ===
${userInstructions}

=== المطلوب ===
- Hook: "${selectedHook}"
- الطول: ${durationConfig.words} كلمة تقريباً
- اكتب بالعامية المصرية
- حول كل نقطة لجملة فيروسية بنفس الترتيب
- ابدأ بالـ Hook ثم النقاط ثم CTA

اكتب السكريبت مباشرة (بدون JSON أو markdown):`,

      gulf: `أنت محرر سكريبتات فايرال صارم. مهمتك تحويل مسودة المستخدم لسكريبت فايرال مع الحفاظ على كل المعلومات.

=== قواعد صارمة ===
1. ✅ استخدم فقط المعلومات الموجودة في مسودة المستخدم
2. ✅ حافظ على نفس الترتيب والهيكل
3. ✅ أعد صياغة كل جملة بأسلوب فايرال زي الأمثلة
4. ❌ ممنوع إضافة معلومات جديدة
5. ❌ ممنوع حذف أي نقطة
6. ❌ ممنوع التأليف

=== أمثلة الأسلوب المطلوب ===
${examplesText}

=== مسودة المستخدم ===
${userInstructions}

=== المطلوب ===
- Hook: "${selectedHook}"
- الطول: ${durationConfig.words} كلمة تقريباً
- اكتب باللهجة الخليجية

اكتب السكريبت مباشرة:`,

      english: `You are a STRICT Viral Script Editor. Your job is to transform the user's draft into a viral script while preserving ALL information.

=== STRICT RULES ===
1. ✅ Use ONLY information from the user's draft
2. ✅ Keep the SAME order and structure (points in same sequence)
3. ✅ Rewrite each sentence in viral style like the examples
4. ❌ DO NOT add new information or numbers
5. ❌ DO NOT remove any of the user's points
6. ❌ DO NOT make up or hallucinate anything

=== STYLE EXAMPLES (copy this tone exactly) ===
${examplesText}

=== USER'S DRAFT (your ONLY source of information) ===
${userInstructions}

=== REQUIREMENTS ===
- Hook: "${selectedHook}"
- Length: ~${durationConfig.words} words
- Transform each point into a viral sentence in the same order
- Start with Hook, then points, then CTA

Write the script directly (no JSON or markdown):`,

      french: `Tu es un éditeur de scripts viraux STRICT. Ta mission est de transformer le brouillon de l'utilisateur en script viral tout en préservant TOUTES les informations.

=== RÈGLES STRICTES ===
1. ✅ Utilise UNIQUEMENT les informations du brouillon
2. ✅ Garde le MÊME ordre et structure
3. ✅ Réécris chaque phrase en style viral comme les exemples
4. ❌ N'ajoute PAS de nouvelles informations
5. ❌ Ne supprime AUCUN point de l'utilisateur
6. ❌ N'invente RIEN

=== EXEMPLES DE STYLE ===
${examplesText}

=== BROUILLON DE L'UTILISATEUR ===
${userInstructions}

=== REQUIS ===
- Hook: "${selectedHook}"
- Longueur: ~${durationConfig.words} mots

Écris le script directement:`,

      frensh: `Tu es un éditeur de scripts viraux STRICT. Ta mission est de transformer le brouillon de l'utilisateur en script viral tout en préservant TOUTES les informations.

=== RÈGLES STRICTES ===
1. ✅ Utilise UNIQUEMENT les informations du brouillon
2. ✅ Garde le MÊME ordre et structure
3. ✅ Réécris chaque phrase en style viral comme les exemples
4. ❌ N'ajoute PAS de nouvelles informations
5. ❌ Ne supprime AUCUN point de l'utilisateur
6. ❌ N'invente RIEN

=== EXEMPLES DE STYLE ===
${examplesText}

=== BROUILLON DE L'UTILISATEUR ===
${userInstructions}

=== REQUIS ===
- Hook: "${selectedHook}"
- Longueur: ~${durationConfig.words} mots

Écris le script directement:`
    };
    
    prompt = refinePrompts[language] || refinePrompts['egyptian'];
    
  } else {
    // ============================================
    // 🔍 RESEARCH MODE: Creative Writer (Original)
    // ============================================
    console.log('   🔍 Using RESEARCH mode (Creative Writer)');
    
    // Get language-specific prompt from prompts.json
    const langKey = language === 'frensh' ? 'french' : language;
    let promptTemplate = PROMPTS[langKey] || PROMPTS['egyptian'];
    
    // Replace variables in the prompt template
    prompt = promptTemplate
      .replace(/\$\{examplesText\}/g, examplesText)
      .replace(/\$\{topic\}/g, topic)
      .replace(/\$\{selectedHook\}/g, selectedHook)
      .replace(/\$\{researchData\}/g, researchData)
      .replace(/\$\{durationConfig\.words\}/g, durationConfig.words);
  }

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: durationConfig.maxTokens,
        temperature: actionType === 'refine' ? 0.5 : 0.7, // Lower temp for refine mode
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
  
  // Track cost
  if (costTracker && response.data?.usageMetadata) {
    const usage = response.data.usageMetadata;
    trackCost(costTracker, 'gemini', usage.promptTokenCount || 0, usage.candidatesTokenCount || usage.totalTokenCount - usage.promptTokenCount || 0);
  }
  
  let script = response.data.candidates[0].content.parts[0].text;
  
  // Clean markdown artifacts
  script = script
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,3}\s*/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
  
  // Word count validation
  let wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
  const targetWords = durationConfig.words;
  
  // If script is too short (less than 80% of target), expand it
  if (wordCount < targetWords * 0.8) {
    console.log(`   ⚠️ Script too short (${wordCount}/${targetWords}). Expanding...`);
    script = await expandScript(script, researchData, selectedHook, targetWords, niche, duration, language, costTracker, actionType, userInstructions);
    wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Expanded to ${wordCount} words`);
  }
  
  return script;
}

// ============================================
// 📏 EXPAND SHORT SCRIPTS
// ============================================

async function expandScript(shortScript, research, selectedHook, targetWords, niche, duration = '30', language = 'egyptian', costTracker = null, actionType = 'research', userInstructions = '') {
  const examples = getNicheExamples(niche, duration, language);
  const examplesText = examples.slice(0, 2).map((ex, idx) => `
--- Example #${idx + 1} ---
${ex.script}
`).join('\n');

  const currentWords = shortScript.split(/\s+/).filter(w => w.length > 0).length;
  
  // Language-specific instructions
  const langInstructions = {
    egyptian: { name: 'العامية المصرية', instruction: 'اكتب السكربت الموسّع بالعامية المصرية' },
    gulf: { name: 'اللهجة الخليجية', instruction: 'اكتب السكربت الموسّع باللهجة الخليجية' },
    french: { name: 'French', instruction: 'Écris le script étendu en Français' },
    frensh: { name: 'French', instruction: 'Écris le script étendu en Français' },
    english: { name: 'English', instruction: 'Write the expanded script in English' },
  };
  const langConfig = langInstructions[language] || langInstructions['egyptian'];
  
  // Use appropriate source based on action type
  const sourceContent = actionType === 'refine' 
    ? `User's original draft (ONLY use information from here):
${userInstructions}`
    : `Full research (use additional info from here):
${research}`;
  
  const prompt = `The script is too short and needs to be expanded.

Current script (${currentWords} words):
${shortScript}

Target: ${targetWords} words (±10%)

${sourceContent}

Reference examples (for style):
${examplesText}

Requirements:
- Expand the script to ${targetWords} words
- ${actionType === 'refine' ? 'Add more detail from the user\'s draft ONLY' : 'Add details, examples, comparisons from the research'}
- Keep the same fast-paced, engaging style
- Start with the same Hook: "${selectedHook}"
- ❌ Don't repeat existing information
- ${actionType === 'refine' ? '❌ DO NOT add information not in the user\'s draft' : '✅ Add new information from the research'}
- ❌ Never say "unspecified" or "unknown"

${langConfig.instruction}:`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: targetWords * 8,
          temperature: actionType === 'refine' ? 0.5 : 0.7,
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    // Track cost
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini', usage.promptTokenCount || 0, usage.candidatesTokenCount || usage.totalTokenCount - usage.promptTokenCount || 0);
    }
    
    let expanded = response.data.candidates[0].content.parts[0].text;
    expanded = expanded
      .replace(/```[\s\S]*?```/g, '')
      .replace(/#{1,3}\s*/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .trim();
    
    return expanded;
  } catch (e) {
    console.error('   ⚠️ Expand error:', e.message);
    return shortScript;
  }
}

// ============================================
// 🧹 STAGE 6: STYLE CHECK & CLEANUP
// ============================================

function styleCleanup(script, selectedHook) {
  let cleaned = script;
  
  // Ensure hook is at the start
  if (!cleaned.startsWith(selectedHook)) {
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
    .replace(/🇪🇬/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return cleaned;
}

// ============================================
// 🖼️ GENERATE VISUAL PROMPTS
// ============================================

async function generateVisualPrompts(topic, script, language = 'egyptian', costTracker = null) {
  console.log(`   🖼️ Generating visual prompts optimized for FLUX (${language})...`);
  
  const culturalContexts = {
    egyptian: 'Characters MUST be Egyptian with Egyptian features and modern Egyptian clothing. Environment should be Egyptian (Cairo streets, Egyptian homes, Egyptian landmarks). Include Egyptian cultural elements.',
    gulf: 'Characters MUST be Gulf Arab wearing traditional thobe/kandura and ghutra/shemagh for men, or modest Gulf fashion for women. Environment should be Gulf/Saudi/UAE (modern Gulf cities, desert landscapes, traditional markets). Include Gulf cultural elements.',
    english: 'Characters should be diverse Western/international. Environment should be modern international settings (offices, cities, homes). Professional and globally appealing aesthetic.',
    french: 'Characters should be French/Francophone European. Environment should be European/Parisian (cafes, elegant streets, French architecture). Include French cultural elements and aesthetic.',
  };
  
  const culturalContext = culturalContexts[language] || culturalContexts.egyptian;
  
  const prompt = `Act as an expert AI Art Director specializing in "Black Forest Labs Flux" prompting.
  
Analyze the script and generate 3 Highly Detailed visual descriptions.

Topic: ${topic}
Script Context: ${script.substring(0, 1000)}
Target Culture: ${language.toUpperCase()}

Create 3 distinct scenes:
1. Hook scene (High impact, controversial or shocking visual)
2. Content scene (Educational, clear, engaging)  
3. CTA scene (Direct, emotional connection)

🚨 CULTURAL CONTEXT (CRITICAL - MUST FOLLOW):
${culturalContext}
ALL people, clothing, settings, and environments MUST reflect this specific culture. This is mandatory.

For EACH scene, the "prompt" field must follow this FLUX Structure:
"[Medium/Style] of [Subject Description with cultural appearance] doing [Action] in [Cultural Environment]. [Lighting Description]. [Camera/Mood Details]."

CRITICAL RULES for the "prompt" field:
- DO NOT use generic tags (e.g., "4k", "best quality"). Use Natural English sentences.
- LENGTH: Must be 40-60 words per prompt (Descriptive & Rich).
- LIGHTING: You MUST specify lighting to fix flatness (e.g., "volumetric lighting", "dramatic rim light", "soft cinematic shading").
- STYLE: Start with "A cinematic hyper-realistic shot of..." or "A detailed 3D illustration of..." depending on the topic.
- NO TEXT: Do not include text inside the image unless necessary.
- CULTURAL ACCURACY: Characters and settings MUST match the target culture specified above.

Output Schema (JSON Only):
{
  "hook": {
    "prompt": "A cinematic hyper-realistic shot of... (full detailed flux prompt with cultural elements)", 
    "description_ar": "وصف قصير بالعربي", 
    "description_en": "Short English description",
    "description_fr": "Courte description en français",
    "caption": "Scene Title"
  },
  "content": {"prompt": "...", "description_ar": "...", "description_en": "...", "description_fr": "...", "caption": "..."},
  "cta": {"prompt": "...", "description_ar": "...", "description_en": "...", "description_fr": "...", "caption": "..."}
}`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 1500,
        system: 'You are a JSON generator. Output valid JSON only. No markdown.',
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
    
    if (costTracker && response.data.usage) {
      trackCost(costTracker, 'claude', response.data.usage.input_tokens, response.data.usage.output_tokens);
    }
    
    const text = response.data.content[0].text;
    console.log('   📝 Visual API response received');
    
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.hook && parsed.content && parsed.cta) {
        console.log('   ✓ Visual prompts parsed successfully');
        return parsed;
      }
    }
  } catch (e) {
    console.error('   ⚠️ Visual prompt error:', e.message);
  }
  
  // Fallback
  console.log('   ⚠️ Using fallback visual prompts');
  return {
    hook: { 
      prompt: `A cinematic hyper-realistic wide shot of ${topic} captured in dramatic composition. Volumetric lighting creates depth with golden hour rays streaming through. Shot on professional cinema camera with shallow depth of field creating atmospheric mood.`,
      description_ar: 'منظر واسع للموضوع',
      description_en: 'Wide shot overview',
      description_fr: 'Vue large du sujet',
      caption: 'Hook Scene'
    },
    content: { 
      prompt: `A detailed hyper-realistic medium shot showcasing ${topic} with clear educational focus. Soft cinematic shading highlights key details while maintaining visual clarity. Professional documentary style with balanced composition and natural color grading.`,
      description_ar: 'لقطة متوسطة للتفاصيل',
      description_en: 'Medium shot details',
      description_fr: 'Plan moyen détaillé',
      caption: 'Content Scene'
    },
    cta: { 
      prompt: `A cinematic hyper-realistic close-up of ${topic} with emotional impact and hopeful atmosphere. Dramatic rim lighting creates powerful silhouette effect. Warm color palette with soft bokeh background evoking inspiration and connection.`,
      description_ar: 'لقطة قريبة للختام',
      description_en: 'Close-up finale',
      description_fr: 'Gros plan final',
      caption: 'CTA Scene'
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
    // Stage 0A: Detect Mode (simple code-based, no AI)
    const action_type = detectMode(rawTopic);
    const user_instructions = action_type === 'refine' ? rawTopic : '';
    
    // Stage 0B: Extract Core Topic (simple - just topic & angle)
    const topic = await extractTopic(rawTopic, language);
    console.log(`   ✓ Topic: "${topic}"`);
    
    // Stage 1: Research (SKIP if refine mode)
    let researchData;
    if (action_type === 'refine') {
      console.log('   ⏭️ Skipping research (Refine Mode - using user content)');
      researchData = user_instructions; // Use user's draft as the "research"
    } else {
      researchData = await research(rawTopic, topic); // Pass both raw input and extracted topic
      console.log('   ✓ Research done');
    }
    
    // Stage 2: Generate Hooks (with action_type)
    const hooks = await generateHooks(topic, researchData, niche, language, null, action_type, user_instructions);
    console.log(`   ✓ Hooks: ${hooks.length}`);
    
    // Select first hook as main
    const selectedHook = hooks[0] || topic;
    
    // Stage 3: Write Script (with action_type)
    let script = await writeScript(topic, researchData, niche, selectedHook, duration, language, null, action_type, user_instructions);
    console.log(`   ✓ Script: ${script.split(/\s+/).length} words`);
    
    // Stage 4: Style Cleanup
    script = styleCleanup(script, selectedHook);
    const wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Cleaned: ${wordCount} words`);
    
    // Stage 5: Visual Prompts
    const visualPrompts = await generateVisualPrompts(topic, script, language);
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
      topic,
      hook: selectedHook,
      alternativeHooks: {
        shock: hooks[1] || '',
        question: hooks[2] || '',
        secret: hooks[0] || '',
      },
      visualPrompts,
      research: researchData.substring(0, 500),
      pipeline: 'fast-v4',
      mode: action_type, // Include mode in response
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
    niches: Object.keys(SCRIPTS['egyptian']?.['30']?.categories || {}),
    features: ['Zero Hallucination', 'Hook Selection', '2-Step Pipeline', 'Refine Mode'],
  });
});

// ============================================
// 🎣 STEP 1: GENERATE HOOKS (Research + 3 Hooks)
// ============================================

app.post('/api/generate-hooks', async (req, res) => {
  const { 
    topic, 
    language = 'egyptian', 
    niche = 'general',
    // Optional params for regenerating hooks (skip research)
    existingResearch = null,
    existingTopic = null,
    existingMode = null,
    existingUserInstructions = null,
  } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  // Check if this is a regenerate-only request (has existing research)
  const isRegenerateOnly = existingResearch && existingTopic;
  
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(isRegenerateOnly ? '🔄 Regenerate Hooks Only' : '🎣 Step 1: Generate Hooks');
  console.log(`📌 Topic: ${topic.substring(0, 80)}...`);
  console.log(`🎯 Niche: ${niche}`);
  console.log(`🌍 Language: ${language}`);
  if (isRegenerateOnly) console.log('⚡ Skipping research (using existing data)');
  console.log('═══════════════════════════════════════');
  
  const startTime = Date.now();
  const costTracker = createCostTracker();
  
  try {
    let extractedTopic, researchData, action_type, user_instructions;
    
    if (isRegenerateOnly) {
      // Use existing data (regenerate hooks only)
      extractedTopic = existingTopic;
      researchData = existingResearch;
      action_type = existingMode || 'research';
      user_instructions = existingUserInstructions || '';
      console.log('   ⏭️ Using existing research data');
    } else {
      // Full flow: detect mode, extract topic, research
      // Stage 0A: Detect Mode (simple code-based, no AI)
      action_type = detectMode(topic);
      user_instructions = action_type === 'refine' ? topic : '';
      
      // Stage 0B: Extract Core Topic (simple - just topic & angle)
      extractedTopic = await extractTopic(topic, language, costTracker);
      console.log(`   ✓ Topic: "${extractedTopic}"`);
      
      // Research (SKIP if refine mode)
      if (action_type === 'refine') {
        console.log('   ⏭️ Skipping research (Refine Mode)');
        researchData = user_instructions;
      } else {
        researchData = await research(topic, extractedTopic, costTracker); // Pass both raw input and extracted topic
        console.log('   ✓ Research done');
      }
    }
    
    // Generate 3 hooks (with action_type)
    const hooks = await generateHooks(extractedTopic, researchData, niche, language, costTracker, action_type, user_instructions);
    console.log(`   ✓ Generated ${hooks.length} hooks`);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✨ ${isRegenerateOnly ? 'Regenerate' : 'Step 1'} Complete in ${elapsed}s`);
    logTotalCost(costTracker);
    
    res.json({
      success: true,
      topic: extractedTopic,
      hooks: hooks,
      research: researchData,
      mode: action_type, // Include mode in response
      user_instructions: user_instructions, // Pass through for Step 2
      elapsed: `${elapsed}s`,
      cost: costTracker.total.toFixed(4),
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
    duration = '30',
    language = 'egyptian',
    mode = 'research', // NEW: Accept mode from Step 1
    user_instructions = '', // NEW: Accept user_instructions from Step 1
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
  console.log(`🌍 Language: ${language}`);
  console.log(`🎯 Mode: ${mode.toUpperCase()}`);
  console.log('═══════════════════════════════════════');
  
  const startTime = Date.now();
  const costTracker = createCostTracker();
  
  try {
    // Write script with selected hook (with mode)
    let script = await writeScript(topic, researchData, niche, selectedHook, duration, language, costTracker, mode, user_instructions);
    console.log(`   ✓ Script: ${script.split(/\s+/).length} words`);
    
    // Style cleanup
    script = styleCleanup(script, selectedHook);
    const wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Cleaned: ${wordCount} words`);
    
    // Visual prompts
    const visualPrompts = await generateVisualPrompts(topic, script, language, costTracker);
    console.log('   ✓ Visual prompts ready');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✨ Step 2 Complete in ${elapsed}s`);
    logTotalCost(costTracker);
    
    const durationConfig = getDurationConfig(duration);
    res.json({
      success: true,
      script,
      wordCount,
      hook: selectedHook,
      visualPrompts,
      durationRange: durationConfig.displayRange,
      mode: mode, // Include mode in response
      elapsed: `${elapsed}s`,
      cost: costTracker.total.toFixed(4),
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
    duration = '30'
  } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  try {
    const result = await generateScript(
      topic, 
      language, 
      niche,
      parseInt(duration) || 30
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
  
  console.log(`💡 Generating ${count} trending ideas for ${niche} in ${language}...`);
  const costTracker = createCostTracker();
  
  const nicheNamesPerLang = {
    egyptian: {
      general: 'مواضيع عامة',
      real_estate: 'العقارات',
      content_creation: 'صناعة المحتوى',
      business: 'البيزنس',
      technology: 'التكنولوجيا',
      self_development: 'تطوير الذات',
      restaurants: 'المطاعم',
      fashion: 'الفاشون',
    },
    gulf: {
      general: 'مواضيع عامة',
      real_estate: 'العقارات',
      content_creation: 'صناعة المحتوى',
      business: 'الأعمال',
      technology: 'التقنية',
      self_development: 'تطوير الذات',
      restaurants: 'المطاعم',
      fashion: 'الأزياء',
    },
    english: {
      general: 'General Topics',
      real_estate: 'Real Estate',
      content_creation: 'Content Creation',
      business: 'Business',
      technology: 'Technology',
      self_development: 'Self Development',
      restaurants: 'Restaurants',
      fashion: 'Fashion',
    },
    french: {
      general: 'Sujets généraux',
      real_estate: 'Immobilier',
      content_creation: 'Création de contenu',
      business: 'Business',
      technology: 'Technologie',
      self_development: 'Développement personnel',
      restaurants: 'Restaurants',
      fashion: 'Mode',
    },
  };
  
  const nicheNames = nicheNamesPerLang[language] || nicheNamesPerLang.egyptian;
  const nicheName = nicheNames[niche] || niche;
  
  let prompt, systemPrompt;
  
  if (language === 'egyptian') {
    prompt = `اقترح ${count} أفكار فيديوهات فيرال في مجال "${nicheName}" للسوشيال ميديا.

المطلوب:
- أفكار جذابة ومثيرة للجدل
- مناسبة للجمهور المصري
- قابلة للتنفيذ في فيديو قصير (60 ثانية)
- اكتب بالعامية المصرية

JSON فقط:
{"ideas": ["فكرة 1", "فكرة 2", ...]}`;
    systemPrompt = 'أنت خبير محتوى مصري. اقترح أفكار فيرال بالعامية المصرية. JSON فقط.';
    
  } else if (language === 'gulf') {
    prompt = `اقترح ${count} أفكار فيديوهات فايرال في مجال "${nicheName}" للسوشيال ميديا.

المطلوب:
- أفكار جذابة ومثيرة للاهتمام
- مناسبة للجمهور الخليجي والسعودي
- قابلة للتنفيذ في فيديو قصير (60 ثانية)
- اكتب باللهجة الخليجية

JSON فقط:
{"ideas": ["فكرة 1", "فكرة 2", ...]}`;
    systemPrompt = 'أنت خبير محتوى خليجي. اقترح أفكار فايرال باللهجة الخليجية. JSON فقط.';
    
  } else if (language === 'french') {
    prompt = `Suggère ${count} idées de vidéos virales dans le domaine "${nicheName}" pour les réseaux sociaux.

Critères:
- Idées accrocheuses et engageantes
- Adaptées au public francophone
- Réalisables en vidéo courte (60 secondes)
- Écris en français

JSON uniquement:
{"ideas": ["idée 1", "idée 2", ...]}`;
    systemPrompt = 'Tu es un expert en contenu français. Suggère des idées virales en français. JSON uniquement.';
    
  } else {
    prompt = `Suggest ${count} viral video ideas in the "${nicheName}" niche for social media.

Requirements:
- Catchy and engaging ideas
- Suitable for English-speaking audience
- Executable in a short video (60 seconds)
- Write in English

JSON only:
{"ideas": ["idea 1", "idea 2", ...]}`;
    systemPrompt = 'You are a content expert. Suggest viral ideas in English. JSON only.';
  }

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 500,
        system: systemPrompt,
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
    
    if (response.data.usage) {
      trackCost(costTracker, 'claude', response.data.usage.input_tokens, response.data.usage.output_tokens);
      console.log(`   💰 Ideas cost: $${costTracker.total.toFixed(4)}`);
    }
    
    const text = response.data.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      console.log(`   ✓ Generated ${parsed.ideas?.length || 0} ideas`);
      res.json({ success: true, ideas: parsed.ideas || [], cost: costTracker.total.toFixed(4) });
      return;
    }
  } catch (e) {
    console.error('   ⚠️ Trending ideas error:', e.message);
  }
  
  const fallbackIdeasPerLang = {
    egyptian: {
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
    },
    gulf: {
      general: [
        'أخطاء شائعة الناس تسويها كل يوم',
        'حقائق صادمة ما حد يقولك عنها',
        'ليش الأثرياء يفكرون بطريقة مختلفة',
      ],
      real_estate: [
        'أخطاء لازم تتجنبها قبل ما تشتري شقة',
        'ليش الإيجار أحسن من التمليك أحياناً',
        'أسرار المطورين العقاريين',
      ],
      business: [
        'أفكار مشاريع بأقل رأس مال',
        'أخطاء تخلي الشركات تقفل في أول سنة',
        'ليش الخصومات تدمر البيزنس',
      ],
    },
    english: {
      general: [
        'Common mistakes people make every day',
        'Shocking facts nobody tells you',
        'Why rich people think differently',
      ],
      real_estate: [
        'Mistakes to avoid before buying a house',
        'Why renting is sometimes better than owning',
        'Real estate developer secrets',
      ],
      business: [
        'Business ideas with minimal capital',
        'Mistakes that close companies in the first year',
        'Why discounts can destroy your business',
      ],
    },
    french: {
      general: [
        'Erreurs courantes que les gens font chaque jour',
        'Faits choquants que personne ne te dit',
        'Pourquoi les riches pensent différemment',
      ],
      real_estate: [
        'Erreurs à éviter avant d\'acheter un bien',
        'Pourquoi la location est parfois meilleure que l\'achat',
        'Les secrets des promoteurs immobiliers',
      ],
      business: [
        'Idées de business avec un capital minimal',
        'Erreurs qui font fermer les entreprises la première année',
        'Pourquoi les réductions peuvent détruire ton business',
      ],
    },
  };
  
  const fallbackIdeas = fallbackIdeasPerLang[language] || fallbackIdeasPerLang.egyptian;
  
  res.json({ 
    success: true, 
    ideas: fallbackIdeas[niche] || fallbackIdeas.general 
  });
});

// ============================================
// 🖼️ GENERATE IMAGE (Flux Schnell)
// ============================================

app.post('/api/generate-image', async (req, res) => {
  const { prompt } = req.body;
  
  console.log('🖼️ Generating image with Flux Schnell...');
  const costTracker = createCostTracker();
  
  const maxRetries = 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const randomSeed = Math.floor(Math.random() * 2147483647);
      const createResponse = await axios.post(
        'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
        {
          input: {
            prompt: prompt,
            seed: randomSeed,
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${CONFIG.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
            'Prefer': 'wait',
          },
        }
      );
      
      trackFluxCost(costTracker);
      
      const output = createResponse.data.output;
      const imageUrl = Array.isArray(output) ? output[0] : output;
      
      console.log('   ✓ Image generated');
      res.json({ success: true, imageUrl, cost: costTracker.total.toFixed(4) });
      return;
    } catch (e) {
      lastError = e;
      if (e.response?.status === 429 && attempt < maxRetries) {
        const waitTime = attempt * 2000;
        console.log(`   ⏳ Rate limited, waiting ${waitTime/1000}s before retry ${attempt + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      break;
    }
  }
  
  console.error('   ⚠️ Image generation error:', lastError?.message);
  res.status(500).json({ success: false, error: 'Failed to generate image' });
});

// ============================================
// ⚙️ CONFIG ENDPOINT
// ============================================

app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    niches: Object.keys(SCRIPTS['egyptian']?.['30']?.categories || {}),
    durations: SUPPORTED_DURATIONS,
    defaultDuration: '30',
    languages: SUPPORTED_LANGUAGES,
    defaultLanguage: 'egyptian',
    modes: ['research', 'refine'], // NEW: Include supported modes
  });
});

// ============================================
// 🤖 AI CHAT ENDPOINT (Gemini)
// ============================================

const CHAT_SYSTEM_INSTRUCTION = `
# IDENTITY
You are the AI Creative Assistant INSIDE the Seshu app.
Seshu is a script-writing app that generates viral video scripts for TikTok/Reels/Shorts.
YOUR role is to help users brainstorm and pick the perfect topic + angle.
AFTER they confirm, a "Generate Script" button appears → the APP writes the full script automatically.

**If asked who you are:**
- Egyptian: "أنا المساعد الإبداعي جوه تطبيق Seshu 🎬 بساعدك تختار الفكرة، وبعدين التطبيق بيكتبلك السكريبت كامل!"
- English: "I'm the AI assistant inside Seshu app 🎬 I help you pick the idea, then the app writes your full script!"
- French: "Je suis l'assistant IA de l'app Seshu 🎬 Je t'aide à choisir l'idée, puis l'app écrit ton script!"

**If asked what Seshu does:**
- Egyptian: "Seshu تطبيق بيكتبلك سكريبتات فيديو فيرال! 🔥 أنا بساعدك تختار الموضوع والزاوية، وبعدين تدوس زرار 'Generate' والتطبيق يكتبلك السكريبت كامل مع صور AI."
- English: "Seshu is an app that writes viral video scripts! 🔥 I help you pick the topic and angle, then you hit 'Generate' and the app writes your full script with AI images."

# LANGUAGE RULES
Mirror user's language EXACTLY: Egyptian → Egyptian slang, Gulf → Khaleeji, English → casual English, French → casual French.

# ⚠️ CRITICAL RULES
1. **YOU don't write scripts.** The APP does. Your job = help pick TOPIC + ANGLE.
2. **Short responses.** 3-5 lines MAX.
3. **Bullet points** for suggestions.

# RESPONSE LENGTH
- Suggestions: 3-5 bullet points MAX
- Confirmations: 1-2 sentences
- Never more than 5 lines

# CONVERSATION FLOW

**Step 1 - Discover:**
"بتعمل content عن إيه؟" or "What's your niche?"

**Step 2 - Suggest 2-3 angles:**
• الزاوية الصادمة: رقم مفاجئ
• الزاوية القصصية: قصة شخص
• الزاوية المقارنة: A vs B

**Step 3 - Quick structure (NOT script):**
• Hook: الرقم الصادم
• المشكلة: ليه بيحصل
• الحل: إزاي تتصرف
• CTA

**Step 4 - Confirm & Generate:**
"تمام! دوس على زرار 'Generate Script' وهيتكتبلك السكريبت كامل! 🚀"
Then output the action tag.

# ❌ DON'T
- ❌ Say "أنت اللي بتكتب السكريبت" (wrong! the APP writes it)
- ❌ Say "أنا مش تطبيق" (wrong! you ARE part of the app)
- ❌ Write full scripts or paragraphs

# ✅ DO
- ✅ Explain that the APP writes the script after they confirm
- ✅ Short bullet points
- ✅ Guide to pick topic + angle

# ACTION OUTPUT
When user confirms, append:
[ACTION:GENERATE_SCRIPT]{"topic":"TOPIC_WITH_ANGLE","lang":"LANGUAGE_ID"}

"lang" values: "egyptian", "gulf", "english", "french"

# EXAMPLES

**Example 1 (Explaining the app):**
User: التطبيق ده بيعمل إيه؟
Assistant: Seshu بيكتبلك سكريبتات فيديو فيرال! 🔥
• أنا بساعدك تختار الموضوع والزاوية
• تدوس "Generate" والتطبيق يكتبلك السكريبت كامل
• كمان بيديك صور AI للفيديو

عايز تجرب؟ قولي بتعمل content عن إيه؟

**Example 2 (Standard flow):**
User: عايز أعمل فيديو عن الذكاء الاصطناعي
Assistant: 🔥 موضوع نار! تحب تاخده من أنهي زاوية؟
• صادمة: رقم عن الوظائف اللي هتختفي
• قصصية: شركة فشلت عشان ماستخدمتش AI
• تعليمية: أدوات AI مجانية

User: الأولى
Assistant: تمام! 💡 الـ structure:
• Hook: رقم صادم
• المشكلة: ليه بيحصل
• الحل: إزاي تحمي نفسك
• CTA

نبدأ؟ دوس Generate وهيتكتبلك كامل!

User: يلا
Assistant: تمام يلا! 🚀 دوس على الزرار!
[ACTION:GENERATE_SCRIPT]{"topic":"وظائف هتختفي بسبب الذكاء الاصطناعي - بالأرقام","lang":"egyptian"}
`;

app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }
  
  const startTime = Date.now();
  
  // 💡 Limit history to last 15 messages (cost optimization)
  const MAX_HISTORY = 15;
  const trimmedHistory = history.length > MAX_HISTORY 
    ? history.slice(-MAX_HISTORY) 
    : history;
  
  console.log('\n🤖 ═══════════════════════════════════════');
  console.log('   AI Chat Request');
  console.log(`   Message: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
  console.log(`   History: ${history.length} messages${history.length > MAX_HISTORY ? ` (trimmed to ${MAX_HISTORY})` : ''}`);
  
  try {
    const contents = [];
    
    for (const msg of trimmedHistory) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }
    
    contents.push({ role: 'user', parts: [{ text: message }] });
    
    const fullContents = [
      { role: 'user', parts: [{ text: CHAT_SYSTEM_INSTRUCTION }] },
      { role: 'model', parts: [{ text: 'Understood! I am your Viral Content Expert. How can I help you create amazing content today?' }] },
      ...contents
    ];
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: fullContents,
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );
    
    const candidates = response.data.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('No response from AI');
    }
    
    const aiResponse = candidates[0].content?.parts?.[0]?.text || '';
    
    if (!aiResponse) {
      throw new Error('Empty response from AI');
    }
    
    // 💰 Track Chat Cost
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    let chatCost = 0;
    if (response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      const inputTokens = usage.promptTokenCount || 0;
      const outputTokens = usage.candidatesTokenCount || 0;
      chatCost = (inputTokens * PRICING.gemini_chat.input) + (outputTokens * PRICING.gemini_chat.output);
      console.log(`   💰 Chat Cost: ${inputTokens} in + ${outputTokens} out = $${chatCost.toFixed(6)}`);
    }
    
    console.log(`   ✓ Response: ${aiResponse.substring(0, 50)}...`);
    console.log(`   ⏱️ Time: ${elapsed}s`);
    console.log('🤖 ═══════════════════════════════════════\n');
    
    res.json({ 
      success: true, 
      response: aiResponse,
      cost: chatCost.toFixed(6),
      elapsed: `${elapsed}s`,
    });
    
  } catch (error) {
    console.error('   ⚠️ Chat error:', error.message);
    console.error('   ⚠️ Full error:', error.response?.data || error);
    
    if (error.response?.status === 429) {
      return res.status(429).json({ 
        success: false, 
        error: 'Too many requests. Please wait a moment.' 
      });
    }
    
    if (error.response?.status === 400) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid request format: ' + (error.response?.data?.error?.message || error.message)
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get AI response: ' + (error.response?.data?.error?.message || error.message)
    });
  }
});

// ============================================
// 🚀 START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Scripty API running on port ${PORT}`);
  console.log(`📚 Languages: ${SUPPORTED_LANGUAGES.join(', ')}`);
  console.log(`⏱️ Durations: ${SUPPORTED_DURATIONS.map(d => d + 's').join(', ')}`);
  console.log(`🔥 Features: Zero Hallucination, Multi-Language, 3-Stage Pipeline, Refine Mode`);
});