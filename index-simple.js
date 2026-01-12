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
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  PERPLEXITY_MODEL: 'sonar-pro',
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  GEMINI_MODEL: 'gemini-2.5-flash',
  DALLE_MODEL: 'dall-e-3',
};

// Log missing envs
const missingEnv = [];
if (!CONFIG.PERPLEXITY_API_KEY) missingEnv.push('PERPLEXITY_API_KEY');
if (!CONFIG.CLAUDE_API_KEY) missingEnv.push('CLAUDE_API_KEY');
if (!CONFIG.GEMINI_API_KEY) missingEnv.push('GEMINI_API_KEY');
if (missingEnv.length) {
  console.error('⚠️ Missing env vars:', missingEnv.join(', '));
}

// ============================================
// 🌍 DIALECTS
// ============================================

const DIALECTS = {
  egyptian: {
    name: 'Egyptian Arabic',
    reference: 'مقدم بودكاست مصري يشرح لصديقه',
    example: 'طب تخيل كده... إنت قاعد في بيتك، وفجأة موبايلك يقولك إن فيه زلزال جاي كمان 30 ثانية. مش خيال علمي - ده اللي اليابان بتعمله دلوقتي.',
  },
  gulf: {
    name: 'Gulf Arabic',
    reference: 'شاب سعودي/إماراتي يشرح لأخوه',
    example: 'الحين بقولك شي... لو قلتلك إن فيه طريقة تخلي موبايلك يعرف إن فيه زلزال قبل ما يصير بنص دقيقة؟',
  },
  english: {
    name: 'English',
    reference: 'Smart YouTuber explaining to a friend',
    example: 'Okay so imagine this... you\'re at home, and suddenly your phone tells you an earthquake is coming in 30 seconds.',
  },
};

// ============================================
// 🎯 SIMPLE 3-STAGE PIPELINE
// ============================================

// Stage 1: Research (Perplexity)
async function simpleResearch(topic) {
  const response = await axios.post(
    'https://api.perplexity.ai/chat/completions',
    {
      model: CONFIG.PERPLEXITY_MODEL,
      messages: [
        {
          role: 'system',
          content: 'باحث محترف. أرقام، تواريخ، تفاصيل دقيقة.'
        },
        {
          role: 'user',
          content: `ابحث بعمق عن: ${topic}. أريد أرقام وتواريخ وتفاصيل.`
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

// Stage 2: Write (Claude - One Shot)
async function simpleWrite(topic, research, dialect, duration) {
  const dialectConfig = DIALECTS[dialect] || DIALECTS.egyptian;
  const wordCount = Math.round(duration * 2.5);
  
  const prompt = `اكتب سكربت فيديو قصير (${duration} ثانية، ~${wordCount} كلمة) عن: ${topic}

═══════════════════════════════════════
📚 المعلومات من البحث:
═══════════════════════════════════════
${research.substring(0, 2000)}

═══════════════════════════════════════
🗣️ اللهجة: ${dialectConfig.name}
${dialectConfig.reference}

مثال على النبرة الصحيحة:
"${dialectConfig.example}"
═══════════════════════════════════════

═══════════════════════════════════════
📚 أمثلة سكربتات ممتازة (تعلم الأسلوب - لا تنسخ):
═══════════════════════════════════════

**مثال 1: العاصمة الإدارية**
مصر بتبني مدينة بحجم دولة سنغافورة كلها، والناس لسه فاكراها مجرد "عمارات جديدة"!

أنت متخيل إن "النهر الأخضر" اللي بيتزرع هناك ده، مساحته 3 أضعاف "السنترال بارك" بتاعة نيويورك؟.. إحنا بنتكلم عن مدينة ذكية بالكامل. عندك البرج الأيقوني، أطول برج في أفريقيا بارتفاع 385 متر، يعني أعلى من برج إيفل بـ 85 متر كاملين. المدينة دي معمولة عشان تستوعب 6.5 مليون بني آدم.

تفتكر هتقدر تشتري شقة هناك، ولا الأسعار هتبقى للخلايجة والأجانب بس؟

---

**مثال 2: التيك توك**
صاحبي أحمد بيعمل 3,200 دولار شهرياً من تيك توك - ومعندوش غير 8 آلاف فولور بس.

قعدت معاه وسألته: يا عم أحمد إنت بتعمل إيه بالظبط؟

قالي سر واحد غيّر كل حاجة: "أنا مش بكسب من تيك توك... أنا بكسب *عن طريق* تيك توك."

يعني إيه الكلام ده؟

أحمد بيعمل فيديوهات مراجعات لمنتجات أمازون. كل فيديو 30 ثانية. بيحط لينك في البايو، وكل واحد يشتري من اللينك، هو بياخد 8% عمولة.

لو عايز تعرف بالظبط إزاي تبدأ زي أحمد - تابعني.

═══════════════════════════════════════
✅ لاحظ في الأمثلة:
═══════════════════════════════════════
• مقارنات محددة ("3 أضعاف السنترال بارك")
• أرقام دقيقة ("385 متر"، "3,200 دولار")
• جمل قصيرة ("قعدت معاه"، "قالي")
• أسئلة مباشرة ("يعني إيه؟")
• CTA سؤال في النهاية

═══════════════════════════════════════
❌ ممنوع تماماً:
═══════════════════════════════════════
• "هل تعلم"، "تخيل كده"، "بص كده"
• "يُعد"، "حيث"، "علاوة على ذلك"
• "في إطار"، "مما يؤدي"
• فواصل (━━━) أو Caption أو هاشتاجات

═══════════════════════════════════════
اكتب السكربت مباشرة عن: ${topic}
═══════════════════════════════════════`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 2500,
      system: 'أنت كاتب سكربتات فيديو قصيرة. اكتب كما تتكلم. Output: نص متصل فقط.',
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

// Stage 3: Quick Polish (Gemini - Light Touch)
async function simplePolish(script, dialect) {
  const dialectConfig = DIALECTS[dialect] || DIALECTS.egyptian;
  
  const prompt = `راجع هذا السكربت بسرعة وأصلح فقط:

السكربت:
${script}

إصلاحات سريعة:
1. شيل "يُعد"، "حيث"، "علاوة" → حولها لعامي
2. شيل أي "━━━" أو "Caption:" أو "#"
3. شيل "هل تعلم" من البداية لو موجود
4. أي جملة > 15 كلمة → قسمها

اللهجة: ${dialectConfig.name}
${dialectConfig.reference}

أعطني السكربت المحسّن فقط:`;

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2000,
      },
      systemInstruction: {
        parts: [{ text: 'أنت محرر سريع. إصلاحات بسيطة فقط. Output: السكربت فقط.' }]
      },
    },
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  let text = response.data.candidates[0].content.parts[0].text;
  
  // Clean output
  text = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[━═─]{3,}/g, '')
    .replace(/^Caption:.*$/gim, '')
    .replace(/^#.*$/gim, '')
    .replace(/^(إليك السكربت|السكربت المحسّن)[:\s]*/i, '')
    .replace(/^هل تعلم (أن|إن|ان)/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return text;
}

// ============================================
// 🚀 MAIN PIPELINE (SIMPLE)
// ============================================

async function generateSimpleScript(topic, language, duration) {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('🚀 SIMPLE Pipeline Started');
  console.log(`📌 Topic: ${topic}`);
  console.log(`🌍 Dialect: ${language}`);
  console.log(`⏱️ Duration: ${duration}s`);
  console.log('═══════════════════════════════════════');
  
  try {
    // Stage 1: Research
    console.log('📚 Stage 1: Research...');
    const research = await simpleResearch(topic);
    console.log('   ✓ Research complete');
    
    // Stage 2: Write (One Shot with Inline Examples)
    console.log('✍️ Stage 2: Write (One Shot)...');
    const draft = await simpleWrite(topic, research, language, duration);
    const draftWords = draft.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Draft complete: ${draftWords} words`);
    
    // Stage 3: Quick Polish
    console.log('🔧 Stage 3: Quick Polish...');
    const polished = await simplePolish(draft, language);
    const finalWords = polished.split(/\s+/).filter(w => w.length > 0).length;
    console.log(`   ✓ Polish complete: ${finalWords} words`);
    
    console.log('═══════════════════════════════════════');
    console.log('✨ SIMPLE Pipeline Complete');
    console.log('═══════════════════════════════════════');
    console.log('');
    
    return {
      success: true,
      script: polished,
      wordCount: finalWords,
      pipeline: 'SIMPLE: Research → Write (One Shot) → Quick Polish',
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
  res.json({ status: 'ok', message: 'Scripty API - Simple Pipeline' });
});

app.post('/api/generate', async (req, res) => {
  const { topic, language = 'egyptian', duration = '60' } = req.body;
  
  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }
  
  try {
    const result = await generateSimpleScript(topic, language, parseInt(duration) || 60);
    
    res.json({
      success: true,
      script: result.script,
      wordCount: result.wordCount,
      pipeline: result.pipeline,
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 🚀 START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Scripty API (SIMPLE) running on port ${PORT}`);
});
