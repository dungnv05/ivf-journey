import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import DietPage from './pages/DietPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pregnancy-diet" element={<DietPage />} />
      </Routes>
    </Router>
  );
}

export default App;
