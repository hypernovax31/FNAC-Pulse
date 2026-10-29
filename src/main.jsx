import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { playStartupSignature } from './startup-sound';
import './styles.css';

playStartupSignature({base:import.meta.env.BASE_URL});
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
