import { render } from 'preact';
import { App } from './App';
import './styles.css';

render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
