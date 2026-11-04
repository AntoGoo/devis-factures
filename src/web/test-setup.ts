import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy*/waitFor attendent 1 s par défaut : trop court quand toute la suite tourne en parallèle.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => cleanup());
