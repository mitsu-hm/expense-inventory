import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BRAND } from '../shared/config';
import { App } from './App';
import './styles.css';

document.title = BRAND.name;
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
