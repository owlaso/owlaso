export { toCsv } from '../public/lib/csv.js';

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

function endOfDay(value) {
  const date = normalizeDate(value);
  if (!date) return null;
  // A bare "YYYY-MM-DD" means the whole day (UTC), not its first millisecond.
  if (/^\d{4}-\d{2}-\d{2}$/u.test(String(value).trim())) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function terms(value) {
  return String(value || '').trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

function haystackOf(review) {
  return [review.title, review.text, review.author, review.version].filter(Boolean).join(' ').toLowerCase();
}

// Filters:
//   stars=1,2          exact star values
//   minRating/maxRating inclusive range (swapped when given the wrong way round)
//   allKeywords        every whitespace-separated term must appear
//   anyKeyword         at least one term must appear
//   keyword            the exact phrase must appear
//   version, dateFrom, dateTo, minLength, replyOnly
export function applyReviewFilters(reviews, filters = {}) {
  const stars = Array.isArray(filters.stars) ? filters.stars : parseStars(filters.stars);
  let minRating = Number.parseFloat(String(filters.minRating ?? ''));
  let maxRating = Number.parseFloat(String(filters.maxRating ?? ''));
  if (Number.isFinite(minRating) && Number.isFinite(maxRating) && minRating > maxRating) {
    [minRating, maxRating] = [maxRating, minRating];
  }
  const ratingFilter = stars.length > 0 || Number.isFinite(minRating) || Number.isFinite(maxRating);
  const allTerms = terms(filters.allKeywords);
  const anyTerms = terms(filters.anyKeyword);
  const phrase = String(filters.keyword || '').trim().toLowerCase();
  const dateFrom = normalizeDate(filters.dateFrom);
  const dateTo = endOfDay(filters.dateTo);
  const version = String(filters.version || '').trim().toLowerCase();
  const minLength = Number.parseInt(filters.minLength || '0', 10) || 0;
  const replyOnly = String(filters.replyOnly || '').toLowerCase() === 'true';
  const needsText = allTerms.length > 0 || anyTerms.length > 0 || phrase !== '';

  return reviews.filter((review) => {
    if (ratingFilter) {
      const rating = Number(review.rating);
      if (!Number.isFinite(rating)) return false;
      if (Number.isFinite(minRating) && rating < minRating) return false;
      if (Number.isFinite(maxRating) && rating > maxRating) return false;
      if (stars.length && !stars.includes(rating)) return false;
    }

    if (dateFrom || dateTo) {
      const reviewDate = normalizeDate(review.date);
      if (!reviewDate) return false;
      if (dateFrom && reviewDate < dateFrom) return false;
      if (dateTo && reviewDate > dateTo) return false;
    }

    if (version && !String(review.version || '').toLowerCase().includes(version)) return false;

    if (needsText) {
      const haystack = haystackOf(review);
      if (allTerms.length && !allTerms.every((term) => haystack.includes(term))) return false;
      if (anyTerms.length && !anyTerms.some((term) => haystack.includes(term))) return false;
      if (phrase && !haystack.includes(phrase)) return false;
    }

    if (minLength > 0 && String(review.text || '').length < minLength) return false;
    if (replyOnly && !review.replyText) return false;

    return true;
  });
}
