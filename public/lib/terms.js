// Review term analysis shared by the browser UI and the Node API.
// Goal: surface what reviews are *about* (crash, subscription, filters…), not
// generic sentiment ("great", "bom", "супер") or filler words.

// Filler words + generic praise/complaint words in the supported languages.
export const STOPWORDS = new Set([
  // en
  'the', 'and', 'this', 'that', 'with', 'from', 'have', 'were', 'they', 'your', 'which', 'will', 'app', 'apps', 'very', 'really', 'just', 'more', 'for', 'you', 'she', 'his', 'her', 'their', 'our', 'not', 'but', 'all', 'has', 'had', 'been', 'are', 'was', 'did', 'does', 'can', 'could', 'would', 'should', 'get', 'got', 'like', 'love', 'use', 'using', 'used', 'one', 'two', 'about', 'into', 'out', 'over', 'after', 'before', 'its', 'it’s', "it's", 'i’m', "i'm", "don't", 'don’t', 'when', 'there', 'what', 'even', 'also', 'than', 'then', 'only', 'some', 'too', 'any', 'can’t', "can't", 'dont', 'cant', 'im', 'ive', 'thing', 'things', 'lot', 'much', 'many', 'every', 'because', 'please', 'make', 'makes', 'made', 'still', 'now', 'way', 'time', 'want', 'need', 'how', 'who', 'why', 'where', 'them', 'these', 'those', 'other', 'here', 'well', 'application',
  'good', 'great', 'nice', 'super', 'best', 'excellent', 'awesome', 'amazing', 'perfect', 'cool', 'easy', 'wow', 'thanks', 'thank', 'wonderful', 'fantastic', 'fine', 'okay', 'bad', 'worst', 'terrible', 'horrible', 'poor', 'useless', 'hate', 'loved', 'loving', 'recommend', 'star', 'stars', 'rating',
  // tr
  've', 'bir', 'bu', 'çok', 'ile', 'için', 'ama', 'gibi', 'daha', 'ben', 'sen', 'biz', 'siz', 'var', 'yok', 'olarak', 'olan', 'her', 'şey', 'kadar', 'sonra', 'önce', 'diye', 'hiç', 'veya', 'ancak', 'uygulama', 'uygulamayı', 'uygulamanın', 'uygulaması', 'güzel', 'harika', 'süper', 'mükemmel', 'teşekkürler', 'teşekkür', 'iyi', 'kötü', 'berbat', 'bayıldım', 'tavsiye', 'ederim', 'gerçekten', 'bence', 'olsun', 'olmuş', 'oldu', 'değil', 'neden', 'nasıl', 'bile', 'artık', 'sadece', 'tamam',
  // de
  'und', 'die', 'der', 'das', 'ist', 'nicht', 'nach', 'seit', 'trotz', 'kein', 'keine', 'zwischen', 'ohne', 'weil', 'ich', 'ein', 'eine', 'mit', 'den', 'auf', 'für', 'sich', 'von', 'sie', 'dem', 'auch', 'aber', 'sehr', 'wie', 'nur', 'noch', 'wenn', 'bei', 'man', 'mehr', 'kann', 'habe', 'hat', 'wird', 'oder', 'schon', 'immer', 'gut', 'toll', 'klasse', 'prima', 'schlecht', 'einfach',
  // fr
  'les', 'des', 'est', 'pas', 'que', 'qui', 'pour', 'dans', 'sur', 'après', 'depuis', 'entre', 'sans', 'quand', 'car', 'rien', 'encore', 'elle', 'avec', 'mais', 'plus', 'très', 'tout', 'bien', 'mon', 'mes', 'application', 'appli', 'aux', 'sont', 'fait', 'être', 'génial', 'bon', 'bonne', 'facile', 'nul', 'top',
  // es / pt / it
  'los', 'las', 'del', 'una', 'por', 'con', 'para', 'pero', 'muy', 'más', 'como', 'esta', 'este', 'después', 'entre', 'cuando', 'desde', 'sobre', 'también', 'hasta', 'sin', 'nada', 'porque', 'aplicación', 'todo', 'buena', 'bueno', 'buenísima', 'excelente', 'genial', 'fácil', 'facil', 'mejor', 'encanta', 'gusta', 'perfecta', 'malo', 'mala',
  'uma', 'não', 'com', 'mais', 'depois', 'entre', 'após', 'quando', 'desde', 'sem', 'nada', 'ainda', 'pra', 'porque', 'muito', 'mas', 'meu', 'minha', 'aplicativo', 'isso', 'esse', 'essa', 'está', 'tem', 'bom', 'boa', 'ótimo', 'ótima', 'otimo', 'legal', 'gostei', 'amei', 'melhor', 'perfeito', 'maravilhoso', 'ruim', 'péssimo',
  'che', 'non', 'della', 'molto', 'più', 'dopo', 'tra', 'senza', 'quando', 'perché', 'ancora', 'gli', 'applicazione', 'anche', 'sono', 'questo', 'questa', 'bello', 'bella', 'ottimo', 'ottima', 'bellissima', 'brutto',
  // nl / pl / sv / id
  'het', 'een', 'van', 'dat', 'niet', 'voor', 'zijn', 'maar', 'ook', 'heel', 'wel', 'nog', 'dan', 'bij', 'aan', 'wat', 'geen', 'goed', 'leuk', 'mooi', 'slecht', 'handig',
  'się', 'nie', 'jest', 'jak', 'ale', 'tak', 'aplikacja', 'aplikacji', 'bardzo', 'już', 'mnie', 'tylko', 'czy', 'dobra', 'fajna', 'fajny', 'polecam', 'świetna', 'dziękuję',
  'och', 'att', 'det', 'som', 'för', 'inte', 'med', 'jag', 'bra', 'mycket', 'bästa', 'dålig',
  'yang', 'dan', 'ini', 'itu', 'aku', 'saya', 'tidak', 'bisa', 'ada', 'untuk', 'dengan', 'aplikasi', 'bagus', 'mantap', 'keren', 'suka', 'sangat', 'banget', 'terima', 'kasih', 'baik', 'jelek', 'sih', 'nya', 'coba',
  // ru
  'что', 'это', 'как', 'все', 'так', 'его', 'очень', 'приложение', 'приложения', 'мне', 'при', 'для', 'когда', 'уже', 'нет', 'есть', 'супер', 'отлично', 'отличное', 'хорошо', 'хорошее', 'класс', 'нравится', 'спасибо', 'плохо', 'просто', 'только',
]);

const TERM_PATTERN = /\p{L}[\p{L}\p{M}'’-]*/gu;
const NO_SPACE_SCRIPTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

export function termsOfText(text, exclude) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().match(TERM_PATTERN) || []) {
    const word = raw.replace(/['’-]+$/u, '');
    if (word.length < 3 || word.length > 24 || STOPWORDS.has(word) || NO_SPACE_SCRIPTS.test(word)) continue;
    if (exclude && exclude.has(word)) continue;
    out.add(word); // a review counts once per term
  }
  return out;
}

// Words of the app's own name are never insights ("body", "tune" for Body Tune).
export function nameTokens(...names) {
  const out = new Set();
  for (const name of names) {
    for (const t of String(name || '').toLowerCase().match(TERM_PATTERN) || []) out.add(t);
  }
  return out;
}

function countTerms(reviews, exclude) {
  const counts = new Map();
  for (const r of reviews) {
    for (const term of termsOfText(`${r.title || ''} ${r.text || ''}`, exclude)) counts.set(term, (counts.get(term) || 0) + 1);
  }
  return counts;
}

// Most frequent terms (a review counts once per term).
export function topTerms(reviews, { limit = 8, exclude, minCount = 2 } = {}) {
  const min = reviews.length < 20 ? 1 : minCount;
  return [...countTerms(reviews, exclude)]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

// Terms that are unusually common in `target` compared with `others`
// (e.g. what 1–2★ reviews talk about that 4–5★ reviews don't).
export function distinctiveTerms(target, others, { limit = 10, exclude, minCount = 2 } = {}) {
  if (!target.length) return [];
  const min = target.length < 20 ? 1 : minCount;
  const a = countTerms(target, exclude);
  const b = countTerms(others, exclude);
  const scored = [];
  for (const [term, count] of a) {
    if (count < min) continue;
    const rateA = count / target.length;
    const rateB = ((b.get(term) || 0) + 1) / (others.length + 1);
    const lift = rateA / rateB;
    if (lift < 1.25) continue;
    scored.push({ term, count, score: count * Math.log2(lift) });
  }
  return scored.sort((x, y) => y.score - x.score || y.count - x.count).slice(0, limit).map(({ term, count }) => ({ term, count }));
}
