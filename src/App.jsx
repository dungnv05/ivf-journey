import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import DietPage from './pages/DietPage';
import ThaiGiaoPage from './pages/ThaiGiaoPage';
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
        <Route path="/thai-giao" element={<ThaiGiaoPage />} />
      </Routes>
    </Router>
  );
}

export default App;
