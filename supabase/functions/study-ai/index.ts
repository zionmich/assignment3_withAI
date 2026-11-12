// AI condition: the browser receives the saved model prediction,
// but NEVER the ground-truth label or service-role key.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CONDITION = 'with_ai';
// To display scores too, set STUDY_SHOW_AI_CONFIDENCE=true as an Edge Function secret.
const SHOW_MODEL_CONFIDENCE = Deno.env.get('STUDY_SHOW_AI_CONFIDENCE') === 'true';
const TRIAL_COUNT = 8;
const LABELS = new Set([
  'none',
  'hasty generalization',
  'false dilemma',
  'appeal to nature',
  'appeal to authority',
]);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}
function fail(message: string, status = 400, code = 'BAD_REQUEST') {
  return json({ message, code }, status);
}
function tokenString(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
function shuffle<T>(arr: T[]): T[] {
  // Fresh random sample without replacement per participant.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function isValidUniqname(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9]{1,19}$/.test(value);
}
function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// Supabase automatically injects the legacy service-role key in hosted Edge
// Functions. A new secret key may be used instead if configured in SUPABASE_SECRET_KEY.
const adminKey = serviceKey || Deno.env.get('SUPABASE_SECRET_KEY');
if (!url || !adminKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY');
}
const db = createClient(url, adminKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type TrialState =
  | { status: 'completed'; totalTrials: number }
  | {
      status: 'trial';
      trialNumber: number;
      totalTrials: number;
      trial: { comment_id: number; headline: string | null; parent_comment: string | null; comment: string | null; model_prediction: string; model_confidence?: number | null };
    };

type Session = {
  uniqname: string;
  condition: string;
  assigned_comment_ids: number[];
  completed_at: string | null;
};

async function getSession(token: unknown): Promise<Session | null> {
  if (!isToken(token)) return null;
  const hash = await sha256Hex(token);
  const { data, error } = await db
    .from('study_condition_sessions')
    .select('uniqname,condition,assigned_comment_ids,completed_at')
    .eq('token_hash', hash)
    .eq('condition', CONDITION)
    .maybeSingle();
  if (error) throw error;
  return (data as Session | null);
}

async function stateFor(session: Session): Promise<TrialState> {
  const { data: submitted, error } = await db
    .from('study_responses')
    .select('trial_number,comment_id')
    .eq('uniqname', session.uniqname)
    .eq('condition', CONDITION)
    .order('trial_number', { ascending: true });
  if (error) throw error;

  const assignments = session.assigned_comment_ids;
  if (!Array.isArray(assignments) || assignments.length !== TRIAL_COUNT) {
    throw new Error('Invalid participant trial assignment.');
  }
  // Check that the stored sequence has not been changed or skipped.
  for (let index = 0; index < (submitted || []).length; index++) {
    if (
      submitted![index].trial_number !== index + 1 ||
      String(submitted![index].comment_id) !== String(assignments[index])
    ) {
      throw new Error('Saved response sequence does not match assigned trials.');
    }
  }

  if (session.completed_at || (submitted?.length ?? 0) >= TRIAL_COUNT) {
    if (!session.completed_at) {
      const { error: updateError } = await db
        .from('study_condition_sessions')
        .update({ completed_at: new Date().toISOString() })
        .eq('uniqname', session.uniqname)
        .eq('condition', CONDITION)
        .is('completed_at', null);
      if (updateError) throw updateError;
    }
    return { status: 'completed', totalTrials: TRIAL_COUNT };
  }

  const index = (submitted || []).length;
  const nextId = assignments[index];
  const { data: comment, error: trialError } = await db
    .from('200_Tests')
    // The correct label is NEVER queried or sent to the browser.
    .select('comment_id,headline,parent_comment,comment,model_prediction,model_confidence')
    .eq('comment_id', nextId)
    .single();
  if (trialError || !comment) throw trialError || new Error('Trial not found.');
  if (!LABELS.has(comment.model_prediction)) {
    throw new Error('Trial is missing a recognized model prediction.');
  }

  // Return only permitted fields, never the ground-truth label.
  const shownTrial = {
    comment_id: comment.comment_id,
    headline: comment.headline,
    parent_comment: comment.parent_comment,
    comment: comment.comment,
    model_prediction: comment.model_prediction,
    ...(SHOW_MODEL_CONFIDENCE ? { model_confidence: comment.model_confidence } : {}),
  };
  return {
    status: 'trial',
    trialNumber: index + 1,
    totalTrials: TRIAL_COUNT,
    trial: shownTrial,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return fail('POST required.', 405, 'METHOD_NOT_ALLOWED');

  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return fail('Invalid JSON request.');
    }

    if (body.action === 'begin') {
      const uniqname = typeof body.uniqname === 'string' ? body.uniqname.trim().toLowerCase() : '';
      if (!isValidUniqname(uniqname)) return fail('Enter a valid uniqname.');
      if (body.attentionAnswer !== 'none') return fail('Please complete the attention check correctly.', 400, 'ATTENTION_FAILED');

      // Pick the participant's eight trials before their study session is created.
      const { data: comments, error: commentsError } = await db
        .from('200_Tests')
        .select('comment_id')
        .order('comment_id')
        .limit(1000);
      if (commentsError) throw commentsError;
      if (!comments || comments.length < TRIAL_COUNT) {
        return fail('The study dataset does not contain enough comments.', 503, 'MISSING_DATA');
      }
      // Exclude any comments already assigned in the other study condition.
      // This works in either order when both Edge Functions use this logic.
      const otherCondition = 'without_ai';
      const { data: otherSession, error: otherSessionError } = await db
        .from('study_condition_sessions')
        .select('assigned_comment_ids')
        .eq('uniqname', uniqname)
        .eq('condition', otherCondition)
        .maybeSingle();
      if (otherSessionError) throw otherSessionError;
      const assignedElsewhere = new Set(otherSession?.assigned_comment_ids ?? []);
      const eligibleIds = comments.map((row) => row.comment_id).filter((id) => !assignedElsewhere.has(id));
      if (eligibleIds.length < TRIAL_COUNT) return fail('Not enough unused comments for this participant.', 503, 'MISSING_DATA');
      const selectedIds = shuffle(eligibleIds).slice(0, TRIAL_COUNT);
      const token = tokenString();
      const tokenHash = await sha256Hex(token);

      // No separate participants table is used. A session row is the enrollment;
      // UNIQUE (uniqname, condition) prevents repeating the same condition,
      // while letting a student use their uniqname once in the other condition.
      const { error: sessionError } = await db
        .from('study_condition_sessions')
        .insert({
          uniqname,
          condition: CONDITION,
          assigned_comment_ids: selectedIds,
          token_hash: tokenHash,
        });
      if (sessionError) {
        if (sessionError.code === '23505') {
          return fail("You've already completed this study.", 409, 'ALREADY_REGISTERED');
        }
        throw sessionError;
      }

      const firstState = await stateFor({
        uniqname, condition: CONDITION, assigned_comment_ids: selectedIds, completed_at: null,
      });
      return json({ ...firstState, token });
    }

    if (body.action === 'resume') {
      const session = await getSession(body.token);
      if (!session) return fail('This session is no longer valid.', 401, 'INVALID_SESSION');
      return json(await stateFor(session));
    }

    if (body.action === 'submit') {
      const session = await getSession(body.token);
      if (!session) return fail('This session is no longer valid.', 401, 'INVALID_SESSION');
      if (session.completed_at) return fail('This study has already been completed.', 409, 'ALREADY_COMPLETED');
      if (!LABELS.has(body.selectedFallacy)) return fail('Choose a valid fallacy category.');
      const conf = body.participantConfidence;
      if (!Number.isInteger(conf) || conf < 1 || conf > 5) return fail('Confidence must be an integer from 1 to 5.');
      const time = body.timeSpentMs;
      if (!Number.isInteger(time) || time < 0 || time > 3600000) return fail('Invalid trial completion time.');

      const current = await stateFor(session);
      if (current.status === 'completed') return fail('This study has already been completed.', 409, 'ALREADY_COMPLETED');
      if (
        body.trialNumber !== current.trialNumber ||
        String(body.commentId) !== String(current.trial?.comment_id)
      ) {
        // If an earlier save succeeded but its network response was lost,
        // return the current trial rather than accidentally duplicating it.
        return json(current);
      }

      const { error: insertError } = await db.from('study_responses').insert({
        uniqname: session.uniqname,
        condition: CONDITION,
        trial_number: current.trialNumber,
        comment_id: current.trial!.comment_id,
        selected_fallacy: body.selectedFallacy,
        participant_confidence: conf,
        time_spent_ms: time,
      });
      if (insertError) {
        if (insertError.code === '23505') return fail('This answer has already been submitted.', 409, 'DUPLICATE_ANSWER');
        throw insertError;
      }
      return json(await stateFor(session));
    }

    return fail('Unknown action.');
  } catch (error) {
    // Keep internal SQL details off the public interface.
    console.error('study-ai error:', error);
    return fail('The server could not process this request. Please contact the study administrator if it persists.', 500, 'SERVER_ERROR');
  }
});
