import React, { useEffect, useRef, useState } from 'react';
import { isConfigured, studyRequest } from './api.js';

const SESSION_STORAGE_KEY = 'fallacy_with_ai_session_v1';
const FALLACIES = [
  { value: 'none', label: 'No fallacy', definition: 'The comment does not clearly use one of the four listed logical fallacies.' },
  { value: 'hasty generalization', label: 'Hasty generalization', definition: 'Draws a broad conclusion from too little or unrepresentative evidence.' },
  { value: 'false dilemma', label: 'False dilemma', definition: 'Presents a limited set of choices as though no other reasonable alternatives exist.' },
  { value: 'appeal to nature', label: 'Appeal to nature', definition: 'Claims that something is good or right because it is natural, or bad because it is unnatural.' },
  { value: 'appeal to authority', label: 'Appeal to authority', definition: 'Treats an authority figure’s status or claim as sufficient proof, without adequate supporting reasoning or evidence.' },
];
const CONFIDENCE_LEVELS = [
  ['1', 'Not at all confident', 'Mostly guessing; you are very uncertain about your answer.'],
  ['2', 'Slightly confident', 'You have a possible answer but substantial doubts.'],
  ['3', 'Moderately confident', 'Your answer seems plausible, although you are not fully sure.'],
  ['4', 'Very confident', 'You have a strong reason to believe your answer is correct.'],
  ['5', 'Extremely confident', 'You are almost certain your answer is correct.'],
];

export default function App() {
  const [view, setView] = useState('welcome'); // welcome | trial | completed | duplicate | failed
  const [uniqname, setUniqname] = useState('');
  const [attentionAnswer, setAttentionAnswer] = useState('');
  const [attentionError, setAttentionError] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const [trial, setTrial] = useState(null);
  const [trialNumber, setTrialNumber] = useState(1);
  const [totalTrials, setTotalTrials] = useState(8);
  const [choice, setChoice] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [confidenceTouched, setConfidenceTouched] = useState(false);
  const [showConfidenceHelp, setShowConfidenceHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(0);
  const requestActive = useRef(false);

  function showState(result) {
    if (result.status === 'completed') {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setTrial(null);
      setView('completed');
      return;
    }
    if (result.status !== 'trial' || !result.trial) {
      throw new Error('The study server returned an unexpected response.');
    }
    setTrial(result.trial);
    setTrialNumber(result.trialNumber);
    setTotalTrials(result.totalTrials);
    setChoice('');
    setConfidence(3);
    setConfidenceTouched(false);
    setShowConfidenceHelp(false);
    setError('');
    setView('trial');
    // Begin timing when the new trial is displayed.
    startedAt.current = performance.now();
  }

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored || requestActive.current) return;
    requestActive.current = true;
    setBusy(true);
    studyRequest({ action: 'resume', token: stored })
      .then((result) => {
        setSessionToken(stored);
        showState(result);
      })
      .catch((err) => {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setError(`Previous session could not be resumed: ${err.message}`);
        setView('failed');
      })
      .finally(() => {
        setBusy(false);
        requestActive.current = false;
      });
  }, []);

  async function begin(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const normalized = uniqname.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]{1,19}$/.test(normalized)) {
      setError('Enter your UMich uniqname only (no @umich.edu).');
      return;
    }
    if (attentionAnswer !== 'none') {
      setAttentionError(true);
      return;
    }
    setBusy(true);
    try {
      const result = await studyRequest({ action: 'begin', uniqname: normalized, attentionAnswer });
      localStorage.setItem(SESSION_STORAGE_KEY, result.token);
      setSessionToken(result.token);
      showState(result);
    } catch (err) {
      if (err.code === 'ALREADY_REGISTERED') {
        setView('duplicate');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !trial) return;
    if (!choice) { setError('Select a fallacy category before submitting.'); return; }
    if (!confidenceTouched) { setError('Please use the confidence slider before submitting.'); return; }
    setError('');
    const timeSpentMs = Math.max(0, Math.round(performance.now() - startedAt.current));
    setBusy(true);
    try {
      const result = await studyRequest({
        action: 'submit',
        token: sessionToken,
        trialNumber,
        commentId: trial.comment_id,
        selectedFallacy: choice,
        participantConfidence: confidence,
        timeSpentMs,
      });
      showState(result);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!isConfigured) {
    return (
      <Page>
        <h2>Setup required</h2>
        <p>This site needs the Supabase project URL before it can collect responses.</p>
        <p>Copy <code>.env.example</code> to <code>.env</code>, enter your project URL, and follow <code>README.md</code> to deploy the database function.</p>
      </Page>
    );
  }

  return (
    <Page>
      {busy && view === 'welcome' && <p className="status">Connecting to the study...</p>}

      {view === 'welcome' && (
        <>
          <h2>Instructions</h2>
          <p>In this study, you will read short comments on news articles and identify the type of logical fallacy, if any, contained in each comment.</p>
          <p>You will complete <strong>8 questions</strong>. The study is designed to take less than 10 minutes.</p>
          <ol>
            <li>Read the headline, if shown, and any parent comment. Then read the target comment.</li>
            <li>Read the <strong>AI suggestion</strong>. It is an automated prediction, not necessarily the correct answer.</li>
            <li>Select <strong>one</strong> of the five classification options. You can agree with or override the AI.</li>
            <li>Use the 1–5 slider to rate <strong>your confidence in your own answer</strong>, not the quality of the comment.</li>
            <li>Click <strong>Submit answer</strong> to save the answer and continue. You cannot change a submitted answer.</li>
          </ol>
          <p><strong>Category definitions:</strong></p>
          <table className="definition-table"><tbody>
            {FALLACIES.map((item) => (
              <tr key={item.value}><th scope="row">{item.label}</th><td>{item.definition}</td></tr>
            ))}
          </tbody></table>
          <p>This version shows an AI-suggested category for each comment. The suggestion may be incorrect. Make your own final classification, then rate your confidence in your own answer. The site records your classification, confidence rating, and response time. Your uniqname is used to prevent repeated participation in this condition.</p>
          <hr />
          <form onSubmit={begin}>
            <h3>Attention check</h3>
            <label htmlFor="attention">If a comment does not contain any of the listed logical fallacies, which answer should you choose?</label>
            <select id="attention" value={attentionAnswer} onChange={(e) => { setAttentionAnswer(e.target.value); setAttentionError(false); }} required>
              <option value="">-- Select an answer --</option>
              <option value="hasty generalization">Hasty generalization</option>
              <option value="none">No fallacy</option>
              <option value="appeal to authority">Appeal to authority</option>
            </select>
            {attentionError && <p className="error" role="alert">Please review the category definitions and answer the attention check correctly before continuing.</p>}
            <h3>Begin study</h3>
            <label htmlFor="uniqname">UMich uniqname</label>
            <input
              id="uniqname"
              name="uniqname"
              value={uniqname}
              onChange={(e) => setUniqname(e.target.value)}
              maxLength={20}
              placeholder="e.g., jsmith"
              autoComplete="off"
              required
            />
            <p className="note">Enter your uniqname without <code>@umich.edu</code>. You may complete this condition only once. Do not begin until you are ready to complete all 8 questions.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Starting...' : 'Begin study'}</button>
          </form>
        </>
      )}

      {view === 'trial' && trial && (
        <>
          <div className="progress">Question <strong>{trialNumber}</strong> of <strong>{totalTrials}</strong></div>
          {trial.headline?.trim() && <Section title="Article headline">{trial.headline}</Section>}
          {trial.parent_comment?.trim() && <Section title="Parent comment">{trial.parent_comment}</Section>}
          <Section title="Comment to classify"><strong>{trial.comment}</strong></Section>
          <div className="ai-suggestion" aria-label="AI suggested category">
            <div className="block-title">AI suggestion</div>
            <div className="block-content">
              <strong>Predicted category: {FALLACIES.find((item) => item.value === trial.model_prediction)?.label ?? trial.model_prediction}</strong>
              {typeof trial.model_confidence === 'number' && (
                <p className="ai-score">Model confidence score: {(trial.model_confidence * 100).toFixed(1)}%</p>
              )}
              <p className="note">The AI may be wrong. Choose the category you believe is correct, even if it differs from this suggestion.</p>
            </div>
          </div>
          <form onSubmit={submit}>
            <fieldset className="choices">
              <legend><strong>Which logical fallacy is present in this comment?</strong></legend>
              {FALLACIES.map((item) => (
                <label className="option" key={item.value}>
                  <input type="radio" name="fallacy" value={item.value} checked={choice === item.value} onChange={() => setChoice(item.value)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
            <div className="confidence-heading">
              <label htmlFor="confidence"><strong>How confident are you in your answer?</strong></label>
              <button
                className="help-button"
                type="button"
                aria-expanded={showConfidenceHelp}
                aria-label="Explain the five confidence ratings"
                title="What do the confidence scores mean?"
                onClick={() => setShowConfidenceHelp((value) => !value)}
              >?</button>
            </div>
            {showConfidenceHelp && (
              <div className="confidence-help" role="region" aria-label="Confidence scale definitions">
                <strong>Confidence scale definitions</strong>
                <ul>
                  {CONFIDENCE_LEVELS.map(([number, label, definition]) => <li key={number}><strong>{number} — {label}:</strong> {definition}</li>)}
                </ul>
              </div>
            )}
            <div className="slider-container">
              <div className="confidence-readout">
                {confidenceTouched ? `${confidence} — ${CONFIDENCE_LEVELS[confidence - 1][1]}` : 'Move the slider to choose a score'}
              </div>
              <input
                id="confidence"
                className="confidence-slider"
                type="range"
                min="1"
                max="5"
                step="1"
                value={confidence}
                onChange={(e) => { setConfidence(Number(e.target.value)); setConfidenceTouched(true); }}
                onPointerDown={() => setConfidenceTouched(true)}
                onKeyDown={() => setConfidenceTouched(true)}
                aria-valuetext={CONFIDENCE_LEVELS[confidence - 1][1]}
              />
              <div className="slider-ticks"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
              <div className="slider-ends"><span>Not at all confident</span><span>Extremely confident</span></div>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <p className="note">Your response is submitted immediately when you click the button below.</p>
            <button type="submit" disabled={busy}>{busy ? 'Saving...' : trialNumber === totalTrials ? 'Submit final answer' : 'Submit answer & next'}</button>
          </form>
        </>
      )}

      {view === 'completed' && (
        <>
          <h2>Study completed</h2>
          <p>Thank you. Your responses have been saved successfully.</p>
          <p>You have completed the <strong>with AI</strong> condition.</p>
          <p>You may close this page.</p>
        </>
      )}

      {view === 'duplicate' && (
        <>
          <h2>You've already completed this study.</h2>
          <p>This uniqname has already been registered for the <strong>with AI</strong> condition. Only one attempt is permitted per uniqname.</p>
          <p>If you believe this is an error or you lost access to an incomplete attempt, contact the study administrator.</p>
        </>
      )}

      {view === 'failed' && (
        <>
          <h2>Could not resume the study</h2>
          <p className="error">{error}</p>
          <p>Your previous session could not be restored. If you already registered your uniqname, contact the study administrator rather than registering again.</p>
        </>
      )}
    </Page>
  );
}

function Section({ title, children }) {
  return <div className="comment-block"><div className="block-title">{title}</div><div className="block-content">{children}</div></div>;
}

function Page({ children }) {
  return <div className="page"><header><h1>Logical Fallacy Classification Study</h1><div className="subtitle">Human-AI Interaction · AI-assisted task</div></header><main>{children}</main></div>;
}
