import { AppShell } from '../components/AppShell';
import { AppProvider } from '../lib/store';

export default function Page() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
