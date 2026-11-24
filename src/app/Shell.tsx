import { type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMediaQuery } from '@mantine/hooks';
import { IconCalendarEvent, IconHistory, IconBooks, IconChartLine, IconDots } from '@tabler/icons-react';
import { t, type MsgKey } from '../i18n';
import { UpdatePrompt } from '../components/banners';

const TABS: { to: string; key: MsgKey; icon: typeof IconBooks; match: RegExp }[] = [
  { to: '/', key: 'nav.today', icon: IconCalendarEvent, match: /^\/$/ },
  { to: '/history', key: 'nav.history', icon: IconHistory, match: /^\/history/ },
  { to: '/library', key: 'nav.library', icon: IconBooks, match: /^\/library/ },
  { to: '/progress', key: 'nav.progress', icon: IconChartLine, match: /^\/progress/ },
  { to: '/more', key: 'nav.more', icon: IconDots, match: /^\/(more|programs|templates|settings|backup|import|migration|install|dev)/ },
];

/** FND-05 AC1: bottom tab bar on phones, left rail from 1024 px. */
export function Shell({ children }: { children: ReactNode }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const { pathname } = useLocation();
  const nav = (
    <nav className={wide ? 'w-rail' : 'w-tabbar'} aria-label={t('app.name')} data-testid={wide ? 'nav-rail' : 'nav-tabbar'} style={wide ? undefined : { display: 'flex' }}>
      {TABS.map(({ to, key, icon: Icon, match }) => (
        <NavLink key={to} to={to} className={match.test(pathname) ? 'active' : ''} aria-current={match.test(pathname) ? 'page' : undefined}>
          <Icon size={wide ? 26 : 24} stroke={1.8} aria-hidden />
          <span>{t(key)}</span>
        </NavLink>
      ))}
    </nav>
  );
  return (
    <>
      {nav}
      <main className="w-main">
        <UpdatePrompt />
        {children}
      </main>
    </>
  );
}
