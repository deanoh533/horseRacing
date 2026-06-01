import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { RaceDetail } from './pages/RaceDetail';
import { RaceEntries } from './pages/RaceEntries';
import { PredictionSheet } from './pages/PredictionSheet';
import { HorseDetail } from './pages/HorseDetail';
import { Statistics } from './pages/Statistics';
import { Settings } from './pages/Settings';
import { Lab } from './pages/Lab';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/race/:meet/:date/:rcNo" element={<RaceDetail />} />
          <Route
            path="/race/:meet/:date/:rcNo/entries"
            element={<RaceEntries />}
          />
          <Route
            path="/race/:meet/:date/:rcNo/sheet"
            element={<PredictionSheet />}
          />
          <Route
            path="/race/:meet/:date/:rcNo/horse/:chulNo"
            element={<HorseDetail />}
          />
          <Route path="/stats" element={<Statistics />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/lab" element={<Lab />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
