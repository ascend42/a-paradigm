import { Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { HomeView } from './views/HomeView';
import { CourseView } from './views/CourseView';
import { QuizView } from './views/QuizView';
import { PLSATView } from './views/PLSATView';
import { ReferenceView } from './views/ReferenceView';
import { CertificateView } from './views/CertificateView';

declare const __PARADIGM_VERSION__: string;

function App() {
  return (
    <div className="app">
      <Header version={__PARADIGM_VERSION__} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomeView />} />
          <Route path="/course/:courseId" element={<CourseView />} />
          <Route path="/course/:courseId/quiz/:lessonId" element={<QuizView />} />
          <Route path="/plsat" element={<PLSATView />} />
          <Route path="/reference" element={<ReferenceView />} />
          <Route path="/certificate" element={<CertificateView />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
