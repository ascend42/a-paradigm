import React, { useEffect } from 'react';
import { useUniversityStore, type CourseListing, type PlsatVersion, type Diploma } from './store/universityStore';
import { usePlatformStore } from '../../store/platformStore';
import './styles/university.css';

function CourseCard({ course, onSelect }: { course: CourseListing; onSelect: () => void }) {
  return (
    <div className="u-course-card" onClick={onSelect} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect()}>
      <div className="u-course-header">
        <span className="u-course-id">{course.id}</span>
        <span className="u-course-meta">{course.lessonCount} lessons{course.quizCount > 0 ? ` · ${course.quizCount} quizzes` : ''}</span>
      </div>
      <h3 className="u-course-title">{course.title}</h3>
      <p className="u-course-desc">{course.description}</p>
    </div>
  );
}

function PlsatCard({ version }: { version: PlsatVersion }) {
  return (
    <div className="u-plsat-card">
      <div className="u-plsat-header">
        <span className="u-plsat-version">PLSAT {version.version}</span>
        {version.passThreshold && <span className="u-plsat-threshold">Pass: {version.passThreshold}%</span>}
      </div>
      <div className="u-plsat-meta">
        {version.questionCount} questions
        {version.timeLimit ? ` · ${version.timeLimit} min` : ''}
        {version.frameworkVersion ? ` · Framework ${version.frameworkVersion}` : ''}
      </div>
    </div>
  );
}

function DiplomaCard({ diploma }: { diploma: Diploma }) {
  return (
    <div className={`u-diploma-card ${diploma.passed ? 'u-diploma-passed' : 'u-diploma-failed'}`}>
      <div className="u-diploma-header">
        <span className="u-diploma-type">{diploma.type.toUpperCase()}</span>
        <span className="u-diploma-date">{new Date(diploma.earnedAt).toLocaleDateString()}</span>
      </div>
      <div className="u-diploma-score">
        {diploma.score}/{diploma.total} ({diploma.percentage}%)
        {diploma.passed ? ' — Passed' : ' — Not passed'}
      </div>
    </div>
  );
}

export default function UniversitySection() {
  const { courses, plsatVersions, diplomas, coursesLoading, selectedCourse,
          fetchCourses, fetchPlsat, fetchDiplomas, selectCourse } = useUniversityStore();

  useEffect(() => {
    fetchCourses();
    fetchPlsat();
    fetchDiplomas();
    const interval = setInterval(() => {
      if (usePlatformStore.getState().activeSection === 'university') {
        fetchDiplomas();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="u-section">
      <div className="u-header">
        <h1>University</h1>
        <span className="u-subtitle">Courses, certifications, and learning paths</span>
      </div>

      {/* Diplomas */}
      {diplomas.length > 0 && (
        <div className="u-block">
          <h2>Earned Diplomas</h2>
          <div className="u-grid">
            {diplomas.map((d, i) => <DiplomaCard key={d.id || i} diploma={d} />)}
          </div>
        </div>
      )}

      {/* Courses */}
      <div className="u-block">
        <h2>Courses</h2>
        {coursesLoading && <p className="u-loading">Loading courses...</p>}
        {!coursesLoading && courses.length === 0 && (
          <p className="u-empty">No courses available. Run <code>paradigm university</code> to set up content.</p>
        )}
        <div className="u-grid">
          {courses.map(c => (
            <CourseCard key={c.id} course={c} onSelect={() => selectCourse(c.id)} />
          ))}
        </div>
      </div>

      {/* PLSAT Certifications */}
      {plsatVersions.length > 0 && (
        <div className="u-block">
          <h2>PLSAT Certification Exams</h2>
          <div className="u-grid">
            {plsatVersions.map(v => <PlsatCard key={v.version} version={v} />)}
          </div>
        </div>
      )}
    </div>
  );
}
