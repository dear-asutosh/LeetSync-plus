import './App.css';
import PopupPage from './pages/popup';
import { ChakraProvider, extendTheme, type ThemeConfig } from '@chakra-ui/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

const config: ThemeConfig = {
  initialColorMode: 'dark',
  useSystemColorMode: false,
};

const theme = extendTheme({ config });

function App() {
  return (
    <BrowserRouter>
      <ChakraProvider theme={theme}>
        <Routes>
          <Route path="/dashboard" element={<h1>Hello from dashboard</h1>} />
          <Route path="*" element={<PopupPage />} />
        </Routes>
      </ChakraProvider>
    </BrowserRouter>
  );
}

export default App;
