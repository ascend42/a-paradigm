import { useState } from 'react';
import { renderMarkdown } from '../utils/renderMarkdown';

interface QuestionCardProps {
  number: number;
  question: string;
  scenario?: string;
  choices: Record<string, string>;
  correct: string;
  explanation: string;
  /** If provided, controlled mode (PLSAT) — no immediate feedback */
  selectedAnswer?: string;
  onSelect?: (letter: string) => void;
  /** If true, show results (quiz review / PLSAT review mode) */
  showResult?: boolean;
  /** Fires in uncontrolled (quiz) mode after user picks an answer */
  onAnswered?: (letter: string) => void;
  /** If true, render as two-column layout (question left, choices right) */
  splitLayout?: boolean;
}

export function QuestionCard({
  number,
  question,
  scenario,
  choices,
  correct,
  explanation,
  selectedAnswer: controlledAnswer,
  onSelect,
  showResult: controlledShowResult,
  onAnswered,
  splitLayout,
}: QuestionCardProps) {
  // Uncontrolled mode for course quizzes
  const [localAnswer, setLocalAnswer] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  const isControlled = onSelect !== undefined;
  const selected = isControlled ? (controlledAnswer || null) : localAnswer;
  const showResult = isControlled ? controlledShowResult : showExplanation;

  const handleSelect = (letter: string) => {
    if (showResult && !isControlled) return; // Already answered in quiz mode
    if (isControlled) {
      onSelect?.(letter);
    } else {
      setLocalAnswer(letter);
      setShowExplanation(true);
      onAnswered?.(letter);
    }
  };

  const isCorrect = selected === correct;
  const letters = Object.keys(choices).sort();

  const questionContent = (
    <>
      <div className="question-number">Question {number}</div>

      {scenario && (
        <div
          className="scenario"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(scenario) }}
        />
      )}

      <div className="question-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(question) }} />
    </>
  );

  const choicesContent = (
    <div className="choices">
      {letters.map((letter) => {
        let className = 'choice-btn';
        if (selected === letter) className += ' selected';
        if (showResult && letter === correct) className += ' correct';
        if (showResult && selected === letter && letter !== correct) className += ' incorrect';

        return (
          <button
            key={letter}
            className={className}
            onClick={() => handleSelect(letter)}
            disabled={showResult && !isControlled}
          >
            <span className="choice-letter">{letter}.</span>
            <span dangerouslySetInnerHTML={{ __html: renderMarkdown(choices[letter]) }} />
          </button>
        );
      })}
    </div>
  );

  if (splitLayout) {
    return (
      <div className="question-card">
        <div className="question-split-layout">
          <div className="question-content">
            {questionContent}
          </div>
          <div className="answer-choices">
            {choicesContent}
          </div>
        </div>

        {showResult && (
          <div className={`explanation ${isCorrect ? '' : 'wrong'}`}>
            <strong>{isCorrect ? 'Correct!' : `Incorrect. The answer is ${correct}.`}</strong>
            <br />
            <span dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation) }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="question-card">
      {questionContent}
      {choicesContent}

      {showResult && (
        <div className={`explanation ${isCorrect ? '' : 'wrong'}`}>
          <strong>{isCorrect ? 'Correct!' : `Incorrect. The answer is ${correct}.`}</strong>
          <br />
          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(explanation) }} />
        </div>
      )}
    </div>
  );
}
