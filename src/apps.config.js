// ─────────────────────────────────────────────────────────────────────────
//  CyberDash — app registry
//
//  This is the only file you normally need to edit. Add one object per app.
//
//    id       unique short string (used internally)
//    name     label shown in the dock tooltip
//    icon     an emoji, OR a path/URL to an image (e.g. "/icons/myhours.png")
//    url      where the app lives (loaded in the host browser, so localhost
//             refers to your machine exactly as it does today)
//    embed    true  → try to load inside the dashboard (iframe)
//             false → always open in a new browser tab
//             Some apps refuse to be iframed (they send X-Frame-Options or a
//             CSP frame-ancestors header). For those, set embed:false and the
//             dock will open them in a new tab instead.
// ─────────────────────────────────────────────────────────────────────────

export const apps = [
  {
    id: 'myhours',
    name: 'MyHours',
    icon: '/icons/myhours.svg',
    url: 'http://localhost:8026',
    embed: true,
  },
  {
    id: 'cybernewshub',
    name: 'CyberNewsHub',
    icon: '/icons/cybernewshub.svg',
    url: 'http://localhost:8030',
    embed: true,
  },
  {
    id: 'secanalysis',
    name: 'SecAnalysis',
    icon: '/icons/secanalysis.svg',
    url: 'http://localhost:8090',
    embed: true,
  },
  {
    id: 'peoplemanager',
    name: 'PeopleManager',
    icon: '/icons/peoplemanager.svg',
    url: 'http://localhost:8081',
    embed: true, // CSP frame-ancestors must allow both the browser shell
    //              (http://localhost:5173) and the native .deb (tauri://localhost)
  },
  {
    id: 'rcdb',
    name: 'Retro Computer DB',
    icon: '/icons/rcdb.svg',
    url: 'http://localhost:8031',
    embed: true, // CSP frame-ancestors must allow both the browser shell
    //              (http://localhost:5173) and the native .deb (tauri://localhost)
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: '/icons/subscriptions.svg',
    url: 'http://localhost:8032',
    embed: true,
  }
  // Add more apps here, e.g.:
  // { id: 'grafana', name: 'Grafana', icon: '📊', url: 'http://localhost:3000', embed: false },
]
