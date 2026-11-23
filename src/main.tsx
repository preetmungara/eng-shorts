import { render } from 'preact';
import { App } from './App';
import './styles.css';

render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && location.protocol !== 'file:' && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
