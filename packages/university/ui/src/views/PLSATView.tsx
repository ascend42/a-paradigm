import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePLSATStore } from '../store/plsatStore';
import { QuestionCard } from '../components/QuestionCard';
import { Timer } from '../components/Timer';
import { Seal } from '../components/Seal';
import type { PLSATExam, Certificate } from '../types';

type Phase = 'intro' | 'exam' | 'review' | 'results';

/** Render a passage string with simple code-block support */
function PassageBlock({ text }: { text: string }) {
  // Split on ```...``` fenced code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="passage-block">
      <div className="passage-content">
        {parts.map((part, i) => {
          if (part.startsWith('```')) {
            // Extract language hint and code body
            const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
            const code = match ? match[2] : part.slice(3, -3);
            return (
              <pre key={i}>
                <code>{code}</code>
              </pre>
            );
          }
          // Render plain text paragraphs (split on double newlines)
          return part.split(/\n\n+/).map((para, j) => (
            <p key={`${i}-${j}`}>{para}</p>
          ));
        })}
      </div>
    </div>
  );
}

/**
 * For a given question index, determine whether we need to show a passage
 * block above it. Returns the passage text if this is the first question in
 * its passage group for the current view, or null otherwise.
 */
function getPassageForIndex(
  _questions: PLSATExam['questions'],
  passages: Record<string, string> | undefined,
  index: number,
): string | null {
  if (!passages) return null;
  const q = _questions[index];
  if (!q.passageId) return null;
  return passages[q.passageId] ?? null;
}

export function PLSATView() {
  const [exam, setExam] = useState<PLSATExam | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [result, setResult] = useState<Certificate | null>(null);

  const { studentName, setStudentName, addCertificate } = usePLSATStore();
  const [nameInput, setNameInput] = useState(studentName);

  useEffect(() => {
    async function loadExam() {
      try {
        const versionsRes = await fetch('/api/plsat');
        const versionsData = await versionsRes.json();
        const best = versionsData.versions?.[0]?.version;
        if (!best) return;
        const examRes = await fetch(`/api/plsat/${best}`);
        if (!examRes.ok) return;
        setExam(await examRes.json());
      } catch {
        // !exam guard below handles the empty state
      } finally {
        setIsLoading(false);
      }
    }
    loadExam();
  }, []);

  const calculateResults = useCallback(() => {
    if (!exam) return;

    const correct = exam.questions.filter((q) => answers[q.id] === q.correct).length;
    const total = exam.questions.length;
    const percentage = Math.round((correct / total) * 100);
    const passed = percentage >= exam.passThreshold * 100;

    const cert: Certificate = {
      name: nameInput || 'Anonymous Scholar',
      score: correct,
      total,
      percentage,
      passed,
      plsatVersion: exam.version,
      frameworkVersion: exam.frameworkVersion,
      date: new Date().toISOString(),
    };

    setResult(cert);
    addCertificate(cert);
    if (nameInput) setStudentName(nameInput);
    setPhase('results');
  }, [exam, answers, nameInput, addCertificate, setStudentName]);

  const handleTimeUp = useCallback(() => {
    calculateResults();
  }, [calculateResults]);

  const handleSubmit = () => {
    calculateResults();
  };

  const startExam = () => {
    setAnswers({});
    setCurrentQ(0);
    setPhase('exam');
  };

  // Pre-compute passage display for the current question in exam mode
  const currentPassageText = useMemo(() => {
    if (!exam || phase !== 'exam') return null;
    return getPassageForIndex(exam.questions, exam.passages, currentQ);
  }, [exam, phase, currentQ]);

  if (isLoading) {
    return <div className="loading">The examination board is convening...</div>;
  }

  if (!exam) {
    return (
      <div className="empty-state">
        <h3>PLSAT Unavailable</h3>
        <p>Could not load the examination. Please try again.</p>
      </div>
    );
  }

  // --- INTRO ---
  if (phase === 'intro') {
    return (
      <div className="plsat-container">
        <div className="plsat-intro">
          <Seal size={100} />
          <h1>The PLSAT</h1>
          <p className="plsat-subtitle">Paradigm Licensure Standardized Assessment Test</p>
          <p className="text-muted">Version {exam.version}</p>
        </div>

        <div className="plsat-rules">
          <h3>Examination Rules</h3>
          <ul>
            <li><strong>{exam.questions.length} questions</strong> covering all aspects of the Paradigm framework</li>
            <li><strong>{Math.floor(exam.timeLimit / 60)} minutes</strong> to complete the examination</li>
            <li><strong>{exam.passThreshold * 100}%</strong> required to pass and receive certification</li>
            <li>All questions are multiple choice (A through E)</li>
            <li>Some questions reference a shared passage — read it carefully</li>
            <li>You may navigate between questions freely</li>
            <li>There is no penalty for guessing — answer every question</li>
            <li>Your certificate will display the PLSAT version for posterity</li>
          </ul>
        </div>

        <div className="text-center">
          <div className="mb-lg">
            <input
              type="text"
              className="name-input"
              placeholder="Enter your name, scholar"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-lg" onClick={startExam}>
            Begin Examination
          </button>
        </div>
      </div>
    );
  }

  // --- EXAM ---
  if (phase === 'exam') {
    const q = exam.questions[currentQ];
    const answeredCount = Object.keys(answers).length;

    return (
      <div className="plsat-container">
        <div className="plsat-timer">
          <Timer
            totalSeconds={exam.timeLimit}
            onTimeUp={handleTimeUp}
            running={true}
          />
          <span className="plsat-progress-text">
            Question {currentQ + 1} of {exam.questions.length} | {answeredCount} answered
          </span>
        </div>

        <div style={{ marginTop: 'var(--space-lg)' }}>
          {currentPassageText && <PassageBlock text={currentPassageText} />}

          <QuestionCard
            number={currentQ + 1}
            question={q.question}
            scenario={q.scenario}
            choices={q.choices}
            correct={q.correct}
            explanation={q.explanation}
            selectedAnswer={answers[q.id]}
            onSelect={(letter) => setAnswers((prev) => ({ ...prev, [q.id]: letter }))}
            showResult={false}
            splitLayout={true}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-lg)' }}>
          <button
            className="btn btn-secondary"
            disabled={currentQ === 0}
            onClick={() => setCurrentQ((p) => p - 1)}
          >
            Previous
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {answeredCount === exam.questions.length && (
              <button className="btn btn-gold" onClick={handleSubmit}>
                Submit Examination
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={currentQ === exam.questions.length - 1}
              onClick={() => setCurrentQ((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>

        {/* Question navigator dots */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: 'var(--space-xl)', justifyContent: 'center' }}>
          {exam.questions.map((qq, i) => (
            <button
              key={qq.id}
              onClick={() => setCurrentQ(i)}
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: i === currentQ ? '2px solid var(--burgundy)' : '1px solid var(--parchment-dark)',
                background: answers[qq.id] ? 'var(--gold-bg)' : 'var(--cream)',
                color: 'var(--ink)',
                fontSize: '0.6875rem',
                cursor: 'pointer',
                fontWeight: i === currentQ ? 600 : 400,
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- RESULTS ---
  if (phase === 'results' && result) {
    return (
      <div className="plsat-container">
        <div className="plsat-results">
          <Seal size={80} />
          <div className={`score-display ${result.passed ? 'passed' : 'failed'}`}>
            {result.percentage}%
          </div>
          <p className="verdict">
            {result.passed
              ? 'Congratulations! You have passed the PLSAT.'
              : 'The examination board regrets to inform you that you did not pass.'}
          </p>
          <p className="text-muted mb-lg">
            Score: {result.score}/{result.total} | PLSAT v{result.plsatVersion} | {new Date(result.date).toLocaleDateString()}
          </p>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            {result.passed && (
              <Link to="/certificate" className="btn btn-gold btn-lg">
                View Certificate
              </Link>
            )}
            <button className="btn btn-secondary" onClick={() => setPhase('review')}>
              Review Answers
            </button>
            <button className="btn btn-primary" onClick={() => setPhase('intro')}>
              {result.passed ? 'Retake' : 'Try Again'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- REVIEW ---
  if (phase === 'review') {
    return (
      <div className="plsat-container">
        <div className="quiz-header">
          <h1>PLSAT Review</h1>
          <p className="quiz-progress">
            {result ? `Score: ${result.score}/${result.total} (${result.percentage}%)` : ''}
          </p>
        </div>

        {exam.questions.map((q, i) => {
          const passageText = getPassageForIndex(exam.questions, exam.passages, i);
          return (
            <div key={q.id}>
              {passageText && <PassageBlock text={passageText} />}
              <QuestionCard
                number={i + 1}
                question={q.question}
                scenario={q.scenario}
                choices={q.choices}
                correct={q.correct}
                explanation={q.explanation}
                selectedAnswer={answers[q.id]}
                onSelect={() => {}}
                showResult={true}
                splitLayout={true}
              />
            </div>
          );
        })}

        <div className="text-center mt-xl">
          <button className="btn btn-primary" onClick={() => setPhase('results')}>
            Back to Results
          </button>
        </div>
      </div>
    );
  }

  return null;
}
