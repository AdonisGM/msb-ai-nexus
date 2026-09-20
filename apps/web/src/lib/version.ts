/** Which build this bundle is.
 *
 *  Baked in by Vite at build time from `VITE_APP_VERSION`, which `deploy.sh`
 *  fills from `git describe`. That gives `v0.4.0` on a tagged commit and
 *  `v0.4.0-3-gabc1234` three commits later — and the tail is information, not
 *  noise: it says the running build is not a release.
 *
 *  `dev` when nothing was passed, which is the honest answer on a laptop. */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev'
