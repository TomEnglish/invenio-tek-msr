# Invitation and password setup recovery

Single-use verification links can be consumed by an email security scanner before the recipient opens the email. The September 9 incident showed a verification success 21 seconds after resend, followed by `One-time token not found` on a later open. This establishes prior consumption; scanner involvement is an inference, not a confirmed identity from the logs.

Invitation and password recovery emails now contain a one-time code and a static link to `login.html`. The link carries only the setup intent and verification type. Opening or prefetching it cannot consume the code. The recipient explicitly submits the email address and code to Supabase `verifyOtp`, then chooses a password. The newest code expires after the configured one-hour period.

For already-confirmed pending users, the existing resend endpoint sends a recovery code; its template retains invitation wording and setup intent. Normal password sign-in also awaits `complete_invitation` before entering the dashboard, so a confirmed user with a password can finish an interrupted invitation. The existing authenticated RPC still checks active status, cancellation, invitation expiry, confirmed email and password. It leaves accepted users unchanged. No role, project membership, expiry policy or database permission is broadened.

## Deploy the paired page and email templates

1. Merge and verify the browser deployment, including `login.html` and `js/utils/login-flow.js` in `release.json`.
2. In the existing Supabase project's Auth configuration, save the current invite/recovery template contents and subjects outside the repository before changing them.
3. Set `mailer_templates_invite_content` from `supabase/templates/invite.html` and `mailer_templates_recovery_content` from `supabase/templates/recovery.html`. Set subjects to `Finish your Invenio invitation` and `Your Invenio access code`. Keep the configured `mailer_otp_exp` at 3600 seconds, matching the email wording and application invitation TTL.
4. Read back those four fields and compare exactly with the checked-in templates. Do not send test email to real colleagues without authorization.

Previously sent links retain their single-use behavior. After this change, use **Users & Access → Resend invitation** to generate a new code. A user who already has a password and a still-valid pending invitation can instead sign in at the normal login page. Their own successful authentication and the existing completion RPC activate the assigned access; administrators do not need to bypass invitation acceptance.

If rollback is needed, restore the prior email templates before rolling the browser back. Keep the code-capable page available while already-delivered codes are still valid. Do not undo users' accepted invitations or reset passwords during a UI rollback.

## Verification

- 54 Node tests pass, including code/type validation, session requirements, template links free of credentials, resend setup intent and awaiting completion before navigation.
- Local browser tests cover wrong-code correction, recovery-code invitation setup through password update and dashboard navigation, expired invitation blocking and phone layout without horizontal overflow.
- A temporary Supabase identity with no project access verified both invite and recovery codes, and confirmed that each rejects reuse. It was removed afterward; no email was sent.
- Independent review approved the change. Production account diagnosis used read-only queries plus a transaction rolled back after validating the existing completion RPC; the colleague's access was not manually changed.

References: [Supabase email prefetching guidance](https://supabase.com/docs/guides/auth/auth-email-templates#email-prefetching), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp).
