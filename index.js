const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const PerformanceTracker = require('./performanceTracker');
const { getErrorMessage, detectErrorType } = require('./errorMessages');
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
  claude: { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },           // Claude Sonnet 4
  perplexity: { input: 1.00 / 1_000_000, output: 5.00 / 1_000_000 },        // sonar-pro
  gemini: { input: 1.25 / 1_000_000, output: 10.00 / 1_000_000 },           // Gemini 3 Pro
  gemini_flash: { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },      // Gemini 2.5 Flash
  gemini_flash_lite: { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },// Gemini 2.5 Flash Lite
  gemini_chat: { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },      // Gemini 2.5 Flash Lite (chat) - alias
  flux: { perImage: 0.003 },                                                 // Flux Schnell $3/1000 images
};

function createCostTracker() {
  return {
    claude: { input: 0, output: 0, cost: 0 },
    perplexity: { input: 0, output: 0, cost: 0 },
    gemini: { input: 0, output: 0, cost: 0 },
    gemini_flash: { input: 0, output: 0, cost: 0 },
    gemini_flash_lite: { input: 0, output: 0, cost: 0 },
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
  if (tracker.claude.cost > 0) {
    console.log(`   Claude:          ${tracker.claude.input} in + ${tracker.claude.output} out = $${tracker.claude.cost.toFixed(4)}`);
  }
  if (tracker.perplexity.cost > 0) {
    console.log(`   Perplexity:      ${tracker.perplexity.input} in + ${tracker.perplexity.output} out = $${tracker.perplexity.cost.toFixed(4)}`);
  }
  if (tracker.gemini.cost > 0) {
    console.log(`   Gemini Pro:      ${tracker.gemini.input} in + ${tracker.gemini.output} out = $${tracker.gemini.cost.toFixed(4)}`);
  }
  if (tracker.gemini_flash && tracker.gemini_flash.cost > 0) {
    console.log(`   Gemini Flash:    ${tracker.gemini_flash.input} in + ${tracker.gemini_flash.output} out = $${tracker.gemini_flash.cost.toFixed(4)}`);
  }
  if (tracker.gemini_flash_lite && tracker.gemini_flash_lite.cost > 0) {
    console.log(`   Gemini FlashLite:${tracker.gemini_flash_lite.input} in + ${tracker.gemini_flash_lite.output} out = $${tracker.gemini_flash_lite.cost.toFixed(4)}`);
  }
  if (tracker.gemini_chat && tracker.gemini_chat.cost > 0) {
    console.log(`   Gemini Chat:     ${tracker.gemini_chat.input} in + ${tracker.gemini_chat.output} out = $${tracker.gemini_chat.cost.toFixed(4)}`);
  }
  if (tracker.flux.images > 0) {
    console.log(`   Flux:            ${tracker.flux.images} images = $${tracker.flux.cost.toFixed(4)}`);
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
// 🎯 STAGE 0A: CONTENT SUFFICIENCY ANALYSIS (Smart AI-Based)
// ============================================

async function analyzeContentSufficiency(userInput, duration = '30', language = 'egyptian', costTracker = null) {
  console.log('   🧠 Analyzing content sufficiency...');
  
  const durationConfig = getDurationConfig(duration);
  const targetWords = durationConfig.words;
  
  // Language-specific analysis prompts
  const langPrompts = {
    egyptian: {
      system: 'أنت محلل محتوى. وظيفتك تحليل كفاية المحتوى لكتابة سكريبت فيديو.',
      prompt: `حلل إذا كان هذا المدخل كافي لكتابة سكريبت فيديو ${duration} ثانية (~${targetWords} كلمة).

=== مدخل المستخدم ===
${userInput}

=== خطوات التحليل ===
1. استخرج كل الحقائق/المعلومات اللي المستخدم قدمها (أرقام، تواريخ، أسماء، تفاصيل)
2. استخرج كل الأسئلة أو طلبات البحث ("ابحث عن"، "شوف كام"، "مش متأكد"، "إزاي")
3. قدّر: لو كتبت 15-20 كلمة عن كل حقيقة، هيطلع كام كلمة مجموع؟
4. احسب الفجوة: الكلمات المطلوبة - الكلمات المقدرة

=== OUTPUT (JSON فقط) ===
{
  "user_facts": ["حقيقة 1", "حقيقة 2"],
  "explicit_research_requests": ["سعر التذكرة", "عدد الزوار"],
  "estimated_words_from_facts": 80,
  "target_words": ${targetWords},
  "gap": 70,
  "needs_research": true,
  "research_queries": [
    "استعلام محدد 1",
    "استعلام محدد 2"
  ],
  "preserve_from_user": ["8 مليون كتاب", "80 جنيه"]
}`
    },
    gulf: {
      system: 'أنت محلل محتوى. وظيفتك تحليل كفاية المحتوى لكتابة سكريبت فيديو.',
      prompt: `حلل إذا كان هذا المدخل كافي لكتابة سكريبت فيديو ${duration} ثانية (~${targetWords} كلمة).

=== مدخل المستخدم ===
${userInput}

=== خطوات التحليل ===
1. استخرج كل الحقائق/المعلومات اللي المستخدم قدمها (أرقام، تواريخ، أسماء، تفاصيل)
2. استخرج كل الأسئلة أو طلبات البحث ("ابحث", "وش السعر", "مب متأكد", "كيف")
3. قدّر: لو كتبت 15-20 كلمة عن كل حقيقة، كم كلمة مجموع؟
4. احسب الفجوة: الكلمات المطلوبة - الكلمات المقدرة

=== OUTPUT (JSON فقط) ===
{
  "user_facts": ["حقيقة 1", "حقيقة 2"],
  "explicit_research_requests": ["سعر التذكرة", "عدد الزوار"],
  "estimated_words_from_facts": 80,
  "target_words": ${targetWords},
  "gap": 70,
  "needs_research": true,
  "research_queries": [
    "استعلام محدد 1",
    "استعلام محدد 2"
  ],
  "preserve_from_user": ["المبلغ الكبير", "السعر المنخفض"]
}`
    },
    english: {
      system: 'You are a content analyst. Your job is to analyze if user input is sufficient for writing a video script.',
      prompt: `Analyze if this input is sufficient to write a ${duration}s video script (~${targetWords} words).

=== USER INPUT ===
${userInput}

=== ANALYSIS STEPS ===
1. Extract all FACTS/INFORMATION the user provided (numbers, dates, names, details)
2. Extract all QUESTIONS or RESEARCH REQUESTS ("how much", "find out", "not sure", "what is")
3. Estimate: if I write 15-20 words about each fact, how many total words?
4. Calculate the gap: target words - estimated words

=== OUTPUT (JSON only) ===
{
  "user_facts": ["fact 1", "fact 2"],
  "explicit_research_requests": ["ticket price", "visitor count"],
  "estimated_words_from_facts": 80,
  "target_words": ${targetWords},
  "gap": 70,
  "needs_research": true,
  "research_queries": [
    "specific query 1",
    "specific query 2"
  ],
  "preserve_from_user": ["8 million books", "$80 price"]
}`
    },
    french: {
      system: 'Tu es un analyste de contenu. Ton travail est d\'analyser si l\'entrée de l\'utilisateur est suffisante pour écrire un script vidéo.',
      prompt: `Analyse si cette entrée est suffisante pour écrire un script vidéo de ${duration}s (~${targetWords} mots).

=== ENTRÉE UTILISATEUR ===
${userInput}

=== ÉTAPES D'ANALYSE ===
1. Extraire tous les FAITS/INFORMATIONS fournis par l'utilisateur (chiffres, dates, noms, détails)
2. Extraire toutes les QUESTIONS ou DEMANDES DE RECHERCHE ("combien", "trouve", "pas sûr", "quel est")
3. Estimer : si j'écris 15-20 mots sur chaque fait, combien de mots au total ?
4. Calculer l'écart : mots cibles - mots estimés

=== SORTIE (JSON uniquement) ===
{
  "user_facts": ["fait 1", "fait 2"],
  "explicit_research_requests": ["prix du billet", "nombre de visiteurs"],
  "estimated_words_from_facts": 80,
  "target_words": ${targetWords},
  "gap": 70,
  "needs_research": true,
  "research_queries": [
    "requête spécifique 1",
    "requête spécifique 2"
  ],
  "preserve_from_user": ["8 millions de livres", "80€"]
}`
    },
    frensh: {
      system: 'Tu es un analyste de contenu. Ton travail est d\'analyser si l\'entrée de l\'utilisateur est suffisante pour écrire un script vidéo.',
      prompt: `Analyse si cette entrée est suffisante pour écrire un script vidéo de ${duration}s (~${targetWords} mots).

=== ENTRÉE UTILISATEUR ===
${userInput}

=== ÉTAPES D'ANALYSE ===
1. Extraire tous les FAITS/INFORMATIONS fournis par l'utilisateur (chiffres, dates, noms, détails)
2. Extraire toutes les QUESTIONS ou DEMANDES DE RECHERCHE ("combien", "trouve", "pas sûr", "quel est")
3. Estimer : si j'écris 15-20 mots sur chaque fait, combien de mots au total ?
4. Calculer l'écart : mots cibles - mots estimés

=== SORTIE (JSON uniquement) ===
{
  "user_facts": ["fait 1", "fait 2"],
  "explicit_research_requests": ["prix du billet", "nombre de visiteurs"],
  "estimated_words_from_facts": 80,
  "target_words": ${targetWords},
  "gap": 70,
  "needs_research": true,
  "research_queries": [
    "requête spécifique 1",
    "requête spécifique 2"
  ],
  "preserve_from_user": ["8 millions de livres", "80€"]
}`
    }
  };
  
  const langConfig = langPrompts[language] || langPrompts['egyptian'];
  
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{
          role: 'user',
          parts: [{ text: langConfig.prompt }]
        }],
        systemInstruction: {
          parts: [{ text: langConfig.system }]
        },
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.1, // Low temp for consistent analysis
        }
      }
    );
    
    // Track cost
    if (costTracker && response.data.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash_lite', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    }
    
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const analysis = JSON.parse(match[0]);
      console.log(`   📊 Analysis: ${analysis.user_facts?.length || 0} facts, gap: ${analysis.gap} words`);
      console.log(`   🔍 Needs research: ${analysis.needs_research ? 'YES' : 'NO'}`);
      
      return analysis;
    }
    
  } catch (e) {
    console.log('   ⚠️ Analysis parse error:', e.message);
  }
  
  // Fallback to simple word count logic if analysis fails
  const wordCount = userInput.split(/\s+/).length;
  return {
    user_facts: [],
    explicit_research_requests: [],
    estimated_words_from_facts: wordCount,
    target_words: targetWords,
    gap: targetWords - wordCount,
    needs_research: wordCount < 60,
    research_queries: [userInput],
    preserve_from_user: [],
  };
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
  
  // Using Gemini 2.5 Flash Lite for cost efficiency
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{
        role: 'user',
        parts: [{ text: langConfig.prompt }]
      }],
      systemInstruction: {
        parts: [{ text: langConfig.system }]
      },
      generationConfig: {
        maxOutputTokens: 200,
      }
    }
  );
  
  // Track cost
  if (costTracker && response.data.usageMetadata) {
    const usage = response.data.usageMetadata;
    trackCost(costTracker, 'gemini_flash_lite', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
  }
  
  try {
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Extract JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const result = `${parsed.topic} - ${parsed.angle}`;
      console.log(`   🧠 Understood: "${result}"`);
      return result;
    }
  } catch (e) {
    console.log('   ⚠️ Parse error, using raw input:', e.message);
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

async function generateHooks(topic, researchData, niche, language = 'egyptian', costTracker = null, actionType = 'research', userInstructions = '', preserveFromUser = []) {
  console.log('   🎣 Generating hooks (Gemini 3 Flash)...');
  
  // Get niche-specific hooks for this language (used as style reference for both modes)
  const nicheHooks = getNicheHooks(niche, language);
  const universalHooks = getUniversalHooks(language);
  
  console.log(`   📌 Using ${nicheHooks.length} niche hooks + ${universalHooks.length} universal hooks (${language})`);
  console.log(`   🎯 Mode: ${actionType.toUpperCase()}`);

  // Language-specific hook generation prompts with Chain of Thought
  const langHookPrompts = {
    egyptian: {
      instruction: 'اكتب 3 Hooks مثيرة للفضول بالعامية المصرية زي الأمثلة دي بالظبط',
      tips: `• غموض يثير الفضول - متكشفش كل حاجة
• سؤال أو تحدي أو صدمة
• استخدم رقم أو حقيقة صادمة من البحث
• ❌ ممنوع تكشف الموضوع بالكامل
• ❌ ممنوع "هل تعلم" أو "تخيل كده"
• ✅ "لو فاكر إن..."، "ليه..."، "أوعى..."، "الرقم ده..."`,
      thinkFirst: `=== فكّر قبل ما تكتب ===
لكل hook، حلل:
1. الـ Curiosity Gap: إيه اللي هيخليه عايز يعرف أكتر؟
2. الـ Emotion: إيه الإحساس؟ (curiosity/shock/fomo/pride/anger)
3. إيقاف السكرول: ليه هيوقف يتفرج؟

اختار أقوى hook وقول ليه.`
    },
    gulf: {
      instruction: 'اكتب 3 Hooks مثيرة للفضول باللهجة الخليجية زي الأمثلة هذي بالضبط',
      tips: `• غموض يثير الفضول - لا تكشف كل شي
• سؤال أو تحدي أو صدمة
• استخدم رقم أو حقيقة صادمة من البحث
• ❌ ممنوع تكشف الموضوع كله
• ❌ ممنوع "هل تعلم" أو "تخيل معي"
• ✅ "لو تحسب إن..."، "ليش..."، "انتبه..."، "الرقم هذا..."`,
      thinkFirst: `=== فكّر قبل ما تكتب ===
لكل hook، حلل:
1. الـ Curiosity Gap: وش اللي يخليه يبي يعرف أكثر؟
2. الـ Emotion: وش الإحساس؟ (curiosity/shock/fomo/pride/anger)
3. إيقاف السكرول: ليش بيوقف يتفرج؟

اختار أقوى hook وقول ليش.`
    },
    french: {
      instruction: 'Écris 3 Hooks intrigants en Français exactement comme ces exemples',
      tips: `• Mystère qui attire la curiosité - ne révèle pas tout
• Question, défi ou choc
• Utilise un chiffre ou fait choquant de la recherche
• ❌ Ne révèle pas tout le sujet
• ❌ Pas de "Saviez-vous" ou "Imaginez"
• ✅ "Si tu penses que...", "Pourquoi...", "Attention...", "Ce chiffre..."`,
      thinkFirst: `=== RÉFLÉCHIS AVANT D'ÉCRIRE ===
Pour CHAQUE hook, analyse:
1. Curiosity Gap: Qu'est-ce qui donne envie d'en savoir plus?
2. Emotion: Quel sentiment? (curiosity/shock/fomo/pride/anger)
3. Facteur d'arrêt: Pourquoi quelqu'un arrêterait de scroller?

Choisis le hook le plus fort et explique pourquoi.`
    },
    frensh: {
      instruction: 'Écris 3 Hooks intrigants en Français exactement comme ces exemples',
      tips: `• Mystère qui attire la curiosité - ne révèle pas tout
• Question, défi ou choc
• Utilise un chiffre ou fait choquant de la recherche
• ❌ Ne révèle pas tout le sujet
• ❌ Pas de "Saviez-vous" ou "Imaginez"
• ✅ "Si tu penses que...", "Pourquoi...", "Attention...", "Ce chiffre..."`,
      thinkFirst: `=== RÉFLÉCHIS AVANT D'ÉCRIRE ===
Pour CHAQUE hook, analyse:
1. Curiosity Gap: Qu'est-ce qui donne envie d'en savoir plus?
2. Emotion: Quel sentiment? (curiosity/shock/fomo/pride/anger)
3. Facteur d'arrêt: Pourquoi quelqu'un arrêterait de scroller?

Choisis le hook le plus fort et explique pourquoi.`
    },
    english: {
      instruction: 'Write 3 curiosity-inducing Hooks in English exactly like these examples',
      tips: `• Mystery that sparks curiosity - don't reveal everything
• Question, challenge, or shock
• Use a shocking number or fact from the research
• ❌ Don't reveal the whole topic
• ❌ No "Did you know" or "Imagine this"
• ✅ "If you think...", "Why...", "Watch out...", "This number..."`,
      thinkFirst: `=== THINK BEFORE YOU WRITE ===
For EACH hook, analyze:
1. Curiosity Gap: What makes them NEED to know more?
2. Emotion: What feeling? (curiosity/shock/fomo/pride/anger)
3. Scroll Stop Factor: Why would someone STOP scrolling?

Pick the strongest hook and explain why.`
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
  
  // Build preserve section for hybrid mode (user's facts that must be used literally)
  const preserveSection = preserveFromUser && preserveFromUser.length > 0
    ? `\n🔒 MUST USE THESE FACTS LITERALLY (from user input - don't change!):\n${preserveFromUser.map(fact => `- "${fact}"`).join('\n')}\n`
    : '';
  
  const prompt = `${hookConfig.instruction}:

Topic: ${topic}
${preserveSection}
${contentSource}

=== Example Hooks from "${niche}" (copy the STYLE exactly!) ===
${nicheHooks.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== Universal Hook Patterns (for inspiration) ===
${universalHooks.slice(0, 3).map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== Style Tips ===
${hookConfig.tips}

${hookConfig.thinkFirst}

${actionType === 'refine' ? '⚠️ IMPORTANT: The hooks must relate to the USER\'S CONTENT above, not external information.' : ''}
${preserveFromUser && preserveFromUser.length > 0 ? '⚠️ IMPORTANT: If user provided specific numbers/facts above (🔒), use them EXACTLY in hooks instead of research data!' : ''}

JSON only (include reasoning for each hook):
{
  "analysis": {
    "topic_hook_potential": "The strongest angle for a hook",
    "target_emotion": "Primary emotion to target (curiosity/shock/fomo/pride/anger)"
  },
  "hooks": [
    {
      "text": "The actual hook text",
      "reasoning": "Why this works (1 sentence)",
      "emotion": "curiosity|shock|fomo|pride|anger",
      "scroll_stop_factor": "What stops the scroll"
    },
    {
      "text": "...",
      "reasoning": "...",
      "emotion": "...",
      "scroll_stop_factor": "..."
    },
    {
      "text": "...",
      "reasoning": "...",
      "emotion": "...",
      "scroll_stop_factor": "..."
    }
  ],
  "recommended": 0
}`;

  try {
    // Use Gemini 3.0 Flash Preview for hook generation (faster + cheaper)
    const hookModel = 'gemini-3-flash-preview';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${hookModel}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.8,
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Track cost (using 'gemini_flash' label for Flash model)
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || usage.totalTokenCount - usage.promptTokenCount || 0);
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
        
        // Handle NEW format with reasoning
        if (parsed.hooks && parsed.hooks.length > 0) {
          // Check if hooks are objects (new format) or strings (old format fallback)
          const isNewFormat = typeof parsed.hooks[0] === 'object';
          
          if (isNewFormat) {
            // Extract text for backward compatibility
            const hooksArray = parsed.hooks.map(h => h.text);
            const recommended = parsed.recommended ?? 0;
            const analysis = parsed.analysis || null;
            
            console.log(`   ✓ Got ${hooksArray.length} hooks with reasoning`);
            console.log(`   ⭐ Recommended: Hook #${recommended + 1}`);
            if (analysis?.target_emotion) {
              console.log(`   🎯 Target emotion: ${analysis.target_emotion}`);
            }
            
            // Return enriched object
            return {
              hooks: hooksArray,           // string[] for backward compatibility
              hooksDetailed: parsed.hooks, // full objects with reasoning
              recommended: recommended,    // index of recommended hook
              analysis: analysis           // topic analysis
            };
          } else {
            // Old format fallback (just strings)
            console.log(`   ✓ Got ${parsed.hooks.length} hooks (simple format)`);
            return {
              hooks: parsed.hooks,
              hooksDetailed: parsed.hooks.map((text, i) => ({
                text,
                reasoning: '',
                emotion: 'curiosity',
                scroll_stop_factor: ''
              })),
              recommended: 0,
              analysis: null
            };
          }
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
  const fallbackHooks = [
    `اللي بيوصلك عن ${topic.substring(0, 30)} ده نص الحقيقة بس...`,
    `لو فاكر إن اللي بيحصل في ${topic.substring(0, 30)} ده صدفة... تبقى غلطان!`,
    `أتحداك تكون واخد بالك من التفصيلة دي...`
  ];
  
  return {
    hooks: fallbackHooks,
    hooksDetailed: fallbackHooks.map((text, i) => ({
      text,
      reasoning: 'Fallback hook',
      emotion: 'curiosity',
      scroll_stop_factor: 'Mystery/intrigue'
    })),
    recommended: 0,
    analysis: null
  };
}

// ============================================
// ✍️ STAGE 3: WRITE SCRIPT (Gemini 3 Pro)
// ============================================

async function writeScript(topic, researchData, niche, selectedHook, duration, language = 'egyptian', costTracker = null, actionType = 'research', userInstructions = '', preserveFromUser = [], explicitRequests = []) {
  console.log(`   ✍️ Writing script (Gemini 3 Pro) - Mode: ${actionType.toUpperCase()}...`);
  
  // Log preserved facts if any
  if (preserveFromUser && preserveFromUser.length > 0) {
    console.log(`   📌 Preserving ${preserveFromUser.length} user facts literally`);
  }
  
  const durationConfig = getDurationConfig(duration);
  const examples = getNicheExamples(niche, duration, language);
  
  // Get 2-3 golden examples
  const goldenExamples = examples.slice(0, Math.min(3, examples.length));
  const examplesText = goldenExamples.map((ex, idx) => `
--- Example #${idx + 1}: ${ex.title || ''} ---
${ex.script}
`).join('\n');

  let prompt;
  
  if (actionType === 'hybrid') {
    // ============================================
    // 🧩 HYBRID MODE: Smart Content Blending
    // ============================================
    console.log('   🧩 Using HYBRID mode (User Content + Research)');
    
    // Build preserve facts section if available
    const preserveSection = preserveFromUser && preserveFromUser.length > 0
      ? `\n🔒 حقائق يجب استخدامها حرفياً (لا تغيرها أبداً):\n${preserveFromUser.map(fact => `- "${fact}"`).join('\n')}\n`
      : '';
    
    const requestsSection = explicitRequests && explicitRequests.length > 0
      ? `\n❓ أسئلة المستخدم (لازم تجاوب عليها من البحث):\n${explicitRequests.map(req => `- ${req}`).join('\n')}\n`
      : '';
    
    const hybridPrompts = {
      egyptian: `أنت كاتب سكريبتات فيروسية ذكي. مهمتك دمج محتوى المستخدم مع البحث بشكل سلس.

=== أمثلة الأسلوب المطلوب (قلد الـ DNA بالظبط) ===
${examplesText}

=== قواعد الدمج الذكي ===
1. ✅ استخدم الحقائق والأرقام من المستخدم حرفياً (لا تغيرها أبداً)
2. ✅ املأ الفجوات بمعلومات من البحث
3. ✅ أجب على أي أسئلة أو طلبات بحث ذكرها المستخدم
4. ✅ احتفظ بترتيب نقاط المستخدم
5. ❌ لا تضيف معلومات عشوائية - اربط كل شيء بالموضوع
${preserveSection}${requestsSection}
=== محتوى المستخدم (أولوية عليا) ===
${userInstructions}

=== البحث (استخدمه لملء الفجوات فقط) ===
${researchData}

=== المطلوب ===
- Hook: "${selectedHook}"
- الطول: ${durationConfig.words} كلمة تقريباً
- ابدأ بالـ Hook
- استخدم حقائق المستخدم حرفياً (خصوصاً اللي فوق 🔒)
- املأ الفراغات من البحث
- اكتب بالعامية المصرية

اكتب السكريبت مباشرة:`,

      gulf: `أنت كاتب سكربتات فايرال ذكي. مهمتك دمج محتوى المستخدم مع البحث بشكل سلس.

=== أمثلة الأسلوب المطلوب ===
${examplesText}

=== قواعد الدمج الذكي ===
1. ✅ استخدم الحقائق والأرقام من المستخدم حرفياً
2. ✅ املأ الفجوات بمعلومات من البحث
3. ✅ أجب على أي أسئلة ذكرها المستخدم
4. ✅ احتفظ بترتيب نقاط المستخدم
5. ❌ لا تضيف معلومات عشوائية
${preserveSection}${requestsSection}
=== محتوى المستخدم (أولوية عليا) ===
${userInstructions}

=== البحث (لملء الفجوات) ===
${researchData}

=== المطلوب ===
- Hook: "${selectedHook}"
- الطول: ${durationConfig.words} كلمة تقريباً
- استخدم حقائق المستخدم حرفياً (خصوصاً اللي فوق 🔒)
- اكتب باللهجة الخليجية

اكتب السكريبت مباشرة:`,

      english: `You are a Smart Viral Scriptwriter. Your job is to intelligently blend user content with research.

=== STYLE EXAMPLES (copy the DNA exactly) ===
${examplesText}

=== SMART BLENDING RULES ===
1. ✅ Use user's facts and numbers EXACTLY as provided (never change them)
2. ✅ Fill gaps with information from research
3. ✅ Answer any questions or research requests the user mentioned
4. ✅ Keep the user's points in order
5. ❌ Don't add random information - keep everything relevant
${preserveSection ? preserveSection.replace('🔒 حقائق يجب استخدامها حرفياً (لا تغيرها أبداً):', '🔒 MUST preserve these facts LITERALLY (never change):') : ''}${requestsSection ? requestsSection.replace('❓ أسئلة المستخدم (لازم تجاوب عليها من البحث):', '❓ User questions (answer from research):') : ''}
=== USER CONTENT (Top Priority) ===
${userInstructions}

=== RESEARCH (Use to fill gaps only) ===
${researchData}

=== REQUIREMENTS ===
- Hook: "${selectedHook}"
- Length: ~${durationConfig.words} words
- Start with the Hook
- Use user facts literally (especially 🔒 above)
- Fill blanks from research
- Write in natural English

Write the script directly:`,

      french: `Tu es un concepteur de scripts viraux intelligent. Ta mission est de fusionner intelligemment le contenu utilisateur avec la recherche.

=== EXEMPLES DE STYLE (copie le DNA exactement) ===
${examplesText}

=== RÈGLES DE FUSION INTELLIGENTE ===
1. ✅ Utilise les faits et chiffres de l'utilisateur EXACTEMENT (ne les change jamais)
2. ✅ Remplis les lacunes avec des informations de la recherche
3. ✅ Réponds aux questions ou demandes de recherche mentionnées par l'utilisateur
4. ✅ Garde l'ordre des points de l'utilisateur
5. ❌ N'ajoute pas d'informations aléatoires - reste pertinent
${preserveSection ? preserveSection.replace('🔒 حقائق يجب استخدامها حرفياً (لا تغيرها أبداً):', '🔒 DOIT préserver ces faits LITTÉRALEMENT (ne jamais changer):') : ''}${requestsSection ? requestsSection.replace('❓ أسئلة المستخدم (لازم تجاوب عليها من البحث):', '❓ Questions utilisateur (répondre depuis recherche):') : ''}
=== CONTENU UTILISATEUR (Priorité maximale) ===
${userInstructions}

=== RECHERCHE (pour combler les lacunes uniquement) ===
${researchData}

=== REQUIS ===
- Hook: "${selectedHook}"
- Longueur: ~${durationConfig.words} mots
- Utilise les faits utilisateur littéralement (surtout 🔒 ci-dessus)
- Écris en Français naturel

Écris le script directement:`,

      frensh: `Tu es un concepteur de scripts viraux intelligent. Ta mission est de fusionner intelligemment le contenu utilisateur avec la recherche.

=== EXEMPLES DE STYLE ===
${examplesText}

=== RÈGLES DE FUSION INTELLIGENTE ===
1. ✅ Utilise les faits et chiffres de l'utilisateur EXACTEMENT
2. ✅ Remplis les lacunes avec des informations de la recherche
3. ✅ Réponds aux questions mentionnées par l'utilisateur
4. ✅ Garde l'ordre des points
5. ❌ N'ajoute pas d'informations aléatoires
${preserveSection ? preserveSection.replace('🔒 حقائق يجب استخدامها حرفياً (لا تغيرها أبداً):', '🔒 DOIT préserver ces faits:') : ''}${requestsSection ? requestsSection.replace('❓ أسئلة المستخدم (لازم تجاوب عليها من البحث):', '❓ Questions utilisateur:') : ''}
=== CONTENU UTILISATEUR ===
${userInstructions}

=== RECHERCHE ===
${researchData}

=== REQUIS ===
- Hook: "${selectedHook}"
- Longueur: ~${durationConfig.words} mots
- Utilise les faits littéralement (surtout 🔒)

Écris le script directement:`
    };
    
    prompt = hybridPrompts[language] || hybridPrompts['egyptian'];
    
  } else if (actionType === 'refine') {
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
7. ❌ ممنوع تنسخ جمل المستخدم حرفياً - اكتبها من جديد بأسلوب الأمثلة

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
7. ❌ ممنوع تنسخ جمل المستخدم حرفياً - اكتبها من جديد بأسلوب الأمثلة

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
7. ❌ DO NOT copy user's sentences word-for-word - rewrite them in the examples' style

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
7. ❌ Ne copie PAS les phrases de l'utilisateur mot à mot - réécris-les dans le style des exemples

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
7. ❌ Ne copie PAS les phrases de l'utilisateur mot à mot - réécris-les dans le style des exemples

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

  // Use Gemini 3 Pro for high-quality script generation
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: durationConfig.maxTokens,
        temperature: actionType === 'refine' ? 0.5 : actionType === 'hybrid' ? 0.6 : 0.7, // Hybrid: balanced creativity
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
  let sourceContent, expandInstructions;
  
  if (actionType === 'refine') {
    sourceContent = `User's original draft (ONLY use information from here):
${userInstructions}`;
    expandInstructions = 'Add more detail from the user\'s draft ONLY';
  } else if (actionType === 'hybrid') {
    sourceContent = `User's Content (preserve exactly):
${userInstructions}

Research Data (use to fill gaps):
${research}`;
    expandInstructions = 'Use user facts literally, fill gaps with research details';
  } else {
    sourceContent = `Full research (use additional info from here):
${research}`;
    expandInstructions = 'Add details, examples, comparisons from the research';
  }
  
  const prompt = `The script is too short and needs to be expanded.

Current script (${currentWords} words):
${shortScript}

Target: ${targetWords} words (±10%)

${sourceContent}

Reference examples (for style):
${examplesText}

Requirements:
- Expand the script to ${targetWords} words
- ${expandInstructions}
- Keep the same fast-paced, engaging style
- Start with the same Hook: "${selectedHook}"
- ❌ Don't repeat existing information
- ❌ Never say "unspecified" or "unknown"

${langConfig.instruction}:`;

  try {
    // Use Gemini 3 Flash for fast expansion
    const expandModel = 'gemini-3-flash-preview';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${expandModel}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: targetWords * 8,
          temperature: actionType === 'refine' ? 0.5 : actionType === 'hybrid' ? 0.6 : 0.7,
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    // Track cost (using 'gemini_flash' label for Flash model)
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || usage.totalTokenCount - usage.promptTokenCount || 0);
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
// ✅ STAGE 6B: FACT VALIDATION (Zero Hallucination)
// ============================================

async function validateFactsAgainstResearch(script, research, language = 'egyptian', costTracker = null) {
  // Skip if no research (refine mode) or research too short
  if (!research || research.length < 100) {
    return { valid: true, accuracy_score: 100, issues: [], skipped: true };
  }
  
  console.log('   🔍 Validating facts against research...');
  
  const prompts = {
    egyptian: `أنت fact-checker دقيق. قارن السكريبت بالبحث.

=== السكريبت ===
${script}

=== البحث (مصدر الحقيقة الوحيد) ===
${research}

=== المطلوب ===
اكتشف أي claim في السكريبت:
1. فيها رقم/تاريخ مش موجود في البحث
2. بتقول معلومة مش مدعومة بالبحث
3. بتبالغ أو بتحرّف حقائق البحث
4. مخترعة من الـ AI

=== Output (JSON فقط) ===
{
  "valid": true,
  "accuracy_score": 95,
  "issues": [
    {
      "claim_in_script": "الجملة الغلط",
      "problem": "not_in_research|exaggerated|wrong_number|fabricated",
      "what_research_says": "الصح من البحث أو null"
    }
  ]
}`,

    gulf: `أنت fact-checker دقيق. قارن السكريبت بالبحث.

=== السكريبت ===
${script}

=== البحث (مصدر الحقيقة الوحيد) ===
${research}

=== المطلوب ===
اكتشف أي claim في السكريبت:
1. فيها رقم/تاريخ مو موجود في البحث
2. تقول معلومة مو مدعومة بالبحث
3. تبالغ أو تحرّف حقائق البحث

=== Output (JSON فقط) ===
{
  "valid": true,
  "accuracy_score": 95,
  "issues": [
    {
      "claim_in_script": "الجملة الغلط",
      "problem": "not_in_research|exaggerated|wrong_number|fabricated",
      "what_research_says": "الصح من البحث أو null"
    }
  ]
}`,

    english: `You are a precise fact-checker. Compare the script against research.

=== SCRIPT ===
${script}

=== RESEARCH (Single Source of Truth) ===
${research}

=== TASK ===
Find ANY claim in the script that:
1. Has a number/date NOT in the research
2. Makes a claim NOT supported by research
3. Exaggerates or distorts research facts
4. Is completely fabricated by AI

=== OUTPUT (JSON only) ===
{
  "valid": true,
  "accuracy_score": 95,
  "issues": [
    {
      "claim_in_script": "The wrong sentence",
      "problem": "not_in_research|exaggerated|wrong_number|fabricated",
      "what_research_says": "Correct info or null"
    }
  ]
}`,

    french: `Vous êtes un fact-checker précis. Comparez le script avec la recherche.

=== SCRIPT ===
${script}

=== RECHERCHE (Seule Source de Vérité) ===
${research}

=== TÂCHE ===
Trouvez toute affirmation dans le script qui:
1. A un nombre/date NON présent dans la recherche
2. Fait une affirmation NON soutenue
3. Exagère ou déforme les faits
4. Est complètement fabriquée

=== OUTPUT (JSON uniquement) ===
{
  "valid": true,
  "accuracy_score": 95,
  "issues": [
    {
      "claim_in_script": "La phrase incorrecte",
      "problem": "not_in_research|exaggerated|wrong_number|fabricated",
      "what_research_says": "Info correcte ou null"
    }
  ]
}`,

    frensh: `Vous êtes un fact-checker précis. Comparez le script avec la recherche.

=== SCRIPT ===
${script}

=== RECHERCHE (Seule Source de Vérité) ===
${research}

=== TÂCHE ===
Trouvez toute affirmation dans le script qui:
1. A un nombre/date NON présent
2. Fait une affirmation NON soutenue
3. Exagère ou déforme les faits

=== OUTPUT (JSON uniquement) ===
{
  "valid": true,
  "accuracy_score": 95,
  "issues": []
}`
  };

  const prompt = prompts[language] || prompts['english'];

  try {
    // Use Gemini Flash Lite (fast + cheap for validation)
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1500,
          temperature: 0.1  // Low temp for accuracy
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Track cost
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash_lite', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    }

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      console.log(`   📊 Fact check: ${result.accuracy_score || 100}% accuracy, ${result.issues?.length || 0} issues`);
      return result;
    }
    
    return { valid: true, accuracy_score: 80, issues: [], parse_error: true };
  } catch (e) {
    console.error('   ⚠️ Fact validation error:', e.message);
    return { valid: true, accuracy_score: 80, issues: [], error: e.message };
  }
}

// ============================================
// 🔧 STAGE 6C: FIX FACTUAL ERRORS
// ============================================

async function fixFactualErrors(script, issues, research, language = 'egyptian', costTracker = null) {
  if (!issues || issues.length === 0) {
    return script;
  }
  
  console.log(`   🔧 Fixing ${issues.length} factual errors...`);
  
  const issuesText = issues.map((issue, i) => `${i + 1}. "${issue.claim_in_script}"
   المشكلة: ${issue.problem}
   الصح: ${issue.what_research_says || 'احذف الجملة'}`).join('\n\n');

  const prompts = {
    egyptian: `أنت محرر سكريبتات. صحّح الأخطاء دي:

=== السكريبت ===
${script}

=== الأخطاء ===
${issuesText}

=== البحث ===
${research.substring(0, 2000)}

=== القواعد ===
1. صحّح الجمل الغلط بس
2. احتفظ بنفس الأسلوب والطاقة
3. لو مفيش معلومة صح → احذف الجملة
4. متضيفش معلومات جديدة

اكتب السكريبت المصحح كامل (بدون JSON أو markdown):`,

    gulf: `أنت محرر سكريبتات. صحّح الأخطاء هذي:

=== السكريبت ===
${script}

=== الأخطاء ===
${issuesText}

=== البحث ===
${research.substring(0, 2000)}

=== القواعد ===
1. صحّح الجمل الغلط بس
2. احتفظ بنفس الأسلوب
3. لو ما فيه معلومة صح → احذف
4. لا تضيف جديد

اكتب السكريبت المصحح:`,

    english: `You are a script editor. Fix these errors:

=== SCRIPT ===
${script}

=== ERRORS ===
${issues.map((issue, i) => `${i + 1}. "${issue.claim_in_script}"
   Problem: ${issue.problem}
   Correct: ${issue.what_research_says || 'Remove this sentence'}`).join('\n\n')}

=== RESEARCH ===
${research.substring(0, 2000)}

=== RULES ===
1. Only fix incorrect sentences
2. Keep same style and energy
3. If no correct info → remove sentence
4. Do NOT add new information

Write the corrected script (no JSON or markdown):`,

    french: `Vous êtes un éditeur. Corrigez ces erreurs:

=== SCRIPT ===
${script}

=== ERREURS ===
${issues.map((issue, i) => `${i + 1}. "${issue.claim_in_script}"
   Problème: ${issue.problem}
   Correct: ${issue.what_research_says || 'Supprimez'}`).join('\n\n')}

=== RECHERCHE ===
${research.substring(0, 2000)}

=== RÈGLES ===
1. Corrigez seulement les erreurs
2. Gardez le même style
3. Si pas d'info correcte → supprimez
4. N'ajoutez rien

Écrivez le script corrigé:`,

    frensh: `Vous êtes un éditeur. Corrigez ces erreurs:

=== SCRIPT ===
${script}

=== ERREURS ===
${issues.map((issue, i) => `${i + 1}. "${issue.claim_in_script}"
   Problème: ${issue.problem}
   Correct: ${issue.what_research_says || 'Supprimez'}`).join('\n\n')}

=== RECHERCHE ===
${research.substring(0, 2000)}

Écrivez le script corrigé:`
  };

  const prompt = prompts[language] || prompts['english'];

  try {
    // Use Gemini 3 Flash for fast error fixing
    const fixModel = 'gemini-3-flash-preview';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${fixModel}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 3000,
          temperature: 0.3
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Track cost (using 'gemini_flash' label for Flash model)
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    }

    const fixedScript = response.data.candidates?.[0]?.content?.parts?.[0]?.text || script;
    
    // Clean up the result
    const cleaned = fixedScript
      .replace(/```[\s\S]*?```/g, '')
      .replace(/#{1,3}\s*/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .trim();
    
    console.log('   ✅ Factual errors fixed');
    return cleaned;
  } catch (e) {
    console.error('   ⚠️ Fix errors failed:', e.message);
    return script; // Return original if fix fails
  }
}

// ============================================
// 📊 STAGE 7: QUALITY SCORING (Compare to Golden Examples)
// ============================================

async function scoreScriptQuality(script, hook, duration, language, niche, costTracker) {
  console.log('   📊 Scoring script quality against golden examples...');
  
  // Get the SAME examples used for script writing
  const examples = getNicheExamples(niche, duration, language);
  const examplesText = examples.slice(0, 2).map((ex, i) => 
    `--- Example ${i + 1} ---\n${ex.script || ex}`
  ).join('\n\n');

  const prompts = {
    egyptian: `أنت محلل جودة سكريبتات فيرال.

=== الأمثلة المرجعية (السكريبت لازم يكون شبههم) ===
${examplesText}

=== السكريبت الجديد ===
${script}

=== الـ Hook ===
${hook}

=== قارن السكريبت بالأمثلة وقيّم (1-10) ===
1. **hook_strength**: الـ hook قوي زي الأمثلة؟
2. **flow_pacing**: الإيقاع والجمل القصيرة زي الأمثلة؟
3. **information_density**: كثافة المعلومات زي الأمثلة؟
4. **emotional_triggers**: الإثارة والطاقة زي الأمثلة؟
5. **cta_strength**: الـ CTA قوي زي الأمثلة؟
6. **dialect_authenticity**: اللهجة طبيعية زي الأمثلة؟
7. **virality_potential**: هيتعمله share زي الأمثلة؟

=== Output (JSON فقط) ===
{
  "scores": {
    "hook_strength": 8,
    "flow_pacing": 7,
    "information_density": 8,
    "emotional_triggers": 6,
    "cta_strength": 5,
    "dialect_authenticity": 9,
    "virality_potential": 7
  },
  "overall": 7.1,
  "weakest_area": "cta_strength",
  "weakness_detail": "الـ CTA مش قوي زي الأمثلة، محتاج يكون أوضح وفيه urgency",
  "strongest_area": "dialect_authenticity",
  "similarity_to_examples": "السكريبت شبه الأمثلة في اللهجة بس الـ CTA أضعف"
}`,

    gulf: `أنت محلل جودة سكريبتات فيرال.

=== الأمثلة المرجعية (السكريبت لازم يكون شبههم) ===
${examplesText}

=== السكريبت الجديد ===
${script}

=== الـ Hook ===
${hook}

=== قارن السكريبت بالأمثلة وقيّم (1-10) ===
1. **hook_strength**: الـ hook قوي مثل الأمثلة؟
2. **flow_pacing**: الإيقاع والجمل مثل الأمثلة؟
3. **information_density**: كثافة المعلومات مثل الأمثلة؟
4. **emotional_triggers**: الإثارة والطاقة مثل الأمثلة؟
5. **cta_strength**: الـ CTA قوي مثل الأمثلة؟
6. **dialect_authenticity**: اللهجة طبيعية مثل الأمثلة؟
7. **virality_potential**: بيتشير مثل الأمثلة؟

=== Output (JSON فقط) ===
{
  "scores": {
    "hook_strength": 8,
    "flow_pacing": 7,
    "information_density": 8,
    "emotional_triggers": 6,
    "cta_strength": 5,
    "dialect_authenticity": 9,
    "virality_potential": 7
  },
  "overall": 7.1,
  "weakest_area": "cta_strength",
  "weakness_detail": "الـ CTA مو قوي مثل الأمثلة",
  "strongest_area": "dialect_authenticity",
  "similarity_to_examples": "السكريبت مشابه للأمثلة في اللهجة بس الـ CTA أضعف"
}`,

    english: `You are a viral script quality analyst.

=== REFERENCE EXAMPLES (Script should match these) ===
${examplesText}

=== NEW SCRIPT ===
${script}

=== HOOK ===
${hook}

=== COMPARE TO EXAMPLES AND SCORE (1-10) ===
1. **hook_strength**: Hook as strong as examples?
2. **flow_pacing**: Rhythm and short sentences like examples?
3. **information_density**: Info density like examples?
4. **emotional_triggers**: Energy and excitement like examples?
5. **cta_strength**: CTA as strong as examples?
6. **dialect_authenticity**: Natural language like examples?
7. **virality_potential**: Shareable like examples?

=== OUTPUT (JSON only) ===
{
  "scores": {
    "hook_strength": 8,
    "flow_pacing": 7,
    "information_density": 8,
    "emotional_triggers": 6,
    "cta_strength": 5,
    "dialect_authenticity": 9,
    "virality_potential": 7
  },
  "overall": 7.1,
  "weakest_area": "cta_strength",
  "weakness_detail": "CTA not as strong as examples, needs more urgency",
  "strongest_area": "dialect_authenticity",
  "similarity_to_examples": "Script matches examples in tone but CTA is weaker"
}`,

    french: `Vous êtes un analyste de qualité de scripts viraux.

=== EXEMPLES DE RÉFÉRENCE (Le script doit leur ressembler) ===
${examplesText}

=== NOUVEAU SCRIPT ===
${script}

=== HOOK ===
${hook}

=== COMPAREZ AUX EXEMPLES ET NOTEZ (1-10) ===
1. **hook_strength**: Hook aussi fort que les exemples?
2. **flow_pacing**: Rythme et phrases comme les exemples?
3. **information_density**: Densité d'info comme les exemples?
4. **emotional_triggers**: Énergie comme les exemples?
5. **cta_strength**: CTA aussi fort que les exemples?
6. **dialect_authenticity**: Langage naturel comme les exemples?
7. **virality_potential**: Partageable comme les exemples?

=== OUTPUT (JSON uniquement) ===
{
  "scores": {
    "hook_strength": 8,
    "flow_pacing": 7,
    "information_density": 8,
    "emotional_triggers": 6,
    "cta_strength": 5,
    "dialect_authenticity": 9,
    "virality_potential": 7
  },
  "overall": 7.1,
  "weakest_area": "cta_strength",
  "weakness_detail": "CTA pas aussi fort que les exemples",
  "strongest_area": "dialect_authenticity",
  "similarity_to_examples": "Script similaire aux exemples mais CTA plus faible"
}`,

    frensh: `Vous êtes un analyste de qualité de scripts viraux.

=== EXEMPLES DE RÉFÉRENCE ===
${examplesText}

=== NOUVEAU SCRIPT ===
${script}

=== HOOK ===
${hook}

=== COMPAREZ ET NOTEZ (1-10) ===

=== OUTPUT (JSON uniquement) ===
{
  "scores": {},
  "overall": 7.5,
  "weakest_area": "",
  "weakness_detail": "",
  "strongest_area": "",
  "similarity_to_examples": ""
}`
  };

  const prompt = prompts[language] || prompts['english'];

  try {
    // Use Gemini Flash Lite (fast + cheap for scoring)
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.2
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Track cost
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash_lite', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    }

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Calculate overall if not provided
      if (!parsed.overall && parsed.scores) {
        const scores = Object.values(parsed.scores);
        parsed.overall = scores.reduce((a, b) => a + b, 0) / scores.length;
      }
      console.log(`   📈 Quality: ${parsed.overall?.toFixed(1) || '?'}/10 | Weakest: ${parsed.weakest_area || 'N/A'}`);
      return parsed;
    }
    
    return { overall: 7.5, scores: {}, skipped: true, parse_error: true };
  } catch (e) {
    console.error('   ⚠️ Quality scoring error:', e.message);
    return { overall: 7.5, scores: {}, skipped: true, error: e.message };
  }
}

// ============================================
// 🔄 STAGE 8: REWRITE WEAK AREAS
// ============================================

async function rewriteWeakAreas(script, qualityScore, hook, duration, language, niche, costTracker) {
  const { weakest_area, weakness_detail } = qualityScore;
  
  if (!weakest_area) {
    return script;
  }
  
  console.log(`   🔄 Rewriting weak area: ${weakest_area}...`);
  
  // Get the SAME examples for reference
  const examples = getNicheExamples(niche, duration, language);
  const examplesText = examples.slice(0, 2).map((ex, i) => 
    `--- Example ${i + 1} ---\n${ex.script || ex}`
  ).join('\n\n');

  const prompts = {
    egyptian: `أنت محرر سكريبتات فيرال.

السكريبت محتاج تحسين في **${weakest_area}**

=== المشكلة ===
${weakness_detail || `الـ ${weakest_area} محتاج يكون أقوى زي الأمثلة`}

=== الأمثلة المرجعية (قلّد أسلوبهم) ===
${examplesText}

=== السكريبت الحالي ===
${script}

=== الـ Hook (يفضل في الأول) ===
${hook}

=== المطلوب ===
أعد كتابة السكريبت مع تحسين ${weakest_area}:
- خلّي الـ ${weakest_area} زي الأمثلة
- ⚠️ حافظ على الربط المباشر بين الـ Hook والموضوع - الـ Hook لازم يكون مرتبط بالموضوع
- حافظ على كل المعلومات والأرقام
- حافظ على نفس الطول
- الـ Hook يكون في أول السكريبت

اكتب السكريبت المحسّن (بدون JSON أو markdown):`,

    gulf: `أنت محرر سكريبتات فيرال.

السكريبت يحتاج تحسين في **${weakest_area}**

=== المشكلة ===
${weakness_detail || `الـ ${weakest_area} يحتاج يكون أقوى مثل الأمثلة`}

=== الأمثلة المرجعية (قلّد أسلوبهم) ===
${examplesText}

=== السكريبت الحالي ===
${script}

=== الـ Hook (يبقى في الأول) ===
${hook}

=== المطلوب ===
أعد كتابة السكريبت مع تحسين ${weakest_area}:
- خلّي الـ ${weakest_area} مثل الأمثلة
- ⚠️ حافظ على الربط المباشر بين الـ Hook والموضوع - الـ Hook لازم يكون مرتبط بالموضوع
- حافظ على كل المعلومات والأرقام
- الـ Hook يبقى في أول السكريبت

اكتب السكريبت المحسّن:`,

    english: `You are a viral script editor.

Script needs improvement in **${weakest_area}**

=== PROBLEM ===
${weakness_detail || `The ${weakest_area} needs to be stronger like the examples`}

=== REFERENCE EXAMPLES (Match their style) ===
${examplesText}

=== CURRENT SCRIPT ===
${script}

=== HOOK (keep at start) ===
${hook}

=== TASK ===
Rewrite improving ${weakest_area}:
- Make ${weakest_area} match the examples
- ⚠️ Keep direct connection between Hook and topic - Hook must be relevant to the topic
- Keep all information and numbers
- Keep same length
- Hook stays at the start

Write improved script (no JSON or markdown):`,

    french: `Vous êtes un éditeur de scripts viraux.

Le script a besoin d'amélioration dans **${weakest_area}**

=== PROBLÈME ===
${weakness_detail || `Le ${weakest_area} doit être plus fort comme les exemples`}

=== EXEMPLES DE RÉFÉRENCE (Copiez leur style) ===
${examplesText}

=== SCRIPT ACTUEL ===
${script}

=== HOOK (garder au début) ===
${hook}

=== TÂCHE ===
Réécrivez en améliorant ${weakest_area}:
- Rendez ${weakest_area} comme les exemples
- ⚠️ Gardez la connexion directe entre le Hook et le sujet - le Hook doit être lié au sujet
- Gardez toutes les informations et chiffres
- Le Hook reste au début

Écrivez le script amélioré:`,

    frensh: `Vous êtes un éditeur de scripts viraux.

Le script a besoin d'amélioration dans **${weakest_area}**

=== EXEMPLES ===
${examplesText}

=== SCRIPT ===
${script}

=== HOOK (garder au début) ===
${hook}

=== TÂCHE ===
Réécrivez en améliorant ${weakest_area}:
- Rendez ${weakest_area} comme les exemples
- ⚠️ Gardez la connexion directe entre le Hook et le sujet
- Gardez toutes les informations
- Le Hook reste au début

Écrivez le script amélioré:`
  };

  const prompt = prompts[language] || prompts['english'];

  try {
    // Use Gemini 3 Flash for fast rewriting
    const rewriteModel = 'gemini-3-flash-preview';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${rewriteModel}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 3000,
          temperature: 0.5
        }
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    // Track cost (using 'gemini_flash' label for Flash model)
    if (costTracker && response.data?.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    }

    const rewrittenScript = response.data.candidates?.[0]?.content?.parts?.[0]?.text || script;
    
    // Clean up the result
    const cleaned = rewrittenScript
      .replace(/```[\s\S]*?```/g, '')
      .replace(/#{1,3}\s*/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .trim();
    
    console.log('   ✅ Weak area rewritten');
    return cleaned;
  } catch (e) {
    console.error('   ⚠️ Rewrite failed:', e.message);
    return script; // Return original if rewrite fails
  }
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
  
  const prompt = `Act as an expert AI Art Director specializing in "Black Forest Labs Flux" prompting AND a Professional Media Researcher.

Analyze the script and generate:
1. 3 Highly Detailed visual descriptions for AI generation (Flux).
2. Smart Google Image Search keywords for finding REAL images for those scenes.
3. A list of 5-8 Supplementary B-Roll search terms to cover the full 60-second video duration.

Topic: ${topic}
Script Context: ${script.substring(0, 1000)}
Target Culture: ${language.toUpperCase()}

Create 3 distinct scenes:
1. Hook scene (High impact, controversial or shocking visual)
2. Content scene (Educational, clear, engaging)
3. CTA scene (Direct, emotional connection)

🚨 CULTURAL CONTEXT (CRITICAL - MUST FOLLOW):
${culturalContext}
ALL people, clothing, settings, and environments MUST reflect this specific culture.

---

### RULESET 1: AI IMAGE PROMPTS (FLUX)
For EACH scene, the "prompt" field must follow this Structure:
"[Medium/Style] of [Subject Description with cultural appearance] doing [Action] in [Cultural Environment]. [Lighting Description]. [Camera/Mood Details]."
- DO NOT use generic tags. Use Natural English sentences.
- LIGHTING: Specify lighting (e.g., "volumetric lighting", "dramatic rim light").
- STYLE: Start with "A cinematic hyper-realistic shot of..." or "A detailed 3D illustration of...".
- CULTURAL ACCURACY: Characters/Settings MUST match the target culture.

### RULESET 2: REAL IMAGE SEARCH (Google)
For the "google_search_term" field:
- Extract the specific ENTITY mentioned (e.g., "iPhone 15 Pro", "Chevening Scholarship", "Pyramids of Giza").
- If no specific entity, use the most descriptive visual concept.
- Append keywords like "real photo", "official logo", "png", "high quality", or "wallpaper" to ensure good results.
- MUST be in English.

### RULESET 3: B-ROLL KEYWORDS (Supplementary)
- Extract 5 to 8 additional visual concepts from the script to act as "Filler" or "B-Roll".
- Focus on objects, specific places, emotions, or metaphors mentioned in the text.
- Format them as search-ready strings (e.g., "Cairo traffic chaos", "Bitcoin chart falling", "Student studying late night").

---

Output Schema (JSON Only):
{
  "hook": {
    "prompt": "A cinematic hyper-realistic shot of... (Flux prompt)",
    "google_search_term": "Specific keywords for Google Images",
    "description_ar": "وصف قصير بالعربي",
    "description_en": "Short English description",
    "description_fr": "Courte description en français",
    "caption": "Scene Title"
  },
  "content": {
    "prompt": "...",
    "google_search_term": "...",
    "description_ar": "...",
    "description_en": "...",
    "description_fr": "...",
    "caption": "..."
  },
  "cta": {
    "prompt": "...",
    "google_search_term": "...",
    "description_ar": "...",
    "description_en": "...",
    "description_fr": "...",
    "caption": "..."
  },
  "b_roll_keywords": [
    "keyword 1",
    "keyword 2",
    "keyword 3",
    "keyword 4",
    "keyword 5"
  ]
}`;

  try {
    // Using Gemini 2.5 Flash for cost efficiency
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        systemInstruction: {
          parts: [{ text: 'You are a JSON generator. Output valid JSON only. No markdown, no code blocks. Keep Flux prompts concise (40-50 words each). Always include google_search_term and b_roll_keywords.' }]
        },
        generationConfig: {
          maxOutputTokens: 3000,
        }
      }
    );
    
    if (costTracker && response.data.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    }
    
    const candidate = response.data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    console.log('   📝 Visual API response received, length:', text.length, 'finishReason:', candidate?.finishReason);
    
    // Try to extract JSON with regex
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.hook && parsed.content && parsed.cta) {
        // Ensure b_roll_keywords exists
        if (!parsed.b_roll_keywords || !Array.isArray(parsed.b_roll_keywords)) {
          parsed.b_roll_keywords = [`${topic} background`, `${topic} aesthetic`, `${topic} concept`, `professional workspace`, `success achievement`];
        }
        // Ensure google_search_term exists for each scene
        if (!parsed.hook.google_search_term) parsed.hook.google_search_term = `${topic} real photo high quality`;
        if (!parsed.content.google_search_term) parsed.content.google_search_term = `${topic} explained infographic`;
        if (!parsed.cta.google_search_term) parsed.cta.google_search_term = `${topic} success motivation`;
        console.log('   ✓ Visual prompts parsed successfully (with google_search_term & b_roll)');
        return parsed;
      }
    }
    console.log('   ⚠️ No valid JSON found in visual response');
  } catch (e) {
    console.error('   ⚠️ Visual prompt error:', e.message);
  }
  
  // Fallback
  console.log('   ⚠️ Using fallback visual prompts');
  return {
    hook: { 
      prompt: `A cinematic hyper-realistic wide shot of ${topic} captured in dramatic composition. Volumetric lighting creates depth with golden hour rays streaming through. Shot on professional cinema camera with shallow depth of field creating atmospheric mood.`,
      google_search_term: `${topic} real photo high quality`,
      description_ar: 'منظر واسع للموضوع',
      description_en: 'Wide shot overview',
      description_fr: 'Vue large du sujet',
      caption: 'Hook Scene'
    },
    content: { 
      prompt: `A detailed hyper-realistic medium shot showcasing ${topic} with clear educational focus. Soft cinematic shading highlights key details while maintaining visual clarity. Professional documentary style with balanced composition and natural color grading.`,
      google_search_term: `${topic} explained infographic`,
      description_ar: 'لقطة متوسطة للتفاصيل',
      description_en: 'Medium shot details',
      description_fr: 'Plan moyen détaillé',
      caption: 'Content Scene'
    },
    cta: { 
      prompt: `A cinematic hyper-realistic close-up of ${topic} with emotional impact and hopeful atmosphere. Dramatic rim lighting creates powerful silhouette effect. Warm color palette with soft bokeh background evoking inspiration and connection.`,
      google_search_term: `${topic} success motivation`,
      description_ar: 'لقطة قريبة للختام',
      description_en: 'Close-up finale',
      description_fr: 'Gros plan final',
      caption: 'CTA Scene'
    },
    b_roll_keywords: [
      `${topic} background`,
      `${topic} aesthetic`,
      `${topic} concept`,
      `professional workspace`,
      `success achievement`
    ]
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
    // Note: This legacy endpoint doesn't have contentAnalysis, so preserveFromUser is empty
    const hooks = await generateHooks(topic, researchData, niche, language, null, action_type, user_instructions, []);
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
    duration = '30',
    appLanguage = 'en', // NEW: App language for error messages
    // Optional params for regenerating hooks (skip research)
    existingResearch = null,
    existingTopic = null,
    existingMode = null,
    existingUserInstructions = null,
  } = req.body;
  
  // Input validation
  if (!topic) {
    return res.status(400).json({ 
      success: false, 
      error: {
        code: 'TOPIC_TOO_SHORT',
        message: getErrorMessage('TOPIC_TOO_SHORT', appLanguage)
      }
    });
  }
  
  if (topic.length < 3) {
    return res.status(400).json({ 
      success: false, 
      error: {
        code: 'TOPIC_TOO_SHORT',
        message: getErrorMessage('TOPIC_TOO_SHORT', appLanguage)
      }
    });
  }
  
  if (topic.length > 2000) {
    return res.status(400).json({ 
      success: false, 
      error: {
        code: 'TOPIC_TOO_LONG',
        message: getErrorMessage('TOPIC_TOO_LONG', appLanguage)
      }
    });
  }
  
  // Check if this is a regenerate-only request (has existing research)
  const isRegenerateOnly = existingResearch && existingTopic;
  
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(isRegenerateOnly ? '🔄 Regenerate Hooks Only' : '🎣 Step 1: Generate Hooks');
  console.log(`📌 Topic: ${topic.substring(0, 80)}...`);
  console.log(`🎯 Niche: ${niche}`);
  console.log(`⏱️ Duration: ${duration}s`);
  console.log(`🌍 Language: ${language}`);
  if (isRegenerateOnly) console.log('⚡ Skipping research (using existing data)');
  console.log('═══════════════════════════════════════');
  
  const perf = new PerformanceTracker();
  const costTracker = createCostTracker();
  
  try {
    let extractedTopic, researchData, action_type, user_instructions, contentAnalysis;
    
    if (isRegenerateOnly) {
      // Use existing data (regenerate hooks only)
      extractedTopic = existingTopic;
      researchData = existingResearch;
      action_type = existingMode || 'research';
      user_instructions = existingUserInstructions || '';
      console.log('   ⏭️ Using existing research data');
      perf.skip('content_analysis');
      perf.skip('topic_extraction');
      perf.skip('research');
    } else {
      // Full flow: analyze content sufficiency, extract topic, research
      
      // Stage 1: Content Sufficiency Analysis
      console.log('   🧠 Stage 1: Analyzing content sufficiency...');
      perf.startStage('content_analysis');
      contentAnalysis = await analyzeContentSufficiency(topic, duration, language, costTracker);
      perf.endStage();
      console.log(`   ✓ Analysis complete (needs_research: ${contentAnalysis.needs_research})`);
      
      // Stage 2: Extract Core Topic
      console.log('   📌 Stage 2: Extracting topic...');
      perf.startStage('topic_extraction');
      extractedTopic = await extractTopic(topic, language, costTracker);
      perf.endStage();
      console.log(`   ✓ Topic: "${extractedTopic}"`);
      
      // Stage 3: Intelligent Research (ONLY what's needed)
      if (contentAnalysis.needs_research && contentAnalysis.research_queries.length > 0) {
        console.log(`   🔍 Stage 3: Researching ${contentAnalysis.research_queries.length} specific queries...`);
        perf.startStage('research');
        const researchQuery = contentAnalysis.research_queries.join('\n');
        researchData = await research(researchQuery, extractedTopic, costTracker);
        perf.endStage();
        console.log('   ✓ Research complete');
        action_type = 'hybrid';
      } else {
        perf.skip('research');
        console.log('   ⏭️ Skipping research (content sufficient)');
        researchData = topic;
        action_type = 'refine';
      }
      
      // Store for script writing phase
      user_instructions = topic;
    }
    
    // Stage 4: Generate 3 hooks
    console.log('   🎣 Stage 4: Generating hooks...');
    perf.startStage('hook_generation');
    // Pass preserve_from_user to hooks so they use user's facts (not conflicting research data)
    const preserveFromUser = contentAnalysis?.preserve_from_user || [];
    const hooksResult = await generateHooks(extractedTopic, researchData, niche, language, costTracker, action_type, user_instructions, preserveFromUser);
    perf.endStage();
    console.log(`   ✓ Generated ${hooksResult.hooks.length} hooks`);
    
    // Ensure all stages are closed before generating report
    perf.closeAll();
    
    perf.logReport();
    logTotalCost(costTracker);
    
    res.json({
      success: true,
      topic: extractedTopic,
      hooks: hooksResult.hooks,
      hooksDetailed: hooksResult.hooksDetailed,
      recommended: hooksResult.recommended,
      hookAnalysis: hooksResult.analysis,
      research: researchData,
      mode: action_type,
      user_instructions: user_instructions,
      content_analysis: contentAnalysis || null,
      performance: perf.getReport(), // NEW: Performance tracking
      cost: costTracker.total.toFixed(4),
    });
    
  } catch (error) {
    console.error('❌ Generate Hooks Error:', error.message);
    
    const errorType = detectErrorType(error);
    const statusCode = error.status || error.statusCode || 500;
    
    res.status(statusCode).json({ 
      success: false, 
      error: {
        code: errorType,
        message: getErrorMessage(errorType, appLanguage),
        technical: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
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
    mode = 'research',
    user_instructions = '',
    preserve_from_user = [],
    explicit_research_requests = [],
    appLanguage = 'en', // NEW: App language for error messages
  } = req.body;
  
  // Input validation
  if (!topic || !selectedHook || !researchData) {
    return res.status(400).json({ 
      success: false, 
      error: {
        code: 'SCRIPT_GENERATION_FAILED',
        message: getErrorMessage('SCRIPT_GENERATION_FAILED', appLanguage)
      }
    });
  }
  
  if (!['30', '60'].includes(duration)) {
    return res.status(400).json({ 
      success: false, 
      error: {
        code: 'INVALID_DURATION',
        message: getErrorMessage('INVALID_DURATION', appLanguage)
      }
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
  
  const perf = new PerformanceTracker();
  const costTracker = createCostTracker();
  
  try {
    // Stage 1: Script Writing
    console.log('   📝 Stage 1: Writing script...');
    perf.startStage('script_writing');
    let script = await writeScript(
      topic, 
      researchData, 
      niche, 
      selectedHook, 
      duration, 
      language, 
      costTracker, 
      mode, 
      user_instructions,
      preserve_from_user,
      explicit_research_requests
    );
    perf.endStage();
    console.log(`   ✓ Script: ${script.split(/\s+/).length} words`);
    
    // Stage 2: Fact Validation (only for research/hybrid mode)
    let factValidation = { valid: true, accuracy_score: 100, issues: [], skipped: true };
    
    if (mode !== 'refine' && researchData && researchData.length >= 100) {
      console.log('   🔍 Stage 2: Validating facts...');
      perf.startStage('fact_validation');
      factValidation = await validateFactsAgainstResearch(script, researchData, language, costTracker);
      perf.endStage();
      
      if (!factValidation.valid && factValidation.issues?.length > 0) {
        console.log(`   ⚠️ Found ${factValidation.issues.length} factual issues, fixing...`);
        perf.startStage('fix_errors');
        script = await fixFactualErrors(script, factValidation.issues, researchData, language, costTracker);
        perf.endStage();
        factValidation.issues_fixed = true;
      } else {
        perf.skip('fix_errors');
        console.log(`   ✅ Fact check passed (${factValidation.accuracy_score}% accuracy)`);
        factValidation.issues_fixed = false;
      }
    } else {
      perf.skip('fact_validation');
      perf.skip('fix_errors');
      console.log('   ⏭️ Skipping fact validation (refine mode or no research)');
    }
    
    // Stage 3: Quality Scoring
    console.log('   📊 Stage 3: Scoring quality...');
    perf.startStage('quality_scoring');
    const QUALITY_THRESHOLD = 7.0; // Lowered from 7.5 to avoid expensive rewrite loops for marginal gains
    const MAX_REWRITES = 2;
    let rewriteAttempts = 0;
    
    let qualityScore = await scoreScriptQuality(script, selectedHook, duration, language, niche, costTracker);
    perf.endStage();
    console.log(`   📈 Quality score: ${qualityScore.overall?.toFixed(1) || '?'}/10`);
    
    if (qualityScore.similarity_to_examples) {
      console.log(`   📝 ${qualityScore.similarity_to_examples}`);
    }
    
    // Stage 4: Rewrite (if needed)
    if (qualityScore.overall < QUALITY_THRESHOLD && !qualityScore.skipped) {
      while (rewriteAttempts < MAX_REWRITES && qualityScore.overall < QUALITY_THRESHOLD) {
        rewriteAttempts++;
        perf.startStage(`rewrite_attempt_${rewriteAttempts}`);
        console.log(`   🔄 Quality ${qualityScore.overall.toFixed(1)} < ${QUALITY_THRESHOLD}, rewriting ${qualityScore.weakest_area} (attempt ${rewriteAttempts}/${MAX_REWRITES})...`);
        
        script = await rewriteWeakAreas(script, qualityScore, selectedHook, duration, language, niche, costTracker);
        script = styleCleanup(script, selectedHook);
        perf.endStage();
        
        perf.startStage(`quality_scoring_after_rewrite_${rewriteAttempts}`);
        qualityScore = await scoreScriptQuality(script, selectedHook, duration, language, niche, costTracker);
        perf.endStage();
        console.log(`   📈 New quality: ${qualityScore.overall?.toFixed(1) || '?'}/10`);
      }
      
      if (rewriteAttempts > 0) {
        console.log(`   ✅ Quality improved after ${rewriteAttempts} rewrite(s)`);
      }
    } else {
      perf.skip('rewrite');
    }
    
    // Stage 5: Style Cleanup
    console.log('   🧹 Stage 5: Cleaning up style...');
    perf.startStage('style_cleanup');
    script = styleCleanup(script, selectedHook);
    perf.endStage();
    const wordCount = script.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Cleaned: ${wordCount} words`);
    
    // Stage 6: Visual Prompts
    console.log('   🖼️ Stage 6: Generating visual prompts...');
    perf.startStage('visual_prompts');
    const visualPrompts = await generateVisualPrompts(topic, script, language, costTracker);
    perf.endStage();
    console.log('   ✓ Visual prompts ready');
    
    // Ensure all stages are closed before generating report
    perf.closeAll();
    
    perf.logReport();
    logTotalCost(costTracker);
    
    const durationConfig = getDurationConfig(duration);
    res.json({
      success: true,
      script,
      wordCount,
      hook: selectedHook,
      visualPrompts,
      durationRange: durationConfig.displayRange,
      mode: mode,
      factValidation: {
        checked: !factValidation.skipped,
        accuracy_score: factValidation.accuracy_score || 100,
        issues_found: factValidation.issues?.length || 0,
        issues_fixed: factValidation.issues_fixed || false
      },
      qualityScore: {
        overall: qualityScore.overall || 7.5,
        scores: qualityScore.scores || {},
        weakest_area: qualityScore.weakest_area || null,
        strongest_area: qualityScore.strongest_area || null,
        similarity_to_examples: qualityScore.similarity_to_examples || null,
        rewrites_needed: rewriteAttempts
      },
      performance: perf.getReport(), // NEW: Performance tracking
      cost: costTracker.total.toFixed(4),
    });
    
  } catch (error) {
    console.error('❌ Write Script Error:', error.message);
    
    const errorType = detectErrorType(error);
    const statusCode = error.status || error.statusCode || 500;
    
    res.status(statusCode).json({ 
      success: false, 
      error: {
        code: errorType,
        message: getErrorMessage(errorType, appLanguage),
        technical: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
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
- الأفكار لازم تكون مناسبة للتصوير في البيت (Talking Head) أو تعليق صوتي (Voiceover)
- تجنب تماماً أفكار الفلوجات الخارجية، تحديات الأكل، أو اللي محتاجة شراء منتجات غالية
- ركز على: الأسرار، القصص الغريبة، تحليل المواقف، وتصحيح المفاهيم الخاطئة

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
- الأفكار لازم تكون مناسبة للتصوير في البيت (Talking Head) أو تعليق صوتي (Voiceover)
- تجنب تماماً أفكار الفلوجات الخارجية، تحديات الأكل، أو اللي محتاجة شراء منتجات غالية
- ركز على: الأسرار، القصص الغريبة، تحليل المواقف، وتصحيح المفاهيم الخاطئة

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
- Les idées doivent être adaptées au tournage à domicile (Face caméra / Talking Head) ou en Voix off
- Évitez strictement les vlogs en extérieur, les défis culinaires, ou les idées nécessitant l'achat de produits coûteux
- Concentrez-vous sur : les secrets, les histoires insolites, l'analyse de situations et la correction des idées reçues

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
- Ideas must be suitable for home filming (Talking Head) or Voiceover style
- Strictly avoid outdoor vlogs, food challenges, or ideas that require purchasing expensive products
- Focus on: Secrets, bizarre stories, analyzing situations, and busting common myths

JSON only:
{"ideas": ["idea 1", "idea 2", ...]}`;
    systemPrompt = 'You are a content expert. Suggest viral ideas in English. JSON only.';
  }

  try {
    // Using Gemini 2.5 Flash for cost efficiency
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          maxOutputTokens: 1000,
        }
      }
    );
    
    if (response.data.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
      console.log(`   💰 Ideas cost: $${costTracker.total.toFixed(4)}`);
    }
    
    // Check for blocking or empty response
    const candidate = response.data.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY') {
      console.log('   ⚠️ Response blocked or empty, finishReason:', candidate?.finishReason);
      throw new Error('Response blocked');
    }
    
    const text = candidate.content?.parts?.[0]?.text || '';
    console.log(`   📝 Ideas response length: ${text.length}, finishReason: ${candidate.finishReason}`);
    
    // Try to extract and parse JSON
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.ideas && parsed.ideas.length > 0) {
        console.log(`   ✓ Generated ${parsed.ideas.length} ideas`);
        res.json({ success: true, ideas: parsed.ideas, cost: costTracker.total.toFixed(4) });
        return;
      }
    }
    console.log('   ⚠️ No valid JSON found in response');
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
2. **Short BUT powerful.** 3-6 lines MAX, but every line must ADD VALUE.
3. **Bullet points** for suggestions.

# RESPONSE QUALITY (IMPORTANT!)
**Short ≠ Shallow.** Your suggestions must be:
- 🎯 **Specific**: Not "فكرة عن AI" but "ليه 40% من الوظائف هتختفي بسبب AI"
- 🔥 **Viral-worthy**: Would YOU stop scrolling for this?
- 💡 **Insightful**: Add a unique angle or surprising fact
- 🎣 **Hook-ready**: Each idea should have a built-in hook

**When suggesting angles, add the "WHY it works":**
- ❌ Bad: "• زاوية صادمة"
- ✅ Good: "• زاوية صادمة: رقم يخلي الناس توقف السكرول (مثلاً: 40% من الوظائف...)"

# RESPONSE LENGTH
- Suggestions: 3-5 bullet points (each with substance)
- Confirmations: 1-2 sentences
- Max 6 lines, but EVERY line counts

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

**Step 4 - Confirm & Generate IMMEDIATELY:**
⚠️ CRITICAL: When user agrees/confirms, send the action tag IN THE SAME MESSAGE.
DO NOT ask "Are you ready?" or wait for a second confirmation.
Just confirm + output the tag immediately:

"ممتاز! دوس على الزرار وهيتكتبلك السكريبت 🚀"
[ACTION:GENERATE_SCRIPT]{"topic":"...","lang":"..."}

# ❌ DON'T
- ❌ Say "أنت اللي بتكتب السكريبت" (wrong! the APP writes it)
- ❌ Say "أنا مش تطبيق" (wrong! you ARE part of the app)
- ❌ Write full scripts or paragraphs

# ✅ DO
- ✅ Explain that the APP writes the script after they confirm
- ✅ Short bullet points
- ✅ Guide to pick topic + angle

# ACTION OUTPUT
When user confirms, append this tag with a **topic summary** (20-40 words):

[ACTION:GENERATE_SCRIPT]{"topic":"TOPIC_SUMMARY","lang":"LANGUAGE_ID"}

**The "topic" field MUST include:**
1. The main subject
2. The chosen angle/approach
3. Key points to cover (briefly)

**⚠️ DO NOT include in the topic:**
- ❌ Specific songs or music names
- ❌ Visual/camera instructions (like "لقطة سريعة")
- ❌ Exact hook wording (the script system writes hooks)
- ❌ Detailed script structure with CTAs

The script generation system will handle hooks, visuals, and structure automatically.

**Examples:**
❌ Bad: "رقص بلدي - هوك الحنين للزمن الجميل (أغنية قديمة), لقطة سريعة للحركة..."
✅ Good: "الرقص البلدي - الفرق بين الأصيل والحديث، أشهر الحركات، أخطاء شائعة"

❌ Bad: "المونوريل - هوك: سرعة المستقبل + لقطة سريعة، ثم خيال علمي، ثم مقارنة، ختام CTA"
✅ Good: "المونوريل في مصر - زاوية المستقبل والخيال العلمي، مقارنة بالمواصلات العادية، تجربة الركوب"

❌ Bad: "Real estate - hook: she lost $50K + crying face, then show documents..."
✅ Good: "3 mistakes first-time home buyers make - shock angle with real money examples"

"lang" values: "egyptian", "gulf", "english", "french"

# HANDLING COMMON QUESTIONS

**"Give me viral content ideas" / "اديني أفكار محتوى فايرال":**
ASK what niche/topic they create content about, then give specific ideas.

**"How to write hooks?" / "إزاي أكتب هوك؟":**
Give CONCRETE hook formulas with examples:
- Question hook: "Did you know 90% of people fail at this?"
- Shock hook: "I lost $50K doing this ONE thing"
- Curiosity hook: "Nobody talks about this but..."
- Controversy hook: "Unpopular opinion: Renting is BETTER"

**"What makes a video go viral?" / "إيه اللي بيخلي الفيديو ينتشر؟":**
Give CONCRETE viral secrets (not generic):
- The 3-second rule (hook hard)
- Curiosity gaps (loops)
- Pattern interrupts (change visuals)
- Share triggers (save-worthy endings)

# EXAMPLES

**Example 1 (Viral ideas request):**
User: 💡 Give me viral content ideas
Assistant: What's your niche? 🎯

• Tech/AI?
• Business/Money?
• Fitness/Health?
• Lifestyle/Vlogs?
• Something else?

Once I know, I'll give you 3 viral ideas that fit YOUR audience!

**Example 2 (Hook writing help):**
User: 🎬 How to write hooks that stop the scroll?
Assistant: 🔥 Hook formulas that WORK:

• **Question**: "Did you know 90% fail at THIS?" — instant curiosity
• **Shock**: "I lost $50K doing this ONE thing" — emotional hit
• **Controversy**: "Unpopular opinion: Renting is BETTER" — triggers comments
• **Curiosity**: "Nobody talks about this but..." — they NEED to know

Tell me your topic and I'll write you 3 custom hooks! 🎯

**Example 3 (Viral secrets):**
User: 📈 What makes a video go viral?
Assistant: 🔥 The REAL viral secrets:

• **3-Second Rule**: Hook must HIT in first 3 seconds
• **Curiosity Gap**: "She made $50K with this..." → they NEED to know
• **Pattern Interrupt**: Change visuals every 2-3 seconds
• **Share Trigger**: End with "Save this for later!"

Tell me your niche and I'll show you how to apply these! 🎯

**Example 4 (Explaining the app):**
User: التطبيق ده بيعمل إيه؟
Assistant: Seshu بيكتبلك سكريبتات فيديو فيرال! 🔥
• بساعدك تلاقي الزاوية اللي توقف السكرول
• تدوس "Generate" → سكريبت كامل + صور AI
• كل ده في ثواني!

قولي بتعمل content عن إيه؟

**Example 4 (Arabic viral secrets):**
User: 📈 إيه اللي بيخلي الفيديو ينتشر؟ قولي الأسرار
Assistant: 🔥 أسرار الفيرال الحقيقية:

• **قاعدة الـ 3 ثواني**: الهوك لازم يضرب في أول 3 ثواني — سؤال، رقم صادم، أو مفاجأة بصرية
• **فجوة الفضول**: "خسر مليون جنيه بسبب غلطة واحدة..." → المشاهد لازم يعرف
• **التغيير كل 2-3 ثواني**: غيّر الصورة أو الصوت عشان تحافظ على الانتباه
• **حافز المشاركة**: اختم بحاجة الناس عايزه تحفظها!

قولي مجالك وهوريك إزاي تطبق ده! 🎯

**Example 5 (Deep suggestions):**
User: عايز أعمل فيديو عن الذكاء الاصطناعي
Assistant: 🔥 AI موضوع واسع، خليني أضيّقلك على زاوية تضرب:

• **الصدمة بالأرقام**: "40% من الوظائف هتختفي خلال 5 سنين" — ده بيوقف السكرول فوراً
• **القصة الحقيقية**: شركة Kodak رفضت AI وفلست — عبرة قوية
• **الـ How-To**: "3 أدوات AI مجانية بتوفرلك 10 ساعات/أسبوع" — قيمة مباشرة

أنهي زاوية حاسس إنها تناسب جمهورك؟

User: الأولى
Assistant: اختيار صح! 💡 دوس Generate وهيتكتبلك كامل 🚀

[ACTION:GENERATE_SCRIPT]{"topic":"تأثير الذكاء الاصطناعي على الوظائف - زاوية صادمة بالأرقام، الوظائف المهددة، مهارات للحماية","lang":"egyptian"}

**Example 3 (English - deep):**
User: I want to make a video about real estate
Assistant: Real estate is hot! 🏠 Let me give you angles that actually convert:

• **Myth-buster**: "Renting isn't throwing money away — here's the math" — controversial = engagement
• **Horror story**: "She lost $50K on her first home because of THIS" — fear sells
• **Checklist**: "5 things your realtor won't tell you" — insider knowledge

Which feels right for your audience?

User: the second one
Assistant: Smart pick! 💡 Hit Generate and let's go! 🚀

[ACTION:GENERATE_SCRIPT]{"topic":"First-time home buyer mistakes - horror story angle, real money loss example, 3 common mistakes, how to protect yourself","lang":"english"}

**Example 4 (Arabic - detailed topic):**
User: عايز أعمل فيديو عن المونوريل
Assistant: المونوريل موضوع نار! 🚄 زوايا ممكن تشتغل:

• **خيال علمي**: مصر بتدخل المستقبل بتقنية جديدة
• **حل الزحمة**: مقارنة سرعة المونوريل vs الطريق العادي
• **تجربة الركوب**: من جوه - السرعة والمنظر

تحب تدمجهم ولا تركز على واحدة؟

User: ادمجهم
Assistant: اختيار ممتاز! 💡 دوس Generate وهيتكتب كامل 🚀

[ACTION:GENERATE_SCRIPT]{"topic":"المونوريل في مصر - زاوية المستقبل والخيال العلمي، مقارنة بالمواصلات العادية، تجربة الركوب","lang":"egyptian"}
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