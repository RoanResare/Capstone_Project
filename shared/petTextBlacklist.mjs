// Application moderation policy, grouped for review and extension. These are
// explicit terms, not language detection. Neutral identities and ordinary
// veterinary wording are excluded; targeted abusive phrases are included.
export const petTextBlacklist = {
  english: [
    "fuck", "fucker", "fuckers", "fucking", "motherfucker", "motherfucking", "fuckoff", "fuckyou", "fuk", "phuck",
    "shit", "shitty", "bullshit", "horseshit", "shithead", "shite", "shyt", "dipshit", "dumbass", "jackass", "asshole", "arsehole",
    "bitch", "bitches", "sonofabitch", "bastard", "cunt", "dick", "dickhead", "prick", "pussy", "cocksucker", "cock sucker",
    "whore", "slut", "slutty", "porn", "porno", "pornography", "blowjob", "handjob", "rimjob", "wanker", "tosser", "twat", "bollocks", "bugger",
    "damn", "goddamn", "god damn", "dammit", "damnit",
  ],
  tagalogAndRegional: [
    "puta", "putangina", "putanginamo", "putanginaka", "tangina", "tanginamo", "tanginaka", "tanginanyo", "tanginaniyo",
    "tanginamong", "tanginang", "tangena", "taena", "taenamo", "taenaka", "pota", "potangina", "pukinangina", "punyeta", "puneta",
    "gago", "gaga", "gagoka", "tanga", "tangaka", "bobo", "boboka", "ulol", "ulolka", "tarantado", "tarantada", "inutil",
    "pakshit", "pakyu", "pakyou", "kantot", "kantutan", "iyot", "iyotin", "burat", "tite", "titi", "pekpek", "puki", "jakol",
    "yawa", "yawa ka", "piste", "pisti", "pistengyawa", "pistingyawa", "atay", "bilat", "bilatan", "buang", "boang", "lintik", "leche", "hinayupak", "hayop ka",
    "siraulo", "sira ulo", "bugok", "sinto-sinto", "sintosinto", "sinto", "baliw", "loko", "loka", "engot", "unggoy", "punyemas",
  ],
  indonesianAndMalay: [
    "goblok", "goblog", "gobleg", "gobloknya", "goblokmu", "gobloklah", "goblokbanget", "gblk",
    "tolol", "tololnya", "tololmu", "dungu", "bangsat", "bangsatnya", "bajingan", "brengsek", "kampret", "keparat", "bedebah",
    "anjing", "anjir", "anjrit", "anjay", "kontol", "kuntul", "memek", "ngentot", "ngewe", "pantek", "pukimak", "pukima",
    "kimak", "pundek", "pundik", "butoh", "sialan", "sial", "jancok", "jancuk", "dancok", "cok", "cuk", "asu", "ndasmu",
    "bodoh", "bodoh kau", "babi", "celaka", "lancau", "lanciao", "cipap", "jubor", "bengong", "setan", "sundal", "jalang",
    "otak udang", "muka tembok", "anjing kau", "babi kau", "kepala otak", "kurang ajar",
  ],
  vietnamese: [
    // Tone marks are folded by normalize(), so include canonical spellings;
    // the matcher also catches their unaccented forms and punctuation variants.
    "đồ ngốc", "ngu thế", "ngu ngốc", "đồ ngu", "thằng ngu", "con ngu", "đồ khốn", "đồ chó", "đồ điên",
    "đần", "ngốc", "ngu", "khốn nạn", "đĩ", "đồ mất dạy", "mất dạy", "cút đi", "địt mẹ", "đụ mẹ", "địt con mẹ",
    "đồ vô dụng", "đồ rác rưởi", "thằng chó", "con chó", "đồ hèn", "bệnh hoạn",
  ],
  discriminatoryAbuse: [
    "nigger", "nigga", "niggah", "negrohead", "coon", "chink", "gook", "kike", "spic", "wetback", "beaner", "raghead", "towelhead", "sandnigger",
    "faggot", "fag", "dyke", "tranny", "shemale", "poofter", "poof", "sodomite", "retard", "retarded", "mongoloid",
    "baklang salot", "salot na bakla", "bading na salot", "kill all gays", "kill gay people", "kill trans people",
    "gay people are disgusting", "trans people are disgusting", "white power", "heil hitler", "sieg heil",
    "banci", "bencong", "pondan", "bapok", "pédé", "pédé de merde", "maricon", "maricón", "schwuchtel", "пидор", "пидорас",
  ],
  spanishAndPortuguese: [
    "mierda", "joder", "jodete", "jódete", "pendejo", "pendeja", "cabron", "cabrón", "cabrona", "coño", "cono", "carajo", "gilipollas", "chingada", "chingado", "chingatumadre",
    "hijodeputa", "hijaputa", "culero", "culera", "verga", "pinche", "puto", "putain", "porra", "caralho", "merda", "foder", "fodase", "buceta", "viado", "filhodaputa",
  ],
  frenchGermanItalianDutch: [
    "merde", "salaud", "salope", "connard", "connasse", "encule", "enculé", "bordel", "scheisse", "scheiße", "arschloch", "fick", "ficken", "fotze", "hurensohn",
    "stronzo", "stronza", "cazzo", "vaffanculo", "puttana", "troia", "minchia", "klootzak", "kankerhoer", "godverdomme", "kut", "lul", "teringlijer",
  ],
  southAsianAndRomanized: [
    "bhenchod", "behenchod", "bahenchod", "madarchod", "maderchod", "chutiya", "chutia", "chutiye", "bhosdike", "bhosdi", "bhosda", "bhosdika", "gaand", "gandu", "randi", "harami", "kamine", "kamina", "lavde", "lavda", "lodu", "lund", "chakka",
    "முட்டாள்", "புண்டை", "தேவடியா", "மயிரு", "போடா", "चूतिया", "मादरचोद", "बहनचोद", "भोसड़ी", "हरामी", "गांडू", "रंडी",
  ],
  russianAndArabic: [
    "сука", "блядь", "блять", "хуй", "пизда", "ебать", "нахуй", "пошел нахуй", "cyka", "blyat", "blyad", "kurwa", "pierdol", "jebać",
    "كس امك", "كسامك", "كسمك", "شرموطة", "قحبة", "زب", "خول", "ابن الكلب", "ابن القحبة",
  ],
};

// These scripts commonly omit spaces between words; match inside a sentence.
export const unsegmentedPetTextBlacklist = [
  "肏", "操你妈", "草泥马", "他妈的", "你妈的", "傻逼", "傻屄", "煞笔", "妈逼", "王八蛋", "狗娘养", "婊子", "贱人", "屌你", "屌你老母", "冚家铲", "仆街", "扑街", "死基佬",
  "くそ", "クソ", "ちくしょう", "畜生", "死ね", "くたばれ", "씨발", "시발", "씨팔", "개새끼", "병신", "좆", "꺼져", "เหี้ย", "สัส", "ควย", "เย็ด", "อีดอก",
];
