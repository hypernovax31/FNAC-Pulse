import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { VisibleFeedbackProvider } from './VisibleFeedback.jsx';
import './styles.css';

// Un lien d'action Firebase ouvre sa page indépendante : ne pas monter
// l'application ni toucher aux sessions pendant le choix du mot de passe.
if (!window.__fnacEmailActionMode) {
  createRoot(document.getElementById('root')).render(<React.StrictMode><VisibleFeedbackProvider placement="page"><App /></VisibleFeedbackProvider></React.StrictMode>);
}
