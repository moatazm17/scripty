const errorMessages = {
  // Network Errors
  NO_INTERNET: {
    ar: 'لا يوجد اتصال بالإنترنت. تأكد من الاتصال وحاول مرة أخرى 📶',
    en: 'No internet connection. Please check your connection and try again 📶',
    fr: 'Pas de connexion Internet. Vérifiez votre connexion et réessayez 📶'
  },
  
  TIMEOUT: {
    ar: 'انتهت مهلة الاتصال. الخادم مشغول، حاول مرة أخرى بعد قليل ⏱️',
    en: 'Connection timed out. Server is busy, please try again shortly ⏱️',
    fr: 'Délai de connexion dépassé. Le serveur est occupé, réessayez dans un moment ⏱️'
  },

  SERVER_ERROR: {
    ar: 'حدث خطأ في الخادم. نعمل على حله، حاول مرة أخرى لاحقاً 🔧',
    en: 'Server error occurred. We\'re working on it, please try again later 🔧',
    fr: 'Erreur serveur. Nous y travaillons, veuillez réessayer plus tard 🔧'
  },

  // Research Errors
  RESEARCH_NO_RESULTS: {
    ar: 'لم نجد معلومات كافية عن هذا الموضوع. جرب صياغة الموضوع بطريقة مختلفة 🔍',
    en: 'Could not find enough information on this topic. Try rephrasing your topic 🔍',
    fr: 'Impossible de trouver assez d\'informations. Essayez de reformuler votre sujet 🔍'
  },

  RESEARCH_FAILED: {
    ar: 'فشل البحث عن المعلومات. حاول مرة أخرى أو اكتب الموضوع بشكل مختلف 🔄',
    en: 'Research failed. Please try again or rephrase your topic 🔄',
    fr: 'La recherche a échoué. Réessayez ou reformulez votre sujet 🔄'
  },

  // Generation Errors
  HOOK_GENERATION_FAILED: {
    ar: 'لم نتمكن من إنشاء الـ Hooks. حاول مرة أخرى 🎣',
    en: 'Could not generate hooks. Please try again 🎣',
    fr: 'Impossible de générer les hooks. Veuillez réessayer 🎣'
  },

  SCRIPT_GENERATION_FAILED: {
    ar: 'لم نتمكن من كتابة السكريبت. حاول مرة أخرى 📝',
    en: 'Could not write the script. Please try again 📝',
    fr: 'Impossible d\'écrire le script. Veuillez réessayer 📝'
  },

  // Input Errors
  TOPIC_TOO_SHORT: {
    ar: 'الموضوع قصير جداً. أضف المزيد من التفاصيل للحصول على نتائج أفضل ✏️',
    en: 'Topic is too short. Add more details for better results ✏️',
    fr: 'Le sujet est trop court. Ajoutez plus de détails pour de meilleurs résultats ✏️'
  },

  TOPIC_TOO_LONG: {
    ar: 'الموضوع طويل جداً. حاول اختصاره قليلاً 📏',
    en: 'Topic is too long. Try to shorten it a bit 📏',
    fr: 'Le sujet est trop long. Essayez de le raccourcir un peu 📏'
  },

  INVALID_LANGUAGE: {
    ar: 'اللغة المختارة غير مدعومة حالياً 🌐',
    en: 'Selected language is not currently supported 🌐',
    fr: 'La langue sélectionnée n\'est pas prise en charge actuellement 🌐'
  },

  INVALID_DURATION: {
    ar: 'مدة الفيديو غير صحيحة. اختر 30 أو 60 ثانية ⏰',
    en: 'Invalid video duration. Please select 30 or 60 seconds ⏰',
    fr: 'Durée de vidéo invalide. Veuillez sélectionner 30 ou 60 secondes ⏰'
  },

  // Limit Errors
  DAILY_LIMIT_REACHED: {
    ar: 'وصلت للحد اليومي. عد غداً أو قم بالترقية للمزيد ⭐',
    en: 'Daily limit reached. Come back tomorrow or upgrade for more ⭐',
    fr: 'Limite quotidienne atteinte. Revenez demain ou passez à la version supérieure ⭐'
  },

  NO_CREDITS: {
    ar: 'لا يوجد رصيد كافٍ. قم بالترقية للاستمرار 💳',
    en: 'Not enough credits. Please upgrade to continue 💳',
    fr: 'Pas assez de crédits. Veuillez passer à la version supérieure pour continuer 💳'
  },

  // API Errors
  API_KEY_INVALID: {
    ar: 'حدث خطأ في المصادقة. حاول تسجيل الخروج والدخول مجدداً 🔑',
    en: 'Authentication error. Try logging out and back in 🔑',
    fr: 'Erreur d\'authentification. Essayez de vous déconnecter et reconnecter 🔑'
  },

  RATE_LIMITED: {
    ar: 'طلبات كثيرة! انتظر قليلاً ثم حاول مرة أخرى 🐢',
    en: 'Too many requests! Please wait a moment and try again 🐢',
    fr: 'Trop de requêtes! Veuillez patienter un moment et réessayer 🐢'
  },

  // Generic
  UNKNOWN_ERROR: {
    ar: 'حدث خطأ غير متوقع. حاول مرة أخرى 😅',
    en: 'An unexpected error occurred. Please try again 😅',
    fr: 'Une erreur inattendue s\'est produite. Veuillez réessayer 😅'
  }
};

function getErrorMessage(errorCode, appLanguage = 'en') {
  const lang = ['ar', 'en', 'fr'].includes(appLanguage) ? appLanguage : 'en';
  return errorMessages[errorCode]?.[lang] || errorMessages.UNKNOWN_ERROR[lang];
}

function detectErrorType(error) {
  const message = (error.message || '').toLowerCase();
  const code = (error.code || '').toLowerCase();
  const status = error.status || error.statusCode || 0;
  
  // Network errors
  if (code.includes('enotfound') || code.includes('econnrefused') || message.includes('network') || message.includes('econnrefused')) {
    return 'NO_INTERNET';
  }
  if (code.includes('etimedout') || code.includes('timeout') || message.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return 'RATE_LIMITED';
  }
  if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('forbidden')) {
    return 'API_KEY_INVALID';
  }
  if (status >= 500 || message.includes('server error')) {
    return 'SERVER_ERROR';
  }
  
  // Research errors
  if (message.includes('research') && (message.includes('fail') || message.includes('no result'))) {
    return 'RESEARCH_FAILED';
  }
  
  // Generation errors
  if (message.includes('hook') && (message.includes('fail') || message.includes('error'))) {
    return 'HOOK_GENERATION_FAILED';
  }
  if (message.includes('script') && (message.includes('fail') || message.includes('error'))) {
    return 'SCRIPT_GENERATION_FAILED';
  }
  
  return 'UNKNOWN_ERROR';
}

module.exports = { errorMessages, getErrorMessage, detectErrorType };
