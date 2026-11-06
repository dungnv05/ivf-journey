import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import DietPage from './pages/DietPage';
import './App.css';

function App() {
  return (
    <Router>
      <a href="#journey-main" className="skip-link">
        Chuyển đến nội dung hành trình
      </a>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pregnancy-diet" element={<DietPage />} />
      </Routes>
    </Router>
  );
}

export default App;
