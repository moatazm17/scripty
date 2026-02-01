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
// 🌍 REGION & CONTEXT HELPERS
// ============================================

const getRegion = (language) => ({
  'egyptian': 'مصر',
  'gulf': 'الخليج العربي (السعودية، الإمارات، الكويت، قطر، البحرين، عمان)',
  'french': 'فرنسا أو المغرب العربي',
  'frensh': 'فرنسا أو المغرب العربي',
  'english': 'the relevant region based on context'
})[language] || 'المنطقة العربية';

const getRegionShort = (language) => ({
  'egyptian': 'مصر',
  'gulf': 'الخليج',
  'french': 'فرنسا/المغرب العربي',
  'frensh': 'فرنسا/المغرب العربي',
  'english': 'the region'
})[language] || 'المنطقة';

const getResearchSystemPrompt = (language, intent) => {
  const region = getRegionShort(language);
  const isArabic = ['egyptian', 'gulf'].includes(language);
  const isFrench = ['french', 'frensh'].includes(language);
  
  if (isArabic) {
    return `أنت باحث متخصص في المحتوى المحلي.

القواعد الأساسية:
- ركز على المعلومات المحلية في ${region}، وليس العالمية
- لا تخلط بين الأسماء المتشابهة (مثلاً: "workspace" المحلي ≠ "WeWork" العالمية)
- إذا كان الموضوع عن مكان/محل/خدمة محلية، لا تذكر علامات تجارية عالمية
- إذا لم تجد معلومات موثوقة، قل "لا تتوفر معلومات كافية" بدلاً من الاختراع
- أعطِ أولوية للمصادر المحلية والرسمية
- أرقام دقيقة وتواريخ محددة فقط`;
  } else if (isFrench) {
    return `Tu es un chercheur spécialisé en contenu local.

Règles fondamentales:
- Concentre-toi sur les informations locales en ${region}, pas mondiales
- Ne confonds pas les noms similaires (ex: "workspace" local ≠ "WeWork" mondiale)
- Si le sujet est un lieu/magasin/service local, ne mentionne pas de marques mondiales
- Si tu ne trouves pas d'informations fiables, dis "informations insuffisantes" au lieu d'inventer
- Priorité aux sources locales et officielles
- Chiffres précis et dates spécifiques uniquement`;
  } else {
    return `You are a research specialist focused on local content.

Core rules:
- Focus on local information relevant to ${region}, not global
- Don't confuse similar names (e.g., local "workspace" ≠ global "WeWork")
- If the topic is about a local place/shop/service, don't mention global brands
- If you can't find reliable information, say "insufficient information" instead of making things up
- Prioritize local and official sources
- Precise numbers and specific dates only`;
  }
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
  gemini_chat: { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },      // Gemini 2.5 Flash Lite (chat)
  gemini_flash_lite: { input: 0.075 / 1_000_000, output: 0.30 / 1_000_000 },// Gemini 2.5 Flash Lite (understanding)
  gemini_flash: { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },      // Gemini 2.0 Flash (visuals)
  flux: { perImage: 0.003 },                                                 // Flux Schnell $3/1000 images
};

function createCostTracker() {
  return {
    claude: { input: 0, output: 0, cost: 0 },
    perplexity: { input: 0, output: 0, cost: 0 },
    gemini: { input: 0, output: 0, cost: 0 },
    gemini_chat: { input: 0, output: 0, cost: 0 },
    gemini_flash_lite: { input: 0, output: 0, cost: 0 },
    gemini_flash: { input: 0, output: 0, cost: 0 },
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
    console.log(`   Claude:      ${tracker.claude.input} in + ${tracker.claude.output} out = $${tracker.claude.cost.toFixed(4)}`);
  }
  if (tracker.perplexity.cost > 0) {
    console.log(`   Perplexity:  ${tracker.perplexity.input} in + ${tracker.perplexity.output} out = $${tracker.perplexity.cost.toFixed(4)}`);
  }
  if (tracker.gemini.cost > 0) {
    console.log(`   Gemini Pro:  ${tracker.gemini.input} in + ${tracker.gemini.output} out = $${tracker.gemini.cost.toFixed(4)}`);
  }
  if (tracker.gemini_chat && tracker.gemini_chat.cost > 0) {
    console.log(`   Gemini Chat: ${tracker.gemini_chat.input} in + ${tracker.gemini_chat.output} out = $${tracker.gemini_chat.cost.toFixed(4)}`);
  }
  if (tracker.gemini_flash_lite && tracker.gemini_flash_lite.cost > 0) {
    console.log(`   Flash Lite:  ${tracker.gemini_flash_lite.input} in + ${tracker.gemini_flash_lite.output} out = $${tracker.gemini_flash_lite.cost.toFixed(4)}`);
  }
  if (tracker.gemini_flash && tracker.gemini_flash.cost > 0) {
    console.log(`   Flash:       ${tracker.gemini_flash.input} in + ${tracker.gemini_flash.output} out = $${tracker.gemini_flash.cost.toFixed(4)}`);
  }
  if (tracker.flux.images > 0) {
    console.log(`   Flux:        ${tracker.flux.images} images = $${tracker.flux.cost.toFixed(4)}`);
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
  
  // Simple word count threshold logic:
  // - Less than 60 words → RESEARCH (external search needed to fill content)
  // - 60+ words → REFINE (user provided enough content, skip search)
  if (wordCount >= 60) {
    console.log(`   🎯 Mode: REFINE (${wordCount} words >= 60)`);
    return 'refine';
  }
  
  console.log(`   🎯 Mode: RESEARCH (${wordCount} words < 60)`);
  return 'research';
}

// ============================================
// 🧠 STAGE 0B: TOPIC EXTRACTION (Simple - Just Topic & Angle)
// ============================================

async function extractTopic(rawInput, language = 'egyptian', costTracker = null) {
  console.log('   🧠 Understanding topic...');
  
  // Language-specific prompts for topic extraction + user facts + intent
  const langPrompts = {
    egyptian: {
      system: 'أنت محلل مواضيع خبير. شغلتك تفهم نية اليوزر وتستخرج كل حاجة مهمة.',
      prompt: `أنت لازم تفهم كل حاجة اليوزر قالها وتحفظها + تحدد نيته.

اليوزر كاتب:
"${rawInput}"

استخرج:
1. topic: الموضوع الأساسي (جملة واحدة)
2. angle: وجهة نظر اليوزر أو الـ angle
3. intent: نوع المحتوى اللي اليوزر عايزه (اختار واحد بس):
   - "local_business": لو بيتكلم عن محل/مكان/خدمة محلية (كافيه، مطعم، محل ملابس، workspace، صالون، gym)
   - "concept": لو عايز يشرح مفهوم أو فكرة (نصائح، tips، معلومات عامة)
   - "news": لو عايز يغطي خبر أو حدث أو مبادرة حكومية
   - "global_local": لو موضوع عالمي بزاوية محلية (الذكاء الاصطناعي في مصر)
   - "general": لو مش واضح أو موضوع عام
4. isLocalBusiness: true لو الموضوع عن مكان/محل/خدمة محلية، false لو لأ
5. userFacts: كل حاجة اليوزر قالها (آراء، أسباب، أرقام، claims)

أمثلة:
- "workspace" → intent: "local_business", isLocalBusiness: true (غالباً كافيه coworking محلي)
- "محل ملابس" → intent: "local_business", isLocalBusiness: true
- "ليه القهوة مفيدة" → intent: "concept", isLocalBusiness: false
- "مبادرة أشبال مصر الرقمية" → intent: "news", isLocalBusiness: false
- "الذكاء الاصطناعي" → intent: "global_local", isLocalBusiness: false

⚠️ مهم: 
- لو اليوزر كتب اسم مكان أو محل (حتى لو كلمة واحدة) = isLocalBusiness: true
- لو مش متأكد إذا كان business أو لأ، اختار true (better safe)

JSON فقط:
{"topic": "...", "angle": "...", "intent": "...", "isLocalBusiness": true/false, "userFacts": ["..."]}`
    },
    gulf: {
      system: 'أنت محلل مواضيع خبير. شغلتك تفهم نية اليوزر وتستخرج كل شي مهم.',
      prompt: `أنت لازم تفهم كل شي اليوزر قاله وتحفظه + تحدد نيته.

اليوزر كاتب:
"${rawInput}"

استخرج:
1. topic: الموضوع الأساسي (جملة واحدة)
2. angle: وجهة نظر اليوزر أو الـ angle
3. intent: نوع المحتوى اللي اليوزر يبيه (اختار واحد بس):
   - "local_business": لو يتكلم عن محل/مكان/خدمة محلية (كافيه، مطعم، محل ملابس، workspace، صالون، gym)
   - "concept": لو يبي يشرح مفهوم أو فكرة (نصائح، tips، معلومات عامة)
   - "news": لو يبي يغطي خبر أو حدث أو مبادرة حكومية
   - "global_local": لو موضوع عالمي بزاوية محلية
   - "general": لو مو واضح أو موضوع عام
4. isLocalBusiness: true لو الموضوع عن مكان/محل/خدمة محلية، false لو لا
5. userFacts: كل شي اليوزر قاله (آراء، أسباب، أرقام، claims)

أمثلة:
- "workspace" → intent: "local_business", isLocalBusiness: true
- "محل ملابس" → intent: "local_business", isLocalBusiness: true
- "ليش القهوة مفيدة" → intent: "concept", isLocalBusiness: false

⚠️ مهم: لو اليوزر كتب اسم مكان أو محل = isLocalBusiness: true

JSON فقط:
{"topic": "...", "angle": "...", "intent": "...", "isLocalBusiness": true/false, "userFacts": ["..."]}`
    },
    french: {
      system: 'Tu es un analyste expert. Ton travail est de comprendre l\'intention de l\'utilisateur.',
      prompt: `Tu dois comprendre tout ce que l'utilisateur a écrit + identifier son intention.

L'utilisateur a écrit:
"${rawInput}"

Extrais:
1. topic: Le sujet principal (une phrase)
2. angle: Le point de vue de l'utilisateur
3. intent: Type de contenu souhaité (choisis un seul):
   - "local_business": s'il parle d'un lieu/magasin/service local (café, restaurant, boutique, workspace, salon, gym)
   - "concept": s'il veut expliquer un concept ou une idée (conseils, tips, informations générales)
   - "news": s'il veut couvrir une actualité ou un événement
   - "global_local": sujet mondial avec angle local
   - "general": si pas clair ou sujet général
4. isLocalBusiness: true si le sujet est un lieu/magasin/service local, false sinon
5. userFacts: Tout ce que l'utilisateur a dit (opinions, raisons, chiffres, arguments)

Exemples:
- "workspace" → intent: "local_business", isLocalBusiness: true
- "boutique de vêtements" → intent: "local_business", isLocalBusiness: true
- "pourquoi le café est bon" → intent: "concept", isLocalBusiness: false

⚠️ Important: Si l'utilisateur écrit un nom de lieu ou magasin = isLocalBusiness: true

JSON uniquement:
{"topic": "...", "angle": "...", "intent": "...", "isLocalBusiness": true/false, "userFacts": ["..."]}`
    },
    frensh: {
      system: 'Tu es un analyste expert. Ton travail est de comprendre l\'intention de l\'utilisateur.',
      prompt: `Tu dois comprendre tout ce que l'utilisateur a écrit + identifier son intention.

L'utilisateur a écrit:
"${rawInput}"

Extrais:
1. topic: Le sujet principal (une phrase)
2. angle: Le point de vue de l'utilisateur
3. intent: Type de contenu souhaité (choisis un seul):
   - "local_business": s'il parle d'un lieu/magasin/service local
   - "concept": s'il veut expliquer un concept ou une idée
   - "news": s'il veut couvrir une actualité
   - "global_local": sujet mondial avec angle local
   - "general": si pas clair
4. isLocalBusiness: true si lieu/magasin/service local, false sinon
5. userFacts: Tout ce que l'utilisateur a dit

⚠️ Important: Si l'utilisateur écrit un nom de lieu = isLocalBusiness: true

JSON uniquement:
{"topic": "...", "angle": "...", "intent": "...", "isLocalBusiness": true/false, "userFacts": ["..."]}`
    },
    english: {
      system: 'You are an expert topic analyst. Your job is to understand user intent and extract key information.',
      prompt: `You must understand everything the user wrote + identify their intent.

The user wrote:
"${rawInput}"

Extract:
1. topic: The main topic (one sentence)
2. angle: The user's perspective or angle
3. intent: Type of content the user wants (pick one):
   - "local_business": if talking about a local place/shop/service (cafe, restaurant, clothing store, workspace, salon, gym)
   - "concept": if they want to explain a concept or idea (tips, general information)
   - "news": if they want to cover news or an event
   - "global_local": global topic with local angle
   - "general": if unclear or general topic
4. isLocalBusiness: true if the topic is a local place/shop/service, false otherwise
5. userFacts: Everything the user said (opinions, reasons, numbers, claims)

Examples:
- "workspace" → intent: "local_business", isLocalBusiness: true (likely a local coworking cafe)
- "clothing store" → intent: "local_business", isLocalBusiness: true
- "why coffee is good" → intent: "concept", isLocalBusiness: false
- "AI trends" → intent: "global_local", isLocalBusiness: false

⚠️ Important: 
- If user wrote a place or business name (even one word) = isLocalBusiness: true
- When in doubt, choose true (better safe)

JSON only:
{"topic": "...", "angle": "...", "intent": "...", "isLocalBusiness": true/false, "userFacts": ["..."]}`
    }
  };
  
  const langConfig = langPrompts[language] || langPrompts['egyptian'];
  
  // Use Gemini Flash Lite for cost efficiency (simple extraction task)
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [{ text: `${langConfig.system}\n\n${langConfig.prompt}` }]
      }],
      generationConfig: {
        maxOutputTokens: 300,
        temperature: 0.3,
      }
    }
  );
  
  // Track cost (Gemini Flash Lite pricing)
  if (costTracker && response.data.usageMetadata) {
    trackCost(costTracker, 'gemini_flash_lite', response.data.usageMetadata.promptTokenCount || 0, response.data.usageMetadata.candidatesTokenCount || 0);
  }
  
  try {
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`   📄 Gemini raw response: ${text.substring(0, 300)}`);
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const topicStr = `${parsed.topic} - ${parsed.angle}`;
      const userFacts = Array.isArray(parsed.userFacts) ? parsed.userFacts.filter(f => f && f.trim()) : [];
      const intent = parsed.intent || 'general';
      const isLocalBusiness = parsed.isLocalBusiness === true;
      
      console.log(`   🧠 Understood: "${topicStr}"`);
      console.log(`   🎯 Intent: ${intent} | isLocalBusiness: ${isLocalBusiness}`);
      console.log(`   📌 EXTRACTED USER FACTS (${userFacts.length}):`);
      if (userFacts.length > 0) {
        userFacts.forEach((fact, i) => console.log(`      ${i + 1}. ${fact}`));
      } else {
        console.log(`      ❌ No facts extracted from input`);
      }
      return { topic: topicStr, userFacts, intent, isLocalBusiness };
    } else {
      console.log(`   ⚠️ No JSON found in response`);
    }
  } catch (e) {
    console.log('   ⚠️ Parse error, using raw input:', e.message);
  }
  
  return { topic: rawInput, userFacts: [], intent: 'general', isLocalBusiness: false };
}

// ============================================
// 🔍 STAGE 1: RESEARCH (Intent-Aware + Context-Based)
// ============================================

async function research(rawInput, extractedTopic, { intent = 'general', isLocalBusiness = false, language = 'egyptian' } = {}, costTracker = null, retries = 3) {
  console.log('   📚 Researching...');
  console.log(`   🎯 Research mode: intent=${intent}, isLocalBusiness=${isLocalBusiness}, lang=${language}`);
  
  const region = getRegion(language);
  const regionShort = getRegionShort(language);
  const isArabic = ['egyptian', 'gulf'].includes(language);
  const isFrench = ['french', 'frensh'].includes(language);
  
  // Check if user provided specific angles/points
  const hasUserAngles = rawInput.length > extractedTopic.length + 20;
  
  // Build intent-aware research prompt
  let researchPrompt;
  
  if (isLocalBusiness || intent === 'local_business') {
    // === LOCAL BUSINESS INTENT ===
    // User wants to promote their own local place/service - DON'T give competitor names!
    console.log('   📍 Using LOCAL BUSINESS research mode');
    
    if (isArabic) {
      researchPrompt = `الموضوع: ${extractedTopic}
المنطقة: ${region}

⚠️ هام جداً: هذا الموضوع عن مكان/محل/خدمة محلية يريد المستخدم الترويج لها.

المطلوب:
1. معلومات عامة عن هذا النوع من الأماكن/الخدمات في ${regionShort}
2. ما الذي يجعل هذا النوع من الأماكن مميزاً أو مطلوباً؟
3. إحصائيات عن السوق المحلي أو سلوك المستهلكين (إن وجدت)
4. نصائح أو معلومات مفيدة للجمهور عن هذا النوع من الخدمات

⛔ ممنوع تماماً:
- لا تذكر أسماء علامات تجارية عالمية (مثل WeWork, Starbucks, Zara)
- لا تذكر أسماء منافسين محليين
- لا تخلط بين الاسم المحلي وعلامات تجارية مشابهة عالمياً

✅ بدلاً من ذلك:
- ركز على الفوائد العامة لهذا النوع من الأماكن
- أعطِ معلومات تفيد الجمهور وتجعلهم يريدون زيارة هذا النوع من الأماكن`;
    } else if (isFrench) {
      researchPrompt = `Sujet: ${extractedTopic}
Région: ${region}

⚠️ Très important: Ce sujet concerne un lieu/magasin/service local que l'utilisateur veut promouvoir.

Requis:
1. Informations générales sur ce type de lieu/service en ${regionShort}
2. Qu'est-ce qui rend ce type de lieu attrayant?
3. Statistiques sur le marché local ou comportement des consommateurs (si disponible)
4. Conseils ou informations utiles pour le public

⛔ Strictement interdit:
- Ne mentionne PAS de marques mondiales (WeWork, Starbucks, Zara)
- Ne mentionne PAS de concurrents locaux
- Ne confonds PAS le nom local avec des marques mondiales similaires

✅ Concentre-toi sur:
- Les avantages généraux de ce type de lieu
- Des informations qui donnent envie au public de visiter`;
    } else {
      researchPrompt = `Topic: ${extractedTopic}
Region: ${region}

⚠️ Very important: This topic is about a local place/shop/service the user wants to promote.

Required:
1. General information about this type of place/service in ${regionShort}
2. What makes this type of place appealing or in-demand?
3. Local market statistics or consumer behavior (if available)
4. Useful tips or information for the audience

⛔ Strictly forbidden:
- Do NOT mention global brand names (WeWork, Starbucks, Zara)
- Do NOT mention local competitors by name
- Do NOT confuse the local name with similar global brands

✅ Instead focus on:
- General benefits of this type of place
- Information that makes the audience want to visit such places`;
    }
    
  } else if (intent === 'news') {
    // === NEWS/EVENT INTENT ===
    console.log('   📰 Using NEWS research mode');
    
    if (isArabic) {
      researchPrompt = `الموضوع: ${extractedTopic}
المنطقة: ${region}

المطلوب:
1. آخر الأخبار والتطورات (2024-2026)
2. أرقام وتواريخ رسمية ومحددة
3. تصريحات رسمية إن وجدت
4. مصادر موثوقة ورسمية

${hasUserAngles ? `طلب المستخدم بالتفصيل:\n"${rawInput}"\n\nركز على النقاط التي ذكرها المستخدم.` : ''}

⚠️ إذا لم تجد معلومات موثوقة وحديثة، قل ذلك بوضوح بدلاً من الاختراع.`;
    } else if (isFrench) {
      researchPrompt = `Sujet: ${extractedTopic}
Région: ${region}

Requis:
1. Dernières actualités et développements (2024-2026)
2. Chiffres et dates officiels et précis
3. Déclarations officielles si disponibles
4. Sources fiables et officielles

${hasUserAngles ? `Demande détaillée de l'utilisateur:\n"${rawInput}"\n\nConcentre-toi sur les points mentionnés.` : ''}

⚠️ Si tu ne trouves pas d'informations fiables et récentes, dis-le clairement au lieu d'inventer.`;
    } else {
      researchPrompt = `Topic: ${extractedTopic}
Region: ${region}

Required:
1. Latest news and developments (2024-2026)
2. Official and specific numbers and dates
3. Official statements if available
4. Reliable and official sources

${hasUserAngles ? `User's detailed request:\n"${rawInput}"\n\nFocus on the points mentioned.` : ''}

⚠️ If you cannot find reliable and recent information, state this clearly instead of making things up.`;
    }
    
  } else if (intent === 'concept') {
    // === CONCEPT/EDUCATIONAL INTENT ===
    console.log('   📚 Using CONCEPT research mode');
    
    if (isArabic) {
      researchPrompt = `الموضوع: ${extractedTopic}
السياق المحلي: ${region}

المطلوب:
1. شرح مبسط للمفهوم أو الفكرة
2. إحصائيات أو أرقام مثيرة للاهتمام
3. أمثلة أو تطبيقات من ${regionShort} إن وجدت
4. معلومات مفاجئة أو غير معروفة

${hasUserAngles ? `طلب المستخدم بالتفصيل:\n"${rawInput}"\n\nركز على النقاط التي ذكرها المستخدم.` : ''}`;
    } else if (isFrench) {
      researchPrompt = `Sujet: ${extractedTopic}
Contexte local: ${region}

Requis:
1. Explication simple du concept ou de l'idée
2. Statistiques ou chiffres intéressants
3. Exemples ou applications de ${regionShort} si disponible
4. Informations surprenantes ou peu connues

${hasUserAngles ? `Demande détaillée de l'utilisateur:\n"${rawInput}"\n\nConcentre-toi sur les points mentionnés.` : ''}`;
    } else {
      researchPrompt = `Topic: ${extractedTopic}
Local context: ${region}

Required:
1. Simple explanation of the concept or idea
2. Interesting statistics or numbers
3. Examples or applications from ${regionShort} if available
4. Surprising or little-known information

${hasUserAngles ? `User's detailed request:\n"${rawInput}"\n\nFocus on the points mentioned.` : ''}`;
    }
    
  } else if (intent === 'global_local') {
    // === GLOBAL TOPIC WITH LOCAL ANGLE ===
    console.log('   🌍 Using GLOBAL+LOCAL research mode');
    
    if (isArabic) {
      researchPrompt = `الموضوع: ${extractedTopic}

المطلوب:
1. معلومات عالمية عن الموضوع (أرقام، تطورات، اتجاهات)
2. كيف يؤثر هذا الموضوع على ${region}؟
3. أمثلة أو تطبيقات محلية في ${regionShort}
4. إحصائيات محلية إن وجدت

${hasUserAngles ? `طلب المستخدم بالتفصيل:\n"${rawInput}"\n\nركز على النقاط التي ذكرها المستخدم.` : ''}`;
    } else if (isFrench) {
      researchPrompt = `Sujet: ${extractedTopic}

Requis:
1. Informations mondiales sur le sujet (chiffres, développements, tendances)
2. Comment ce sujet affecte ${region}?
3. Exemples ou applications locales en ${regionShort}
4. Statistiques locales si disponibles

${hasUserAngles ? `Demande détaillée de l'utilisateur:\n"${rawInput}"\n\nConcentre-toi sur les points mentionnés.` : ''}`;
    } else {
      researchPrompt = `Topic: ${extractedTopic}

Required:
1. Global information about the topic (numbers, developments, trends)
2. How does this topic affect ${region}?
3. Local examples or applications in ${regionShort}
4. Local statistics if available

${hasUserAngles ? `User's detailed request:\n"${rawInput}"\n\nFocus on the points mentioned.` : ''}`;
    }
    
  } else {
    // === GENERAL/DEFAULT INTENT ===
    console.log('   📋 Using GENERAL research mode');
    
    if (hasUserAngles) {
      if (isArabic) {
        researchPrompt = `الموضوع: ${extractedTopic}

طلب المستخدم بالتفصيل:
"${rawInput}"

المطلوب:
1. ابحث عن كل النقاط التي ذكرها المستخدم
2. أرقام وتواريخ محددة
3. تفاصيل مفاجئة أو غير معروفة
4. المصادر

مختصر ودقيق.`;
      } else if (isFrench) {
        researchPrompt = `Sujet: ${extractedTopic}

Demande détaillée de l'utilisateur:
"${rawInput}"

Requis:
1. Recherche tous les points mentionnés par l'utilisateur
2. Chiffres et dates précis
3. Détails surprenants ou peu connus
4. Sources

Concis et précis.`;
      } else {
        researchPrompt = `Topic: ${extractedTopic}

User's detailed request:
"${rawInput}"

Required:
1. Research all the points mentioned by the user
2. Specific numbers and dates
3. Surprising or little-known details
4. Sources

Concise and accurate.`;
      }
    } else {
      // Short topic - do general research
      if (isArabic) {
        researchPrompt = `${extractedTopic}

المطلوب:
1. أرقام وتواريخ محددة
2. تفاصيل مفاجئة أو غير معروفة
3. المصادر

مختصر ودقيق.`;
      } else if (isFrench) {
        researchPrompt = `${extractedTopic}

Requis:
1. Chiffres et dates précis
2. Détails surprenants ou peu connus
3. Sources

Concis et précis.`;
      } else {
        researchPrompt = `${extractedTopic}

Required:
1. Specific numbers and dates
2. Surprising or little-known details
3. Sources

Concise and accurate.`;
      }
    }
  }
  
  // Get the appropriate system prompt based on language and intent
  const systemPrompt = getResearchSystemPrompt(language, intent);
  
  // 📝 LOG: What we're sending to Perplexity
  console.log('   ┌─────────────────────────────────────');
  console.log('   │ 🔍 PERPLEXITY REQUEST');
  console.log('   ├─────────────────────────────────────');
  console.log(`   │ System: ${systemPrompt.substring(0, 100)}...`);
  console.log('   │');
  console.log(`   │ Query: ${researchPrompt.substring(0, 200)}...`);
  console.log('   └─────────────────────────────────────');
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: CONFIG.PERPLEXITY_MODEL,
          messages: [
            {
              role: 'system',
              content: systemPrompt
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
      
      const result = response.data.choices[0].message.content;
      
      // 📝 LOG: What Perplexity returned
      console.log('   ┌─────────────────────────────────────');
      console.log('   │ 📥 PERPLEXITY RESPONSE');
      console.log('   ├─────────────────────────────────────');
      console.log(`   │ ${result.substring(0, 500).replace(/\n/g, '\n   │ ')}...`);
      console.log('   └─────────────────────────────────────');
      
      return result;
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

async function generateHooks(topic, researchData, niche, language = 'egyptian', costTracker = null, actionType = 'research', userInstructions = '', userFacts = []) {
  console.log('   🎣 Generating hooks (Gemini 3 Pro)...');
  
  // Get niche-specific hooks for this language (used as style reference for both modes)
  const nicheHooks = getNicheHooks(niche, language);
  const universalHooks = getUniversalHooks(language);
  
  // Build user facts section if available
  const userFactsSection = userFacts && userFacts.length > 0
    ? `\n=== User mentioned (use these facts!) ===\n${userFacts.map(f => `• ${f}`).join('\n')}\n`
    : '';
  
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
${userFactsSection}
=== Example Hooks from "${niche}" (copy the STYLE exactly!) ===
${nicheHooks.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== Universal Hook Patterns (for inspiration) ===
${universalHooks.slice(0, 3).map((h, i) => `${i + 1}. "${h}"`).join('\n')}

=== Style Tips ===
${hookConfig.tips}

${actionType === 'refine' ? '⚠️ IMPORTANT: The hooks must relate to the USER\'S CONTENT above, not external information.' : ''}

⚠️ CRITICAL: Each hook MUST be 25 words or less! Keep them short and punchy.

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

async function writeScript(topic, researchData, niche, selectedHook, duration, language = 'egyptian', costTracker = null, actionType = 'research', userInstructions = '', userFacts = []) {
  console.log(`   ✍️ Writing script (Gemini 3 Pro) - Mode: ${actionType.toUpperCase()}...`);
  
  const durationConfig = getDurationConfig(duration);
  const examples = getNicheExamples(niche, duration, language);
  
  // Build user facts section if available
  const userFactsSection = userFacts && userFacts.length > 0
    ? `\n=== User mentioned (prioritize these facts!) ===\n${userFacts.map(f => `• ${f}`).join('\n')}\n`
    : '';
  
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
      .replace(/\$\{researchData\}/g, userFactsSection + researchData)  // Prepend user facts to research
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
  
  const prompt = `You are a JSON generator. Output valid JSON only. No markdown, no code blocks. Keep prompts concise (40-50 words each).

Act as an expert AI Art Director specializing in "Black Forest Labs Flux" prompting AND a Professional Media Researcher.

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

### RULESET 2: SMART IMAGE SEARCH (Google) - ENTITY-FIRST EXTRACTION

For "google_search_term" and "b_roll_keywords" fields, follow this PRIORITY ORDER:

**STEP 1: SCAN FOR NAMED ENTITIES (MANDATORY)**
Before writing ANY keyword, scan the script section for:
- Brand/Company names (Apple, Tesla, Google, Samsung, etc.)
- Initiative/Program names → Add "logo" or "official"
- Organization names (ministries, funds, institutions, agencies)
- Person names or titles/roles (CEO, minister, founder) → Add context
- Specific buildings/landmarks (headquarters, academies, monuments)
- Official plans/visions/programs (national initiatives, tech programs)
- Product names (iPhone, Model S, etc.)

**STEP 2: KEYWORD FORMATTING**
- Use 2-4 words maximum
- For entities: Include the ORIGINAL language name + English translation in b_roll_keywords
- For logos/official images: Append "logo" or "official"
- For events/launches: Append "launch", "announcement", or "event"
- ALL google_search_term values MUST be in English for best results

**STEP 3: FALLBACK ONLY**
- Use generic visual terms ONLY if the section contains ZERO named entities
- Generic terms = last resort, not default

**EXAMPLES BY LANGUAGE:**

🇪🇬 ARABIC (Egyptian/Gulf):
Script mentions "مبادرة رواد مصر الرقميون":
✅ RIGHT: "Digital Egypt Pioneers logo", "رواد مصر الرقميون"
❌ WRONG: "Egyptian students learning"

Script mentions "وزارة الاتصالات":
✅ RIGHT: "Egypt Minister of Communications", "وزارة الاتصالات مصر"
❌ WRONG: "Egyptian government official"

🇺🇸 ENGLISH:
Script mentions "Elon Musk announced Neuralink":
✅ RIGHT: "Elon Musk Neuralink", "Neuralink logo"
❌ WRONG: "businessman technology"

Script mentions "Apple's Vision Pro headset":
✅ RIGHT: "Apple Vision Pro", "Vision Pro headset"
❌ WRONG: "VR technology device"

Script mentions "Y Combinator accelerator":
✅ RIGHT: "Y Combinator logo", "YC Demo Day"
❌ WRONG: "startup incubator office"

🇫🇷 FRENCH:
Script mentions "Station F à Paris":
✅ RIGHT: "Station F Paris", "Station F logo"
❌ WRONG: "French startup hub"

Script mentions "BPI France financement":
✅ RIGHT: "BPI France logo", "Bpifrance"
❌ WRONG: "French government funding"

Script mentions "École 42":
✅ RIGHT: "Ecole 42 Paris", "42 school logo"
❌ WRONG: "coding school France"

**OUTPUT BEHAVIOR:**
- google_search_term: Primary entity in English (with "logo" if applicable)
- b_roll_keywords: Mix of original language + English entity names, logos, and related official terms

**STRICT RULE:** If a proper noun, initiative name, brand, or organization exists in the script text, it MUST appear in the keywords. Never replace specific names with generic descriptions.

### RULESET 3: B-ROLL KEYWORDS (Supplementary)
- Extract 5 to 8 simple 2-3 word keywords from the script for B-Roll footage.
- Focus on objects, places, actions mentioned in the text.
- Keep each keyword SHORT (2-3 words max).
- Examples: "money stack", "Cairo skyline", "typing keyboard", "coffee shop"

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
    // Use Gemini Flash for cost efficiency (keyword extraction task)
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          maxOutputTokens: 1500,
          temperature: 0.7,
        }
      }
    );
    
    if (costTracker && response.data.usageMetadata) {
      trackCost(costTracker, 'gemini_flash', response.data.usageMetadata.promptTokenCount || 0, response.data.usageMetadata.candidatesTokenCount || 0);
    }
    
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('   📝 Visual API response received (Gemini Flash)');
    
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.hook && parsed.content && parsed.cta) {
        console.log('   ✓ Visual prompts parsed successfully');
        // Detailed logging for debugging
        console.log('   📸 VISUAL PROMPTS OUTPUT:');
        console.log('   ├─ Hook google_search_term:', parsed.hook.google_search_term || '❌ MISSING');
        console.log('   ├─ Content google_search_term:', parsed.content.google_search_term || '❌ MISSING');
        console.log('   ├─ CTA google_search_term:', parsed.cta.google_search_term || '❌ MISSING');
        console.log('   └─ B-Roll Keywords:', parsed.b_roll_keywords ? `[${parsed.b_roll_keywords.length} items] ${parsed.b_roll_keywords.join(', ')}` : '❌ MISSING');
        return parsed;
      } else {
        console.log('   ⚠️ Parsed JSON missing required fields (hook/content/cta)');
        console.log('   📄 Parsed keys:', Object.keys(parsed));
      }
    } else {
      console.log('   ⚠️ Could not extract JSON from response');
      console.log('   📄 Raw response preview:', text.substring(0, 200));
    }
  } catch (e) {
    console.error('   ⚠️ Visual prompt error:', e.message);
    console.error('   📄 Stack:', e.stack?.substring(0, 300));
  }
  
  // Fallback
  console.log('   ⚠️ Using fallback visual prompts');
  const fallbackResult = {
    hook: { 
      prompt: `A cinematic hyper-realistic wide shot of ${topic} captured in dramatic composition. Volumetric lighting creates depth with golden hour rays streaming through. Shot on professional cinema camera with shallow depth of field creating atmospheric mood.`,
      google_search_term: topic,
      description_ar: 'منظر واسع للموضوع',
      description_en: 'Wide shot overview',
      description_fr: 'Vue large du sujet',
      caption: 'Hook Scene'
    },
    content: { 
      prompt: `A detailed hyper-realistic medium shot showcasing ${topic} with clear educational focus. Soft cinematic shading highlights key details while maintaining visual clarity. Professional documentary style with balanced composition and natural color grading.`,
      google_search_term: `${topic} closeup`,
      description_ar: 'لقطة متوسطة للتفاصيل',
      description_en: 'Medium shot details',
      description_fr: 'Plan moyen détaillé',
      caption: 'Content Scene'
    },
    cta: { 
      prompt: `A cinematic hyper-realistic close-up of ${topic} with emotional impact and hopeful atmosphere. Dramatic rim lighting creates powerful silhouette effect. Warm color palette with soft bokeh background evoking inspiration and connection.`,
      google_search_term: `${topic} success`,
      description_ar: 'لقطة قريبة للختام',
      description_en: 'Close-up finale',
      description_fr: 'Gros plan final',
      caption: 'CTA Scene'
    },
    b_roll_keywords: [
      topic,
      'office desk',
      'typing keyboard',
      'city street',
      'success achievement'
    ]
  };
  console.log('   📸 FALLBACK VISUAL PROMPTS:');
  console.log('   ├─ Hook google_search_term:', fallbackResult.hook.google_search_term);
  console.log('   ├─ Content google_search_term:', fallbackResult.content.google_search_term);
  console.log('   ├─ CTA google_search_term:', fallbackResult.cta.google_search_term);
  console.log('   └─ B-Roll Keywords:', fallbackResult.b_roll_keywords.join(', '));
  return fallbackResult;
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
    
    // Stage 0B: Extract Core Topic + User Facts + Intent
    const topicResult = await extractTopic(rawTopic, language);
    const topic = topicResult.topic;
    const userFacts = topicResult.userFacts || [];
    const intent = topicResult.intent || 'general';
    const isLocalBusiness = topicResult.isLocalBusiness || false;
    console.log(`   ✓ Topic: "${topic}"`);
    console.log(`   🎯 Intent: ${intent} | isLocalBusiness: ${isLocalBusiness}`);
    console.log(`   📌 User Facts: ${JSON.stringify(userFacts)}`);
    
    // Stage 1: Research (SKIP if refine mode)
    let researchData;
    if (action_type === 'refine') {
      console.log('   ⏭️ Skipping research (Refine Mode - using user content)');
      researchData = user_instructions; // Use user's draft as the "research"
    } else {
      researchData = await research(rawTopic, topic, { intent, isLocalBusiness, language }); // Pass intent context
      console.log('   ✓ Research done');
    }
    
    // Stage 2: Generate Hooks (with action_type and userFacts)
    console.log(`   📌 Passing ${userFacts.length} user facts to hooks`);
    const hooks = await generateHooks(topic, researchData, niche, language, null, action_type, user_instructions, userFacts);
    console.log(`   ✓ Hooks: ${hooks.length}`);
    
    // Select first hook as main
    const selectedHook = hooks[0] || topic;
    
    // Stage 3: Write Script (with action_type and userFacts)
    console.log(`   📌 Passing ${userFacts.length} user facts to script`);
    let script = await writeScript(topic, researchData, niche, selectedHook, duration, language, null, action_type, user_instructions, userFacts);
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
    let extractedTopic, researchData, action_type, user_instructions, userFacts = [];
    
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
      
      // Stage 0B: Extract Core Topic + User Facts + Intent
      const topicResult = await extractTopic(topic, language, costTracker);
      extractedTopic = topicResult.topic;
      userFacts = topicResult.userFacts || [];
      const intent = topicResult.intent || 'general';
      const isLocalBusiness = topicResult.isLocalBusiness || false;
      console.log(`   ✓ Topic: "${extractedTopic}"`);
      console.log(`   🎯 Intent: ${intent} | isLocalBusiness: ${isLocalBusiness}`);
      console.log(`   📌 User Facts: ${JSON.stringify(userFacts)}`);
      
      // Research (SKIP if refine mode)
      if (action_type === 'refine') {
        console.log('   ⏭️ Skipping research (Refine Mode)');
        researchData = user_instructions;
      } else {
        researchData = await research(topic, extractedTopic, { intent, isLocalBusiness, language }, costTracker); // Pass intent context
        console.log('   ✓ Research done');
      }
    }
    
    // Generate 3 hooks (with action_type and userFacts)
    console.log(`   📌 Passing ${userFacts.length} user facts to hooks`);
    const hooks = await generateHooks(extractedTopic, researchData, niche, language, costTracker, action_type, user_instructions, userFacts);
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
      user_facts: userFacts, // Pass user facts for Step 2
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
    user_facts = [], // NEW: Accept user_facts from Step 1
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
  
  // DEBUG: Log what user_facts was received
  console.log('   🔍 DEBUG user_facts received:', JSON.stringify(user_facts));
  console.log('   🔍 DEBUG req.body.user_facts:', JSON.stringify(req.body.user_facts));
  console.log('   🔍 DEBUG typeof user_facts:', typeof user_facts);
  console.log('   🔍 DEBUG Array.isArray:', Array.isArray(user_facts));
  
  const startTime = Date.now();
  const costTracker = createCostTracker();
  
  try {
    // Write script with selected hook (with mode and user facts)
    console.log(`   📌 Passing ${user_facts.length} user facts to script`);
    let script = await writeScript(topic, researchData, niche, selectedHook, duration, language, costTracker, mode, user_instructions, user_facts);
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
// 💡 TRENDING IDEAS (Inspiration) - v2
// Focus: Easy viral content (talking head OR voiceover)
// No complex production needed
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
    prompt = `اقترح ${count} أفكار فيديوهات فيرال في مجال "${nicheName}".

⚠️ شروط مهمة:
- الفيديو يكون **talking head** (شخص يتكلم للكاميرا) أو **voiceover** (صور/فيديوهات مع صوت)
- مينفعش يحتاج: تصوير خارجي، ناس تانية، معدات، تجارب في الشارع
- لازم يتنفذ بسهولة: سكريبت + موبايل + خلاص
- الفكرة تكون مثيرة للفضول أو الجدل أو فيها معلومة صادمة
- مناسب للجمهور المصري، بالعامية المصرية

أمثلة على أفكار صح ✅:
- "ليه 70% من المصريين بيعملوا الغلطة دي في الفلوس"
- "3 حاجات منعرفهاش عن [الموضوع] هتصدمك"
- "الفرق بين اللي بينجح واللي بيفشل في [المجال]"

أمثلة على أفكار غلط ❌:
- "اعمل تجربة اجتماعية في الشارع" (صعب التنفيذ)
- "صور ردة فعل صاحبك" (محتاج ناس)
- "راجع المنتج ده" (محتاج منتج)

JSON فقط:
{"ideas": ["فكرة 1", "فكرة 2", ...]}`;
    systemPrompt = 'أنت خبير في المحتوى الفيرال. بتقترح أفكار سهلة التنفيذ (talking head أو voiceover) تتعمل بموبايل بس. بالعامية المصرية. JSON فقط.';
    
  } else if (language === 'gulf') {
    prompt = `اقترح ${count} أفكار فيديوهات فايرال في مجال "${nicheName}".

⚠️ شروط مهمة:
- الفيديو يكون **talking head** (شخص يتكلم للكاميرا) أو **voiceover** (صور/مقاطع مع صوت)
- ما يحتاج: تصوير برا، ناس ثانيين، معدات، تجارب بالشارع
- لازم يتنفذ بسهولة: سكريبت + جوال + خلاص
- الفكرة تكون مثيرة للفضول أو الجدل أو فيها معلومة صادمة
- مناسب للجمهور الخليجي، باللهجة الخليجية

أمثلة على أفكار صح ✅:
- "ليش 70% من الناس يغلطون بهالشي في الفلوس"
- "3 أشياء ما تعرفها عن [الموضوع] بتصدمك"
- "الفرق بين اللي ينجح واللي يفشل في [المجال]"

أمثلة على أفكار غلط ❌:
- "سو تجربة اجتماعية بالشارع" (صعب التنفيذ)
- "صور ردة فعل ربيعك" (يحتاج ناس)
- "سو ريفيو لهالمنتج" (يحتاج منتج)

JSON فقط:
{"ideas": ["فكرة 1", "فكرة 2", ...]}`;
    systemPrompt = 'أنت خبير في المحتوى الفايرال. تقترح أفكار سهلة التنفيذ (talking head أو voiceover) تنسوى بجوال بس. باللهجة الخليجية. JSON فقط.';
    
  } else if (language === 'french') {
    prompt = `Suggère ${count} idées de vidéos virales dans le domaine "${nicheName}".

⚠️ Contraintes importantes:
- La vidéo doit être **talking head** (personne qui parle face caméra) OU **voiceover** (images/clips avec narration)
- PAS DE: tournage extérieur, autres personnes, équipement, expériences sociales
- Doit être facile à réaliser: script + téléphone = c'est tout
- Les idées doivent susciter la curiosité, la controverse, ou avoir un hook surprenant
- Adapté au public francophone

Bons exemples ✅:
- "Pourquoi 70% des gens font cette erreur avec l'argent"
- "3 choses que personne ne te dit sur [sujet] qui vont te choquer"
- "La différence entre ceux qui réussissent et ceux qui échouent dans [domaine]"

Mauvais exemples ❌:
- "Fais une expérience sociale dans la rue" (difficile à réaliser)
- "Filme la réaction de ton ami" (besoin d'autres personnes)
- "Fais une review de ce produit" (besoin du produit)

JSON uniquement:
{"ideas": ["idée 1", "idée 2", ...]}`;
    systemPrompt = 'Tu es un expert en contenu viral. Tu suggères des idées faciles à réaliser (talking head ou voiceover) faisables avec juste un téléphone. JSON uniquement.';
    
  } else {
    prompt = `Suggest ${count} viral video ideas in the "${nicheName}" niche.

⚠️ Important constraints:
- Video must be **talking head** (person talking to camera) OR **voiceover** (images/clips with narration)
- NO: outdoor filming, other people needed, equipment, street experiments, reactions
- Must be easy to execute: script + phone = done
- Ideas should spark curiosity, controversy, or have a surprising hook
- Suitable for English-speaking audience

Good examples ✅:
- "Why 70% of people make this money mistake"
- "3 things nobody tells you about [topic] that will shock you"
- "The difference between people who succeed and fail at [niche]"

Bad examples ❌:
- "Do a social experiment on the street" (hard to execute)
- "Film your friend's reaction" (needs other people)
- "Review this product" (needs product)

JSON only:
{"ideas": ["idea 1", "idea 2", ...]}`;
    systemPrompt = 'You are a viral content expert. You suggest easy-to-execute ideas (talking head or voiceover) that can be made with just a phone. JSON only.';
  }

  try {
    // Using Gemini Flash Lite for cost efficiency
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Understood. I will suggest easy-to-execute viral ideas in JSON format.' }] },
          { role: 'user', parts: [{ text: prompt }] }
        ],
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    
    if (response.data.usageMetadata) {
      const usage = response.data.usageMetadata;
      trackCost(costTracker, 'gemini_chat', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
      console.log(`   💰 Ideas cost: $${costTracker.total.toFixed(4)}`);
    }
    
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
            disable_safety_checker: false, // Ensure NSFW filter is ALWAYS enabled
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
      
      // Check if NSFW content was detected
      const errorMessage = e.response?.data?.detail || e.message || '';
      if (errorMessage.toLowerCase().includes('nsfw')) {
        console.log('   🚫 NSFW content blocked by safety filter');
        res.status(400).json({ 
          success: false, 
          error: 'Content blocked by safety filter. Please try a different prompt.',
          code: 'NSFW_BLOCKED'
        });
        return;
      }
      
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
# WHO YOU ARE
You're a content creation expert inside the Seshu app.
You specialize in short-form video (TikTok, Reels, Shorts) and understand virality, growth, trends, algorithms, and everything creators need to succeed.

You genuinely understand:
- How algorithms prioritize content
- What triggers shares, saves, and comments
- Platform differences (TikTok vs Reels vs Shorts)
- Trend mechanics and timing
- Growth strategies and engagement tactics
- Content planning and consistency
- Niche selection and positioning
- Analytics and what metrics matter

# SESHU'S SCRIPT FEATURE
Seshu has a script generator. When users want to create a video:
1. You help them pick a **topic and angle**
2. They hit "Generate Script" → the APP writes the full script with hooks, structure, and AI images

You don't write scripts or hooks for specific videos - the app handles that. Your job is helping them decide WHAT to make.

# LANGUAGE
Mirror the user's language naturally:
- Egyptian Arabic → Egyptian slang
- Gulf Arabic → Khaleeji style  
- English → casual English
- French → conversational French

# RESPONSE STYLE
- **Concise but valuable** - No fluff, every line adds something
- **Specific over generic** - Real examples, real tactics
- **Actionable** - Give them something they can use
- Keep responses 3-6 lines typically

# WHAT YOU HELP WITH

**Content Strategy:**
- What niche to pick
- Content pillars and themes
- Posting frequency and timing
- Building a content calendar

**Viral Mechanics (educational):**
- Hook formulas and why they work
- Retention techniques
- What makes people share/save
- Algorithm behavior

**Platform Knowledge:**
- TikTok trends and sounds
- Reels best practices
- Shorts optimization
- Cross-posting strategies

**Growth & Engagement:**
- How to grow from zero
- Engagement tactics
- Building community
- Converting viewers to followers

**Topic Brainstorming:**
- Finding angles for any subject
- Making boring topics interesting
- Trend-jacking ideas

# TOPIC → SCRIPT FLOW
When helping pick a topic for script generation:

1. Understand their niche (ask if unclear)
2. Suggest 2-3 angles (without pre-writing hooks - app handles that)
3. When they confirm → trigger immediately

Example angles:
• الزاوية الصادمة: رقم أو حقيقة مفاجئة
• الزاوية القصصية: قصة شخص حقيقي
• الزاوية المقارنة: A vs B

When user confirms, output:
[ACTION:GENERATE_SCRIPT]{"topic":"DETAILED_TOPIC_30-50_WORDS","lang":"LANGUAGE_ID"}

**Topic field:** Main subject + agreed angle + key points. Detail helps the app write better.
**Lang values:** "egyptian", "gulf", "english", "french"

Don't double-confirm. When they agree → trigger immediately.

# WHAT NOT TO DO
- Don't write full scripts (app does that)
- Don't pre-write specific hooks for their video (app does that)
- Don't give generic advice like "be consistent"
- Don't over-explain or pad responses

# EXAMPLES

**User asks about content creation:**
"إزاي أبدأ قناة من الصفر؟"
→ Give real actionable advice about niche selection, first 10 videos strategy, etc.

**User asks about hooks (educational):**
"How do hooks work?"
→ Teach hook formulas: question hooks, shock stats, curiosity gaps, etc.

**User wants to make a video:**
"عايز فيديو عن الذكاء الاصطناعي"
→ Suggest 2-3 angles (without writing hooks), when they pick one → trigger script generation

**User asks about growth:**
"ليه الفيديوهات مش بتوصل؟"
→ Diagnose possible issues: hooks, retention, posting time, niche clarity, etc.

**Greeting:**
"مرحبا"
→ "أهلاً! 👋 محتاج مساعدة في إيه النهاردة؟"
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
    
    // Retry logic for 503 (overloaded) errors
    const MAX_RETRIES = 3;
    let response;
    let lastError;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await axios.post(
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
        break; // Success, exit retry loop
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        
        // Retry on 503 (overloaded) or 429 (rate limit)
        if ((status === 503 || status === 429) && attempt < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000); // 1s, 2s, 4s max
          console.log(`   ⏳ Retry ${attempt}/${MAX_RETRIES} after ${delay}ms (status: ${status})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err; // Non-retryable error or max retries reached
      }
    }
    
    if (!response) {
      throw lastError || new Error('Failed after retries');
    }
    
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