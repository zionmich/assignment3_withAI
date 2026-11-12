const baseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const isConfigured = /^https:\/\/.+\.supabase\.co$/.test(baseUrl);

export async function studyRequest(payload) {
  if (!isConfigured) {
    throw new Error('The study has not been configured. Set VITE_SUPABASE_URL in your .env file.');
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/functions/v1/study-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { apikey: key } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not connect to the study server. Check the connection and try again.');
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || `Server error (${response.status}).`);
    error.code = result.code;
    throw error;
  }
  return result;
}
