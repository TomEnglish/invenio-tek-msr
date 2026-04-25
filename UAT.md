# MSR Dashboard — User Acceptance Testing

Scope of this document: validate the Invenio design-system restyle (commits `608eca4` → `9613606` on `main`) before declaring it production-ready. This UAT does **not** cover Supabase data accuracy, Python sync scripts, or business logic — only the user-facing app behavior that changed.

**Estimated total time:** 60–90 minutes if all manual; ~30 minutes with automation in place.

---

## Legend

- 🤖 **Automatable** — can be covered by Playwright/headless-Chrome
- 👤 **One human** — requires visual judgment, can be done by anyone with access
- 👥 **Multiple humans / sessions** — needs a second user, second device, or coordinated timing
- ⚠️  **Risk-flagged** — area I changed but couldn't visually verify in development

---

## 0. Pre-test setup

### Accounts and access
- [ ] Two Supabase user accounts in project `lzroduricxyshgyjdkki` (one owner-level, one regular)
- [ ] Access to the Supabase dashboard for the same project (to seed test data and trigger real-time events)

### Devices and browsers
| Browser | Light | Dark | Mobile (≤768px) | Notes |
|---|---|---|---|---|
| Chrome (latest) | required | required | required | Primary target |
| Safari (macOS, latest) | required | required | optional | Webkit-specific quirks |
| Firefox (latest) | optional | optional | optional | Sanity only |
| Edge (latest) | optional | optional | optional | Same engine as Chrome |
| iOS Safari | optional | optional | required | PWA install path |

### Tools to have open
- DevTools console (catch JS errors)
- Network tab (verify cache-bust query strings are loading new files)
- Lighthouse panel (for §6 performance / a11y)

---

## 1. Per-page visual sweep — light + dark mode

**Goal:** every page renders cleanly in both themes with no white bleed, broken layouts, or contrast failures.

**Automation:** 🤖 fully automatable via Playwright + screenshot diff. See [§ Automation playbook](#automation-playbook) at the bottom. Manual fallback below.

For each page, in both `light` and `dark` mode, verify:
1. Sidebar logo is legible and on-brand
2. Top header shows search, theme toggle (sun/moon), and bell — no misalignment
3. No white panels or rows leaking through where dark surfaces are expected
4. Status badges, chips, and buttons use brand colors (teal, sky, success green, amber warn, red danger, purple info)
5. Text is readable (contrast not washed out)
6. No layout breakage (overlapping cards, scrollbar in wrong place, etc.)

| Page | Light ✅ | Dark ✅ | Notes |
|---|---|---|---|
| `index.html` (Dashboard) | [ ] | [ ] | Hero gradient, 4 KPI cards, 3 charts, milestones list |
| `shipment-visibility.html` | [ ] | [ ] | `#cargoTableBody` rows ⚠️ |
| `inventory.html` | [ ] | [ ] | `#inventoryTableBody` rows ⚠️ |
| `outside-shop-inventory.html` | [ ] | [ ] | Custom thead pattern, status badges |
| `shop-contacts.html` | [ ] | [ ] | Card grid layout |
| `gap-analysis.html` | [ ] | [ ] | New hero-banner pattern, gap/available cards, priority badges |
| `material-tracking.html` | [ ] | [ ] | ⚠️ Forms heavy, multiple status warning banners |
| `delivery-dates.html` | [ ] | [ ] | `#deliveryTableBody` rows + calendar grid ⚠️ |
| `project-schedule.html` | [ ] | [ ] | `#scheduleTableBody` + timeline view + Chart.js ⚠️ |
| `samsara-tracking.html` | [ ] | [ ] | ⚠️ Map widget — third-party tile theme will not flip |
| `site-plan.html` | [ ] | [ ] | ⚠️ SVG-heavy, custom fills |
| `receiving.html` | [ ] | [ ] | Status badges (warn-soft palette) |
| `admin.html` | [ ] | [ ] | ⚠️ Data browser — pagination, edit modals, large tables |
| `login.html` | [ ] | [ ] | Inline white I on gradient panel |

**Pass criteria:** every cell checked; no white-on-white in dark mode; no dark-on-dark in light mode; all status colors readable.

**Known limitation:** Samsara map tiles, embedded PDF viewers, or other third-party content won't follow the theme. That's expected — flag only if it breaks usability.

---

## 2. Theme toggle behavior

**Goal:** sun/moon toggle in the top header works everywhere and persists.

**Automation:** 🤖 partially automatable (Playwright can click toggle and assert `data-theme` attribute + screenshot delta).

| Test | Type | Steps |
|---|---|---|
| 2.1 Toggle from light → dark | 🤖 | Open `index.html`, confirm light. Click moon icon. Verify `<html data-theme="dark">`, sun icon now visible, full app re-paints dark. |
| 2.2 Toggle from dark → light | 🤖 | Reverse of 2.1. |
| 2.3 Persistence across page navigation | 🤖 | Toggle dark on `index.html`. Navigate to each of the other 13 pages via sidebar. Each page loads in dark mode with no flash. |
| 2.4 Persistence across full reload | 🤖 | Toggle dark, hit Cmd+R. Page reloads in dark with no FOUC (white flash). |
| 2.5 Persistence across browser restart | 👤 | Toggle dark, fully quit and relaunch browser. Open the app — still dark. |
| 2.6 OS preference fallback | 👤 | Clear `localStorage["invenio-theme"]` in DevTools. Set OS to dark mode. Open app → loads dark. Set OS to light → reload → loads light. |
| 2.7 Charts re-render on toggle | 🤖 | On `index.html`, toggle theme. The 3 charts repaint with correct grid colors and tooltip backgrounds — no need to reload. Same for `project-schedule.html` timeline. |
| 2.8 Sidebar logo swap on toggle | 🤖 | Toggle dark — sidebar logo changes from `invenio-lockup.svg` to `invenio-lockup-dark.svg` (text color flips). |
| 2.9 Toggle button keyboard accessible | 👤 | Tab to the toggle, hit Space/Enter — should toggle. Visible focus ring. |

---

## 3. Functional regression — JS files I touched

**Goal:** verify code paths in `dashboard.js`, `branding.js`, `sidebar.js`, `chart-theme.js` haven't broken existing behavior.

**Automation:** 🤖 mostly automatable for happy paths; some failure-mode tests need manual triggers.

### 3.1 Dashboard (`dashboard.js`) ⚠️
- [ ] 🤖 KPI cards load real numbers (not stuck on spinner) — wait up to 10s
- [ ] 🤖 No console errors on page load
- [ ] 🤖 `#poStatusChart` renders with the new teal-led palette
- [ ] 🤖 `#shipmentStatusChart` renders, bars use teal/pink/sky leading
- [ ] 🤖 `#disciplineChart` two-series — Total Items teal, Field Hours pink
- [ ] 👤 Tab switching (Overview / Procurement / Shipments / Installation) works
- [ ] 👤 "Export PDF" button generates a sensible PDF — see § 5
- [ ] 👥 Real-time toast appears when another session writes to a relevant Supabase table — see § 7

### 3.2 Sidebar (`sidebar.js`)
- [ ] 🤖 Sidebar injects on every page (the 14 pages above)
- [ ] 🤖 Active nav link highlighted on current page (sky-soft bg + sky text)
- [ ] 👤 Sidebar collapse button (top-left) toggles sidebar; icon flips bars↔times
- [ ] 👤 Mobile (≤768px): sidebar overlays page content; backdrop scrim visible
- [ ] 👤 Sign Out button at the bottom of the sidebar — clicking it clears session and redirects to `login.html`
- [ ] 👤 User initials avatar populates from logged-in email

### 3.3 Branding (`branding.js`)
- [ ] 🤖 Page title: "MSR Dashboard — Greenfield LNG Terminal" on `index.html`
- [ ] 🤖 `BRANDING.projectName` is rendered into the hero on `index.html`
- [ ] 🤖 Logo is `brand/invenio-lockup.svg` in light, `brand/invenio-lockup-dark.svg` in dark (covered by 2.8)

### 3.4 Chart theme (`chart-theme.js`)
- [ ] 🤖 `Chart.invenioPalette()`, `Chart.invenioToken('primary')`, `Chart.invenioSurface()` are exposed on `window.Chart`
- [ ] 🤖 Chart axes/gridlines/tooltips use token colors (not Chart.js defaults)
- [ ] 🤖 MutationObserver re-applies theme on `data-theme` attribute change (covered by 2.7)

---

## 4. Forms and user input

**Goal:** form-related Bootstrap overrides in `styles.css` haven't broken submission, validation, or focus behavior.

**Automation:** 🤖 happy paths automatable; visual focus styling needs human eye.

| Form | Type | Test |
|---|---|---|
| Login (`login.html`) | 🤖 | Submit valid credentials → redirects to `index.html`. Submit invalid → red error banner appears. |
| Login focus ring | 👤 | Tab through email and password — focus ring is sky-700 with 3px soft halo. |
| Material tracking add link | 👤 | On `material-tracking.html`, add a new PO-to-tag link. Verify save works and table updates. |
| Admin data browser | 👤 | On `admin.html`, click a row to edit. Modal opens. Edit a field, save. Row updates without reload. |
| Search box (top header) | 👤 | Type in the search box on any page. No console error. (Search may be a no-op currently — that's fine, just check it doesn't break.) |
| Form-check checkbox | 👤 | If any page has checkboxes (admin filters), verify they render with the sky-700 fill when checked, not Bootstrap blue. |
| Date range filters | 👤 | On `delivery-dates.html` and `project-schedule.html`, change date filters → table re-filters. |

---

## 5. PDF export and print

**Goal:** the rewritten `@media print` block in `styles.css` produces usable PDFs.

**Automation:** 👤 fundamentally manual — visual judgment of PDF quality required.

- [ ] 👤 On `index.html`, click "Export PDF". A PDF downloads.
- [ ] 👤 Open the PDF. Verify:
  - Sidebar and top header are NOT in the PDF (they should be hidden via `@media print`)
  - Hero banner appears (without the gradient — collapsed to white bg with black text per print rules)
  - KPI cards and charts visible with sensible borders
  - Tables don't break across pages awkwardly (`tbody tr { break-inside: avoid }`)
- [ ] 👤 Also test browser native print (Cmd+P) on `project-schedule.html` and `inventory.html` — the print preview should match what comes out as PDF.

---

## 6. Performance and accessibility

**Automation:** 🤖 Lighthouse handles both. Run via DevTools or CLI.

### 6.1 Lighthouse audit — `index.html` and `login.html`
- [ ] 🤖 Performance ≥ 80
- [ ] 🤖 Accessibility ≥ 95 (the design system was built to hit AA)
- [ ] 🤖 Best Practices ≥ 90
- [ ] 🤖 No "missing alt text" warnings on the Invenio mark/lockup
- [ ] 🤖 No "low contrast" warnings on dark mode (run Lighthouse in dark mode too)

### 6.2 Manual a11y spot-checks
- [ ] 👤 Tab through `login.html` — every interactive element gets a visible focus ring
- [ ] 👤 Tab through `index.html` top header → sidebar nav → KPI cards → charts → buttons
- [ ] 👤 Use VoiceOver (macOS Cmd+F5) on `login.html` — reads "Invenio" alt text on the mark, labels the email/password inputs
- [ ] 👤 Try `prefers-reduced-motion: reduce` (DevTools → Rendering panel) → animations should be near-instant on theme toggle, page transitions, skeleton shimmers

---

## 7. Real-time and multi-user behavior

**Automation:** 👥 fundamentally requires two sessions — humans or scripted second-client.

- [ ] 👥 User A on `index.html`. User B (in Supabase dashboard or another session) writes a row to a tracked table (e.g., insert a new PO). User A sees a real-time toast appear bottom-right within 2 seconds, with the new dark-mode-aware background (`var(--text)` bg, `var(--text-inverse)` text).
- [ ] 👥 User A on `material-tracking.html`. User B adds a material link. User A's table updates without a reload.
- [ ] 👤 Sign out from one tab — verify another tab logged into the same session also gets kicked to login on next nav.

---

## 8. Cache and deploy hygiene

**Goal:** verify the cache-bust strategy actually works on Netlify.

**Automation:** 🤖 fully scriptable via curl.

- [ ] 🤖 `curl -sI https://invenio-msr.netlify.app/styles.css` → `Cache-Control: public, max-age=300, must-revalidate` (NOT `immutable`)
- [ ] 🤖 `curl -sI https://invenio-msr.netlify.app/js/utils/sidebar.js` → same as above
- [ ] 🤖 `curl -sI https://invenio-msr.netlify.app/favicon-96x96.png` → returns 200, ≤ 86400 max-age
- [ ] 🤖 `curl -sI https://invenio-msr.netlify.app/brand/invenio-mark.svg` → returns 200
- [ ] 🤖 View page source on `index.html` → all local `<script src="js/utils/...">` includes have `?v=YYYYMMDD<letter>`
- [ ] 👤 Deploy a no-op CSS change → bump `?v=` → push → wait for Netlify build → confirm new CSS shows up without a hard refresh in a regular tab

---

## 9. PWA / installability

**Automation:** 👤 manual — install flow is OS-driven.

- [ ] 👤 On Chrome desktop, "Install app" from the address bar — PWA installs with the Invenio mark as the icon.
- [ ] 👤 On iOS Safari, "Add to Home Screen" — apple-touch-icon shows the Invenio mark, not a generic favicon.
- [ ] 👤 Standalone PWA window opens at `index.html` when launched.
- [ ] 👤 Theme color in the OS chrome (Android tab bar, iOS status) reads `#0369a1`.

---

## 10. Cross-cutting smoke

After all the above, do one final "feel" pass.

- [ ] 👤 The app feels coherent — same fonts, spacings, radii, and color usage everywhere
- [ ] 👤 Nothing off-brand jumps out (no orphaned RPS gold, no random magenta from old Bootstrap theme)
- [ ] 👤 Loading states are visible (spinner where data is fetching, not blank cards)
- [ ] 👤 Empty states (no data) display sensibly, not blank space
- [ ] 👤 Error states (network failure, expired session) display sensibly

---

## Automation playbook

A starter Playwright spec to cover §§ 1, 2, 3.1, 6, and 8 — drop it in a new `tests/uat.spec.ts` and run with `npx playwright test`.

```typescript
import { test, expect } from '@playwright/test';

const PAGES = [
  'index.html', 'shipment-visibility.html', 'inventory.html',
  'outside-shop-inventory.html', 'shop-contacts.html', 'gap-analysis.html',
  'material-tracking.html', 'delivery-dates.html', 'project-schedule.html',
  'samsara-tracking.html', 'site-plan.html', 'receiving.html',
  'admin.html', 'login.html',
];

const BASE = process.env.MSR_BASE_URL ?? 'http://localhost:8765';

test.beforeEach(async ({ page }) => {
  // Auth setup — fill in real test creds
  // await page.goto(`${BASE}/login.html`);
  // await page.fill('#email', process.env.TEST_EMAIL!);
  // await page.fill('#password', process.env.TEST_PASSWORD!);
  // await page.click('.login-btn');
});

for (const slug of PAGES) {
  test(`light: ${slug} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${BASE}/${slug}`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${slug}-light.png`, { fullPage: true });
    expect(errors, `console errors on ${slug}`).toEqual([]);
  });

  test(`dark: ${slug} renders without console errors`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('invenio-theme', 'dark'));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${BASE}/${slug}`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${slug}-dark.png`, { fullPage: true });
    expect(errors, `console errors on ${slug}`).toEqual([]);
  });
}

test('theme toggle flips data-theme and persists', async ({ page }) => {
  await page.goto(`${BASE}/index.html`);
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`${BASE}/inventory.html`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('cache headers are not immutable', async ({ request }) => {
  const css = await request.head(`${BASE}/styles.css`);
  expect(css.headers()['cache-control']).not.toContain('immutable');
  expect(css.headers()['cache-control']).toContain('must-revalidate');
});
```

**Run modes:**
- First run: `npx playwright test --update-snapshots` to baseline screenshots
- Regression runs: `npx playwright test` — fails on visual diff
- After intentional design changes: re-baseline + commit the new snapshots

**For Lighthouse automation** (§ 6): use [`@lhci/cli`](https://github.com/GoogleChrome/lighthouse-ci) with config thresholds matching § 6.1.

---

## What can NOT be automated

- **Aesthetic judgment** — "does this feel like the Invenio brand"
- **Multi-user real-time** — needs a second session writing to Supabase while a first session watches (could be scripted but is brittle)
- **Print/PDF visual quality** — humans need to flip through the PDF
- **PWA install flow** — OS-controlled, varies per browser/OS
- **Screen reader behavior** — VoiceOver/NVDA require a person
- **"Did anything obvious break" smoke test** — the final eye-on-the-app pass before declaring done

---

## Sign-off

When all sections complete and no blocking failures:

| Role | Name | Date | Signature |
|---|---|---|---|
| QA tester | | | |
| Product owner | | | |
| Engineering | | | |
