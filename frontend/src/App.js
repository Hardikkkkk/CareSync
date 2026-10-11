import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Box, Spinner } from 'grommet';
import { useAuth0 } from '@auth0/auth0-react';
import { useMutation, gql } from '@apollo/client';
import AppHeader from './components/AppHeader';
import useSmoothScroll from './hooks/useSmoothScroll';
import CustomCursor from './components/CustomCursor';
import { warmUp } from './utils/warmUp';

// Each page is its own chunk, so the heavy code (three.js on Home, charts on the
// manager page) is only downloaded when that page is actually shown.
const loadHome = () => import('./pages/Home');
const loadCareworker = () => import('./pages/Careworker');
const loadManager = () => import('./pages/ManagerDashboard');
const Home = lazy(loadHome);
const Careworker = lazy(loadCareworker);
const ManagerDashboard = lazy(loadManager);

// Start downloading the right page while Auth0 is still checking the session,
// instead of waiting for it. Auth0 keeps its cache in localStorage (see index.js).
const looksLoggedIn = () => {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('@@auth0spajs@@'));
  } catch (e) {
    return false;
  }
};
if (looksLoggedIn()) loadCareworker();
else loadHome();

// Remember the user record so a returning user sees the app instantly.
// It is refreshed from the server on every load, and the backend still
// enforces roles, so this is only a speed-up.
const CACHE_KEY = 'caresync:user';
const readCachedUser = (email) => {
  try {
    const u = JSON.parse(localStorage.getItem(CACHE_KEY));
    return u && u.email === email ? u : null;
  } catch (e) {
    return null;
  }
};
const writeCachedUser = (u) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(u)); } catch (e) { /* storage unavailable */ }
};
const clearCachedUser = () => {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* storage unavailable */ }
};

const CREATE_USER_IF_NOT_EXISTS = gql`
  mutation CreateUserIfNotExists($name: String!, $email: String!) {
    createUserIfNotExists(name: $name, email: $email) {
      id
      name
      email
      role
    }
  }
`;

function Splash() {
  return (
    <Box fill align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Spinner color="#1c7c7d" size="medium" />
    </Box>
  );
}

function AppRoutes() {
  const { user, isAuthenticated, isLoading } = useAuth0();
  const [createUserIfNotExists] = useMutation(CREATE_USER_IF_NOT_EXISTS);
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const syncStarted = useRef(false);

  // Wake the backend and database early so the first login is not slow
  useEffect(() => { warmUp(); }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) clearCachedUser();
  }, [isLoading, isAuthenticated]);

  // One request after login: create the user if new, or return the existing one.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user?.email || syncStarted.current) return;
    syncStarted.current = true;

    // Show the app straight away from the cache, then refresh from the server
    const cached = readCachedUser(user.email);
    if (cached) setLoggedInUser(cached);

    const name = user.name || user.nickname || user.email;

    createUserIfNotExists({ variables: { name, email: user.email } })
      .then(({ data }) => {
        setLoggedInUser(data.createUserIfNotExists);
        writeCachedUser(data.createUserIfNotExists);
      })
      .catch((err) => {
        console.error('User sync error:', err);
        syncStarted.current = false;
        setSyncError(err);
      });
  }, [isLoading, isAuthenticated, user, createUserIfNotExists]);

  // Auth0 is still checking the session, or we are waiting for the user record
  console.log('DEBUG', { isLoading, isAuthenticated, hasUser: !!loggedInUser, error: syncError?.message });
  if (isLoading || (isAuthenticated && !loggedInUser && !syncError)) {
    return <Splash />;
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<Splash />}>
        <Home />
      </Suspense>
    );
  }

  if (syncError && !loggedInUser) {
    return (
      <div style={{ padding: 20 }}>
        <p>We couldn't load your account. Check your connection and try again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <Router>
      <AppHeader user={loggedInUser} />

      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/" element={<Careworker user={loggedInUser} />} />
          <Route
            path="/manager"
            element={
              loggedInUser.role === 'manager'
                ? <ManagerDashboard user={loggedInUser} />
                : <Navigate to="/" replace />
            }
          />
        </Routes>
      </Suspense>
    </Router>
  );
}

// Smooth scrolling and the custom cursor are mounted once, for every screen
function App() {
  useSmoothScroll();
  return (
    <>
      <CustomCursor />
      <AppRoutes />
    </>
  );
}

export default App;