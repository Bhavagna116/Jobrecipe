// Shared date/time helpers. Assessment and proctoring times are always shown
// in IST (Asia/Kolkata) so admins see the same clock regardless of where the
// browser or server is located.

export const IST_TIME_ZONE = 'Asia/Kolkata';

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatISTTime = (value) => {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
};

export const formatISTDate = (value) => {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

export const formatISTDateTime = (value, options = {}) => {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    ...options,
  }).format(date);
};
