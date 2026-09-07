// Curated common ISO 4217 codes for the provider course price form's
// currency <select>. Deliberately not exhaustive and not DB-enforced (see
// 20260902260000_course_catalogue_price.sql -- price_currency stays plain
// text, no check constraint) -- a course with a legacy/unlisted currency
// value is still shown as an extra option rather than silently dropped.
export const CURRENCIES = [
  'USD', 'GBP', 'EUR', 'AUD', 'CAD', 'NZD', 'CHF', 'JPY', 'CNY', 'INR',
  'SGD', 'HKD', 'ZAR', 'AED', 'SEK', 'NOK', 'DKK', 'PLN', 'BRL', 'MXN',
]
