export function parseStars(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((x) => Number.isInteger(x) && x >= 1 && x <= 5);
}

export function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function applyReviewFilters(reviews, filters = {}) {
  const stars = Array.isArray(filters.stars) ? filters.stars : parseStars(filters.stars);
  const minRating = Number.parseFloat(String(filters.minRating ?? ''));
  const maxRating = Number.parseFloat(String(filters.maxRating ?? ''));
  const anyKeyword = (filters.anyKeyword || filters.keyword || '').trim().toLowerCase();
  const dateFrom = normalizeDate(filters.dateFrom);
  const dateTo = normalizeDate(filters.dateTo);
  const keyword = (filters.keyword || '').trim().toLowerCase();
  const version = (filters.version || '').trim().toLowerCase();
  const minLength = Number.parseInt(filters.minLength || '0', 10) || 0;
  const replyOnly = String(filters.replyOnly || '').toLowerCase() === 'true';

  return reviews.filter((review) => {
    const rating = Number(review.rating);
    if (Number.isFinite(rating)) {
      if (Number.isFinite(minRating) && rating < minRating) return false;
      if (Number.isFinite(maxRating) && rating > maxRating) return false;
    }
    if (stars.length && !stars.includes(rating)) return false;

    if (dateFrom || dateTo) {
      const reviewDate = normalizeDate(review.date);
      if (!reviewDate) return false;
      if (dateFrom && reviewDate < dateFrom) return false;
      if (dateTo) {
        const inclusiveTo = new Date(dateTo);
        inclusiveTo.setHours(23, 59, 59, 999);
        if (reviewDate > inclusiveTo) return false;
      }
    }

    if (version) {
      const reviewVersion = String(review.version || '').toLowerCase();
      if (!reviewVersion.includes(version)) return false;
    }

    if (anyKeyword) {
      const haystack = [review.title, review.text, review.author, review.version]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const terms = anyKeyword.split(/\s+/u).filter(Boolean);
      if (!terms.some((term) => haystack.includes(term))) return false;
    }

    if (keyword) {
      const haystack = [review.title, review.text, review.author, review.version]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    if (minLength > 0 && String(review.text || '').length < minLength) return false;
    if (replyOnly && !review.replyText) return false;

    return true;
  });
}

export function toCsv(rows) {
  const headers = [
    'platform',
    'appId',
    'rating',
    'title',
    'text',
    'author',
    'date',
    'version',
    'helpful',
    'replyText',
    'url'
  ];

  const escape = (value) => {
    const raw = value == null ? '' : String(value);
    return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };

  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');
}
