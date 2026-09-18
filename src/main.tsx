import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={{ primaryColor: 'teal', defaultRadius: 'md', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
