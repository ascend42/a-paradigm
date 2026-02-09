import { useState } from 'react';

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
    }
  };

  const isCorrect = selected === correct;
  const letters = Object.keys(choices).sort();

  return (
    <div className="question-card">
      <div className="question-number">Question {number}</div>

      {scenario && <div className="scenario">{scenario}</div>}

      <div className="question-text">{question}</div>

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
              <span>{choices[letter]}</span>
            </button>
          );
        })}
      </div>

      {showResult && (
        <div className={`explanation ${isCorrect ? '' : 'wrong'}`}>
          <strong>{isCorrect ? 'Correct!' : `Incorrect. The answer is ${correct}.`}</strong>
          <br />
          {explanation}
        </div>
      )}
    </div>
  );
}
