import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  useMediaQuery,
} from '@mui/material'

function AppThemeProvider({ children }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')

  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: prefersDark ? 'dark' : 'light',
          primary: { main: '#3f51b5' }, // matches link color in your CSS
        },
        shape: { borderRadius: 10 },
        components: {
          MuiPaper: {
            defaultProps: { elevation: 0 },
            styleOverrides: {
              root: {
                borderRadius: 12,
              },
            },
          },
          MuiButton: {
            styleOverrides: {
              root: {
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 10,
              },
            },
          },
          MuiSelect: {
            styleOverrides: {
              outlined: {
                borderRadius: 10,
              },
            },
          },
          MuiTextField: {
            styleOverrides: {
              root: {
                borderRadius: 10,
              },
            },
          },
          MuiAlert: {
            styleOverrides: {
              root: {
                borderRadius: 10,
              },
            },
          },
        },
      }),
    [prefersDark]
  )

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppThemeProvider>
      <App />
    </AppThemeProvider>
  </React.StrictMode>
)