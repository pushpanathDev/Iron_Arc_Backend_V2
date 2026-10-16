/** Most rows one page can hold; clients page through totalPages for more. */
const MAX_PAGE_SIZE = 1000;

/** ?page=&limit= from a request, as safe numbers (page from 1, limit 1–1000). */
function pageFromQuery(query, defaultLimit) {
  return {
    page: Math.max(parseInt(query.page) || 1, 1),
    limit: Math.min(Math.max(parseInt(query.limit) || defaultLimit, 1), MAX_PAGE_SIZE),
  };
}

/** Prisma `where.date` for an optional startDate/endDate range (inclusive). */
function dateRange(startDate, endDate) {
  if (!startDate && !endDate) return undefined;
  return {
    ...(startDate ? { gte: new Date(startDate) } : {}),
    ...(endDate ? { lte: new Date(endDate) } : {}),
  };
}

/** One page of rows plus the counts the app pages by. */
const pageResult = (key, rows, total, { page, limit }) => ({ [key]: rows, total, page, limit, totalPages: Math.ceil(total / limit) });

module.exports = { pageFromQuery, dateRange, pageResult };
